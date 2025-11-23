"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { orderService } from "../lib/supabase";
import { WebSocketClient } from "../lib/websocket";

type Token = "ETH" | "USDC";
type OrderSide = "buy" | "sell";

interface Order {
  id: string;
  price: number;
  amount: number;
  total: number;
  side: OrderSide;
}

interface UserOrder {
  id: string;
  side: OrderSide;
  sellToken: Token;
  buyToken: Token;
  sellAmount: string;
  buyAmount: string;
  price: string;
  orderType: "market" | "limit";
  expiry: string;
  status: "open" | "filled" | "cancelled";
  timestamp: number;
}

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function Home() {
  const [sellToken, setSellToken] = useState<Token>("ETH");
  const [buyToken, setBuyToken] = useState<Token>("USDC");
  const [sellAmount, setSellAmount] = useState("");
  const [buyAmount, setBuyAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("limit");
  const [expiry, setExpiry] = useState("1 week");
  const [side, setSide] = useState<OrderSide>("sell");
  const [orderFormTab, setOrderFormTab] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [userOrders, setUserOrders] = useState<UserOrder[]>([]);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [positionsTab, setPositionsTab] = useState<"open" | "history">("open");
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected" | "reconnecting" | "reconnect_failed">("disconnected");
  const wsClient = useRef<WebSocketClient | null>(null);

  // Mock current market price
  const marketPrice = 2819.02;

  // Real balances from Base mainnet
  const [balances, setBalances] = useState({
    ETH: "0",
    USDC: "0",
  });

  // Order book data from real orders
  const [orderBook, setOrderBook] = useState<{ bids: Order[]; asks: Order[] }>({
    bids: [],
    asks: [],
  });

  const handleSwitchTokens = () => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
    setSellAmount(buyAmount);
    setBuyAmount(sellAmount);
    setSide(side === "buy" ? "sell" : "buy");
  };

  const handleLimitPriceChange = (value: string) => {
    setLimitPrice(value);
    if (value && sellAmount) {
      const price = parseFloat(value);
      const amount = parseFloat(sellAmount);
      if (sellToken === "ETH") {
        setBuyAmount((price * amount).toFixed(2));
      } else {
        setBuyAmount((amount / price).toFixed(6));
      }
    }
  };

  const handlePercentageClick = (percentage: number) => {
    const adjustedPrice = marketPrice * (1 + percentage / 100);
    handleLimitPriceChange(adjustedPrice.toFixed(2));
  };

  const handleSellAmountChange = (value: string) => {
    setSellAmount(value);
    if (orderType === "limit" && limitPrice && value) {
      const price = parseFloat(limitPrice);
      const amount = parseFloat(value);
      if (sellToken === "ETH") {
        setBuyAmount((price * amount).toFixed(2));
      } else {
        setBuyAmount((amount / price).toFixed(6));
      }
    } else if (orderType === "market" && value) {
      const amount = parseFloat(value);
      if (sellToken === "ETH") {
        setBuyAmount((marketPrice * amount).toFixed(2));
      } else {
        setBuyAmount((amount / marketPrice).toFixed(6));
      }
    }
  };

  const handleConfirmOrder = async () => {
    if (!walletAddress) {
      alert("Please connect your wallet first!");
      return;
    }

    try {
      if (editingOrderId) {
        // Update existing order in Supabase
        const updatePayload = {
          side,
          sell_token: sellToken,
          buy_token: buyToken,
          sell_amount: sellAmount,
          buy_amount: buyAmount,
          price: orderType === "limit" ? limitPrice : marketPrice.toString(),
          order_type: orderType,
          expiry,
          status: "open" as const, // Ensure status remains open
        };
        
        console.log('Updating order with payload:', updatePayload);
        
        const updatedOrder = await orderService.updateOrder(editingOrderId, updatePayload);
        
        console.log('Order updated successfully:', updatedOrder);
        
        // Fetch fresh data from Supabase
        await loadOrders(walletAddress);
        
        // Reload order book
        await loadOrderBook();
        
        setEditingOrderId(null);
      } else {
        // Create new order in Supabase
        const orderId = `${walletAddress}-${Date.now()}`;
        const newOrder = {
          id: orderId,
          wallet_address: walletAddress,
          side,
          sell_token: sellToken,
          buy_token: buyToken,
          sell_amount: sellAmount,
          buy_amount: buyAmount,
          price: orderType === "limit" ? limitPrice : marketPrice.toString(),
          order_type: orderType,
          expiry,
          status: "open" as const,
        };

        const createdOrder = await orderService.createOrder(newOrder);
        
        console.log('Order created successfully:', createdOrder);
        
        // Fetch fresh data from Supabase
        await loadOrders(walletAddress);
        
        // Reload order book
        await loadOrderBook();
      }

      // Reset form
      setSellAmount("");
      setBuyAmount("");
      setLimitPrice("");
    } catch (error: any) {
      console.error("Error submitting order:", error);
      const errorMsg = error?.message || "Failed to submit order. Please try again.";
      alert(errorMsg);
    }
  };

  const connectWallet = async () => {
    if (typeof window.ethereum === "undefined") {
      alert("Please install MetaMask or another Web3 wallet!");
      return;
    }

    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const address = accounts[0];
      setWalletAddress(address);
      
      // Save to localStorage for persistence
      localStorage.setItem('walletAddress', address);
      
      // Fetch real balances from Base mainnet
      await fetchBalances(address);
      
      // Load user's orders from Supabase
      await loadOrders(address);
    } catch (error) {
      console.error("Error connecting wallet:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setUserOrders([]);
    localStorage.removeItem('walletAddress');
  };

  // Fetch real balances from Base mainnet
  const fetchBalances = async (address: string) => {
    try {
      const rpcUrl = "https://base-mainnet.infura.io/v3/11469fd48540431fb160852a8dbb50a2";
      
      // USDC contract address on Base mainnet
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      
      // Fetch ETH balance
      const ethBalanceResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBalance",
          params: [address, "latest"],
          id: 1,
        }),
      });
      const ethData = await ethBalanceResponse.json();
      const ethBalance = ethData.result ? (parseInt(ethData.result, 16) / 1e18).toFixed(4) : "0";
      
      // Fetch USDC balance (ERC20)
      // balanceOf(address) function signature: 0x70a08231
      const paddedAddress = address.slice(2).padStart(64, "0");
      const data = "0x70a08231" + paddedAddress;
      
      const usdcBalanceResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [
            {
              to: usdcAddress,
              data: data,
            },
            "latest",
          ],
          id: 2,
        }),
      });
      const usdcData = await usdcBalanceResponse.json();
      const usdcBalance = usdcData.result ? (parseInt(usdcData.result, 16) / 1e6).toFixed(2) : "0"; // USDC has 6 decimals
      
      setBalances({
        ETH: ethBalance,
        USDC: usdcBalance,
      });
    } catch (error) {
      console.error("Error fetching balances:", error);
      setBalances({
        ETH: "0",
        USDC: "0",
      });
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Set mounted state and check for previously connected wallet
  useEffect(() => {
    setMounted(true);
    const savedAddress = localStorage.getItem('walletAddress');
    if (savedAddress) {
      setWalletAddress(savedAddress);
      // Fetch balances for saved address
      // fetchBalances(savedAddress);
    }

    // Initialize WebSocket client
    const ws = new WebSocketClient('ws://localhost:8080', {
      autoReconnect: true,
      reconnectDelay: 2000,
      maxReconnectAttempts: 5,
      requestTimeout: 10000,
    });

    wsClient.current = ws;

    // Listen to status changes
    ws.onStatusChange((status) => {
      console.log('WebSocket status:', status);
      setWsStatus(status);
    });

    // Listen to messages
    ws.onMessage((message) => {
      console.log('WebSocket message:', message);
      
      // Handle real-time order updates
      if (message.type === 'order.created' || message.type === 'order.updated' || message.type === 'order.cancelled') {
        // Reload orders when any order changes
        if (walletAddress) {
          loadOrders(walletAddress);
        }
        // Reload order book to show updated orders
        loadOrderBook();
      }
    });

    // Listen to errors
    ws.onError((error) => {
      console.error('WebSocket error:', error);
    });

    return () => {
      ws.close();
    };
  }, []);

  // Connect WebSocket when wallet is connected
  useEffect(() => {
    if (walletAddress && wsClient.current && wsStatus === 'disconnected') {
      console.log('Connecting WebSocket for wallet:', walletAddress);
      wsClient.current.connect(walletAddress).catch((error) => {
        console.error('Failed to connect WebSocket:', error);
      });
    }
  }, [walletAddress, wsStatus]);

  // Load orders when wallet is connected
  useEffect(() => {
    if (walletAddress) {
      loadOrders(walletAddress);
      
      // Subscribe to real-time order updates
      const subscription = orderService.subscribeToOrders(
        walletAddress,
        (payload) => {
          console.log('Order update:', payload);
          // Reload orders on any change
          loadOrders(walletAddress);
          // Also reload order book
          loadOrderBook();
        }
      );

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [walletAddress]);

  // Load order book on mount and periodically
  useEffect(() => {
    // Initial load
    loadOrderBook();

    // Refresh order book every 10 seconds
    const interval = setInterval(loadOrderBook, 10000);

    return () => clearInterval(interval);
  }, []);

  const handlePercentageAdjustment = (percentage: number) => {
    const adjustedPrice = marketPrice * (1 + percentage / 100);
    const amount = sellAmount ? parseFloat(sellAmount) : 0;
    if (sellToken === "ETH" && amount) {
      setBuyAmount((adjustedPrice * amount).toFixed(2));
    } else if (amount) {
      setBuyAmount((amount / adjustedPrice).toFixed(6));
    }
  };

  const handleEditOrder = (order: UserOrder) => {
    console.log('Editing order:', order);
    setEditingOrderId(order.id);
    setSellToken(order.sellToken);
    setBuyToken(order.buyToken);
    setSellAmount(order.sellAmount);
    setBuyAmount(order.buyAmount);
    setLimitPrice(order.price);
    setOrderType(order.orderType);
    setExpiry(order.expiry);
    setSide(order.side);
    
    // Scroll to top of page to show the form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      await orderService.cancelOrder(orderId);
      setUserOrders((prev) =>
        prev.map((order) =>
          order.id === orderId ? { ...order, status: "cancelled" } : order
        )
      );
    } catch (error) {
      console.error("Error cancelling order:", error);
      alert("Failed to cancel order. Please try again.");
    }
  };

  const loadOrders = async (address: string) => {
    setIsLoadingOrders(true);
    try {
      const orders = await orderService.getOrdersByWallet(address);
      const formattedOrders: UserOrder[] = orders.map((order) => ({
        id: order.id,
        side: order.side,
        sellToken: order.sell_token,
        buyToken: order.buy_token,
        sellAmount: order.sell_amount,
        buyAmount: order.buy_amount,
        price: order.price,
        orderType: order.order_type,
        expiry: order.expiry,
        status: order.status,
        timestamp: new Date(order.created_at).getTime(),
      }));
      setUserOrders(formattedOrders);
    } catch (error) {
      console.error("Error loading orders:", error);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const loadOrderBook = async () => {
    try {
      const allOrders = await orderService.getOpenOrders();
      
      // Separate buy and sell orders for ETH/USDC pair
      const bids: Order[] = [];
      const asks: Order[] = [];

      allOrders.forEach((order) => {
        // Only show ETH/USDC orders
        if (
          (order.sell_token === 'ETH' && order.buy_token === 'USDC') ||
          (order.sell_token === 'USDC' && order.buy_token === 'ETH')
        ) {
          const price = parseFloat(order.price);
          const sellAmount = parseFloat(order.sell_amount);
          const buyAmount = parseFloat(order.buy_amount);

          if (order.side === 'buy') {
            // Buy order (bid) - buying ETH with USDC
            bids.push({
              id: order.id,
              price: price,
              amount: order.sell_token === 'USDC' ? buyAmount : sellAmount,
              total: order.sell_token === 'USDC' ? sellAmount : buyAmount,
              side: 'buy',
            });
          } else {
            // Sell order (ask) - selling ETH for USDC
            asks.push({
              id: order.id,
              price: price,
              amount: order.sell_token === 'ETH' ? sellAmount : buyAmount,
              total: order.sell_token === 'ETH' ? buyAmount : sellAmount,
              side: 'sell',
            });
          }
        }
      });

      // Sort bids (highest price first)
      bids.sort((a, b) => b.price - a.price);
      
      // Sort asks (lowest price first)
      asks.sort((a, b) => a.price - b.price);

      setOrderBook({ bids, asks });
    } catch (error) {
      console.error('Error loading order book:', error);
    }
  };

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header with Connect Wallet */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">P2P Limit Order Book</h1>
            
            {/* WebSocket Status Indicator */}
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${
                wsStatus === 'connected' ? 'bg-green-400' :
                wsStatus === 'connecting' || wsStatus === 'reconnecting' ? 'bg-yellow-400 animate-pulse' :
                'bg-red-400'
              }`}></div>
              <span className="text-zinc-400">
                {wsStatus === 'connected' ? 'Live' :
                 wsStatus === 'connecting' ? 'Connecting...' :
                 wsStatus === 'reconnecting' ? 'Reconnecting...' :
                 'Offline'}
              </span>
            </div>
          </div>
          
          {walletAddress ? (
            <div className="flex items-center gap-3">
              <div className="bg-zinc-800 px-4 py-2 rounded-lg flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span className="text-sm font-medium">{formatAddress(walletAddress)}</span>
              </div>
              <button
                onClick={disconnectWallet}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Order Book - Left Side */}
          <div className="lg:col-span-3 bg-zinc-900 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Order Book</h2>
            <div className="text-sm mb-4 text-zinc-400">
              {sellToken}/{buyToken}
            </div>
            
            {/* Asks (Sell Orders) */}
            <div className="mb-6">
              <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500 mb-2">
                <div>Price</div>
                <div className="text-right">Amount</div>
                <div className="text-right">Total</div>
              </div>
              <div className="space-y-1">
                {orderBook.asks.length > 0 ? (
                  orderBook.asks.slice().reverse().map((order) => (
                    <div
                      key={order.id}
                      className="grid grid-cols-3 gap-2 text-sm text-red-400 hover:bg-zinc-800 cursor-pointer p-1 rounded"
                      onClick={() => setLimitPrice(order.price.toString())}
                    >
                      <div>{order.price.toFixed(2)}</div>
                      <div className="text-right">{order.amount.toFixed(4)}</div>
                      <div className="text-right">{order.total.toFixed(2)}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-zinc-500 text-sm py-2">
                    No sell orders
                  </div>
                )}
              </div>
            </div>

            {/* Current Market Price */}
            <div className="my-4 py-2 bg-zinc-800 rounded text-center">
              <div className="text-lg font-bold text-green-400">
                {marketPrice.toFixed(2)}
              </div>
              <div className="text-xs text-zinc-400">Market Price</div>
            </div>

            {/* Bids (Buy Orders) */}
            <div>
              <div className="space-y-1">
                {orderBook.bids.length > 0 ? (
                  orderBook.bids.map((order) => (
                    <div
                      key={order.id}
                      className="grid grid-cols-3 gap-2 text-sm text-green-400 hover:bg-zinc-800 cursor-pointer p-1 rounded"
                      onClick={() => setLimitPrice(order.price.toString())}
                    >
                      <div>{order.price.toFixed(2)}</div>
                      <div className="text-right">{order.amount.toFixed(4)}</div>
                      <div className="text-right">{order.total.toFixed(2)}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-zinc-500 text-sm py-2">
                    No buy orders
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DexScreener Chart - Middle */}
          <div className="lg:col-span-6 bg-zinc-900 rounded-lg overflow-hidden">
            <iframe
              src="https://dexscreener.com/ethereum/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640?embed=1&theme=dark&trades=0&info=0"
              className="w-full h-[600px] border-0"
              title="DexScreener ETH/USD Chart"
            />
          </div>

          {/* Order Form - Right Side */}
          <div className="lg:col-span-3 bg-zinc-900 rounded-lg overflow-hidden">
            {/* Long/Short Tabs */}
            <div className="grid grid-cols-2 border-b border-zinc-800">
              <button
                onClick={() => {
                  setOrderFormTab("long");
                  setSide("buy");
                }}
                className={`py-4 text-center font-semibold transition-colors ${
                  orderFormTab === "long"
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-400 hover:text-zinc-300"
                }`}
              >
                Long
              </button>
              <button
                onClick={() => {
                  setOrderFormTab("short");
                  setSide("sell");
                }}
                className={`py-4 text-center font-semibold transition-colors ${
                  orderFormTab === "short"
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-400 hover:text-zinc-300"
                }`}
              >
                Short
              </button>
            </div>

            <div className="p-6">
              {/* Editing Indicator */}
              {editingOrderId && (
                <div className="mb-4 p-3 bg-blue-900/30 border border-blue-500 rounded-lg flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span className="text-blue-300 text-sm font-medium">Editing Order #{editingOrderId.slice(-8)}</span>
                </div>
              )}

              {/* Price Input */}
              <div className="mb-6">
                <label className="block text-sm text-zinc-400 mb-2">Price (USDC)</label>
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => handleLimitPriceChange(e.target.value)}
                  placeholder={marketPrice.toFixed(2)}
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="text-xs text-zinc-500 mt-1">
                  Market: ${marketPrice.toFixed(2)}
                </div>
              </div>

              {/* Amount Input */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-400">
                    Amount ({orderFormTab === "long" ? "ETH" : "ETH"})
                  </label>
                  <span className="text-xs text-zinc-500">
                    Balance: {orderFormTab === "long" ? balances.USDC : balances.ETH}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={orderFormTab === "long" ? buyAmount : sellAmount}
                    onChange={(e) => {
                      if (orderFormTab === "long") {
                        setBuyAmount(e.target.value);
                        if (limitPrice) {
                          setSellAmount((parseFloat(e.target.value) * parseFloat(limitPrice)).toFixed(2));
                        }
                      } else {
                        setSellAmount(e.target.value);
                        if (limitPrice) {
                          setBuyAmount((parseFloat(e.target.value) * parseFloat(limitPrice)).toFixed(2));
                        }
                      }
                    }}
                    placeholder="0.0"
                    className="w-full bg-zinc-800 rounded-lg px-4 py-3 pr-20 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <Image 
                      src={orderFormTab === "long" ? "/eth.png" : "/eth.png"} 
                      alt="ETH" 
                      width={20} 
                      height={20} 
                      className="rounded-full" 
                    />
                    <span className="text-sm font-medium text-white">ETH</span>
                  </div>
                </div>
              </div>

              {/* Total */}
              <div className="mb-6 p-4 bg-zinc-800 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Total (USDC)</span>
                  <div className="flex items-center gap-2">
                    <Image src="/usdc.png" alt="USDC" width={20} height={20} className="rounded-full" />
                    <span className="text-lg font-semibold text-white">
                      {orderFormTab === "long" 
                        ? (sellAmount || "0.00")
                        : (buyAmount || "0.00")
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Expiry */}
              <div className="mb-6">
                <label className="block text-sm text-zinc-400 mb-2">Expiry</label>
                <div className="grid grid-cols-4 gap-2">
                  {["1 day", "1 week", "1 month", "1 year"].map((period) => (
                    <button
                      key={period}
                      onClick={() => setExpiry(period)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        expiry === period
                          ? "bg-zinc-700 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {period.split(" ")[0]}{period.includes("day") ? "d" : period.includes("week") ? "w" : period.includes("month") ? "m" : "y"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Confirm Button */}
              <button
                onClick={handleConfirmOrder}
                disabled={!limitPrice || (orderFormTab === "long" ? !buyAmount : !sellAmount)}
                className="w-full py-4 rounded-xl font-bold text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: orderFormTab === "long" 
                    ? "linear-gradient(to right, #22c55e, #16a34a)" 
                    : "linear-gradient(to right, #ef4444, #dc2626)",
                  color: "white"
                }}
              >
                {editingOrderId ? "Update Order" : `${orderFormTab === "long" ? "Buy" : "Sell"} ETH`}
              </button>
              {editingOrderId && (
                <button
                  onClick={() => {
                    setEditingOrderId(null);
                    setSellAmount("");
                    setBuyAmount("");
                    setLimitPrice("");
                  }}
                  className="w-full mt-3 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Positions Section */}
        <div className="mt-6 bg-zinc-900 rounded-lg overflow-hidden">
          <h2 className="text-xl font-semibold px-6 pt-6 pb-4">Positions</h2>
          
          {/* Tabs */}
          <div className="flex border-b border-zinc-800">
            <button
              onClick={() => setPositionsTab("open")}
              className={`flex-1 py-4 text-center font-medium transition-colors relative ${
                positionsTab === "open"
                  ? "text-white bg-zinc-950"
                  : "text-zinc-400 hover:text-zinc-300"
              }`}
            >
              Open Positions ({userOrders.filter(o => o.status === "open").length})
              {positionsTab === "open" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"></div>
              )}
            </button>
            <button
              onClick={() => setPositionsTab("history")}
              className={`flex-1 py-4 text-center font-medium transition-colors relative ${
                positionsTab === "history"
                  ? "text-white bg-zinc-950"
                  : "text-zinc-400 hover:text-zinc-300"
              }`}
            >
              Position History ({userOrders.filter(o => o.status !== "open").length})
              {positionsTab === "history" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"></div>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {positionsTab === "open" ? (
              // Open Positions
              userOrders.filter(o => o.status === "open").length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-zinc-400 border-b border-zinc-800">
                        <th className="pb-3">Type</th>
                        <th className="pb-3">Side</th>
                        <th className="pb-3">Pair</th>
                        <th className="pb-3">Amount</th>
                        <th className="pb-3">Price</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">Expiry</th>
                        <th className="pb-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userOrders
                        .filter(o => o.status === "open")
                        .map((order) => (
                          <tr
                            key={order.id}
                            className="border-b border-zinc-800 text-sm hover:bg-zinc-800"
                          >
                            <td className="py-3">
                              <span className="capitalize">{order.orderType}</span>
                            </td>
                            <td className="py-3">
                              <span
                                className={`capitalize ${
                                  order.side === "buy"
                                    ? "text-green-400"
                                    : "text-red-400"
                                }`}
                              >
                                {order.side}
                              </span>
                            </td>
                            <td className="py-3">
                              {order.sellToken}/{order.buyToken}
                            </td>
                            <td className="py-3">
                              {order.sellAmount} {order.sellToken}
                            </td>
                            <td className="py-3">${parseFloat(order.price).toFixed(2)}</td>
                            <td className="py-3">
                              <span
                                className="px-2 py-1 rounded text-xs bg-green-900 text-green-300"
                              >
                                {order.status}
                              </span>
                            </td>
                            <td className="py-3">{order.expiry}</td>
                            <td className="py-3">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEditOrder(order)}
                                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleCancelOrder(order.id)}
                                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-xl text-zinc-300 mb-2">No open positions</p>
                  <p className="text-sm text-zinc-500">Your open positions will appear here</p>
                </div>
              )
            ) : (
              // Position History
              userOrders.filter(o => o.status !== "open").length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-zinc-400 border-b border-zinc-800">
                        <th className="pb-3">Type</th>
                        <th className="pb-3">Side</th>
                        <th className="pb-3">Pair</th>
                        <th className="pb-3">Amount</th>
                        <th className="pb-3">Price</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userOrders
                        .filter(o => o.status !== "open")
                        .map((order) => (
                          <tr
                            key={order.id}
                            className="border-b border-zinc-800 text-sm hover:bg-zinc-800"
                          >
                            <td className="py-3">
                              <span className="capitalize">{order.orderType}</span>
                            </td>
                            <td className="py-3">
                              <span
                                className={`capitalize ${
                                  order.side === "buy"
                                    ? "text-green-400"
                                    : "text-red-400"
                                }`}
                              >
                                {order.side}
                              </span>
                            </td>
                            <td className="py-3">
                              {order.sellToken}/{order.buyToken}
                            </td>
                            <td className="py-3">
                              {order.sellAmount} {order.sellToken}
                            </td>
                            <td className="py-3">${parseFloat(order.price).toFixed(2)}</td>
                            <td className="py-3">
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  order.status === "filled"
                                    ? "bg-blue-900 text-blue-300"
                                    : "bg-red-900 text-red-300"
                                }`}
                              >
                                {order.status}
                              </span>
                            </td>
                            <td className="py-3">{order.expiry}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-xl text-zinc-300 mb-2">No position history</p>
                  <p className="text-sm text-zinc-500">Your closed positions will appear here</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
