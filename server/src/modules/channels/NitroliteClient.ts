import type { YellowEnvConfig } from '../../config/env';
import type { ChannelStateUpdate } from '@shared/types/channel';

interface NitroliteConnection {
  readonly connected: boolean;
}

export class NitroliteClient {
  private connection: NitroliteConnection = { connected: false };

  constructor(private readonly config: YellowEnvConfig) {}

  async connect() {
    // TODO: initialize Nitrolite SDK client with credentials
    this.connection = { connected: true };
    console.log('Nitrolite client connected to', this.config.rpcUrl);
  }

  async updateChannel(_update: ChannelStateUpdate) {
    if (!this.connection.connected) {
      throw new Error('Nitrolite client not connected');
    }
    // TODO: push updated state to ClearNode
  }
}
