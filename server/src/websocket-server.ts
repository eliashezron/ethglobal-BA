import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { OrderBook } from './orderbook/OrderBook';
import { OrderMatcher } from './orderbook/OrderMatcher';
import { NitroliteClient, EventBus } from './nitrolite';
import { loadEnv } from './config/env';
import type { OrderRecord } from '@shared/types/order';
import { createClient } from '@supabase/supabase-js';
import type { ChannelInfo } from './nitrolite/client';

interface ClientConnection {
  ws: WebSocket;
  address?: string;
  isAlive: boolean;
}

const PORT = process.env.WS_PORT || 8080;
const clients = new Map<string, ClientConnection>();

// Global instances
let orderBook: OrderBook;
let orderMatcher: OrderMatcher;
let nitroliteClient: NitroliteClient;
let supabase: ReturnType<typeof createClient>;
let availableChannels: ChannelInfo[] = [];

export async function startWebSocketServer() {
  // Initialize Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  Supabase credentials not found, order persistence disabled');
  } else {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase connected');
  }

  // Initialize Nitrolite client
  const env = loadEnv();
  const events = new EventBus();
  nitroliteClient = new NitroliteClient(env.yellow, events);
  
  console.log('🔗 Connecting to Nitrolite...');
  await nitroliteClient.connect();
  console.log('✅ Nitrolite connected');

  // Fetch available channels
  console.log('📡 Fetching channels...');
  events.on('nitrolite.channels.received', (data: any) => {
    if (data.channels && Array.isArray(data.channels)) {
      availableChannels = data.channels;
      console.log(`✅ Loaded ${availableChannels.length} channels`);
      if (availableChannels.length > 0) {
        console.log('📋 First channel:', availableChannels[0].channelId);
      }
    }
  });
  
  try {
    await nitroliteClient.requestChannels();
    // Give it a moment to receive the response
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    console.warn('⚠️  Could not fetch channels, will use placeholder');
  }

  // Initialize OrderBook and Matcher
  orderBook = new OrderBook();
  orderMatcher = new OrderMatcher(orderBook, nitroliteClient);

  // Listen for match events
  orderMatcher.on('match', async (match) => {
    console.log(`💱 Match created: ${match.tradeId}`);
    
    // Update order statuses in Supabase
    if (supabase) {
      try {
        // Update maker order
        await supabase
          .from('orders')
          .update({ 
            status: 'filled',
            updated_at: new Date().toISOString()
          })
          .eq('id', match.makerOrderId);
        
        // Update taker order
        await supabase
          .from('orders')
          .update({ 
            status: 'filled',
            updated_at: new Date().toISOString()
          })
          .eq('id', match.takerOrderId);
        
        console.log('✅ Order statuses updated in database');
      } catch (error) {
        console.error('❌ Failed to update order statuses:', error);
      }
    }
    
    // Broadcast match to all clients
    broadcast({
      type: 'trade.matched',
      data: {
        tradeId: match.tradeId,
        makerOrderId: match.makerOrderId,
        takerOrderId: match.takerOrderId,
        makerAddress: match.makerAddress,
        takerAddress: match.takerAddress,
        fillQuantity: match.fillQuantity.toString(),
        price: match.price.toString(),
        sessionData: match.sessionData,
      },
      timestamp: match.timestamp,
    });
  });

  // Create HTTP server
  const server = createServer();
  
  // Create WebSocket server
  const wss = new WebSocketServer({ server });

  console.log(`🚀 WebSocket server starting on port ${PORT}...`);

  // Heartbeat mechanism
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = Array.from(clients.values()).find(c => c.ws === ws);
      if (client) {
        if (!client.isAlive) {
          console.log(`Client ${client.address || 'unknown'} failed heartbeat, terminating`);
          return ws.terminate();
        }
        client.isAlive = false;
        ws.ping();
      }
    });
  }, 30000); // 30 seconds

  wss.on('connection', (ws: WebSocket, req) => {
    const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    
    clients.set(clientId, {
      ws,
      isAlive: true
    });

    console.log(`✅ New client connected: ${clientId} (Total: ${clients.size})`);

    ws.on('pong', () => {
      const client = clients.get(clientId);
      if (client) {
        client.isAlive = true;
      }
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`📨 Message from ${clientId}:`, message.type || 'unknown');

        // Handle different message types
        switch (message.type) {
          case 'auth':
            await handleAuth(ws, clientId, message);
            break;
          
          case 'order.create':
            await handleOrderCreate(ws, clientId, message);
            break;
          
          case 'order.update':
            await handleOrderUpdate(ws, clientId, message);
            break;
          
          case 'order.cancel':
            await handleOrderCancel(ws, clientId, message);
            break;
          
          case 'orderbook.subscribe':
            await handleOrderbookSubscribe(ws, clientId, message);
            break;
          
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
          
          default:
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: `Unknown message type: ${message.type}` 
            }));
        }
      } catch (error) {
        console.error(`❌ Error processing message from ${clientId}:`, error);
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: error instanceof Error ? error.message : 'Unknown error' 
        }));
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`👋 Client disconnected: ${clientId} (Total: ${clients.size})`);
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for ${clientId}:`, error);
    });

    // Send welcome message
    ws.send(JSON.stringify({ 
      type: 'connected', 
      message: 'Connected to P2P Order Book',
      timestamp: Date.now()
    }));
  });

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  server.listen(PORT, () => {
    console.log(`✅ WebSocket server running on ws://localhost:${PORT}`);
    console.log(`📡 Ready to accept connections...`);
  });

  return { server, wss };
}

