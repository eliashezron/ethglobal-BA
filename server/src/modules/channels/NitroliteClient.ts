import { WebSocket } from 'ws';
import { ethers } from 'ethers';
import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createAuthVerifyMessageWithJWT,
  createECDSAMessageSigner,
  createGetChannelsMessage,
  createPingMessage,
  getError,
  getMethod,
  getParams,
  getResult,
  RPCMethod,
  EIP712AuthTypes,
  type MessageSigner,
} from '@erc7824/nitrolite';

import type { YellowEnvConfig } from '../../config/env';
import type { EventBus } from '../events/EventBus';
import type { ChannelStateUpdate } from '@shared/types/channel';
import {
  generateSessionKey,
  getStoredJWT,
  getStoredSessionKey,
  removeJWT,
  removeSessionKey,
  storeJWT,
  storeSessionKey,
  type SessionKey,
} from '../../lib/utils';

type Address = `0x${string}`;
type Hex = `0x${string}`;

type ConnectionState = 'idle' | 'connecting' | 'authenticated';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface NitroliteMessageContext {
  readonly method: RPCMethod;
  readonly payload: unknown;
  readonly raw: unknown;
}

type AuthAllowance = { asset: string; amount: string };

interface AuthContext {
  scope: string;
  application: Address;
  participant: Address;
  expire: string;
  allowances: AuthAllowance[];
}

export class NitroliteClient {
  private readonly wallet: ethers.Wallet;
  private readonly walletAddress: Address;
  private readonly applicationAddress: Address;
  private readonly sessionWallet: ethers.Wallet;
  private readonly sessionKey: Address;
  private readonly sessionMessageSigner: MessageSigner;

  private socket?: WebSocket;
  private state: ConnectionState = 'idle';
  private jwtToken?: string;
  private connectPromise?: Promise<void>;
  private resolveConnect?: () => void;
  private rejectConnect?: (error: Error) => void;
  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private shouldReconnect = true;
  private pendingAuth?: AuthContext;

  constructor(private readonly config: YellowEnvConfig, private readonly events: EventBus) {
    this.wallet = new ethers.Wallet(this.config.privateKey);
    this.walletAddress = this.wallet.address as Address;
    this.applicationAddress = (this.config.applicationAddress === ZERO_ADDRESS
      ? this.walletAddress
      : (this.config.applicationAddress as Address));
    const storedSession = this.safeLoadSessionKey();
    const configuredSessionKey = this.isZeroHex(this.config.sessionKey)
      ? undefined
      : (this.config.sessionKey as Address);
    const configuredSessionPrivateKey = this.normalizeHex(this.config.sessionPrivateKey);

    let sessionSource: SessionKey | undefined;

    if (configuredSessionPrivateKey) {
      const wallet = new ethers.Wallet(configuredSessionPrivateKey);
      sessionSource = { privateKey: configuredSessionPrivateKey, address: wallet.address as Address };
      if (configuredSessionKey && configuredSessionKey.toLowerCase() !== sessionSource.address.toLowerCase()) {
        this.events.emit('nitrolite.session.mismatch', {
          configuredSessionKey,
          derivedSessionKey: sessionSource.address,
        });
      }
    } else if (storedSession) {
      sessionSource = storedSession;
      if (configuredSessionKey && configuredSessionKey.toLowerCase() !== storedSession.address.toLowerCase()) {
        this.events.emit('nitrolite.session.mismatch', {
          configuredSessionKey,
          derivedSessionKey: storedSession.address,
        });
      }
    } else {
      sessionSource = generateSessionKey();
      storeSessionKey(sessionSource);
      this.events.emit('nitrolite.session.generated', { address: sessionSource.address });
    }

    this.sessionWallet = new ethers.Wallet(sessionSource.privateKey);
    const derivedSessionKey = this.sessionWallet.address as Address;
    this.sessionKey = configuredSessionKey ?? (storedSession?.address as Address | undefined) ?? derivedSessionKey;

    if (this.sessionKey.toLowerCase() !== derivedSessionKey.toLowerCase()) {
      this.events.emit('nitrolite.session.mismatch', {
        configuredSessionKey: this.sessionKey,
        derivedSessionKey,
      });
    }

    if (!configuredSessionPrivateKey) {
      storeSessionKey({ privateKey: this.sessionWallet.privateKey as Hex, address: derivedSessionKey });
    }

      this.sessionMessageSigner = createECDSAMessageSigner(this.sessionWallet.privateKey as Hex);
    this.jwtToken = getStoredJWT() ?? this.jwtToken;
      this.jwtToken = getStoredJWT() ?? undefined;
  }

  get address(): Address {
    return this.walletAddress;
  }

  get isConnected(): boolean {
    return this.state === 'authenticated';
  }

  get jwt(): string | undefined {
    return this.jwtToken;
  }

