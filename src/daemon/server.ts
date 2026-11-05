import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BrowserEngine, BrowserType } from '../engine/browser.js';
import { ShellRunner } from '../engine/shell.js';

export const SOCKET_PATH = path.join(os.homedir(), '.btool.sock');

export interface DaemonRequest {
  action: 'start' | 'stop' | 'navigate' | 'evaluate' | 'click' | 'fill' | 'snapshot' | 'screenshot' | 'elements' | 'cookies-get' | 'cookies-save' | 'cookies-load' | 'logs' | 'network' | 'exec' | 'status';
  payload?: any;
}

export interface DaemonResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export class DaemonServer {
  private engine = new BrowserEngine();
  private server: net.Server | null = null;

  async start(): Promise<void> {
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {
        // ignore
      }
    }

    this.server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', async (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const req: DaemonRequest = JSON.parse(line);
            const res = await this.handleRequest(req);
            socket.write(JSON.stringify(res) + '\n');
            if (req.action === 'stop') {
              setTimeout(() => this.shutdown(), 200);
            }
          } catch (err: any) {
            socket.write(JSON.stringify({ success: false, error: err.message }) + '\n');
          }
        }
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(SOCKET_PATH, () => {
        resolve();
      });
    });
  }

  private async handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
    try {
      switch (req.action) {
        case 'start': {
          const { browser = 'zen', headless = true, profile, port = 9222 } = req.payload || {};
          await this.engine.launch({ browser, headless, profile, port });
          return { success: true, data: { browser, message: `Launched ${browser}` } };
        }
        case 'navigate': {
          await this.engine.navigate(req.payload.url);
          return { success: true, data: { url: req.payload.url } };
        }
        case 'evaluate': {
          const result = await this.engine.evaluate(req.payload.expression);
          return { success: true, data: result };
        }
        case 'click': {
          await this.engine.click(req.payload.selector);
          return { success: true, data: { clicked: req.payload.selector } };
        }
        case 'fill': {
          await this.engine.fill(req.payload.selector, req.payload.value);
          return { success: true, data: { filled: req.payload.selector } };
        }
        case 'snapshot': {
          const data = await this.engine.getSnapshot();
          return { success: true, data };
        }
        case 'screenshot': {
          const res = await this.engine.captureScreenshot(req.payload?.path);
          return { success: true, data: res };
        }
        case 'elements': {
          const items = await this.engine.tagElements();
          return { success: true, data: items };
        }
        case 'cookies-get': {
          const cookies = await this.engine.getCookies();
          return { success: true, data: cookies };
        }
        case 'cookies-save': {
          const savedPath = await this.engine.saveCookies(req.payload.path);
          return { success: true, data: { path: savedPath } };
        }
        case 'cookies-load': {
          const count = await this.engine.loadCookies(req.payload.path);
          return { success: true, data: { loaded: count } };
        }
        case 'logs': {
          const logs = this.engine.getLogs(Boolean(req.payload?.clear));
          return { success: true, data: logs };
        }
        case 'network': {
          const events = this.engine.getNetwork(Boolean(req.payload?.clear));
          return { success: true, data: events };
        }
        case 'exec': {
          const res = await ShellRunner.run(req.payload.command, req.payload.cwd);
          return { success: true, data: res };
        }
        case 'status': {
          return { success: true, data: { activeBrowser: this.engine.activeBrowser } };
        }
        case 'stop': {
          await this.engine.close();
          return { success: true, data: { stopped: true } };
        }
        default:
          return { success: false, error: `Unknown action: ${(req as any).action}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  async shutdown(): Promise<void> {
    await this.engine.close();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {
        // ignore
      }
    }
    process.exit(0);
  }
}
