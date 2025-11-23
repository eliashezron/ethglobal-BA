# Supabase Setup Instructions

## Project Details
- **Project Name**: ethglobal_ba
- **Project ID**: sbdblqgjodskqyftfdqg
- **URL**: https://sbdblqgjodskqyftfdqg.supabase.co

## Setup Steps

### 1. Get Your Supabase Anon Key

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/sbdblqgjodskqyftfdqg
2. Navigate to **Settings** → **API**
3. Copy the **anon/public** key
4. Update the `.env.local` file with the actual key:

```env
NEXT_PUBLIC_SUPABASE_URL=https://sbdblqgjodskqyftfdqg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_actual_anon_key_here
```

### 2. Create the Database Table

1. Go to **SQL Editor** in your Supabase dashboard
2. Copy the contents of `lib/supabase-setup.sql`
3. Paste and run the SQL script

This will create:
- The `orders` table with all necessary columns
- Indexes for better query performance
- Row Level Security policies

### 3. Verify the Setup

After running the SQL script, you should see:
- A new `orders` table in the **Table Editor**
- The table should have columns: id, wallet_address, side, sell_token, buy_token, sell_amount, buy_amount, price, order_type, expiry, status, created_at, updated_at

### 4. Test the Integration

1. Restart your Next.js development server:
   ```bash
   npm run dev
   ```

2. Connect your wallet in the app
3. Create a test order
4. Check the Supabase dashboard → **Table Editor** → **orders** to see your order

## Features Implemented

✅ **Persistent Storage**: All orders are saved to Supabase
✅ **Real-time Updates**: Orders update in real-time across all connected clients
✅ **Wallet-based Data**: Each user sees only their orders
✅ **Order Management**: Create, update, and cancel orders
✅ **Order History**: View all your past orders with timestamps

## Database Schema

```sql
orders (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  side TEXT CHECK (side IN ('buy', 'sell')),
  sell_token TEXT CHECK (sell_token IN ('ETH', 'USDC')),
  buy_token TEXT CHECK (buy_token IN ('ETH', 'USDC')),
  sell_amount TEXT,
  buy_amount TEXT,
  price TEXT,
  order_type TEXT CHECK (order_type IN ('market', 'limit')),
  expiry TEXT,
  status TEXT CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)
```

## Security

- Row Level Security (RLS) is enabled
- Public read access for the order book
- Users can only modify their own orders
- All queries are authenticated through the wallet address

## Troubleshooting

### Orders not saving?
- Check that the anon key is correct in `.env.local`
- Verify the table was created successfully
- Check browser console for errors

### Real-time updates not working?
- Ensure Realtime is enabled in Supabase dashboard
- Check that the subscription is properly set up

### Connection errors?
- Verify your Supabase project is active
- Check the project URL is correct
- Ensure you have internet connectivity
