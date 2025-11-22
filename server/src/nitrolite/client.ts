/**
 * Simplified Nitrolite Client
 * Focused on WebSocket connection, authentication, and channel management
 */

import { WebSocket } from 'ws';
import {
  createAuthVerifyMessageFromChallenge,
  createAuthVerifyMessageWithJWT,
  createGetChannelsMessage,
  createPingMessage,
  getError,
  getMethod,
  getParams,
  getResult,
  getRequestId,
  RPCMethod,
  type MessageSigner,
} from '@erc7824/nitrolite';

import type { YellowEnvConfig } from '../config/env';
import type { EventBus } from './events/EventBus';
import { getStoredJWT, removeJWT, removeSessionKey, storeJWT, storeSessionKey, type SessionKey } from '../lib/utils';
import { AuthController } from './auth/AuthController';
import { logger } from './utils/logger';
import { createSessionSigner, createWallet, generateSessionKey, getAddress, isZeroHex, normalizeHex } from './signer';
import type { Address, Hex } from './types';

type ConnectionState = 'idle' | 'connecting' | 'authenticated';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

interface NitroliteMessageContext {
  readonly method: RPCMethod;
  readonly payload: unknown;
  readonly raw: unknown;
  readonly requestId?: number;
}

export interface ChannelInfo {
  channelId: string;
  participant?: Address;
  wallet?: Address;
  status?: string;
  token: Address;
  amount?: string;
  chainId?: number;
  adjudicator?: Address;
  createdAt?: string;
  updatedAt?: string;
}

export class NitroliteClient {
  private readonly walletAddress: Address;
  private readonly applicationAddress: Address;
  private readonly sessionWallet;
  private sessionKey: Address;
  private readonly sessionMessageSigner: MessageSigner;
  private readonly auth: AuthController;

  private socket?: WebSocket;
  private state: ConnectionState = 'idle';
  private jwtToken?: string;
  private connectPromise?: Promise<void>;
  private resolveConnect?: () => void;
  private rejectConnect?: (error: Error) => void;
  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private shouldReconnect = true;

