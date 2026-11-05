export interface BiDiMessage {
  id?: number;
  type?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
  message?: string;
}

export class BiDiClient {
  private ws: WebSocket | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private eventHandlers = new Map<string, ((params: any) => void)[]>();

  constructor(private url: string) {}

  async connect(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout connecting to WebDriver BiDi at ${this.url}`));
      }, timeoutMs);

      try {
        this.ws = new WebSocket(this.url);

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
            const data: BiDiMessage = JSON.parse(event.data.toString());
            if (data.id !== undefined && this.pendingRequests.has(data.id)) {
              const { resolve, reject } = this.pendingRequests.get(data.id)!;
              this.pendingRequests.delete(data.id);
              if (data.error) {
                reject(new Error(`BiDi Error (${data.error}): ${data.message || ''}`));
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
            console.error('Failed to parse BiDi message:', e);
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
      throw new Error('BiDi WebSocket is not open');
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
