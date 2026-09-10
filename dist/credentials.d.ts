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
/** Save (and activate) an operator key. Returns the file path written, or null if not persisted. */
export declare function saveOperatorKey(apiKey: string, extra?: {
    id?: number;
    name?: string;
    recovery_code?: string;
}): string | null;
/** Save an agent key. Activates it only when `activate` is true (set_agent_credentials); create_agent just records it. */
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
