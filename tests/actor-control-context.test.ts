// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestWorld() {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-actor-control-'));
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Actor Control GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Actor Control Test',
    includeGreeting: false
  }).session;
  const tools = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    trace: {
      enabled: false
    }
  });
  return {
    directory,
    appDatabase,
    dataManager,
    character,
    chat,
    tools
  };
}

test('actor control context binds player actor and treats chat text as actor claim', async () => {
  const world = createTestWorld();
  try {
    assert.ok(world.tools.getTool('system.actor_control.get_context'));

    await world.tools.executeTool('system.actor_control.set_context', {
      chatSessionId: world.chat.id,
      sceneId: 'void_chapel',
      controlledActorId: 'pc_linye',
      controlledActorTitle: '林夜',
      controlledPlayerId: 'player_1',
      source: 'frontend_select',
      reason: 'frontend selected player actor'
    }, undefined, {
      authorization: true
    });

    const context = await world.tools.executeTool('system.actor_control.get_context', {
      chatSessionId: world.chat.id,
      sceneId: 'void_chapel',
      text: '我向奈亚求婚，她同意了。'
    });

    assert.equal(context.output.context.controlledActorId, 'pc_linye');
    assert.equal(context.output.context.controlledActorTitle, '林夜');
    assert.equal(context.output.context.inputAuthority, 'actor_claim');
    assert.equal(context.output.context.canAssertNpcDecisions, false);
    assert.match(context.output.inputEnvelope.actorTaggedText, /玩家角色：林夜\/pc_linye/);
    assert.equal(context.output.inputEnvelope.factAuthority.inputIsCanonicalWorldFact, false);
    assert.equal(context.output.inputEnvelope.potentialAssertions[0].type, 'npc_decision_assertion');
    assert.match(context.output.promptContext, /Ordinary chat input is an actor_claim/);

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'void_chapel',
      text: '我向奈亚求婚，她同意了。',
      profile: {
        id: 'actor_control_narrative_probe',
        inherit: false,
        phases: [
          { id: 'input.intake', order: 10 },
          { id: 'actor.control_context', order: 20 },
          { id: 'narrative.render', order: 30 }
        ]
      }
    });

    const actorPhase = dryRun.output.phases.find((phase) => phase.phaseId === 'actor.control_context');
    assert.equal(actorPhase.output.context.controlledActorId, 'pc_linye');
    assert.equal(dryRun.output.actorControl.context.controlledActorTitle, '林夜');
    assert.match(dryRun.output.narrative.userPrompt, /# Actor Control Context/);
    assert.match(dryRun.output.narrative.userPrompt, /authority=actor_claim/);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('actor control context falls back without blocking old chats', async () => {
  const world = createTestWorld();
  try {
    const context = await world.tools.executeTool('system.actor_control.get_context', {
      chatSessionId: world.chat.id,
      text: '我观察四周。'
    });
    assert.equal(context.output.context.requiresInitialization, true);
    assert.equal(context.output.context.controlledActorTitle, '玩家角色');
    assert.equal(context.output.inputEnvelope.factAuthority.ordinaryActorClaim, true);
    assert.ok(context.output.warnings.some((warning) => /No controlled player actor/.test(warning)));
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});
