import { loadEnv } from './config/env';
import { NitroliteClient } from './nitrolite/NitroliteClient';
import { EventBus } from './nitrolite/events/EventBus';

export interface ApplicationContext {
  readonly env: ReturnType<typeof loadEnv>;
  readonly events: EventBus;
  readonly nitroliteClient: NitroliteClient;
}

export async function bootstrap() {
  const env = loadEnv();
  const events = new EventBus();
  const nitroliteClient = new NitroliteClient(env.yellow, events);

  if (env.nodeEnv !== 'production') {
    const watch = (event: string) =>
      events.on(event, (payload) => {
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

  const context: ApplicationContext = {
    env,
    events,
    nitroliteClient,
  };

  await nitroliteClient.connect();

  if (env.nodeEnv !== 'production') {
    const participant = '0x3E519A6Afa345b52E18B7497755961BbBEE371ce' as const;
    void nitroliteClient.requestLedgerBalances(participant).catch((error) => {
      events.emit('nitrolite.ledger.error', {
        participant,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return context;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error) => {
    console.error('Failed to bootstrap application', error);
    process.exitCode = 1;
  });
}
