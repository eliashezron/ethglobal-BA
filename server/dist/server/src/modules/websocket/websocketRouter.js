export class Router {
    context;
    constructor(context) {
        this.context = context;
    }
    handleOrderCreate(_intent) {
        // TODO: wire into OrderService once transport layer is selected.
        this.context.events.emit('order.intent.received', _intent);
    }
    handleFillProposed(_fill) {
        this.context.events.emit('fill.intent.received', _fill);
    }
}
