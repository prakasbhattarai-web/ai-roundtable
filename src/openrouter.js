import './config.js';

const BASE = 'https://openrouter.ai/api/v1';

/**
 * One chat completion through OpenRouter, streamed.
 * Returns { text, usage } where usage.cost is in USD (OpenRouter usage accounting).
 */
export async function chat({ model, messages, maxTokens, onDelta = () => {}, signal }) {
  if (process.env.AI_BRIDGE_MOCK) return mockChat({ model, messages, onDelta });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key (https://openrouter.ai/keys)');

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://github.com/prakasbhattarai-web/ai-roundtable',
      'X-Title': 'AI Roundtable',
    },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, usage: { include: true } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${model} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  let text = '';
  let usage = null;
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // skips ": OPENROUTER PROCESSING" keep-alives
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.error) throw new Error(`${model}: ${json.error.message || JSON.stringify(json.error)}`);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) { text += delta; onDelta(delta); }
      if (json.usage) usage = json.usage;
    }
  }
  return { text, usage };
}

/** Offline stand-in so the orchestration and UI can be tested without a key or spend. */
async function mockChat({ model, messages, onDelta }) {
  const last = messages.at(-1).content;
  const turn = (last.match(/YOUR TURN: (.*)/) || [])[1] || 'answer';
  const text = `**${model}** (mock) responding to: _${turn.slice(0, 80)}_\n\n- point one\n- point two`;
  for (const word of text.split(/(?<= )/)) { onDelta(word); await new Promise(r => setTimeout(r, 5)); }
  return { text, usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0 } };
}
