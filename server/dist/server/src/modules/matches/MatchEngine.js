export class MatchEngine {
    deps;
    constructor(deps) {
        this.deps = deps;
        this.deps.events.on('order.created', (order) => {
            console.log('Match engine received new order', order.id);
        });
    }
}
