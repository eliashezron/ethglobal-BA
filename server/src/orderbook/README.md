# P2P Orderbook System - Complete Guide

## 🎯 **What Your System Does**

Users can create **limit orders** to trade assets at a specific price. Orders can be filled **fully** or **partially** by multiple takers.

### Supported Trading Pairs:
- ✅ **USDC → ETH** (buy ETH with USDC)
- ✅ **ETH → USDC** (sell ETH for USDC)  
- ✅ **USDC → USDC** (same-asset swaps)
- ✅ **Any ERC20 ↔ Any ERC20**

---

## 📦 **System Components**

### 1. **Core Types** (`shared/types/order.ts`)
Already implemented:
```typescript
OrderRecord {
  id: string
  maker: address              // Order creator
  baseToken: address          // Asset being traded
  quoteToken: address         // Asset receiving
  side: 'buy' | 'sell'       // Buy or sell
  price: bigint              // Limit price
  size: bigint               // Total order size
  minFill: bigint            // Min fill per trade
  remaining: bigint          // Amount left to fill
  status: 'open' | 'partially_filled' | 'filled' | 'cancelled'
}
```

### 2. **Session Creation** (`nitrolite/create-session.ts`)
Already implemented:
- ✅ Partial fill support
- ✅ Multi-asset support (ETH/USDC, USDC/USDC)
- ✅ Automatic same-asset detection
- ✅ Fee tracking
- ✅ Settlement coordination

### 3. **Orderbook Manager** (`orderbook/OrderBook.ts`)
**NEW** - Just created:
- Order lifecycle management
- Partial fill tracking
- Order matching engine
- Validation & expiry checking

### 4. **API Layer** (`orderbook/OrderBookAPI.ts`)
**NEW** - Just created:
- REST-style interface
- Order CRUD operations
- Fill execution with session creation
- Order matching

---

## 🚀 **How to Use**

### **Create a Limit Order**

```typescript
import { OrderBook } from './orderbook/OrderBook';
import { OrderBookAPI } from './orderbook/OrderBookAPI';

const orderBook = new OrderBook();
const api = new OrderBookAPI(orderBook, nitroliteClient);

// User wants to SELL 10 ETH at 3000 USDC each
const order = await api.createOrder({
  id: 'order-001',
  maker: '0x...',           // User's wallet
  baseToken: WETH_ADDRESS,  // Selling ETH
  quoteToken: USDC_ADDRESS, // Receiving USDC
  side: 'sell',
  price: 3000n * 10n**18n,  // 3000 USDC per ETH
  size: 10n * 10n**18n,     // Total: 10 ETH
  minFill: 1n * 10n**18n,   // Min 1 ETH per fill
  expiry: Date.now() / 1000 + 86400, // 24h
  channelId: '0xchannelid',
  nonce: `${Date.now()}`,
  signature: '0xsig...',
});
```

### **Fill an Order (Partial)**

```typescript
// Taker wants to buy 3 ETH
const result = await api.fillOrder(
  'order-001',                    // Order ID
  '0xtaker...',                   // Taker address
  3n * 10n**18n                   // Quantity: 3 ETH
);

// Result includes:
// - tradeId: Unique trade identifier
// - sessionData: Nitrolite session for signing
// Order now has 7 ETH remaining
```

### **Find Matching Orders**

```typescript
// Find orders I can buy from
const matches = api.findMatches({
  side: 'buy',                    // I want to buy
  baseToken: WETH_ADDRESS,
  quoteToken: USDC_ADDRESS,
  price: 3100n * 10n**18n,        // Max price I'll pay
  quantity: 2n * 10n**18n,        // How much I want
});

// Returns sorted orders (best price first)
matches.forEach(match => {
  console.log(`Order ${match.orderId} - ${match.price} USDC/ETH`);
});
```

---

## 📊 **Order Flow Examples**

### **Example 1: ETH → USDC (Sell Order)**

```
1. Maker creates order:
   - Sell 10 ETH at 3000 USDC each
   - Min fill: 1 ETH
   
2. Taker 1 fills 3 ETH:
   - Trade session created for 3 ETH ↔ 9,000 USDC
   - Order status: partially_filled
   - Remaining: 7 ETH
   
3. Taker 2 fills 5 ETH:
   - Trade session created for 5 ETH ↔ 15,000 USDC
   - Order status: partially_filled
   - Remaining: 2 ETH
   
4. Taker 3 fills 2 ETH:
   - Trade session created for 2 ETH ↔ 6,000 USDC
   - Order status: filled ✓
   - Remaining: 0 ETH
```

### **Example 2: USDC → ETH (Buy Order)**

```
1. Maker creates order:
   - Buy 5 ETH at 2950 USDC each
   - Will pay: 14,750 USDC total
   - Min fill: 0.5 ETH
   
2. Taker fills 2 ETH:
   - Taker sends 2 ETH
   - Maker sends 5,900 USDC
   - Remaining: 3 ETH wanted
```

### **Example 3: USDC ↔ USDC (Same-Asset Swap)**

