export class ExpiryWorker {
    context;
    interval;
    constructor(context) {
        this.context = context;
    }
    start() {
        this.interval = setInterval(() => this.tick(), 5_000);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }
    tick() {
        // TODO: scan storage for expired orders and emit cancellations.
        this.context.events.emit('orders.expiry.scan', new Date().toISOString());
    }
}
