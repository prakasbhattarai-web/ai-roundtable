import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env from the project folder (works no matter where the MCP client starts us from).
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env yet */ }

export const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

/** Accepts an alias ("grok") or any raw OpenRouter id ("mistralai/mistral-large"). */
export function resolveModel(ref) {
  const key = String(ref).trim();
  const known = config.models[key.toLowerCase()];
  if (known) return { alias: key.toLowerCase(), ...known };
  if (key.includes('/')) return { alias: key, id: key, name: key.split('/')[1], color: '#999999' };
  const aliases = Object.keys(config.models).join(', ');
  throw new Error(`Unknown model "${key}". Use one of: ${aliases}, or a full OpenRouter id like "mistralai/mistral-large".`);
}
