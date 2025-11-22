export function normalizeLedgerBalancesPayload(payload) {
    const entries = [];
    if (!payload) {
        return entries;
    }
    const queue = Array.isArray(payload) ? [...payload] : [payload];
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
export function findBalanceByAsset(balances, assetSymbol) {
    return balances.find((entry) => entry.asset?.toLowerCase() === assetSymbol.toLowerCase());
}
function isLedgerBalanceRecord(value) {
    return typeof value === 'object' && value !== null;
}
function pickString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }
    return undefined;
}
function pickAddress(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)) {
            return value;
        }
    }
    return undefined;
}
function pickNumber(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}
function pickAmount(record, keys) {
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
