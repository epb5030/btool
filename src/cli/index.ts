import { spawn } from 'node:child_process';
import { DaemonClient } from '../daemon/client.js';
import { DaemonServer } from '../daemon/server.js';

export async function handleCLI(args: string[]): Promise<void> {
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  // Internal daemon runner
  if (command === '__daemon__') {
    const server = new DaemonServer();
    await server.start();
    return;
  }

  switch (command) {
    case 'start': {
      let browser = 'zen';
      let headless = true;
      let profile: string | undefined;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--browser' && args[i + 1]) {
          browser = args[++i];
        } else if (args[i] === '--headful') {
          headless = false;
        } else if (args[i] === '--headless') {
          headless = true;
        } else if (args[i] === '--profile' && args[i + 1]) {
          profile = args[++i];
        }
      }

      if (!DaemonClient.isRunning()) {
        // Spawn background daemon process
        const binPath = process.argv[1];
        const child = spawn(process.execPath, [binPath, '__daemon__'], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        // Wait for daemon socket
        let retries = 20;
        while (retries-- > 0 && !DaemonClient.isRunning()) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      const res = await DaemonClient.send({
        action: 'start',
        payload: { browser, headless, profile }
      });

      if (res.success) {
        console.log(`✓ Started session with ${browser} (headless: ${headless})`);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'navigate': {
      const url = args[1];
      if (!url) {
        console.error('Usage: btool navigate <url>');
        process.exit(1);
      }
      const res = await DaemonClient.send({ action: 'navigate', payload: { url } });
      if (res.success) {
        console.log(`✓ Navigated to ${url}`);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'snapshot': {
      const res = await DaemonClient.send({ action: 'snapshot' });
      if (res.success) {
        const { title, url, content } = res.data;
        console.log(`=== ${title} ===`);
        console.log(`URL: ${url}\n`);
        console.log(content);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'screenshot': {
      let targetPath: string | undefined;
      for (let i = 1; i < args.length; i++) {
        if ((args[i] === '-o' || args[i] === '--output') && args[i + 1]) {
          targetPath = args[++i];
        } else if (!args[i].startsWith('-')) {
          targetPath = args[i];
        }
      }

      const res = await DaemonClient.send({ action: 'screenshot', payload: { path: targetPath } });
      if (res.success) {
        console.log(`✓ Screenshot saved: ${res.data.path}`);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'elements':
    case 'tags': {
      const res = await DaemonClient.send({ action: 'elements' });
      if (res.success) {
        const items = res.data as Array<{ id: number; type: string; text: string; href?: string }>;
        if (items.length === 0) {
          console.log('No visible interactive elements found.');
        } else {
          console.log(`=== Interactive Elements (${items.length}) ===`);
          for (const item of items) {
            const extra = item.href ? ` -> ${item.href}` : '';
            console.log(`[${item.id}] <${item.type}> "${item.text}"${extra}`);
          }
        }
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'cookies': {
      const sub = args[1] || 'get';
      if (sub === 'get') {
        const res = await DaemonClient.send({ action: 'cookies-get' });
        if (res.success) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.error(`✗ Error: ${res.error}`);
          process.exit(1);
        }
      } else if (sub === 'save') {
        const targetPath = args[2] || 'cookies.json';
        const res = await DaemonClient.send({ action: 'cookies-save', payload: { path: targetPath } });
        if (res.success) {
          console.log(`✓ Cookies saved to: ${res.data.path}`);
        } else {
          console.error(`✗ Error: ${res.error}`);
          process.exit(1);
        }
      } else if (sub === 'load') {
        const sourcePath = args[2];
        if (!sourcePath) {
          console.error('Usage: btool cookies load <path>');
          process.exit(1);
        }
        const res = await DaemonClient.send({ action: 'cookies-load', payload: { path: sourcePath } });
        if (res.success) {
          console.log(`✓ Loaded ${res.data.loaded} cookies.`);
        } else {
          console.error(`✗ Error: ${res.error}`);
          process.exit(1);
        }
      } else {
        console.error(`Unknown cookies subcommand: ${sub}. Use get, save, or load.`);
        process.exit(1);
      }
      break;
    }

    case 'logs': {
      const clear = args.includes('--clear');
      const res = await DaemonClient.send({ action: 'logs', payload: { clear } });
      if (res.success) {
        const logs = res.data as Array<{ level: string; text: string; timestamp: number }>;
        if (logs.length === 0) {
          console.log('No console logs recorded.');
        } else {
          for (const log of logs) {
            const time = new Date(log.timestamp).toISOString().split('T')[1].replace('Z', '');
            console.log(`[${time}] [${log.level.toUpperCase()}] ${log.text}`);
          }
        }
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'network': {
      const clear = args.includes('--clear');
      const res = await DaemonClient.send({ action: 'network', payload: { clear } });
      if (res.success) {
        const events = res.data as Array<{ method: string; url: string; status?: number; timestamp: number }>;
        if (events.length === 0) {
          console.log('No network events recorded.');
        } else {
          for (const ev of events) {
            const statusStr = ev.status ? `[${ev.status}]` : '[PENDING]';
            console.log(`${statusStr} ${ev.method} ${ev.url}`);
          }
        }
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'click': {
      const selector = args[1];
      if (!selector) {
        console.error('Usage: btool click <selector>');
        process.exit(1);
      }
      const res = await DaemonClient.send({ action: 'click', payload: { selector } });
      if (res.success) {
        console.log(`✓ Clicked element: ${selector}`);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'fill': {
      const selector = args[1];
      const value = args[2];
      if (!selector || value === undefined) {
        console.error('Usage: btool fill <selector> <value>');
        process.exit(1);
      }
      const res = await DaemonClient.send({ action: 'fill', payload: { selector, value } });
      if (res.success) {
        console.log(`✓ Filled ${selector}`);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'eval': {
      const expression = args.slice(1).join(' ');
      if (!expression) {
        console.error('Usage: btool eval <expression>');
        process.exit(1);
      }
      const res = await DaemonClient.send({ action: 'evaluate', payload: { expression } });
      if (res.success) {
        console.log(typeof res.data === 'object' ? JSON.stringify(res.data, null, 2) : res.data);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'exec': {
      const commandStr = args.slice(1).join(' ');
      if (!commandStr) {
        console.error('Usage: btool exec <command>');
        process.exit(1);
      }
      const res = await DaemonClient.send({ action: 'exec', payload: { command: commandStr } });
      if (res.success) {
        if (res.data.stdout) console.log(res.data.stdout);
        if (res.data.stderr) console.error(res.data.stderr);
        process.exit(res.data.exitCode);
      } else {
        console.error(`✗ Error: ${res.error}`);
        process.exit(1);
      }
      break;
    }

    case 'status': {
      if (!DaemonClient.isRunning()) {
        console.log('No btool daemon running.');
        return;
      }
      const res = await DaemonClient.send({ action: 'status' });
      if (res.success) {
        console.log(`Active browser: ${res.data.activeBrowser || 'None'}`);
      } else {
        console.error(`✗ Error: ${res.error}`);
      }
      break;
    }

    case 'stop': {
      if (!DaemonClient.isRunning()) {
        console.log('Daemon is not running.');
        return;
      }
      const res = await DaemonClient.send({ action: 'stop' });
      if (res.success) {
        console.log('✓ Stopped session and browser.');
      } else {
        console.error(`✗ Error: ${res.error}`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
btool - Cross-browser CLI & MCP Automation Tool
Targeting Zen Browser, Firefox, and Brave with CLI Execution

USAGE:
  btool start [--browser zen|firefox|brave] [--headless|--headful] [--profile <name|path>]
  btool navigate <url>
  btool snapshot
  btool elements
  btool screenshot [-o <path>]
  btool cookies [get | save <path> | load <path>]
  btool logs [--clear]
  btool network [--clear]
  btool click <selector|id>
  btool fill <selector|id> <value>
  btool eval <expression>
  btool exec <command>
  btool status
  btool stop
  btool --mcp

EXAMPLES:
  btool start --browser zen
  btool navigate https://example.com
  btool snapshot
  btool eval "document.title"
  btool exec "curl -s https://httpbin.org/ip"
  btool stop
`);
}
