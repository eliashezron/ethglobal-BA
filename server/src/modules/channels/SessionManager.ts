import type { EventBus } from '../events/EventBus';
import type { NitroliteClient } from './NitroliteClient';
import type { FillIntent } from '@shared/types/fill';
import type { ChannelSession } from '@shared/types/channel';

interface SessionManagerDeps {
  readonly events: EventBus;
  readonly nitroliteClient: NitroliteClient;
}

export class SessionManager {
  private readonly sessions = new Map<string, ChannelSession>();

  constructor(private readonly deps: SessionManagerDeps) {}

  async prepareFill(intent: FillIntent) {
    const session = this.sessions.get(intent.orderId) ?? this.createSession(intent);
    // TODO: orchestrate signature requests using Nitrolite SDK
    this.sessions.set(intent.orderId, session);
  }

  private createSession(intent: FillIntent): ChannelSession {
    const session: ChannelSession = {
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
