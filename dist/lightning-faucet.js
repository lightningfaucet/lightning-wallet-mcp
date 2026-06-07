"use strict";
/**
 * Lightning Faucet API Client
 *
 * Handles communication with the Lightning Faucet AI Agent Wallet API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LightningFaucetClient = void 0;
exports.registerOperator = registerOperator;
const pre_payment_hook_js_1 = require("./pre-payment-hook.js");
const bolt11_js_1 = require("./bolt11.js");
const API_BASE_URL = process.env.LIGHTNING_WALLET_API_URL || 'https://lightningfaucet.com/ai-agents/api';
function safeStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return '[unserializable]';
    }
}
class LightningFaucetClient {
    apiKey;
    agentIdCache;
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('API key is required');
        }
        this.apiKey = apiKey;
    }
    /**
     * Resolve the current agent id for hook proposals (best-effort, cached).
     * Returns null if it cannot be determined; a payment is never blocked solely
     * because identity resolution failed — that decision is left to the policy hook.
     */
    async resolveAgentId() {
        if (this.agentIdCache !== undefined) {
            return this.agentIdCache;
        }
        try {
            const who = await this.whoami();
            this.agentIdCache = who.id || null;
        }
        catch {
            this.agentIdCache = null;
        }
        return this.agentIdCache;
    }
    /**
     * Run the optional pre-payment policy hook before executing a payment.
     *
     * No-op when `PRE_PAYMENT_HOOK_URL` is unset (behaviour is unchanged). When a
     * hook is configured this POSTs a vendor-neutral proposal and throws
     * `PolicyDenied` if the hook — or fail-closed handling of a hook error —
     * denies the payment. Only the four explicit payment methods call this; it is
     * invoked before any funds-moving request is sent.
     */
    async enforcePrePaymentPolicy(params) {
        const config = (0, pre_payment_hook_js_1.getPrePaymentHookConfig)();
        if (!config) {
            return;
        }
        const agentId = await this.resolveAgentId();
        const proposal = {
            proposal_id: globalThis.crypto.randomUUID(),
            agent_id: agentId,
            protocol: params.protocol,
            destination_or_url: params.destinationOrUrl,
            amount_sats: params.amountSats,
            max_payment_sats: params.maxPaymentSats,
            method: params.method ?? null,
            ts: new Date().toISOString(),
        };
        const { attestation } = await (0, pre_payment_hook_js_1.runPrePaymentHook)(proposal, config);
        if (attestation !== undefined) {
            // Opaque to this client — logged on stderr to avoid corrupting MCP stdio.
            console.error(`[pre-payment-hook] payment allowed with attestation: ${safeStringify(attestation)}`);
        }
    }
    /**
     * Make an API request to Lightning Faucet
     */
    async request(action, data = {}) {
        const payload = {
            action,
            api_key: this.apiKey,
            ...data,
        };
        const response = await fetch(API_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            // Don't include statusText in error — it may expose server internals
            throw new Error(`Request failed (HTTP ${response.status})`);
        }
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Unknown API error');
        }
        return result;
    }
    /**
     * Check the agent's current balance
     */
    async checkBalance() {
        const result = await this.request('get_balance');
        return {
            balanceSats: result.balance_sats || result.balance || 0,
            rawResponse: result,
        };
    }
    /**
     * Pay an L402-protected API endpoint
     */
    async l402Pay(url, method = 'GET', body, maxPaymentSats = 1000) {
        // L402 vs X402 is auto-detected server-side; the actual amount is set by the
        // challenge, so only the agent-authorised ceiling is known at hook time.
        await this.enforcePrePaymentPolicy({
            protocol: 'l402',
            destinationOrUrl: url,
            amountSats: null,
            maxPaymentSats,
            method: method.toUpperCase(),
        });
        const requestData = {
            url,
            method: method.toUpperCase(),
            max_payment_sats: maxPaymentSats,
        };
        if (body) {
            requestData.body = body;
        }
        const result = await this.request('l402_pay', requestData);
        let responseData;
        if (result.body) {
            try {
                responseData = JSON.parse(result.body);
            }
            catch {
                responseData = result.body;
            }
        }
        else {
            responseData = result.data;
        }
        return {
            data: responseData,
            statusCode: result.status_code || 200,
            paymentHash: result.payment_hash,
            amountPaid: result.amount_paid,
            fee: result.fee,
            paymentProtocol: result.payment_protocol,
            usdcAmount: result.usdc_amount,
            rawResponse: result,
        };
    }
    /**
     * Pay a BOLT11 Lightning invoice
     */
    async payInvoice(bolt11, maxFeeSats) {
        // Decode the amount from the invoice locally (no extra API call) so the hook
        // receives the exact amount; null only if the invoice is amountless/unparseable.
        await this.enforcePrePaymentPolicy({
            protocol: 'bolt11',
            destinationOrUrl: bolt11,
            amountSats: (0, bolt11_js_1.bolt11AmountSats)(bolt11),
            maxPaymentSats: null,
            method: null,
        });
        const data = {
            invoice: bolt11,
        };
        if (maxFeeSats !== undefined) {
            data.max_fee_sats = maxFeeSats;
        }
        const result = await this.request('pay_invoice', data);
        const amountSats = result.amount_sats || result.amount_paid || 0;
        const routingFeeSats = result.routing_fee_sats || 0;
        const platformFeeSats = result.platform_fee_sats || 0;
        return {
            preimage: result.preimage || result.payment_preimage || '',
            amountSats,
            routingFeeSats,
            platformFeeSats,
            totalCost: result.total_cost || (amountSats + routingFeeSats + platformFeeSats),
            paymentHash: result.payment_hash || '',
            newBalance: result.new_balance || 0,
            rawResponse: result,
        };
    }
    /**
     * Create a Lightning invoice to receive payment
     */
    async createInvoice(amountSats, memo) {
        const data = {
            amount_sats: amountSats,
        };
        if (memo) {
            data.memo = memo;
        }
        const result = await this.request('create_invoice', data);
        const bolt11 = result.bolt11 || result.invoice || result.payment_request;
        if (!bolt11) {
            throw new Error('No invoice returned from API');
        }
        return {
            bolt11,
            paymentHash: result.payment_hash || '',
            expiresAt: result.expires_at || '',
            rawResponse: result,
        };
    }
    /**
     * Check if an invoice has been paid
     */
    async getInvoiceStatus(paymentHash) {
        const result = await this.request('get_invoice_status', {
            payment_hash: paymentHash,
        });
        const paid = result.paid || result.settled || result.status === 'settled';
        return {
            paid,
            amountSats: result.amount_sats || 0,
            settledAt: result.settled_at,
            preimage: result.preimage,
            expired: result.expired || false,
            newBalance: result.new_balance,
            rawResponse: result,
        };
    }
    /**
     * Get transaction history
     */
    async getTransactions(limit = 50, offset = 0) {
        const result = await this.request('get_transactions', {
            limit,
            offset,
        });
        const transactions = (result.transactions || []).map(tx => ({
            type: (tx.type === 'deposit' || tx.type === 'incoming' || tx.amount_sats > 0
                ? 'incoming' : 'outgoing'),
            amount_sats: Math.abs(tx.amount_sats),
            fee_sats: tx.fee_sats,
            memo: tx.memo || tx.description,
            payment_hash: tx.payment_hash,
            timestamp: tx.timestamp || tx.created_at || tx.settled_at,
            balance_after: tx.balance_after,
        }));
        return {
            transactions,
            total: result.total || transactions.length,
            has_more: result.has_more || false,
            rawResponse: result,
        };
    }
    // ==========================================
    // OPERATOR MANAGEMENT METHODS
    // ==========================================
    /**
     * Create a deposit invoice to fund the operator account
     */
    async getDepositInvoice(amountSats) {
        const result = await this.request('create_deposit', {
            amount_sats: amountSats,
        });
        const bolt11 = result.bolt11 || result.invoice;
        if (!bolt11) {
            throw new Error('No invoice returned from API');
        }
        // Compute expires_at from expires_in if not provided
        let expiresAt = result.expires_at || '';
        if (!expiresAt && result.expires_in) {
            const expiryDate = new Date(Date.now() + result.expires_in * 1000);
            expiresAt = expiryDate.toISOString();
        }
        return {
            bolt11,
            paymentHash: result.payment_hash || '',
            expiresAt,
            paymentUrl: result.payment_url,
            qrUrl: result.qr_url,
            rawResponse: result,
        };
    }
    /**
     * Create a new agent under this operator
     */
    async createAgent(name, description, budgetLimitSats) {
        const data = { name };
        if (description)
            data.description = description;
        if (budgetLimitSats !== undefined)
            data.budget_limit_sats = budgetLimitSats;
        const result = await this.request('create_agent', data);
        const apiKey = result.agent_api_key || result.api_key;
        if (!apiKey) {
            throw new Error('No agent API key returned');
        }
        return {
            agentId: result.agent_id || 0,
            agentApiKey: apiKey,
            name: result.name || name,
            rawResponse: result,
        };
    }
    /**
     * Fund an agent from operator balance
     */
    async fundAgent(agentId, amountSats) {
        const result = await this.request('fund_agent', {
            agent_id: agentId,
            amount_sats: amountSats,
        });
        return {
            newOperatorBalance: result.operator_balance || result.new_operator_balance || 0,
            newAgentBalance: result.agent_balance || result.new_agent_balance || 0,
            amountTransferred: result.transferred || result.amount_transferred || amountSats,
            rawResponse: result,
        };
    }
    /**
     * List all agents under this operator
     */
    async listAgents() {
        const result = await this.request('list_agents');
        const agents = (result.agents || []).map(agent => ({
            id: agent.id,
            name: agent.name,
            balance_sats: agent.balance_sats,
            is_active: agent.is_active,
        }));
        return {
            agents,
            rawResponse: result,
        };
    }
    /**
     * Get current context (operator or agent info)
     */
    async whoami() {
        const result = await this.request('whoami');
        return {
            type: result.type || 'agent',
            id: result.id || 0,
            name: result.name || 'Unknown',
            balanceSats: result.balance_sats || 0,
            agentCount: result.agent_count,
            budgetLimitSats: result.budget_limit_sats,
            operatorId: result.operator_id,
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 1: Webhook Management
    // ==========================================
    /**
     * Register a webhook to receive event notifications
     */
    async registerWebhook(url, events = ['invoice_paid']) {
        const result = await this.request('register_webhook', { url, events });
        return {
            webhookId: result.webhook_id || 0,
            url: result.url || url,
            events: result.events || events,
            secret: result.secret || '',
            rawResponse: result,
        };
    }
    /**
     * List all registered webhooks
     */
    async listWebhooks() {
        const result = await this.request('list_webhooks');
        const webhooks = (result.webhooks || []).map(w => {
            let events;
            if (Array.isArray(w.events)) {
                events = w.events;
            }
            else {
                try {
                    events = JSON.parse(w.events || '[]');
                }
                catch {
                    // Handle malformed JSON gracefully
                    events = [];
                }
            }
            return {
                id: w.id,
                url: w.url,
                events,
                isActive: w.is_active,
                lastDeliveredAt: w.last_delivered_at,
                failureCount: w.failure_count,
            };
        });
        return { webhooks, rawResponse: result };
    }
    /**
     * Delete a webhook
     */
    async deleteWebhook(webhookId) {
        const result = await this.request('delete_webhook', {
            webhook_id: webhookId,
        });
        return {
            message: result.message || 'Webhook deleted',
            rawResponse: result,
        };
    }
    /**
     * Send a test event to a webhook
     */
    async testWebhook(webhookId) {
        const result = await this.request('test_webhook', { webhook_id: webhookId });
        return {
            message: result.message || 'Test event queued',
            deliveryId: result.delivery_id,
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 1: Budget Management
    // ==========================================
    /**
     * Get budget status for an agent
     */
    async getBudgetStatus(agentId) {
        const data = {};
        if (agentId)
            data.agent_id = agentId;
        const result = await this.request('get_budget_status', data);
        const budgetLimit = result.budget_limit_sats ?? null;
        const totalSpent = result.total_spent_sats || result.total_spent || 0;
        return {
            agentId: result.agent_id || agentId || 0,
            budgetLimitSats: budgetLimit,
            totalSpentSats: totalSpent,
            remainingSats: budgetLimit !== null ? budgetLimit - totalSpent : null,
            hasBudget: budgetLimit !== null,
            rawResponse: result,
        };
    }
    /**
     * Set budget limit for an agent
     */
    async setBudget(agentId, budgetLimitSats) {
        const result = await this.request('update_agent', {
            agent_id: agentId,
            updates: { budget_limit_sats: budgetLimitSats === 0 ? null : budgetLimitSats },
        });
        return {
            agentId: result.agent_id || agentId,
            newBudgetLimitSats: budgetLimitSats,
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 1: Agent Lifecycle
    // ==========================================
    /**
     * Deactivate an agent
     */
    async deactivateAgent(agentId) {
        const result = await this.request('update_agent', {
            agent_id: agentId,
            updates: { is_active: false },
        });
        return {
            agentId,
            message: result.message || 'Agent deactivated',
            rawResponse: result,
        };
    }
    /**
     * Reactivate an agent
     */
    async reactivateAgent(agentId) {
        const result = await this.request('update_agent', {
            agent_id: agentId,
            updates: { is_active: true },
        });
        return {
            agentId,
            message: result.message || 'Agent reactivated',
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 1: Recovery & Key Rotation
    // ==========================================
    /**
     * Recover an operator account using recovery code
     * Note: This is a static-like method but needs to use the request infrastructure
     */
    async recoverAccount(recoveryCode) {
        // Recovery doesn't need auth, so we make a direct request
        const response = await fetch(API_BASE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'recover',
                recovery_code: recoveryCode,
            }),
        });
        if (!response.ok) {
            throw new Error(`Request failed (HTTP ${response.status})`);
        }
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Recovery failed');
        }
        return {
            operatorId: result.operator_id || 0,
            apiKey: result.api_key || '',
            cooldownUntil: result.cooldown_until,
            rawResponse: result,
        };
    }
    /**
     * Rotate API key (operator or agent)
     */
    async rotateApiKey(agentId) {
        const action = agentId ? 'regenerate_agent_key' : 'regenerate_operator_key';
        const data = {};
        if (agentId)
            data.agent_id = agentId;
        const result = await this.request(action, data);
        return {
            apiKey: result.api_key || result.new_api_key || '',
            message: result.message || 'API key rotated',
            cooldownUntil: result.cooldown_until,
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 2: Service Info & Invoice Decoding
    // ==========================================
    /**
     * Get service info and capabilities
     */
    async getInfo() {
        const result = await this.request('get_info');
        return {
            version: result.version || '2.0.0',
            apiVersion: result.api_version || '1.0',
            status: result.status || 'operational',
            maxPaymentSats: result.max_payment_sats || 1000000,
            minPaymentSats: result.min_payment_sats || 1,
            supportedFeatures: result.supported_features || ['l402', 'webhooks', 'lightning_address'],
            rawResponse: result,
        };
    }
    /**
     * Decode a BOLT11 invoice without paying
     */
    async decodeInvoice(bolt11) {
        const result = await this.request('decode_invoice', { invoice: bolt11 });
        const amountSats = result.amount_sats || parseInt(result.num_satoshis || '0', 10);
        const timestamp = result.timestamp ? parseInt(result.timestamp, 10) : 0;
        const expiry = result.expiry ? parseInt(result.expiry, 10) : 3600;
        const expiresAt = result.expires_at || new Date((timestamp + expiry) * 1000).toISOString();
        const isExpired = result.is_expired ?? (timestamp + expiry < Date.now() / 1000);
        return {
            amountSats,
            description: result.description || '',
            paymentHash: result.payment_hash || '',
            destination: result.destination || '',
            expiresAt,
            isExpired,
            createdAt: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
            rawResponse: result,
        };
    }
    /**
     * Get current rate limit status
     */
    async getRateLimits() {
        const result = await this.request('get_rate_limits');
        return {
            requestsPerMinute: result.requests_per_minute || result.rate_limit_per_minute || 60,
            requestsRemaining: result.requests_remaining || 60,
            resetAt: result.reset_at || new Date(Date.now() + 60000).toISOString(),
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 3: Withdrawals & Advanced Payments
    // ==========================================
    /**
     * Withdraw to external Lightning invoice
     */
    async withdraw(invoice) {
        const result = await this.request('withdraw', { invoice });
        const amountSats = result.amount_sats || 0;
        const routingFeeSats = result.routing_fee_sats || 0;
        const platformFeeSats = result.platform_fee_sats || 0;
        return {
            amountSats,
            routingFeeSats,
            platformFeeSats,
            totalCost: result.total_cost || (amountSats + routingFeeSats + platformFeeSats),
            paymentHash: result.payment_hash || '',
            newBalance: result.new_balance || 0,
            rawResponse: result,
        };
    }
    /**
     * Create an LNURL-withdraw link for the operator to receive funds.
     * Opens in browser for QR code scanning with any Lightning wallet.
     */
    async createWithdrawLink(amountSats) {
        const params = {};
        if (amountSats !== undefined) {
            params.amount_sats = amountSats;
        }
        const result = await this.request('create_withdraw_link', params);
        return {
            lnurl: result.lnurl || '',
            paymentUrl: result.payment_url || '',
            qrUrl: result.qr_url || '',
            amountSats: result.amount_sats || 0,
            platformFeeSats: result.platform_fee_sats || 0,
            maxRoutingFeeSats: result.max_routing_fee_sats || 0,
            totalDebitSats: result.total_debit_sats || 0,
            expiresAt: result.expires_at || '',
            rawResponse: result,
        };
    }
    /**
     * Sweep funds from agent back to operator
     */
    async sweepAgent(agentId, amountSats) {
        const result = await this.request('withdraw_from_agent', {
            agent_id: agentId,
            amount_sats: amountSats,
            sweep: true,
        });
        return {
            amountTransferred: result.amount_transferred || amountSats,
            newOperatorBalance: result.new_operator_balance || 0,
            newAgentBalance: result.new_agent_balance || 0,
            rawResponse: result,
        };
    }
    /**
     * Pay to a Lightning address
     */
    async payLightningAddress(address, amountSats, comment) {
        await this.enforcePrePaymentPolicy({
            protocol: 'lnaddress',
            destinationOrUrl: address,
            amountSats,
            maxPaymentSats: amountSats,
            method: null,
        });
        const data = {
            address,
            amount_sats: amountSats,
        };
        if (comment)
            data.comment = comment;
        const result = await this.request('pay_lightning_address', data);
        return {
            amountSats: result.amount_sats || amountSats,
            feeSats: result.fee_sats || 0,
            paymentHash: result.payment_hash || '',
            newBalance: result.new_balance || 0,
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 4: Advanced Agent Management
    // ==========================================
    /**
     * Transfer between agents or from operator to agent
     */
    async transferToAgent(toAgentId, amountSats, fromAgentId) {
        // If fromAgentId is provided, it's agent-to-agent; otherwise operator-to-agent
        if (fromAgentId) {
            // This would need a new backend endpoint for agent-to-agent
            const result = await this.request('transfer_between_agents', {
                from_agent_id: fromAgentId,
                to_agent_id: toAgentId,
                amount_sats: amountSats,
            });
            return {
                amountTransferred: result.amount_transferred || amountSats,
                fromBalance: result.from_balance || 0,
                toBalance: result.to_balance || 0,
                rawResponse: result,
            };
        }
        else {
            // Use existing fund_agent
            const result = await this.fundAgent(toAgentId, amountSats);
            return {
                amountTransferred: result.amountTransferred,
                fromBalance: result.newOperatorBalance,
                toBalance: result.newAgentBalance,
                rawResponse: result.rawResponse,
            };
        }
    }
    /**
     * Delete an agent permanently
     */
    async deleteAgent(agentId) {
        const result = await this.request('delete_agent', { agent_id: agentId });
        return {
            message: result.message || 'Agent deleted',
            balanceReturned: result.balance_returned || 0,
            rawResponse: result,
        };
    }
    // ==========================================
    // TIER 5: Protocol Extensions
    // ==========================================
    /**
     * Authenticate with LNURL-auth
     */
    async lnurlAuth(lnurl) {
        const result = await this.request('lnurl_auth', { lnurl });
        return {
            message: result.message || 'Authentication successful',
            domain: result.domain || '',
            rawResponse: result,
        };
    }
    /**
     * Claim funds from LNURL-withdraw
     */
    async claimLnurlWithdraw(lnurl) {
        const result = await this.request('claim_lnurl_withdraw', { lnurl });
        return {
            message: result.message || 'Withdrawal claimed',
            amountSats: result.amount_sats || 0,
            paymentHash: result.payment_hash || '',
            newBalance: result.new_balance || 0,
            rawResponse: result,
        };
    }
    /**
     * Send keysend payment
     */
    async keysend(destination, amountSats, message) {
        await this.enforcePrePaymentPolicy({
            protocol: 'keysend',
            destinationOrUrl: destination,
            amountSats,
            maxPaymentSats: amountSats,
            method: null,
        });
        const data = {
            destination,
            amount_sats: amountSats,
        };
        if (message)
            data.message = message;
        const result = await this.request('keysend', data);
        const amt = result.amount_sats || amountSats;
        const routingFeeSats = result.routing_fee_sats || 0;
        const platformFeeSats = result.platform_fee_sats || 0;
        return {
            preimage: result.preimage || '',
            amountSats: amt,
            routingFeeSats,
            platformFeeSats,
            totalCost: result.total_cost || (amt + routingFeeSats + platformFeeSats),
            newBalance: result.new_balance || 0,
            rawResponse: result,
        };
    }
    // ==========================================
    // NOSTR IDENTITY & ZAPS
    // ==========================================
    /**
     * Set Nostr identity for the agent (generates keypair from private key)
     */
    async setNostrIdentity(privateKey) {
        const result = await this.request('set_nostr_identity', { private_key: privateKey });
        return {
            publicKey: result.public_key || '',
            npub: result.npub || '',
            rawResponse: result,
        };
    }
    /**
     * Get the agent's Nostr identity (public key only)
     */
    async getNostrIdentity() {
        const result = await this.request('get_nostr_identity');
        return {
            publicKey: result.public_key || '',
            npub: result.npub || '',
            hasIdentity: result.has_identity || !!result.public_key,
            rawResponse: result,
        };
    }
    /**
     * Send a Nostr zap (NIP-57 Lightning payment with Nostr event)
     * Falls back to regular Lightning address payment if recipient doesn't support NIP-57
     */
    async nostrZap(address, amountSats, recipientPubkey, content, eventId, relays) {
        // A Nostr zap settles as a Lightning-address payment, so it is an agent spend
        // and must pass the policy hook like any other.
        await this.enforcePrePaymentPolicy({
            protocol: 'lnaddress',
            destinationOrUrl: address,
            amountSats,
            maxPaymentSats: amountSats,
            method: null,
        });
        const data = {
            address,
            amount_sats: amountSats,
        };
        if (recipientPubkey)
            data.recipient_pubkey = recipientPubkey;
        if (content)
            data.content = content;
        if (eventId)
            data.event_id = eventId;
        if (relays)
            data.relays = relays;
        const result = await this.request('nostr_zap', data);
        return {
            amountSats: result.amount_sats || amountSats,
            feeSats: result.fee_sats || 0,
            paymentHash: result.payment_hash || '',
            newBalance: result.new_balance || 0,
            zapType: result.zap_type || 'fallback',
            rawResponse: result,
        };
    }
    // ==========================================
    // MESSAGE BOARD METHODS
    // ==========================================
    /**
     * Read board posts (public — no auth required, but works with auth too)
     */
    async boardRead(sort = 'trending', topic, limit = 20, offset = 0) {
        const data = { sort, limit, offset };
        if (topic)
            data.topic = topic;
        return this.request('board_read', data);
    }
    /**
     * Post a message to the board
     */
    async boardPost(content, topic) {
        const data = { content };
        if (topic)
            data.topic = topic;
        return this.request('board_post', data);
    }
    /**
     * Reply to an existing post
     */
    async boardReply(postId, content) {
        return this.request('board_reply', {
            post_id: postId,
            content,
        });
    }
    /**
     * Vote on a post
     */
    async boardVote(postId, direction) {
        return this.request('board_vote', {
            post_id: postId,
            direction,
        });
    }
}
exports.LightningFaucetClient = LightningFaucetClient;
// Static method for registration (no API key needed)
async function registerOperator(name, email) {
    const payload = {
        action: 'register',
        name: name || 'AI Agent Operator',
    };
    if (email) {
        payload.email = email;
    }
    const response = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Request failed (HTTP ${response.status})`);
    }
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || 'Registration failed');
    }
    if (!result.api_key) {
        throw new Error('No API key returned');
    }
    return {
        operatorId: result.operator_id || 0,
        apiKey: result.api_key,
        recoveryCode: result.recovery_code || '',
    };
}
