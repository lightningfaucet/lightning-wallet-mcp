# Lightning Wallet

[![npm version](https://img.shields.io/npm/v/lightning-wallet-mcp.svg)](https://www.npmjs.com/package/lightning-wallet-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![lightning-wallet-mcp MCP server](https://glama.ai/mcp/servers/lightningfaucet/lightning-wallet-mcp/badges/score.svg)](https://glama.ai/mcp/servers/lightningfaucet/lightning-wallet-mcp)

**Give your AI agent a Bitcoin wallet.** MCP server + CLI. Works with Claude Code, OpenClaw, Cursor, and any agent framework.

> **Note:** This package was previously published as `lightning-faucet-mcp`. The functionality is identical.

## Free Sats Promotion

**First 100 installs get 100 free sats — one per person!**

1. `npm i -g lightning-wallet-mcp`
2. `lw register --name "YourAgent"`
3. `lw deposit 100`

We verify the invoice cryptographically and pay automatically. No trust required — the destination pubkey in the invoice proves it came from `lw`.

## What's New in v1.3

**v1.3.0** - L402 protocol v0 support per the latest Lightning Labs spec.

- **L402 Protocol v0** - Updated header format: `version="0", token=`, backward compatible with `macaroon=`
- **Endpoint Discovery** - `.well-known/l402.json` on lightningfaucet.com and certvera.com
- **Backward Compatible** - Handles both old and new L402 header formats from any service

## What's New in v1.1

**v1.1.0** - X402 protocol support (USDC on Base) as automatic fallback alongside L402 (Lightning).

- **X402 Support** - Automatic USDC payments on Base when L402 isn't available
- **Protocol Auto-Detection** - `pay_l402_api` seamlessly handles both L402 and X402
- **Webhooks** - Real-time notifications for payments and events
- **Keysend** - Send payments without invoices using node pubkeys
- **Invoice Decoding** - Decode BOLT11 invoices before paying
- **Agent Analytics** - Track spending patterns and usage
- **Transaction Export** - Export history in JSON or CSV format
- **Budget Management** - Get detailed budget status and set limits
- **Agent Lifecycle** - Deactivate, reactivate, and delete agents
- **Account Recovery** - Recover accounts and rotate API keys
- **Agent-to-Agent Transfers** - Move funds between your agents

## Why Lightning Wallet MCP?

- **Instant Payments** - Lightning Network transactions settle in milliseconds
- **L402 + X402 Protocol Support** - Access any paid API automatically (Lightning or USDC)
- **Operator/Agent Hierarchy** - Manage multiple agents with spending limits
- **No Custody Risk** - Each agent has isolated funds with operator oversight
- **Production Ready** - Battle-tested infrastructure powering real transactions
- **Webhook Notifications** - Get notified instantly when payments arrive
- **Full Observability** - Analytics, exports, and detailed status tracking

## Two Ways to Use

### CLI (Any Agent Framework)

For CLI-first agents (OpenClaw, Pi, KiloCode, or any agent with Bash access):

```bash
npm install -g lightning-wallet-mcp
```

This installs the `lw` command:

```bash
# Register and save your API key
export LIGHTNING_WALLET_API_KEY=$(lw register --name "My Bot" | jq -r '.api_key')

# Check balance
lw balance | jq '.balance_sats'

# Pay an L402 API
lw pay-api "https://lightningfaucet.com/api/l402/fortune"

# Create and fund an agent
lw create-agent "Research Bot" --budget 5000
lw fund-agent 1 1000

# Check identity
lw whoami
```

Output is JSON by default (pipe to `jq`). Use `--human` for readable output.

Run `lw help` for all commands.

### MCP Server (Claude Code, Cursor, Windsurf)

For MCP-native clients, configure as an MCP server:

**Option A: Self-Registration**

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

Then ask Claude: *"Register a new Lightning Wallet operator account"*

**Option B: Pre-configured API Key**

1. Get an API key at [lightningfaucet.com/ai-agents](https://lightningfaucet.com/ai-agents/)
2. Configure Claude Code (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "lightning-wallet": {
      "command": "npx",
      "args": ["lightning-wallet-mcp"],
      "env": {
        "LIGHTNING_WALLET_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Tools Reference

### Service Info

| Tool | Description |
|------|-------------|
| `get_info` | Get service status, version, and supported features |
| `decode_invoice` | Decode a BOLT11 invoice to see amount, destination, and expiry |

### Context & Identity

| Tool | Description |
|------|-------------|
| `whoami` | Get current context - shows if operating as operator or agent |
| `check_balance` | Check current Lightning balance in satoshis |
| `get_rate_limits` | Check current rate limit status and requests remaining |

### Payments (Agent Key Required)

| Tool | Description |
|------|-------------|
| `pay_l402_api` | Access paid APIs (L402/X402) - auto-detects protocol and pays |
| `pay_invoice` | Pay any BOLT11 Lightning invoice |
| `keysend` | Send payment directly to a node pubkey (no invoice needed) |
| `pay_lightning_address` | Pay to a Lightning address (user@domain.com format) |
| `create_invoice` | Generate invoice to receive payments |
| `get_invoice_status` | Check if an invoice has been paid |
| `get_transactions` | View transaction history |

### LNURL (Agent Key Required)

| Tool | Description |
|------|-------------|
| `lnurl_auth` | Authenticate to a service using LNURL-auth protocol |
| `claim_lnurl_withdraw` | Claim funds from an LNURL-withdraw link |

### Operator Management

| Tool | Description |
|------|-------------|
| `register_operator` | Create new operator account |
| `recover_account` | Recover account using recovery code |
| `rotate_api_key` | Generate a new API key (60-min cooldown on withdrawals) |
| `get_deposit_invoice` | Create invoice to fund operator account |
| `withdraw` | Withdraw funds to external Lightning destination |
| `set_operator_key` | Switch to operator credentials |

### Agent Management

| Tool | Description |
|------|-------------|
| `create_agent` | Create agent under operator |
| `list_agents` | List all agents under operator |
| `fund_agent` | Transfer sats from operator to agent |
| `transfer_to_agent` | Transfer sats between agents or from operator to agent |
| `sweep_agent` | Sweep funds from agent back to operator |
| `deactivate_agent` | Temporarily disable an agent |
| `reactivate_agent` | Re-enable a deactivated agent |
| `delete_agent` | Permanently delete an agent (returns balance to operator) |
| `get_budget_status` | Get agent's budget limit and spending |
| `set_budget` | Set or update agent's spending limit |
| `set_agent_credentials` | Switch to agent credentials |

### Webhooks

| Tool | Description |
|------|-------------|
| `register_webhook` | Register a URL to receive event notifications |
| `list_webhooks` | List all registered webhooks |
| `delete_webhook` | Delete a webhook |
| `test_webhook` | Send a test event to verify webhook connectivity |

**Webhook Events:**
- `invoice_paid` - Payment received on an invoice
- `payment_completed` - Outgoing payment succeeded
- `payment_failed` - Outgoing payment failed
- `balance_low` - Balance dropped below threshold
- `budget_warning` - 80% of budget consumed
- `test` - Manual test event

## CLI Reference

All commands output JSON to stdout. Errors go to stderr with exit code 1.

| Command | Description |
|---------|-------------|
| `lw register [--name "name"]` | Create operator account, prints API key |
| `lw whoami` | Current identity (operator or agent) |
| `lw balance` | Balance in satoshis |
| `lw info` | Service status and capabilities |
| `lw deposit <amount>` | Generate deposit invoice |
| `lw withdraw <invoice>` | Withdraw to external wallet |
| `lw pay <invoice>` | Pay BOLT11 invoice `[--max-fee <sats>]` |
| `lw pay-api <url>` | Pay L402/X402 API `[--method GET] [--body "{}"] [--max-sats 1000]` |
| `lw decode <invoice>` | Decode BOLT11 invoice |
| `lw create-agent <name>` | Create agent `[--budget <sats>]` |
| `lw fund-agent <id> <amount>` | Transfer sats to agent |
| `lw list-agents` | List all agents |
| `lw transactions` | Recent transactions `[--limit 10] [--offset 0]` |
| `lw help` | Show all commands |

### Agent Workflow Example (Bash)

```bash
# 1. Register (one-time)
export LIGHTNING_WALLET_API_KEY=$(lw register --name "My Agent" | jq -r '.api_key')

# 2. Fund the account (pay the invoice with any Lightning wallet)
lw deposit 10000 | jq -r '.bolt11'

# 3. Create an agent with a budget
AGENT=$(lw create-agent "Worker" --budget 5000)
AGENT_ID=$(echo $AGENT | jq -r '.agent_id')
AGENT_KEY=$(echo $AGENT | jq -r '.agent_api_key')

# 4. Fund the agent
lw fund-agent $AGENT_ID 2000

# 5. Switch to agent context and make payments
export LIGHTNING_WALLET_API_KEY=$AGENT_KEY
lw pay-api "https://api.example.com/data" --max-sats 100

# 6. Check what happened
lw transactions --limit 5
```

## Paid API Protocols: L402 + X402

Lightning Wallet MCP supports two HTTP 402 payment protocols:

- **L402 (primary)** - Lightning Network payments. The original pay-per-request protocol.
- **X402 (fallback)** - USDC on Base (Coinbase's protocol). Auto-detected when L402 isn't available.

When you call `pay_l402_api`, the server automatically detects which protocol the API uses. L402 always takes priority if both headers are present. Agents always pay in sats regardless of protocol — X402 amounts are converted at market rate.

### L402 Protocol

The L402 protocol (formerly LSAT) enables APIs to charge per-request using Lightning. When you call an L402-protected endpoint:

1. Server returns HTTP 402 with a Lightning invoice
2. Lightning Faucet pays the invoice automatically
3. Request completes with the paid content

### X402 Protocol (Coinbase)

X402 uses USDC on Base for API payments. The flow is transparent to agents:

1. Server returns HTTP 402 with `PAYMENT-REQUIRED` header
2. Lightning Faucet converts USDC amount to sats, debits agent balance
3. Signs an EIP-712 authorization and retries with `PAYMENT-SIGNATURE` header
4. Request completes — agent sees the same response format as L402

The response includes `payment_protocol: "x402"` and `usdc_amount` so agents know which protocol was used.

### L402 API Registry

We maintain a directory of L402-enabled APIs at **[lightningfaucet.com/l402-registry](https://lightningfaucet.com/l402-registry/)** - perfect for testing your agents.

### Demo L402 APIs

Try these endpoints to test L402 payments:

```
# Get a fortune (costs ~10-50 sats)
pay_l402_api({ url: "https://lightningfaucet.com/api/l402/fortune" })

# Get a joke (costs ~10-50 sats)
pay_l402_api({ url: "https://lightningfaucet.com/api/l402/joke" })

# Get an inspirational quote (costs ~10-50 sats)
pay_l402_api({ url: "https://lightningfaucet.com/api/l402/quote" })
```

See the [L402 API Registry](https://lightningfaucet.com/l402-registry/) for more endpoints and resources.

## Complete Workflow Example

```typescript
// 1. Register as operator (if no API key configured)
register_operator({ name: "My AI Company" })
// Returns: { api_key: "lf_abc...", recovery_code: "xyz...", operator_id: 123 }

// 2. Activate the operator key
set_operator_key({ api_key: "lf_abc..." })

// 3. Check who you are
whoami()
// Returns: { type: "operator", id: 123, name: "My AI Company", balance_sats: 0 }

// 4. Fund your operator account
get_deposit_invoice({ amount_sats: 10000 })
// Pay this invoice with any Lightning wallet

// 5. Create an agent with budget limit
create_agent({ name: "Research Assistant", budget_limit_sats: 5000 })
// Returns: { agent_id: 456, agent_api_key: "agent_def..." }

// 6. Fund the agent
fund_agent({ agent_id: 456, amount_sats: 1000 })

// 7. Set up a webhook for payment notifications
register_webhook({
  url: "https://your-server.com/webhooks/lightning",
  events: ["invoice_paid", "payment_completed"]
})
// Returns: { webhook_id: 1, secret: "..." }  <- Save this secret!

// 8. Switch to agent mode for payments
set_agent_credentials({ api_key: "agent_def..." })

// 9. Check budget status
get_budget_status()
// Returns: { budget_limit_sats: 5000, total_spent_sats: 0, remaining_sats: 5000 }

// 10. Make payments!
pay_l402_api({ url: "https://api.example.com/premium-data" })

```

## Keysend Payments

Send payments directly to a Lightning node without needing an invoice:

```typescript
// Send 100 sats to a node with an optional message
keysend({
  destination: "03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f",
  amount_sats: 100,
  message: "Hello from my AI agent!"
})
```

## Invoice Decoding

Check invoice details before paying:

```typescript
decode_invoice({ invoice: "lnbc1000n1..." })
// Returns: {
//   amount_sats: 1000,
//   description: "Test payment",
//   destination: "03abc...",
//   expires_at: "2026-01-16T12:00:00Z",
//   is_expired: false
// }
```

## Tool Details

### get_info

Get service status and capabilities.

```json
{
  "success": true,
  "version": "1.0.1",
  "api_version": "1.0",
  "status": "operational",
  "max_payment_sats": 1000000,
  "min_payment_sats": 1,
  "supported_features": ["l402", "x402", "webhooks", "lightning_address", "keysend"]
}
```

### whoami

Get current operating context.

**Returns for Operator:**
```json
{
  "type": "operator",
  "id": 123,
  "name": "My Company",
  "balance_sats": 50000,
  "agent_count": 3
}
```

**Returns for Agent:**
```json
{
  "type": "agent",
  "id": 456,
  "name": "Research Bot",
  "balance_sats": 1000,
  "budget_limit_sats": 5000,
  "operator_id": 123
}
```

### pay_l402_api

Access paid APIs with automatic payment. Supports both L402 (Lightning) and X402 (USDC on Base) protocols. Protocol is auto-detected from the 402 response headers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | The URL to request |
| method | string | No | HTTP method (GET, POST, PUT, DELETE). Default: GET |
| body | string | No | Request body for POST/PUT |
| max_payment_sats | number | No | Maximum payment amount. Default: 1000 |

### keysend

Send payment to a node without an invoice.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| destination | string | Yes | Target node public key (66 hex chars) |
| amount_sats | number | Yes | Amount in satoshis |
| message | string | No | Optional message (max 1000 chars) |

### register_webhook

Register a URL to receive payment notifications.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | HTTPS URL to receive webhooks |
| events | array | No | Event types to subscribe to. Default: ["invoice_paid"] |

**Returns:** Webhook ID and HMAC secret for signature verification.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OPERATOR                              │
│  • Holds main funds                                      │
│  • Creates and manages agents                            │
│  • Sets spending limits                                  │
│  • Receives webhook notifications                        │
│  • Can recover account with recovery code                │
├─────────────────────────────────────────────────────────┤
│     AGENT 1          AGENT 2          AGENT 3           │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐        │
│   │ 1000 sat│      │ 5000 sat│      │ 2500 sat│        │
│   │ Budget: │      │ Budget: │      │ Budget: │        │
│   │ 5000    │      │ 10000   │      │ Unlimited│        │
│   └─────────┘      └─────────┘      └─────────┘        │
│       │                │                │               │
│   L402 APIs        Keysend          Receive             │
│   Pay Invoice      Payments         Payments            │
└─────────────────────────────────────────────────────────┘
```

## Security Best Practices

- **Never commit API keys** - Use environment variables
- **Set budget limits** - Protect against runaway spending
- **Use agent keys for payments** - Keep operator key secure
- **Verify webhook signatures** - Use the secret returned during registration
- **Monitor transactions** - Use `get_transactions` to review activity
- **Recovery codes** - Store securely, needed if API key is lost
- **Key rotation** - Rotate keys periodically using `rotate_api_key`

## Webhook Security

Webhooks include HMAC-SHA256 signatures for verification:

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
```

Check the `X-Webhook-Signature` header against the payload.

## Pricing

Lightning Faucet charges a 2% platform fee (min 1 sat) on outgoing payments:
- **L402 payments:** 2% platform fee + Lightning routing fee
- **X402 payments:** 2% platform fee + 1% exchange rate spread (USDC to sats conversion)
- **Invoice payments:** 2% platform fee + Lightning routing fee
- **Keysend payments:** 2% platform fee + Lightning routing fee
- **Operator withdrawals:** 2% platform fee + Lightning routing fee
- **Cross-operator internal transfers:** 2% platform fee (no routing fee)
- **Same-operator agent transfers:** Free
- **Deposits:** Free
- **Receiving payments:** Free
- **Webhooks:** Free

All payment responses include `platform_fee_sats`, `routing_fee_sats`, and `total_cost` for full transparency.

## Changelog

### v1.1.0 (2026-02-16)
- **CLI interface:** New `lw` command for CLI-first agents (OpenClaw, Pi, KiloCode, any Bash agent)
- **Same package, two interfaces:** `npm install -g lightning-wallet-mcp` gives you both MCP server and CLI
- **JSON-first output:** All CLI commands output JSON to stdout, errors to stderr
- **X402 support:** Automatic fallback to X402 (USDC on Base) when L402 is not available
- **Protocol auto-detection:** `pay_l402_api` detects L402 or X402 from 402 response headers
- **Response fields:** `payment_protocol` and `usdc_amount` included when X402 is used
- **Exchange rate:** Real-time BTC/USD conversion via CoinGecko with 5-min cache

### v1.0.3 (2026-02-05)
- **Platform fee:** 2% fee (min 1 sat) on all outgoing payments and cross-operator transfers
- **Fee transparency:** All payment responses now include `platform_fee_sats`, `routing_fee_sats`, and `total_cost`
- Same-operator agent transfers remain free

### v1.0.0 (2026-02-04)
- **Rebranded** from `lightning-faucet-mcp` to `lightning-wallet-mcp`
- Environment variable renamed: `LIGHTNING_FAUCET_API_KEY` → `LIGHTNING_WALLET_API_KEY`
- All 37 tools fully tested and production-ready
- No breaking API changes - just the package name

### Previous releases (as lightning-faucet-mcp)

See the [lightning-faucet-mcp changelog](https://www.npmjs.com/package/lightning-faucet-mcp) for v1.6.0 through v2.0.7 history.
- Basic payments and invoices

## Showcase: AI Agent Game Theory Experiment

We ran a 100-round economic experiment with 16 AI agents (8 Claude, 8 GPT-4o) using real Bitcoin on Lightning. Agents could trade, form alliances, invest, and compete — all powered by this MCP server.

**Results:** Agents completed 2,839 real Lightning transactions. Claude agents dominated through aggressive early trading while GPT-4o agents adopted conservative strategies.

- **Experiment repo:** [github.com/pfergi42/lf-game-theory](https://github.com/pfergi42/lf-game-theory)
- **Blog post:** [lightningfaucet.com/blog/ai-game-theory](https://lightningfaucet.com/blog/ai-game-theory)

## Support

- **Documentation:** [lightningfaucet.com/ai-agents/docs](https://lightningfaucet.com/ai-agents/docs/)
- **Demo:** [lightningfaucet.com/ai-agents/demo](https://lightningfaucet.com/ai-agents/demo/)
- **Issues:** [github.com/lightningfaucet/lightning-wallet-mcp/issues](https://github.com/lightningfaucet/lightning-wallet-mcp/issues)
- **Email:** support@lightningfaucet.com

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Built with Bitcoin** | [Lightning Faucet](https://lightningfaucet.com)
