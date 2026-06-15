#!/usr/bin/env node

/**
 * Lightning Wallet CLI
 *
 * CLI interface for AI agents that extend themselves via Bash.
 * Same API, same backend as the MCP server — just a different interface.
 *
 * Usage: lw <command> [options]
 */

import { LightningFaucetClient, registerOperator, getPublicInfo } from './lightning-faucet.js';

const VERSION = '1.4.0';

// --- Helpers ---

function getApiKey(): string {
  const key = process.env.LIGHTNING_WALLET_API_KEY;
  if (!key) {
    error('No API key found. Set LIGHTNING_WALLET_API_KEY or run: lw register');
  }
  return key;
}

function getClient(): LightningFaucetClient {
  return new LightningFaucetClient(getApiKey());
}

function error(message: string): never {
  const out = JSON.stringify({ error: message });
  process.stderr.write(message + '\n');
  process.stdout.write(out + '\n');
  process.exit(1);
}

function output(data: unknown, human: boolean): void {
  if (human) {
    process.stdout.write(formatHuman(data) + '\n');
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }
}

function formatHuman(data: unknown, indent: number = 0): string {
  if (data === null || data === undefined) return 'null';
  if (typeof data !== 'object') return String(data);
  const prefix = '  '.repeat(indent);
  if (Array.isArray(data)) {
    if (data.length === 0) return '(none)';
    return data.map((item, i) => `${prefix}[${i}] ${formatHuman(item, indent + 1)}`).join('\n');
  }
  const obj = data as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null) {
      lines.push(`${prefix}${key}:`);
      lines.push(formatHuman(val, indent + 1));
    } else {
      lines.push(`${prefix}${key}: ${val}`);
    }
  }
  return lines.join('\n');
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const command = argv[0] || 'help';
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// --- Commands ---

async function cmdRegister(positional: string[], flags: Record<string, string | boolean>): Promise<unknown> {
  const name = (flags.name as string) || positional[0] || undefined;
  const email = (flags.email as string) || undefined;
  const result = await registerOperator(name, email);
  return {
    operator_id: result.operatorId,
    api_key: result.apiKey,
    recovery_code: result.recoveryCode,
    hint: `export LIGHTNING_WALLET_API_KEY=${result.apiKey}`,
    webhook_tip: 'Set up a webhook to get real-time notifications for payments and balance changes. Run: lw help webhooks',
  };
}

async function cmdWhoami(): Promise<unknown> {
  const client = getClient();
  const result = await client.whoami();
  const out: Record<string, unknown> = {
    type: result.type,
    id: result.id,
    name: result.name,
    balance_sats: result.balanceSats,
  };
  if (result.agentCount !== undefined) out.agent_count = result.agentCount;
  if (result.budgetLimitSats !== undefined) out.budget_limit_sats = result.budgetLimitSats;
  if (result.operatorId !== undefined) out.operator_id = result.operatorId;
  return out;
}

async function cmdBalance(): Promise<unknown> {
  const client = getClient();
  const result = await client.checkBalance();
  return { balance_sats: result.balanceSats };
}

async function cmdPay(positional: string[], flags: Record<string, string | boolean>): Promise<unknown> {
  const invoice = positional[0];
  if (!invoice) error('Usage: lw pay <bolt11_invoice>');
  const client = getClient();
  const maxFee = flags['max-fee'] ? parseInt(flags['max-fee'] as string, 10) : undefined;
  const result = await client.payInvoice(invoice, maxFee);
  return {
    preimage: result.preimage,
    amount_sats: result.amountSats,
    routing_fee_sats: result.routingFeeSats,
    platform_fee_sats: result.platformFeeSats,
    total_cost: result.totalCost,
    payment_hash: result.paymentHash,
    new_balance: result.newBalance,
  };
}

async function cmdPayApi(positional: string[], flags: Record<string, string | boolean>): Promise<unknown> {
  const url = positional[0];
  if (!url) error('Usage: lw pay-api <url> [--method GET] [--body "{}"] [--max-sats 1000]');
  const client = getClient();
  const method = (flags.method as string) || 'GET';
  const body = flags.body as string | undefined;
  const maxSats = flags['max-sats'] ? parseInt(flags['max-sats'] as string, 10) : 1000;
  const result = await client.l402Pay(url, method, body === undefined ? undefined : body, maxSats);
  const out: Record<string, unknown> = {
    data: result.data,
    status_code: result.statusCode,
    amount_paid: result.amountPaid,
    fee: result.fee,
    payment_hash: result.paymentHash,
  };
  if (result.paymentProtocol) out.payment_protocol = result.paymentProtocol;
  if (result.usdcAmount) out.usdc_amount = result.usdcAmount;
  return out;
}

