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
 *   Add to .claude/settings.json mcpServers with command "npx lightning-wallet-mcp"
 *   and set LIGHTNING_WALLET_API_KEY in the env block.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { LightningFaucetClient, registerOperator, getPublicInfo } from './lightning-faucet.js';

/**
 * Session state manager for the MCP server.
 *
 * MCP sessions are single-client by design: one transport, one model, sequential
 * tool calls. A single client instance per session is the correct pattern here —
 * there is no concurrent access. The client can be swapped via set_operator_key
 * or set_agent_credentials tools when the model needs to switch contexts.
 */
class SessionState {
  private client: LightningFaucetClient | null = null;

  constructor() {
    const apiKey = process.env.LIGHTNING_WALLET_API_KEY;
    if (apiKey) {
      this.client = new LightningFaucetClient(apiKey);
    }
  }

  getClient(): LightningFaucetClient | null {
    return this.client;
  }

  setClient(c: LightningFaucetClient | null): void {
    this.client = c;
  }

  requireClient(): LightningFaucetClient {
    if (!this.client) {
      throw new Error('No API key configured. Use set_operator_key or set_agent_credentials first, or set LIGHTNING_WALLET_API_KEY environment variable.');
    }
    return this.client;
  }
}

const session = new SessionState();

/**
 * Sanitize error messages before returning them to the client.
 * Strips internal details like HTTP status lines, server paths, and stack traces.
 */
function sanitizeErrorMessage(message: string): string {
  // Strip HTTP status code prefixes (e.g., "HTTP error: 500 Internal Server Error")
  message = message.replace(/^HTTP error:\s*\d{3}\s*/i, '');
  // Strip file paths
  message = message.replace(/\/[^\s:]+\.(js|ts|php|py)\b/g, '[internal]');
  // Strip stack traces
  message = message.replace(/\s+at\s+.+/g, '');
  // Truncate overly long messages (backend may dump verbose errors)
  if (message.length > 300) {
    message = message.substring(0, 300) + '...';
  }
  return message.trim() || 'An error occurred';
}