  constructor(
    private readonly config: YellowEnvConfig,
    private readonly events: EventBus,
  ) {
    // Initialize main wallet
    const mainWallet = createWallet(normalizeHex(this.config.privateKey)!);
    this.walletAddress = getAddress(mainWallet);
    this.applicationAddress = this.config.applicationAddress === ZERO_ADDRESS 
      ? this.walletAddress 
      : (this.config.applicationAddress as Address);

    // Load or generate session key
    const sessionSource = this.initializeSessionKey();
    this.sessionWallet = createWallet(sessionSource.privateKey);
    this.sessionKey = sessionSource.address;
    this.sessionMessageSigner = createSessionSigner(sessionSource.privateKey);

    // Initialize auth controller
    this.auth = AuthController.fromEnv({
      wallet: mainWallet,
      walletAddress: this.walletAddress,
      applicationAddress: this.applicationAddress,
      getSessionKey: () => this.sessionKey,
      events: this.events,
      env: {
        applicationName: this.config.applicationName,
        authScope: this.config.authScope,
        authTtlSeconds: this.config.authTtlSeconds,
      },
    });

    this.jwtToken = getStoredJWT() ?? undefined;
    logger.system(`Nitrolite client initialized for ${this.walletAddress}`);
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

  async requestChannels(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    try {
      const message = await createGetChannelsMessage(this.sessionMessageSigner, this.walletAddress);
      this.socket.send(message);
      logger.nitro(`Requested channels for ${this.walletAddress}`);
      this.events.emit('nitrolite.channels.requested', {
        participant: this.walletAddress,
        sessionKey: this.sessionKey,
      });
    } catch (error) {
      logger.error('Failed to request channels', error);
      this.events.emit('nitrolite.channels.error', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ========================================
  // Private: Session Key Initialization
  // ========================================

  private initializeSessionKey(): SessionKey {
    const storedSession = this.safeLoadSessionKey();
    const configuredSessionKey = isZeroHex(this.config.sessionKey) 
      ? undefined 
      : (this.config.sessionKey as Address);
    const configuredSessionPrivateKey = normalizeHex(this.config.sessionPrivateKey);

    let sessionSource: SessionKey | undefined;

    if (configuredSessionPrivateKey) {
      const wallet = createWallet(configuredSessionPrivateKey);
      sessionSource = { privateKey: configuredSessionPrivateKey, address: getAddress(wallet) };
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

    const derivedSessionKey = createWallet(sessionSource.privateKey).address as Address;
    const finalSessionKey = configuredSessionKey ?? (storedSession?.address as Address | undefined) ?? derivedSessionKey;

    if (finalSessionKey.toLowerCase() !== derivedSessionKey.toLowerCase()) {
      this.events.emit('nitrolite.session.mismatch', {
        configuredSessionKey: finalSessionKey,
        derivedSessionKey,
      });
    }

    if (!configuredSessionPrivateKey) {
      storeSessionKey({ privateKey: sessionSource.privateKey, address: derivedSessionKey });
    }

    return { privateKey: sessionSource.privateKey, address: finalSessionKey };
  }

  private safeLoadSessionKey(): SessionKey | undefined {
    try {
      const stored = require('../lib/utils').getStoredSessionKey();
      return stored ?? undefined;
    } catch {
      return undefined;
    }
  }

  // ========================================
  // Private: WebSocket Management
  // ========================================

  private openSocket() {
    logger.ws(`Opening ClearNode connection to ${this.config.clearNodeUrl}`);
    this.events.emit('nitrolite.connection.initiated', {
      url: this.config.clearNodeUrl,
      address: this.walletAddress,
    });

    const socket = new WebSocket(this.config.clearNodeUrl);
    this.socket = socket;

    socket.on('open', () => {
      logger.ws('WebSocket connection established');
      this.events.emit('nitrolite.connection.open', { url: this.config.clearNodeUrl });
      void this.authenticate();
    });

    socket.on('message', (data) => {
      void this.handleMessage(data.toString());
    });

    socket.on('error', (error) => {
      logger.error('WebSocket error', error);
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
      logger.ws(`WebSocket closed (${code}): ${closeReason}`);
      this.events.emit('nitrolite.connection.closed', { code, reason: closeReason });

      if (this.state === 'connecting' && this.rejectConnect) {
        this.rejectConnect(new Error(`ClearNode connection closed (${code}): ${closeReason}`));
      }

      this.cleanup();
      this.scheduleReconnect();
    });
  }

  private sendMessage(payload: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    this.socket.send(payload);
  }

  // ========================================
  // Private: Authentication
  // ========================================

  private async authenticate() {
    try {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not open');
      }

      if (this.jwtToken) {
        try {
          logger.auth('Attempting JWT verification');
          const verifyWithJwt = await createAuthVerifyMessageWithJWT(this.jwtToken);
          this.socket.send(verifyWithJwt);
          this.events.emit('nitrolite.auth.verify.jwt', {});
          return;
        } catch (error) {
          logger.warn('Stored JWT verification failed');
          this.jwtToken = undefined;
          removeJWT();
          this.events.emit('nitrolite.auth.verify.jwt_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await this.auth.sendAuthRequest(this.sendMessage.bind(this), 'initial');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Authentication flow failed', error);
      this.events.emit('nitrolite.auth.error', { message });
      if (this.rejectConnect) {
        this.rejectConnect(error as Error);
        this.rejectConnect = undefined;
        this.resolveConnect = undefined;
      }
      this.cleanup();
    }
  }

  // ========================================
  // Private: Message Handling
  // ========================================

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
    const requestIdValue = getRequestId(parsed);
    const requestId = typeof requestIdValue === 'number' ? requestIdValue : undefined;

    if (error) {
      this.events.emit('nitrolite.rpc.error', error);
      return;
    }

    if (!method) {
      this.events.emit('nitrolite.message.unknown', { raw: parsed });
      return;
    }

    const payload = parsed.req ? getParams(parsed) : getResult(parsed);
    const context: NitroliteMessageContext = { method, payload, raw: parsed, requestId };

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
      case RPCMethod.GetChannels:
        this.handleGetChannels(context);
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
      logger.auth('Received auth challenge');
      if (!this.auth.hasPendingAuth()) {
        await this.auth.sendAuthRequest(this.sendMessage.bind(this), 'retry');
      }

      const authVerify = await createAuthVerifyMessageFromChallenge(
        this.auth.createVerifySigner(),
        challengeMessage,
      );
      this.sendMessage(authVerify);
      logger.auth('Sent auth_verify response');
      this.events.emit('nitrolite.auth.challenge', { challengeMessage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to process auth challenge', error);
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
      logger.error('Nitrolite authentication failed', params);
      this.events.emit('nitrolite.auth.failed', params ?? {});
      removeJWT();
      removeSessionKey();
      this.auth.reset();
      if (this.rejectConnect) {
        this.rejectConnect(error);
        this.rejectConnect = undefined;
        this.resolveConnect = undefined;
      }
      this.cleanup();
      return;
    }

    const sessionKey = (params.sessionKey ?? params.session_key ?? this.sessionKey) as Address;

    this.sessionKey = sessionKey;
    this.jwtToken = params.jwtToken ?? params.jwt_token ?? this.jwtToken;
    this.state = 'authenticated';
    logger.success('Nitrolite authentication succeeded');
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
    this.auth.reset();

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
    logger.error('ClearNode error', message);
    this.events.emit('nitrolite.rpc.error', { message });
    if (message.toLowerCase().includes('auth')) {
      removeJWT();
      removeSessionKey();
    }
  }

  private handleGetChannels({ payload }: NitroliteMessageContext) {
    const unwrapped = this.unwrapPayload(payload);
    const channels = this.normalizeChannelsPayload(unwrapped);

    logger.nitro(`Received ${channels.length} channels`);

    if (channels.length === 0) {
      this.events.emit('nitrolite.channels.received', {
        count: 0,
        raw: unwrapped,
      });
      return;
    }

    channels.forEach((channel, index) => {
      this.events.emit('nitrolite.channels.entry', {
        index,
        ...channel,
      });
    });

    this.events.emit('nitrolite.channels.received', {
      count: channels.length,
      channels,
    });
  }

  // ========================================
  // Private: Channel Normalization
  // ========================================

  private normalizeChannelsPayload(payload: unknown): ChannelInfo[] {
    if (!payload) return [];

    let entries: Record<string, unknown>[] = [];

    if (Array.isArray(payload)) {
      entries = payload.filter((value): value is Record<string, unknown> => this.isRecord(value));
    } else if (this.isRecord(payload)) {
      if (Array.isArray(payload.channels)) {
        entries = payload.channels.filter((value): value is Record<string, unknown> => this.isRecord(value));
      } else if (Array.isArray(payload.items)) {
        entries = payload.items.filter((value): value is Record<string, unknown> => this.isRecord(value));
      } else if (payload.channel || payload.channel_id || payload.channelId) {
        entries = [payload];
      }
    }

    const channels: ChannelInfo[] = [];

    entries.forEach((entry) => {
      const channelId = this.pickString(entry, ['channelId', 'channel_id']);
      const token = this.pickAddress(entry, ['token']);

      if (!channelId || !token) {
        this.events.emit('nitrolite.channels.unparsed', { entry });
        return;
      }

      channels.push({
        channelId,
        participant: this.pickAddress(entry, ['participant']),
        wallet: this.pickAddress(entry, ['wallet']),
        status: this.pickString(entry, ['status']),
        token,
        amount: this.pickAmount(entry),
        chainId: this.pickNumber(entry, ['chainId', 'chain_id']),
        adjudicator: this.pickAddress(entry, ['adjudicator']),
        createdAt: this.pickString(entry, ['createdAt', 'created_at']),
        updatedAt: this.pickString(entry, ['updatedAt', 'updated_at']),
      });
    });

    return channels;
  }

  private pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'bigint') {
        return Number(value);
      }
    }
    return undefined;
  }

  private pickAddress(record: Record<string, unknown>, keys: string[]): Address | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)) {
        return value as Address;
      }
    }
    return undefined;
  }

  private pickAmount(record: Record<string, unknown>): string | undefined {
    const value = record.amount ?? record.balance ?? record.value;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'bigint') return value.toString();
    return undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
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

  // ========================================
  // Private: Heartbeat & Cleanup
  // ========================================

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

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;

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
    this.auth.reset();
  }
}
