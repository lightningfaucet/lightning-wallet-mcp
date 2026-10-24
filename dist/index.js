#!/usr/bin/env node
"use strict";
/**
 * Lightning Wallet MCP Server
 *
 * Provides AI agents with Lightning Network payment capabilities via MCP.
 *
 * Configuration:
 *   Set LIGHTNING_WALLET_API_KEY environment variable with your agent API key.
 *   Get an API key at: https://lightningfaucet.com/ai-agents/
 *
 * Usage with Claude Code:
 *   claude mcp add lightning-wallet -- npx -y lightning-wallet-mcp
 *   (or add it to .mcp.json). No key needed up front: register_operator saves credentials to
 *   ~/.lightning-wallet/credentials.json and they are reused automatically in later sessions.
 *   LIGHTNING_WALLET_API_KEY, when set, always takes precedence over the saved file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const lightning_faucet_js_1 = require("./lightning-faucet.js");
const tools_js_1 = require("./tools.js");
const credentials_js_1 = require("./credentials.js");
/** stdio persists keys to ~/.lightning-wallet/credentials.json (unless disabled by env). */
const FILE_CREDENTIAL_STORE = {
    saveOperatorKey: credentials_js_1.saveOperatorKey,
    saveAgentKey: credentials_js_1.saveAgentKey,
    forgetCredentials: credentials_js_1.forgetCredentials,
    describeCredentials: credentials_js_1.describeCredentials,
    credentialsPath: credentials_js_1.credentialsPath,
};
// Package is built as CommonJS, so a plain require resolves ../package.json at runtime.
const PKG_VERSION = (() => {
    try {
        return require('../package.json').version;
    }
    catch {
        return '0.0.0';
    }
})();
/**
 * Session state manager for the MCP server.
 *
 * MCP sessions are single-client by design: one transport, one model, sequential
 * tool calls. A single client instance per session is the correct pattern here —
 * there is no concurrent access. The client can be swapped via set_operator_key
 * or set_agent_credentials tools when the model needs to switch contexts.
 */
class SessionState {
    client = null;
    /** Where the startup key came from; surfaced in whoami for debuggability. */
    keySource = 'none';
    constructor() {
        const apiKey = process.env.LIGHTNING_WALLET_API_KEY;
        if (apiKey) {
            this.client = new lightning_faucet_js_1.LightningFaucetClient(apiKey);
            this.keySource = 'env';
            return;
        }
        // No env key: fall back to credentials persisted by a previous session
        // (register_operator / set_operator_key / set_agent_credentials write them).
        const stored = (0, credentials_js_1.activeStoredKey)((0, credentials_js_1.loadCredentials)());
        if (stored) {
            this.client = new lightning_faucet_js_1.LightningFaucetClient(stored.api_key);
            this.keySource = 'file';
        }
    }
    getClient() {
        return this.client;
    }
    setClient(c) {
        this.client = c;
    }
    requireClient() {
        if (!this.client) {
            throw new Error('No API key configured. Call register_operator to create a wallet (credentials are saved for future sessions), or set_operator_key / set_agent_credentials with an existing key, or set the LIGHTNING_WALLET_API_KEY environment variable.');
        }
        return this.client;
    }
}
const session = new SessionState();
// Create MCP server
const server = new index_js_1.Server({
    name: 'lightning-wallet',
    version: PKG_VERSION,
}, {
    capabilities: {
        tools: {},
    },
});
// List available tools
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools: tools_js_1.TOOL_DEFINITIONS }));
// Handle tool calls
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return (0, tools_js_1.callTool)(name, args, { session, creds: FILE_CREDENTIAL_STORE });
});
// Start the server
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('Lightning Wallet MCP server running on stdio');
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
