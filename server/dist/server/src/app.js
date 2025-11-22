import { loadEnv } from './config/env';
import { buildServer } from './modules/websocket/server';
import { OrderService } from './modules/orders/OrderService';
import { FillCoordinator } from './modules/fills/FillCoordinator';
import { MatchEngine } from './modules/matches/MatchEngine';
import { SessionManager } from './modules/channels/SessionManager';
import { NitroliteClient } from './modules/channels/NitroliteClient';
import { EventBus } from './modules/events/EventBus';
export async function bootstrap() {
    const env = loadEnv();
    const events = new EventBus();
    const nitroliteClient = new NitroliteClient(env.yellow, events);
    const sessionManager = new SessionManager({ events, nitroliteClient });
    const orderService = new OrderService({ events, sessionManager });
    const fillCoordinator = new FillCoordinator({ events, sessionManager, orderService });
    const matchEngine = new MatchEngine({ events });
    if (env.nodeEnv !== 'production') {
        const watch = (event) => events.on(event, (payload) => {
            console.log(`[${event}]`, payload);
        });
        watch('nitrolite.connection.initiated');
        watch('nitrolite.connection.open');
        watch('nitrolite.connection.closed');
        watch('nitrolite.connection.error');
        watch('nitrolite.auth.requested');
        watch('nitrolite.auth.challenge');
        watch('nitrolite.auth.verify.jwt');
        watch('nitrolite.auth.verify.jwt_failed');
        watch('nitrolite.auth.success');
        watch('nitrolite.auth.failed');
        watch('nitrolite.auth.error');
        watch('nitrolite.rpc.error');
        watch('nitrolite.message.AuthVerify');
        watch('nitrolite.message.AuthChallenge');
        watch('nitrolite.session.mismatch');
        watch('nitrolite.session.generated');
        watch('nitrolite.channels.requested');
        watch('nitrolite.channels.received');
        watch('nitrolite.channels.entry');
        watch('nitrolite.ledger.requested');
        watch('nitrolite.ledger.received');
        watch('nitrolite.ledger.error');
    }
    const context = {
        env,
        events,
        nitroliteClient,
        sessionManager,
        orderService,
        fillCoordinator,
        matchEngine,
    };
    await nitroliteClient.connect();
    if (env.nodeEnv !== 'production') {
        const participant = '0x3E519A6Afa345b52E18B7497755961BbBEE371ce';
        void nitroliteClient.requestLedgerBalances(participant).catch((error) => {
            events.emit('nitrolite.ledger.error', {
                participant,
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }
    buildServer({ context });
    return context;
}
if (import.meta.url === `file://${process.argv[1]}`) {
    bootstrap().catch((error) => {
        console.error('Failed to bootstrap application', error);
        process.exitCode = 1;
    });
}
