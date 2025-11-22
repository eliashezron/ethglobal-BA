export class DisputeWatcher {
    context;
    interval;
    constructor(context) {
        this.context = context;
    }
    start() {
        this.interval = setInterval(() => this.tick(), 15_000);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }
    tick() {
        // TODO: query Nitrolite for sessions nearing their challenge windows.
        this.context.events.emit('channels.dispute.scan', new Date().toISOString());
    }
}
