#!/usr/bin/env node
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
export {};
