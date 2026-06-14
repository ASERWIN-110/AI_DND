// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ToolPluginManager } from '../src/index.js';

const exampleDir = new URL('../manuals/examples/', import.meta.url);

async function readExample(name) {
  const text = await readFile(new URL(name, exampleDir), 'utf8');
  return JSON.parse(text);
}

test('dynamic plugin manifest example is accepted by the existing tool manager', async () => {
  const manifest = await readExample('plugin-manifest.example.json');
  const manager = new ToolPluginManager({ trace: false });
  const plugin = manager.createPlugin(manifest);

  assert.equal(plugin.id, 'system.alchemy');
  assert.equal(manager.getTool('system.alchemy.mix_potion').name, 'mix_potion');
  assert.equal(manager.getTool('system.alchemy.mix_potion').mutatesState, true);

  assert.doesNotThrow(() => manager.validateToolInput('system.alchemy', 'mix_potion', {
    chatSessionId: 'chat_example',
    actorId: 'pc_arin',
    ingredientIds: ['herb_red', 'water_clear'],
    dryRun: true
  }));
  assert.throws(() => manager.validateToolInput('system.alchemy', 'mix_potion', {
    chatSessionId: 'chat_example',
    actorId: 'pc_arin'
  }), /Invalid input/);

  const exported = manager.exportTools({ format: 'claude', includeDisabled: true });
  assert.ok(exported.some((tool) => tool.name.includes('system_alchemy_mix_potion')));
});

test('frontend tool contract examples use stable statuses and tool-call shape', async () => {
  const ready = await readExample('frontend-tool-response-ready.example.json');
  const needsTarget = await readExample('frontend-tool-response-needs-target.example.json');
  const statuses = new Set([
    'ready',
    'dry_run',
    'needs_target',
    'needs_confirmation',
    'needs_adjudication',
    'blocked',
    'resolved',
    'resolved_with_pending_adjudication',
    'dry_run_with_pending_adjudication',
    'skipped',
    'error'
  ]);

  assert.equal(statuses.has(ready.status), true);
  assert.equal(ready.directToolCall.tool, 'system.item_use.use_item');
  assert.equal(typeof ready.directToolCall.input.chatSessionId, 'string');
  assert.equal(Array.isArray(ready.displayHints.sections), true);

  assert.equal(statuses.has(needsTarget.status), true);
  assert.equal(needsTarget.status, 'needs_target');
  assert.equal(needsTarget.targetPolicy, 'singleEnemy');
  assert.equal(Array.isArray(needsTarget.targetCandidates), true);
});

test('loose field convention example keeps content extensible under metadata.extension', async () => {
  const record = await readExample('loose-content-record.example.json');
  assert.equal(record.id, 'blade_of_threads');
  assert.equal(record.name, 'Blade of Threads');
  assert.equal(record.metadata.executionMode, 'hybrid');
  assert.equal(record.metadata.specialHandling.requiresAdjudication, true);
  assert.equal(record.metadata.extension['system.alchemy'].distillationTier, 2);
  assert.equal(record.lifecycleScope, 'character');
});
