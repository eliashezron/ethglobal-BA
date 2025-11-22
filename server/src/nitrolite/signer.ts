/**
 * Signer utilities for Nitrolite integration
 * Handles session key generation and message signing
 */

import { ethers } from 'ethers';
import { createECDSAMessageSigner, type MessageSigner } from '@erc7824/nitrolite';
import { generateSessionKey as generateViemSessionKey, type SessionKey } from '../lib/utils';
import type { Address, Hex } from './types';
import { logger } from './utils/logger';

/**
 * Generate ephemeral session keypair for authentication
 */
export function generateSessionKey(): SessionKey {
  logger.debug('Generating new session key');
  return generateViemSessionKey();
}

/**
 * Create ECDSA message signer from private key
 * Compatible with Nitrolite's MessageSigner interface
 */
export function createSessionSigner(privateKey: Hex): MessageSigner {
  logger.debug('Creating ECDSA message signer');
  return createECDSAMessageSigner(privateKey);
}

/**
 * Create ethers wallet from private key
 */
export function createWallet(privateKey: Hex): ethers.Wallet {
  return new ethers.Wallet(privateKey);
}

/**
 * Normalize hex string to proper format
 */
export function normalizeHex(value?: string): Hex | undefined {
  if (!value) return undefined;
  const normalized = value.startsWith('0x') || value.startsWith('0X') 
    ? (`0x${value.slice(2)}` as Hex) 
    : (`0x${value}` as Hex);
  return /^0x0+$/i.test(normalized) ? undefined : normalized;
}

/**
 * Check if hex string is zero/empty
 */
export function isZeroHex(value?: string): boolean {
  if (!value) return true;
  const normalized = value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`;
  return /^0x0+$/i.test(normalized);
}

/**
 * Get address from wallet
 */
export function getAddress(wallet: ethers.Wallet): Address {
  return wallet.address as Address;
}
