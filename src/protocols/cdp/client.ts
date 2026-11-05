export interface CDPMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export class CDPClient {
  private ws: WebSocket | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private eventHandlers = new Map<string, ((params: any) => void)[]>();

  constructor(private wsUrl: string) {}

  static async discoverWebSocketUrl(port: number): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) {
      throw new Error(`Failed to query CDP discovery endpoint on port ${port}: ${res.statusText}`);
    }
    const data = await res.json() as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error(`No webSocketDebuggerUrl found on port ${port}`);
    }
    return data.webSocketDebuggerUrl;
  }

  async connect(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout connecting to CDP at ${this.wsUrl}`));
      }, timeoutMs);

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };

        this.ws.onerror = (err) => {
          clearTimeout(timer);
          reject(err);
        };

        this.ws.onmessage = (event) => {
          try {
            const data: CDPMessage = JSON.parse(event.data.toString());
            if (data.id !== undefined && this.pendingRequests.has(data.id)) {
              const { resolve, reject } = this.pendingRequests.get(data.id)!;
              this.pendingRequests.delete(data.id);
              if (data.error) {
                reject(new Error(`CDP Error (${data.error.code}): ${data.error.message}`));
              } else {
                resolve(data.result);
              }
            } else if (data.method) {
              const listeners = this.eventHandlers.get(data.method);
              if (listeners) {
                for (const fn of listeners) {
                  fn(data.params);
                }
              }
            }
          } catch (e) {
            console.error('Failed to parse CDP message:', e);
          }
        };

        this.ws.onclose = () => {
          for (const [, req] of this.pendingRequests) {
            req.reject(new Error('WebSocket closed'));
          }
          this.pendingRequests.clear();
        };
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async send(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('CDP WebSocket is not open');
    }

    const id = this.messageId++;
    const payload = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  on(event: string, callback: (params: any) => void): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.push(callback);
    this.eventHandlers.set(event, handlers);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
