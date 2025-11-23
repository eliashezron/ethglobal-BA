-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  sell_token TEXT NOT NULL CHECK (sell_token IN ('ETH', 'USDC')),
  buy_token TEXT NOT NULL CHECK (buy_token IN ('ETH', 'USDC')),
  sell_amount TEXT NOT NULL,
  buy_amount TEXT NOT NULL,
  price TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('market', 'limit')),
  expiry TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_wallet ON orders(wallet_address);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_price ON orders(price);

-- Enable Row Level Security
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read all orders (for order book)
CREATE POLICY "Allow public read access" ON orders
  FOR SELECT
  USING (true);

-- Create policy to allow users to insert their own orders
CREATE POLICY "Allow users to insert orders" ON orders
  FOR INSERT
  WITH CHECK (true);

-- Create policy to allow users to update their own orders
CREATE POLICY "Allow users to update own orders" ON orders
  FOR UPDATE
  USING (true);

-- Create policy to allow users to delete their own orders
CREATE POLICY "Allow users to delete own orders" ON orders
  FOR DELETE
  USING (true);
