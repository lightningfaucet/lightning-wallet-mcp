"use strict";
/**
 * Lightning Faucet API Client
 *
 * Handles communication with the Lightning Faucet AI Agent Wallet API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LightningFaucetClient = void 0;
exports.registerOperator = registerOperator;
const API_BASE_URL = 'https://lightningfaucet.com/ai-agents/api';
class LightningFaucetClient {
    apiKey;
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('API key is required');
        }
        this.apiKey = apiKey;
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
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
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
            rawResponse: result,
        };
    }
    /**
     * Pay a BOLT11 Lightning invoice
     */
    async payInvoice(bolt11, maxFeeSats) {
        const data = {
            invoice: bolt11,
        };
        if (maxFeeSats !== undefined) {
            data.max_fee_sats = maxFeeSats;
        }
        const result = await this.request('pay_invoice', data);
        return {
            preimage: result.preimage || result.payment_preimage || '',
            amountSats: result.amount_sats || result.amount_paid || 0,
            feeSats: result.fee_sats || result.fee || 0,
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
            amountSats: Math.abs(tx.amount_sats),
            feeSats: tx.fee_sats,
            memo: tx.memo || tx.description,
            paymentHash: tx.payment_hash,
            timestamp: tx.timestamp || tx.created_at || tx.settled_at,
            balanceAfter: tx.balance_after,
        }));
        return {
            transactions,
            total: result.total || transactions.length,
            hasMore: result.has_more || false,
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
            newOperatorBalance: result.new_operator_balance || 0,
            newAgentBalance: result.new_agent_balance || 0,
            amountTransferred: result.amount_transferred || amountSats,
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
            balanceSats: agent.balance_sats,
            isActive: agent.is_active,
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
        const webhooks = (result.webhooks || []).map(w => ({
            id: w.id,
            url: w.url,
            events: Array.isArray(w.events) ? w.events : JSON.parse(w.events || '[]'),
            isActive: w.is_active,
            lastDeliveredAt: w.last_delivered_at,
            failureCount: w.failure_count,
        }));
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
            throw new Error(`HTTP error: ${response.status}`);
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
        return {
            amountSats: result.amount_sats || 0,
            feeSats: result.fee_sats || 0,
            paymentHash: result.payment_hash || '',
            newBalance: result.new_balance || 0,
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
    /**
     * Export transactions in specified format
     */
    async exportTransactions(format = 'json', startDate, endDate, includePending = false) {
        const data = {
            format,
            include_pending: includePending,
        };
        if (startDate)
            data.start_date = startDate;
        if (endDate)
            data.end_date = endDate;
        const result = await this.request('export_transactions', data);
        return {
            format: result.format || format,
            count: result.count || (result.transactions?.length || 0),
            data: format === 'csv' ? result.csv : (result.data || result.transactions),
            rawResponse: result,
        };
    }
    /**
     * Get analytics for an agent
     */
    async getAgentAnalytics(agentId, period = '30d') {
        const data = { period };
        if (agentId)
            data.agent_id = agentId;
        const result = await this.request('get_agent_analytics', data);
        return {
            agentId: result.agent_id || agentId || 0,
            period: result.period || period,
            totalSpent: result.total_spent || 0,
            totalReceived: result.total_received || 0,
            transactionCount: result.transaction_count || 0,
            averagePayment: result.average_payment || 0,
            topDestinations: result.top_destinations || [],
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
        const data = {
            destination,
            amount_sats: amountSats,
        };
        if (message)
            data.message = message;
        const result = await this.request('keysend', data);
        return {
            preimage: result.preimage || '',
            amountSats: result.amount_sats || amountSats,
            feeSats: result.fee_sats || 0,
            newBalance: result.new_balance || 0,
            rawResponse: result,
        };
    }
}
exports.LightningFaucetClient = LightningFaucetClient;
// Static method for registration (no API key needed)
async function registerOperator(name) {
    const payload = {
        action: 'register',
        name: name || 'AI Agent Operator',
    };
    const response = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
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
//# sourceMappingURL=lightning-faucet.js.map