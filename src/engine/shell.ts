import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ShellRunner {
  static async run(command: string, cwd: string = process.cwd()): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 10 * 1024 * 1024 });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };
    } catch (err: any) {
      return {
        stdout: (err.stdout || '').trim(),
        stderr: (err.stderr || err.message || '').trim(),
        exitCode: err.code ?? 1
      };
    }
  }
}
