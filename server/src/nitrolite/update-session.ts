/**
 * ============================================================================
 * TRADE SESSION STATE UPDATES
 * ============================================================================
 *
 * Submits intermediate state updates to Nitrolite during trade execution.
 *
 * FLOW:
 * 1. Trade execution progresses (partial fills, settlement steps)
 * 2. Submit updated state to Nitrolite
 * 3. Update session_data with current execution state
 * 4. Funds stay in session (no redistribution until close)
 *
 * KEY FUNCTIONS:
 * - submitTradeState() - Update trade session state during execution
 * - updateSettlementProgress() - Record settlement step completion
 * ============================================================================
 */

import { createSubmitAppStateMessage, RPCAppStateIntent, RPCProtocolVersion } from '@erc7824/nitrolite';
import type { Hex } from 'viem';
import { logger } from './utils/logger';
import type { Address } from './types';
import type { ActiveTradeSession, SettlementStep } from './session-storage';

/**
 * Trade state update data
 */
export interface TradeStateUpdate {
  settlementStep?: string;
  status?: 'pending' | 'completed' | 'failed';
  participant?: Address;
  details?: Record<string, any>;
  allocationChanges?: boolean;
}

/**
 * Submit trade state update to Nitrolite
 *
 * @param client - Nitrolite client instance
 * @param session - Active trade session
 * @param stateUpdate - Current trade execution state
 * @returns Promise<void>
 */
export async function submitTradeState(
  client: any, // NitroliteClient instance
  session: ActiveTradeSession,
  stateUpdate: TradeStateUpdate = {}
): Promise<void> {
  if (!session) {
    logger.debug(`No active session to submit state`);
    return;
  }

  try {
    // Ensure WebSocket is connected
    if (!client.socket) {
      logger.error('Client has no WebSocket instance');
      throw new Error('Client WebSocket not initialized');
    }

    const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const currentState = wsStates[client.socket.readyState] || `UNKNOWN(${client.socket.readyState})`;

    if (client.socket.readyState !== 1) {
      logger.error(`Client WebSocket not ready. Current state: ${currentState}`);
      throw new Error(`Client WebSocket not connected (state: ${currentState})`);
    }

    // Keep current allocations (no fund redistribution during execution)
    // These will be recalculated on session close based on settlement outcome
    const allocations = [
      {
        participant: session.makerAddress,
        asset: 'usdc',
        amount: '0' // Placeholder - actual amounts determined at close
      },
      {
        participant: session.takerAddress,
        asset: 'usdc',
        amount: '0' // Placeholder - actual amounts determined at close
      },
      {
        participant: session.serverAddress,
        asset: 'usdc',
        amount: '0' // Server fee
      }
    ];

    // Update session data with current execution state
    const updatedSessionData = {
      // Trade Metadata
      tradeType: 'p2p_orderbook',
      version: '1.0',
      protocol: 'NitroRPC/0.4',

      // Trade Identification
      appSessionId: session.appSessionId,
      tradeId: session.tradeId,
      orderId: session.orderId,

      // Financial Data
      fillQuantity: session.fillQuantity,
      currency: 'usdc',
      serverFee: '0', // TODO: Calculate actual fee

      // Fee History (preserved from session)
      feeHistory: session.feeHistory || [],

      // Timing Data
      startTime: session.createdAt,
      updateTime: Date.now(),
      elapsedTime: Date.now() - session.createdAt,

      // Participant Information
      participants: {
        maker: {
          address: session.makerAddress,
          role: 'maker'
        },
        taker: {
          address: session.takerAddress,
          role: 'taker'
        },
        server: {
          address: session.serverAddress,
          role: 'facilitator'
        }
      },

      // Current Execution State
      executionState: stateUpdate.status || 'executing',
      currentStep: stateUpdate.settlementStep || 'in_progress',
      allocationChanges: stateUpdate.allocationChanges || false,

      // Settlement Progress
      settlementSteps: session.settlementSteps || [],
      totalSteps: (session.settlementSteps || []).length,
      completedSteps: (session.settlementSteps || []).filter(s => s.status === 'completed').length,
      pendingSteps: (session.settlementSteps || []).filter(s => s.status === 'pending').length,
      failedSteps: (session.settlementSteps || []).filter(s => s.status === 'failed').length,

      // Latest Settlement Step
      latestStep: (session.settlementSteps || []).length > 0
        ? session.settlementSteps[session.settlementSteps.length - 1]
        : null,

      // Verification Data
      serverAddress: session.serverAddress,
      lastUpdate: new Date().toISOString()
    };

    // Use V04 protocol with intent and version
    const stateData = {
      app_session_id: session.appSessionId,
      intent: RPCAppStateIntent.Operate, // Operating mode - no fund changes
      version: 1,
      allocations,
      session_data: JSON.stringify(updatedSessionData)
    };

    logger.nitro(`▶ Sending: submit_app_state for trade ${session.tradeId}`);
    logger.data('State update:', stateData);

    // Sign with session signer
    const sign = (client as any).sessionSigner || (client as any).signMessage?.bind(client);
    if (!sign) {
      throw new Error('No signing method available on client');
    }

    const stateMessage = await createSubmitAppStateMessage<RPCProtocolVersion.NitroRPC_0_4>(sign, stateData);

    // Send directly to WebSocket
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for state submission'));
      }, 30000);

      const handler = (data: any) => {
        try {
          const msg = typeof data === 'string' ? data : data.toString();
          const parsed = JSON.parse(msg);

          // Check if this is a response
          if (parsed.res && Array.isArray(parsed.res)) {
            const [reqId, method, params] = parsed.res;

            if (method === 'submit_app_state') {
              clearTimeout(timeout);
              client.socket.removeListener('message', handler);
              logger.nitro('◀ Received: submit_app_state response');
              resolve();
            }
          }
          // Check for error
          else if (parsed.err && Array.isArray(parsed.err)) {
            const [reqId, errorCode, errorMsg] = parsed.err;
            clearTimeout(timeout);
            client.socket.removeListener('message', handler);
            logger.error('◀ Received error:', errorMsg);
            reject(new Error(`Submit app state failed: ${errorMsg}`));
          }
        } catch (err) {
          // Ignore parsing errors for other messages
        }
      };

      client.socket.on('message', handler);
      client.socket.send(stateMessage);
    });

    logger.nitro(`✓ Trade state submitted for trade ${session.tradeId}`);

  } catch (error) {
    logger.error(`Error submitting trade state for trade ${session.tradeId}:`, error);
    // Don't throw - state submission is not critical for execution
  }
}

