// @ts-nocheck
import { ToolPluginManager } from './tool-plugin-manager.js';
import { createToolStateSnapshotProvider } from '../audit/state-snapshot.js';
import { ACTION_RESOLVER_PLUGIN, createActionResolverHandlers } from './action-resolver-plugin.js';
import { ACTOR_CONTROL_PLUGIN, createActorControlHandlers } from './actor-control-plugin.js';
import { AGENT_LOOP_PLUGIN, createAgentLoopHandlers } from './agent-loop-plugin.js';
import { CHARACTER_MEMORY_PLUGIN, createCharacterMemoryHandlers } from './character-memory-plugin.js';
import { CHAT_COMPRESSION_PLUGIN, createChatCompressionHandlers } from './chat-compression-plugin.js';
import { COMBAT_PLUGIN, createCombatHandlers } from './combat-plugin.js';
import { CONTEXT_COMPLETENESS_PLUGIN, createContextCompletenessHandlers } from './context-completeness-plugin.js';
import { CONTEXT_PLANNER_PLUGIN, createContextPlannerHandlers } from './context-planner-plugin.js';
import { DATA_PLUGIN, createDataHandlers } from './data-plugin.js';
import { DICE_PLUGIN, createDiceHandlers } from './dice-plugin.js';
import { ENCOUNTER_PLUGIN, createEncounterHandlers } from './encounter-plugin.js';
import { ENVIRONMENT_BEHAVIOR_PLUGIN, createEnvironmentBehaviorHandlers } from './environment-behavior-plugin.js';
import { EFFECT_SETTLEMENT_PLUGIN, createEffectSettlementHandlers } from './effect-settlement-plugin.js';
import { FACTION_PLUGIN, createFactionHandlers } from './faction-plugin.js';
import { ITEM_REGISTRY_PLUGIN, createItemRegistryHandlers } from './item-registry-plugin.js';
import { ITEM_USE_PLUGIN, createItemUseHandlers } from './item-use-plugin.js';
import { MAP_RELATIONSHIP_PLUGIN, createMapRelationshipHandlers } from './map-relationship-plugin.js';
import { MAP_REGISTRY_PLUGIN, createMapRegistryHandlers } from './map-registry-plugin.js';
import { MAP_STATE_PLUGIN, createMapStateHandlers } from './map-state-plugin.js';
import { MECHANICS_REGISTRY_PLUGIN, createMechanicsRegistryHandlers } from './mechanics-registry-plugin.js';
import { MODIFIER_RESOLVER_PLUGIN, createModifierResolverHandlers } from './modifier-resolver-plugin.js';
import { NPC_PROFILES_PLUGIN, createNpcProfileHandlers } from './npc-profiles-plugin.js';
import { NPC_REGISTRY_PLUGIN, createNpcRegistryHandlers } from './npc-registry-plugin.js';
import { NPC_RELATIONSHIP_PLUGIN, createNpcRelationshipHandlers } from './npc-relationship-plugin.js';
import { NPC_BEHAVIOR_PLUGIN, createNpcBehaviorHandlers } from './npc-behavior-plugin.js';
import { NPC_STATE_PLUGIN, createNpcStateHandlers } from './npc-state-plugin.js';
import { PARTY_PLUGIN, createPartyHandlers } from './party-plugin.js';
import { PERSUASION_PLUGIN, createPersuasionHandlers } from './persuasion-plugin.js';
import { PROTAGONIST_SWITCH_PLUGIN, createProtagonistSwitchHandlers } from './protagonist-switch-plugin.js';
import { QUEST_PLUGIN, createQuestHandlers } from './quest-plugin.js';
import { RAG_PERMANENT_PLUGIN, RAG_RUNTIME_PLUGIN, createRagPermanentHandlers, createRagRuntimeHandlers } from './rag-plugin.js';
import { RESOURCE_PLUGIN, createResourceHandlers } from './resource-plugin.js';
import { RULE_PACK_PLUGIN, createRulePackHandlers } from './rule-pack-plugin.js';
import { SCENE_MAP_PLUGIN, createSceneMapHandlers } from './scene-map-plugin.js';
import { SCENE_NPC_PLUGIN, createSceneNpcHandlers } from './scene-npc-plugin.js';
import { SLOT_USE_PLUGIN, createSlotUseHandlers } from './slot-use-plugin.js';
import { TIME_PLUGIN, createTimeHandlers } from './time-plugin.js';
import { TRIGGER_PLUGIN, createTriggerHandlers } from './trigger-plugin.js';
import { VISUAL_ASSET_PLUGIN, createVisualAssetHandlers } from './visual-asset-plugin.js';

