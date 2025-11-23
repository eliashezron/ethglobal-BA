/**
 * ============================================================================
 * ORDERBOOK MANAGEMENT
 * ============================================================================
 * 
 * Manages limit orders for P2P trading with partial fills
 * 
 * FEATURES:
 * - Create limit orders (buy/sell)
 * - Match orders at specified price
 * - Partial fill support
 * - Order lifecycle management
 * - Multi-asset support (ETH/USDC, USDC/ETH, USDC/USDC)
 * ============================================================================
 */

import { type OrderRecord, type OrderSide, type OrderStatus } from '@shared/types/order';
import { logger } from '../nitrolite/utils/logger';

interface OrderBookEntry {
  order: OrderRecord;
  fills: Array<{
    tradeId: string;
    quantity: bigint;
    value: bigint;
    timestamp: number;
    taker: string;
  }>;
}

export class OrderBook {
  private orders = new Map<string, OrderBookEntry>();
  private activeOrders = new Set<string>(); // Orders that can still be filled

  /**
   * Create a new limit order
   */
  createOrder(order: OrderRecord): void {
    if (this.orders.has(order.id)) {
      throw new Error(`Order ${order.id} already exists`);
    }

    // Validate order
    if (order.size <= 0n) {
      throw new Error('Order size must be positive');
    }
    if (order.price <= 0n) {
      throw new Error('Order price must be positive');
    }
    if (order.minFill > order.size) {
      throw new Error('minFill cannot exceed order size');
    }
    if (order.expiry < Date.now() / 1000) {
      throw new Error('Order expiry must be in the future');
    }

    this.orders.set(order.id, {
      order,
      fills: [],
    });
    this.activeOrders.add(order.id);

    logger.success(`✓ Order created: ${order.id}`);
    logger.data('Order Details', {
      side: order.side,
      baseToken: order.baseToken.substring(0, 10) + '...',
      quoteToken: order.quoteToken.substring(0, 10) + '...',
      price: order.price.toString(),
      size: order.size.toString(),
      minFill: order.minFill.toString(),
    });
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): OrderBookEntry | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Get all active orders (can still be filled)
   */
  getActiveOrders(): OrderBookEntry[] {
    return Array.from(this.activeOrders)
      .map(id => this.orders.get(id))
      .filter((entry): entry is OrderBookEntry => entry !== undefined);
  }

  /**
   * Get orders by side (buy or sell)
   */
  getOrdersBySide(side: OrderSide): OrderBookEntry[] {
    return this.getActiveOrders().filter(entry => entry.order.side === side);
  }

  /**
   * Get orders for a specific token pair
   */
  getOrdersByTokenPair(baseToken: string, quoteToken: string): OrderBookEntry[] {
    return this.getActiveOrders().filter(
      entry =>
        entry.order.baseToken.toLowerCase() === baseToken.toLowerCase() &&
        entry.order.quoteToken.toLowerCase() === quoteToken.toLowerCase()
    );
  }

  /**
   * Check if order can be filled with given quantity
   */
  canFill(orderId: string, quantity: bigint): { canFill: boolean; reason?: string } {
    const entry = this.orders.get(orderId);
    if (!entry) {
      return { canFill: false, reason: 'Order not found' };
    }

    if (!this.activeOrders.has(orderId)) {
      return { canFill: false, reason: 'Order is not active' };
    }

    if (entry.order.expiry < Date.now() / 1000) {
      return { canFill: false, reason: 'Order expired' };
    }

    if (quantity < entry.order.minFill) {
      return { canFill: false, reason: `Quantity ${quantity} below minFill ${entry.order.minFill}` };
    }

    if (quantity > entry.order.remaining) {
      return { canFill: false, reason: `Quantity ${quantity} exceeds remaining ${entry.order.remaining}` };
    }

    return { canFill: true };
  }

  /**
   * Record a fill for an order
   */
  recordFill(orderId: string, tradeId: string, quantity: bigint, value: bigint, taker: string): void {
    const entry = this.orders.get(orderId);
    if (!entry) {
      throw new Error(`Order ${orderId} not found`);
    }

    const validation = this.canFill(orderId, quantity);
    if (!validation.canFill) {
      throw new Error(`Cannot fill order: ${validation.reason}`);
    }

    // Record the fill
    entry.fills.push({
      tradeId,
      quantity,
      value,
      timestamp: Date.now(),
      taker,
    });

    // Update order remaining
    entry.order.remaining -= quantity;

    // Update order status
    if (entry.order.remaining === 0n) {
      entry.order.status = 'filled';
      this.activeOrders.delete(orderId);
      logger.success(`✓ Order ${orderId} fully filled`);
    } else {
      entry.order.status = 'partially_filled';
      logger.info(`Order ${orderId} partially filled: ${entry.order.remaining} remaining`);
    }

    entry.order.updatedAt = new Date().toISOString();
  }

  /**
   * Cancel an order
   */
  cancelOrder(orderId: string, maker: string): void {
    const entry = this.orders.get(orderId);
    if (!entry) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (entry.order.maker !== maker) {
      throw new Error('Only maker can cancel order');
    }

    if (entry.order.status === 'filled') {
      throw new Error('Cannot cancel filled order');
    }

    entry.order.status = 'cancelled';
    entry.order.updatedAt = new Date().toISOString();
    this.activeOrders.delete(orderId);

    logger.warn(`Order ${orderId} cancelled by maker`);
  }

  /**
   * Get orderbook statistics
   */
  getStats() {
    const allOrders = Array.from(this.orders.values());
    
    return {
      totalOrders: allOrders.length,
      activeOrders: this.activeOrders.size,
      filledOrders: allOrders.filter(e => e.order.status === 'filled').length,
      partiallyFilledOrders: allOrders.filter(e => e.order.status === 'partially_filled').length,
      cancelledOrders: allOrders.filter(e => e.order.status === 'cancelled').length,
      totalFills: allOrders.reduce((sum, e) => sum + e.fills.length, 0),
    };
  }

  /**
   * Find matching orders for a taker order
   * Returns orders that can be filled at the taker's price or better
   */
  findMatchingOrders(
    side: OrderSide,
    baseToken: string,
    quoteToken: string,
    takerPrice: bigint,
    quantity: bigint
  ): OrderBookEntry[] {
    const oppositeSide = side === 'buy' ? 'sell' : 'buy';
    
    return this.getOrdersByTokenPair(baseToken, quoteToken)
      .filter(entry => {
        if (entry.order.side !== oppositeSide) return false;
        if (entry.order.remaining < quantity && entry.order.remaining < entry.order.minFill) return false;
        
        // Price matching logic:
        // For taker buy order: maker sell price must be <= taker's willing price
        // For taker sell order: maker buy price must be >= taker's willing price
        if (side === 'buy') {
          return entry.order.price <= takerPrice;
        } else {
          return entry.order.price >= takerPrice;
        }
      })
      .sort((a, b) => {
        // Sort by best price for taker
        if (side === 'buy') {
          // Buy side wants lowest sell prices first
          return Number(a.order.price - b.order.price);
        } else {
          // Sell side wants highest buy prices first
          return Number(b.order.price - a.order.price);
        }
      });
  }
}
