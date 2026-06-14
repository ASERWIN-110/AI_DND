// @ts-nocheck
import { selectWorldInfoEntries } from '../characters/world-info.js';
import { serializeDialogue } from '../core/messages.js';
import { agentRouterReviewStore } from '../runtime/agent-progress-events.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { createContextEnvelope } from '../utils/context-envelope.js';
import { createId, nowIso } from '../utils/id.js';

export const AGENT_LOOP_TRACE_DIR = 'data/agent-loop-traces';
export const AGENT_LOOP_PROFILE_COLLECTION = 'agent_loop_profiles';
export const AGENT_LOOP_CONFIG_COLLECTION = 'agent_loop_configs';
export const AGENT_LOOP_ACTIVE_CONFIG_COLLECTION = 'agent_loop_active_configs';
export const AGENT_LOOP_ARCHIVE_COLLECTION = 'agent_loop_archives';
export const AGENT_LOOP_DEFAULT_CONFIG_ID = 'default_flow_v1';

export const AGENT_LOOP_USER_LAYER_MAPPING = [
  {
    userLayer: '1. 备份 / 快照 / 保存',
    phases: ['turn.snapshot']
  },
  {
    userLayer: '2. 无需 LLM 自动进行的东西',
    phases: ['deterministic.pre_tick', 'postprocess.memory']
  },
  {
    userLayer: '3. 历史信息',
    phases: ['actor.control_context', 'baseline.load', 'worldbook.activate', 'rag.guidance', 'retrieval.targeted']
  },
  {
    userLayer: '4. 路由层',
    phases: ['route.intent']
  },
  {
    userLayer: '5. 上下文预算层',
    phases: ['context.budget']
  },
  {
    userLayer: '6. 事件触发层',
    phases: ['resolver.orchestration']
  },
  {
    userLayer: '7. 裁决层',
    phases: ['adjudication']
  },
  {
    userLayer: '8. 影响结算层',
    phases: ['impact.plan', 'impact.route_validate', 'state.commit', 'reaction.npc', 'reaction.environment']
  },
  {
    userLayer: '9. 演绎层',
    phases: ['narrative.render']
  },
  {
    userLayer: '10. 影响路由层',
    phases: ['impact.route_validate']
  },
  {
    userLayer: '11. AI 后处理层',
    phases: ['postprocess.memory']
  }
];

const DEFAULT_ADJUDICATION_PROMPT = [
  '你是 AI-DND 的裁决层，只负责把输入、上下文和 resolver 候选转换成可检查的裁决草案。',
  '不要直接写数据库。需要写入时，只输出 effectEnvelope.toolCalls 草案。',
  '荒诞行为可以成功，但必须给出相对合理的代价、解释或后续影响。'
].join('\n');

const DEFAULT_IMPACT_PROMPT = [
  '你是 AI-DND 的影响结算层。',
  '请把裁决结果拆成可审计的影响：数值变化、状态变化、背包变化、关系变化、地图变化、任务变化、RAG/记忆变化。',
  '每个影响必须注明建议工具、风险、是否需要用户授权。',
  '人物数值、状态栏、技能栏、特殊状态、背包、资源、装备变化应路由到 system.npc_state.patch_state。',
  '可复用技能/状态/专长应路由到 system.mechanics_registry.*；可复用物品/装备/武器/饰品/坐骑/特殊道具应路由到 system.item_registry.*。',
  'NPC 关系、地图关系、阵营、任务、RAG/记忆或扩展数据库变化必须写成显式 toolCalls；没有合适工具时说明缺失路由并使用 system.data.quantify_text 或最近的可用数据工具。'
].join('\n');

const DEFAULT_NARRATIVE_PROMPT = [
  '请用玩家可直接阅读的纯文本输出本轮叙事，不要输出 JSON、YAML、字段清单或调试对象。',
  '默认把玩家输入当作“本轮正在尝试执行的行动”，不是让 GM 征求下一步意图。',
  '如果玩家输入的是可执行复合行动，应直接收束成一轮或一段明确结果：过程概况、成败程度、收益、代价、状态变化。',
  '不要因为玩家没有补充每个细节就停下来列选项。只有目标完全缺失、需要玩家选择消耗/目标、或高风险不可逆行为必须确认时，才询问玩家。',
  '不要把玩家对结果的断言直接当事实。玩家说“我尝试说服她”可以执行；玩家说“她已经同意并交出神器”必须经过裁决、工具或叙事合理化。',
  '每轮必须推进：先写“做得怎么样”，再写“产生什么变化”，最后用一句开放式承接问“接下来做什么”。',
  '最后的承接只能是开放式问题或单句提示，不要列 2 到 4 个选项，不要把提示当成本轮结果。',
  '默认格式：',
  '地图名：玩家角色所见、所闻、所感，以及当前场景发生了什么。',
  'NPC名字：NPC 的对白、动作或态度变化。多个 NPC 各占一行。',
  '旁白：必要的规则结果、世界反应、悬念或提示。',
  '推荐追加“行动结果：...”“状态变化：...”“接下来：...”。不要输出“可选项：...”，除非玩家明确要求建议。',
  '不要把调试信息写入正式叙事。'
].join('\n');

const DEFAULT_HANDOFF_TOKEN_MODE = 'light';
const HANDOFF_TOKEN_MODES = new Set(['none', 'light', 'super', 'extreme']);
const DEFAULT_ACTION_RESOLVER_TOOL_ID = 'system.action.resolve';
const LEGACY_ACTION_RESOLVER_TOOL_ID = 'system.action.resolve_once';

const DEFAULT_PHASE_PROGRESS_LABELS = Object.freeze({
  'turn.snapshot': '正在保存当前回合快照...',
  'deterministic.pre_tick': '正在处理自动规则...',
  'input.intake': '正在理解玩家输入...',
  'actor.control_context': '正在确认玩家角色控制权...',
  'baseline.load': '正在读取当前上下文...',
  'context.minimal_load': '正在读取基础上下文...',
  'route.intent': '正在理解玩家意图...',
  'worldbook.activate': '正在检索世界设定...',
  'rag.guidance': '正在整理检索线索...',
  'retrieval.targeted': '正在检索记忆...',
  'context.budget': '正在筛选可用上下文...',
  'resolver.orchestration': '正在选择处理流程...',
  adjudication: '正在进行行动裁决...',
  'impact.plan': '正在规划影响结算...',
  'impact.route_validate': '正在检查影响写入路径...',
  'state.commit': '正在写入世界状态...',
  'reaction.npc': '正在检查 NPC 反应...',
  'reaction.environment': '正在检查环境反应...',
  'narrative.render': '正在生成场景描述...',
  'structured.parse': '正在解析结构化结果...',
  'deterministic.post_tick': '正在处理回合后自动规则...',
  'memory.finalize': '正在整理记忆...',
  'postprocess.memory': '正在整理记忆和后处理...',
  'debug.collect': '正在整理调试汇总...'
});

const DEFAULT_ROUTER_ALLOWED_TOOL_IDS = Object.freeze([
  DEFAULT_ACTION_RESOLVER_TOOL_ID,
  'system.combat.prepare_battle',
  'system.combat.resolve_action',
  'system.combat.start_battle',
  'system.combat.end_battle',
  'system.persuasion.resolve',
  'system.npc_behavior.resolve',
  'system.environment_behavior.resolve',
  'system.map_relationships.find_scene_path'
]);

const DEFAULT_ROUTER_FALLBACK_TOOL_ID = DEFAULT_ACTION_RESOLVER_TOOL_ID;
const DEFAULT_ROUTER_NO_FALLBACK_INTENTS = Object.freeze([
  'empty',
  'chat_only',
  'information_query',
  'management_command'
]);

const DEFAULT_RESOLVER_TOOL_BY_INTENT = Object.freeze({
  combat_action: 'system.combat.prepare_battle',
  social_action: 'system.persuasion.resolve',
  movement: 'system.map_relationships.find_scene_path',
  observation: DEFAULT_ACTION_RESOLVER_TOOL_ID,
  player_action: DEFAULT_ACTION_RESOLVER_TOOL_ID,
  npc_behavior: 'system.npc_behavior.resolve',
  environment_behavior: 'system.environment_behavior.resolve',
  information_query: undefined,
  management_command: undefined,
  chat_only: undefined,
  empty: undefined
});

const MAP_SCENE_PATH_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'includeGlobal',
  'includeMountedMaps',
  'includeStructuredState',
  'includeParentLinks',
  'includeInactive',
  'startMapId',
  'targetMapId',
  'fromMapId',
  'toMapId',
  'startNodeId',
  'targetNodeId',
  'from',
  'to',
  'maxDepth',
  'relationType',
  'relationTypes',
  'travelMode',
  'travelModes',
  'includeIncoming',
  'includeOutgoing',
  'includeBlocked',
  'includeHidden',
  'maxDifficulty',
  'tags'
]);

const PATH_RESOLVER_ONLY_INPUT_KEYS = Object.freeze([
  'includeGlobal',
  'includeMountedMaps',
  'includeStructuredState',
  'includeParentLinks',
  'includeInactive',
  'includeBlocked',
  'includeHidden',
  'startMapId',
  'targetMapId',
  'fromMapId',
  'toMapId',
  'startNodeId',
  'targetNodeId',
  'from',
  'to',
  'maxDepth',
  'relationType',
  'relationTypes',
  'travelMode',
  'travelModes',
  'includeIncoming',
  'includeOutgoing',
  'maxDifficulty',
  'tags'
]);

const PERSUASION_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'sourceText',
  'text',
  'content',
  'query',
  'targetNpcId',
  'npcId',
  'targetId',
  'target',
  'speakerId',
  'speakerNpcId',
  'actorId',
  'playerId',
  'speaker',
  'playerSpeech',
  'speech',
  'argument',
  'personalPersuasion',
  'directSpeech',
  'desiredOutcome',
  'stakes',
  'successThreshold',
  'dc',
  'baseThreshold',
  'userRules',
  'persuasionPrompt',
  'includeContext',
  'includeRag',
  'ragQuery',
  'ragCollection',
  'ragLimit',
  'ragFilter',
  'context',
  'includeDiceInPrompt',
  'judgement',
  'persuasionJudgement',
  'diceResult',
  'rollResult',
  'rollDice',
  'diceInput',
  'diceCount',
  'rollCount',
  'diceSides',
  'sides',
  'modifier',
  'fixedModifier',
  'buff',
  'debuff',
  'abilityModifier',
  'proficiencyBonus',
  'modifiers',
  'forceMode',
  'rollMode',
  'inspirationPoints',
  'criticalMode',
  'criticalPolicy',
  'useLlm',
  'temperature',
  'maxTokens'
]);

const COMBAT_ACTION_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'battleId',
  'actionId',
  'id',
  'actorId',
  'npcId',
  'playerId',
  'targetId',
  'targetNpcId',
  'targetIds',
  'targets',
  'target',
  'actionKind',
  'kind',
  'type',
  'sourceText',
  'text',
  'content',
  'dryRun',
  'autoHit',
  'hit',
  'hitResult',
  'attackResult',
  'attack',
  'attackRoll',
  'check',
  'diceInput',
  'successThreshold',
  'dc',
  'targetAc',
  'ac',
  'diceCount',
  'rollCount',
  'diceSides',
  'sides',
  'modifier',
  'fixedModifier',
  'abilityModifier',
  'proficiencyBonus',
  'rollMode',
  'forceMode',
  'inspirationPoints',
  'criticalMode',
  'criticalDamageMultiplier',
  'damage',
  'damages',
  'damageRolls',
  'damageDice',
  'healing',
  'heals',
  'temporaryHp',
  'tempHp',
  'statusEffects',
  'statuses',
  'conditions',
  'defenses',
  'resistances',
  'vulnerabilities',
  'immunities',
  'applyDamageOnMiss',
  'consumeAction',
  'actionResource',
  'costs',
  'resourceCosts',
  'ammoCost',
  'ammoResourceId',
  'ammoAmount',
  'consumableCost',
  'consumableId',
  'consumableAmount',
  'recordEvent',
  'useModifierResolver',
  'applyModifiers',
  'metadata'
]);

const BEHAVIOR_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'sourceText',
  'text',
  'content',
  'triggerText',
  'triggerType',
  'triggerSummary',
  'npcId',
  'npcIds',
  'actorNpcIds',
  'factionId',
  'factionIds',
  'factionQuery',
  'query',
  'includeContext',
  'includeRag',
  'ragQuery',
  'ragCollection',
  'ragLimit',
  'ragFilter',
  'templateId',
  'plannerPrompt',
  'userRules',
  'referenceText',
  'referenceTexts',
  'referenceDocuments',
  'toolReferenceText',
  'allowedTools',
  'plan',
  'planTemplate',
  'useLlm',
  'dryRun',
  'continueOnError',
  'temperature',
  'maxTokens'
]);

const ENVIRONMENT_BEHAVIOR_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'mapId',
  'sourceText',
  'text',
  'content',
  'triggerText',
  'triggerType',
  'triggerSummary',
  'query',
  'includeContext',
  'includeRag',
  'ragQuery',
  'ragCollection',
  'ragLimit',
  'ragFilter',
  'templateId',
  'plannerPrompt',
  'userRules',
  'referenceText',
  'referenceTexts',
  'referenceDocuments',
  'toolReferenceText',
  'baseChance',
  'environmentBaseChance',
  'triggerThreshold',
  'scenePressure',
  'forceTrigger',
  'triggered',
  'disableTrigger',
  'noTrigger',
  'allowedTools',
  'plan',
  'planTemplate',
  'useLlm',
  'dryRun',
  'continueOnError',
  'temperature',
  'maxTokens'
]);

const COMBAT_START_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'battleId',
  'id',
  'name',
  'title',
  'battleName',
  'status',
  'shouldStartBattle',
  'participantIds',
  'allyIds',
  'enemyIds',
  'objective',
  'stakes',
  'sourceText',
  'text',
  'content',
  'userRules',
  'startPrompt',
  'battle',
  'decision',
  'startDecision',
  'context',
  'includeContext',
  'metadata',
  'useLlm',
  'temperature',
  'maxTokens'
]);

const COMBAT_PREPARE_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'dryRun',
  'actorId',
  'playerId',
  'controlledActorId',
  'protagonistActorId',
  'actorName',
  'playerName',
  'enemyCount',
  'enemyName',
  'enemyLabel',
  'enemy',
  'enemyIds',
  'enemies',
  'enemyObjects',
  'spawnEnemies',
  'autoSpawnEnemies',
  'autoCreatePlayer',
  'continueActiveBattle',
  'forceNewBattle',
  'autoEndOnDefeat',
  'resetActorActionEconomy',
  'resetPlayerActionEconomy',
  'includeDefaultEnemyAttack',
  'loot',
  'rewards',
  'battleId',
  'id',
  'name',
  'title',
  'battleName',
  'status',
  'shouldStartBattle',
  'participantIds',
  'allyIds',
  'objective',
  'stakes',
  'sourceText',
  'text',
  'content',
  'userRules',
  'startPrompt',
  'battle',
  'decision',
  'startDecision',
  'context',
  'includeContext',
  'metadata',
  'useLlm',
  'temperature',
  'maxTokens'
]);

const COMBAT_END_RESOLVER_INPUT_KEYS = Object.freeze([
  'chatSessionId',
  'sceneId',
  'battleId',
  'id',
  'outcome',
  'status',
  'sourceText',
  'text',
  'content',
  'summary',
  'dryRun',
  'applyRewards',
  'applyImpactToolCalls',
  'applyInfluence',
  'continueOnImpactError',
  'allowUnresolvedVictory',
  'requireDefeatedEnemies',
  'enforceDefeatedEnemies',
  'rewardActorId',
  'recipientActorId',
  'actorId',
  'playerId',
  'rewards',
  'loot',
  'currency',
  'authorization',
  'userAuthorization',
  'approval',
  'metadata',
  'userRules',
  'aftermathPrompt',
  'aftermath',
  'battle',
  'context',
  'includeContext',
  'useLlm',
  'temperature',
  'maxTokens'
]);

const DEFAULT_INTENT_RULES = Object.freeze([
  route('management_command', ['导入', '导出', '数据库', '字段', '设置', '注册', '注销', '配置', 'profile', 'schema']),
  route('combat_action', ['攻击', '战斗', '施法', '伤害', '治疗', '闪避', '格挡', '射击', '命中']),
  route('movement', ['前往', '移动', '进入', '离开', '去', '穿过', '寻路', '返回']),
  route('social_action', ['说服', '威胁', '欺骗', '谈判', '交谈', '交涉', '求婚', '亲', '拥抱']),
  route('environment_behavior', ['爆炸', '炸', '放火', '点燃', '燃烧', '坍塌', '倒塌', '毒气', '洪水', '地震', '陷阱', '警报', '摧毁', '破坏', '砸碎', '环境', '机关']),
  route('observation', ['观察', '调查', '查看', '聆听', '搜索', '检查', '看看']),
  route('chat_only', ['你好', '早安', '晚安', '闲聊'])
]);

const PHASE_IO_CONTRACTS = Object.freeze({
  'turn.snapshot': ioContract({
    reads: ['runtime.activeChat', 'toolManager.enabledTools', 'appDatabase.chatSummary'],
    writes: ['state.snapshot'],
    output: ['turnId', 'profileId', 'active', 'chatSessionId', 'availableTools', 'chat']
  }),
  'deterministic.pre_tick': ioContract({
    reads: ['phase.config', 'phase.toolCalls'],
    writes: [],
    output: ['noLlm', 'policy', 'defaultAction', 'configuredToolCalls']
  }),
  'input.intake': ioContract({
    reads: ['request.text', 'request.messages', 'request.metadata'],
    writes: ['state.input'],
    output: ['text', 'messages', 'latestUserMessage', 'metadata']
  }),
  'actor.control_context': ioContract({
    reads: ['state.input.latestUserMessage', 'request.chatSessionId', 'request.actorControl', 'system.actor_control'],
    writes: ['state.actorControl', 'state.input.actorTaggedMessage'],
    output: ['context', 'inputEnvelope', 'promptContext', 'warnings']
  }),
  'baseline.load': ioContract({
    reads: ['appDatabase.chatSession', 'appDatabase.recentMessages', 'characterCard.character_book'],
    writes: ['state.baseline', 'state.minimalContext'],
    output: ['recentMessages', 'dialogue', 'character', 'characterBook', 'baseline']
  }),
  'context.minimal_load': ioContract({
    reads: ['appDatabase.chatSession', 'appDatabase.recentMessages', 'characterCard.character_book'],
    writes: ['state.baseline', 'state.minimalContext'],
    output: ['recentMessages', 'dialogue', 'character', 'characterBook', 'baseline']
  }),
  'route.intent': ioContract({
    reads: ['state.input.latestUserMessage', 'profile.routes', 'phase.config.routes', 'phase.config.routerPolicy'],
    writes: ['state.intent'],
    output: ['intent', 'confidence', 'reasons', 'sourceText', 'orderedIntents', 'blockedIntents', 'interceptedIntents', 'routerPolicy']
  }),
  'worldbook.activate': ioContract({
    reads: ['characterBook.entries', 'state.baseline.recentMessages', 'state.input.latestUserMessage'],
    writes: ['state.worldbook'],
    output: ['worldBook', 'activatedEntries', 'promptSnippets', 'policy']
  }),
  'rag.guidance': ioContract({
    reads: ['state.worldbook.activatedEntries', 'request.ragGuidance', 'phase.config.guidance'],
    writes: ['state.ragGuidance'],
    output: ['guidance', 'querySeeds', 'policy']
  }),
  'retrieval.targeted': ioContract({
    reads: ['request.query', 'state.input.latestUserMessage', 'state.ragGuidance', 'state.baseline'],
    writes: [],
    output: ['query', 'guidance', 'collectionHints', 'metadataFilters', 'configuredToolCalls']
  }),
  'context.budget': ioContract({
    reads: ['request.chatSessionId', 'state.ragGuidance', 'state.baseline', 'system.context_planner.plan_context'],
    writes: ['state.contextPlan'],
    output: ['planned', 'executed', 'toolId', 'input', 'output', 'promptContext']
  }),
  'resolver.orchestration': ioContract({
    reads: ['state.intent', 'request.text', 'phase.config.resolverTools', 'phase.config.routerPolicy', 'phase.config.allowedResolverToolIds'],
    writes: ['state.resolverCandidates'],
    output: ['candidates', 'blockedCandidates', 'selectedCandidate', 'allowedToolIds', 'blockedToolIds', 'autoExecuteResolvers']
  }),
  adjudication: ioContract({
    reads: ['state.resolverCandidates', 'phase.promptTemplate'],
    writes: ['state.adjudication'],
    output: ['policy', 'candidate', 'promptTemplate', 'requiresExternalResolver', 'plannedOnly', 'resolverResult']
  }),
  'impact.plan': ioContract({
    reads: ['state.adjudication', 'phase.promptTemplate'],
    writes: ['state.impactPlan'],
    output: ['policy', 'effectEnvelope', 'promptTemplate']
  }),
  'impact.route_validate': ioContract({
    reads: ['state.impactPlan.effectEnvelope.toolCalls', 'phase.config.allowedToolIds', 'phase.config.blockedToolIds'],
    writes: ['state.impactRoutes'],
    output: ['policy', 'allowedToolIds', 'blockedToolIds', 'pendingEffects']
  }),
  'state.commit': ioContract({
    reads: ['state.impactRoutes', 'phase.toolCalls', 'request.dryRun'],
    writes: ['state.commit', 'external state through configured mutating tools'],
    output: ['dryRun', 'defaultAction', 'policy', 'configuredToolCalls']
  }),
  'reaction.npc': ioContract({
    reads: ['state.adjudication', 'state.impactPlan', 'state.commit', 'phase.toolCalls'],
    writes: ['state.npcReaction', 'external state through configured mutating tools'],
    output: ['noLlm', 'defaultAction', 'policy', 'configuredToolCalls']
  }),
  'reaction.environment': ioContract({
    reads: ['state.npcReaction', 'state.adjudication', 'state.impactPlan', 'state.commit', 'phase.toolCalls'],
    writes: ['state.environmentReaction', 'external state through configured mutating tools'],
    output: ['noLlm', 'defaultAction', 'policy', 'configuredToolCalls']
  }),
  'narrative.render': ioContract({
    reads: ['state.input', 'state.intent', 'state.contextPlan', 'state.worldbook', 'state.ragGuidance', 'state.adjudication', 'state.impactPlan', 'state.npcReaction', 'state.environmentReaction'],
    writes: ['state.narrative'],
    output: ['systemPrompt', 'userPrompt', 'draft', 'layers', 'completion', 'content']
  }),
  'structured.parse': ioContract({
    reads: ['state.narrative', 'phase.toolCalls'],
    writes: ['state.structured'],
    output: ['expectedBlocks', 'sourceNarrative', 'configuredToolCalls']
  }),
  'deterministic.post_tick': ioContract({
    reads: ['phase.config', 'phase.toolCalls'],
    writes: [],
    output: ['noLlm', 'policy', 'defaultAction', 'configuredToolCalls']
  }),
  'memory.finalize': ioContract({
    reads: ['state.input', 'state.intent', 'state.worldbook', 'state.ragGuidance', 'state.adjudication', 'state.impactPlan', 'state.narrative'],
    writes: [],
    output: ['summarySeed', 'configuredToolCalls']
  }),
  'postprocess.memory': ioContract({
    reads: ['state.narrative', 'phase.toolCalls'],
    writes: ['state.structured', 'state.postprocess'],
    output: ['policy', 'structured', 'deterministic', 'memory', 'configuredToolCalls']
  }),
  'debug.collect': ioContract({
    reads: ['state.phaseResults', 'state.toolResults', 'state.intent', 'state.resolverCandidates', 'state.narrative'],
    writes: ['state.debugSummary'],
    output: ['format', 'debugOnly', 'router', 'phaseSequence', 'toolResults', 'frontendReview', 'tokenReview']
  })
});

export const AGENT_LOOP_TEMPLATES = [
  createDefaultAgentLoopProfile(),
  createMinimalAgentLoopProfile(),
  createLlmNarrativeAgentLoopProfile()
];

export const AGENT_LOOP_CONFIG_TEMPLATES = [
  createDefaultLoopConfig(),
  createMinimalLoopConfig(),
  createLlmNarrativeLoopConfig(),
  createHandoffModeLoopConfig('none'),
  createHandoffModeLoopConfig('light'),
  createHandoffModeLoopConfig('super'),
  createHandoffModeLoopConfig('extreme'),
  createTwoStageDebugLoopConfig()
];

export class AgentTurnLoop {
  constructor({
    toolManager,
    appDatabase,
    dataManager,
    chatProvider,
    phaseHandlers = {},
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso,
    progress
  } = {}) {
    this.toolManager = toolManager;
    this.appDatabase = appDatabase;
    this.dataManager = dataManager;
    this.chatProvider = chatProvider;
    this.now = now;
    this.progress = typeof progress === 'function' ? progress : undefined;
    this.phaseHandlers = new Map([
      ...Object.entries(createDefaultPhaseHandlers(this)),
      ...Object.entries(phaseHandlers)
    ]);
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || AGENT_LOOP_TRACE_DIR,
      cwd,
      now
    });
    this.ensureLoopManagerCollections();
  }

  describe() {
    const defaultProfile = createDefaultAgentLoopProfile();
    return {
      purpose: 'Run one AI-DND turn through a configurable, traceable agent loop without hard-coding business modules into the loop body.',
      decoupling: {
        loopOwns: ['phase ordering', 'debug traces', 'intermediate files', 'tool dispatch envelopes', 'profile CRUD'],
        toolsOwn: ['NPC/map/task/combat/RAG/database rules', 'state mutations', 'LLM-specific judgement modules'],
        profilesOwn: ['phase enablement', 'tool ids', 'prompt templates', 'route keywords', 'budget settings']
      },
      router: {
        defaultAllowedToolIds: [...DEFAULT_ROUTER_ALLOWED_TOOL_IDS],
        defaultActionResolverToolId: DEFAULT_ACTION_RESOLVER_TOOL_ID,
        legacySinglePassActionResolverToolId: LEGACY_ACTION_RESOLVER_TOOL_ID,
        actionResolverMode: 'player_accept_or_rebut_loop',
        ordering: 'Resolver candidates are sorted by the first matching intent keyword position in the user input.',
        override: 'Set phase.config.allowedResolverToolIds / additionalResolverToolIds, or allowUnlistedResolverTools=true for custom router experiments.'
      },
      defaultProfileId: defaultProfile.id,
      phaseOrder: defaultProfile.phases.map((phase) => phase.id),
      userLayerMapping: AGENT_LOOP_USER_LAYER_MAPPING.map((entry) => ({ ...entry, phases: [...entry.phases] })),
      templateIds: AGENT_LOOP_TEMPLATES.map((template) => template.id),
      profileCollection: AGENT_LOOP_PROFILE_COLLECTION,
      configCollection: AGENT_LOOP_CONFIG_COLLECTION,
      activeConfigCollection: AGENT_LOOP_ACTIVE_CONFIG_COLLECTION,
      archiveCollection: AGENT_LOOP_ARCHIVE_COLLECTION,
      traceDirectory: AGENT_LOOP_TRACE_DIR,
      runModes: {
        dry_run_turn: 'Builds all intermediate artifacts and planned tool calls without committing state.',
        run_turn: 'Executes configured phase tool calls. Mutating tool calls still rely on the normal tool authorization policy.',
        dry_run_config_turn: 'Runs a configured multi-loop flow in dry-run mode, preserving each step output and trace.',
        run_config_turn: 'Runs a configured multi-loop flow. Each step still uses the normal phase/tool authorization policy.'
      }
    };
  }

  describeManagement() {
    return {
      purpose: 'Manage loop flows above individual profiles: stitch multiple loop profiles into ordered steps, hot-switch active flow configs, and archive snapshots before or after changes.',
      layers: {
        profile: 'One turn loop phase definition: phase order, prompts, routes, tool calls, and LLM flags.',
        config: 'Flow definition above profiles: ordered steps, profile selection per step, handoff policy, and active profile fallback.',
        activeConfig: 'Hot-switch pointer. When no explicit profileId/configId is supplied, the active config decides the default profile.',
        archive: 'Immutable config snapshot for rollback, comparison, or per-loop record keeping.'
      },
      storage: {
        profiles: AGENT_LOOP_PROFILE_COLLECTION,
        configs: AGENT_LOOP_CONFIG_COLLECTION,
        activeConfigs: AGENT_LOOP_ACTIVE_CONFIG_COLLECTION,
        archives: AGENT_LOOP_ARCHIVE_COLLECTION
      },
      defaultConfigId: AGENT_LOOP_DEFAULT_CONFIG_ID,
      templateIds: AGENT_LOOP_CONFIG_TEMPLATES.map((template) => template.id),
      tokenModeFlowIds: ['handoff_none_flow_v1', 'handoff_light_flow_v1', 'handoff_super_flow_v1', 'handoff_extreme_flow_v1'],
      hotSwitch: {
        defaultScope: 'global',
        defaultScopeId: 'default',
        behavior: 'switch_config updates the active pointer immediately; subsequent dry_run_turn/run_turn calls without profileId can resolve through that active config.'
      },
      flow: {
        stepOrder: 'Enabled steps run by numeric order, then id.',
        profileResolution: 'Each step uses step.profileId, then request.profileId, then config.activeProfileId, then default_v1.',
        handoff: 'Each step receives metadata.agentLoopConfig, metadata.agentLoopStep, and token-mode controlled previous output metadata. handoff.tokenMode can be none, light, super, or extreme; step.input templates reference the selected {{previous.*}} scope.'
      }
    };
  }

  listTemplates({ includePhases = false } = {}) {
    return AGENT_LOOP_TEMPLATES.map((template) => publicProfile(template, { includePhases }));
  }

  getTemplate(id = 'default_v1') {
    const template = AGENT_LOOP_TEMPLATES.find((candidate) => candidate.id === id);
    if (!template) throw notFound(`Agent loop template not found: ${id}`);
    return cloneJson(template);
  }

  listProfiles(input = {}) {
    if (!this.dataManager?.queryRecords) {
      return {
        collection: AGENT_LOOP_PROFILE_COLLECTION,
        records: [],
        builtinTemplates: this.listTemplates({ includePhases: Boolean(input.includeTemplatePhases) }),
        storage: 'unavailable'
      };
    }
    this.ensureProfileCollection();
    const result = this.dataManager.queryRecords(AGENT_LOOP_PROFILE_COLLECTION, {
      filter: input.filter || {},
      sort: input.sort || [{ field: 'updated_at', direction: 'desc' }],
      limit: input.limit,
      offset: input.offset
    });
    return {
      ...result,
      records: result.records.map((record) => ({
        ...record,
        profile: record.data?.profile ? publicProfile(record.data.profile, { includePhases: Boolean(input.includePhases) }) : undefined
      })),
      builtinTemplates: this.listTemplates({ includePhases: Boolean(input.includeTemplatePhases) }),
      storage: 'sqlite-data-manager'
    };
  }

  getProfile(id) {
    const normalizedId = requireText(id, 'id');
    const stored = this.getStoredProfile(normalizedId);
    if (stored) {
      return {
        id: stored.id,
        source: 'stored',
        profile: cloneJson(stored.data.profile || stored.data)
      };
    }
    return {
      id: normalizedId,
      source: 'template',
      profile: this.getTemplate(normalizedId)
    };
  }

  upsertProfile(input = {}) {
    if (!this.dataManager?.upsertRecord) {
      throw dependencyError('Agent loop profile storage requires dataManager');
    }
    const profile = normalizeProfile(input.profile || input, {
      fallbackId: input.id || input.profileId || input.name
    });
    const id = requireText(input.id || input.profileId || profile.id, 'id');
    this.ensureProfileCollection();
    const record = this.dataManager.upsertRecord(AGENT_LOOP_PROFILE_COLLECTION, {
      id,
      profile: {
        ...profile,
        id
      },
      name: input.name || profile.name || profile.title || id,
      description: input.description || profile.description || '',
      tags: Array.isArray(input.tags) ? input.tags : (Array.isArray(profile.tags) ? profile.tags : []),
      updatedAt: this.now()
    }, { id });
    return {
      id: record.id,
      collection: record.collection,
      profile: cloneJson(record.data.profile),
      record
    };
  }

  deleteProfile(id) {
    if (!this.dataManager?.deleteRecord) {
      throw dependencyError('Agent loop profile storage requires dataManager');
    }
    const normalizedId = requireText(id, 'id');
    if (AGENT_LOOP_TEMPLATES.some((template) => template.id === normalizedId)) {
      return {
        id: normalizedId,
        deleted: false,
        reason: 'builtin_template_cannot_be_deleted'
      };
    }
    return this.dataManager.deleteRecord(AGENT_LOOP_PROFILE_COLLECTION, normalizedId);
  }

  listConfigTemplates({ includeSteps = false } = {}) {
    return AGENT_LOOP_CONFIG_TEMPLATES.map((template) => publicLoopConfig(template, { includeSteps }));
  }

  getConfigTemplate(id = AGENT_LOOP_DEFAULT_CONFIG_ID) {
    const template = AGENT_LOOP_CONFIG_TEMPLATES.find((candidate) => candidate.id === id);
    if (!template) throw notFound(`Agent loop config template not found: ${id}`);
    return cloneJson(template);
  }

  listConfigs(input = {}) {
    if (!this.dataManager?.queryRecords) {
      return {
        collection: AGENT_LOOP_CONFIG_COLLECTION,
        records: [],
        builtinTemplates: this.listConfigTemplates({ includeSteps: Boolean(input.includeTemplateSteps) }),
        storage: 'unavailable'
      };
    }
    this.ensureLoopManagerCollections();
    const result = this.dataManager.queryRecords(AGENT_LOOP_CONFIG_COLLECTION, {
      filter: input.filter || {},
      sort: input.sort || [{ field: 'updated_at', direction: 'desc' }],
      limit: input.limit,
      offset: input.offset
    });
    return {
      ...result,
      records: result.records.map((record) => ({
        ...record,
        config: record.data?.config ? publicLoopConfig(record.data.config, { includeSteps: Boolean(input.includeSteps) }) : undefined
      })),
      builtinTemplates: this.listConfigTemplates({ includeSteps: Boolean(input.includeTemplateSteps) }),
      storage: 'sqlite-data-manager'
    };
  }

  getConfig(id = AGENT_LOOP_DEFAULT_CONFIG_ID) {
    const normalizedId = requireText(id || AGENT_LOOP_DEFAULT_CONFIG_ID, 'id');
    const stored = this.getStoredConfig(normalizedId);
    if (stored) {
      return {
        id: stored.id,
        source: 'stored',
        config: cloneJson(stored.data.config || stored.data)
      };
    }
    return {
      id: normalizedId,
      source: 'template',
      config: this.getConfigTemplate(normalizedId)
    };
  }

  upsertConfig(input = {}) {
    if (!this.dataManager?.upsertRecord) {
      throw dependencyError('Agent loop config storage requires dataManager');
    }
    const config = normalizeLoopConfig(input.config || input, {
      fallbackId: input.id || input.configId || input.loopConfigId || input.name
    });
    const id = requireText(input.id || input.configId || input.loopConfigId || config.id, 'id');
    if (AGENT_LOOP_CONFIG_TEMPLATES.some((template) => template.id === id)) {
      throw validationError(`Built-in loop config ids are reserved. Copy ${id} to a new id before saving.`);
    }
    this.ensureLoopManagerCollections();
    const existing = this.getStoredConfig(id);
    const archived = existing && input.archiveExisting !== false
      ? this.archiveConfig({
          id,
          label: input.archiveLabel || 'before-upsert',
          reason: input.archiveReason || 'automatic archive before replacing loop config',
          source: 'upsert_config'
        })
      : undefined;
    const record = this.dataManager.upsertRecord(AGENT_LOOP_CONFIG_COLLECTION, {
      id,
      config: {
        ...config,
        id
      },
      name: input.name || config.name || config.title || id,
      description: input.description || config.description || '',
      tags: Array.isArray(input.tags) ? input.tags : (Array.isArray(config.tags) ? config.tags : []),
      updatedAt: this.now()
    }, { id });
    return {
      id: record.id,
      collection: record.collection,
      config: cloneJson(record.data.config),
      archived,
      record
    };
  }

  deleteConfig(id) {
    if (!this.dataManager?.deleteRecord) {
      throw dependencyError('Agent loop config storage requires dataManager');
    }
    const normalizedId = requireText(id, 'id');
    if (AGENT_LOOP_CONFIG_TEMPLATES.some((template) => template.id === normalizedId)) {
      return {
        id: normalizedId,
        deleted: false,
        reason: 'builtin_template_cannot_be_deleted'
      };
    }
    return this.dataManager.deleteRecord(AGENT_LOOP_CONFIG_COLLECTION, normalizedId);
  }

  getActiveConfig(input = {}) {
    const scope = normalizeActiveScope(input);
    const fallback = this.getConfig(AGENT_LOOP_DEFAULT_CONFIG_ID).config;
    if (!this.dataManager?.getRecord) {
      return {
        ...scope,
        source: 'default',
        activeConfigId: fallback.id,
        config: fallback,
        storage: 'unavailable'
      };
    }
    this.ensureLoopManagerCollections();
    const record = this.dataManager.getRecord(AGENT_LOOP_ACTIVE_CONFIG_COLLECTION, activeConfigRecordId(scope), {
      missing: 'undefined'
    });
    if (!record) {
      return {
        ...scope,
        source: 'default',
        activeConfigId: fallback.id,
        config: fallback,
        storage: 'sqlite-data-manager'
      };
    }
    let config = fallback;
    let reason = record.data?.reason;
    try {
      config = this.getConfig(record.data.configId).config;
    } catch (error) {
      reason = `active_config_missing:${record.data.configId}`;
    }
    return {
      ...scope,
      id: record.id,
      source: 'stored',
      activeConfigId: config.id,
      switchedAt: record.data?.switchedAt,
      reason,
      config,
      record,
      storage: 'sqlite-data-manager'
    };
  }

  switchConfig(input = {}) {
    if (!this.dataManager?.upsertRecord) {
      throw dependencyError('Agent loop active config storage requires dataManager');
    }
    const id = requireText(input.id || input.configId || input.loopConfigId, 'id');
    const config = this.getConfig(id).config;
    const scope = normalizeActiveScope(input);
    this.ensureLoopManagerCollections();
    const record = this.dataManager.upsertRecord(AGENT_LOOP_ACTIVE_CONFIG_COLLECTION, {
      ...scope,
      configId: config.id,
      switchedAt: this.now(),
      reason: input.reason || '',
      updatedAt: this.now()
    }, { id: activeConfigRecordId(scope) });
    return {
      ...scope,
      activeConfigId: config.id,
      config,
      record,
      hotSwitched: true
    };
  }

  archiveConfig(input = {}) {
    if (!this.dataManager?.upsertRecord) {
      throw dependencyError('Agent loop archive storage requires dataManager');
    }
    const id = requireText(input.id || input.configId || input.loopConfigId, 'id');
    const resolved = this.getConfig(id);
    this.ensureLoopManagerCollections();
    const timestamp = this.now();
    const archiveId = input.archiveId
      || `${safeSegment(resolved.config.id)}__${timestamp.replace(/[^0-9A-Za-z]+/g, '')}__${createId('archive')}`;
    const record = this.dataManager.upsertRecord(AGENT_LOOP_ARCHIVE_COLLECTION, {
      id: archiveId,
      configId: resolved.config.id,
      label: input.label || '',
      reason: input.reason || '',
      source: input.source || resolved.source,
      archivedAt: timestamp,
      config: cloneJson(resolved.config),
      updatedAt: timestamp
    }, { id: archiveId });
    return {
      id: record.id,
      collection: record.collection,
      configId: resolved.config.id,
      archive: cloneJson(record.data),
      record
    };
  }

  listConfigArchives(input = {}) {
    if (!this.dataManager?.queryRecords) {
      return {
        collection: AGENT_LOOP_ARCHIVE_COLLECTION,
        records: [],
        storage: 'unavailable'
      };
    }
    this.ensureLoopManagerCollections();
    const filter = {
      ...(input.filter || {})
    };
    if (input.configId || input.id || input.loopConfigId) {
      filter.configId = input.configId || input.id || input.loopConfigId;
    }
    return {
      ...this.dataManager.queryRecords(AGENT_LOOP_ARCHIVE_COLLECTION, {
        filter,
        sort: input.sort || [{ field: 'updated_at', direction: 'desc' }],
        limit: input.limit,
        offset: input.offset
      }),
      storage: 'sqlite-data-manager'
    };
  }

  previewConfig(input = {}) {
    const request = normalizeTurnInput({
      ...input,
      configId: input.configId || input.loopConfigId || input.id
    });
    const { config, source } = this.resolveLoopConfig(request);
    return buildLoopConfigPreview({
      loop: this,
      request,
      config,
      source
    });
  }

  async dryRunConfigTurn(input = {}) {
    return this.runConfigTurn({
      ...input,
      dryRun: true
    });
  }

  async runConfigTurn(input = {}) {
    const request = normalizeTurnInput(input);
    const { config, source } = this.resolveLoopConfig(request);
    const steps = normalizeLoopConfigSteps(config.steps).filter((step) => step.enabled !== false);
    const startedAt = this.now();
    const rootTurnId = request.turnId || createId('flow');
    this.emitProgress({
      type: 'flow_started',
      status: 'running',
      turnId: rootTurnId,
      rootTurnId,
      chatSessionId: request.chatSessionId,
      configId: config.id,
      title: config.name || config.title || config.id,
      progressLabel: '正在启动本轮 Agent 循环...'
    });
    const output = {
      turnId: rootTurnId,
      configId: config.id,
      configSource: source,
      config: publicLoopConfig(config, { includeSteps: true }),
      dryRun: request.dryRun,
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      startedAt,
      finishedAt: undefined,
      steps: [],
      finalOutput: undefined,
      warnings: [],
      errors: []
    };
    let previousOutput;

    for (const [index, step] of steps.entries()) {
      const stepStartedAt = this.now();
      this.emitProgress({
        type: 'step_started',
        status: 'running',
        turnId: rootTurnId,
        rootTurnId,
        chatSessionId: request.chatSessionId,
        configId: config.id,
        stepId: step.id,
        stepIndex: index,
        title: step.title || step.id,
        progressLabel: step.progressLabel || `正在运行${humanizeProgressSubject(step.title || step.id)}...`
      });
      const stepInput = buildConfigStepInput({
        request,
        config,
        step,
        index,
        rootTurnId,
        previousOutput
      });
      try {
        const stepOutput = await this.runTurn(stepInput);
        const stepResult = {
          stepId: step.id,
          title: step.title || step.id,
          order: step.order,
          profileId: stepOutput.profileId,
          status: 'success',
          startedAt: stepStartedAt,
          finishedAt: this.now(),
          durationMs: undefined,
          output: stepOutput,
          trace: stepOutput.trace,
          handoff: step.handoff || {}
        };
        stepResult.durationMs = durationMs(stepResult.startedAt, stepResult.finishedAt);
        output.steps.push(stepResult);
        previousOutput = stepOutput;
        output.finalOutput = stepOutput;
        this.emitProgress({
          type: 'step_finished',
          status: 'success',
          turnId: rootTurnId,
          rootTurnId,
          chatSessionId: request.chatSessionId,
          configId: config.id,
          stepId: step.id,
          stepIndex: index,
          title: stepResult.title,
          durationMs: stepResult.durationMs,
          progressLabel: `${stepResult.title} 已完成`
        });
      } catch (error) {
        const serialized = serializeError(error);
        const stepResult = {
          stepId: step.id,
          title: step.title || step.id,
          order: step.order,
          profileId: resolveStepProfileId({ request, config, step }),
          status: step.required === false ? 'skipped' : 'error',
          startedAt: stepStartedAt,
          finishedAt: this.now(),
          durationMs: undefined,
          error: serialized,
          trace: error.agentLoopTrace,
          handoff: step.handoff || {}
        };
        stepResult.durationMs = durationMs(stepResult.startedAt, stepResult.finishedAt);
        output.steps.push(stepResult);
        output.errors.push({
          stepId: step.id,
          ...serialized
        });
        this.emitProgress({
          type: 'step_failed',
          status: 'error',
          turnId: rootTurnId,
          rootTurnId,
          chatSessionId: request.chatSessionId,
          configId: config.id,
          stepId: step.id,
          stepIndex: index,
          title: stepResult.title,
          durationMs: stepResult.durationMs,
          error: serialized,
          progressLabel: `${stepResult.title} 出了问题`
        });
        if (step.required !== false) {
          output.finishedAt = this.now();
          this.emitProgress({
            type: 'flow_failed',
            status: 'error',
            turnId: rootTurnId,
            rootTurnId,
            chatSessionId: request.chatSessionId,
            configId: config.id,
            stepId: step.id,
            stepIndex: index,
            title: config.name || config.title || config.id,
            durationMs: durationMs(startedAt, output.finishedAt),
            error: serialized,
            progressLabel: `${stepResult.title} 出了问题，Agent 循环停止`
          });
          error.agentLoopConfig = {
            configId: config.id,
            stepId: step.id,
            output
          };
          throw error;
        }
      }
    }

    output.finishedAt = this.now();
    this.emitProgress({
      type: 'flow_finished',
      status: output.errors.length ? 'error' : 'success',
      turnId: rootTurnId,
      rootTurnId,
      chatSessionId: request.chatSessionId,
      configId: config.id,
      durationMs: durationMs(startedAt, output.finishedAt),
      progressLabel: output.errors.length ? 'Agent 循环完成，但有部分问题' : 'Agent 循环已完成'
    });
    return output;
  }

  async dryRunTurn(input = {}) {
    return this.runTurn({
      ...input,
      dryRun: true
    });
  }

  async runTurn(input = {}) {
    const request = normalizeTurnInput(input);
    const profile = this.resolveProfile(request);
    const sessionId = request.chatSessionId;
    const turnId = request.turnId || createId('turn');
    const state = createLoopState({ request, profile, turnId, now: this.now });
    const trace = this.traceRecorder.start('agent-turn-loop', {
      sessionId,
      input: {
        ...request,
        profile: publicProfile(profile, { includePhases: true })
      },
      stateBefore: await this.buildTraceStateBefore(request)
    });

    try {
      this.emitProgress({
        type: 'turn_started',
        status: 'running',
        turnId,
        chatSessionId: sessionId,
        profileId: profile.id,
        title: profile.name || profile.title || profile.id,
        progressLabel: '正在准备本轮思考...'
      });
      const phases = normalizePhases(profile.phases);
      this.emitProgress({
        type: 'router_plan_updated',
        status: 'running',
        turnId,
        chatSessionId: sessionId,
        profileId: profile.id,
        routerPlan: {
          source: 'profile',
          title: '本轮模块顺序',
          items: buildRouterReviewItemsForPhases({
            turnId,
            chatSessionId: sessionId,
            profile,
            phases
          })
        },
        progressLabel: 'AI 已排出本轮模块顺序'
      });
      for (const phase of phases) {
        const phaseResult = await this.runPhase({
          phase,
          state,
          profile,
          request
        });
        state.phaseResults.push(phaseResult);
        state.phaseById[phase.id] = phaseResult;
      }

      const output = buildLoopOutput({
        request,
        profile,
        state,
        trace: undefined,
        finishedAt: this.now()
      });
      output.trace = this.traceRecorder.finish(trace, {
        output,
        stateAfter: this.buildTraceStateAfter(state),
        prompt: renderDebugPrompt(output)
      });
      this.emitProgress({
        type: 'turn_finished',
        status: output.errors.length ? 'error' : 'success',
        turnId,
        chatSessionId: sessionId,
        profileId: profile.id,
        durationMs: durationMs(state.startedAt, output.finishedAt),
        progressLabel: output.errors.length ? '本轮循环完成，但有阶段报错' : '本轮循环已完成'
      });
      return output;
    } catch (error) {
      const traceSummary = this.traceRecorder.fail(trace, { error });
      error.agentLoopTrace = traceSummary;
      this.emitProgress({
        type: 'turn_failed',
        status: 'error',
        turnId,
        chatSessionId: sessionId,
        profileId: profile.id,
        error: serializeError(error),
        progressLabel: '本轮循环出了问题'
      });
      throw error;
    }
  }

  async runPhase({ phase, state, profile, request }) {
    const startedAt = this.now();
    const routerItemId = routerReviewPhaseItemId(state.turnId, phase.id);
    const playerSkip = routerReviewSkipRecord({ request, turnId: state.turnId, itemId: routerItemId });
    const skipped = phase.enabled === false || Boolean(playerSkip);
    const result = {
      phaseId: phase.id,
      title: phase.title || phase.id,
      progressLabel: phase.progressLabel || fallbackProgressLabelForPhase(phase),
      order: phase.order,
      mode: phase.mode || 'built_in',
      enabled: !skipped,
      llm: Boolean(phase.llm),
      mutatesState: Boolean(phase.mutatesState),
      startedAt,
      finishedAt: undefined,
      durationMs: undefined,
      skipped,
      output: undefined,
      contextEnvelope: undefined,
      toolCalls: [],
      warnings: [],
      errors: []
    };
    if (playerSkip) result.skipReason = playerSkip.reason || 'player_skipped_router_item';
    const progressWarning = progressLabelWarningForPhase(phase);
    if (progressWarning) {
      result.warnings.push(progressWarning);
      this.emitProgress({
        type: 'phase_warning',
        status: 'warning',
        turnId: state.turnId,
        chatSessionId: request.chatSessionId,
        profileId: profile.id,
        phaseId: phase.id,
        title: result.title,
        warning: progressWarning,
        progressLabel: progressWarning.message
      });
    }

    if (skipped) {
      result.finishedAt = this.now();
      result.durationMs = durationMs(startedAt, result.finishedAt);
      state.warnings.push(...result.warnings.map((warning) => ({
        phaseId: phase.id,
        warning
      })));
      this.emitProgress({
        type: 'phase_skipped',
        status: 'skipped',
        turnId: state.turnId,
        chatSessionId: request.chatSessionId,
        profileId: profile.id,
        phaseId: phase.id,
        routerItemId,
        routerItem: routerReviewItemFromPhase({ turnId: state.turnId, chatSessionId: request.chatSessionId, profile, phase, status: 'skipped' }),
        title: result.title,
        skipReason: result.skipReason || 'disabled',
        progressLabel: playerSkip ? `${result.title} 已按玩家要求跳过` : `${result.title} 已跳过`
      });
      return result;
    }

    this.emitProgress({
      type: 'phase_started',
      status: 'running',
      turnId: state.turnId,
      chatSessionId: request.chatSessionId,
      profileId: profile.id,
      phaseId: phase.id,
      routerItemId,
      routerItem: routerReviewItemFromPhase({ turnId: state.turnId, chatSessionId: request.chatSessionId, profile, phase, status: 'running' }),
      title: result.title,
      progressLabel: result.progressLabel
    });

    try {
      const handler = this.phaseHandlers.get(phase.id) || createGenericPhaseHandler(this);
      result.output = await handler({ phase, state, profile, request });
      const handlerToolCalls = Array.isArray(result.output?.toolCalls) ? result.output.toolCalls : [];
      for (const toolResult of handlerToolCalls) {
        result.toolCalls.push(toolResult);
        state.toolResults.push({
          phaseId: phase.id,
          ...toolResult
        });
        if (toolResult.status === 'error') {
          result.errors.push(toolResult.error);
        }
      }
      const toolCalls = Array.isArray(phase.toolCalls) ? phase.toolCalls : [];
      for (const call of toolCalls) {
        const toolResult = await this.executePhaseToolCall({
          call,
          phase,
          state,
          request
        });
        result.toolCalls.push(toolResult);
        state.toolResults.push({
          phaseId: phase.id,
          ...toolResult
        });
        if (toolResult.status === 'error') {
          result.errors.push(toolResult.error);
        }
      }
    } catch (error) {
      const serialized = serializeError(error);
      result.errors.push(serialized);
      if (phase.required !== false) {
        result.finishedAt = this.now();
        result.durationMs = durationMs(startedAt, result.finishedAt);
        state.errors.push({
          phaseId: phase.id,
          ...serialized
        });
        this.emitProgress({
          type: 'phase_failed',
          status: 'error',
          turnId: state.turnId,
          chatSessionId: request.chatSessionId,
          profileId: profile.id,
          phaseId: phase.id,
          routerItemId,
          routerItem: routerReviewItemFromPhase({ turnId: state.turnId, chatSessionId: request.chatSessionId, profile, phase, status: 'error' }),
          title: result.title,
          durationMs: result.durationMs,
          error: serialized,
          progressLabel: `${result.title} 出了问题`
        });
        throw error;
      }
    }

    result.finishedAt = this.now();
    result.durationMs = durationMs(startedAt, result.finishedAt);
    result.contextEnvelope = createContextEnvelope({
      id: `phase:${phase.id}`,
      kind: 'agent_loop_phase',
      title: result.progressLabel || result.title,
      status: result.skipped ? 'skipped' : (result.errors.length ? 'error' : 'success'),
      output: result.output,
      artifactRefs: result.toolCalls
        .map((toolCall) => toolCall.contextEnvelope)
        .filter(Boolean)
        .map((envelope) => ({
          kind: 'context_envelope',
          id: envelope.id,
          note: envelope.compactSummary
        }))
    });
    state.contextEnvelopeByPhase[phase.id] = result.contextEnvelope;
    state.contextEnvelopeList.push(result.contextEnvelope);
    state.latestContextEnvelope = result.contextEnvelope;
    state.warnings.push(...result.warnings.map((warning) => ({
      phaseId: phase.id,
      warning
    })));
    state.errors.push(...result.errors.map((error) => ({
      phaseId: phase.id,
      ...error
    })));
    this.emitProgress({
      type: 'phase_finished',
      status: result.errors.length ? 'error' : 'success',
      turnId: state.turnId,
      chatSessionId: request.chatSessionId,
      profileId: profile.id,
      phaseId: phase.id,
      routerItemId,
      routerItem: routerReviewItemFromPhase({ turnId: state.turnId, chatSessionId: request.chatSessionId, profile, phase, status: result.errors.length ? 'error' : 'success' }),
      title: result.title,
      durationMs: result.durationMs,
      progressLabel: result.errors.length ? `${result.title} 完成，但有问题` : `${result.title} 已完成`
    });
    return result;
  }

  async executePhaseToolCall({ call, phase, state, request }) {
    const normalized = normalizeToolCall(call, { phase, state, request });
    const routerItemId = routerReviewToolItemId(state.turnId, phase.id, normalized);
    const planned = {
      id: normalized.id,
      toolId: normalized.toolId,
      phaseId: phase.id,
      progressLabel: normalized.progressLabel || fallbackProgressLabelForTool(normalized.toolId),
      input: normalized.input,
      status: 'planned',
      reason: undefined,
      output: undefined,
      error: undefined,
      trace: undefined
    };
    const playerSkip = routerReviewSkipRecord({ request, turnId: state.turnId, itemId: routerItemId });
    if (playerSkip) {
      this.emitProgress({
        type: 'tool_skipped',
        status: 'skipped',
        turnId: state.turnId,
        chatSessionId: request.chatSessionId,
        phaseId: phase.id,
        toolId: normalized.toolId,
        routerItemId,
        routerItem: routerReviewItemFromToolCall({
          turnId: state.turnId,
          chatSessionId: request.chatSessionId,
          phase,
          call: normalized,
          status: 'skipped'
        }),
        title: normalized.toolId,
        skipReason: playerSkip.reason,
        progressLabel: `${humanizeProgressSubject(normalized.toolId)}工具已按玩家要求跳过`
      });
      return {
        ...planned,
        status: 'skipped',
        reason: playerSkip.reason || 'player_skipped_router_item'
      };
    }

    if (normalized.enabled === false) {
      return {
        ...planned,
        status: 'skipped',
        reason: 'disabled'
      };
    }
    if (!this.toolManager?.getTool || !this.toolManager?.executeTool) {
      return {
        ...planned,
        status: normalized.required ? 'error' : 'skipped',
        reason: 'tool_manager_unavailable',
        error: normalized.required ? serializeError(dependencyError('Agent loop tool call requires toolManager')) : undefined
      };
    }

    let tool;
    try {
      tool = this.toolManager.getTool(normalized.toolId);
    } catch (error) {
      const serialized = serializeError(error);
      if (normalized.required) {
        return {
          ...planned,
          status: 'error',
          error: serialized
        };
      }
      return {
        ...planned,
        status: 'skipped',
        reason: 'tool_not_found',
        error: serialized
      };
    }

    if (request.dryRun) {
      if (!normalized.executeInDryRun || tool.mutatesState || (!dryRunAllowsExternalApi(request) && toolMayUseExternalApi(tool))) {
        let reason = 'dry_run_planned_only';
        if (tool.mutatesState) reason = 'dry_run_mutating_tool_not_executed';
        else if (normalized.executeInDryRun && toolMayUseExternalApi(tool)) reason = 'dry_run_external_api_not_executed';
        return {
          ...planned,
          tool: publicTool(tool),
          reason
        };
      }
    }
    if (normalized.execute === false) {
      return {
        ...planned,
        tool: publicTool(tool),
        reason: 'execute_false'
      };
    }

    try {
      this.emitProgress({
        type: 'tool_started',
        status: 'running',
        turnId: state.turnId,
        chatSessionId: request.chatSessionId,
        phaseId: phase.id,
        toolId: normalized.toolId,
        routerItemId,
        routerItem: routerReviewItemFromToolCall({
          turnId: state.turnId,
          chatSessionId: request.chatSessionId,
          phase,
          call: normalized,
          status: 'running'
        }),
        title: normalized.toolId,
        progressLabel: planned.progressLabel
      });
      const result = await this.toolManager.executeTool(normalized.toolId, normalized.input, undefined, {
        ...request.toolContext,
        ...normalized.context,
        agentLoop: {
          turnId: state.turnId,
          phaseId: phase.id,
          dryRun: request.dryRun
        }
      });
      const successResult = {
        ...planned,
        tool: publicTool(tool),
        status: 'success',
        output: result.output,
        trace: result.trace,
        contextEnvelope: createContextEnvelope({
          id: `tool:${phase.id}:${normalized.toolId}`,
          kind: 'tool_call',
          title: normalized.toolId,
          status: 'success',
          output: result.output,
          trace: result.trace
        })
      };
      this.emitProgress({
        type: 'tool_finished',
        status: 'success',
        turnId: state.turnId,
        chatSessionId: request.chatSessionId,
        phaseId: phase.id,
        toolId: normalized.toolId,
        routerItemId,
        routerItem: routerReviewItemFromToolCall({
          turnId: state.turnId,
          chatSessionId: request.chatSessionId,
          phase,
          call: normalized,
          status: 'success'
        }),
        title: normalized.toolId,
        progressLabel: `${humanizeProgressSubject(normalized.toolId)}工具已完成`
      });
      return successResult;
    } catch (error) {
      const serialized = serializeError(error);
      this.emitProgress({
        type: 'tool_failed',
        status: 'error',
        turnId: state.turnId,
        chatSessionId: request.chatSessionId,
        phaseId: phase.id,
        toolId: normalized.toolId,
        routerItemId,
        routerItem: routerReviewItemFromToolCall({
          turnId: state.turnId,
          chatSessionId: request.chatSessionId,
          phase,
          call: normalized,
          status: 'error'
        }),
        title: normalized.toolId,
        error: serialized,
        progressLabel: `${humanizeProgressSubject(normalized.toolId)}工具出了问题`
      });
      if (normalized.required) {
        return {
          ...planned,
          tool: publicTool(tool),
          status: 'error',
          error: serialized
        };
      }
      return {
        ...planned,
        tool: publicTool(tool),
        status: 'skipped',
        reason: 'optional_tool_call_failed',
        error: serialized
      };
    }
  }

  emitProgress(event = {}) {
    if (!this.progress) return undefined;
    try {
      return this.progress({
        source: 'agent-loop',
        ...event
      });
    } catch {
      return undefined;
    }
  }

  resolveProfile(request) {
    let base;
    let configPhaseOverrides = [];
    if (request.profileId) {
      base = this.getProfile(request.profileId).profile;
    } else if (request.configId || request.loopConfigId || request.useActiveConfig !== false) {
      const { config } = this.resolveLoopConfig(request);
      const profileId = resolveConfigProfileId(config);
      base = profileId ? this.getProfile(profileId).profile : createDefaultAgentLoopProfile();
      configPhaseOverrides = phaseProgressOverridesForConfig(config, profileId);
    } else {
      base = createDefaultAgentLoopProfile();
    }
    const withConfig = configPhaseOverrides.length > 0
      ? mergeProfiles(base, { phases: configPhaseOverrides })
      : base;
    const withInline = request.profile ? mergeProfiles(withConfig, request.profile) : withConfig;
    return request.phaseOverrides
      ? mergeProfiles(withInline, { phases: request.phaseOverrides })
      : withInline;
  }

  resolveLoopConfig(request = {}) {
    let source = 'template';
    let config;
    if (request.configId || request.loopConfigId) {
      const resolved = this.getConfig(request.configId || request.loopConfigId);
      config = resolved.config;
      source = resolved.source;
    } else if (request.useActiveConfig !== false) {
      const active = this.getActiveConfig(request);
      config = active.config;
      source = active.source === 'stored' ? 'active' : active.source;
    } else {
      config = this.getConfig(AGENT_LOOP_DEFAULT_CONFIG_ID).config;
      source = 'template';
    }
    if (request.config && typeof request.config === 'object') {
      config = mergeLoopConfigs(config, request.config);
      source = source === 'active' ? 'active+inline' : `${source}+inline`;
    }
    return {
      source,
      config: normalizeLoopConfig(config)
    };
  }

  getStoredProfile(id) {
    if (!this.dataManager?.getRecord) return undefined;
    this.ensureProfileCollection();
    return this.dataManager.getRecord(AGENT_LOOP_PROFILE_COLLECTION, id, { missing: 'undefined' });
  }

  getStoredConfig(id) {
    if (!this.dataManager?.getRecord) return undefined;
    this.ensureLoopManagerCollections();
    return this.dataManager.getRecord(AGENT_LOOP_CONFIG_COLLECTION, id, { missing: 'undefined' });
  }

  ensureProfileCollection() {
    if (!this.dataManager?.ensureCollection) return undefined;
    return this.dataManager.ensureCollection(AGENT_LOOP_PROFILE_COLLECTION, [{
      id: 'example',
      profile: {},
      name: '',
      description: '',
      tags: [],
      updatedAt: this.now()
    }]);
  }

  ensureLoopManagerCollections() {
    if (!this.dataManager?.ensureCollection) return undefined;
    this.ensureProfileCollection();
    this.dataManager.ensureCollection(AGENT_LOOP_CONFIG_COLLECTION, [{
      id: 'example',
      config: {},
      name: '',
      description: '',
      tags: [],
      updatedAt: this.now()
    }]);
    this.dataManager.ensureCollection(AGENT_LOOP_ACTIVE_CONFIG_COLLECTION, [{
      scope: 'global',
      scopeId: 'default',
      configId: AGENT_LOOP_DEFAULT_CONFIG_ID,
      switchedAt: this.now(),
      reason: '',
      updatedAt: this.now()
    }]);
    this.dataManager.ensureCollection(AGENT_LOOP_ARCHIVE_COLLECTION, [{
      id: 'example',
      configId: AGENT_LOOP_DEFAULT_CONFIG_ID,
      label: '',
      reason: '',
      source: '',
      archivedAt: this.now(),
      config: {},
      updatedAt: this.now()
    }]);
    return true;
  }

  async buildTraceStateBefore(request) {
    const active = this.appDatabase?.getActiveChatState?.();
    const chatSessionId = request.chatSessionId || active?.chatSessionId;
    const summary = {
      active,
      chatSessionId,
      availableToolCount: this.toolManager?.listTools ? this.toolManager.listTools({ includeDisabled: false }).length : 0
    };
    if (chatSessionId && this.appDatabase?.getChatSession) {
      try {
        const session = this.appDatabase.getChatSession(chatSessionId, {
          includeMessages: false,
          includeCharacter: true,
          includeDataDatabase: false
        });
        summary.chat = {
          id: session.id,
          title: session.title,
          characterCardId: session.characterCardId,
          characterName: session.characterCard?.data?.name
        };
        summary.messageCount = this.appDatabase.listChatMessages?.(chatSessionId)?.length;
      } catch (error) {
        summary.chatError = serializeError(error);
      }
    }
    return summary;
  }

  buildTraceStateAfter(state) {
    return {
      turnId: state.turnId,
      phases: state.phaseResults.map((phase) => ({
        phaseId: phase.phaseId,
        status: phase.skipped ? 'skipped' : (phase.errors.length ? 'error' : 'success'),
        toolCallCount: phase.toolCalls.length,
        durationMs: phase.durationMs
      })),
      errors: state.errors,
      warnings: state.warnings,
      plannedToolCalls: state.toolResults.filter((result) => result.status === 'planned').length,
      executedToolCalls: state.toolResults.filter((result) => result.status === 'success').length
    };
  }
}

async function executeHandlerToolCall(loop, { phase, state, request, call }) {
  return loop.executePhaseToolCall({
    call,
    phase,
    state,
    request
  });
}

async function runEncounterAutomation(loop, { phase, state, request }) {
  const chatSessionId = request.chatSessionId;
  const sourceText = latestRequestText(request, state);
  const assessment = assessEncounterAutomation(sourceText, phase.config || {});
  if (!chatSessionId || assessment.skip) {
    return {
      noLlm: true,
      skipped: true,
      reason: assessment.reason || 'encounter_automation_not_salient',
      assessment,
      toolCalls: []
    };
  }

  const toolCalls = [];
  const triggerCall = await executeHandlerToolCall(loop, {
    phase,
    state,
    request,
    call: {
      id: 'auto_encounter_trigger',
      toolId: 'system.triggers.roll_encounter_trigger',
      progressLabel: '正在判定是否触发奇遇...',
      input: {
        chatSessionId,
        sceneId: request.sceneId || phase.config?.sceneId || 'current',
        chance: assessment.chance,
        force: assessment.force,
        apply: true,
        source: 'agent_loop.deterministic.pre_tick',
        table: phase.config?.encounterTable
      }
    }
  });
  toolCalls.push(triggerCall);

  if (triggerCall.status === 'success' && triggerCall.output?.triggered) {
    const createCall = await executeHandlerToolCall(loop, {
      phase,
      state,
      request,
      call: {
        id: 'auto_create_encounter',
        toolId: 'system.encounters.create_encounter',
        progressLabel: '正在创建已触发的奇遇记录...',
        input: {
          chatSessionId,
          sceneId: request.sceneId || phase.config?.sceneId || 'current',
          sourceText,
          triggerResult: triggerCall.output,
          sourceTriggerEventId: triggerCall.output?.event?.data?.triggerEventId || triggerCall.output?.event?.id,
          luck: encounterLuckFromTrigger(triggerCall.output),
          useLlm: phase.config?.encounterUseLlm === true,
          dryRun: false
        }
      }
    });
    toolCalls.push(createCall);
  }

  return {
    noLlm: true,
    skipped: false,
    assessment,
    triggered: Boolean(triggerCall.output?.triggered),
    toolCalls
  };
}

async function runNpcReactionAutomation(loop, { phase, state, request }) {
  const chatSessionId = request.chatSessionId;
  const sourceText = latestRequestText(request, state);
  const assessment = assessNpcReactionAutomation(sourceText, phase.config || {});
  if (!chatSessionId || assessment.skip) {
    return {
      noLlm: true,
      skipped: true,
      reason: assessment.reason || 'npc_reaction_not_salient',
      assessment,
      toolCalls: []
    };
  }

  const plan = buildNpcReactionAutomationPlan({
    sourceText,
    chatSessionId,
    sceneId: request.sceneId || phase.config?.sceneId || 'current',
    assessment
  });
  const toolCall = await executeHandlerToolCall(loop, {
    phase,
    state,
    request,
    call: {
      id: 'auto_npc_behavior_resolve',
      toolId: 'system.npc_behavior.resolve',
      progressLabel: '正在判定 NPC 自发反应...',
      input: {
        chatSessionId,
        sceneId: request.sceneId || phase.config?.sceneId || 'current',
        sourceText,
        triggerText: sourceText,
        triggerType: 'post_impact_autonomy',
        plan,
        dryRun: false,
        includeContext: true,
        includeRag: true,
        referenceText: phase.config?.referenceText || phase.config?.npcBehaviorReferenceText || ''
      }
    }
  });

  return {
    noLlm: true,
    skipped: false,
    assessment,
    plan,
    toolCalls: [toolCall]
  };
}

async function runEnvironmentReactionAutomation(loop, { phase, state, request }) {
  const chatSessionId = request.chatSessionId;
  const sourceText = latestRequestText(request, state);
  const assessment = assessEnvironmentAutomation(sourceText, phase.config || {});
  if (!chatSessionId || assessment.skip) {
    return {
      noLlm: true,
      skipped: true,
      reason: assessment.reason || 'environment_reaction_not_salient',
      assessment,
      toolCalls: []
    };
  }
  const toolCall = await executeHandlerToolCall(loop, {
    phase,
    state,
    request,
    call: {
      id: 'auto_environment_behavior_resolve',
      toolId: 'system.environment_behavior.resolve',
      progressLabel: '正在判定环境自发反应...',
      input: {
        chatSessionId,
        sceneId: request.sceneId || phase.config?.sceneId || 'current',
        sourceText,
        triggerText: sourceText,
        triggerType: 'post_impact_environment',
        dryRun: false,
        includeContext: true,
        includeRag: true,
        referenceText: phase.config?.referenceText || phase.config?.environmentBehaviorReferenceText || ''
      }
    }
  });
  return {
    noLlm: true,
    skipped: false,
    assessment,
    toolCalls: [toolCall]
  };
}

async function runPostprocessMemoryAutomation(loop, { phase, state, request }) {
  const chatSessionId = request.chatSessionId;
  const sourceText = latestRequestText(request, state);
  const narrativeText = state.narrative?.content || state.narrative?.draft || '';
  const summarySeed = buildSummarySeed(state);
  const memoryText = compactMemoryText({
    turnId: state.turnId,
    sourceText,
    narrativeText,
    summarySeed
  });
  if (!chatSessionId || !memoryText) {
    return {
      skipped: true,
      reason: 'postprocess_memory_no_chat_or_text',
      summarySeed,
      toolCalls: []
    };
  }

  const toolCalls = [];
  toolCalls.push(await executeHandlerToolCall(loop, {
    phase,
    state,
    request,
    call: {
      id: 'auto_chat_compression_upsert',
      toolId: 'system.chat_compression.upsert_summary',
      progressLabel: '正在写入本轮压缩概况...',
      input: {
        chatSessionId,
        summaryId: `turn_${state.turnId}`,
        type: 'segment_summary',
        title: `Turn ${state.turnId}`,
        summary: memoryText,
        text: memoryText,
        importance: memoryImportanceFromText(sourceText),
        status: 'active',
        source: 'agent_loop.postprocess.memory',
        metadata: {
          turnId: state.turnId,
          sceneId: request.sceneId || phase.config?.sceneId || 'current',
          sourceKind: 'auto_postprocess_memory'
        }
      }
    }
  }));

  toolCalls.push(await executeHandlerToolCall(loop, {
    phase,
    state,
    request,
    call: {
      id: 'auto_runtime_rag_remember',
      toolId: 'system.rag_runtime.remember',
      progressLabel: '正在写入短期向量记忆...',
      input: {
        collection: phase.config?.runtimeRagCollection || 'chat-runtime',
        sourceId: `turn_${state.turnId}`,
        text: memoryText,
        format: 'text',
        ttlSeconds: clampInteger(phase.config?.runtimeRagTtlSeconds ?? 60 * 60 * 6, 60, 60 * 60 * 24 * 30),
        importance: memoryImportanceFromText(sourceText),
        sceneId: request.sceneId || phase.config?.sceneId || 'current',
        memoryType: 'turn_summary',
        metadata: {
          chatSessionId,
          turnId: state.turnId,
          sourceKind: 'agent_loop.postprocess.memory'
        }
      }
    }
  }));

  return {
    skipped: false,
    summarySeed,
    memoryText,
    toolCalls
  };
}

function createDefaultPhaseHandlers(loop) {
  const baselineLoad = async ({ request, phase, state }) => {
    const chatSessionId = request.chatSessionId;
    const recentMessageCount = clampInteger(phase.config?.recentMessageCount ?? request.recentMessageCount ?? 8, 0, 100);
    const output = {
      chatSessionId,
      recentMessageCount,
      recentMessages: [],
      dialogue: '',
      character: undefined,
      characterBook: undefined,
      active: loop.appDatabase?.getActiveChatState?.(),
      baseline: {
        actorRefs: [],
        sceneRefs: [],
        mapRefs: [],
        questRefs: [],
        factionRefs: [],
        keywords: []
      },
      policy: phase.config?.policy || 'Load only small structured facts and identifiers here. Larger lore goes through worldbook/RAG/context budget.'
    };
    if (chatSessionId && loop.appDatabase?.getChatSession) {
      const session = loop.appDatabase.getChatSession(chatSessionId, {
        includeMessages: false,
        includeCharacter: true,
        includeDataDatabase: false
      });
      const messages = loop.appDatabase.listChatMessages(chatSessionId).slice(-recentMessageCount);
      const characterData = session.characterCard?.data || {};
      output.recentMessages = messages;
      output.dialogue = serializeDialogue(messages);
      output.character = {
        id: session.characterCardId,
        name: characterData.name || session.characterCard?.name,
        title: session.title,
        userName: session.userName,
        playerPersona: session.playerPersona
      };
      output.characterBook = characterData.character_book
        ? {
            name: characterData.character_book.name || characterData.name || 'character_book',
            entryCount: countWorldBookEntries(characterData.character_book)
          }
        : undefined;
      output.baseline.keywords = compactUnique([
        characterData.name,
        session.title,
        request.sceneId,
        ...(messages.slice(-3).flatMap((message) => extractLooseKeywords(message.content)))
      ]).slice(0, 30);
    }
    state.baseline = output;
    state.minimalContext = output;
    return output;
  };

  const postprocessMemory = async ({ phase, state, request = {} }) => {
    const automation = await runPostprocessMemoryAutomation(loop, { phase, state, request });
    const output = {
      policy: phase.config?.policy || 'Postprocess accepted output: parse structured UI blocks, run deterministic post-turn tools, and update chat compression/character memory/runtime RAG through configured toolCalls.',
      structured: {
        expectedBlocks: ['scene_map', 'status_bar', 'skill_bar', 'inventory', 'npc_summary'],
        sourceNarrative: state.narrative?.content || state.narrative?.draft || ''
      },
      deterministic: {
        noLlm: true,
        examples: ['duration ticks', 'resource cooldowns', 'trigger scans', 'quest completion checks']
      },
      memory: {
        summarySeed: automation.summarySeed || buildSummarySeed(state),
        automation
      },
      configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0,
      toolCalls: automation.toolCalls || []
    };
    state.structured = output.structured;
    state.postprocess = output;
    return output;
  };

  return {
    'turn.snapshot': async ({ request, profile, state }) => {
      const active = loop.appDatabase?.getActiveChatState?.();
      const chatSessionId = request.chatSessionId || active?.chatSessionId;
      const tools = loop.toolManager?.listTools
        ? loop.toolManager.listTools({ includeDisabled: false }).map(publicTool)
        : [];
      const output = {
        turnId: state.turnId,
        profileId: profile.id,
        dryRun: request.dryRun,
        active,
        chatSessionId,
        availableTools: tools
      };
      if (chatSessionId && loop.appDatabase?.getChatSession) {
        output.chat = getChatSummary(loop.appDatabase, chatSessionId);
      }
      state.snapshot = output;
      return output;
    },

    'deterministic.pre_tick': async ({ phase, state, request }) => {
      const encounter = await runEncounterAutomation(loop, { phase, state, request });
      return {
        noLlm: true,
        policy: phase.config?.policy || 'Run configured deterministic pre-turn tools such as world clocks, quest expiry, triggers, or encounter checks.',
        defaultAction: encounter.skipped ? 'no-op' : 'encounter-check',
        configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0,
        encounter,
        toolCalls: encounter.toolCalls || []
      };
    },

    'input.intake': async ({ request, state }) => {
      const text = request.text || request.currentInput || request.userInput || '';
      const messages = normalizeMessages(request.messages);
      const output = {
        text,
        messages,
        latestUserMessage: text || [...messages].reverse().find((message) => message.role === 'user')?.content || '',
        metadata: request.metadata || {}
      };
      state.input = output;
      return output;
    },

    'actor.control_context': async ({ phase, request, state }) => {
      const text = state.input?.latestUserMessage || request.text || request.currentInput || request.userInput || '';
      const input = {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId || phase.config?.sceneId || 'current',
        text,
        ...(phase.config?.actorControlInput || {}),
        ...(request.actorControl || {}),
        controlledActorId: request.controlledActorId
          || request.playerActorId
          || request.protagonistActorId
          || request.actorControl?.controlledActorId
          || request.actorControl?.playerActorId
          || request.actorControl?.protagonistActorId,
        controlledActorTitle: request.controlledActorTitle
          || request.playerActorTitle
          || request.actorTitle
          || request.actorControl?.controlledActorTitle
          || request.actorControl?.playerActorTitle
          || request.actorControl?.actorTitle,
        controlledPlayerId: request.controlledPlayerId || request.playerId || request.actorControl?.controlledPlayerId || request.actorControl?.playerId,
        viewpointActorId: request.viewpointActorId || request.actorControl?.viewpointActorId,
        embodiedActorId: request.embodiedActorId || request.actorControl?.embodiedActorId,
        inputAuthority: request.inputAuthority || request.actorControl?.inputAuthority,
        worldEditMode: request.worldEditMode === true || request.actorControl?.worldEditMode === true,
        canAssertWorldFacts: request.canAssertWorldFacts === true || request.actorControl?.canAssertWorldFacts === true,
        canAssertNpcDecisions: request.canAssertNpcDecisions === true || request.actorControl?.canAssertNpcDecisions === true
      };
      let output;
      if (request.chatSessionId && loop.toolManager?.getTool) {
        try {
          loop.toolManager.getTool('system.actor_control.get_context');
          const result = await loop.toolManager.executeTool('system.actor_control.get_context', input, undefined, {
            ...request.toolContext,
            agentLoop: {
              turnId: state.turnId,
              phaseId: 'actor.control_context',
              dryRun: request.dryRun
            },
            audit: { skipAudit: true }
          });
          output = {
            ...result.output,
            toolId: 'system.actor_control.get_context',
            trace: result.trace
          };
        } catch (error) {
          output = buildFallbackActorControlOutput({
            request,
            input,
            reason: 'actor_control_tool_unavailable',
            error: serializeError(error)
          });
        }
      } else {
        output = buildFallbackActorControlOutput({
          request,
          input,
          reason: request.chatSessionId ? 'missing_tool_manager' : 'missing_chat_session'
        });
      }
      state.actorControl = output;
      if (state.input) {
        state.input.actorControl = output.context;
        state.input.inputEnvelope = output.inputEnvelope;
        state.input.actorTaggedMessage = output.inputEnvelope?.actorTaggedText || text;
      }
      return output;
    },

    'baseline.load': baselineLoad,
    'context.minimal_load': baselineLoad,

    'route.intent': async ({ phase, profile, state, request }) => {
      const text = state.input?.latestUserMessage || '';
      const intent = classifyIntent(text, {
        fallbackIntent: profile.routes?.fallbackIntent,
        ...(phase.config || {}),
        routes: phase.config?.routes || profile.routes || [],
        request,
        phase
      });
      state.intent = intent;
      return intent;
    },

    'worldbook.activate': async ({ phase, state, request }) => {
      const worldBook = phase.config?.worldBook || request.worldBook || getSessionWorldBook(loop.appDatabase, request.chatSessionId);
      const recentMessages = [
        ...(state.baseline?.recentMessages || state.minimalContext?.recentMessages || []),
        ...(state.input?.latestUserMessage ? [{ role: 'user', content: state.input.latestUserMessage }] : [])
      ];
      const selectedEntries = selectWorldInfoEntries(worldBook, recentMessages, {
        scanDepth: phase.config?.scanDepth || 12,
        budgetChars: phase.config?.budgetChars || 2200,
        budgetTokens: phase.config?.budgetTokens,
        maxRecursionSteps: phase.config?.maxRecursionSteps ?? 1,
        random: typeof phase.config?.random === 'function' ? phase.config.random : undefined
      });
      const activatedEntries = selectedEntries.map(publicWorldBookEntry);
      const output = {
        noLlm: true,
        worldBook: {
          name: worldBook?.name || 'character_book',
          entryCount: countWorldBookEntries(worldBook)
        },
        activatedEntries,
        promptSnippets: activatedEntries
          .filter((entry) => entry.injectionPolicy.mode !== 'never')
          .map((entry) => ({
            id: entry.id,
            title: entry.title,
            priority: entry.priority,
            content: entry.promptSnippet
          }))
          .filter((snippet) => snippet.content)
          .slice(0, phase.config?.maxPromptSnippets || 8),
        policy: phase.config?.policy || 'Worldbook is a navigation layer: activate small high-value entries before RAG, not a replacement for RAG.'
      };
      state.worldbook = output;
      return output;
    },

    'rag.guidance': async ({ phase, state, request }) => {
      const guidance = mergeRagGuidance(
        buildWorldbookRagGuidance(state.worldbook?.activatedEntries || []),
        phase.config?.guidance || {},
        request.ragGuidance || {}
      );
      const output = {
        noLlm: true,
        guidance,
        querySeeds: compactUnique([
          request.query,
          state.input?.latestUserMessage,
          ...(guidance.priorityTerms || []),
          ...(guidance.queryExpansion || []),
          ...(state.baseline?.baseline?.keywords || [])
        ]).slice(0, phase.config?.maxQuerySeeds || 60),
        policy: phase.config?.policy || 'Convert activated worldbook entries into query expansion, collection hints, metadata filters, priority terms, and optional must-include snippets.'
      };
      state.ragGuidance = output;
      return output;
    },

    'retrieval.targeted': async ({ phase, state, request }) => ({
      noLlm: true,
      policy: phase.config?.policy || 'Use configured read-only retrieval tools. The base loop plans RAG/database reads from guidance but does not hard-code a specific store.',
      query: buildGuidedQuery({
        input: request.query || state.input?.latestUserMessage || '',
        guidance: state.ragGuidance?.guidance,
        baseline: state.baseline
      }),
      guidance: state.ragGuidance?.guidance || emptyRagGuidance(),
      collectionHints: state.ragGuidance?.guidance?.collectionHints || [],
      metadataFilters: state.ragGuidance?.guidance?.metadataFilters || {},
      configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0
    }),

    'context.budget': async ({ phase, state, request }) => {
      const shouldUsePlanner = phase.config?.useContextPlanner !== false && request.contextPlanner !== false;
      const toolId = phase.config?.toolId || 'system.context_completeness.resolve_context';
      const plannerInputOverrides = {
        ...(phase.config?.plannerInput || {}),
        ...(request.contextPlannerInput || {})
      };
      const input = {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId || phase.config?.sceneId || 'current',
        query: buildGuidedQuery({
          input: request.query || state.input?.latestUserMessage || '',
          guidance: state.ragGuidance?.guidance,
          baseline: state.baseline
        }),
        currentInput: state.input?.latestUserMessage || request.text || '',
        sourceText: state.input?.latestUserMessage || request.text || '',
        intent: Array.isArray(state.intent?.orderedIntents) && state.intent.orderedIntents.length > 0
          ? state.intent.orderedIntents.map((entry) => entry.intent)
          : state.intent?.intent,
        riskHint: request.riskHint || phase.config?.riskHint,
        actorIds: contextBudgetActorIds({ request, phase, state }),
        maxContextTokens: request.maxContextTokens || phase.config?.maxContextTokens || 6000,
        recentMessageCount: request.recentMessageCount || phase.config?.recentMessageCount || 12,
        ragCollection: state.ragGuidance?.guidance?.collectionHints?.[0],
        ragFilter: state.ragGuidance?.guidance?.metadataFilters,
        ...(toolId === 'system.context_completeness.resolve_context'
          ? { contextPlannerInput: plannerInputOverrides }
          : plannerInputOverrides)
      };
      if (!shouldUsePlanner || !request.chatSessionId || !loop.toolManager?.getTool) {
        const output = {
          planned: shouldUsePlanner,
          executed: false,
          reason: !shouldUsePlanner ? 'disabled' : 'missing_chat_or_tool_manager',
          input,
          promptContext: state.baseline?.dialogue || state.minimalContext?.dialogue || ''
        };
        state.contextPlan = output;
        return output;
      }
      try {
        loop.toolManager.getTool(toolId);
      } catch (error) {
        const fallbackToolId = toolId === 'system.context_completeness.resolve_context'
          ? 'system.context_planner.plan_context'
          : undefined;
        if (fallbackToolId) {
          try {
            loop.toolManager.getTool(fallbackToolId);
            const fallbackInput = fallbackToolId === 'system.context_planner.plan_context'
              ? contextPlannerFallbackInput(input)
              : input;
            const fallbackResult = await loop.toolManager.executeTool(fallbackToolId, fallbackInput, undefined, {
              ...request.toolContext,
              agentLoop: {
                turnId: state.turnId,
                phaseId: 'context.budget',
                dryRun: request.dryRun,
                fallbackFrom: toolId
              }
            });
            const output = {
              planned: true,
              executed: true,
              toolId: fallbackToolId,
              fallbackFrom: toolId,
              input: fallbackInput,
              output: fallbackResult.output,
              trace: fallbackResult.trace
            };
            state.contextPlan = fallbackResult.output;
            return output;
          } catch (fallbackError) {
            const output = {
              planned: true,
              executed: false,
              reason: 'context_tool_not_found',
              error: serializeError(error),
              fallbackError: serializeError(fallbackError),
              input,
              promptContext: state.baseline?.dialogue || state.minimalContext?.dialogue || ''
            };
            state.contextPlan = output;
            return output;
          }
        }
        const output = {
          planned: true,
          executed: false,
          reason: 'context_tool_not_found',
          error: serializeError(error),
          input,
          promptContext: state.baseline?.dialogue || state.minimalContext?.dialogue || ''
        };
        state.contextPlan = output;
        return output;
      }
      const result = await loop.toolManager.executeTool(toolId, input, undefined, {
        ...request.toolContext,
        agentLoop: {
          turnId: state.turnId,
          phaseId: 'context.budget',
          dryRun: request.dryRun
        }
      });
      const output = {
        planned: true,
        executed: true,
        toolId,
        input,
        output: result.output,
        trace: result.trace
      };
      state.contextPlan = result.output;
      state.contextCompleteness = toolId === 'system.context_completeness.resolve_context' ? result.output : undefined;
      return output;
    },

    'resolver.orchestration': async ({ phase, state, request }) => {
      const routerPlan = buildResolverCandidates({
        intent: state.intent,
        request,
        phase,
        text: state.input?.latestUserMessage || '',
        actorControl: state.actorControl
      });
      state.resolverCandidates = routerPlan.candidates;
      state.routerPlan = routerPlan;
      const output = {
        noLlm: true,
        ...routerPlan,
        selectedCandidate: routerPlan.candidates[0] || undefined,
        autoExecuteResolvers: Boolean(phase.config?.autoExecuteResolvers)
      };
      loop.emitProgress({
        type: 'router_plan_updated',
        status: 'running',
        turnId: state.turnId,
        chatSessionId: request.chatSessionId,
        profileId: state.profile?.id,
        phaseId: phase.id,
        routerPlan: {
          source: 'resolver.orchestration',
          title: 'Router 提案',
          items: buildRouterReviewItemsForResolverCandidates({
            turnId: state.turnId,
            chatSessionId: request.chatSessionId,
            phase,
            routerPlan
          })
        },
        progressLabel: 'Router 已给出处理提案'
      });
      return output;
    },

    adjudication: async ({ phase, state, request }) => {
      const candidate = state.resolverCandidates?.[0];
      const output = {
        policy: phase.config?.policy || 'Adjudication is delegated to configured resolver tools or a user-modified prompt.',
        candidate,
        promptTemplate: phase.promptTemplate || DEFAULT_ADJUDICATION_PROMPT,
        requiresExternalResolver: Boolean(candidate),
        plannedOnly: true
      };
      if (candidate?.execute) {
        const candidateItemId = routerReviewResolverItemId(state.turnId, phase.id, candidate);
        const playerSkip = routerReviewSkipRecord({ request, turnId: state.turnId, itemId: candidateItemId });
        if (playerSkip) {
          output.plannedOnly = true;
          output.requiresExternalResolver = false;
          output.skipReason = playerSkip.reason || 'player_skipped_router_item';
          output.resolverResult = {
            status: 'skipped',
            reason: output.skipReason,
            candidate
          };
          loop.emitProgress({
            type: 'resolver_skipped',
            status: 'skipped',
            turnId: state.turnId,
            chatSessionId: request.chatSessionId,
            phaseId: phase.id,
            toolId: candidate.toolId,
            routerItemId: candidateItemId,
            routerItem: routerReviewItemFromResolverCandidate({
              turnId: state.turnId,
              chatSessionId: request.chatSessionId,
              phase,
              candidate,
              status: 'skipped'
            }),
            title: candidate.toolId,
            skipReason: output.skipReason,
            progressLabel: `${humanizeProgressSubject(candidate.toolId)}已按玩家要求跳过`
          });
        } else {
          const resolved = await executeResolverCandidate({
            loop,
            candidate,
            phase,
            state,
            request
          });
          output.plannedOnly = false;
          output.requiresExternalResolver = false;
          output.resolverResult = resolved.output;
          output.resolverTrace = resolved.trace;
          output.resolverTool = resolved.tool;
        }
      }
      state.adjudication = output;
      return output;
    },

    'impact.plan': async ({ phase, state }) => {
      const output = {
        policy: phase.config?.policy || 'Convert adjudication results into an explicit effect/update envelope before writing any state.',
        effectEnvelope: {
          sourceTurnId: state.turnId,
          status: 'draft',
          toolCalls: [],
          notes: []
        },
        promptTemplate: phase.promptTemplate || DEFAULT_IMPACT_PROMPT
      };
      state.impactPlan = output;
      return output;
    },

    'impact.route_validate': async ({ phase, state }) => {
      const output = {
        policy: phase.config?.policy || 'Validate which tools would receive final effects. Dangerous writes remain behind tool authorization.',
        allowedToolIds: Array.isArray(phase.config?.allowedToolIds) ? phase.config.allowedToolIds : [],
        blockedToolIds: Array.isArray(phase.config?.blockedToolIds) ? phase.config.blockedToolIds : [],
        pendingEffects: state.impactPlan?.effectEnvelope?.toolCalls || []
      };
      state.impactRoutes = output;
      return output;
    },

    'state.commit': async ({ phase, request, state }) => {
      const output = {
        dryRun: request.dryRun,
        defaultAction: 'no-op',
        policy: phase.config?.policy || 'Only explicitly configured toolCalls in this phase can commit state.',
        configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0
      };
      state.commit = output;
      return output;
    },

    'reaction.npc': async ({ phase, state, request }) => {
      const automation = await runNpcReactionAutomation(loop, { phase, state, request });
      const output = {
        noLlm: true,
        defaultAction: automation.skipped ? 'no-op' : 'probability-check',
        policy: phase.config?.policy || 'NPC reaction checkpoint. NPC behavior remains probability-based and runs only when the prompt/reference makes NPC autonomy salient.',
        configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0,
        suggestedTool: 'system.npc_behavior.resolve',
        automation,
        toolCalls: automation.toolCalls || []
      };
      state.npcReaction = output;
      return output;
    },

    'reaction.environment': async ({ phase, state, request }) => {
      const automation = await runEnvironmentReactionAutomation(loop, { phase, state, request });
      const output = {
        noLlm: true,
        defaultAction: automation.skipped ? 'mostly-no-op' : 'probability-check',
        policy: phase.config?.policy || 'Environment reaction checkpoint after NPC reactions. Environment behavior is usually no-op unless prompt or reference text makes a scene hazard salient.',
        configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0,
        suggestedTool: 'system.environment_behavior.resolve',
        automation,
        toolCalls: automation.toolCalls || []
      };
      state.environmentReaction = output;
      return output;
    },

    'narrative.render': async ({ phase, profile, request, state }) => {
      const packageOutput = buildNarrativePackage({
        phase,
        profile,
        request,
        state
      });
      state.narrative = packageOutput;
      if (!shouldUseLlmNarrative({ phase, profile, request }) || !loop.chatProvider?.generate) {
        return packageOutput;
      }
      if (request.dryRun && !dryRunAllowsExternalApi(request)) {
        const output = {
          ...packageOutput,
          externalApiSkipped: true,
          reason: 'dry_run_external_api_not_executed'
        };
        state.narrative = output;
        return output;
      }
      const completion = await loop.chatProvider.generate({
        messages: [
          { role: 'system', content: packageOutput.systemPrompt },
          { role: 'user', content: packageOutput.userPrompt }
        ],
        temperature: phase.config?.temperature ?? profile.llm?.temperature,
        maxTokens: phase.config?.maxTokens ?? profile.llm?.maxTokens,
        extra: phase.config?.extra || profile.llm?.extra || {}
      });
      const consistencyReview = reviewNarrativeConsistency(completion.content, packageOutput.resolverGrounding);
      const content = consistencyReview.status === 'blocked'
        ? packageOutput.draft
        : completion.content;
      const output = {
        ...packageOutput,
        completion,
        content,
        originalContent: consistencyReview.status === 'blocked' ? completion.content : undefined,
        consistencyReview
      };
      state.narrative = output;
      return output;
    },

    'structured.parse': async ({ phase, state }) => {
      const output = await postprocessMemory({ phase, state });
      state.structured = output.structured;
      return {
        policy: 'Compatibility alias for postprocess.memory structured parsing.',
        ...output.structured,
        configuredToolCalls: output.configuredToolCalls
      };
    },

    'deterministic.post_tick': async ({ phase }) => ({
      noLlm: true,
      policy: phase.config?.policy || 'Run configured deterministic post-turn tools such as duration ticks, resource cooldowns, trigger scans, or quest completion checks.',
      defaultAction: 'no-op',
      configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0
    }),

    'memory.finalize': async ({ phase, state }) => ({
      policy: 'Compatibility alias for postprocess.memory memory finalization.',
      summarySeed: buildSummarySeed(state),
      configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0
    }),

    'postprocess.memory': postprocessMemory,

    'debug.collect': async ({ phase, profile, request, state }) => {
      const output = buildDebugSummary({
        phase,
        profile,
        request,
        state
      });
      state.debugSummary = output;
      return output;
    }
  };
}

function createGenericPhaseHandler() {
  return async ({ phase, state }) => ({
    phaseId: phase.id,
    mode: phase.mode || 'custom',
    description: phase.description || '',
    promptTemplate: phase.promptTemplate,
    inputSchema: phase.inputSchema,
    outputSchema: phase.outputSchema,
    stateKeys: Object.keys(state).filter((key) => !['phaseResults', 'phaseById', 'toolResults'].includes(key)),
    configuredToolCalls: Array.isArray(phase.toolCalls) ? phase.toolCalls.length : 0
  });
}

function createDefaultAgentLoopProfile() {
  return {
    id: 'default_v1',
    name: 'Default Debuggable Agent Loop v1',
    description: 'A conservative first-pass loop profile. It builds explicit intermediate artifacts, delegates business behavior to tools, and does not auto-commit state in dry-run.',
    version: '0.1.0',
    mutableByUser: true,
    tags: ['default', 'debuggable', 'decoupled'],
    metadata: {
      userLayerMapping: AGENT_LOOP_USER_LAYER_MAPPING,
      architecture: 'phase handlers + declarative toolCalls + editable prompt templates'
    },
    llm: {
      narrative: false,
      temperature: 0.7,
      maxTokens: 1200
    },
    routes: [
      route('management_command', ['导入', '导出', '创建数据库', '删除字段', '增加字段', '设置', '注册', '注销']),
      route('combat_action', ['攻击', '施法', '格挡', '闪避', '射击', '战斗', '伤害', '治疗']),
      route('movement', ['前往', '移动', '去', '进入', '离开', '穿过', '寻路']),
      route('social_action', ['说服', '威胁', '欺骗', '谈判', '求婚', '亲', '拥抱']),
      route('observation', ['观察', '调查', '查看', '聆听', '搜索', '检查']),
      route('chat_only', ['闲聊', '寒暄'])
    ],
    phases: [
      phase('turn.snapshot', 'Turn Snapshot', 10, {
        description: 'Capture active chat, tool list, and trace state before the turn.',
        required: true
      }),
      phase('deterministic.pre_tick', 'Pre-Turn Deterministic Automation', 20, {
        description: 'Optional no-LLM automation before interpreting the player input.',
        mayMutate: true,
        config: {
          examples: ['world clock pulse', 'quest expiry scan', 'death/revival trigger scan', 'encounter luck check']
        }
      }),
      phase('input.intake', 'Input Intake', 30, {
        description: 'Normalize current user input and supplied messages.'
      }),
      phase('actor.control_context', 'Actor Control Context', 35, {
        description: 'Resolve which player actor owns the user input and mark ordinary chat as actor_claim rather than world fact.'
      }),
      phase('baseline.load', 'Baseline Structured Load', 40, {
        description: 'Load small structured facts, identifiers, current chat summary, and recent messages before worldbook/RAG.',
        config: {
          recentMessageCount: 8
        }
      }),
      phase('route.intent', 'Intent Routing', 50, {
        description: 'Route the user input to likely resolver categories using editable keyword templates.',
        config: {
          fallbackIntent: 'player_action'
        }
      }),
      phase('worldbook.activate', 'Worldbook Activation', 60, {
        description: 'Activate small high-priority worldbook entries from current input, recent messages, and baseline facts.',
        config: {
          scanDepth: 12,
          budgetChars: 2200,
          maxRecursionSteps: 1,
          maxPromptSnippets: 8
        }
      }),
      phase('rag.guidance', 'RAG Guidance From Worldbook', 70, {
        description: 'Convert activated worldbook entries into RAG query expansion, collection hints, metadata filters, and priority terms.',
        config: {
          maxQuerySeeds: 60
        }
      }),
      phase('retrieval.targeted', 'Targeted Retrieval', 80, {
        description: 'Plan targeted RAG/database reads from the original input plus worldbook guidance.'
      }),
      phase('context.budget', 'Context Budget Plan', 90, {
        description: 'Resolve context completeness first, then budget prompt context through Context Planner.',
        config: {
          useContextPlanner: true,
          toolId: 'system.context_completeness.resolve_context',
          maxContextTokens: 6000,
          recentMessageCount: 12
        }
      }),
      phase('resolver.orchestration', 'Resolver Orchestration', 100, {
        description: 'Convert intent into resolver candidates without hard-coding execution.',
        config: {
          autoExecuteResolvers: true,
          allowedResolverToolIds: [...DEFAULT_ROUTER_ALLOWED_TOOL_IDS]
        }
      }),
      phase('adjudication', 'Adjudication', 110, {
        llm: true,
        description: 'Editable adjudication prompt/envelope. Specific judgement remains delegated to resolver tools.',
        promptTemplate: DEFAULT_ADJUDICATION_PROMPT
      }),
      phase('impact.plan', 'Impact Plan', 120, {
        llm: true,
        description: 'Draft state impacts from adjudication before any write.',
        promptTemplate: DEFAULT_IMPACT_PROMPT
      }),
      phase('impact.route_validate', 'Impact Route Validation', 130, {
        description: 'Validate final writes and route them to tools.'
      }),
      phase('state.commit', 'State Commit', 140, {
        mayMutate: true,
        description: 'Commit only explicit toolCalls attached to this phase.'
      }),
      phase('reaction.npc', 'NPC Reaction Checkpoint', 145, {
        mayMutate: true,
        description: 'Optional post-impact NPC reaction checkpoint. By default it is a no-op hook; configured toolCalls can run system.npc_behavior.resolve.'
      }),
      phase('reaction.environment', 'Environment Reaction Checkpoint', 146, {
        mayMutate: true,
        description: 'Optional post-NPC environment reaction checkpoint. By default it is mostly no-op; configured toolCalls can run system.environment_behavior.resolve.'
      }),
      phase('narrative.render', 'Three-Layer Narrative Render', 150, {
        llm: true,
        description: 'Build or optionally generate scene/NPC/narrator layered output.',
        promptTemplate: DEFAULT_NARRATIVE_PROMPT,
        config: {
          useLlm: false,
          layers: ['scene', 'npcs', 'narrator']
        }
      }),
      phase('postprocess.memory', 'Postprocess Structured State And Memory', 160, {
        mayMutate: true,
        description: 'Parse structured UI/state output, run deterministic post-turn tools, and update compression/character memory/runtime RAG after acceptance.'
      }),
      phase('debug.collect', 'Debug Turn Summary', 170, {
        description: 'Debug-only rollup of phase outputs, router decisions, tool results, possible player-facing artifacts, and token bloat risks. It must not feed narrative.render.',
        config: {
          maxOutputPreviewChars: 500,
          tokenRiskChars: 4000
        }
      })
    ]
  };
}

function createMinimalAgentLoopProfile() {
  return {
    ...createDefaultAgentLoopProfile(),
    id: 'minimal_debug_v1',
    name: 'Minimal Debug Loop v1',
    description: 'A small loop profile for testing routing and narrative package generation.',
    tags: ['minimal', 'debuggable'],
    phases: createDefaultAgentLoopProfile().phases
      .filter((phaseConfig) => [
        'turn.snapshot',
        'input.intake',
        'route.intent',
        'narrative.render'
      ].includes(phaseConfig.id))
      .map((phaseConfig, index) => ({
        ...phaseConfig,
        order: (index + 1) * 10
      }))
  };
}

function createLlmNarrativeAgentLoopProfile() {
  const profile = createDefaultAgentLoopProfile();
  return {
    ...profile,
    id: 'llm_narrative_v1',
    name: 'LLM Narrative Loop v1',
    description: 'Same as default, but enables the narrative.render LLM call when a chatProvider is supplied.',
    tags: ['llm', 'narrative', 'debuggable'],
    llm: {
      ...profile.llm,
      narrative: true
    },
    phases: profile.phases.map((phaseConfig) => phaseConfig.id === 'narrative.render'
      ? {
          ...phaseConfig,
          config: {
            ...phaseConfig.config,
            useLlm: true
          }
        }
      : phaseConfig)
  };
}

function createDefaultLoopConfig() {
  const profile = createDefaultAgentLoopProfile();
  return {
    id: AGENT_LOOP_DEFAULT_CONFIG_ID,
    name: 'Default Loop Flow v1',
    description: 'Single-step flow using the default full agent loop profile. The step also carries an editable module list so managers can show and change the actual phase/tool order without opening a separate profile first.',
    version: '0.1.0',
    tags: ['default', 'flow', 'hot-switch'],
    mutableByUser: true,
    activeProfileId: profile.id,
    metadata: {
      layer: 'loop-config',
      purpose: 'Default active flow and hot-switch fallback.',
      handoffFamily: 'single_step',
      tokenMode: DEFAULT_HANDOFF_TOKEN_MODE,
      executionModel: 'ordered modules patched over existing profiles'
    },
    hotSwitch: {
      enabled: true,
      scope: 'global',
      scopeId: 'default'
    },
    archive: {
      enabled: true,
      policy: 'Archive before risky flow edits or before switching campaigns.'
    },
    handoff: {
      tokenMode: DEFAULT_HANDOFF_TOKEN_MODE
    },
    steps: [
      loopStepFromProfile({
        id: 'main',
        title: 'Main Turn Loop',
        order: 10,
        profile
      })
    ]
  };
}

function createMinimalLoopConfig() {
  const profile = createMinimalAgentLoopProfile();
  return {
    ...createDefaultLoopConfig(),
    id: 'minimal_flow_v1',
    name: 'Minimal Debug Flow v1',
    description: 'Single-step flow using the minimal debug profile for routing and narrative package tests.',
    tags: ['minimal', 'flow', 'debuggable'],
    activeProfileId: profile.id,
    steps: [
      loopStepFromProfile({
        id: 'minimal',
        title: 'Minimal Debug Loop',
        order: 10,
        profile
      })
    ]
  };
}

function createLlmNarrativeLoopConfig() {
  const profile = createLlmNarrativeAgentLoopProfile();
  return {
    ...createDefaultLoopConfig(),
    id: 'llm_narrative_flow_v1',
    name: 'LLM Narrative Flow v1',
    description: 'Single-step flow using the LLM narrative profile when chatProvider is available.',
    tags: ['llm', 'narrative', 'flow'],
    activeProfileId: profile.id,
    steps: [
      loopStepFromProfile({
        id: 'narrative',
        title: 'LLM Narrative Loop',
        order: 10,
        profile
      })
    ]
  };
}

function createHandoffModeLoopConfig(tokenMode) {
  const mode = normalizeHandoffTokenMode(tokenMode);
  const variants = {
    none: {
      id: 'handoff_none_flow_v1',
      name: 'No Token Saving Loop v1',
      description: 'Two-step flow that preserves the full previous step output in handoff metadata. Use for debugging, migration, and exact-field inspection.',
      label: 'No token saving',
      tags: ['handoff', 'none', 'full-output', 'debuggable']
    },
    light: {
      id: 'handoff_light_flow_v1',
      name: 'Light Token Saving Loop v1',
      description: 'Two-step flow using the default clipped summary plus context envelope handoff.',
      label: 'Light token saving',
      tags: ['handoff', 'light', 'default', 'balanced']
    },
    super: {
      id: 'handoff_super_flow_v1',
      name: 'Super Token Saving Loop v1',
      description: 'Two-step flow using a tighter summary handoff with short narrative, key ids, errors, and envelope refs.',
      label: 'Super token saving',
      tags: ['handoff', 'super', 'compact']
    },
    extreme: {
      id: 'handoff_extreme_flow_v1',
      name: 'Extreme Token Saving Loop v1',
      description: 'Two-step flow that hands off only key ids, intent, context envelope, and trace refs.',
      label: 'Extreme token saving',
      tags: ['handoff', 'extreme', 'reference-only']
    }
  };
  const variant = variants[mode] || variants[DEFAULT_HANDOFF_TOKEN_MODE];
  return {
    ...createDefaultLoopConfig(),
    id: variant.id,
    name: variant.name,
    description: variant.description,
    tags: ['flow', 'hot-switch', ...variant.tags],
    activeProfileId: 'minimal_debug_v1',
    metadata: {
      layer: 'loop-config',
      purpose: 'User-selectable token handoff loop template.',
      handoffFamily: 'token_mode_variants',
      tokenMode: mode,
      tokenModeLabel: variant.label
    },
    handoff: {
      tokenMode: mode
    },
    steps: [
      loopStepFromProfile({
        id: 'route-preview',
        title: 'Route Preview Loop',
        order: 10,
        profile: createMinimalAgentLoopProfile(),
        handoff: {
          tokenMode: mode,
          input: 'preserve'
        }
      }),
      loopStepFromProfile({
        id: 'main-loop',
        title: 'Main Loop With Preview',
        order: 20,
        profile: createDefaultAgentLoopProfile(),
        handoff: {
          tokenMode: mode,
          input: 'preserve',
          previousOutput: mode === 'none'
            ? 'metadata.previousLoopOutput'
            : 'metadata.previousContextEnvelope',
          previousSummary: 'metadata.previousLoopSummary'
        }
      })
    ]
  };
}

function createTwoStageDebugLoopConfig() {
  return {
    ...createDefaultLoopConfig(),
    id: 'two_stage_debug_flow_v1',
    name: 'Two-Stage Debug Flow v1',
    description: 'Example stitched flow: first run a minimal routing pass, then run the full default loop with the previous output available in metadata.',
    tags: ['example', 'multi-step', 'debuggable'],
    activeProfileId: 'minimal_debug_v1',
    steps: [
      loopStepFromProfile({
        id: 'route-preview',
        title: 'Route Preview Loop',
        order: 10,
        profile: createMinimalAgentLoopProfile(),
        handoff: {
          tokenMode: DEFAULT_HANDOFF_TOKEN_MODE,
          input: 'preserve'
        }
      }),
      loopStepFromProfile({
        id: 'main-loop',
        title: 'Main Loop With Preview',
        order: 20,
        profile: createDefaultAgentLoopProfile(),
        handoff: {
          tokenMode: DEFAULT_HANDOFF_TOKEN_MODE,
          input: 'preserve',
          previousOutput: 'metadata.previousContextEnvelope',
          previousSummary: 'metadata.previousLoopSummary'
        }
      })
    ]
  };
}

function loopStepFromProfile({
  id,
  title,
  order,
  profile,
  handoff = defaultLoopStepHandoff()
}) {
  const modules = profileToLoopModules(profile);
  return {
    id,
    title,
    order,
    enabled: true,
    required: true,
    mode: 'turn',
    executionModel: 'profile-modules',
    profileId: profile.id,
    replaceProfilePhases: true,
    modules,
    moduleSequence: modules.map((moduleConfig) => moduleConfig.id),
    toolCallSequence: toolCallSequenceForModules(modules),
    handoff: {
      ...defaultLoopStepHandoff(),
      ...(handoff || {})
    }
  };
}

function defaultLoopStepHandoff() {
  return {
    tokenMode: DEFAULT_HANDOFF_TOKEN_MODE,
    input: 'preserve',
    previousOutput: 'metadata.previousContextEnvelope',
    previousSummary: 'metadata.previousLoopSummary'
  };
}

function phase(id, title, order, extra = {}) {
  return {
    id,
    title,
    order,
    enabled: true,
    mode: 'built_in',
    llm: false,
    mutatesState: false,
    mayMutate: false,
    required: true,
    toolCalls: [],
    config: {},
    ...extra
  };
}

function route(intent, keywords) {
  return {
    intent,
    keywords
  };
}

function profileToLoopModules(profile) {
  return normalizePhases(profile?.phases || []).map((phaseConfig) => {
    const moduleConfig = {
      id: phaseConfig.id,
      phaseId: phaseConfig.id,
      title: phaseConfig.title || phaseConfig.id,
      order: phaseConfig.order,
      enabled: phaseConfig.enabled !== false,
      required: phaseConfig.required !== false,
      mode: phaseConfig.mode || 'built_in',
      llm: Boolean(phaseConfig.llm),
      mutatesState: Boolean(phaseConfig.mutatesState),
      mayMutate: Boolean(phaseConfig.mayMutate),
      description: phaseConfig.description || '',
      progressLabel: phaseConfig.progressLabel || fallbackProgressLabelForPhase(phaseConfig),
      config: phaseConfig.config || {},
      metadata: phaseConfig.metadata || {},
      toolCalls: normalizeConfiguredToolCalls(phaseConfig.toolCalls || [])
    };
    if (phaseConfig.promptTemplate) moduleConfig.promptTemplate = phaseConfig.promptTemplate;
    if (phaseConfig.inputSchema) moduleConfig.inputSchema = phaseConfig.inputSchema;
    if (phaseConfig.outputSchema) moduleConfig.outputSchema = phaseConfig.outputSchema;
    return moduleConfig;
  });
}

function toolCallSequenceForModules(modules) {
  return normalizeLoopModules(modules)
    .flatMap((moduleConfig) => normalizeConfiguredToolCalls(moduleConfig.toolCalls).map((call, index) => ({
      phaseId: moduleConfig.id,
      moduleId: moduleConfig.id,
      callId: call.id,
      toolId: call.toolId,
      order: call.order ?? (index + 1) * 10,
      enabled: call.enabled !== false,
      required: call.required === true,
      executeInDryRun: call.executeInDryRun === true,
      progressLabel: call.progressLabel || fallbackProgressLabelForTool(call.toolId)
    })));
}

function normalizeTurnInput(input = {}) {
  const chatSessionId = input.chatSessionId || input.chatId || input.sessionId;
  return {
    ...input,
    chatSessionId,
    sceneId: input.sceneId || input.currentSceneId || 'current',
    text: input.text || input.currentInput || input.userInput || '',
    messages: normalizeMessages(input.messages),
    dryRun: input.dryRun !== false,
    allowExternalApiInDryRun: input.allowExternalApiInDryRun === true
      || input.dryRunAllowExternalApi === true
      || input.allowApiInDryRun === true,
    routerPolicy: normalizeRouterPolicy(input.routerPolicy || input.router || input.intentRouter),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    toolContext: input.toolContext && typeof input.toolContext === 'object' ? input.toolContext : {}
  };
}

function normalizeRouterPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const source = normalizePlainObject(input);
  const policy = {
    ...source,
    allowedIntents: normalizeStringArray(
      source.allowedIntents
        ?? source.intentAllowlist
        ?? source.intentWhitelist
        ?? source.whitelistIntents
    ),
    blockedIntents: normalizeStringArray(
      source.blockedIntents
        ?? source.intentBlocklist
        ?? source.intentBlacklist
        ?? source.blacklistIntents
        ?? source.deniedIntents
    ),
    intercepts: normalizeRouterIntercepts(
      source.intercepts
        ?? source.intentIntercepts
        ?? source.intentInterceptors
    ),
    allowedResolverToolIds: normalizeStringArray(
      source.allowedResolverToolIds
        ?? source.allowedRouterToolIds
        ?? source.routerAllowedToolIds
        ?? source.resolverToolAllowlist
        ?? source.resolverToolWhitelist
    ),
    additionalResolverToolIds: normalizeStringArray(
      source.additionalResolverToolIds
        ?? source.additionalRouterToolIds
        ?? source.extraResolverToolIds
    ),
    blockedResolverToolIds: normalizeStringArray(
      source.blockedResolverToolIds
        ?? source.blockedRouterToolIds
        ?? source.routerBlockedToolIds
        ?? source.resolverToolBlocklist
        ?? source.resolverToolBlacklist
        ?? source.deniedResolverToolIds
    ),
    allowUnlistedResolverTools: source.allowUnlistedResolverTools === true
      || source.allowAnyResolverTool === true
      || source.allowUnlistedRouterTools === true
  };
  return routerPolicyHasContent(policy) ? policy : undefined;
}

function normalizeRouterIntercepts(intercepts) {
  return (Array.isArray(intercepts) ? intercepts : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const intentIds = normalizeStringArray(entry.intents || entry.intentIds);
      const intentId = normalizeOptionalText(entry.intent || entry.fromIntent || entry.matchIntent);
      const action = normalizeRouterInterceptAction(entry.action || entry.mode || (entry.toIntent || entry.targetIntent ? 'remap' : 'block'));
      return {
        ...entry,
        enabled: entry.enabled !== false,
        intent: intentId,
        intents: compactUnique([intentId, ...intentIds]),
        action,
        toIntent: normalizeOptionalText(entry.toIntent || entry.targetIntent || entry.redirectIntent),
        reason: normalizeOptionalText(entry.reason || entry.note || entry.description)
      };
    })
    .filter((entry) => entry.enabled !== false && entry.intents.length > 0 && entry.action);
}

function normalizeRouterInterceptAction(action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (['block', 'deny', 'drop', 'skip'].includes(normalized)) return 'block';
  if (['allow', 'pass', 'permit'].includes(normalized)) return 'allow';
  if (['remap', 'rewrite', 'redirect'].includes(normalized)) return 'remap';
  return undefined;
}

function routerPolicyHasContent(policy = {}) {
  return normalizeStringArray(policy.allowedIntents).length > 0
    || normalizeStringArray(policy.blockedIntents).length > 0
    || normalizeStringArray(policy.allowedResolverToolIds).length > 0
    || normalizeStringArray(policy.additionalResolverToolIds).length > 0
    || normalizeStringArray(policy.blockedResolverToolIds).length > 0
    || (Array.isArray(policy.intercepts) && policy.intercepts.length > 0)
    || policy.allowUnlistedResolverTools === true;
}

function mergeRouterPolicies(...sources) {
  const policies = sources.map((source) => normalizeRouterPolicy(source)).filter(Boolean);
  if (policies.length === 0) return undefined;
  const merged = {};
  for (const policy of policies) {
    const previousAllowedIntents = merged.allowedIntents || [];
    const previousBlockedIntents = merged.blockedIntents || [];
    const previousIntercepts = merged.intercepts || [];
    const previousAllowedResolverToolIds = merged.allowedResolverToolIds || [];
    const previousAdditionalResolverToolIds = merged.additionalResolverToolIds || [];
    const previousBlockedResolverToolIds = merged.blockedResolverToolIds || [];
    Object.assign(merged, policy);
    merged.allowedIntents = policy.allowedIntents?.length
      ? [...policy.allowedIntents]
      : previousAllowedIntents;
    merged.blockedIntents = compactUnique([
      ...previousBlockedIntents,
      ...(policy.blockedIntents || [])
    ]);
    merged.intercepts = [
      ...previousIntercepts,
      ...(policy.intercepts || [])
    ];
    merged.allowedResolverToolIds = policy.allowedResolverToolIds?.length
      ? [...policy.allowedResolverToolIds]
      : previousAllowedResolverToolIds;
    merged.additionalResolverToolIds = compactUnique([
      ...previousAdditionalResolverToolIds,
      ...(policy.additionalResolverToolIds || [])
    ]);
    merged.blockedResolverToolIds = compactUnique([
      ...previousBlockedResolverToolIds,
      ...(policy.blockedResolverToolIds || [])
    ]);
    if (policy.allowUnlistedResolverTools === true) {
      merged.allowUnlistedResolverTools = true;
    }
  }
  return routerPolicyHasContent(merged) ? merged : undefined;
}

function routerPolicySummary(policyInput) {
  const policy = normalizeRouterPolicy(policyInput);
  if (!policy) return undefined;
  return {
    allowedIntents: policy.allowedIntents || [],
    blockedIntents: policy.blockedIntents || [],
    interceptCount: Array.isArray(policy.intercepts) ? policy.intercepts.length : 0,
    allowedResolverToolIds: policy.allowedResolverToolIds || [],
    additionalResolverToolIds: policy.additionalResolverToolIds || [],
    blockedResolverToolIds: policy.blockedResolverToolIds || [],
    allowUnlistedResolverTools: policy.allowUnlistedResolverTools === true
  };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      id: message.id,
      role: message.role || 'user',
      name: message.name,
      content: String(message.content || ''),
      metadata: message.metadata || {},
      createdAt: message.createdAt,
      orderIndex: message.orderIndex
    }));
}

function normalizeProfile(input = {}, { fallbackId } = {}) {
  const base = {
    id: fallbackId || input.id || 'custom_loop',
    name: input.name || input.title || fallbackId || input.id || 'Custom Agent Loop',
    description: input.description || '',
    version: input.version || '0.1.0',
    mutableByUser: input.mutableByUser !== false,
    tags: Array.isArray(input.tags) ? input.tags : [],
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    llm: input.llm && typeof input.llm === 'object' ? input.llm : {},
    routes: Array.isArray(input.routes) ? input.routes : [],
    phases: normalizePhases(input.phases || [])
  };
  return {
    ...input,
    ...base
  };
}

function normalizeLoopConfig(input = {}, { fallbackId } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const steps = normalizeLoopConfigSteps(source.steps);
  const activeProfileId = source.activeProfileId
    || source.profileId
    || steps.find((step) => step.enabled !== false && step.profileId)?.profileId
    || 'default_v1';
  return {
    ...source,
    id: fallbackId || source.id || source.configId || source.loopConfigId || 'custom_flow',
    name: source.name || source.title || fallbackId || source.id || 'Custom Loop Flow',
    description: source.description || '',
    version: source.version || '0.1.0',
    mutableByUser: source.mutableByUser !== false,
    tags: Array.isArray(source.tags) ? source.tags : [],
    metadata: normalizePlainObject(source.metadata),
    phaseProgressLabels: normalizeProgressLabels(source.phaseProgressLabels || source.progressLabels),
    routerPolicy: normalizeRouterPolicy(source.routerPolicy || source.router || source.intentRouter),
    activeProfileId,
    handoff: {
      tokenMode: DEFAULT_HANDOFF_TOKEN_MODE,
      ...(normalizePlainObject(source.handoff))
    },
    hotSwitch: {
      enabled: source.hotSwitch?.enabled !== false,
      scope: source.hotSwitch?.scope || 'global',
      scopeId: source.hotSwitch?.scopeId || 'default',
      ...(normalizePlainObject(source.hotSwitch))
    },
    archive: {
      enabled: source.archive?.enabled !== false,
      ...(normalizePlainObject(source.archive))
    },
    steps: steps.length ? steps : normalizeLoopConfigSteps(createDefaultLoopConfig().steps)
  };
}

function normalizeLoopConfigSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .filter((step) => step && typeof step === 'object' && step.id)
    .map((step, index) => {
      const modules = normalizeLoopModules(step.modules || step.moduleSequence || step.phases);
      return {
        enabled: true,
        required: true,
        mode: 'turn',
        executionModel: modules.length > 0 ? 'profile-modules' : 'profile',
        handoff: defaultLoopStepHandoff(),
        input: {},
        metadata: {},
        ...step,
        id: String(step.id),
        title: step.title || step.name || String(step.id),
        order: Number.isFinite(Number(step.order)) ? Number(step.order) : (index + 1) * 10,
        profileId: step.profileId || step.profile?.id,
        replaceProfilePhases: modules.length > 0 ? step.replaceProfilePhases !== false : Boolean(step.replaceProfilePhases),
        modules,
        moduleSequence: modules.map((moduleConfig) => moduleConfig.id),
        toolCallSequence: toolCallSequenceForModules(modules),
        handoff: {
          ...defaultLoopStepHandoff(),
          ...(normalizePlainObject(step.handoff))
        },
        input: normalizePlainObject(step.input),
        metadata: normalizePlainObject(step.metadata),
        phaseProgressLabels: normalizeProgressLabels(step.phaseProgressLabels || step.progressLabels),
        routerPolicy: normalizeRouterPolicy(step.routerPolicy || step.router || step.intentRouter)
      };
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function normalizeLoopModules(modules) {
  return (Array.isArray(modules) ? modules : [])
    .map((moduleConfig, index) => {
      if (typeof moduleConfig === 'string') {
        return normalizeLoopModule({ id: moduleConfig }, index);
      }
      return normalizeLoopModule(moduleConfig, index);
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function normalizeLoopModule(moduleConfig, index) {
  if (!moduleConfig || typeof moduleConfig !== 'object') return undefined;
  const id = moduleConfig.id || moduleConfig.phaseId || moduleConfig.name;
  if (!id) return undefined;
  const toolCalls = normalizeConfiguredToolCalls(moduleConfig.toolCalls);
  return {
    enabled: true,
    required: true,
    mode: 'built_in',
    llm: false,
    mutatesState: false,
    mayMutate: false,
    config: {},
    toolCalls: [],
    ...moduleConfig,
    id: String(id),
    phaseId: String(id),
    title: moduleConfig.title || moduleConfig.name || String(id),
    order: Number.isFinite(Number(moduleConfig.order)) ? Number(moduleConfig.order) : (index + 1) * 10,
    enabled: moduleConfig.enabled !== false,
    required: moduleConfig.required !== false,
    llm: Boolean(moduleConfig.llm),
    mutatesState: Boolean(moduleConfig.mutatesState),
    mayMutate: Boolean(moduleConfig.mayMutate),
    progressLabel: normalizeOptionalText(moduleConfig.progressLabel),
    description: moduleConfig.description || moduleConfig.purpose || '',
    config: normalizePlainObject(moduleConfig.config),
    metadata: normalizePlainObject(moduleConfig.metadata),
    toolCalls
  };
}

function normalizeConfiguredToolCalls(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .filter((call) => call && typeof call === 'object' && (call.toolId || call.id || call.name))
    .map((call, index) => ({
      enabled: true,
      required: false,
      executeInDryRun: false,
      input: {},
      context: {},
      ...call,
      id: call.id || call.callId || `${call.toolId || call.name || 'tool'}_${index + 1}`,
      toolId: call.toolId || call.name || call.id,
      order: Number.isFinite(Number(call.order)) ? Number(call.order) : (index + 1) * 10,
      input: normalizePlainObject(call.input),
      context: normalizePlainObject(call.context),
      progressLabel: normalizeOptionalText(call.progressLabel)
    }))
    .sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
}

function mergeLoopConfigs(baseInput, overrideInput) {
  const base = normalizeLoopConfig(cloneJson(baseInput || createDefaultLoopConfig()));
  const override = overrideInput && typeof overrideInput === 'object' ? cloneJson(overrideInput) : {};
  const replaceSteps = override.inherit === false || override.replaceSteps === true;
  const merged = {
    ...base,
    ...override,
    id: override.id || override.configId || override.loopConfigId || base.id,
    name: override.name || override.title || base.name,
    metadata: {
      ...(base.metadata || {}),
      ...(override.metadata || {})
    },
    phaseProgressLabels: {
      ...(base.phaseProgressLabels || {}),
      ...(override.phaseProgressLabels || override.progressLabels || {})
    },
    routerPolicy: mergeRouterPolicies(
      base.routerPolicy,
      override.routerPolicy || override.router || override.intentRouter
    ),
    hotSwitch: {
      ...(base.hotSwitch || {}),
      ...(override.hotSwitch || {})
    },
    archive: {
      ...(base.archive || {}),
      ...(override.archive || {})
    }
  };
  if (Array.isArray(override.steps)) {
    merged.steps = replaceSteps
      ? normalizeLoopConfigSteps(override.steps)
      : mergeLoopConfigSteps(base.steps, override.steps);
  } else {
    merged.steps = normalizeLoopConfigSteps(base.steps);
  }
  return normalizeLoopConfig(merged);
}

function mergeLoopConfigSteps(baseSteps, overrideSteps) {
  const byId = new Map(normalizeLoopConfigSteps(baseSteps).map((step) => [step.id, step]));
  for (const override of overrideSteps) {
    if (!override?.id) continue;
    const current = byId.get(String(override.id));
    if (override.delete === true || override.enabled === 'delete') {
      byId.delete(String(override.id));
      continue;
    }
    byId.set(String(override.id), current
      ? {
          ...current,
          ...override,
          input: {
            ...(current.input || {}),
            ...(override.input || {})
          },
          metadata: {
            ...(current.metadata || {}),
            ...(override.metadata || {})
          },
          phaseProgressLabels: {
            ...(current.phaseProgressLabels || {}),
            ...(override.phaseProgressLabels || override.progressLabels || {})
          },
          routerPolicy: mergeRouterPolicies(
            current.routerPolicy,
            override.routerPolicy || override.router || override.intentRouter
          ),
          handoff: {
            ...(current.handoff || {}),
            ...(override.handoff || {})
          }
        }
      : override);
  }
  return normalizeLoopConfigSteps([...byId.values()]);
}

function normalizePhases(phases) {
  return (Array.isArray(phases) ? phases : [])
    .filter((phaseConfig) => phaseConfig && typeof phaseConfig === 'object' && phaseConfig.id)
    .map((phaseConfig, index) => ({
      enabled: true,
      mode: 'custom',
      llm: false,
      mutatesState: false,
      mayMutate: false,
      required: true,
      toolCalls: [],
      config: {},
      ...phaseConfig,
      id: String(phaseConfig.id),
      progressLabel: normalizeOptionalText(phaseConfig.progressLabel),
      order: Number.isFinite(Number(phaseConfig.order)) ? Number(phaseConfig.order) : (index + 1) * 10
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function mergeProfiles(baseInput, overrideInput) {
  const base = normalizeProfile(cloneJson(baseInput || createDefaultAgentLoopProfile()));
  const override = overrideInput && typeof overrideInput === 'object' ? cloneJson(overrideInput) : {};
  const replacePhases = override.inherit === false || override.replacePhases === true;
  const merged = {
    ...base,
    ...override,
    id: override.id || base.id,
    name: override.name || override.title || base.name,
    metadata: {
      ...(base.metadata || {}),
      ...(override.metadata || {})
    },
    llm: {
      ...(base.llm || {}),
      ...(override.llm || {})
    },
    routes: Array.isArray(override.routes) ? override.routes : base.routes
  };

  if (Array.isArray(override.phases)) {
    merged.phases = replacePhases
      ? normalizePhases(override.phases)
      : mergePhases(base.phases, override.phases);
  } else {
    merged.phases = normalizePhases(base.phases);
  }
  return normalizeProfile(merged);
}

function mergePhases(basePhases, overridePhases) {
  const byId = new Map(normalizePhases(basePhases).map((phaseConfig) => [phaseConfig.id, phaseConfig]));
  for (const override of overridePhases) {
    if (!override?.id) continue;
    const current = byId.get(override.id);
    if (override.delete === true || override.enabled === 'delete') {
      byId.delete(override.id);
      continue;
    }
    byId.set(override.id, current ? deepMergePhase(current, override) : override);
  }
  return normalizePhases([...byId.values()]);
}

function deepMergePhase(base, override) {
  return {
    ...base,
    ...override,
    config: {
      ...(base.config || {}),
      ...(override.config || {})
    },
    toolCalls: Array.isArray(override.toolCalls) ? override.toolCalls : (base.toolCalls || [])
  };
}

function createLoopState({ request, profile, turnId, now }) {
  return {
    turnId,
    startedAt: now(),
    request,
    profile: publicProfile(profile, { includePhases: true }),
    phaseResults: [],
    phaseById: {},
    contextEnvelopeByPhase: {},
    contextEnvelopeList: [],
    latestContextEnvelope: undefined,
    toolResults: [],
    warnings: [],
    errors: []
  };
}

function buildRouterReviewItemsForPhases({ turnId, chatSessionId, profile, phases = [] }) {
  const items = [];
  for (const phase of phases) {
    items.push(routerReviewItemFromPhase({
      turnId,
      chatSessionId,
      profile,
      phase,
      status: 'pending'
    }));
    for (const [index, call] of normalizeConfiguredToolCalls(phase.toolCalls || []).entries()) {
      items.push(routerReviewItemFromToolCall({
        turnId,
        chatSessionId,
        phase,
        call: {
          ...call,
          id: call.id || `${phase.id}:${call.toolId || call.name || index + 1}`,
          toolId: call.toolId || call.name || call.id
        },
        index,
        status: 'pending'
      }));
    }
  }
  return items;
}

function buildRouterReviewItemsForResolverCandidates({ turnId, chatSessionId, phase, routerPlan = {} }) {
  return (Array.isArray(routerPlan.candidates) ? routerPlan.candidates : []).map((candidate) => routerReviewItemFromResolverCandidate({
    turnId,
    chatSessionId,
    phase,
    candidate,
    status: candidate.execute ? 'pending' : 'planned'
  }));
}

function routerReviewItemFromPhase({ turnId, chatSessionId, profile, phase, status = 'pending' }) {
  const title = phase.title || phase.id;
  return {
    id: routerReviewPhaseItemId(turnId, phase.id),
    turnId,
    chatSessionId,
    kind: 'module',
    status,
    phaseId: phase.id,
    profileId: profile?.id,
    order: phase.order,
    title,
    text: `AI 认为本轮需要执行模块：${title}`,
    detail: phase.description || phase.progressLabel || fallbackProgressLabelForPhase(phase),
    skippable: true
  };
}

function routerReviewItemFromToolCall({ turnId, chatSessionId, phase, call, index = 0, status = 'pending' }) {
  const toolId = call.toolId || call.id || call.name;
  const title = call.progressLabel || fallbackProgressLabelForTool(toolId);
  return {
    id: routerReviewToolItemId(turnId, phase.id, call),
    turnId,
    chatSessionId,
    kind: 'tool',
    status,
    phaseId: phase.id,
    toolId,
    order: Number(phase.order || 0) + (index + 1) / 100,
    title,
    text: `AI 认为需要调用工具：${humanizeProgressSubject(toolId)}`,
    detail: `来自模块 ${phase.title || phase.id}`,
    skippable: true
  };
}

function routerReviewItemFromResolverCandidate({ turnId, chatSessionId, phase, candidate, status = 'pending' }) {
  const toolId = candidate.toolId || '';
  const intentText = candidate.intent ? `，用于处理「${candidate.intent}」` : '';
  return {
    id: routerReviewResolverItemId(turnId, phase.id, candidate),
    turnId,
    chatSessionId,
    kind: 'resolver',
    status,
    phaseId: phase.id,
    toolId,
    intent: candidate.intent,
    order: candidate.order,
    title: humanizeProgressSubject(toolId),
    text: `Router 建议使用 ${humanizeProgressSubject(toolId)}${intentText}`,
    detail: [
      candidate.reason,
      candidate.keyword ? `命中关键词：${candidate.keyword}` : '',
      candidate.confidence !== undefined ? `置信度 ${Math.round(Number(candidate.confidence) * 100)}%` : ''
    ].filter(Boolean).join(' · '),
    skippable: true
  };
}

function routerReviewPhaseItemId(turnId, phaseId) {
  return `router:phase:${safeSegment(turnId)}:${safeSegment(phaseId)}`;
}

function routerReviewToolItemId(turnId, phaseId, call = {}) {
  return `router:tool:${safeSegment(turnId)}:${safeSegment(phaseId)}:${safeSegment(call.id || call.toolId || call.name || 'tool')}`;
}

function routerReviewResolverItemId(turnId, phaseId, candidate = {}) {
  return `router:resolver:${safeSegment(turnId)}:${safeSegment(phaseId)}:${safeSegment(candidate.toolId || 'resolver')}:${safeSegment(candidate.intent || 'intent')}:${safeSegment(candidate.order || 0)}`;
}

function routerReviewSkipRecord({ request, turnId, itemId } = {}) {
  return agentRouterReviewStore.getSkip({
    chatSessionId: request?.chatSessionId,
    turnId,
    itemId
  });
}

function buildSettlementNoticeFromToolResult({ toolId, phaseId, output } = {}) {
  if (!isSettlementToolId(toolId)) return undefined;
  const category = settlementNoticeCategory(toolId, phaseId);
  if (!category) return undefined;
  return {
    id: createId('settlement_notice'),
    type: category.type,
    title: category.title,
    text: `${category.subject}已结算`,
    detail: settlementNoticeDetail(toolId, output),
    toolId,
    phaseId
  };
}

function isSettlementToolId(toolId) {
  const text = String(toolId || '').toLowerCase();
  if (/(\.list_|\.get_|\.query_|\.search_|\.find_|\.describe_|\.export_|context_planner|rag\.search|worldbook)/.test(text)) return false;
  return /(upsert|patch|delete|import|apply|resolve|commit|update|set_|clear_|start|end|advance|tick|create|spend|use|equip|unequip|switch|enter|expire)/.test(text);
}

function settlementNoticeCategory(toolId = '', phaseId = '') {
  const text = `${toolId} ${phaseId}`.toLowerCase();
  if (/system\.npc_behavior\.resolve/.test(text)) {
    return { type: 'npc-behavior', title: 'NPC自发行为', subject: 'NPC自发行为' };
  }
  if (/system\.environment_behavior\.resolve/.test(text)) {
    return { type: 'environment-behavior', title: '环境自发行为', subject: '环境自发行为' };
  }
  if (/inventory|item|equipment|loot|resource/.test(text)) return { type: 'inventory', title: '背包变化', subject: '背包' };
  if (/status|effect|time|clock|trigger/.test(text)) return { type: 'status', title: '状态变化', subject: '状态' };
  if (/npc|actor|party|relationship|faction|protagonist/.test(text)) return { type: 'npc', title: '人物变化', subject: 'NPC' };
  if (/map|scene|location|route|path/.test(text)) return { type: 'map', title: '地图变化', subject: '地图' };
  if (/quest|encounter/.test(text)) return { type: 'quest', title: '任务变化', subject: '任务' };
  if (/combat|battle|damage|dice/.test(text)) return { type: 'combat', title: '战斗变化', subject: '战斗' };
  if (/memory|rag|compression/.test(text)) return { type: 'memory', title: '记忆变化', subject: '记忆' };
  if (/data/.test(text)) return { type: 'data', title: '数据变化', subject: '数据' };
  return undefined;
}

function settlementNoticeDetail(toolId, output) {
  const text = String(toolId || '').toLowerCase();
  if (/system\.npc_behavior\.resolve/.test(text)) {
    return behaviorSettlementDetail(output, 'NPC');
  }
  if (/system\.environment_behavior\.resolve/.test(text)) {
    return behaviorSettlementDetail(output, '环境');
  }
  const parts = [humanizeProgressSubject(toolId)];
  if (output && typeof output === 'object') {
    const count = firstFiniteNumber(
      output.count,
      output.updated,
      output.created,
      output.deleted,
      output.records?.length,
      output.nodes?.count,
      output.edges?.count,
      output.factions?.count,
      output.relations?.count,
      output.memberships?.count
    );
    if (count !== undefined) parts.push(`${count}项`);
  }
  return parts.filter(Boolean).join(' · ');
}

function behaviorSettlementDetail(output, subject = '行为') {
  if (!output || typeof output !== 'object') return '';
  const plan = output.plan || output.apply?.plan || {};
  const apply = output.apply?.apply || output.apply || {};
  const intent = plan.intent || {};
  const calls = Array.isArray(apply.appliedToolCalls) ? apply.appliedToolCalls : [];
  const failed = Array.isArray(apply.failedToolCalls) ? apply.failedToolCalls : [];
  const skipped = Array.isArray(apply.skippedToolCalls) ? apply.skippedToolCalls : [];
  const status = output.status || apply.status || '';
  const summary = intent.summary || plan.narrationHints?.success || plan.narrationHints?.noTrigger || '';
  const noOp = !calls.length && !failed.length && !skipped.length && (/noop|no-op|noTrigger|没有产生独立反应|did not/.test(String(summary)));
  return [
    noOp ? `${subject}没有产生独立反应` : summary,
    calls.length ? `执行 ${calls.length} 项` : '',
    failed.length ? `失败 ${failed.length} 项` : '',
    !calls.length && !failed.length && !noOp && status ? `状态 ${status}` : ''
  ].filter(Boolean).join(' · ');
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function classifyIntent(text, config = {}) {
  const source = String(text || '').trim();
  if (!source) return intent('empty', 1, ['empty_input'], source);
  const routerPolicy = normalizeRouterPolicy(config.routerPolicy || config.router || config.intentRouter);
  const routeMatches = collectOrderedIntentMatches(source, {
    routes: config.routes,
    includeDefaultRules: config.includeDefaultRules !== false,
    request: config.request,
    phase: config.phase
  });
  const orderedIntents = protectPartialSpecializedMacroAction(source, routeMatches, { routerPolicy });
  const rawIntents = orderedIntents.length > 0
    ? orderedIntents
    : [buildFallbackIntentFromUnmatchedInput(source, config.fallbackIntent || 'player_action')];
  const routed = applyRouterPolicyToIntentEntries(rawIntents, {
    policy: routerPolicy,
    sourceText: source
  });
  if (routed.allowedIntents.length > 0) {
    const selected = routed.allowedIntents[0];
    return {
      ...selected,
      orderedIntents: orderedIntents.length > 0 ? routed.allowedIntents : [],
      blockedIntents: routed.blockedIntents,
      interceptedIntents: routed.interceptedIntents,
      routerPolicy: routerPolicySummary(routerPolicy)
    };
  }
  return {
    ...intent('router_blocked', 1, ['router_policy:all_intents_blocked'], source, {
      blocked: true,
      originalIntent: rawIntents[0]?.intent,
      orderedIntents: [],
      blockedIntents: routed.blockedIntents,
      interceptedIntents: routed.interceptedIntents,
      routerPolicy: routerPolicySummary(routerPolicy)
    })
  };
}

function applyRouterPolicyToIntentEntries(entries = [], { policy: policyInput, sourceText = '' } = {}) {
  const policy = normalizeRouterPolicy(policyInput);
  const allowedSet = new Set(policy?.allowedIntents || []);
  const blockedSet = new Set(policy?.blockedIntents || []);
  const hasAllowlist = allowedSet.size > 0;
  const allowedIntents = [];
  const blockedIntents = [];
  const interceptedIntents = [];

  for (const [index, sourceEntry] of entries.entries()) {
    if (!sourceEntry?.intent) continue;
    let entry = {
      ...sourceEntry,
      sequence: Number.isFinite(Number(sourceEntry.sequence)) ? Number(sourceEntry.sequence) : index + 1
    };
    const originalIntent = entry.intent;
    const matchedIntercept = findRouterIntercept(entry.intent, policy);
    if (matchedIntercept) {
      interceptedIntents.push({
        intent: originalIntent,
        action: matchedIntercept.action,
        toIntent: matchedIntercept.toIntent,
        reason: matchedIntercept.reason
      });
      if (matchedIntercept.action === 'block') {
        blockedIntents.push({
          ...entry,
          blocked: true,
          originalIntent,
          reason: `router_intent_intercepted:${originalIntent}`,
          policyReason: matchedIntercept.reason
        });
        continue;
      }
      if (matchedIntercept.action === 'remap' && matchedIntercept.toIntent) {
        entry = {
          ...entry,
          intent: matchedIntercept.toIntent,
          originalIntent,
          reasons: [
            ...(Array.isArray(entry.reasons) ? entry.reasons : []),
            `router_intent_remapped:${originalIntent}->${matchedIntercept.toIntent}`
          ]
        };
      }
    }

    if (blockedSet.has(entry.intent)) {
      blockedIntents.push({
        ...entry,
        blocked: true,
        originalIntent,
        reason: `router_intent_blocked:${entry.intent}`
      });
      continue;
    }
    if (hasAllowlist && !allowedSet.has(entry.intent)) {
      blockedIntents.push({
        ...entry,
        blocked: true,
        originalIntent,
        reason: `router_intent_not_allowed:${entry.intent}`
      });
      continue;
    }
    allowedIntents.push(entry);
  }

  return {
    allowedIntents,
    blockedIntents,
    interceptedIntents
  };
}

function findRouterIntercept(intentId, policyInput) {
  const policy = normalizeRouterPolicy(policyInput);
  if (!policy?.intercepts?.length) return undefined;
  return policy.intercepts.find((entry) => (
    entry.enabled !== false
    && (entry.intents || []).some((candidate) => candidate === '*' || candidate === intentId)
  ));
}

function collectOrderedIntentMatches(text, { routes: routeRules = [], includeDefaultRules = true, request, phase } = {}) {
  const source = String(text || '');
  const lowered = source.toLowerCase();
  const configuredRoutes = Array.isArray(routeRules) ? routeRules : [];
  const rules = [
    ...configuredRoutes.map((rule) => ({
      intent: rule?.intent,
      keywords: Array.isArray(rule?.keywords) ? rule.keywords : [],
      confidence: Number.isFinite(Number(rule?.confidence)) ? Number(rule.confidence) : 0.76,
      source: 'profile'
    })),
    ...(includeDefaultRules ? DEFAULT_INTENT_RULES.map((rule) => ({
      intent: rule.intent,
      keywords: Array.isArray(rule.keywords) ? rule.keywords : [],
      confidence: 0.7,
      source: 'default'
    })) : [])
  ];
  const byIntent = new Map();

  for (const [ruleOrder, rule] of rules.entries()) {
    if (!rule.intent || !Array.isArray(rule.keywords)) continue;
    for (const keyword of rule.keywords) {
      const normalizedKeyword = String(keyword || '').trim();
      if (!normalizedKeyword) continue;
      const index = lowered.indexOf(normalizedKeyword.toLowerCase());
      if (index < 0) continue;
      if (rule.intent === 'movement' && !shouldAcceptMovementIntentMatch(source, {
        keyword: normalizedKeyword,
        index,
        request,
        phase
      })) {
        continue;
      }
      const match = intent(rule.intent, rule.confidence, [
        `keyword:${rule.intent}`,
        `matched:${normalizedKeyword}`,
        `source:${rule.source}`
      ], source, {
        keyword: normalizedKeyword,
        index,
        order: ruleOrder,
        source: rule.source
      });
      const existing = byIntent.get(rule.intent);
      if (!existing || match.index < existing.index || (match.index === existing.index && match.order < existing.order)) {
        byIntent.set(rule.intent, match);
      }
    }
  }

  return [...byIntent.values()]
    .sort((a, b) => a.index - b.index || a.order - b.order || a.intent.localeCompare(b.intent))
    .map((entry, index) => ({
      ...entry,
      sequence: index + 1
    }));
}

function shouldAcceptMovementIntentMatch(source, { keyword = '', request, phase } = {}) {
  if (hasExplicitMovementEndpoint({ request, phase })) return true;
  const text = String(source || '').trim();
  const normalizedKeyword = String(keyword || '').trim();
  if (!text || !normalizedKeyword) return false;
  if (/寻路/u.test(normalizedKeyword)) return false;
  if (normalizedKeyword === '去') return false;
  if (isActionPurposeTravel(text)) return false;
  return false;
}

function hasExplicitMovementEndpoint({ request, phase } = {}) {
  const pathInput = resolverPathInput({ request, phase });
  return hasAnyNonEmptyValue(pathInput, ['targetMapId', 'toMapId', 'targetNodeId', 'to'])
    || hasAnyNonEmptyValue(pathInput, ['destinationMapId', 'destinationLocationId', 'targetLocationId']);
}

function isActionPurposeTravel(source = '') {
  const text = String(source || '').trim();
  if (!text) return false;
  return /(?:去|前往|移动到|进入).{0,12}(?:学|学习|修炼|练功|领取|拿|取|购买|拾取|收集|采集|打|杀|猎|攻击|说服|交谈|谈判|调查|搜索|查看|检查|完成|提交|提升|突破|炼|制作|打造|休息|工作|打听)/u.test(text);
}

function protectPartialSpecializedMacroAction(source, entries = [], { routerPolicy } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  if (entries.some((entry) => entry.intent === 'player_action')) return entries;
  if (entries.some((entry) => findRouterIntercept(entry.intent, routerPolicy))) return entries;
  const shape = classifyInputShape(source);
  if (!shape.macro) return entries;
  const actionableEntries = entries.filter((entry) => !DEFAULT_ROUTER_NO_FALLBACK_INTENTS.includes(entry.intent));
  if (actionableEntries.length === 0) return entries;
  if (actionableEntries.length >= shape.clauseCount) return entries;
  const protectedEntry = intent('player_action', 0.68, [
    'structural_macro_action:partial_specialized_route',
    `covered_intents:${actionableEntries.length}`,
    `clauses:${shape.clauseCount}`
  ], source, {
    index: -1,
    order: -1,
    source: 'structural',
    metadata: {
      routeClass: 'partial_specialized_macro_action',
      utteranceKind: 'action_declaration',
      scope: 'macro',
      actionPacing: 'macro_resolution',
      clauseCount: shape.clauseCount,
      matchedIntentCount: actionableEntries.length,
      structuralConnector: shape.structuralConnector,
      actionPacingHint: 'Input is a multi-clause action where specialized resolver matches cover only part of the utterance. Route the whole utterance to action adjudication instead of letting a narrow resolver consume it.'
    }
  });
  return [protectedEntry, ...entries];
}

function buildFallbackIntentFromUnmatchedInput(source, fallbackIntent = 'player_action') {
  const actionDeclaration = classifyUnmatchedPlayerInput(source);
  const preferredIntent = (!fallbackIntent || fallbackIntent === 'player_action') && actionDeclaration.intent !== 'player_action'
    ? actionDeclaration.intent
    : fallbackIntent;
  return intent(preferredIntent, actionDeclaration.confidence, [
    'fallback',
    `utterance:${actionDeclaration.utteranceKind}`,
    `scope:${actionDeclaration.scope}`
  ], source, {
    source: 'fallback',
    metadata: actionDeclaration
  });
}

// Fallback routing is structural, not setting-specific: declarations become actions; information requests stay non-mutating.
function classifyUnmatchedPlayerInput(source) {
  const text = String(source || '').trim();
  const delegatedQuestionAction = isDelegatedQuestionAction(text);
  const informationRequest = isInformationRequest(text) && !delegatedQuestionAction;
  const combatDeclaration = !informationRequest && isCombatActionDeclaration(text);
  const shape = classifyInputShape(text);
  const macro = !informationRequest && shape.macro;
  return {
    intent: informationRequest ? 'information_query' : (combatDeclaration ? 'combat_action' : 'player_action'),
    utteranceKind: informationRequest ? 'information_request' : 'action_declaration',
    scope: informationRequest ? 'lookup' : (macro ? 'macro' : 'single'),
    actionPacing: informationRequest ? 'none' : (macro ? 'macro_resolution' : 'single_resolution'),
    routeClass: combatDeclaration ? 'inferred_combat_action' : 'unmatched_player_input',
    confidence: informationRequest ? 0.62 : (combatDeclaration ? 0.66 : (macro ? 0.62 : 0.45)),
    clauseCount: shape.clauseCount,
    structuralConnector: shape.structuralConnector,
    delegatedQuestionAction,
    combatDeclaration,
    actionPacingHint: informationRequest
      ? 'Input is an unmatched information request. Answer from available context/retrieval; do not adjudicate it as a world-changing action.'
      : combatDeclaration
      ? 'Input is a combat declaration without a pre-selected combat UI action. Prepare or enter battle first; do not execute a deterministic combat action until actor, target, and battle context exist.'
      : macro
      ? 'Input is an unmatched multi-clause player action declaration. Resolve it as one meaningful batch outcome this turn; do not expand it into a slow menu, travel chain, or task list.'
      : 'Input is an unmatched player action declaration. Resolve the attempted action directly unless required facts are missing.'
  };
}

function isCombatActionDeclaration(text) {
  const source = String(text || '').trim();
  if (!source) return false;
  const combatVerb = /(?:攻击|袭击|进攻|迎战|开战|交战|战斗|斗法|殴打|击打|击杀|杀死|猎杀|斩杀|砍|斩|刺|射杀|射击|打倒|干掉|打(?!听|扫|坐|探|理|造|磨|点|开|算|扰|招呼|工|水|饭))/u.test(source);
  if (!combatVerb) return false;
  const hostileTarget = /(?:敌|妖|魔|怪|兽|守卫|强盗|盗匪|刺客|杀手|狼|虎|蛇|僵尸|亡灵|恶徒|boss|monster|enemy)/iu.test(source);
  const countedTarget = /(?:\d+|[一二两三四五六七八九十百]+)\s*(?:只|个|头|名|位|群|队)/u.test(source);
  return hostileTarget || countedTarget || /(?:开战|交战|战斗|斗法)/u.test(source);
}

function classifyInputShape(source) {
  const text = String(source || '').trim();
  const punctuationClauseCount = text
    .split(/[，,、；;。.!！\n]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
  const connectorClauseCount = text
    .split(/(?:然后|接着|同时|并且|以及|顺便|再|最后)/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
  const structuralConnector = /(?:然后|接着|同时|并且|以及|顺便|再|最后)/u.test(text);
  const clauseCount = Math.max(punctuationClauseCount, connectorClauseCount);
  return {
    clauseCount,
    structuralConnector,
    macro: clauseCount >= 2 || structuralConnector
  };
}

function isInformationRequest(text) {
  const source = String(text || '').trim();
  if (!source) return false;
  return /[?？]\s*$/.test(source)
    || /^(?:请)?(?:告诉我|解释|说明|查询|查一下|检索|搜索|帮我查|帮我看看)/u.test(source)
    || /(?:是什么|为什么|怎么回事|如何|哪[个里一]?|谁|多少|是否|能不能|可不可以|有没有|知道吗|记得吗|了解吗)/u.test(source);
}

function isDelegatedQuestionAction(text) {
  const source = String(text || '').trim();
  if (!source) return false;
  return /^(?:我|玩家|主角|角色|本角色|自己|自身).{0,16}(?:问|询问|请教|打听|套话|审问|盘问|请求|命令|说|告诉|交代)/u.test(source);
}

function intent(intentId, confidence, reasons, sourceText, extra = {}) {
  return {
    intent: intentId,
    confidence,
    reasons,
    sourceText,
    ...extra
  };
}

async function executeResolverCandidate({ loop, candidate, phase, state, request }) {
  if (!loop.toolManager?.getTool || !loop.toolManager?.executeTool) {
    throw dependencyError('Resolver candidate execution requires toolManager');
  }
  const tool = loop.toolManager.getTool(candidate.toolId);
  if (request.dryRun && tool.mutatesState && candidate.input?.dryRun !== true) {
    return {
      status: 'planned',
      reason: 'dry_run_mutating_resolver_not_executed',
      tool: publicTool(tool)
    };
  }
  if (request.dryRun && !dryRunAllowsExternalApi(request) && toolMayUseExternalApi(tool)) {
    return {
      status: 'planned',
      reason: 'dry_run_external_api_not_executed',
      tool: publicTool(tool)
    };
  }
  loop.emitProgress({
    type: 'resolver_started',
    status: 'running',
    turnId: state.turnId,
    chatSessionId: request.chatSessionId,
    phaseId: phase.id,
    toolId: candidate.toolId,
    routerItemId: routerReviewResolverItemId(state.turnId, phase.id, candidate),
    routerItem: routerReviewItemFromResolverCandidate({
      turnId: state.turnId,
      chatSessionId: request.chatSessionId,
      phase,
      candidate,
      status: 'running'
    }),
    title: candidate.toolId,
    progressLabel: `正在调用${humanizeProgressSubject(candidate.toolId)}...`
  });
  const result = await loop.toolManager.executeTool(candidate.toolId, candidate.input || {}, undefined, {
    ...request.toolContext,
    agentLoop: {
      turnId: state.turnId,
      phaseId: phase.id,
      dryRun: request.dryRun,
      resolverCandidate: true
    }
  });
  const normalizedOutput = normalizeResolverExecutionOutput(candidate, result.output);
  loop.emitProgress({
    type: 'resolver_finished',
    status: 'success',
    turnId: state.turnId,
    chatSessionId: request.chatSessionId,
    phaseId: phase.id,
    toolId: candidate.toolId,
    routerItemId: routerReviewResolverItemId(state.turnId, phase.id, candidate),
    routerItem: routerReviewItemFromResolverCandidate({
      turnId: state.turnId,
      chatSessionId: request.chatSessionId,
      phase,
      candidate,
      status: 'success'
    }),
    title: candidate.toolId,
    progressLabel: `${humanizeProgressSubject(candidate.toolId)}已完成`
  });
  return {
    status: 'success',
    tool: publicTool(tool),
    output: normalizedOutput,
    trace: result.trace
  };
}

function normalizeResolverExecutionOutput(candidate = {}, output = {}) {
  if (candidate.toolId !== 'system.map_relationships.find_scene_path') return output;
  if (output?.found !== false) return output;
  const missingMapIds = Array.isArray(output.missingMapIds) ? output.missingMapIds : [];
  return {
    ...output,
    status: 'path_unavailable',
    resolverFallback: 'report_only',
    reason: missingMapIds.length > 0 ? 'missing_map_node' : 'no_scene_path',
    playerMessage: missingMapIds.length > 0
      ? `地图节点不存在或未挂载：${missingMapIds.join(', ')}。`
      : '当前地图关系中找不到可通行路线。'
  };
}

function buildResolverCandidates({ intent: routedIntent, request, phase, text, actorControl }) {
  const intentEntries = normalizeRouterIntentEntries(routedIntent);
  const routerPolicy = mergeRouterPolicies(
    routedIntent?.routerPolicy,
    phase.config?.routerPolicy || phase.config?.router || phase.config?.intentRouter,
    request.routerPolicy || request.router || request.intentRouter
  );
  const baseInput = {
    chatSessionId: request.chatSessionId,
    sceneId: request.sceneId,
    sourceText: text,
    text,
    dryRun: request.dryRun !== false,
    includeAbsurdity: request.includeAbsurdity,
    useAbsurdityLlm: request.useAbsurdityLlm,
    useAbsurdityExplanationLlm: request.useAbsurdityExplanationLlm,
    forceAbsurdityExplanation: request.forceAbsurdityExplanation,
    explainAbsurdityOnDryRun: request.explainAbsurdityOnDryRun,
    absurdityRules: request.absurdityRules,
    ...resolverPathInput({ phase, request })
  };
  const configured = phase.config?.resolverTools && typeof phase.config.resolverTools === 'object'
    ? phase.config.resolverTools
    : {};
  const allowedToolIds = resolveRouterAllowedToolIds({ phase, request, routerPolicy });
  const blockedToolIds = resolveRouterBlockedToolIds({ phase, request, routerPolicy });
  const allowUnlisted = phase.config?.allowUnlistedResolverTools === true
    || phase.config?.allowAnyResolverTool === true
    || request.allowUnlistedResolverTools === true
    || routerPolicy?.allowUnlistedResolverTools === true;
  const candidates = [];
  const blockedCandidates = [];
  const seenToolIds = new Set();
  let fallbackCandidate;
  let forceFallbackCandidate = false;

  for (const [index, intentEntry] of intentEntries.entries()) {
    const intentId = intentEntry.intent || 'player_action';
    const toolId = configured[intentId] || DEFAULT_RESOLVER_TOOL_BY_INTENT[intentId];
    if (!toolId) continue;
    const routerIntent = resolverRouterIntentInput(intentEntry);
    const actionPacing = resolverActionPacingInput(intentEntry);
    const input = buildResolverCandidateInput({
      toolId,
      baseInput,
      phase,
      request,
      actorControl,
      routerIntent,
      actionPacing,
      resolverInput: phase.config?.resolverInput
    });
    const candidate = {
      intent: intentId,
      toolId,
      order: index + 1,
      sourceIndex: Number.isFinite(Number(intentEntry.index)) ? Number(intentEntry.index) : undefined,
      keyword: intentEntry.keyword,
      confidence: intentEntry.confidence,
      input,
      actorControl: actorControl ? {
        context: actorControl.context,
        inputEnvelope: actorControl.inputEnvelope
      } : undefined,
      execute: Boolean(phase.config?.autoExecuteResolvers),
      playerDecisionLoop: toolId === DEFAULT_ACTION_RESOLVER_TOOL_ID,
      reason: `intent:${intentId}`
    };
	    if (blockedToolIds.includes(toolId)) {
	      blockedCandidates.push({
        ...candidate,
        blocked: true,
        reason: `router_tool_blocked:${toolId}`
      });
	      continue;
	    }
	    const readiness = validateResolverCandidateReadiness(candidate);
	    if (!readiness.ready) {
	      blockedCandidates.push({
	        ...candidate,
	        blocked: true,
	        reason: readiness.reason,
	        missingFields: readiness.missingFields,
	        fallbackRecommended: readiness.fallbackRecommended
	      });
	      if (index === 0 && readiness.fallbackRecommended) forceFallbackCandidate = true;
	      continue;
	    }
	    if (!allowUnlisted && allowedToolIds.length > 0 && !allowedToolIds.includes(toolId)) {
      blockedCandidates.push({
        ...candidate,
        blocked: true,
        reason: `router_tool_not_allowed:${toolId}`
      });
      continue;
    }
    if (seenToolIds.has(toolId) && phase.config?.dedupeResolverTools !== false) continue;
    seenToolIds.add(toolId);
    candidates.push(candidate);
  }

  if (candidates.length === 0 || forceFallbackCandidate) {
    const fallback = buildRouterFallbackCandidate({
      intentEntries,
      routedIntent,
      phase,
      request,
      baseInput,
      actorControl,
      blockedCandidates,
      allowedToolIds,
      blockedToolIds,
      allowUnlisted
    });
    if (fallback) {
      if (fallback.blocked) {
        blockedCandidates.push(fallback);
      } else {
        fallbackCandidate = fallback;
        if (forceFallbackCandidate) candidates.unshift(fallback);
        else candidates.push(fallback);
      }
    }
  }

  return {
    allowedToolIds,
    blockedToolIds,
    allowUnlisted,
    candidates,
    blockedCandidates,
    fallbackCandidate,
    orderedIntents: intentEntries,
    blockedIntents: Array.isArray(routedIntent?.blockedIntents) ? routedIntent.blockedIntents : [],
    interceptedIntents: Array.isArray(routedIntent?.interceptedIntents) ? routedIntent.interceptedIntents : [],
    policy: {
      noLlm: true,
      allowedToolIds,
      blockedToolIds,
      allowUnlisted,
      ordering: 'textual_intent_order',
      routerPolicy: routerPolicySummary(routerPolicy)
    }
  };
}

function resolverRouterIntentInput(intentEntry = {}) {
  return {
    intent: intentEntry.intent,
    originalIntent: intentEntry.originalIntent,
    confidence: intentEntry.confidence,
    keyword: intentEntry.keyword,
    reasons: Array.isArray(intentEntry.reasons) ? [...intentEntry.reasons] : [],
    metadata: intentEntry.metadata && typeof intentEntry.metadata === 'object'
      ? { ...intentEntry.metadata }
      : {}
  };
}

function resolverActionPacingInput(intentEntry = {}) {
  const metadata = intentEntry.metadata && typeof intentEntry.metadata === 'object'
    ? intentEntry.metadata
    : {};
  if (!metadata.actionPacing) return undefined;
  return {
    mode: metadata.actionPacing,
    routeClass: metadata.routeClass || 'player_action',
    scope: metadata.scope,
    clauseCount: metadata.clauseCount,
    hint: metadata.actionPacingHint || 'Resolve this attempted action directly this turn.'
  };
}

function buildResolverCandidateInput({
  toolId,
  baseInput,
  phase,
  request,
  actorControl,
  routerIntent,
  actionPacing,
  resolverInput
} = {}) {
  const configuredInput = resolverInput && typeof resolverInput === 'object'
    ? resolverInput
    : {};
  const useLlmInput = resolverUseLlmInput({ phase, request });
  const commonInput = {
    ...(baseInput || {}),
    ...actorControlResolverInput(actorControl),
    ...configuredInput
  };

  if (toolId === DEFAULT_ACTION_RESOLVER_TOOL_ID) {
    return {
      ...omitResolverInputKeys(commonInput, PATH_RESOLVER_ONLY_INPUT_KEYS),
      routerIntent,
      ...(actionPacing ? { actionPacing } : {}),
      semanticWritePlanning: request.semanticWritePlanning !== false && phase.config?.semanticWritePlanning !== false,
      useSemanticWriteLlm: resolveSemanticWriteLlmInput({ phase, request }),
      allowExternalApiInDryRun: request.allowExternalApiInDryRun === true,
      ...useLlmInput
    };
  }

  if (toolId === 'system.map_relationships.find_scene_path') {
    return pickResolverInput({
      ...commonInput,
      ...resolverPathInput({ phase, request })
    }, MAP_SCENE_PATH_RESOLVER_INPUT_KEYS);
  }

  if (toolId === 'system.persuasion.resolve') {
    return pickResolverInput({
      ...commonInput,
      ...useLlmInput
    }, PERSUASION_RESOLVER_INPUT_KEYS);
  }

  if (toolId === 'system.combat.resolve_action') {
    return pickResolverInput(commonInput, COMBAT_ACTION_RESOLVER_INPUT_KEYS);
  }

  if (toolId === 'system.combat.prepare_battle') {
    return pickResolverInput({
      ...commonInput,
      ...useLlmInput
    }, COMBAT_PREPARE_RESOLVER_INPUT_KEYS);
  }

  if (toolId === 'system.combat.start_battle') {
    return pickResolverInput({
      ...commonInput,
      ...useLlmInput
    }, COMBAT_START_RESOLVER_INPUT_KEYS);
  }

  if (toolId === 'system.combat.end_battle') {
    return pickResolverInput({
      ...commonInput,
      ...useLlmInput
    }, COMBAT_END_RESOLVER_INPUT_KEYS);
  }

  if (toolId === 'system.npc_behavior.resolve') {
    return pickResolverInput({
      ...commonInput,
      ...useLlmInput
    }, BEHAVIOR_RESOLVER_INPUT_KEYS);
  }

  if (toolId === 'system.environment_behavior.resolve') {
    return pickResolverInput({
      ...commonInput,
      ...useLlmInput
    }, ENVIRONMENT_BEHAVIOR_RESOLVER_INPUT_KEYS);
  }

  return {
    ...commonInput,
    ...useLlmInput
  };
}

function actorControlResolverInput(actorControl = {}) {
  const context = actorControl?.context && typeof actorControl.context === 'object'
    ? actorControl.context
    : {};
  const actorId = firstNonEmptyValue(
    context.controlledActorId,
    context.embodiedActorId,
    context.viewpointActorId
  );
  const actorName = firstNonEmptyValue(
    context.controlledActorTitle,
    context.embodiedActorTitle,
    context.viewpointActorTitle
  );
  return {
    ...(actorId ? {
      actorId,
      playerId: actorId,
      controlledActorId: actorId,
      protagonistActorId: actorId
    } : {}),
    ...(actorName ? {
      actorName,
      playerName: actorName
    } : {})
  };
}

function pickResolverInput(input = {}, allowedKeys = []) {
  const output = {};
  for (const key of allowedKeys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

function omitResolverInputKeys(input = {}, omittedKeys = []) {
  const omitted = new Set(omittedKeys);
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!omitted.has(key)) output[key] = value;
  }
  return output;
}

function resolverPathInput({ phase, request } = {}) {
  const source = {
    ...(request && typeof request === 'object' ? request : {}),
    ...(request?.movement && typeof request.movement === 'object' ? request.movement : {}),
    ...(request?.path && typeof request.path === 'object' ? request.path : {}),
    ...(request?.pathfinding && typeof request.pathfinding === 'object' ? request.pathfinding : {}),
    ...(phase?.config?.resolverInput && typeof phase.config.resolverInput === 'object' ? phase.config.resolverInput : {}),
    ...(phase?.config?.pathInput && typeof phase.config.pathInput === 'object' ? phase.config.pathInput : {}),
    ...(phase?.config?.movementInput && typeof phase.config.movementInput === 'object' ? phase.config.movementInput : {})
  };
  const output = {};
  for (const key of [
    'startMapId',
    'targetMapId',
    'fromMapId',
    'toMapId',
    'startNodeId',
    'targetNodeId',
    'from',
    'to',
    'includeGlobal',
    'includeMountedMaps',
    'includeStructuredState',
    'includeParentLinks',
    'includeInactive',
    'includeBlocked',
    'includeHidden',
    'maxDepth',
    'relationType',
    'relationTypes',
    'travelMode',
    'travelModes',
    'includeIncoming',
    'includeOutgoing',
    'maxDifficulty',
    'tags'
  ]) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  if (!hasAnyNonEmptyValue(output, ['startMapId', 'fromMapId', 'startNodeId', 'from'])) {
    const start = firstNonEmptyValue(source.currentMapId, source.activeMapId, source.currentLocationId, source.activeLocationId);
    if (start !== undefined) output.startMapId = start;
  }
  if (!hasAnyNonEmptyValue(output, ['targetMapId', 'toMapId', 'targetNodeId', 'to'])) {
    const target = firstNonEmptyValue(source.destinationMapId, source.destinationLocationId, source.targetLocationId);
    if (target !== undefined) output.targetMapId = target;
  }
  return output;
}

function validateResolverCandidateReadiness(candidate = {}) {
  if (candidate.toolId === 'system.map_relationships.find_scene_path') {
    const input = candidate.input || {};
    const hasStart = hasAnyNonEmptyValue(input, ['startMapId', 'fromMapId', 'startNodeId', 'from']);
    const hasTarget = hasAnyNonEmptyValue(input, ['targetMapId', 'toMapId', 'targetNodeId', 'to']);
    if (!hasStart || !hasTarget) {
      return {
        ready: false,
        reason: 'router_tool_missing_required_path_endpoint:system.map_relationships.find_scene_path',
        missingFields: hasStart
          ? ['targetMapId|toMapId|targetNodeId|to']
          : ['startMapId|fromMapId|startNodeId|from', 'targetMapId|toMapId|targetNodeId|to'],
        fallbackRecommended: true
      };
    }
  }
  return { ready: true };
}

function hasAnyNonEmptyValue(source = {}, keys = []) {
  return keys.some((key) => {
    const value = source[key];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (String(value).trim() !== '') return value;
  }
  return undefined;
}

function resolverUseLlmInput({ phase, request } = {}) {
  const value = phase?.config?.resolverInput?.useLlm
    ?? phase?.config?.useLlmResolvers
    ?? phase?.config?.useLlmResolver
    ?? phase?.config?.resolverUseLlm
    ?? request?.useLlmResolvers
    ?? request?.useLlmResolver
    ?? request?.useLlmAdjudication
    ?? request?.useLlmActionResolver;
  return value === undefined ? {} : { useLlm: Boolean(value) };
}

function resolveSemanticWriteLlmInput({ phase, request } = {}) {
  if (request.useSemanticWriteLlm !== undefined) return request.useSemanticWriteLlm === true;
  if (phase.config?.useSemanticWriteLlm !== undefined) return phase.config.useSemanticWriteLlm === true;
  if (request.dryRun && request.allowExternalApiInDryRun !== true) return false;
  return request.semanticWritePlanning !== false && phase.config?.semanticWritePlanning !== false;
}

function buildRouterFallbackCandidate({
  intentEntries,
  routedIntent,
  phase,
  request,
  baseInput,
  actorControl,
  blockedCandidates,
  allowedToolIds,
  blockedToolIds,
  allowUnlisted
}) {
  const fallbackEnabled = phase.config?.fallbackToActionResolver !== false
    && phase.config?.fallbackToAction !== false
    && request.fallbackToActionResolver !== false
    && request.fallbackToAction !== false;
  if (!fallbackEnabled) return undefined;

  const primary = intentEntries[0] || routedIntent || {};
  const originalIntent = primary.originalIntent || routedIntent?.originalIntent || primary.intent;
  const effectiveIntent = originalIntent || primary.intent;
  const noFallbackIntents = compactUnique([
    ...DEFAULT_ROUTER_NO_FALLBACK_INTENTS,
    ...normalizeStringArray(phase.config?.noFallbackIntents || phase.config?.noActionFallbackIntents),
    ...normalizeStringArray(request.noFallbackIntents || request.noActionFallbackIntents)
  ]);
  if (noFallbackIntents.includes(effectiveIntent) || noFallbackIntents.includes(primary.intent)) {
    return undefined;
  }

  const fallbackToolId = normalizeOptionalText(
    phase.config?.fallbackResolverToolId
      || phase.config?.fallbackToolId
      || request.fallbackResolverToolId
      || request.fallbackToolId
  ) || DEFAULT_ROUTER_FALLBACK_TOOL_ID;
  const routerIntent = resolverRouterIntentInput(primary);
  const actionPacing = resolverActionPacingInput(primary);
  const input = buildResolverCandidateInput({
    toolId: fallbackToolId,
    baseInput,
    phase,
    request,
    actorControl,
    routerIntent,
    actionPacing,
    resolverInput: phase.config?.fallbackResolverInput || phase.config?.resolverInput
  });
	  const candidate = {
	    intent: 'player_action',
	    originalIntent: effectiveIntent,
	    toolId: fallbackToolId,
    order: intentEntries.length + 1,
    sourceIndex: Number.isFinite(Number(primary.index)) ? Number(primary.index) : undefined,
    keyword: primary.keyword,
    confidence: Math.min(Number(primary.confidence || 0.45), 0.45),
	    input,
    actorControl: actorControl ? {
      context: actorControl.context,
      inputEnvelope: actorControl.inputEnvelope
    } : undefined,
    execute: Boolean(phase.config?.autoExecuteResolvers),
    playerDecisionLoop: fallbackToolId === DEFAULT_ACTION_RESOLVER_TOOL_ID,
    fallback: true,
    skippedCandidateCount: blockedCandidates.length,
    skippedIntents: compactUnique([
      ...intentEntries.map((entry) => entry.intent),
      ...blockedCandidates.map((candidate) => candidate.intent)
    ]),
    reason: blockedCandidates.length > 0
      ? 'router_fallback:all_specialized_candidates_blocked'
      : 'router_fallback:no_specialized_candidate'
  };

  if (blockedToolIds.includes(fallbackToolId)) {
    return {
      ...candidate,
      blocked: true,
      reason: `router_fallback_tool_blocked:${fallbackToolId}`
    };
  }
  if (!allowUnlisted && allowedToolIds.length > 0 && !allowedToolIds.includes(fallbackToolId)) {
    return {
      ...candidate,
      blocked: true,
      reason: `router_fallback_tool_not_allowed:${fallbackToolId}`
    };
  }
  return candidate;
}

function normalizeRouterIntentEntries(routedIntent = {}) {
  const ordered = Array.isArray(routedIntent?.orderedIntents) && routedIntent.orderedIntents.length > 0
    ? routedIntent.orderedIntents
    : [routedIntent];
  return ordered
    .filter((entry) => entry && typeof entry === 'object' && entry.intent)
    .map((entry, index) => ({
      ...entry,
      sequence: Number.isFinite(Number(entry.sequence)) ? Number(entry.sequence) : index + 1
    }))
    .sort((a, b) => {
      const aIndex = Number.isFinite(Number(a.index)) ? Number(a.index) : Number.MAX_SAFE_INTEGER;
      const bIndex = Number.isFinite(Number(b.index)) ? Number(b.index) : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex || a.sequence - b.sequence || String(a.intent).localeCompare(String(b.intent));
    });
}

function resolveRouterAllowedToolIds({ phase, request, routerPolicy }) {
  const configured = routerPolicy?.allowedResolverToolIds?.length
    ? routerPolicy.allowedResolverToolIds
    : (
        phase.config?.allowedResolverToolIds
        ?? phase.config?.allowedRouterToolIds
        ?? phase.config?.routerAllowedToolIds
        ?? request.allowedResolverToolIds
        ?? request.allowedRouterToolIds
        ?? request.routerAllowedToolIds
      );
  const base = configured === undefined
    ? [...DEFAULT_ROUTER_ALLOWED_TOOL_IDS]
    : normalizeStringArray(configured);
  const additional = normalizeStringArray(
    routerPolicy?.additionalResolverToolIds?.length
      ? routerPolicy.additionalResolverToolIds
      : (
          phase.config?.additionalResolverToolIds
          ?? phase.config?.additionalRouterToolIds
          ?? request.additionalResolverToolIds
          ?? request.additionalRouterToolIds
        )
  );
  return compactUnique([...base, ...additional]);
}

function resolveRouterBlockedToolIds({ phase, request, routerPolicy }) {
  return compactUnique([
    ...(routerPolicy?.blockedResolverToolIds || []),
    ...normalizeStringArray(
      phase.config?.blockedResolverToolIds
        ?? phase.config?.blockedRouterToolIds
        ?? phase.config?.routerBlockedToolIds
    ),
    ...normalizeStringArray(
      request.blockedResolverToolIds
        ?? request.blockedRouterToolIds
        ?? request.routerBlockedToolIds
    )
  ]);
}

function buildNarrativePackage({ phase, profile, request, state }) {
  const contextText = state.contextPlan?.promptContext
    || state.contextPlan?.output?.promptContext
    || state.baseline?.dialogue
    || state.minimalContext?.dialogue
    || '';
  const actionText = state.input?.latestUserMessage || request.text || '';
  const actorControlText = state.actorControl?.promptContext || '';
  const actorTaggedText = state.actorControl?.inputEnvelope?.actorTaggedText || state.input?.actorTaggedMessage || actionText;
  const worldbookText = renderWorldbookPromptContext(state.worldbook);
  const guidanceText = JSON.stringify(state.ragGuidance?.guidance || emptyRagGuidance(), null, 2);
  const resolverGrounding = buildNarrativeResolverGrounding(state);
  const systemPrompt = [
    phase.promptTemplate || DEFAULT_NARRATIVE_PROMPT,
    '',
    '输出必须是纯文本，优先使用“地图名：... / NPC名字：... / 旁白：...”行格式。',
    '必须遵守 Resolver Grounding：如果工具调用失败或尚未写库，不得把结果写成已经成功；如果 automatic_progress 已成功写库，则可以写成直接成功且无需掷骰。',
    '',
    actorControlText
  ].join('\n');
  const userPrompt = [
    '# Action Execution Policy',
    [
      'Treat the current input as an action to resolve now unless it is explicitly asking for advice/options.',
      'Do not replace a concrete player action with a menu of possible actions.',
      'For broad but executable actions, pick a plausible abstraction level and summarize the completed attempt, checks, consequences, gains, costs, and state changes.',
      'Narrative order should be: what happened / what changed / one open-ended next-step question.',
      'Clarify only when a required target/resource/irreversible choice is genuinely missing.',
      'Do not accept claimed results as facts without adjudication or tool output.'
    ].join('\n'),
    '',
    '# Current Input',
    actorTaggedText || actionText || '(empty)',
    '',
    '# Raw Input',
    actionText || '(empty)',
    '',
    '# Actor Control Context',
    actorControlText || '(no actor control context)',
    '',
    '# Routed Intent',
    JSON.stringify(state.intent || {}, null, 2),
    '',
    '# Resolver Grounding',
    JSON.stringify(resolverGrounding, null, 2),
    '',
    '# Context',
    contextText || '(no context)',
    '',
    '# Worldbook Activated Snippets',
    worldbookText || '(no activated worldbook snippets)',
    '',
    '# RAG Guidance',
    guidanceText,
    '',
    '# Adjudication / Impact Draft',
    JSON.stringify({
      adjudication: state.adjudication,
      impactPlan: state.impactPlan,
      impactRoutes: state.impactRoutes,
      npcReaction: state.npcReaction,
      environmentReaction: state.environmentReaction
    }, null, 2)
  ].join('\n');
  const sceneName = inferNarrativeDraftSceneName({ phase, request, state });
  const sceneDraft = phase.config?.draftScene || defaultSceneDraftFromResolverGrounding(resolverGrounding);
  const npcDraft = phase.config?.draftNpcs || '暂无新的直接对话。';
  const narratorDraft = phase.config?.draftNarrator || defaultNarratorDraftFromResolverGrounding(resolverGrounding);
  const draft = [
    `${sceneName}：${sceneDraft}`,
    `NPC：${npcDraft}`,
    `旁白：${narratorDraft}`
  ].join('\n');
  return {
    profileId: profile.id,
    useLlm: shouldUseLlmNarrative({ phase, profile, request }),
    resolverGrounding,
    systemPrompt,
    userPrompt,
    draft,
    layers: {
      scene: phase.config?.draftScene || sceneDraft,
      npcs: phase.config?.draftNpcs || '',
      narrator: phase.config?.draftNarrator || narratorDraft
    }
  };
}

function buildNarrativeResolverGrounding(state = {}) {
  const output = normalizePlainObject(state.adjudication?.resolverResult);
  const resolution = normalizePlainObject(output.currentResolution || output.finalResolution || output.resolution || output);
  const apply = normalizePlainObject(resolution.apply || resolution.application?.apply || resolution);
  const summary = normalizePlainObject(output.currentSummary || resolution.currentSummary);
  const plan = normalizePlainObject(resolution.plan || apply.plan);
  const appliedToolCalls = normalizeList(summary.appliedToolCalls || apply.appliedToolCalls);
  const failedToolCalls = normalizeList(summary.failedToolCalls || apply.failedToolCalls);
  const skippedToolCalls = normalizeList(apply.skippedToolCalls);
  const plannedDefinitionFacts = extractNarrativePlannedDefinitionFacts(normalizeList(plan.proposals || apply.plan?.proposals));
  const combatAction = normalizePlainObject(output.actionResult || output);
  const combatAttack = normalizePlainObject(combatAction.attack);
  const combatTargetState = extractCombatTargetSettlementState(combatAction, output);
  const combatDiceResults = combatAttack && Object.keys(combatAttack).length
    ? [stripUndefined({
        checkId: combatAction.action?.actionId || combatAction.actionId,
        outcome: combatAttack.outcome,
        success: combatAttack.hit ?? combatAttack.success,
        total: combatAttack.total,
        threshold: combatAttack.input?.successThreshold ?? combatAttack.output?.successThreshold,
        source: 'combat.resolve_action'
      })]
    : [];
  const diceResults = normalizeList(summary.diceResults || apply.diceResults || combatDiceResults);
  const status = normalizeOptionalText(summary.status || resolution.status || apply.status || output.resolutionStatus || output.status);
  const resolutionMode = normalizeOptionalText(
    summary.resolutionMode
    || plan.metadata?.resolutionMode
    || apply.plan?.metadata?.resolutionMode
    || (output.endBattle ? 'combat_end' : '')
    || (combatAction.action ? 'combat_action' : '')
    || (output.mode === 'active_battle_action' ? 'combat_action' : '')
    || (output.status === 'prepared' || output.battle || output.battleInput ? 'combat_start' : '')
  );
  const combatBattleGrounding = extractNarrativeCombatBattleGrounding(output, { combatAction, resolutionMode });
  const diceSucceeded = diceResults.length > 0
    ? diceResults.some((result) => Boolean(result?.success || result?.criticalSuccess || /success/i.test(String(result?.outcome || ''))))
    : undefined;
  const combatStateWritten = Boolean(
    combatAction.settlement && combatAction.settlement.skipped !== true
    || output.actionResult?.settlement && output.actionResult.settlement.skipped !== true
    || output.rewardApplication?.status === 'applied'
    || output.endBattle?.rewardApplication?.status === 'applied'
    || combatBattleGrounding.stateWritten
  );
  const successStatus = ['success', 'partial_failure', 'prepared', 'resolved', 'ended', 'active'].includes(status)
    || (combatBattleGrounding.stateWritten && !combatBattleGrounding.blocked);
  const success = (diceSucceeded !== undefined ? diceSucceeded : successStatus)
    && failedToolCalls.length === 0;
  const writtenFacts = extractNarrativeWrittenFacts(normalizeList(apply.appliedToolCalls || resolution.apply?.appliedToolCalls));
  mergeExistingSceneNpcsIntoWrittenFacts(writtenFacts, { state, output, resolution });
  mergeExistingSceneMapsIntoWrittenFacts(writtenFacts, { state, output, resolution });
  mergeCombatRewardsIntoWrittenFacts(writtenFacts, normalizeList(output.rewardApplication?.rewards || output.endBattle?.rewardApplication?.rewards), {
    rewardStatus: output.rewardApplication?.status || output.endBattle?.rewardApplication?.status
  });
  const contextFocus = extractNarrativeContextFocus(state);
  const movement = extractNarrativeMovementGrounding(output);
  return stripUndefined({
    status,
    loopStatus: normalizeOptionalText(output.status),
    resolutionMode,
    dicePolicy: normalizeOptionalText(summary.dicePolicy || plan.metadata?.dicePolicy || apply.plan?.metadata?.dicePolicy),
    success,
    diceRolled: diceResults.length > 0,
    diceCount: diceResults.length,
    diceResults: diceResults.map((result) => stripUndefined({
      checkId: result.checkId || result.id,
      outcome: result.outcome || result.output?.outcome,
      success: result.success ?? result.output?.success,
      total: result.total ?? result.output?.total,
      threshold: result.threshold ?? result.input?.successThreshold ?? result.output?.successThreshold
    })),
    appliedToolCallCount: Number(summary.appliedToolCallCount ?? appliedToolCalls.length) + (combatStateWritten ? 1 : 0),
    failedToolCallCount: Number(summary.failedToolCallCount ?? failedToolCalls.length),
    skippedToolCallCount: Number(summary.skippedToolCallCount ?? skippedToolCalls.length),
    appliedToolCalls: appliedToolCalls.map((call) => ({ id: call.id, tool: call.tool })),
    writtenFacts,
    plannedDefinitionFacts,
    contextFocus,
    movement,
    failedToolCalls: failedToolCalls.map((call) => ({
      id: call.id,
      tool: call.tool,
      error: call.error ? { name: call.error.name, message: call.error.message } : undefined
    })),
    combat: combatBattleGrounding.present || combatAction.action || output.mode === 'active_battle_action' || output.endBattle ? stripUndefined({
      ...combatBattleGrounding,
      mode: output.mode || resolutionMode || combatBattleGrounding.mode,
      actorId: combatAction.action?.actorId || output.actorId,
      targetId: combatAction.action?.targetIds?.[0] || output.targetId,
      targetName: output.targetName,
      hit: combatAttack.hit,
      attackTotal: combatAttack.total,
      targetHp: combatTargetState.hp,
      targetDefeated: combatTargetState.defeated,
      targetConditions: combatTargetState.conditions,
      damage: normalizeList(combatAction.damage || output.actionResult?.damage).map((item) => stripUndefined({
        type: item.type,
        amount: item.amount
      })),
      battleStatus: output.endBattle?.battle?.data?.status || output.battle?.data?.status || combatBattleGrounding.battleStatus,
      rewardStatus: output.rewardApplication?.status || output.endBattle?.rewardApplication?.status,
      rewards: normalizeList(output.rewardApplication?.rewards || output.endBattle?.rewardApplication?.rewards).map((item) => stripUndefined({
        id: item.id,
        name: item.name,
        quantity: item.quantity
      }))
    }) : undefined,
    narrationPolicy: success
      ? (resolutionMode === 'automatic_progress'
          ? 'Narrate this as direct low-risk progress already written to state. Do not mention a dice roll.'
          : resolutionMode === 'combat_action'
          ? 'Narrate only the combat action that was numerically resolved. Use hit/miss and written HP/status changes from resolver output; do not invent victory, loot, or deaths unless endBattle/rewardApplication is present.'
          : resolutionMode === 'combat_end'
          ? 'Narrate the battle ending and rewards only if endBattle and rewardApplication show they were applied.'
          : 'Narrate according to successful resolver output.')
      : (status
          ? 'Do not narrate the attempted action as successful. Explain that it was not successfully settled or that the state write failed.'
          : 'No executed resolver result is available; keep narration conservative.'),
    source: 'state.adjudication.resolverResult'
  });
}

function extractNarrativeContextFocus(state = {}) {
  const candidates = [
    state.contextPlan?.turnFocus,
    state.contextPlan?.output?.turnFocus,
    state.contextPlan?.contextPlanner?.turnFocus,
    state.contextPlan?.contextPlanner?.output?.turnFocus,
    state.contextPlan?.output?.contextPlanner?.turnFocus,
    state.contextPlan?.output?.contextPlanner?.output?.turnFocus
  ];
  const focus = candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  return focus ? normalizeNarrativeContextFocus(focus) : undefined;
}

function normalizeNarrativeContextFocus(focus = {}) {
  const foreground = normalizePlainObject(focus.foreground);
  return stripUndefined({
    currentInput: normalizeOptionalText(focus.currentInput),
    currentInputClass: normalizeOptionalText(focus.currentInputClass),
    currentCombatExplicit: focus.currentCombatExplicit === true,
    latestNonCurrentUserInput: normalizeOptionalText(focus.latestNonCurrentUserInput),
    foreground: Object.keys(foreground).length ? stripUndefined({
      kind: normalizeOptionalText(foreground.kind),
      sourceText: normalizeOptionalText(foreground.sourceText),
      targetCandidates: normalizeStringArray(foreground.targetCandidates)
    }) : undefined,
    foregroundTargetCandidates: normalizeStringArray(focus.foregroundTargetCandidates),
    recentCombatHint: normalizeOptionalText(focus.recentCombatHint),
    staleContextWarnings: normalizeStringArray(focus.staleContextWarnings),
    bindingPolicy: normalizeStringArray(focus.bindingPolicy)
  });
}

function extractNarrativeCombatBattleGrounding(output = {}, { combatAction = {}, resolutionMode = '' } = {}) {
  const data = normalizePlainObject(output);
  const battle = firstCombatBattleData([
    data.endBattle?.battle,
    data.battle,
    data.startedBattle?.battle,
    data.preparedBattle?.battle,
    data.startBattle?.battle,
    data.activeBattle,
    data.battleInput
  ]);
  const enemyObjects = [
    ...normalizeList(data.enemies),
    ...normalizeList(data.enemyObjects),
    ...normalizeList(data.enemy),
    ...normalizeList(data.spawned).map((entry) => normalizePlainObject(entry).enemy),
    ...normalizeList(data.enemiesBefore),
    ...normalizeList(data.enemiesAfter)
  ].map(normalizeNarrativeCombatEnemy).filter((enemy) => enemy.id || enemy.name);
  const battleEnemyIds = normalizeStringArray(battle.enemyIds);
  const outputEnemyIds = normalizeStringArray(data.enemyIds);
  const enemyIds = compactUnique([
    ...battleEnemyIds,
    ...outputEnemyIds,
    ...enemyObjects.map((enemy) => enemy.id)
  ].filter(Boolean));
  const enemyNames = compactUnique([
    ...enemyObjects.map((enemy) => enemy.name),
    ...enemyIds
  ].filter(Boolean));
  const participantIds = compactUnique([
    ...normalizeStringArray(battle.participantIds),
    ...normalizeStringArray(data.participantIds)
  ].filter(Boolean));
  const allyIds = compactUnique([
    ...normalizeStringArray(battle.allyIds),
    ...normalizeStringArray(data.allyIds)
  ].filter(Boolean));
  const status = normalizeOptionalText(data.status);
  const battleStatus = firstNonEmptyString(
    data.endBattle?.battle?.data?.status,
    battle.status,
    status === 'prepared' ? 'active' : '',
    status
  );
  const eventType = normalizeOptionalText(data.event?.data?.eventType || data.event?.eventType);
  const battleId = normalizeOptionalText(battle.battleId || data.battleId || data.id);
  const hasBattleRecord = Boolean(
    battleId
    || battle.name
    || normalizeStringArray(battle.enemyIds).length
    || normalizeStringArray(battle.participantIds).length
  );
  const dryRun = data.dryRun === true || status === 'dry_run';
  const blocked = data.ok === false || data.skipped === true || status === 'blocked';
  const stateWritten = hasBattleRecord && !dryRun && !blocked && /active|prepared|resolved|won|lost|fled|ended|success/i.test(`${battleStatus} ${status}`);
  const battleStarted = stateWritten && (
    /active/i.test(battleStatus)
    || status === 'prepared'
    || eventType === 'start'
    || resolutionMode === 'combat_start'
    || combatAction.action
    || data.mode === 'active_battle_action'
  );
  const enemyCount = enemyIds.length || firstFiniteNumber(data.enemyCount, battleEnemyIds.length, outputEnemyIds.length);
  const present = Boolean(
    hasBattleRecord
    || data.mode === 'active_battle_action'
    || data.endBattle
    || status === 'prepared'
    || enemyIds.length
    || enemyObjects.length
  );
  return stripUndefined({
    present,
    stateWritten,
    blocked,
    battleStarted,
    mode: normalizeOptionalText(data.mode || resolutionMode),
    battleId,
    battleName: normalizeOptionalText(battle.name || data.name || data.battleName || data.title),
    sceneId: normalizeOptionalText(battle.sceneId || data.sceneId),
    battleStatus,
    status,
    enemyIds,
    enemyNames,
    enemyCount,
    enemies: enemyObjects,
    participantIds,
    allyIds,
    objective: normalizeOptionalText(battle.objective || data.objective),
    stakes: normalizeOptionalText(battle.stakes || data.stakes),
    eventType,
    reason: normalizeOptionalText(data.reason),
    playerMessage: normalizeOptionalText(data.playerMessage),
    dryRun
  });
}

function firstCombatBattleData(candidates = []) {
  for (const candidate of candidates) {
    const record = normalizePlainObject(candidate);
    if (!Object.keys(record).length) continue;
    const data = normalizePlainObject(record.data);
    const battle = Object.keys(data).length ? data : record;
    if (
      battle.battleId
      || battle.name
      || battle.status
      || normalizeStringArray(battle.enemyIds).length
      || normalizeStringArray(battle.participantIds).length
    ) {
      return battle;
    }
  }
  return {};
}

function normalizeNarrativeCombatEnemy(candidate = {}) {
  const entry = normalizePlainObject(candidate);
  const data = normalizePlainObject(entry.data || entry.enemy || entry);
  return stripUndefined({
    id: normalizeOptionalText(data.enemyId || data.npcId || data.actorId || data.id),
    name: normalizeOptionalText(data.name || data.title || data.enemyName || data.enemyId || data.npcId || data.actorId || data.id),
    hp: firstFiniteNumber(data.values?.hp, data.statusBar?.hp, data.hp),
    defeated: data.defeated === true || firstFiniteNumber(data.values?.hp, data.statusBar?.hp, data.hp) <= 0,
    actorType: normalizeOptionalText(data.actorType || data.type)
  });
}

function extractCombatTargetSettlementState(combatAction = {}, output = {}) {
  const targetId = normalizeOptionalText(combatAction.action?.targetIds?.[0] || output.targetId);
  const records = normalizeList(
    combatAction.settlement?.records
    || output.actionResult?.settlement?.records
    || combatAction.settlement?.state?.actors
    || output.actionResult?.settlement?.state?.actors
  );
  const matched = records.find((record) => {
    const data = normalizePlainObject(record.data || record);
    return targetId && normalizeOptionalText(data.npcId || data.actorId || data.id) === targetId;
  }) || records[0];
  const data = normalizePlainObject(matched?.data || matched);
  const hp = firstFiniteNumber(data.values?.hp, data.statusBar?.hp, data.hp);
  const conditions = compactUnique([
    ...normalizeList(data.statusBar?.conditions),
    ...normalizeList(data.conditions),
    ...normalizeList(data.specialStatuses).map((status) => normalizeOptionalText(status.id || status.name))
  ]).filter(Boolean);
  const defeated = hp !== undefined && hp <= 0
    || conditions.some((condition) => /dead|dying|unconscious|defeated|死亡|濒死|昏迷|击败/i.test(String(condition || '')));
  return stripUndefined({
    hp,
    defeated,
    conditions
  });
}

function extractNarrativeMovementGrounding(output = {}) {
  const data = normalizePlainObject(output);
  if (data.mode !== 'scene' && data.found === undefined && normalizeOptionalText(data.status) !== 'path_unavailable') return undefined;
  const targetNode = normalizeList(data.nodes).at(-1);
  const targetNodeData = normalizePlainObject(targetNode?.data || targetNode);
  return stripUndefined({
    mode: normalizeOptionalText(data.mode),
    status: normalizeOptionalText(data.status),
    found: data.found,
    startMapId: normalizeOptionalText(data.startMapId),
    targetMapId: normalizeOptionalText(data.targetMapId),
    targetName: normalizeOptionalText(targetNodeData.name),
    knownStart: data.knownStart,
    knownTarget: data.knownTarget,
    missingMapIds: normalizeStringArray(data.missingMapIds),
    pathMapIds: normalizeStringArray(data.pathMapIds),
    pathEdgeIds: normalizeStringArray(data.pathEdgeIds),
    reason: normalizeOptionalText(data.reason)
  });
}

function extractNarrativeWrittenFacts(appliedToolCalls = []) {
  const facts = {
    items: [],
    itemConsumptions: [],
    currency: {},
    currencyConsumptions: {},
    resourceConsumptions: [],
    equipment: [],
    equipmentRemovals: [],
    skills: [],
    feats: [],
    statuses: [],
    actorValues: [],
    npcs: [],
    sceneNpcs: [],
    sceneNpcDepartures: [],
    maps: [],
    sceneMaps: [],
    sceneMapRemovals: [],
    mapRoutes: [],
    npcRelations: [],
    partyMembers: [],
    partyMemberRemovals: [],
    factions: [],
    factionMemberships: [],
    factionRelations: [],
    quests: [],
    extensionFacts: []
  };
  for (const call of normalizeList(appliedToolCalls)) {
    const tool = normalizeOptionalText(call.tool);
    const input = normalizePlainObject(call.input);
    if (tool === 'system.npc_state.patch_state' || tool === 'system.npc_state.rewrite_state') {
      const actorId = normalizeOptionalText(input.npcId || input.actorId || input.id || input.recordId);
      const actorName = normalizeOptionalText(input.name || input.actorName);
      for (const [field, value] of Object.entries({
        ...normalizePlainObject(input.values),
        ...normalizePlainObject(input.numericValues)
      })) {
        if (!field) continue;
        facts.actorValues.push({
          actorId,
          actorName,
          field: normalizeOptionalText(field),
          value,
          source: 'values'
        });
      }
      for (const [field, value] of Object.entries(normalizePlainObject(input.statusBar))) {
        if (!field) continue;
        facts.actorValues.push({
          actorId,
          actorName,
          field: normalizeOptionalText(field),
          value,
          source: 'statusBar'
        });
      }
      const inventory = normalizePlainObject(input.inventory);
      for (const item of normalizeList(inventory.items)) {
        const data = normalizePlainObject(item);
        const name = normalizeOptionalText(data.name || data.id);
        if (!name) continue;
        facts.items.push({
          id: normalizeOptionalText(data.id),
          name,
          quantity: firstFiniteNumber(data.quantity, data.count, data.amount, 1),
          inventoryWritten: true
        });
      }
      for (const [key, value] of Object.entries(normalizePlainObject(inventory.currency))) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) continue;
        facts.currency[key] = (Number(facts.currency[key]) || 0) + amount;
      }
      collectNarrativeEquipmentFactsFromStatePatch(facts, input);
      const skillBar = normalizePlainObject(input.skillBar);
      for (const skill of [
        ...normalizeList(skillBar.skills),
        ...normalizeList(skillBar.actions)
      ]) {
          const data = normalizePlainObject(skill);
        const name = normalizeOptionalText(data.name || data.skillId || data.id);
        if (name) facts.skills.push({ id: normalizeOptionalText(data.skillId || data.id), name, definitionOnly: false });
      }
      for (const feat of normalizeList(skillBar.feats)) {
        const data = normalizePlainObject(feat);
        const name = normalizeOptionalText(data.name || data.featId || data.id);
        if (name) facts.feats.push({
          id: normalizeOptionalText(data.featId || data.id),
          name,
          status: normalizeOptionalText(data.status),
          definitionOnly: false
        });
      }
      for (const [key, value] of Object.entries(skillBar)) {
        if (['skills', 'actions', 'feats'].includes(key)) continue;
        const data = normalizePlainObject(value);
        const name = normalizeOptionalText(data.name || key);
        if (name) facts.skills.push({ id: normalizeOptionalText(data.skillId || data.id), name, definitionOnly: false });
      }
      const resources = normalizePlainObject(input.resources);
      const combatResources = normalizePlainObject(resources.combat);
      for (const feat of [
        ...normalizeList(combatResources.feats),
        ...normalizeList(input.statusBar?.feats)
      ]) {
        const data = normalizePlainObject(feat);
        const name = normalizeOptionalText(data.name || data.featId || data.id);
        if (name) facts.feats.push({
          id: normalizeOptionalText(data.featId || data.id),
          name,
          status: normalizeOptionalText(data.status),
          definitionOnly: false
        });
      }
      for (const status of [
        ...normalizeList(input.specialStatuses),
        ...normalizeList(input.statuses)
      ]) {
        const data = normalizePlainObject(status);
        const name = normalizeOptionalText(data.name || data.statusName || data.statusId || data.id);
        if (!name) continue;
        facts.statuses.push({
          id: normalizeOptionalText(data.statusId || data.id),
          name,
          actorId,
          actorName,
          active: data.active !== false && !/inactive|removed|cleared|false/i.test(String(data.status || data.state || '')),
          definitionOnly: false
        });
      }
    }
    collectNarrativeConsumptionFactsFromToolCall(facts, call);
    collectNarrativeEquipmentFactsFromToolCall(facts, call);
    collectNarrativePartyFactsFromToolCall(facts, call);
    collectNarrativeSceneNpcFactsFromToolCall(facts, call);
    collectNarrativeSceneMapFactsFromToolCall(facts, call);
    if (tool === 'system.item_registry.upsert_special_item' || tool === 'system.item_registry.upsert_item' || tool === 'system.item_registry.upsert_equipment' || tool === 'system.item_registry.upsert_weapon' || tool === 'system.item_registry.upsert_accessory' || tool === 'system.item_registry.upsert_mount') {
      const name = normalizeOptionalText(input.name || input.itemName || input.title || input.itemId || input.id);
      if (name) facts.items.push({ id: normalizeOptionalText(input.itemId || input.id), name, definitionOnly: true });
    }
    if (tool === 'system.mechanics_registry.upsert_skill') {
      const name = normalizeOptionalText(input.name || input.skillId || input.id);
      if (name) facts.skills.push({ id: normalizeOptionalText(input.skillId || input.id), name, definitionOnly: true });
    }
    if (tool === 'system.mechanics_registry.upsert_feat') {
      const name = normalizeOptionalText(input.name || input.featName || input.featId || input.id);
      if (name) facts.feats.push({ id: normalizeOptionalText(input.featId || input.id), name, definitionOnly: true });
    }
    if (tool === 'system.mechanics_registry.upsert_status') {
      const name = normalizeOptionalText(input.name || input.statusName || input.statusId || input.id);
      if (name) facts.statuses.push({ id: normalizeOptionalText(input.statusId || input.id), name, definitionOnly: true });
    }
    if (tool === 'system.npc_registry.upsert_npc') {
      const name = normalizeOptionalText(input.name || input.npcId || input.id);
      if (name) facts.npcs.push({ id: normalizeOptionalText(input.npcId || input.id), name, role: normalizeOptionalText(input.role) });
    }
    if (tool === 'system.map_registry.upsert_map') {
      const name = normalizeOptionalText(input.name || input.mapId || input.id);
      if (name) facts.maps.push({ id: normalizeOptionalText(input.mapId || input.id), name, type: normalizeOptionalText(input.type) });
    }
    if (tool === 'system.map_relationships.upsert_edge' || tool === 'system.map_relationships.patch_edge') {
      facts.mapRoutes.push({
        id: normalizeOptionalText(input.edgeId || input.id || input.relationId),
        fromId: normalizeOptionalText(input.fromMapId || input.from || input.sourceMapId || input.source),
        toId: normalizeOptionalText(input.toMapId || input.to || input.targetMapId || input.target),
        relationType: normalizeOptionalText(input.relationType || input.type || input.kind),
        status: normalizeOptionalText(input.status),
        summary: normalizeOptionalText(input.summary || input.description)
      });
    }
    if (tool === 'system.npc_relationships.upsert_edge' || tool === 'system.npc_relationships.patch_edge') {
      facts.npcRelations.push({
        id: normalizeOptionalText(input.edgeId || input.id || input.relationId),
        fromId: normalizeOptionalText(input.fromNpcId || input.from || input.sourceNpcId || input.source),
        toId: normalizeOptionalText(input.toNpcId || input.to || input.targetNpcId || input.target),
        relationType: normalizeOptionalText(input.relationType || input.type || input.kind),
        status: normalizeOptionalText(input.status),
        trust: input.trust,
        weight: input.weight,
        summary: normalizeOptionalText(input.summary || input.description)
      });
    }
    if (tool === 'system.factions.upsert_faction' || tool === 'system.factions.patch_faction') {
      const name = normalizeOptionalText(input.name || input.factionName || input.factionId || input.id);
      if (name) {
        facts.factions.push({
          id: normalizeOptionalText(input.factionId || input.id),
          name,
          status: normalizeOptionalText(input.status),
          kind: normalizeOptionalText(input.kind || input.type)
        });
      }
    }
    if (tool === 'system.factions.upsert_membership' || tool === 'system.factions.patch_membership') {
      facts.factionMemberships.push({
        id: normalizeOptionalText(input.membershipId || input.id),
        actorId: normalizeOptionalText(input.actorId || input.npcId || input.characterId),
        actorName: normalizeOptionalText(input.actorName || input.name),
        factionId: normalizeOptionalText(input.factionId || input.faction || input.organizationId),
        factionName: normalizeOptionalText(input.factionName || input.faction),
        status: normalizeOptionalText(input.status || input.role || input.position),
        loyalty: input.loyalty,
        influence: input.influence,
        summary: normalizeOptionalText(input.summary || input.description)
      });
    }
    if (tool === 'system.factions.upsert_relation' || tool === 'system.factions.patch_relation') {
      facts.factionRelations.push({
        id: normalizeOptionalText(input.relationId || input.edgeId || input.id),
        fromFactionId: normalizeOptionalText(input.fromFactionId || input.from || input.sourceFactionId || input.source),
        toFactionId: normalizeOptionalText(input.toFactionId || input.to || input.targetFactionId || input.target),
        relationType: normalizeOptionalText(input.relationType || input.type || input.kind),
        status: normalizeOptionalText(input.status),
        tension: input.tension,
        trust: input.trust,
        summary: normalizeOptionalText(input.summary || input.description)
      });
    }
    if (tool === 'system.quests.upsert_quest' || tool === 'system.quests.patch_quest' || tool === 'system.quests.set_quest_status' || tool === 'system.quests.track_quest') {
      facts.quests.push({
        id: normalizeOptionalText(input.questId || input.id),
        title: normalizeOptionalText(input.title || input.name || input.questTitle || input.questId || input.id),
        status: normalizeOptionalText(input.status || input.nextStatus),
        objective: normalizeOptionalText(input.objective),
        summary: normalizeOptionalText(input.summary || input.hookText || input.description)
      });
    }
    if (tool === 'system.data.quantify_text') {
      const values = normalizePlainObject(input.values);
      const factName = normalizeOptionalText(values.factName || values.metricName || input.id);
      if (factName) {
        facts.extensionFacts.push({
          name: factName,
          value: values.factValue ?? values.value ?? values.numericValue,
          collection: normalizeOptionalText(input.collection)
        });
      }
    }
  }
  facts.items = mergeNarrativeFactsByName(facts.items, 'quantity');
  facts.itemConsumptions = mergeNarrativeFactsByName(facts.itemConsumptions, 'quantity');
  facts.resourceConsumptions = mergeNarrativeFactsByName(facts.resourceConsumptions, 'quantity');
  facts.equipment = mergeNarrativeFactsByName(facts.equipment);
  facts.equipmentRemovals = mergeNarrativeFactsByName(facts.equipmentRemovals);
  facts.skills = mergeNarrativeFactsByName(facts.skills);
  facts.feats = mergeNarrativeFactsByName(facts.feats);
  facts.statuses = mergeNarrativeFactsByName(facts.statuses);
  facts.actorValues = mergeNarrativeFactsByKey(facts.actorValues, (fact) => [fact.actorId, fact.actorName, fact.field].filter(Boolean).join(':') || fact.field);
  facts.npcs = mergeNarrativeFactsByName(facts.npcs);
  facts.sceneNpcs = mergeNarrativeFactsByKey(facts.sceneNpcs, (fact) => [fact.sceneId, fact.npcId, fact.name].filter(Boolean).join(':'));
  facts.sceneNpcDepartures = mergeNarrativeFactsByKey(facts.sceneNpcDepartures, (fact) => [fact.sceneId, fact.npcId, fact.name].filter(Boolean).join(':'));
  facts.maps = mergeNarrativeFactsByName(facts.maps);
  facts.sceneMaps = mergeNarrativeFactsByKey(facts.sceneMaps, (fact) => [fact.sceneId, fact.mapId, fact.name].filter(Boolean).join(':'));
  facts.sceneMapRemovals = mergeNarrativeFactsByKey(facts.sceneMapRemovals, (fact) => [fact.sceneId, fact.mapId, fact.name].filter(Boolean).join(':'));
  facts.mapRoutes = mergeNarrativeFactsByKey(facts.mapRoutes, (fact) => [fact.fromId, fact.toId, fact.relationType].filter(Boolean).join(':'));
  facts.npcRelations = mergeNarrativeFactsByKey(facts.npcRelations, (fact) => [fact.fromId, fact.toId, fact.relationType].filter(Boolean).join(':'));
  facts.partyMembers = mergeNarrativeFactsByKey(facts.partyMembers, (fact) => [fact.partyId, fact.memberId, fact.npcId, fact.playerId, fact.name].filter(Boolean).join(':'));
  facts.partyMemberRemovals = mergeNarrativeFactsByKey(facts.partyMemberRemovals, (fact) => [fact.partyId, fact.memberId, fact.npcId, fact.playerId, fact.name].filter(Boolean).join(':'));
  facts.factions = mergeNarrativeFactsByName(facts.factions);
  hydrateFactionFactNames(facts);
  facts.factionMemberships = mergeNarrativeFactsByKey(facts.factionMemberships, (fact) => [fact.actorId, fact.actorName, fact.factionId, fact.factionName].filter(Boolean).join(':'));
  facts.factionRelations = mergeNarrativeFactsByKey(facts.factionRelations, (fact) => [fact.fromFactionId, fact.fromFactionName, fact.toFactionId, fact.toFactionName].filter(Boolean).join(':'));
  facts.quests = mergeNarrativeFactsByName(facts.quests.map((quest) => ({ ...quest, name: quest.title || quest.id })));
  facts.extensionFacts = mergeNarrativeFactsByName(facts.extensionFacts);
  return facts;
}

function extractNarrativePlannedDefinitionFacts(toolCalls = []) {
  const facts = {
    skills: [],
    feats: [],
    statuses: []
  };
  for (const call of normalizeList(toolCalls)) {
    const tool = normalizeOptionalText(call.tool);
    const input = normalizePlainObject(call.input);
    if (tool === 'system.mechanics_registry.upsert_skill') {
      const name = normalizeOptionalText(input.name || input.skillId || input.id);
      if (name) facts.skills.push({ id: normalizeOptionalText(input.skillId || input.id), name, definitionOnly: true });
    }
    if (tool === 'system.mechanics_registry.upsert_feat') {
      const name = normalizeOptionalText(input.name || input.featName || input.featId || input.id);
      if (name) facts.feats.push({ id: normalizeOptionalText(input.featId || input.id), name, definitionOnly: true });
    }
    if (tool === 'system.mechanics_registry.upsert_status') {
      const name = normalizeOptionalText(input.name || input.statusName || input.statusId || input.id);
      if (name) facts.statuses.push({ id: normalizeOptionalText(input.statusId || input.id), name, definitionOnly: true });
    }
  }
  facts.skills = mergeNarrativeFactsByName(facts.skills);
  facts.feats = mergeNarrativeFactsByName(facts.feats);
  facts.statuses = mergeNarrativeFactsByName(facts.statuses);
  return facts;
}

function collectNarrativeEquipmentFactsFromToolCall(facts = {}, call = {}) {
  const tool = normalizeOptionalText(call.tool);
  const input = normalizePlainObject(call.input);
  const output = normalizePlainObject(call.output);
  if (tool === 'system.item_use.equip_item') {
    const item = normalizePlainObject(output.item || input.item);
    const name = normalizeOptionalText(item.name || input.itemName || input.name || input.itemId || input.id);
    if (name) {
      facts.equipment.push({
        id: normalizeOptionalText(item.id || item.itemId || input.itemId || input.id),
        name,
        slot: normalizeOptionalText(output.slot || input.slot || input.equipSlot || input.equipmentSlot),
        source: tool
      });
    }
    collectNarrativeEquipmentFactsFromStatePatch(facts, normalizePlainObject(output.patch));
    return;
  }
  if (tool === 'system.item_use.unequip_item') {
    for (const item of normalizeList(output.items)) {
      const data = normalizePlainObject(item);
      const name = normalizeOptionalText(data.name || data.id || data.itemId);
      if (!name) continue;
      facts.equipmentRemovals.push({
        id: normalizeOptionalText(data.id || data.itemId),
        name,
        source: tool
      });
    }
    collectNarrativeEquipmentFactsFromStatePatch(facts, normalizePlainObject(output.patch));
  }
}

function collectNarrativeEquipmentFactsFromStatePatch(facts = {}, input = {}) {
  const equipment = normalizePlainObject(input.equipment);
  for (const entry of flattenNarrativeEquipmentEntries(equipment)) {
    if (!entry.name) continue;
    facts.equipment.push({ ...entry, source: 'equipment' });
  }
  const inventory = normalizePlainObject(input.inventory);
  for (const item of normalizeList(inventory.items)) {
    const data = normalizePlainObject(item);
    const name = normalizeOptionalText(data.name || data.id || data.itemId);
    if (!name) continue;
    const fact = {
      id: normalizeOptionalText(data.id || data.itemId),
      name,
      slot: normalizeOptionalText(data.metadata?.equippedSlot || data.slot || data.equipSlot),
      source: 'inventory.equipped'
    };
    if (data.equipped === true) facts.equipment.push(fact);
    if (data.equipped === false) facts.equipmentRemovals.push(fact);
  }
}

function flattenNarrativeEquipmentEntries(value, path = '') {
  const output = [];
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => output.push(...flattenNarrativeEquipmentEntries(entry, `${path}.${index}`)));
    return output;
  }
  const data = normalizePlainObject(value);
  if (data.id || data.itemId || data.sourceItemId || data.name) {
    const name = normalizeOptionalText(data.name || data.itemName || data.id || data.itemId || data.sourceItemId);
    if (name) {
      output.push({
        id: normalizeOptionalText(data.id || data.itemId || data.sourceItemId),
        name,
        slot: normalizeOptionalText(data.slot || data.equipSlot || data.bodySlot || path.replace(/^\./u, ''))
      });
    }
    return output;
  }
  for (const [key, child] of Object.entries(data)) {
    if (child === null || child === undefined || child === false) continue;
    output.push(...flattenNarrativeEquipmentEntries(child, path ? `${path}.${key}` : key));
  }
  return output;
}

function collectNarrativePartyFactsFromToolCall(facts = {}, call = {}) {
  const tool = normalizeOptionalText(call.tool);
  if (!tool || !tool.startsWith('system.party.')) return;
  const input = normalizePlainObject(call.input);
  const output = normalizePlainObject(call.output);
  if (tool === 'system.party.clear_party') {
    for (const result of normalizeList(output.results)) {
      const fact = extractNarrativePartyMemberFact(input, normalizePlainObject(result), tool);
      if (fact.name) facts.partyMemberRemovals.push({ ...fact, source: tool });
    }
    return;
  }
  const fact = extractNarrativePartyMemberFact(input, output, tool);
  if (!fact.name) return;
  if (tool === 'system.party.remove_member' || narrativePartyMemberIsInactive(fact)) {
    facts.partyMemberRemovals.push({ ...fact, source: tool });
    return;
  }
  if ([
    'system.party.add_member',
    'system.party.patch_member',
    'system.party.assign_member',
    'system.party.set_member_activity',
    'system.party.set_member_location'
  ].includes(tool)) {
    facts.partyMembers.push({ ...fact, source: tool });
  }
}

function extractNarrativePartyMemberFact(input = {}, output = {}, tool = '') {
  const patch = normalizePlainObject(input.patch);
  const record = normalizePlainObject(output.record);
  const outputData = normalizePlainObject(output.data || record.data || output.member?.data || output.member || output);
  const data = {
    ...patch,
    ...outputData
  };
  const assignment = normalizePlainObject(data.assignment || input.assignment || patch.assignment);
  const name = normalizeOptionalText(data.name || input.name || input.memberName || data.displayName || input.displayName || input.npcName);
  const npcId = normalizeOptionalText(data.npcId || input.npcId || input.registryId || patch.npcId || patch.registryId);
  const memberId = normalizeOptionalText(data.memberId || input.memberId || patch.memberId || npcId || input.playerId || data.playerId);
  const playerId = normalizeOptionalText(data.playerId || input.playerId || patch.playerId);
  const id = normalizeOptionalText(data.id || output.id || record.id || input.id || patch.id);
  const fallbackName = name || normalizeOptionalText(data.alias || memberId || npcId || playerId || id);
  return stripUndefined({
    id,
    partyId: normalizeOptionalText(data.partyId || input.partyId || patch.partyId || 'main'),
    memberId,
    npcId,
    playerId,
    name: fallbackName,
    membershipStatus: normalizeOptionalText(data.membershipStatus || input.membershipStatus || patch.membershipStatus || (tool === 'system.party.add_member' ? 'active' : '')),
    activityStatus: normalizeOptionalText(data.activityStatus || input.activityStatus || input.status || patch.activityStatus || patch.status || (tool === 'system.party.add_member' ? 'following' : '')),
    partyRole: normalizeOptionalText(data.partyRole || input.partyRole || patch.partyRole || input.companionRole || patch.companionRole),
    assignmentTitle: normalizeOptionalText(assignment.title || assignment.name || input.title),
    assignmentObjective: normalizeOptionalText(assignment.objective || assignment.task || assignment.order || input.objective || input.task || input.order),
    locationLabel: normalizeOptionalText(data.locationLabel || input.locationLabel || input.location || patch.locationLabel || patch.location),
    sceneId: normalizeOptionalText(data.sceneId || input.sceneId || patch.sceneId),
    deleted: output.deleted === true,
    mode: normalizeOptionalText(output.mode || input.mode)
  });
}

function narrativePartyMemberIsInactive(fact = {}) {
  const membershipStatus = String(normalizeOptionalText(fact.membershipStatus) || '').toLowerCase();
  const activityStatus = String(normalizeOptionalText(fact.activityStatus) || '').toLowerCase();
  const mode = String(normalizeOptionalText(fact.mode) || '').toLowerCase();
  return fact.deleted === true
    || ['former', 'removed', 'dead', 'archived'].includes(membershipStatus)
    || ['dead', 'removed'].includes(activityStatus)
    || ['markformer', 'markdead', 'dead', 'delete'].includes(mode);
}

function collectNarrativeSceneNpcFactsFromToolCall(facts = {}, call = {}) {
  const tool = normalizeOptionalText(call.tool);
  const input = normalizePlainObject(call.input);
  const output = normalizePlainObject(call.output);
  if (tool === 'system.scene_npcs.clear_scene_npcs') {
    for (const result of normalizeList(output.results)) {
      const fact = extractNarrativeSceneNpcFact(input, normalizePlainObject(result), tool);
      if (fact.name) facts.sceneNpcDepartures.push({ ...fact, source: tool });
    }
    return;
  }
  if (tool === 'system.scene_manager.enter_scene') {
    for (const mounted of normalizeList(output.mountedNpcs)) {
      const fact = extractNarrativeSceneNpcFact(input, normalizePlainObject(mounted), tool);
      if (fact.name && !narrativeSceneNpcIsInactive(fact)) facts.sceneNpcs.push({ ...fact, source: tool });
    }
    return;
  }
  if (tool === 'system.scene_manager.end_scene') {
    const unmounted = normalizePlainObject(output.unmountedNpcs);
    for (const result of normalizeList(unmounted.results)) {
      const fact = extractNarrativeSceneNpcFact(input, normalizePlainObject(result), tool);
      if (fact.name) facts.sceneNpcDepartures.push({ ...fact, source: tool });
    }
    return;
  }
  if (!tool || !tool.startsWith('system.scene_npcs.')) return;
  const fact = extractNarrativeSceneNpcFact(input, output, tool);
  if (!fact.name) return;
  if (tool === 'system.scene_npcs.unmount_npc' || narrativeSceneNpcIsInactive(fact)) {
    facts.sceneNpcDepartures.push({ ...fact, source: tool });
    return;
  }
  if (tool === 'system.scene_npcs.mount_npc' || tool === 'system.scene_npcs.patch_mounted_npc') {
    facts.sceneNpcs.push({ ...fact, source: tool });
  }
}

function extractNarrativeSceneNpcFact(input = {}, output = {}, tool = '') {
  const patch = normalizePlainObject(input.patch);
  const record = normalizePlainObject(output.record);
  const outputData = normalizePlainObject(output.data || record.data || output.npc?.data || output.npc || output);
  const data = {
    ...patch,
    ...outputData
  };
  const name = normalizeOptionalText(data.name || input.name || input.npcName || data.displayName || input.displayName);
  const npcId = normalizeOptionalText(data.npcId || input.npcId || input.registryId || patch.npcId || patch.registryId);
  const id = normalizeOptionalText(data.id || output.id || record.id || input.id || patch.id);
  const fallbackName = name || normalizeOptionalText(data.alias || npcId || id);
  return stripUndefined({
    id,
    sceneId: normalizeOptionalText(data.sceneId || input.sceneId || patch.sceneId || 'current'),
    npcId,
    name: fallbackName,
    actorType: normalizeOptionalText(data.actorType || input.actorType || patch.actorType || input.type || patch.type),
    status: normalizeOptionalText(data.status || input.status || patch.status || (tool === 'system.scene_npcs.mount_npc' || tool === 'system.scene_manager.enter_scene' ? 'present' : '')),
    visibility: normalizeOptionalText(data.visibility || input.visibility || patch.visibility),
    disposition: normalizeOptionalText(data.disposition || input.disposition || patch.disposition),
    locationLabel: normalizeOptionalText(data.locationLabel || input.locationLabel || input.location || patch.locationLabel || patch.location),
    deleted: output.deleted === true,
    mode: normalizeOptionalText(output.mode || input.mode)
  });
}

function narrativeSceneNpcIsInactive(fact = {}) {
  const status = String(normalizeOptionalText(fact.status) || '').toLowerCase();
  const mode = String(normalizeOptionalText(fact.mode) || '').toLowerCase();
  return fact.deleted === true
    || ['inactive', 'departed', 'dead', 'removed'].includes(status)
    || ['markdeparted', 'mark-departed', 'delete'].includes(mode);
}

function collectNarrativeSceneMapFactsFromToolCall(facts = {}, call = {}) {
  const tool = normalizeOptionalText(call.tool);
  const input = normalizePlainObject(call.input);
  const output = normalizePlainObject(call.output);
  if (tool === 'system.scene_maps.clear_scene_maps') {
    for (const result of normalizeList(output.results)) {
      const fact = extractNarrativeSceneMapFact(input, normalizePlainObject(result), tool);
      if (fact.name) facts.sceneMapRemovals.push({ ...fact, source: tool });
    }
    return;
  }
  if (tool === 'system.scene_manager.enter_scene') {
    for (const mounted of normalizeList(output.mountedMaps)) {
      const fact = extractNarrativeSceneMapFact(input, normalizePlainObject(mounted), tool);
      if (fact.name && !narrativeSceneMapIsInactive(fact)) facts.sceneMaps.push({ ...fact, source: tool });
    }
    return;
  }
  if (tool === 'system.scene_manager.end_scene') {
    const unmounted = normalizePlainObject(output.unmountedMaps);
    for (const result of normalizeList(unmounted.results)) {
      const fact = extractNarrativeSceneMapFact(input, normalizePlainObject(result), tool);
      if (fact.name) facts.sceneMapRemovals.push({ ...fact, source: tool });
    }
    return;
  }
  if (!tool || !tool.startsWith('system.scene_maps.')) return;
  const fact = extractNarrativeSceneMapFact(input, output, tool);
  if (!fact.name) return;
  if (tool === 'system.scene_maps.unmount_map' || narrativeSceneMapIsInactive(fact)) {
    facts.sceneMapRemovals.push({ ...fact, source: tool });
    return;
  }
  if (tool === 'system.scene_maps.mount_map' || tool === 'system.scene_maps.patch_mounted_map') {
    facts.sceneMaps.push({ ...fact, source: tool });
  }
}

function extractNarrativeSceneMapFact(input = {}, output = {}, tool = '') {
  const patch = normalizePlainObject(input.patch);
  const record = normalizePlainObject(output.record);
  const outputData = normalizePlainObject(output.data || record.data || output.map?.data || output.map || output);
  const data = {
    ...patch,
    ...outputData
  };
  const name = normalizeOptionalText(data.name || input.name || input.mapName || data.displayName || input.displayName);
  const mapId = normalizeOptionalText(data.mapId || input.mapId || input.registryId || patch.mapId || patch.registryId);
  const id = normalizeOptionalText(data.id || output.id || record.id || input.id || patch.id);
  const fallbackName = name || normalizeOptionalText(data.alias || mapId || id);
  return stripUndefined({
    id,
    sceneId: normalizeOptionalText(data.sceneId || input.sceneId || patch.sceneId || 'current'),
    mapId,
    name: fallbackName,
    type: normalizeOptionalText(data.type || input.type || patch.type),
    status: normalizeOptionalText(data.status || input.status || patch.status || (tool === 'system.scene_maps.mount_map' || tool === 'system.scene_manager.enter_scene' ? 'active' : '')),
    visibility: normalizeOptionalText(data.visibility || input.visibility || patch.visibility),
    locationLabel: normalizeOptionalText(data.locationLabel || input.locationLabel || input.location || patch.locationLabel || patch.location),
    deleted: output.deleted === true,
    mode: normalizeOptionalText(output.mode || input.mode)
  });
}

function narrativeSceneMapIsInactive(fact = {}) {
  const status = String(normalizeOptionalText(fact.status) || '').toLowerCase();
  const mode = String(normalizeOptionalText(fact.mode) || '').toLowerCase();
  return fact.deleted === true
    || ['inactive', 'removed', 'unreachable', 'collapsed'].includes(status)
    || ['markinactive', 'mark-inactive', 'delete'].includes(mode);
}

function collectNarrativeConsumptionFactsFromToolCall(facts = {}, call = {}) {
  const tool = normalizeOptionalText(call.tool);
  const input = normalizePlainObject(call.input);
  const output = normalizePlainObject(call.output);
  collectNarrativeConsumptionFact(facts, { tool, input, output, source: tool });
  if (tool === 'system.item_use.use_item') {
    for (const application of normalizeList(output.costApplications)) {
      const app = normalizePlainObject(application);
      collectNarrativeConsumptionFact(facts, {
        tool: normalizeOptionalText(app.tool),
        input: normalizePlainObject(app.result?.input || app.input),
        output: normalizePlainObject(app.result?.output || app.output),
        cost: normalizePlainObject(app.cost),
        source: 'system.item_use.use_item.costApplications'
      });
    }
    for (const application of normalizeList(output.resourceChanges)) {
      const app = normalizePlainObject(application);
      collectNarrativeConsumptionFact(facts, {
        tool: normalizeOptionalText(app.tool),
        input: normalizePlainObject(app.result?.input || app.input),
        output: normalizePlainObject(app.result?.output || app.output),
        cost: normalizePlainObject(app.change),
        source: 'system.item_use.use_item.resourceChanges'
      });
    }
  }
}

function collectNarrativeConsumptionFact(facts = {}, { tool = '', input = {}, output = {}, cost = {}, source = '' } = {}) {
  if (!['system.resources.consume_item', 'system.resources.spend_resource', 'system.resources.spend_action_economy'].includes(tool)) return;
  if (tool === 'system.resources.spend_action_economy') {
    const resourceId = normalizeOptionalText(output.resource || input.resource || input.actionType || input.type || input.kind);
    const quantity = firstFiniteNumber(output.amount, input.amount, input.value, input.distance, 1);
    if (!resourceId) return;
    facts.resourceConsumptions.push({
      id: resourceId,
      name: resourceId,
      category: 'actionEconomy',
      quantity,
      before: firstFiniteNumber(output.before),
      after: firstFiniteNumber(output.after),
      source
    });
    return;
  }
  const category = normalizeOptionalText(output.category || input.category || cost.category || cost.resourceType || input.resourceType || input.type);
  const resourceId = normalizeOptionalText(output.resourceId || input.resourceId || input.id || input.itemId || cost.resourceId || cost.itemId || cost.id);
  const itemId = normalizeOptionalText(output.resource?.itemId || input.itemId || input.inventoryItemId || cost.itemId || cost.inventoryItemId || resourceId);
  const inventoryPatchItems = normalizeList(output.inventoryPatch?.items);
  const patchedItem = inventoryPatchItems.find((item) => normalizeOptionalText(item?.id) === itemId) || inventoryPatchItems[0];
  const itemName = normalizeOptionalText(input.itemName || cost.itemName || input.name || cost.name || output.resource?.name || patchedItem?.name || itemId || resourceId);
  const quantity = firstFiniteNumber(output.amount, input.amount, input.quantity, input.value, cost.amount, cost.quantity, cost.value, 1);
  const before = firstFiniteNumber(output.before);
  const after = firstFiniteNumber(output.after);
  const currencyKey = normalizeNarrativeCurrencyKey(itemId || resourceId || itemName);
  if (currencyKey || category === 'currency') {
    const key = currencyKey || normalizeNarrativeCurrencyKey(resourceId || itemName);
    if (key) facts.currencyConsumptions[key] = (Number(facts.currencyConsumptions[key]) || 0) + quantity;
    return;
  }
  if (tool === 'system.resources.consume_item') {
    if (!itemName) return;
    facts.itemConsumptions.push({
      id: itemId,
      name: itemName,
      quantity,
      before,
      after,
      source
    });
    return;
  }
  if (!resourceId && !itemName) return;
  facts.resourceConsumptions.push({
    id: resourceId,
    name: itemName || resourceId,
    category,
    quantity,
    before,
    after,
    source
  });
}

function mergeCombatRewardsIntoWrittenFacts(facts = {}, rewards = [], { rewardStatus } = {}) {
  if (normalizeOptionalText(rewardStatus) !== 'applied') return facts;
  for (const reward of normalizeList(rewards)) {
    const data = normalizePlainObject(reward);
    const name = normalizeOptionalText(data.name || data.itemName || data.id);
    if (!name) continue;
    const quantity = firstFiniteNumber(data.quantity, data.count, data.amount, 1);
    if (isNarrativeCurrencyId(data.id) || isNarrativeCurrencyName(name)) {
      const key = normalizeNarrativeCurrencyKey(data.id || name);
      if (key) facts.currency[key] = (Number(facts.currency[key]) || 0) + quantity;
    } else {
      facts.items.push({
        id: normalizeOptionalText(data.id),
        name,
        quantity,
        inventoryWritten: true,
        source: 'combat.rewardApplication'
      });
    }
  }
  facts.items = mergeNarrativeFactsByName(facts.items, 'quantity');
  return facts;
}

function mergeExistingSceneNpcsIntoWrittenFacts(facts = {}, { state = {}, output = {}, resolution = {} } = {}) {
  const sources = [
    resolution.context?.sources?.sceneNpcs,
    output.context?.sources?.sceneNpcs,
    state.adjudication?.resolverResult?.currentResolution?.context?.sources?.sceneNpcs,
    state.adjudication?.resolverResult?.context?.sources?.sceneNpcs
  ];
  for (const source of sources) {
    for (const record of normalizeList(source?.records)) {
      const data = normalizePlainObject(record.data || record);
      if (!data || narrativeSceneNpcIsInactive(data)) continue;
      const name = normalizeOptionalText(data.name || data.npcId || record.id);
      if (!name) continue;
      facts.sceneNpcs.push(stripUndefined({
        id: normalizeOptionalText(record.id || data.id),
        sceneId: normalizeOptionalText(data.sceneId || source?.sceneId || 'current'),
        npcId: normalizeOptionalText(data.npcId),
        name,
        actorType: normalizeOptionalText(data.actorType),
        status: normalizeOptionalText(data.status || 'present'),
        visibility: normalizeOptionalText(data.visibility),
        disposition: normalizeOptionalText(data.disposition),
        locationLabel: normalizeOptionalText(data.locationLabel),
        source: 'existing_scene_context'
      }));
    }
  }
  facts.sceneNpcs = mergeNarrativeFactsByKey(facts.sceneNpcs, (fact) => [fact.sceneId, fact.npcId, fact.name].filter(Boolean).join(':'));
  return facts;
}

function mergeExistingSceneMapsIntoWrittenFacts(facts = {}, { state = {}, output = {}, resolution = {} } = {}) {
  const sources = [
    resolution.context?.sources?.sceneMaps,
    output.context?.sources?.sceneMaps,
    state.adjudication?.resolverResult?.currentResolution?.context?.sources?.sceneMaps,
    state.adjudication?.resolverResult?.context?.sources?.sceneMaps
  ];
  for (const source of sources) {
    for (const record of normalizeList(source?.records)) {
      const data = normalizePlainObject(record.data || record);
      if (!data || narrativeSceneMapIsInactive(data)) continue;
      const name = normalizeOptionalText(data.name || data.mapId || record.id);
      if (!name) continue;
      facts.sceneMaps.push(stripUndefined({
        id: normalizeOptionalText(record.id || data.id),
        sceneId: normalizeOptionalText(data.sceneId || source?.sceneId || 'current'),
        mapId: normalizeOptionalText(data.mapId),
        name,
        type: normalizeOptionalText(data.type),
        status: normalizeOptionalText(data.status || 'active'),
        visibility: normalizeOptionalText(data.visibility),
        locationLabel: normalizeOptionalText(data.locationLabel),
        source: 'existing_scene_context'
      }));
    }
  }
  facts.sceneMaps = mergeNarrativeFactsByKey(facts.sceneMaps, (fact) => [fact.sceneId, fact.mapId, fact.name].filter(Boolean).join(':'));
  return facts;
}

function mergeNarrativeFactsByName(values = [], numericField) {
  const byName = new Map();
  for (const value of normalizeList(values)) {
    const data = normalizePlainObject(value);
    const name = normalizeOptionalText(data.name);
    if (!name) continue;
    const previous = byName.get(name);
    if (!previous) {
      byName.set(name, data);
      continue;
    }
    const merged = { ...previous, ...data };
    if (numericField && Number.isFinite(Number(data[numericField])) && Number.isFinite(Number(previous[numericField]))) {
      merged[numericField] = Number(previous[numericField]) + Number(data[numericField]);
    }
    if (previous.inventoryWritten || data.inventoryWritten) merged.inventoryWritten = true;
    if (previous.definitionOnly === false || data.definitionOnly === false) {
      merged.definitionOnly = false;
    } else if (previous.definitionOnly === true || data.definitionOnly === true) {
      merged.definitionOnly = true;
    }
    byName.set(name, merged);
  }
  return [...byName.values()];
}

function mergeNarrativeFactsByKey(values = [], keyFn) {
  const byKey = new Map();
  for (const value of normalizeList(values)) {
    const data = normalizePlainObject(value);
    const key = normalizeOptionalText(typeof keyFn === 'function' ? keyFn(data) : data.id);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) || {}), ...data });
  }
  return [...byKey.values()];
}

function hydrateFactionFactNames(facts = {}) {
  const namesById = new Map();
  for (const faction of normalizeList(facts.factions)) {
    const id = normalizeOptionalText(faction.id || faction.factionId);
    const name = normalizeOptionalText(faction.name);
    if (id && name) namesById.set(id, name);
  }
  for (const membership of normalizeList(facts.factionMemberships)) {
    const name = normalizeOptionalText(membership.factionName) || namesById.get(normalizeOptionalText(membership.factionId));
    if (name) membership.factionName = name;
  }
  for (const relation of normalizeList(facts.factionRelations)) {
    relation.fromFactionName = normalizeOptionalText(relation.fromFactionName) || namesById.get(normalizeOptionalText(relation.fromFactionId));
    relation.toFactionName = normalizeOptionalText(relation.toFactionName) || namesById.get(normalizeOptionalText(relation.toFactionId));
  }
}

function reviewNarrativeConsistency(content = '', grounding = {}) {
  const text = String(content || '');
  const facts = normalizePlainObject(grounding.writtenFacts);
  const plannedDefinitionFacts = normalizePlainObject(grounding.plannedDefinitionFacts);
  const issues = [
    ...reviewNarrativeItemClaims(text, facts),
    ...reviewNarrativeItemConsumptionClaims(text, facts),
    ...reviewNarrativeCurrencyClaims(text, facts),
    ...reviewNarrativeCurrencyConsumptionClaims(text, facts),
    ...reviewNarrativeResourceConsumptionClaims(text, facts),
    ...reviewNarrativeEquipmentClaims(text, facts),
    ...reviewNarrativeSkillClaims(text, facts, plannedDefinitionFacts),
    ...reviewNarrativeFeatClaims(text, facts, plannedDefinitionFacts),
    ...reviewNarrativeStatusClaims(text, facts),
    ...reviewNarrativeActorValueClaims(text, facts),
    ...reviewNarrativeEntityClaims(text, facts, 'npc'),
    ...reviewNarrativeSceneNpcClaims(text, facts),
    ...reviewNarrativeEntityClaims(text, facts, 'map'),
    ...reviewNarrativeSceneMapClaims(text, facts),
    ...reviewNarrativeMapRouteClaims(text, facts),
    ...reviewNarrativeNpcRelationshipClaims(text, facts),
    ...reviewNarrativePartyClaims(text, facts),
    ...reviewNarrativeFactionClaims(text, facts),
    ...reviewNarrativeQuestClaims(text, facts),
    ...reviewNarrativeExtensionFactClaims(text, facts),
    ...reviewNarrativeCombatClaims(text, grounding),
    ...reviewNarrativeMovementClaims(text, grounding),
    ...reviewNarrativeContextFocusClaims(text, grounding),
    ...reviewNarrativeResolutionClaims(text, grounding)
  ];
  return {
    status: issues.length ? 'blocked' : 'ok',
    issues,
    policy: 'Positive claims about obtained/written/consumed/equipped items, currency, resources, skills, feats, statuses, values, current-scene NPC presence, current-scene map/location mounts, party roster/activity, relationships, factions, quests, maps, movement arrival/location, extension facts, combat starts/enemies/outcomes, adjudication success/failure, and short-input context focus must match Resolver Grounding.'
  };
}

function reviewNarrativeItemClaims(text = '', facts = {}) {
  const issues = [];
  const allowed = new Map(normalizeList(facts.items).map((item) => [normalizeOptionalText(item.name), item]));
  const itemPattern = narrativeItemClaimPattern();
  for (const match of text.matchAll(itemPattern)) {
    const name = cleanNarrativeItemClaimName(match[2]);
    if (!name) continue;
    const context = claimWindow(text, match.index || 0, name.length);
    if (!isPositiveInventoryClaim(context)) continue;
    const fact = allowed.get(name);
    if (!fact || fact.definitionOnly && !fact.inventoryWritten) {
      issues.push({ kind: 'unwritten_item_claim', name, context });
      continue;
    }
    const claimedQuantity = parseNarrativeQuantity(match[1]) ?? parseNarrativeQuantity(match[3]);
    const writtenQuantity = Number(fact.quantity);
    if (claimedQuantity !== undefined && Number.isFinite(writtenQuantity) && claimedQuantity !== writtenQuantity) {
      issues.push({ kind: 'item_quantity_mismatch', name, claimedQuantity, writtenQuantity, context });
    }
  }
  return issues;
}

function reviewNarrativeItemConsumptionClaims(text = '', facts = {}) {
  const issues = [];
  const consumed = new Map(normalizeList(facts.itemConsumptions).map((item) => [normalizeOptionalText(item.name), item]));
  const itemPattern = narrativeItemClaimPattern();
  for (const match of text.matchAll(itemPattern)) {
    const name = cleanNarrativeItemClaimName(match[2]);
    if (!name) continue;
    const context = claimWindow(text, match.index || 0, name.length);
    if (!isInventoryConsumptionClaim(context)) continue;
    const fact = consumed.get(name);
    if (!fact) {
      issues.push({ kind: 'unwritten_item_consumption_claim', name, context });
      continue;
    }
    const claimedQuantity = parseNarrativeQuantity(match[1]) ?? parseNarrativeQuantity(match[3]);
    const writtenQuantity = Number(fact.quantity);
    if (claimedQuantity !== undefined && Number.isFinite(writtenQuantity) && claimedQuantity !== writtenQuantity) {
      issues.push({ kind: 'item_consumption_quantity_mismatch', name, claimedQuantity, writtenQuantity, context });
    }
  }
  return issues;
}

function narrativeItemClaimPattern() {
  return /(?:([零一二两三四五六七八九十百千万\d]+)\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件)?\s*)?((?:[\u4e00-\u9fa5A-Za-z0-9]{1,16}(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|丹|卷轴|符纸|符箓|护符|玉佩|材料|素材|灵草|药草|矿石))|(?:符纸|符箓|灵草|药草|矿石|材料|素材|钥匙|令牌|卷轴))(?:\s*(?:x|×)?\s*([零一二两三四五六七八九十百千万\d]+))?/gu;
}

function cleanNarrativeItemClaimName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:你|我|他|她|其|旁白|行动结果)/u, '')
    .replace(/^(?:获得|得到|拿到|拾取|捡到|领取|收取|写入|加入|放入|收入|额外获得|还额外获得|奖励|掉落|消耗|耗费|用掉|扣除|花费|支付|付出|失去|损失|交出|减少)/u, '')
    .replace(/^(?:还|额外|并|同时|以及)/u, '')
    .replace(/^(?:获得|得到|拿到|拾取|捡到|领取|收取|写入|加入|放入|收入|额外获得|奖励|掉落|消耗|耗费|用掉|扣除|花费|支付|付出|失去|损失|交出|减少)/u, '')
    .trim();
}

function reviewNarrativeCurrencyClaims(text = '', facts = {}) {
  const issues = [];
  const scanText = normalizeNarrativeCurrencyClaimText(text);
  const currency = normalizePlainObject(facts.currency);
  const labels = {
    low_grade_spirit_stone: '下品灵石',
    mid_grade_spirit_stone: '中品灵石',
    high_grade_spirit_stone: '上品灵石',
    spirit_stone: '灵石'
  };
  for (const [key, label] of Object.entries(labels)) {
    const amount = Number(currency[key]);
    const pattern = new RegExp(`(?:([零一二两三四五六七八九十百千万\\d]+)\\s*(?:个|枚|块|颗|份)?\\s*)?(${escapeRegExpForNarrative(label)})\\s*([零一二两三四五六七八九十百千万\\d]+)?`, 'gu');
    for (const match of scanText.matchAll(pattern)) {
      const labelIndex = (match.index || 0) + match[0].indexOf(match[2]);
      if (key === 'spirit_stone' && /(?:下品|低品|中品|上品|高品)$/u.test(scanText.slice(Math.max(0, labelIndex - 2), labelIndex))) continue;
      const context = claimWindow(scanText, match.index || 0, label.length);
      if (!isPositiveInventoryClaim(context)) continue;
      const claimedQuantity = parseNarrativeQuantity(match[1]) ?? parseNarrativeQuantity(match[3]);
      if (!Number.isFinite(amount)) {
        issues.push({ kind: 'unwritten_currency_claim', name: label, context });
      } else if (claimedQuantity !== undefined && claimedQuantity !== amount) {
        issues.push({ kind: 'currency_quantity_mismatch', name: label, claimedQuantity, writtenQuantity: amount, context });
      }
    }
  }
  return issues;
}

function reviewNarrativeCurrencyConsumptionClaims(text = '', facts = {}) {
  const issues = [];
  const scanText = normalizeNarrativeCurrencyClaimText(text);
  const currency = normalizePlainObject(facts.currencyConsumptions);
  const labels = {
    low_grade_spirit_stone: '下品灵石',
    mid_grade_spirit_stone: '中品灵石',
    high_grade_spirit_stone: '上品灵石',
    spirit_stone: '灵石'
  };
  for (const [key, label] of Object.entries(labels)) {
    const amount = Number(currency[key]);
    const pattern = new RegExp(`(?:([零一二两三四五六七八九十百千万\\d]+)\\s*(?:个|枚|块|颗|份)?\\s*)?(${escapeRegExpForNarrative(label)})\\s*([零一二两三四五六七八九十百千万\\d]+)?`, 'gu');
    for (const match of scanText.matchAll(pattern)) {
      const labelIndex = (match.index || 0) + match[0].indexOf(match[2]);
      if (key === 'spirit_stone' && /(?:下品|低品|中品|上品|高品)$/u.test(scanText.slice(Math.max(0, labelIndex - 2), labelIndex))) continue;
      const context = claimWindow(scanText, match.index || 0, label.length);
      if (!isInventoryConsumptionClaim(context)) continue;
      const claimedQuantity = parseNarrativeQuantity(match[1]) ?? parseNarrativeQuantity(match[3]);
      if (!Number.isFinite(amount)) {
        issues.push({ kind: 'unwritten_currency_consumption_claim', name: label, context });
      } else if (claimedQuantity !== undefined && claimedQuantity !== amount) {
        issues.push({ kind: 'currency_consumption_quantity_mismatch', name: label, claimedQuantity, writtenQuantity: amount, context });
      }
    }
  }
  return issues;
}

function reviewNarrativeResourceConsumptionClaims(text = '', facts = {}) {
  const issues = [];
  const consumed = normalizeList(facts.resourceConsumptions);
  for (const claim of extractNarrativeResourceConsumptionClaims(text)) {
    const matches = consumed.filter((fact) => narrativeResourceConsumptionMatches(claim, fact));
    if (!matches.length) {
      issues.push({ kind: 'unwritten_resource_consumption_claim', name: claim.name, category: claim.category, context: claim.context });
      continue;
    }
    const claimedQuantity = claim.quantity;
    const writtenQuantity = matches.reduce((sum, fact) => sum + (Number(fact.quantity) || 0), 0);
    if (claimedQuantity !== undefined && Number.isFinite(writtenQuantity) && claimedQuantity !== writtenQuantity) {
      issues.push({
        kind: 'resource_consumption_quantity_mismatch',
        name: claim.name,
        category: claim.category,
        claimedQuantity,
        writtenQuantity,
        context: claim.context
      });
    }
  }
  return issues;
}

function extractNarrativeResourceConsumptionClaims(text = '') {
  const claims = [];
  const suffix = '(?:法术位|技能次数|使用次数|箭矢|箭|弹药|子弹|动作|行动|附赠动作|反应|移动力|移动距离)';
  const patterns = [
    {
      pattern: new RegExp(`(?:消耗|耗费|用掉|扣除|花费|支付)\\s*([零一二两三四五六七八九十百千万\\d]+)?\\s*(?:个|点|次|发|支|格|尺|米)?\\s*([^,，.。;；:：\\n\\r]{0,18}?${suffix})`, 'gu'),
      quantityGroup: 1,
      nameGroup: 2
    },
    {
      pattern: new RegExp(`([^,，.。;；:：\\n\\r]{0,18}?${suffix})\\s*(?:消耗|耗费|用掉|扣除|减少)\\s*([零一二两三四五六七八九十百千万\\d]+)?`, 'gu'),
      nameGroup: 1,
      quantityGroup: 2
    }
  ];
  for (const { pattern, nameGroup, quantityGroup } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawName = match[nameGroup];
      const quantity = parseNarrativeQuantity(match[quantityGroup]);
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (!isInventoryConsumptionClaim(context)) continue;
      const normalized = normalizeNarrativeResourceClaim(rawName);
      if (!normalized.name || !normalized.category) continue;
      claims.push({
        ...normalized,
        quantity,
        context
      });
    }
  }
  return mergeNarrativeFactsByName(claims, 'quantity');
}

function normalizeNarrativeResourceClaim(value = '') {
  const name = normalizeOptionalText(value)
    .replace(/^(?:你|我|他|她|其|旁白|行动结果|消耗|耗费|用掉|扣除|花费|支付|了|一个|一次|一发|一支|一点)/u, '')
    .replace(/^[零一二两三四五六七八九十百千万\d]+\s*(?:个|点|次|发|支|格|尺|米)?/u, '')
    .trim();
  if (!name) return {};
  if (/法术位/u.test(name)) {
    const level = extractNarrativeSpellSlotLevel(name);
    return {
      name,
      category: 'spellSlots',
      resourceId: level ? `level${level}` : ''
    };
  }
  if (/技能次数|使用次数/u.test(name)) {
    return {
      name,
      category: 'skillUses',
      resourceId: normalizeOptionalText(name.replace(/(?:技能次数|使用次数)$/u, ''))
    };
  }
  if (/箭矢|箭|弹药|子弹/u.test(name)) {
    return {
      name,
      category: 'ammo',
      resourceId: /箭|箭矢/u.test(name) ? 'arrows' : ''
    };
  }
  if (/附赠动作/u.test(name)) return { name, category: 'actionEconomy', resourceId: 'bonusAction' };
  if (/反应/u.test(name)) return { name, category: 'actionEconomy', resourceId: 'reaction' };
  if (/移动力|移动距离/u.test(name)) return { name, category: 'actionEconomy', resourceId: 'movement' };
  if (/动作|行动/u.test(name)) return { name, category: 'actionEconomy', resourceId: 'action' };
  return {};
}

function extractNarrativeSpellSlotLevel(name = '') {
  const text = normalizeOptionalText(name);
  const match = text.match(/([零一二两三四五六七八九十\d]+)\s*(?:环|级)/u)
    || text.match(/level\s*([0-9]+)/iu);
  if (!match) return undefined;
  return parseNarrativeQuantity(match[1]);
}

function narrativeResourceConsumptionMatches(claim = {}, fact = {}) {
  const claimCategory = normalizeOptionalText(claim.category);
  const factCategory = normalizeOptionalText(fact.category);
  if (claimCategory && factCategory && claimCategory !== factCategory) return false;
  const claimAliases = narrativeResourceAliases(claim);
  const factAliases = narrativeResourceAliases(fact);
  if (!claimAliases.length || !factAliases.length) return claimCategory && claimCategory === factCategory;
  return claimAliases.some((left) => factAliases.some((right) => narrativeResourceAliasCompatible(left, right)));
}

function narrativeResourceAliases(value = {}) {
  const data = normalizePlainObject(value);
  const category = normalizeOptionalText(data.category);
  const id = normalizeOptionalText(data.resourceId || data.id);
  const name = normalizeOptionalText(data.name);
  const aliases = compactUnique([id, name, category]).filter(Boolean);
  if (category === 'spellSlots' || /level\d+|法术位/u.test(`${id} ${name}`)) {
    const level = extractNarrativeSpellSlotLevel(name) || Number(String(id).match(/level(\d+)/i)?.[1]);
    aliases.push('法术位');
    if (Number.isFinite(level)) {
      aliases.push(`level${level}`, `${level}环法术位`, `${toSimpleChineseNumber(level)}环法术位`);
    }
  }
  if (category === 'ammo' || /arrows?|箭矢|弹药|子弹/u.test(`${id} ${name}`)) {
    aliases.push('ammo', '弹药', '箭矢', '箭', 'arrows', 'arrow');
  }
  if (category === 'actionEconomy') {
    if (/bonusAction|附赠/u.test(`${id} ${name}`)) aliases.push('bonusAction', '附赠动作');
    if (/reaction|反应/u.test(`${id} ${name}`)) aliases.push('reaction', '反应');
    if (/movement|移动/u.test(`${id} ${name}`)) aliases.push('movement', '移动力', '移动距离');
    if (/^action$|动作|行动/u.test(`${id} ${name}`)) aliases.push('action', '动作', '行动');
  }
  return compactUnique(aliases.map(normalizeNarrativeResourceComparable).filter(Boolean));
}

function narrativeResourceAliasCompatible(left = '', right = '') {
  const a = normalizeNarrativeResourceComparable(left);
  const b = normalizeNarrativeResourceComparable(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function normalizeNarrativeResourceComparable(value = '') {
  return normalizeOptionalText(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function toSimpleChineseNumber(value) {
  const number = Number(value);
  const map = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (Number.isInteger(number) && number >= 1 && number <= 10) return map[number];
  return String(value);
}

function normalizeNarrativeCurrencyClaimText(text = '') {
  return String(text || '').replace(
    /(下品|低品|中品|上品|高品)\s*([零一二两三四五六七八九十百千万\d]+)\s*(?:个|枚|块|颗|份)?\s*灵石/gu,
    '$1灵石$2'
  );
}

function reviewNarrativeEquipmentClaims(text = '', facts = {}) {
  const issues = [];
  const equipped = new Map(normalizeList(facts.equipment).map((item) => [normalizeOptionalText(item.name), item]));
  const removed = new Map(normalizeList(facts.equipmentRemovals).map((item) => [normalizeOptionalText(item.name), item]));
  for (const claim of extractNarrativeEquipmentClaims(text)) {
    if (claim.action === 'equip' && !equipped.has(claim.name)) {
      issues.push({ kind: 'unwritten_equipment_claim', name: claim.name, context: claim.context });
    }
    if (claim.action === 'unequip' && !removed.has(claim.name)) {
      issues.push({ kind: 'unwritten_equipment_removal_claim', name: claim.name, context: claim.context });
    }
  }
  return issues;
}

function extractNarrativeEquipmentClaims(text = '') {
  const claims = [];
  const patterns = [
    {
      action: 'equip',
      pattern: /(?:装备|穿上|戴上|佩戴|握住|持有|换上|装上)\s*([^,，.。;；:：\n\r]{1,24}?(?:剑|刀|枪|弓|弩|杖|盾|甲|铠|靴|袍|冠|戒指|项链|护符|法器|武器|护甲|盔甲))/gu
    },
    {
      action: 'equip',
      pattern: /([^,，.。;；:：\n\r]{1,24}?(?:剑|刀|枪|弓|弩|杖|盾|甲|铠|靴|袍|冠|戒指|项链|护符|法器|武器|护甲|盔甲))\s*(?:已经|已)?(?:装备|穿上|戴上|佩戴|握住|持有|换上|装上)/gu
    },
    {
      action: 'unequip',
      pattern: /(?:卸下|脱下|摘下|取下|解除装备|收起)\s*([^,，.。;；:：\n\r]{1,24}?(?:剑|刀|枪|弓|弩|杖|盾|甲|铠|靴|袍|冠|戒指|项链|护符|法器|武器|护甲|盔甲))/gu
    },
    {
      action: 'unequip',
      pattern: /([^,，.。;；:：\n\r]{1,24}?(?:剑|刀|枪|弓|弩|杖|盾|甲|铠|靴|袍|冠|戒指|项链|护符|法器|武器|护甲|盔甲))\s*(?:已经|已)?(?:卸下|脱下|摘下|取下|解除装备|收起)/gu
    }
  ];
  for (const { action, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanNarrativeEquipmentClaimName(match[1]);
      if (!name) continue;
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (hasNarrativeNegation(context)) continue;
      claims.push({ action, name, context });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativeEquipmentClaimName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:你|我|他|她|其|旁白|行动结果|已经|已|了|将|把|这把|这个|一把|一面|一件|一枚|一条)/u, '')
    .replace(/^(?:装备|穿上|戴上|佩戴|握住|持有|换上|装上|卸下|脱下|摘下|取下|解除装备|收起)/u, '')
    .replace(/(?:已经|已)?(?:装备|穿上|戴上|佩戴|握住|持有|换上|装上|卸下|脱下|摘下|取下|解除装备|收起)$/u, '')
    .trim();
}

function reviewNarrativeSkillClaims(text = '', facts = {}, plannedDefinitionFacts = {}) {
  const issues = [];
  const allowed = normalizeList(facts.skills).filter((skill) => normalizeOptionalText(skill.name));
  const plannedDefinitions = normalizeList(plannedDefinitionFacts.skills).filter((skill) => normalizeOptionalText(skill.name));
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{1,16}(?:功法|技能|法术|招式|剑诀|心法|身法|秘术|术法))/gu;
  for (const match of text.matchAll(pattern)) {
    const name = cleanNarrativeSkillClaimName(match[1]);
    const context = claimWindow(text, match.index || 0, name.length);
    if (!/(学会|习得|掌握|写入|已记录|加入技能|技能栏|skillBar)/u.test(context) || hasNarrativeNegation(context)) continue;
    const fact = findNarrativeMechanicFact(allowed, name, SKILL_NAME_SUFFIX_PATTERN);
    if (!fact) {
      const plannedDefinition = findNarrativeMechanicFact(plannedDefinitions, name, SKILL_NAME_SUFFIX_PATTERN);
      if (plannedDefinition && isSkillAcquisitionClaim(context)) {
        issues.push({ kind: 'skill_definition_only_claimed_as_learned', name, context });
        continue;
      }
      issues.push({ kind: 'unwritten_skill_claim', name, context });
      continue;
    }
    if (isSkillAcquisitionClaim(context) && fact.definitionOnly) {
      issues.push({ kind: 'skill_definition_only_claimed_as_learned', name, context });
    }
  }
  return issues;
}

function cleanNarrativeSkillClaimName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:你|我|他|她|其|旁白|行动结果|新的|新|一个|一项|该|这个)/u, '')
    .replace(/^(?:学会|习得|掌握|获得|修成|练成|写入|记录|登记|新增|加入)/u, '')
    .trim();
}

const SKILL_NAME_SUFFIX_PATTERN = /(?:功法|技能|法术|招式|剑诀|心法|身法|秘术|术法)$/iu;
const FEAT_NAME_SUFFIX_PATTERN = /(?:专长|天赋|特质|特性|专精|perk|feat|talent|trait)$/iu;

function findNarrativeMechanicFact(facts = [], claimedName = '', suffixPattern = /$/u) {
  const claimed = normalizeNarrativeMechanicComparable(claimedName, suffixPattern);
  if (!claimed) return null;
  return normalizeList(facts).find((fact) => narrativeMechanicNamesCompatible(claimed, fact.name, suffixPattern)) || null;
}

function narrativeMechanicNamesCompatible(normalizedClaim = '', writtenName = '', suffixPattern = /$/u) {
  const written = normalizeNarrativeMechanicComparable(writtenName, suffixPattern);
  if (!normalizedClaim || !written) return false;
  return normalizedClaim === written || normalizedClaim.includes(written) || written.includes(normalizedClaim);
}

function normalizeNarrativeMechanicComparable(value = '', suffixPattern = /$/u) {
  return normalizeOptionalText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(suffixPattern, '');
}

function isSkillAcquisitionClaim(context = '') {
  return /(?:学会|习得|掌握|加入技能|技能栏|skillBar|learned|unlocked|acquired)/iu.test(context);
}

function reviewNarrativeFeatClaims(text = '', facts = {}, plannedDefinitionFacts = {}) {
  const issues = [];
  const allowed = normalizeList(facts.feats).filter((feat) => normalizeOptionalText(feat.name));
  const plannedDefinitions = normalizeList(plannedDefinitionFacts.feats).filter((feat) => normalizeOptionalText(feat.name));
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{1,16}(?:专长|天赋|特质|特性|专精|perk|feat|talent|trait))/giu;
  for (const match of text.matchAll(pattern)) {
    const name = cleanNarrativeFeatClaimName(match[1]);
    if (!name) continue;
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (!isPositiveFeatClaim(context) || hasNarrativeNegation(context)) continue;
    const fact = findNarrativeMechanicFact(allowed, name, FEAT_NAME_SUFFIX_PATTERN);
    if (!fact) {
      const plannedDefinition = findNarrativeMechanicFact(plannedDefinitions, name, FEAT_NAME_SUFFIX_PATTERN);
      if (plannedDefinition && isFeatAcquisitionClaim(context)) {
        issues.push({ kind: 'feat_definition_only_claimed_as_acquired', name, context });
        continue;
      }
      issues.push({ kind: 'unwritten_feat_claim', name, context });
      continue;
    }
    if (isFeatAcquisitionClaim(context) && fact.definitionOnly) {
      issues.push({ kind: 'feat_definition_only_claimed_as_acquired', name, context });
    }
  }
  return issues;
}

function cleanNarrativeFeatClaimName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:你|我|他|她|其|旁白|行动结果|新的|新|一个|一项|该|这个)/u, '')
    .replace(/^(?:获得|取得|解锁|习得|学会|掌握|拥有|觉醒|激活|写入|记录|登记|新增|加入)/u, '')
    .trim();
}

function isPositiveFeatClaim(context = '') {
  return /(?:获得|取得|解锁|习得|学会|掌握|拥有|觉醒|激活|写入|记录|登记|新增|加入|专长栏|天赋栏|特质栏|feat|perk|talent|trait)/iu.test(context);
}

function isFeatAcquisitionClaim(context = '') {
  return /(?:获得|取得|解锁|习得|学会|掌握|拥有|觉醒|激活|加入专长栏|加入天赋栏|加入特质栏|gained|learned|unlocked|acquired)/iu.test(context);
}

function reviewNarrativeStatusClaims(text = '', facts = {}) {
  const issues = [];
  const allowed = normalizeList(facts.statuses).filter((status) => normalizeOptionalText(status.name));
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{1,16})(?:状态|效果|buff|debuff)/giu;
  for (const match of text.matchAll(pattern)) {
    const name = cleanNarrativeStatusClaimName(match[1]);
    if (!name || /当前|等待|特殊|战斗|角色|玩家/u.test(name)) continue;
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (!/(获得|进入|陷入|附加|施加|写入|加入|记录|新增|生效|激活|受到)/u.test(context) || hasNarrativeNegation(context)) continue;
    const fact = findNarrativeStatusFact(allowed, name);
    if (!fact || fact.definitionOnly || fact.active === false) {
      issues.push({ kind: 'unwritten_status_claim', name, context });
    }
  }
  return issues;
}

function findNarrativeStatusFact(statuses = [], claimedName = '') {
  const claimed = normalizeNarrativeStatusComparable(claimedName);
  if (!claimed) return null;
  return normalizeList(statuses).find((status) => narrativeStatusNamesCompatible(claimed, status.name)) || null;
}

function narrativeStatusNamesCompatible(normalizedClaim = '', writtenName = '') {
  const written = normalizeNarrativeStatusComparable(writtenName);
  if (!normalizedClaim || !written) return false;
  return normalizedClaim === written || normalizedClaim.includes(written) || written.includes(normalizedClaim);
}

function normalizeNarrativeStatusComparable(value = '') {
  return normalizeOptionalText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/(?:状态|效果|buff|debuff)$/iu, '');
}

function cleanNarrativeStatusClaimName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:你|我|他|她|其|旁白|行动结果)/u, '')
    .replace(/^(?:获得|进入|陷入|附加|施加|写入|加入|记录|新增|受到|处于|变为)/u, '')
    .trim();
}

function reviewNarrativeActorValueClaims(text = '', facts = {}) {
  const issues = [];
  const valuesByField = new Map();
  for (const fact of normalizeList(facts.actorValues)) {
    const field = normalizeNarrativeValueField(fact.field);
    if (!field) continue;
    valuesByField.set(field, fact);
  }
  const absolutePattern = /(HP|hp|生命值|气血|体力|灵力|法力|MP|mp|mana)\s*(?:变为|更新为|剩余|降至|升至|写入|记录|=|：|:)?\s*([零一二两三四五六七八九十百千万\d]+)?/giu;
  for (const match of text.matchAll(absolutePattern)) {
    const field = normalizeNarrativeValueField(match[1]);
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (!/(变为|更新为|剩余|降至|升至|写入|记录|扣除|损失|减少|增加|恢复|=|：|:)/u.test(context) || hasNarrativeNegation(context)) continue;
    const fact = valuesByField.get(field);
    if (!fact) {
      issues.push({ kind: 'unwritten_actor_value_claim', field, label: match[1], context });
      continue;
    }
    const claimedValue = parseNarrativeQuantity(match[2]);
    const writtenValue = Number(fact.value);
    if (claimedValue !== undefined && Number.isFinite(writtenValue) && claimedValue !== writtenValue) {
      issues.push({ kind: 'actor_value_mismatch', field, label: match[1], claimedValue, writtenValue, context });
    }
  }
  const deltaPattern = /(?:扣除|损失|减少|增加|恢复)\s*([零一二两三四五六七八九十百千万\d]+)\s*点?\s*(HP|hp|生命值|气血|体力|灵力|法力|MP|mp|mana)/giu;
  for (const match of text.matchAll(deltaPattern)) {
    const field = normalizeNarrativeValueField(match[2]);
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (hasNarrativeNegation(context)) continue;
    if (!valuesByField.has(field)) issues.push({ kind: 'unwritten_actor_value_delta_claim', field, label: match[2], context });
  }
  return issues;
}

function normalizeNarrativeValueField(value = '') {
  const text = normalizeOptionalText(value).toLowerCase();
  if (!text) return '';
  if (['hp', '生命值', '气血'].includes(text)) return 'hp';
  if (['mp', 'mana', '灵力', '法力'].includes(text)) return 'mp';
  if (['体力'].includes(text)) return 'stamina';
  return text;
}

function reviewNarrativeEntityClaims(text = '', facts = {}, kind = 'npc') {
  const listKey = kind === 'map' ? 'maps' : 'npcs';
  const allowed = new Set(normalizeList(facts[listKey]).map((entry) => normalizeOptionalText(entry.name)).filter(Boolean));
  const issues = [];
  for (const claim of extractNarrativeEntityWriteClaims(text, kind)) {
    if (!entityClaimMatchesAllowed(claim.name, allowed, kind)) {
      issues.push({ kind: `unwritten_${kind}_claim`, name: claim.name, context: claim.context });
    }
  }
  return issues;
}

function extractNarrativeEntityWriteClaims(text = '', kind = 'npc') {
  const claims = [];
  const labels = kind === 'map'
    ? ['新地图', '新地点', '地点', '地图']
    : ['新NPC', '新人物', 'NPC', '人物'];
  const labelPattern = labels.map(escapeRegExpForNarrative).join('|');
  const pattern = new RegExp(`(?:${labelPattern})[「『“"]?([^,，.。;；:：\\n\\r]{1,28})[」』”"]?`, 'gu');
  for (const match of text.matchAll(pattern)) {
    const name = cleanNarrativeEntityClaimName(match[1], kind);
    if (!name) continue;
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (!isPositiveEntityWriteClaim(context)) continue;
    claims.push({ name, context });
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativeEntityClaimName(value = '', kind = 'npc') {
  const cleaned = normalizeOptionalText(value)
    .replace(/(?:已经|已)?(?:记录|写入|登场|加入|开放|创建|新增|入库|可用|出现|建立).+$/u, '')
    .replace(/(?:已经|已)$/u, '')
    .replace(/^(?:了|一个|一位|一名|名为|叫做|叫|为|：|:)/u, '')
    .trim();
  if (!cleaned || cleaned.length < 2) return '';
  return kind === 'npc' ? (stripNarrativeRolePrefix(cleaned) || cleaned) : cleaned;
}

function stripNarrativeRolePrefix(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:铁匠|掌柜|老板娘|老板|猎人|矿工|修士|道士|巫师|护卫|长老|弟子|商人|炼丹师|药师|阵法师|剑修|医师|镖师|队长|祭司|学徒)/u, '')
    .trim();
}

function entityClaimMatchesAllowed(name = '', allowed = new Set(), kind = 'npc') {
  if (!name) return false;
  if (allowed.has(name)) return true;
  if (kind === 'npc') {
    const stripped = stripNarrativeRolePrefix(name);
    if (stripped && allowed.has(stripped)) return true;
  }
  return false;
}

function isPositiveEntityWriteClaim(context = '') {
  const text = normalizeOptionalText(context);
  return Boolean(text)
    && /(已记录|写入|登场|加入|开放|创建|新增|入库|可用|已经记录|已经写入|已经开放|已经创建)/u.test(text)
    && !hasNarrativeNegation(text);
}

function reviewNarrativeSceneNpcClaims(text = '', facts = {}) {
  const issues = [];
  const mounted = normalizeList(facts.sceneNpcs);
  const departed = normalizeList(facts.sceneNpcDepartures);
  for (const claim of extractNarrativeSceneNpcClaims(text)) {
    if (claim.claimedStatus === 'departed') {
      const matches = findNarrativeSceneNpcMatches(claim.name, departed);
      if (!matches.length) {
        issues.push({ kind: 'unwritten_scene_npc_departure_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
      }
      continue;
    }
    const matches = findNarrativeSceneNpcMatches(claim.name, mounted);
    if (!matches.length) {
      issues.push({ kind: 'unwritten_scene_npc_presence_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
      continue;
    }
    const compatible = matches.some((npc) => narrativeSceneNpcStatusCompatible(claim.claimedStatus, npc));
    if (!compatible) {
      issues.push({
        kind: 'scene_npc_status_mismatch',
        name: claim.name,
        claimedStatus: claim.claimedStatus,
        writtenStatuses: matches.map(normalizeWrittenSceneNpcStatus).filter(Boolean),
        context: claim.context
      });
    }
  }
  return issues;
}

function extractNarrativeSceneNpcClaims(text = '') {
  const claims = [];
  const patterns = [
    {
      status: 'present',
      pattern: /([\u4e00-\u9fa5A-Za-z0-9]{2,18})\s*(?:已经|已|突然|正|正在|也)?\s*(?:出现|登场|现身|来到|走到|进入)\s*(?:在)?\s*(?:你|我|主角|玩家)?(?:的)?(?:眼前|面前|身边|附近|当前场景|场景|视野里|面前不远处)/gu
    },
    {
      status: 'present',
      pattern: /(?:眼前|面前|身边|附近|当前场景|场景|视野里)\s*(?:出现|登场|现身|来了|站着|站着的是|有)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,18})/gu
    },
    {
      status: 'present',
      pattern: /([\u4e00-\u9fa5A-Za-z0-9]{2,18})\s*(?:已经|已|正|正在)?\s*(?:在场|就在这里|站在(?:你|我|主角|玩家)?(?:的)?(?:眼前|面前|身边|附近)|位于当前场景|处于当前场景)/gu
    },
    {
      status: 'departed',
      pattern: /([\u4e00-\u9fa5A-Za-z0-9]{2,18})\s*(?:已经|已|突然|终于)?\s*(?:离开|离去|退场|消失|不见|撤离)\s*(?:了)?\s*(?:当前场景|场景|你|我|主角|玩家|眼前|面前|身边|附近|视野)?/gu
    },
    {
      status: 'departed',
      pattern: /(?:当前场景|场景|眼前|面前|身边|附近|视野里)\s*(?:不再有|已经没有|没有了|少了)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,18})/gu
    }
  ];
  for (const { pattern, status } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanNarrativeSceneNpcName(match[1]);
      if (!name || looksLikeFactionName(name) || looksLikeNonSceneNpcName(name)) continue;
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (!isPositiveSceneNpcClaimContext(context, status)) continue;
      claims.push({ name, claimedStatus: status, context });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativeSceneNpcName(value = '') {
  const cleaned = String(normalizeOptionalText(value) || '')
    .replace(/^(?:旁白|行动结果|你|我|玩家|主角|角色|新的|新|NPC|人物|怪物|妖兽|魔兽|敌人|一位|一名|一个|这名|这位|名为|叫做|叫|为|：|:)/u, '')
    .replace(/(?:已经|已|突然|正|正在|也|了)$/u, '')
    .trim();
  if (!cleaned || cleaned.length < 2) return '';
  return stripNarrativeRolePrefix(cleaned) || cleaned;
}

function looksLikeNonSceneNpcName(value = '') {
  return /(?:当前场景|场景|眼前|面前|身边|附近|视野|队伍|小队|路线|通路|地图|地点|任务|委托|线索|状态|效果|技能|功法|背包|物品|灵石|丹药|钥匙)$/u.test(normalizeOptionalText(value) || '');
}

function isPositiveSceneNpcClaimContext(context = '', status = '') {
  const text = normalizeOptionalText(context);
  if (!text || hasNarrativeNegation(text) || isHypotheticalResolutionContext(text)) return false;
  if (/(传闻|据说|听说|可能|也许|将会|会在|曾经|过去|历史|记录为背景|描述为背景).{0,12}(?:出现|登场|现身|来到|离开|离去|退场|消失|不见)/u.test(text)) return false;
  if (status === 'departed') {
    return /(离开|离去|退场|消失|不见|撤离|不再有|已经没有|没有了).{0,18}(?:当前场景|场景|你|我|主角|玩家|眼前|面前|身边|附近|视野)?/u.test(text);
  }
  return /(出现|登场|现身|来到|走到|进入|在场|就在这里|站在|位于当前场景|处于当前场景).{0,18}(?:当前场景|场景|你|我|主角|玩家|眼前|面前|身边|附近|视野|这里)?/u.test(text)
    || /(?:眼前|面前|身边|附近|当前场景|场景|视野里).{0,12}(?:出现|登场|现身|来了|站着|有)/u.test(text);
}

function findNarrativeSceneNpcMatches(name = '', npcs = []) {
  const targetNames = compactUnique([name, stripNarrativeRolePrefix(name)]).filter(Boolean);
  return normalizeList(npcs).filter((npc) => {
    const candidates = compactUnique([
      npc.name,
      stripNarrativeRolePrefix(npc.name),
      npc.npcId,
      npc.id
    ]).filter(Boolean);
    return targetNames.some((target) => candidates.some((candidate) => narrativeSceneNpcNamesCompatible(target, candidate)));
  });
}

function narrativeSceneNpcNamesCompatible(claimed = '', written = '') {
  const left = normalizeNarrativeSceneNpcComparable(claimed);
  const right = normalizeNarrativeSceneNpcComparable(written);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeNarrativeSceneNpcComparable(value = '') {
  return String(normalizeOptionalText(value) || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^(?:npc|monster|enemy|妖兽|魔兽|怪物|敌人|人物|角色)/u, '');
}

function normalizeWrittenSceneNpcStatus(npc = {}) {
  const status = String(normalizeOptionalText(npc.status) || '').toLowerCase();
  const visibility = String(normalizeOptionalText(npc.visibility) || '').toLowerCase();
  if (['inactive', 'departed', 'dead', 'removed'].includes(status)) return 'departed';
  if (['hidden', 'unknown', 'offscreen'].includes(visibility)) return 'hidden';
  return status || 'present';
}

function narrativeSceneNpcStatusCompatible(claimed = '', npc = {}) {
  const claim = normalizeOptionalText(claimed);
  const written = normalizeWrittenSceneNpcStatus(npc);
  if (!claim || !written) return false;
  if (claim === written) return true;
  if (claim === 'present' && ['present', 'nearby', 'visible'].includes(written)) return true;
  return false;
}

function reviewNarrativeSceneMapClaims(text = '', facts = {}) {
  const issues = [];
  const mounted = normalizeList(facts.sceneMaps);
  const removed = normalizeList(facts.sceneMapRemovals);
  for (const claim of extractNarrativeSceneMapClaims(text)) {
    if (claim.claimedStatus === 'removed') {
      const matches = findNarrativeSceneMapMatches(claim.name, removed);
      if (!matches.length) {
        issues.push({ kind: 'unwritten_scene_map_removal_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
      }
      continue;
    }
    const matches = findNarrativeSceneMapMatches(claim.name, mounted);
    if (!matches.length) {
      issues.push({ kind: 'unwritten_scene_map_presence_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
      continue;
    }
    const compatible = matches.some((map) => narrativeSceneMapStatusCompatible(claim.claimedStatus, map));
    if (!compatible) {
      issues.push({
        kind: 'scene_map_status_mismatch',
        name: claim.name,
        claimedStatus: claim.claimedStatus,
        writtenStatuses: matches.map(normalizeWrittenSceneMapStatus).filter(Boolean),
        context: claim.context
      });
    }
  }
  return issues;
}

function extractNarrativeSceneMapClaims(text = '') {
  const claims = [];
  const mapName = '([^,，.。;；:：\\n\\r]{2,28}?(?:井底|洞府|洞窟|遗迹|山谷|森林|城镇|酒馆|矿井|秘境|坊市|宗门|山门|营地|村落|城市|城|镇|村|塔|峰|谷|殿|宫|寺|庙|湖|河|港|区域|地点|地图))';
  const patterns = [
    {
      status: 'active',
      pattern: new RegExp(`(?:当前场景|当前地点|所在地点|所在位置|场景地图|地图面板|眼前区域|眼前地点)\\s*(?:已经|已|现在)?\\s*(?:变为|更新为|设为|显示|挂载|载入|进入|抵达|到达|来到|是|为|：|:)\\s*${mapName}`, 'gu')
    },
    {
      status: 'active',
      pattern: new RegExp(`${mapName}\\s*(?:已经|已|现在)?\\s*(?:成为|变为|写入|挂载|显示在|载入|进入)\\s*(?:当前场景|当前地点|所在地点|所在位置|场景地图|地图面板|眼前区域|眼前地点)`, 'gu')
    },
    {
      status: 'removed',
      pattern: new RegExp(`${mapName}\\s*(?:已经|已|现在)?\\s*(?:移出|卸载|离开|关闭|不再显示|不再是)\\s*(?:当前场景|当前地点|所在地点|所在位置|场景地图|地图面板|眼前区域|眼前地点)?`, 'gu')
    },
    {
      status: 'removed',
      pattern: new RegExp(`(?:当前场景|当前地点|所在地点|所在位置|场景地图|地图面板|眼前区域|眼前地点)\\s*(?:不再显示|已经没有|没有了|卸载了|移出了)\\s*${mapName}`, 'gu')
    }
  ];
  for (const { pattern, status } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawName = match[1] || match[2];
      const name = cleanNarrativeSceneMapName(rawName);
      if (!name || looksLikeNonSceneMapName(name)) continue;
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (!isPositiveSceneMapClaimContext(context, status)) continue;
      claims.push({ name, claimedStatus: status, context });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativeSceneMapName(value = '') {
  const cleaned = String(normalizeOptionalText(value) || '')
    .replace(/^(?:旁白|行动结果|你|我|玩家|主角|角色|新的|新|地图|地点|区域|场景|当前场景|当前地点|所在地点|所在位置|一个|一处|这处|这里|为|是|：|:)/u, '')
    .replace(/(?:已经|已|现在|了)$/u, '')
    .trim();
  if (!cleaned || cleaned.length < 2) return '';
  return cleaned;
}

function looksLikeNonSceneMapName(value = '') {
  return /(?:队伍|小队|队友|同伴|NPC|人物|怪物|妖兽|魔兽|敌人|任务|委托|线索|状态|效果|技能|功法|背包|物品|灵石|丹药|钥匙)$/u.test(normalizeOptionalText(value) || '');
}

function isPositiveSceneMapClaimContext(context = '', status = '') {
  const text = normalizeOptionalText(context);
  if (!text || hasNarrativeNegation(text) || isHypotheticalResolutionContext(text)) return false;
  if (/(传闻|据说|听说|可能|也许|将会|会在|曾经|过去|历史|记录为背景|描述为背景).{0,12}(?:当前场景|当前地点|地图面板|变为|进入|抵达|显示|挂载|卸载|移出)/u.test(text)) return false;
  if (status === 'removed') {
    return /(移出|卸载|离开|关闭|不再显示|不再是|已经没有|没有了).{0,18}(?:当前场景|当前地点|所在地点|所在位置|场景地图|地图面板|眼前区域|眼前地点)?/u.test(text);
  }
  return /(?:当前场景|当前地点|所在地点|所在位置|场景地图|地图面板|眼前区域|眼前地点).{0,14}(?:变为|更新为|设为|显示|挂载|载入|进入|抵达|到达|来到|是|为|：|:)/u.test(text)
    || /(?:成为|变为|写入|挂载|显示在|载入|进入).{0,14}(?:当前场景|当前地点|所在地点|所在位置|场景地图|地图面板|眼前区域|眼前地点)/u.test(text);
}

function findNarrativeSceneMapMatches(name = '', maps = []) {
  const targetNames = compactUnique([name]).filter(Boolean);
  return normalizeList(maps).filter((map) => {
    const candidates = compactUnique([
      map.name,
      map.mapId,
      map.id
    ]).filter(Boolean);
    return targetNames.some((target) => candidates.some((candidate) => narrativeSceneMapNamesCompatible(target, candidate)));
  });
}

function narrativeSceneMapNamesCompatible(claimed = '', written = '') {
  const left = normalizeNarrativeSceneMapComparable(claimed);
  const right = normalizeNarrativeSceneMapComparable(written);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeNarrativeSceneMapComparable(value = '') {
  return String(normalizeOptionalText(value) || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^(?:map|location|地图|地点|区域|场景)/u, '');
}

function normalizeWrittenSceneMapStatus(map = {}) {
  const status = String(normalizeOptionalText(map.status) || '').toLowerCase();
  const visibility = String(normalizeOptionalText(map.visibility) || '').toLowerCase();
  if (['inactive', 'removed', 'unreachable', 'collapsed'].includes(status)) return 'removed';
  if (['hidden', 'unknown', 'fogged', 'secret', 'offscreen'].includes(visibility)) return 'hidden';
  return status || 'active';
}

function narrativeSceneMapStatusCompatible(claimed = '', map = {}) {
  const claim = normalizeOptionalText(claimed);
  const written = normalizeWrittenSceneMapStatus(map);
  if (!claim || !written) return false;
  if (claim === written) return true;
  if (claim === 'active' && ['active', 'visible', 'discovered'].includes(written)) return true;
  return false;
}

function reviewNarrativeMapRouteClaims(text = '', facts = {}) {
  const issues = [];
  const maps = normalizeList(facts.maps);
  const routes = normalizeList(facts.mapRoutes);
  const mapNameById = new Map(maps.map((map) => [normalizeOptionalText(map.id || map.mapId), normalizeOptionalText(map.name)]).filter(([id, name]) => id && name));
  for (const claim of extractNarrativeMapRouteWriteClaims(text)) {
    if (!narrativeMapRouteClaimMatches(claim.name, { routes, mapNameById })) {
      issues.push({ kind: 'unwritten_map_route_claim', name: claim.name, context: claim.context });
    }
  }
  if (!maps.length) return issues;
  for (const map of maps) {
    const name = normalizeOptionalText(map.name);
    if (!name || !text.includes(name)) continue;
    const index = text.indexOf(name);
    const context = claimWindow(text, index, name.length);
    if (!/(可以|已经|已|路线|通路|道路|入口|出口).{0,10}(?:前往|抵达|通往|开放|连通|解锁)|(?:前往|抵达|通往).{0,10}(?:已|已经)?(?:开放|记录|写入)/u.test(context) || hasNarrativeNegation(context)) continue;
    const mapId = normalizeOptionalText(map.id || map.mapId);
    const matched = routes.some((route) => {
      const from = normalizeOptionalText(route.fromId);
      const to = normalizeOptionalText(route.toId);
      return from === mapId || to === mapId || from === name || to === name;
    });
    if (!matched && !hasNarrativeIssue(issues, 'unwritten_map_route_claim', name)) {
      issues.push({ kind: 'unwritten_map_route_claim', name, context });
    }
  }
  return issues;
}

function extractNarrativeMapRouteWriteClaims(text = '') {
  const claims = [];
  const patterns = [
    /(?:通往|前往|抵达|到达)\s*([^,，.。;；:：\n\r]{2,24}?)(?:的)?(?:路线|通路|道路|入口|出口)\s*(?:已经|已)?(?:开放|记录|写入|连通|解锁|可用)/gu,
    /(?:路线|通路|道路|入口|出口)[「『“"]?([^,，.。;；:：\n\r]{2,24})[」』”"]?\s*(?:已经|已)?(?:开放|记录|写入|连通|解锁|可用)/gu,
    /(?:可以|已经可以|已可以)\s*(?:前往|抵达|通往|到达)\s*([^,，.。;；:：\n\r]{2,24})/gu
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanNarrativeMapRouteTargetName(match[1]);
      if (!name) continue;
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (hasNarrativeNegation(context)) continue;
      claims.push({ name, context });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativeMapRouteTargetName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:新地图|新地点|地图|地点|去往|通往|前往|抵达|到达)/u, '')
    .replace(/(?:的)?(?:路线|通路|道路|入口|出口).+$/u, '')
    .replace(/^(?:了|一个|一处|：|:)/u, '')
    .trim();
}

function narrativeMapRouteClaimMatches(name = '', { routes = [], mapNameById = new Map() } = {}) {
  const target = normalizeOptionalText(name);
  if (!target) return false;
  return normalizeList(routes).some((route) => {
    const from = normalizeOptionalText(route.fromId);
    const to = normalizeOptionalText(route.toId);
    const fromName = normalizeOptionalText(route.fromName) || mapNameById.get(from);
    const toName = normalizeOptionalText(route.toName) || mapNameById.get(to);
    return [from, to, fromName, toName].some((value) => value === target || value?.includes?.(target) || target.includes(value));
  });
}

function reviewNarrativeNpcRelationshipClaims(text = '', facts = {}) {
  const issues = [];
  const npcs = normalizeList(facts.npcs);
  const relations = normalizeList(facts.npcRelations);
  const npcNamesById = new Map(npcs.map((npc) => [normalizeOptionalText(npc.id), normalizeOptionalText(npc.name)]).filter(([id, name]) => id && name));
  for (const claim of extractNarrativeNpcRelationshipWriteClaims(text)) {
    const matching = findNarrativeNpcRelationshipMatches(claim.name, { npcs, relations, npcNamesById });
    if (!matching.length) {
      issues.push({ kind: 'unwritten_npc_relationship_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
      continue;
    }
    const compatible = matching.some((relation) => relationshipStatusesCompatible(claim.claimedStatus, normalizeWrittenRelationshipStatus(relation)));
    if (!compatible && !hasNarrativeIssue(issues, 'npc_relationship_status_mismatch', claim.name)) {
      issues.push({
        kind: 'npc_relationship_status_mismatch',
        name: claim.name,
        claimedStatus: claim.claimedStatus,
        writtenStatuses: matching.map((relation) => normalizeWrittenRelationshipStatus(relation)).filter(Boolean),
        context: claim.context
      });
    }
  }
  if (!npcs.length) return issues;
  for (const npc of npcs) {
    const name = normalizeOptionalText(npc.name);
    if (!name || !text.includes(name)) continue;
    const context = claimWindow(text, text.indexOf(name), name.length);
    const claimedStatus = normalizeNarrativeRelationshipStatus(context);
    if (!claimedStatus || !/(我|你|玩家|主角|角色)/u.test(context) || hasNarrativeNegation(context)) continue;
    const matching = findNarrativeNpcRelationshipMatches(name, { npcs, relations, npcNamesById, npc });
    if (!matching.length) {
      issues.push({ kind: 'unwritten_npc_relationship_claim', name, claimedStatus, context });
      continue;
    }
    const compatible = matching.some((relation) => relationshipStatusesCompatible(claimedStatus, normalizeWrittenRelationshipStatus(relation)));
    if (!compatible) {
      issues.push({
        kind: 'npc_relationship_status_mismatch',
        name,
        claimedStatus,
        writtenStatuses: matching.map((relation) => normalizeWrittenRelationshipStatus(relation)).filter(Boolean),
        context
      });
    }
  }
  return issues;
}

function extractNarrativeNpcRelationshipWriteClaims(text = '') {
  const claims = [];
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,16})\s*(?:已经|已)?\s*(信任|友好|友善|支持|亲近|敌视|敌对|仇视|敌意)\s*(?:你|我|玩家|主角|角色)/gu;
  for (const match of text.matchAll(pattern)) {
    const name = cleanNarrativeRelationshipEntityName(match[1]);
    if (!name || looksLikeFactionName(name)) continue;
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (hasNarrativeNegation(context)) continue;
    const claimedStatus = normalizeNarrativeRelationshipStatus(match[2]);
    if (!claimedStatus) continue;
    claims.push({ name, claimedStatus, context });
  }
  return mergeNarrativeFactsByName(claims);
}

function findNarrativeNpcRelationshipMatches(name = '', { npcs = [], relations = [], npcNamesById = new Map(), npc } = {}) {
  const targetNames = compactUnique([name, stripNarrativeRolePrefix(name), npc?.name]).filter(Boolean);
  const targetIds = compactUnique([npc?.id, npc?.npcId]).filter(Boolean);
  return normalizeList(relations).filter((relation) => {
    const fromName = npcNamesById.get(normalizeOptionalText(relation.fromId)) || normalizeOptionalText(relation.fromName);
    const toName = npcNamesById.get(normalizeOptionalText(relation.toId)) || normalizeOptionalText(relation.toName);
    const fromId = normalizeOptionalText(relation.fromId);
    const toId = normalizeOptionalText(relation.toId);
    return targetNames.includes(fromName)
      || targetNames.includes(toName)
      || targetIds.includes(fromId)
      || targetIds.includes(toId)
      || normalizeList(npcs).some((candidate) => {
        const candidateName = normalizeOptionalText(candidate.name);
        const candidateId = normalizeOptionalText(candidate.id || candidate.npcId);
        return targetNames.includes(candidateName) && (candidateId === fromId || candidateId === toId);
      });
  });
}

function reviewNarrativePartyClaims(text = '', facts = {}) {
  const issues = [];
  const members = normalizeList(facts.partyMembers);
  const removals = normalizeList(facts.partyMemberRemovals);
  for (const claim of extractNarrativePartyClaims(text)) {
    if (claim.claimedStatus === 'removed') {
      const matchingRemovals = findNarrativePartyMemberMatches(claim.name, removals);
      if (!matchingRemovals.length) {
        issues.push({ kind: 'unwritten_party_member_removal_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
      }
      continue;
    }
    const matchingMembers = findNarrativePartyMemberMatches(claim.name, members);
    if (!matchingMembers.length) {
      issues.push({ kind: 'unwritten_party_member_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
      continue;
    }
    const compatible = matchingMembers.some((member) => narrativePartyStatusCompatible(claim.claimedStatus, member));
    if (!compatible) {
      issues.push({
        kind: 'party_member_status_mismatch',
        name: claim.name,
        claimedStatus: claim.claimedStatus,
        writtenStatuses: matchingMembers.map(normalizeWrittenPartyStatus).filter(Boolean),
        context: claim.context
      });
    }
  }
  return issues;
}

function extractNarrativePartyClaims(text = '') {
  const claims = [];
  const patterns = [
    {
      status: 'active',
      pattern: /([\u4e00-\u9fa5A-Za-z0-9]{2,16})\s*(?:已经|已|也|终于|正式)?\s*(?:加入|入队|归队|成为|变成|作为)\s*(?:了)?\s*(?:你|我|我方|我们|主角|玩家)?(?:的)?(?:队伍|小队|队友|同伴|伙伴|随从|一员|成员)/gu
    },
    {
      status: 'active',
      pattern: /(?:队友|同伴|伙伴|随从|队伍成员)[「『“"]?([\u4e00-\u9fa5A-Za-z0-9]{2,16})[」』”"]?\s*(?:已经|已)?(?:加入|入队|记录|写入|跟随|同行|随行)/gu
    },
    {
      status: 'following',
      pattern: /([\u4e00-\u9fa5A-Za-z0-9]{2,16})\s*(?:开始|继续|已经|已|也)?\s*(?:跟随|同行|随行|跟着)\s*(?:你|我|主角|玩家|队伍|小队|大家|一行人)/gu
    },
    {
      status: 'standby',
      pattern: /([\u4e00-\u9fa5A-Za-z0-9]{2,16})\s*(?:已经|已|继续|被安排)?\s*(?:留守|待命|留在后方|留在营地|原地待命)/gu
    },
    {
      status: 'assigned',
      pattern: /(?:队友|同伴|伙伴|队伍成员)?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,16})\s*(?:已经|已|被)?(?:派去|分配去|安排去|受命前往|前去)\s*[^,，.。;；:：\n\r]{0,18}(?:侦察|调查|打探|守卫|巡逻|护送|研究|待命)/gu
    },
    {
      status: 'removed',
      pattern: /([\u4e00-\u9fa5A-Za-z0-9]{2,16})\s*(?:已经|已|正式)?\s*(?:离队|退队|脱队|退出队伍|离开队伍|不再跟随|被移出队伍|从队伍移除|不再是(?:你|我|主角|玩家)?(?:的)?(?:队友|同伴|伙伴))/gu
    },
    {
      status: 'removed',
      pattern: /(?:将|把)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,16})\s*(?:移出|踢出|逐出)\s*(?:队伍|小队)/gu
    }
  ];
  for (const { pattern, status } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanNarrativePartyMemberName(match[1]);
      if (!name || looksLikeFactionName(name)) continue;
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (!isPositivePartyClaimContext(context, status)) continue;
      claims.push({
        name,
        claimedStatus: status,
        context
      });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativePartyMemberName(value = '') {
  const cleaned = normalizeOptionalText(value)
    .replace(/^(?:旁白|行动结果|你|我|玩家|主角|角色|新的|新|NPC|人物|队友|同伴|伙伴|随从|把|将|让|使|了|一位|一名|名为|叫做|叫|为|：|:)/u, '')
    .replace(/(?:已经|已|也|终于|正式|开始|继续|被安排|被)?$/u, '')
    .trim();
  if (!cleaned || cleaned.length < 2) return '';
  if (/^(?:队伍|小队|队友|同伴|伙伴|随从|大家|一行人)$/u.test(cleaned)) return '';
  return stripNarrativeRolePrefix(cleaned) || cleaned;
}

function isPositivePartyClaimContext(context = '', status = '') {
  const text = normalizeOptionalText(context);
  if (!text || hasNarrativeNegation(text) || isHypotheticalResolutionContext(text)) return false;
  if (status === 'removed') {
    return /(离队|退队|脱队|退出队伍|离开队伍|不再跟随|移出队伍|从队伍移除|踢出|逐出|不再是).{0,12}(?:队伍|小队|队友|同伴|伙伴|跟随)?/u.test(text);
  }
  if (status === 'following') {
    return /(跟随|同行|随行|跟着).{0,12}(?:你|我|主角|玩家|队伍|小队|大家|一行人)/u.test(text);
  }
  if (status === 'standby') {
    return /(留守|待命|留在后方|留在营地|原地待命)/u.test(text);
  }
  if (status === 'assigned') {
    return /(派去|分配去|安排去|受命前往|前去).{0,24}(?:侦察|调查|打探|守卫|巡逻|护送|研究|待命)/u.test(text);
  }
  return /(加入|入队|归队|成为|变成|作为|记录|写入|跟随|同行|随行).{0,12}(?:队伍|小队|队友|同伴|伙伴|随从|一员|成员)|(?:队伍|小队|队友|同伴|伙伴|随从).{0,12}(?:加入|入队|归队|记录|写入|跟随|同行|随行)/u.test(text);
}

function findNarrativePartyMemberMatches(name = '', members = []) {
  const targetNames = compactUnique([name, stripNarrativeRolePrefix(name)]).filter(Boolean);
  return normalizeList(members).filter((member) => {
    const candidates = compactUnique([
      member.name,
      stripNarrativeRolePrefix(member.name),
      member.memberId,
      member.npcId,
      member.playerId,
      member.id
    ]).filter(Boolean);
    return targetNames.some((target) => candidates.some((candidate) => narrativePartyNamesCompatible(target, candidate)));
  });
}

function narrativePartyNamesCompatible(claimed = '', written = '') {
  const left = normalizeNarrativePartyComparable(claimed);
  const right = normalizeNarrativePartyComparable(written);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeNarrativePartyComparable(value = '') {
  return String(normalizeOptionalText(value) || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^(?:npc|pc|party|member|队友|同伴|伙伴|随从)/u, '');
}

function normalizeWrittenPartyStatus(member = {}) {
  const membership = String(normalizeOptionalText(member.membershipStatus) || '').toLowerCase();
  const activity = String(normalizeOptionalText(member.activityStatus) || '').toLowerCase();
  if (['former', 'removed', 'dead', 'archived'].includes(membership) || ['dead', 'removed'].includes(activity)) return 'removed';
  if (activity === 'following') return 'following';
  if (activity === 'standby') return 'standby';
  if (activity === 'assigned') return 'assigned';
  if (['active', 'guest', 'reserve'].includes(membership)) return 'active';
  return membership || activity || 'active';
}

function narrativePartyStatusCompatible(claimed = '', member = {}) {
  const claim = normalizeOptionalText(claimed);
  const written = normalizeWrittenPartyStatus(member);
  if (!claim || !written) return false;
  if (claim === written) return true;
  if (claim === 'active' && ['active', 'following', 'standby', 'assigned'].includes(written)) return true;
  return false;
}

function reviewNarrativeFactionClaims(text = '', facts = {}) {
  const issues = [];
  const factions = normalizeList(facts.factions);
  const memberships = normalizeList(facts.factionMemberships);
  const relations = normalizeList(facts.factionRelations);
  const names = compactUnique([
    ...factions.map((faction) => faction.name),
    ...memberships.map((membership) => membership.factionName),
    ...relations.flatMap((relation) => [relation.fromFactionName, relation.toFactionName])
  ]).filter(Boolean);
  for (const claim of extractNarrativeFactionWriteClaims(text)) {
    if (!names.includes(claim.name)) {
      issues.push({ kind: 'unwritten_faction_claim', name: claim.name, claimedStatus: claim.claimedStatus, context: claim.context });
    }
  }
  for (const name of names) {
    if (!name || !text.includes(name)) continue;
    const pattern = new RegExp(escapeRegExpForNarrative(name), 'gu');
    for (const match of text.matchAll(pattern)) {
      const context = claimWindow(text, match.index || 0, name.length + 24);
      const claimedStatus = normalizeNarrativeRelationshipStatus(context);
      if (!claimedStatus || hasNarrativeNegation(context)) continue;
      const pairRelation = relations.find((relation) => {
        const fromName = normalizeOptionalText(relation.fromFactionName);
        const toName = normalizeOptionalText(relation.toFactionName);
        return fromName && toName && context.includes(fromName) && context.includes(toName);
      });
      if (pairRelation) {
        const writtenStatus = normalizeWrittenRelationshipStatus(pairRelation);
        if (!relationshipStatusesCompatible(claimedStatus, writtenStatus)) {
          issues.push({ kind: 'faction_relation_status_mismatch', name, claimedStatus, writtenStatus, context });
        }
      }
      if (/(我|你|玩家|主角|角色)/u.test(context)) {
        const matchingMemberships = memberships.filter((membership) => normalizeOptionalText(membership.factionName) === name || normalizeOptionalText(membership.factionId) === name);
        if (!matchingMemberships.length) {
          issues.push({ kind: 'unwritten_faction_membership_claim', name, claimedStatus, context });
          continue;
        }
        const compatible = matchingMemberships.some((membership) => relationshipStatusesCompatible(claimedStatus, normalizeWrittenRelationshipStatus(membership)));
        if (!compatible) {
          issues.push({
            kind: 'faction_membership_status_mismatch',
            name,
            claimedStatus,
            writtenStatuses: matchingMemberships.map((membership) => normalizeWrittenRelationshipStatus(membership)).filter(Boolean),
            context
          });
        }
      }
    }
  }
  return issues;
}

function reviewNarrativeQuestClaims(text = '', facts = {}) {
  const issues = [];
  const allowed = new Set(normalizeList(facts.quests).map((quest) => normalizeOptionalText(quest.title || quest.name || quest.id)).filter(Boolean));
  for (const claim of extractNarrativeQuestWriteClaims(text)) {
    if (!allowed.has(claim.title)) {
      issues.push({ kind: 'unwritten_quest_claim', title: claim.title, claimedStatus: claim.claimedStatus, context: claim.context });
    }
  }
  for (const quest of normalizeList(facts.quests)) {
    const title = normalizeOptionalText(quest.title || quest.name || quest.id);
    if (!title || !text.includes(title)) continue;
    const context = claimWindow(text, text.indexOf(title), title.length);
    if (!/(任务|委托|线索|目标).{0,12}(?:已记录|接下|追踪|完成|失败|放弃|更新)|(?:已记录|接下|追踪|完成|失败|放弃|更新).{0,12}(?:任务|委托|线索|目标)/u.test(context) || hasNarrativeNegation(context)) continue;
    const claimedStatus = normalizeNarrativeQuestStatus(context);
    const writtenStatus = normalizeNarrativeQuestStatus(quest.status || 'tracked');
    if (claimedStatus && writtenStatus && !questStatusesCompatible(claimedStatus, writtenStatus)) {
      issues.push({ kind: 'quest_status_mismatch', title, claimedStatus, writtenStatus, context });
    }
  }
  return issues;
}

function extractNarrativeFactionWriteClaims(text = '') {
  const claims = [];
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,18}(?:帮|宗|派|门|盟|商会|教|团|会|家|族))\s*(?:已经|已|开始)?\s*(敌视|敌对|仇视|敌意|友好|友善|信任|支持|亲近|紧张|结盟|中立|加入|归属)/gu;
  for (const match of text.matchAll(pattern)) {
    const name = cleanNarrativeRelationshipEntityName(match[1]);
    if (!name) continue;
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (hasNarrativeNegation(context)) continue;
    const claimedStatus = normalizeNarrativeRelationshipStatus(match[2]);
    if (!claimedStatus) continue;
    claims.push({ name, claimedStatus, context });
  }
  return mergeNarrativeFactsByName(claims);
}

function extractNarrativeQuestWriteClaims(text = '') {
  const claims = [];
  const patterns = [
    /([\u4e00-\u9fa5A-Za-z0-9]{2,30})(?:任务|委托|线索|目标)\s*(?:已经|已)?\s*(已记录|记录|接下|追踪|完成|失败|放弃|更新)/gu,
    /(?:任务|委托|线索|目标)[「『“"]?([^,，.。;；:：\n\r]{2,30})[」』”"]?\s*(?:已经|已)?\s*(已记录|记录|接下|追踪|完成|失败|放弃|更新)/gu
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const title = cleanNarrativeQuestTitle(match[1]);
      if (!title) continue;
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (hasNarrativeNegation(context)) continue;
      const claimedStatus = normalizeNarrativeQuestStatus(context);
      claims.push({ title, name: title, claimedStatus, context });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativeQuestTitle(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:旁白|行动结果|你|我|玩家|主角|角色|新的|新|一个|一项|已|已经|任务|委托|线索|目标)/u, '')
    .replace(/(?:已经|已)?(?:记录|接下|追踪|完成|失败|放弃|更新).+$/u, '')
    .trim();
}

function cleanNarrativeRelationshipEntityName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:旁白|行动结果|你|我|玩家|主角|角色|新的|新|NPC|人物|阵营|势力)/u, '')
    .trim();
}

function looksLikeFactionName(value = '') {
  return /(?:帮|宗|派|门|盟|商会|教|团|会|家|族)$/u.test(normalizeOptionalText(value));
}

function reviewNarrativeExtensionFactClaims(text = '', facts = {}) {
  const issues = [];
  const factsByName = new Map(normalizeList(facts.extensionFacts)
    .map((fact) => [normalizeOptionalText(fact.name), normalizePlainObject(fact)])
    .filter(([name]) => Boolean(name)));
  for (const fact of normalizeList(facts.extensionFacts)) {
    const name = normalizeOptionalText(fact.name);
    if (!name || !text.includes(name)) continue;
    const index = text.indexOf(name);
    const context = claimWindow(text, index, name.length + 16);
    if (hasNarrativeNegation(context)) continue;
    const claimedValue = extractClaimedFactValue(context, name);
    if (claimedValue === undefined) continue;
    const writtenValue = fact.value;
    if (!narrativeFactValuesEqual(claimedValue, writtenValue)) {
      issues.push({ kind: 'extension_fact_value_mismatch', name, claimedValue, writtenValue, context });
    }
  }
  for (const claim of extractNarrativeExtensionFactClaims(text)) {
    const fact = factsByName.get(claim.name);
    if (!fact) {
      issues.push({
        kind: 'unwritten_extension_fact_claim',
        name: claim.name,
        claimedValue: claim.value,
        context: claim.context
      });
      continue;
    }
    if (!narrativeFactValuesEqual(claim.value, fact.value) && !hasNarrativeIssue(issues, 'extension_fact_value_mismatch', claim.name)) {
      issues.push({
        kind: 'extension_fact_value_mismatch',
        name: claim.name,
        claimedValue: claim.value,
        writtenValue: fact.value,
        context: claim.context
      });
    }
  }
  return issues;
}

function extractNarrativeExtensionFactClaims(text = '') {
  const claims = [];
  const pattern = /([^,，.。;；\n\r:：]{1,24}?(?:指数|等级|参数|评分|浓度|危险度|稳定度|污染度|战力|威胁|波动|强度|纯度|品质|进度|熟练度|阈值|范围|上限|下限))\s*(?:目前|当前|现在)?\s*(?:记录为|写入为|设为|设置为|变为|更新为|为|是|=|：|:)\s*([A-Za-z甲乙丙丁戊己庚辛壬癸零一二两三四五六七八九十百千万\d.%-]{1,24})/gu;
  for (const match of text.matchAll(pattern)) {
    const name = cleanNarrativeExtensionFactName(match[1]);
    const value = normalizeNarrativeFactValue(match[2]);
    if (!name || !value) continue;
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (!isPositiveExtensionFactClaim(context)) continue;
    claims.push({ name, value, context });
  }
  return mergeNarrativeFactsByName(claims.map((claim) => ({
    name: claim.name,
    value: claim.value,
    context: claim.context
  })));
}

function cleanNarrativeExtensionFactName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:旁白|行动结果|结果|系统|记录|新增|写入|设定|设定项|扩展数据|当前|目前|现在|其|该|这个|此处|这里|你|我|玩家|主角|角色)/u, '')
    .replace(/^(?:的|：|:)+/u, '')
    .trim();
}

function isPositiveExtensionFactClaim(context = '') {
  const text = normalizeOptionalText(context);
  if (!text || hasNarrativeNegation(text)) return false;
  if (/(?:如果|若是|假如|可能|也许|建议|可以|可尝试|需要确认|尚待确认).{0,12}(?:指数|等级|参数|评分|浓度|危险度|稳定度|污染度|战力|威胁|波动|强度|纯度|品质|进度|熟练度|阈值|范围|上限|下限)/u.test(text)) return false;
  return /(?:指数|等级|参数|评分|浓度|危险度|稳定度|污染度|战力|威胁|波动|强度|纯度|品质|进度|熟练度|阈值|范围|上限|下限).{0,12}(?:记录为|写入为|设为|设置为|变为|更新为|为|是|=|：|:)/u.test(text);
}

function hasNarrativeIssue(issues = [], kind = '', name = '') {
  return normalizeList(issues).some((issue) => issue?.kind === kind && normalizeOptionalText(issue.name) === normalizeOptionalText(name));
}

function reviewNarrativeCombatClaims(text = '', grounding = {}) {
  const issues = [];
  const combat = normalizePlainObject(grounding.combat);
  for (const claim of extractNarrativeCombatStartClaims(text)) {
    if (!isGroundedCombatStart(combat)) {
      issues.push({
        kind: 'ungrounded_combat_start_claim',
        battleId: combat.battleId,
        battleStatus: combat.battleStatus,
        status: combat.status,
        context: claim.context
      });
    }
  }
  for (const claim of extractNarrativeCombatEnemyPresenceClaims(text)) {
    if (!isGroundedCombatEnemyPresence(combat, claim)) {
      issues.push({
        kind: 'ungrounded_combat_enemy_claim',
        name: claim.name,
        battleId: combat.battleId,
        battleStatus: combat.battleStatus,
        enemyIds: combat.enemyIds,
        enemyNames: combat.enemyNames,
        context: claim.context
      });
    }
  }
  for (const match of text.matchAll(/(?:战斗)?(?:胜利|获胜|胜出|已经结束|已结束|结束战斗|战斗结束)/gu)) {
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (hasNarrativeNegation(context)) continue;
    if (!isGroundedCombatVictory(combat)) {
      issues.push({
        kind: 'ungrounded_combat_victory_claim',
        battleStatus: combat.battleStatus,
        rewardStatus: combat.rewardStatus,
        context
      });
    }
  }
  for (const match of text.matchAll(/造成\s*([零一二两三四五六七八九十百千万\d]+)\s*点?(?:伤害|damage)/giu)) {
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (hasNarrativeNegation(context)) continue;
    const claimedDamage = parseNarrativeQuantity(match[1]);
    const writtenDamage = normalizeList(combat.damage).reduce((sum, damage) => sum + (Number(damage.amount) || 0), 0);
    if (!writtenDamage) {
      issues.push({ kind: 'unwritten_combat_damage_claim', claimedDamage, context });
    } else if (claimedDamage !== undefined && claimedDamage !== writtenDamage) {
      issues.push({ kind: 'combat_damage_mismatch', claimedDamage, writtenDamage, context });
    }
  }
  for (const match of text.matchAll(/(?:击杀|杀死|斩杀|射杀|猎杀|打倒|击倒|击败|干掉|放倒|死亡|死去|倒下|毙命|被杀|被击倒)/gu)) {
    const context = claimWindow(text, match.index || 0, match[0].length);
    if (!isPositiveCombatDefeatClaim(context, match[0], combat) || hasNarrativeNegation(context)) continue;
    if (!isGroundedCombatDefeat(combat)) {
      issues.push({
        kind: 'ungrounded_combat_defeat_claim',
        targetId: combat.targetId,
        targetName: combat.targetName,
        targetHp: combat.targetHp,
        targetDefeated: combat.targetDefeated,
        battleStatus: combat.battleStatus,
        context
      });
    }
  }
  return issues;
}

function extractNarrativeCombatStartClaims(text = '') {
  const claims = [];
  const patterns = [
    /(?:战斗|遭遇战|battle)\s*(?:已经|已)?(?:开始|开启|触发|打响|爆发|建立|生成|创建)/giu,
    /(?:开始|开启|触发|进入|切入|转入)\s*(?:一场)?(?:战斗|遭遇战|battle)/giu,
    /(?:开战|接战|交战|进入回合|进入战斗回合|战斗界面(?:已经|已)?打开|战斗轮次(?:开始|开启))/gu
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (hasNarrativeNegation(context) || isHypotheticalResolutionContext(context)) continue;
      claims.push({ context });
    }
  }
  return claims;
}

function extractNarrativeCombatEnemyPresenceClaims(text = '') {
  const claims = [];
  for (const clause of splitNarrativeClauses(text)) {
    if (hasNarrativeNegation(clause) || isHypotheticalResolutionContext(clause)) continue;
    if (!/(?:进入|加入|参战|入战|出现在|仍在|在场|当前战斗|战斗中|战场|面前)/u.test(clause)) continue;
    for (const name of extractNarrativeCombatEnemyTerms(clause)) {
      claims.push({
        name,
        context: clause
      });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function extractNarrativeCombatEnemyTerms(text = '') {
  const terms = [];
  for (const match of String(text || '').matchAll(/(?:[\u4e00-\u9fa5A-Za-z0-9]{0,8}(?:妖兽|魔兽|怪物)\d*|(?:敌人|敌方|敌手|monster|enemy)\d*)/giu)) {
    const name = cleanNarrativeCombatEnemyClaimName(match[0]);
    if (name) terms.push(name);
  }
  return compactUnique(terms);
}

function cleanNarrativeCombatEnemyClaimName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:你|我|他|她|其|旁白|行动结果|当前|新的|新|一只|一头|一个|两只|两头|两个)/u, '')
    .replace(/(?:已经|已|仍在|进入|加入|参战|入战|出现在|在场|当前战斗|战斗中|战场|面前|回合)$/u, '')
    .trim();
}

function isGroundedCombatStart(combat = {}) {
  return combat.battleStarted === true
    || (Boolean(combat.battleId) && /active|prepared|resolved/i.test(`${combat.battleStatus || ''} ${combat.status || ''}`))
    || normalizeOptionalText(combat.mode) === 'active_battle_action';
}

function isGroundedCombatEnemyPresence(combat = {}, claim = {}) {
  if (!isGroundedCombatStart(combat)) return false;
  const enemyIds = normalizeStringArray(combat.enemyIds);
  const enemyNames = normalizeStringArray(combat.enemyNames);
  const enemies = normalizeList(combat.enemies).map((enemy) => normalizeNarrativeCombatEnemy(enemy));
  const names = compactUnique([
    ...enemyNames,
    ...enemyIds,
    ...enemies.map((enemy) => enemy.name),
    ...enemies.map((enemy) => enemy.id)
  ].filter(Boolean));
  const enemyCount = firstFiniteNumber(combat.enemyCount, enemyIds.length, names.length, enemies.length) || 0;
  if (enemyCount <= 0 && !names.length) return false;
  const claimName = normalizeOptionalText(claim.name);
  if (!claimName || isGenericCombatEnemyTerm(claimName)) return true;
  return names.some((name) => narrativeCombatEnemyNamesCompatible(claimName, name));
}

function isGenericCombatEnemyTerm(name = '') {
  const text = normalizeNarrativeCombatEnemyComparable(name);
  if (/\d$/u.test(text)) return false;
  return /^(?:低级|中级|高级|普通|精英|强大|野生)?(?:妖兽|魔兽|怪物|敌人|敌方|敌手|monster|enemy)$/iu.test(text);
}

function narrativeCombatEnemyNamesCompatible(claimed = '', written = '') {
  const left = normalizeNarrativeCombatEnemyComparable(claimed);
  const right = normalizeNarrativeCombatEnemyComparable(written);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeNarrativeCombatEnemyComparable(value = '') {
  return normalizeOptionalText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^(?:低级|中级|高级|普通|精英|强大|野生)/u, '');
}

function reviewNarrativeMovementClaims(text = '', grounding = {}) {
  const issues = [];
  const movement = normalizePlainObject(grounding.movement);
  if (!movement || Object.keys(movement).length === 0) return issues;
  for (const claim of extractNarrativeMovementArrivalClaims(text)) {
    if (movement.found === false || normalizeOptionalText(movement.status) === 'path_unavailable') {
      issues.push({
        kind: 'ungrounded_movement_arrival_claim',
        name: claim.name,
        context: claim.context,
        status: movement.status,
        reason: movement.reason,
        startMapId: movement.startMapId,
        targetMapId: movement.targetMapId,
        missingMapIds: movement.missingMapIds
      });
      continue;
    }
    const targetNames = compactUnique([
      movement.targetMapId,
      movement.targetName,
      ...normalizeStringArray(movement.pathMapIds).slice(-1)
    ]).filter(Boolean);
    if (targetNames.length && claim.name && !targetNames.some((target) => narrativePlaceNamesCompatible(claim.name, target))) {
      issues.push({
        kind: 'movement_target_mismatch',
        name: claim.name,
        writtenTargets: targetNames,
        context: claim.context
      });
    }
  }
  return issues;
}

function extractNarrativeMovementArrivalClaims(text = '') {
  const claims = [];
  const patterns = [
    /(?:成功|顺利|已经|已)?\s*(?:抵达|到达|来到|进入|走进|穿过到|移动到|前往到)\s*([^,，.。;；:：\n\r]{1,24})/gu,
    /(?:当前位置|当前地点|所在地点|所在位置|位置)\s*(?:变为|更新为|设为|设置为|是|为|=|：|:)\s*([^,，.。;；:：\n\r]{1,24})/gu
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanNarrativeMovementPlaceName(match[1]);
      const context = claimWindow(text, match.index || 0, match[0].length);
      if (!name || !isPositiveMovementArrivalClaim(context, name)) continue;
      claims.push({ name, context });
    }
  }
  return mergeNarrativeFactsByName(claims);
}

function cleanNarrativeMovementPlaceName(value = '') {
  return normalizeOptionalText(value)
    .replace(/^(?:新地图|新地点|地图|地点|区域|场景|了|到|至|一处|一个|的)/u, '')
    .replace(/(?:之后|以后|附近|门口|入口|出口)$/u, '')
    .trim();
}

function isPositiveMovementArrivalClaim(context = '', placeName = '') {
  const text = normalizeOptionalText(context);
  if (!text || hasNarrativeNegation(text) || isHypotheticalResolutionContext(text)) return false;
  if (/(状态|效果|冷却|回合|战斗|界面|菜单|背包|技能|任务|记录|数据库|世界书)/u.test(placeName)) return false;
  if (/(进入|抵达|到达|来到|走进|移动到|当前位置|当前地点|所在地点|所在位置|位置)/u.test(text)
    && /(你|玩家|主角|角色|当前位置|当前地点|所在地点|所在位置|位置|行动结果|旁白)/u.test(text)) {
    return true;
  }
  return false;
}

function narrativePlaceNamesCompatible(claimed = '', written = '') {
  const left = normalizeNarrativePlaceComparable(claimed);
  const right = normalizeNarrativePlaceComparable(written);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeNarrativePlaceComparable(value = '') {
  return normalizeOptionalText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^(?:地图|地点|区域|场景)/u, '');
}

function reviewNarrativeContextFocusClaims(text = '', grounding = {}) {
  const issues = [];
  const focus = normalizePlainObject(grounding.contextFocus);
  const foreground = normalizePlainObject(focus.foreground);
  const foregroundKind = normalizeOptionalText(foreground.kind);
  if (focus.currentInputClass !== 'short_or_elliptic') return issues;
  if (focus.currentCombatExplicit === true) return issues;
  if (!['tracking', 'investigation', 'social'].includes(foregroundKind)) return issues;
  if (!normalizeOptionalText(focus.recentCombatHint)) return issues;

  const focusTargets = compactUnique([
    ...normalizeStringArray(focus.foregroundTargetCandidates),
    ...normalizeStringArray(foreground.targetCandidates)
  ]);
  if (focusTargets.some((target) => target && text.includes(target))) return issues;

  const staleTerms = buildStaleCombatTerms(focus.recentCombatHint);
  for (const clause of splitNarrativeClauses(text)) {
    if (!isStaleCombatEscapeClause(clause, staleTerms)) continue;
    issues.push({
      kind: 'stale_context_combat_target_claim',
      currentInput: focus.currentInput,
      foregroundKind,
      foregroundTargets: focusTargets,
      recentCombatHint: focus.recentCombatHint,
      context: clause
    });
  }
  return issues;
}

function buildStaleCombatTerms(recentCombatHint = '') {
  const text = normalizeOptionalText(recentCombatHint) || '';
  const terms = ['妖兽', '魔兽', '怪物', '敌人', '敌方', '敌手', 'monster', 'enemy'];
  for (const match of text.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{0,8}(?:妖兽|魔兽|怪物|敌人|敌方|敌手|monster|enemy)[\u4e00-\u9fa5A-Za-z0-9]{0,8}/giu)) {
    terms.push(match[0]);
  }
  return compactUnique(terms).slice(0, 24);
}

function isStaleCombatEscapeClause(clause = '', staleTerms = []) {
  const text = normalizeOptionalText(clause);
  if (!text) return false;
  if (hasNarrativeNegation(text) || /(?:不是|并非|不再|旧|之前|此前|上次|早先|历史|回忆|记录).{0,12}(?:妖兽|魔兽|怪物|敌人|敌方|monster|enemy)/iu.test(text)) {
    return false;
  }
  if (!/(逃离|逃跑|撤离|撤退|脱离|甩开|摆脱|避开|躲开|被追|追来|追赶|追击|追捕|追上|追逐|追踪)/u.test(text)) {
    return false;
  }
  return normalizeList(staleTerms).some((term) => {
    const normalized = normalizeOptionalText(term);
    return normalized && new RegExp(escapeRegExpForNarrative(normalized), 'iu').test(text);
  });
}

function isPositiveCombatDefeatClaim(context = '', matched = '', combat = {}) {
  if (/(传闻|据说|听说|提到|记录为背景|可能|疑似|传言)/u.test(context)) return false;
  if (/(击杀|杀死|斩杀|射杀|猎杀|打倒|击倒|击败|干掉|放倒|毙命|被杀|被击倒)/u.test(matched)) return true;
  return /(战斗|攻击|敌人|妖兽|魔兽|怪物|目标|对手|敌方|NPC|他|她|它).{0,12}(?:死亡|死去|倒下)|(?:死亡|死去|倒下).{0,12}(?:战斗|攻击|敌人|妖兽|魔兽|怪物|目标|对手|敌方|NPC|他|她|它)/u.test(context);
}

function isGroundedCombatVictory(combat = {}) {
  return /won|victory|success/i.test(String(combat.battleStatus || ''))
    || (/applied/i.test(String(combat.rewardStatus || '')) && normalizeList(combat.rewards).length > 0);
}

function isGroundedCombatDefeat(combat = {}) {
  return combat.targetDefeated === true
    || Number(combat.targetHp) <= 0
    || normalizeList(combat.targetConditions).some((condition) => /dead|dying|unconscious|defeated|死亡|濒死|昏迷|击败/i.test(String(condition || '')))
    || isGroundedCombatVictory(combat);
}

function reviewNarrativeResolutionClaims(text = '', grounding = {}) {
  const issues = [];
  const failed = groundingShowsFailedResolution(grounding);
  const succeeded = groundingShowsSuccessfulResolution(grounding);
  if (!failed && !succeeded) return issues;
  for (const clause of splitNarrativeClauses(text)) {
    if (failed && isPositiveResolutionSuccessClaim(clause)) {
      issues.push({
        kind: 'resolution_success_claim_on_failed_adjudication',
        context: clause,
        status: grounding.status,
        diceResults: grounding.diceResults
      });
    }
    if (succeeded && isNegativeResolutionFailureClaim(clause)) {
      issues.push({
        kind: 'resolution_failure_claim_on_successful_adjudication',
        context: clause,
        status: grounding.status,
        diceResults: grounding.diceResults
      });
    }
  }
  return issues;
}

function groundingShowsFailedResolution(grounding = {}) {
  if (grounding.success !== false) return false;
  if (grounding.diceRolled === true) return true;
  if (Number(grounding.failedToolCallCount) > 0) return true;
  return /failure|failed|error|blocked|partial_failure|path_unavailable|unavailable|not_found|missing/i.test(String(grounding.status || grounding.loopStatus || ''));
}

function groundingShowsSuccessfulResolution(grounding = {}) {
  if (grounding.success !== true) return false;
  if (Number(grounding.failedToolCallCount) > 0) return false;
  if (/failure|failed|error|blocked/i.test(String(grounding.status || grounding.loopStatus || ''))) return false;
  return grounding.diceRolled === true || Number(grounding.appliedToolCallCount) > 0 || /success/i.test(String(grounding.status || ''));
}

function splitNarrativeClauses(text = '') {
  return String(text || '')
    .split(/[。！？!?；;\n\r]+/u)
    .map((part) => normalizeOptionalText(part))
    .filter(Boolean);
}

function isPositiveResolutionSuccessClaim(clause = '') {
  const text = normalizeOptionalText(clause);
  if (!text || hasNarrativeNegation(text) || isHypotheticalResolutionContext(text)) return false;
  if (!/(成功|顺利|通过|完成|达成|做到了|办到|奏效|生效)/u.test(text)) return false;
  return /(你|玩家|主角|角色|行动|检定|判定|尝试|打开|破解|越过|说服|潜入|完成|达成|抵达|找到|解开|制服|穿过|放行|推进|结果)/u.test(text);
}

function isNegativeResolutionFailureClaim(clause = '') {
  const text = normalizeOptionalText(clause);
  if (!text || isHypotheticalResolutionContext(text)) return false;
  if (/(没有失败|并未失败|不是失败|差点失败|险些失败|几乎失败)/u.test(text)) return false;
  if (!/(失败|未通过|没有通过|未能|没能|无法|不能|没有成功|并未成功)/u.test(text)) return false;
  return /(你|玩家|主角|角色|行动|检定|判定|尝试|打开|破解|越过|说服|潜入|完成|达成|抵达|找到|解开|制服|穿过|放行|推进|结果)/u.test(text);
}

function isHypotheticalResolutionContext(text = '') {
  return /(?:如果|若是|假如|可能|也许|下次|之后|可以尝试|可尝试|建议|选择|选项).{0,12}(?:成功|失败|通过|完成|达成|未能|无法)/u.test(text);
}

function isPositiveInventoryClaim(context = '') {
  return /(获得|得到|拿到|拾取|领取|写入背包|加入背包|放入背包|战利品|掉落|奖励|已记录|收入背包)/u.test(context)
    && !hasNarrativeNegation(context);
}

function isInventoryConsumptionClaim(context = '') {
  return /(消耗|耗费|用掉|扣除|花费|支付|付出|失去|损失|交出|减少|移出背包|从背包移除)/u.test(context)
    && !hasNarrativeNegation(context);
}

function hasNarrativeNegation(context = '') {
  return /(?:未|没有|没能|无|不能|无法|尚未|并未).{0,10}(?:获得|得到|拿到|拾取|领取|写入|加入|入队|归队|离队|退队|退出|移出|跟随|同行|随行|待命|派去|分配|安排|出现|现身|在场|离开|离去|退场|消失|不见|挂载|卸载|载入|显示|设为|学会|习得|掌握|记录|登场|开放|状态|效果|生效|激活|变为|更新|完成|成功|胜利|获胜|结束|敌视|友好|紧张|结盟|中立|造成|消耗|耗费|用掉|扣除|支付|花费|损失|减少|增加|抵达|到达|来到|进入|走进|移动到|前往)/u.test(context);
}

function normalizeNarrativeRelationshipStatus(value = '') {
  const text = normalizeOptionalText(value).toLowerCase();
  if (!text) return '';
  if (/敌视|敌对|仇视|敌意|hostile|enemy|adversarial|opposed/u.test(text)) return 'hostile';
  if (/紧张|冲突|摩擦|tense|conflict|rival/u.test(text)) return 'tense';
  if (/结盟|盟友|同盟|allied|alliance|ally/u.test(text)) return 'allied';
  if (/友好|友善|信任|支持|亲近|friendly|trust|supportive/u.test(text)) return 'friendly';
  if (/中立|neutral/u.test(text)) return 'neutral';
  if (/加入|归属|成员|效忠|member|joined/u.test(text)) return 'member';
  if (/完成|成功|completed|success/u.test(text)) return 'completed';
  if (/失败|failed|failure/u.test(text)) return 'failed';
  return '';
}

function normalizeWrittenRelationshipStatus(value = {}) {
  const data = normalizePlainObject(value);
  return normalizeNarrativeRelationshipStatus([
    data.status,
    data.relationType,
    data.type,
    data.role,
    data.position,
    Number(data.tension) > 0 ? 'tense' : '',
    Number(data.trust) > 0 ? 'friendly' : ''
  ].filter(Boolean).join(' '));
}

function relationshipStatusesCompatible(claimed = '', written = '') {
  const claim = normalizeNarrativeRelationshipStatus(claimed);
  const fact = normalizeNarrativeRelationshipStatus(written);
  if (!claim || !fact) return false;
  if (claim === fact) return true;
  const groups = [
    new Set(['friendly', 'allied', 'member']),
    new Set(['hostile', 'tense'])
  ];
  return groups.some((group) => group.has(claim) && group.has(fact));
}

function normalizeNarrativeQuestStatus(value = '') {
  const text = normalizeOptionalText(value).toLowerCase();
  if (!text) return '';
  if (/完成|成功|completed|complete|succeeded|resolved/u.test(text)) return 'completed';
  if (/失败|fail|failed|expired/u.test(text)) return 'failed';
  if (/放弃|abandon/u.test(text)) return 'abandoned';
  if (/接下|追踪|已记录|记录|tracked|active|open|accepted/u.test(text)) return 'tracked';
  return '';
}

function questStatusesCompatible(claimed = '', written = '') {
  const claim = normalizeNarrativeQuestStatus(claimed);
  const fact = normalizeNarrativeQuestStatus(written);
  if (!claim || !fact) return false;
  return claim === fact || (claim === 'tracked' && ['tracked', 'active'].includes(fact));
}

function extractClaimedFactValue(context = '', name = '') {
  const pattern = new RegExp(`${escapeRegExpForNarrative(name)}.{0,8}?(?:为|是|=|：|:)?\\s*([甲乙丙丁戊己庚辛壬癸A-Za-z0-9零一二两三四五六七八九十百千万.-]+)`, 'u');
  const match = context.match(pattern);
  if (!match) return undefined;
  return normalizeNarrativeFactValue(match[1]);
}

function narrativeFactValuesEqual(claimed, written) {
  const left = normalizeNarrativeFactValue(claimed);
  const right = normalizeNarrativeFactValue(written);
  const leftNumber = parseNarrativeQuantity(left);
  const rightNumber = typeof written === 'number' ? written : parseNarrativeQuantity(right);
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber === rightNumber;
  return left === right;
}

function normalizeNarrativeFactValue(value) {
  return normalizeOptionalText(value)
    .replace(/^(?:目前|当前|现在)/u, '')
    .replace(/级$/u, '')
    .trim();
}

function isNarrativeCurrencyId(value = '') {
  return Boolean(normalizeNarrativeCurrencyKey(value));
}

function isNarrativeCurrencyName(value = '') {
  return Boolean(normalizeNarrativeCurrencyKey(value));
}

function normalizeNarrativeCurrencyKey(value = '') {
  const text = normalizeOptionalText(value).toLowerCase();
  if (!text) return '';
  if (text === 'low_grade_spirit_stone' || /下品灵石|低品灵石/u.test(text)) return 'low_grade_spirit_stone';
  if (text === 'mid_grade_spirit_stone' || /中品灵石/u.test(text)) return 'mid_grade_spirit_stone';
  if (text === 'high_grade_spirit_stone' || /上品灵石|高品灵石/u.test(text)) return 'high_grade_spirit_stone';
  if (text === 'spirit_stone' || text === '灵石') return 'spirit_stone';
  return '';
}

function claimWindow(text = '', index = 0, length = 0) {
  return text.slice(Math.max(0, index - 18), Math.min(text.length, index + length + 18));
}

function parseNarrativeQuantity(value = '') {
  const text = normalizeOptionalText(value);
  if (!text) return undefined;
  if (/^\d+$/u.test(text)) return Number(text);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^[零一二两三四五六七八九]$/u.test(text)) return digits[text];
  let total = 0;
  let section = 0;
  let number = 0;
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  for (const char of text) {
    if (digits[char] !== undefined) {
      number = digits[char];
      continue;
    }
    const unit = units[char];
    if (!unit) continue;
    if (unit === 10000) {
      section = (section + number) || 1;
      total += section * unit;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  const parsed = total + section + number;
  return parsed > 0 ? parsed : undefined;
}

function escapeRegExpForNarrative(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeList(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function stripUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function defaultSceneDraftFromResolverGrounding(grounding = {}) {
  const combat = normalizePlainObject(grounding.combat);
  if (isGroundedCombatStart(combat) && grounding.resolutionMode === 'combat_start') {
    const enemyNames = normalizeStringArray(combat.enemyNames).slice(0, 4);
    const enemyText = enemyNames.length
      ? `敌人：${enemyNames.join('、')}`
      : `敌人数量：${firstFiniteNumber(combat.enemyCount, normalizeStringArray(combat.enemyIds).length) || 0}`;
    return `战斗记录已创建，${enemyText}。`;
  }
  if (grounding.success && grounding.resolutionMode === 'automatic_progress') {
    return '这次低风险行动已经直接结算，产生了小幅进展。';
  }
  if (grounding.success) return '玩家行动已经完成结算。';
  if (grounding.status === 'dry_run') return '这次裁决仍是预览，尚未写入世界状态。';
  if (grounding.failedToolCallCount > 0 || grounding.status === 'failure' || grounding.status === 'partial_failure') {
    return '这次行动没有成功写入结果，当前场景状态保持不变。';
  }
  return '玩家的行动已经被记录，当前场景等待进一步描写。';
}

function defaultNarratorDraftFromResolverGrounding(grounding = {}) {
  const combat = normalizePlainObject(grounding.combat);
  if (isGroundedCombatStart(combat) && grounding.resolutionMode === 'combat_start') {
    return '规则：战斗已经写入数据库，接下来应从战斗面板或明确的战斗行动继续。';
  }
  if (grounding.success && grounding.resolutionMode === 'automatic_progress') {
    return '规则：低风险入门/日常行动按自动进度处理，无需掷骰。';
  }
  if (grounding.failedToolCallCount > 0) {
    return '规则：存在失败工具调用，不能把未写入的变化当成既成事实。';
  }
  if (grounding.status === 'dry_run') return '规则：dry-run 只预览，不提交数据库变化。';
  return '本轮 Agent 循环已完成。';
}

function inferNarrativeDraftSceneName({ phase, request, state } = {}) {
  return firstNonEmptyString(
    phase?.config?.draftMapName,
    phase?.config?.mapName,
    state?.contextPlan?.sceneName,
    state?.contextPlan?.locationName,
    state?.minimalContext?.sceneName,
    state?.baseline?.sceneName,
    request?.sceneName,
    request?.locationName,
    '当前场景'
  );
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function contextPlannerFallbackInput(input = {}) {
  const {
    intent,
    riskHint,
    actorIds,
    contextPlannerInput,
    missingPolicy,
    forceRag,
    ragProbe,
    useContextPlanner,
    ...base
  } = input;
  return {
    ...base,
    ...(contextPlannerInput && typeof contextPlannerInput === 'object' && !Array.isArray(contextPlannerInput)
      ? contextPlannerInput
    : {})
  };
}

function contextBudgetActorIds({ request, phase, state } = {}) {
  return compactUnique([
    ...normalizeStringArray(request.actorIds || request.npcIds),
    ...normalizeStringArray(phase.config?.actorIds),
    state.actorControl?.context?.requiresInitialization ? '' : state.actorControl?.context?.controlledActorId
  ]).filter(Boolean);
}

function buildFallbackActorControlOutput({ request = {}, input = {}, reason = 'fallback', error } = {}) {
  const context = {
    chatSessionId: input.chatSessionId || request.chatSessionId || '',
    sceneId: input.sceneId || request.sceneId || 'current',
    controlledActorId: input.controlledActorId || '',
    controlledActorTitle: input.controlledActorTitle || input.actorTitle || input.controlledActorId || '玩家角色',
    controlledPlayerId: input.controlledPlayerId || '',
    viewpointActorId: input.viewpointActorId || input.controlledActorId || '',
    viewpointActorTitle: input.viewpointActorTitle || input.controlledActorTitle || input.actorTitle || input.controlledActorId || '玩家角色',
    embodiedActorId: input.embodiedActorId || input.controlledActorId || '',
    embodiedActorTitle: input.embodiedActorTitle || input.controlledActorTitle || input.actorTitle || input.controlledActorId || '玩家角色',
    speakerRole: 'player',
    inputAuthority: input.inputAuthority || 'actor_claim',
    worldEditMode: Boolean(input.worldEditMode),
    canAssertWorldFacts: Boolean(input.canAssertWorldFacts),
    canAssertNpcDecisions: Boolean(input.canAssertNpcDecisions),
    aiRole: 'gm',
    userRole: 'player_controller',
    aiAllowedSpeakers: ['gm', 'narrator', 'npc'],
    aiForbiddenControl: input.controlledActorId ? [input.controlledActorId] : [],
    factWriteChannels: ['database_editor', 'import_document', 'authorized_tool_call', 'resolver_result', 'worldline_restore'],
    requiresInitialization: !input.controlledActorId,
    source: 'fallback_unbound',
    metadata: {},
    controlUpdatedAt: nowIso()
  };
  const actorLabel = context.controlledActorId
    ? `${context.controlledActorTitle}/${context.controlledActorId}`
    : context.controlledActorTitle;
  const rawText = input.text || request.text || '';
  const inputEnvelope = {
    rawText,
    actorTaggedText: `[玩家角色：${actorLabel} | authority=${context.inputAuthority}] ${rawText}`,
    speakerRole: 'player',
    actorId: context.controlledActorId,
    actorTitle: context.controlledActorTitle,
    authority: context.inputAuthority,
    factAuthority: {
      inputIsCanonicalWorldFact: false,
      canAssertWorldFacts: false,
      canAssertNpcDecisions: false,
      ordinaryActorClaim: true,
      canonicalFactSources: context.factWriteChannels
    },
    potentialAssertions: [],
    handling: 'Treat ordinary chat as a player-character claim until a resolver/tool/user override confirms it.'
  };
  const promptContext = [
    '<AI_DND_ACTOR_CONTROL_CONTEXT>',
    `controlledActorId: ${context.controlledActorId || '(unbound)'}`,
    `controlledActorTitle: ${context.controlledActorTitle}`,
    `inputAuthority: ${context.inputAuthority}`,
    'Rules:',
    '- Ordinary chat input is an actor_claim from the controlled player actor, not a canonical world fact.',
    '- Do not decide major actions, inner thoughts, or dialogue for the controlled player actor unless explicit user authorization exists.',
    `Tagged current input: ${inputEnvelope.actorTaggedText}`,
    '</AI_DND_ACTOR_CONTROL_CONTEXT>'
  ].join('\n');
  return {
    noLlm: true,
    chatSessionId: context.chatSessionId,
    sceneId: context.sceneId,
    context,
    inputEnvelope,
    promptContext,
    warnings: [
      'Actor control tool was unavailable; loop used compatibility fallback.',
      ...(context.requiresInitialization ? ['No controlled player actor is bound.'] : [])
    ],
    reason,
    error,
    policy: {
      ordinaryChatAuthority: 'actor_claim',
      canonicalFactSources: context.factWriteChannels,
      aiForbiddenControl: context.aiForbiddenControl
    }
  };
}

function shouldUseLlmNarrative({ phase, profile, request }) {
  if (request.useLlmNarrative === true || request.useLlm === true) return true;
  if (request.useLlmNarrative === false || request.useLlm === false) return false;
  if (phase.config?.useLlm !== undefined) return Boolean(phase.config.useLlm);
  return Boolean(profile.llm?.narrative);
}

function dryRunAllowsExternalApi(request = {}) {
  return request.dryRun === true && (
    request.allowExternalApiInDryRun === true
    || request.dryRunAllowExternalApi === true
    || request.allowApiInDryRun === true
  );
}

function buildSummarySeed(state) {
  return {
    input: state.input?.latestUserMessage || '',
    actorControl: state.actorControl?.context,
    intent: state.intent,
    worldbook: state.worldbook?.activatedEntries?.map((entry) => ({
      id: entry.id,
      title: entry.title,
      priority: entry.priority
    })) || [],
    ragGuidance: state.ragGuidance?.guidance,
    adjudication: state.adjudication,
    impactPlan: state.impactPlan,
    npcReaction: state.npcReaction,
    environmentReaction: state.environmentReaction,
    narrative: state.narrative?.content || state.narrative?.draft || ''
  };
}

function latestRequestText(request = {}, state = {}) {
  return String(
    state.input?.latestUserMessage
    || request.text
    || request.currentInput
    || request.userInput
    || ''
  ).trim();
}

function assessEncounterAutomation(sourceText = '', config = {}) {
  const source = String(sourceText || '').trim();
  if (!source) return { skip: true, reason: 'empty_input', chance: 0 };
  const lower = source.toLowerCase();
  const matchedTerms = weightedTermMatches(lower, [
    ['奇遇', 0.95],
    ['遭遇', 0.9],
    ['随机事件', 0.85],
    ['探索', 0.45],
    ['探险', 0.45],
    ['旅行', 0.3],
    ['赶路', 0.25],
    ['野外', 0.25],
    ['荒野', 0.3],
    ['废墟', 0.3],
    ['矿井', 0.25],
    ['森林', 0.2],
    ['encounter', 0.95],
    ['random event', 0.85],
    ['explore', 0.45],
    ['travel', 0.3]
  ]);
  const explicit = /奇遇|遭遇|随机事件|encounter|random event/i.test(source);
  if (matchedTerms.length === 0 && config.autoRollAmbientEncounter !== true) {
    return { skip: true, reason: 'no_encounter_terms', chance: 0, matchedTerms: [] };
  }
  const baseChance = clampProbability(config.encounterBaseChance ?? (config.autoRollAmbientEncounter ? 0.03 : 0));
  const chance = explicit
    ? clampProbability(config.explicitEncounterChance ?? 1)
    : clampProbability(baseChance + matchedTerms.reduce((sum, match) => sum + match.weight, 0));
  if (chance <= 0) return { skip: true, reason: 'encounter_chance_zero', chance, matchedTerms };
  return {
    skip: false,
    noLlm: true,
    chance,
    force: explicit && config.forceExplicitEncounter !== false && chance >= 1,
    explicit,
    matchedTerms,
    policy: 'Explicit encounter prompts trigger strongly; ambient exploration only rolls when configured or salient.'
  };
}

function encounterLuckFromTrigger(trigger = {}) {
  if (trigger?.selected?.luckTier) return { tier: trigger.selected.luckTier, score: trigger.selected.luckScore };
  if (trigger?.selected?.type === 'reward') return { tier: 'favorable', score: 75 };
  if (trigger?.selected?.type === 'combat') return { tier: 'mixed', score: 50 };
  const chance = Number(trigger?.chance);
  const roll = Number(trigger?.roll);
  if (Number.isFinite(chance) && Number.isFinite(roll)) {
    const margin = chance - roll;
    if (margin > 0.5) return { tier: 'exceptional', score: 90, roll, chance, margin };
    if (margin > 0.15) return { tier: 'favorable', score: 75, roll, chance, margin };
    return { tier: 'mixed', score: 50, roll, chance, margin };
  }
  return { tier: 'mixed', score: 50 };
}

function assessNpcReactionAutomation(sourceText = '', config = {}) {
  const source = String(sourceText || '').trim();
  if (!source) return { skip: true, reason: 'empty_input', chance: 0 };
  const lower = source.toLowerCase();
  const matchedTerms = weightedTermMatches(lower, [
    ['npc', 0.25],
    ['自发', 0.55],
    ['自己', 0.25],
    ['送礼', 0.65],
    ['赠送', 0.6],
    ['报答', 0.55],
    ['攻击', 0.55],
    ['袭击', 0.6],
    ['背叛', 0.65],
    ['叛变', 0.65],
    ['逃跑', 0.45],
    ['求援', 0.45],
    ['行动', 0.25],
    ['反应', 0.3],
    ['autonomous', 0.65],
    ['gift', 0.65],
    ['attack', 0.55],
    ['betray', 0.65],
    ['react', 0.3]
  ]);
  if (matchedTerms.length === 0) return { skip: true, reason: 'no_npc_reaction_terms', chance: 0, matchedTerms: [] };
  const chance = clampProbability(config.npcReactionChance ?? Math.max(0.35, Math.min(0.95, 0.2 + matchedTerms.reduce((sum, match) => sum + match.weight, 0))));
  return {
    skip: false,
    noLlm: true,
    chance,
    diceThreshold: chanceToD100Threshold(chance),
    matchedTerms,
    behaviorKind: inferNpcBehaviorKind(source),
    npcName: extractLikelyNpcName(source) || '场景NPC',
    policy: 'NPC autonomy is probability-gated; explicit NPC reaction wording raises the chance but does not force a state write.'
  };
}

function buildNpcReactionAutomationPlan({ sourceText = '', chatSessionId, sceneId = 'current', assessment = {} } = {}) {
  const npcName = assessment.npcName || '场景NPC';
  const npcId = automationId('npc', npcName);
  const behaviorKind = assessment.behaviorKind || 'reaction';
  const positive = ['gift', 'support', 'gratitude'].includes(behaviorKind);
  const hostile = ['attack', 'betrayal', 'flight'].includes(behaviorKind);
  const relationType = hostile ? 'hostile_reaction' : (positive ? 'supportive_reaction' : 'autonomous_reaction');
  const trust = hostile ? -30 : (positive ? 35 : 10);
  const statusName = hostile ? 'Autonomous Hostility' : (positive ? 'Autonomous Gratitude' : 'Autonomous Reaction');
  return {
    actionId: automationId('npc_behavior', sourceText || npcName),
    sourceText,
    intent: {
      label: 'npc-autonomy-probability-check',
      summary: `${npcName} may make a small autonomous reaction after the trigger.`
    },
    metadata: {
      npcBehavior: {
        trigger: { type: 'post_impact_autonomy', sourceText, sceneId },
        actors: [{
          npcId,
          name: npcName,
          motivation: positive ? 'reciprocate or support the player' : hostile ? 'respond under pressure or hostility' : 'react to the changed scene',
          pressure: 'prompt salience and current scene context',
          severity: hostile ? 'medium' : 'low'
        }],
        probability: assessment
      }
    },
    checks: [{
      id: 'npc_autonomy_probability',
      tool: 'game.dice.check',
      input: {
        successThreshold: assessment.diceThreshold || chanceToD100Threshold(assessment.chance || 0.35),
        diceCount: 1,
        diceSides: 100,
        modifier: 0
      }
    }],
    proposals: [
      {
        id: 'record_npc_autonomy_status',
        when: 'success',
        tool: 'system.npc_state.patch_state',
        input: {
          chatSessionId,
          sceneId,
          npcId,
          name: npcName,
          specialStatuses: [{
            id: 'autonomous_reaction',
            name: statusName,
            description: sourceText || 'NPC autonomous reaction passed its probability gate.',
            intensity: Math.max(1, Math.round((assessment.chance || 0.35) * 3)),
            metadata: {
              behaviorKind,
              source: 'agent_loop.reaction.npc'
            }
          }],
          source: 'agent_loop.reaction.npc'
        }
      },
      {
        id: 'record_npc_autonomy_relation',
        when: 'success',
        tool: 'system.npc_relationships.upsert_edge',
        input: {
          fromNpcId: npcId,
          toNpcId: 'player',
          relationType,
          direction: 'directed',
          trust,
          weight: trust,
          status: hostile ? 'tense' : 'active',
          sourceText,
          summary: `${npcName} produced a ${relationType} toward the player.`,
          createMissingNodes: true,
          metadata: {
            chatSessionId,
            sceneId,
            source: 'agent_loop.reaction.npc'
          }
        }
      }
    ],
    narrationHints: {
      success: 'NPC autonomy passed; describe only a small visible NPC reaction.',
      failure: 'NPC autonomy did not produce an independent state change.'
    }
  };
}

function assessEnvironmentAutomation(sourceText = '', config = {}) {
  const source = String(sourceText || '').trim();
  if (!source) return { skip: true, reason: 'empty_input', chance: 0 };
  const lower = source.toLowerCase();
  const matchedTerms = weightedTermMatches(lower, [
    ['爆炸', 0.8],
    ['引爆', 0.8],
    ['炸', 0.55],
    ['放火', 0.65],
    ['点燃', 0.55],
    ['燃烧', 0.45],
    ['坍塌', 0.75],
    ['倒塌', 0.7],
    ['毒气', 0.55],
    ['洪水', 0.55],
    ['地震', 0.55],
    ['陷阱', 0.45],
    ['警报', 0.4],
    ['摧毁', 0.6],
    ['破坏', 0.45],
    ['环境', 0.25],
    ['连锁反应', 0.55],
    ['explosion', 0.8],
    ['explode', 0.8],
    ['fire', 0.45],
    ['collapse', 0.75],
    ['alarm', 0.4],
    ['trap', 0.45]
  ]);
  if (matchedTerms.length === 0) return { skip: true, reason: 'no_environment_terms', chance: 0, matchedTerms: [] };
  return {
    skip: false,
    noLlm: true,
    chance: clampProbability(config.environmentReactionChance ?? Math.min(0.95, 0.1 + matchedTerms.reduce((sum, match) => sum + match.weight, 0))),
    matchedTerms,
    policy: 'Environment reactions are usually no-op; destructive or volatile text makes the resolver run.'
  };
}

function compactMemoryText({ turnId, sourceText = '', narrativeText = '', summarySeed = {} } = {}) {
  const intent = summarySeed?.intent?.intent || summarySeed?.intent?.primaryIntent || summarySeed?.intent?.label || '';
  const toolCallCount = [
    ...(summarySeed?.adjudication?.resolverResult?.currentSummary?.appliedToolCalls || []),
    ...(summarySeed?.npcReaction?.automation?.toolCalls || []),
    ...(summarySeed?.environmentReaction?.automation?.toolCalls || [])
  ].length;
  return [
    `Turn: ${turnId || 'unknown'}`,
    sourceText ? `User: ${clampText(sourceText, 500)}` : '',
    intent ? `Intent: ${clampText(intent, 120)}` : '',
    narrativeText ? `Narrative: ${clampText(narrativeText, 800)}` : '',
    `ToolCallCount: ${toolCallCount}`
  ].filter(Boolean).join('\n').trim();
}

function memoryImportanceFromText(sourceText = '') {
  if (/获得|失去|死亡|复活|任务|奇遇|遭遇|背叛|阵营|关系|物品|技能|状态|地图|SEVEN STAR|暗号|important|remember|quest|item|skill|status|faction|relation/i.test(sourceText)) {
    return 0.8;
  }
  return 0.45;
}

function weightedTermMatches(lowerText = '', terms = []) {
  return terms
    .map(([term, weight]) => ({ term, weight }))
    .filter(({ term }) => lowerText.includes(String(term).toLowerCase()));
}

function chanceToD100Threshold(chance) {
  return Math.max(1, Math.min(100, Math.ceil(101 - clampProbability(chance) * 100)));
}

function clampProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function inferNpcBehaviorKind(sourceText = '') {
  if (/送礼|赠送|报答|帮忙|支援|support|gift|reward/i.test(sourceText)) return 'gift';
  if (/攻击|袭击|开打|动手|attack|assault/i.test(sourceText)) return 'attack';
  if (/背叛|叛变|betray/i.test(sourceText)) return 'betrayal';
  if (/逃跑|逃离|flee|run away/i.test(sourceText)) return 'flight';
  return 'reaction';
}

function extractLikelyNpcName(sourceText = '') {
  const source = String(sourceText || '');
  const cn = source.match(/(?:NPC|商人|铁匠|老板娘|守卫|长老|师傅|师父|弟子|妖兽|敌人|角色)([\u4e00-\u9fa5A-Za-z0-9_]{2,8})/u)?.[1]
    || source.match(/遇见(?:新)?NPC([\u4e00-\u9fa5A-Za-z0-9_]{2,8})/u)?.[1];
  if (cn) return cleanLikelyNpcName(cn);
  const en = source.match(/\bNPC\s+([A-Z][A-Za-z0-9_-]{1,30}(?:\s+(?!NPC\b|AUTONOMOUS\b|GIFT\b|REACT\b|ATTACK\b|BETRAY\b|FLEE\b)[A-Z][A-Za-z0-9_-]{1,30}){0,2})\b/)?.[1];
  return en ? cleanLikelyNpcName(en) : '';
}

function cleanLikelyNpcName(value = '') {
  return String(value || '')
    .replace(/(?:一命|说道|说话|交给|告诉|攻击|送礼|行动|反应|会不会|自己)$/u, '')
    .replace(/[，。；;:：,.\s]+$/u, '')
    .trim();
}

function automationId(prefix, value = '') {
  const key = String(value || prefix)
    .normalize('NFKD')
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || prefix;
  return `${prefix}_${key}`.slice(0, 80);
}

function buildDebugSummary({ phase, profile, request, state }) {
  const maxPreviewChars = clampInteger(phase.config?.maxOutputPreviewChars ?? 500, 80, 4000);
  const tokenRiskChars = clampInteger(phase.config?.tokenRiskChars ?? 4000, 500, 50000);
  const phaseSequence = state.phaseResults.map((result) => summarizePhaseForDebug(result, {
    maxPreviewChars,
    tokenRiskChars
  }));
  const toolResults = state.toolResults.map((result) => summarizeToolResultForDebug(result, {
    maxPreviewChars,
    tokenRiskChars
  }));
  const artifactCandidates = collectArtifactCandidates({
    phaseResults: state.phaseResults,
    toolResults: state.toolResults,
    maxPreviewChars
  });
  const tokenReview = buildTokenReview({
    phaseSequence,
    toolResults,
    narrative: state.narrative,
    contextPlan: state.contextPlan,
    tokenRiskChars
  });
  const routerOutput = state.phaseResults.find((result) => result.phaseId === 'resolver.orchestration')?.output || state.routerPlan || {};

  return {
    format: 'ai-dnd-turn-debug-summary/v1',
    debugOnly: true,
    affectsNarrative: false,
    noLlm: true,
    policy: phase.config?.policy || 'Debug-only rollup. It summarizes all phase/tool artifacts for human inspection and must not be fed back into narrative.render unless a later config explicitly chooses a small derived brief.',
    turn: {
      turnId: state.turnId,
      profileId: profile.id,
      dryRun: request.dryRun,
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId
    },
    actorControl: state.actorControl ? {
      context: state.actorControl.context,
      inputEnvelope: state.actorControl.inputEnvelope,
      warnings: state.actorControl.warnings || []
    } : undefined,
    router: {
      intent: state.intent,
      orderedIntents: routerOutput.orderedIntents || state.intent?.orderedIntents || [],
      allowedToolIds: routerOutput.allowedToolIds || [],
      candidates: routerOutput.candidates || state.resolverCandidates || [],
      blockedCandidates: routerOutput.blockedCandidates || [],
      ordering: routerOutput.policy?.ordering || 'textual_intent_order'
    },
    phaseSequence,
    toolResults,
    artifactCandidates,
    frontendReview: buildFrontendReview(artifactCandidates),
    tokenReview,
    traceRefs: compactUnique([
      ...phaseSequence.map((entry) => entry.traceRef),
      ...toolResults.map((entry) => entry.traceRef)
    ]).filter(Boolean),
    warnings: state.warnings,
    errors: state.errors
  };
}

function summarizePhaseForDebug(result, { maxPreviewChars, tokenRiskChars }) {
  const output = result.output;
  const chars = approximateJsonChars(output);
  return {
    phaseId: result.phaseId,
    title: result.title,
    order: result.order,
    status: result.skipped ? 'skipped' : (result.errors.length ? 'error' : 'success'),
    llm: Boolean(result.llm),
    mutatesState: Boolean(result.mutatesState),
    durationMs: result.durationMs,
    outputKeys: output && typeof output === 'object' && !Array.isArray(output) ? Object.keys(output) : [],
    approxChars: chars,
    approxTokens: approximateTokens(chars),
    tokenRisk: chars >= tokenRiskChars ? 'large_output' : undefined,
    preview: previewValue(output, maxPreviewChars),
    toolCallCount: result.toolCalls.length,
    traceRef: result.contextEnvelope?.artifactRefs?.find((ref) => ref.kind === 'trace')?.id,
    warnings: result.warnings,
    errors: result.errors
  };
}

function summarizeToolResultForDebug(result, { maxPreviewChars, tokenRiskChars }) {
  const chars = approximateJsonChars(result.output);
  return {
    phaseId: result.phaseId,
    id: result.id,
    toolId: result.toolId,
    status: result.status,
    reason: result.reason,
    mutatesState: Boolean(result.tool?.mutatesState),
    autoCallable: Boolean(result.tool?.autoCallable),
    approxChars: chars,
    approxTokens: approximateTokens(chars),
    tokenRisk: chars >= tokenRiskChars ? 'large_tool_output' : undefined,
    outputKeys: result.output && typeof result.output === 'object' && !Array.isArray(result.output) ? Object.keys(result.output) : [],
    preview: previewValue(result.output, maxPreviewChars),
    traceRef: result.trace?.traceId || result.trace?.id,
    error: result.error
  };
}

function collectArtifactCandidates({ phaseResults, toolResults, maxPreviewChars }) {
  const candidates = [];
  for (const result of phaseResults) {
    collectArtifactsFromValue(result.output, {
      sourceKind: 'phase',
      sourceId: result.phaseId,
      phaseId: result.phaseId,
      maxPreviewChars,
      candidates
    });
  }
  for (const result of toolResults) {
    collectArtifactsFromValue(result.output, {
      sourceKind: 'tool',
      sourceId: result.toolId,
      phaseId: result.phaseId,
      maxPreviewChars,
      candidates
    });
  }
  return candidates.slice(0, 200);
}

function collectArtifactsFromValue(value, { sourceKind, sourceId, phaseId, maxPreviewChars, candidates }) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const bucket = classifyArtifactField(key);
    if (bucket) {
      const items = Array.isArray(child) ? child : [child];
      for (const [index, item] of items.entries()) {
        if (item === undefined || item === null || item === '') continue;
        candidates.push({
          bucket,
          sourceKind,
          sourceId,
          phaseId,
          field: key,
          index,
          approxChars: approximateJsonChars(item),
          preview: previewValue(item, maxPreviewChars)
        });
      }
    }
  }
}

function classifyArtifactField(key) {
  const normalized = String(key || '').toLowerCase();
  if ([
    'playerfacing',
    'playerfacingevents',
    'visibleevents',
    'publicevents',
    'displayevents'
  ].includes(normalized)) return 'candidate_player_facing';
  if ([
    'statedeltas',
    'statechanges',
    'effects',
    'settlements',
    'proposals',
    'pendingeffects'
  ].includes(normalized)) return 'candidate_state_delta';
  if ([
    'narrativehints',
    'narrationhints',
    'promptsnippets',
    'mustincludesnippets',
    'summary',
    'decision',
    'judgement',
    'result'
  ].includes(normalized)) return 'candidate_narrative_input';
  return undefined;
}

function buildFrontendReview(artifactCandidates) {
  return {
    candidatePlayerFacing: artifactCandidates
      .filter((candidate) => candidate.bucket === 'candidate_player_facing')
      .slice(0, 50),
    candidateNarrativeInputs: artifactCandidates
      .filter((candidate) => candidate.bucket === 'candidate_narrative_input')
      .slice(0, 80),
    candidateStateDeltas: artifactCandidates
      .filter((candidate) => candidate.bucket === 'candidate_state_delta')
      .slice(0, 80),
    hideByDefault: artifactCandidates
      .filter((candidate) => candidate.bucket !== 'candidate_player_facing')
      .slice(0, 80),
    nextDecision: 'Review these candidates and promote only stable, player-safe fields into a future NarrativeBrief or frontend panel.'
  };
}

function buildTokenReview({ phaseSequence, toolResults, narrative, contextPlan, tokenRiskChars }) {
  const narrativeUserPromptChars = String(narrative?.userPrompt || '').length;
  const contextPromptChars = String(contextPlan?.promptContext || contextPlan?.output?.promptContext || '').length;
  const largePhaseOutputs = phaseSequence
    .filter((entry) => entry.approxChars >= tokenRiskChars)
    .map((entry) => ({
      phaseId: entry.phaseId,
      approxChars: entry.approxChars,
      approxTokens: entry.approxTokens,
      outputKeys: entry.outputKeys
    }));
  const largeToolOutputs = toolResults
    .filter((entry) => entry.approxChars >= tokenRiskChars)
    .map((entry) => ({
      phaseId: entry.phaseId,
      toolId: entry.toolId,
      approxChars: entry.approxChars,
      approxTokens: entry.approxTokens,
      outputKeys: entry.outputKeys
    }));
  return {
    tokenRiskChars,
    narrativeUserPrompt: {
      approxChars: narrativeUserPromptChars,
      approxTokens: approximateTokens(narrativeUserPromptChars),
      risk: narrativeUserPromptChars >= tokenRiskChars ? 'large_narrative_prompt' : undefined
    },
    contextPrompt: {
      approxChars: contextPromptChars,
      approxTokens: approximateTokens(contextPromptChars),
      risk: contextPromptChars >= tokenRiskChars ? 'large_context_prompt' : undefined
    },
    largePhaseOutputs,
    largeToolOutputs,
    recommendations: [
      'Keep full raw outputs in trace files.',
      'Pass contextEnvelope or a small NarrativeBrief between modules instead of copying full prompt/userPrompt fields.',
      'Promote player-facing artifacts through an explicit schema rather than scanning arbitrary tool JSON.'
    ]
  };
}

function previewValue(value, maxChars = 500) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return clampText(value, maxChars);
  try {
    return clampText(JSON.stringify(value), maxChars);
  } catch {
    return clampText(String(value), maxChars);
  }
}

function approximateJsonChars(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function approximateTokens(chars) {
  return Math.ceil(Number(chars || 0) / 4);
}

function getSessionWorldBook(appDatabase, chatSessionId) {
  if (!appDatabase?.getChatSession || !chatSessionId) return undefined;
  try {
    const session = appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: true,
      includeDataDatabase: false
    });
    return session.characterCard?.data?.character_book;
  } catch {
    return undefined;
  }
}

function countWorldBookEntries(worldBook) {
  if (!worldBook) return 0;
  if (Array.isArray(worldBook.entries)) return worldBook.entries.length;
  if (worldBook.entries && typeof worldBook.entries === 'object') return Object.keys(worldBook.entries).length;
  return 0;
}

function publicWorldBookEntry(entry) {
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
  const ragGuidance = metadata.ragGuidance || metadata.rag_guidance || {};
  const injectionPolicy = metadata.injectionPolicy || metadata.injection_policy || {};
  return {
    id: String(entry.uid ?? metadata.id ?? entry.comment ?? createId('wbentry')),
    title: entry.comment || metadata.title || metadata.name || '',
    priority: Number(entry.priority || 0),
    keys: [...(entry.key || [])],
    secondaryKeys: [...(entry.keysecondary || [])],
    promptSnippet: String(metadata.promptSnippet || metadata.prompt_snippet || entry.content || '').slice(0, injectionPolicy.maxChars || 800),
    ragGuidance: normalizeRagGuidance(ragGuidance),
    injectionPolicy: {
      mode: injectionPolicy.mode || 'only_when_relevant',
      maxTokens: injectionPolicy.maxTokens,
      maxChars: injectionPolicy.maxChars
    },
    metadata: {
      position: entry.position,
      role: entry.role,
      depth: entry.depth
    }
  };
}

function emptyRagGuidance() {
  return {
    priorityTerms: [],
    queryExpansion: [],
    collectionHints: [],
    metadataFilters: {},
    mustIncludeSnippets: [],
    lowPriorityTerms: [],
    promptHints: []
  };
}

function normalizeRagGuidance(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    priorityTerms: normalizeStringArray(source.priorityTerms || source.priority_terms),
    queryExpansion: normalizeStringArray(source.queryExpansion || source.query_expansion),
    collectionHints: normalizeStringArray(source.collectionHints || source.collection_hints),
    metadataFilters: normalizePlainObject(source.metadataFilters || source.metadata_filters),
    mustIncludeSnippets: normalizeStringArray(source.mustIncludeSnippets || source.must_include_snippets),
    lowPriorityTerms: normalizeStringArray(source.lowPriorityTerms || source.low_priority_terms),
    promptHints: normalizeStringArray(source.promptHints || source.prompt_hints)
  };
}

function buildWorldbookRagGuidance(entries = []) {
  const guidance = emptyRagGuidance();
  for (const entry of entries) {
    const entryGuidance = normalizeRagGuidance(entry.ragGuidance);
    guidance.priorityTerms.push(entry.title, ...(entry.keys || []), ...entryGuidance.priorityTerms);
    guidance.queryExpansion.push(...(entry.secondaryKeys || []), ...entryGuidance.queryExpansion, ...extractLooseKeywords(entry.promptSnippet));
    guidance.collectionHints.push(...entryGuidance.collectionHints);
    guidance.mustIncludeSnippets.push(...entryGuidance.mustIncludeSnippets);
    guidance.lowPriorityTerms.push(...entryGuidance.lowPriorityTerms);
    guidance.promptHints.push(...entryGuidance.promptHints);
    Object.assign(guidance.metadataFilters, entryGuidance.metadataFilters);
  }
  return normalizeRagGuidance(guidance);
}

function mergeRagGuidance(...items) {
  const merged = emptyRagGuidance();
  for (const item of items) {
    const guidance = normalizeRagGuidance(item);
    merged.priorityTerms.push(...guidance.priorityTerms);
    merged.queryExpansion.push(...guidance.queryExpansion);
    merged.collectionHints.push(...guidance.collectionHints);
    merged.mustIncludeSnippets.push(...guidance.mustIncludeSnippets);
    merged.lowPriorityTerms.push(...guidance.lowPriorityTerms);
    merged.promptHints.push(...guidance.promptHints);
    Object.assign(merged.metadataFilters, guidance.metadataFilters);
  }
  return {
    priorityTerms: compactUnique(merged.priorityTerms).slice(0, 80),
    queryExpansion: compactUnique(merged.queryExpansion).slice(0, 120),
    collectionHints: compactUnique(merged.collectionHints).slice(0, 20),
    metadataFilters: merged.metadataFilters,
    mustIncludeSnippets: compactUnique(merged.mustIncludeSnippets).slice(0, 20),
    lowPriorityTerms: compactUnique(merged.lowPriorityTerms).slice(0, 50),
    promptHints: compactUnique(merged.promptHints).slice(0, 50)
  };
}

function buildGuidedQuery({ input = '', guidance = {}, baseline } = {}) {
  const normalized = normalizeRagGuidance(guidance);
  return compactUnique([
    input,
    ...(normalized.priorityTerms || []),
    ...(normalized.queryExpansion || []),
    ...(baseline?.baseline?.keywords || [])
  ])
    .filter((term) => !(normalized.lowPriorityTerms || []).includes(term))
    .slice(0, 80)
    .join(' ');
}

function renderWorldbookPromptContext(worldbook) {
  const snippets = Array.isArray(worldbook?.promptSnippets) ? worldbook.promptSnippets : [];
  return snippets
    .map((snippet) => {
      const title = snippet.title ? ` (${snippet.title})` : '';
      return `- ${snippet.id}${title}: ${snippet.content}`;
    })
    .join('\n');
}

function extractLooseKeywords(text = '') {
  const source = String(text || '');
  const asciiWords = source.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || [];
  const cjkPhrases = source.match(/[\p{Script=Han}]{2,12}/gu) || [];
  return compactUnique([...asciiWords, ...cjkPhrases])
    .filter((keyword) => keyword.length <= 24)
    .slice(0, 20);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return compactUnique(value.map((item) => String(item || '').trim()).filter(Boolean));
  if (typeof value === 'string') return compactUnique(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean));
  return [];
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function normalizeProgressLabels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, label]) => [String(key || '').trim(), normalizeOptionalText(label)])
    .filter(([key, label]) => key && label));
}

function normalizePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function compactUnique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => value === undefined || value === null ? '' : String(value).trim())
    .filter(Boolean))];
}

function normalizeToolCall(call, { phase, state, request }) {
  const toolId = requireText(call.toolId || call.id || call.name, 'toolId');
  return {
    ...call,
    id: call.id || `${phase.id}:${toolId}`,
    toolId,
    enabled: call.enabled !== false,
    required: call.required === true,
    execute: call.execute,
    executeInDryRun: call.executeInDryRun === true,
    progressLabel: normalizeOptionalText(call.progressLabel),
    input: resolveTemplateValue(call.input || {}, { phase, state, request }),
    context: call.context && typeof call.context === 'object'
      ? resolveTemplateValue(call.context, { phase, state, request })
      : {}
  };
}

function fallbackProgressLabelForPhase(phase = {}) {
  const id = String(phase.id || '').trim();
  if (DEFAULT_PHASE_PROGRESS_LABELS[id]) return DEFAULT_PHASE_PROGRESS_LABELS[id];
  const subject = humanizeProgressSubject(phase.title || id || '当前阶段');
  return `正在处理${subject}...`;
}

function progressLabelWarningForPhase(phase = {}) {
  const id = String(phase.id || '').trim();
  if (normalizeOptionalText(phase.progressLabel)) return undefined;
  if (DEFAULT_PHASE_PROGRESS_LABELS[id]) return undefined;
  const title = phase.title || id || '未命名阶段';
  return {
    code: 'missing_progress_label',
    phaseId: id || undefined,
    message: `阶段「${title}」没有 progressLabel，建议在循环配置里写一句给用户看的进度文案。`
  };
}

function fallbackProgressLabelForTool(toolId) {
  const name = String(toolId || '').split('.').filter(Boolean).at(-1) || toolId || '工具';
  const subject = humanizeProgressSubject(name);
  return `正在调用${subject}工具...`;
}

function humanizeProgressSubject(value) {
  const source = String(value || '').trim();
  if (!source) return '当前任务';
  const withoutNamespace = source
    .replace(/^system[._-]/i, '')
    .replace(/^game[._-]/i, '')
    .replace(/^core[._-]/i, '');
  const tokenText = withoutNamespace
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._:/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const dictionaries = {
    turn: '回合',
    snapshot: '快照',
    deterministic: '自动规则',
    pre: '前置',
    post: '后置',
    tick: '计时',
    input: '输入',
    intake: '接收',
    baseline: '基础上下文',
    load: '读取',
    context: '上下文',
    minimal: '基础',
    route: '路由',
    intent: '意图',
    worldbook: '世界书',
    activate: '激活',
    rag: '记忆检索',
    guidance: '引导',
    retrieval: '检索',
    targeted: '定向',
    budget: '预算',
    resolver: '解析器',
    orchestration: '编排',
    adjudication: '裁决',
    impact: '影响',
    plan: '规划',
    validate: '校验',
    state: '状态',
    commit: '提交',
    narrative: '叙事',
    render: '生成',
    structured: '结构化',
    parse: '解析',
    memory: '记忆',
    finalize: '收尾',
    postprocess: '后处理',
    data: '数据',
    query: '查询',
    records: '记录',
    record: '记录',
    contextplanner: '上下文规划',
    planner: '规划',
    echo: '回显',
    tool: '工具'
  };
  const translated = tokenText
    .split(' ')
    .map((token) => dictionaries[token.toLowerCase()] || token)
    .join('');
  return translated || source;
}

function resolveTemplateValue(value, scope) {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/);
    if (exact) return getPath(scope, exact[1]);
    return value.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, path) => {
      const resolved = getPath(scope, path);
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplateValue(item, scope));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      resolveTemplateValue(child, scope)
    ]));
  }
  return value;
}

function getPath(source, path) {
  return String(path).split('.').reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, source);
}

function buildConfigStepInput({ request, config, step, index, rootTurnId, previousOutput }) {
  const previousHandoff = buildPreviousHandoff({
    request,
    config,
    step,
    rootTurnId,
    previousOutput
  });
  const previous = previousHandoff.templateScope;
  const templatedInput = resolveTemplateValue(step.input || {}, {
    request,
    config,
    step,
    previous
  });
  const handoffText = resolveHandoffText({
    request,
    step,
    previous
  });
  const baseInput = {
    ...request,
    text: handoffText,
    ...templatedInput
  };
  const profileOverride = combineInlineProfileOverrides([
    request.profile,
    step.profile,
    stepModuleProfileOverride(step),
    templatedInput.profile
  ]);
  return {
    ...baseInput,
    dryRun: request.dryRun,
    turnId: templatedInput.turnId || `${rootTurnId}_${safeSegment(step.id)}`,
    profileId: templatedInput.profileId || resolveStepProfileId({ request, config, step }),
    profile: profileOverride,
    phaseOverrides: mergeConfigStepPhaseOverrides({ request, config, step, templatedInput }),
    useActiveConfig: false,
    metadata: {
      ...(request.metadata || {}),
      ...(step.metadata || {}),
      ...(templatedInput.metadata || {}),
      agentLoopConfig: {
        id: config.id,
        name: config.name,
        stepCount: normalizeLoopConfigSteps(config.steps).length
      },
      agentLoopStep: {
        id: step.id,
        title: step.title || step.id,
        order: step.order,
        index
      },
      previousHandoffPolicy: previousHandoff.policy,
      previousContextEnvelope: previousHandoff.contextEnvelope,
      previousLoopSummary: previousHandoff.summary,
      previousLoopOutput: previousHandoff.output
    },
    toolContext: {
      ...(request.toolContext || {}),
      ...(templatedInput.toolContext || {}),
      agentLoopConfig: {
        id: config.id,
        stepId: step.id,
        stepIndex: index
      }
    }
  };
}

function stepModuleProfileOverride(step) {
  const modules = normalizeLoopModules(step.modules || step.moduleSequence || step.phases);
  if (modules.length === 0) return undefined;
  return {
    inherit: step.replaceProfilePhases === false,
    replacePhases: step.replaceProfilePhases !== false,
    metadata: {
      generatedFromLoopStep: step.id,
      executionModel: step.executionModel || 'profile-modules'
    },
    phases: modules.map((moduleConfig) => loopModuleToPhase(moduleConfig))
  };
}

function loopModuleToPhase(moduleConfig) {
  const phaseConfig = {
    id: moduleConfig.phaseId || moduleConfig.id,
    title: moduleConfig.title || moduleConfig.id,
    order: moduleConfig.order,
    enabled: moduleConfig.enabled !== false,
    mode: moduleConfig.mode || 'built_in',
    llm: Boolean(moduleConfig.llm),
    mutatesState: Boolean(moduleConfig.mutatesState),
    mayMutate: Boolean(moduleConfig.mayMutate),
    required: moduleConfig.required !== false,
    description: moduleConfig.description || '',
    progressLabel: normalizeOptionalText(moduleConfig.progressLabel),
    toolCalls: normalizeConfiguredToolCalls(moduleConfig.toolCalls),
    config: normalizePlainObject(moduleConfig.config),
    metadata: normalizePlainObject(moduleConfig.metadata)
  };
  if (moduleConfig.promptTemplate) phaseConfig.promptTemplate = moduleConfig.promptTemplate;
  if (moduleConfig.inputSchema) phaseConfig.inputSchema = moduleConfig.inputSchema;
  if (moduleConfig.outputSchema) phaseConfig.outputSchema = moduleConfig.outputSchema;
  return phaseConfig;
}

function combineInlineProfileOverrides(overrides = []) {
  let combined;
  for (const override of overrides) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) continue;
    const next = cloneJson(override);
    combined = combined ? mergeInlineProfileOverride(combined, next) : next;
  }
  return combined;
}

function mergeInlineProfileOverride(baseInput = {}, overrideInput = {}) {
  const base = cloneJson(baseInput);
  const override = cloneJson(overrideInput);
  const merged = {
    ...base,
    ...override,
    id: override.id || base.id,
    name: override.name || override.title || base.name,
    metadata: {
      ...(base.metadata || {}),
      ...(override.metadata || {})
    },
    llm: {
      ...(base.llm || {}),
      ...(override.llm || {})
    }
  };
  if (Array.isArray(override.routes)) {
    merged.routes = override.routes;
  } else if (Array.isArray(base.routes)) {
    merged.routes = base.routes;
  }
  if (Array.isArray(override.phases)) {
    const replacePhases = override.inherit === false || override.replacePhases === true;
    merged.phases = replacePhases
      ? normalizePhases(override.phases)
      : mergePhases(base.phases || [], override.phases);
  } else if (Array.isArray(base.phases)) {
    merged.phases = normalizePhases(base.phases);
  }
  return merged;
}

function mergeConfigStepPhaseOverrides({ request, config, step, templatedInput }) {
  const overrides = [
    ...progressLabelsToPhaseOverrides(
      config.phaseProgressLabels || config.progressLabels,
      step.phaseProgressLabels || step.progressLabels,
      templatedInput.phaseProgressLabels || templatedInput.progressLabels
    ),
    ...routerPolicyToPhaseOverrides(
      config.routerPolicy || config.router || config.intentRouter,
      step.routerPolicy || step.router || step.intentRouter,
      templatedInput.routerPolicy || templatedInput.router || templatedInput.intentRouter
    )
  ];
  if (Array.isArray(request.phaseOverrides)) overrides.push(...request.phaseOverrides);
  if (Array.isArray(step.phaseOverrides)) overrides.push(...step.phaseOverrides);
  if (Array.isArray(templatedInput.phaseOverrides)) overrides.push(...templatedInput.phaseOverrides);
  return overrides.length > 0 ? overrides : undefined;
}

function phaseProgressOverridesForConfig(config, profileId) {
  const steps = normalizeLoopConfigSteps(config.steps);
  const matchingStep = steps.find((step) => step.enabled !== false && (
    step.profileId === profileId
    || (!step.profileId && config.activeProfileId === profileId)
  )) || steps.find((step) => step.enabled !== false);
  return [
    ...progressLabelsToPhaseOverrides(
      config.phaseProgressLabels || config.progressLabels,
      matchingStep?.phaseProgressLabels || matchingStep?.progressLabels
    ),
    ...routerPolicyToPhaseOverrides(
      config.routerPolicy || config.router || config.intentRouter,
      matchingStep?.routerPolicy || matchingStep?.router || matchingStep?.intentRouter
    )
  ];
}

function progressLabelsToPhaseOverrides(...sources) {
  const labels = Object.assign({}, ...sources.map((source) => normalizeProgressLabels(source)));
  return Object.entries(labels).map(([phaseId, progressLabel]) => ({
    id: phaseId,
    progressLabel
  }));
}

function routerPolicyToPhaseOverrides(...sources) {
  const routerPolicy = mergeRouterPolicies(...sources);
  if (!routerPolicy) return [];
  const resolverConfig = {
    routerPolicy
  };
  if (routerPolicy.allowedResolverToolIds?.length) {
    resolverConfig.allowedResolverToolIds = [...routerPolicy.allowedResolverToolIds];
  }
  if (routerPolicy.additionalResolverToolIds?.length) {
    resolverConfig.additionalResolverToolIds = [...routerPolicy.additionalResolverToolIds];
  }
  if (routerPolicy.blockedResolverToolIds?.length) {
    resolverConfig.blockedResolverToolIds = [...routerPolicy.blockedResolverToolIds];
  }
  if (routerPolicy.allowUnlistedResolverTools === true) {
    resolverConfig.allowUnlistedResolverTools = true;
  }
  return [
    {
      id: 'route.intent',
      config: {
        routerPolicy
      }
    },
    {
      id: 'resolver.orchestration',
      config: resolverConfig
    }
  ];
}

function buildPreviousHandoff({ request, config, step, rootTurnId, previousOutput }) {
  const tokenMode = resolveHandoffTokenMode({ request, config, step });
  const contextEnvelope = previousOutput
    ? createContextEnvelope({
        id: `flow:${rootTurnId}:previous:${safeSegment(step.id)}`,
        kind: 'agent_loop_handoff',
        title: 'Previous loop output handoff',
        status: Array.isArray(previousOutput.errors) && previousOutput.errors.length ? 'error' : 'success',
        output: previousOutput,
        trace: previousOutput.trace,
        artifactRefs: compactContextEnvelopeRefs(previousOutput.contextEnvelopes, envelopeRefOptionsForTokenMode(tokenMode)),
        maxSummaryChars: contextEnvelopeSummaryChars(tokenMode),
        maxScalars: contextEnvelopeScalarLimit(tokenMode)
      })
    : undefined;
  const summary = previousOutput ? summarizeLoopOutput(previousOutput, summaryOptionsForTokenMode(tokenMode)) : undefined;
  const minimal = previousOutput ? minimalLoopOutput(previousOutput, contextEnvelope) : undefined;
  const output = selectPreviousLoopOutput({
    tokenMode,
    previousOutput,
    summary,
    contextEnvelope,
    minimal
  });

  return {
    tokenMode,
    templateScope: output,
    contextEnvelope,
    summary,
    output,
    policy: {
      tokenMode,
      options: ['none', 'light', 'super', 'extreme'],
      previousLoopOutput: previousLoopOutputPolicy(tokenMode),
      fullOutputLocation: 'flow steps[].output, turn phases[].output, and trace files'
    }
  };
}

function selectPreviousLoopOutput({ tokenMode, previousOutput, summary, contextEnvelope, minimal }) {
  if (!previousOutput) return undefined;
  if (tokenMode === 'none') return previousOutput;
  if (tokenMode === 'extreme') return minimal;
  if (tokenMode === 'super') {
    return {
      ...minimal,
      intent: summary?.intent,
      narrative: summary?.narrative,
      errors: summary?.errors,
      warnings: summary?.warnings
    };
  }
  return summary;
}

function previousLoopOutputPolicy(tokenMode) {
  if (tokenMode === 'none') return 'full_previous_output';
  if (tokenMode === 'extreme') return 'minimal_ids_envelope_and_trace_ref';
  if (tokenMode === 'super') return 'tight_summary_with_ids_envelope_trace_and_short_narrative';
  return 'clipped_summary_with_context_envelope_refs';
}

function resolveHandoffTokenMode({ request, config, step }) {
  return normalizeHandoffTokenMode(
    step.handoff?.tokenMode
      || step.handoff?.contextMode
      || step.handoff?.compaction
      || config.handoff?.tokenMode
      || config.handoff?.contextMode
      || request.handoffTokenMode
      || request.tokenMode
      || DEFAULT_HANDOFF_TOKEN_MODE
  );
}

function normalizeHandoffTokenMode(value) {
  const normalized = String(value || DEFAULT_HANDOFF_TOKEN_MODE).trim().toLowerCase();
  if (['off', 'full', 'legacy', 'copy', 'copy_full'].includes(normalized)) return 'none';
  if (['slight', 'compact', 'balanced', 'default'].includes(normalized)) return 'light';
  if (['aggressive', 'heavy', 'very_compact'].includes(normalized)) return 'super';
  if (['max', 'minimal', 'reference_only', 'refs'].includes(normalized)) return 'extreme';
  return HANDOFF_TOKEN_MODES.has(normalized) ? normalized : DEFAULT_HANDOFF_TOKEN_MODE;
}

function summaryOptionsForTokenMode(tokenMode) {
  if (tokenMode === 'super') {
    return {
      narrativeChars: 300,
      draftChars: 200,
      layerChars: 140,
      contextEnvelopeLimit: 3,
      contextEnvelopeSummaryChars: 160,
      resolverCandidateLimit: 3,
      resolverReasonChars: 100,
      warningLimit: 3,
      errorLimit: 3
    };
  }
  if (tokenMode === 'extreme') {
    return {
      includeNarrative: false,
      includeResolverCandidates: false,
      contextEnvelopeLimit: 1,
      contextEnvelopeSummaryChars: 120,
      warningLimit: 1,
      errorLimit: 1
    };
  }
  return {
    narrativeChars: 800,
    draftChars: 500,
    layerChars: 300,
    contextEnvelopeLimit: 5,
    contextEnvelopeSummaryChars: 300,
    resolverCandidateLimit: 5,
    resolverReasonChars: 200,
    warningLimit: 5,
    errorLimit: 5
  };
}

function envelopeRefOptionsForTokenMode(tokenMode) {
  if (tokenMode === 'extreme') return { limit: 1, summaryChars: 120 };
  if (tokenMode === 'super') return { limit: 3, summaryChars: 160 };
  return { limit: 5, summaryChars: 300 };
}

function contextEnvelopeSummaryChars(tokenMode) {
  if (tokenMode === 'extreme') return 180;
  if (tokenMode === 'super') return 320;
  return 500;
}

function contextEnvelopeScalarLimit(tokenMode) {
  if (tokenMode === 'extreme') return 12;
  if (tokenMode === 'super') return 20;
  return 30;
}

function resolveHandoffText({ request, step, previous }) {
  const mode = step.handoff?.input || 'preserve';
  if (mode === 'previous_narrative') {
    return previous?.narrative?.content || previous?.narrative?.draft || request.text || '';
  }
  if (mode === 'previous_intent') {
    return previous?.intent?.sourceText || request.text || '';
  }
  return request.text || '';
}

function resolveStepProfileId({ request, config, step }) {
  return step.profileId
    || step.profile?.id
    || request.profileId
    || config.activeProfileId
    || resolveConfigProfileId(config)
    || 'default_v1';
}

function resolveConfigProfileId(config) {
  const normalized = normalizeLoopConfig(config || createDefaultLoopConfig());
  return normalized.activeProfileId
    || normalized.steps.find((step) => step.enabled !== false && step.profileId)?.profileId
    || 'default_v1';
}

function summarizeLoopOutput(output, options = {}) {
  if (!output || typeof output !== 'object') return undefined;
  const {
    includeNarrative = true,
    includeResolverCandidates = true,
    narrativeChars = 800,
    draftChars = 500,
    layerChars = 300,
    contextEnvelopeLimit = 5,
    contextEnvelopeSummaryChars = 300,
    resolverCandidateLimit = 5,
    resolverReasonChars = 200,
    warningLimit = 5,
    errorLimit = 5
  } = options;
  const narrativeText = output.narrative?.content || output.narrative?.draft || '';
  return {
    turnId: output.turnId,
    profileId: output.profileId,
    dryRun: output.dryRun,
    chatSessionId: output.chatSessionId,
    sceneId: output.sceneId,
    intent: output.intent,
    compactSummary: output.contextEnvelope?.compactSummary,
    contextEnvelope: output.contextEnvelope || compactContextEnvelopeRefs(output.contextEnvelopes, {
      limit: contextEnvelopeLimit,
      summaryChars: contextEnvelopeSummaryChars
    }).at(-1),
    contextEnvelopeRefs: compactContextEnvelopeRefs(output.contextEnvelopes, {
      limit: contextEnvelopeLimit,
      summaryChars: contextEnvelopeSummaryChars
    }),
    phaseCount: Array.isArray(output.phases) ? output.phases.length : 0,
    toolResultCount: Array.isArray(output.toolResults) ? output.toolResults.length : 0,
    resolverCandidates: includeResolverCandidates
      ? compactResolverCandidates(output.resolverCandidates, {
          limit: resolverCandidateLimit,
          reasonChars: resolverReasonChars
        })
      : undefined,
    narrative: includeNarrative && output.narrative
      ? {
          useLlm: output.narrative.useLlm,
          content: clampText(narrativeText, narrativeChars),
          draft: clampText(output.narrative.draft, draftChars),
          layerKeys: output.narrative.layers && typeof output.narrative.layers === 'object'
            ? Object.keys(output.narrative.layers)
            : [],
          layers: compactTextObject(output.narrative.layers, layerChars)
        }
      : undefined,
    warnings: Array.isArray(output.warnings) ? output.warnings.slice(0, warningLimit) : [],
    errors: Array.isArray(output.errors) ? output.errors.slice(0, errorLimit) : [],
    trace: compactTraceRef(output.trace)
  };
}

function minimalLoopOutput(output, contextEnvelope) {
  return {
    turnId: output.turnId,
    profileId: output.profileId,
    dryRun: output.dryRun,
    chatSessionId: output.chatSessionId,
    sceneId: output.sceneId,
    intent: output.intent
      ? {
          intent: output.intent.intent,
          confidence: output.intent.confidence,
          sourceText: clampText(output.intent.sourceText, 120)
        }
      : undefined,
    phaseCount: Array.isArray(output.phases) ? output.phases.length : 0,
    toolResultCount: Array.isArray(output.toolResults) ? output.toolResults.length : 0,
    contextEnvelope: contextEnvelope
      ? {
          kind: contextEnvelope.kind,
          id: contextEnvelope.id,
          status: contextEnvelope.status,
          compactSummary: contextEnvelope.compactSummary,
          stateDelta: contextEnvelope.stateDelta,
          artifactRefs: contextEnvelope.artifactRefs,
          stats: contextEnvelope.stats
        }
      : undefined,
    trace: compactTraceRef(output.trace)
  };
}

function compactResolverCandidates(candidates, { limit = 5, reasonChars = 200 } = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .slice(0, limit)
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return candidate;
      return {
        id: candidate.id,
        toolId: candidate.toolId,
        status: candidate.status,
        intent: candidate.intent,
        confidence: candidate.confidence,
        reason: clampText(candidate.reason, reasonChars)
      };
    });
}

function compactContextEnvelopeRefs(envelopes, { limit = 5, summaryChars = 300 } = {}) {
  return (Array.isArray(envelopes) ? envelopes : [])
    .slice(-limit)
    .filter((envelope) => envelope && typeof envelope === 'object')
    .map((envelope) => ({
      kind: envelope.kind || 'context_envelope',
      id: envelope.id,
      title: envelope.title,
      status: envelope.status,
      compactSummary: clampText(envelope.compactSummary, summaryChars),
      stats: envelope.stats
    }));
}

function compactTraceRef(trace) {
  if (!trace || typeof trace !== 'object') return undefined;
  return {
    traceId: trace.traceId || trace.id,
    directory: trace.directory,
    files: trace.files
      ? {
          output: trace.files.output,
          summary: trace.files.summary
        }
      : undefined
  };
}

function compactTextObject(value, maxChars) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    typeof child === 'string' ? clampText(child, maxChars) : child
  ]));
}

function buildLoopOutput({ request, profile, state, trace, finishedAt }) {
  const phases = state.phaseResults.map((phase) => ({
    phaseId: phase.phaseId,
    title: phase.title,
    progressLabel: phase.progressLabel,
    order: phase.order,
    enabled: phase.enabled,
    skipped: phase.skipped,
    llm: phase.llm,
    mutatesState: phase.mutatesState,
    durationMs: phase.durationMs,
    output: phase.output,
    contextEnvelope: phase.contextEnvelope,
    toolCalls: phase.toolCalls,
    errors: phase.errors,
    warnings: phase.warnings
  }));
  return {
    turnId: state.turnId,
    profileId: profile.id,
    dryRun: request.dryRun,
    chatSessionId: request.chatSessionId,
    sceneId: request.sceneId,
    startedAt: state.startedAt,
    finishedAt,
    phases,
    intent: state.intent,
    resolverCandidates: state.resolverCandidates || [],
    contextPlan: state.contextPlan,
    contextEnvelope: state.latestContextEnvelope,
    contextEnvelopes: state.contextEnvelopeList,
    actorControl: state.actorControl,
    narrative: state.narrative,
    structured: state.structured,
    debugSummary: state.debugSummary,
    toolResults: state.toolResults,
    warnings: state.warnings,
    errors: state.errors,
    trace
  };
}

function renderDebugPrompt(output) {
  return [
    '# AI-DND Agent Loop Debug',
    `turnId: ${output.turnId}`,
    `profileId: ${output.profileId}`,
    `dryRun: ${output.dryRun}`,
    '',
    '## Phases',
    ...output.phases.map((phase) => `- ${phase.phaseId}: ${phase.skipped ? 'skipped' : (phase.errors.length ? 'error' : 'ok')} (${phase.durationMs}ms)`),
    '',
    '## Intent',
    JSON.stringify(output.intent || {}, null, 2),
    '',
    '## Narrative Prompt',
    output.narrative?.userPrompt || output.narrative?.draft || ''
  ].join('\n');
}

function getChatSummary(appDatabase, chatSessionId) {
  try {
    const session = appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: true,
      includeDataDatabase: false
    });
    return {
      id: session.id,
      title: session.title,
      characterCardId: session.characterCardId,
      characterName: session.characterCard?.data?.name || session.characterCard?.name,
      updatedAt: session.updatedAt,
      messageCount: appDatabase.listChatMessages(chatSessionId).length
    };
  } catch (error) {
    return {
      id: chatSessionId,
      error: serializeError(error)
    };
  }
}

function normalizeActiveScope(input = {}) {
  return {
    scope: requireText(input.scope || input.activeScope || 'global', 'scope'),
    scopeId: requireText(input.scopeId || input.activeScopeId || 'default', 'scopeId')
  };
}

function activeConfigRecordId(scopeInput = {}) {
  const scope = normalizeActiveScope(scopeInput);
  return `${safeSegment(scope.scope)}__${safeSegment(scope.scopeId)}`;
}

function buildLoopConfigPreview({ loop, request, config, source }) {
  const normalized = normalizeLoopConfig(config);
  const steps = normalizeLoopConfigSteps(normalized.steps);
  const rootTurnId = request.turnId || `preview_${safeSegment(normalized.id)}`;
  const previewSteps = steps.map((step, index) => previewLoopStep({
    loop,
    request,
    config: normalized,
    source,
    step,
    index,
    rootTurnId
  }));
  const modules = previewSteps.flatMap((step) => step.modules.map((moduleConfig) => ({
    stepId: step.id,
    moduleId: moduleConfig.id,
    order: moduleConfig.order,
    title: moduleConfig.title,
    enabled: moduleConfig.enabled,
    llm: moduleConfig.llm,
    writes: moduleConfig.mutatesState || moduleConfig.mayMutate,
    toolCallCount: moduleConfig.toolCalls.length
  })));
  const toolCalls = previewSteps.flatMap((step) => step.modules.flatMap((moduleConfig) => moduleConfig.toolCalls.map((call) => ({
    stepId: step.id,
    moduleId: moduleConfig.id,
    callId: call.id,
    toolId: call.toolId,
    order: call.order,
    status: call.status,
    mutatesState: call.mutatesState,
    executeInDryRun: call.executeInDryRun
  }))));
  return {
    format: 'ai-dnd-loop-flow-preview/v1',
    purpose: 'Read-only resolved execution blueprint for managers and human review. Edit sourceConfig through upsert_config or import/export; execute with dry_run_config_turn/run_config_turn.',
    configId: normalized.id,
    configSource: source,
    activeProfileId: normalized.activeProfileId,
    summary: {
      stepCount: previewSteps.length,
      enabledStepCount: previewSteps.filter((step) => step.enabled).length,
      moduleCount: modules.length,
      enabledModuleCount: modules.filter((moduleConfig) => moduleConfig.enabled !== false).length,
      llmModuleCount: modules.filter((moduleConfig) => moduleConfig.llm).length,
      writeModuleCount: modules.filter((moduleConfig) => moduleConfig.writes).length,
      toolCallCount: toolCalls.length,
      missingToolCallCount: toolCalls.filter((call) => call.status === 'missing').length,
      routerPolicyEnabled: Boolean(normalized.routerPolicy)
    },
    management: {
      sourceConfigTool: 'system.agent_loop.get_config',
      saveTool: 'system.agent_loop.upsert_config',
      archiveTool: 'system.agent_loop.archive_config',
      switchTool: 'system.agent_loop.switch_config',
      dryRunTool: 'system.agent_loop.dry_run_config_turn',
      runTool: 'system.agent_loop.run_config_turn'
    },
    sourceConfig: publicLoopConfig(normalized, { includeSteps: true }),
    routerPolicy: routerPolicySummary(normalized.routerPolicy),
    steps: previewSteps,
    moduleOrder: modules,
    toolCallOrder: toolCalls
  };
}

function previewLoopStep({ loop, request, config, source, step, index, rootTurnId }) {
  const stepInput = buildConfigStepInput({
    request,
    config,
    step,
    index,
    rootTurnId,
    previousOutput: undefined
  });
  const profile = loop.resolveProfile(stepInput);
  const modules = profileToLoopModules(profile).map((moduleConfig) => previewLoopModule(moduleConfig, {
    toolManager: loop.toolManager
  }));
  const explicitModules = normalizeLoopModules(step.modules || step.moduleSequence || step.phases);
  const routerPolicy = mergeRouterPolicies(config.routerPolicy, step.routerPolicy);
  return {
    id: step.id,
    title: step.title || step.id,
    order: step.order,
    index,
    enabled: step.enabled !== false,
    required: step.required !== false,
    mode: step.mode || 'turn',
    executionModel: explicitModules.length > 0 ? 'profile-modules' : 'profile',
    profileId: profile.id,
    profileSource: explicitModules.length > 0
      ? 'step.modules'
      : (step.profile ? 'step.profile' : `profile:${profile.id}`),
    configSource: source,
    replaceProfilePhases: explicitModules.length > 0 ? step.replaceProfilePhases !== false : false,
    handoff: {
      input: step.handoff?.input || 'preserve',
      tokenMode: resolveHandoffTokenMode({ request, config, step }),
      previousOutput: step.handoff?.previousOutput,
      previousSummary: step.handoff?.previousSummary
    },
    inputTemplate: step.input || {},
    metadata: step.metadata || {},
    phaseProgressLabels: step.phaseProgressLabels || {},
    routerPolicy: routerPolicySummary(routerPolicy),
    modules
  };
}

function previewLoopModule(moduleConfig, { toolManager } = {}) {
  const contract = phaseIoContract(moduleConfig);
  const toolCalls = normalizeConfiguredToolCalls(moduleConfig.toolCalls).map((call) => previewLoopToolCall(call, {
    toolManager
  }));
  return {
    id: moduleConfig.id,
    phaseId: moduleConfig.phaseId || moduleConfig.id,
    title: moduleConfig.title || moduleConfig.id,
    description: moduleConfig.description || '',
    order: moduleConfig.order,
    enabled: moduleConfig.enabled !== false,
    required: moduleConfig.required !== false,
    mode: moduleConfig.mode || 'built_in',
    llm: Boolean(moduleConfig.llm),
    mutatesState: Boolean(moduleConfig.mutatesState),
    mayMutate: Boolean(moduleConfig.mayMutate),
    progressLabel: moduleConfig.progressLabel || fallbackProgressLabelForPhase(moduleConfig),
    contract,
    config: moduleConfig.config || {},
    routerPolicy: routerPolicySummary(moduleConfig.config?.routerPolicy || moduleConfig.config?.router || moduleConfig.config?.intentRouter),
    prompt: {
      hasTemplate: Boolean(moduleConfig.promptTemplate),
      template: moduleConfig.promptTemplate || '',
      length: moduleConfig.promptTemplate ? String(moduleConfig.promptTemplate).length : 0
    },
    toolCalls
  };
}

function previewLoopToolCall(call, { toolManager } = {}) {
  let tool;
  let status = 'unavailable';
  try {
    tool = toolManager?.getTool ? toolManager.getTool(call.toolId) : undefined;
    status = tool ? 'available' : 'unavailable';
  } catch {
    status = 'missing';
  }
  return {
    id: call.id,
    toolId: call.toolId,
    order: call.order,
    enabled: call.enabled !== false,
    required: call.required === true,
    execute: call.execute,
    executeInDryRun: call.executeInDryRun === true,
    dryRunBehavior: call.executeInDryRun === true ? 'execute_if_non_mutating' : 'planned_only',
    progressLabel: call.progressLabel || fallbackProgressLabelForTool(call.toolId),
    status,
    title: tool?.title,
    description: tool?.description,
    mutatesState: Boolean(tool?.mutatesState),
    autoCallable: Boolean(tool?.autoCallable),
    tags: Array.isArray(tool?.tags) ? tool.tags : [],
    inputTemplate: call.input || {},
    contextTemplate: call.context || {},
    inputSchema: tool?.inputSchema,
    outputSchema: tool?.outputSchema
  };
}

function phaseIoContract(phaseConfig = {}) {
  const id = String(phaseConfig.id || phaseConfig.phaseId || '').trim();
  const known = PHASE_IO_CONTRACTS[id];
  if (known) return cloneJson(known);
  return ioContract({
    reads: ['state', 'request', 'phase.config'],
    writes: [`state.phaseById.${id || 'custom'}`],
    output: ['phaseId', 'mode', 'description', 'promptTemplate', 'inputSchema', 'outputSchema', 'configuredToolCalls']
  });
}

function ioContract({ reads = [], writes = [], output = [] } = {}) {
  return {
    reads: [...reads],
    writes: [...writes],
    output: [...output]
  };
}

function publicLoopConfig(config, { includeSteps = true } = {}) {
  const normalized = normalizeLoopConfig(config);
  const publicData = {
    id: normalized.id,
    name: normalized.name || normalized.title,
    description: normalized.description || '',
    version: normalized.version,
    mutableByUser: normalized.mutableByUser !== false,
    tags: Array.isArray(normalized.tags) ? normalized.tags : [],
    activeProfileId: normalized.activeProfileId,
    stepCount: normalized.steps.length,
    phaseProgressLabels: normalized.phaseProgressLabels || {},
    routerPolicy: normalized.routerPolicy,
    handoff: normalized.handoff || {},
    hotSwitch: normalized.hotSwitch || {},
    archive: normalized.archive || {},
    metadata: normalized.metadata || {}
  };
  if (includeSteps) {
    publicData.steps = normalized.steps.map((step) => publicLoopConfigStep(step));
  }
  return publicData;
}

function publicLoopConfigStep(step) {
  const modules = normalizeLoopModules(step.modules || step.moduleSequence || step.phases);
  return {
    id: step.id,
    title: step.title,
    description: step.description || '',
    order: step.order,
    enabled: step.enabled !== false,
    required: step.required !== false,
    mode: step.mode || 'turn',
    executionModel: step.executionModel || (modules.length > 0 ? 'profile-modules' : 'profile'),
    profileId: step.profileId,
    replaceProfilePhases: modules.length > 0 ? step.replaceProfilePhases !== false : Boolean(step.replaceProfilePhases),
    hasInlineProfile: Boolean(step.profile),
    phaseOverrideCount: Array.isArray(step.phaseOverrides) ? step.phaseOverrides.length : 0,
    moduleCount: modules.length,
    moduleSequence: modules.map((moduleConfig) => moduleConfig.id),
    toolCallSequence: toolCallSequenceForModules(modules),
    modules,
    phaseProgressLabels: step.phaseProgressLabels || {},
    routerPolicy: step.routerPolicy,
    handoff: step.handoff || {},
    input: step.input || {},
    metadata: step.metadata || {}
  };
}

function publicProfile(profile, { includePhases = true } = {}) {
  const publicData = {
    id: profile.id,
    name: profile.name || profile.title,
    description: profile.description || '',
    version: profile.version,
    mutableByUser: profile.mutableByUser !== false,
    tags: Array.isArray(profile.tags) ? profile.tags : [],
    llm: profile.llm || {},
    phaseCount: Array.isArray(profile.phases) ? profile.phases.length : 0
  };
  if (includePhases) {
    publicData.phases = normalizePhases(profile.phases).map((phaseConfig) => ({
      id: phaseConfig.id,
      title: phaseConfig.title,
      progressLabel: phaseConfig.progressLabel || fallbackProgressLabelForPhase(phaseConfig),
      order: phaseConfig.order,
      enabled: phaseConfig.enabled !== false,
      mode: phaseConfig.mode,
      llm: Boolean(phaseConfig.llm),
      mutatesState: Boolean(phaseConfig.mutatesState),
      mayMutate: Boolean(phaseConfig.mayMutate),
      required: phaseConfig.required !== false,
      toolCallCount: Array.isArray(phaseConfig.toolCalls) ? phaseConfig.toolCalls.length : 0,
      config: phaseConfig.config || {}
    }));
  }
  return publicData;
}

function publicTool(tool) {
  return {
    id: tool.id,
    name: tool.name,
    pluginId: tool.pluginId,
    title: tool.title,
    description: tool.description,
    autoCallable: Boolean(tool.autoCallable),
    mutatesState: Boolean(tool.mutatesState),
    tags: Array.isArray(tool.tags) ? tool.tags : []
  };
}

function toolMayUseExternalApi(tool = {}) {
  const metadata = tool.metadata && typeof tool.metadata === 'object' ? tool.metadata : {};
  const tags = Array.isArray(tool.tags) ? tool.tags.map((tag) => String(tag).toLowerCase()) : [];
  return Boolean(
    metadata.llm
      || metadata.usesLlm
      || metadata.requiresLlm
      || metadata.externalApi
      || metadata.provider === 'llm'
      || tags.includes('llm')
      || tags.includes('ai')
      || tags.includes('external-api')
  );
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeSegment(value) {
  const text = String(value || '').trim();
  return text.replace(/[^0-9A-Za-z._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'default';
}

function requireText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw validationError(`${name} is required`);
  return text;
}

function clampText(value, maxChars) {
  if (value === undefined || value === null) return value;
  const text = String(value);
  if (!Number.isFinite(maxChars) || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function durationMs(startedAt, finishedAt) {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return undefined;
  return Math.max(0, finished - started);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'AgentLoopValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'AgentLoopNotFoundError';
  error.statusCode = 404;
  return error;
}

function dependencyError(message) {
  const error = new Error(message);
  error.name = 'AgentLoopDependencyError';
  error.statusCode = 500;
  return error;
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    details: error?.details
  };
}
