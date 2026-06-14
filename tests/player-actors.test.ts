// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  NpcProfileDatabase,
  NpcRegistry,
  NpcStructuredStateDatabase,
  SceneNpcMountManager,
  SQLiteDataManager,
  buildNpcStructuredStatePrompt,
  extractNpcStructuredStateUpdates,
  stripNpcStructuredStateUpdates
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
    title: 'Player Actor Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('player actors reuse NPC registry, profile, scene mount, and structured state layers', () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new NpcRegistry({ dataManager });
  const profiles = new NpcProfileDatabase({ dataManager });
  const sceneNpcs = new SceneNpcMountManager({ appDatabase, npcRegistry: registry });
  const states = new NpcStructuredStateDatabase({ appDatabase, trace: false });

  try {
    const player = registry.upsertNpc({
      id: 'pc_arin',
      name: 'Arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1',
      summary: '主角，L0/L1 轻量记录即可。',
      tags: ['party', 'pc']
    });
    assert.equal(player.data.actorType, 'player');
    assert.equal(player.data.isPlayer, true);
    assert.equal(player.data.importance, 'key');

    const profile = profiles.upsertProfile({
      npcId: 'pc_arin',
      name: 'Arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1',
      level: 'L1',
      summary: '玩家主角的轻量 L1 摘要。',
      content: '只保留身份、目标、与当前团相关的少量事实。'
    }, {
      context: { authorization: true }
    });
    assert.equal(profile.data.profileType, 'playerProfile');
    assert.equal(profile.data.level, 'L1');

    const mounted = sceneNpcs.mountNpc({
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin',
      locationLabel: '篝火旁'
    });
    assert.equal(mounted.data.actorType, 'player');
    assert.equal(mounted.data.isPlayer, true);

    const content = [
      'Arin 重新整理背包，确认法术位。',
      '<AI_DND_ACTOR_STATE>',
      JSON.stringify({
        mode: 'patch',
        sceneId: 'camp',
        players: [
          {
            npcId: 'pc_arin',
            playerId: 'player_1',
            name: 'Arin',
            statusBar: {
              hp: 18,
              maxHp: 24,
              armorClass: 15,
              inspiration: 1,
              abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 11, cha: 13 },
              conditions: ['疲惫1']
            },
            skillBar: {
              skills: [{ id: 'arcana', name: '奥秘', bonus: 6, ready: true }],
              spells: [{ id: 'shield', name: '护盾术', level: 1, prepared: true }]
            },
            resources: {
              spellSlots: { level1: 2 },
              hitDice: 1
            },
            inventory: {
              currency: { gold: 12 },
              items: [{ id: 'rope', name: '绳索', quantity: 1 }]
            }
          }
        ]
      }),
      '</AI_DND_ACTOR_STATE>'
    ].join('\n');

    assert.equal(extractNpcStructuredStateUpdates(content).updates.length, 1);
    assert.equal(stripNpcStructuredStateUpdates(content), 'Arin 重新整理背包，确认法术位。');

    const applied = states.applyModelOutput(chat.id, content, { sceneId: 'camp' });
    assert.equal(applied.records[0].data.actorType, 'player');
    assert.equal(applied.records[0].data.isPlayer, true);
    assert.equal(applied.records[0].data.statusBar.hp, 18);
    assert.equal(applied.records[0].data.skillBar.skills[0].id, 'arcana');
    assert.equal(applied.state.players.length, 1);
    assert.equal(applied.state.npcs.length, 0);

    const prompt = buildNpcStructuredStatePrompt({ state: applied.state });
    assert.match(prompt, /AI_DND_ACTOR_STATE/);
    assert.match(prompt, /Players are special NPC\/actor records/);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});
