import type { Address } from '../types';

export interface AuthAllowance {
  asset: string;
  amount: string;
}

export interface AuthContext {
  scope: string;
  application: Address;
  participant: Address;
  sessionKey: Address;
  expire: string;
  allowances: AuthAllowance[];
}
