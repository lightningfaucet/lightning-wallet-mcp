"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_TOOL_NAMES = exports.AGENT_TOOLS = void 0;
exports.verifyFair = verifyFair;
exports.handleAgentTool = handleAgentTool;
/**
 * Agent-coverage tools (v1.10): actions the Lightning Faucet API already serves that
 * had no MCP tool, plus L402 discovery, generic provably-fair verification, and read-only
 * views of Pick'em and the human tournament lobby.
 *
 * Kept in its own module so the big tool switch in index.ts only gains a dispatch hook.
 *
 * Deliberately NOT included:
 *  - Free-spin / faucet claims: one claim per human account, gated by email, device and IP
 *    checks. An agent claiming would be farming by definition, so there is no agent path.
 *  - Pick'em entry and human tournament join: both need a person's account session and pay
 *    bonus sats, which would open multi-account farming. Agents have the Agent Arena for
 *    tournaments and prediction markets for forecasting; these tools are read-only views.
 */
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const lightning_faucet_js_1 = require("./lightning-faucet.js");
const PLATFORM_API_URL = process.env.LIGHTNING_WALLET_PLATFORM_URL || 'https://lightningfaucet.com/api/';
const L402_WELL_KNOWN_URL = 'https://lightningfaucet.com/.well-known/l402.json';
/** Cap on text returned in one tool result so a huge export cannot flood the model context. */
const MAX_TEXT_CHARS = 60_000;
const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const typedError = (error, message, extra = {}) => ({
    content: [{ type: 'text', text: JSON.stringify({ success: false, error, message, ...extra }, null, 2) }],
    isError: true,
});
// ─── Schemas ────────────────────────────────────────────────────────────
const LinkUserSchema = zod_1.z.object({
    recovery_code: zod_1.z.string().min(8).max(128).describe('Recovery code of the Lightning Faucet website account to link'),
    merge_balance: zod_1.z.boolean().default(false).describe('Also move this operator balance into the website account. Default false'),
    confirm: zod_1.z.literal(true).describe('Must be true. Linking is permanent and a balance merge cannot be undone'),
});
const ExportTransactionsSchema = zod_1.z.object({
    format: zod_1.z.enum(['json', 'csv']).default('json').describe('Output format'),
    start_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/).optional().describe('Inclusive start, YYYY-MM-DD'),
    end_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/).optional().describe('Inclusive end, YYYY-MM-DD'),
    include_pending: zod_1.z.boolean().default(false).describe('Include pending transactions'),
});
const AgentAnalyticsSchema = zod_1.z.object({
    period: zod_1.z.enum(['24h', '7d', '30d', 'all']).default('30d').describe('Reporting window'),
});
const GatewayCatalogSchema = zod_1.z.object({
    category: zod_1.z.string().min(1).max(40).optional().describe('Category filter'),
    page: zod_1.z.number().int().min(1).default(1),
    page_size: zod_1.z.number().int().min(1).max(50).default(20),
});
const GatewayRegisterSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100).describe('Public name of the paid endpoint'),
    description: zod_1.z.string().max(500).optional(),
    upstream_url: zod_1.z.string().url().describe('Public URL your endpoint proxies to. Private and localhost addresses are refused'),
    upstream_method: zod_1.z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
    price_sats: zod_1.z.number().int().positive().describe('Price per call in sats'),
    category: zod_1.z.string().min(1).max(40).optional().describe('Catalog category'),
    upstream_headers: zod_1.z.record(zod_1.z.string()).optional().describe('Headers sent to your upstream (for example its own auth)'),
    upstream_timeout_ms: zod_1.z.number().int().min(1000).max(30000).optional(),
});
const GatewayUpdateSchema = zod_1.z.object({
    endpoint_id: zod_1.z.number().int().positive(),
    name: zod_1.z.string().min(1).max(100).optional(),
    description: zod_1.z.string().max(500).optional(),
    price_sats: zod_1.z.number().int().positive().optional(),
    upstream_url: zod_1.z.string().url().optional(),
    upstream_method: zod_1.z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    upstream_headers: zod_1.z.record(zod_1.z.string()).optional(),
    upstream_timeout_ms: zod_1.z.number().int().min(1000).max(30000).optional(),
});
const GatewayIdSchema = zod_1.z.object({ endpoint_id: zod_1.z.number().int().positive().describe('Endpoint id from gateway_list') });
const GatewayDeleteSchema = zod_1.z.object({
    endpoint_id: zod_1.z.number().int().positive(),
    confirm: zod_1.z.literal(true).describe('Must be true. Deleting an endpoint frees its slug and stops all sales'),
});
const GatewayProbeSchema = zod_1.z.object({
    upstream_url: zod_1.z.string().url(),
    upstream_method: zod_1.z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
    upstream_headers: zod_1.z.record(zod_1.z.string()).optional(),
});
const ListL402Schema = zod_1.z.object({
    source: zod_1.z.enum(['first_party', 'registry', 'discovered', 'gateway']).default('registry')
        .describe('first_party: Lightning Faucet own priced endpoints. registry: community directory. discovered: endpoints seen in real L402 payments. gateway: seller endpoints on our gateway'),
    category: zod_1.z.string().min(1).max(40).optional().describe('registry and gateway: category filter (registry: demo, finance, data, ai, other)'),
    search: zod_1.z.string().min(1).max(100).optional().describe('registry: match on name or provider'),
    limit: zod_1.z.number().int().min(1).max(50).default(20).describe('Rows per page'),
    page: zod_1.z.number().int().min(1).default(1),
});
const VerifyFairSchema = zod_1.z.object({
    server_seed: zod_1.z.string().min(1).max(256).describe('The revealed server seed'),
    client_seed: zod_1.z.string().min(1).max(128).describe('The client seed used for the roll'),
    nonce: zod_1.z.number().int().min(0).describe('The nonce that roll consumed (the pre-increment value)'),
    server_seed_hash: zod_1.z.string().regex(/^[0-9a-fA-F]{64}$/).optional().describe('The SHA-256 commitment shown before the roll. If given, it is checked against server_seed'),
    claimed_result: zod_1.z.number().int().min(0).optional().describe('The roll or result the game reported. If given, it is compared to the recomputed value for result_type'),
    result_type: zod_1.z.enum(['dice', 'roll']).optional().describe('Which mapping claimed_result uses: dice (0-9999, default) or roll (0-99999)'),
});
const PickemBrowseSchema = zod_1.z.object({
    week: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Week key (YYYY-MM-DD, a Monday) from the weeks list. Default current week'),
});
const TournamentListSchema = zod_1.z.object({
    game_type: zod_1.z.string().min(1).max(30).optional().describe('Filter by game type, for example slots, blackjack, dice'),
});
// ─── Tool definitions ───────────────────────────────────────────────────
const GATEWAY_KEYS = 'REQUIRES OPERATOR KEY.';
exports.AGENT_TOOLS = [
    {
        name: 'link_user',
        description: 'Link this operator account to a Lightning Faucet website account using that account\'s recovery code, so the same person sees both. The link is permanent. merge_balance defaults to false; true also moves the operator balance into the website account and cannot be undone. confirm must be true. REQUIRES OPERATOR KEY.',
        inputSchema: {
            type: 'object',
            properties: {
                recovery_code: { type: 'string', description: 'Recovery code of the website account' },
                merge_balance: { type: 'boolean', default: false, description: 'Also move the operator balance (irreversible). Default false' },
                confirm: { type: 'boolean', enum: [true], description: 'Must be true' },
            },
            required: ['recovery_code', 'confirm'],
        },
    },
    {
        name: 'export_transactions',
        description: 'Export this agent\'s transaction history as JSON or CSV for accounting, optionally for a date range. Read-only. Large exports are truncated to about 60k characters with truncated:true; narrow the dates and call again. REQUIRES AGENT KEY.',
        inputSchema: {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
                start_date: { type: 'string', description: 'Inclusive start, YYYY-MM-DD' },
                end_date: { type: 'string', description: 'Inclusive end, YYYY-MM-DD' },
                include_pending: { type: 'boolean', default: false },
            },
        },
    },
    {
        name: 'get_agent_analytics',
        description: 'Spending and earning analytics for this agent over a window: total spent and received, transaction count, average payment, and top L402 destinations. Read-only. REQUIRES AGENT KEY.',
        inputSchema: {
            type: 'object',
            properties: { period: { type: 'string', enum: ['24h', '7d', '30d', 'all'], default: '30d' } },
        },
    },
    {
        name: 'gateway_catalog',
        description: 'Browse the public catalog of paid endpoints that sellers have published on the Lightning Faucet L402 gateway. Public, no key. Pair with pay_l402_api to buy one.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string' },
                page: { type: 'integer', minimum: 1, default: 1 },
                page_size: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
        },
    },
    {
        name: 'gateway_probe',
        description: 'Test that a URL you want to sell is reachable and returns something sensible, before gateway_register. Makes one request to the URL from our servers; private and localhost addresses are refused. Read-only on our side. ' + GATEWAY_KEYS,
        inputSchema: {
            type: 'object',
            properties: {
                upstream_url: { type: 'string' },
                upstream_method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
                upstream_headers: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['upstream_url'],
        },
    },
    {
        name: 'gateway_register',
        description: 'Seller side: put your HTTP endpoint behind an L402 paywall on our gateway. Callers pay price_sats over Lightning per request and we proxy to upstream_url. The upstream is probed first and registration fails if it is unreachable. Registering does not spend funds. ' + GATEWAY_KEYS,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', maxLength: 100 },
                description: { type: 'string', maxLength: 500 },
                upstream_url: { type: 'string' },
                upstream_method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
                price_sats: { type: 'integer', minimum: 1 },
                category: { type: 'string' },
                upstream_headers: { type: 'object', additionalProperties: { type: 'string' } },
                upstream_timeout_ms: { type: 'integer', minimum: 1000, maximum: 30000 },
            },
            required: ['name', 'upstream_url', 'price_sats'],
        },
    },
    {
        name: 'gateway_list',
        description: 'Seller side: list your gateway endpoints with status, price and slug. Read-only. ' + GATEWAY_KEYS,
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'gateway_update',
        description: 'Seller side: change the name, description, price or upstream of one of your gateway endpoints. Only the fields you pass change. ' + GATEWAY_KEYS,
        inputSchema: {
            type: 'object',
            properties: {
                endpoint_id: { type: 'integer', minimum: 1 },
                name: { type: 'string' },
                description: { type: 'string' },
                price_sats: { type: 'integer', minimum: 1 },
                upstream_url: { type: 'string' },
                upstream_method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
                upstream_headers: { type: 'object', additionalProperties: { type: 'string' } },
                upstream_timeout_ms: { type: 'integer', minimum: 1000, maximum: 30000 },
            },
            required: ['endpoint_id'],
        },
    },
    {
        name: 'gateway_pause',
        description: 'Seller side: stop selling an endpoint without deleting it. Reversible with gateway_resume. ' + GATEWAY_KEYS,
        inputSchema: { type: 'object', properties: { endpoint_id: { type: 'integer', minimum: 1 } }, required: ['endpoint_id'] },
    },
    {
        name: 'gateway_resume',
        description: 'Seller side: resume a paused endpoint. ' + GATEWAY_KEYS,
        inputSchema: { type: 'object', properties: { endpoint_id: { type: 'integer', minimum: 1 } }, required: ['endpoint_id'] },
    },
    {
        name: 'gateway_delete',
        description: 'Seller side: permanently delete a gateway endpoint. Prefer gateway_pause if you may want it back. confirm must be true. ' + GATEWAY_KEYS,
        inputSchema: {
            type: 'object',
            properties: { endpoint_id: { type: 'integer', minimum: 1 }, confirm: { type: 'boolean', enum: [true] } },
            required: ['endpoint_id', 'confirm'],
        },
    },
    {
        name: 'gateway_stats',
        description: 'Seller side: calls, revenue and recent activity for one of your gateway endpoints. Read-only. ' + GATEWAY_KEYS,
        inputSchema: { type: 'object', properties: { endpoint_id: { type: 'integer', minimum: 1 } }, required: ['endpoint_id'] },
    },
    {
        name: 'list_l402_apis',
        description: 'Discover L402 APIs you can pay for with pay_l402_api. source=first_party lists Lightning Faucet\'s own priced endpoints with live prices; registry is the community directory (filter by category or search); discovered lists endpoints seen in real L402 payments; gateway lists seller endpoints on our gateway. Public, no key, read-only.',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', enum: ['first_party', 'registry', 'discovered', 'gateway'], default: 'registry' },
                category: { type: 'string' },
                search: { type: 'string' },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
                page: { type: 'integer', minimum: 1, default: 1 },
            },
        },
    },
    {
        name: 'verify_fair',
        description: 'Verify a provably fair result locally, with no network call and no key. Recomputes HMAC-SHA256(server_seed, client_seed + ":" + nonce), derives the roll (first 8 hex digits as an integer, modulo 100000, then modulo 10000 for the 0-9999 dice range), optionally checks the SHA-256 commitment you saw before the roll (server_seed_hash) and compares your claimed_result. Works for Agent Arena dice and Lightning Faucet casino dice; returns the full hash so other games can apply their own mapping. Use the nonce the roll consumed, not the next one.',
        inputSchema: {
            type: 'object',
            properties: {
                server_seed: { type: 'string', description: 'Revealed server seed' },
                client_seed: { type: 'string' },
                nonce: { type: 'integer', minimum: 0, description: 'Nonce the roll consumed' },
                server_seed_hash: { type: 'string', description: 'Optional SHA-256 commitment to check' },
                claimed_result: { type: 'integer', minimum: 0, description: 'Optional reported roll to compare' },
                result_type: { type: 'string', enum: ['dice', 'roll'], default: 'dice', description: 'Mapping claimed_result uses: dice (0-9999) or roll (0-99999)' },
            },
            required: ['server_seed', 'client_seed', 'nonce'],
        },
    },
    {
        name: 'pickem_browse',
        description: 'Weekly Pick\'em (free NFL and college football contest with bonus sat prizes): this week\'s slate, lock times, results, prize ladder and standings. Public and read-only. Entering requires a person\'s website account at https://lightningfaucet.com/pickem/, so there is no agent entry tool; tell your human about it, or forecast the same games on prediction markets with prediction_markets.',
        inputSchema: {
            type: 'object',
            properties: { week: { type: 'string', description: 'Week key YYYY-MM-DD from the weeks list. Default current week' } },
        },
    },
    {
        name: 'tournament_list',
        description: 'List the human casino tournaments running now (slots, blackjack, dice and more): buy-in, prize pool, schedule, leaderboard. Public and read-only. These are for people with website accounts; agents compete in the Agent Arena instead (arena_list, arena_join).',
        inputSchema: {
            type: 'object',
            properties: { game_type: { type: 'string', description: 'Filter, for example slots' } },
        },
    },
];
exports.AGENT_TOOL_NAMES = new Set(exports.AGENT_TOOLS.map((t) => t.name));
// ─── Helpers ────────────────────────────────────────────────────────────
async function platformRead(action, data = {}) {
    const res = await (0, lightning_faucet_js_1.fetchWithTimeout)(PLATFORM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
    });
    if (!res.ok)
        throw new Error(`Request failed (HTTP ${res.status})`);
    const json = (await res.json());
    if (json.success === false)
        throw new lightning_faucet_js_1.ApiError(String(json.error ?? 'Unknown API error'), json);
    return json;
}
function truncate(text) {
    return text.length > MAX_TEXT_CHARS ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true } : { text, truncated: false };
}
/** Pure, exported for tests. */
function verifyFair(p) {
    const hash = (0, node_crypto_1.createHmac)('sha256', p.server_seed).update(`${p.client_seed}:${p.nonce}`).digest('hex');
    const roll = parseInt(hash.slice(0, 8), 16) % 100000;
    const dice = roll % 10000;
    const out = {
        success: true,
        hmac_sha256: hash,
        roll_0_99999: roll,
        dice_0_9999: dice,
        formula: 'hash = HMAC_SHA256(server_seed, client_seed + ":" + nonce); roll = int(hash[0:8], 16) % 100000; dice = roll % 10000',
    };
    if (p.server_seed_hash) {
        const commit = (0, node_crypto_1.createHash)('sha256').update(p.server_seed).digest('hex');
        out.commitment_sha256 = commit;
        out.commitment_matches = commit.toLowerCase() === p.server_seed_hash.toLowerCase();
    }
    if (p.claimed_result !== undefined) {
        out.claimed_result = p.claimed_result;
        const resultType = p.result_type ?? 'dice';
        out.result_type = resultType;
        out.result_matches = p.claimed_result === (resultType === 'roll' ? roll : dice);
    }
    const checks = [out.commitment_matches, out.result_matches].filter((v) => v !== undefined);
    out.verified = checks.length > 0 ? checks.every(Boolean) : null;
    if (checks.length === 0)
        out.note = 'Pass server_seed_hash and/or claimed_result to get a verified true/false.';
    return out;
}
function summarizeTournament(t) {
    const keep = ['id', 'name', 'tier_label', 'game_type', 'schedule', 'status', 'entrants', 'start_at', 'end_at', 'buy_in_sats', 'spins_per_entry', 'prize_pool_sats', 'guarantee_sats', 'prize_structure', 'entry_count', 'player_count', 'time_remaining_seconds'];
    const out = {};
    for (const k of keep)
        if (t[k] !== undefined)
            out[k] = t[k];
    if (Array.isArray(t.leaderboard))
        out.top_5 = t.leaderboard.slice(0, 5).map((r) => ({ rank: r.rank, player: r.player, score: r.score }));
    return out;
}
/** Agent-scoped actions answer "Unknown operator action" to an operator key; say what to do instead. */
async function agentOnly(tool, run) {
    try {
        return await run();
    }
    catch (e) {
        if (e instanceof lightning_faucet_js_1.ApiError && /unknown operator action/i.test(e.message)) {
            throw new lightning_faucet_js_1.ApiError('requires_agent_key', {
                success: false,
                error: 'requires_agent_key',
                hint: `${tool} runs as one agent. You are using an operator key: use set_agent_credentials with that agent's key (agent_...), then call ${tool} again.`,
            });
        }
        throw e;
    }
}
// ─── Dispatch ───────────────────────────────────────────────────────────
/** Returns a result for tools owned by this module, or null so the caller continues. */
async function handleAgentTool(name, args, session) {
    if (!exports.AGENT_TOOL_NAMES.has(name))
        return null;
    const a = args ?? {};
    switch (name) {
        case 'link_user': {
            const p = LinkUserSchema.parse(a);
            return ok(await session.requireClient().rawAction('link_user', { recovery_code: p.recovery_code, merge_balance: p.merge_balance }));
        }
        case 'export_transactions': {
            const p = ExportTransactionsSchema.parse(a);
            const data = { format: p.format, include_pending: p.include_pending };
            if (p.start_date)
                data.start_date = p.start_date;
            if (p.end_date)
                data.end_date = p.end_date;
            const r = await agentOnly('export_transactions', () => session.requireClient().rawAction('export_transactions', data));
            if (typeof r.csv === 'string') {
                const t = truncate(r.csv);
                return ok({ ...r, csv: t.text, truncated: t.truncated, ...(t.truncated ? { next: 'Output was cut. Narrow start_date and end_date and call again.' } : {}) });
            }
            const s = JSON.stringify(r);
            if (s.length > MAX_TEXT_CHARS && Array.isArray(r.transactions)) {
                let rows = r.transactions;
                while (rows.length > 1 && JSON.stringify(rows).length > MAX_TEXT_CHARS)
                    rows = rows.slice(0, Math.ceil(rows.length / 2));
                return ok({ ...r, transactions: rows, truncated: true, returned: rows.length, next: 'Output was cut. Narrow start_date and end_date and call again.' });
            }
            return ok(r);
        }
        case 'get_agent_analytics': {
            const p = AgentAnalyticsSchema.parse(a);
            return ok(await agentOnly('get_agent_analytics', () => session.requireClient().rawAction('get_agent_analytics', { period: p.period })));
        }
        case 'gateway_catalog': {
            const p = GatewayCatalogSchema.parse(a);
            const c = session.getClient();
            const data = { ...p };
            return ok(c ? await c.rawAction('gateway_catalog', data) : await (0, lightning_faucet_js_1.getPublicAction)('gateway_catalog', data));
        }
        case 'gateway_probe': return ok(await session.requireClient().rawAction('gateway_probe', GatewayProbeSchema.parse(a)));
        case 'gateway_register': return ok(await session.requireClient().rawAction('gateway_register', GatewayRegisterSchema.parse(a)));
        case 'gateway_list': return ok(await session.requireClient().rawAction('gateway_list'));
        case 'gateway_update': return ok(await session.requireClient().rawAction('gateway_update', GatewayUpdateSchema.parse(a)));
        case 'gateway_pause': return ok(await session.requireClient().rawAction('gateway_pause', GatewayIdSchema.parse(a)));
        case 'gateway_resume': return ok(await session.requireClient().rawAction('gateway_resume', GatewayIdSchema.parse(a)));
        case 'gateway_delete': {
            const p = GatewayDeleteSchema.parse(a);
            return ok(await session.requireClient().rawAction('gateway_delete', { endpoint_id: p.endpoint_id }));
        }
        case 'gateway_stats': return ok(await session.requireClient().rawAction('gateway_stats', GatewayIdSchema.parse(a)));
        case 'list_l402_apis': {
            const p = ListL402Schema.parse(a);
            if (p.source === 'first_party') {
                const res = await (0, lightning_faucet_js_1.fetchWithTimeout)(L402_WELL_KNOWN_URL, { method: 'GET', headers: { Accept: 'application/json' } });
                if (!res.ok)
                    return typedError('upstream_unavailable', `Could not read ${L402_WELL_KNOWN_URL} (HTTP ${res.status}). Try again shortly.`);
                return ok({ success: true, source: 'first_party', source_url: L402_WELL_KNOWN_URL, discovery: await res.json() });
            }
            const act = p.source === 'registry' ? 'registry_list' : p.source === 'discovered' ? 'get_l402_discovered' : 'gateway_catalog';
            const data = p.source === 'discovered' ? { limit: p.limit, page: p.page } : { page: p.page, page_size: p.limit };
            if (p.category && p.source !== 'discovered')
                data.category = p.category;
            if (p.search && p.source === 'registry')
                data.search = p.search;
            const c = session.getClient();
            const r = c ? await c.rawAction(act, data) : await (0, lightning_faucet_js_1.getPublicAction)(act, data);
            return ok({ source: p.source, ...r, next: 'Call an entry with pay_l402_api (set max_payment_sats).' });
        }
        case 'verify_fair': return ok(verifyFair(VerifyFairSchema.parse(a)));
        case 'pickem_browse': {
            const p = PickemBrowseSchema.parse(a);
            const r = await platformRead('pickem_state', p.week ? { week: p.week } : {});
            return ok({ ...r, enter_at: 'https://lightningfaucet.com/pickem/', agent_entry: 'not available: entry needs a person\'s website account. Forecast the same games with prediction_markets.' });
        }
        case 'tournament_list': {
            const p = TournamentListSchema.parse(a);
            const r = await platformRead('get_active_tournaments');
            let list = Array.isArray(r.tournaments) ? r.tournaments : [];
            if (p.game_type)
                list = list.filter((t) => t.game_type === p.game_type);
            return ok({ success: true, count: list.length, tournaments: list.map(summarizeTournament), join_at: 'https://lightningfaucet.com/casino/', agent_tournaments: 'Use arena_list and arena_join for tournaments agents can enter.' });
        }
        default:
            return null;
    }
}
