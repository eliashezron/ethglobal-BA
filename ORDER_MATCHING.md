# Order Matching & Session Creation System

## Overview
Automatic order matching system that creates Nitrolite sessions when compatible buy/sell orders are found.

## Architecture

### 1. Order Matcher (`server/src/orderbook/OrderMatcher.ts`)
**Purpose**: Automatically matches compatible orders and creates trade sessions

**Features**:
- Real-time order matching on new order arrival
- Price-time priority matching algorithm
- Partial fill support
- Event-driven architecture
- Automatic session creation via Nitrolite

**Matching Logic**:
```typescript
// For BUY orders: finds SELL orders at maker's price or lower
// For SELL orders: finds BUY orders at maker's price or higher

// Price-time priority:
- Buy side: Lowest sell prices first
- Sell side: Highest buy prices first
```

### 2. Enhanced WebSocket Server (`server/src/websocket-server.ts`)
**Updates**:
- Integrated OrderBook and OrderMatcher
- Connected to Nitrolite client
- Automatic matching on order creation
- Broadcasts trade matches to all clients

**New Message Types**:
- `trade.matched` - Sent when orders are matched
- Contains: tradeId, maker/taker info, fill quantity, price, session data

### 3. Client UI (`client/app/page.tsx`)
**New Features**:
- Trade match notifications
- Session modal showing match details
- Real-time updates when orders are matched
- Participant information display

## How It Works

### Order Creation Flow
```
1. User creates order via UI
   ↓
2. WebSocket sends to server
   ↓
3. Server adds to OrderBook
   ↓
4. OrderMatcher.onNewOrder() triggered
   ↓
5. Finds matching orders on opposite side
   ↓
6. For each match:
   - Calculate fill quantity
   - Create Nitrolite session
   - Record fills in both orders
   - Emit match event
   ↓
7. Broadcast match to all clients
   ↓
8. Clients show session modal
```

### Matching Example

**Scenario**: 
- Alice creates: BUY 1 ETH @ $2800 (Order A)
- Bob creates: SELL 1 ETH @ $2750 (Order B)

**Result**:
- ✓ Match found (Bob's price $2750 ≤ Alice's price $2800)
- Trade executes at Bob's price: $2750
- Nitrolite session created with:
  - Maker: Bob (Order B creator)
  - Taker: Alice (Order A creator)
  - Fill: 1 ETH @ $2750

## Session Creation

When orders match, the system:

1. **Generates Session Message** (`generateTradeSessionMessage`)
   - Creates app definition (3 participants: maker, taker, server)
   - Server has 100% voting power for settlement
   - Sets up allocations (tokens being exchanged)
   - Creates session metadata

2. **Session Data Includes**:
   - Trade metadata (order IDs, sides, tokens)
   - Fill information (quantity, value, percentage)
   - Financial data (amounts for each party)
   - Participant roles
   - Settlement tracking

3. **Stores Pending Session**
   - Awaits signatures from both parties
   - Includes request structure for signing
   - Tracks signature collection

## Client Features

### Session Modal
Displays when user's order is matched:
- Trade summary (quantity, price, total)
- Participant addresses
- Session status
- Next steps for users

### Real-time Updates
- Order book refreshes on match
- User orders update to show fills
- WebSocket notifications

## Configuration

### Server Setup
```typescript
// Requires:
- Nitrolite connection (Yellow Network)
- WebSocket server on port 8080
- OrderBook instance
- OrderMatcher instance
```

### Matching Parameters
```typescript
// OrderRecord fields used for matching:
- side: 'buy' | 'sell'
- price: bigint (in wei, 18 decimals)
- size: bigint (total order size)
- remaining: bigint (unfilled amount)
- minFill: bigint (minimum fill size)
- expiry: number (unix timestamp)
```

## Testing Order Matching

### Test Scenario 1: Exact Match
```typescript
// Create sell order
{
  side: 'sell',
  price: 2800e18, // $2800
  size: 1e18,     // 1 ETH
}

// Create matching buy order
{
  side: 'buy',
  price: 2800e18, // $2800
  size: 1e18,     // 1 ETH
}

// Result: Full fill, session created
```

### Test Scenario 2: Partial Fill
```typescript
// Create large sell order
{
  side: 'sell',
  price: 2800e18,
  size: 10e18,    // 10 ETH
}

// Create smaller buy order
{
  side: 'buy',
  price: 2800e18,
  size: 3e18,     // 3 ETH
}

// Result: Partial fill (3 ETH), sell order has 7 ETH remaining
```

### Test Scenario 3: Price Improvement
```typescript
// Create aggressive buy order
{
  side: 'buy',
  price: 2900e18, // Willing to pay $2900
}

// Matches existing sell at $2800
// Result: Buyer gets $100 price improvement
```

## Events

### OrderMatcher Events
```typescript
matcher.on('match', (match: MatchResult) => {
  // Emitted when orders are matched
  // Contains full trade details
});
```

### WebSocket Events
```typescript
// Server broadcasts
{
  type: 'trade.matched',
  data: {
    tradeId,
    makerOrderId,
    takerOrderId,
    makerAddress,
    takerAddress,
    fillQuantity,
    price,
    sessionData
  }
}
```

## Next Steps

### Immediate
- [ ] Test matching with real orders
- [ ] Verify session creation
- [ ] Test signature collection

### Future Enhancements
- [ ] Multi-asset pair support
- [ ] Advanced order types (stop-loss, take-profit)
- [ ] Batch matching optimization
- [ ] MEV protection
- [ ] Gas optimization for settlements

## Error Handling

The system handles:
- ✓ Orders below minFill
- ✓ Expired orders
- ✓ Insufficient remaining quantity
- ✓ Nitrolite connection failures
- ✓ Session creation errors

All errors are logged and don't prevent other matches.

## Monitoring

Check logs for:
- `🔍 Checking for matches` - New order matching attempt
- `✓ Found X potential matches` - Matches found
- `💱 Creating trade session` - Session creation started
- `✓ Match created` - Successful match
- `❌ Failed to create trade session` - Session creation error
