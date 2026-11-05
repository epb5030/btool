import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { BiDiClient } from '../protocols/bidi/client.js';
import { CDPClient } from '../protocols/cdp/client.js';
import { ProfileManager } from './profile.js';
function deserializeBiDiValue(remoteValue) {
    if (!remoteValue || typeof remoteValue !== 'object')
        return remoteValue;
    if ('type' in remoteValue) {
        switch (remoteValue.type) {
            case 'string':
            case 'number':
            case 'boolean':
                return remoteValue.value;
            case 'null':
                return null;
            case 'undefined':
                return undefined;
            case 'array':
                return (remoteValue.value || []).map(deserializeBiDiValue);
            case 'object': {
                const obj = {};
                for (const [k, v] of (remoteValue.value || [])) {
                    obj[k] = deserializeBiDiValue(v);
                }
                return obj;
            }
            default:
                return remoteValue.value !== undefined ? remoteValue.value : remoteValue;
        }
    }
    return remoteValue;
}
export class BrowserEngine {
    process = null;
    bidi = null;
    cdp = null;
    currentContextId = null;
    tempProfileDir = null;
    resolvedProfile = null;
    activeBrowser = null;
    consoleLogs = [];
    networkEvents = [];
    findBinary(type) {
        const candidates = {
            zen: ['/usr/bin/zen-browser', '/usr/bin/zen', 'zen-browser', 'zen', '/opt/zen-browser/zen'],
            firefox: ['/usr/bin/firefox', 'firefox'],
            brave: ['/usr/bin/brave-browser', '/usr/bin/brave', 'brave-browser', 'brave', '/opt/brave.com/brave/brave-browser']
        };
        for (const bin of candidates[type]) {
            try {
                // Quick check
                if (bin.startsWith('/')) {
                    if (require('node:fs').existsSync(bin))
                        return bin;
                }
                else {
                    return bin; // Rely on PATH resolution
                }
            }
            catch {
                // Continue
            }
        }
        return candidates[type][0];
    }
    async launch(options) {
        const { browser, headless = false, profile, port = 9222 } = options;
        this.activeBrowser = browser;
        const binary = this.findBinary(browser);
        this.resolvedProfile = await ProfileManager.resolveProfile(browser, profile);
        const profileDir = this.resolvedProfile.path;
        const args = [];
        if (browser === 'firefox' || browser === 'zen') {
            if (headless)
                args.push('--headless');
            args.push('--no-remote');
            args.push('--profile', profileDir);
            args.push('--remote-debugging-port', port.toString());
            args.push('--remote-allow-origins', '*');
            args.push('--remote-allow-hosts', '*');
        }
        else if (browser === 'brave') {
            if (headless)
                args.push('--headless=new');
            args.push(`--user-data-dir=${profileDir}`);
            args.push(`--remote-debugging-port=${port}`);
            args.push('--no-first-run', '--no-default-browser-check');
        }
        this.process = spawn(binary, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true
        });
        this.process.stderr?.on('data', (d) => {
            // debug logs if needed
        });
        await this.waitForPort(port, 15000);
        if (browser === 'firefox' || browser === 'zen') {
            const bidiUrl = `ws://127.0.0.1:${port}/session`;
            this.bidi = new BiDiClient(bidiUrl);
            await this.bidi.connect();
            // Create session
            await this.bidi.send('session.new', { capabilities: {} });
            // Get initial browsing context
            const tree = await this.bidi.send('browsingContext.getTree', {});
            if (tree && tree.contexts && tree.contexts.length > 0) {
                this.currentContextId = tree.contexts[0].context;
            }
            // Subscribe to log and network events
            try {
                await this.bidi.send('session.subscribe', {
                    events: ['log.entryAdded', 'network.responseCompleted']
                });
                this.bidi.on('log.entryAdded', (params) => {
                    this.consoleLogs.push({
                        level: params.level || 'info',
                        text: params.text || JSON.stringify(params),
                        timestamp: params.timestamp || Date.now()
                    });
                    if (this.consoleLogs.length > 200)
                        this.consoleLogs.shift();
                });
                this.bidi.on('network.responseCompleted', (params) => {
                    this.networkEvents.push({
                        method: params.request?.method || 'GET',
                        url: params.request?.url || '',
                        status: params.response?.status,
                        timestamp: Date.now()
                    });
                    if (this.networkEvents.length > 200)
                        this.networkEvents.shift();
                });
            }
            catch {
                // Event subscription may vary by browser build
            }
        }
        else {
            const wsUrl = await CDPClient.discoverWebSocketUrl(port);
            this.cdp = new CDPClient(wsUrl);
            await this.cdp.connect();
            await this.cdp.send('Page.enable');
            await this.cdp.send('Runtime.enable');
            await this.cdp.send('DOM.enable');
            await this.cdp.send('Network.enable');
            this.cdp.on('Runtime.consoleAPICalled', (params) => {
                const text = (params.args || []).map((a) => a.value || a.description || '').join(' ');
                this.consoleLogs.push({
                    level: params.type || 'info',
                    text,
                    timestamp: Date.now()
                });
                if (this.consoleLogs.length > 200)
                    this.consoleLogs.shift();
            });
            this.cdp.on('Network.responseReceived', (params) => {
                this.networkEvents.push({
                    method: 'HTTP',
                    url: params.response?.url || '',
                    status: params.response?.status,
                    timestamp: Date.now()
                });
                if (this.networkEvents.length > 200)
                    this.networkEvents.shift();
            });
        }
    }
    async waitForPort(port, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const net = await import('node:net');
                const socket = new net.Socket();
                await new Promise((resolve, reject) => {
                    socket.connect(port, '127.0.0.1', () => {
                        socket.destroy();
                        resolve();
                    });
                    socket.on('error', (err) => {
                        socket.destroy();
                        reject(err);
                    });
                });
                return;
            }
            catch {
                await new Promise((r) => setTimeout(r, 200));
            }
        }
        throw new Error(`Timed out waiting for browser remote debugging port ${port}`);
    }
    async navigate(url) {
        const formattedUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
        if (this.bidi && this.currentContextId) {
            await this.bidi.send('browsingContext.navigate', {
                context: this.currentContextId,
                url: formattedUrl,
                wait: 'complete'
            });
        }
        else if (this.cdp) {
            await this.cdp.send('Page.navigate', { url: formattedUrl });
        }
        else {
            throw new Error('No active browser connection');
        }
    }
    async evaluate(expression) {
        if (this.bidi && this.currentContextId) {
            const result = await this.bidi.send('script.evaluate', {
                expression,
                target: { context: this.currentContextId },
                awaitPromise: true
            });
            return deserializeBiDiValue(result?.result);
        }
        else if (this.cdp) {
            const result = await this.cdp.send('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            });
            return result?.result?.value;
        }
        else {
            throw new Error('No active browser connection');
        }
    }
    async click(target) {
        const isId = /^\d+$/.test(target.trim());
        const selector = isId ? `[data-btool-id="${target.trim()}"]` : target;
        const script = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return true;
      })()
    `;
        await this.evaluate(script);
    }
    async fill(target, value) {
        const isId = /^\d+$/.test(target.trim());
        const selector = isId ? `[data-btool-id="${target.trim()}"]` : target;
        const script = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'center', inline: 'center' });
        if ('value' in el) {
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        throw new Error("Element is not an input or textarea");
      })()
    `;
        await this.evaluate(script);
    }
    async tagElements() {
        const script = `
      (() => {
        document.querySelectorAll('.btool-badge').forEach(e => e.remove());
        document.querySelectorAll('[data-btool-id]').forEach(e => e.removeAttribute('data-btool-id'));

        const candidates = Array.from(document.querySelectorAll(
          'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [onclick], summary'
        ));

        const items = [];
        let id = 1;

        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            continue;
          }

          const tag = el.tagName.toLowerCase();
          let type = tag;
          if (tag === 'a') type = 'link';
          else if (tag === 'input') type = 'input[' + (el.type || 'text') + ']';
          else if (tag === 'button' || el.getAttribute('role') === 'button') type = 'button';

          let text = (el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
          if (text.length > 80) text = text.slice(0, 77) + '...';

          el.setAttribute('data-btool-id', String(id));

          const badge = document.createElement('span');
          badge.className = 'btool-badge';
          badge.textContent = String(id);
          badge.style.position = 'absolute';
          badge.style.left = (window.scrollX + rect.left) + 'px';
          badge.style.top = (window.scrollY + rect.top) + 'px';
          badge.style.backgroundColor = '#ff4757';
          badge.style.color = '#ffffff';
          badge.style.fontSize = '11px';
          badge.style.fontWeight = 'bold';
          badge.style.padding = '1px 4px';
          badge.style.borderRadius = '3px';
          badge.style.zIndex = '2147483647';
          badge.style.pointerEvents = 'none';
          document.body.appendChild(badge);

          items.push({
            id,
            type,
            text,
            href: el.getAttribute('href') || undefined
          });
          id++;
        }

        return items;
      })()
    `;
        const res = await this.evaluate(script);
        return Array.isArray(res) ? res : [];
    }
    async getSnapshot() {
        const script = `
      (() => {
        return {
          title: document.title,
          url: window.location.href,
          content: document.body ? document.body.innerText : ""
        };
      })()
    `;
        return await this.evaluate(script);
    }
    async captureScreenshot(outputPath) {
        let base64Data;
        if (this.bidi && this.currentContextId) {
            const result = await this.bidi.send('browsingContext.captureScreenshot', {
                context: this.currentContextId
            });
            base64Data = result?.data;
        }
        else if (this.cdp) {
            const result = await this.cdp.send('Page.captureScreenshot', {
                format: 'png'
            });
            base64Data = result?.data;
        }
        else {
            throw new Error('No active browser connection');
        }
        if (!base64Data) {
            throw new Error('Failed to retrieve screenshot data from browser');
        }
        const targetPath = outputPath ? path.resolve(outputPath) : path.join(os.tmpdir(), `btool-screenshot-${Date.now()}.png`);
        await fs.writeFile(targetPath, Buffer.from(base64Data, 'base64'));
        return { path: targetPath, base64: base64Data };
    }
    async getCookies() {
        if (this.bidi) {
            try {
                const res = await this.bidi.send('storage.getCookies', {});
                return deserializeBiDiValue(res?.cookies || []);
            }
            catch {
                const raw = await this.evaluate('document.cookie');
                return String(raw || '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
                    const [name, ...rest] = c.split('=');
                    return { name, value: rest.join('=') };
                });
            }
        }
        else if (this.cdp) {
            const res = await this.cdp.send('Network.getCookies');
            return res?.cookies || [];
        }
        return [];
    }
    async saveCookies(filePath) {
        const cookies = await this.getCookies();
        const absPath = path.resolve(filePath);
        await fs.writeFile(absPath, JSON.stringify(cookies, null, 2));
        return absPath;
    }
    async loadCookies(filePath) {
        const absPath = path.resolve(filePath);
        const data = JSON.parse(await fs.readFile(absPath, 'utf-8'));
        if (!Array.isArray(data))
            throw new Error('Cookies file must contain an array of cookies');
        let loaded = 0;
        for (const c of data) {
            if (this.bidi && c.name && c.value) {
                try {
                    await this.bidi.send('storage.setCookie', { cookie: c });
                    loaded++;
                }
                catch {
                    await this.evaluate(`document.cookie = ${JSON.stringify(`${c.name}=${c.value}; path=${c.path || '/'}`)}`);
                    loaded++;
                }
            }
            else if (this.cdp && c.name && c.value) {
                await this.cdp.send('Network.setCookie', c);
                loaded++;
            }
        }
        return loaded;
    }
    getLogs(clear = false) {
        const copy = [...this.consoleLogs];
        if (clear)
            this.consoleLogs = [];
        return copy;
    }
    getNetwork(clear = false) {
        const copy = [...this.networkEvents];
        if (clear)
            this.networkEvents = [];
        return copy;
    }
    async close() {
        if (this.bidi) {
            this.bidi.close();
            this.bidi = null;
        }
        if (this.cdp) {
            this.cdp.close();
            this.cdp = null;
        }
        if (this.process && this.process.pid) {
            try {
                process.kill(-this.process.pid, 'SIGTERM');
            }
            catch {
                this.process.kill('SIGTERM');
            }
            this.process = null;
        }
        if (this.resolvedProfile?.isEphemeral) {
            try {
                await fs.rm(this.resolvedProfile.path, { recursive: true, force: true });
            }
            catch {
                // ignore cleanup error
            }
            this.resolvedProfile = null;
        }
        this.activeBrowser = null;
    }
}
