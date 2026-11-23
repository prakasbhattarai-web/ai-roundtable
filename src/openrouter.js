import './config.js';

const OPENROUTER = 'https://openrouter.ai/api/v1';

/**
 * Where requests go: OpenRouter by default, or any OpenAI-compatible endpoint
 * (a self-hosted gateway, LiteLLM, …) when AI_BASE_URL + AI_API_KEY are set.
 */
export function endpoint() {
  if (process.env.AI_BASE_URL) {
    return { base: process.env.AI_BASE_URL.replace(/\/+$/, ''), key: process.env.AI_API_KEY || '', openrouter: false, keyName: 'AI_API_KEY' };
  }
  return { base: OPENROUTER, key: process.env.OPENROUTER_API_KEY || '', openrouter: true, keyName: 'OPENROUTER_API_KEY' };
}

/**
 * One chat completion, streamed.
 * Returns { text, usage } where usage.cost is in USD when the endpoint reports it.
 */
export async function chat({ model, messages, maxTokens, onDelta = () => {}, signal }) {
  if (process.env.AI_BRIDGE_MOCK) return mockChat({ model, messages, onDelta });

  const { base, key, openrouter, keyName } = endpoint();
  if (!key) throw new Error(`${keyName} is not set. Copy .env.example to .env and add your key (https://openrouter.ai/keys)`);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/prakasbhattarai-web/ai-roundtable',
      'X-Title': 'AI Roundtable',
    },
    body: JSON.stringify({
      model, messages, stream: true, max_tokens: maxTokens,
      ...(openrouter ? { usage: { include: true } } : { stream_options: { include_usage: true } }),
    }),
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
