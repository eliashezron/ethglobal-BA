import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const SESSION_KEY_STORAGE = 'nexus_session_key';
const JWT_KEY = 'nexus_jwt_token';
const localStorageRef = typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined'
    ? globalThis.localStorage
    : undefined;
const storageFilePath = process.env.CLEARNODE_SESSION_STORE
    ? path.resolve(process.env.CLEARNODE_SESSION_STORE)
    : path.join(process.cwd(), '.clearnode-session.json');
function readFileStore() {
    if (!existsSync(storageFilePath)) {
        return {};
    }
    try {
        const raw = readFileSync(storageFilePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
function writeFileStore(data) {
    try {
        const dir = path.dirname(storageFilePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(storageFilePath, JSON.stringify(data, null, 2), 'utf-8');
    }
    catch {
        // Swallow file persistence errors and continue without caching.
    }
}
export const generateSessionKey = () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return { privateKey, address: account.address };
};
export const getStoredSessionKey = () => {
    if (localStorageRef) {
        try {
            const stored = localStorageRef.getItem(SESSION_KEY_STORAGE);
            return stored ? JSON.parse(stored) : null;
        }
        catch {
            return null;
        }
    }
    const persisted = readFileStore();
    return persisted.sessionKey ?? null;
};
export const storeSessionKey = (sessionKey) => {
    if (localStorageRef) {
        try {
            localStorageRef.setItem(SESSION_KEY_STORAGE, JSON.stringify(sessionKey));
        }
        catch {
            // Ignore storage errors in browser context.
        }
        return;
    }
    const persisted = readFileStore();
    writeFileStore({ ...persisted, sessionKey });
};
export const removeSessionKey = () => {
    if (localStorageRef) {
        try {
            localStorageRef.removeItem(SESSION_KEY_STORAGE);
        }
        catch {
            // Ignore storage errors in browser context.
        }
        return;
    }
    const persisted = readFileStore();
    if (persisted.sessionKey || persisted.jwt) {
        delete persisted.sessionKey;
        writeFileStore(persisted.jwt ? { jwt: persisted.jwt } : {});
    }
};
export const getStoredJWT = () => {
    if (localStorageRef) {
        try {
            return localStorageRef.getItem(JWT_KEY);
        }
        catch {
            return null;
        }
    }
    const persisted = readFileStore();
    return persisted.jwt ?? null;
};
export const storeJWT = (token) => {
    if (localStorageRef) {
        try {
            localStorageRef.setItem(JWT_KEY, token);
        }
        catch {
            // Ignore storage errors in browser context.
        }
        return;
    }
    const persisted = readFileStore();
    writeFileStore({ ...persisted, jwt: token });
};
export const removeJWT = () => {
    if (localStorageRef) {
        try {
            localStorageRef.removeItem(JWT_KEY);
        }
        catch {
            // Ignore storage errors in browser context.
        }
        return;
    }
    const persisted = readFileStore();
    if (persisted.sessionKey || persisted.jwt) {
        delete persisted.jwt;
        writeFileStore(persisted.sessionKey ? { sessionKey: persisted.sessionKey } : {});
    }
};
