/**
 * On-disk credential persistence for lightning-wallet-mcp.
 *
 * Problem this solves: MCP hosts (Claude Code, Cursor, ...) restart the server every session.
 * Before 1.6.0 a self-registered operator key lived only in process memory, so the next
 * session had no key and the model re-registered from scratch (new operator, no balance).
 *
 * Storage: $LIGHTNING_WALLET_HOME/credentials.json (default ~/.lightning-wallet), mode 0600.
 * Precedence at startup: LIGHTNING_WALLET_API_KEY env var > credentials file > nothing.
 * Set LIGHTNING_WALLET_NO_PERSIST=1 to disable all disk writes.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface StoredKey {
  api_key: string;
  id?: number;
  name?: string;
  saved_at: string;
}

export interface CredentialsFile {
  version: 1;
  api_url?: string;
  active: 'operator' | 'agent';
  operator?: StoredKey & { recovery_code?: string };
  agent?: StoredKey;
}

export function credentialsDir(): string {
  return process.env.LIGHTNING_WALLET_HOME || path.join(os.homedir(), '.lightning-wallet');
}

export function credentialsPath(): string {
  return path.join(credentialsDir(), 'credentials.json');
}

export function persistenceDisabled(): boolean {
  const v = (process.env.LIGHTNING_WALLET_NO_PERSIST || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function loadCredentials(): CredentialsFile | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    const parsed = JSON.parse(raw) as CredentialsFile;
    if (!parsed || parsed.version !== 1) return null;
    if (parsed.active !== 'operator' && parsed.active !== 'agent') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The key that should be used at startup when no env var is set (null if none saved). */
export function activeStoredKey(creds: CredentialsFile | null): { api_key: string; type: 'operator' | 'agent' } | null {
  if (!creds) return null;
  const entry = creds.active === 'agent' ? creds.agent : creds.operator;
  if (entry?.api_key) return { api_key: entry.api_key, type: creds.active };
  // Fall back to whichever exists.
  if (creds.operator?.api_key) return { api_key: creds.operator.api_key, type: 'operator' };
  if (creds.agent?.api_key) return { api_key: creds.agent.api_key, type: 'agent' };
  return null;
}

function writeCredentials(creds: CredentialsFile): string | null {
  if (persistenceDisabled()) return null;
  const dir = credentialsDir();
  const file = credentialsPath();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* best effort on non-POSIX */ }
    return file;
  } catch {
    return null;
  }
}

function base(): CredentialsFile {
  return loadCredentials() || { version: 1, active: 'operator' };
}

/** Save (and activate) an operator key. Returns the file path written, or null if not persisted. */
export function saveOperatorKey(apiKey: string, extra: { id?: number; name?: string; recovery_code?: string } = {}): string | null {
  const creds = base();
  const prev = creds.operator && creds.operator.api_key === apiKey ? creds.operator : undefined;
  creds.operator = {
    api_key: apiKey,
    id: extra.id ?? prev?.id,
    name: extra.name ?? prev?.name,
    recovery_code: extra.recovery_code ?? prev?.recovery_code,
    saved_at: new Date().toISOString(),
  };
  creds.active = 'operator';
  if (process.env.LIGHTNING_WALLET_API_URL) creds.api_url = process.env.LIGHTNING_WALLET_API_URL;
  return writeCredentials(creds);
}

/** Save an agent key. Activates it only when `activate` is true (set_agent_credentials); create_agent just records it. */
export function saveAgentKey(apiKey: string, extra: { id?: number; name?: string } = {}, activate = false): string | null {
  const creds = base();
  creds.agent = { api_key: apiKey, id: extra.id, name: extra.name, saved_at: new Date().toISOString() };
  if (activate) creds.active = 'agent';
  return writeCredentials(creds);
}

/** Mark which stored key is active without changing the keys. */
export function setActive(which: 'operator' | 'agent'): string | null {
  const creds = base();
  creds.active = which;
  return writeCredentials(creds);
}

export function forgetCredentials(): boolean {
  try { fs.unlinkSync(credentialsPath()); return true; } catch { return false; }
}

/** Redacted view for status/whoami output. Never returns key material. */
export function describeCredentials(): { path: string; exists: boolean; active?: string; operator_id?: number; agent_id?: number; persistence: 'enabled' | 'disabled' } {
  const creds = loadCredentials();
  return {
    path: credentialsPath(),
    exists: creds !== null,
    active: creds?.active,
    operator_id: creds?.operator?.id,
    agent_id: creds?.agent?.id,
    persistence: persistenceDisabled() ? 'disabled' : 'enabled',
  };
}
