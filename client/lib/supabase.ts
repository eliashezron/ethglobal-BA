import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types
export interface UserOrderDB {
  id: string;
  wallet_address: string;
  side: 'buy' | 'sell';
  sell_token: 'ETH' | 'USDC';
  buy_token: 'ETH' | 'USDC';
  sell_amount: string;
  buy_amount: string;
  price: string;
  order_type: 'market' | 'limit';
  expiry: string;
  status: 'open' | 'filled' | 'cancelled';
  created_at: string;
  updated_at: string;
}

// Order operations
export const orderService = {
  // Create a new order
  async createOrder(order: Omit<UserOrderDB, 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from('orders')
      .insert([order])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Get all orders for a wallet
  async getOrdersByWallet(walletAddress: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('wallet_address', walletAddress)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  // Update an order
  async updateOrder(id: string, updates: Partial<UserOrderDB>) {
    const { data, error } = await supabase
      .from('orders')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Cancel an order
  async cancelOrder(id: string) {
    const { data, error } = await supabase
      .from('orders')
      .update({ 
        status: 'cancelled', 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Get all open orders (for order book)
  async getOpenOrders() {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'open')
      .order('price', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  // Subscribe to order changes
  subscribeToOrders(walletAddress: string, callback: (payload: any) => void) {
    return supabase
      .channel('orders-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `wallet_address=eq.${walletAddress}`,
        },
        callback
      )
      .subscribe();
  },
};
