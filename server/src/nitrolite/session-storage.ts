/**
 * ============================================================================
 * SESSION STORAGE FOR P2P TRADES
 * ============================================================================
 *
 * Simple in-memory storage for trade sessions and pending signatures.
 * In production, this should use Redis or a database.
 *
 * STORAGE:
 * - activeTradeSessions: Active trade sessions by trade ID
 * - pendingTradeSessions: Pending signature collection by trade ID
 *
 * NOTE: This module handles both pending (awaiting signatures) and active
 * (fully signed and executing) trade sessions.
 * ============================================================================
 */

import type { Hex } from 'viem';
import { logger } from './utils/logger';
import type { Address } from './types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface PendingAppSession {
  readonly appSessionData: any;
  readonly appDefinition: any;
  readonly makerAddress: Address;
  readonly takerAddress: Address;
  readonly serverAddress: Address;
  readonly requestToSign: any;
  readonly nonce: number;
  readonly signatures: Map<Address, string>;
  readonly serverSignature: string;
  readonly tradeId: string;
  readonly orderId: string;
  readonly fillQuantity: bigint;
  readonly createdAt: number;
}

export interface ActiveTradeSession {
  readonly appSessionId: Hex;
  readonly tradeId: string;
  readonly orderId: string;
  readonly makerAddress: Address;
  readonly takerAddress: Address;
  readonly serverAddress: Address;
  readonly fillQuantity: string;
  readonly createdAt: number;
  readonly settlementSteps: SettlementStep[];
  readonly feeHistory: FeeHistoryEntry[];
}

export interface SettlementStep {
  readonly step: string;
  readonly timestamp: number;
  readonly timestampISO: string;
  readonly participant?: Address;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly details?: Record<string, any>;
}

export interface FeeHistoryEntry {
  readonly event: string;
  readonly timestamp: number;
  readonly timestampISO: string;
  readonly serverAddress: Address;
  readonly feeCharged: string;
  readonly feeUsed: boolean;
  readonly makerAddress?: Address;
  readonly takerAddress?: Address;
  readonly fillQuantity?: string;
  readonly tradeValue?: string;
  readonly appSessionId?: string;
  readonly allSignaturesCollected?: boolean;
}

// ============================================================================
// STORAGE MAPS
// ============================================================================

// Active trade sessions by trade ID
const activeTradeSessions = new Map<string, ActiveTradeSession>();

// Pending signature collection by trade ID
const pendingTradeSessions = new Map<string, PendingAppSession>();

// ============================================================================
// ACTIVE TRADE SESSIONS
// ============================================================================

/**
 * Get active trade session by trade ID
 */
export function getActiveSession(tradeId: string): ActiveTradeSession | undefined {
  const session = activeTradeSessions.get(tradeId);
  if (!session) {
    logger.debug(`getActiveSession: No session for trade ${tradeId} (total active: ${activeTradeSessions.size})`);
  }
  return session;
}

/**
 * Check if active session exists
 */
export function hasActiveSession(tradeId: string): boolean {
  return activeTradeSessions.has(tradeId);
}

/**
 * Store active trade session
 */
export function setActiveSession(tradeId: string, sessionData: ActiveTradeSession): void {
  activeTradeSessions.set(tradeId, sessionData);
  logger.nitro(`✓ Active trade session stored for ${tradeId}`);
  logger.data('Session stored', {
    tradeId,
    appSessionId: sessionData.appSessionId,
    orderId: sessionData.orderId,
    maker: sessionData.makerAddress,
    taker: sessionData.takerAddress,
    fillQuantity: sessionData.fillQuantity,
    totalActiveSessions: activeTradeSessions.size,
  });
}

/**
 * Delete active trade session
 */
export function deleteActiveSession(tradeId: string): void {
  const had = activeTradeSessions.has(tradeId);
  activeTradeSessions.delete(tradeId);
  if (had) {
    logger.nitro(`Trade session deleted for ${tradeId} (remaining: ${activeTradeSessions.size})`);
  }
}

/**
 * Get all active trade sessions
 */
export function getAllActiveSessions(): Array<[string, ActiveTradeSession]> {
  return Array.from(activeTradeSessions.entries());
}

/**
 * Clear all active sessions (for testing/reset)
 */
export function clearAllActiveSessions(): void {
  activeTradeSessions.clear();
  logger.warn('All active trade sessions cleared');
}

// ============================================================================
// PENDING TRADE SESSIONS (AWAITING SIGNATURES)
// ============================================================================

/**
 * Get pending trade session by trade ID
 */
export function getPendingSession(tradeId: string): PendingAppSession | undefined {
  return pendingTradeSessions.get(tradeId);
}

/**
 * Store pending trade session
 */
export function setPendingSession(tradeId: string, session: PendingAppSession): void {
  pendingTradeSessions.set(tradeId, session);
  logger.nitro(`✓ Pending trade session stored for ${tradeId}`);
  logger.data('Pending session', {
    tradeId,
    orderId: session.orderId,
    maker: session.makerAddress,
    taker: session.takerAddress,
    fillQuantity: session.fillQuantity.toString(),
    signaturesCollected: session.signatures.size,
    totalPending: pendingTradeSessions.size,
  });
}

/**
 * Remove pending trade session
 */
export function removePendingSession(tradeId: string): boolean {
  const had = pendingTradeSessions.has(tradeId);
  const deleted = pendingTradeSessions.delete(tradeId);
  if (had) {
    logger.nitro(`Pending session removed for ${tradeId} (remaining: ${pendingTradeSessions.size})`);
  }
  return deleted;
}

/**
 * Check if pending session exists
 */
export function hasPendingSession(tradeId: string): boolean {
  return pendingTradeSessions.has(tradeId);
}

/**
 * Get all pending trade sessions
 */
export function getAllPendingSessions(): Array<[string, PendingAppSession]> {
  return Array.from(pendingTradeSessions.entries());
}

/**
 * Clear all pending sessions (for testing/reset)
 */
export function clearAllPendingSessions(): void {
  pendingTradeSessions.clear();
  logger.warn('All pending trade sessions cleared');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get session statistics
 */
export function getSessionStats(): {
  activeSessions: number;
  pendingSessions: number;
  totalSessions: number;
} {
  return {
    activeSessions: activeTradeSessions.size,
    pendingSessions: pendingTradeSessions.size,
    totalSessions: activeTradeSessions.size + pendingTradeSessions.size,
  };
}

/**
 * Find session by app session ID (searches both pending and active)
 */
export function findSessionByAppSessionId(appSessionId: string): {
  type: 'active' | 'pending' | null;
  tradeId: string | null;
  session: ActiveTradeSession | PendingAppSession | null;
} {
  // Search active sessions
  for (const [tradeId, session] of activeTradeSessions.entries()) {
    if (session.appSessionId === appSessionId) {
      return { type: 'active', tradeId, session };
    }
  }

  // Search pending sessions (check if appSessionId exists in session data)
  for (const [tradeId, session] of pendingTradeSessions.entries()) {
    // Pending sessions don't have appSessionId yet, so this will typically return null
    // But keeping for future extensibility
    return { type: null, tradeId: null, session: null };
  }

  return { type: null, tradeId: null, session: null };
}

