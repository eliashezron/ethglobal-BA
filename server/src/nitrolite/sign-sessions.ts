/**
 * ============================================================================
 * SIGNATURE COLLECTION FOR TRADE SESSIONS
 * ============================================================================
 *
 * Collects signatures from maker and taker for app session creation.
 *
 * FLOW:
 * 1. Maker signs first → stores signature
 * 2. Taker signs second → stores signature
 * 3. Once both collected → submit to Nitrolite
 * 4. Session created → trade can execute
 *
 * KEY FUNCTIONS:
 * - addTradeSessionSignature() - Store participant signature
 * - createTradeSessionWithSignatures() - Submit with all signatures
 * - addSettlementStep() - Track settlement progress
 * ============================================================================
 */

import { RPCMethod } from '@erc7824/nitrolite';
import { ethers } from 'ethers';
import { logger } from './utils/logger';
import type { NitroliteClient } from './client';
import { 
  getPendingSession, 
  removePendingSession, 
  setActiveSession as storeActiveSession,
  type PendingAppSession,
  type ActiveTradeSession,
  type SettlementStep,
  type FeeHistoryEntry
} from './session-storage';
import type { Address } from './types';

// In-memory storage for active sessions (should be Redis in production)
// Note: This local Map is used temporarily, but will be migrated to use
// the centralized storage in session-storage.ts
const activeSessions = new Map<string, ActiveTradeSession>();

/**
 * Get active trade session by trade ID
 */
export function getActiveSession(tradeId: string): ActiveTradeSession | undefined {
  return activeSessions.get(tradeId);
}

/**
 * Set active trade session
 */
export function setActiveSession(tradeId: string, session: ActiveTradeSession): void {
  activeSessions.set(tradeId, session);
  // Also store in centralized storage
  storeActiveSession(tradeId, session);
}

/**
 * Remove active trade session
 */
export function deleteActiveSession(tradeId: string): boolean {
  return activeSessions.delete(tradeId);
}

/**
 * Add participant signature to pending trade session
 *
 * @param tradeId - Trade ID
 * @param participantEOA - Participant's Ethereum address
 * @param signature - Participant's signature
 * @returns True if ALL signatures are now collected (2/2)
 */
export function addTradeSessionSignature(tradeId: string, participantEOA: Address, signature: string): boolean {
  const pending = getPendingSession(tradeId);

  if (!pending) {
    logger.error(`No pending trade session found for ${tradeId}`);
    return false;
  }

  // Format address
  const formattedAddress = ethers.utils.getAddress(participantEOA) as Address;

  // Validate signature format
  if (!signature || typeof signature !== 'string') {
    logger.error(`Invalid signature format from ${formattedAddress}: not a string`);
    return false;
  }

  if (!signature.startsWith('0x')) {
    logger.error(`Invalid signature format from ${formattedAddress}: missing 0x prefix`);
    return false;
  }

  if (signature.length !== 132) {
    logger.warn(`Suspicious signature length from ${formattedAddress}: ${signature.length} (expected 132)`);
    logger.data('Signature', signature);
  }

  // Store signature
  pending.signatures.set(formattedAddress, signature);

  logger.nitro(`✓ Signature added for trade ${tradeId} from ${formattedAddress}`);
  logger.data('Signature preview', `${signature.substring(0, 20)}...${signature.substring(signature.length - 20)}`);
  logger.data('Length', signature.length.toString());
  logger.nitro(`Total signatures collected: ${pending.signatures.size}/2`);

  // Return true only if we now have all 2 signatures (maker + taker)
  return pending.signatures.size === 2;
}

/**
 * Create trade session with all collected signatures
 *
 * @param tradeId - Trade ID
 * @param nitroliteClient - Connected Nitrolite client instance
 * @returns App session ID
 */
