import { WebSocket } from 'ws';
import { ethers } from 'ethers';
import { createAuthRequestMessage, createAuthVerifyMessageFromChallenge, createAuthVerifyMessageWithJWT, createECDSAMessageSigner, createGetChannelsMessage, createGetLedgerBalancesMessage, createPingMessage, getError, getMethod, getParams, getResult, getRequestId, RPCMethod, EIP712AuthTypes, } from '@erc7824/nitrolite';
import { generateSessionKey, getStoredJWT, getStoredSessionKey, removeJWT, removeSessionKey, storeJWT, storeSessionKey, } from '../../lib/utils';
import { normalizeLedgerBalancesPayload } from '../../lib/asset_mgt';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export class NitroliteClient {
    config;
    events;
    wallet;
    walletAddress;
    applicationAddress;
    sessionWallet;
    sessionKey;
    sessionMessageSigner;
    pendingLedgerRequests = new Map();
    socket;
    state = 'idle';
    jwtToken;
    connectPromise;
    resolveConnect;
    rejectConnect;
    reconnectTimer;
    pingTimer;
    shouldReconnect = true;
    pendingAuth;
    constructor(config, events) {
        this.config = config;
        this.events = events;
        this.wallet = new ethers.Wallet(this.config.privateKey);
        this.walletAddress = this.wallet.address;
        this.applicationAddress = (this.config.applicationAddress === ZERO_ADDRESS
            ? this.walletAddress
            : this.config.applicationAddress);
        const storedSession = this.safeLoadSessionKey();
        const configuredSessionKey = this.isZeroHex(this.config.sessionKey)
            ? undefined
            : this.config.sessionKey;
        const configuredSessionPrivateKey = this.normalizeHex(this.config.sessionPrivateKey);
        let sessionSource;
        if (configuredSessionPrivateKey) {
            const wallet = new ethers.Wallet(configuredSessionPrivateKey);
            sessionSource = { privateKey: configuredSessionPrivateKey, address: wallet.address };
            if (configuredSessionKey && configuredSessionKey.toLowerCase() !== sessionSource.address.toLowerCase()) {
                this.events.emit('nitrolite.session.mismatch', {
                    configuredSessionKey,
                    derivedSessionKey: sessionSource.address,
                });
            }
        }
        else if (storedSession) {
            sessionSource = storedSession;
            if (configuredSessionKey && configuredSessionKey.toLowerCase() !== storedSession.address.toLowerCase()) {
                this.events.emit('nitrolite.session.mismatch', {
                    configuredSessionKey,
                    derivedSessionKey: storedSession.address,
                });
            }
        }
        else {
            sessionSource = generateSessionKey();
            storeSessionKey(sessionSource);
            this.events.emit('nitrolite.session.generated', { address: sessionSource.address });
        }
        this.sessionWallet = new ethers.Wallet(sessionSource.privateKey);
        const derivedSessionKey = this.sessionWallet.address;
        this.sessionKey = configuredSessionKey ?? storedSession?.address ?? derivedSessionKey;
        if (this.sessionKey.toLowerCase() !== derivedSessionKey.toLowerCase()) {
            this.events.emit('nitrolite.session.mismatch', {
                configuredSessionKey: this.sessionKey,
                derivedSessionKey,
            });
        }
        if (!configuredSessionPrivateKey) {
            storeSessionKey({ privateKey: this.sessionWallet.privateKey, address: derivedSessionKey });
        }
        this.sessionMessageSigner = createECDSAMessageSigner(this.sessionWallet.privateKey);
        this.jwtToken = getStoredJWT() ?? this.jwtToken;
        this.jwtToken = getStoredJWT() ?? undefined;
    }
    get address() {
        return this.walletAddress;
    }
    get isConnected() {
        return this.state === 'authenticated';
    }
    get jwt() {
        return this.jwtToken;
    }
    async connect() {
        if (this.state === 'authenticated' && this.socket?.readyState === WebSocket.OPEN) {
            return;
        }
        if (this.state === 'connecting' && this.connectPromise) {
            return this.connectPromise;
        }
        this.shouldReconnect = true;
        this.state = 'connecting';
        this.connectPromise = new Promise((resolve, reject) => {
            this.resolveConnect = resolve;
            this.rejectConnect = reject;
            this.openSocket();
        });
        return this.connectPromise;
    }
    async disconnect() {
        this.shouldReconnect = false;
        this.stopHeartbeat();
        this.clearReconnectTimer();
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close(1000, 'client disconnect');
        }
        this.cleanup();
    }
    async updateChannel(_update) {
        if (!this.isConnected) {
            throw new Error('Nitrolite client not connected');
        }
        // TODO: push updated state to ClearNode
    }
    openSocket() {
        this.events.emit('nitrolite.connection.initiated', {
            url: this.config.clearNodeUrl,
            address: this.walletAddress,
        });
        const socket = new WebSocket(this.config.clearNodeUrl);
        this.socket = socket;
        socket.on('open', () => {
            this.events.emit('nitrolite.connection.open', { url: this.config.clearNodeUrl });
            this.authenticate();
        });
        socket.on('message', (data) => {
            void this.handleMessage(data.toString());
        });
        socket.on('error', (error) => {
            this.events.emit('nitrolite.connection.error', {
                error: error instanceof Error ? error.message : String(error),
            });
            if (this.rejectConnect) {
                this.rejectConnect(error);
                this.rejectConnect = undefined;
                this.resolveConnect = undefined;
            }
            if (this.state === 'connecting') {
                this.cleanup();
            }
        });
        socket.on('close', (code, reason) => {
            const closeReason = reason.toString() || 'unknown';
            this.events.emit('nitrolite.connection.closed', { code, reason: closeReason });
            if (this.state === 'connecting' && this.rejectConnect) {
                this.rejectConnect(new Error(`ClearNode connection closed (${code}): ${closeReason}`));
            }
            this.cleanup();
            this.scheduleReconnect();
        });
    }
    async authenticate() {
        try {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket not open');
            }
            if (this.jwtToken) {
                try {
                    const verifyWithJwt = await createAuthVerifyMessageWithJWT(this.jwtToken);
                    this.socket.send(verifyWithJwt);
                    this.events.emit('nitrolite.auth.verify.jwt', {});
                    return;
                }
                catch (error) {
                    this.jwtToken = undefined;
                    removeJWT();
                    this.events.emit('nitrolite.auth.verify.jwt_failed', {
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            await this.sendAuthRequest('initial');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.events.emit('nitrolite.auth.error', { message });
            if (this.rejectConnect) {
                this.rejectConnect(error);
                this.rejectConnect = undefined;
                this.resolveConnect = undefined;
            }
            this.cleanup();
        }
    }
    async handleMessage(raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (error) {
            this.events.emit('nitrolite.message.invalid', { raw });
            return;
        }
        const method = getMethod(parsed);
        const error = getError(parsed);
        if (error) {
            this.events.emit('nitrolite.rpc.error', error);
        }
        if (!method) {
            this.events.emit('nitrolite.message.unknown', { raw: parsed });
            return;
        }
        const payload = parsed.req ? getParams(parsed) : getResult(parsed);
        const context = { method, payload, raw: parsed };
        switch (method) {
            case RPCMethod.AuthChallenge:
                await this.handleAuthChallenge(context);
                break;
            case RPCMethod.AuthVerify:
                await this.handleAuthVerify(context);
                break;
            case RPCMethod.Error:
                this.handleError(context);
                break;
            case RPCMethod.GetChannels:
                this.handleGetChannels(context);
                break;
            case RPCMethod.GetLedgerBalances:
                this.handleGetLedgerBalances(context);
                break;
            default:
                this.events.emit(`nitrolite.message.${method}`, payload);
        }
    }
    async handleAuthChallenge({ payload }) {
        const data = this.unwrapPayload(payload);
        const challengeMessage = data?.challengeMessage ?? data?.challenge_message;
        if (!challengeMessage) {
            const error = new Error('Missing challengeMessage in auth challenge');
            this.events.emit('nitrolite.auth.error', { message: error.message });
            if (this.rejectConnect) {
                this.rejectConnect(error);
                this.rejectConnect = undefined;
                this.resolveConnect = undefined;
            }
            this.cleanup();
            return;
        }
        try {
            if (!this.pendingAuth) {
                await this.sendAuthRequest('retry');
            }
            const authVerify = await createAuthVerifyMessageFromChallenge(this.createAuthVerifyMessageSigner(), challengeMessage);
            this.socket?.send(authVerify);
            this.events.emit('nitrolite.auth.challenge', { challengeMessage });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.events.emit('nitrolite.auth.error', { message });
            if (this.rejectConnect) {
                this.rejectConnect(error);
                this.rejectConnect = undefined;
                this.resolveConnect = undefined;
            }
            this.cleanup();
        }
    }
    async handleAuthVerify({ payload }) {
        const params = this.unwrapPayload(payload);
        if (!params?.success) {
            const error = new Error('Nitrolite authentication failed');
            this.events.emit('nitrolite.auth.failed', params ?? {});
            removeJWT();
            removeSessionKey();
            if (this.rejectConnect) {
                this.rejectConnect(error);
                this.rejectConnect = undefined;
                this.resolveConnect = undefined;
            }
            this.cleanup();
            return;
        }
        const sessionKey = (params.sessionKey ?? params.session_key ?? this.sessionKey);
        this.jwtToken = params.jwtToken ?? params.jwt_token ?? this.jwtToken;
        this.state = 'authenticated';
        this.events.emit('nitrolite.auth.success', {
            address: params.address ?? this.walletAddress,
            sessionKey,
            jwt: this.jwtToken,
        });
        if (this.jwtToken) {
            storeJWT(this.jwtToken);
        }
        const persistedSession = {
            privateKey: this.sessionWallet.privateKey,
            address: sessionKey,
        };
        storeSessionKey(persistedSession);
        this.resolveConnect?.();
        this.resolveConnect = undefined;
        this.rejectConnect = undefined;
        this.startHeartbeat();
        if (this.config.fetchChannelsOnConnect) {
            await this.requestChannels();
        }
    }
    handleError({ payload }) {
        const params = this.unwrapPayload(payload);
        const message = params?.error ?? 'Unknown ClearNode error';
        this.events.emit('nitrolite.rpc.error', { message });
        if (message.toLowerCase().includes('auth')) {
            removeJWT();
            removeSessionKey();
        }
    }
    handleGetChannels({ payload }) {
        const unwrapped = this.unwrapPayload(payload);
        const channels = this.normalizeChannelsPayload(unwrapped);
        if (channels.length === 0) {
            this.events.emit('nitrolite.channels.received', {
                count: 0,
                raw: unwrapped,
            });
            return;
        }
        channels.forEach((channel, index) => {
            this.events.emit('nitrolite.channels.entry', {
                index,
                channelId: channel.channelId,
                participant: channel.participant,
                wallet: channel.wallet,
                status: channel.status,
                token: channel.token,
                amount: channel.amount,
                chainId: channel.chainId,
                adjudicator: channel.adjudicator,
                createdAt: channel.createdAt,
                updatedAt: channel.updatedAt,
                raw: channel.raw,
            });
        });
        this.events.emit('nitrolite.channels.received', {
            count: channels.length,
            channels: channels.map(({ raw, ...summary }) => summary),
        });
    }
    handleGetLedgerBalances({ payload, raw }) {
        const requestId = this.pickRequestId(raw);
        const pending = typeof requestId === 'number' ? this.pendingLedgerRequests.get(requestId) : undefined;
        const participant = pending?.participant ?? this.pickParticipantFromPayload(payload);
        if (typeof requestId === 'number') {
            this.pendingLedgerRequests.delete(requestId);
        }
        const balances = normalizeLedgerBalancesPayload(payload);
        this.events.emit('nitrolite.ledger.received', {
            participant,
            requestId,
            balances,
            raw: payload,
        });
    }
    safeLoadSessionKey() {
        try {
            return getStoredSessionKey() ?? undefined;
        }
        catch {
            return undefined;
        }
    }
    normalizeHex(value) {
        if (!value)
            return undefined;
        const normalized = value.startsWith('0x') || value.startsWith('0X') ? `0x${value.slice(2)}` : `0x${value}`;
        return /^0x0+$/i.test(normalized) ? undefined : normalized;
    }
    isZeroHex(value) {
        if (!value)
            return true;
        const normalized = value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`;
        return /^0x0+$/i.test(normalized);
    }
    unwrapPayload(payload) {
        if (Array.isArray(payload)) {
            if (payload.length === 1) {
                return payload[0];
            }
            return payload;
        }
        return payload ?? {};
    }
    async requestChannels() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
            return;
        try {
            const message = await createGetChannelsMessage(this.sessionMessageSigner, this.walletAddress);
            this.socket.send(message);
            this.events.emit('nitrolite.channels.requested', {
                participant: this.walletAddress,
                sessionKey: this.sessionKey,
            });
        }
        catch (error) {
            this.events.emit('nitrolite.channels.error', {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    async requestLedgerBalances(participant = this.walletAddress) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('Nitrolite client not connected');
        }
        try {
            const message = await createGetLedgerBalancesMessage(this.sessionMessageSigner, participant);
            let requestId;
            try {
                const parsed = JSON.parse(message);
                if (parsed?.req && typeof parsed.req[0] === 'number') {
                    requestId = parsed.req[0];
                    this.pendingLedgerRequests.set(requestId, {
                        participant,
                        requestedAt: Date.now(),
                    });
                }
            }
            catch (parseError) {
                this.events.emit('nitrolite.ledger.error', {
                    participant,
                    message: parseError instanceof Error ? parseError.message : String(parseError),
                });
            }
            this.socket.send(message);
            this.events.emit('nitrolite.ledger.requested', {
                participant,
                requestId,
            });
            return requestId;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.events.emit('nitrolite.ledger.error', {
                participant,
                message,
            });
            throw error;
        }
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.pingTimer = setInterval(async () => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
                return;
            try {
                const ping = await createPingMessage(this.sessionMessageSigner);
                this.socket.send(ping);
            }
            catch (error) {
                this.events.emit('nitrolite.ping.error', {
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }, this.config.pingIntervalMs);
    }
    stopHeartbeat() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
    }
    async sendAuthRequest(reason) {
        const authContext = this.createAuthContext();
        this.pendingAuth = authContext;
        const authRequest = await createAuthRequestMessage({
            address: this.walletAddress,
            session_key: authContext.sessionKey,
            app_name: this.config.applicationName,
            allowances: authContext.allowances,
            expire: authContext.expire,
            scope: authContext.scope,
            application: authContext.application,
        });
        this.socket?.send(authRequest);
        this.events.emit('nitrolite.auth.requested', {
            address: this.walletAddress,
            application: authContext.application,
            participant: authContext.participant,
            sessionKey: authContext.sessionKey,
            expiresAt: authContext.expire,
            reason,
        });
    }
    createAuthContext() {
        const expire = Math.floor(Date.now() / 1000 + this.config.authTtlSeconds).toString();
        return {
            scope: this.config.authScope,
            application: this.applicationAddress,
            participant: this.walletAddress,
            sessionKey: this.sessionKey,
            expire,
            allowances: [],
        };
    }
    normalizeChannelsPayload(payload) {
        const entries = this.extractChannelEntries(payload);
        return this.normalizeChannelEntries(entries);
    }
    extractChannelEntries(payload) {
        if (!payload) {
            return [];
        }
        if (Array.isArray(payload)) {
            return payload.filter((value) => this.isRecord(value));
        }
        if (this.isRecord(payload)) {
            if (Array.isArray(payload.channels)) {
                return payload.channels.filter((value) => this.isRecord(value));
            }
            if (Array.isArray(payload.items)) {
                return payload.items.filter((value) => this.isRecord(value));
            }
            if (payload.channel || payload.channel_id || payload.channelId) {
                return [payload];
            }
        }
        return [];
    }
    normalizeChannelEntries(entries) {
        const channels = [];
        entries.forEach((entry) => {
            const channelId = this.pickString(entry, ['channelId', 'channel_id']);
            const token = this.pickAddress(entry, ['token']);
            if (!channelId || !token) {
                this.events.emit('nitrolite.channels.unparsed', { entry });
                return;
            }
            channels.push({
                channelId,
                participant: this.pickAddress(entry, ['participant']),
                wallet: this.pickAddress(entry, ['wallet']),
                status: this.pickString(entry, ['status']),
                token,
                amount: this.pickAmount(entry),
                chainId: this.pickNumber(entry, ['chainId', 'chain_id']),
                adjudicator: this.pickAddress(entry, ['adjudicator']),
                createdAt: this.pickString(entry, ['createdAt', 'created_at']),
                updatedAt: this.pickString(entry, ['updatedAt', 'updated_at']),
                raw: entry,
            });
        });
        return channels;
    }
    pickString(record, keys) {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'string' && value.length > 0) {
                return value;
            }
        }
        return undefined;
    }
    pickNumber(record, keys) {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                return value;
            }
            if (typeof value === 'bigint') {
                return Number(value);
            }
        }
        return undefined;
    }
    pickAddress(record, keys) {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)) {
                return value;
            }
        }
        return undefined;
    }
    pickAmount(record) {
        const value = record.amount ?? record.balance ?? record.value;
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number') {
            return value.toString();
        }
        if (typeof value === 'bigint') {
            return value.toString();
        }
        return undefined;
    }
    isRecord(value) {
        return typeof value === 'object' && value !== null;
    }
    pickParticipantFromPayload(payload) {
        const target = this.extractNestedRecord(payload, ['participant', 'owner']);
        if (typeof target === 'string' && /^0x[a-fA-F0-9]{40}$/.test(target)) {
            return target;
        }
        return undefined;
    }
    pickRequestId(raw) {
        try {
            if (this.isRecord(raw)) {
                const req = this.extractTuple(raw, 'req');
                if (typeof req?.[0] === 'number') {
                    return req[0];
                }
                const res = this.extractTuple(raw, 'res');
                if (typeof res?.[0] === 'number') {
                    return res[0];
                }
                const requestId = getRequestId(raw);
                if (typeof requestId === 'number') {
                    return requestId;
                }
            }
        }
        catch {
            /* ignore */
        }
        return undefined;
    }
    extractTuple(record, key) {
        const value = record[key];
        if (Array.isArray(value)) {
            return value;
        }
        return undefined;
    }
    extractNestedRecord(payload, keys) {
        if (!payload)
            return undefined;
        if (Array.isArray(payload)) {
            for (const item of payload) {
                const match = this.extractNestedRecord(item, keys);
                if (match !== undefined) {
                    return match;
                }
            }
            return undefined;
        }
        if (!this.isRecord(payload)) {
            return undefined;
        }
        for (const key of keys) {
            const value = payload[key];
            if (value !== undefined) {
                return value;
            }
        }
        if (Array.isArray(payload.params)) {
            return this.extractNestedRecord(payload.params, keys);
        }
        if (Array.isArray(payload.result)) {
            return this.extractNestedRecord(payload.result, keys);
        }
        if (payload.params) {
            return this.extractNestedRecord(payload.params, keys);
        }
        if (payload.result) {
            return this.extractNestedRecord(payload.result, keys);
        }
        return undefined;
    }
    createAuthVerifyMessageSigner() {
        return async (payload) => {
            if (!this.pendingAuth) {
                throw new Error('Missing pending auth context for verification');
            }
            if (!Array.isArray(payload) || payload.length < 3) {
                throw new Error('Unexpected payload for auth_verify signature');
            }
            const method = payload[1];
            if (method !== RPCMethod.AuthVerify) {
                throw new Error(`Auth signer invoked for unexpected method ${String(method)}`);
            }
            const params = payload[2];
            const challenge = params?.challenge ?? params?.challengeMessage ?? params?.challenge_message;
            if (!challenge) {
                throw new Error('Missing challenge in auth_verify payload');
            }
            const message = {
                challenge,
                scope: this.pendingAuth.scope,
                wallet: this.walletAddress,
                application: this.pendingAuth.application,
                participant: this.pendingAuth.participant,
                expire: this.pendingAuth.expire,
                allowances: this.pendingAuth.allowances,
            };
            const domain = { name: this.config.applicationName };
            return this.wallet._signTypedData(domain, EIP712AuthTypes, message);
        };
    }
    scheduleReconnect() {
        if (!this.shouldReconnect) {
            return;
        }
        if (this.reconnectTimer) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect().catch((error) => {
                this.events.emit('nitrolite.reconnect.error', {
                    message: error instanceof Error ? error.message : String(error),
                });
            });
        }, this.config.reconnectDelayMs);
    }
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }
    cleanup() {
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket = undefined;
        }
        this.state = 'idle';
        this.connectPromise = undefined;
        this.resolveConnect = undefined;
        this.rejectConnect = undefined;
        this.pendingAuth = undefined;
    }
}
