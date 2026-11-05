import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrowserEngine } from '../engine/browser.js';
import { ShellRunner } from '../engine/shell.js';
export async function runMCPServer() {
    const server = new McpServer({
        name: 'btool',
        version: '0.1.0'
    });
    const engine = new BrowserEngine();
    server.tool('browser_start', 'Start a browser session (Zen Browser, Firefox, or Brave)', {
        browser: z.enum(['zen', 'firefox', 'brave']).default('zen').describe('Browser target to launch'),
        headless: z.boolean().default(true).describe('Whether to run headless'),
        profile: z.string().optional().describe('Path to specific browser profile directory')
    }, async ({ browser, headless, profile }) => {
        try {
            await engine.launch({ browser: browser, headless, profile });
            return {
                content: [{ type: 'text', text: `Successfully started ${browser} browser session.` }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Failed to start browser: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_navigate', 'Navigate the active browser to a URL', {
        url: z.string().describe('URL to navigate to')
    }, async ({ url }) => {
        try {
            await engine.navigate(url);
            return {
                content: [{ type: 'text', text: `Navigated to ${url}` }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Navigation error: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_snapshot', 'Get current page title, URL, and visible text content', {}, async () => {
        try {
            const snap = await engine.getSnapshot();
            return {
                content: [
                    {
                        type: 'text',
                        text: `# ${snap.title}\nURL: ${snap.url}\n\n${snap.content}`
                    }
                ]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Snapshot error: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_screenshot', 'Capture a screenshot of the active browser viewport and save to file', {
        path: z.string().optional().describe('Target output path for the PNG file')
    }, async ({ path }) => {
        try {
            const res = await engine.captureScreenshot(path);
            return {
                content: [{ type: 'text', text: `Screenshot captured and saved to: ${res.path}` }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Screenshot error: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_elements', 'List all interactive elements (links, buttons, inputs) with numeric IDs for easy clicking', {}, async () => {
        try {
            const items = await engine.tagElements();
            const text = items.map((i) => `[${i.id}] <${i.type}> "${i.text}"${i.href ? ` -> ${i.href}` : ''}`).join('\n');
            return {
                content: [{ type: 'text', text: text || 'No interactive elements found.' }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Error tagging elements: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_click', 'Click an element matching numeric ID (e.g. "1") or CSS selector', {
        target: z.string().describe('Numeric element ID from browser_elements or CSS selector')
    }, async ({ target }) => {
        try {
            await engine.click(target);
            return {
                content: [{ type: 'text', text: `Clicked ${target}` }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Click error: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_fill', 'Fill text into an input matching numeric ID (e.g. "2") or CSS selector', {
        target: z.string().describe('Numeric element ID from browser_elements or CSS selector'),
        value: z.string().describe('Text value to enter')
    }, async ({ target, value }) => {
        try {
            await engine.fill(target, value);
            return {
                content: [{ type: 'text', text: `Filled ${target}` }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Fill error: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_evaluate', 'Evaluate JavaScript in the active page context', {
        expression: z.string().describe('JavaScript code to evaluate')
    }, async ({ expression }) => {
        try {
            const result = await engine.evaluate(expression);
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
                    }
                ]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Eval error: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('system_exec', 'Execute a CLI / shell command', {
        command: z.string().describe('Shell command to execute'),
        cwd: z.string().optional().describe('Working directory for the command')
    }, async ({ command, cwd }) => {
        try {
            const res = await ShellRunner.run(command, cwd);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Exit Code: ${res.exitCode}\nSTDOUT:\n${res.stdout}\n${res.stderr ? `STDERR:\n${res.stderr}` : ''}`
                    }
                ]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Execution failed: ${err.message}` }],
                isError: true
            };
        }
    });
    server.tool('browser_get_logs', 'Get recent console logs and errors from the browser', {
        clear: z.boolean().default(false).describe('Whether to clear logs after fetching')
    }, async ({ clear }) => {
        const logs = engine.getLogs(clear);
        const text = logs.map((l) => `[${l.level.toUpperCase()}] ${l.text}`).join('\n');
        return {
            content: [{ type: 'text', text: text || 'No console logs.' }]
        };
    });
    server.tool('browser_get_network', 'Get recent network requests and HTTP responses from the browser', {
        clear: z.boolean().default(false).describe('Whether to clear network events after fetching')
    }, async ({ clear }) => {
        const events = engine.getNetwork(clear);
        const text = events.map((e) => `[${e.status || 'PENDING'}] ${e.method} ${e.url}`).join('\n');
        return {
            content: [{ type: 'text', text: text || 'No network requests.' }]
        };
    });
    server.tool('browser_stop', 'Close the active browser session', {}, async () => {
        try {
            await engine.close();
            return {
                content: [{ type: 'text', text: 'Browser session closed.' }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Error stopping browser: ${err.message}` }],
                isError: true
            };
        }
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
