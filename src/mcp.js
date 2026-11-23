#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ROOT, config } from './config.js';
import { ask, runRoundtable, MODES } from './roundtable.js';

const aliases = Object.keys(config.models).join(', ');
const server = new McpServer({ name: 'ai-roundtable', version: '0.1.0' });

const text = t => ({ content: [{ type: 'text', text: t }] });
const fail = e => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

server.registerTool('list_models', {
  title: 'List roundtable models',
  description: 'Show the AI models the roundtable can reach (aliases and OpenRouter ids), the default team and the modes.',
  inputSchema: {},
}, async () => {
  const rows = Object.entries(config.models).map(([a, m]) => `- ${a}: ${m.name} → ${m.id}`);
  const modes = Object.entries(MODES).map(([k, v]) => `- ${k}: ${v}`);
  return text(`Models:\n${rows.join('\n')}\n\nDefault team: ${config.defaultTeam.join(', ')} (final answer by ${config.synthesizer})\n\nModes:\n${modes.join('\n')}\n\nAny OpenRouter id (e.g. "mistralai/mistral-large") also works.`);
});

server.registerTool('ask_model', {
  title: 'Ask another AI',
  description: `Send one prompt to another AI model (ChatGPT, Grok, Gemini, DeepSeek, Claude…) and get its reply. Use it for a second opinion, a different perspective, or to check your own work. Model can be an alias (${aliases}) or a full OpenRouter id.`,
  inputSchema: {
    model: z.string().describe(`Alias (${aliases}) or OpenRouter id`),
    prompt: z.string().describe('The full message to send. The other model has no context except what you put here.'),
    system: z.string().optional().describe('Optional system prompt'),
  },
}, async ({ model, prompt, system }) => {
  try {
    const r = await ask({ model, prompt, system });
    return text(`[${r.model.name} — ${r.model.id}, $${r.cost.toFixed(4)}]\n\n${r.text}`);
  } catch (e) { return fail(e); }
});

server.registerTool('roundtable', {
  title: 'Multi-AI roundtable',
  description: `Have several AI models work on a task together and return the full conversation plus a final combined answer. Modes: ${Object.entries(MODES).map(([k, v]) => `${k} = ${v}`).join(' ')} Takes 30 s to a few minutes.`,
  inputSchema: {
    task: z.string().describe('The task or question, with all the context the models need'),
    team: z.array(z.string()).optional().describe(`Models taking part (default ${config.defaultTeam.join(', ')})`),
    mode: z.enum(['parallel', 'discuss', 'pipeline']).optional().describe('Default discuss'),
    rounds: z.number().int().min(1).max(5).optional().describe('Rounds for discuss mode (default 2)'),
    synthesizer: z.string().optional().describe(`Model that writes the final answer (default ${config.synthesizer})`),
  },
}, async (args) => {
  try {
    const run = await runRoundtable(args);
    saveRun(run);
    const convo = run.transcript.filter(t => t.role !== 'final answer').map(t => `### ${t.speaker}${t.round ? ` (round ${t.round})` : ''} — ${t.role}\n${t.text}`).join('\n\n');
    return text(`${convo}\n\n---\n## Final answer\n${run.final}\n\n_Total cost: $${run.cost.toFixed(4)}_`);
  } catch (e) { return fail(e); }
});

function saveRun(run) {
  try {
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(path.join(ROOT, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'runs', `${id}.json`), JSON.stringify({ id, source: 'mcp', createdAt: new Date().toISOString(), ...run }, null, 2));
  } catch { /* history is best-effort */ }
}

await server.connect(new StdioServerTransport());
