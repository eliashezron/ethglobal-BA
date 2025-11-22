import type { ApplicationContext } from '../app';

export class DisputeWatcher {
  private interval?: ReturnType<typeof setInterval>;

  constructor(private readonly context: ApplicationContext) {}

  start() {
    this.interval = setInterval(() => this.tick(), 15_000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private tick() {
    // TODO: query Nitrolite for sessions nearing their challenge windows.
    this.context.events.emit('channels.dispute.scan', new Date().toISOString());
  }
}
