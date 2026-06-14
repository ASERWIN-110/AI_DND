// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StructuredInterfaceStateStore,
  applyStructuredInterfaceUpdate,
  buildStructuredInterfacePrompt,
  extractStructuredInterfaceUpdates,
  stripStructuredInterfaceUpdates
} from '../src/index.js';

test('structured interface extracts, strips, and applies patch updates', () => {
  const content = [
    '你进入钟楼。',
    '<AI_DND_STRUCTURED_STATE>',
    JSON.stringify({
      mode: 'patch',
      sceneMap: {
        title: '旧钟楼',
        areas: [{ id: 'foyer', name: '门厅', discovered: true }]
      },
      inventory: {
        items: [{ id: 'torch', name: '火把', quantity: 1 }]
      }
    }),
    '</AI_DND_STRUCTURED_STATE>'
  ].join('\n');

  const extracted = extractStructuredInterfaceUpdates(content);
  assert.equal(extracted.updates.length, 1);
  assert.equal(extracted.updates[0].sceneMap.title, '旧钟楼');
  assert.equal(stripStructuredInterfaceUpdates(content), '你进入钟楼。');

  const first = applyStructuredInterfaceUpdate({}, extracted.updates[0]);
  assert.equal(first.sceneMap.areas[0].name, '门厅');
  assert.equal(first.inventory.items[0].quantity, 1);

  const second = applyStructuredInterfaceUpdate(first, {
    inventory: {
      items: [
        { id: 'torch', quantity: 2 },
        { id: 'key', name: '铜钥匙', quantity: 1 }
      ]
    }
  });
  assert.equal(second.inventory.items.find((item) => item.id === 'torch').quantity, 2);
  assert.equal(second.inventory.items.find((item) => item.id === 'key').name, '铜钥匙');
});

test('structured interface store saves manual and model updates to files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-structured-'));
  const store = new StructuredInterfaceStateStore({
    directory: join(directory, 'state'),
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    const manual = store.update('sess-1', {
      statusBar: {
        characters: [{ id: 'pc', name: 'Player', hp: 9, maxHp: 12 }]
      }
    }, { mode: 'manual', source: 'test' });
    assert.equal(manual.state.statusBar.characters[0].hp, 9);
    assert.ok(manual.filePath.endsWith('sess-1.json'));
    assert.equal(existsSync(manual.trace.files.input), true);
    assert.equal(existsSync(manual.trace.files.stateBefore), true);
    assert.equal(existsSync(manual.trace.files.stateAfter), true);
    assert.equal(existsSync(manual.trace.files.output), true);

    const model = store.applyModelOutput('sess-1', [
      '门后传来脚步声。',
      '<AI_DND_STRUCTURED_STATE>{"mode":"patch","npcSummary":{"npcs":[{"id":"mira","name":"Mira","status":"alert"}]}}</AI_DND_STRUCTURED_STATE>'
    ].join('\n'));
    assert.equal(model.content, '门后传来脚步声。');
    assert.equal(model.state.npcSummary.npcs[0].status, 'alert');
    assert.equal(existsSync(model.trace.files.input), true);
    assert.match(JSON.parse(readFileSync(model.trace.files.output, 'utf8')).output.content, /门后传来脚步声/);

    const prompt = buildStructuredInterfacePrompt({ state: model.state });
    assert.match(prompt, /Structured game interface state/i);
    assert.match(prompt, /AI_DND_STRUCTURED_STATE/);
    assert.match(prompt, /Current structured state/);
    const promptTrace = store.tracePrompt('sess-1', {
      prompt,
      state: model,
      source: 'test.prompt'
    });
    assert.equal(existsSync(promptTrace.files.prompt), true);
    assert.match(readFileSync(promptTrace.files.prompt, 'utf8'), /AI_DND_STRUCTURED_STATE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
