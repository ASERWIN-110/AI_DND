// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestWorld() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Test GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Environment Behavior Test',
    includeGreeting: false
  }).session;
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const tools = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    trace: false
  });
  return { appDatabase, dataManager, tools, chat };
}

test('environment behavior resolver includes reference text and defaults to no-op for weak triggers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-environment-behavior-prompt-'));
  const world = createTestWorld();
  try {
    const tools = createDefaultToolPluginManager({
      appDatabase: world.appDatabase,
      dataManager: world.dataManager,
      trace: {
        environmentBehavior: {
          directory: join(directory, 'traces')
        }
      }
    });

    const prompt = await tools.executeTool('system.environment_behavior.build_prompt', {
      chatSessionId: world.chat.id,
      sceneId: 'study',
      triggerText: '我观察书房里的旧地毯。',
      referenceText: '只有明确爆炸、纵火、坍塌、毒气或机关触发时，环境才应该明显反应。'
    });

    assert.match(prompt.output.prompt, /Environment Behavior Plan/);
    assert.match(prompt.output.prompt, /明确爆炸/);
    assert.match(prompt.output.prompt, /State impact contract/);
    assert.match(prompt.output.prompt, /system.npc_state.patch_state/);
    assert.match(prompt.output.prompt, /system.map_relationships/);
    assert.equal(prompt.output.triggerAssessment.triggerLikely, false);
    assert.ok(prompt.output.triggerAssessment.finalChance < 0.2);
    assert.equal(existsSync(prompt.output.trace.files.plannerPrompt), true);

    const planned = await tools.executeTool('system.environment_behavior.plan', {
      chatSessionId: world.chat.id,
      sceneId: 'study',
      triggerText: '我观察书房里的旧地毯。',
      referenceText: '只有明确爆炸、纵火、坍塌、毒气或机关触发时，环境才应该明显反应。'
    });

    assert.equal(planned.output.plan.metadata.environmentBehavior.triggerAssessment.triggerLikely, false);
    assert.equal(planned.output.plan.checks.length, 0);
    assert.equal(planned.output.plan.proposals.length, 0);
  } finally {
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('environment behavior resolver raises chance for destructive triggers and can apply map consequences', async () => {
  const world = createTestWorld();
  try {
    const planned = await world.tools.executeTool('system.environment_behavior.plan', {
      chatSessionId: world.chat.id,
      sceneId: 'lab',
      mapId: 'alchemy_lab',
      triggerText: '我把炼金实验室的承重墙炸开。',
      referenceText: '炼金实验室发生爆炸时，烟雾、碎石和警报很容易成为场景危险。'
    });

    assert.equal(planned.output.triggerAssessment.triggerLikely, true);
    assert.ok(planned.output.triggerAssessment.finalChance >= 0.5);
    assert.equal(planned.output.plan.checks[0].tool, 'game.dice.check');
    assert.equal(planned.output.plan.proposals[0].tool, 'system.map_state.patch_state');

    const dryRun = await world.tools.executeTool('system.environment_behavior.apply_plan', {
      plan: planned.output.plan,
      dryRun: true
    });
    assert.equal(dryRun.output.status, 'dry_run');
    assert.equal(dryRun.output.apply.riskReport.summary.total, 2);

    const applied = await world.tools.executeTool('system.environment_behavior.apply_plan', {
      plan: {
        actionId: 'env_lab_smoke',
        sourceText: '爆炸后的烟雾充满实验室。',
        intent: {
          label: 'environment-reaction',
          summary: 'Record smoke as a map hazard.'
        },
        checks: [],
        proposals: [{
          id: 'record_smoke',
          when: 'always',
          tool: 'system.map_state.patch_state',
          input: {
            chatSessionId: world.chat.id,
            sceneId: 'lab',
            mapId: 'alchemy_lab',
            hazards: [{
              id: 'hazard_smoke',
              name: 'Smoke',
              summary: 'Smoke from the explosion obscures the lab.',
              intensity: 2
            }],
            values: {
              environmentInstability: 70
            },
            source: 'environment_behavior'
          }
        }]
      },
      dryRun: false
    });
    assert.equal(applied.output.status, 'success');
    assert.equal(applied.output.apply.appliedToolCalls[0].tool, 'system.map_state.patch_state');

    const mapState = await world.tools.executeTool('system.map_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'lab',
      mapId: 'alchemy_lab'
    });
    assert.equal(mapState.output.data.hazards[0].id, 'hazard_smoke');
    assert.equal(mapState.output.data.values.environmentInstability, 70);
  } finally {
    world.dataManager.close();
    world.appDatabase.close();
  }
});
