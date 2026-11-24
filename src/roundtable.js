import { randomUUID } from 'node:crypto';
import { config, resolveModel, tierConfig } from './config.js';
import { chat } from './openrouter.js';

export const MODES = {
  parallel: 'Everyone answers independently, then the synthesizer merges the best parts.',
  discuss: 'Models take turns for N rounds, building on and challenging each other, then a final answer.',
  pipeline: 'First model drafts, each next model critiques and improves it, synthesizer polishes the final.',
};

/** Ask a single model one question. */
export async function ask({ model, prompt, system, tier, onDelta, signal }) {
  const m = resolveModel(model, tier);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const { text, usage } = await chat({ model: m.id, messages, maxTokens: tierConfig(tier).maxTokensPerTurn * 2, onDelta, signal });
  return { model: m, text, cost: usage?.cost ?? 0 };
}

/**
 * Run a multi-model session.
 * onEvent receives: turn_start {id, alias, speaker, color, role, round}, delta {id, text},
 * turn_end {id, cost}, turn_error {id, error}, done {final, cost}.
 */
export async function runRoundtable({
  task,
  team = config.defaultTeam,
  mode = 'discuss',
  rounds = 2,
  synthesizer = config.synthesizer,
  tier,
  onEvent = () => {},
  signal,
}) {
  if (!task?.trim()) throw new Error('task is required');
  if (!MODES[mode]) throw new Error(`mode must be one of: ${Object.keys(MODES).join(', ')}`);
  const t = tierConfig(tier);
  const members = team.map(ref => resolveModel(ref, t.name));
  if (members.length < 1) throw new Error('team needs at least one model');
  const synth = resolveModel(synthesizer || members[0].alias, t.name);
  rounds = Math.max(1, Math.min(5, Number(rounds) || 1));

  const transcript = [];
  let cost = 0;

  const say = async (member, role, instruction, round = null) => {
    const id = randomUUID();
    // Snapshot the transcript now so parallel turns don't see each other.
    const messages = [
      { role: 'system', content: systemPrompt(member, members, role) },
      { role: 'user', content: userPrompt(task, transcript, instruction) },
    ];
    onEvent({ type: 'turn_start', id, alias: member.alias, speaker: member.name, model: member.id, color: member.color, role, round });
    try {
      const { text, usage } = await chat({
        model: member.id,
        messages,
        maxTokens: t.maxTokensPerTurn,
        onDelta: text => onEvent({ type: 'delta', id, text }),
        signal,
      });
      const turnCost = usage?.cost ?? 0;
      cost += turnCost;
      const entry = { speaker: member.name, alias: member.alias, model: member.id, role, round, text };
      transcript.push(entry);
      onEvent({ type: 'turn_end', id, cost: turnCost });
      return entry;
    } catch (err) {
      if (signal?.aborted) throw err;
      onEvent({ type: 'turn_error', id, error: err.message });
      return null;
    }
  };

  if (mode === 'parallel') {
    await Promise.all(members.map(m => say(m, 'independent answer', 'Answer the task on your own, as well as you can.', 1)));
  } else if (mode === 'discuss') {
    for (let r = 1; r <= rounds; r++) {
      for (const m of members) {
        const instruction = r === 1 && transcript.length === 0
          ? 'You speak first. Give your best answer to the task.'
          : r === 1
            ? 'Give your answer. Say where you agree or disagree with the others so far, and add what they missed.'
            : `Round ${r}. Respond to the latest points: push back on anything weak, concede where someone was right, and move the answer forward. Do not restate the whole thing.`;
        await say(m, 'discussant', instruction, r);
      }
    }
  } else if (mode === 'pipeline') {
    const [first, ...rest] = members;
    await say(first, 'drafter', 'Write a complete first draft that answers the task.', 1);
    for (const m of rest) {
      await say(m, 'reviewer', 'Review the latest version: list the 3–5 most important problems in a few lines, then write the full improved version.', 1);
    }
  }

  if (transcript.length === 0) throw new Error('Every model failed — check the key, credit balance and model ids.');

  const finalTurn = await say(
    synth,
    'final answer',
    'Write the final answer for the human. Combine the strongest points from the session, resolve disagreements (briefly note any that remain), and leave out the back-and-forth.',
  );
  const final = finalTurn?.text ?? transcript.at(-1).text;
  onEvent({ type: 'done', final, cost });
  return { task, mode, tier: t.name, team: members.map(m => m.alias), synthesizer: synth.alias, transcript, final, cost };
}

function systemPrompt(me, members, role) {
  const others = members.filter(m => m.alias !== me.alias).map(m => `${m.name} (${m.id})`);
  return [
    `You are ${me.name} (${me.id}), working with other AI models on a task a human gave the group.`,
    others.length ? `The others in the session: ${others.join(', ')}.` : '',
    `Your role this turn: ${role}.`,
    'Rules: be direct and concise. Refer to the others by name when you agree or disagree. Do not repeat what has already been said. Only speak as yourself — never write lines for the other models. If you are unsure of a fact, say so instead of guessing.',
  ].filter(Boolean).join('\n');
}

function userPrompt(task, transcript, instruction) {
  const history = transcript.length
    ? transcript.map(t => `[${t.speaker}${t.round ? ` — round ${t.round}` : ''}, ${t.role}]\n${t.text}`).join('\n\n')
    : '(nobody has spoken yet)';
  return `TASK FROM THE HUMAN:\n${task}\n\nSESSION SO FAR:\n${history}\n\nYOUR TURN: ${instruction}`;
}
