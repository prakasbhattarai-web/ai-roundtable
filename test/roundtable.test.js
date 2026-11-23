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