/**
 * Update settlement progress and submit state update
 *
 * @param client - Nitrolite client instance
 * @param session - Active trade session
 * @param step - Settlement step name
 * @param status - Step status
 * @param participant - Optional participant address
 * @param details - Optional additional details
 * @returns Promise<void>
 */
export async function updateSettlementProgress(
  client: any,
  session: ActiveTradeSession,
  step: string,
  status: 'pending' | 'completed' | 'failed',
  participant?: Address,
  details?: Record<string, any>
): Promise<void> {
  const newStep: SettlementStep = {
    step,
    timestamp: Date.now(),
    timestampISO: new Date().toISOString(),
    participant,
    status,
    details
  };

  // Add step to session's settlement steps
  session.settlementSteps.push(newStep);

  logger.nitro(`Settlement step ${step}: ${status}`, {
    tradeId: session.tradeId,
    participant,
    details
  });

  // Submit updated state to Nitrolite
  await submitTradeState(client, session, {
    settlementStep: step,
    status,
    participant,
    details,
    allocationChanges: status === 'completed' && step === 'funds_released'
  });
}

/**
 * Record trade execution milestone
 *
 * @param session - Active trade session
 * @param milestone - Milestone name
 * @param details - Optional details
 */
export function recordTradeMilestone(
  session: ActiveTradeSession,
  milestone: string,
  details?: Record<string, any>
): void {
  const step: SettlementStep = {
    step: milestone,
    timestamp: Date.now(),
    timestampISO: new Date().toISOString(),
    status: 'completed',
    details
  };

  session.settlementSteps.push(step);

  logger.info(`Trade milestone: ${milestone}`, {
    tradeId: session.tradeId,
    appSessionId: session.appSessionId,
    details
  });
}
