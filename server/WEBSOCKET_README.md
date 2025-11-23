# WebSocket Server Setup

## Running the Server

### Development Mode

Run the WebSocket server in development mode with hot reload:

```bash
cd server
pnpm run dev:ws
```

The server will start on `ws://localhost:8080`

### Production Mode

1. Build the server:
```bash
cd server
pnpm run build
```

2. Start the server:
```bash
pnpm run start:ws
```

## Environment Variables

Create a `.env` file in the `server` directory:

```env
WS_PORT=8080
NODE_ENV=development
```

## Features

✅ **Real-time Order Updates**: Orders broadcast to all connected clients
✅ **Auto-reconnection**: Clients automatically reconnect on disconnect
✅ **Heartbeat Mechanism**: Keeps connections alive with ping/pong
✅ **Authentication**: Wallet-based authentication
✅ **Order Management**: Create, update, and cancel orders in real-time

## WebSocket Message Types

### Client → Server

- `auth`: Authenticate with wallet address
- `order.create`: Create a new order
- `order.update`: Update an existing order
- `order.cancel`: Cancel an order
- `orderbook.subscribe`: Subscribe to orderbook updates
- `ping`: Ping the server

### Server → Client

- `connected`: Welcome message on connection
- `auth.success` / `auth.error`: Authentication response
- `order.created`: Order created broadcast
- `order.updated`: Order updated broadcast
- `order.cancelled`: Order cancelled broadcast
- `order.create.success` / `order.create.error`: Order creation response
- `order.update.success` / `order.update.error`: Order update response
- `order.cancel.success` / `order.cancel.error`: Order cancel response
- `pong`: Response to ping

## Testing

1. Start the WebSocket server:
```bash
cd server
pnpm run dev:ws
```

2. Start the Next.js client:
```bash
cd client
npm run dev
```

3. Connect your wallet in the browser
4. The WebSocket will automatically connect
5. Watch the console for connection logs

## Monitoring

The server logs all WebSocket events:
- ✅ Client connections
- 📨 Messages received
- 👋 Client disconnections
- ❌ Errors

## Architecture

```
Client (Browser)
    ↓ WebSocket
WebSocket Server (Port 8080)
    ↓ Nitrolite
Yellow Network
```

The WebSocket server integrates with your existing Nitrolite client and orderbook system.
