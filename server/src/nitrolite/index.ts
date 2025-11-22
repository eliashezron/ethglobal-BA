/**
 * Nitrolite Integration Module
 * Exports simplified client for authentication, signing, and channel management
 */

export { NitroliteClient } from './client';
export type { ChannelInfo } from './client';
export { AuthController } from './auth';
export type { AuthAllowance, AuthContext } from './auth';
export type { Address, Hex } from './types';
export { EventBus } from './events/EventBus';
export { logger } from './utils/logger';