async function cmdCreateAgent(positional: string[], flags: Record<string, string | boolean>): Promise<unknown> {
  const name = positional[0] || (flags.name as string);
  if (!name) error('Usage: lw create-agent <name> [--budget <sats>]');
  const client = getClient();
  const budget = flags.budget ? parseInt(flags.budget as string, 10) : undefined;
  const result = await client.createAgent(name, undefined, budget);
  return {
    agent_id: result.agentId,
    agent_api_key: result.agentApiKey,
    name: result.name,
  };
}

async function cmdFundAgent(positional: string[]): Promise<unknown> {
  const agentId = positional[0];
  const amount = positional[1];
  if (!agentId || !amount) error('Usage: lw fund-agent <agent_id> <amount_sats>');
  const client = getClient();
  const result = await client.fundAgent(parseInt(agentId, 10), parseInt(amount, 10));
  return {
    amount_transferred: result.amountTransferred,
    new_operator_balance: result.newOperatorBalance,
    new_agent_balance: result.newAgentBalance,
  };
}

async function cmdListAgents(): Promise<unknown> {
  const client = getClient();
  const result = await client.listAgents();
  return result.agents.map(a => ({
    id: a.id,
    name: a.name,
    balance_sats: a.balance_sats,
    is_active: a.is_active,
  }));
}

async function cmdDeposit(positional: string[]): Promise<unknown> {
  const amount = positional[0];
  if (!amount) error('Usage: lw deposit <amount_sats>');
  const client = getClient();
  const result = await client.getDepositInvoice(parseInt(amount, 10));
  return {
    bolt11: result.bolt11,
    payment_hash: result.paymentHash,
    expires_at: result.expiresAt,
    payment_url: result.paymentUrl,
    qr_url: result.qrUrl,
  };
}

async function cmdWithdraw(positional: string[]): Promise<unknown> {
  const invoice = positional[0];
  if (!invoice) error('Usage: lw withdraw <bolt11_invoice>');
  const client = getClient();
  const result = await client.withdraw(invoice);
  return {
    amount_sats: result.amountSats,
    routing_fee_sats: result.routingFeeSats,
    platform_fee_sats: result.platformFeeSats,
    total_cost: result.totalCost,
    payment_hash: result.paymentHash,
    new_balance: result.newBalance,
  };
}

async function cmdWithdrawLink(positional: string[]): Promise<unknown> {
  const amount = positional[0] ? parseInt(positional[0], 10) : undefined;
  const client = getClient();
  const result = await client.createWithdrawLink(amount);
  return {
    payment_url: result.paymentUrl,
    qr_url: result.qrUrl,
    amount_sats: result.amountSats,
    platform_fee_sats: result.platformFeeSats,
    max_routing_fee_sats: result.maxRoutingFeeSats,
    total_debit_sats: result.totalDebitSats,
    expires_at: result.expiresAt,
    lnurl: result.lnurl,
  };
}

async function cmdTransactions(flags: Record<string, string | boolean>): Promise<unknown> {
  const client = getClient();
  const limit = flags.limit ? parseInt(flags.limit as string, 10) : 10;
  const offset = flags.offset ? parseInt(flags.offset as string, 10) : 0;
  const result = await client.getTransactions(limit, offset);
  return {
    transactions: result.transactions.map(tx => ({
      type: tx.type,
      amount_sats: tx.amount_sats,
      fee_sats: tx.fee_sats,
      memo: tx.memo,
      payment_hash: tx.payment_hash,
      timestamp: tx.timestamp,
      balance_after: tx.balance_after,
    })),
    total: result.total,
    has_more: result.has_more,
  };
}


async function cmdSetEmail(positional: string[]): Promise<unknown> {
  const email = positional[0];
  if (!email) error('Usage: lw set-email <email>');
  const client = getClient();
  return client.updateOperator({ email });
}

async function cmdClaimPromo(): Promise<unknown> {
  const client = getClient();
  return client.claimPromo();
}

async function cmdInfo(): Promise<unknown> {
  // Service info is public - works with or without an API key
  const result = process.env.LIGHTNING_WALLET_API_KEY
    ? await getClient().getInfo()
    : await getPublicInfo();
  return {
    version: result.version,
    api_version: result.apiVersion,
    status: result.status,
    max_payment_sats: result.maxPaymentSats,
    min_payment_sats: result.minPaymentSats,
    supported_features: result.supportedFeatures,
  };
}

async function cmdDecode(positional: string[]): Promise<unknown> {
  const invoice = positional[0];
  if (!invoice) error('Usage: lw decode <bolt11_invoice>');
  const client = getClient();
  const result = await client.decodeInvoice(invoice);
  return {
    amount_sats: result.amountSats,
    description: result.description,
    payment_hash: result.paymentHash,
    destination: result.destination,
    expires_at: result.expiresAt,
    is_expired: result.isExpired,
    created_at: result.createdAt,
  };
}

