/**
 * ============================================================================
 * ORDER MATCHING ENGINE
 * ============================================================================
 * 
 * Automatically matches compatible buy/sell orders and creates trade sessions
 * 
 * FEATURES:
 * - Real-time order matching
 * - Price-time priority matching
 * - Partial fill support
 * - Session creation for matched orders
 * - Event-driven architecture
 * ============================================================================
 */

import { OrderBook } from './OrderBook';
import { generateTradeSessionMessage } from '../nitrolite/create-session';
import type { OrderRecord } from '@shared/types/order';
import type { NitroliteClient } from '../nitrolite/client';
import { logger } from '../nitrolite/utils/logger';
import { EventEmitter } from 'events';

export interface MatchResult {
  tradeId: string;
  makerOrderId: string;
  takerOrderId: string;
  makerAddress: string;
  takerAddress: string;
  fillQuantity: bigint;
  price: bigint;
  sessionData: any;
  timestamp: number;
}

export class OrderMatcher extends EventEmitter {
  private isMatching = false;
  private matchQueue: OrderRecord[] = [];

  constructor(
    private orderBook: OrderBook,
    private nitroliteClient: NitroliteClient
  ) {
    super();
  }

  /**
   * Trigger matching process when a new order arrives
   */
  async onNewOrder(order: OrderRecord): Promise<MatchResult[]> {
    logger.info(`🔍 Checking for matches for order ${order.id}`);
    
    // Add to queue and process
    this.matchQueue.push(order);
    return await this.processMatching();
  }

  /**
   * Process matching for queued orders
   */
  private async processMatching(): Promise<MatchResult[]> {
    if (this.isMatching) {
      logger.info('Matching already in progress, queued');
      return [];
    }

    this.isMatching = true;
    const matches: MatchResult[] = [];

    try {
      while (this.matchQueue.length > 0) {
        const takerOrder = this.matchQueue.shift()!;
        const orderMatches = await this.matchOrder(takerOrder);
        matches.push(...orderMatches);
      }
    } finally {
      this.isMatching = false;
    }

    return matches;
  }

  /**
   * Find and execute matches for a single order
   */
  private async matchOrder(takerOrder: OrderRecord): Promise<MatchResult[]> {
    const matches: MatchResult[] = [];

    // Find matching orders on the opposite side
    const matchingOrders = this.orderBook.findMatchingOrders(
      takerOrder.side,
      takerOrder.baseToken,
      takerOrder.quoteToken,
      takerOrder.price,
      takerOrder.minFill
    );

    if (matchingOrders.length === 0) {
      logger.info(`No matches found for order ${takerOrder.id}`);
      return matches;
    }

    logger.success(`✓ Found ${matchingOrders.length} potential matches for order ${takerOrder.id}`);

    let remainingToFill = takerOrder.remaining;

    // Match with orders in price-time priority
    for (const makerEntry of matchingOrders) {
      if (remainingToFill === 0n) {
        break;
      }

      const makerOrder = makerEntry.order;

      // Calculate fill quantity
      const fillQuantity = this.calculateFillQuantity(
        remainingToFill,
        makerOrder.remaining,
        takerOrder.minFill,
        makerOrder.minFill
      );

      if (fillQuantity === 0n) {
        logger.info(`Cannot fill - quantity below minFill threshold`);
        continue;
      }

      try {
        // Create trade session
        logger.info(`💱 Creating trade session:`);
        logger.data('Maker Order', {
          id: makerOrder.id,
          side: makerOrder.side,
          price: makerOrder.price.toString(),
          remaining: makerOrder.remaining.toString(),
        });
        logger.data('Taker Order', {
          id: takerOrder.id,
          side: takerOrder.side,
          price: takerOrder.price.toString(),
          remaining: remainingToFill.toString(),
        });
        logger.data('Fill', {
          quantity: fillQuantity.toString(),
          price: makerOrder.price.toString(),
        });

        const tradeId = `trade-${makerOrder.id}-${takerOrder.id}-${Date.now()}`;
        
        const sessionData = await generateTradeSessionMessage(
          tradeId,
          makerOrder,
          makerOrder.maker as `0x${string}`,
          takerOrder.maker as `0x${string}`, // Taker is the maker of the taker order
          fillQuantity,
          this.nitroliteClient
        );

        // Record fills in both orders
        const tradeValue = (fillQuantity * makerOrder.price) / BigInt(1e18);
        
        this.orderBook.recordFill(
          makerOrder.id,
          tradeId,
          fillQuantity,
          tradeValue,
          takerOrder.maker
        );

        this.orderBook.recordFill(
          takerOrder.id,
          tradeId,
          fillQuantity,
          tradeValue,
          makerOrder.maker
        );

        const match: MatchResult = {
          tradeId,
          makerOrderId: makerOrder.id,
          takerOrderId: takerOrder.id,
          makerAddress: makerOrder.maker,
          takerAddress: takerOrder.maker,
          fillQuantity,
          price: makerOrder.price,
          sessionData,
          timestamp: Date.now(),
        };

        matches.push(match);
        remainingToFill -= fillQuantity;

        logger.success(`✓ Match created: ${tradeId}`);
        logger.success(`  Filled: ${fillQuantity.toString()}`);
        logger.success(`  Remaining: ${remainingToFill.toString()}`);

        // Emit match event
        this.emit('match', match);

      } catch (error) {
        logger.error(`Failed to create trade session for ${makerOrder.id} x ${takerOrder.id}`, error);
        continue;
      }
    }

    if (matches.length > 0) {
      logger.success(`✓ Created ${matches.length} matches for order ${takerOrder.id}`);
    }

    return matches;
  }

  /**
   * Calculate the quantity that can be filled
   */
  private calculateFillQuantity(
    takerRemaining: bigint,
    makerRemaining: bigint,
    takerMinFill: bigint,
    makerMinFill: bigint
  ): bigint {
    // Maximum we can fill is the minimum of both remainings
    const maxFill = takerRemaining < makerRemaining ? takerRemaining : makerRemaining;

    // Check if we can meet both minFill requirements
    if (maxFill < takerMinFill || maxFill < makerMinFill) {
      return 0n;
    }

    return maxFill;
  }

  /**
   * Manually trigger matching for all active orders
   */
  async matchAllActiveOrders(): Promise<MatchResult[]> {
    const activeOrders = this.orderBook.getActiveOrders();
    logger.info(`🔄 Attempting to match ${activeOrders.length} active orders`);

    const matches: MatchResult[] = [];

    for (const entry of activeOrders) {
      const orderMatches = await this.matchOrder(entry.order);
      matches.push(...orderMatches);
    }

    if (matches.length > 0) {
      logger.success(`✓ Created ${matches.length} total matches`);
    } else {
      logger.info('No matches found among active orders');
    }

    return matches;
  }
}
