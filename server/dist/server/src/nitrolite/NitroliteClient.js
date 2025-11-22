import { WebSocket } from 'ws';
import { ethers } from 'ethers';
import { createAuthVerifyMessageFromChallenge, createAuthVerifyMessageWithJWT, createECDSAMessageSigner, createAppSessionMessage, createGetChannelsMessage, createGetLedgerBalancesMessage, createPingMessage, getError, getMethod, getParams, getResult, getRequestId, RPCMethod, } from '@erc7824/nitrolite';
import { generateSessionKey, getStoredJWT, getStoredSessionKey, removeJWT, removeSessionKey, storeJWT, storeSessionKey, } from '../lib/utils';
import { normalizeLedgerBalancesPayload } from '../lib/asset_mgt';
import { AuthController } from './auth/AuthController';
import { logger } from './utils/logger';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_APP_SESSION_TIMEOUT_MS = 20_000;
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
    pendingAppSessionRequests = new Map();
    auth;
    sendMessage = (payload) => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not open');
        }
        this.socket.send(payload);
    };
    socket;
    state = 'idle';
    jwtToken;
    connectPromise;
    resolveConnect;
    rejectConnect;
    reconnectTimer;
    pingTimer;
    shouldReconnect = true;
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
        this.auth = AuthController.fromEnv({
            wallet: this.wallet,
            walletAddress: this.walletAddress,
            applicationAddress: this.applicationAddress,
            getSessionKey: () => this.sessionKey,
            events: this.events,
            env: {
                applicationName: this.config.applicationName,
                authScope: this.config.authScope,
                authTtlSeconds: this.config.authTtlSeconds,
            },
        });
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
        logger.ws(`Opening ClearNode connection to ${this.config.clearNodeUrl}`);
        this.events.emit('nitrolite.connection.initiated', {
            url: this.config.clearNodeUrl,
            address: this.walletAddress,
        });
        const socket = new WebSocket(this.config.clearNodeUrl);
        this.socket = socket;
        socket.on('open', () => {
            logger.ws('WebSocket connection established');
            this.events.emit('nitrolite.connection.open', { url: this.config.clearNodeUrl });
            this.authenticate();
        });
        socket.on('message', (data) => {
            void this.handleMessage(data.toString());
        });
        socket.on('error', (error) => {
            logger.error('WebSocket error', error);
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
            logger.ws(`WebSocket closed (${code}): ${closeReason}`);
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
                    logger.auth('Attempting JWT verification');
                    const verifyWithJwt = await createAuthVerifyMessageWithJWT(this.jwtToken);
                    this.socket.send(verifyWithJwt);
                    this.events.emit('nitrolite.auth.verify.jwt', {});
                    return;
                }
                catch (error) {
                    logger.warn('Stored JWT verification failed');
                    this.jwtToken = undefined;
                    removeJWT();
                    this.events.emit('nitrolite.auth.verify.jwt_failed', {
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            await this.auth.sendAuthRequest(this.sendMessage, 'initial');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('Authentication flow failed', error);
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
        const requestIdValue = getRequestId(parsed);
        const requestId = typeof requestIdValue === 'number' ? requestIdValue : undefined;
        if (error) {
            this.events.emit('nitrolite.rpc.error', error);
            if (requestId !== undefined) {
                this.rejectPendingAppSession(requestId, error.message ?? 'Nitrolite RPC error');
            }
        }
        if (!method) {
            this.events.emit('nitrolite.message.unknown', { raw: parsed });
            return;
        }
        const payload = parsed.req ? getParams(parsed) : getResult(parsed);
        const context = { method, payload, raw: parsed, requestId };
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
            case RPCMethod.CreateAppSession:
                this.handleCreateAppSession(context);
                break;
            case RPCMethod.AppSessionUpdate:
                this.handleAppSessionUpdate(context);
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
            logger.auth('Received auth challenge');
            if (!this.auth.hasPendingAuth()) {
                await this.auth.sendAuthRequest(this.sendMessage, 'retry');
            }
            const authVerify = await createAuthVerifyMessageFromChallenge(this.auth.createVerifySigner(), challengeMessage);
            this.sendMessage(authVerify);
            logger.auth('Sent auth_verify response');
            this.events.emit('nitrolite.auth.challenge', { challengeMessage });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('Failed to process auth challenge', error);
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
            logger.error('Nitrolite authentication failed', params);
            this.events.emit('nitrolite.auth.failed', params ?? {});
            removeJWT();
            removeSessionKey();
            this.auth.reset();
            if (this.rejectConnect) {
                this.rejectConnect(error);
                this.rejectConnect = undefined;
                this.resolveConnect = undefined;
            }
            this.cleanup();
            return;
        }
        const sessionKey = (params.sessionKey ?? params.session_key ?? this.sessionKey);
        this.sessionKey = sessionKey;
        this.jwtToken = params.jwtToken ?? params.jwt_token ?? this.jwtToken;
        this.state = 'authenticated';
        logger.success('Nitrolite authentication succeeded');
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
        this.auth.reset();
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
    handleCreateAppSession({ payload, requestId }) {
        const session = this.normalizeAppSessionPayload(payload);
        if (!session) {
            if (typeof requestId === 'number') {
                this.rejectPendingAppSession(requestId, 'Unable to parse application session response');
            }
            return;
        }
        if (typeof requestId === 'number') {
            const pending = this.pendingAppSessionRequests.get(requestId);
            if (pending) {
                this.pendingAppSessionRequests.delete(requestId);
                clearTimeout(pending.timer);
                pending.resolve(session);
            }
        }
        this.events.emit('nitrolite.app_session.created', {
            requestId,
            session,
        });
    }
    handleAppSessionUpdate({ payload, requestId }) {
        const session = this.normalizeAppSessionPayload(payload);
        if (!session) {
            return;
        }
        this.events.emit('nitrolite.app_session.updated', {
            requestId,
            session,
        });
    }
    handleGetLedgerBalances({ payload, requestId, raw }) {
        const resolvedRequestId = requestId ?? this.pickRequestId(raw);
        const pending = typeof resolvedRequestId === 'number' ? this.pendingLedgerRequests.get(resolvedRequestId) : undefined;
        const participant = pending?.participant ?? this.pickParticipantFromPayload(payload);
        if (typeof resolvedRequestId === 'number') {
            this.pendingLedgerRequests.delete(resolvedRequestId);
        }
        const balances = normalizeLedgerBalancesPayload(payload);
        this.events.emit('nitrolite.ledger.received', {
            participant,
            requestId: resolvedRequestId,
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
    async requestAppSession(params, timeoutMs = DEFAULT_APP_SESSION_TIMEOUT_MS) {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error('Nitrolite client not connected');
        }
        const message = await createAppSessionMessage(this.sessionMessageSigner, params);
        let requestId;
        try {
            const parsed = JSON.parse(message);
            if (Array.isArray(parsed?.req) && typeof parsed.req[0] === 'number') {
                requestId = parsed.req[0];
            }
        }
        catch (error) {
            this.events.emit('nitrolite.app_session.error', {
                context: 'parse_request_id',
                message: error instanceof Error ? error.message : String(error),
            });
        }
        if (typeof requestId !== 'number') {
            throw new Error('Unable to determine request id for app session request');
        }
        return await new Promise((resolve, reject) => {
            if (this.pendingAppSessionRequests.has(requestId)) {
                reject(new Error(`App session request already pending for id ${requestId}`));
                return;
            }
            const timer = setTimeout(() => {
                this.events.emit('nitrolite.app_session.timeout', { requestId, timeoutMs });
                this.rejectPendingAppSession(requestId, new Error(`Timeout waiting for app session response (request ${requestId})`));
            }, timeoutMs);
            this.pendingAppSessionRequests.set(requestId, {
                resolve: (session) => {
                    clearTimeout(timer);
                    resolve(session);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
                timer,
            });
            try {
                socket.send(message);
                this.events.emit('nitrolite.app_session.requested', { requestId, params });
            }
            catch (error) {
                const wrapped = error instanceof Error ? error : new Error(String(error));
                this.events.emit('nitrolite.app_session.error', {
                    requestId,
                    message: wrapped.message,
                });
                this.rejectPendingAppSession(requestId, wrapped);
            }
        });
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
    rejectPendingAppSession(requestId, reason) {
        const pending = this.pendingAppSessionRequests.get(requestId);
        if (!pending) {
            return;
        }
        this.pendingAppSessionRequests.delete(requestId);
        clearTimeout(pending.timer);
        const error = reason instanceof Error ? reason : new Error(reason);
        pending.reject(error);
        this.events.emit('nitrolite.app_session.rejected', {
            requestId,
            message: error.message,
        });
    }
    extractTuple(record, key) {
        const value = record[key];
        if (Array.isArray(value)) {
            return value;
        }
        return undefined;
    }
    normalizeAppSessionPayload(payload) {
        const record = this.findAppSessionRecord(this.unwrapPayload(payload));
        if (!record) {
            this.events.emit('nitrolite.app_session.unparsed', { payload });
            return undefined;
        }
        const appSessionId = this.pickString(record, ['appSessionId', 'app_session_id', 'sessionId', 'session_id', 'id']);
        if (!appSessionId) {
            this.events.emit('nitrolite.app_session.unparsed', { payload: record });
            return undefined;
        }
        const participants = this.pickAddressArray(record, ['participants', 'partyAddresses']);
        const weights = this.pickNumberArray(record, ['weights']);
        const allocations = this.extractAppSessionAllocations(record);
        return {
            appSessionId,
            status: this.pickString(record, ['status']),
            version: this.pickNumber(record, ['version']),
            participants,
            weights,
            quorum: this.pickNumber(record, ['quorum']),
            challenge: this.pickNumber(record, ['challenge']),
            nonce: this.pickNumber(record, ['nonce']),
            protocol: this.pickString(record, ['protocol']),
            sessionData: this.pickString(record, ['sessionData', 'session_data']),
            createdAt: this.pickString(record, ['createdAt', 'created_at']),
            updatedAt: this.pickString(record, ['updatedAt', 'updated_at']),
            allocations,
            raw: record,
        };
    }
    findAppSessionRecord(payload) {
        if (!payload) {
            return undefined;
        }
        if (Array.isArray(payload)) {
            for (const item of payload) {
                const result = this.findAppSessionRecord(item);
                if (result) {
                    return result;
                }
            }
            return undefined;
        }
        if (!this.isRecord(payload)) {
            return undefined;
        }
        if (this.isAppSessionRecord(payload)) {
            return payload;
        }
        const nestedKeys = [
            'appSession',
            'app_session',
            'session',
            'sessions',
            'appSessions',
            'items',
            'params',
            'result',
            'data',
            'payload',
        ];
        for (const key of nestedKeys) {
            if (payload[key] !== undefined) {
                const result = this.findAppSessionRecord(payload[key]);
                if (result) {
                    return result;
                }
            }
        }
        for (const value of Object.values(payload)) {
            if (value !== undefined) {
                const result = this.findAppSessionRecord(value);
                if (result) {
                    return result;
                }
            }
        }
        return undefined;
    }
    isAppSessionRecord(record) {
        return (typeof record.appSessionId === 'string' ||
            typeof record.app_session_id === 'string' ||
            typeof record.sessionId === 'string' ||
            typeof record.session_id === 'string');
    }
    pickAddressArray(record, keys) {
        for (const key of keys) {
            const value = record[key];
            if (Array.isArray(value) && value.length > 0) {
                const addresses = [];
                let valid = true;
                for (const entry of value) {
                    if (typeof entry === 'string' && /^0x[a-fA-F0-9]{40}$/.test(entry)) {
                        addresses.push(entry);
                    }
                    else {
                        valid = false;
                        break;
                    }
                }
                if (valid) {
                    return addresses;
                }
            }
        }
        return undefined;
    }
    pickNumberArray(record, keys) {
        for (const key of keys) {
            const value = record[key];
            if (Array.isArray(value) && value.length > 0) {
                const numbers = [];
                let valid = true;
                for (const entry of value) {
                    if (typeof entry === 'number' && Number.isFinite(entry)) {
                        numbers.push(entry);
                    }
                    else if (typeof entry === 'string' && entry.length > 0 && !Number.isNaN(Number(entry))) {
                        numbers.push(Number(entry));
                    }
                    else if (typeof entry === 'bigint') {
                        numbers.push(Number(entry));
                    }
                    else {
                        valid = false;
                        break;
                    }
                }
                if (valid) {
                    return numbers;
                }
            }
        }
        return undefined;
    }
    extractAppSessionAllocations(record) {
        const candidates = [record['allocations'], record['sessionAllocations'], record['session_allocation']];
        for (const candidate of candidates) {
            if (!Array.isArray(candidate) || candidate.length === 0) {
                continue;
            }
            const allocations = [];
            for (const entry of candidate) {
                if (!this.isRecord(entry)) {
                    continue;
                }
                const participant = this.pickAddress(entry, ['participant', 'address', 'destination']);
                const asset = this.pickString(entry, ['asset', 'token']);
                const amount = this.pickAmount(entry);
                if (participant && asset && amount) {
                    allocations.push({ participant, asset, amount });
                }
                else {
                    this.events.emit('nitrolite.app_session.allocations.unparsed', { entry });
                }
            }
            if (allocations.length > 0) {
                return allocations;
            }
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
        this.auth.reset();
    }
}
