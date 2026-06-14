// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  RagService,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestWorld({ progress, chatProvider } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-agent-loop-'));
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null
  });
  const ragService = new RagService({
    defaultCollection: 'chat-runtime',
    chunkSize: 160,
    overlap: 20
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Loop GM',
      first_mes: 'Begin.',
      character_book: {
        name: 'Loop Worldbook',
        entries: [
          {
            uid: 'wb_old_market',
            comment: '旧市场钟楼密门',
            key: ['旧市场', '钟楼'],
            keysecondary: ['银钥匙', '密门'],
            content: '旧市场钟楼下存在一扇需要银钥匙开启的密门，男爵并不知道这条路。',
            priority: 90,
            ragGuidance: {
              priorityTerms: ['银钥匙', '旧市场钟楼'],
              queryExpansion: ['钟楼地窖', '男爵巡逻'],
              collectionHints: ['lore'],
              metadataFilters: { region: 'old_market' },
              promptHints: ['密门知识应该谨慎揭露']
            }
          }
        ]
      }
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Loop Test',
    includeGreeting: false
  }).session;
  const tools = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    ragService,
    chatProvider,
    progress,
    trace: {
      enabled: false,
      actionResolver: false,
      agentLoop: {
        directory: join(directory, 'agent-loop-traces')
      },
      contextPlanner: {
        directory: join(directory, 'context-planner-traces')
      }
    }
  });
  return {
    directory,
    appDatabase,
    dataManager,
    ragService,
    character,
    chat,
    tools
  };
}

