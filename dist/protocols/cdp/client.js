export class CDPClient {
    wsUrl;
    ws = null;
    messageId = 1;
    pendingRequests = new Map();
    eventHandlers = new Map();
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
    }
    static async discoverWebSocketUrl(port) {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (!res.ok) {
            throw new Error(`Failed to query CDP discovery endpoint on port ${port}: ${res.statusText}`);
        }
        const data = await res.json();
        if (!data.webSocketDebuggerUrl) {
            throw new Error(`No webSocketDebuggerUrl found on port ${port}`);
        }
        return data.webSocketDebuggerUrl;
    }
    async connect(timeoutMs = 10000) {
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
                        const data = JSON.parse(event.data.toString());
                        if (data.id !== undefined && this.pendingRequests.has(data.id)) {
                            const { resolve, reject } = this.pendingRequests.get(data.id);
                            this.pendingRequests.delete(data.id);
                            if (data.error) {
                                reject(new Error(`CDP Error (${data.error.code}): ${data.error.message}`));
                            }
                            else {
                                resolve(data.result);
                            }
                        }
                        else if (data.method) {
                            const listeners = this.eventHandlers.get(data.method);
                            if (listeners) {
                                for (const fn of listeners) {
                                    fn(data.params);
                                }
                            }
                        }
                    }
                    catch (e) {
                        console.error('Failed to parse CDP message:', e);
                    }
                };
                this.ws.onclose = () => {
                    for (const [, req] of this.pendingRequests) {
                        req.reject(new Error('WebSocket closed'));
                    }
                    this.pendingRequests.clear();
                };
            }
            catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }
    async send(method, params = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('CDP WebSocket is not open');
        }
        const id = this.messageId++;
        const payload = { id, method, params };
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(payload));
        });
    }
    on(event, callback) {
        const handlers = this.eventHandlers.get(event) || [];
        handlers.push(callback);
        this.eventHandlers.set(event, handlers);
    }
    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
