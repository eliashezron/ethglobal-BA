"use client";

import { useState, useEffect } from "react";
import { orderService } from "../lib/supabase";

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
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [userOrders, setUserOrders] = useState<UserOrder[]>([]);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  // Mock current market price
  const marketPrice = 2819.02;

  // Mock balances
  const balances = {
    ETH: 0,
    USDC: 0,
  };

  // Mock order book data
  const [orderBook, setOrderBook] = useState<{ bids: Order[]; asks: Order[] }>({
    bids: [
      { id: "1", price: 2818.5, amount: 0.5, total: 1409.25, side: "buy" },
      { id: "2", price: 2817.0, amount: 1.2, total: 3380.4, side: "buy" },
      { id: "3", price: 2815.5, amount: 0.8, total: 2252.4, side: "buy" },
    ],
    asks: [
      { id: "4", price: 2820.0, amount: 0.6, total: 1692.0, side: "sell" },
      { id: "5", price: 2821.5, amount: 0.9, total: 2539.35, side: "sell" },
      { id: "6", price: 2823.0, amount: 1.5, total: 4234.5, side: "sell" },
    ],
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
        await orderService.updateOrder(editingOrderId, {
          sell_token: sellToken,
          buy_token: buyToken,
          sell_amount: sellAmount,
          buy_amount: buyAmount,
          price: orderType === "limit" ? limitPrice : marketPrice.toString(),
          order_type: orderType,
          expiry,
        });
        
        // Update local state
        setUserOrders((prev) =>
          prev.map((order) =>
            order.id === editingOrderId
              ? {
                  ...order,
                  sellToken,
                  buyToken,
                  sellAmount,
                  buyAmount,
                  price: orderType === "limit" ? limitPrice : marketPrice.toString(),
                  orderType,
                  expiry,
                }
              : order
          )
        );
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

        await orderService.createOrder(newOrder);

        // Add to local state
        const localOrder: UserOrder = {
          id: orderId,
          side,
          sellToken,
          buyToken,
          sellAmount,
          buyAmount,
          price: orderType === "limit" ? limitPrice : marketPrice.toString(),
          orderType,
          expiry,
          status: "open",
          timestamp: Date.now(),
        };
        setUserOrders((prev) => [localOrder, ...prev]);
      }

      // Reset form
      setSellAmount("");
      setBuyAmount("");
      setLimitPrice("");
    } catch (error) {
      console.error("Error submitting order:", error);
      alert("Failed to submit order. Please try again.");
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
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

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
        }
      );

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [walletAddress]);

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
    setEditingOrderId(order.id);
    setSellToken(order.sellToken);
    setBuyToken(order.buyToken);
    setSellAmount(order.sellAmount);
    setBuyAmount(order.buyAmount);
    setLimitPrice(order.price);
    setOrderType(order.orderType);
    setExpiry(order.expiry);
    setSide(order.side);
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

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header with Connect Wallet */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold">P2P Limit Order Book</h1>
          
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
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Order Book Display */}
          <div className="lg:col-span-1 bg-zinc-900 rounded-lg p-6">
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
                {orderBook.asks.slice().reverse().map((order) => (
                  <div
                    key={order.id}
                    className="grid grid-cols-3 gap-2 text-sm text-red-400 hover:bg-zinc-800 cursor-pointer p-1 rounded"
                    onClick={() => setLimitPrice(order.price.toString())}
                  >
                    <div>{order.price.toFixed(2)}</div>
                    <div className="text-right">{order.amount.toFixed(4)}</div>
                    <div className="text-right">{order.total.toFixed(2)}</div>
                  </div>
                ))}
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
                {orderBook.bids.map((order) => (
                  <div
                    key={order.id}
                    className="grid grid-cols-3 gap-2 text-sm text-green-400 hover:bg-zinc-800 cursor-pointer p-1 rounded"
                    onClick={() => setLimitPrice(order.price.toString())}
                  >
                    <div>{order.price.toFixed(2)}</div>
                    <div className="text-right">{order.amount.toFixed(4)}</div>
                    <div className="text-right">{order.total.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Order Form */}
          <div className="lg:col-span-2 bg-zinc-900 rounded-lg p-6">
            {/* Order Type Selector */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setOrderType("market")}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  orderType === "market"
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                Market
              </button>
              <button
                onClick={() => setOrderType("limit")}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  orderType === "limit"
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                Limit
              </button>
            </div>

            {/* Current Price Display */}
            <div className="mb-6 p-4 bg-zinc-800 rounded-lg">
              <div className="text-sm text-zinc-400 mb-1">
                When 1 <span className="inline-flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-blue-500 inline-block"></span>
                  <span className="font-medium text-white">{sellToken}</span>
                </span> is worth
              </div>
              <div className="text-3xl font-bold text-white">
                {orderType === "limit" && limitPrice
                  ? parseFloat(limitPrice).toFixed(2)
                  : marketPrice.toFixed(2)}
              </div>
              <div className="text-sm text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-blue-400 inline-block"></span>
                  <span>{buyToken}</span>
                </span>
              </div>
              
              {/* Slippage/Premium Buttons */}
              {orderType === "market" && (
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => handlePercentageAdjustment(0)}
                    className="px-3 py-1 rounded-full bg-zinc-700 text-xs hover:bg-zinc-600"
                  >
                    Market
                  </button>
                  <button
                    onClick={() => handlePercentageAdjustment(1)}
                    className="px-3 py-1 rounded-full bg-zinc-700 text-xs hover:bg-zinc-600"
                  >
                    +1%
                  </button>
                  <button
                    onClick={() => handlePercentageAdjustment(5)}
                    className="px-3 py-1 rounded-full bg-zinc-700 text-xs hover:bg-zinc-600"
                  >
                    +5%
                  </button>
                  <button
                    onClick={() => handlePercentageAdjustment(10)}
                    className="px-3 py-1 rounded-full bg-zinc-700 text-xs hover:bg-zinc-600"
                  >
                    +10%
                  </button>
                </div>
              )}
            </div>

            {/* Limit Price Input (only for limit orders) */}
            {orderType === "limit" && (
              <div className="mb-6">
                <label className="block text-sm text-zinc-400 mb-2">
                  Limit Price
                </label>
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => handleLimitPriceChange(e.target.value)}
                  placeholder="Enter limit price"
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="text-xs text-zinc-500 mt-1">
                  Current market price: {marketPrice.toFixed(2)} {buyToken}
                </div>
              </div>
            )}

            {/* Sell Input */}
            <div className="mb-4">
              <label className="block text-sm text-zinc-400 mb-2">Sell</label>
              <div className="relative">
                <input
                  type="number"
                  value={sellAmount}
                  onChange={(e) => handleSellAmountChange(e.target.value)}
                  placeholder="0"
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 pr-32 text-2xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (sellToken === "ETH") {
                        setSellToken("USDC");
                        setBuyToken("ETH");
                      } else {
                        setSellToken("ETH");
                        setBuyToken("USDC");
                      }
                    }}
                    className="flex items-center gap-2 bg-zinc-700 px-3 py-2 rounded-lg hover:bg-zinc-600"
                  >
                    <span className="w-5 h-5 rounded-full bg-blue-500 inline-block"></span>
                    <span className="font-medium">{sellToken}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="text-sm text-zinc-500 mt-1 text-right">
                Balance: {balances[sellToken]}
              </div>
            </div>

            {/* Switch Button */}
            <div className="flex justify-center my-4">
              <button
                onClick={handleSwitchTokens}
                className="bg-zinc-800 p-2 rounded-full hover:bg-zinc-700 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>
            </div>

            {/* Buy Input */}
            <div className="mb-6">
              <label className="block text-sm text-zinc-400 mb-2">Buy</label>
              <div className="relative">
                <input
                  type="number"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-zinc-800 rounded-lg px-4 py-3 pr-32 text-2xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (buyToken === "ETH") {
                        setBuyToken("USDC");
                        setSellToken("ETH");
                      } else {
                        setBuyToken("ETH");
                        setSellToken("USDC");
                      }
                    }}
                    className="flex items-center gap-2 bg-zinc-700 px-3 py-2 rounded-lg hover:bg-zinc-600"
                  >
                    <span className="w-5 h-5 rounded-full bg-blue-400 inline-block"></span>
                    <span className="font-medium">{buyToken}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="text-sm text-zinc-500 mt-1 text-right">
                Balance: {balances[buyToken]}
              </div>
            </div>

            {/* Expiry */}
            <div className="mb-6">
              <label className="block text-sm text-zinc-400 mb-2">Expiry</label>
              <div className="flex gap-2">
                {["1 day", "1 week", "1 month", "1 year"].map((period) => (
                  <button
                    key={period}
                    onClick={() => setExpiry(period)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      expiry === period
                        ? "bg-zinc-700 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>
            </div>

            {/* Order Summary */}
            {sellAmount && buyAmount && (
              <div className="mb-6 p-4 bg-zinc-800 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Order Type</span>
                  <span className="text-white capitalize">{orderType}</span>
                </div>
                {orderType === "limit" && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Limit Price</span>
                    <span className="text-white">
                      {limitPrice} {buyToken}/{sellToken}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-zinc-400">You Sell</span>
                  <span className="text-white">
                    {sellAmount} {sellToken}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">You Receive</span>
                  <span className="text-white">
                    {buyAmount} {buyToken}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Expires</span>
                  <span className="text-white">{expiry}</span>
                </div>
              </div>
            )}

            {/* Confirm Button */}
            <button
              onClick={handleConfirmOrder}
              disabled={!sellAmount || !buyAmount || (orderType === "limit" && !limitPrice)}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold py-4 rounded-lg transition-colors text-lg"
            >
              {editingOrderId
                ? "Update Order"
                : orderType === "limit"
                ? "Place Limit Order"
                : "Place Market Order"}
            </button>
            {editingOrderId && (
              <button
                onClick={() => {
                  setEditingOrderId(null);
                  setSellAmount("");
                  setBuyAmount("");
                  setLimitPrice("");
                }}
                className="w-full mt-2 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Cancel Edit
              </button>
            )}
          </div>
        </div>

        {/* User Orders Section */}
        {userOrders.length > 0 && (
          <div className="mt-6 bg-zinc-900 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">My Orders</h2>
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
                  {userOrders.map((order) => (
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
                            order.status === "open"
                              ? "bg-blue-900 text-blue-300"
                              : order.status === "filled"
                              ? "bg-green-900 text-green-300"
                              : "bg-red-900 text-red-300"
                          }`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="py-3">{order.expiry}</td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          {order.status === "open" && (
                            <>
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
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
