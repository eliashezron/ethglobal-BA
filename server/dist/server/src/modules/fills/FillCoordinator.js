export class FillCoordinator {
    deps;
    constructor(deps) {
        this.deps = deps;
        this.deps.events.on('fill.intent.received', (payload) => {
            const fill = payload;
            void this.initiateFill(fill);
        });
    }
    async initiateFill(intent) {
        // TODO: validation, residual checks, partial logic
        const record = {
            ...intent,
            status: 'proposed',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await this.deps.sessionManager.prepareFill(intent);
        this.deps.events.emit('fill.proposed', record);
        return record;
    }
}
