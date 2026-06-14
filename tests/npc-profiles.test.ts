// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NPC_PROFILES_PLUGIN,
  NpcProfileDatabase,
  SQLiteDataManager,
  ToolPluginManager,
  createNpcProfileHandlers
} from '../src/index.js';

test('npc profile database imports and exports L1-L3 profile records', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const profiles = new NpcProfileDatabase({ dataManager });

  const imported = profiles.importDocument({
    format: 'yaml',
    source: 'test-fixture',
    text: [
      'npcProfiles:',
      '  npc_mira:',
      '    name: Mira',
      '    tags: [mage, silver-mist]',
      '    L1:',
      '      summary: Silver-mist investigator.',
      '    L2:',
      '      sections:',
      '        persona: Careful, patient, and suspicious of easy answers.',
      '        goals: Find the bell tower ledger.',
      '    L3:',
      '      content: Full long-form roleplay profile.',
      '      characterCard:',
      '        data:',
      '          name: Mira'
    ].join('\n')
  }, {
    context: {
      authorization: true
    }
  });

  assert.equal(imported.count, 3);
  assert.deepEqual(imported.ids, [
    'profile_npc_mira_l1',
    'profile_npc_mira_l2',
    'profile_npc_mira_l3'
  ]);

  const bundle = profiles.getProfileBundle({ npcId: 'npc_mira' });
  assert.equal(bundle.levels.length, 3);
  assert.equal(bundle.levels[0].level, 'L1');
  assert.equal(bundle.levels[2].profile.data.characterCard.data.name, 'Mira');

  const exported = profiles.exportDocument({ format: 'json', npcId: 'npc_mira' });
  assert.equal(exported.payload.npcProfiles.length, 3);
  assert.match(exported.text, /Full long-form roleplay profile/);

  dataManager.close();
});

test('npc profile tools gate writes with a persistent access switch', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const profileDatabase = new NpcProfileDatabase({ dataManager });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(NPC_PROFILES_PLUGIN, {
    handlers: createNpcProfileHandlers({ database: profileDatabase })
  });

  const initialAccess = await manager.executeTool('system.npc_profiles.get_write_access', {});
  assert.equal(initialAccess.output.enabled, false);

  await assert.rejects(
    () => manager.executeTool('system.npc_profiles.upsert_profile', {
      npcId: 'npc_mira',
      level: 'L1',
      name: 'Mira',
      summary: 'Blocked write.'
    }),
    /write access is disabled/
  );

  await assert.rejects(
    () => manager.executeTool('system.npc_profiles.set_write_access', {
      enabled: true,
      reason: 'test'
    }),
    /requires explicit user authorization/
  );

  const enabled = await manager.executeTool('system.npc_profiles.set_write_access', {
    enabled: true,
    reason: 'user allows profile writes'
  }, undefined, {
    authorization: true
  });
  assert.equal(enabled.output.enabled, true);

  const written = await manager.executeTool('system.npc_profiles.upsert_profile', {
    npcId: 'npc_mira',
    level: 'L2',
    name: 'Mira',
    sections: {
      persona: 'Careful investigator.'
    }
  });
  assert.equal(written.output.id, 'profile_npc_mira_l2');

  await manager.executeTool('system.npc_profiles.set_write_access', {
    enabled: false,
    reason: 'close writes after edit'
  }, undefined, {
    authorization: true
  });

  const read = await manager.executeTool('system.npc_profiles.get_profile', {
    npcId: 'npc_mira',
    level: 'L2'
  });
  assert.equal(read.output.data.sections.persona, 'Careful investigator.');

  await assert.rejects(
    () => manager.executeTool('system.npc_profiles.delete_profile', {
      npcId: 'npc_mira',
      level: 'L2'
    }),
    /write access is disabled/
  );

  const manualImport = await manager.executeTool('system.npc_profiles.import_document', {
    format: 'yaml',
    text: [
      'npcProfiles:',
      '  - npcId: npc_mira',
      '    level: L3',
      '    content: Manual full profile import.'
    ].join('\n')
  }, undefined, {
    authorization: {
      approved: true,
      reason: 'manual import while agent writes remain closed'
    }
  });
  assert.equal(manualImport.output.count, 1);

  const exported = await manager.executeTool('system.npc_profiles.export_document', {
    npcId: 'npc_mira',
    format: 'yaml'
  });
  assert.match(exported.output.text, /Manual full profile import/);

  dataManager.close();
});