// Helper function to get a channel ID
function getChannelId(): string {
  if (availableChannels.length > 0) {
    // Use the first available channel
    const channelId = availableChannels[0].channelId;
    console.log(`📡 Using channel: ${channelId}`);
    return channelId;
  }
  
  // Fallback to zero channel if none available
  console.warn('⚠️  No channels available, using placeholder');
  return '0x0000000000000000000000000000000000000000000000000000000000000000';
}

// Handler functions
async function handleAuth(ws: WebSocket, clientId: string, message: any) {
  try {
    const { address, signature } = message.data;
    
    // Store the authenticated address
    const client = clients.get(clientId);
    if (client) {
      client.address = address;
    }

    console.log(`🔐 Client authenticated: ${address}`);
    
    ws.send(JSON.stringify({
      type: 'auth.success',
      data: { address },
      timestamp: Date.now()
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'auth.error',
      message: error instanceof Error ? error.message : 'Authentication failed',
      timestamp: Date.now()
    }));
  }
}

async function handleOrderCreate(ws: WebSocket, clientId: string, message: any) {
  try {
    const client = clients.get(clientId);
    if (!client?.address) {
      throw new Error('Not authenticated');
    }

    console.log(`📝 Creating order for ${client.address}`);
    console.log('📦 Order data:', message.data);

    const orderData = message.data;
    
    // Helper to safely convert to BigInt (handle scientific notation)
    const toBigInt = (value: any): bigint => {
      const str = String(value);
      // Remove any scientific notation or decimals
      const num = Math.floor(parseFloat(str));
      return BigInt(num);
    };
    
    // Get a real channel ID (replace 0x0 with actual channel)
    const channelId = getChannelId();
    
    // Convert numeric strings to BigInt
    const order: OrderRecord = {
      ...orderData,
      channelId, // Use real channel ID
      price: toBigInt(orderData.price),
      size: toBigInt(orderData.size),
      minFill: toBigInt(orderData.minFill || orderData.size),
      remaining: toBigInt(orderData.size),
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    console.log('✅ Order converted:', {
      id: order.id,
      side: order.side,
      price: order.price.toString(),
      size: order.size.toString(),
    });

    // Add order to orderbook
    orderBook.createOrder(order);

    // Broadcast to all clients
    broadcast({
      type: 'order.created',
      data: message.data,
      timestamp: Date.now()
    }, clientId);

    ws.send(JSON.stringify({
      type: 'order.create.success',
      data: message.data,
      timestamp: Date.now()
    }));

    // Attempt to match the order
    console.log('🔍 Checking for matches...');
    const matches = await orderMatcher.onNewOrder(order);
    
    if (matches.length > 0) {
      console.log(`✅ Created ${matches.length} matches`);
    } else {
      console.log('📋 Order added to book, awaiting match');
    }

  } catch (error) {
    console.error('❌ Order creation error:', error);
    ws.send(JSON.stringify({
      type: 'order.create.error',
      message: error instanceof Error ? error.message : 'Order creation failed',
      timestamp: Date.now()
    }));
  }
}

async function handleOrderUpdate(ws: WebSocket, clientId: string, message: any) {
  try {
    const client = clients.get(clientId);
    if (!client?.address) {
      throw new Error('Not authenticated');
    }

    console.log(`✏️  Updating order ${message.data.id} for ${client.address}`);

    // Broadcast to all clients
    broadcast({
      type: 'order.updated',
      data: message.data,
      timestamp: Date.now()
    }, clientId);

    ws.send(JSON.stringify({
      type: 'order.update.success',
      data: message.data,
      timestamp: Date.now()
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'order.update.error',
      message: error instanceof Error ? error.message : 'Order update failed',
      timestamp: Date.now()
    }));
  }
}

async function handleOrderCancel(ws: WebSocket, clientId: string, message: any) {
  try {
    const client = clients.get(clientId);
    if (!client?.address) {
      throw new Error('Not authenticated');
    }

    console.log(`❌ Cancelling order ${message.data.id} for ${client.address}`);

    // Broadcast to all clients
    broadcast({
      type: 'order.cancelled',
      data: message.data,
      timestamp: Date.now()
    }, clientId);

    ws.send(JSON.stringify({
      type: 'order.cancel.success',
      data: message.data,
      timestamp: Date.now()
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'order.cancel.error',
      message: error instanceof Error ? error.message : 'Order cancellation failed',
      timestamp: Date.now()
    }));
  }
}

async function handleOrderbookSubscribe(ws: WebSocket, clientId: string, message: any) {
  console.log(`📊 Client ${clientId} subscribed to orderbook`);
  
  ws.send(JSON.stringify({
    type: 'orderbook.subscribed',
    timestamp: Date.now()
  }));
}

// Broadcast to all connected clients except sender
function broadcast(message: any, excludeClientId?: string) {
  const messageStr = JSON.stringify(message);
  clients.forEach((client, id) => {
    if (id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  startWebSocketServer().catch((error) => {
    console.error('❌ Failed to start WebSocket server:', error);
    process.exit(1);
  });
}