function cmdHelp(): void {
  const help = `Lightning Wallet CLI v${VERSION}
https://lightningfaucet.com/ai-agents

Give your AI agent a Bitcoin wallet. Works with any agent framework.

USAGE
  lw <command> [options]

SETUP
  register [--name "name"] [--email "you@example.com"]
                                 Create operator account, prints API key
  export LIGHTNING_WALLET_API_KEY=<key>   Set API key (after register)

COMMANDS
  whoami                          Show current identity (operator or agent)
  balance                         Check balance in satoshis
  info                            Service status and capabilities
  deposit <amount>                Generate deposit invoice (sats)
  withdraw <invoice>              Withdraw to external wallet
  withdraw-link [amount]          Create LNURL-withdraw link (omit amount to sweep all)

  pay <invoice>                   Pay a BOLT11 invoice [--max-fee <sats>]
  pay-api <url>                   Pay L402/X402 API (auto-detect protocol)
                                    [--method GET] [--body "{}"] [--max-sats 1000]
  decode <invoice>                Decode BOLT11 invoice without paying

  create-agent <name>             Create agent [--budget <sats>]
  fund-agent <id> <amount>        Transfer sats to agent
  list-agents | agents             List all agents

  transactions                    Recent transactions [--limit 10] [--offset 0]
  set-email <email>               Set operator email (verification link emailed)
  claim-promo                     Claim the 100-sat install promo
                                    (requires verified email + 3h account age)
  help                            Show this help

WEBHOOKS
  Get real-time notifications instead of polling. Webhooks POST JSON to your
  URL when events occur (payments received, balance changes, etc.).

  Quick setup with ngrok (no server needed):
    1. npx ngrok http 3000              Start a tunnel
    2. Use the https URL ngrok gives you as your webhook URL

  Register:  curl -X POST https://lightningfaucet.com/ai-agents/api.php \\
               -d '{"action":"register_webhook","api_key":"YOUR_KEY",
                    "url":"https://your-ngrok-url.ngrok-free.app/webhook",
                    "events":["invoice_paid","balance_changed"]}'

  Events: invoice_paid, payment_completed, payment_failed,
          withdrawal_completed, balance_changed, balance_low, budget_warning

  Full docs: https://lightningfaucet.com/ai-agents/docs#webhooks

OUTPUT
  Default: JSON (pipe to jq for parsing)
  --human                         Human-readable output

EXAMPLES
  # Register and save key
  export LIGHTNING_WALLET_API_KEY=$(lw register --name "My Bot" | jq -r '.api_key')

  # Check balance
  lw balance | jq '.balance_sats'

  # Pay an L402 API
  lw pay-api "https://lightningfaucet.com/api/l402/fortune"

  # Create and fund an agent
  lw create-agent "Research Bot" --budget 5000
  lw fund-agent 1 1000

DOCS
  https://lightningfaucet.com/ai-agents/docs
  https://github.com/lightningfaucet/lightning-wallet-mcp`;

  process.stdout.write(help + '\n');
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, positional, flags } = parseArgs(args);
  const human = flags.human === true || flags.pretty === true;

  try {
    let result: unknown;

    switch (command) {
      case 'register':
        result = await cmdRegister(positional, flags);
        break;
      case 'whoami':
        result = await cmdWhoami();
        break;
      case 'balance':
        result = await cmdBalance();
        break;
      case 'pay':
        result = await cmdPay(positional, flags);
        break;
      case 'pay-api':
        result = await cmdPayApi(positional, flags);
        break;
      case 'create-agent':
        result = await cmdCreateAgent(positional, flags);
        break;
      case 'fund-agent':
        result = await cmdFundAgent(positional);
        break;
      case 'list-agents':
      case 'agents':
        result = await cmdListAgents();
        break;
      case 'deposit':
        result = await cmdDeposit(positional);
        break;
      case 'withdraw':
        result = await cmdWithdraw(positional);
        break;
      case 'withdraw-link':
        result = await cmdWithdrawLink(positional);
        break;
      case 'transactions':
        result = await cmdTransactions(flags);
        break;
      case 'set-email':
        result = await cmdSetEmail(positional);
        break;
      case 'claim-promo':
        result = await cmdClaimPromo();
        break;
      case 'info':
        result = await cmdInfo();
        break;
      case 'decode':
        result = await cmdDecode(positional);
        break;
      case 'help':
      case '--help':
      case '-h':
        cmdHelp();
        return;
      case 'version':
      case '--version':
      case '-v':
        process.stdout.write(VERSION + '\n');
        return;
      default:
        process.stderr.write(`Unknown command: ${command}\n\n`);
        cmdHelp();
        process.exit(1);
    }

    output(result, human);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.stdout.write(JSON.stringify({ error: message }) + '\n');
    process.exit(1);
  }
}

main();