  async connect(): Promise<void> {
    if (this.state === 'authenticated' && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.state === 'connecting' && this.connectPromise) {
      return this.connectPromise;
    }

    this.shouldReconnect = true;
    this.state = 'connecting';
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
      this.openSocket();
    });

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, 'client disconnect');
    }
    this.cleanup();
  }

  async updateChannel(_update: ChannelStateUpdate) {
    if (!this.isConnected) {
      throw new Error('Nitrolite client not connected');
    }
    // TODO: push updated state to ClearNode
  }

  private openSocket() {
    this.events.emit('nitrolite.connection.initiated', {
      url: this.config.clearNodeUrl,
      address: this.walletAddress,
    });

    const socket = new WebSocket(this.config.clearNodeUrl);
    this.socket = socket;

    socket.on('open', () => {
      this.events.emit('nitrolite.connection.open', { url: this.config.clearNodeUrl });
      this.authenticate();
    });

    socket.on('message', (data) => {
      void this.handleMessage(data.toString());
    });

    socket.on('error', (error) => {
      this.events.emit('nitrolite.connection.error', {
        error: error instanceof Error ? error.message : String(error),
      });

      if (this.rejectConnect) {
        this.rejectConnect(error as Error);
        this.rejectConnect = undefined;
        this.resolveConnect = undefined;
      }

      if (this.state === 'connecting') {
        this.cleanup();
      }
    });

    socket.on('close', (code, reason) => {
      const closeReason = reason.toString() || 'unknown';
      this.events.emit('nitrolite.connection.closed', { code, reason: closeReason });

      if (this.state === 'connecting' && this.rejectConnect) {
        this.rejectConnect(new Error(`ClearNode connection closed (${code}): ${closeReason}`));
      }

      this.cleanup();
      this.scheduleReconnect();
    });
  }

  private async authenticate() {
    try {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not open');
      }

      if (this.jwtToken) {
        try {
          const verifyWithJwt = await createAuthVerifyMessageWithJWT(this.jwtToken);
          this.socket.send(verifyWithJwt);
          this.events.emit('nitrolite.auth.verify.jwt', {});
          return;
        } catch (error) {
          this.jwtToken = undefined;
          removeJWT();
          this.events.emit('nitrolite.auth.verify.jwt_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await this.sendAuthRequest('initial');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.emit('nitrolite.auth.error', { message });
      if (this.rejectConnect) {
        this.rejectConnect(error as Error);
        this.rejectConnect = undefined;
        this.resolveConnect = undefined;
      }
      this.cleanup();
    }
  }

  private async handleMessage(raw: string) {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.events.emit('nitrolite.message.invalid', { raw });
      return;
    }

    const method = getMethod(parsed) as RPCMethod | undefined;
    const error = getError(parsed);
    if (error) {
      this.events.emit('nitrolite.rpc.error', error);
    }

    if (!method) {
      this.events.emit('nitrolite.message.unknown', { raw: parsed });
      return;
    }

    const payload = parsed.req ? getParams(parsed) : getResult(parsed);
    const context: NitroliteMessageContext = { method, payload, raw: parsed };

    switch (method) {
      case RPCMethod.AuthChallenge:
        await this.handleAuthChallenge(context);
        break;
      case RPCMethod.AuthVerify:
        await this.handleAuthVerify(context);
        break;
      case RPCMethod.Error:
        this.handleError(context);
        break;
      default:
        this.events.emit(`nitrolite.message.${method}`, payload);
    }
  }

  private async handleAuthChallenge({ payload }: NitroliteMessageContext) {
    const data = this.unwrapPayload(payload) as { challengeMessage?: string; challenge_message?: string };
    const challengeMessage = data?.challengeMessage ?? data?.challenge_message;

    if (!challengeMessage) {
      const error = new Error('Missing challengeMessage in auth challenge');
      this.events.emit('nitrolite.auth.error', { message: error.message });
      if (this.rejectConnect) {
        this.rejectConnect(error);
        this.rejectConnect = undefined;
        this.resolveConnect = undefined;
      }
      this.cleanup();
      return;
    }

    try {
      if (!this.pendingAuth) {
        await this.sendAuthRequest('retry');
      }

      const authVerify = await createAuthVerifyMessageFromChallenge(
        this.createAuthVerifyMessageSigner(),
        challengeMessage,
      );
      this.socket?.send(authVerify);
      this.events.emit('nitrolite.auth.challenge', { challengeMessage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.emit('nitrolite.auth.error', { message });
      if (this.rejectConnect) {
        this.rejectConnect(error as Error);
        this.rejectConnect = undefined;
        this.resolveConnect = undefined;
      }
      this.cleanup();
    }
  }

  private async handleAuthVerify({ payload }: NitroliteMessageContext) {
    const params = this.unwrapPayload(payload) as {
      success?: boolean;
      jwtToken?: string;
      jwt_token?: string;
      address?: string;
      sessionKey?: string;
      session_key?: string;
    };

    if (!params?.success) {
      const error = new Error('Nitrolite authentication failed');
      this.events.emit('nitrolite.auth.failed', params ?? {});
      removeJWT();
      removeSessionKey();
      if (this.rejectConnect) {
        this.rejectConnect(error);
        this.rejectConnect = undefined;
        this.resolveConnect = undefined;
      }
      this.cleanup();
      return;
    }

    const sessionKey = (params.sessionKey ?? params.session_key ?? this.sessionKey) as Address;

    this.jwtToken = params.jwtToken ?? params.jwt_token ?? this.jwtToken;
    this.state = 'authenticated';
    this.events.emit('nitrolite.auth.success', {
      address: params.address ?? this.walletAddress,
      sessionKey,
      jwt: this.jwtToken,
    });

    if (this.jwtToken) {
      storeJWT(this.jwtToken);
    }

    const persistedSession: SessionKey = {
      privateKey: this.sessionWallet.privateKey as Hex,
      address: sessionKey,
    };
    storeSessionKey(persistedSession);

    this.resolveConnect?.();
    this.resolveConnect = undefined;
    this.rejectConnect = undefined;

    this.startHeartbeat();

    if (this.config.fetchChannelsOnConnect) {
      await this.requestChannels();
    }
  }

  private handleError({ payload }: NitroliteMessageContext) {
    const params = this.unwrapPayload(payload) as { error?: string };
    const message = params?.error ?? 'Unknown ClearNode error';
    this.events.emit('nitrolite.rpc.error', { message });
    if (message.toLowerCase().includes('auth')) {
      removeJWT();
      removeSessionKey();
    }
  }

  private safeLoadSessionKey(): SessionKey | undefined {
    try {
      return getStoredSessionKey() ?? undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeHex(value?: string): `0x${string}` | undefined {
    if (!value) return undefined;
    const normalized = value.startsWith('0x') || value.startsWith('0X') ? (`0x${value.slice(2)}` as `0x${string}`) : (`0x${value}` as `0x${string}`);
    return /^0x0+$/i.test(normalized) ? undefined : normalized;
  }

  private isZeroHex(value?: string): boolean {
    if (!value) return true;
    const normalized = value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`;
    return /^0x0+$/i.test(normalized);
  }

  private unwrapPayload(payload: unknown): unknown {
    if (Array.isArray(payload)) {
      if (payload.length === 1) {
        return payload[0];
      }
      return payload;
    }
    return payload ?? {};
  }

  private async requestChannels() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      const message = await createGetChannelsMessage(this.sessionMessageSigner, this.walletAddress);
      this.socket.send(message);
    } catch (error) {
      this.events.emit('nitrolite.channels.error', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(async () => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        const ping = await createPingMessage(this.sessionMessageSigner);
        this.socket.send(ping);
      } catch (error) {
        this.events.emit('nitrolite.ping.error', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.pingIntervalMs);
  }

  private stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private async sendAuthRequest(reason: 'initial' | 'retry') {
    const authContext = this.createAuthContext();
    this.pendingAuth = authContext;
    const authRequest = await createAuthRequestMessage({
      address: this.walletAddress,
      session_key: authContext.participant,
      app_name: this.config.applicationName,
      allowances: authContext.allowances,
      expire: authContext.expire,
      scope: authContext.scope,
      application: authContext.application,
    });

    this.socket?.send(authRequest);
    this.events.emit('nitrolite.auth.requested', {
      address: this.walletAddress,
      application: authContext.application,
      sessionKey: authContext.participant,
      expiresAt: authContext.expire,
      reason,
    });
  }

  private createAuthContext(): AuthContext {
    const expire = Math.floor(Date.now() / 1000 + this.config.authTtlSeconds).toString();
    return {
      scope: this.config.authScope,
      application: this.applicationAddress,
      participant: this.sessionKey,
      expire,
      allowances: [],
    };
  }

  private createAuthVerifyMessageSigner(): MessageSigner {
    return async (payload) => {
      if (!this.pendingAuth) {
        throw new Error('Missing pending auth context for verification');
      }

      if (!Array.isArray(payload) || payload.length < 3) {
        throw new Error('Unexpected payload for auth_verify signature');
      }

      const method = payload[1];
      if (method !== RPCMethod.AuthVerify) {
        throw new Error(`Auth signer invoked for unexpected method ${String(method)}`);
      }

      const params = payload[2] as { challenge?: string; challengeMessage?: string; challenge_message?: string };
      const challenge = params?.challenge ?? params?.challengeMessage ?? params?.challenge_message;
      if (!challenge) {
        throw new Error('Missing challenge in auth_verify payload');
      }

      const message = {
        challenge,
        scope: this.pendingAuth.scope,
        wallet: this.walletAddress,
        application: this.pendingAuth.application,
        participant: this.pendingAuth.participant,
        expire: this.pendingAuth.expire,
        allowances: this.pendingAuth.allowances,
      };

      const domain = { name: this.config.applicationName };

      return this.wallet._signTypedData(domain, EIP712AuthTypes, message) as Promise<`0x${string}`>;
    };
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch((error) => {
        this.events.emit('nitrolite.reconnect.error', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.config.reconnectDelayMs);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private cleanup() {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket = undefined;
    }

    this.state = 'idle';
    this.connectPromise = undefined;
    this.resolveConnect = undefined;
    this.rejectConnect = undefined;
    this.pendingAuth = undefined;
  }
}
