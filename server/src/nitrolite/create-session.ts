/**
 * ============================================================================
 * SESSION CREATION FOR P2P TRADE MATCHING
 * ============================================================================
 *
 * Generates app session messages for matched orders.
 *
 * FLOW:
 * 1. Generate app definition (maker, taker, server with weights & quorum)
 * 2. Create allocations (tokens being exchanged in the trade)
 * 3. Create message that both parties will sign
 * 4. Store as pending until all signatures collected
 *
 * KEY FUNCTION:
 * - generateTradeSessionMessage() - Creates unsigned message for partial/full fill
 * ============================================================================
 */

import { createAppSessionMessage, type RPCProtocolVersion } from '@erc7824/nitrolite';
import { ethers } from 'ethers';
import { logger } from './utils/logger';
import { getPendingSession, setPendingSession, type PendingAppSession } from './session-storage';
import type { Address } from './types';
import type { OrderRecord } from '@shared/types/order';
import type { NitroliteClient } from './client';

/**
 * Generate app session message for trade execution (partial or full fill)
 *
 * @param tradeId - Unique trade identifier
 * @param order - The order being filled
 * @param makerAddress - Order maker address
 * @param takerAddress - Order taker address
 * @param fillQuantity - Amount being filled (can be partial)
 * @param nitroliteClient - Connected Nitrolite client instance
 * @returns Unsigned message and app definition
 */
