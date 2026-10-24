import { LightningFaucetClient } from './lightning-faucet.js';
/** The caller's credentials for one tool call. stdio keeps one for the process; HTTP builds one per request. */
export interface ToolSession {
    keySource: 'env' | 'file' | 'none' | 'header';
    getClient(): LightningFaucetClient | null;
    setClient(c: LightningFaucetClient | null): void;
    requireClient(): LightningFaucetClient;
}
/** Where tools may persist keys. stdio uses ~/.lightning-wallet; the remote server persists nothing. */
export interface CredentialStore {
    saveOperatorKey(apiKey: string, extra?: {
        id?: number;
        name?: string;
        recovery_code?: string;
    }, opts?: {
        rotatedFrom?: string;
    }): string | null;
    saveAgentKey(apiKey: string, extra?: {
        id?: number;
        name?: string;
    }, activate?: boolean): string | null;
    forgetCredentials(): boolean;
    describeCredentials(): Record<string, unknown>;
    credentialsPath(): string;
}
export type ToolResult = {
    content: {
        type: 'text';
        text: string;
    }[];
    isError?: boolean;
};
/**
 * Sanitize error messages before returning them to the client.
 * Strips internal details like HTTP status lines, server paths, and stack traces.
 */
export declare function sanitizeErrorMessage(message: string): string;
/** Every tool this server exposes, in list order. */
export declare const TOOL_DEFINITIONS: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}[];
/** Run one tool call. Errors are returned as tool results, never thrown. */
export declare function callTool(name: string, args: unknown, ctx: {
    session: ToolSession;
    creds: CredentialStore;
}): Promise<ToolResult>;
