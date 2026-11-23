import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { runRoundtable, MODES } from './roundtable.js';

const PORT = Number(process.env.PORT) || 4747;
const RUNS = path.join(ROOT, 'runs');
fs.mkdirSync(RUNS, { recursive: true });

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

async function readBody(req) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 200_000) throw new Error('body too large'); }
  return JSON.parse(raw || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(ROOT, 'web', 'index.html')).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { ...config, modes: MODES, hasKey: Boolean(process.env.OPENROUTER_API_KEY || process.env.AI_BRIDGE_MOCK) });
    }

    if (req.method === 'GET' && url.pathname === '/api/runs') {
      const list = fs.readdirSync(RUNS).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 50).map(f => {
        try {
          const r = JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8'));
          return { id: r.id, task: r.task.slice(0, 120), mode: r.mode, team: r.team, cost: r.cost, createdAt: r.createdAt, source: r.source };
        } catch { return null; }
      }).filter(Boolean);
      return json(res, 200, list);
    }

    const m = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const file = path.join(RUNS, `${m[1]}.json`);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
      return json(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readBody(req);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableFinished) ac.abort(); });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      try {
        const run = await runRoundtable({ ...body, onEvent: send, signal: ac.signal });
        const id = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(RUNS, `${id}.json`), JSON.stringify({ id, source: 'web', createdAt: new Date().toISOString(), ...run }, null, 2));
        send({ type: 'saved', id });
      } catch (e) {
        if (!ac.signal.aborted) send({ type: 'error', error: e.message });
      }
      return res.end();
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message });
    else res.end();
  }
});

// Localhost only: this spends your OpenRouter credit, so it must not be reachable from the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI Roundtable → http://localhost:${PORT}`);
  if (!process.env.OPENROUTER_API_KEY && !process.env.AI_BRIDGE_MOCK) console.log('⚠  No OPENROUTER_API_KEY in .env yet — runs will fail until you add it.');
});
