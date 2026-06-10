/**
 * Lightning Faucet API Client
 *
 * Handles communication with the Lightning Faucet AI Agent Wallet API.
 */

const API_BASE_URL = process.env.LIGHTNING_WALLET_API_URL || 'https://lightningfaucet.com/ai-agents/api';

// Response interfaces
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
  payment_protocol?: 'l402' | 'x402';
  usdc_amount?: number;
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
  tip?: string;
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

// Operator management interfaces
interface RegisterResponse extends ApiResponse {
  operator_id?: number;
  api_key?: string;
  recovery_code?: string;
  message?: string;
}

interface DepositInvoiceResponse extends ApiResponse {
  bolt11?: string;
  invoice?: string;
  payment_hash?: string;
  amount_sats?: number;
  expires_at?: string;
  expires_in?: number;  // Backend returns seconds until expiry
  payment_url?: string;
  qr_url?: string;
}

interface CreateAgentResponse extends ApiResponse {
  agent_id?: number;
  agent_api_key?: string;
  api_key?: string;  // Backend returns this field name
  name?: string;
  message?: string;
}

interface FundAgentResponse extends ApiResponse {
  operator_balance?: number;
  agent_balance?: number;
  transferred?: number;
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
  agent_count?: number;  // For operators
  budget_limit_sats?: number;  // For agents
  operator_id?: number;  // For agents
}

