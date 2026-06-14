// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  NpcStructuredStateDatabase,
  ProtagonistSwitchManager,
  createDefaultToolPluginManager
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
      name: 'Test GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Protagonist Switch Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('protagonist manager separates perspective switch from possession inheritance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-protagonist-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: join(directory, 'chat-data') });
  const actorState = new NpcStructuredStateDatabase({
    appDatabase,
    trace: false
  });
  const protagonist = new ProtagonistSwitchManager({
    appDatabase,
    actorState,
    trace: {
      directory: join(directory, 'protagonist-traces')
    }
  });

  try {
    actorState.rewriteNpcState({
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1',
      name: 'Arin',
      statusBar: {
        hp: 5,
        maxHp: 24,
        inspiration: 1
      },
      skillBar: {
        skills: [{ id: 'arcana', name: '奥秘', bonus: 6 }]
      },
      inventory: {
        items: [{ id: 'rope', name: '绳索', quantity: 1 }]
      }
    });

    const perspective = protagonist.switchPerspective({
      chatSessionId: chat.id,
      sceneId: 'camp',
      toActorId: 'pc_mira',
      toPlayerId: 'player_2',
      toName: 'Mira',
      createTargetState: true,
      reason: '新视角开场'
    });
    assert.equal(perspective.mode, 'perspective');
    assert.equal(perspective.active.data.activeActorId, 'pc_mira');
    assert.equal(perspective.targetState.data.statusBar.hp, undefined);
    assert.equal(perspective.inherited, false);
    assert.equal(existsSync(perspective.trace.files.input), true);

    protagonist.switchPerspective({
      chatSessionId: chat.id,
      sceneId: 'camp',
      toActorId: 'pc_arin',
      toPlayerId: 'player_1',
      reason: '切回原主角'
    });
    const possession = protagonist.switchPossession({
      chatSessionId: chat.id,
      sceneId: 'camp',
      toActorId: 'pc_nova',
      toPlayerId: 'player_3',
      toName: 'Nova',
      reason: '夺舍新身体'
    });
    assert.equal(possession.mode, 'possession');
    assert.equal(possession.active.data.activeActorId, 'pc_nova');
    assert.equal(possession.sourceState.data.npcId, 'pc_arin');
    assert.equal(possession.targetState.data.npcId, 'pc_nova');
    assert.equal(possession.targetState.data.name, 'Nova');
    assert.equal(possession.targetState.data.statusBar.hp, 5);
    assert.equal(possession.targetState.data.skillBar.skills[0].id, 'arcana');
    assert.equal(possession.targetState.data.inventory.items[0].id, 'rope');

    const prompt = protagonist.buildPromptContext({ chatSessionId: chat.id });
    assert.match(prompt.prompt, /pc_nova/);
    assert.match(prompt.prompt, /statusBar/);

    const history = protagonist.listSwitches({ chatSessionId: chat.id });
    assert.equal(history.records.some((record) => record.data.mode === 'perspective'), true);
    assert.equal(history.records.some((record) => record.data.mode === 'possession'), true);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('protagonist switch tools are registered by the default tool manager', async () => {
  const { appDatabase, chat } = createTestChat();
  const tools = createDefaultToolPluginManager({
    appDatabase,
    trace: false
  });

  try {
    await tools.executeTool('system.npc_state.rewrite_state', {
      chatSessionId: chat.id,
      sceneId: 'gate',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      statusBar: { hp: 9 },
      inventory: {
        items: [{ id: 'coin', name: '硬币', quantity: 1 }]
      }
    });
    await tools.executeTool('system.protagonist.switch_perspective', {
      chatSessionId: chat.id,
      sceneId: 'gate',
      toActorId: 'pc_arin',
      toPlayerId: 'player_1'
    });
    const possessed = await tools.executeTool('system.protagonist.switch_possession', {
      chatSessionId: chat.id,
      sceneId: 'gate',
      toActorId: 'pc_shadow',
      toPlayerId: 'player_shadow'
    });
    assert.equal(possessed.output.targetState.data.statusBar.hp, 9);

    const active = await tools.executeTool('system.protagonist.get_active', {
      chatSessionId: chat.id
    });
    assert.equal(active.output.active.data.activeActorId, 'pc_shadow');
  } finally {
    appDatabase.close();
  }
});
