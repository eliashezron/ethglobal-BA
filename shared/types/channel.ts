export type ChannelSessionStatus = 'open' | 'closing' | 'closed';

export interface ChannelSession {
  readonly id: string;
  readonly channelId: string;
  readonly participants: readonly string[];
  latestVersion: number;
  status: ChannelSessionStatus;
}

export interface ChannelStateUpdate {
  readonly sessionId: string;
  readonly version: number;
  readonly payloadHash: string;
  readonly signatures: readonly string[];
}
