import { handleCLI } from './cli/index.js';
import { runMCPServer } from './mcp/server.js';
async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--mcp')) {
        await runMCPServer();
    }
    else {
        await handleCLI(args);
    }
}
main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
