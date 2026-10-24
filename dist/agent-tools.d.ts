import { z } from 'zod';
import { LightningFaucetClient } from './lightning-faucet.js';
type ToolDef = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
};
type Session = {
    getClient(): LightningFaucetClient | null;
    requireClient(): LightningFaucetClient;
};
type ToolResult = {
    content: {
        type: 'text';
        text: string;
    }[];
    isError?: boolean;
};
declare const VerifyFairSchema: z.ZodObject<{
    server_seed: z.ZodString;
    client_seed: z.ZodString;
    nonce: z.ZodNumber;
    server_seed_hash: z.ZodOptional<z.ZodString>;
    claimed_result: z.ZodOptional<z.ZodNumber>;
    result_type: z.ZodOptional<z.ZodEnum<["dice", "roll"]>>;
}, "strip", z.ZodTypeAny, {
    client_seed: string;
    server_seed: string;
    nonce: number;
    server_seed_hash?: string | undefined;
    claimed_result?: number | undefined;
    result_type?: "dice" | "roll" | undefined;
}, {
    client_seed: string;
    server_seed: string;
    nonce: number;
    server_seed_hash?: string | undefined;
    claimed_result?: number | undefined;
    result_type?: "dice" | "roll" | undefined;
}>;
export declare const AGENT_TOOLS: ToolDef[];
export declare const AGENT_TOOL_NAMES: Set<string>;
/** Pure, exported for tests. */
export declare function verifyFair(p: z.infer<typeof VerifyFairSchema>): Record<string, unknown>;
/** Returns a result for tools owned by this module, or null so the caller continues. */
export declare function handleAgentTool(name: string, args: unknown, session: Session): Promise<ToolResult | null>;
export {};