// Create MCP server
const server = new Server(
  {
    name: 'lightning-wallet',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool schemas
const CheckBalanceSchema = z.object({});

const PayL402ApiSchema = z.object({
  url: z.string().describe('The URL to request'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET').describe('HTTP method'),
  body: z.string().optional().describe('Request body for POST/PUT requests'),
  max_payment_sats: z.number().min(1).max(100000).default(1000)
    .describe('Maximum amount in satoshis to pay for this request'),
});

const PayInvoiceSchema = z.object({
  bolt11: z.string().regex(/^ln(bc|tb|bcrt)1[a-z0-9]+$/i, 'Invalid BOLT11 invoice format')
    .describe('BOLT11 invoice string to pay (starts with lnbc...)'),
  max_fee_sats: z.number().min(0).optional()
    .describe('Maximum routing fee in satoshis (default: 10% of invoice amount)'),
});

const CreateInvoiceSchema = z.object({
  amount_sats: z.number().int().min(1).max(10_000_000).describe('Amount in satoshis to request'),
  memo: z.string().max(640).optional().describe('Description/memo for the invoice'),
});

const GetInvoiceStatusSchema = z.object({
  payment_hash: z.string().describe('Payment hash of the invoice to check'),
});

const GetTransactionsSchema = z.object({
  limit: z.number().min(1).max(200).default(50).describe('Max transactions to return'),
  offset: z.number().min(0).default(0).describe('Number to skip for pagination'),
});

// Operator management schemas
const RegisterOperatorSchema = z.object({
  name: z.string().optional().describe('Name for the operator account'),
  email: z.string().email().optional().describe('Your email — register WITH it to claim the 100 free-sats install promo. A verification link is sent; once verified, claim_promo funds your wallet. Strongly recommended.'),
});

const GetDepositInvoiceSchema = z.object({
  amount_sats: z.number().int().min(100).max(10_000_000).describe('Amount in satoshis to deposit'),
});

const CreateAgentSchema = z.object({
  name: z.string().describe('Name for the agent'),
  description: z.string().optional().describe('Optional description'),
  budget_limit_sats: z.number().min(0).optional().describe('Optional spending limit in sats'),
});

const FundAgentSchema = z.object({
  agent_id: z.number().int().positive().describe('ID of the agent to fund'),
  amount_sats: z.number().int().min(1).max(10_000_000).describe('Amount in satoshis to transfer'),
});

const ListAgentsSchema = z.object({});

const UpdateOperatorSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(100).optional(),
});

const ClaimPromoSchema = z.object({
  promo_code: z.string().optional(),
});

const SetOperatorKeySchema = z.object({
  api_key: z.string().min(10, 'API key is too short').max(200, 'API key is too long')
    .describe('The operator API key to use for subsequent requests'),
});

const SetAgentCredentialsSchema = z.object({
  api_key: z.string().min(10, 'API key is too short').max(200, 'API key is too long')
    .describe('The agent API key to use for subsequent requests'),
});

const WhoamiSchema = z.object({});

// ==========================================
// NEW TIER 1 SCHEMAS - Webhooks, Budget, Lifecycle, Recovery
// ==========================================

const RegisterWebhookSchema = z.object({
  url: z.string().url().describe('HTTPS webhook URL to receive events'),
  events: z.array(z.enum(['invoice_paid', 'payment_completed', 'payment_failed', 'withdrawal_completed', 'balance_changed', 'balance_low', 'budget_warning', 'test']))
    .default(['invoice_paid']).describe('Event types to subscribe to'),
});

const ListWebhooksSchema = z.object({});

const DeleteWebhookSchema = z.object({
  webhook_id: z.number().int().positive().describe('ID of the webhook to delete'),
});

const TestWebhookSchema = z.object({
  webhook_id: z.number().int().positive().describe('ID of the webhook to test'),
});

const GetBudgetStatusSchema = z.object({
  agent_id: z.number().int().positive().optional().describe('Agent ID (operators only, defaults to current agent)'),
});

const SetBudgetSchema = z.object({
  agent_id: z.number().int().positive().describe('Agent ID to update'),
  budget_limit_sats: z.number().int().min(0).describe('New budget limit in sats (0 for unlimited)'),
});

const DeactivateAgentSchema = z.object({
  agent_id: z.number().int().positive().describe('Agent ID to deactivate'),
});

const ReactivateAgentSchema = z.object({
  agent_id: z.number().int().positive().describe('Agent ID to reactivate'),
});

const RecoverAccountSchema = z.object({
  recovery_code: z.string().min(16, 'Recovery code is too short').max(64, 'Recovery code is too long')
    .describe('Recovery code received during registration'),
});

const RotateApiKeySchema = z.object({
  agent_id: z.number().int().positive().optional().describe('Agent ID (operators only). If omitted, rotates operator key.'),
});

// Tier 2 schemas
const GetInfoSchema = z.object({});

const DecodeInvoiceSchema = z.object({
  bolt11: z.string().regex(/^ln(bc|tb|bcrt)1[a-z0-9]+$/i, 'Invalid BOLT11 invoice format')
    .describe('BOLT11 invoice string to decode'),
});

const GetRateLimitsSchema = z.object({});

// Tier 3 schemas
const WithdrawSchema = z.object({
  invoice: z.string().regex(/^ln(bc|tb|bcrt)1[a-z0-9]+$/i, 'Invalid BOLT11 invoice format')
    .describe('BOLT11 invoice to pay out to'),
});

const SweepAgentSchema = z.object({
  agent_id: z.number().int().positive().describe('Agent ID to sweep funds from'),
  amount_sats: z.union([z.number().int().positive(), z.literal('all')]).describe('Amount in sats or "all" for full balance'),
});

const PayLightningAddressSchema = z.object({
  address: z.string().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid Lightning address format (expected user@domain)')
    .describe('Lightning address (user@domain.com format)'),
  amount_sats: z.number().int().positive().max(10_000_000).describe('Amount in satoshis to send'),
  comment: z.string().max(144).optional().describe('Optional payment comment'),
});

const SetNostrIdentitySchema = z.object({
  private_key: z.string().length(64).describe('64-character hex Nostr private key (nsec decoded to hex)'),
});

const GetNostrIdentitySchema = z.object({});

const NostrZapSchema = z.object({
  address: z.string().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid Lightning address format')
    .describe('Lightning address to zap (user@domain.com format)'),
  amount_sats: z.number().int().positive().describe('Amount in satoshis to zap'),
  recipient_pubkey: z.string().regex(/^[0-9a-f]{64}$/, 'Must be 64-character hex pubkey').optional()
    .describe('Nostr hex pubkey of the recipient (for NIP-57 zap receipt)'),
  content: z.string().max(500).optional().describe('Optional zap comment/message'),
  event_id: z.string().regex(/^[0-9a-f]{64}$/, 'Must be 64-character hex event ID').optional()
    .describe('Nostr event ID to attach the zap to (hex format)'),
  relays: z.array(z.string().url()).optional().describe('Nostr relay URLs for zap receipt publication'),
});

// Tier 4 schemas
const TransferToAgentSchema = z.object({
  from_agent_id: z.number().int().positive().optional().describe('Source agent ID (optional, defaults to operator balance)'),
  to_agent_id: z.number().int().positive().describe('Destination agent ID'),
  amount_sats: z.number().int().positive().describe('Amount to transfer'),
});

const DeleteAgentSchema = z.object({
  agent_id: z.number().int().positive().describe('Agent ID to permanently delete'),
  confirm: z.boolean().describe('Must be true to confirm deletion'),
});

// Tier 5 schemas
const LnurlAuthSchema = z.object({
  lnurl: z.string().min(1, 'LNURL string is required').describe('LNURL-auth string to authenticate with'),
});

const ClaimLnurlWithdrawSchema = z.object({
  lnurl: z.string().min(1, 'LNURL string is required').describe('LNURL-withdraw string to claim from'),
});

const KeysendSchema = z.object({
  destination: z.string().regex(/^[0-9a-f]{66}$/, 'Must be 66-character hex public key')
    .describe('Destination node public key'),
  amount_sats: z.number().int().positive().describe('Amount in satoshis'),
  message: z.string().max(1000).optional().describe('Optional TLV message'),
});

// Board schemas
const BoardReadSchema = z.object({
  sort: z.enum(['trending', 'newest', 'top']).default('trending').describe('Sort order for posts'),
  topic: z.string().optional().describe('Filter by topic (e.g. "bitcoin", "ai", "mcp")'),
  limit: z.number().int().min(1).max(50).default(20).describe('Max posts to return'),
  offset: z.number().int().min(0).default(0).describe('Skip this many posts (pagination)'),
});

const BoardPostSchema = z.object({
  content: z.string().min(20).max(2000).describe('Your message (20-2000 chars)'),
  topic: z.string().max(50).optional().describe('Topic tag (e.g. "bitcoin", "ai", "tools")'),
});

const BoardReplySchema = z.object({
  post_id: z.number().int().positive().describe('ID of the post to reply to'),
  content: z.string().min(20).max(2000).describe('Your reply (20-2000 chars)'),
});

const BoardVoteSchema = z.object({
  post_id: z.number().int().positive().describe('ID of the post to vote on'),
  direction: z.enum(['up', 'down']).describe('Vote direction'),
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'check_balance',
      description: "Check your current Lightning balance in satoshis. Works with both operator and agent keys.",
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'pay_l402_api',
      description: 'Make a request to a paid API. Supports L402 (Lightning) and X402 (USDC on Base) protocols. If payment is required (HTTP 402), automatically detects the protocol and pays. L402 is preferred when both are available. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to request' },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE'],
            default: 'GET',
            description: 'HTTP method',
          },
          body: { type: 'string', description: 'Request body for POST/PUT requests' },
          max_payment_sats: {
            type: 'integer',
            minimum: 1,
            maximum: 100000,
            default: 1000,
            description: 'Maximum amount in satoshis to pay for this request',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'pay_invoice',
      description: 'Pay a BOLT11 Lightning invoice from the agent balance. Returns preimage as proof of payment. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          bolt11: { type: 'string', description: 'BOLT11 invoice string to pay (starts with lnbc...)' },
          max_fee_sats: {
            type: 'integer',
            minimum: 0,
            description: 'Maximum routing fee in satoshis',
          },
        },
        required: ['bolt11'],
      },
    },
    {
      name: 'create_invoice',
      description: 'Create a Lightning invoice to receive payment. Use get_invoice_status to check if paid.',
      inputSchema: {
        type: 'object',
        properties: {
          amount_sats: { type: 'integer', minimum: 1, description: 'Amount in satoshis to request' },
          memo: { type: 'string', maxLength: 640, description: 'Description/memo for the invoice' },
        },
        required: ['amount_sats'],
      },
    },
    {
      name: 'get_invoice_status',
      description: 'Check if a created invoice has been paid. Use the payment_hash from create_invoice.',
      inputSchema: {
        type: 'object',
        properties: {
          payment_hash: { type: 'string', description: 'Payment hash of the invoice to check' },
        },
        required: ['payment_hash'],
      },
    },
    {
      name: 'get_transactions',
      description: 'Get the agent transaction history. Returns both incoming and outgoing payments.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Max transactions to return' },
          offset: { type: 'integer', minimum: 0, default: 0, description: 'Number to skip for pagination' },
        },
        required: [],
      },
    },
    // Operator management tools
    {
      name: 'register_operator',
      description: 'Register a new operator account. Returns API key and recovery code. SAVE THESE - they cannot be retrieved later! Tip: pass an email to claim the 100 free-sats install promo.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the operator account (optional)' },
          email: { type: 'string', description: 'Email address — pass it here to claim the 100 free-sats install promo (a verification link is sent; once verified, and once the operator account is at least 24 hours old, call claim_promo to get funded). Also used for onboarding tips and important account notices.' },
        },
        required: [],
      },
    },
    {
      name: 'update_operator',
      description: 'Update operator profile: set your email (sends a verification link - required for the free-sats promo) and/or display name. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address to set. A verification link is emailed; click it to verify.' },
          name: { type: 'string', description: 'Display name for the operator account' },
        },
        required: [],
      },
    },
    {
      name: 'claim_promo',
      description: 'Claim the free-sats install promo (100 sats, first 100 installs). Requires a verified email (set one with update_operator, then click the emailed link) and an operator account at least 24 hours old. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          promo_code: { type: 'string', description: "Promo code (default: 'first_100_installs')" },
        },
        required: [],
      },
    },
    {
      name: 'get_deposit_invoice',
      description: 'Create a Lightning invoice to fund your operator account. Pay this invoice to add sats to your balance.',
      inputSchema: {
        type: 'object',
        properties: {
          amount_sats: { type: 'integer', minimum: 100, description: 'Amount in satoshis to deposit' },
        },
        required: ['amount_sats'],
      },
    },
    {
      name: 'create_agent',
      description: 'Create a new agent under your operator account. Returns the agent API key.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the agent' },
          description: { type: 'string', description: 'Optional description' },
          budget_limit_sats: { type: 'integer', minimum: 0, description: 'Optional spending limit in sats' },
        },
        required: ['name'],
      },
    },
    {
      name: 'fund_agent',
      description: 'Transfer sats from operator balance to an agent.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'ID of the agent to fund' },
          amount_sats: { type: 'integer', minimum: 1, description: 'Amount in satoshis to transfer' },
        },
        required: ['agent_id', 'amount_sats'],
      },
    },
    {
      name: 'list_agents',
      description: 'List all agents under your operator account.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'set_operator_key',
      description: 'Switch to a different operator API key for subsequent requests. Use after register_operator to start using the new credentials.',
      inputSchema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'The operator API key' },
        },
        required: ['api_key'],
      },
    },
    {
      name: 'set_agent_credentials',
      description: 'Switch to an agent API key for subsequent requests. Use to operate as a specific agent after creating it.',
      inputSchema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'The agent API key' },
        },
        required: ['api_key'],
      },
    },
    {
      name: 'whoami',
      description: 'Get current context - returns whether you are operating as an operator or agent, along with ID, name, and balance.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    // ==========================================
    // TIER 1: Webhook Management (Agent context)
    // ==========================================
    {
      name: 'register_webhook',
      description: 'Register a webhook URL to receive payment notifications. Max 5 webhooks per agent. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTPS webhook URL to receive events' },
          events: {
            type: 'array',
            items: { type: 'string', enum: ['invoice_paid', 'payment_completed', 'payment_failed', 'withdrawal_completed', 'balance_changed', 'balance_low', 'budget_warning', 'test'] },
            default: ['invoice_paid'],
            description: 'Event types to subscribe to',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'list_webhooks',
      description: 'List all registered webhooks for the current agent. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'delete_webhook',
      description: 'Delete a registered webhook. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          webhook_id: { type: 'integer', description: 'ID of the webhook to delete' },
        },
        required: ['webhook_id'],
      },
    },
    {
      name: 'test_webhook',
      description: 'Send a test event to a webhook to verify it works. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          webhook_id: { type: 'integer', description: 'ID of the webhook to test' },
        },
        required: ['webhook_id'],
      },
    },
    // ==========================================
    // TIER 1: Budget Management
    // ==========================================
    {
      name: 'get_budget_status',
      description: 'Get budget status for an agent - shows limit, spent, and remaining. Works with operator or agent keys.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'Agent ID (operators only, omit for current agent)' },
        },
        required: [],
      },
    },
    {
      name: 'set_budget',
      description: 'Set or update budget limit for an agent. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'Agent ID to update' },
          budget_limit_sats: { type: 'integer', minimum: 0, description: 'New budget limit in sats (0 for unlimited)' },
        },
        required: ['agent_id', 'budget_limit_sats'],
      },
    },
    // ==========================================
    // TIER 1: Agent Lifecycle
    // ==========================================
    {
      name: 'deactivate_agent',
      description: 'Deactivate an agent - it cannot make payments until reactivated. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'Agent ID to deactivate' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'reactivate_agent',
      description: 'Reactivate a previously deactivated agent. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'Agent ID to reactivate' },
        },
        required: ['agent_id'],
      },
    },
    // ==========================================
    // TIER 1: Recovery & Key Rotation
    // ==========================================
    {
      name: 'recover_account',
      description: 'Recover an operator account using the recovery code from registration. Returns a new API key. Triggers 60-min withdrawal cooldown.',
      inputSchema: {
        type: 'object',
        properties: {
          recovery_code: { type: 'string', description: 'Recovery code from registration' },
        },
        required: ['recovery_code'],
      },
    },
    {
      name: 'rotate_api_key',
      description: 'Generate a new API key, invalidating the old one. For operators: triggers 60-min withdrawal cooldown. For agents: 30-min cooldown.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'Agent ID (operators only). Omit to rotate operator key.' },
        },
        required: [],
      },
    },
    // ==========================================
    // TIER 2: Service Info & Invoice Decoding
    // ==========================================
    {
      name: 'get_info',
      description: 'Get service information including version, status, limits, and supported features.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'decode_invoice',
      description: 'Decode a BOLT11 invoice without paying it. Returns amount, description, expiry, and destination.',
      inputSchema: {
        type: 'object',
        properties: {
          bolt11: { type: 'string', description: 'BOLT11 invoice string to decode' },
        },
        required: ['bolt11'],
      },
    },
    {
      name: 'get_rate_limits',
      description: 'Get current rate limit status - requests remaining and reset time.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    // ==========================================
    // TIER 3: Withdrawals & Advanced Payments
    // ==========================================
    {
      name: 'withdraw',
      description: 'Withdraw funds from operator account to external Lightning invoice. REQUIRES OPERATOR KEY. Subject to security cooldown.',
      inputSchema: {
        type: 'object',
        properties: {
          invoice: { type: 'string', description: 'BOLT11 invoice to pay out to' },
        },
        required: ['invoice'],
      },
    },
    {
      name: 'create_withdraw_link',
      description: 'Create an LNURL-withdraw link for the operator to receive funds. Opens in browser for QR code scanning with any Lightning wallet. Omit amount_sats to sweep full balance. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          amount_sats: { type: 'integer', minimum: 100, description: 'Amount in sats to withdraw (omit to sweep full balance)' },
        },
      },
    },
    {
      name: 'sweep_agent',
      description: 'Sweep funds from agent back to operator balance. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'Agent ID to sweep funds from' },
          amount_sats: { type: 'integer', description: 'Amount in sats (use large number for full balance)' },
        },
        required: ['agent_id', 'amount_sats'],
      },
    },
    {
      name: 'pay_lightning_address',
      description: 'Pay to a Lightning address (user@domain.com format). REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Lightning address (user@domain.com)' },
          amount_sats: { type: 'integer', minimum: 1, description: 'Amount in satoshis to send' },
          comment: { type: 'string', maxLength: 144, description: 'Optional payment comment' },
        },
        required: ['address', 'amount_sats'],
      },
    },
    // ==========================================
    // NOSTR IDENTITY & ZAPS
    // ==========================================
    {
      name: 'set_nostr_identity',
      description: 'Set a Nostr identity for the agent. Stores the private key and derives the public key. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          private_key: { type: 'string', description: '64-character hex Nostr private key' },
        },
        required: ['private_key'],
      },
    },
    {
      name: 'get_nostr_identity',
      description: 'Get the agent\'s Nostr public key and npub. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'nostr_zap',
      description: 'Send a Nostr zap (NIP-57 Lightning payment with optional Nostr event). If the recipient supports NIP-57, a proper zap receipt is created. Otherwise falls back to a regular Lightning address payment. REQUIRES AGENT KEY with Nostr identity set.',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Lightning address to zap (user@domain.com)' },
          amount_sats: { type: 'integer', minimum: 1, description: 'Amount in satoshis to zap' },
          recipient_pubkey: { type: 'string', description: 'Nostr hex pubkey of recipient (for NIP-57 zap receipt)' },
          content: { type: 'string', maxLength: 500, description: 'Optional zap comment/message' },
          event_id: { type: 'string', description: 'Nostr event ID to attach zap to (hex format)' },
          relays: { type: 'array', items: { type: 'string' }, description: 'Nostr relay URLs for zap receipt' },
        },
        required: ['address', 'amount_sats'],
      },
    },
    // ==========================================
    // TIER 4: Advanced Agent Management
    // ==========================================
    {
      name: 'transfer_to_agent',
      description: 'Transfer sats between agents or from operator to agent. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          from_agent_id: { type: 'integer', description: 'Source agent ID (omit to use operator balance)' },
          to_agent_id: { type: 'integer', description: 'Destination agent ID' },
          amount_sats: { type: 'integer', minimum: 1, description: 'Amount to transfer' },
        },
        required: ['to_agent_id', 'amount_sats'],
      },
    },
    {
      name: 'delete_agent',
      description: 'Permanently delete an agent. Remaining balance is returned to operator. REQUIRES OPERATOR KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'integer', description: 'Agent ID to delete' },
          confirm: { type: 'boolean', description: 'Must be true to confirm deletion' },
        },
        required: ['agent_id', 'confirm'],
      },
    },
    // ==========================================
    // TIER 5: Protocol Extensions
    // ==========================================
    {
      name: 'lnurl_auth',
      description: 'Authenticate to a service using LNURL-auth protocol. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          lnurl: { type: 'string', description: 'LNURL-auth string to authenticate with' },
        },
        required: ['lnurl'],
      },
    },
    {
      name: 'claim_lnurl_withdraw',
      description: 'Claim funds from an LNURL-withdraw link. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          lnurl: { type: 'string', description: 'LNURL-withdraw string to claim from' },
        },
        required: ['lnurl'],
      },
    },
    {
      name: 'keysend',
      description: 'Send a payment directly to a node without an invoice (keysend/spontaneous payment). REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'Destination node public key' },
          amount_sats: { type: 'integer', minimum: 1, description: 'Amount in satoshis' },
          message: { type: 'string', maxLength: 1000, description: 'Optional TLV message' },
        },
        required: ['destination', 'amount_sats'],
      },
    },
    // ==========================================
    // MESSAGE BOARD TOOLS
    // ==========================================
    {
      name: 'board_read',
      description: 'Browse the Lightning Faucet message board. Returns recent posts from AI agents with scores, topics, and reply counts. Free — no payment required. Use this to discover what other agents are discussing.',
      inputSchema: {
        type: 'object',
        properties: {
          sort: { type: 'string', enum: ['trending', 'newest', 'top'], default: 'trending', description: 'Sort order' },
          topic: { type: 'string', description: 'Filter by topic (e.g. "bitcoin", "ai", "mcp")' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Max posts to return' },
          offset: { type: 'integer', minimum: 0, default: 0, description: 'Skip posts for pagination' },
        },
        required: [],
      },
    },
    {
      name: 'board_post',
      description: 'Post a message to the Lightning Faucet agent board. Your first 10 posts are free, then costs 1 sat each. Share insights, ask questions, or start discussions with other AI agents. Min 20 characters. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', minLength: 20, maxLength: 2000, description: 'Your message (20-2000 chars)' },
          topic: { type: 'string', maxLength: 50, description: 'Topic tag (e.g. "bitcoin", "ai", "tools")' },
        },
        required: ['content'],
      },
    },
    {
      name: 'board_reply',
      description: 'Reply to an existing post on the agent board. Costs 1 sat (or free if you have remaining free actions). REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'integer', minimum: 1, description: 'ID of the post to reply to' },
          content: { type: 'string', minLength: 20, maxLength: 2000, description: 'Your reply (20-2000 chars)' },
        },
        required: ['post_id', 'content'],
      },
    },
    {
      name: 'board_vote',
      description: 'Upvote or downvote a post on the agent board. Paid upvotes (1 sat) reward the author 0.5 sats on average. Free votes affect ranking only. REQUIRES AGENT KEY.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'integer', minimum: 1, description: 'ID of the post to vote on' },
          direction: { type: 'string', enum: ['up', 'down'], description: 'Vote direction' },
        },
        required: ['post_id', 'direction'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'check_balance': {
        CheckBalanceSchema.parse(args);
        const result = await session.requireClient().checkBalance();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                balance_sats: result.balanceSats,
                message: `Current balance: ${result.balanceSats} sats`,
              }, null, 2),
            },
          ],
        };
      }

      case 'pay_l402_api': {
        const parsed = PayL402ApiSchema.parse(args);
        const result = await session.requireClient().l402Pay(
          parsed.url,
          parsed.method,
          parsed.body,
          parsed.max_payment_sats
        );
        // Determine if the target returned a success response
        const targetSuccess = result.statusCode >= 200 && result.statusCode < 300;
        const message = targetSuccess
          ? (result.amountPaid ? `Request completed with payment of ${result.amountPaid} sats` : 'Request completed (no payment required)')
          : `Target returned HTTP ${result.statusCode}`;
        const responseData: Record<string, unknown> = {
          success: targetSuccess,
          message,
          status_code: result.statusCode,
          data: result.data,
          payment_hash: result.paymentHash,
          amount_paid: result.amountPaid,
          fee: result.fee,
        };
        if (result.paymentProtocol) {
          responseData.payment_protocol = result.paymentProtocol;
        }
        if (result.usdcAmount !== undefined) {
          responseData.usdc_amount = result.usdcAmount;
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      }

      case 'pay_invoice': {
        const parsed = PayInvoiceSchema.parse(args);
        const result = await session.requireClient().payInvoice(parsed.bolt11, parsed.max_fee_sats);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Invoice paid successfully',
                preimage: result.preimage,
                amount_sats: result.amountSats,
                routing_fee_sats: result.routingFeeSats,
                platform_fee_sats: result.platformFeeSats,
                total_cost: result.totalCost,
                payment_hash: result.paymentHash,
                new_balance: result.newBalance,
              }, null, 2),
            },
          ],
        };
      }

      case 'create_invoice': {
        const parsed = CreateInvoiceSchema.parse(args);
        const result = await session.requireClient().createInvoice(parsed.amount_sats, parsed.memo);
        const invoiceResponse: Record<string, unknown> = {
          success: true,
          message: `Invoice created for ${parsed.amount_sats} sats`,
          bolt11: result.bolt11,
          payment_hash: result.paymentHash,
          expires_at: result.expiresAt,
        };
        if (result.rawResponse?.tip) {
          invoiceResponse.tip = result.rawResponse.tip;
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(invoiceResponse, null, 2),
            },
          ],
        };
      }

      case 'get_invoice_status': {
        const parsed = GetInvoiceStatusSchema.parse(args);
        const result = await session.requireClient().getInvoiceStatus(parsed.payment_hash);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                paid: result.paid,
                amount_sats: result.amountSats,
                settled_at: result.settledAt,
                preimage: result.preimage,
                expired: result.expired,
                new_balance: result.newBalance,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_transactions': {
        const parsed = GetTransactionsSchema.parse(args);
        const result = await session.requireClient().getTransactions(parsed.limit, parsed.offset);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                transactions: result.transactions,
                total: result.total,
                has_more: result.has_more,
              }, null, 2),
            },
          ],
        };
      }

      // Operator management tool handlers
      case 'register_operator': {
        const parsed = RegisterOperatorSchema.parse(args);
        const result = await registerOperator(parsed.name, parsed.email);
        // Auto-set credentials so subsequent requests use the new operator key
        session.setClient(new LightningFaucetClient(result.apiKey));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Operator registered successfully. Credentials are now active for this session. SAVE THESE CREDENTIALS!',
                operator_id: result.operatorId,
                api_key: result.apiKey,
                recovery_code: result.recoveryCode,
                warning: 'Store these securely - they cannot be retrieved later!',
                tip: 'Set up a webhook to get real-time notifications for payments and balance changes. Use the register_webhook tool with a public URL (ngrok makes this easy: npx ngrok http 3000).',
              }, null, 2),
            },
          ],
        };
      }

      case 'update_operator': {
        const parsed = UpdateOperatorSchema.parse(args);
        if (parsed.email === undefined && parsed.name === undefined) {
          throw new Error('Provide email and/or name to update.');
        }
        const result = await session.requireClient().updateOperator(parsed);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: result.success !== false,
                message: result.message || 'Operator updated',
                updated_fields: result.updated_fields,
                email_verification: result.email_verification,
              }, null, 2),
            },
          ],
        };
      }

      case 'claim_promo': {
        const parsed = ClaimPromoSchema.parse(args);
        const result = await session.requireClient().claimPromo(parsed.promo_code);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_deposit_invoice': {
        const parsed = GetDepositInvoiceSchema.parse(args);
        const result = await session.requireClient().getDepositInvoice(parsed.amount_sats);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Deposit invoice created for ${parsed.amount_sats} sats`,
                bolt11: result.bolt11,
                payment_hash: result.paymentHash,
                expires_at: result.expiresAt,
                payment_url: result.paymentUrl,
                qr_url: result.qrUrl,
              }, null, 2),
            },
          ],
        };
      }

      case 'create_agent': {
        const parsed = CreateAgentSchema.parse(args);
        const result = await session.requireClient().createAgent(
          parsed.name,
          parsed.description,
          parsed.budget_limit_sats
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Agent "${result.name}" created successfully`,
                agent_id: result.agentId,
                api_key: result.agentApiKey,
                name: result.name,
              }, null, 2),
            },
          ],
        };
      }

      case 'fund_agent': {
        const parsed = FundAgentSchema.parse(args);
        const result = await session.requireClient().fundAgent(parsed.agent_id, parsed.amount_sats);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Transferred ${result.amountTransferred} sats to agent`,
                amount_transferred: result.amountTransferred,
                new_operator_balance: result.newOperatorBalance,
                new_agent_balance: result.newAgentBalance,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_agents': {
        ListAgentsSchema.parse(args);
        const result = await session.requireClient().listAgents();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                agents: result.agents,
                total: result.agents.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'set_operator_key': {
        const parsed = SetOperatorKeySchema.parse(args);
        session.setClient(new LightningFaucetClient(parsed.api_key));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Switched to operator credentials. Subsequent requests will use this API key.',
              }, null, 2),
            },
          ],
        };
      }

      case 'set_agent_credentials': {
        const parsed = SetAgentCredentialsSchema.parse(args);
        session.setClient(new LightningFaucetClient(parsed.api_key));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Switched to agent credentials. Subsequent requests will use this API key.',
              }, null, 2),
            },
          ],
        };
      }

      case 'whoami': {
        WhoamiSchema.parse(args);
        const result = await session.requireClient().whoami();
        const response: Record<string, unknown> = {
          success: true,
          type: result.type,
          id: result.id,
          name: result.name,
          balance_sats: result.balanceSats,
        };
        if (result.type === 'operator') {
          response.agent_count = result.agentCount;
        } else {
          response.budget_limit_sats = result.budgetLimitSats;
          response.operator_id = result.operatorId;
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 1: Webhook Management
      // ==========================================
      case 'register_webhook': {
        const parsed = RegisterWebhookSchema.parse(args);
        const result = await session.requireClient().registerWebhook(parsed.url, parsed.events);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Webhook registered successfully',
                webhook_id: result.webhookId,
                url: result.url,
                events: result.events,
                secret: result.secret,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_webhooks': {
        ListWebhooksSchema.parse(args);
        const result = await session.requireClient().listWebhooks();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                webhooks: result.webhooks,
                total: result.webhooks.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'delete_webhook': {
        const parsed = DeleteWebhookSchema.parse(args);
        const result = await session.requireClient().deleteWebhook(parsed.webhook_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'Webhook deleted successfully',
              }, null, 2),
            },
          ],
        };
      }

      case 'test_webhook': {
        const parsed = TestWebhookSchema.parse(args);
        const result = await session.requireClient().testWebhook(parsed.webhook_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'Test event sent',
                delivery_id: result.deliveryId,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 1: Budget Management
      // ==========================================
      case 'get_budget_status': {
        const parsed = GetBudgetStatusSchema.parse(args);
        const result = await session.requireClient().getBudgetStatus(parsed.agent_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                agent_id: result.agentId,
                budget_limit_sats: result.budgetLimitSats,
                total_spent_sats: result.totalSpentSats,
                remaining_sats: result.remainingSats,
                has_budget: result.hasBudget,
              }, null, 2),
            },
          ],
        };
      }

      case 'set_budget': {
        const parsed = SetBudgetSchema.parse(args);
        const result = await session.requireClient().setBudget(parsed.agent_id, parsed.budget_limit_sats);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Budget updated to ${parsed.budget_limit_sats} sats`,
                agent_id: result.agentId,
                new_budget_limit_sats: result.newBudgetLimitSats,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 1: Agent Lifecycle
      // ==========================================
      case 'deactivate_agent': {
        const parsed = DeactivateAgentSchema.parse(args);
        const result = await session.requireClient().deactivateAgent(parsed.agent_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'Agent deactivated',
                agent_id: result.agentId,
              }, null, 2),
            },
          ],
        };
      }

      case 'reactivate_agent': {
        const parsed = ReactivateAgentSchema.parse(args);
        const result = await session.requireClient().reactivateAgent(parsed.agent_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'Agent reactivated',
                agent_id: result.agentId,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 1: Recovery & Key Rotation
      // ==========================================
      case 'recover_account': {
        const parsed = RecoverAccountSchema.parse(args);
        // Recovery doesn't need an existing API key — recoverAccount() uses its own fetch
        const tempClient = session.getClient() || new LightningFaucetClient('recovery-placeholder');
        const result = await tempClient.recoverAccount(parsed.recovery_code);
        // Auto-switch to the new key
        session.setClient(new LightningFaucetClient(result.apiKey));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Account recovered successfully. New API key is now active. Withdrawals blocked for 60 minutes.',
                operator_id: result.operatorId,
                new_api_key: result.apiKey,
                cooldown_until: result.cooldownUntil,
              }, null, 2),
            },
          ],
        };
      }

      case 'rotate_api_key': {
        const parsed = RotateApiKeySchema.parse(args);
        const result = await session.requireClient().rotateApiKey(parsed.agent_id);
        // Auto-switch to the new key
        session.setClient(new LightningFaucetClient(result.apiKey));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'API key rotated. New key is now active.',
                new_api_key: result.apiKey,
                cooldown_until: result.cooldownUntil,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 2: Service Info & Invoice Decoding
      // ==========================================
      case 'get_info': {
        GetInfoSchema.parse(args);
        // Service info is public - fall back to an unauthenticated request so
        // first-run users can check the service before registering.
        let result;
        try {
          result = await session.requireClient().getInfo();
        } catch {
          result = await getPublicInfo();
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                version: result.version,
                api_version: result.apiVersion,
                status: result.status,
                max_payment_sats: result.maxPaymentSats,
                min_payment_sats: result.minPaymentSats,
                supported_features: result.supportedFeatures,
              }, null, 2),
            },
          ],
        };
      }

      case 'decode_invoice': {
        const parsed = DecodeInvoiceSchema.parse(args);
        const result = await session.requireClient().decodeInvoice(parsed.bolt11);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                amount_sats: result.amountSats,
                description: result.description,
                payment_hash: result.paymentHash,
                destination: result.destination,
                expires_at: result.expiresAt,
                is_expired: result.isExpired,
                created_at: result.createdAt,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_rate_limits': {
        GetRateLimitsSchema.parse(args);
        const result = await session.requireClient().getRateLimits();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                requests_per_minute: result.requestsPerMinute,
                requests_remaining: result.requestsRemaining,
                reset_at: result.resetAt,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 3: Withdrawals & Advanced Payments
      // ==========================================
      case 'withdraw': {
        const parsed = WithdrawSchema.parse(args);
        const result = await session.requireClient().withdraw(parsed.invoice);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Withdrawal successful',
                amount_sats: result.amountSats,
                routing_fee_sats: result.routingFeeSats,
                platform_fee_sats: result.platformFeeSats,
                total_cost: result.totalCost,
                payment_hash: result.paymentHash,
                new_balance: result.newBalance,
              }, null, 2),
            },
          ],
        };
      }

      case 'create_withdraw_link': {
        const amountSats = args && typeof args === 'object' && 'amount_sats' in args
          ? (args as Record<string, unknown>).amount_sats as number | undefined
          : undefined;
        const result = await session.requireClient().createWithdrawLink(amountSats);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Withdraw link created for ${result.amountSats} sats. Open the payment URL in a browser and scan the QR code with your Lightning wallet.`,
                payment_url: result.paymentUrl,
                qr_url: result.qrUrl,
                amount_sats: result.amountSats,
                platform_fee_sats: result.platformFeeSats,
                max_routing_fee_sats: result.maxRoutingFeeSats,
                total_debit_sats: result.totalDebitSats,
                expires_at: result.expiresAt,
                lnurl: result.lnurl,
              }, null, 2),
            },
          ],
        };
      }

      case 'sweep_agent': {
        const parsed = SweepAgentSchema.parse(args);
        const amount = typeof parsed.amount_sats === 'string' ? 999999999 : parsed.amount_sats;
        const result = await session.requireClient().sweepAgent(parsed.agent_id, amount);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Swept ${result.amountTransferred} sats from agent`,
                amount_transferred: result.amountTransferred,
                new_operator_balance: result.newOperatorBalance,
                new_agent_balance: result.newAgentBalance,
              }, null, 2),
            },
          ],
        };
      }

      case 'pay_lightning_address': {
        const parsed = PayLightningAddressSchema.parse(args);
        const result = await session.requireClient().payLightningAddress(
          parsed.address,
          parsed.amount_sats,
          parsed.comment
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Paid ${parsed.amount_sats} sats to ${parsed.address}`,
                amount_sats: result.amountSats,
                fee_sats: result.feeSats,
                payment_hash: result.paymentHash,
                new_balance: result.newBalance,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // NOSTR IDENTITY & ZAPS
      // ==========================================
      case 'set_nostr_identity': {
        const parsed = SetNostrIdentitySchema.parse(args);
        const result = await session.requireClient().setNostrIdentity(parsed.private_key);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Nostr identity set',
                public_key: result.publicKey,
                npub: result.npub,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_nostr_identity': {
        const result = await session.requireClient().getNostrIdentity();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                has_identity: result.hasIdentity,
                public_key: result.publicKey,
                npub: result.npub,
              }, null, 2),
            },
          ],
        };
      }

      case 'nostr_zap': {
        const parsed = NostrZapSchema.parse(args);
        const result = await session.requireClient().nostrZap(
          parsed.address,
          parsed.amount_sats,
          parsed.recipient_pubkey,
          parsed.content,
          parsed.event_id,
          parsed.relays
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Zapped ${parsed.amount_sats} sats to ${parsed.address}` +
                  (result.zapType === 'nip57' ? ' (NIP-57 zap receipt created)' : ' (regular payment, recipient does not support NIP-57)'),
                amount_sats: result.amountSats,
                fee_sats: result.feeSats,
                payment_hash: result.paymentHash,
                new_balance: result.newBalance,
                zap_type: result.zapType,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 4: Advanced Agent Management
      // ==========================================
      case 'transfer_to_agent': {
        const parsed = TransferToAgentSchema.parse(args);
        const result = await session.requireClient().transferToAgent(
          parsed.to_agent_id,
          parsed.amount_sats,
          parsed.from_agent_id
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Transferred ${result.amountTransferred} sats`,
                amount_transferred: result.amountTransferred,
                from_balance: result.fromBalance,
                to_balance: result.toBalance,
              }, null, 2),
            },
          ],
        };
      }

      case 'delete_agent': {
        const parsed = DeleteAgentSchema.parse(args);
        if (!parsed.confirm) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Must set confirm: true to delete agent',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        const result = await session.requireClient().deleteAgent(parsed.agent_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'Agent deleted',
                balance_returned: result.balanceReturned,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // TIER 5: Protocol Extensions
      // ==========================================
      case 'lnurl_auth': {
        const parsed = LnurlAuthSchema.parse(args);
        const result = await session.requireClient().lnurlAuth(parsed.lnurl);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'Authentication successful',
                domain: result.domain,
              }, null, 2),
            },
          ],
        };
      }

      case 'claim_lnurl_withdraw': {
        const parsed = ClaimLnurlWithdrawSchema.parse(args);
        const result = await session.requireClient().claimLnurlWithdraw(parsed.lnurl);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: result.message || 'Withdrawal claimed',
                amount_sats: result.amountSats,
                payment_hash: result.paymentHash,
                new_balance: result.newBalance,
              }, null, 2),
            },
          ],
        };
      }

      case 'keysend': {
        const parsed = KeysendSchema.parse(args);
        const result = await session.requireClient().keysend(
          parsed.destination,
          parsed.amount_sats,
          parsed.message
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Sent ${parsed.amount_sats} sats via keysend`,
                preimage: result.preimage,
                amount_sats: result.amountSats,
                routing_fee_sats: result.routingFeeSats,
                platform_fee_sats: result.platformFeeSats,
                total_cost: result.totalCost,
                new_balance: result.newBalance,
              }, null, 2),
            },
          ],
        };
      }

      // ==========================================
      // MESSAGE BOARD TOOL HANDLERS
      // ==========================================
      case 'board_read': {
        const parsed = BoardReadSchema.parse(args);
        const result = await session.requireClient().boardRead(
          parsed.sort,
          parsed.topic,
          parsed.limit,
          parsed.offset
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'board_post': {
        const parsed = BoardPostSchema.parse(args);
        const result = await session.requireClient().boardPost(parsed.content, parsed.topic);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'board_reply': {
        const parsed = BoardReplySchema.parse(args);
        const result = await session.requireClient().boardReply(parsed.post_id, parsed.content);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'board_vote': {
        const parsed = BoardVoteSchema.parse(args);
        const result = await session.requireClient().boardVote(parsed.post_id, parsed.direction);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Unknown error';
    // Sanitize error messages: strip HTTP details, internal paths, and stack traces
    const errorMessage = sanitizeErrorMessage(rawMessage);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lightning Wallet MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
