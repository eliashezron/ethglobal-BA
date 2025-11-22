export class SessionManager {
    deps;
    sessions = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    async prepareFill(intent) {
        const session = this.sessions.get(intent.orderId) ?? this.createSession(intent);
        // TODO: orchestrate signature requests using Nitrolite SDK
        this.sessions.set(intent.orderId, session);
    }
    createSession(intent) {
        const session = {
            id: `session-${intent.orderId}`,
            channelId: intent.channelId,
            participants: [intent.maker, intent.taker],
            latestVersion: 0,
            status: 'open',
        };
        this.deps.events.emit('channel.session.created', session);
        return session;
    }
}
