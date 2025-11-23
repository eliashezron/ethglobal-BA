import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

interface ClientConnection {
  ws: WebSocket;
  address?: string;
  isAlive: boolean;
}

const PORT = process.env.WS_PORT || 8080;
const clients = new Map<string, ClientConnection>();

export async function startWebSocketServer() {
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
  } catch (error) {
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
