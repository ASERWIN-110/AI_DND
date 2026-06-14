// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  EFFECT_SETTLEMENT_PLUGIN,
  EffectSettlementResolver,
  NpcStructuredStateDatabase,
  ToolPluginManager,
  createDefaultToolPluginManager,
  createEffectSettlementHandlers
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
      name: 'Combat GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Effect Settlement Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('effect settlement applies resistance, temporary HP, and pending concentration check', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-effects-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const npcState = new NpcStructuredStateDatabase({
    appDatabase,
    trace: {
      directory: join(directory, 'npc-state-traces')
    }
  });
  const settlement = new EffectSettlementResolver({
    npcState,
    trace: {
      directory: join(directory, 'effect-traces')
    }
  });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'gate',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      values: { hp: 20, maxHp: 30, temporaryHp: 5 },
      statusBar: {
        hp: 20,
        maxHp: 30,
        temporaryHp: 5,
        defenses: { resistances: ['fire'] },
        concentration: { active: true, spellId: 'hex' },
        conditions: ['concentrating']
      },
      specialStatuses: [{ id: 'concentration', name: 'concentrating', active: true }]
    });

    const preview = settlement.previewSettlement({
      chatSessionId: chat.id,
      sceneId: 'gate',
      targets: [{
        npcId: 'pc_arin',
        hit: { outcome: 'hit' },
        damage: [{ type: 'fire', amount: 13, roll: { expression: '2d6+5', total: 13 } }]
      }]
    });

    assert.equal(preview.targets[0].totals.rawDamage, 13);
    assert.equal(preview.targets[0].totals.damageAfterDefenses, 6);
    assert.equal(preview.targets[0].temporaryHp.absorbed, 5);
    assert.equal(preview.targets[0].hp.final, 19);
    assert.equal(preview.requiredChecks[0].successThreshold, 10);
    assert.equal(existsSync(preview.trace.files.input), true);

    const applied = settlement.applySettlement({
      chatSessionId: chat.id,
      sceneId: 'gate',
      targets: [{
        npcId: 'pc_arin',
        hit: { outcome: 'hit' },
        damage: [{ type: 'fire', amount: 13 }]
      }]
    });

    assert.equal(applied.records[0].data.values.hp, 19);
    assert.equal(applied.records[0].data.values.temporaryHp, 0);
    assert.equal(applied.records[0].data.statusBar.concentration.pendingCheck.successThreshold, 10);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('effect settlement handles death saves and healing recovery', () => {
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const settlement = new EffectSettlementResolver({ npcState, trace: false });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      npcId: 'npc_guard',
      name: 'Guard',
      values: { hp: 4, maxHp: 12 },
      statusBar: { hp: 4, maxHp: 12 }
    });

    const downed = settlement.applySettlement({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      targets: [{
        npcId: 'npc_guard',
        hit: { outcome: 'hit' },
        damage: [{ type: 'slashing', amount: 8 }]
      }]
    });

    assert.equal(downed.records[0].data.values.hp, 0);
    assert.equal(downed.records[0].data.statusBar.deathSaves.dying, true);
    assert.ok(downed.records[0].data.statusBar.conditions.includes('dying'));

    const failedSave = settlement.applySettlement({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      targets: [{
        npcId: 'npc_guard',
        deathSave: { outcome: 'failure' }
      }]
    });
    assert.equal(failedSave.records[0].data.statusBar.deathSaves.failures, 1);

    const healed = settlement.applySettlement({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      targets: [{
        npcId: 'npc_guard',
        healing: [{ amount: 5, type: 'potion' }]
      }]
    });

    assert.equal(healed.records[0].data.values.hp, 5);
    assert.equal(healed.records[0].data.statusBar.deathSaves.failures, 0);
    assert.equal(healed.records[0].data.statusBar.deathSaves.dying, false);
    assert.equal(healed.records[0].data.statusBar.conditions.includes('dying'), false);
  } finally {
    appDatabase.close();
  }
});

