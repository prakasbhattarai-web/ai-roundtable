import test from 'node:test';
import assert from 'node:assert/strict';
import { runRoundtable } from '../src/roundtable.js';
import { resolveModel } from '../src/config.js';

for (const mode of ['parallel', 'discuss', 'pipeline']) {
  test(`${mode} mode produces turns and a final answer`, async () => {
    const events = [];
    const run = await runRoundtable({ task: 'Say hi', team: ['gpt', 'grok', 'gemini'], mode, rounds: 2, onEvent: e => events.push(e.type) });
    const expected = { parallel: 3, discuss: 6, pipeline: 3 }[mode] + 1;
    assert.equal(run.transcript.length, expected);
    assert.equal(run.transcript.at(-1).role, 'final answer');
    assert.ok(run.final.length > 0);
    assert.equal(events.at(-1), 'done');
  });
}

test('later speakers see earlier turns', async () => {
  const run = await runRoundtable({ task: 'x', team: ['gpt', 'claude'], mode: 'discuss', rounds: 1 });
  assert.equal(run.transcript[1].speaker, 'Claude');
});

test('resolveModel accepts aliases and raw ids, rejects junk', () => {
  assert.equal(resolveModel('GROK').id, 'x-ai/grok-4.7');
  assert.equal(resolveModel('mistralai/mistral-large').id, 'mistralai/mistral-large');
  assert.throws(() => resolveModel('nope'));
});

test('cheap tier swaps aliases to their cheap models; raw ids stay as given', async () => {
  const { config } = await import('../src/config.js');
  const run = await runRoundtable({ task: 'x', team: ['gpt', 'claude', 'mistralai/mistral-large'], mode: 'parallel', tier: 'cheap' });
  assert.equal(run.tier, 'cheap');
  const byAlias = Object.fromEntries(run.transcript.filter(t => t.role !== 'final answer').map(t => [t.alias, t.model]));
  assert.equal(byAlias.gpt, config.models.gpt.cheap);
  assert.equal(byAlias.claude, config.models.claude.cheap);
  assert.equal(byAlias['mistralai/mistral-large'], 'mistralai/mistral-large');
  assert.equal(run.transcript.at(-1).model, config.models.claude.cheap, 'synthesizer uses the cheap tier too');
});

test('smart tier (default) uses the main models', async () => {
  const { config } = await import('../src/config.js');
  const run = await runRoundtable({ task: 'x', team: ['gpt'], mode: 'parallel' });
  assert.equal(run.tier, 'smart');
  assert.equal(run.transcript[0].model, config.models.gpt.id);
});

test('unknown tier is rejected', async () => {
  await assert.rejects(runRoundtable({ task: 'x', team: ['gpt'], tier: 'ultra' }), /Unknown tier/);
});
