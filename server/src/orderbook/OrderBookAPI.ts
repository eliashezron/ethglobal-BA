/**
 * ============================================================================
 * ORDERBOOK API ROUTES
 * ============================================================================
 * 
 * REST API endpoints for order management
 * ============================================================================
 */

import { OrderBook } from './OrderBook';
import { generateTradeSessionMessage } from '../nitrolite/create-session';
import type { OrderRecord } from '@shared/types/order';
import type { NitroliteClient } from '../nitrolite/client';
import { logger } from '../nitrolite/utils/logger';

export class OrderBookAPI {
  constructor(
    private orderBook: OrderBook,
    private nitroliteClient: NitroliteClient
  ) {}

  /**
   * POST /orders - Create a new limit order
   */
  async createOrder(orderData: Omit<OrderRecord, 'status' | 'remaining' | 'createdAt' | 'updatedAt'>): Promise<OrderRecord> {
    const order: OrderRecord = {
      ...orderData,
      status: 'open',
      remaining: orderData.size,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.orderBook.createOrder(order);
    
    return order;
  }

  /**
   * GET /orders - Get all active orders
   */
  getOrders(filters?: {
    side?: 'buy' | 'sell';
    baseToken?: string;
    quoteToken?: string;
    maker?: string;
  }) {
    let orders = this.orderBook.getActiveOrders();

    if (filters?.side) {
      orders = orders.filter(e => e.order.side === filters.side);
    }

    if (filters?.baseToken && filters?.quoteToken) {
      orders = orders.filter(
        e =>
          e.order.baseToken.toLowerCase() === filters.baseToken!.toLowerCase() &&
          e.order.quoteToken.toLowerCase() === filters.quoteToken!.toLowerCase()
      );
    }

    if (filters?.maker) {
      orders = orders.filter(e => e.order.maker.toLowerCase() === filters.maker!.toLowerCase());
    }

    return orders.map(e => ({
      order: e.order,
      fills: e.fills,
    }));
  }

  /**
   * GET /orders/:orderId - Get specific order
   */
  getOrderById(orderId: string) {
    const entry = this.orderBook.getOrder(orderId);
    if (!entry) {
      throw new Error('Order not found');
    }

    return {
      order: entry.order,
      fills: entry.fills,
    };
  }

  /**
   * POST /orders/:orderId/fill - Fill an order (creates trade session)
   */
  async fillOrder(
    orderId: string,
    taker: string,
    quantity: bigint
  ): Promise<{ tradeId: string; sessionData: any }> {
    const entry = this.orderBook.getOrder(orderId);
    if (!entry) {
      throw new Error('Order not found');
    }

    // Validate fill
    const validation = this.orderBook.canFill(orderId, quantity);
    if (!validation.canFill) {
      throw new Error(validation.reason);
    }

    // Generate trade session
    const tradeId = `trade-${orderId}-${Date.now()}`;
    const sessionData = await generateTradeSessionMessage(
      tradeId,
      entry.order,
      entry.order.maker as `0x${string}`,
      taker as `0x${string}`,
      quantity,
      this.nitroliteClient
    );

    logger.success(`✓ Trade session created: ${tradeId}`);
    logger.data('Fill Details', {
      orderId,
      quantity: quantity.toString(),
      remaining: (entry.order.remaining - quantity).toString(),
    });

    return {
      tradeId,
      sessionData,
    };
  }

  /**
   * DELETE /orders/:orderId - Cancel an order
   */
  cancelOrder(orderId: string, maker: string) {
    this.orderBook.cancelOrder(orderId, maker);
    
    return {
      success: true,
      orderId,
      status: 'cancelled',
    };
  }

  /**
   * GET /orderbook/stats - Get orderbook statistics
   */
  getStats() {
    return this.orderBook.getStats();
  }

  /**
   * POST /orderbook/match - Find matching orders for a taker
   */
  findMatches(request: {
    side: 'buy' | 'sell';
    baseToken: string;
    quoteToken: string;
    price: bigint;
    quantity: bigint;
  }) {
    const matches = this.orderBook.findMatchingOrders(
      request.side,
      request.baseToken,
      request.quoteToken,
      request.price,
      request.quantity
    );

    return matches.map(e => ({
      orderId: e.order.id,
      maker: e.order.maker,
      price: e.order.price.toString(),
      available: e.order.remaining.toString(),
      minFill: e.order.minFill.toString(),
    }));
  }
}