test('agent loop exposes templates and dry-runs the default phase order with trace files', async () => {
  const world = createTestWorld();
  try {
    world.appDatabase.addChatMessage(world.chat.id, {
      role: 'user',
      name: 'Player',
      content: '我观察四周。'
    });

    const described = await world.tools.executeTool('system.agent_loop.describe_loop', {});
    assert.equal(described.output.defaultProfileId, 'default_v1');
    assert.ok(described.output.phaseOrder.includes('context.budget'));
    assert.ok(described.output.decoupling.loopOwns.includes('phase ordering'));

    const templates = await world.tools.executeTool('system.agent_loop.list_templates', {
      includePhases: true
    });
    assert.ok(templates.output.some((template) => template.id === 'default_v1'));
    assert.ok(templates.output.some((template) => template.id === 'minimal_debug_v1'));

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'market',
      text: '我观察旧市场四周。',
      maxContextTokens: 1200
    });

    assert.equal(dryRun.output.dryRun, true);
    assert.equal(dryRun.output.intent.intent, 'observation');
    assert.deepEqual(
      dryRun.output.phases.map((phase) => phase.phaseId),
      [
        'turn.snapshot',
        'deterministic.pre_tick',
        'input.intake',
        'actor.control_context',
        'baseline.load',
        'route.intent',
        'worldbook.activate',
        'rag.guidance',
        'retrieval.targeted',
        'context.budget',
        'resolver.orchestration',
        'adjudication',
        'impact.plan',
        'impact.route_validate',
        'state.commit',
        'reaction.npc',
        'reaction.environment',
        'narrative.render',
        'postprocess.memory',
        'debug.collect'
      ]
    );
    const worldbook = dryRun.output.phases.find((phase) => phase.phaseId === 'worldbook.activate').output;
    assert.equal(worldbook.activatedEntries.length, 1);
    assert.equal(worldbook.activatedEntries[0].id, 'wb_old_market');
    const ragGuidance = dryRun.output.phases.find((phase) => phase.phaseId === 'rag.guidance').output.guidance;
    assert.ok(ragGuidance.priorityTerms.includes('银钥匙'));
    assert.equal(ragGuidance.metadataFilters.region, 'old_market');
    assert.equal(dryRun.output.phases.find((phase) => phase.phaseId === 'context.budget').output.executed, true);
    assert.match(dryRun.output.phases.find((phase) => phase.phaseId === 'context.budget').output.input.query, /钟楼地窖/);
    assert.equal(dryRun.output.contextEnvelopes.length, 20);
    const actorControl = dryRun.output.phases.find((phase) => phase.phaseId === 'actor.control_context').output;
    assert.equal(actorControl.context.inputAuthority, 'actor_claim');
    assert.match(actorControl.inputEnvelope.actorTaggedText, /玩家角色/);
    const contextEnvelope = dryRun.output.phases.find((phase) => phase.phaseId === 'context.budget').contextEnvelope;
    assert.equal(contextEnvelope.kind, 'agent_loop_phase');
    assert.match(contextEnvelope.compactSummary, /executed|Object keys/);
    assert.equal(typeof contextEnvelope.stats.approxChars, 'number');
    assert.match(dryRun.output.narrative.userPrompt, /# Current Input/);
    assert.match(dryRun.output.narrative.userPrompt, /# Actor Control Context/);
    assert.match(dryRun.output.narrative.userPrompt, /# Worldbook Activated Snippets/);
    assert.equal(dryRun.output.debugSummary.format, 'ai-dnd-turn-debug-summary/v1');
    assert.equal(dryRun.output.debugSummary.debugOnly, true);
    assert.equal(dryRun.output.debugSummary.affectsNarrative, false);
    assert.ok(dryRun.output.debugSummary.router.allowedToolIds.includes('system.action.resolve'));
    assert.equal(existsSync(dryRun.output.trace.files.input), true);
    assert.equal(existsSync(dryRun.output.trace.files.output), true);
    assert.equal(existsSync(dryRun.output.trace.files.prompt), true);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop profiles can be saved, modified, and used for dry-runs', async () => {
  const world = createTestWorld();
  try {
    const profile = {
      id: 'custom_minimal_loop',
      name: 'Custom Minimal Loop',
      inherit: false,
      routes: [
        { intent: 'custom_route', keywords: ['魔改关键词'] }
      ],
      phases: [
        { id: 'input.intake', title: 'Input', order: 10 },
        { id: 'route.intent', title: 'Route', order: 20 },
        {
          id: 'narrative.render',
          title: 'Narrative',
          order: 30,
          config: {
            draftScene: '自定义场景层',
            draftNpcs: '自定义 NPC 层',
            draftNarrator: '自定义旁白层'
          }
        }
      ]
    };

    const saved = await world.tools.executeTool('system.agent_loop.upsert_profile', {
      id: profile.id,
      profile
    }, undefined, {
      authorization: true
    });
    assert.equal(saved.output.profile.id, profile.id);

    const listed = await world.tools.executeTool('system.agent_loop.list_profiles', {
      includePhases: true
    });
    assert.ok(listed.output.records.some((record) => record.id === profile.id));

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      profileId: profile.id,
      text: '我使用魔改关键词测试路由'
    });
    assert.deepEqual(dryRun.output.phases.map((phase) => phase.phaseId), [
      'input.intake',
      'route.intent',
      'narrative.render'
    ]);
    assert.equal(dryRun.output.intent.intent, 'custom_route');
    assert.equal(dryRun.output.narrative.layers.scene, '自定义场景层');
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop router sorts resolver candidates by user intent order and blocks unlisted tools', async () => {
  const world = createTestWorld();
  try {
	    const ordered = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      startMapId: 'market_square',
	      targetMapId: 'tavern',
	      text: '先移动到酒馆，然后交谈。',
	      profile: {
        id: 'router_order_profile',
        inherit: false,
        phases: [
          { id: 'input.intake', order: 10 },
          { id: 'route.intent', order: 20 },
          { id: 'resolver.orchestration', order: 30 }
        ]
      }
    });
    const route = ordered.output.intent;
    assert.equal(route.intent, 'movement');
    assert.deepEqual(route.orderedIntents.slice(0, 2).map((entry) => entry.intent), [
      'movement',
      'social_action'
    ]);
	    const resolver = ordered.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.deepEqual(resolver.candidates.map((candidate) => candidate.toolId), [
	      'system.map_relationships.find_scene_path',
	      'system.persuasion.resolve'
	    ]);
	    assert.equal(resolver.candidates[0].input.startMapId, 'market_square');
	    assert.equal(resolver.candidates[0].input.targetMapId, 'tavern');
	    assert.equal(resolver.candidates[0].input.sourceText, undefined);
	    assert.equal(resolver.candidates[0].input.text, undefined);
	    assert.equal(resolver.candidates[0].input.dryRun, undefined);
	    assert.equal(resolver.candidates[0].input.routerIntent, undefined);
	    assert.equal(resolver.candidates[0].input.actionPacing, undefined);
	    assert.equal(resolver.candidates[1].input.dryRun, undefined);
	    assert.equal(resolver.candidates[1].input.routerIntent, undefined);
	    assert.equal(resolver.candidates[1].input.actionPacing, undefined);
	    assert.deepEqual(resolver.candidates.map((candidate) => candidate.intent), [
	      'movement',
	      'social_action'
	    ]);

	    const executedMovement = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      startMapId: 'market_square',
	      targetMapId: 'tavern',
	      text: '我移动到酒馆。',
	      profile: {
	        id: 'router_execute_movement_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          {
	            id: 'resolver.orchestration',
	            order: 30,
	            config: { autoExecuteResolvers: true }
	          },
	          { id: 'adjudication', order: 40 }
	        ]
	      }
	    });
	    const executedMovementResolver = executedMovement.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    const executedMovementAdjudication = executedMovement.output.phases.find((phase) => phase.phaseId === 'adjudication').output;
	    assert.equal(executedMovementResolver.candidates[0].toolId, 'system.map_relationships.find_scene_path');
	    assert.equal(executedMovementResolver.candidates[0].input.sourceText, undefined);
	    assert.equal(executedMovementAdjudication.plannedOnly, false);
	    assert.ok(executedMovementAdjudication.resolverResult);

	    const missingPathTarget = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '先移动到酒馆，然后交谈。',
	      profile: {
	        id: 'router_missing_movement_endpoint_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    const missingPathResolver = missingPathTarget.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(missingPathResolver.candidates[0].toolId, 'system.action.resolve');
	    assert.equal(missingPathResolver.candidates[0].fallback, undefined);
	    assert.equal(missingPathTarget.output.intent.intent, 'player_action');
	    assert.equal(missingPathTarget.output.intent.metadata.routeClass, 'partial_specialized_macro_action');
	    assert.equal(missingPathResolver.blockedCandidates.length, 0);

	    const actionPurposeTravel = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '去修炼入门功法。',
	      profile: {
	        id: 'router_action_purpose_travel_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    const actionPurposeResolver = actionPurposeTravel.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(actionPurposeTravel.output.intent.intent, 'player_action');
	    assert.equal(actionPurposeResolver.candidates[0].toolId, 'system.action.resolve');
	    assert.equal(actionPurposeResolver.blockedCandidates.length, 0);

    const environment = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      text: '我把屋子炸了。',
      profile: {
        id: 'router_environment_profile',
        inherit: false,
        phases: [
          { id: 'input.intake', order: 10 },
          { id: 'route.intent', order: 20 },
          { id: 'resolver.orchestration', order: 30 }
        ]
      }
    });
    const environmentResolver = environment.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
    assert.equal(environment.output.intent.intent, 'environment_behavior');
    assert.equal(environmentResolver.candidates[0].toolId, 'system.environment_behavior.resolve');

    const blocked = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      text: '我攻击守卫。',
      profile: {
        id: 'router_block_profile',
        inherit: false,
        phases: [
          { id: 'input.intake', order: 10 },
          { id: 'route.intent', order: 20 },
          {
            id: 'resolver.orchestration',
            order: 30,
            config: {
              resolverTools: {
                combat_action: 'game.dice.check'
              }
            }
          }
        ]
      }
    });
    const blockedResolver = blocked.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
    assert.deepEqual(blockedResolver.candidates.map((candidate) => candidate.toolId), [
      'system.action.resolve'
    ]);
    assert.equal(blockedResolver.candidates[0].fallback, true);
    assert.equal(blockedResolver.candidates[0].playerDecisionLoop, true);
    assert.equal(blockedResolver.candidates[0].originalIntent, 'combat_action');
    assert.equal(blockedResolver.candidates[0].input.sourceText, '我攻击守卫。');
    assert.equal(blockedResolver.candidates[0].input.actionText, undefined);
	    assert.equal(blockedResolver.blockedCandidates[0].toolId, 'game.dice.check');
	    assert.match(blockedResolver.blockedCandidates[0].reason, /router_tool_not_allowed/);
	
	    const macroAction = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '修炼入门功法，杀些低级魔兽，加强自身修为和战力。',
	      profile: {
	        id: 'router_macro_action_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    assert.equal(macroAction.output.intent.intent, 'player_action');
	    assert.equal(macroAction.output.intent.metadata.routeClass, 'unmatched_player_input');
	    assert.equal(macroAction.output.intent.metadata.actionPacing, 'macro_resolution');
	    const macroResolver = macroAction.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(macroResolver.candidates[0].toolId, 'system.action.resolve');
	    assert.equal(macroResolver.candidates[0].input.routerIntent.metadata.routeClass, 'unmatched_player_input');
	    assert.equal(macroResolver.candidates[0].input.actionPacing.mode, 'macro_resolution');
	    assert.equal(macroResolver.candidates[0].input.actionPacing.scope, 'macro');

	    const genericMacro = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '整理材料，完成准备，提高成功率。',
	      profile: {
	        id: 'router_generic_macro_action_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    const genericMacroResolver = genericMacro.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(genericMacro.output.intent.intent, 'player_action');
	    assert.equal(genericMacroResolver.candidates[0].input.actionPacing.mode, 'macro_resolution');

	    const partialMovementMacro = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '去学入门功法，领取每月灵石。',
	      profile: {
	        id: 'router_partial_movement_macro_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    const partialMovementResolver = partialMovementMacro.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(partialMovementMacro.output.intent.intent, 'player_action');
	    assert.equal(partialMovementMacro.output.intent.metadata.routeClass, 'unmatched_player_input');
	    assert.equal(partialMovementResolver.candidates[0].toolId, 'system.action.resolve');
	    assert.equal(partialMovementResolver.candidates[0].input.actionPacing.mode, 'macro_resolution');

	    const genericPartialMovementMacro = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '去档案室整理资料，提交报告。',
	      profile: {
	        id: 'router_generic_partial_movement_macro_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    const genericPartialMovementResolver = genericPartialMovementMacro.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(genericPartialMovementMacro.output.intent.intent, 'player_action');
	    assert.equal(genericPartialMovementMacro.output.intent.metadata.routeClass, 'unmatched_player_input');
	    assert.equal(genericPartialMovementResolver.candidates[0].toolId, 'system.action.resolve');
	    assert.equal(genericPartialMovementResolver.candidates[0].input.actionPacing.mode, 'macro_resolution');

	    const combatPrepare = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      sceneId: 'arena',
	      text: '我打两只妖兽。',
	      profile: {
	        id: 'router_combat_prepare_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          {
	            id: 'resolver.orchestration',
	            order: 30,
	            config: { autoExecuteResolvers: true }
	          },
	          { id: 'adjudication', order: 40 }
	        ]
	      }
	    });
	    assert.equal(combatPrepare.output.intent.intent, 'combat_action');
	    assert.equal(combatPrepare.output.intent.metadata.routeClass, 'inferred_combat_action');
	    const combatPrepareResolver = combatPrepare.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(combatPrepareResolver.candidates[0].toolId, 'system.combat.prepare_battle');
	    const combatPrepareAdjudication = combatPrepare.output.phases.find((phase) => phase.phaseId === 'adjudication').output;
	    assert.equal(combatPrepareAdjudication.resolverTool.id, 'system.combat.prepare_battle');
	    assert.equal(combatPrepareAdjudication.resolverResult.status, 'dry_run');
	    assert.equal(combatPrepareAdjudication.resolverResult.enemies.length, 2);
	    assert.equal(combatPrepareAdjudication.resolverResult.enemies[0].skillBar.actions.length, 1);

	    const lookup = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '这里的门是什么来历？',
	      profile: {
	        id: 'router_lookup_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    assert.equal(lookup.output.intent.intent, 'information_query');
	    assert.equal(lookup.output.intent.metadata.actionPacing, 'none');
	    const lookupResolver = lookup.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(lookupResolver.candidates.length, 0);

	    const delegatedQuestion = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '我问老板娘：最近有什么传闻？',
	      profile: {
	        id: 'router_delegated_question_action_profile',
	        inherit: false,
	        phases: [
	          { id: 'input.intake', order: 10 },
	          { id: 'route.intent', order: 20 },
	          { id: 'resolver.orchestration', order: 30 }
	        ]
	      }
	    });
	    assert.equal(delegatedQuestion.output.intent.intent, 'player_action');
	    assert.equal(delegatedQuestion.output.intent.metadata.delegatedQuestionAction, true);
	    const delegatedResolver = delegatedQuestion.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
	    assert.equal(delegatedResolver.candidates[0].toolId, 'system.action.resolve');
	    assert.equal(delegatedResolver.candidates[0].input.actionPacing.mode, 'single_resolution');

	    const skipped = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
	      chatSessionId: world.chat.id,
	      text: '我向国王求婚，让他立刻投降。',
      profile: {
        id: 'router_skip_to_action_profile',
        inherit: false,
        phases: [
          { id: 'input.intake', order: 10 },
          {
            id: 'route.intent',
            order: 20,
            config: {
              routerPolicy: {
                intercepts: [
                  {
                    intent: 'social_action',
                    action: 'skip',
                    reason: '奇怪社交行为交给通用行动裁决'
                  }
                ]
              }
            }
          },
          { id: 'resolver.orchestration', order: 30 }
        ]
      }
    });
    const skippedResolver = skipped.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
    assert.deepEqual(skippedResolver.candidates.map((candidate) => candidate.toolId), [
      'system.action.resolve'
    ]);
    assert.equal(skippedResolver.candidates[0].fallback, true);
    assert.equal(skippedResolver.candidates[0].originalIntent, 'social_action');
    assert.equal(skipped.output.intent.intent, 'router_blocked');
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop can execute the default action resolver as the player appeal loop', async () => {
  const world = createTestWorld();
  try {
    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'market',
      text: '我检查旧市场的门锁。',
      profile: {
        id: 'auto_resolve_with_appeal_profile',
        inherit: false,
        phases: [
          { id: 'input.intake', order: 10 },
          { id: 'route.intent', order: 20 },
          {
            id: 'resolver.orchestration',
            order: 30,
            config: {
              autoExecuteResolvers: true
            }
          },
          { id: 'adjudication', order: 40 }
        ]
      }
    });

    const resolver = dryRun.output.phases.find((phase) => phase.phaseId === 'resolver.orchestration').output;
    assert.equal(resolver.selectedCandidate.toolId, 'system.action.resolve');
    assert.equal(resolver.selectedCandidate.playerDecisionLoop, true);
    const adjudication = dryRun.output.phases.find((phase) => phase.phaseId === 'adjudication').output;
    assert.equal(adjudication.plannedOnly, false);
    assert.equal(adjudication.resolverTool.id, 'system.action.resolve');
    assert.equal(adjudication.resolverResult.status, 'awaiting_player_decision');
    assert.equal(adjudication.resolverResult.choices[0].id, 'accept');
    assert.equal(adjudication.resolverResult.choices[1].id, 'appeal');
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop config router policy manages intent intercepts and resolver whitelist blocks', async () => {
  const world = createTestWorld();
  try {
    const config = {
      inherit: false,
      id: 'router_policy_flow',
      name: 'Router Policy Flow',
      routerPolicy: {
        allowedIntents: ['social_action'],
        blockedResolverToolIds: ['system.persuasion.resolve']
      },
      steps: [
        {
          id: 'main',
          title: 'Router Managed Loop',
          order: 10,
          modules: [
            { id: 'input.intake', order: 10 },
            { id: 'route.intent', order: 20 },
            {
              id: 'resolver.orchestration',
              order: 30,
              config: {
                fallbackToActionResolver: false
              }
            }
          ]
        }
      ]
    };

    const preview = await world.tools.executeTool('system.agent_loop.preview_config', {
      useActiveConfig: false,
      config
    });
    assert.equal(preview.output.summary.routerPolicyEnabled, true);
    assert.deepEqual(preview.output.sourceConfig.routerPolicy.allowedIntents, ['social_action']);

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_config_turn', {
      useActiveConfig: false,
      config,
      chatSessionId: world.chat.id,
      text: '先移动到酒馆，然后交谈。'
    });
    assert.equal(dryRun.output.finalOutput.intent.intent, 'social_action');
    assert.equal(dryRun.output.finalOutput.intent.blockedIntents[0].intent, 'player_action');
    assert.match(dryRun.output.finalOutput.intent.blockedIntents[0].reason, /router_intent_not_allowed:player_action/);

    const resolver = dryRun.output.steps[0].output.phases
      .find((phase) => phase.phaseId === 'resolver.orchestration').output;
    assert.deepEqual(resolver.candidates, []);
    assert.equal(resolver.blockedCandidates[0].toolId, 'system.persuasion.resolve');
    assert.match(resolver.blockedCandidates[0].reason, /router_tool_blocked/);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop configs can be saved, archived, hot-switched, and used for implicit profile selection', async () => {
  const world = createTestWorld();
  try {
    const management = await world.tools.executeTool('system.agent_loop.describe_loop_manager', {});
    assert.deepEqual(management.output.tokenModeFlowIds, [
      'handoff_none_flow_v1',
      'handoff_light_flow_v1',
      'handoff_super_flow_v1',
      'handoff_extreme_flow_v1'
    ]);
    const configTemplates = await world.tools.executeTool('system.agent_loop.list_configs', {
      includeTemplateSteps: true
    });
    const handoffTemplates = new Map(configTemplates.output.builtinTemplates
      .filter((template) => template.metadata?.handoffFamily === 'token_mode_variants')
      .map((template) => [template.id, template]));
    assert.deepEqual([...handoffTemplates.keys()], [
      'handoff_none_flow_v1',
      'handoff_light_flow_v1',
      'handoff_super_flow_v1',
      'handoff_extreme_flow_v1'
    ]);
    assert.equal(handoffTemplates.get('handoff_none_flow_v1').handoff.tokenMode, 'none');
    assert.equal(handoffTemplates.get('handoff_light_flow_v1').handoff.tokenMode, 'light');
    assert.equal(handoffTemplates.get('handoff_super_flow_v1').handoff.tokenMode, 'super');
    assert.equal(handoffTemplates.get('handoff_extreme_flow_v1').handoff.tokenMode, 'extreme');

    const profile = {
      id: 'custom_hot_switch_loop',
      name: 'Custom Hot Switch Loop',
      inherit: false,
      routes: [
        { intent: 'hot_switch_route', keywords: ['热切换关键词'] }
      ],
      phases: [
        { id: 'input.intake', title: 'Input', order: 10 },
        { id: 'route.intent', title: 'Route', order: 20 },
        {
          id: 'narrative.render',
          title: 'Narrative',
          order: 30,
          config: {
            draftScene: '热切换场景层',
            draftNpcs: '热切换 NPC 层',
            draftNarrator: '热切换旁白层'
          }
        }
      ]
    };

    await world.tools.executeTool('system.agent_loop.upsert_profile', {
      id: profile.id,
      profile
    }, undefined, {
      authorization: true
    });

    const saved = await world.tools.executeTool('system.agent_loop.upsert_config', {
      id: 'hot_switch_flow',
      config: {
        id: 'hot_switch_flow',
        name: 'Hot Switch Flow',
        activeProfileId: profile.id,
        phaseProgressLabels: {
          'route.intent': '正在热切换路由...'
        },
        steps: [
          {
            id: 'custom',
            order: 10,
            profileId: profile.id
          }
        ]
      }
    }, undefined, {
      authorization: true
    });
    assert.equal(saved.output.config.id, 'hot_switch_flow');

    const archived = await world.tools.executeTool('system.agent_loop.archive_config', {
      id: 'hot_switch_flow',
      label: 'before-session'
    }, undefined, {
      authorization: true
    });
    assert.equal(archived.output.configId, 'hot_switch_flow');

    const archives = await world.tools.executeTool('system.agent_loop.list_config_archives', {
      configId: 'hot_switch_flow'
    });
    assert.ok(archives.output.records.some((record) => record.data.configId === 'hot_switch_flow'));

    const switched = await world.tools.executeTool('system.agent_loop.switch_config', {
      id: 'hot_switch_flow',
      reason: 'test hot switch'
    }, undefined, {
      authorization: true
    });
    assert.equal(switched.output.activeConfigId, 'hot_switch_flow');

    const active = await world.tools.executeTool('system.agent_loop.get_active_config', {});
    assert.equal(active.output.activeConfigId, 'hot_switch_flow');
    assert.equal(active.output.config.activeProfileId, profile.id);

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      text: '我使用热切换关键词测试。'
    });
    assert.deepEqual(dryRun.output.phases.map((phase) => phase.phaseId), [
      'input.intake',
      'route.intent',
      'narrative.render'
    ]);
    assert.equal(dryRun.output.profileId, profile.id);
    assert.equal(dryRun.output.intent.intent, 'hot_switch_route');
    assert.equal(dryRun.output.phases.find((phase) => phase.phaseId === 'route.intent').progressLabel, '正在热切换路由...');
    assert.equal(dryRun.output.narrative.layers.scene, '热切换场景层');
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop flow configs expose and run editable module and tool order', async () => {
  const world = createTestWorld();
  try {
    const template = await world.tools.executeTool('system.agent_loop.get_config', {
      id: 'default_flow_v1'
    });
    const mainStep = template.output.config.steps[0];
    assert.equal(mainStep.executionModel, 'profile-modules');
    assert.equal(mainStep.replaceProfilePhases, true);
    assert.deepEqual(mainStep.moduleSequence.slice(0, 4), [
      'turn.snapshot',
      'deterministic.pre_tick',
      'input.intake',
      'actor.control_context'
    ]);
    assert.equal(mainStep.moduleSequence[4], 'baseline.load');
    assert.ok(mainStep.modules.some((moduleConfig) => moduleConfig.id === 'narrative.render' && moduleConfig.promptTemplate));

    const preview = await world.tools.executeTool('system.agent_loop.preview_config', {
      id: 'default_flow_v1'
    });
    assert.equal(preview.output.format, 'ai-dnd-loop-flow-preview/v1');
    assert.equal(preview.output.summary.stepCount, 1);
    assert.equal(preview.output.summary.moduleCount, 20);
    assert.equal(preview.output.steps[0].modules[0].contract.output.includes('availableTools'), true);
    assert.equal(preview.output.steps[0].modules.find((moduleConfig) => moduleConfig.id === 'narrative.render').prompt.hasTemplate, true);

    const shortPreview = await world.tools.executeTool('system.agent_loop.preview_config', {
      useActiveConfig: false,
      config: {
        inherit: false,
        id: 'short_preview_flow',
        steps: [
          {
            id: 'minimal',
            profileId: 'minimal_debug_v1'
          }
        ]
      }
    });
    assert.deepEqual(shortPreview.output.steps[0].modules.map((moduleConfig) => moduleConfig.id), [
      'turn.snapshot',
      'input.intake',
      'route.intent',
      'narrative.render'
    ]);

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_config_turn', {
      useActiveConfig: false,
      config: {
        inherit: false,
        id: 'module_order_flow',
        activeProfileId: 'default_v1',
        steps: [
          {
            id: 'module-main',
            title: 'Module Main',
            order: 10,
            profileId: 'default_v1',
            executionModel: 'profile-modules',
            replaceProfilePhases: true,
            modules: [
              {
                id: 'input.intake',
                title: 'Input First',
                order: 10
              },
              {
                id: 'narrative.render',
                title: 'Narrative Before Route',
                order: 20,
                config: {
                  draftScene: '模块顺序场景层'
                },
                toolCalls: [
                  {
                    id: 'echo_after_narrative',
                    toolId: 'core.utility.echo',
                    order: 10,
                    executeInDryRun: true,
                    input: {
                      text: '{{state.input.latestUserMessage}}'
                    }
                  }
                ]
              },
              {
                id: 'route.intent',
                title: 'Route Last',
                order: 30,
                progressLabel: '正在最后识别意图...'
              }
            ]
          }
        ]
      },
      chatSessionId: world.chat.id,
      text: '我检查门。'
    });

    const phases = dryRun.output.steps[0].output.phases;
    assert.deepEqual(phases.map((phase) => phase.phaseId), [
      'input.intake',
      'narrative.render',
      'route.intent'
    ]);
    assert.equal(phases[1].output.layers.scene, '模块顺序场景层');
    assert.equal(phases[1].toolCalls[0].status, 'success');
    assert.equal(phases[1].toolCalls[0].output.text, '我检查门。');
    assert.equal(phases[2].progressLabel, '正在最后识别意图...');
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop config turns stitch multiple loop steps with previous output handoff metadata', async () => {
  const world = createTestWorld();
  try {
    const profile = {
      id: 'second_step_loop',
      name: 'Second Step Loop',
      inherit: false,
      phases: [
        {
          id: 'input.intake',
          title: 'Input',
          order: 10,
          toolCalls: [
            {
              toolId: 'core.utility.echo',
              input: { text: 'debug' }
            }
          ]
        },
        {
          id: 'narrative.render',
          title: 'Narrative',
          order: 20,
          config: {
            draftScene: '第二环场景层',
            draftNpcs: '第二环 NPC 层',
            draftNarrator: '第二环旁白层'
          }
        }
      ]
    };

    await world.tools.executeTool('system.agent_loop.upsert_profile', {
      id: profile.id,
      profile
    }, undefined, {
      authorization: true
    });

    await world.tools.executeTool('system.agent_loop.upsert_config', {
      id: 'stitched_flow',
      config: {
        id: 'stitched_flow',
        name: 'Stitched Flow',
        activeProfileId: 'minimal_debug_v1',
        phaseProgressLabels: {
          'route.intent': '正在理解玩家意图...'
        },
        steps: [
          {
            id: 'preview',
            title: 'Preview',
            order: 10,
            profileId: 'minimal_debug_v1'
          },
          {
            id: 'second',
            title: 'Second',
            order: 20,
            profileId: profile.id,
            phaseProgressLabels: {
              'input.intake': '正在接收上一环结果...',
              'narrative.render': '正在生成第二环场景描述...'
            },
            input: {
              metadata: {
                receivedPreviewTurnId: '{{previous.turnId}}'
              }
            }
          }
        ]
      }
    }, undefined, {
      authorization: true
    });

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_config_turn', {
      configId: 'stitched_flow',
      chatSessionId: world.chat.id,
      text: '我观察旧市场。'
    });

    assert.equal(dryRun.output.configId, 'stitched_flow');
    assert.equal(dryRun.output.steps.length, 2);
    assert.deepEqual(dryRun.output.steps.map((step) => step.stepId), ['preview', 'second']);
    assert.deepEqual(dryRun.output.steps.map((step) => step.profileId), ['minimal_debug_v1', profile.id]);
    const previewRoute = dryRun.output.steps[0].output.phases.find((phase) => phase.phaseId === 'route.intent');
    const previewNarrative = dryRun.output.steps[0].output.phases.find((phase) => phase.phaseId === 'narrative.render');
    assert.equal(previewRoute.progressLabel, '正在理解玩家意图...');
    assert.equal(previewNarrative.progressLabel, '正在生成场景描述...');
    const secondInput = dryRun.output.steps[1].output.phases.find((phase) => phase.phaseId === 'input.intake').output;
    const secondInputPhase = dryRun.output.steps[1].output.phases.find((phase) => phase.phaseId === 'input.intake');
    const secondNarrative = dryRun.output.steps[1].output.phases.find((phase) => phase.phaseId === 'narrative.render');
    assert.equal(secondInputPhase.progressLabel, '正在接收上一环结果...');
    assert.equal(secondNarrative.progressLabel, '正在生成第二环场景描述...');
    assert.equal(secondInputPhase.toolCalls[0].progressLabel, '正在调用回显工具...');
    assert.equal(secondInput.metadata.agentLoopStep.id, 'second');
    assert.equal(secondInput.metadata.previousLoopOutput.turnId, dryRun.output.steps[0].output.turnId);
    assert.equal(secondInput.metadata.previousLoopSummary.turnId, dryRun.output.steps[0].output.turnId);
    assert.equal(secondInput.metadata.previousContextEnvelope.kind, 'agent_loop_handoff');
    assert.match(secondInput.metadata.previousContextEnvelope.compactSummary, /phases|contextEnvelopes|Object keys/);
    assert.ok(
      JSON.stringify(secondInput.metadata.previousLoopOutput).length
        < JSON.stringify(dryRun.output.steps[0].output).length
    );
    assert.equal(secondInput.metadata.receivedPreviewTurnId, dryRun.output.steps[0].output.turnId);
    assert.equal(dryRun.output.finalOutput.profileId, profile.id);

    const fullHandoff = await world.tools.executeTool('system.agent_loop.dry_run_config_turn', {
      useActiveConfig: false,
      config: {
        inherit: false,
        id: 'full_handoff_flow',
        activeProfileId: 'minimal_debug_v1',
        steps: [
          { id: 'preview', order: 10, profileId: 'minimal_debug_v1' },
          {
            id: 'second',
            order: 20,
            profileId: profile.id,
            handoff: { tokenMode: 'none' }
          }
        ]
      },
      chatSessionId: world.chat.id,
      text: '我观察旧市场。'
    });
    const fullSecondInput = fullHandoff.output.steps[1].output.phases.find((phase) => phase.phaseId === 'input.intake').output;
    assert.equal(fullSecondInput.metadata.previousHandoffPolicy.tokenMode, 'none');
    assert.ok(Array.isArray(fullSecondInput.metadata.previousLoopOutput.phases));

    const extremeHandoff = await world.tools.executeTool('system.agent_loop.dry_run_config_turn', {
      useActiveConfig: false,
      config: {
        inherit: false,
        id: 'extreme_handoff_flow',
        activeProfileId: 'minimal_debug_v1',
        steps: [
          { id: 'preview', order: 10, profileId: 'minimal_debug_v1' },
          {
            id: 'second',
            order: 20,
            profileId: profile.id,
            handoff: { tokenMode: 'extreme' }
          }
        ]
      },
      chatSessionId: world.chat.id,
      text: '我观察旧市场。'
    });
    const extremeSecondInput = extremeHandoff.output.steps[1].output.phases.find((phase) => phase.phaseId === 'input.intake').output;
    assert.equal(extremeSecondInput.metadata.previousHandoffPolicy.tokenMode, 'extreme');
    assert.equal(extremeSecondInput.metadata.previousLoopOutput.turnId, extremeHandoff.output.steps[0].output.turnId);
    assert.equal(extremeSecondInput.metadata.previousLoopOutput.phases, undefined);
    assert.ok(extremeSecondInput.metadata.previousLoopOutput.contextEnvelope.artifactRefs.length <= 2);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop emits progress and warns when custom phases lack progress labels', async () => {
  const events = [];
  const world = createTestWorld({ progress: (event) => events.push(event) });
  try {
    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      text: '我试着打开暗门。',
      profile: {
        id: 'missing_progress_label_profile',
        inherit: false,
        phases: [
          {
            id: 'custom.secret-door-check',
            title: 'Secret Door Check'
          }
        ]
      }
    });

    assert.equal(dryRun.output.phases[0].phaseId, 'custom.secret-door-check');
    assert.equal(dryRun.output.phases[0].progressLabel, '正在处理SecretDoorCheck...');
    assert.equal(dryRun.output.warnings[0].warning.code, 'missing_progress_label');
    assert.ok(events.some((event) => event.type === 'phase_warning' && event.phaseId === 'custom.secret-door-check'));
    assert.ok(events.some((event) => event.type === 'phase_started' && event.progressLabel === '正在处理SecretDoorCheck...'));
  } finally {
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop dry-run does not consume external LLM/API by default', async () => {
  let llmCalls = 0;
  const chatProvider = {
    generate: async () => {
      llmCalls += 1;
      return { content: 'LLM narrative content' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我观察旧市场。'
    });
    assert.equal(llmCalls, 0);
    assert.equal(dryRun.output.narrative.useLlm, true);
    assert.equal(dryRun.output.narrative.externalApiSkipped, true);
    assert.equal(dryRun.output.narrative.reason, 'dry_run_external_api_not_executed');

    const allowed = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我观察旧市场。',
      allowExternalApiInDryRun: true
    });
    assert.equal(llmCalls, 1);
    assert.equal(allowed.output.narrative.content, 'LLM narrative content');
  } finally {
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM narrative claims that conflict with written database facts', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你获得下品灵石3个，还额外获得星辉宝珠。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force narrative consistency test state writes'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我领取下品灵石2个。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(turn.output.narrative.consistencyReview.issues.some((issue) => issue.kind === 'currency_quantity_mismatch'));
    assert.ok(turn.output.narrative.consistencyReview.issues.some((issue) => issue.kind === 'unwritten_item_claim'));
    assert.match(turn.output.narrative.originalContent, /下品灵石3个/);
    assert.doesNotMatch(turn.output.narrative.content, /下品灵石3个|星辉宝珠/);

    const states = await world.tools.executeTool('system.npc_state.list_states', {
      chatSessionId: world.chat.id,
      limit: 50
    });
    const holder = states.output.records.find((record) => record.data.inventory?.currency?.low_grade_spirit_stone);
    assert.ok(holder);
    assert.equal(holder.data.inventory.currency.low_grade_spirit_stone, 2);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM item and currency consumption claims that were not spent', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你消耗疗伤丹1瓶，并扣除下品灵石3个。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop',
      actorType: 'player',
      isPlayer: true,
      name: 'Loop PC',
      inventory: {
        currency: { low_grade_spirit_stone: 5 },
        items: [{ id: 'healing_pill', name: '疗伤丹', quantity: 2 }]
      }
    });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force consumption consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我查看背包里的疗伤丹和灵石。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_item_consumption_claim'));
    assert.ok(issues.includes('unwritten_currency_consumption_claim'));
    assert.match(turn.output.narrative.originalContent, /消耗疗伤丹1瓶/u);
    assert.doesNotMatch(turn.output.narrative.content, /消耗疗伤丹1瓶|扣除下品灵石3个/u);

    const state = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop'
    });
    assert.equal(state.output.data.inventory.items.find((item) => item.name === '疗伤丹')?.quantity, 2);
    assert.equal(state.output.data.inventory.currency.low_grade_spirit_stone, 5);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows LLM item consumption narration when resource tool spent it', async () => {
  let chatSessionId = '';
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'consume_item_write',
            summary: 'Route item consumption through the resource manager.',
            tokenClassification: [],
            updates: [],
            newProposals: [{
              id: 'consume_healing_pill',
              tool: 'system.resources.consume_item',
              when: 'success',
              input: {
                chatSessionId,
                sceneId: 'current',
                npcId: 'pc_loop',
                itemId: 'healing_pill',
                itemName: '疗伤丹',
                amount: 1
              },
              reason: '消耗背包中的疗伤丹应走资源消耗工具。'
            }],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你消耗疗伤丹1瓶，药力开始在经脉里散开。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  chatSessionId = world.chat.id;
  try {
    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop',
      actorType: 'player',
      isPlayer: true,
      name: 'Loop PC',
      inventory: {
        items: [{ id: 'healing_pill', name: '疗伤丹', quantity: 2 }]
      }
    });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force valid consumption consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '请记录我消耗疗伤丹1瓶。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /消耗疗伤丹1瓶/u);
    assert.equal(turn.output.narrative.resolverGrounding.writtenFacts.itemConsumptions.find((item) => item.name === '疗伤丹')?.quantity, 1);

    const state = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop'
    });
    assert.equal(state.output.data.inventory.items.find((item) => item.name === '疗伤丹')?.quantity, 1);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM spell slot and ammo consumption claims that were not spent', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_resource_changes',
            summary: 'No resource rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你消耗一环法术位1个，并消耗箭矢2支。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop',
      actorType: 'player',
      isPlayer: true,
      name: 'Loop PC',
      resources: {
        spellSlots: { level1: { current: 2, max: 2 } },
        ammo: { arrows: { current: 5, max: 20, itemId: 'arrows', name: '箭矢' } }
      },
      inventory: {
        items: [{ id: 'arrows', name: '箭矢', quantity: 5 }]
      }
    });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force resource consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我查看法术位和箭矢。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.equal(issues.filter((kind) => kind === 'unwritten_resource_consumption_claim').length, 2);
    assert.match(turn.output.narrative.originalContent, /消耗一环法术位1个/u);
    assert.doesNotMatch(turn.output.narrative.content, /消耗一环法术位1个|消耗箭矢2支/u);

    const state = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop'
    });
    assert.equal(state.output.data.resources.spellSlots.level1.current, 2);
    assert.equal(state.output.data.resources.ammo.arrows.current, 5);
    assert.equal(state.output.data.inventory.items.find((item) => item.id === 'arrows')?.quantity, 5);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows LLM resource consumption narration when resource tools spent it', async () => {
  let chatSessionId = '';
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'spend_resource_write',
            summary: 'Route spell slot and ammo consumption through resource tools.',
            tokenClassification: [],
            updates: [],
            newProposals: [
              {
                id: 'spend_level1_slot',
                tool: 'system.resources.spend_resource',
                when: 'success',
                input: {
                  chatSessionId,
                  sceneId: 'current',
                  npcId: 'pc_loop',
                  category: 'spellSlots',
                  level: 1,
                  amount: 1
                },
                reason: '法术位消耗需要写入资源栏。'
              },
              {
                id: 'spend_arrows',
                tool: 'system.resources.spend_resource',
                when: 'success',
                input: {
                  chatSessionId,
                  sceneId: 'current',
                  npcId: 'pc_loop',
                  category: 'ammo',
                  resourceId: 'arrows',
                  itemId: 'arrows',
                  itemName: '箭矢',
                  amount: 2
                },
                reason: '箭矢消耗需要写入弹药资源和背包数量。'
              }
            ],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你消耗一环法术位1个，并消耗箭矢2支。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  chatSessionId = world.chat.id;
  try {
    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop',
      actorType: 'player',
      isPlayer: true,
      name: 'Loop PC',
      resources: {
        spellSlots: { level1: { current: 2, max: 2 } },
        ammo: { arrows: { current: 5, max: 20, itemId: 'arrows', name: '箭矢' } }
      },
      inventory: {
        items: [{ id: 'arrows', name: '箭矢', quantity: 5 }]
      }
    });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force valid resource consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '请记录我消耗一环法术位1个，并消耗箭矢2支。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /消耗一环法术位1个/u);
    assert.equal(turn.output.narrative.resolverGrounding.writtenFacts.resourceConsumptions.some((item) => item.category === 'spellSlots' && item.id === 'level1' && item.quantity === 1), true);
    assert.equal(turn.output.narrative.resolverGrounding.writtenFacts.resourceConsumptions.some((item) => item.category === 'ammo' && item.id === 'arrows' && item.quantity === 2), true);

    const state = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop'
    });
    assert.equal(state.output.data.resources.spellSlots.level1.current, 1);
    assert.equal(state.output.data.resources.ammo.arrows.current, 3);
    assert.equal(state.output.data.inventory.items.find((item) => item.id === 'arrows')?.quantity, 3);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM party join claims that were not written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_party_changes',
            summary: 'No party roster rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：白芷已经加入你的队伍，成为队友。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('system.npc_registry.upsert_npc', {
      id: 'npc_baizhi',
      name: '白芷',
      actorType: 'companion',
      role: '追踪线索的散修'
    }, undefined, { authorization: true });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force party consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我确认白芷是否愿意跟上。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_party_member_claim'));
    assert.match(turn.output.narrative.originalContent, /白芷已经加入你的队伍/u);
    assert.doesNotMatch(turn.output.narrative.content, /白芷已经加入你的队伍|成为队友/u);

    const party = await world.tools.executeTool('system.party.list_members', {
      chatSessionId: world.chat.id,
      includeInactive: true
    });
    assert.equal(party.output.records.length, 0);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows LLM party join narration when party roster was written', async () => {
  let chatSessionId = '';
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'write_party_join',
            summary: 'Route companion join into party roster.',
            tokenClassification: [],
            updates: [],
            newProposals: [{
              id: 'add_baizhi_party_member',
              tool: 'system.party.add_member',
              when: 'success',
              input: {
                chatSessionId,
                partyId: 'main',
                npcId: 'npc_baizhi',
                name: '白芷',
                actorType: 'companion',
                partyRole: 'companion',
                membershipStatus: 'active',
                activityStatus: 'following',
                source: 'semantic-write-test'
              },
              reason: 'NPC joining the party must be stored in the party roster.'
            }],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：白芷已经加入你的队伍，成为队友。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  chatSessionId = world.chat.id;
  try {
    await world.tools.executeTool('system.npc_registry.upsert_npc', {
      id: 'npc_baizhi',
      name: '白芷',
      actorType: 'companion',
      role: '追踪线索的散修'
    }, undefined, { authorization: true });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force valid party consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我邀请白芷同行。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /白芷已经加入你的队伍/u);
    assert.equal(turn.output.narrative.resolverGrounding.writtenFacts.partyMembers.some((member) => member.name === '白芷' && member.activityStatus === 'following'), true);

    const party = await world.tools.executeTool('system.party.list_members', {
      chatSessionId: world.chat.id,
      query: '白芷'
    });
    assert.equal(party.output.records.length, 1);
    assert.equal(party.output.records[0].data.activityStatus, 'following');
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM current-scene NPC presence claims that were not mounted', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_scene_npc_changes',
            summary: 'No scene NPC mount rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：白芷出现在你面前，站在当前场景入口。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('system.npc_registry.upsert_npc', {
      id: 'npc_baizhi',
      name: '白芷',
      actorType: 'npc',
      role: '炼丹师'
    }, undefined, { authorization: true });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force scene NPC presence consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      profileId: 'llm_narrative_v1',
      text: '我观察营地入口。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_scene_npc_presence_claim'));
    assert.match(turn.output.narrative.originalContent, /白芷出现在你面前/u);
    assert.doesNotMatch(turn.output.narrative.content, /白芷出现在你面前|当前场景入口/u);

    const mounted = await world.tools.executeTool('system.scene_npcs.list_mounted_npcs', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      includeInactive: true,
      query: '白芷'
    });
    assert.equal(mounted.output.records.length, 0);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows current-scene NPC presence narration when semantic write mounts the NPC', async () => {
  let chatSessionId = '';
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'write_scene_npc_mount',
            summary: 'Route visible NPC arrival into current scene mounts.',
            tokenClassification: [],
            updates: [],
            newProposals: [{
              id: 'mount_baizhi_current_scene',
              tool: 'system.scene_npcs.mount_npc',
              when: 'success',
              input: {
                chatSessionId,
                sceneId: 'current',
                npcId: 'npc_baizhi',
                name: '白芷',
                actorType: 'npc',
                role: '炼丹师',
                status: 'present',
                visibility: 'visible',
                locationLabel: '营地入口',
                source: 'semantic-write-test'
              },
              reason: 'NPC appearing in the current scene must be mounted for scene UI/context.'
            }],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：白芷出现在你面前，站在当前场景入口。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  chatSessionId = world.chat.id;
  try {
    await world.tools.executeTool('system.npc_registry.upsert_npc', {
      id: 'npc_baizhi',
      name: '白芷',
      actorType: 'npc',
      role: '炼丹师'
    }, undefined, { authorization: true });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force valid scene NPC presence consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      profileId: 'llm_narrative_v1',
      text: '我观察营地入口，白芷是否出现在当前场景。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /白芷出现在你面前/u);
    assert.equal(turn.output.narrative.resolverGrounding.writtenFacts.sceneNpcs.some((npc) => npc.name === '白芷' && npc.status === 'present'), true);

    const mounted = await world.tools.executeTool('system.scene_npcs.list_mounted_npcs', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      query: '白芷'
    });
    assert.equal(mounted.output.records.length, 1);
    assert.equal(mounted.output.records[0].data.status, 'present');
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM current-scene map claims that were not mounted', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_scene_map_changes',
            summary: 'No scene map mount rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：当前场景变为黑雾井底，地图面板显示黑雾井底。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('system.map_registry.upsert_map', {
      mapId: 'map_black_mist_well',
      name: '黑雾井底',
      type: 'dungeon'
    }, undefined, { authorization: true });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force scene map consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      profileId: 'llm_narrative_v1',
      text: '我查看当前地点。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_scene_map_presence_claim'));
    assert.match(turn.output.narrative.originalContent, /当前场景变为黑雾井底/u);
    assert.doesNotMatch(turn.output.narrative.content, /当前场景变为黑雾井底|地图面板显示黑雾井底/u);

    const mounted = await world.tools.executeTool('system.scene_maps.list_mounted_maps', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      includeInactive: true,
      query: '黑雾井底'
    });
    assert.equal(mounted.output.records.length, 0);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows current-scene map narration when semantic write mounts the map', async () => {
  let chatSessionId = '';
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'write_scene_map_mount',
            summary: 'Route visible current location into scene map mounts.',
            tokenClassification: [],
            updates: [],
            newProposals: [{
              id: 'mount_black_mist_well_current_scene',
              tool: 'system.scene_maps.mount_map',
              when: 'success',
              input: {
                chatSessionId,
                sceneId: 'current',
                mapId: 'map_black_mist_well',
                name: '黑雾井底',
                type: 'dungeon',
                status: 'active',
                visibility: 'visible',
                locationLabel: '井底入口',
                source: 'semantic-write-test'
              },
              reason: 'Current-scene location must be mounted for map UI/context.'
            }],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：当前场景变为黑雾井底，地图面板显示黑雾井底。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  chatSessionId = world.chat.id;
  try {
    await world.tools.executeTool('system.map_registry.upsert_map', {
      mapId: 'map_black_mist_well',
      name: '黑雾井底',
      type: 'dungeon'
    }, undefined, { authorization: true });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force valid scene map consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      profileId: 'llm_narrative_v1',
      text: '我确认当前场景变为黑雾井底。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /当前场景变为黑雾井底/u);
    assert.equal(turn.output.narrative.resolverGrounding.writtenFacts.sceneMaps.some((map) => map.name === '黑雾井底' && map.status === 'active'), true);

    const mounted = await world.tools.executeTool('system.scene_maps.list_mounted_maps', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      query: '黑雾井底'
    });
    assert.equal(mounted.output.records.length, 1);
    assert.equal(mounted.output.records[0].data.status, 'active');
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM equipment equip and unequip claims that were not written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_equipment_changes',
            summary: 'No equipment rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你已经装备青锋剑，并卸下玄铁盾。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop',
      actorType: 'player',
      isPlayer: true,
      name: 'Loop PC',
      inventory: {
        items: [
          { id: 'qingfeng_sword', name: '青锋剑', quantity: 1 },
          { id: 'black_iron_shield', name: '玄铁盾', quantity: 1 }
        ]
      }
    });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force equipment consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我查看身上的装备。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_equipment_claim'));
    assert.ok(issues.includes('unwritten_equipment_removal_claim'));
    assert.match(turn.output.narrative.originalContent, /装备青锋剑/u);
    assert.doesNotMatch(turn.output.narrative.content, /装备青锋剑|卸下玄铁盾/u);

    const state = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop'
    });
    assert.equal(state.output.data.equipment.mainHand, undefined);
    assert.equal(state.output.data.inventory.items.find((item) => item.name === '青锋剑')?.equipped, false);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows LLM equipment narration when npc state wrote equipment', async () => {
  let chatSessionId = '';
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'equip_state_write',
            summary: 'Write equipped weapon into actor state.',
            tokenClassification: [],
            updates: [],
            newProposals: [{
              id: 'equip_qingfeng_sword',
              tool: 'system.npc_state.patch_state',
              when: 'success',
              input: {
                chatSessionId,
                sceneId: 'current',
                npcId: 'pc_loop',
                actorType: 'player',
                isPlayer: true,
                name: 'Loop PC',
                inventory: {
                  items: [{ id: 'qingfeng_sword', name: '青锋剑', quantity: 1, equipped: true }]
                },
                equipment: {
                  mainHand: { id: 'qingfeng_sword', name: '青锋剑', slot: 'mainHand' }
                }
              },
              reason: '装备变化应写入角色装备栏。'
            }],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你已经装备青锋剑。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  chatSessionId = world.chat.id;
  try {
    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop',
      actorType: 'player',
      isPlayer: true,
      name: 'Loop PC',
      inventory: {
        items: [{ id: 'qingfeng_sword', name: '青锋剑', quantity: 1 }]
      }
    });
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force valid equipment consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '请记录我装备青锋剑。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /装备青锋剑/u);
    assert.equal(turn.output.narrative.resolverGrounding.writtenFacts.equipment.some((item) => item.name === '青锋剑'), true);

    const state = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_loop'
    });
    assert.equal(state.output.data.equipment.mainHand.name, '青锋剑');
    assert.equal(state.output.data.inventory.items.find((item) => item.name === '青锋剑')?.equipped, true);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM success narration when dice adjudication failed', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return { content: '旁白：你成功破解封印，行动完成。' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 1,
      reason: 'force failed adjudication consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我尝试破解不可能的古神封印。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.resolverGrounding.diceRolled, true);
    assert.equal(turn.output.narrative.resolverGrounding.success, false);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(turn.output.narrative.consistencyReview.issues.some((issue) => issue.kind === 'resolution_success_claim_on_failed_adjudication'));
    assert.match(turn.output.narrative.originalContent, /成功破解封印/);
    assert.doesNotMatch(turn.output.narrative.content, /成功破解封印|行动完成/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows LLM success narration when dice adjudication succeeded', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return { content: '旁白：你成功破解封印，行动完成。' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force successful adjudication consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我尝试破解不可能的古神封印。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.resolverGrounding.diceRolled, true);
    assert.equal(turn.output.narrative.resolverGrounding.success, true);
    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /成功破解封印/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM narrative status and actor value claims that were not written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：你进入中毒状态，生命值变为5。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force status consistency test state writes'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我修炼入门功法1次。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_status_claim'));
    assert.ok(issues.includes('unwritten_actor_value_claim'));
    assert.doesNotMatch(turn.output.narrative.content, /中毒状态|生命值变为5/u);

    const states = await world.tools.executeTool('system.npc_state.list_states', {
      chatSessionId: world.chat.id,
      limit: 50
    });
    assert.equal(states.output.records.some((record) => record.data.specialStatuses?.some((status) => status.name === '中毒')), false);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM narrative faction, quest, and extension fact mismatches', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：青狐帮已经友好待你，青狐帮和云岚宗已经结盟；灵脉污染指数为42；调查黑雾井任务已经完成。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force relationship consistency test state writes'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我在青岚镇酒馆听到传闻：黑雾井下有失踪矿工。我立刻接下调查黑雾井的委托；青狐帮开始敌视我；青狐帮和云岚宗的关系从中立转为紧张。我还记录一个自定义扩展数据：灵脉污染指数目前为37，污染源描述为井底黑雾。请按剧情结果推进并记录这些变化。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('faction_membership_status_mismatch'));
    assert.ok(issues.includes('faction_relation_status_mismatch'));
    assert.ok(issues.includes('extension_fact_value_mismatch'));
    assert.ok(issues.includes('quest_status_mismatch'));
    assert.doesNotMatch(turn.output.narrative.content, /友好待你|已经结盟|灵脉污染指数为42|任务已经完成/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM extension fact claims that were never written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：灵脉稳定度为甲，炉温波动为丙，妖兽战力为12。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force unwritten extension fact narrative consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我观察炼丹炉。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues;
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.equal(issues.filter((issue) => issue.kind === 'unwritten_extension_fact_claim').length, 3);
    assert.match(turn.output.narrative.originalContent, /灵脉稳定度为甲/u);
    assert.doesNotMatch(turn.output.narrative.content, /灵脉稳定度为甲|炉温波动为丙|妖兽战力为12/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM feat acquisition claims that were not written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return { content: '旁白：你获得剑心通明专长。' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force unwritten feat narrative consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我观察石碑上的剑痕。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_feat_claim'));
    assert.match(turn.output.narrative.originalContent, /剑心通明专长/u);
    assert.doesNotMatch(turn.output.narrative.content, /获得剑心通明专长/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM skill acquisition claims when only a skill definition was written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'skill_definition_only',
            summary: 'Only define the skill in mechanics registry, do not add it to actor skill state.',
            tokenClassification: [
              {
                token: '青木诀',
                classification: 'skill',
                metadata: { category: 'cultivation' },
                reason: 'The player read a record that names the skill, but did not learn it.'
              }
            ],
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return { content: '旁白：你习得青木诀功法。' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force skill definition consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '补漏设定：新功法青木诀功法只是宗门藏书里的名称。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('skill_definition_only_claimed_as_learned'));
    assert.match(turn.output.narrative.originalContent, /青木诀功法/u);
    assert.doesNotMatch(turn.output.narrative.content, /习得青木诀功法/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('action resolver semantic classifier writes acquired feats into registry and actor state', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'semantic_feat_acquisition',
            summary: 'Classify acquired feat into mechanics registry and actor state.',
            tokenClassification: [
              {
                token: '剑心通明专长',
                classification: 'feat',
                status: 'learned',
                metadata: { category: 'combat', tier: 'novice' },
                reason: 'The player acquired this feat.'
              }
            ],
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return { content: '{}' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force feat acquisition consistency test'
    }, undefined, {
      authorization: true
    });

    const resolved = await world.tools.executeTool('system.action.resolve', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      actorId: 'pc_feat',
      sourceText: '补漏设定：我获得剑心通明专长。',
      useLlm: true,
      dryRun: false,
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const appliedTools = resolved.output.currentResolution.apply.appliedToolCalls.map((call) => call.tool);
    assert.ok(appliedTools.includes('system.mechanics_registry.upsert_feat'));
    assert.ok(appliedTools.includes('system.npc_state.patch_state'));

    const feats = await world.tools.executeTool('system.mechanics_registry.list_feats', { query: '剑心通明', limit: 20 });
    assert.equal(feats.output.records.some((record) => record.data.name === '剑心通明专长'), true);
    const actorState = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_feat'
    });
    assert.equal(actorState.output.data.skillBar.feats.some((feat) => feat.name === '剑心通明专长' && feat.status === 'learned'), true);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('action resolver semantic classifier writes active statuses into registry and actor state', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'semantic_status_application',
            summary: 'Classify active status into mechanics registry and actor state.',
            tokenClassification: [
              {
                token: '寒毒状态',
                classification: 'status',
                status: 'active',
                metadata: { category: 'debuff', severity: 'moderate', durationType: 'scene' },
                reason: 'The player is affected by this status.'
              }
            ],
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return { content: '{}' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force active status semantic classifier test'
    }, undefined, {
      authorization: true
    });

    const resolved = await world.tools.executeTool('system.action.resolve', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      actorId: 'pc_status',
      sourceText: '补漏设定：我进入寒毒状态。',
      useLlm: true,
      dryRun: false,
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const appliedTools = resolved.output.currentResolution.apply.appliedToolCalls.map((call) => call.tool);
    assert.ok(appliedTools.includes('system.mechanics_registry.upsert_status'));
    assert.ok(appliedTools.includes('system.npc_state.patch_state'));

    const statuses = await world.tools.executeTool('system.mechanics_registry.list_statuses', { query: '寒毒', limit: 20 });
    assert.equal(statuses.output.records.some((record) => record.data.name === '寒毒状态'), true);
    const actorState = await world.tools.executeTool('system.npc_state.get_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: 'pc_status'
    });
    assert.equal(actorState.output.data.specialStatuses.some((status) => status.name === '寒毒状态' && status.active), true);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM entity, quest, faction, and relationship claims that were never written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：新NPC白芷已记录，新地图星砂塔已开放，调查黑雾井任务已记录，青狐帮已经敌视你，白芷已经信任你。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force unwritten entity narrative consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我观察告示牌。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('unwritten_npc_claim'));
    assert.ok(issues.includes('unwritten_map_claim'));
    assert.ok(issues.includes('unwritten_quest_claim'));
    assert.ok(issues.includes('unwritten_faction_claim'));
    assert.ok(issues.includes('unwritten_npc_relationship_claim'));
    assert.match(turn.output.narrative.originalContent, /新NPC白芷已记录/u);
    assert.doesNotMatch(turn.output.narrative.content, /新NPC白芷已记录|新地图星砂塔已开放|调查黑雾井任务已记录|青狐帮已经敌视你|白芷已经信任你/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM map route claims that were never written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：通往星砂塔的路线已开放，你已经可以前往黑雾井底。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force unwritten map route narrative consistency test'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我观察路牌。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const routeIssues = turn.output.narrative.consistencyReview.issues.filter((issue) => issue.kind === 'unwritten_map_route_claim');
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.equal(routeIssues.length, 2);
    assert.match(turn.output.narrative.originalContent, /通往星砂塔的路线已开放/u);
    assert.doesNotMatch(turn.output.narrative.content, /通往星砂塔的路线已开放|可以前往黑雾井底/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM movement arrival narration when scene path is unavailable', async () => {
  const chatProvider = {
    async generate() {
      return {
        content: '旁白：你成功抵达星砂塔，当前位置变为星砂塔。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      startMapId: 'old_market',
      targetMapId: 'star_tower',
      profile: {
        id: 'movement_path_unavailable_consistency_profile',
        inherit: false,
        phases: [
          { id: 'input.intake', order: 10 },
          { id: 'route.intent', order: 20 },
          { id: 'resolver.orchestration', order: 30, config: { autoExecuteResolvers: true } },
          { id: 'adjudication', order: 40 },
          { id: 'narrative.render', order: 50, config: { useLlm: true } }
        ]
      },
      text: '我前往星砂塔。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const narrative = turn.output.phases.find((phase) => phase.phaseId === 'narrative.render').output;
    const issues = narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(narrative.resolverGrounding.status, 'path_unavailable');
    assert.equal(narrative.resolverGrounding.movement.found, false);
    assert.equal(narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('ungrounded_movement_arrival_claim'));
    assert.ok(issues.includes('resolution_success_claim_on_failed_adjudication'));
    assert.match(narrative.originalContent, /成功抵达星砂塔/u);
    assert.doesNotMatch(narrative.content, /成功抵达星砂塔|当前位置变为星砂塔/u);
  } finally {
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM narrative combat victory and loot before combat settlement', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return {
        content: '旁白：战斗胜利，妖兽1已经死亡，你获得低级妖兽素材2个。'
      };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force combat consistency test state writes'
    }, undefined, {
      authorization: true
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我打两只低级妖兽。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('ungrounded_combat_victory_claim'));
    assert.ok(issues.includes('ungrounded_combat_defeat_claim'));
    assert.ok(issues.includes('unwritten_item_claim'));
    assert.doesNotMatch(turn.output.narrative.content, /战斗胜利|妖兽1已经死亡|低级妖兽素材2个/u);

    const battles = await world.tools.executeTool('system.combat.list_battles', {
      chatSessionId: world.chat.id,
      limit: 20
    });
    assert.equal(battles.output.records.some((record) => record.data.status === 'active'), true);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks LLM combat start claims when no battle was written', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      if (/# Resolver Grounding/i.test(lastUser)) {
        return { content: '旁白：战斗开始，低级妖兽进入战斗。' };
      }
      return { content: '{}' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我观察林间空地。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const issues = turn.output.narrative.consistencyReview.issues.map((issue) => issue.kind);
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(issues.includes('ungrounded_combat_start_claim'));
    assert.ok(issues.includes('ungrounded_combat_enemy_claim'));
    assert.match(turn.output.narrative.originalContent, /战斗开始/u);
    assert.doesNotMatch(turn.output.narrative.content, /战斗开始|进入战斗/u);
  } finally {
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows LLM combat start claims when prepare_battle wrote enemies and battle', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      if (/# Resolver Grounding/i.test(lastUser)) {
        return { content: '旁白：战斗开始，妖兽1和妖兽2进入战斗。' };
      }
      return { content: '{}' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我打两只低级妖兽。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const combat = turn.output.narrative.resolverGrounding.combat;
    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.equal(combat.battleStarted, true);
    assert.equal(combat.enemyCount, 2);
    assert.ok(combat.enemyNames.includes('妖兽1'));
    assert.ok(combat.enemyNames.includes('妖兽2'));
    assert.match(turn.output.narrative.content, /战斗开始，妖兽1和妖兽2进入战斗/u);
  } finally {
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop allows LLM combat defeat claims when resolver wrote target HP to zero', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      if (/我攻击妖兽1/u.test(lastUser)) {
        return { content: '旁白：你击杀妖兽1。' };
      }
      return { content: '旁白：战斗开始，敌人仍在场。' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force grounded combat defeat narrative'
    }, undefined, {
      authorization: true
    });

    await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我打低级妖兽。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    const battles = await world.tools.executeTool('system.combat.list_battles', {
      chatSessionId: world.chat.id,
      limit: 20
    });
    const battle = battles.output.records.find((record) => record.data.status === 'active')?.data;
    assert.ok(battle);
    const enemyId = battle.enemyIds[0];
    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'current',
      npcId: enemyId,
      values: { hp: 1 },
      source: 'test.force-near-defeat'
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我攻击妖兽1。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.consistencyReview.status, 'ok');
    assert.match(turn.output.narrative.content, /击杀妖兽1/u);
    assert.equal(turn.output.narrative.resolverGrounding.combat.targetDefeated, true);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop blocks stale monster escape narration after recent NPC tracking focus', async () => {
  const chatProvider = {
    async generate({ messages }) {
      const lastUser = messages.at(-1)?.content || '';
      if (/Semantic Database Write Planner/i.test(lastUser)) {
        return {
          content: JSON.stringify({
            decisionId: 'no_semantic_changes',
            summary: 'No semantic rewrite needed.',
            updates: [],
            newProposals: [],
            droppedProposalIds: []
          })
        };
      }
      return { content: '旁白：你从妖兽的追击中逃离。' };
    }
  };
  const world = createTestWorld({ chatProvider });
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'force stale context narrative consistency test'
    }, undefined, {
      authorization: true
    });

    await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我打两只低级妖兽。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我跟踪炼丹师白芷，保持距离观察她去哪里。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    world.appDatabase.addChatMessage(world.chat.id, {
      role: 'user',
      name: 'Player',
      content: '我打两只低级妖兽。'
    });
    world.appDatabase.addChatMessage(world.chat.id, {
      role: 'assistant',
      name: 'Loop GM',
      content: '妖兽记录保留在旧战斗状态里。'
    });
    world.appDatabase.addChatMessage(world.chat.id, {
      role: 'user',
      name: 'Player',
      content: '我跟踪炼丹师白芷，保持距离观察她去哪里。'
    });

    const turn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      profileId: 'llm_narrative_v1',
      text: '我要逃跑。',
      continueOnError: true
    }, undefined, {
      authorization: true
    });

    assert.equal(turn.output.narrative.resolverGrounding.contextFocus.currentInputClass, 'short_or_elliptic');
    assert.equal(turn.output.narrative.resolverGrounding.contextFocus.foreground.kind, 'tracking');
    assert.ok(turn.output.narrative.resolverGrounding.contextFocus.foregroundTargetCandidates.includes('白芷'));
    assert.equal(turn.output.narrative.consistencyReview.status, 'blocked');
    assert.ok(turn.output.narrative.consistencyReview.issues.some((issue) => issue.kind === 'stale_context_combat_target_claim'));
    assert.match(turn.output.narrative.originalContent, /妖兽的追击/u);
    assert.doesNotMatch(turn.output.narrative.content, /妖兽|魔兽|怪物/u);
  } finally {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true }).catch(() => {});
    world.dataManager.close();
    world.appDatabase.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop run_turn requires user authorization', async () => {
  const world = createTestWorld();
  try {
    await assert.rejects(
      () => world.tools.executeTool('system.agent_loop.run_turn', {
        chatSessionId: world.chat.id,
        text: '我向前走。'
      }),
      /requires explicit user authorization/
    );

    const authorized = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      text: '我向前走。',
      dryRun: true
    }, undefined, {
      authorization: true
    });
    assert.equal(authorized.output.dryRun, true);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop run_turn auto-triggers encounter, reactions, compression, and runtime rag', async () => {
  const world = createTestWorld();
  try {
    await world.tools.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 100,
      fixedRoll: 100
    }, undefined, { authorization: true });

    const encounterTurn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      text: '我在废弃矿井里慢慢探索，看看会不会遇到奇遇。',
      toolContext: { authorization: true }
    }, undefined, { authorization: true });
    const preTick = encounterTurn.output.phases.find((phase) => phase.phaseId === 'deterministic.pre_tick');
    assert.equal(preTick.output.encounter.triggered, true);
    assert.ok(preTick.toolCalls.some((call) => call.toolId === 'system.triggers.roll_encounter_trigger'));
    assert.ok(preTick.toolCalls.some((call) => call.toolId === 'system.encounters.create_encounter'));

    const triggers = await world.tools.executeTool('system.triggers.list_trigger_events', {
      chatSessionId: world.chat.id,
      triggerType: 'encounter',
      limit: 20
    });
    assert.ok(triggers.output.records.some((record) => record.data.status === 'triggered'));

    const encounters = await world.tools.executeTool('system.encounters.list_encounters', {
      chatSessionId: world.chat.id,
      limit: 20
    });
    assert.ok(encounters.output.records.length > 0);

    const reactionTurn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      text: '我当众救了商人韩铸一命，然后把青狐帮的阴谋告诉他，看看NPC会不会自己送礼或者行动。',
      toolContext: { authorization: true }
    }, undefined, { authorization: true });
    const npcReaction = reactionTurn.output.phases.find((phase) => phase.phaseId === 'reaction.npc');
    assert.equal(npcReaction.output.automation.skipped, false);
    assert.ok(npcReaction.toolCalls.some((call) => call.toolId === 'system.npc_behavior.resolve'));

    const npcStates = await world.tools.executeTool('system.npc_state.list_states', {
      chatSessionId: world.chat.id,
      query: '韩铸',
      limit: 20
    });
    assert.ok(npcStates.output.records.some((record) => record.data.name === '韩铸'));

    const npcEdges = await world.tools.executeTool('system.npc_relationships.list_edges', {
      query: '韩铸',
      limit: 20
    });
    assert.ok(npcEdges.output.records.some((record) => /supportive_reaction|autonomous_reaction/.test(record.data.relationType)));

    const environmentTurn = await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      text: '我点燃仓库里的油桶，引爆火焰并触发警报，观察环境会不会坍塌或者产生连锁反应。',
      toolContext: { authorization: true }
    }, undefined, { authorization: true });
    const environmentReaction = environmentTurn.output.phases.find((phase) => phase.phaseId === 'reaction.environment');
    assert.equal(environmentReaction.output.automation.skipped, false);
    assert.ok(environmentReaction.toolCalls.some((call) => call.toolId === 'system.environment_behavior.resolve'));

    const mapStates = await world.tools.executeTool('system.map_state.list_states', {
      chatSessionId: world.chat.id,
      query: 'Environmental Reaction',
      limit: 20
    });
    assert.ok(mapStates.output.records.length > 0);

    const summaries = await world.tools.executeTool('system.chat_compression.list_summaries', {
      chatSessionId: world.chat.id,
      query: 'SEVEN STAR',
      limit: 20
    });
    assert.equal(summaries.output.records.length, 0);

    await world.tools.executeTool('system.agent_loop.run_turn', {
      chatSessionId: world.chat.id,
      text: '请记住这条短期信息：蓝色暗号是 SEVEN STAR，之后我会问你。',
      toolContext: { authorization: true }
    }, undefined, { authorization: true });

    const rememberedSummaries = await world.tools.executeTool('system.chat_compression.list_summaries', {
      chatSessionId: world.chat.id,
      query: 'SEVEN STAR',
      limit: 20
    });
    assert.ok(rememberedSummaries.output.records.some((record) => /SEVEN STAR/.test(record.data.summary || record.data.text || '')));

    const ragHits = await world.tools.executeTool('system.rag_runtime.search', {
      collection: 'chat-runtime',
      query: 'SEVEN STAR 蓝色暗号',
      minScore: 0,
      limit: 5
    });
    assert.ok(ragHits.output.hits.some((hit) => /SEVEN STAR/.test(hit.text || '')));
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('agent loop run_config_turn requires user authorization', async () => {
  const world = createTestWorld();
  try {
    await assert.rejects(
      () => world.tools.executeTool('system.agent_loop.run_config_turn', {
        configId: 'minimal_flow_v1',
        chatSessionId: world.chat.id,
        text: '我向前走。'
      }),
      /requires explicit user authorization/
    );

    const authorized = await world.tools.executeTool('system.agent_loop.run_config_turn', {
      configId: 'minimal_flow_v1',
      chatSessionId: world.chat.id,
      text: '我向前走。',
      dryRun: true
    }, undefined, {
      authorization: true
    });
    assert.equal(authorized.output.dryRun, true);
    assert.equal(authorized.output.steps.length, 1);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});