export async function createTradeSessionWithSignatures(
  tradeId: string,
  nitroliteClient: NitroliteClient,
): Promise<string> {
  const pending = getPendingSession(tradeId);

  if (!pending) {
    throw new Error(`No pending trade session for ${tradeId}`);
  }

  // Verify we have all signatures
  if (pending.signatures.size !== 2) {
    logger.warn(`Not all signatures collected yet (have ${pending.signatures.size}/2)`);
    throw new Error(`Not all signatures collected (have ${pending.signatures.size}/2)`);
  }

  logger.nitro(`Creating trade session for ${tradeId} with all signatures`);
  logger.nitro(`Maker (${pending.makerAddress}): signed`);
  logger.nitro(`Taker (${pending.takerAddress}): signed`);
  logger.nitro(`Server (${pending.serverAddress}): signed`);

  try {
    // Ensure client is connected
    if (!nitroliteClient.isConnected) {
      throw new Error('Nitrolite client not connected');
    }

    // Build complete request with all signatures
    const sigMaker = pending.signatures.get(pending.makerAddress);
    const sigTaker = pending.signatures.get(pending.takerAddress);
    const sigServer = pending.serverSignature;

    logger.nitro('═══════════════════════════════════════════════════════');
    logger.nitro('SIGNATURE VERIFICATION:');
    logger.nitro('═══════════════════════════════════════════════════════');
    logger.nitro('Participants order (from definition):');
    logger.data('[0]', pending.makerAddress);
    logger.data('[1]', pending.takerAddress);
    logger.data('[2]', pending.serverAddress);
    logger.nitro('');
    logger.nitro('Signatures order (MUST match participants):');
    logger.nitro(`  sig[0] for ${pending.makerAddress}:`);
    logger.data('Signature', sigMaker || 'null');
    logger.data('Length', sigMaker ? sigMaker.length.toString() : 'null');
    logger.nitro(`  sig[1] for ${pending.takerAddress}:`);
    logger.data('Signature', sigTaker || 'null');
    logger.data('Length', sigTaker ? sigTaker.length.toString() : 'null');
    logger.nitro(`  sig[2] for ${pending.serverAddress}:`);
    logger.data('Signature', sigServer || 'null');
    logger.data('Length', sigServer ? sigServer.length.toString() : 'null');
    logger.nitro('');
    logger.nitro('⚠️  CRITICAL: Client must sign using SESSION KEY, not main wallet!');
    logger.nitro('⚠️  CRITICAL: Client must use createAppSessionMessage() from @erc7824/nitrolite');
    logger.nitro('═══════════════════════════════════════════════════════');

    const completeRequest = {
      req: pending.requestToSign,
      sig: [sigMaker, sigTaker, sigServer],
    };

    logger.data('Complete request structure', completeRequest);
    logger.data('Request array', pending.requestToSign);
    logger.nitro('▶ Sending: create_app_session');

    // Access the WebSocket directly from the client (we know it exists when connected)
    const socket = (nitroliteClient as any).socket;

    if (!socket) {
      logger.error('Nitrolite client has no WebSocket instance');
      throw new Error('Nitrolite client WebSocket not initialized');
    }

    const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const currentState = wsStates[socket.readyState] || `UNKNOWN(${socket.readyState})`;

    if (socket.readyState !== 1) {
      logger.error(`WebSocket not ready. Current state: ${currentState}`);
      throw new Error(`WebSocket not connected (state: ${currentState})`);
    }

    logger.nitro(`WebSocket connected and ready (state: ${currentState})`);

    // Send directly to WebSocket (multi-signature requests need direct send)
    const requestString = JSON.stringify(completeRequest);
    logger.data('Sending JSON', requestString);

    const response = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for trade session creation'));
      }, 30000);

      const handler = (data: any) => {
        try {
          const msg = typeof data === 'string' ? data : data.toString();
          const parsed = JSON.parse(msg);

          // Check if this is a response (has "res" array)
          if (parsed.res && Array.isArray(parsed.res)) {
            const [reqId, method, params] = parsed.res;

            // Match by method name
            if (method === 'create_app_session') {
              clearTimeout(timeout);
              socket.removeListener('message', handler);
              logger.nitro('◀ Received: create_app_session response');
              logger.data('Response', params);
              resolve(params);
            }
          }
          // Check for error
          else if (parsed.err && Array.isArray(parsed.err)) {
            const [reqId, errorCode, errorMsg] = parsed.err;
            clearTimeout(timeout);
            socket.removeListener('message', handler);
            logger.error('◀ Received error:', errorMsg);
            reject(new Error(`Create trade session failed: ${errorMsg}`));
          }
        } catch (err) {
          // Ignore parsing errors for other messages
        }
      };

      socket.on('message', handler);
      socket.send(requestString);
    });

    // Extract app session ID
    const appSessionId = response.app_session_id || response.appSessionId;

    if (!appSessionId) {
      logger.error('No app session ID in response!');
      logger.data('Response object', response);
      throw new Error('Trade session created but no ID returned');
    }

    logger.nitro(`✓ Trade session created with ID: ${appSessionId}`);

    // Calculate fee information
    const fillQuantity = pending.fillQuantity.toString();
    const serverFee = '0'; // Server fee (currently 0)

    // Store active session with settlement tracking and fee history
    const activeSession: ActiveTradeSession = {
      appSessionId,
      tradeId: pending.tradeId,
      orderId: pending.orderId,
      makerAddress: pending.makerAddress,
      takerAddress: pending.takerAddress,
      serverAddress: pending.serverAddress,
      fillQuantity,
      createdAt: Date.now(),
      settlementSteps: [],
      feeHistory: [
        {
          event: 'session_created',
          timestamp: pending.createdAt,
          timestampISO: new Date(pending.createdAt).toISOString(),
          serverAddress: pending.serverAddress,
          feeCharged: serverFee,
          feeUsed: false,
          makerAddress: pending.makerAddress,
          takerAddress: pending.takerAddress,
          fillQuantity,
          tradeValue: '0', // TODO: Calculate from order price
        },
        {
          event: 'trade_started',
          timestamp: Date.now(),
          timestampISO: new Date().toISOString(),
          serverAddress: pending.serverAddress,
          feeCharged: serverFee,
          feeUsed: true, // Fee is now consumed as trade is active
          appSessionId,
          allSignaturesCollected: true,
        },
      ],
    };

    activeSessions.set(tradeId, activeSession);
    storeActiveSession(tradeId, activeSession);

    // Clean up pending
    removePendingSession(tradeId);

    return appSessionId;
  } catch (error) {
    logger.error(`Error creating trade session for ${tradeId}`, error);
    throw error;
  }
}

/**
 * Add a settlement step to the trade session history
 *
 * @param tradeId - Trade ID
 * @param step - Settlement step description
 * @param participant - Optional participant address
 * @param status - Step status
 * @param details - Optional additional details
 */
export function addSettlementStep(
  tradeId: string,
  step: string,
  participant?: Address,
  status: 'pending' | 'completed' | 'failed' = 'completed',
  details?: Record<string, any>,
): void {
  const session = getActiveSession(tradeId);

  if (!session) {
    logger.warn(`No active session for trade ${tradeId} to track settlement`);
    return;
  }

  const settlementStep: SettlementStep = {
    step,
    timestamp: Date.now(),
    timestampISO: new Date().toISOString(),
    participant,
    status,
    details,
  };

  session.settlementSteps.push(settlementStep);

  logger.debug(`Settlement step #${session.settlementSteps.length} recorded: ${step} (${status})`);
}

/**
 * Get all active trade sessions
 */
export function getAllActiveSessions(): ActiveTradeSession[] {
  return Array.from(activeSessions.values());
}

/**
 * Clear all active sessions (for testing/reset)
 */
export function clearAllActiveSessions(): void {
  activeSessions.clear();
}