export async function generateTradeSessionMessage(
  tradeId: string,
  order: OrderRecord,
  makerAddress: Address,
  takerAddress: Address,
  fillQuantity: bigint,
  nitroliteClient: NitroliteClient,
): Promise<{
  appSessionData: any;
  appDefinition: any;
  participants: Address[];
  requestToSign: any;
}> {
  try {
    // Format addresses to checksum format
    const formattedMaker = ethers.utils.getAddress(makerAddress) as Address;
    const formattedTaker = ethers.utils.getAddress(takerAddress) as Address;

    logger.nitro(`Generating trade session for ${tradeId}`);
    logger.nitro(`Maker: ${formattedMaker}`);
    logger.nitro(`Taker: ${formattedTaker}`);
    logger.nitro(`Order: ${order.id} (${order.side})`);
    logger.nitro(`Fill: ${fillQuantity.toString()} / ${order.size.toString()}`);

    // Check if already have pending session
    const pending = getPendingSession(tradeId);
    if (pending) {
      logger.nitro(`Reusing existing session for trade ${tradeId}`);
      return {
        appSessionData: pending.appSessionData,
        appDefinition: pending.appDefinition,
        participants: [pending.makerAddress, pending.takerAddress, pending.serverAddress],
        requestToSign: pending.requestToSign,
      };
    }

    // Ensure client is connected
    if (!nitroliteClient.isConnected) {
      throw new Error('Nitrolite client not connected');
    }

    // Use server address (the authenticated participant)
    const serverAddress = nitroliteClient.address;

    // Create app definition
    // Server has 100% voting power to ensure trades can settle
    const nonce = Date.now();
    const appDefinition = {
      protocol: 'NitroRPC/0.4' as RPCProtocolVersion,
      participants: [formattedMaker, formattedTaker, serverAddress],
      weights: [0, 0, 100], // Only server can update state
      quorum: 100, // Server must sign
      challenge: 0, // No challenge period
      nonce,
    };

    // Determine if this is a partial fill
    const isPartialFill = fillQuantity < order.remaining;
    const fillPercentage = Number((fillQuantity * 100n) / order.size);

    // Calculate trade amounts
    const tradeValue = (fillQuantity * order.price) / BigInt(1e18); // Assuming 18 decimals

    // Create initial session data with complete trade metadata
    const initialSessionData = {
      // Trade Metadata
      tradeType: 'p2p_orderbook',
      version: '1.0',
      protocol: 'NitroRPC/0.4',

      // Order Information
      orderId: order.id,
      orderSide: order.side,
      baseToken: order.baseToken,
      quoteToken: order.quoteToken,
      price: order.price.toString(),
      originalSize: order.size.toString(),
      remainingSize: order.remaining.toString(),

      // Fill Information
      fillQuantity: fillQuantity.toString(),
      fillValue: tradeValue.toString(),
      isPartialFill,
      fillPercentage: `${fillPercentage.toFixed(2)}%`,

      // Financial Data
      makerReceives: order.side === 'sell' ? tradeValue.toString() : fillQuantity.toString(),
      takerReceives: order.side === 'sell' ? fillQuantity.toString() : tradeValue.toString(),
      serverFee: '0', // TODO: Calculate server fee

      // Fee History (for Yellow Network audit)
      feeHistory: [
        {
          event: 'trade_session_created',
          timestamp: Date.now(),
          timestampISO: new Date().toISOString(),
          serverAddress,
          feeCharged: '0',
          feeUsed: false,
          makerAddress: formattedMaker,
          takerAddress: formattedTaker,
          fillQuantity: fillQuantity.toString(),
          tradeValue: tradeValue.toString(),
        },
      ],

      // Timing Data
      startTime: Date.now(),
      createdAt: new Date().toISOString(),

      // Participant Information
      participants: {
        maker: {
          address: formattedMaker,
          role: 'maker',
          side: order.side,
          channelId: order.channelId,
        },
        taker: {
          address: formattedTaker,
          role: 'taker',
          side: order.side === 'buy' ? 'sell' : 'buy',
        },
        server: {
          address: serverAddress,
          role: 'settlement_coordinator',
        },
      },

      // Initial Trade State
      tradeState: 'created',
      status: 'awaiting_signatures',

      // Settlement tracking
      settlementSteps: [],
      totalSteps: 0,

      // Verification Data
      serverAddress,
      nonce,
      tradeId,
      channelId: order.channelId,
      channelNonce: order.nonce,
    };

    // Create allocations based on order side
    // For a BUY order: maker receives base token, pays quote token
    // For a SELL order: maker receives quote token, pays base token
    const allocations =
      order.side === 'buy'
        ? [
            {
              participant: formattedMaker,
              asset: order.quoteToken, // Maker pays quote
              amount: tradeValue.toString(),
            },
            {
              participant: formattedTaker,
              asset: order.baseToken, // Taker pays base
              amount: fillQuantity.toString(),
            },
            {
              participant: serverAddress,
              asset: order.quoteToken, // Server fee in quote token
              amount: '0',
            },
          ]
        : [
            {
              participant: formattedMaker,
              asset: order.baseToken, // Maker pays base
              amount: fillQuantity.toString(),
            },
            {
              participant: formattedTaker,
              asset: order.quoteToken, // Taker pays quote
              amount: tradeValue.toString(),
            },
            {
              participant: serverAddress,
              asset: order.baseToken, // Server fee in base token
              amount: '0',
            },
          ];

    // Create app session data
    const appSessionData = {
      definition: appDefinition,
      allocations,
      session_data: JSON.stringify(initialSessionData),
    };

    // Generate message for signing
    logger.nitro('Creating app session message...');
    
    // Create a signer function that uses the client's session message signer
    const sessionSigner = async (payload: any) => {
      // The session signer is already bound to the client
      return await (nitroliteClient as any).sessionMessageSigner(payload);
    };

    const signedMessage = await createAppSessionMessage(sessionSigner, appSessionData);
    const parsedMessage = JSON.parse(signedMessage);

    // Extract request structure
    const requestToSign = parsedMessage.req;
    const serverSignature = parsedMessage.sig?.[0];

    logger.success(`Generated trade session message for ${tradeId}`);
    logger.nitro('═══════════════════════════════════════════════════════');
    logger.nitro('DATA SENT TO PARTICIPANTS FOR SIGNING:');
    logger.nitro('═══════════════════════════════════════════════════════');
    logger.data('Request to sign structure', requestToSign);
    if (Array.isArray(requestToSign)) {
      logger.data('Request ID', requestToSign[0]);
      logger.data('Method', requestToSign[1]);
      logger.data('Params type', typeof requestToSign[2]);
      logger.data('Timestamp', requestToSign[3]);
    }
    logger.nitro('Participants must sign this EXACT array structure');
    logger.nitro('═══════════════════════════════════════════════════════');
    logger.data('Server signature', serverSignature);
    logger.data('App definition', appDefinition);

    // Store as pending
    logger.nitro(`Storing pending session for trade ${tradeId}`);
    const pendingSession: PendingAppSession = {
      appSessionData,
      appDefinition,
      makerAddress: formattedMaker,
      takerAddress: formattedTaker,
      serverAddress,
      requestToSign,
      nonce,
      signatures: new Map(),
      serverSignature: serverSignature || '',
      tradeId,
      orderId: order.id,
      fillQuantity,
      createdAt: Date.now(),
    };

    setPendingSession(tradeId, pendingSession);

    logger.info(`Pending trade session created - waiting for participant signatures`);

    return {
      appSessionData,
      appDefinition,
      participants: [formattedMaker, formattedTaker, serverAddress],
      requestToSign,
    };
  } catch (error) {
    logger.error(`Error generating trade session message for ${tradeId}`, error);
    throw error;
  }
}

/**
 * Get pending trade session message by trade ID
 *
 * @param tradeId - Trade ID
 * @returns Pending session or undefined
 */
export function getPendingTradeSession(tradeId: string): PendingAppSession | undefined {
  return getPendingSession(tradeId);
}
