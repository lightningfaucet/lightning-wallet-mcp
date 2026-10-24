#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Lightning Wallet remote MCP server (Streamable HTTP, stateless, JSON responses).
 *
 * Serves the same tools as the stdio package at POST /mcp so hosted AI apps and agent
 * frameworks can use Lightning Faucet without installing anything. Phase 1 auth: the
 * caller's own operator (lf_...) or agent (agent_...) key in "Authorization: Bearer".
 * The server stores no keys; every request builds a fresh, request-scoped session.
 *
 * Security model:
 *  - No key: only a small public read-only tool set (remote-policy ANON_TOOLS).
 *  - Key-management tools that need a local credentials file are stdio only.
 *  - Kill switch (LF_MCP_KILL_SWITCH=1, or the LF_MCP_KILL_SWITCH_FILE path existing)
 *    refuses every money-moving tool immediately, no restart needed for the file form.
 *  - Outbound requests are pinned to the Lightning Faucet API (no SSRF), and the real
 *    caller address is forwarded so backend per-IP limits keep working.
 *  - Body cap, result cap, per-IP and per-key rate limits, Origin and Host validation.
 *  - Logs carry tool name, a key hash prefix and the amount. Never a key.
 *
 * Env:
 *  LF_MCP_HOST (127.0.0.1)  LF_MCP_PORT (8893)
 *  LIGHTNING_WALLET_API_URL      agent API endpoint (default https://lightningfaucet.com/ai-agents/api)
 *  LF_MCP_TRUSTED_PROXIES        peers whose X-Real-IP / X-Forwarded-For are trusted (127.0.0.1,::1)
 *  LF_MCP_ALLOWED_HOSTS          accepted Host headers (lightningfaucet.com,www.lightningfaucet.com,localhost,127.0.0.1)
 *  LF_MCP_ALLOWED_ORIGINS        browser origins allowed (https://claude.ai,https://chatgpt.com,...)
 *  LF_MCP_MAX_BODY_BYTES (65536) LF_MCP_MAX_INFLIGHT (200)
 *  LF_MCP_RL_IP_PER_MIN (120)  LF_MCP_RL_ANON_TOOLS_PER_MIN (20)  LF_MCP_RL_KEY_TOOLS_PER_MIN (60)
 *  LF_MCP_RL_MONEY_PER_MIN (10)
 *  LF_MCP_KILL_SWITCH (0|1)  LF_MCP_KILL_SWITCH_FILE (unset)
 */
const node_async_hooks_1 = require("node:async_hooks");
const node_fs_1 = require("node:fs");
const node_http_1 = require("node:http");
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const lightning_faucet_js_1 = require("./lightning-faucet.js");
const tools_js_1 = require("./tools.js");
const remote_policy_js_1 = require("./remote-policy.js");
const PKG_VERSION = (() => {
    try {
        return require('../package.json').version;
    }
    catch {
        return '0.0.0';
    }
})();
const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v, d) => new Set((v ?? d).split(',').map((s) => s.trim()).filter(Boolean));
const HOST = env.LF_MCP_HOST || '127.0.0.1';
const PORT = num(env.LF_MCP_PORT, 8893);
const MAX_BODY_BYTES = num(env.LF_MCP_MAX_BODY_BYTES, 65_536);
const MAX_INFLIGHT = num(env.LF_MCP_MAX_INFLIGHT, 200);
const RL_IP_PER_MIN = num(env.LF_MCP_RL_IP_PER_MIN, 120);
const RL_ANON_TOOLS_PER_MIN = num(env.LF_MCP_RL_ANON_TOOLS_PER_MIN, 20);
const RL_KEY_TOOLS_PER_MIN = num(env.LF_MCP_RL_KEY_TOOLS_PER_MIN, 60);
const RL_MONEY_PER_MIN = num(env.LF_MCP_RL_MONEY_PER_MIN, 10);
const TRUSTED_PROXIES = list(env.LF_MCP_TRUSTED_PROXIES, '127.0.0.1,::1');
const ALLOWED_HOSTS = list(env.LF_MCP_ALLOWED_HOSTS, 'lightningfaucet.com,www.lightningfaucet.com,localhost,127.0.0.1');
const ALLOWED_ORIGINS = list(env.LF_MCP_ALLOWED_ORIGINS, 'https://claude.ai,https://chatgpt.com,https://chat.openai.com,https://lightningfaucet.com');
const KILL_SWITCH_FILE = env.LF_MCP_KILL_SWITCH_FILE || '';
function killSwitchOn() {
    if (env.LF_MCP_KILL_SWITCH === '1' || env.LF_MCP_KILL_SWITCH === 'true')
        return true;
    return KILL_SWITCH_FILE !== '' && (0, node_fs_1.existsSync)(KILL_SWITCH_FILE);
}
// ─── Outbound pinning (no SSRF) and caller-address forwarding ───────────
const API_URL = env.LIGHTNING_WALLET_API_URL || 'https://lightningfaucet.com/ai-agents/api';
const PLATFORM_URL = env.LIGHTNING_WALLET_PLATFORM_URL || 'https://lightningfaucet.com/api/';
const L402_WELL_KNOWN = 'https://lightningfaucet.com/.well-known/l402.json';
/** Backends the agent API may live on: the public site, or the LAN backend Apache itself proxies to. */
const API_HOSTS = new Set(['lightningfaucet.com', '192.168.1.29', '127.0.0.1']);
function assertConfig() {
    const api = new URL(API_URL);
    if (!API_HOSTS.has(api.hostname))
        throw new Error(`LIGHTNING_WALLET_API_URL host ${api.hostname} is not an allowed Lightning Faucet backend`);
    if (new URL(PLATFORM_URL).hostname !== 'lightningfaucet.com')
        throw new Error('LIGHTNING_WALLET_PLATFORM_URL must be on lightningfaucet.com');
    // The pre-payment hook POSTs payment proposals to an arbitrary URL: fine for a local
    // install, never for a shared server.
    if (env.PRE_PAYMENT_HOOK_URL)
        throw new Error('PRE_PAYMENT_HOOK_URL must not be set on the remote server');
}
const requestContext = new node_async_hooks_1.AsyncLocalStorage();
const realFetch = globalThis.fetch.bind(globalThis);
function sameEndpoint(a, b) {
    const x = new URL(a), y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
}
/**
 * Every outbound request from tool code passes through here. Anything that is not one of the
 * three Lightning Faucet endpoints is refused, and agent API calls carry the caller's address
 * (both header and body, mirroring what lightningfaucet.com/ai-agents/api.php sends).
 */
const guardedFetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (sameEndpoint(url, L402_WELL_KNOWN) || sameEndpoint(url, PLATFORM_URL)) {
        return realFetch(input, init);
    }
    if (!sameEndpoint(url, API_URL)) {
        throw new Error('Outbound request blocked: the remote server only talks to the Lightning Faucet API');
    }
    const ip = requestContext.getStore()?.clientIp ?? null;
    if (!ip || (0, remote_policy_js_1.isPrivateIp)(ip)) {
        // Never vouch for a private address to the backend (it trusts this host as a proxy).
        throw new Error('Could not determine the caller address for this request');
    }
    const headers = new Headers(init?.headers);
    headers.set('X-Forwarded-For', ip);
    headers.set('User-Agent', `lightning-wallet-mcp-remote/${PKG_VERSION}`);
    let body = init?.body;
    if (typeof body === 'string' && body.length > 0) {
        const parsed = JSON.parse(body);
        parsed.ip_address = ip;
        body = JSON.stringify(parsed);
    }
    return realFetch(url, { ...init, headers, body });
};
globalThis.fetch = guardedFetch;
// ─── Per-request session (no persistence) ───────────────────────────────
const NO_STORE = {
    saveOperatorKey: () => null,
    saveAgentKey: () => null,
    forgetCredentials: () => false,
    describeCredentials: () => ({ persistence: 'none', mode: 'remote', note: 'The remote server never stores keys. Send yours on every request as Authorization: Bearer <key>.' }),
    credentialsPath: () => '',
};
class RequestSession {
    keySource;
    client;
    constructor(key) {
        this.client = key ? new lightning_faucet_js_1.LightningFaucetClient(key) : null;
        this.keySource = key ? 'header' : 'none';
    }
    getClient() { return this.client; }
    // rotate_api_key swaps to the new key; that only lives for the rest of this request.
    setClient(c) { this.client = c; }
    requireClient() {
        if (!this.client)
            throw new Error('This tool needs an API key. Send "Authorization: Bearer <lf_ or agent_ key>". Get one at https://lightningfaucet.com/ai-agents/.');
        return this.client;
    }
}
// ─── Logging ────────────────────────────────────────────────────────────
function log(fields) {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...fields }) + '\n');
}
// ─── MCP server per request ─────────────────────────────────────────────
const REMOTE_TOOLS = tools_js_1.TOOL_DEFINITIONS.filter((t) => !remote_policy_js_1.STDIO_ONLY_TOOLS.has(t.name));
const INSTRUCTIONS = [
    'Lightning Faucet: a Bitcoin Lightning wallet for AI agents (payments, L402 APIs, prediction markets, Agent Arena).',
    'Without a key you can use the public read-only tools: ' + [...remote_policy_js_1.ANON_TOOLS].join(', ') + '.',
    'Everything else needs your own key in the HTTP header "Authorization: Bearer <key>": an operator key (lf_...) or an agent key (agent_...). Agent keys are safer: they carry a budget and spend limits.',
    'Get a key at https://lightningfaucet.com/ai-agents/. The server never stores keys. Bets need an idempotency_key; pending payments must not be retried.',
].join(' ');
const limiter = new remote_policy_js_1.RateLimiter();
setInterval(() => limiter.sweep(), 60_000).unref();
function textError(error, message, extra = {}) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error, message, ...extra }, null, 2) }], isError: true };
}
function buildMcpServer(ctx) {
    const server = new index_js_1.Server({ name: 'lightning-wallet', version: PKG_VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools: REMOTE_TOOLS }));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const started = Date.now();
        const amount = (0, remote_policy_js_1.amountForLog)(name, args);
        const base = { evt: 'tool', tool: name, auth: ctx.tag, ip: ctx.clientIp, amount_sats: amount };
        const decision = (0, remote_policy_js_1.decideTool)(name, { authenticated: ctx.key !== null, killSwitch: killSwitchOn() });
        if (!decision.allow) {
            log({ ...base, outcome: decision.error });
            return textError(decision.error, decision.message);
        }
        const retry = ctx.key
            ? limiter.hit(`key:${ctx.tag}`, RL_KEY_TOOLS_PER_MIN, 60_000) || (decision.money ? limiter.hit(`money:${ctx.tag}`, RL_MONEY_PER_MIN, 60_000) : 0)
            : limiter.hit(`anon:${ctx.clientIp}`, RL_ANON_TOOLS_PER_MIN, 60_000);
        if (retry) {
            log({ ...base, outcome: 'rate_limited' });
            return textError('rate_limited', `Too many tool calls. Wait ${retry}s and try again.`, { retry_after_seconds: retry });
        }
        const session = new RequestSession(ctx.key);
        const result = await requestContext.run({ clientIp: ctx.clientIp }, () => (0, tools_js_1.callTool)(name, args, { session, creds: NO_STORE }));
        log({ ...base, outcome: result.isError ? 'error' : 'ok', ms: Date.now() - started });
        return (0, remote_policy_js_1.capResult)(result);
    });
    return server;
}
// ─── HTTP plumbing ──────────────────────────────────────────────────────
function sendJson(res, status, body, headers = {}) {
    if (res.headersSent)
        return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
}
function rpcError(res, status, code, message, headers = {}) {
    sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);
}
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) {
            resolve(null);
            req.resume();
            return;
        }
        const chunks = [];
        let size = 0;
        let over = false;
        req.on('data', (c) => {
            if (over)
                return;
            size += c.length;
            if (size > limit) {
                over = true;
                resolve(null);
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => { if (!over)
            resolve(Buffer.concat(chunks)); });
        req.on('error', reject);
    });
}
function corsHeaders(origin) {
    if (!origin)
        return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
        'Access-Control-Max-Age': '600',
    };
}
let inflight = 0;
async function handle(req, res) {
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    const clientIp = (0, remote_policy_js_1.resolveClientIp)(req.socket.remoteAddress, req.headers, TRUSTED_PROXIES);
    if (path === '/health' || path === '/mcp/health') {
        sendJson(res, 200, {
            ok: true,
            name: 'lightning-wallet-mcp-remote',
            version: PKG_VERSION,
            transport: 'streamable-http',
            money_tools_enabled: !killSwitchOn(),
            tools: REMOTE_TOOLS.length,
            anonymous_tools: remote_policy_js_1.ANON_TOOLS.size,
            money_tools: remote_policy_js_1.MONEY_TOOLS.size,
        });
        return;
    }
    if (path !== '/mcp') {
        sendJson(res, 404, { error: 'not_found' });
        return;
    }
    // DNS-rebinding protection (MCP spec): validate Host and Origin before anything else.
    if (!(0, remote_policy_js_1.hostAllowed)(req.headers.host, ALLOWED_HOSTS)) {
        rpcError(res, 403, -32000, 'Host not allowed');
        return;
    }
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (origin !== undefined && !(0, remote_policy_js_1.originAllowed)(origin, ALLOWED_ORIGINS)) {
        rpcError(res, 403, -32000, 'Origin not allowed');
        return;
    }
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
    }
    if (req.method !== 'POST') {
        // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
        rpcError(res, 405, -32000, 'Method not allowed. This is a stateless Streamable HTTP MCP endpoint: POST JSON-RPC to /mcp.', { Allow: 'POST, OPTIONS', ...cors });
        return;
    }
    const ipRetry = limiter.hit(`ip:${clientIp}`, RL_IP_PER_MIN, 60_000);
    if (ipRetry) {
        rpcError(res, 429, -32000, `Rate limit exceeded. Retry in ${ipRetry}s.`, { 'Retry-After': String(ipRetry), ...cors });
        return;
    }
    const bearer = (0, remote_policy_js_1.parseBearer)(req.headers.authorization);
    if (bearer.kind === 'invalid') {
        log({ evt: 'auth', outcome: 'malformed_key', ip: clientIp });
        rpcError(res, 401, -32001, 'Malformed Authorization header. Use "Authorization: Bearer <key>" with an operator key (lf_...) or agent key (agent_...), or omit it for public read-only tools.', cors);
        return;
    }
    const key = bearer.kind === 'key' ? bearer.key : null;
    const tag = key ? `key:${(0, remote_policy_js_1.keyTag)(key)}` : 'anon';
    if (inflight >= MAX_INFLIGHT) {
        rpcError(res, 503, -32000, 'Server busy, retry shortly.', { 'Retry-After': '5', ...cors });
        return;
    }
    inflight++;
    try {
        const raw = await readBody(req, MAX_BODY_BYTES);
        if (raw === null) {
            rpcError(res, 413, -32600, `Request body larger than ${MAX_BODY_BYTES} bytes`, cors);
            return;
        }
        let body;
        try {
            body = JSON.parse(raw.toString('utf8'));
        }
        catch {
            rpcError(res, 400, -32700, 'Parse error: body must be JSON', cors);
            return;
        }
        for (const [k, v] of Object.entries(cors))
            res.setHeader(k, v);
        res.setHeader('Cache-Control', 'no-store');
        const server = buildMcpServer({ key, tag, clientIp });
        const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
    }
    finally {
        inflight--;
    }
}
function main() {
    assertConfig();
    const httpServer = (0, node_http_1.createServer)((req, res) => {
        handle(req, res).catch((err) => {
            log({ evt: 'http_error', message: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
            rpcError(res, 500, -32603, 'Internal server error');
        });
    });
    httpServer.requestTimeout = 90_000;
    httpServer.headersTimeout = 15_000;
    httpServer.keepAliveTimeout = 5_000;
    httpServer.listen(PORT, HOST, () => {
        log({ evt: 'start', version: PKG_VERSION, host: HOST, port: PORT, api: new URL(API_URL).host, tools: REMOTE_TOOLS.length, money_tools_enabled: !killSwitchOn() });
    });
    const stop = () => httpServer.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}
main();
