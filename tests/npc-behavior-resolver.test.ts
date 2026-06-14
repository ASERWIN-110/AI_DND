// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  SQLiteDataManager,
  ToolPluginManager,
  NPC_BEHAVIOR_PLUGIN,
  createDefaultToolPluginManager,
  createNpcBehaviorHandlers
} from '../src/index.js';

function createTestChat() {
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
    title: 'NPC Behavior Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('npc behavior resolver builds prompts with faction context and traces', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-npc-behavior-prompt-'));
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({ appDatabase, dataManager, trace: false });
  const behaviorTools = new ToolPluginManager({ trace: false });
  behaviorTools.createPlugin(NPC_BEHAVIOR_PLUGIN, {
    handlers: createNpcBehaviorHandlers({
      toolManager: manager,
      trace: {
        directory: join(directory, 'traces')
      }
    })
  });

  try {
    await manager.executeTool('system.factions.upsert_faction', {
      factionId: 'city_watch',
      name: 'City Watch',
      coreInterests: ['order']
    });
    await manager.executeTool('system.factions.upsert_membership', {
      actorId: 'npc_guard',
      actorName: 'Gate Guard',
      factionId: 'city_watch',
      role: 'sentry',
      loyalty: 70
    });

    const prompt = await behaviorTools.executeTool('system.npc_behavior.build_prompt', {
      chatSessionId: chat.id,
      sceneId: 'gate',
      actorNpcIds: ['npc_guard'],
      triggerText: '玩家说服守卫放行，但这违反城防命令。',
      templateId: 'factionPressure',
      userRules: '背叛需要明确压力或强烈动机。',
      referenceText: '如果玩家明确提到某个 NPC，必须提高该 NPC 的反应检查权重。'
    });

    assert.match(prompt.output.prompt, /NPC Behavior Plan/);
    assert.match(prompt.output.prompt, /City Watch/);
    assert.match(prompt.output.prompt, /反应检查权重/);
    assert.match(prompt.output.prompt, /State impact contract/);
    assert.match(prompt.output.prompt, /system.item_registry/);
    assert.match(prompt.output.prompt, /system.quests/);
    assert.equal(prompt.output.context.sources['actorFactions:npc_guard'].factions[0].membership.data.role, 'sentry');
    assert.equal(existsSync(prompt.output.trace.files.plannerPrompt), true);
    assert.equal(existsSync(prompt.output.trace.files.context), true);
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('npc behavior resolver plans and applies autonomous consequences through existing tools', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-npc-behavior-apply-'));
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({ appDatabase, dataManager, trace: false });
  const calls = [];
  const behaviorTools = new ToolPluginManager({ trace: false });
  behaviorTools.createPlugin(NPC_BEHAVIOR_PLUGIN, {
    handlers: createNpcBehaviorHandlers({
      toolManager: manager,
      chatProvider: {
        async generate({ messages }) {
          calls.push(messages);
          return {
            content: JSON.stringify({
              actionId: 'npc_guard_wavers',
              sourceText: 'The guard was persuaded and now weighs faction duty against personal trust.',
              intent: {
                label: 'wavering-loyalty',
                summary: 'The guard does not defect yet, but his loyalty weakens.'
              },
              metadata: {
                npcBehavior: {
                  actors: [
                    {
                      npcId: 'npc_guard',
                      motivation: 'Avoid punishment while helping the party.',
                      pressure: 'City Watch duty versus persuasion.',
                      severity: 'medium'
                    }
                  ]
                }
              },
              checks: [],
              proposals: [
                {
                  id: 'reduce_watch_loyalty',
                  when: 'always',
                  tool: 'system.factions.patch_membership',
                  input: {
                    actorId: 'npc_guard',
                    factionId: 'city_watch',
                    patch: {
                      status: 'wavering',
                      loyalty: 35,
                      reasons: ['persuaded by party', 'still afraid of punishment']
                    }
                  }
                }
              ],
              narrationHints: {
                resolved: '守卫开始动摇，但还没有公开背叛城防。'
              }
            }),
            raw: { provider: 'fake' }
          };
        }
      },
      trace: {
        directory: join(directory, 'traces')
      }
    })
  });

  try {
    await manager.executeTool('system.factions.upsert_faction', {
      factionId: 'city_watch',
      name: 'City Watch'
    });
    await manager.executeTool('system.factions.upsert_membership', {
      actorId: 'npc_guard',
      actorName: 'Gate Guard',
      factionId: 'city_watch',
      role: 'sentry',
      loyalty: 70
    });

    const planned = await behaviorTools.executeTool('system.npc_behavior.plan', {
      chatSessionId: chat.id,
      sceneId: 'gate',
      actorNpcIds: ['npc_guard'],
      triggerText: '守卫被说服后，需要判断他是否真的改变行为。',
      useLlm: true
    });
    assert.equal(calls.length, 1);
    assert.equal(planned.output.plan.actionId, 'npc_guard_wavers');
    assert.equal(planned.output.plan.metadata.npcBehavior.actors[0].npcId, 'npc_guard');

    const dryRun = await behaviorTools.executeTool('system.npc_behavior.apply_plan', {
      plan: planned.output.plan
    });
    assert.equal(dryRun.output.status, 'dry_run');
    assert.equal(dryRun.output.apply.riskReport.summary.total, 1);

    const applied = await behaviorTools.executeTool('system.npc_behavior.apply_plan', {
      plan: planned.output.plan,
      dryRun: false
    });
    assert.equal(applied.output.status, 'success');
    assert.equal(applied.output.apply.appliedToolCalls[0].tool, 'system.factions.patch_membership');
    assert.equal(existsSync(applied.output.trace.files.normalizedPlan), true);
    assert.equal(existsSync(applied.output.trace.files.riskReport), true);

    const membership = await manager.executeTool('system.factions.get_membership', {
      id: 'factionmember_npc_guard_city_watch'
    });
    assert.equal(membership.output.data.status, 'wavering');
    assert.equal(membership.output.data.loyalty, 35);
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
