import { config } from 'dotenv';
import { env } from "process";

// Load .env file
config();

export interface YellowEnvConfig {
  readonly rpcUrl: string;
  readonly clearNodeUrl: string;
  readonly custodyAddress: string;
  readonly adjudicatorAddress: string;
  readonly privateKey: string;
  readonly chainId: number;
  readonly applicationAddress: string;
  readonly applicationName: string;
  readonly sessionKey: string;
  readonly sessionPrivateKey?: string;
  readonly authScope: string;
  readonly authTtlSeconds: number;
  readonly reconnectDelayMs: number;
  readonly pingIntervalMs: number;
  readonly fetchChannelsOnConnect: boolean;
}

export interface ServerEnvConfig {
  readonly port: number;
  readonly redisUrl: string;
  readonly postgresUrl: string;
}

export interface TestEnvConfig {
  readonly makerPrivateKey: string;
  readonly takerPrivateKey: string;
}

export interface EnvConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly yellow: YellowEnvConfig;
  readonly server: ServerEnvConfig;
  readonly test: TestEnvConfig;
}

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function requireNumber(key: string, fallback: string): number {
  const value = Number(requireEnv(key, fallback));
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return value;
}

function requireBoolean(key: string, fallback: string): boolean {
  const value = requireEnv(key, fallback).toLowerCase();
  if (['true', '1', 'yes'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;
  throw new Error(`Environment variable ${key} must be a boolean`);
}

function ensureHexPrefixed(value: string): string {
  if (value.startsWith('0x') || value.startsWith('0X')) {
    return `0x${value.slice(2)}`;
  }
  return `0x${value}`;
}

export function loadEnv(): EnvConfig {
const nodeEnv = (process.env.NODE_ENV ?? 'development') as EnvConfig['nodeEnv'];

return {
    nodeEnv,
    yellow: {
      rpcUrl: requireEnv('NITROLITE_RPC_URL', 'wss://clearnet.yellow.com/ws'),
      clearNodeUrl: requireEnv('CLEARNODE_WS_URL', 'wss://clearnet.yellow.com/ws'),
      custodyAddress: requireEnv('CUSTODY_ADDRESS', '0xCUSTODY_PLACEHOLDER'),
      adjudicatorAddress: requireEnv('ADJUDICATOR_ADDRESS', '0xADJUDICATOR_PLACEHOLDER'),
      privateKey: ensureHexPrefixed(
        requireEnv('SERVER_PRIVATE_KEY', '0000000000000000000000000000000000000000000000000000000000000000'),
      ),
      chainId: requireNumber('CHAIN_ID', '137'),
      applicationAddress: requireEnv('APPLICATION_ADDRESS', '0x0000000000000000000000000000000000000000'),
      applicationName: requireEnv('APPLICATION_NAME', 'p2p-orderbook'),
      sessionKey: ensureHexPrefixed(
        requireEnv(
          'CLEARNODE_SESSION_KEY',
          '0000000000000000000000000000000000000000000000000000000000000000',
        ),
      ),
      sessionPrivateKey: process.env.CLEARNODE_SESSION_PRIVATE_KEY
        ? ensureHexPrefixed(process.env.CLEARNODE_SESSION_PRIVATE_KEY)
        : undefined,
      authScope: requireEnv('AUTH_SCOPE', 'application'),
      authTtlSeconds: requireNumber('AUTH_TTL_SECONDS', '3600'),
      reconnectDelayMs: requireNumber('CLEARNODE_RECONNECT_MS', '5000'),
      pingIntervalMs: requireNumber('CLEARNODE_PING_MS', '30000'),
      fetchChannelsOnConnect: requireBoolean('CLEARNODE_FETCH_CHANNELS', 'true'),
    },
    server: {
      port: requireNumber('PORT', '8080'),
      redisUrl: requireEnv('REDIS_URL', 'redis://localhost:6379'),
      postgresUrl: requireEnv('POSTGRES_URL', 'postgres://postgres:postgres@localhost:5432/yellow'),
    },
    test: {
      makerPrivateKey: ensureHexPrefixed(requireEnv('TEST_MAKER_PRIVATE_KEY')),
      takerPrivateKey: ensureHexPrefixed(requireEnv('TEST_TAKER_PRIVATE_KEY')),
    },
  };
}
