/**
 * ============================================================================
 * ORDERBOOK USAGE EXAMPLE
 * ============================================================================
 * 
 * Demonstrates how to use the orderbook system for P2P trading
 * ============================================================================
 */

import { OrderBook } from './OrderBook';
import { OrderBookAPI } from './OrderBookAPI';
import type { OrderRecord } from '@shared/types/order';

// Token addresses (Base network)
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';

export async function exampleUsage(nitroliteClient: any) {
  const orderBook = new OrderBook();
  const api = new OrderBookAPI(orderBook, nitroliteClient);

  // ============================================================================
  // EXAMPLE 1: User creates SELL order (selling ETH for USDC)
  // ============================================================================
  console.log('\n📝 EXAMPLE 1: Create SELL order (ETH → USDC)');
  
  const sellOrder = await api.createOrder({
    id: 'order-001',
    maker: '0x3A4dB9e7306aF09012ceb0f222d581FD1F0C6D71',
    baseToken: WETH,           // Selling ETH
    quoteToken: USDC,          // Receiving USDC
    side: 'sell',
    price: 3000n * 10n**18n,   // Price: 3000 USDC per ETH
    size: 10n * 10n**18n,      // Size: 10 ETH total
    minFill: 1n * 10n**18n,    // Accept minimum 1 ETH per fill
    expiry: Math.floor(Date.now() / 1000) + 86400, // Expires in 24h
    channelId: '0xchannelid123',
    nonce: `${Date.now()}-001`,
    signature: '0xsignature...',
  });

  console.log('✅ Order created:', {
    id: sellOrder.id,
    selling: '10 ETH',
    receiving: '30,000 USDC',
    price: '3000 USDC/ETH',
    minFill: '1 ETH',
  });

  // ============================================================================
  // EXAMPLE 2: Another user partially fills the order
  // ============================================================================
  console.log('\n💰 EXAMPLE 2: Partial fill (3 ETH)');
  
  const taker1 = '0x41Ad4f7A089e1e2cbF43250325aC482823987e6A';
  const fillAmount1 = 3n * 10n**18n; // Buy 3 ETH
  
  const trade1 = await api.fillOrder('order-001', taker1, fillAmount1);
  
  console.log('✅ Trade created:', {
    tradeId: trade1.tradeId,
    filled: '3 ETH',
    cost: '9,000 USDC',
    remaining: '7 ETH',
  });

  // ============================================================================
  // EXAMPLE 3: Another taker fills more
  // ============================================================================
  console.log('\n💰 EXAMPLE 3: Another partial fill (5 ETH)');
  
  const taker2 = '0x52Bd4f7B099e1f3cbF54360325aC583923997f8C';
  const fillAmount2 = 5n * 10n**18n; // Buy 5 ETH
  
  const trade2 = await api.fillOrder('order-001', taker2, fillAmount2);
  
  console.log('✅ Trade created:', {
    tradeId: trade2.tradeId,
    filled: '5 ETH',
    cost: '15,000 USDC',
    remaining: '2 ETH',
  });

  // ============================================================================
  // EXAMPLE 4: User creates BUY order (buying ETH with USDC)
  // ============================================================================
  console.log('\n📝 EXAMPLE 4: Create BUY order (USDC → ETH)');
  
  const buyOrder = await api.createOrder({
    id: 'order-002',
    maker: '0x63Ed5b1A089e2f4dbF64370425aC594923008e7B',
    baseToken: WETH,           // Buying ETH
    quoteToken: USDC,          // Paying USDC
    side: 'buy',
    price: 2950n * 10n**18n,   // Price: 2950 USDC per ETH (lower = better for buyer)
    size: 5n * 10n**18n,       // Size: Want 5 ETH
    minFill: 5n * 10n**17n,    // Accept minimum 0.5 ETH per fill
    expiry: Math.floor(Date.now() / 1000) + 86400,
    channelId: '0xchannelid456',
    nonce: `${Date.now()}-002`,
    signature: '0xsignature...',
  });

  console.log('✅ Order created:', {
    id: buyOrder.id,
    buying: '5 ETH',
    paying: '14,750 USDC',
    price: '2950 USDC/ETH',
    minFill: '0.5 ETH',
  });

  // ============================================================================
  // EXAMPLE 5: Same-asset swap (USDC for USDC)
  // ============================================================================
  console.log('\n📝 EXAMPLE 5: Same-asset swap (USDC ↔ USDC)');
  
  const swapOrder = await api.createOrder({
    id: 'order-003',
    maker: '0x74Fe6c1B190f1f5cbF74370525aC695924118f9D',
    baseToken: USDC,           // Same asset
    quoteToken: USDC,          // Same asset
    side: 'sell',
    price: 1n * 10n**18n,      // 1:1 ratio
    size: 100n * 10n**6n,      // 100 USDC (6 decimals)
    minFill: 10n * 10n**6n,    // Min 10 USDC
    expiry: Math.floor(Date.now() / 1000) + 3600,
    channelId: '0xchannelid789',
    nonce: `${Date.now()}-003`,
    signature: '0xsignature...',
  });

  console.log('✅ Same-asset swap order created:', {
    id: swapOrder.id,
    amount: '100 USDC',
    minFill: '10 USDC',
  });

  // ============================================================================
  // EXAMPLE 6: Find matching orders
  // ============================================================================
  console.log('\n🔍 EXAMPLE 6: Find matching orders');
  
  const matches = api.findMatches({
    side: 'buy',              // I want to buy
    baseToken: WETH,
    quoteToken: USDC,
    price: 3100n * 10n**18n,  // Willing to pay up to 3100 USDC/ETH
    quantity: 2n * 10n**18n,  // Want to buy 2 ETH
  });

  console.log(`✅ Found ${matches.length} matching orders:`);
  matches.forEach((match, i) => {
    console.log(`  ${i + 1}. Order ${match.orderId}:`, {
      maker: match.maker,
      price: `${Number(BigInt(match.price) / 10n**18n)} USDC/ETH`,
      available: `${Number(BigInt(match.available) / 10n**18n)} ETH`,
    });
  });

  // ============================================================================
  // EXAMPLE 7: Get orderbook stats
  // ============================================================================
  console.log('\n📊 EXAMPLE 7: Orderbook statistics');
  
  const stats = api.getStats();
  console.log('✅ Stats:', {
    totalOrders: stats.totalOrders,
    activeOrders: stats.activeOrders,
    filledOrders: stats.filledOrders,
    partiallyFilledOrders: stats.partiallyFilledOrders,
    totalFills: stats.totalFills,
  });

  // ============================================================================
  // EXAMPLE 8: Cancel an order
  // ============================================================================
  console.log('\n❌ EXAMPLE 8: Cancel order');
  
  const makerAddress = '0x74Fe6c1B190f1f5cbF74370525aC695924118f9D';
  const cancelled = api.cancelOrder('order-003', makerAddress);
  
  console.log('✅ Order cancelled:', {
    orderId: cancelled.orderId,
    status: cancelled.status,
  });
}

/**
 * Quick reference for common operations
 */
export const QUICK_REFERENCE = {
  // Create sell order (ETH → USDC)
  sellETH: {
    baseToken: 'WETH',
    quoteToken: 'USDC',
    side: 'sell',
    description: 'Selling ETH, receiving USDC',
  },

  // Create buy order (USDC → ETH)
  buyETH: {
    baseToken: 'WETH',
    quoteToken: 'USDC',
    side: 'buy',
    description: 'Buying ETH, paying USDC',
  },

  // Same-asset swap
  swapUSDC: {
    baseToken: 'USDC',
    quoteToken: 'USDC',
    side: 'sell',
    description: 'USDC for USDC swap (both contribute same asset)',
  },
};
