export class EventBus {
    listeners = {};
    on(event, listener) {
        if (!this.listeners[event]) {
            this.listeners[event] = new Set();
        }
        this.listeners[event].add(listener);
        return () => this.off(event, listener);
    }
    off(event, listener) {
        this.listeners[event]?.delete(listener);
        if (this.listeners[event]?.size === 0) {
            delete this.listeners[event];
        }
    }
    emit(event, payload) {
        this.listeners[event]?.forEach((listener) => {
            try {
                listener(payload);
            }
            catch (error) {
                console.error(`Event listener failed for ${event}`, error);
            }
        });
    }
}
