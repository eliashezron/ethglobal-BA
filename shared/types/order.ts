export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

export interface OrderIntent {
  readonly id: string;
  readonly maker: string;
  readonly baseToken: string;
  readonly quoteToken: string;
  readonly side: OrderSide;
  readonly price: bigint;
  readonly size: bigint;
  readonly minFill: bigint;
  readonly expiry: number;
  readonly channelId: string;
  readonly nonce: string;
  readonly signature: string;
}

export interface OrderRecord extends OrderIntent {
  status: OrderStatus;
  remaining: bigint;
  readonly createdAt: string;
  updatedAt: string;
}
