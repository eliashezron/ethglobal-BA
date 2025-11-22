type Address = `0x${string}`;

type LedgerBalanceRecord = Record<string, unknown>;

export interface LedgerBalanceEntry {
  readonly asset?: string;
  readonly token?: Address;
  readonly amount?: string;
  readonly chainId?: number;
  readonly raw: LedgerBalanceRecord;
}

export interface LedgerBalancesSnapshot {
  readonly participant: Address;
  readonly balances: LedgerBalanceEntry[];
  readonly requestId?: number;
  readonly raw: unknown;
}

export function normalizeLedgerBalancesPayload(payload: unknown): LedgerBalanceEntry[] {
  const entries: LedgerBalanceEntry[] = [];

  if (!payload) {
    return entries;
  }

  const queue: unknown[] = Array.isArray(payload) ? [...payload] : [payload];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (isLedgerBalanceRecord(current)) {
      const nestedCandidates = ['balances', 'ledger_balances', 'entries', 'items', 'results'];
      nestedCandidates.forEach((key) => {
        const value = current[key];
        if (Array.isArray(value)) {
          queue.push(...value);
        }
      });

      const asset = pickString(current, ['asset', 'symbol', 'ticker']);
      const token = pickAddress(current, ['token', 'address']);
      const amount = pickAmount(current, ['amount', 'balance', 'value']);
      const chainId = pickNumber(current, ['chainId', 'chain_id']);

      if (asset || token || amount) {
        entries.push({
          asset,
          token,
          amount,
          chainId,
          raw: current,
        });
      }

      continue;
    }
  }

  return entries;
}

export function findBalanceByAsset(balances: LedgerBalanceEntry[], assetSymbol: string): LedgerBalanceEntry | undefined {
  return balances.find((entry) => entry.asset?.toLowerCase() === assetSymbol.toLowerCase());
}

function isLedgerBalanceRecord(value: unknown): value is LedgerBalanceRecord {
  return typeof value === 'object' && value !== null;
}

function pickString(record: LedgerBalanceRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function pickAddress(record: LedgerBalanceRecord, keys: string[]): Address | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)) {
      return value as Address;
    }
  }
  return undefined;
}

function pickNumber(record: LedgerBalanceRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function pickAmount(record: LedgerBalanceRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
  }
  return undefined;
}
