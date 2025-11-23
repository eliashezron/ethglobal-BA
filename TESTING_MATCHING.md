# Testing Order Matching System

## Quick Start

### 1. Start the Server
```bash
cd server
npm run dev
```

Expected output:
```
🔗 Connecting to Nitrolite...
✅ Nitrolite connected
🚀 WebSocket server starting on port 8080...
✅ WebSocket server running on ws://localhost:8080
```

### 2. Start the Client
```bash
cd client
npm run dev
```

### 3. Open Two Browser Windows
- Window 1: Alice (Seller)
- Window 2: Bob (Buyer)

## Test Case 1: Simple Match

### Window 1 (Alice - Seller)
1. Connect wallet
2. Select **Short** tab
3. Enter:
   - Price: `2800` USDC
   - Amount: `1` ETH
   - Expiry: Any future time
4. Click **Confirm Short**

### Window 2 (Bob - Buyer)
1. Connect wallet
2. Select **Long** tab  
3. Enter:
   - Price: `2800` USDC (same or higher than Alice's)
   - Amount: `1` ETH
   - Expiry: Any future time
4. Click **Confirm Long**

### Expected Result:
- 🎉 **Session Modal appears in both windows!**
- Console shows: `💱 Match created: trade-xxx`
- Both orders show as `partially_filled` or `filled`
- Order book updates automatically

## Test Case 2: Partial Fill

### Window 1 (Alice - Seller)
1. Create order:
   - Short
   - Price: `2800` USDC
   - Amount: `5` ETH (large order)

### Window 2 (Bob - Buyer)
1. Create order:
   - Long
   - Price: `2800` USDC
   - Amount: `1` ETH (smaller)

### Expected Result:
- Bob's order: **fully filled** (1 ETH)
- Alice's order: **partially filled** (4 ETH remaining)
- Alice can get matched again with another buyer

## Test Case 3: Price Improvement

### Window 1 (Alice - Seller)
1. Create order:
   - Short
   - Price: `2750` USDC (lower price)
   - Amount: `1` ETH

### Window 2 (Bob - Buyer)
1. Create order:
   - Long
   - Price: `2800` USDC (willing to pay more)
   - Amount: `1` ETH

### Expected Result:
- **Match at Alice's price ($2750)**
- Bob saves $50!
- Session modal shows price: $2750

## Test Case 4: No Match

### Window 1 (Alice - Seller)
1. Create order:
   - Short
   - Price: `2900` USDC (high price)
   - Amount: `1` ETH

### Window 2 (Bob - Buyer)
1. Create order:
   - Long
   - Price: `2700` USDC (low bid)
   - Amount: `1` ETH

### Expected Result:
- ❌ **No match** (Bob's bid too low)
- Both orders remain in order book
- Console: `No matches found`

## Monitoring

### Server Console
Look for these messages:
```
📝 Creating order for 0x...
✓ Order created: order-xxx
🔍 Checking for matches for order order-xxx
✓ Found 1 potential matches
💱 Creating trade session:
✓ Match created: trade-xxx
```

### Client Console
Look for:
```
WebSocket message: trade.matched
🎉 Trade matched! { tradeId: ..., fillQuantity: ... }
```

### Session Modal
Should display:
- ✅ Trade ID
- ✅ Fill quantity and price
- ✅ Maker and taker addresses
- ✅ "Nitrolite Session Created"
- ✅ Next steps

## What to Check

### ✓ Order Book Updates
- Matched orders disappear from book
- Partially filled orders show reduced quantity
- Other users see updates in real-time

### ✓ Position Table Updates
- Open positions show filled orders
- Status changes from "open" to "filled"
- Amounts reflect actual fills

### ✓ Network Traffic
Open DevTools → Network → WS:
- Should see `trade.matched` messages
- Order updates broadcast to all clients

## Troubleshooting

### No match occurs
- Check prices are compatible (buy ≥ sell price)
- Verify amounts meet minFill requirements
- Check order hasn't expired
- Server logs should show "No matches found"

### Session modal doesn't appear
- Check wallet address matches maker/taker
- Verify WebSocket connection (status indicator)
- Check browser console for errors

### Orders not showing in book
- Verify Supabase connection
- Check table has data: `select * from orders`
- Reload page to fetch latest

## Database Queries

Check order status in Supabase:
```sql
-- View all orders
SELECT id, side, price, size, remaining, status, maker
FROM orders
ORDER BY created_at DESC;

-- Check for matches
SELECT 
  o1.id as buy_order,
  o2.id as sell_order,
  o1.price as buy_price,
  o2.price as sell_price
FROM orders o1, orders o2
WHERE o1.side = 'buy' 
  AND o2.side = 'sell'
  AND o1.price >= o2.price
  AND o1.status = 'open'
  AND o2.status = 'open';
```

## Advanced Testing

### Multiple Orders
1. Create 3 sell orders at different prices ($2700, $2800, $2900)
2. Create 1 buy order at $2850
3. Should match with $2700 first (best price)

### Same User Orders
Create both buy and sell from same wallet:
- Orders should NOT match with themselves
- Need different wallets for actual matching

### Rapid Order Creation
Create multiple orders quickly:
- System should queue and process in order
- All compatible orders should match

## Success Criteria

✅ Orders match when prices cross
✅ Session modal appears for participants
✅ Order book updates in real-time
✅ Partial fills work correctly
✅ Multiple matches from one order work
✅ Price-time priority respected
✅ No errors in console

## Next: Signature Collection

After confirming matches work, the next phase is:
1. Collecting signatures from maker and taker
2. Submitting signed sessions to Nitrolite
3. Executing trades on-chain
4. Updating balances

See `server/src/nitrolite/sign-sessions.ts` for signature handling.
