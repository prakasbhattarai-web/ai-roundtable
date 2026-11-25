import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env from the project folder (works no matter where the MCP client starts us from).
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env yet */ }

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

// config.json ships with the repo; config.local.json (git-ignored) overrides any part of it.
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
export const config = merge(read('config.json'), fs.existsSync(path.join(ROOT, 'config.local.json')) ? read('config.local.json') : {});

export function tierConfig(tier) {
  const name = tier || config.defaultTier || 'smart';
  const t = config.tiers?.[name];
  if (!t) throw new Error(`Unknown tier "${name}". Use one of: ${Object.keys(config.tiers || {}).join(', ')}`);
  return { name, ...t };
}

/**
 * Accepts an alias ("grok") or any raw model id ("mistralai/mistral-large").
 * In the cheap tier an alias resolves to its "cheap" model when one is configured.
 */
export function resolveModel(ref, tier) {
  const key = String(ref).trim();
  const known = config.models[key.toLowerCase()];
  if (known) {
    const { cheap, ...rest } = known;
    const id = tierConfig(tier).name === 'cheap' && cheap ? cheap : known.id;
    return { alias: key.toLowerCase(), ...rest, id };
  }
  if (key.includes('/')) return { alias: key, id: key, name: key.split('/')[1], color: '#999999' };
  const aliases = Object.keys(config.models).join(', ');
  throw new Error(`Unknown model "${key}". Use one of: ${aliases}, or a full model id like "mistralai/mistral-large".`);
}
