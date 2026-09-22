export interface StoredKey {
    api_key: string;
    id?: number;
    name?: string;
    saved_at: string;
}
export interface CredentialsFile {
    version: 1;
    api_url?: string;
    active: 'operator' | 'agent';
    operator?: StoredKey & {
        recovery_code?: string;
    };
    agent?: StoredKey;
}
export declare function credentialsDir(): string;
export declare function credentialsPath(): string;
export declare function persistenceDisabled(): boolean;
export declare function loadCredentials(): CredentialsFile | null;
/** The key that should be used at startup when no env var is set (null if none saved). */
export declare function activeStoredKey(creds: CredentialsFile | null): {
    api_key: string;
    type: 'operator' | 'agent';
} | null;
/**
 * Save (and activate) an operator key. Returns the file path written, or null if not persisted.
 * Metadata (id, name, recovery_code) already on file is kept when the key is unchanged, or when
 * `rotatedFrom` names the key that was just rotated AND that key is the one on file (so a
 * rotation of the env-var account never inherits another operator's recovery code from the
 * file). Any other key change is treated as a different account and starts clean.
 */
export declare function saveOperatorKey(apiKey: string, extra?: {
    id?: number;
    name?: string;
    recovery_code?: string;
}, opts?: {
    rotatedFrom?: string;
}): string | null;
/**
 * Save an agent key. Activates it only when `activate` is true (set_agent_credentials);
 * create_agent just records it. Metadata already on file is kept when the key is unchanged
 * (set_agent_credentials passes none), since the recorded id is what later lets rotate_api_key
 * recognise the saved key as the rotated agent's. A different key is a different agent and
 * starts clean.
 */
export declare function saveAgentKey(apiKey: string, extra?: {
    id?: number;
    name?: string;
}, activate?: boolean): string | null;
/** Mark which stored key is active without changing the keys. */
export declare function setActive(which: 'operator' | 'agent'): string | null;
export declare function forgetCredentials(): boolean;
/** Redacted view for status/whoami output. Never returns key material. */
export declare function describeCredentials(): {
    path: string;
    exists: boolean;
    active?: string;
    operator_id?: number;
    agent_id?: number;
    persistence: 'enabled' | 'disabled';
};