export class LightningFaucetClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Make an API request to Lightning Faucet
   */
  private async request<T extends ApiResponse>(
    action: string,
    data: Record<string, unknown> = {}
  ): Promise<T> {
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

    const result = await response.json() as T;

    if (!result.success) {
      throw new Error(result.error || 'Unknown API error');
    }

    return result;
  }

  /**
   * Check the agent's current balance
   */
  async checkBalance(): Promise<{
    balanceSats: number;
    rawResponse: BalanceResponse;
  }> {
    const result = await this.request<BalanceResponse>('get_balance');
    return {
      balanceSats: result.balance_sats || result.balance || 0,
      rawResponse: result,
    };
  }

  /**
   * Pay an L402-protected API endpoint
   */
  async l402Pay(
    url: string,
    method: string = 'GET',
    body?: string,
    maxPaymentSats: number = 1000
  ): Promise<{
    data: unknown;
    statusCode: number;
    paymentHash?: string;
    amountPaid?: number;
    fee?: number;
    paymentProtocol?: 'l402' | 'x402';
    usdcAmount?: number;
    rawResponse: L402PayResponse;
  }> {
    const requestData: Record<string, unknown> = {
      url,
      method: method.toUpperCase(),
      max_payment_sats: maxPaymentSats,
    };

    if (body) {
      requestData.body = body;
    }

    const result = await this.request<L402PayResponse>('l402_pay', requestData);

    let responseData: unknown;
    if (result.body) {
      try {
        responseData = JSON.parse(result.body);
      } catch {
        responseData = result.body;
      }
    } else {
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
  async payInvoice(
    bolt11: string,
    maxFeeSats?: number
  ): Promise<{
    preimage: string;
    amountSats: number;
    routingFeeSats: number;
    platformFeeSats: number;
    totalCost: number;
    paymentHash: string;
    newBalance: number;
    rawResponse: PayInvoiceResponse;
  }> {
    const data: Record<string, unknown> = {
      invoice: bolt11,
    };

    if (maxFeeSats !== undefined) {
      data.max_fee_sats = maxFeeSats;
    }

    const result = await this.request<PayInvoiceResponse>('pay_invoice', data);

    const amountSats = result.amount_sats || result.amount_paid || 0;
    const routingFeeSats = (result as any).routing_fee_sats || 0;
    const platformFeeSats = (result as any).platform_fee_sats || 0;

    return {
      preimage: result.preimage || result.payment_preimage || '',
      amountSats,
      routingFeeSats,
      platformFeeSats,
      totalCost: (result as any).total_cost || (amountSats + routingFeeSats + platformFeeSats),
      paymentHash: result.payment_hash || '',
      newBalance: result.new_balance || 0,
      rawResponse: result,
    };
  }

  /**
   * Create a Lightning invoice to receive payment
   */
  async createInvoice(
    amountSats: number,
    memo?: string
  ): Promise<{
    bolt11: string;
    paymentHash: string;
    expiresAt: string;
    rawResponse: CreateInvoiceResponse;
  }> {
    const data: Record<string, unknown> = {
      amount_sats: amountSats,
    };

    if (memo) {
      data.memo = memo;
    }

    const result = await this.request<CreateInvoiceResponse>('create_invoice', data);

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
  async getInvoiceStatus(paymentHash: string): Promise<{
    paid: boolean;
    amountSats: number;
    settledAt?: string;
    preimage?: string;
    expired: boolean;
    newBalance?: number;
    rawResponse: InvoiceStatusResponse;
  }> {
    const result = await this.request<InvoiceStatusResponse>('get_invoice_status', {
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
  async getTransactions(
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    transactions: Array<{
      type: 'incoming' | 'outgoing';
      amount_sats: number;
      fee_sats?: number;
      memo?: string;
      payment_hash?: string;
      timestamp?: string;
      balance_after?: number;
    }>;
    total: number;
    has_more: boolean;
    rawResponse: GetTransactionsResponse;
  }> {
    const result = await this.request<GetTransactionsResponse>('get_transactions', {
      limit,
      offset,
    });

    const transactions = (result.transactions || []).map(tx => ({
      type: (tx.type === 'deposit' || tx.type === 'incoming' || tx.amount_sats > 0
        ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing',
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
  async getDepositInvoice(amountSats: number): Promise<{
    bolt11: string;
    paymentHash: string;
    expiresAt: string;
    paymentUrl?: string;
    qrUrl?: string;
    rawResponse: DepositInvoiceResponse;
  }> {
    const result = await this.request<DepositInvoiceResponse>('create_deposit', {
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
  async createAgent(
    name: string,
    description?: string,
    budgetLimitSats?: number
  ): Promise<{
    agentId: number;
    agentApiKey: string;
    name: string;
    rawResponse: CreateAgentResponse;
  }> {
    const data: Record<string, unknown> = { name };
    if (description) data.description = description;
    if (budgetLimitSats !== undefined) data.budget_limit_sats = budgetLimitSats;

    const result = await this.request<CreateAgentResponse>('create_agent', data);

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
  async fundAgent(
    agentId: number,
    amountSats: number
  ): Promise<{
    newOperatorBalance: number;
    newAgentBalance: number;
    amountTransferred: number;
    rawResponse: FundAgentResponse;
  }> {
    const result = await this.request<FundAgentResponse>('fund_agent', {
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
  async listAgents(): Promise<{
    agents: Array<{
      id: number;
      name: string;
      balance_sats: number;
      is_active: boolean;
    }>;
    rawResponse: ListAgentsResponse;
  }> {
    const result = await this.request<ListAgentsResponse>('list_agents');

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
  async whoami(): Promise<{
    type: 'operator' | 'agent';
    id: number;
    name: string;
    balanceSats: number;
    agentCount?: number;  // For operators
    budgetLimitSats?: number;  // For agents
    operatorId?: number;  // For agents
    rawResponse: WhoamiResponse;
  }> {
    const result = await this.request<WhoamiResponse>('whoami');

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
  async registerWebhook(
    url: string,
    events: string[] = ['invoice_paid']
  ): Promise<{
    webhookId: number;
    url: string;
    events: string[];
    secret: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      webhook_id?: number;
      url?: string;
      events?: string[];
      secret?: string;
    }>('register_webhook', { url, events });

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
  async listWebhooks(): Promise<{
    webhooks: Array<{
      id: number;
      url: string;
      events: string[];
      isActive: boolean;
      lastDeliveredAt?: string;
      failureCount: number;
    }>;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      webhooks?: Array<{
        id: number;
        url: string;
        events: string | string[];
        is_active: boolean;
        last_delivered_at?: string;
        failure_count: number;
      }>;
    }>('list_webhooks');

    const webhooks = (result.webhooks || []).map(w => {
      let events: string[];
      if (Array.isArray(w.events)) {
        events = w.events;
      } else {
        try {
          events = JSON.parse(w.events || '[]');
        } catch {
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
  async deleteWebhook(webhookId: number): Promise<{
    message: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & { message?: string }>('delete_webhook', {
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
  async testWebhook(webhookId: number): Promise<{
    message: string;
    deliveryId?: number;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      message?: string;
      delivery_id?: number;
    }>('test_webhook', { webhook_id: webhookId });

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
  async getBudgetStatus(agentId?: number): Promise<{
    agentId: number;
    budgetLimitSats: number | null;
    totalSpentSats: number;
    remainingSats: number | null;
    hasBudget: boolean;
    rawResponse: ApiResponse;
  }> {
    const data: Record<string, unknown> = {};
    if (agentId) data.agent_id = agentId;

    const result = await this.request<ApiResponse & {
      agent_id?: number;
      budget_limit_sats?: number | null;
      total_spent?: number;
      total_spent_sats?: number;
      remaining_sats?: number | null;
      has_budget?: boolean;
    }>('get_budget_status', data);

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
  async setBudget(agentId: number, budgetLimitSats: number): Promise<{
    agentId: number;
    newBudgetLimitSats: number;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      agent_id?: number;
      budget_limit_sats?: number;
    }>('update_agent', {
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
  async deactivateAgent(agentId: number): Promise<{
    agentId: number;
    message: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & { message?: string }>('update_agent', {
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
  async reactivateAgent(agentId: number): Promise<{
    agentId: number;
    message: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & { message?: string }>('update_agent', {
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
  async recoverAccount(recoveryCode: string): Promise<{
    operatorId: number;
    apiKey: string;
    cooldownUntil?: string;
    rawResponse: ApiResponse;
  }> {
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

    const result = await response.json() as ApiResponse & {
      operator_id?: number;
      api_key?: string;
      cooldown_until?: string;
    };

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
  async rotateApiKey(agentId?: number): Promise<{
    apiKey: string;
    message: string;
    cooldownUntil?: string;
    rawResponse: ApiResponse;
  }> {
    const action = agentId ? 'regenerate_agent_key' : 'regenerate_operator_key';
    const data: Record<string, unknown> = {};
    if (agentId) data.agent_id = agentId;

    const result = await this.request<ApiResponse & {
      api_key?: string;
      new_api_key?: string;
      message?: string;
      cooldown_until?: string;
    }>(action, data);

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
  async getInfo(): Promise<{
    version: string;
    apiVersion: string;
    status: string;
    maxPaymentSats: number;
    minPaymentSats: number;
    supportedFeatures: string[];
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      version?: string;
      api_version?: string;
      status?: string;
      max_payment_sats?: number;
      min_payment_sats?: number;
      supported_features?: string[];
    }>('get_info');

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
  async decodeInvoice(bolt11: string): Promise<{
    amountSats: number;
    description: string;
    paymentHash: string;
    destination: string;
    expiresAt: string;
    isExpired: boolean;
    createdAt?: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      amount_sats?: number;
      num_satoshis?: string;
      description?: string;
      payment_hash?: string;
      destination?: string;
      timestamp?: string;
      expiry?: string;
      expires_at?: string;
      is_expired?: boolean;
    }>('decode_invoice', { invoice: bolt11 });

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
  async getRateLimits(): Promise<{
    requestsPerMinute: number;
    requestsRemaining: number;
    resetAt: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      requests_per_minute?: number;
      rate_limit_per_minute?: number;
      requests_remaining?: number;
      reset_at?: string;
    }>('get_rate_limits');

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
  async withdraw(invoice: string): Promise<{
    amountSats: number;
    routingFeeSats: number;
    platformFeeSats: number;
    totalCost: number;
    paymentHash: string;
    newBalance: number;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      amount_sats?: number;
      routing_fee_sats?: number;
      platform_fee_sats?: number;
      total_cost?: number;
      payment_hash?: string;
      new_balance?: number;
    }>('withdraw', { invoice });

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
  async createWithdrawLink(amountSats?: number): Promise<{
    lnurl: string;
    paymentUrl: string;
    qrUrl: string;
    amountSats: number;
    platformFeeSats: number;
    maxRoutingFeeSats: number;
    totalDebitSats: number;
    expiresAt: string;
    rawResponse: ApiResponse;
  }> {
    const params: Record<string, unknown> = {};
    if (amountSats !== undefined) {
      params.amount_sats = amountSats;
    }

    const result = await this.request<ApiResponse & {
      lnurl?: string;
      payment_url?: string;
      qr_url?: string;
      amount_sats?: number;
      platform_fee_sats?: number;
      max_routing_fee_sats?: number;
      total_debit_sats?: number;
      expires_at?: string;
    }>('create_withdraw_link', params);

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
  async sweepAgent(agentId: number, amountSats: number): Promise<{
    amountTransferred: number;
    newOperatorBalance: number;
    newAgentBalance: number;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      amount_transferred?: number;
      new_operator_balance?: number;
      new_agent_balance?: number;
    }>('withdraw_from_agent', {
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
  async payLightningAddress(
    address: string,
    amountSats: number,
    comment?: string
  ): Promise<{
    amountSats: number;
    feeSats: number;
    paymentHash: string;
    newBalance: number;
    rawResponse: ApiResponse;
  }> {
    const data: Record<string, unknown> = {
      address,
      amount_sats: amountSats,
    };
    if (comment) data.comment = comment;

    const result = await this.request<ApiResponse & {
      amount_sats?: number;
      fee_sats?: number;
      payment_hash?: string;
      new_balance?: number;
    }>('pay_lightning_address', data);

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
  async transferToAgent(
    toAgentId: number,
    amountSats: number,
    fromAgentId?: number
  ): Promise<{
    amountTransferred: number;
    fromBalance: number;
    toBalance: number;
    rawResponse: ApiResponse;
  }> {
    // If fromAgentId is provided, it's agent-to-agent; otherwise operator-to-agent
    if (fromAgentId) {
      // This would need a new backend endpoint for agent-to-agent
      const result = await this.request<ApiResponse & {
        amount_transferred?: number;
        from_balance?: number;
        to_balance?: number;
      }>('transfer_between_agents', {
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
    } else {
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
  async deleteAgent(agentId: number): Promise<{
    message: string;
    balanceReturned: number;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      message?: string;
      balance_returned?: number;
    }>('delete_agent', { agent_id: agentId });

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
  async lnurlAuth(lnurl: string): Promise<{
    message: string;
    domain: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      message?: string;
      domain?: string;
    }>('lnurl_auth', { lnurl });

    return {
      message: result.message || 'Authentication successful',
      domain: result.domain || '',
      rawResponse: result,
    };
  }

  /**
   * Claim funds from LNURL-withdraw
   */
  async claimLnurlWithdraw(lnurl: string): Promise<{
    message: string;
    amountSats: number;
    paymentHash: string;
    newBalance: number;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      message?: string;
      amount_sats?: number;
      payment_hash?: string;
      new_balance?: number;
    }>('claim_lnurl_withdraw', { lnurl });

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
  async keysend(
    destination: string,
    amountSats: number,
    message?: string
  ): Promise<{
    preimage: string;
    amountSats: number;
    routingFeeSats: number;
    platformFeeSats: number;
    totalCost: number;
    newBalance: number;
    rawResponse: ApiResponse;
  }> {
    const data: Record<string, unknown> = {
      destination,
      amount_sats: amountSats,
    };
    if (message) data.message = message;

    const result = await this.request<ApiResponse & {
      preimage?: string;
      amount_sats?: number;
      routing_fee_sats?: number;
      platform_fee_sats?: number;
      total_cost?: number;
      new_balance?: number;
    }>('keysend', data);

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
  async setNostrIdentity(privateKey: string): Promise<{
    publicKey: string;
    npub: string;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      public_key?: string;
      npub?: string;
    }>('set_nostr_identity', { private_key: privateKey });

    return {
      publicKey: result.public_key || '',
      npub: result.npub || '',
      rawResponse: result,
    };
  }

  /**
   * Get the agent's Nostr identity (public key only)
   */
  async getNostrIdentity(): Promise<{
    publicKey: string;
    npub: string;
    hasIdentity: boolean;
    rawResponse: ApiResponse;
  }> {
    const result = await this.request<ApiResponse & {
      public_key?: string;
      npub?: string;
      has_identity?: boolean;
    }>('get_nostr_identity');

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
  async nostrZap(
    address: string,
    amountSats: number,
    recipientPubkey?: string,
    content?: string,
    eventId?: string,
    relays?: string[]
  ): Promise<{
    amountSats: number;
    feeSats: number;
    paymentHash: string;
    newBalance: number;
    zapType: 'nip57' | 'fallback';
    rawResponse: ApiResponse;
  }> {
    const data: Record<string, unknown> = {
      address,
      amount_sats: amountSats,
    };
    if (recipientPubkey) data.recipient_pubkey = recipientPubkey;
    if (content) data.content = content;
    if (eventId) data.event_id = eventId;
    if (relays) data.relays = relays;

    const result = await this.request<ApiResponse & {
      amount_sats?: number;
      fee_sats?: number;
      payment_hash?: string;
      new_balance?: number;
      zap_type?: 'nip57' | 'fallback';
    }>('nostr_zap', data);

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
  async boardRead(
    sort: string = 'trending',
    topic?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { sort, limit, offset };
    if (topic) data.topic = topic;
    return this.request<ApiResponse & Record<string, unknown>>('board_read', data);
  }

  /**
   * Post a message to the board
   */
  async boardPost(
    content: string,
    topic?: string
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { content };
    if (topic) data.topic = topic;
    return this.request<ApiResponse & Record<string, unknown>>('board_post', data);
  }

  /**
   * Reply to an existing post
   */
  async boardReply(
    postId: number,
    content: string
  ): Promise<Record<string, unknown>> {
    return this.request<ApiResponse & Record<string, unknown>>('board_reply', {
      post_id: postId,
      content,
    });
  }

  /**
   * Vote on a post
   */
  async boardVote(
    postId: number,
    direction: string
  ): Promise<Record<string, unknown>> {
    return this.request<ApiResponse & Record<string, unknown>>('board_vote', {
      post_id: postId,
      direction,
    });
  }

  /**
   * Update operator profile (email and/or name). Setting an email sends a
   * verification link - a verified email is required for the free-sats promo.
   */
  async updateOperator(opts: { email?: string; name?: string }): Promise<ApiResponse & {
    message?: string;
    updated_fields?: string[];
    email_verification?: string;
  }> {
    const params: Record<string, unknown> = {};
    if (opts.email !== undefined) params.email = opts.email;
    if (opts.name !== undefined) params.name = opts.name;
    return this.request('update_operator', params);
  }

  /**
   * Claim a promo bonus (default: the first_100_installs free-sats promo).
   * Requires a verified email and an operator account at least 24 hours old.
   */
  async claimPromo(promoCode?: string): Promise<ApiResponse & {
    promo?: string;
    bonus_sats?: number;
    message?: string;
  }> {
    const params: Record<string, unknown> = {};
    if (promoCode) params.promo_code = promoCode;
    return this.request('claim_promo', params);
  }
}

// Static method for registration (no API key needed)
export async function registerOperator(name?: string, email?: string): Promise<{
  operatorId: number;
  apiKey: string;
  recoveryCode: string;
}> {
  const payload: Record<string, string> = {
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

  const result = await response.json() as RegisterResponse;

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


// Public service info (no API key needed)
export async function getPublicInfo(): Promise<{
  version: string;
  apiVersion: string;
  status: string;
  maxPaymentSats: number;
  minPaymentSats: number;
  supportedFeatures: string[];
  rawResponse: ApiResponse;
}> {
  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_info' }),
  });
  if (!response.ok) {
    throw new Error(`Request failed (HTTP ${response.status})`);
  }
  const result = (await response.json()) as ApiResponse & {
    version?: string;
    api_version?: string;
    status?: string;
    max_payment_sats?: number;
    min_payment_sats?: number;
    supported_features?: string[];
  };
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
