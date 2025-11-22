type EventListener<T> = (payload: T) => void;

interface EventRegistry {
  [event: string]: Set<EventListener<unknown>>;
}

export class EventBus {
  private readonly listeners: EventRegistry = {};

  on<T>(event: string, listener: EventListener<T>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event].add(listener as EventListener<unknown>);
    return () => this.off(event, listener);
  }

  off<T>(event: string, listener: EventListener<T>): void {
    this.listeners[event]?.delete(listener as EventListener<unknown>);
    if (this.listeners[event]?.size === 0) {
      delete this.listeners[event];
    }
  }

  emit<T>(event: string, payload: T): void {
    this.listeners[event]?.forEach((listener) => {
      try {
        (listener as EventListener<T>)(payload);
      } catch (error) {
        console.error(`Event listener failed for ${event}`, error);
      }
    });
  }
}