test('effect settlement tools are dice-independent and registered by default manager', async () => {
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const resolver = new EffectSettlementResolver({ npcState, trace: false });
  const tools = new ToolPluginManager({ trace: false });
  tools.createPlugin(EFFECT_SETTLEMENT_PLUGIN, {
    handlers: createEffectSettlementHandlers({ resolver })
  });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_ooze',
      name: 'Ooze',
      values: { hp: 10, maxHp: 10 },
      statusBar: {
        hp: 10,
        maxHp: 10,
        defenses: { immunities: ['poison'], vulnerabilities: ['cold'] }
      }
    });

    const result = await tools.executeTool('system.effects.apply_settlement', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      targets: [{
        npcId: 'npc_ooze',
        hit: true,
        damage: [
          { type: 'poison', amount: 99 },
          { type: 'cold', amount: 3 }
        ],
        statusEffects: [{ id: 'chilled', name: 'Chilled', remainingTurns: 2 }]
      }]
    });

    assert.equal(result.output.targets[0].totals.damageAfterDefenses, 6);
    assert.equal(result.output.records[0].data.values.hp, 4);
    assert.equal(result.output.records[0].data.specialStatuses.find((status) => status.id === 'chilled').remainingTurns, 2);

    const defaultTools = createDefaultToolPluginManager({ appDatabase, trace: false });
    const listed = defaultTools.listTools().map((tool) => tool.id);
    assert.ok(listed.includes('system.effects.preview_settlement'));
    assert.ok(listed.includes('system.effects.apply_settlement'));
  } finally {
    appDatabase.close();
  }
});

test('effect settlement normalizes status duration metadata and removes concentration-linked spell states', () => {
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const settlement = new EffectSettlementResolver({ npcState, trace: false });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'chapel',
      npcId: 'pc_cleric',
      actorType: 'player',
      isPlayer: true,
      name: 'Cleric',
      values: { hp: 18, maxHp: 18 },
      statusBar: {
        hp: 18,
        maxHp: 18,
        concentration: {
          active: true,
          spellId: 'bless',
          linkedStatusIds: ['bless']
        },
        conditions: ['concentrating', 'blessed']
      },
      specialStatuses: [
        { id: 'concentration', name: 'concentrating', active: true, metadata: { spellId: 'bless', linkedStatusIds: ['bless'] } },
        { id: 'bless', name: 'Bless', active: true, metadata: { spellId: 'bless', requiresConcentration: true, conditionName: 'blessed' } }
      ]
    });

    const added = settlement.applySettlement({
      chatSessionId: chat.id,
      sceneId: 'chapel',
      targets: [{
        npcId: 'pc_cleric',
        statusEffects: [
          {
            id: 'poisoned',
            name: 'Poisoned',
            tickTiming: 'endTurn',
            damage: [{ type: 'poison', amount: 2 }],
            durationType: 'turns'
          },
          {
            id: 'shield',
            name: 'Shield',
            remainingTurns: 1,
            durationTiming: 'endTurn',
            expiresOnActorId: 'pc_cleric'
          }
        ]
      }]
    });

    const poisoned = added.records[0].data.specialStatuses.find((status) => status.id === 'poisoned');
    const shield = added.records[0].data.specialStatuses.find((status) => status.id === 'shield');
    assert.equal(poisoned.metadata.tickTiming, 'endTurn');
    assert.equal(poisoned.metadata.damage[0].amount, 2);
    assert.equal(shield.remainingTurns, 1);
    assert.equal(shield.metadata.durationTiming, 'endTurn');
    assert.equal(shield.metadata.expiresOnActorId, 'pc_cleric');

    const broken = settlement.applySettlement({
      chatSessionId: chat.id,
      sceneId: 'chapel',
      targets: [{
        npcId: 'pc_cleric',
        hit: true,
        damage: [{ type: 'force', amount: 4 }],
        concentrationCheck: { outcome: 'failure', total: 7 }
      }]
    });

    assert.equal(broken.records[0].data.statusBar.concentration.active, false);
    assert.equal(broken.records[0].data.specialStatuses.find((status) => status.id === 'bless'), undefined);
    assert.equal(broken.records[0].data.specialStatuses.find((status) => status.id === 'concentration'), undefined);
    assert.equal(broken.records[0].data.statusBar.conditions.includes('blessed'), false);
    assert.equal(broken.records[0].data.statusBar.conditions.includes('concentrating'), false);
  } finally {
    appDatabase.close();
  }
});
