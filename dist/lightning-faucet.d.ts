/**
 * Lightning Faucet API Client
 *
 * Handles communication with the Lightning Faucet AI Agent Wallet API.
 */
interface ApiResponse {
    success: boolean;
    error?: string;
}
interface BalanceResponse extends ApiResponse {
    balance_sats?: number;
    balance?: number;
}
interface L402PayResponse extends ApiResponse {
    data?: unknown;
    body?: string;
    status_code?: number;
    payment_hash?: string;
    amount_paid?: number;
    fee?: number;
}
interface PayInvoiceResponse extends ApiResponse {
    preimage?: string;
    payment_preimage?: string;
    amount_sats?: number;
    amount_paid?: number;
    fee_sats?: number;
    fee?: number;
    payment_hash?: string;
    total_cost?: number;
    new_balance?: number;
}
interface CreateInvoiceResponse extends ApiResponse {
    bolt11?: string;
    invoice?: string;
    payment_request?: string;
    payment_hash?: string;
    amount_sats?: number;
    memo?: string;
    expires_at?: string;
}
interface InvoiceStatusResponse extends ApiResponse {
    status?: string;
    paid?: boolean;
    settled?: boolean;
    amount_sats?: number;
    memo?: string;
    expires_at?: string;
    settled_at?: string;
    preimage?: string;
    expired?: boolean;
    new_balance?: number;
}
interface Transaction {
    type: string;
    amount_sats: number;
    fee_sats?: number;
    memo?: string;
    description?: string;
    payment_hash?: string;
    timestamp?: string;
    created_at?: string;
    settled_at?: string;
    destination?: string;
    balance_after?: number;
}
interface GetTransactionsResponse extends ApiResponse {
    transactions?: Transaction[];
    total?: number;
    has_more?: boolean;
}
interface DepositInvoiceResponse extends ApiResponse {
    bolt11?: string;
    invoice?: string;
    payment_hash?: string;
    amount_sats?: number;
    expires_at?: string;
    expires_in?: number;
    payment_url?: string;
    qr_url?: string;
}
interface CreateAgentResponse extends ApiResponse {
    agent_id?: number;
    agent_api_key?: string;
    api_key?: string;
    name?: string;
    message?: string;
}
interface FundAgentResponse extends ApiResponse {
    new_operator_balance?: number;
    new_agent_balance?: number;
    amount_transferred?: number;
}
interface Agent {
    id: number;
    name: string;
    balance_sats: number;
    is_active: boolean;
    created_at?: string;
}
interface ListAgentsResponse extends ApiResponse {
    agents?: Agent[];
}
interface WhoamiResponse extends ApiResponse {
    type?: 'operator' | 'agent';
    id?: number;
    name?: string;
    balance_sats?: number;
    agent_count?: number;
    budget_limit_sats?: number;
    operator_id?: number;
}
export declare class LightningFaucetClient {
    private apiKey;
    constructor(apiKey: string);
    /**
     * Make an API request to Lightning Faucet
     */
    private request;
    /**
     * Check the agent's current balance
     */
    checkBalance(): Promise<{
        balanceSats: number;
        rawResponse: BalanceResponse;
    }>;
    /**
     * Pay an L402-protected API endpoint
     */
    l402Pay(url: string, method?: string, body?: string, maxPaymentSats?: number): Promise<{
        data: unknown;
        statusCode: number;
        paymentHash?: string;
        amountPaid?: number;
        fee?: number;
        rawResponse: L402PayResponse;
    }>;
    /**
     * Pay a BOLT11 Lightning invoice
     */
    payInvoice(bolt11: string, maxFeeSats?: number): Promise<{
        preimage: string;
        amountSats: number;
        routingFeeSats: number;
        platformFeeSats: number;
        totalCost: number;
        paymentHash: string;
        newBalance: number;
        rawResponse: PayInvoiceResponse;
    }>;
    /**
     * Create a Lightning invoice to receive payment
     */
    createInvoice(amountSats: number, memo?: string): Promise<{
        bolt11: string;
        paymentHash: string;
        expiresAt: string;
        rawResponse: CreateInvoiceResponse;
    }>;
    /**
     * Check if an invoice has been paid
     */
    getInvoiceStatus(paymentHash: string): Promise<{
        paid: boolean;
        amountSats: number;
        settledAt?: string;
        preimage?: string;
        expired: boolean;
        newBalance?: number;
        rawResponse: InvoiceStatusResponse;
    }>;
    /**
     * Get transaction history
     */
    getTransactions(limit?: number, offset?: number): Promise<{
        transactions: Array<{
            type: 'incoming' | 'outgoing';
            amountSats: number;
            feeSats?: number;
            memo?: string;
            paymentHash?: string;
            timestamp?: string;
            balanceAfter?: number;
        }>;
        total: number;
        hasMore: boolean;
        rawResponse: GetTransactionsResponse;
    }>;
    /**
     * Create a deposit invoice to fund the operator account
     */
    getDepositInvoice(amountSats: number): Promise<{
        bolt11: string;
        paymentHash: string;
        expiresAt: string;
        paymentUrl?: string;
        qrUrl?: string;
        rawResponse: DepositInvoiceResponse;
    }>;
    /**
     * Create a new agent under this operator
     */
    createAgent(name: string, description?: string, budgetLimitSats?: number): Promise<{
        agentId: number;
        agentApiKey: string;
        name: string;
        rawResponse: CreateAgentResponse;
    }>;
    /**
     * Fund an agent from operator balance
     */
    fundAgent(agentId: number, amountSats: number): Promise<{
        newOperatorBalance: number;
        newAgentBalance: number;
        amountTransferred: number;
        rawResponse: FundAgentResponse;
    }>;
    /**
     * List all agents under this operator
     */
    listAgents(): Promise<{
        agents: Array<{
            id: number;
            name: string;
            balanceSats: number;
            isActive: boolean;
        }>;
        rawResponse: ListAgentsResponse;
    }>;
    /**
     * Get current context (operator or agent info)
     */
    whoami(): Promise<{
        type: 'operator' | 'agent';
        id: number;
        name: string;
        balanceSats: number;
        agentCount?: number;
        budgetLimitSats?: number;
        operatorId?: number;
        rawResponse: WhoamiResponse;
    }>;
    /**
     * Register a webhook to receive event notifications
     */
    registerWebhook(url: string, events?: string[]): Promise<{
        webhookId: number;
        url: string;
        events: string[];
        secret: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * List all registered webhooks
     */
    listWebhooks(): Promise<{
        webhooks: Array<{
            id: number;
            url: string;
            events: string[];
            isActive: boolean;
            lastDeliveredAt?: string;
            failureCount: number;
        }>;
        rawResponse: ApiResponse;
    }>;
    /**
     * Delete a webhook
     */
    deleteWebhook(webhookId: number): Promise<{
        message: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Send a test event to a webhook
     */
    testWebhook(webhookId: number): Promise<{
        message: string;
        deliveryId?: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Get budget status for an agent
     */
    getBudgetStatus(agentId?: number): Promise<{
        agentId: number;
        budgetLimitSats: number | null;
        totalSpentSats: number;
        remainingSats: number | null;
        hasBudget: boolean;
        rawResponse: ApiResponse;
    }>;
    /**
     * Set budget limit for an agent
     */
    setBudget(agentId: number, budgetLimitSats: number): Promise<{
        agentId: number;
        newBudgetLimitSats: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Deactivate an agent
     */
    deactivateAgent(agentId: number): Promise<{
        agentId: number;
        message: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Reactivate an agent
     */
    reactivateAgent(agentId: number): Promise<{
        agentId: number;
        message: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Recover an operator account using recovery code
     * Note: This is a static-like method but needs to use the request infrastructure
     */
    recoverAccount(recoveryCode: string): Promise<{
        operatorId: number;
        apiKey: string;
        cooldownUntil?: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Rotate API key (operator or agent)
     */
    rotateApiKey(agentId?: number): Promise<{
        apiKey: string;
        message: string;
        cooldownUntil?: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Get service info and capabilities
     */
    getInfo(): Promise<{
        version: string;
        apiVersion: string;
        status: string;
        maxPaymentSats: number;
        minPaymentSats: number;
        supportedFeatures: string[];
        rawResponse: ApiResponse;
    }>;
    /**
     * Decode a BOLT11 invoice without paying
     */
    decodeInvoice(bolt11: string): Promise<{
        amountSats: number;
        description: string;
        paymentHash: string;
        destination: string;
        expiresAt: string;
        isExpired: boolean;
        createdAt?: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Get current rate limit status
     */
    getRateLimits(): Promise<{
        requestsPerMinute: number;
        requestsRemaining: number;
        resetAt: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Withdraw to external Lightning invoice
     */
    withdraw(invoice: string): Promise<{
        amountSats: number;
        routingFeeSats: number;
        platformFeeSats: number;
        totalCost: number;
        paymentHash: string;
        newBalance: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Sweep funds from agent back to operator
     */
    sweepAgent(agentId: number, amountSats: number): Promise<{
        amountTransferred: number;
        newOperatorBalance: number;
        newAgentBalance: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Pay to a Lightning address
     */
    payLightningAddress(address: string, amountSats: number, comment?: string): Promise<{
        amountSats: number;
        feeSats: number;
        paymentHash: string;
        newBalance: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Export transactions in specified format
     */
    exportTransactions(format?: string, startDate?: string, endDate?: string, includePending?: boolean): Promise<{
        format: string;
        count: number;
        data: unknown;
        rawResponse: ApiResponse;
    }>;
    /**
     * Get analytics for an agent
     */
    getAgentAnalytics(agentId?: number, period?: string): Promise<{
        agentId: number;
        period: string;
        totalSpent: number;
        totalReceived: number;
        transactionCount: number;
        averagePayment: number;
        topDestinations: Array<{
            destination: string;
            count: number;
            total: number;
        }>;
        rawResponse: ApiResponse;
    }>;
    /**
     * Transfer between agents or from operator to agent
     */
    transferToAgent(toAgentId: number, amountSats: number, fromAgentId?: number): Promise<{
        amountTransferred: number;
        fromBalance: number;
        toBalance: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Delete an agent permanently
     */
    deleteAgent(agentId: number): Promise<{
        message: string;
        balanceReturned: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Authenticate with LNURL-auth
     */
    lnurlAuth(lnurl: string): Promise<{
        message: string;
        domain: string;
        rawResponse: ApiResponse;
    }>;
    /**
     * Claim funds from LNURL-withdraw
     */
    claimLnurlWithdraw(lnurl: string): Promise<{
        message: string;
        amountSats: number;
        paymentHash: string;
        newBalance: number;
        rawResponse: ApiResponse;
    }>;
    /**
     * Send keysend payment
     */
    keysend(destination: string, amountSats: number, message?: string): Promise<{
        preimage: string;
        amountSats: number;
        routingFeeSats: number;
        platformFeeSats: number;
        totalCost: number;
        newBalance: number;
        rawResponse: ApiResponse;
    }>;
}
export declare function registerOperator(name?: string): Promise<{
    operatorId: number;
    apiKey: string;
    recoveryCode: string;
}>;
export {};
//# sourceMappingURL=lightning-faucet.d.ts.map