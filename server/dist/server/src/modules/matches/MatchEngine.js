export class MatchEngine {
    deps;
    constructor(deps) {
        this.deps = deps;
        this.deps.events.on('order.intent.received', (payload) => {
            const intent = payload;
            this.deps.orderService.createOrder(intent);
        });
    }
}