```
1. Maker creates order:
   - Contribute 100 USDC
   - Expects 100 USDC back
   - Price: 1:1
   
2. Taker fills 50 USDC:
   - Both contribute 50 USDC to session
   - System detects same-asset automatically
   - Remaining: 50 USDC
```

---

## 🔧 **Integration Steps**

### **Step 1: Initialize System**

```typescript
import { NitroliteClient } from './nitrolite/client';
import { OrderBook } from './orderbook/OrderBook';
import { OrderBookAPI } from './orderbook/OrderBookAPI';

// Initialize Nitrolite
const client = new NitroliteClient(config, eventBus);
await client.connect();

// Initialize Orderbook
const orderBook = new OrderBook();
const api = new OrderBookAPI(orderBook, client);
```

### **Step 2: Create REST/WebSocket Endpoints**

```typescript
// Express.js example
app.post('/api/orders', async (req, res) => {
  const order = await api.createOrder(req.body);
  res.json(order);
});

app.get('/api/orders', (req, res) => {
  const orders = api.getOrders(req.query);
  res.json(orders);
});

app.post('/api/orders/:orderId/fill', async (req, res) => {
  const { taker, quantity } = req.body;
  const trade = await api.fillOrder(req.params.orderId, taker, BigInt(quantity));
  res.json(trade);
});

app.get('/api/orderbook/stats', (req, res) => {
  const stats = api.getStats();
  res.json(stats);
});
```

### **Step 3: Handle Trade Sessions**

When `fillOrder()` is called:
1. ✅ Validates order can be filled
2. ✅ Creates Nitrolite session via `generateTradeSessionMessage()`
3. ✅ Returns `sessionData` with `requestToSign`
4. 👉 **You need to**: Send to maker & taker for signatures
5. 👉 **You need to**: Collect signatures and submit to ClearNode
6. ✅ Record fill once session is active

### **Step 4: Record Fills After Settlement**

```typescript
// After trade session is settled on-chain
orderBook.recordFill(
  orderId,
  tradeId,
  quantity,
  value,
  takerAddress
);
```

---

## 📁 **File Structure**

```
server/src/
├── orderbook/
│   ├── OrderBook.ts           # NEW: Order management
│   ├── OrderBookAPI.ts        # NEW: API interface
│   └── USAGE_EXAMPLES.ts      # NEW: Usage examples
├── nitrolite/
│   ├── create-session.ts      # ✅ Session creation (already done)
│   ├── sign-sessions.ts       # ✅ Signature collection
│   └── session-storage.ts     # ✅ Session persistence
└── shared/types/
    └── order.ts               # ✅ Order types (already done)
```

---

## ✅ **What's Already Working**

- ✅ Order types defined
- ✅ Partial fill support in sessions
- ✅ Multi-asset trading (ETH/USDC/USDC)
- ✅ Session creation & signing
- ✅ ClearNode integration

## 🔨 **What You Need to Add**

- 🔧 REST/WebSocket API server
- 🔧 Database persistence (currently in-memory)
- 🔧 Signature collection from maker/taker
- 🔧 WebSocket notifications for order updates
- 🔧 User authentication
- 🔧 Order signature validation

---

## 🎯 **Next Steps**

1. **Test the orderbook**:
   ```bash
   cd server && pnpm tsx src/orderbook/USAGE_EXAMPLES.ts
   ```

2. **Add HTTP server** (Express/Fastify)

3. **Add database** (PostgreSQL/Redis for orders)

4. **Build frontend** for order creation/filling

5. **Deploy** to production

---

## 📚 **API Reference**

### **OrderBookAPI Methods**

```typescript
// Create order
createOrder(orderData): Promise<OrderRecord>

// Get orders
getOrders(filters?): OrderBookEntry[]

// Get specific order
getOrderById(orderId): OrderBookEntry

// Fill order (creates trade session)
fillOrder(orderId, taker, quantity): Promise<{ tradeId, sessionData }>

// Cancel order
cancelOrder(orderId, maker): { success, orderId, status }

// Get stats
getStats(): { totalOrders, activeOrders, filledOrders, ... }

// Find matches
findMatches(request): Match[]
```

---

## 💡 **Tips**

- **Price**: Always use 18 decimals (e.g., `3000n * 10n**18n` = 3000 USDC)
- **minFill**: Prevents dust orders, set sensible minimums
- **Expiry**: Unix timestamp in seconds
- **Same-asset**: System auto-detects when `baseToken === quoteToken`
- **Partial fills**: Can happen many times until order fully filled
- **Order matching**: Best price orders returned first

---

## 🐛 **Common Issues**

**Q: Order not filling?**
- Check `canFill()` validation
- Ensure `quantity >= minFill`
- Verify order not expired
- Check sufficient `remaining`

**Q: Same-asset swap not detected?**
- Both tokens must be exact same address (case-insensitive)

**Q: Signature errors?**
- Use session keys, not wallet keys
- Follow coordinator pattern from `test-coordinator.ts`

---

That's it! Your P2P orderbook system is ready. Check `USAGE_EXAMPLES.ts` for complete code examples.
