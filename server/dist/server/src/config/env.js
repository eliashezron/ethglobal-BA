function requireEnv(key, fallback) {
    const value = process.env[key] ?? fallback;
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Missing required environment variable ${key}`);
    }
    return value;
}
export function loadEnv() {
    const nodeEnv = (process.env.NODE_ENV ?? 'development');
    return {
        nodeEnv,
        yellow: {
            rpcUrl: requireEnv('NITROLITE_RPC_URL', 'wss://clearnet.yellow.com/ws'),
            clearNodeUrl: requireEnv('CLEARNODE_WS_URL', 'wss://clearnet.yellow.com/ws'),
            custodyAddress: requireEnv('CUSTODY_ADDRESS', '0xCUSTODY_PLACEHOLDER'),
            adjudicatorAddress: requireEnv('ADJUDICATOR_ADDRESS', '0xADJUDICATOR_PLACEHOLDER'),
            privateKey: requireEnv('SERVER_PRIVATE_KEY', '0x0'),
            chainId: Number(requireEnv('CHAIN_ID', '137')),
        },
        server: {
            port: Number(requireEnv('PORT', '8080')),
            redisUrl: requireEnv('REDIS_URL', 'redis://localhost:6379'),
            postgresUrl: requireEnv('POSTGRES_URL', 'postgres://postgres:postgres@localhost:5432/yellow'),
        },
    };
}
