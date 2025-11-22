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
    const nitroliteClient = new NitroliteClient(env.yellow);
    const sessionManager = new SessionManager({ events, nitroliteClient });
    const orderService = new OrderService({ events, sessionManager });
    const fillCoordinator = new FillCoordinator({ events, sessionManager, orderService });
    const matchEngine = new MatchEngine({ events, orderService });
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
    buildServer({ context });
    return context;
}
if (import.meta.url === `file://${process.argv[1]}`) {
    bootstrap().catch((error) => {
        console.error('Failed to bootstrap application', error);
        process.exitCode = 1;
    });
}
