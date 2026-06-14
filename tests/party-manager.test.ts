// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  NPC_REGISTRY_PLUGIN,
  NpcRegistry,
  PARTY_PLUGIN,
  PartyManager,
  SQLiteDataManager,
  ToolPluginManager,
  createDefaultToolPluginManager,
  createNpcRegistryHandlers,
  createPartyHandlers
} from '../src/index.js';

function createTestChat() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Party GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Party Test',
    includeGreeting: false
  }).session;
  return { appDatabase, character, chat };
}

test('party manager tracks teammates across scenes and assignments', () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new NpcRegistry({ dataManager });
  const party = new PartyManager({ appDatabase, npcRegistry: registry });

  try {
    registry.upsertNpc({
      id: 'npc_mira',
      name: 'Mira',
      actorType: 'companion',
      role: 'investigator mage',
      importance: 'major',
      tags: ['mage', 'silver-mist'],
      profileRef: 'profiles/npc_mira.json',
      summary: 'A silver-mist investigator.'
    });

    const mira = party.addMember({
      chatSessionId: chat.id,
      partyId: 'main',
      npcId: 'npc_mira',
      partyRole: 'scout',
      sceneId: 'camp',
      locationLabel: '篝火旁'
    });
    assert.equal(mira.data.name, 'Mira');
    assert.equal(mira.data.profileRef, 'profiles/npc_mira.json');
    assert.equal(mira.data.activityStatus, 'following');

    const assigned = party.assignMember({
      chatSessionId: chat.id,
      partyId: 'main',
      npcId: 'npc_mira',
      title: '侦察旧市场',
      objective: '去旧市场打听银钥匙和守卫换班。',
      destinationSceneId: 'old_market',
      locationLabel: '前往旧市场的路上',
      notes: ['不要暴露队伍身份']
    });
    assert.equal(assigned.data.activityStatus, 'assigned');
    assert.equal(assigned.data.destinationSceneId, 'old_market');
    assert.equal(assigned.data.assignment.objective, '去旧市场打听银钥匙和守卫换班。');

    const player = party.addMember({
      chatSessionId: chat.id,
      npcId: 'pc_arin',
      name: 'Arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1',
      partyRole: 'leader',
      tags: ['party', 'pc']
    });
    assert.equal(player.data.actorType, 'player');
    assert.equal(player.data.isPlayer, true);

    const context = party.buildPromptContext({
      chatSessionId: chat.id,
      partyId: 'main'
    });
    assert.match(context.context, /Assigned\/offscreen orders/);
    assert.match(context.context, /旧市场/);
    assert.equal(context.groups.following.length, 1);
    assert.equal(context.groups.assigned.length, 1);

    const standby = party.setMemberActivity({
      chatSessionId: chat.id,
      npcId: 'pc_arin',
      activityStatus: 'standby',
      sceneId: 'camp',
      locationLabel: '营地'
    });
    assert.equal(standby.data.activityStatus, 'standby');

    const listed = party.listMembers({
      chatSessionId: chat.id,
      partyId: 'main',
      query: 'mira'
    });
    assert.equal(listed.records.length, 1);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('party tools import, export, mutate roster, and register by default', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const tools = new ToolPluginManager({ trace: false });
  tools.createPlugin(NPC_REGISTRY_PLUGIN, {
    handlers: createNpcRegistryHandlers({ dataManager })
  });
  tools.createPlugin(PARTY_PLUGIN, {
    handlers: createPartyHandlers({ appDatabase, dataManager })
  });

  try {
    await tools.executeTool('system.npc_registry.upsert_npc', {
      id: 'npc_guard',
      name: 'Gate Guard',
      actorType: 'companion',
      role: 'shield bearer',
      tags: ['guard']
    }, undefined, {
      authorization: true
    });

    const imported = await tools.executeTool('system.party.import_document', {
      chatSessionId: chat.id,
      partyId: 'main',
      format: 'yaml',
      text: [
        'partyMembers:',
        '  - npcId: npc_guard',
        '    partyRole: escort',
        '    activityStatus: following',
        '    sceneId: gate',
        '  - memberId: npc_vendor_helper',
        '    name: Vendor Helper',
        '    actorType: companion',
        '    partyRole: hireling',
        '    activityStatus: standby',
        '    locationLabel: market stall'
      ].join('\n')
    });
    assert.equal(imported.output.count, 2);
    assert.equal(imported.output.records[0].data.name, 'Gate Guard');

    const assigned = await tools.executeTool('system.party.assign_member', {
      chatSessionId: chat.id,
      npcId: 'npc_guard',
      title: '守住后门',
      objective: '在仓库后门待命，发现追兵就吹哨。',
      destinationSceneId: 'warehouse_backdoor'
    });
    assert.equal(assigned.output.data.activityStatus, 'assigned');

    const listed = await tools.executeTool('system.party.list_members', {
      chatSessionId: chat.id,
      activityStatus: 'assigned'
    });
    assert.equal(listed.output.records.length, 1);
    assert.equal(listed.output.records[0].data.destinationSceneId, 'warehouse_backdoor');

    const prompt = await tools.executeTool('system.party.build_prompt_context', {
      chatSessionId: chat.id
    });
    assert.match(prompt.output.context, /Assigned\/offscreen orders/);

    const exported = await tools.executeTool('system.party.export_document', {
      chatSessionId: chat.id,
      format: 'yaml'
    });
    assert.match(exported.output.text, /partyMembers:/);
    assert.match(exported.output.text, /warehouse_backdoor/);

    const defaultTools = createDefaultToolPluginManager({ appDatabase, dataManager, trace: false });
    const ids = defaultTools.listTools().map((tool) => tool.id);
    assert.ok(ids.includes('system.party.add_member'));
    assert.ok(ids.includes('system.party.assign_member'));
    assert.ok(ids.includes('system.party.build_prompt_context'));
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('party removal can preserve history by marking former', () => {
  const { appDatabase, chat } = createTestChat();
  const party = new PartyManager({ appDatabase });

  try {
    party.addMember({
      chatSessionId: chat.id,
      npcId: 'npc_tmp',
      name: 'Temporary Ally'
    });
    const removed = party.removeMember({
      chatSessionId: chat.id,
      npcId: 'npc_tmp'
    });
    assert.equal(removed.deleted, false);
    assert.equal(removed.record.data.membershipStatus, 'former');

    const hidden = party.listMembers({
      chatSessionId: chat.id
    });
    assert.equal(hidden.records.length, 0);

    const included = party.listMembers({
      chatSessionId: chat.id,
      includeInactive: true
    });
    assert.equal(included.records.length, 1);
  } finally {
    appDatabase.close();
  }
});
