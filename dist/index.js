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
 *   Add to .claude/settings.json:
 *   {
 *     "mcpServers": {
 *       "lightning-wallet": {
 *         "command": "npx",
 *         "args": ["lightning-wallet-mcp"],
 *         "env": {
 *           "LIGHTNING_WALLET_API_KEY": "your-api-key-here"
 *         }
 *       }
 *     }
 *   }
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const lightning_faucet_js_1 = require("./lightning-faucet.js");
// Get API key from environment (optional - can be set later via set_operator_key or set_agent_credentials)
// Supports both new and legacy env var names for backwards compatibility
const API_KEY = process.env.LIGHTNING_WALLET_API_KEY || process.env.LIGHTNING_FAUCET_API_KEY;
// Global client instance for the current session
// NOTE: This is intentionally global as MCP tools are invoked sequentially by the model.
// If concurrent tool execution becomes supported, this would need to be refactored
// to use per-request context or a connection pool.
let client = API_KEY ? new lightning_faucet_js_1.LightningFaucetClient(API_KEY) : null;
function requireClient() {
    if (!client) {
        throw new Error('No API key configured. Use set_operator_key or set_agent_credentials first, or set LIGHTNING_WALLET_API_KEY environment variable.');
    }
    return client;
}
// Create MCP server
const server = new index_js_1.Server({
    name: 'lightning-wallet',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Tool schemas
const CheckBalanceSchema = zod_1.z.object({});
const PayL402ApiSchema = zod_1.z.object({
    url: zod_1.z.string().describe('The URL to request'),
    method: zod_1.z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET').describe('HTTP method'),
    body: zod_1.z.string().optional().describe('Request body for POST/PUT requests'),
    max_payment_sats: zod_1.z.number().min(1).max(100000).default(1000)
        .describe('Maximum amount in satoshis to pay for this request'),
});
const PayInvoiceSchema = zod_1.z.object({
    bolt11: zod_1.z.string().describe('BOLT11 invoice string to pay (starts with lnbc...)'),
    max_fee_sats: zod_1.z.number().min(0).optional()
        .describe('Maximum routing fee in satoshis (default: 10% of invoice amount)'),
});
const CreateInvoiceSchema = zod_1.z.object({
    amount_sats: zod_1.z.number().min(1).describe('Amount in satoshis to request'),
    memo: zod_1.z.string().max(640).optional().describe('Description/memo for the invoice'),
});
const GetInvoiceStatusSchema = zod_1.z.object({
    payment_hash: zod_1.z.string().describe('Payment hash of the invoice to check'),
});
const GetTransactionsSchema = zod_1.z.object({
    limit: zod_1.z.number().min(1).max(200).default(50).describe('Max transactions to return'),
    offset: zod_1.z.number().min(0).default(0).describe('Number to skip for pagination'),
});
// Operator management schemas
const RegisterOperatorSchema = zod_1.z.object({
    name: zod_1.z.string().optional().describe('Name for the operator account'),
});
const GetDepositInvoiceSchema = zod_1.z.object({
    amount_sats: zod_1.z.number().min(100).describe('Amount in satoshis to deposit'),
});
const CreateAgentSchema = zod_1.z.object({
    name: zod_1.z.string().describe('Name for the agent'),
    description: zod_1.z.string().optional().describe('Optional description'),
    budget_limit_sats: zod_1.z.number().min(0).optional().describe('Optional spending limit in sats'),
});
const FundAgentSchema = zod_1.z.object({
    agent_id: zod_1.z.number().describe('ID of the agent to fund'),
    amount_sats: zod_1.z.number().min(1).describe('Amount in satoshis to transfer'),
});
const ListAgentsSchema = zod_1.z.object({});
const SetOperatorKeySchema = zod_1.z.object({
    api_key: zod_1.z.string().describe('The operator API key to use for subsequent requests'),
});
const SetAgentCredentialsSchema = zod_1.z.object({
    api_key: zod_1.z.string().describe('The agent API key to use for subsequent requests'),
});
const WhoamiSchema = zod_1.z.object({});
// ==========================================
// NEW TIER 1 SCHEMAS - Webhooks, Budget, Lifecycle, Recovery
// ==========================================
const RegisterWebhookSchema = zod_1.z.object({
    url: zod_1.z.string().url().describe('HTTPS webhook URL to receive events'),
    events: zod_1.z.array(zod_1.z.enum(['invoice_paid', 'payment_completed', 'payment_failed', 'balance_low', 'budget_warning', 'test']))
        .default(['invoice_paid']).describe('Event types to subscribe to'),
});
const ListWebhooksSchema = zod_1.z.object({});
const DeleteWebhookSchema = zod_1.z.object({
    webhook_id: zod_1.z.number().int().positive().describe('ID of the webhook to delete'),
});
const TestWebhookSchema = zod_1.z.object({
    webhook_id: zod_1.z.number().int().positive().describe('ID of the webhook to test'),
});
const GetBudgetStatusSchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().optional().describe('Agent ID (operators only, defaults to current agent)'),
});
const SetBudgetSchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().describe('Agent ID to update'),
    budget_limit_sats: zod_1.z.number().int().min(0).describe('New budget limit in sats (0 for unlimited)'),
});
const DeactivateAgentSchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().describe('Agent ID to deactivate'),
});
const ReactivateAgentSchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().describe('Agent ID to reactivate'),
});
const RecoverAccountSchema = zod_1.z.object({
    recovery_code: zod_1.z.string().describe('Recovery code received during registration'),
});
const RotateApiKeySchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().optional().describe('Agent ID (operators only). If omitted, rotates operator key.'),
});
// Tier 2 schemas
const GetInfoSchema = zod_1.z.object({});
const DecodeInvoiceSchema = zod_1.z.object({
    bolt11: zod_1.z.string().describe('BOLT11 invoice string to decode'),
});
const GetRateLimitsSchema = zod_1.z.object({});
// Tier 3 schemas
const WithdrawSchema = zod_1.z.object({
    invoice: zod_1.z.string().describe('BOLT11 invoice to pay out to'),
});
const SweepAgentSchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().describe('Agent ID to sweep funds from'),
    amount_sats: zod_1.z.union([zod_1.z.number().int().positive(), zod_1.z.literal('all')]).describe('Amount in sats or "all" for full balance'),
});
const PayLightningAddressSchema = zod_1.z.object({
    address: zod_1.z.string().describe('Lightning address (user@domain.com format)'),
    amount_sats: zod_1.z.number().int().positive().describe('Amount in satoshis to send'),
    comment: zod_1.z.string().max(144).optional().describe('Optional payment comment'),
});
const ExportTransactionsSchema = zod_1.z.object({
    format: zod_1.z.enum(['json', 'csv']).default('json').describe('Export format'),
    start_date: zod_1.z.string().optional().describe('ISO date for start of range'),
    end_date: zod_1.z.string().optional().describe('ISO date for end of range'),
    include_pending: zod_1.z.boolean().default(false).describe('Include pending transactions'),
});
const GetAgentAnalyticsSchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().optional().describe('Agent ID (defaults to current agent)'),
    period: zod_1.z.enum(['24h', '7d', '30d', 'all']).default('30d').describe('Time period for analytics'),
});
// Tier 4 schemas
const TransferToAgentSchema = zod_1.z.object({
    from_agent_id: zod_1.z.number().int().positive().optional().describe('Source agent ID (optional, defaults to operator balance)'),
    to_agent_id: zod_1.z.number().int().positive().describe('Destination agent ID'),
    amount_sats: zod_1.z.number().int().positive().describe('Amount to transfer'),
});
const DeleteAgentSchema = zod_1.z.object({
    agent_id: zod_1.z.number().int().positive().describe('Agent ID to permanently delete'),
    confirm: zod_1.z.boolean().describe('Must be true to confirm deletion'),
});
// Tier 5 schemas
const LnurlAuthSchema = zod_1.z.object({
    lnurl: zod_1.z.string().describe('LNURL-auth string to authenticate with'),
});
const ClaimLnurlWithdrawSchema = zod_1.z.object({
    lnurl: zod_1.z.string().describe('LNURL-withdraw string to claim from'),
});
const KeysendSchema = zod_1.z.object({
    destination: zod_1.z.string().describe('Destination node public key'),
    amount_sats: zod_1.z.number().int().positive().describe('Amount in satoshis'),
    message: zod_1.z.string().max(1000).optional().describe('Optional TLV message'),
});
// List available tools
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
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
            description: 'Make a request to an L402-protected API. If payment is required (HTTP 402), automatically pay the Lightning invoice and complete the request. REQUIRES AGENT KEY - use set_agent_credentials first if operating as an operator.',
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
            description: 'Register a new operator account. Returns API key and recovery code. SAVE THESE - they cannot be retrieved later!',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name for the operator account (optional)' },
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
                        items: { type: 'string', enum: ['invoice_paid', 'payment_completed', 'payment_failed', 'balance_low', 'budget_warning', 'test'] },
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
        {
            name: 'export_transactions',
            description: 'Export transaction history in JSON or CSV format.',
            inputSchema: {
                type: 'object',
                properties: {
                    format: { type: 'string', enum: ['json', 'csv'], default: 'json', description: 'Export format' },
                    start_date: { type: 'string', description: 'ISO date for start of range' },
                    end_date: { type: 'string', description: 'ISO date for end of range' },
                    include_pending: { type: 'boolean', default: false, description: 'Include pending transactions' },
                },
                required: [],
            },
        },
        {
            name: 'get_agent_analytics',
            description: 'Get detailed spending analytics for an agent.',
            inputSchema: {
                type: 'object',
                properties: {
                    agent_id: { type: 'integer', description: 'Agent ID (defaults to current agent)' },
                    period: { type: 'string', enum: ['24h', '7d', '30d', 'all'], default: '30d', description: 'Time period' },
                },
                required: [],
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
    ],
}));
// Handle tool calls
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'check_balance': {
                CheckBalanceSchema.parse(args);
                const result = await requireClient().checkBalance();
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
                const result = await requireClient().l402Pay(parsed.url, parsed.method, parsed.body, parsed.max_payment_sats);
                // Determine if the target returned a success response
                const targetSuccess = result.statusCode >= 200 && result.statusCode < 300;
                const message = targetSuccess
                    ? (result.amountPaid ? `Request completed with payment of ${result.amountPaid} sats` : 'Request completed (no payment required)')
                    : `Target returned HTTP ${result.statusCode}`;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: targetSuccess,
                                message,
                                status_code: result.statusCode,
                                data: result.data,
                                payment_hash: result.paymentHash,
                                amount_paid: result.amountPaid,
                                fee: result.fee,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'pay_invoice': {
                const parsed = PayInvoiceSchema.parse(args);
                const result = await requireClient().payInvoice(parsed.bolt11, parsed.max_fee_sats);
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
                const result = await requireClient().createInvoice(parsed.amount_sats, parsed.memo);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: `Invoice created for ${parsed.amount_sats} sats`,
                                bolt11: result.bolt11,
                                payment_hash: result.paymentHash,
                                expires_at: result.expiresAt,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'get_invoice_status': {
                const parsed = GetInvoiceStatusSchema.parse(args);
                const result = await requireClient().getInvoiceStatus(parsed.payment_hash);
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
                const result = await requireClient().getTransactions(parsed.limit, parsed.offset);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                transactions: result.transactions,
                                total: result.total,
                                has_more: result.hasMore,
                            }, null, 2),
                        },
                    ],
                };
            }
            // Operator management tool handlers
            case 'register_operator': {
                const parsed = RegisterOperatorSchema.parse(args);
                const result = await (0, lightning_faucet_js_1.registerOperator)(parsed.name);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: 'Operator registered successfully. SAVE THESE CREDENTIALS!',
                                operator_id: result.operatorId,
                                api_key: result.apiKey,
                                recovery_code: result.recoveryCode,
                                warning: 'Store these securely - they cannot be retrieved later!',
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'get_deposit_invoice': {
                const parsed = GetDepositInvoiceSchema.parse(args);
                const result = await requireClient().getDepositInvoice(parsed.amount_sats);
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
                const result = await requireClient().createAgent(parsed.name, parsed.description, parsed.budget_limit_sats);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: `Agent "${result.name}" created successfully`,
                                agent_id: result.agentId,
                                agent_api_key: result.agentApiKey,
                                name: result.name,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'fund_agent': {
                const parsed = FundAgentSchema.parse(args);
                const result = await requireClient().fundAgent(parsed.agent_id, parsed.amount_sats);
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
                const result = await requireClient().listAgents();
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
                client = new lightning_faucet_js_1.LightningFaucetClient(parsed.api_key);
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
                client = new lightning_faucet_js_1.LightningFaucetClient(parsed.api_key);
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
                const result = await requireClient().whoami();
                const response = {
                    success: true,
                    type: result.type,
                    id: result.id,
                    name: result.name,
                    balance_sats: result.balanceSats,
                };
                if (result.type === 'operator') {
                    response.agent_count = result.agentCount;
                }
                else {
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
                const result = await requireClient().registerWebhook(parsed.url, parsed.events);
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
                const result = await requireClient().listWebhooks();
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
                const result = await requireClient().deleteWebhook(parsed.webhook_id);
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
                const result = await requireClient().testWebhook(parsed.webhook_id);
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
                const result = await requireClient().getBudgetStatus(parsed.agent_id);
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
                const result = await requireClient().setBudget(parsed.agent_id, parsed.budget_limit_sats);
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
                const result = await requireClient().deactivateAgent(parsed.agent_id);
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
                const result = await requireClient().reactivateAgent(parsed.agent_id);
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
                // Recovery doesn't need an existing API key - create temp client or use existing
                const tempClient = client || new lightning_faucet_js_1.LightningFaucetClient('');
                const result = await tempClient.recoverAccount(parsed.recovery_code);
                // Auto-switch to the new key
                client = new lightning_faucet_js_1.LightningFaucetClient(result.apiKey);
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
                const result = await requireClient().rotateApiKey(parsed.agent_id);
                // Auto-switch to the new key
                client = new lightning_faucet_js_1.LightningFaucetClient(result.apiKey);
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
                const result = await requireClient().getInfo();
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
                const result = await requireClient().decodeInvoice(parsed.bolt11);
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
                const result = await requireClient().getRateLimits();
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
                const result = await requireClient().withdraw(parsed.invoice);
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
            case 'sweep_agent': {
                const parsed = SweepAgentSchema.parse(args);
                const amount = typeof parsed.amount_sats === 'string' ? 999999999 : parsed.amount_sats;
                const result = await requireClient().sweepAgent(parsed.agent_id, amount);
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
                const result = await requireClient().payLightningAddress(parsed.address, parsed.amount_sats, parsed.comment);
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
            case 'export_transactions': {
                const parsed = ExportTransactionsSchema.parse(args);
                const result = await requireClient().exportTransactions(parsed.format, parsed.start_date, parsed.end_date, parsed.include_pending);
                return {
                    content: [
                        {
                            type: 'text',
                            text: result.format === 'csv' ? result.data : JSON.stringify({
                                success: true,
                                format: result.format,
                                count: result.count,
                                data: result.data,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'get_agent_analytics': {
                const parsed = GetAgentAnalyticsSchema.parse(args);
                const result = await requireClient().getAgentAnalytics(parsed.agent_id, parsed.period);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                agent_id: result.agentId,
                                period: result.period,
                                total_spent: result.totalSpent,
                                total_received: result.totalReceived,
                                transaction_count: result.transactionCount,
                                average_payment: result.averagePayment,
                                top_destinations: result.topDestinations,
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
                const result = await requireClient().transferToAgent(parsed.to_agent_id, parsed.amount_sats, parsed.from_agent_id);
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
                const result = await requireClient().deleteAgent(parsed.agent_id);
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
                const result = await requireClient().lnurlAuth(parsed.lnurl);
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
                const result = await requireClient().claimLnurlWithdraw(parsed.lnurl);
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
                const result = await requireClient().keysend(parsed.destination, parsed.amount_sats, parsed.message);
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('Lightning Wallet MCP server running on stdio');
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map