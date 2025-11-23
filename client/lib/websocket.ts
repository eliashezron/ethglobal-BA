export type WSStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "reconnect_failed";

export interface WebSocketMessage {
  type: string;
  data?: any;
  timestamp?: number;
  requestId?: string;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private statusChangeListeners: ((status: WSStatus) => void)[] = [];
  private messageListeners: ((message: WebSocketMessage) => void)[] = [];
  private errorListeners: ((error: Error) => void)[] = [];
  private currentStatus: WSStatus = "disconnected";
  private walletAddress: string | null = null;

  constructor(
    private url: string,
    private options: {
      autoReconnect?: boolean;
      reconnectDelay?: number;
      maxReconnectAttempts?: number;
      requestTimeout?: number;
    } = {}
  ) {
    this.options = {
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 5,
      requestTimeout: 10000,
      ...options,
    };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get status(): WSStatus {
    return this.currentStatus;
  }

  private setStatus(status: WSStatus) {
    this.currentStatus = status;
    this.statusChangeListeners.forEach(listener => listener(status));
  }

  async connect(walletAddress: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected");
      return;
    }

    this.walletAddress = walletAddress;
    this.setStatus("connecting");

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log("✅ WebSocket connected");
          this.reconnectAttempts = 0;
          this.setStatus("connected");
          
          // Send auth message
          this.send({
            type: "auth",
            data: { address: this.walletAddress }
          });
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            console.log("📨 Received:", message.type);
            this.messageListeners.forEach(listener => listener(message));
          } catch (error) {
            console.error("Failed to parse message:", error);
          }
        };

        this.ws.onerror = (event) => {
          const error = new Error("WebSocket error");
          console.error("❌ WebSocket error:", error);
          this.errorListeners.forEach(listener => listener(error));
        };

        this.ws.onclose = (event) => {
          console.log("WebSocket closed:", event.code, event.reason);
          this.setStatus("disconnected");
          
          if (this.options.autoReconnect && this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)) {
            this.scheduleReconnect();
          } else if (this.reconnectAttempts >= (this.options.maxReconnectAttempts || 5)) {
            this.setStatus("reconnect_failed");
          }
        };

        // Timeout for connection
        setTimeout(() => {
          if (this.currentStatus === "connecting") {
            this.ws?.close();
            reject(new Error("Connection timeout"));
          }
        }, this.options.requestTimeout);

      } catch (error) {
        this.setStatus("disconnected");
        reject(error);
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    this.setStatus("reconnecting");
    
    console.log(`Reconnecting... (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.walletAddress) {
        this.connect(this.walletAddress).catch(error => {
          console.error("Reconnection failed:", error);
        });
      }
    }, this.options.reconnectDelay);
  }

  send(message: WebSocketMessage) {
    if (!this.isConnected) {
      throw new Error("WebSocket not connected");
    }
    this.ws?.send(JSON.stringify(message));
  }

  async sendRequest(type: string, data?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const requestId = Math.random().toString(36).substring(7);
      const timeoutId = setTimeout(() => {
        reject(new Error("Request timeout"));
      }, this.options.requestTimeout);

      const messageHandler = (message: WebSocketMessage) => {
        if (message.type === `${type}.success` || message.type === `${type}.error`) {
          clearTimeout(timeoutId);
          this.removeMessageListener(messageHandler);
          
          if (message.type.endsWith(".error")) {
            reject(new Error(message.data?.message || "Request failed"));
          } else {
            resolve(message.data);
          }
        }
      };

      this.onMessage(messageHandler);
      this.send({ type, data, requestId });
    });
  }

  close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  onStatusChange(listener: (status: WSStatus) => void) {
    this.statusChangeListeners.push(listener);
  }

  onMessage(listener: (message: WebSocketMessage) => void) {
    this.messageListeners.push(listener);
  }

  onError(listener: (error: Error) => void) {
    this.errorListeners.push(listener);
  }

  private removeMessageListener(listener: (message: WebSocketMessage) => void) {
    const index = this.messageListeners.indexOf(listener);
    if (index > -1) {
      this.messageListeners.splice(index, 1);
    }
  }

  ping() {
    return this.sendRequest("ping");
  }
}
