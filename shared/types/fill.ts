export type FillStatus = 'proposed' | 'awaiting_signatures' | 'submitted' | 'confirmed' | 'failed';

export interface FillIntent {
  readonly id: string;
  readonly orderId: string;
  readonly maker: string;
  readonly taker: string;
  readonly quantity: bigint;
  readonly price: bigint;
  readonly partial: boolean;
  readonly channelId: string;
  readonly channelNonce: bigint;
  readonly signature: string;
}

export interface FillRecord extends FillIntent {
  status: FillStatus;
  readonly createdAt: string;
  updatedAt: string;
}