export const CORE_UTILITY_PLUGIN = {
  id: 'core.utility',
  name: 'Core Utility Tools',
  version: '0.1.0',
  description: 'Small built-in tools for testing the tool plugin pipeline.',
  enabled: true,
  permissions: [],
  tools: [
    {
      name: 'echo',
      title: 'Echo',
      description: 'Return the supplied text. Useful for testing tool execution and API plumbing.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            minLength: 1
          }
        },
        required: ['text'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string'
          }
        },
        required: ['text'],
        additionalProperties: false
      },
      visibility: 'internal',
      autoCallable: false,
      mutatesState: false,
      tags: ['debug']
    }
  ]
};

export const CORE_UTILITY_HANDLERS = {
  echo: async ({ input }) => ({
    text: input.text
  })
};

export function createDefaultToolPluginManager({
  dataManager,
  appDatabase,
  ragService,
  permanentRagService,
  chatProvider,
  trace,
  auditLog,
  auditSnapshot,
  progress,
  onToolResult
} = {}) {
  if (dataManager && appDatabase && !dataManager.appDatabase) {
    dataManager.appDatabase = appDatabase;
  }
  const manager = new ToolPluginManager({
    trace,
    auditLog,
    auditSnapshot: auditSnapshot || createToolStateSnapshotProvider({ appDatabase, dataManager }),
    onToolResult
  });
  manager.createPlugin(CORE_UTILITY_PLUGIN, {
    handlers: CORE_UTILITY_HANDLERS
  });
  manager.createPlugin(DICE_PLUGIN, {
    handlers: createDiceHandlers({ appDatabase, dataManager })
  });
  manager.createPlugin(DATA_PLUGIN, {
    handlers: createDataHandlers(dataManager, { chatProvider, appDatabase })
  });
  manager.createPlugin(NPC_REGISTRY_PLUGIN, {
    handlers: createNpcRegistryHandlers({ dataManager, appDatabase })
  });
  manager.createPlugin(NPC_PROFILES_PLUGIN, {
    handlers: createNpcProfileHandlers({ dataManager })
  });
  manager.createPlugin(NPC_RELATIONSHIP_PLUGIN, {
    handlers: createNpcRelationshipHandlers({ dataManager })
  });
  manager.createPlugin(FACTION_PLUGIN, {
    handlers: createFactionHandlers({
      dataManager,
      runtimeRagService: ragService,
      permanentRagService
    })
  });
  manager.createPlugin(MAP_REGISTRY_PLUGIN, {
    handlers: createMapRegistryHandlers({ dataManager, appDatabase })
  });
  manager.createPlugin(MAP_RELATIONSHIP_PLUGIN, {
    handlers: createMapRelationshipHandlers({ dataManager, appDatabase })
  });
  manager.createPlugin(ITEM_REGISTRY_PLUGIN, {
    handlers: createItemRegistryHandlers({ dataManager, appDatabase, chatProvider })
  });
  manager.createPlugin(MECHANICS_REGISTRY_PLUGIN, {
    handlers: createMechanicsRegistryHandlers({ dataManager, appDatabase, chatProvider })
  });
  manager.createPlugin(MODIFIER_RESOLVER_PLUGIN, {
    handlers: createModifierResolverHandlers({ toolManager: manager })
  });
  manager.createPlugin(RULE_PACK_PLUGIN, {
    handlers: createRulePackHandlers({ dataManager, appDatabase })
  });
  manager.createPlugin(VISUAL_ASSET_PLUGIN, {
    handlers: createVisualAssetHandlers({ dataManager, appDatabase })
  });
  if (permanentRagService) {
    manager.createPlugin(RAG_PERMANENT_PLUGIN, {
      handlers: createRagPermanentHandlers({
        permanentRagService,
        runtimeRagService: ragService,
        dataManager,
        appDatabase
      })
    });
  }
  if (ragService) {
    manager.createPlugin(RAG_RUNTIME_PLUGIN, {
      handlers: createRagRuntimeHandlers({
        runtimeRagService: ragService,
        permanentRagService,
        dataManager,
        appDatabase
      })
    });
  }
  if (appDatabase) {
    manager.createPlugin(CHAT_COMPRESSION_PLUGIN, {
      handlers: createChatCompressionHandlers({ appDatabase })
    });
    manager.createPlugin(CHARACTER_MEMORY_PLUGIN, {
      handlers: createCharacterMemoryHandlers({ appDatabase })
    });
    manager.createPlugin(NPC_STATE_PLUGIN, {
      handlers: createNpcStateHandlers({ appDatabase })
    });
    manager.createPlugin(RESOURCE_PLUGIN, {
      handlers: createResourceHandlers({
        appDatabase,
        trace: trace === false ? false : trace?.resources
      })
    });
    manager.createPlugin(PARTY_PLUGIN, {
      handlers: createPartyHandlers({ appDatabase, dataManager })
    });
    manager.createPlugin(EFFECT_SETTLEMENT_PLUGIN, {
      handlers: createEffectSettlementHandlers({
        appDatabase,
        trace: trace === false ? false : trace?.effects
      })
    });
    manager.createPlugin(ITEM_USE_PLUGIN, {
      handlers: createItemUseHandlers({
        toolManager: manager,
        trace: trace === false ? false : trace?.itemUse
      })
    });
    manager.createPlugin(SLOT_USE_PLUGIN, {
      handlers: createSlotUseHandlers({
        toolManager: manager,
        trace: trace === false ? false : trace?.slotUse
      })
    });
    manager.createPlugin(PROTAGONIST_SWITCH_PLUGIN, {
      handlers: createProtagonistSwitchHandlers({
        appDatabase,
        trace: trace === false ? false : trace?.protagonist
      })
    });
    manager.createPlugin(ACTOR_CONTROL_PLUGIN, {
      handlers: createActorControlHandlers({
        appDatabase,
        dataManager,
        trace: trace === false ? false : trace?.actorControl
      })
    });
    manager.createPlugin(SCENE_NPC_PLUGIN, {
      handlers: createSceneNpcHandlers({ appDatabase, dataManager })
    });
    manager.createPlugin(MAP_STATE_PLUGIN, {
      handlers: createMapStateHandlers({ appDatabase })
    });
    manager.createPlugin(SCENE_MAP_PLUGIN, {
      handlers: createSceneMapHandlers({ appDatabase, dataManager })
    });
    manager.createPlugin(TIME_PLUGIN, {
      handlers: createTimeHandlers({ appDatabase, chatProvider })
    });
    manager.createPlugin(QUEST_PLUGIN, {
      handlers: createQuestHandlers({
        appDatabase,
        chatProvider,
        trace: trace === false ? false : trace?.quests
      })
    });
    manager.createPlugin(TRIGGER_PLUGIN, {
      handlers: createTriggerHandlers({
        appDatabase,
        trace: trace === false ? false : trace?.triggers
      })
    });
    manager.createPlugin(ENCOUNTER_PLUGIN, {
      handlers: createEncounterHandlers({
        appDatabase,
        toolManager: manager,
        chatProvider,
        trace: trace === false ? false : trace?.encounters
      })
    });
    manager.createPlugin(ACTION_RESOLVER_PLUGIN, {
      handlers: createActionResolverHandlers({
        toolManager: manager,
        chatProvider,
        trace: trace === false ? false : trace?.actionResolver
      })
    });
    manager.createPlugin(NPC_BEHAVIOR_PLUGIN, {
      handlers: createNpcBehaviorHandlers({
        toolManager: manager,
        chatProvider,
        trace: trace === false ? false : trace?.npcBehavior
      })
    });
    manager.createPlugin(ENVIRONMENT_BEHAVIOR_PLUGIN, {
      handlers: createEnvironmentBehaviorHandlers({
        toolManager: manager,
        chatProvider,
        trace: trace === false ? false : trace?.environmentBehavior
      })
    });
    manager.createPlugin(COMBAT_PLUGIN, {
      handlers: createCombatHandlers({
        appDatabase,
        toolManager: manager,
        chatProvider,
        trace: trace === false ? false : trace?.combat
      })
    });
    manager.createPlugin(PERSUASION_PLUGIN, {
      handlers: createPersuasionHandlers({
        toolManager: manager,
        chatProvider,
        trace: trace === false ? false : trace?.persuasion
      })
    });
    manager.createPlugin(CONTEXT_PLANNER_PLUGIN, {
      handlers: createContextPlannerHandlers({
        toolManager: manager,
        appDatabase,
        trace: trace === false ? false : trace?.contextPlanner
      })
    });
    manager.createPlugin(CONTEXT_COMPLETENESS_PLUGIN, {
      handlers: createContextCompletenessHandlers({
        toolManager: manager,
        appDatabase,
        trace: trace === false ? false : trace?.contextCompleteness
      })
    });
  }
  manager.createPlugin(AGENT_LOOP_PLUGIN, {
    handlers: createAgentLoopHandlers({
      toolManager: manager,
      appDatabase,
      dataManager,
      chatProvider,
      trace: trace === false ? false : trace?.agentLoop,
      progress
    })
  });
  return manager;
}
