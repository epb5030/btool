import * as net from 'node:net';
import * as fs from 'node:fs';
import { SOCKET_PATH, DaemonRequest, DaemonResponse } from './server.js';

export class DaemonClient {
  static isRunning(): boolean {
    return fs.existsSync(SOCKET_PATH);
  }

  static async send(request: DaemonRequest): Promise<DaemonResponse> {
    if (!this.isRunning()) {
      throw new Error(`Daemon is not running. Start it first with: btool start --browser [zen|firefox|brave]`);
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(SOCKET_PATH);
      let buffer = '';

      socket.on('connect', () => {
        socket.write(JSON.stringify(request) + '\n');
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes('\n')) {
          const line = buffer.split('\n')[0];
          try {
            const res: DaemonResponse = JSON.parse(line);
            socket.end();
            resolve(res);
          } catch (e) {
            socket.end();
            reject(e);
          }
        }
      });

      socket.on('error', (err) => {
        reject(err);
      });
    });
  }
}
