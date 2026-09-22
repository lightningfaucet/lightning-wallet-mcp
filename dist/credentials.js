"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.credentialsDir = credentialsDir;
exports.credentialsPath = credentialsPath;
exports.persistenceDisabled = persistenceDisabled;
exports.loadCredentials = loadCredentials;
exports.activeStoredKey = activeStoredKey;
exports.saveOperatorKey = saveOperatorKey;
exports.saveAgentKey = saveAgentKey;
exports.setActive = setActive;
exports.forgetCredentials = forgetCredentials;
exports.describeCredentials = describeCredentials;
/**
 * On-disk credential persistence for lightning-wallet-mcp.
 *
 * Problem this solves: MCP hosts (Claude Code, Cursor, ...) restart the server every session.
 * Before 1.6.0 a self-registered operator key lived only in process memory, so the next
 * session had no key and the model re-registered from scratch (new operator, no balance).
 *
 * Storage: $LIGHTNING_WALLET_HOME/credentials.json (default ~/.lightning-wallet), mode 0600.
 * Precedence at startup: LIGHTNING_WALLET_API_KEY env var > credentials file > nothing.
 * Set LIGHTNING_WALLET_NO_PERSIST=1 to disable all disk writes.
 */
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
function credentialsDir() {
    return process.env.LIGHTNING_WALLET_HOME || path.join(os.homedir(), '.lightning-wallet');
}
function credentialsPath() {
    return path.join(credentialsDir(), 'credentials.json');
}
function persistenceDisabled() {
    const v = (process.env.LIGHTNING_WALLET_NO_PERSIST || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}
function loadCredentials() {
    try {
        const raw = fs.readFileSync(credentialsPath(), 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1)
            return null;
        if (parsed.active !== 'operator' && parsed.active !== 'agent')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/** The key that should be used at startup when no env var is set (null if none saved). */
function activeStoredKey(creds) {
    if (!creds)
        return null;
    const entry = creds.active === 'agent' ? creds.agent : creds.operator;
    if (entry?.api_key)
        return { api_key: entry.api_key, type: creds.active };
    // Fall back to whichever exists.
    if (creds.operator?.api_key)
        return { api_key: creds.operator.api_key, type: 'operator' };
    if (creds.agent?.api_key)
        return { api_key: creds.agent.api_key, type: 'agent' };
    return null;
}
function writeCredentials(creds) {
    if (persistenceDisabled())
        return null;
    const dir = credentialsDir();
    const file = credentialsPath();
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(tmp, file);
        try {
            fs.chmodSync(file, 0o600);
        }
        catch { /* best effort on non-POSIX */ }
        return file;
    }
    catch {
        return null;
    }
}
function base() {
    return loadCredentials() || { version: 1, active: 'operator' };
}
/**
 * Save (and activate) an operator key. Returns the file path written, or null if not persisted.
 * Metadata (id, name, recovery_code) already on file is kept when the key is unchanged, or when
 * `rotatedFrom` names the key that was just rotated AND that key is the one on file (so a
 * rotation of the env-var account never inherits another operator's recovery code from the
 * file). Any other key change is treated as a different account and starts clean.
 */
function saveOperatorKey(apiKey, extra = {}, opts = {}) {
    const creds = base();
    const storedKey = creds.operator?.api_key;
    const sameAccount = storedKey !== undefined && (storedKey === apiKey || (opts.rotatedFrom !== undefined && storedKey === opts.rotatedFrom));
    const prev = sameAccount ? creds.operator : undefined;
    creds.operator = {
        api_key: apiKey,
        id: extra.id ?? prev?.id,
        name: extra.name ?? prev?.name,
        recovery_code: extra.recovery_code ?? prev?.recovery_code,
        saved_at: new Date().toISOString(),
    };
    creds.active = 'operator';
    if (process.env.LIGHTNING_WALLET_API_URL)
        creds.api_url = process.env.LIGHTNING_WALLET_API_URL;
    return writeCredentials(creds);
}
/**
 * Save an agent key. Activates it only when `activate` is true (set_agent_credentials);
 * create_agent just records it. Metadata already on file is kept when the key is unchanged
 * (set_agent_credentials passes none), since the recorded id is what later lets rotate_api_key
 * recognise the saved key as the rotated agent's. A different key is a different agent and
 * starts clean.
 */
function saveAgentKey(apiKey, extra = {}, activate = false) {
    const creds = base();
    const prev = creds.agent?.api_key === apiKey ? creds.agent : undefined;
    creds.agent = { api_key: apiKey, id: extra.id ?? prev?.id, name: extra.name ?? prev?.name, saved_at: new Date().toISOString() };
    if (activate)
        creds.active = 'agent';
    return writeCredentials(creds);
}
/** Mark which stored key is active without changing the keys. */
function setActive(which) {
    const creds = base();
    creds.active = which;
    return writeCredentials(creds);
}
function forgetCredentials() {
    try {
        fs.unlinkSync(credentialsPath());
        return true;
    }
    catch {
        return false;
    }
}
/** Redacted view for status/whoami output. Never returns key material. */
function describeCredentials() {
    const creds = loadCredentials();
    return {
        path: credentialsPath(),
        exists: creds !== null,
        active: creds?.active,
        operator_id: creds?.operator?.id,
        agent_id: creds?.agent?.id,
        persistence: persistenceDisabled() ? 'disabled' : 'enabled',
    };
}
