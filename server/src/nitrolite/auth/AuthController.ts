import { createAuthRequestMessage, EIP712AuthTypes, RPCMethod, type MessageSigner } from '@erc7824/nitrolite';
import type { Wallet } from 'ethers';

import type { YellowEnvConfig } from '../../config/env';
import type { EventBus } from '../events/EventBus';
import type { Address } from '../types';
import type { AuthContext } from './types';
import { logger } from '../utils/logger';

interface AuthConfig {
  readonly applicationName: string;
  readonly scope: string;
  readonly ttlSeconds: number;
}

export interface AuthControllerOptions {
  readonly wallet: Wallet;
  readonly walletAddress: Address;
  readonly applicationAddress: Address;
  readonly getSessionKey: () => Address;
  readonly events: EventBus;
  readonly config: AuthConfig;
}

type MessageSender = (message: string) => void;

export class AuthController {
  private pendingAuth?: AuthContext;

  constructor(private readonly options: AuthControllerOptions) {}

  static fromEnv(params: {
    wallet: Wallet;
    walletAddress: Address;
    applicationAddress: Address;
    getSessionKey: () => Address;
    events: EventBus;
    env: Pick<YellowEnvConfig, 'applicationName' | 'authScope' | 'authTtlSeconds'>;
  }): AuthController {
    const { wallet, walletAddress, applicationAddress, getSessionKey, events, env } = params;
    return new AuthController({
      wallet,
      walletAddress,
      applicationAddress,
      getSessionKey,
      events,
      config: {
        applicationName: env.applicationName,
        scope: env.authScope,
        ttlSeconds: env.authTtlSeconds,
      },
    });
  }

  hasPendingAuth(): boolean {
    return typeof this.pendingAuth !== 'undefined';
  }

  reset(): void {
    this.pendingAuth = undefined;
  }

  async sendAuthRequest(send: MessageSender, reason: 'initial' | 'retry'): Promise<void> {
    const context = this.createAuthContext();
    this.pendingAuth = context;

    const payload = await createAuthRequestMessage({
      address: this.options.walletAddress,
      session_key: context.sessionKey,
      app_name: this.options.config.applicationName,
      allowances: context.allowances,
      expire: context.expire,
      scope: context.scope,
      application: context.application,
    });

    logger.auth(`Sending auth_request (${reason}) for session key ${context.sessionKey}`);

    try {
      send(payload);
      this.options.events.emit('nitrolite.auth.requested', {
        address: this.options.walletAddress,
        application: context.application,
        participant: context.participant,
        sessionKey: context.sessionKey,
        expiresAt: context.expire,
        reason,
      });
    } catch (error) {
      this.pendingAuth = undefined;
      logger.error('Failed to send auth_request', error);
      throw error;
    }
  }

  createVerifySigner(): MessageSigner {
    return async (payload) => {
      const context = this.pendingAuth;
      if (!context) {
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

      logger.auth('Signing auth_verify challenge');

      const message = {
        challenge,
        scope: context.scope,
        wallet: this.options.walletAddress,
        application: context.application,
        participant: context.participant,
        expire: context.expire,
        allowances: context.allowances,
      };

      const domain = { name: this.options.config.applicationName };

      return this.options.wallet._signTypedData(domain, EIP712AuthTypes, message) as Promise<`0x${string}`>;
    };
  }

  private createAuthContext(): AuthContext {
    const expire = Math.floor(Date.now() / 1000 + this.options.config.ttlSeconds).toString();
    return {
      scope: this.options.config.scope,
      application: this.options.applicationAddress,
      participant: this.options.walletAddress,
      sessionKey: this.options.getSessionKey(),
      expire,
      allowances: [],
    };
  }
}
