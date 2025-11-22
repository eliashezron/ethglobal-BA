export class SnapshotPublisher {
    context;
    interval;
    constructor(context) {
        this.context = context;
    }
    start() {
        this.interval = setInterval(() => this.tick(), 2_000);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }
    tick() {
        // TODO: collect order book snapshot and push to subscribers.
        this.context.events.emit('orderbook.snapshot.publish', new Date().toISOString());
    }
}
