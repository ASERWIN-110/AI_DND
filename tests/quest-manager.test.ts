// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  QuestManager,
  ToolPluginManager,
  QUEST_PLUGIN,
  createDefaultToolPluginManager,
  createQuestHandlers
} from '../src/index.js';

function createTestChat(options = {}) {
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: options.chatDataDirectory
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Quest GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Quest Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('quest manager creates route-free quests and converges investigation ticks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-quests-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const quests = new QuestManager({
    appDatabase,
    trace: {
      directory: join(directory, 'quest-traces')
    }
  });

  try {
    const created = await quests.createHook({
      chatSessionId: chat.id,
      quest: {
        questId: 'well_mystery',
        title: '井底回声',
        hookText: '井底传来笑声，村民不敢靠近。',
        objective: '查明井底回声的来源并让村民知道是否安全。',
        successCriteria: [
          '确认回声来源',
          '处理或报告实际风险'
        ],
        evidenceSlots: [
          { id: 'source', description: '回声来源', required: true },
          { id: 'risk', description: '是否存在危险', required: true }
        ],
        openLeads: ['井口绳痕', '湿冷笑声'],
        investigationBudget: 2
      }
    });

    assert.equal(created.quest.data.status, 'rumor');
    assert.equal(created.quest.data.budgetRemaining, 2);
    assert.equal(existsSync(created.trace.files.input), true);

    const tracked = quests.trackQuest({
      chatSessionId: chat.id,
      questId: 'well_mystery'
    });
    assert.equal(tracked.quest.data.status, 'tracked');

    const firstTick = await quests.resolveInvestigationTick({
      chatSessionId: chat.id,
      questId: 'well_mystery',
      sourceText: '玩家把灯放进井里，看到井壁后面有一道裂缝在传声。',
      tick: {
        tickType: 'evidence',
        summary: '灯光证明笑声来自井壁裂缝后的传声。',
        evidenceUpdates: [
          { slotId: 'source', status: 'filled', value: '声音来自井壁裂缝后的空间' }
        ],
        budgetSpent: 1
      },
      dryRun: false
    });

    assert.equal(firstTick.quest.data.budgetRemaining, 1);
    assert.equal(firstTick.quest.data.evidenceSlots.find((slot) => slot.id === 'source').status, 'filled');

    const secondTick = await quests.resolveInvestigationTick({
      chatSessionId: chat.id,
      questId: 'well_mystery',
      sourceText: '玩家丢下一块石头，没有听到怪物移动，只听到机械回响。',
      tick: {
        tickType: 'conclusion',
        summary: '井底不是怪物，而是旧水车的机关回音。',
        evidenceUpdates: [
          { slotId: 'risk', status: 'filled', value: '没有活物威胁，旧水车机关需要修理' }
        ],
        budgetSpent: 1,
        questStatus: 'reportable'
      },
      dryRun: false
    });

    assert.equal(secondTick.quest.data.status, 'reportable');
    assert.equal(secondTick.quest.data.budgetRemaining, 0);

    assert.throws(() => quests.upsertQuest({
      chatSessionId: chat.id,
      questId: 'bad_route',
      title: '坏任务',
      objective: '测试',
      requiredSteps: ['先去 A', '再去 B']
    }), /Forbidden route fields/);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('quest tools import, export, expire due quests, and register in default manager', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-quest-tools-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const questManager = new QuestManager({
    appDatabase,
    trace: {
      directory: join(directory, 'quest-traces')
    }
  });
  const tools = new ToolPluginManager({ trace: false });
  tools.createPlugin(QUEST_PLUGIN, {
    handlers: createQuestHandlers({ manager: questManager })
  });

  try {
    const imported = await tools.executeTool('system.quests.import_quests', {
      chatSessionId: chat.id,
      format: 'yaml',
      text: [
        'questSystem:',
        '  records:',
        '    - questId: missing_cat',
        '      title: 找猫',
        '      status: tracked',
        '      objective: 找到旅店老板的猫或确认它的去向',
        '      successCriteria:',
        '        - 找到猫',
        '      evidenceSlots:',
        '        - id: cat_location',
        '          description: 猫的位置',
        '          required: true',
        '      investigationBudget: 1'
      ].join('\n')
    });
    assert.equal(imported.output.count, 1);

    const clock = await tools.executeTool('system.quests.set_quest_clock', {
      chatSessionId: chat.id,
      questId: 'missing_cat',
      expiresAtElapsedSeconds: 30,
      expireMode: 'fail',
      expiryImpact: { note: '猫被商队带走' }
    });
    assert.equal(clock.output.clock.data.status, 'active');

    const expired = await tools.executeTool('system.quests.expire_due_quests', {
      chatSessionId: chat.id,
      elapsedSeconds: 31
    });
    assert.equal(expired.output.count, 1);
    assert.equal(expired.output.expired[0].quest.data.status, 'failed');

    const exported = await tools.executeTool('system.quests.export_quests', {
      chatSessionId: chat.id,
      format: 'json'
    });
    assert.match(exported.output.text, /missing_cat/);

    const defaultTools = createDefaultToolPluginManager({ appDatabase, trace: false });
    const listed = defaultTools.listTools().map((tool) => tool.id);
    assert.ok(listed.includes('system.quests.create_hook'));
    assert.ok(listed.includes('system.quests.resolve_investigation_tick'));
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('quest LLM tools normalize supplied decisions without mutating on dry run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-quest-dry-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const quests = new QuestManager({
    appDatabase,
    trace: false
  });

  try {
    await quests.createHook({
      chatSessionId: chat.id,
      quest: {
        questId: 'sealed_letter',
        title: '密封信',
        objective: '确认密封信该交给谁',
        successCriteria: ['正确确认收信人'],
        evidenceSlots: [{ id: 'recipient', description: '收信人身份', required: true }],
        investigationBudget: 1
      }
    });

    const dry = await quests.checkCompletion({
      chatSessionId: chat.id,
      questId: 'sealed_letter',
      sourceText: '玩家只是把信揣进口袋。',
      decision: {
        objectiveSatisfied: false,
        status: 'tracked',
        reason: '尚未确认收信人。',
        confidence: 0.9
      }
    });

    assert.equal(dry.dryRun, true);
    assert.equal(dry.decision.objectiveSatisfied, false);
    const current = quests.getQuest({ chatSessionId: chat.id, questId: 'sealed_letter' });
    assert.equal(current.data.status, 'rumor');
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
