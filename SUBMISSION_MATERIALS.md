# MCP Registry Submission Materials

Use these details to submit Lightning Wallet MCP to various registries.

## Basic Info

- **Name**: lightning-wallet-mcp
- **Display Name**: Lightning Wallet - AI Agent Bitcoin Wallet
- **Version**: 1.0.0
- **Author/Vendor**: Lightning Faucet
- **License**: MIT

## URLs

- **npm**: https://www.npmjs.com/package/lightning-wallet-mcp
- **GitHub**: https://github.com/lightningfaucet/lightning-wallet-mcp
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
npx lightning-wallet-mcp
```

Or with npm:

```bash
npm install -g lightning-wallet-mcp
```

## Configuration (Claude Code)

```json
{
  "mcpServers": {
    "lightning-wallet": {
      "command": "npx",
      "args": ["lightning-wallet-mcp"]
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

## External Updates Required (Rebrand from lightning-faucet-mcp)

### Already Submitted (need updates)

1. **Official MCP Registry** - https://registry.modelcontextprotocol.io
   - Old: io.github.lightningfaucet/mcp-server
   - New: io.github.lightningfaucet/lightning-wallet-mcp
   - Action: Re-publish with new name

2. **npm** - https://www.npmjs.com/package/lightning-faucet-mcp
   - Action: Publish lightning-wallet-mcp, deprecate old package
   - Command: `npm deprecate lightning-faucet-mcp "Renamed to lightning-wallet-mcp"`

3. **GitHub** - https://github.com/lightningfaucet/mcp-server
   - Action: Rename repo to lightning-wallet-mcp
   - GitHub provides automatic redirects

4. **PulseMCP** - Submitted
   - Action: Contact to update listing

5. **MCP.so** - Submitted
   - Action: Contact to update listing

6. **Glama** - Submitted
   - Action: Contact to update listing

7. **LinkedIn** - Posted
   - Action: New post announcing rebrand

8. **lf-game-theory repo** - https://github.com/pfergi42/lf-game-theory
   - Action: Update references to new package name

### Website Updates (lightningfaucet.com)

- /ai-agents/ - Update package name in docs
- /ai-agents/docs/ - Update installation instructions
- Any blog posts mentioning the package

---

Generated: 2026-02-04
