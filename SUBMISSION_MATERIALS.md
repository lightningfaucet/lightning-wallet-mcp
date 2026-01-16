# MCP Registry Submission Materials

Use these details to submit Lightning Faucet MCP to various registries.

## Basic Info

- **Name**: lightning-faucet-mcp
- **Display Name**: Lightning Faucet - AI Agent Bitcoin Wallet
- **Version**: 2.0.2
- **Author/Vendor**: Lightning Faucet
- **License**: MIT

## URLs

- **npm**: https://www.npmjs.com/package/lightning-faucet-mcp
- **GitHub**: https://github.com/lightningfaucet/mcp-server
- **Homepage**: https://lightningfaucet.com/ai-agents/
- **Documentation**: https://lightningfaucet.com/ai-agents/docs/

## Description (Short - 160 chars)

Give your AI agent a Bitcoin wallet. Send and receive Bitcoin via Lightning Network with L402 protocol support, webhooks, and budget management.

## Description (Medium - 280 chars)

Give your AI agent a Bitcoin wallet. This MCP server enables AI agents to send and receive Bitcoin via the Lightning Network. Features L402 protocol support, webhooks, keysend payments, budget enforcement, transaction analytics, and 31 tools for complete wallet autonomy.

## Description (Full)

**Give your AI agent a Bitcoin wallet.** This MCP server enables AI agents to send and receive Bitcoin via the Lightning Network - the first step toward true AI economic autonomy.

### Key Features

- **L402 Protocol Support** - Access any L402-protected API with automatic payment
- **31 Tools** - Complete wallet management, payments, webhooks, and analytics
- **Operator/Agent Hierarchy** - Manage multiple agents with spending limits
- **Self-Registration** - Agents can register themselves without pre-configuration
- **Webhooks** - Real-time notifications for payments and events
- **Keysend** - Send payments without invoices using node pubkeys
- **Budget Management** - Set and enforce spending limits per agent
- **Transaction Export** - JSON and CSV export for accounting

### Use Cases

- AI agents paying for API access (L402 protocol)
- Autonomous trading and payments
- Multi-agent systems with budget controls
- Receiving payments for AI-generated services
- Micropayments for AI compute resources

## Installation

```bash
npx lightning-faucet-mcp
```

Or with npm:

```bash
npm install -g lightning-faucet-mcp
```

## Configuration (Claude Code)

```json
{
  "mcpServers": {
    "lightning-faucet": {
      "command": "npx",
      "args": ["lightning-faucet-mcp"]
    }
  }
}
```

## Categories/Tags

- finance
- payments
- bitcoin
- cryptocurrency
- lightning-network
- l402
- wallet
- ai-agent
- webhooks
- api

## Tools (31 total)

### Service Info
- get_info
- decode_invoice

### Context & Identity
- whoami
- check_balance
- get_rate_limits

### Payments
- pay_l402_api
- pay_invoice
- keysend
- create_invoice
- get_invoice_status
- get_transactions
- export_transactions

### Operator Management
- register_operator
- recover_account
- rotate_api_key
- get_deposit_invoice
- withdraw
- set_operator_key

### Agent Management
- create_agent
- list_agents
- fund_agent
- transfer_to_agent
- transfer_between_agents
- withdraw_from_agent
- deactivate_agent
- reactivate_agent
- delete_agent
- get_budget_status
- set_budget
- get_agent_analytics
- set_agent_credentials

### Webhooks
- register_webhook
- list_webhooks
- delete_webhook
- test_webhook

---

## Registry-Specific Submissions

### 1. Official MCP Registry (modelcontextprotocol.io)

**Status**: Requires publisher CLI tool
**URL**: https://registry.modelcontextprotocol.io
**Process**: Use `mcp-publisher` CLI with GitHub OAuth

### 2. PulseMCP

**Status**: Ready for submission
**URL**: https://www.pulsemcp.com/submit
**Type**: MCP Server
**URL to submit**: https://github.com/lightningfaucet/mcp-server

### 3. MCP.so

**Status**: Ready for submission
**URL**: https://mcp.so/submit
**Type**: MCP Server
**Name**: Lightning Faucet MCP
**URL to submit**: https://github.com/lightningfaucet/mcp-server

### 4. Glama

**Status**: Ready for submission
**URL**: https://glama.ai/mcp/servers
**Process**: Look for "Add Server" button

### 5. Smithery.ai

**Status**: Requires CLI setup
**URL**: https://smithery.ai
**Process**: Fork reference servers repo, use `smithery publish`

### 6. mcp-get

**Status**: PR prepared (but deprecated in favor of Smithery)
**URL**: https://github.com/michaellatman/mcp-get
**File**: packages/lightning-faucet-mcp.json

### 7. GitHub MCP Registry

**Status**: Check submission process
**URL**: https://github.com/mcp

---

Generated: 2026-01-16
