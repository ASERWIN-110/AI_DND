const ORDER_KEY = 'ai-dnd-tool-manager-plugin-order';
const SELECTION_KEY = 'ai-dnd-tool-manager-selection';
const BACKEND_API_BASE_KEY = 'ai-dnd-backend-api-base-v1';
const API_TARGET_SETTINGS_KEY = 'ai-dnd-api-target-settings';
const AGENT_ACCESS_POLICY_KEY = 'ai-dnd-agent-access-policy';
const TOOL_PROMPT_SETTINGS_KEY = 'ai-dnd-tool-prompt-settings';
const fallbackStorage = new Map();

const DEFAULT_AGENT_ACCESS_POLICY = Object.freeze({
  database: Object.freeze({ read: true, write: true }),
  databaseL1: Object.freeze({ read: true, write: true }),
  databaseL2: Object.freeze({ read: true, write: true }),
  databaseL3: Object.freeze({ read: true, write: true }),
  rag: Object.freeze({ read: true, write: true }),
  permanentRag: Object.freeze({ read: true, write: true }),
  runtimeRag: Object.freeze({ read: true, write: true }),
  tools: Object.freeze({})
});

const ACCESS_CALL_COUNT_LAYERS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'RAG']);
const ACCESS_CALL_COUNTER_KEYS = Object.freeze(['attempted', 'ok', 'error', 'missing', 'pending', 'empty']);
const ACCESS_CALL_COUNT_ROWS = Object.freeze([
  {
    id: 'db-l0-read',
    label: 'L0 DB Read',
    description: 'registry/basic lookup',
    layer: 'L0',
    capabilities: Object.freeze(['database:read'])
  },
  {
    id: 'db-l1-read',
    label: 'L1 DB Read',
    description: 'light profile facts',
    layer: 'L1',
    capabilities: Object.freeze(['database:read', 'databaseL1:read'])
  },
  {
    id: 'db-l2-read',
    label: 'L2 DB Read',
    description: 'deeper profile facts',
    layer: 'L2',
    capabilities: Object.freeze(['database:read', 'databaseL2:read'])
  },
  {
    id: 'db-l3-read',
    label: 'L3 DB Read',
    description: 'hidden/high-stakes facts',
    layer: 'L3',
    capabilities: Object.freeze(['database:read', 'databaseL3:read'])
  },
  {
    id: 'rag-read',
    label: 'RAG Read',
    description: 'all retrieval layers',
    layer: 'RAG',
    capabilities: Object.freeze(['rag:read'])
  },
  {
    id: 'permanent-rag-read',
    label: 'Permanent RAG Read',
    description: 'long-term retrieval',
    toolPrefix: 'system.rag_permanent.',
    capabilities: Object.freeze(['rag:read', 'permanentRag:read'])
  },
  {
    id: 'runtime-rag-read',
    label: 'Runtime RAG Read',
    description: 'short-term retrieval',
    toolPrefix: 'system.rag_runtime.',
    capabilities: Object.freeze(['rag:read', 'runtimeRag:read'])
  }
]);

const DEFAULT_API_SETTINGS = Object.freeze({
  provider: 'server',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: '',
  maxTokens: ''
});
const BACKEND_API_BASE = resolveBackendApiBase();

const DEFAULT_TOOL_PROMPT_SETTINGS = Object.freeze({
  enabled: false,
  mode: 'inject',
  replacementPrompt: '',
  systemPrompt: '',
  promptPrefix: '',
  promptSuffix: '',
  references: ''
});

const DEFAULT_ROUTER_POLICY_DRAFT = Object.freeze({
  allowedIntents: Object.freeze([]),
  blockedIntents: Object.freeze([]),
  intercepts: Object.freeze([]),
  allowedResolverToolIds: Object.freeze([
    'system.action.resolve',
    'system.combat.resolve_action',
    'system.combat.start_battle',
    'system.combat.end_battle',
    'system.persuasion.resolve',
    'system.npc_behavior.resolve',
    'system.map_relationships.find_scene_path'
  ]),
  additionalResolverToolIds: Object.freeze([]),
  blockedResolverToolIds: Object.freeze([]),
  allowUnlistedResolverTools: false
});

const LLM_SWITCH_FIELD_PRIORITY = Object.freeze(['useLlm', 'preferLlm']);
const PROMPT_FIELD_PRIORITY = Object.freeze([
  'plannerPrompt',
  'promptText',
  'prompt',
  'systemPrompt',
  'instruction',
  'instructions'
]);
const REFERENCE_FIELD_PRIORITY = Object.freeze([
  'referenceText',
  'referenceTexts',
  'referenceDocuments',
  'referenceDocs',
  'references',
  'referenceMaterial',
  'referenceFiles',
  'referenceFilePaths'
]);
const CONTEXT_REFERENCE_FIELD_PRIORITY = Object.freeze([
  'contextText',
  'recentContext',
  'context'
]);

const API_PROVIDER_DEFAULTS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  'openai-compatible': 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434',
  'llama.cpp': 'http://127.0.0.1:8080/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  tabbyapi: 'http://127.0.0.1:5000/v1',
  'lm-studio': 'http://127.0.0.1:1234/v1',
  koboldcpp: 'http://127.0.0.1:5001/v1'
});

const BUILTIN_DEPENDENCIES = Object.freeze({
  'system.action': [
    'game.dice',
    'system.npc_state',
    'system.map_state',
    'system.time',
    'system.scene_npcs',
    'system.scene_maps',
    'system.map_relationships',
    'system.npc_relationships',
    'system.factions',
    'system.character_memory',
    'system.rag_runtime',
    'system.rag_permanent',
    'system.data'
  ],
  'system.npc_behavior': [
    'system.action',
    'system.npc_state',
    'system.map_state',
    'system.scene_npcs',
    'system.scene_maps',
    'system.time',
    'system.factions',
    'system.npc_relationships',
    'system.npc_profiles',
    'system.rag_runtime',
    'system.rag_permanent'
  ],
  'system.context_planner': [
    'system.scene_npcs',
    'system.scene_maps',
    'system.npc_state',
    'system.map_state',
    'system.quests',
    'system.character_memory',
    'system.chat_compression',
    'system.rag_runtime',
    'system.rag_permanent'
  ],
  'system.scene_manager': [
    'system.scene_maps',
    'system.scene_npcs',
    'system.time',
    'system.chat_compression',
    'system.rag_runtime',
    'system.rag_permanent'
  ],
  'system.item_use': [
    'system.item_registry',
    'system.npc_state',
    'system.effects',
    'system.resources',
    'game.dice'
  ],
  'system.combat': [
    'game.dice',
    'system.effects',
    'system.resources',
    'system.scene_npcs',
    'system.npc_state',
    'system.time'
  ],
  'system.persuasion': [
    'game.dice',
    'system.scene_npcs',
    'system.npc_state',
    'system.character_memory',
    'system.npc_relationships',
    'system.factions',
    'system.rag_runtime',
    'system.rag_permanent'
  ],
  'system.triggers': [
    'system.effects',
    'system.npc_state',
    'system.party',
    'system.quests',
    'system.time'
  ],
  'system.effects': ['system.npc_state'],
  'system.resources': ['system.npc_state'],
  'system.party': ['system.npc_registry'],
  'system.factions': ['system.rag_runtime', 'system.rag_permanent'],
  'system.character_memory': ['system.chat_compression', 'system.scene_npcs'],
  'system.audit': ['system.data'],
  'system.worldline': ['system.audit', 'system.rag_runtime', 'system.rag_permanent']
});

const state = {
  plugins: [],
  tools: [],
  pluginOrder: loadOrder(),
  selectedPluginId: '',
  selectedToolId: '',
  pluginSearch: '',
  toolSearch: '',
  toolScope: 'selected',
  toolBatchScope: 'selected',
  visibility: 'all',
  enabledFilter: 'all',
  apiTargets: loadApiTargets(),
  selectedApiTargetId: 'chat',
  apiTargetSearch: '',
  agentAccessPolicy: loadAgentAccessPolicy(),
  toolPrompts: loadToolPrompts(),
  promptInventorySearch: '',
  promptInventoryFilter: 'all',
  visualAssets: [],
  visualBindings: [],
  visualTargets: {
    npc: [],
    map: []
  },
  selectedVisualAssetId: '',
  selectedVisualBindingId: '',
  assetSearch: '',
  assetTargetFilter: 'all',
  loopConfigs: [],
  loopArchives: [],
  activeLoopConfig: undefined,
  selectedLoopConfigId: '',
  loopManagerStorage: 'unknown',
  loopPreview: undefined,
  latestPromptText: '',
  latestPromptToolId: '',
  activeDetailTab: 'detail',
  debugFiles: [],
  selectedDebugFilePath: '',
  debugAutoRefresh: false,
  latestAccessCallCounts: undefined,
  latestAccessCallCountsSource: '',
  busy: false,
  draggedPluginId: ''
};

const els = {};
let debugRefreshTimer;

document.addEventListener('DOMContentLoaded', () => {
  bindElements();
  syncNavigationLinks();
  bindEvents();
  restoreSelection();
  applyRouteHash();
  activateDetailTab(state.activeDetailTab);
  loadAll();
});

function bindElements() {
  for (const id of [
    'globalStats',
    'refreshButton',
    'toolBatchScopeSelect',
    'importToolsButton',
    'exportToolsButton',
    'deleteToolsButton',
    'toolImportFileInput',
    'pluginCount',
    'pluginSearch',
    'pluginList',
    'movePluginUpButton',
    'movePluginDownButton',
    'resetOrderButton',
    'toolCount',
    'toolSearch',
    'toolScopeSelect',
    'visibilitySelect',
    'enabledSelect',
    'toolList',
    'exportButton',
    'detailViewSelect',
    'selectionHeader',
    'apiShortcutBlock',
    'dependencyBlock',
    'metadataBlock',
    'schemaMeaningBlock',
    'schemaPreview',
    'copySchemaButton',
    'toolInputJson',
    'toolContextJson',
    'executeToolButton',
    'toolOutputJson',
    'loopManagerSummary',
    'refreshLoopConfigsButton',
    'refreshLoopPreviewButton',
    'newLoopConfigButton',
    'importLoopConfigButton',
    'exportLoopConfigButton',
    'exportLoopPreviewButton',
    'loopConfigImportFileInput',
    'activeLoopConfigLabel',
    'loopStorageLabel',
    'loopConfigSelect',
    'loadLoopConfigButton',
    'saveLoopConfigButton',
    'switchLoopConfigButton',
    'archiveLoopConfigButton',
    'deleteLoopConfigButton',
    'loopPreviewSummary',
    'loopFlowPreview',
    'loopBlueprintJson',
    'loopRouterPolicySummary',
    'loopRouterPolicyJson',
    'loadLoopRouterPolicyButton',
    'applyLoopRouterPolicyButton',
    'resetLoopRouterPolicyButton',
    'loopConfigJson',
    'loopRunInputJson',
    'dryRunLoopConfigButton',
    'loopArchiveList',
    'loopRunOutputJson',
    'toolPromptTitle',
    'toolPromptSummary',
    'loadLatestPromptButton',
    'useLatestPromptButton',
    'importPromptButton',
    'exportPromptButton',
    'resetPromptButton',
    'savePromptButton',
    'promptImportFileInput',
    'promptInventorySummary',
    'promptInventorySearch',
    'promptInventoryFilter',
    'promptInventoryList',
    'exportAllPromptsButton',
    'toolPromptEnabled',
    'toolPromptMode',
    'toolPromptReplacement',
    'toolSystemPrompt',
    'toolPromptPrefix',
    'toolPromptSuffix',
    'toolPromptReferences',
    'toolPromptLatestPreview',
    'runDebugToolButton',
    'loadLatestTraceButton',
    'debugFileSelect',
    'refreshDebugFileButton',
    'debugAutoRefreshInput',
    'debugFileMeta',
    'debugFilePreview',
    'accessPolicySummary',
    'accessCallSummary',
    'accessCallCountList',
    'clearAccessCallStatsButton',
    'resetAccessPolicyButton',
    'agentDatabaseReadAccess',
    'agentDatabaseWriteAccess',
    'agentDatabaseL1ReadAccess',
    'agentDatabaseL1WriteAccess',
    'agentDatabaseL2ReadAccess',
    'agentDatabaseL2WriteAccess',
    'agentDatabaseL3ReadAccess',
    'agentDatabaseL3WriteAccess',
    'agentRagReadAccess',
    'agentRagWriteAccess',
    'agentPermanentRagReadAccess',
    'agentPermanentRagWriteAccess',
    'accessTargetTitle',
    'accessTargetSummary',
    'accessCapabilityList',
    'inheritAgentToolButton',
    'blockAgentToolButton',
    'allowAgentToolButton',
    'assetManagerSummary',
    'refreshAssetsButton',
    'assetSearchInput',
    'assetTargetFilter',
    'visualBindingList',
    'visualAssetList',
    'assetEditorTitle',
    'assetEditorSummary',
    'newAssetBindingButton',
    'resolveAssetBindingButton',
    'saveVisualAssetButton',
    'saveVisualBindingButton',
    'saveVisualAssetBindingButton',
    'visualAssetPreview',
    'visualTargetType',
    'visualTargetSelect',
    'visualTargetId',
    'visualSlot',
    'visualBindingId',
    'visualPriority',
    'visualBindingStatus',
    'visualVisibility',
    'visualConditionsJson',
    'visualAssetId',
    'visualAssetType',
    'visualAssetName',
    'visualAssetUri',
    'visualMimeType',
    'visualAssetStatus',
    'visualAssetTags',
    'visualAssetPrompt',
    'visualMetadataJson',
    'archiveVisualAssetButton',
    'archiveVisualBindingButton',
    'visualResolveOutput',
    'apiTargetCount',
    'resetApiTargetsButton',
    'apiTargetSearch',
    'apiTargetList',
    'apiTargetTitle',
    'apiTargetSubtitle',
    'copyChatApiButton',
    'apiProviderSelect',
    'apiBaseUrl',
    'apiKey',
    'apiModel',
    'apiTemperature',
    'apiMaxTokens',
    'clearApiTargetButton',
    'saveApiTargetButton',
    'openChatLink',
    'connectionStatus',
    'selectedStatus',
    'toast'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.refreshButton.addEventListener('click', loadAll);
  els.toolBatchScopeSelect.addEventListener('change', () => {
    state.toolBatchScope = els.toolBatchScopeSelect.value;
    saveSelection();
    updateButtons();
  });
  els.importToolsButton.addEventListener('click', () => els.toolImportFileInput.click());
  els.exportToolsButton.addEventListener('click', exportBatchTools);
  els.deleteToolsButton.addEventListener('click', deleteBatchTools);
  els.toolImportFileInput.addEventListener('change', importToolsFromFile);
  els.pluginSearch.addEventListener('input', () => {
    state.pluginSearch = els.pluginSearch.value.trim().toLowerCase();
    render();
  });
  els.toolSearch.addEventListener('input', () => {
    state.toolSearch = els.toolSearch.value.trim().toLowerCase();
    renderTools();
  });
  els.toolScopeSelect.addEventListener('change', () => {
    state.toolScope = els.toolScopeSelect.value;
    renderTools();
  });
  els.visibilitySelect.addEventListener('change', () => {
    state.visibility = els.visibilitySelect.value;
    renderTools();
  });
  els.enabledSelect.addEventListener('change', () => {
    state.enabledFilter = els.enabledSelect.value;
    renderTools();
  });
  els.movePluginUpButton.addEventListener('click', () => moveSelectedPlugin(-1));
  els.movePluginDownButton.addEventListener('click', () => moveSelectedPlugin(1));
  els.resetOrderButton.addEventListener('click', resetPluginOrder);
  els.exportButton.addEventListener('click', exportConfiguration);
  els.copySchemaButton.addEventListener('click', copySchema);
  els.executeToolButton.addEventListener('click', executeSelectedTool);
  els.detailViewSelect.addEventListener('change', () => activateDetailTab(els.detailViewSelect.value));
  els.refreshLoopConfigsButton.addEventListener('click', () => loadLoopManagerData());
  els.refreshLoopPreviewButton.addEventListener('click', () => refreshLoopPreview());
  els.newLoopConfigButton.addEventListener('click', createNewLoopConfigDraft);
  els.importLoopConfigButton.addEventListener('click', () => els.loopConfigImportFileInput.click());
  els.exportLoopConfigButton.addEventListener('click', exportSelectedLoopConfig);
  els.exportLoopPreviewButton.addEventListener('click', exportLoopPreview);
  els.loopConfigImportFileInput.addEventListener('change', importLoopConfigFromFile);
  els.loopConfigJson.addEventListener('input', markLoopPreviewStale);
  els.loopRouterPolicyJson.addEventListener('input', renderLoopRouterPolicySummary);
  els.loadLoopRouterPolicyButton.addEventListener('click', () => syncLoopRouterPolicyEditor({ force: true }));
  els.applyLoopRouterPolicyButton.addEventListener('click', applyLoopRouterPolicyToConfig);
  els.resetLoopRouterPolicyButton.addEventListener('click', resetLoopRouterPolicyDraft);
  els.loopConfigSelect.addEventListener('change', () => selectLoopConfig(els.loopConfigSelect.value));
  els.loadLoopConfigButton.addEventListener('click', () => loadSelectedLoopConfig());
  els.saveLoopConfigButton.addEventListener('click', saveLoopConfigFromEditor);
  els.switchLoopConfigButton.addEventListener('click', switchSelectedLoopConfig);
  els.archiveLoopConfigButton.addEventListener('click', archiveSelectedLoopConfig);
  els.deleteLoopConfigButton.addEventListener('click', deleteSelectedLoopConfig);
  els.dryRunLoopConfigButton.addEventListener('click', dryRunSelectedLoopConfig);
  els.loadLatestPromptButton.addEventListener('click', loadLatestPromptSnapshot);
  els.useLatestPromptButton.addEventListener('click', useLatestPromptAsOverride);
  els.importPromptButton.addEventListener('click', () => els.promptImportFileInput.click());
  els.exportPromptButton.addEventListener('click', exportPromptSettings);
  els.exportAllPromptsButton.addEventListener('click', exportAllPromptSettings);
  els.resetPromptButton.addEventListener('click', resetSelectedPromptSettings);
  els.savePromptButton.addEventListener('click', saveSelectedPromptSettings);
  els.promptImportFileInput.addEventListener('change', importPromptSettingsFromFile);
  els.promptInventorySearch.addEventListener('input', () => {
    state.promptInventorySearch = els.promptInventorySearch.value.trim().toLowerCase();
    renderPromptInventory();
  });
  els.promptInventoryFilter.addEventListener('change', () => {
    state.promptInventoryFilter = els.promptInventoryFilter.value;
    renderPromptInventory();
  });
  els.runDebugToolButton.addEventListener('click', executeSelectedTool);
  els.loadLatestTraceButton.addEventListener('click', loadLatestDebugTrace);
  els.debugFileSelect.addEventListener('change', () => {
    state.selectedDebugFilePath = els.debugFileSelect.value;
    refreshDebugFile();
  });
  els.refreshDebugFileButton.addEventListener('click', refreshDebugFile);
  els.debugAutoRefreshInput.addEventListener('change', () => {
    state.debugAutoRefresh = els.debugAutoRefreshInput.checked;
    updateDebugAutoRefresh();
  });
  els.refreshAssetsButton.addEventListener('click', () => refreshVisualAssetData());
  els.assetSearchInput.addEventListener('input', () => {
    state.assetSearch = els.assetSearchInput.value.trim().toLowerCase();
    renderAssetPanel();
  });
  els.assetTargetFilter.addEventListener('change', () => {
    state.assetTargetFilter = els.assetTargetFilter.value;
    renderAssetPanel();
  });
  els.newAssetBindingButton.addEventListener('click', createVisualAssetBindingDraft);
  els.resolveAssetBindingButton.addEventListener('click', resolveVisualAssetBindingDraft);
  els.saveVisualAssetButton.addEventListener('click', () => saveVisualAssetDraft({ binding: false }));
  els.saveVisualBindingButton.addEventListener('click', () => saveVisualBindingDraft({ asset: false }));
  els.saveVisualAssetBindingButton.addEventListener('click', saveVisualAssetAndBindingDraft);
  els.archiveVisualAssetButton.addEventListener('click', archiveSelectedVisualAsset);
  els.archiveVisualBindingButton.addEventListener('click', archiveSelectedVisualBinding);
  els.visualTargetType.addEventListener('change', () => {
    syncVisualTargetSelect();
    syncVisualSlotForTargetType();
    renderVisualAssetPreview();
  });
  els.visualTargetSelect.addEventListener('change', () => applyKnownVisualTarget(els.visualTargetSelect.value));
  for (const element of [
    els.visualTargetId,
    els.visualSlot,
    els.visualBindingId,
    els.visualPriority,
    els.visualBindingStatus,
    els.visualVisibility,
    els.visualConditionsJson,
    els.visualAssetId,
    els.visualAssetType,
    els.visualAssetName,
    els.visualAssetUri,
    els.visualMimeType,
    els.visualAssetStatus,
    els.visualAssetTags,
    els.visualAssetPrompt,
    els.visualMetadataJson
  ]) {
    element.addEventListener('input', renderVisualAssetPreview);
    element.addEventListener('change', renderVisualAssetPreview);
  }
  els.resetApiTargetsButton.addEventListener('click', resetApiTargets);
  els.apiTargetSearch.addEventListener('input', () => {
    state.apiTargetSearch = els.apiTargetSearch.value.trim().toLowerCase();
    renderApiTargets();
  });
  els.apiProviderSelect.addEventListener('change', applyProviderDefault);
  els.copyChatApiButton.addEventListener('click', copyChatApiToSelected);
  els.clearApiTargetButton.addEventListener('click', clearSelectedApiTarget);
  els.saveApiTargetButton.addEventListener('click', saveSelectedApiTarget);
  for (const [element, resource, operation] of [
    [els.agentDatabaseReadAccess, 'database', 'read'],
    [els.agentDatabaseWriteAccess, 'database', 'write'],
    [els.agentDatabaseL1ReadAccess, 'databaseL1', 'read'],
    [els.agentDatabaseL1WriteAccess, 'databaseL1', 'write'],
    [els.agentDatabaseL2ReadAccess, 'databaseL2', 'read'],
    [els.agentDatabaseL2WriteAccess, 'databaseL2', 'write'],
    [els.agentDatabaseL3ReadAccess, 'databaseL3', 'read'],
    [els.agentDatabaseL3WriteAccess, 'databaseL3', 'write'],
    [els.agentRagReadAccess, 'rag', 'read'],
    [els.agentRagWriteAccess, 'rag', 'write'],
    [els.agentPermanentRagReadAccess, 'permanentRag', 'read'],
    [els.agentPermanentRagWriteAccess, 'permanentRag', 'write']
  ]) {
    element.addEventListener('change', () => updateAgentAccessCapability(resource, operation, element.checked));
  }
  els.resetAccessPolicyButton.addEventListener('click', resetAgentAccessPolicy);
  els.clearAccessCallStatsButton.addEventListener('click', clearAccessCallCounts);
  els.inheritAgentToolButton.addEventListener('click', () => setSelectedToolAccessOverride(undefined));
  els.blockAgentToolButton.addEventListener('click', () => setSelectedToolAccessOverride('blocked'));
  els.allowAgentToolButton.addEventListener('click', () => setSelectedToolAccessOverride('allowed'));

  for (const button of document.querySelectorAll('.detail-tab')) {
    button.addEventListener('click', () => activateDetailTab(button.dataset.detailTab));
  }
  activateDetailTab(state.activeDetailTab);
}

async function loadAll() {
  setBusy(true);
  try {
    await api('/health');
    const [pluginsPayload, toolsPayload] = await Promise.all([
      api('/v1/tool-plugins'),
      api('/v1/tools?includeDisabled=true')
    ]);
    state.plugins = pluginsPayload.plugins || [];
    state.tools = toolsPayload.tools || [];
    reconcilePluginOrder();
    reconcileSelection();
    await loadLoopManagerData({ silent: true });
    await refreshVisualAssetData({ silent: true });
    render();
    setConnection('connected');
  } catch (error) {
    setConnection('offline');
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function reconcilePluginOrder() {
  const ids = state.plugins.map((plugin) => plugin.id);
  const known = state.pluginOrder.filter((id) => ids.includes(id));
  const added = ids.filter((id) => !known.includes(id)).sort((a, b) => a.localeCompare(b));
  state.pluginOrder = [...known, ...added];
  saveOrder();
}

function reconcileSelection() {
  if (!state.plugins.some((plugin) => plugin.id === state.selectedPluginId)) {
    state.selectedPluginId = orderedPlugins()[0]?.id || '';
  }
  if (!state.tools.some((tool) => tool.id === state.selectedToolId)) {
    const firstTool = toolsForPlugin(state.selectedPluginId)[0] || state.tools[0];
    state.selectedToolId = firstTool?.id || '';
  }
  const currentTool = selectedTool();
  if (currentTool && currentTool.pluginId !== state.selectedPluginId && state.toolScope === 'selected') {
    state.selectedToolId = toolsForPlugin(state.selectedPluginId)[0]?.id || '';
  }
  saveSelection();
}

function render() {
  renderStats();
  renderPlugins();
  renderTools();
  renderApiTargets();
  renderAccessPanel();
  renderPromptPanel();
  renderAssetPanel();
  renderDebugPanel();
  renderLoopPanel();
  renderDetails();
  updateButtons();
}

function renderStats() {
  const enabledPlugins = state.plugins.filter((plugin) => plugin.enabled !== false).length;
  const enabledTools = state.tools.filter((tool) => tool.enabled !== false).length;
  const mutatingTools = state.tools.filter((tool) => tool.mutatesState).length;
  els.globalStats.innerHTML = '';
  els.globalStats.append(
    statPill('plugins', `${enabledPlugins}/${state.plugins.length}`),
    statPill('tools', `${enabledTools}/${state.tools.length}`),
    statPill('writes', String(mutatingTools)),
    statPill('blocked', String(blockedAgentToolCount())),
    statPill('apis', String(getApiTargets().length))
  );
  els.pluginCount.textContent = `${state.plugins.length} loaded`;
  els.selectedStatus.textContent = state.selectedToolId || state.selectedPluginId || 'no selection';
}

function renderPlugins() {
  const plugins = orderedPlugins().filter((plugin) => matchesPluginSearch(plugin));
  els.pluginList.innerHTML = '';
  if (plugins.length === 0) {
    els.pluginList.append(emptyState('no plugins'));
    return;
  }

  for (const plugin of plugins) {
    const row = document.createElement('div');
    row.role = 'button';
    row.tabIndex = 0;
    row.draggable = true;
    row.className = `plugin-row${plugin.id === state.selectedPluginId ? ' active' : ''}${plugin.enabled === false ? ' disabled' : ''}`;
    row.dataset.pluginId = plugin.id;
    row.addEventListener('click', () => selectPlugin(plugin.id));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPlugin(plugin.id);
      }
    });
    row.addEventListener('dragstart', (event) => {
      state.draggedPluginId = plugin.id;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', plugin.id);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      state.draggedPluginId = '';
    });
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      reorderPlugin(state.draggedPluginId || event.dataTransfer.getData('text/plain'), plugin.id);
    });

    const priority = document.createElement('span');
    priority.className = 'priority';
    priority.textContent = String(state.pluginOrder.indexOf(plugin.id) + 1).padStart(2, '0');

    const toggle = switchControl(plugin.enabled !== false, async (checked) => {
      await patchPlugin(plugin.id, { enabled: checked });
    });

    const title = document.createElement('span');
    title.className = 'row-main';
    const name = document.createElement('span');
    name.className = 'row-title';
    name.textContent = plugin.id;
    const subtitle = document.createElement('span');
    subtitle.className = 'row-subtitle';
    const depStatus = dependencyStatus(plugin.id);
    subtitle.textContent = [
      plugin.name || '',
      depStatus.label
    ].filter(Boolean).join(' · ');
    title.append(name, subtitle);

    const count = document.createElement('span');
    count.className = 'count-cell';
    count.textContent = String(toolsForPlugin(plugin.id).length);

    row.append(priority, toggle, title, count);
    els.pluginList.append(row);
  }
}

function renderTools() {
  const tools = filteredTools();
  els.toolList.innerHTML = '';
  els.toolCount.textContent = `${tools.length} visible`;
  if (tools.length === 0) {
    els.toolList.append(emptyState('no tools'));
    renderDetails();
    return;
  }

  if (!tools.some((tool) => tool.id === state.selectedToolId)) {
    state.selectedToolId = tools[0]?.id || '';
    saveSelection();
  }

  for (const tool of tools) {
    const plugin = pluginById(tool.pluginId);
    const raw = rawToolFor(tool);
    const blocked = isAgentAccessBlocked(tool);
    const row = document.createElement('div');
    row.role = 'button';
    row.tabIndex = 0;
    row.className = `tool-row${tool.id === state.selectedToolId ? ' active' : ''}${tool.enabled === false ? ' disabled' : ''}${blocked ? ' restricted' : ''}`;
    row.dataset.toolId = tool.id;
    row.addEventListener('click', () => selectTool(tool.id));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectTool(tool.id);
      }
    });

    const toggle = switchControl(raw?.enabled !== false, async (checked) => {
      await patchTool(tool.pluginId, tool.name, { enabled: checked });
    });
    toggle.querySelector('input').disabled = plugin?.enabled === false;

    const main = document.createElement('span');
    main.className = 'row-main';
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = tool.name;
    const subtitle = document.createElement('span');
    subtitle.className = 'row-subtitle';
    subtitle.textContent = state.toolScope === 'all' ? tool.pluginId : (tool.title || tool.id);
    main.append(title, subtitle);

    const visibility = document.createElement('span');
    visibility.className = 'visibility-cell';
    visibility.textContent = tool.visibility || 'public';

    const flags = document.createElement('span');
    flags.className = 'row-flags';
    if (blocked) flags.append(flag('block', 'deny'));
    if (toolUsesLlm(tool)) flags.append(flag(activeApiSettings(tool.id) ? 'api' : 'llm', activeApiSettings(tool.id) ? 'api' : 'llm'));
    const access = classifyToolAccess(tool);
    if (access.has('database:read') || access.has('database:write')) flags.append(flag('db', 'db'));
    if ([...access].some((capability) => /^databaseL[123]:/.test(capability))) flags.append(flag('L-db', 'db'));
    if (access.has('rag:read') || access.has('rag:write')) flags.append(flag('rag', 'rag'));
    if (access.has('permanentRag:read') || access.has('permanentRag:write')) flags.append(flag('long-rag', 'rag'));
    if (tool.mutatesState) flags.append(flag('write', 'write'));
    if (tool.autoCallable) flags.append(flag('auto', 'auto'));
    if (plugin?.enabled === false) flags.append(flag('plugin off', 'warn'));
    if (!toolUsesLlm(tool) && !tool.mutatesState && !tool.autoCallable) flags.append(flag('read'));

    row.append(toggle, main, visibility, flags);
    els.toolList.append(row);
  }
  renderDetails();
}

function renderApiTargets() {
  const allTargets = getApiTargets();
  const targets = allTargets.filter((target) => matchesApiTargetSearch(target));
  els.apiTargetCount.textContent = `${allTargets.length} targets`;
  els.apiTargetList.innerHTML = '';
  if (targets.length === 0) {
    els.apiTargetList.append(emptyState('no api targets'));
    renderApiEditor();
    return;
  }
  if (!allTargets.some((target) => target.id === state.selectedApiTargetId)) {
    state.selectedApiTargetId = 'chat';
  }

  for (const target of targets) {
    const settings = apiSettingsForTarget(target.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.targetId = target.id;
    row.className = `api-target-row${target.id === state.selectedApiTargetId ? ' active' : ''}`;
    row.setAttribute('aria-pressed', target.id === state.selectedApiTargetId ? 'true' : 'false');
    row.addEventListener('click', () => selectApiTarget(target.id));

    const main = document.createElement('span');
    main.className = 'api-target-main';
    const title = document.createElement('span');
    title.className = 'api-target-title';
    title.textContent = target.label;
    const subtitle = document.createElement('span');
    subtitle.className = 'api-target-subtitle';
    subtitle.textContent = [
      target.id,
      apiSettingsLabel(settings)
    ].filter(Boolean).join(' · ');
    main.append(title, subtitle);

    const kind = document.createElement('span');
    kind.className = `api-target-kind ${target.kind}`;
    kind.textContent = target.kind === 'base' ? 'base' : 'tool';
    row.append(main, kind);
    els.apiTargetList.append(row);
  }
  renderApiEditor();
}

function renderApiEditor() {
  const targets = getApiTargets();
  const target = targets.find((candidate) => candidate.id === state.selectedApiTargetId) || targets[0];
  if (!target) return;
  state.selectedApiTargetId = target.id;
  const settings = apiSettingsForTarget(target.id);
  els.apiTargetTitle.textContent = target.label;
  els.apiTargetSubtitle.textContent = `${target.id} · ${apiSettingsLabel(settings)}`;
  els.apiProviderSelect.value = settings.provider;
  els.apiBaseUrl.value = settings.baseUrl;
  els.apiKey.value = settings.apiKey;
  els.apiModel.value = settings.model;
  els.apiTemperature.value = settings.temperature;
  els.apiMaxTokens.value = settings.maxTokens;
  saveSelection();
}

function selectApiTarget(targetId) {
  state.selectedApiTargetId = targetId;
  saveSelection();
  renderApiTargets();
}

function getApiTargets() {
  const llmTools = state.tools
    .filter(toolUsesLlm)
    .sort((a, b) => a.id.localeCompare(b.id));
  return [
    {
      id: 'chat',
      label: 'Chat LLM',
      kind: 'base',
      description: 'Chat response model'
    },
    {
      id: 'tool-calling',
      label: 'Tool-Calling LLM',
      kind: 'base',
      description: 'Model that plans tool calls'
    },
    ...llmTools.map((tool) => ({
      id: tool.id,
      label: tool.id,
      kind: 'tool',
      tool,
      description: tool.description || tool.title || ''
    }))
  ];
}

function toolUsesLlm(tool) {
  if (!tool) return false;
  const metadata = tool.metadata || {};
  if (metadata.llm === true || metadata.usesLlm === true || metadata.requiresLlm === true || metadata.llmTool === true) return true;
  if ((tool.tags || []).some((tag) => String(tag).toLowerCase() === 'llm')) return true;
  if (String(tool.description || '').toLowerCase().includes('llm')) return true;
  if (schemaHasKey(tool.inputSchema, 'useLlm')) return true;
  const plugin = pluginById(tool.pluginId);
  const optional = plugin?.metadata?.optionalLlmEntryPoints;
  return Array.isArray(optional) && optional.includes(tool.name);
}

function classifyToolAccess(tool) {
  const access = new Set();
  if (!tool) return access;
  const plugin = pluginById(tool.pluginId);
  const text = accessHaystack(tool, plugin);
  const operationText = accessOperationHaystack(tool);
  const permissions = (plugin?.permissions || []).map((permission) => String(permission).toLowerCase());
  const usesRag = /\brag\b|runtime-rag|permanent-rag|vector|embedding/.test(text)
    || permissions.some((permission) => permission.includes('rag'));
  const usesPermanentRag = tool.pluginId === 'system.rag_permanent'
    || /permanent[-_\s]?rag|rag[-_\s]?permanent|permanentrag/.test(text)
    || permissions.some((permission) => permission.includes('rag-permanent'));
  const usesRuntimeRag = tool.pluginId === 'system.rag_runtime'
    || /runtime[-_\s]?rag|rag[-_\s]?runtime|runtimerag/.test(text)
    || permissions.some((permission) => permission.includes('rag-runtime'));
  const usesDatabase = /database|sqlite|chat-local|global-data|app-chat|collection|record|registry|profile|state|graph|relationship|timeline|savepoint/.test(text)
    || permissions.some((permission) => /:read|:write/.test(permission) && !permission.includes('rag'));
  const usesProfileLevels = tool.pluginId === 'system.npc_profiles'
    || /l1\/l2\/l3|profilelevels|profile levels|npc[-_\s]?profiles/.test(text);
  const writes = Boolean(tool.mutatesState)
    || /\b(write|create|upsert|update|patch|delete|import|ingest|remember|index|store|restore|rewrite|mount|unmount)\b/.test(operationText);
  const reads = !writes || /\b(read|search|list|get|query|export|describe|build|context|snapshot|prompt|retrieve)\b/.test(operationText);

  if (usesDatabase) {
    if (writes) access.add('database:write');
    if (reads || /database snapshot|sourcecollection|source collection/.test(text)) access.add('database:read');
  }
  if (usesRag) {
    if (writes || /\bremember|index|import|ingest\b/.test(text)) access.add('rag:write');
    if (reads || /\bsearch|retrieve|list|export|context\b/.test(text)) access.add('rag:read');
  }
  if (usesPermanentRag) {
    if (writes || /\bindex|import|ingest\b/.test(text)) access.add('permanentRag:write');
    if (reads || /\bsearch|retrieve|list|export|context\b/.test(text)) access.add('permanentRag:read');
  }
  if (usesRuntimeRag) {
    if (writes || /\bremember|index|import|ingest|prune\b/.test(text)) access.add('runtimeRag:write');
    if (reads || /\bsearch|retrieve|list|context\b/.test(text)) access.add('runtimeRag:read');
  }
  if (usesProfileLevels && isProfileDataAccessTool(tool)) {
    const levels = profileLevelsForTool(tool);
    for (const level of levels) {
      const resource = `database${level}`;
      if (writes) access.add(`${resource}:write`);
      if (reads) access.add(`${resource}:read`);
    }
  }
  return access;
}

function accessHaystack(tool, plugin) {
  return [
    tool.id,
    tool.name,
    tool.title,
    tool.description,
    ...(tool.tags || []),
    JSON.stringify(tool.inputSchema || {}),
    JSON.stringify(tool.metadata || {}),
    plugin?.id,
    plugin?.name,
    plugin?.description,
    ...(plugin?.permissions || []),
    JSON.stringify(plugin?.metadata || {})
  ].filter(Boolean).join(' ').toLowerCase();
}

function isProfileDataAccessTool(tool = {}) {
  if (tool.pluginId === 'system.npc_profiles') {
    return [
      'list_profiles',
      'get_profile',
      'get_profile_bundle',
      'upsert_profile',
      'patch_profile',
      'delete_profile',
      'import_document',
      'export_document'
    ].includes(tool.name);
  }
  const text = accessHaystack(tool, pluginById(tool.pluginId));
  return /profilelevels|profile levels|l1\/l2\/l3/.test(text);
}

function profileLevelsForTool(tool = {}) {
  const text = accessHaystack(tool, pluginById(tool.pluginId)).toUpperCase();
  const matched = ['L1', 'L2', 'L3'].filter((level) => text.includes(level));
  return matched.length ? matched : ['L1', 'L2', 'L3'];
}

function formatAccessResource(resource) {
  const labels = {
    database: 'DB',
    databaseL1: 'L1 DB',
    databaseL2: 'L2 DB',
    databaseL3: 'L3 DB',
    rag: 'RAG',
    permanentRag: 'PERMANENT RAG',
    runtimeRag: 'RUNTIME RAG'
  };
  return labels[resource] || resource.toUpperCase();
}

function accessOperationHaystack(tool) {
  return [
    tool.id,
    tool.name,
    tool.title,
    tool.description,
    ...(tool.tags || []),
    JSON.stringify(tool.metadata || {})
  ].filter(Boolean).join(' ').toLowerCase();
}

function isAgentAccessBlocked(tool) {
  const policy = normalizeAgentAccessPolicy(state.agentAccessPolicy);
  const override = policy.tools?.[tool?.id];
  if (override === 'allowed') return false;
  if (override === 'blocked') return true;
  for (const capability of classifyToolAccess(tool)) {
    if (!isCapabilityAllowed(capability, tool)) return true;
  }
  return false;
}

function isCapabilityAllowed(capability, tool) {
  const policy = normalizeAgentAccessPolicy(state.agentAccessPolicy);
  const override = policy.tools?.[tool?.id];
  if (override === 'allowed') return true;
  if (override === 'blocked') return false;
  const [resource, operation] = capability.split(':');
  return policy[resource]?.[operation] !== false;
}

function blockedAgentToolCount() {
  return state.tools.filter((tool) => isAgentAccessBlocked(tool)).length;
}

function schemaHasKey(schema, key) {
  if (!schema || typeof schema !== 'object') return false;
  if (schema.properties && Object.hasOwn(schema.properties, key)) return true;
  for (const nestedKey of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[nestedKey]) && schema[nestedKey].some((item) => schemaHasKey(item, key))) {
      return true;
    }
  }
  if (schema.items && schemaHasKey(schema.items, key)) return true;
  return false;
}

function schemaProperties(schema, seen = new WeakSet()) {
  if (!schema || typeof schema !== 'object') return {};
  if (seen.has(schema)) return {};
  seen.add(schema);
  const properties = isPlainRecord(schema.properties) ? { ...schema.properties } : {};
  for (const nestedKey of ['allOf', 'anyOf', 'oneOf']) {
    if (!Array.isArray(schema[nestedKey])) continue;
    for (const child of schema[nestedKey]) {
      Object.assign(properties, schemaProperties(child, seen));
    }
  }
  return properties;
}

function schemaRequiredFields(schema, seen = new WeakSet()) {
  if (!schema || typeof schema !== 'object') return [];
  if (seen.has(schema)) return [];
  seen.add(schema);
  const fields = new Set(Array.isArray(schema.required) ? schema.required.filter((field) => typeof field === 'string') : []);
  for (const nestedKey of ['allOf', 'anyOf', 'oneOf']) {
    if (!Array.isArray(schema[nestedKey])) continue;
    for (const child of schema[nestedKey]) {
      schemaRequiredFields(child, seen).forEach((field) => fields.add(field));
    }
  }
  return [...fields];
}

function promptProfileForTool(tool) {
  if (!tool) {
    return {
      manageable: false,
      llm: false,
      useLlmFields: [],
      promptFields: [],
      referenceFields: [],
      contextFields: [],
      reasons: []
    };
  }
  const properties = schemaProperties(tool.inputSchema);
  const entries = Object.entries(properties);
  const llm = toolUsesLlm(tool);
  const useLlmFields = sortByPriority(entries
    .filter(([name, property]) => isLlmSwitchField(name, property))
    .map(([name]) => name), LLM_SWITCH_FIELD_PRIORITY);
  const promptFields = sortByPriority(entries
    .filter(([name, property]) => isPromptInputField(name, property))
    .map(([name]) => name), PROMPT_FIELD_PRIORITY);
  const referenceFields = sortByPriority(entries
    .filter(([name, property]) => isReferenceInputField(name, property))
    .map(([name]) => name), REFERENCE_FIELD_PRIORITY);
  const contextFields = sortByPriority(entries
    .filter(([name, property]) => isContextReferenceField(name, property))
    .map(([name]) => name), CONTEXT_REFERENCE_FIELD_PRIORITY);
  const manageable = llm || useLlmFields.length > 0 || promptFields.length > 0 || referenceFields.length > 0;
  const reasons = [];
  if (llm) reasons.push('LLM tool');
  if (useLlmFields.length > 0) reasons.push(`LLM switch: ${useLlmFields.join(', ')}`);
  if (promptFields.length > 0) reasons.push(`prompt input: ${promptFields.join(', ')}`);
  if (referenceFields.length > 0) reasons.push(`reference input: ${referenceFields.join(', ')}`);
  if (contextFields.length > 0 && referenceFields.length === 0) reasons.push(`reference fallback: ${contextFields.join(', ')}`);
  return {
    manageable,
    llm,
    useLlmFields,
    promptFields,
    referenceFields,
    contextFields,
    reasons
  };
}

function isLlmSwitchField(name, property) {
  return ['useLlm', 'preferLlm'].includes(name) && schemaPropertyAcceptsType(property, 'boolean');
}

function isPromptInputField(name, property) {
  if (!schemaPropertyAcceptsType(property, 'string')) return false;
  const lower = name.toLowerCase();
  if (PROMPT_FIELD_PRIORITY.map((field) => field.toLowerCase()).includes(lower)) return true;
  return /(^|[_-])prompt(text)?$/i.test(name) || /prompt$/i.test(name);
}

function isReferenceInputField(name, property) {
  const lower = name.toLowerCase();
  if (/^(allow|include|has|is)/.test(lower)) return false;
  if (!schemaPropertyAcceptsType(property, 'string')
    && !schemaPropertyAcceptsType(property, 'array')
    && !schemaPropertyAcceptsType(property, 'object')) {
    return false;
  }
  if (REFERENCE_FIELD_PRIORITY.map((field) => field.toLowerCase()).includes(lower)) return true;
  return /^references?$/.test(lower) || /^reference(material|texts?|docs?|documents?|files?|filepaths?)$/.test(lower);
}

function isContextReferenceField(name, property) {
  const lower = name.toLowerCase();
  if (!['context', 'contexttext', 'recentcontext'].includes(lower)) return false;
  return schemaPropertyAcceptsType(property, 'string') || schemaPropertyAcceptsType(property, 'object');
}

function schemaPropertyAcceptsType(property, type, seen = new WeakSet()) {
  if (!property || typeof property !== 'object') return false;
  if (seen.has(property)) return false;
  seen.add(property);
  if (Array.isArray(property.type) && property.type.includes(type)) return true;
  if (property.type === type) return true;
  for (const nestedKey of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(property[nestedKey]) && property[nestedKey].some((item) => schemaPropertyAcceptsType(item, type, seen))) {
      return true;
    }
  }
  return false;
}

function sortByPriority(fields, priority) {
  const indexOf = (field) => {
    const index = priority.findIndex((candidate) => candidate.toLowerCase() === String(field).toLowerCase());
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...fields].sort((a, b) => {
    const byPriority = indexOf(a) - indexOf(b);
    return byPriority || a.localeCompare(b);
  });
}

function matchesApiTargetSearch(target) {
  if (!state.apiTargetSearch) return true;
  return [
    target.id,
    target.label,
    target.description,
    target.kind
  ].filter(Boolean).join(' ').toLowerCase().includes(state.apiTargetSearch);
}

function saveSelectedApiTarget() {
  state.apiTargets[state.selectedApiTargetId] = normalizeApiSettings({
    provider: els.apiProviderSelect.value,
    baseUrl: els.apiBaseUrl.value,
    apiKey: els.apiKey.value,
    model: els.apiModel.value,
    temperature: els.apiTemperature.value,
    maxTokens: els.apiMaxTokens.value
  });
  saveApiTargets();
  renderApiTargets();
  showToast(`${state.selectedApiTargetId} API saved`);
}

function clearSelectedApiTarget() {
  delete state.apiTargets[state.selectedApiTargetId];
  saveApiTargets();
  renderApiTargets();
  showToast(`${state.selectedApiTargetId} API cleared`);
}

function copyChatApiToSelected() {
  if (state.selectedApiTargetId === 'chat') return;
  state.apiTargets[state.selectedApiTargetId] = {
    ...apiSettingsForTarget('chat')
  };
  saveApiTargets();
  renderApiTargets();
  showToast('chat API copied');
}

function resetApiTargets() {
  if (!confirm('Reset all API target selections?')) return;
  state.apiTargets = {};
  saveApiTargets();
  renderApiTargets();
  showToast('api targets reset');
}

function applyProviderDefault() {
  const provider = els.apiProviderSelect.value;
  if (!els.apiBaseUrl.value.trim() && API_PROVIDER_DEFAULTS[provider]) {
    els.apiBaseUrl.value = API_PROVIDER_DEFAULTS[provider];
  }
}

function renderDetails() {
  const plugin = selectedPlugin();
  const tool = selectedTool();

  els.selectionHeader.innerHTML = '';
  if (!plugin && !tool) {
    els.selectionHeader.append(emptyState('no selection'));
    els.apiShortcutBlock.innerHTML = '';
    els.dependencyBlock.innerHTML = '';
    els.metadataBlock.innerHTML = '';
    els.schemaPreview.textContent = '';
    return;
  }

  const title = document.createElement('div');
  title.className = 'selection-title';
  title.textContent = tool?.id || plugin.id;
  const description = document.createElement('div');
  description.className = 'selection-description';
  description.textContent = tool?.description || plugin.description || plugin.name || '';
  const badges = document.createElement('div');
  badges.className = 'badge-row';
  badges.append(
    badge(plugin.enabled === false || tool?.enabled === false ? 'disabled' : 'enabled', plugin.enabled === false || tool?.enabled === false ? 'disabled' : 'enabled'),
    badge(tool ? (tool.visibility || 'public') : `v${plugin.version || '0.1.0'}`),
    badge(tool?.mutatesState ? 'mutates' : 'read-only'),
    badge(tool?.autoCallable ? 'auto' : 'manual')
  );
  if (tool?.tags?.length) {
    for (const tag of tool.tags.slice(0, 8)) badges.append(badge(tag));
  }
  els.selectionHeader.append(title, description, badges);

  renderApiShortcut(tool);
  renderDependencies(plugin);
  renderMetadata(plugin, tool);
  renderSchema(tool);
  renderExecutionDefaults(tool);
  renderPromptPanel(tool);
  els.selectedStatus.textContent = tool?.id || plugin.id;
}

function renderApiShortcut(tool) {
  els.apiShortcutBlock.innerHTML = '';
  if (!tool) return;

  const usesLlm = toolUsesLlm(tool);
  const targetId = usesLlm ? tool.id : 'tool-calling';
  const settings = apiSettingsForTarget(targetId);
  const apiLabel = apiSettingsLabel(settings);

  const block = document.createElement('div');
  block.className = `api-shortcut${usesLlm ? ' direct' : ' fallback'}`;

  const summary = document.createElement('div');
  summary.className = 'api-shortcut-summary';
  const label = document.createElement('span');
  label.className = 'api-shortcut-label';
  label.textContent = usesLlm ? 'Internal LLM API' : 'Tool-Calling API';
  const target = document.createElement('span');
  target.className = 'api-shortcut-target';
  target.textContent = targetId;
  summary.append(label, target);

  const status = badge(apiLabel, settings.provider === 'server' ? '' : 'enabled');
  status.classList.add('api-shortcut-status');

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary-button api-shortcut-edit';
  edit.textContent = usesLlm ? 'Edit Tool API' : 'Edit Tool-Calling API';
  edit.addEventListener('click', () => {
    state.apiTargetSearch = '';
    els.apiTargetSearch.value = '';
    selectApiTarget(targetId);
    activateDetailTab('api');
  });

  block.append(summary, status, edit);
  els.apiShortcutBlock.append(block);
}

function renderAccessPanel() {
  const policy = normalizeAgentAccessPolicy(state.agentAccessPolicy);
  els.agentDatabaseReadAccess.checked = policy.database.read !== false;
  els.agentDatabaseWriteAccess.checked = policy.database.write !== false;
  els.agentDatabaseL1ReadAccess.checked = policy.databaseL1.read !== false;
  els.agentDatabaseL1WriteAccess.checked = policy.databaseL1.write !== false;
  els.agentDatabaseL2ReadAccess.checked = policy.databaseL2.read !== false;
  els.agentDatabaseL2WriteAccess.checked = policy.databaseL2.write !== false;
  els.agentDatabaseL3ReadAccess.checked = policy.databaseL3.read !== false;
  els.agentDatabaseL3WriteAccess.checked = policy.databaseL3.write !== false;
  els.agentRagReadAccess.checked = policy.rag.read !== false;
  els.agentRagWriteAccess.checked = policy.rag.write !== false;
  els.agentPermanentRagReadAccess.checked = policy.permanentRag.read !== false;
  els.agentPermanentRagWriteAccess.checked = policy.permanentRag.write !== false;
  const blocked = blockedAgentToolCount();
  els.accessPolicySummary.textContent = `${blocked} blocked / ${state.tools.length} tools`;
  renderAccessCallCounts(policy);

  const tool = selectedTool();
  els.accessCapabilityList.innerHTML = '';
  if (!tool) {
    els.accessTargetTitle.textContent = 'Selected Tool';
    els.accessTargetSummary.textContent = 'no selection';
    els.accessCapabilityList.append(emptyState('select a tool to inspect DB/RAG access'));
    els.inheritAgentToolButton.disabled = true;
    els.blockAgentToolButton.disabled = true;
    els.allowAgentToolButton.disabled = true;
    return;
  }

  const access = classifyToolAccess(tool);
  const override = policy.tools?.[tool.id];
  const blockedByPolicy = isAgentAccessBlocked(tool);
  els.accessTargetTitle.textContent = tool.id;
  els.accessTargetSummary.textContent = [
    override ? `override: ${override}` : 'inherits global policy',
    blockedByPolicy ? 'blocked' : 'allowed'
  ].join(' · ');

  const capabilities = [
    'database:read',
    'database:write',
    'databaseL1:read',
    'databaseL1:write',
    'databaseL2:read',
    'databaseL2:write',
    'databaseL3:read',
    'databaseL3:write',
    'rag:read',
    'rag:write',
    'permanentRag:read',
    'permanentRag:write',
    'runtimeRag:read',
    'runtimeRag:write'
  ];
  for (const capability of capabilities) {
    const [resource, operation] = capability.split(':');
    const used = access.has(capability);
    const allowed = !used || isCapabilityAllowed(capability, tool);
    const row = document.createElement('div');
    row.className = `access-capability${used ? '' : ' unused'}${allowed ? '' : ' denied'}`;
    const name = document.createElement('span');
    name.textContent = `${formatAccessResource(resource)} ${operation}`;
    const status = document.createElement('span');
    status.textContent = used ? (allowed ? 'allowed' : 'blocked') : 'not used';
    row.append(name, status);
    els.accessCapabilityList.append(row);
  }

  els.inheritAgentToolButton.disabled = false;
  els.blockAgentToolButton.disabled = override === 'blocked';
  els.allowAgentToolButton.disabled = override === 'allowed';
}

function renderAccessCallCounts(policy = normalizeAgentAccessPolicy(state.agentAccessPolicy)) {
  els.accessCallCountList.innerHTML = '';
  const stats = state.latestAccessCallCounts;
  if (!stats) {
    els.accessCallSummary.textContent = 'no loop run';
    els.accessCallCountList.append(emptyState('Run a loop dry-run to inspect this turn DB/RAG calls.'));
    return;
  }

  const rows = ACCESS_CALL_COUNT_ROWS.map((definition) => {
    const counter = accessCounterForRow(stats, definition);
    const allowed = definition.capabilities.every((capability) => isPolicyCapabilityAllowed(policy, capability));
    return {
      definition,
      counter,
      attempted: counter.attempted || 0,
      allowed
    };
  });
  const rawCallCount = Number.isFinite(Number(stats.rawCallCount))
    ? Number(stats.rawCallCount)
    : (stats.total?.attempted || 0);
  const activeRows = rows.filter((row) => row.attempted > 0);
  const deniedRows = activeRows.filter((row) => !row.allowed);
  els.accessCallSummary.textContent = [
    state.latestAccessCallCountsSource || 'latest loop',
    `${rawCallCount} raw calls`,
    `${activeRows.length} tracked rows`,
    deniedRows.length ? `${deniedRows.length} restricted now` : 'policy ok'
  ].join(' · ');

  for (const rowInfo of rows) {
    const { definition, counter, attempted, allowed } = rowInfo;
    const row = document.createElement('div');
    row.className = `access-call-row${attempted > 0 ? '' : ' empty'}${attempted > 0 && !allowed ? ' denied' : ''}`;

    const name = document.createElement('span');
    name.className = 'access-call-name';
    const label = document.createElement('strong');
    label.textContent = definition.label;
    const description = document.createElement('small');
    description.textContent = definition.description;
    name.append(label, description);

    const count = document.createElement('span');
    count.className = 'access-call-counter';
    count.textContent = formatAccessCallCounter(counter);

    const status = document.createElement('span');
    status.className = 'access-call-policy';
    status.textContent = attempted === 0
      ? 'no calls'
      : (allowed ? 'allowed' : 'blocked now');

    row.append(name, count, status);
    els.accessCallCountList.append(row);
  }
}

function isPolicyCapabilityAllowed(policy, capability) {
  const [resource, operation] = capability.split(':');
  return policy?.[resource]?.[operation] !== false;
}

function accessCounterForRow(stats, definition) {
  if (definition.layer) {
    return normalizeAccessCallCounter(stats.byImportance?.[definition.layer]);
  }
  if (definition.toolPrefix) {
    const counter = createAccessCallCounter();
    for (const [toolId, toolCounter] of Object.entries(stats.byTool || {})) {
      if (toolId.startsWith(definition.toolPrefix)) mergeAccessCallCounter(counter, toolCounter);
    }
    return counter;
  }
  return createAccessCallCounter();
}

function formatAccessCallCounter(counter) {
  const attempted = counter.attempted || 0;
  if (attempted <= 0) return '0 calls';
  const detail = [
    counter.ok ? `ok ${counter.ok}` : '',
    counter.empty ? `empty ${counter.empty}` : '',
    counter.missing ? `missing ${counter.missing}` : '',
    counter.error ? `error ${counter.error}` : '',
    counter.pending ? `pending ${counter.pending}` : ''
  ].filter(Boolean).join(' · ');
  return detail ? `${attempted} calls · ${detail}` : `${attempted} calls`;
}

function clearAccessCallCounts() {
  state.latestAccessCallCounts = undefined;
  state.latestAccessCallCountsSource = '';
  renderAccessPanel();
  showToast('loop DB/RAG call stats cleared');
}

function updateAgentAccessCapability(resource, operation, allowed) {
  state.agentAccessPolicy = normalizeAgentAccessPolicy(state.agentAccessPolicy);
  state.agentAccessPolicy[resource] = {
    ...state.agentAccessPolicy[resource],
    [operation]: Boolean(allowed)
  };
  saveAgentAccessPolicy();
  renderTools();
  renderAccessPanel();
  showToast(`${resource} ${operation} ${allowed ? 'allowed' : 'blocked'} for agents`);
}

function setSelectedToolAccessOverride(mode) {
  const tool = selectedTool();
  if (!tool) return;
  state.agentAccessPolicy = normalizeAgentAccessPolicy(state.agentAccessPolicy);
  if (mode) {
    state.agentAccessPolicy.tools[tool.id] = mode;
  } else {
    delete state.agentAccessPolicy.tools[tool.id];
  }
  saveAgentAccessPolicy();
  renderTools();
  renderAccessPanel();
  showToast(`${tool.id} agent access ${mode || 'inherits'}`);
}

function resetAgentAccessPolicy() {
  if (!confirm('Reset all agent DB/RAG access restrictions?')) return;
  state.agentAccessPolicy = normalizeAgentAccessPolicy();
  saveAgentAccessPolicy();
  renderTools();
  renderAccessPanel();
  showToast('agent access reset');
}

function renderDependencies(plugin) {
  els.dependencyBlock.innerHTML = '';
  if (!plugin) return;

  const deps = dependenciesFor(plugin);
  const dependents = state.plugins
    .filter((candidate) => candidate.id !== plugin.id)
    .filter((candidate) => dependenciesFor(candidate).includes(plugin.id))
    .map((candidate) => candidate.id)
    .sort((a, b) => a.localeCompare(b));

  els.dependencyBlock.append(
    dependencyGroup('Dependencies', deps),
    dependencyGroup('Required By', dependents)
  );
}

function renderMetadata(plugin, tool) {
  els.metadataBlock.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = 'Metadata';
  const pre = document.createElement('pre');
  pre.className = 'code-panel';
  pre.textContent = pretty({
    plugin: {
      id: plugin?.id,
      name: plugin?.name,
      permissions: plugin?.permissions || [],
      metadata: plugin?.metadata || {}
    },
    tool: tool ? {
      id: tool.id,
      title: tool.title,
      visibility: tool.visibility,
      enabled: tool.enabled,
      autoCallable: tool.autoCallable,
      mutatesState: tool.mutatesState,
      annotations: tool.annotations || {},
      metadata: tool.metadata || {}
    } : undefined
  });
  els.metadataBlock.append(heading, pre);
}

function renderSchema(tool) {
  const schema = tool ? {
    inputSchema: tool.inputSchema || {},
    outputSchema: tool.outputSchema || undefined
  } : {};
  renderSchemaMeaning(tool);
  els.schemaPreview.textContent = pretty(schema);
}

function renderSchemaMeaning(tool) {
  els.schemaMeaningBlock.innerHTML = '';
  if (!tool) {
    els.schemaMeaningBlock.append(emptyState('no schema selected'));
    return;
  }
  els.schemaMeaningBlock.append(
    schemaMeaningGroup('Input fields', tool.inputSchema, 'input'),
    schemaMeaningGroup('Output fields', tool.outputSchema, 'output')
  );
}

function schemaMeaningGroup(title, schema, direction) {
  const group = document.createElement('div');
  group.className = 'schema-meaning-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  group.append(heading);

  const properties = schemaProperties(schema);
  const required = new Set(schemaRequiredFields(schema));
  const names = Object.keys(properties).sort((a, b) => {
    const requiredDelta = Number(required.has(b)) - Number(required.has(a));
    return requiredDelta || a.localeCompare(b);
  });
  if (names.length === 0) {
    group.append(emptyState(direction === 'output'
      ? 'No declared output schema; inspect Run output or Debug traces for concrete shape.'
      : 'No declared input fields.'));
    return group;
  }

  const list = document.createElement('div');
  list.className = 'schema-meaning-list';
  for (const name of names) {
    const property = properties[name] || {};
    const row = document.createElement('div');
    row.className = 'schema-meaning-row';

    const key = document.createElement('code');
    key.textContent = name;
    const type = document.createElement('span');
    type.className = 'schema-field-type';
    type.textContent = schemaTypeLabel(property);
    const mode = document.createElement('span');
    mode.className = `schema-field-mode ${required.has(name) ? 'required' : 'optional'}`;
    mode.textContent = required.has(name) ? 'required' : 'optional';
    const meaning = document.createElement('span');
    meaning.className = 'schema-field-meaning';
    meaning.textContent = fieldMeaningFor(name, property, direction);

    row.append(key, type, mode, meaning);
    list.append(row);
  }
  group.append(list);
  return group;
}

function renderExecutionDefaults(tool) {
  if (!tool) {
    els.toolInputJson.value = '{}';
    els.toolContextJson.value = pretty({ source: 'tool-manager' });
    els.executeToolButton.disabled = true;
    return;
  }
  if (els.toolInputJson.dataset.toolId !== tool.id) {
    els.toolInputJson.value = pretty(exampleInputFor(tool.inputSchema || {}, tool.inputExamples?.[0]));
    els.toolInputJson.dataset.toolId = tool.id;
    els.toolOutputJson.textContent = '';
    state.debugFiles = [];
    state.selectedDebugFilePath = '';
    renderDebugPanel();
  }
  if (!els.toolContextJson.value.trim()) {
    els.toolContextJson.value = pretty({ source: 'tool-manager' });
  }
  els.executeToolButton.disabled = state.busy || tool.enabled === false;
}

function renderLoopPanel() {
  const available = loopManagerAvailable();
  for (const element of [
    els.refreshLoopConfigsButton,
    els.refreshLoopPreviewButton,
    els.newLoopConfigButton,
    els.importLoopConfigButton,
    els.exportLoopConfigButton,
    els.exportLoopPreviewButton,
    els.loopConfigSelect,
    els.loadLoopConfigButton,
    els.saveLoopConfigButton,
    els.switchLoopConfigButton,
    els.archiveLoopConfigButton,
    els.deleteLoopConfigButton,
    els.loopRouterPolicyJson,
    els.loadLoopRouterPolicyButton,
    els.applyLoopRouterPolicyButton,
    els.resetLoopRouterPolicyButton,
    els.loopConfigJson,
    els.loopRunInputJson,
    els.dryRunLoopConfigButton
  ]) {
    element.disabled = !available || state.busy;
  }
  els.refreshLoopPreviewButton.disabled = !available || !loopPreviewAvailable() || state.busy;
  els.exportLoopPreviewButton.disabled = !available || !state.loopPreview || state.busy;
  if (!available) {
    els.loopManagerSummary.textContent = 'system.agent_loop tools are not available';
    els.activeLoopConfigLabel.textContent = 'none';
    els.loopStorageLabel.textContent = 'unavailable';
    els.loopConfigSelect.innerHTML = '';
    els.loopFlowPreview.innerHTML = '';
    els.loopPreviewSummary.textContent = 'not available';
    els.loopBlueprintJson.textContent = '';
    els.loopRouterPolicySummary.textContent = 'not available';
    els.loopRouterPolicyJson.value = '';
    els.loopArchiveList.innerHTML = '';
    els.loopRunOutputJson.textContent = '';
    return;
  }

  const activeId = state.activeLoopConfig?.activeConfigId || state.activeLoopConfig?.config?.id || '';
  els.loopManagerSummary.textContent = `${state.loopConfigs.length} configs · ${state.loopArchives.length} archives`;
  els.activeLoopConfigLabel.textContent = activeId || 'default_flow_v1';
  els.loopStorageLabel.textContent = state.loopManagerStorage || 'unknown';

  const currentValue = els.loopConfigSelect.value;
  els.loopConfigSelect.innerHTML = '';
  for (const config of state.loopConfigs) {
    const option = document.createElement('option');
    option.value = config.id;
    option.textContent = [
      config.id,
      config.source === 'template' ? 'template' : 'saved',
      config.stepCount !== undefined ? `${config.stepCount} steps` : ''
    ].filter(Boolean).join(' · ');
    els.loopConfigSelect.append(option);
  }
  const selectedId = state.selectedLoopConfigId
    || (state.loopConfigs.some((config) => config.id === activeId) ? activeId : state.loopConfigs[0]?.id)
    || '';
  state.selectedLoopConfigId = selectedId;
  els.loopConfigSelect.value = state.loopConfigs.some((config) => config.id === currentValue)
    ? currentValue
    : selectedId;

  const editorConfig = parseJsonMaybe(els.loopConfigJson.value);
  renderLoopBlueprint(state.loopPreview);
  renderLoopFlowPreview(state.loopPreview || (editorConfig?.id ? editorConfig : loopConfigById(state.selectedLoopConfigId)));
  renderLoopRouterPolicySummary();
  renderLoopArchives();
}

function renderLoopFlowPreview(config) {
  els.loopFlowPreview.innerHTML = '';
  if (!config) {
    els.loopFlowPreview.append(emptyState('load or create a config'));
    return;
  }
  const steps = Array.isArray(config.steps) ? [...config.steps] : [];
  if (steps.length === 0) {
    els.loopFlowPreview.append(emptyState('no flow steps'));
    return;
  }
  const sorted = steps.sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.id).localeCompare(String(b.id)));
  for (const [index, step] of sorted.entries()) {
    const item = document.createElement('div');
    item.className = `loop-step${step.enabled === false ? ' disabled' : ''}`;
    const number = document.createElement('span');
    number.className = 'loop-step-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const body = document.createElement('span');
    body.className = 'loop-step-body';
    const title = document.createElement('strong');
    title.textContent = step.title || step.id || `step-${index + 1}`;
    const meta = document.createElement('small');
    const modules = modulesForLoopStep(step);
    meta.textContent = [
      step.id,
      step.profileId || step.profile?.id || config.activeProfileId || 'default_v1',
      step.handoff?.input || 'preserve',
      modules.length ? `${modules.length} modules` : ''
    ].filter(Boolean).join(' · ');
    body.append(title, meta);
    if (modules.length > 0) {
      const moduleList = document.createElement('div');
      moduleList.className = 'loop-module-list';
      for (const [moduleIndex, moduleConfig] of modules.entries()) {
        const row = document.createElement('div');
        row.className = `loop-module${moduleConfig.enabled === false ? ' disabled' : ''}`;
        const ordinal = document.createElement('span');
        ordinal.className = 'loop-module-index';
        ordinal.textContent = String(moduleIndex + 1).padStart(2, '0');
        const details = document.createElement('span');
        details.className = 'loop-module-body';
        const moduleTitle = document.createElement('strong');
        moduleTitle.textContent = moduleConfig.title || moduleConfig.id || `module-${moduleIndex + 1}`;
        const moduleMeta = document.createElement('small');
        const toolCalls = toolCallsForLoopModule(moduleConfig);
        moduleMeta.textContent = [
          moduleConfig.id || moduleConfig.phaseId,
          moduleConfig.llm ? 'LLM' : '',
          moduleConfig.mutatesState || moduleConfig.mayMutate ? 'writes' : '',
          toolCalls.length ? `${toolCalls.length} tool calls` : ''
        ].filter(Boolean).join(' · ');
        details.append(moduleTitle, moduleMeta);
        if (toolCalls.length > 0) {
          const toolLine = document.createElement('em');
          toolLine.textContent = toolCalls
            .map((call) => call.toolId || call.name || call.id)
            .filter(Boolean)
            .join(' -> ');
          details.append(toolLine);
        }
        row.append(ordinal, details);
        moduleList.append(row);
      }
      body.append(moduleList);
    }
    item.append(number, body);
    els.loopFlowPreview.append(item);
  }
}

function renderLoopBlueprint(preview) {
  if (!preview) {
    els.loopPreviewSummary.textContent = 'press Preview to resolve source config';
    els.loopBlueprintJson.textContent = '';
    return;
  }
  const summary = preview.summary || {};
  els.loopPreviewSummary.textContent = [
    preview.format || 'preview',
    `${summary.stepCount ?? 0} steps`,
    `${summary.moduleCount ?? 0} modules`,
    `${summary.toolCallCount ?? 0} tool calls`,
    `${summary.llmModuleCount ?? 0} LLM`
  ].join(' · ');
  els.loopBlueprintJson.textContent = pretty(preview);
}

function modulesForLoopStep(step = {}) {
  const source = Array.isArray(step.modules) && step.modules.length
    ? step.modules
    : (Array.isArray(step.moduleSequence) ? step.moduleSequence : []);
  return source
    .map((moduleConfig, index) => {
      if (typeof moduleConfig === 'string') {
        return { id: moduleConfig, title: moduleConfig, order: (index + 1) * 10, toolCalls: [] };
      }
      if (!moduleConfig || typeof moduleConfig !== 'object') return undefined;
      const id = moduleConfig.id || moduleConfig.phaseId || moduleConfig.name;
      if (!id) return undefined;
      return {
        ...moduleConfig,
        id,
        title: moduleConfig.title || moduleConfig.name || id,
        order: Number.isFinite(Number(moduleConfig.order)) ? Number(moduleConfig.order) : (index + 1) * 10
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.id).localeCompare(String(b.id)));
}

function markLoopPreviewStale() {
  state.loopPreview = undefined;
  renderLoopBlueprint(undefined);
  renderLoopRouterPolicySummary();
  const editorConfig = parseJsonMaybe(els.loopConfigJson.value);
  renderLoopFlowPreview(editorConfig?.id ? editorConfig : loopConfigById(state.selectedLoopConfigId));
}

function syncLoopRouterPolicyEditor({ force = false } = {}) {
  if (!force && els.loopRouterPolicyJson.value.trim()) {
    renderLoopRouterPolicySummary();
    return;
  }
  const config = parseJsonMaybe(els.loopConfigJson.value) || loopConfigById(state.selectedLoopConfigId);
  els.loopRouterPolicyJson.value = pretty(routerPolicyFromConfig(config) || defaultRouterPolicyDraft());
  renderLoopRouterPolicySummary();
}

function resetLoopRouterPolicyDraft() {
  els.loopRouterPolicyJson.value = pretty(defaultRouterPolicyDraft());
  renderLoopRouterPolicySummary();
  showToast('router policy draft reset');
}

function applyLoopRouterPolicyToConfig() {
  let config;
  let policy;
  try {
    config = parseJsonEditor(els.loopConfigJson.value, 'Config JSON');
    policy = parseJsonEditor(els.loopRouterPolicyJson.value || '{}', 'Router Policy JSON');
  } catch (error) {
    showToast(error.message);
    return;
  }
  if (!config?.id) {
    showToast('config id is required before applying router policy');
    return;
  }
  const normalized = normalizeRouterPolicyDraft(policy);
  if (normalized) {
    config.routerPolicy = normalized;
  } else {
    delete config.routerPolicy;
  }
  els.loopConfigJson.value = pretty(config);
  markLoopPreviewStale();
  renderLoopRouterPolicySummary();
  showToast('router policy applied to source config');
}

function renderLoopRouterPolicySummary() {
  if (!els.loopRouterPolicySummary) return;
  const policy = parseJsonMaybe(els.loopRouterPolicyJson.value);
  if (!policy) {
    els.loopRouterPolicySummary.textContent = els.loopRouterPolicyJson.value.trim()
      ? 'invalid JSON'
      : 'empty';
    return;
  }
  const normalized = normalizeRouterPolicyDraft(policy) || {};
  const parts = [
    `${arrayField(normalized.allowedIntents).length || 'all'} intents allowed`,
    `${arrayField(normalized.blockedIntents).length} intents blocked`,
    `${arrayField(normalized.intercepts).length} intercepts`,
    `${arrayField(normalized.allowedResolverToolIds).length || 'default'} tools allowed`,
    `${arrayField(normalized.blockedResolverToolIds).length} tools blocked`,
    normalized.allowUnlistedResolverTools ? 'unlisted allowed' : 'whitelist enforced'
  ];
  els.loopRouterPolicySummary.textContent = parts.join(' · ');
}

function routerPolicyFromConfig(config) {
  if (!config || typeof config !== 'object') return undefined;
  return config.routerPolicy || config.router || config.intentRouter;
}

function defaultRouterPolicyDraft() {
  return JSON.parse(JSON.stringify(DEFAULT_ROUTER_POLICY_DRAFT));
}

function normalizeRouterPolicyDraft(policy = {}) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return undefined;
  const normalized = {
    allowedIntents: normalizeStringList(policy.allowedIntents || policy.intentAllowlist || policy.intentWhitelist || policy.whitelistIntents),
    blockedIntents: normalizeStringList(policy.blockedIntents || policy.intentBlocklist || policy.intentBlacklist || policy.blacklistIntents || policy.deniedIntents),
    intercepts: normalizeRouterInterceptDrafts(policy.intercepts || policy.intentIntercepts || policy.intentInterceptors),
    allowedResolverToolIds: normalizeStringList(policy.allowedResolverToolIds || policy.allowedRouterToolIds || policy.routerAllowedToolIds || policy.resolverToolAllowlist || policy.resolverToolWhitelist),
    additionalResolverToolIds: normalizeStringList(policy.additionalResolverToolIds || policy.additionalRouterToolIds || policy.extraResolverToolIds),
    blockedResolverToolIds: normalizeStringList(policy.blockedResolverToolIds || policy.blockedRouterToolIds || policy.routerBlockedToolIds || policy.resolverToolBlocklist || policy.resolverToolBlacklist || policy.deniedResolverToolIds),
    allowUnlistedResolverTools: policy.allowUnlistedResolverTools === true || policy.allowAnyResolverTool === true || policy.allowUnlistedRouterTools === true
  };
  return routerPolicyDraftHasContent(normalized) ? normalized : undefined;
}

function normalizeRouterInterceptDrafts(intercepts) {
  return (Array.isArray(intercepts) ? intercepts : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      intent: String(entry.intent || entry.fromIntent || entry.matchIntent || '').trim(),
      intents: normalizeStringList(entry.intents || entry.intentIds),
      action: String(entry.action || entry.mode || (entry.toIntent || entry.targetIntent ? 'remap' : 'block')).trim() || 'block',
      toIntent: String(entry.toIntent || entry.targetIntent || entry.redirectIntent || '').trim(),
      reason: String(entry.reason || entry.note || entry.description || '').trim()
    }))
    .map((entry) => ({
      ...entry,
      intents: normalizeStringList([entry.intent, ...entry.intents])
    }))
    .filter((entry) => entry.intents.length > 0 && entry.action);
}

function routerPolicyDraftHasContent(policy = {}) {
  return arrayField(policy.allowedIntents).length > 0
    || arrayField(policy.blockedIntents).length > 0
    || arrayField(policy.intercepts).length > 0
    || arrayField(policy.allowedResolverToolIds).length > 0
    || arrayField(policy.additionalResolverToolIds).length > 0
    || arrayField(policy.blockedResolverToolIds).length > 0
    || policy.allowUnlistedResolverTools === true;
}

function normalizeStringList(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[,，\n]/) : []);
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))];
}

function arrayField(value) {
  return Array.isArray(value) ? value : [];
}

function toolCallsForLoopModule(moduleConfig = {}) {
  return (Array.isArray(moduleConfig.toolCalls) ? moduleConfig.toolCalls : [])
    .filter((call) => call && typeof call === 'object')
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.id || a.toolId || '').localeCompare(String(b.id || b.toolId || '')));
}

function renderLoopArchives() {
  els.loopArchiveList.innerHTML = '';
  const selectedId = state.selectedLoopConfigId;
  const archives = state.loopArchives
    .filter((record) => !selectedId || record.data?.configId === selectedId || record.configId === selectedId)
    .slice(0, 20);
  if (archives.length === 0) {
    els.loopArchiveList.append(emptyState('no archives for selected config'));
    return;
  }
  for (const record of archives) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'loop-archive-row';
    row.addEventListener('click', () => {
      const config = record.data?.config || record.config;
      if (config) {
        els.loopConfigJson.value = pretty(config);
        state.loopPreview = undefined;
        renderLoopPanel();
        void refreshLoopPreview({ silent: true });
      }
    });
    const title = document.createElement('span');
    title.textContent = record.data?.label || record.id || 'archive';
    const meta = document.createElement('small');
    meta.textContent = [
      record.data?.configId || record.configId,
      record.data?.archivedAt || record.updatedAt || record.createdAt
    ].filter(Boolean).join(' · ');
    row.append(title, meta);
    els.loopArchiveList.append(row);
  }
}

async function loadLoopManagerData({ silent = false } = {}) {
  if (!loopManagerAvailable()) {
    state.loopConfigs = [];
    state.loopArchives = [];
    state.activeLoopConfig = undefined;
    state.loopManagerStorage = 'unavailable';
    if (!silent) renderLoopPanel();
    return;
  }
  if (!silent) setBusy(true);
  try {
    const [listed, active, archives] = await Promise.all([
      executeLoopTool('system.agent_loop.list_configs', { includeSteps: true, includeTemplateSteps: true }),
      executeLoopTool('system.agent_loop.get_active_config', {}),
      executeLoopTool('system.agent_loop.list_config_archives', { limit: 100 })
    ]);
    state.loopConfigs = normalizeLoopConfigList(listed);
    state.activeLoopConfig = active;
    state.loopArchives = archives.records || [];
    state.loopManagerStorage = listed.storage || active.storage || archives.storage || 'unknown';
    if (!state.selectedLoopConfigId) {
      state.selectedLoopConfigId = active.activeConfigId || state.loopConfigs[0]?.id || '';
    }
    if (!els.loopConfigJson.value.trim() && state.selectedLoopConfigId) {
      await loadSelectedLoopConfig({ silent: true });
    }
    if (!silent) {
      renderLoopPanel();
      showToast('loop configs refreshed');
    }
  } catch (error) {
    if (!silent) showToast(error.message || String(error));
  } finally {
    if (!silent) setBusy(false);
  }
}

function normalizeLoopConfigList(listed = {}) {
  const templates = (listed.builtinTemplates || []).map((config) => ({
    ...config,
    source: 'template'
  }));
  const records = (listed.records || []).map((record) => ({
    ...(record.config || record.data?.config || {}),
    source: 'stored',
    recordId: record.id,
    updatedAt: record.updatedAt
  }));
  const byId = new Map();
  for (const config of [...templates, ...records]) {
    if (config?.id) byId.set(config.id, config);
  }
  return [...byId.values()].sort((a, b) => {
    const sourceDelta = Number(a.source === 'template') - Number(b.source === 'template');
    return sourceDelta || a.id.localeCompare(b.id);
  });
}

async function selectLoopConfig(configId) {
  state.selectedLoopConfigId = configId;
  await loadSelectedLoopConfig();
}

async function loadSelectedLoopConfig({ silent = false } = {}) {
  const id = state.selectedLoopConfigId || els.loopConfigSelect.value;
  if (!id) return;
  if (!silent) setBusy(true);
  try {
    const resolved = await executeLoopTool('system.agent_loop.get_config', { id });
    const config = resolved.config || resolved;
    state.selectedLoopConfigId = config.id || id;
    els.loopConfigJson.value = pretty(config);
    if (!els.loopRunInputJson.value.trim()) {
      els.loopRunInputJson.value = pretty({
        configId: state.selectedLoopConfigId,
        text: ''
      });
    }
    syncLoopRouterPolicyEditor({ force: true });
    state.loopPreview = undefined;
    await refreshLoopPreview({ silent: true });
    renderLoopPanel();
    if (!silent) showToast(`${state.selectedLoopConfigId} loaded`);
  } catch (error) {
    if (!silent) showToast(error.message || String(error));
  } finally {
    if (!silent) setBusy(false);
  }
}

function createNewLoopConfigDraft() {
  const base = parseJsonMaybe(els.loopConfigJson.value) || loopConfigById(state.selectedLoopConfigId) || {
    activeProfileId: 'default_v1',
    steps: []
  };
  const timestamp = timestampForFilename().replace(/[^0-9A-Za-z]+/g, '_').slice(0, 24);
  const draft = {
    ...base,
    id: `custom_flow_${timestamp}`,
    name: 'Custom Loop Flow',
    description: '',
    tags: [...new Set([...(base.tags || []), 'custom'])],
    phaseProgressLabels: {
      ...(base.phaseProgressLabels || {}),
      'route.intent': base.phaseProgressLabels?.['route.intent'] || '正在理解玩家意图...',
      'retrieval.targeted': base.phaseProgressLabels?.['retrieval.targeted'] || '正在检索记忆...',
      'narrative.render': base.phaseProgressLabels?.['narrative.render'] || '正在生成场景描述...'
    },
    steps: Array.isArray(base.steps) && base.steps.length
      ? base.steps
      : [
          {
            id: 'main',
            title: 'Main Turn Loop',
            order: 10,
            profileId: base.activeProfileId || 'default_v1',
            handoff: {
              input: 'preserve',
              previousOutput: 'metadata.previousContextEnvelope',
              previousSummary: 'metadata.previousLoopSummary'
            }
          }
        ]
  };
  state.selectedLoopConfigId = draft.id;
  state.loopPreview = undefined;
  els.loopConfigJson.value = pretty(draft);
  els.loopRunInputJson.value = pretty({
    configId: draft.id,
    text: ''
  });
  syncLoopRouterPolicyEditor({ force: true });
  renderLoopPanel();
}

async function refreshLoopPreview({ silent = false } = {}) {
  if (!loopPreviewAvailable()) {
    state.loopPreview = undefined;
    renderLoopPanel();
    if (!silent) showToast('preview_config tool is not available');
    return;
  }
  const config = parseJsonMaybe(els.loopConfigJson.value);
  const id = config?.id || currentLoopConfigId();
  if (!id && !config) {
    if (!silent) showToast('load or create a loop config first');
    return;
  }
  const input = config
    ? {
        useActiveConfig: false,
        config: config.inherit === undefined ? { ...config, inherit: false } : config
      }
    : { id };
  if (!silent) setBusy(true);
  try {
    state.loopPreview = await executeLoopTool('system.agent_loop.preview_config', input);
    renderLoopPanel();
    if (!silent) showToast(`${state.loopPreview.configId || id} preview ready`);
  } catch (error) {
    state.loopPreview = undefined;
    renderLoopBlueprint(undefined);
    if (!silent) showToast(error.message || String(error));
  } finally {
    if (!silent) setBusy(false);
  }
}

async function saveLoopConfigFromEditor() {
  let config;
  try {
    config = parseJsonEditor(els.loopConfigJson.value, 'Config JSON');
  } catch (error) {
    showToast(error.message);
    return;
  }
  const id = config.id || state.selectedLoopConfigId;
  if (!id) {
    showToast('config id is required');
    return;
  }
  if (!confirm(`Save loop config ${id}?`)) return;
  setBusy(true);
  try {
    await executeLoopTool('system.agent_loop.upsert_config', { id, config }, { authorization: true });
    state.selectedLoopConfigId = id;
    await loadLoopManagerData({ silent: true });
    await loadSelectedLoopConfig({ silent: true });
    renderLoopPanel();
    showToast(`${id} saved`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function archiveSelectedLoopConfig() {
  const id = currentLoopConfigId();
  if (!id) return showToast('select a loop config first');
  if (!confirm(`Archive loop config ${id}?`)) return;
  setBusy(true);
  try {
    await executeLoopTool('system.agent_loop.archive_config', {
      id,
      label: `manual-${new Date().toISOString()}`
    }, { authorization: true });
    await loadLoopManagerData({ silent: true });
    renderLoopPanel();
    showToast(`${id} archived`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function switchSelectedLoopConfig() {
  const id = currentLoopConfigId();
  if (!id) return showToast('select a loop config first');
  if (!confirm(`Hot-switch active loop config to ${id}?`)) return;
  setBusy(true);
  try {
    await executeLoopTool('system.agent_loop.switch_config', {
      id,
      reason: 'tool-manager hot switch'
    }, { authorization: true });
    await loadLoopManagerData({ silent: true });
    renderLoopPanel();
    showToast(`${id} is active`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function deleteSelectedLoopConfig() {
  const id = currentLoopConfigId();
  if (!id) return showToast('select a loop config first');
  if (!confirm(`Delete saved loop config ${id}? Built-in templates cannot be deleted.`)) return;
  setBusy(true);
  try {
    const result = await executeLoopTool('system.agent_loop.delete_config', { id }, { authorization: true });
    await loadLoopManagerData({ silent: true });
    state.selectedLoopConfigId = state.activeLoopConfig?.activeConfigId || state.loopConfigs[0]?.id || '';
    renderLoopPanel();
    showToast(result.deleted ? `${id} deleted` : `${id} not deleted`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function dryRunSelectedLoopConfig() {
  let input;
  try {
    input = parseJsonEditor(els.loopRunInputJson.value || '{}', 'Dry-Run Input JSON');
  } catch (error) {
    showToast(error.message);
    return;
  }
  const id = currentLoopConfigId();
  if (id && !input.configId && !input.loopConfigId) input.configId = id;
  setBusy(true);
  try {
    const result = await executeLoopTool('system.agent_loop.dry_run_config_turn', input);
    els.loopRunInputJson.value = pretty(input);
    els.loopRunOutputJson.textContent = pretty(result);
    setDebugFilesFromResult({ output: result, trace: result.finalOutput?.trace || result.steps?.at(-1)?.trace });
    setLatestAccessCallCountsFromResult(result, `${result.configId || id || 'loop'} dry-run`);
    showToast(`${result.configId || id} dry-run complete`);
  } catch (error) {
    els.loopRunOutputJson.textContent = pretty({ error: error.message || String(error) });
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function exportSelectedLoopConfig() {
  const config = parseJsonMaybe(els.loopConfigJson.value) || loopConfigById(currentLoopConfigId());
  if (!config?.id) return showToast('load a loop config first');
  downloadJson(`ai-dnd-loop-config-${config.id}-${timestampForFilename()}.json`, {
    kind: 'ai-dnd-loop-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    config
  });
  showToast(`${config.id} exported`);
}

function exportLoopPreview() {
  if (!state.loopPreview) {
    showToast('run Preview first');
    return;
  }
  const id = state.loopPreview.configId || currentLoopConfigId() || 'loop-flow';
  downloadJson(`ai-dnd-loop-preview-${id}-${timestampForFilename()}.json`, {
    kind: 'ai-dnd-loop-flow-preview',
    version: 1,
    exportedAt: new Date().toISOString(),
    preview: state.loopPreview
  });
  showToast(`${id} preview exported`);
}

async function importLoopConfigFromFile() {
  const file = els.loopConfigImportFileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const config = parsed.config || parsed;
    if (!config?.id) throw new Error('Imported loop config requires id');
    state.selectedLoopConfigId = config.id;
    els.loopConfigJson.value = pretty(config);
    els.loopRunInputJson.value = pretty({
      configId: config.id,
      text: ''
    });
    syncLoopRouterPolicyEditor({ force: true });
    state.loopPreview = undefined;
    await refreshLoopPreview({ silent: true });
    renderLoopPanel();
    showToast(`${config.id} imported into editor`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    els.loopConfigImportFileInput.value = '';
  }
}

function loopManagerAvailable() {
  return state.tools.some((tool) => tool.id === 'system.agent_loop.list_configs')
    && state.tools.some((tool) => tool.id === 'system.agent_loop.dry_run_config_turn');
}

function loopPreviewAvailable() {
  return state.tools.some((tool) => tool.id === 'system.agent_loop.preview_config');
}

async function executeLoopTool(toolId, input = {}, { authorization = false } = {}) {
  const managedInput = withManagedLoopToolContext(toolId, input);
  const payload = await api(`/v1/tools/${encodeURIComponent(toolId)}/execute`, {
    method: 'POST',
    body: {
      input: managedInput,
      context: {
        source: 'tool-manager.loop',
        ...(authorization ? { authorization: true } : {})
      }
    }
  });
  return payload.result?.output ?? payload.output ?? payload.result;
}

function withManagedLoopToolContext(toolId, input = {}) {
  if (!isLoopTurnTool(toolId) || !isPlainRecord(input)) return input;
  const policy = normalizeAgentAccessPolicy(state.agentAccessPolicy);
  const toolContext = isPlainRecord(input.toolContext) ? input.toolContext : {};
  const agentAccess = isPlainRecord(toolContext.agentAccess) ? toolContext.agentAccess : {};
  return {
    ...input,
    toolContext: {
      ...toolContext,
      agentAccessPolicy: toolContext.agentAccessPolicy || policy,
      agentAccess: {
        ...agentAccess,
        policy: agentAccess.policy || toolContext.agentAccessPolicy || policy,
        source: agentAccess.source || 'tool-manager.loop'
      }
    }
  };
}

function isLoopTurnTool(toolId) {
  return [
    'system.agent_loop.dry_run_config_turn',
    'system.agent_loop.run_config_turn',
    'system.agent_loop.dry_run_turn',
    'system.agent_loop.run_turn'
  ].includes(toolId);
}

function loopConfigById(id) {
  return state.loopConfigs.find((config) => config.id === id);
}

function currentLoopConfigId() {
  const config = parseJsonMaybe(els.loopConfigJson.value);
  return config?.id || state.selectedLoopConfigId || els.loopConfigSelect.value;
}

function parseJsonMaybe(text) {
  const source = String(text || '').trim();
  if (!source) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

function filteredTools() {
  const search = state.toolSearch;
  return state.tools.filter((tool) => {
    if (state.toolScope === 'selected' && tool.pluginId !== state.selectedPluginId) return false;
    if (state.visibility !== 'all' && tool.visibility !== state.visibility) return false;
    if (state.enabledFilter === 'enabled' && tool.enabled === false) return false;
    if (state.enabledFilter === 'disabled' && tool.enabled !== false) return false;
    if (!search) return true;
    return [
      tool.id,
      tool.name,
      tool.title,
      tool.description,
      tool.visibility,
      ...(tool.tags || [])
    ].filter(Boolean).join(' ').toLowerCase().includes(search);
  });
}

function matchesPluginSearch(plugin) {
  if (!state.pluginSearch) return true;
  return [
    plugin.id,
    plugin.name,
    plugin.description,
    ...(plugin.permissions || [])
  ].filter(Boolean).join(' ').toLowerCase().includes(state.pluginSearch);
}

function selectPlugin(pluginId) {
  state.selectedPluginId = pluginId;
  if (state.toolScope === 'selected') {
    const pluginTools = toolsForPlugin(pluginId);
    if (!pluginTools.some((tool) => tool.id === state.selectedToolId)) {
      state.selectedToolId = pluginTools[0]?.id || '';
    }
  }
  saveSelection();
  render();
}

function selectTool(toolId) {
  const tool = state.tools.find((candidate) => candidate.id === toolId);
  state.selectedToolId = toolId;
  if (tool) state.selectedPluginId = tool.pluginId;
  saveSelection();
  render();
}

async function patchPlugin(pluginId, patch) {
  setBusy(true);
  try {
    await api(`/v1/tool-plugins/${encodeURIComponent(pluginId)}`, {
      method: 'PATCH',
      body: patch
    });
    await loadAll();
    showToast(`${pluginId} saved`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function patchTool(pluginId, toolName, patch) {
  setBusy(true);
  try {
    await api(`/v1/tool-plugins/${encodeURIComponent(pluginId)}/tools/${encodeURIComponent(toolName)}`, {
      method: 'PATCH',
      body: patch
    });
    await loadAll();
    showToast(`${pluginId}.${toolName} saved`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function executeSelectedTool() {
  const tool = selectedTool();
  if (!tool) return;
  if (tool.mutatesState && !confirm(`Run mutating tool ${tool.id}?`)) return;

  let input;
  let context;
  try {
    input = parseJsonEditor(els.toolInputJson.value, 'Input JSON');
    context = parseJsonEditor(els.toolContextJson.value, 'Context JSON');
  } catch (error) {
    showToast(error.message);
    return;
  }

  setBusy(true);
  try {
    input = applyPromptSettingsToToolInput(input, tool);
    els.toolInputJson.value = pretty(input);
    context = buildExecutionContext(context, tool);
    const payload = await api(`/v1/tools/${encodeURIComponent(tool.id)}/execute`, {
      method: 'POST',
      body: { input, context }
    });
    els.toolOutputJson.textContent = pretty(payload.result);
    setDebugFilesFromResult(payload.result);
    showToast(`${tool.id} executed`);
  } catch (error) {
    els.toolOutputJson.textContent = pretty({ error: error.message || String(error) });
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function moveSelectedPlugin(direction) {
  const index = state.pluginOrder.indexOf(state.selectedPluginId);
  if (index < 0) return;
  const next = index + direction;
  if (next < 0 || next >= state.pluginOrder.length) return;
  const order = [...state.pluginOrder];
  [order[index], order[next]] = [order[next], order[index]];
  state.pluginOrder = order;
  saveOrder();
  renderPlugins();
}

function reorderPlugin(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const order = state.pluginOrder.filter((id) => id !== sourceId);
  const targetIndex = order.indexOf(targetId);
  order.splice(targetIndex < 0 ? order.length : targetIndex, 0, sourceId);
  state.pluginOrder = order;
  saveOrder();
  renderPlugins();
}

function resetPluginOrder() {
  state.pluginOrder = state.plugins.map((plugin) => plugin.id).sort((a, b) => a.localeCompare(b));
  saveOrder();
  renderPlugins();
  showToast('order reset');
}

function exportConfiguration() {
  const payload = {
    exportedAt: new Date().toISOString(),
    pluginOrder: state.pluginOrder,
    apiTargets: redactApiTargets(state.apiTargets),
    agentAccessPolicy: normalizeAgentAccessPolicy(state.agentAccessPolicy),
    plugins: orderedPlugins().map((plugin) => ({
      id: plugin.id,
      enabled: plugin.enabled !== false,
      tools: toolsForPlugin(plugin.id).map((tool) => ({
        id: tool.id,
        name: tool.name,
        enabled: tool.enabled !== false,
        visibility: tool.visibility,
        mutatesState: Boolean(tool.mutatesState),
        autoCallable: Boolean(tool.autoCallable)
      }))
    }))
  };
  downloadJson('ai-dnd-tool-manager-config.json', payload);
}

function exportBatchTools() {
  const tools = toolsForBatchScope();
  if (tools.length === 0) {
    showToast('no tools to export');
    return;
  }
  const payload = buildToolBundle(tools);
  downloadJson(`ai-dnd-tools-${state.toolBatchScope}-${timestampForFilename()}.json`, payload);
  showToast(`${tools.length} tools exported`);
}

async function importToolsFromFile() {
  const file = els.toolImportFileInput.files?.[0];
  if (!file) return;

  setBusy(true);
  try {
    const parsed = JSON.parse(await file.text());
    const payload = Array.isArray(parsed)
      ? { tools: parsed, targetPluginId: state.selectedPluginId, mode: 'upsert' }
      : {
          ...(parsed || {}),
          targetPluginId: parsed?.targetPluginId || state.selectedPluginId,
          mode: parsed?.mode || 'upsert'
        };
    const result = await api('/v1/tools/import', {
      method: 'POST',
      body: payload
    });
    await loadAll();
    showToast(formatToolImportResult(result));
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    els.toolImportFileInput.value = '';
    setBusy(false);
  }
}

async function deleteBatchTools() {
  const tools = toolsForBatchScope();
  if (tools.length === 0) {
    showToast('no tools to delete');
    return;
  }
  const label = toolBatchScopeLabel();
  if (!confirm(`Delete ${tools.length} tools from ${label}? This only affects the running tool registry.`)) return;

  setBusy(true);
  try {
    const result = await api('/v1/tools/delete', {
      method: 'POST',
      body: { toolIds: tools.map((tool) => tool.id) }
    });
    await loadAll();
    showToast(formatToolDeleteResult(result));
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function toolsForBatchScope() {
  if (state.toolBatchScope === 'all') return [...state.tools];
  if (state.toolBatchScope === 'visible') return filteredTools();
  if (state.toolBatchScope === 'plugin') return toolsForPlugin(state.selectedPluginId);
  const tool = selectedTool();
  return tool ? [tool] : [];
}

function toolBatchScopeLabel() {
  const labels = {
    selected: 'selected tool',
    plugin: state.selectedPluginId || 'current plugin',
    visible: 'visible tools',
    all: 'all tools'
  };
  return labels[state.toolBatchScope] || 'selected tool';
}

function buildToolBundle(tools) {
  const toolIds = new Set(tools.map((tool) => tool.id));
  const plugins = orderedPlugins()
    .filter((plugin) => tools.some((tool) => tool.pluginId === plugin.id))
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      enabled: plugin.enabled,
      author: plugin.author,
      homepage: plugin.homepage,
      permissions: plugin.permissions || [],
      metadata: plugin.metadata || {},
      tools: tools
        .filter((tool) => tool.pluginId === plugin.id && toolIds.has(tool.id))
        .map(exportableToolDescriptor)
    }));
  return {
    kind: 'ai-dnd-tool-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: state.toolBatchScope,
    selectedPluginId: state.selectedPluginId,
    selectedToolId: state.selectedToolId,
    plugins
  };
}

function exportableToolDescriptor(tool) {
  const raw = rawToolFor(tool) || tool;
  const {
    id: _id,
    pluginId: _pluginId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...descriptor
  } = raw;
  return descriptor;
}

function formatToolImportResult(result = {}) {
  const created = (result.createdTools || []).length;
  const updated = (result.updatedTools || []).length;
  const plugins = (result.createdPlugins || []).length;
  const errors = (result.errors || []).length;
  return `imported ${created} created, ${updated} updated, ${plugins} plugins, ${errors} errors`;
}

function formatToolDeleteResult(result = {}) {
  const deleted = (result.deletedTools || []).length;
  const errors = (result.errors || []).length;
  return `deleted ${deleted} tools${errors ? `, ${errors} errors` : ''}`;
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function visualAssetManagerAvailable() {
  return ['list_assets', 'list_bindings', 'resolve_assets', 'upsert_asset', 'upsert_binding']
    .every((name) => state.tools.some((tool) => tool.id === `system.visual.${name}`));
}

async function refreshVisualAssetData({ silent = false } = {}) {
  if (!visualAssetManagerAvailable()) {
    state.visualAssets = [];
    state.visualBindings = [];
    state.visualTargets = { npc: [], map: [] };
    renderAssetPanel();
    return;
  }
  if (!silent) setBusy(true);
  try {
    const [assets, bindings, npcs, maps] = await Promise.all([
      executeVisualTool('list_assets', { limit: 500 }),
      executeVisualTool('list_bindings', { limit: 500 }),
      executeOptionalTool('system.npc_registry.list_npcs', { limit: 500 }),
      executeOptionalTool('system.map_registry.list_maps', { limit: 500 })
    ]);
    state.visualAssets = visualRecordsFromOutput(assets);
    state.visualBindings = visualRecordsFromOutput(bindings);
    state.visualTargets = {
      npc: visualRecordsFromOutput(npcs),
      map: visualRecordsFromOutput(maps)
    };
    if (state.selectedVisualAssetId && !state.visualAssets.some((record) => visualAssetId(record) === state.selectedVisualAssetId)) {
      state.selectedVisualAssetId = '';
    }
    if (state.selectedVisualBindingId && !state.visualBindings.some((record) => visualBindingId(record) === state.selectedVisualBindingId)) {
      state.selectedVisualBindingId = '';
    }
    renderAssetPanel();
    if (!silent) showToast('visual assets refreshed');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    if (!silent) setBusy(false);
  }
}

async function executeVisualTool(name, input = {}, { authorization = false } = {}) {
  const payload = await api(`/v1/tools/${encodeURIComponent(`system.visual.${name}`)}/execute`, {
    method: 'POST',
    body: {
      input,
      context: {
        source: 'tool-manager.assets',
        ...(authorization ? { authorization: true } : {})
      }
    }
  });
  return payload.result?.output ?? payload.output ?? payload.result;
}

async function executeOptionalTool(toolId, input = {}, context = { source: 'tool-manager.assets' }) {
  if (!state.tools.some((tool) => tool.id === toolId)) return undefined;
  try {
    const payload = await api(`/v1/tools/${encodeURIComponent(toolId)}/execute`, {
      method: 'POST',
      body: { input, context }
    });
    return payload.result?.output ?? payload.output ?? payload.result;
  } catch {
    return undefined;
  }
}

function visualRecordsFromOutput(output = {}) {
  if (Array.isArray(output)) return output;
  return output.records || output.assets || output.bindings || output.eventBindings || output.maps || output.npcs || [];
}

function renderAssetPanel() {
  if (!els.assetManagerSummary) return;
  const available = visualAssetManagerAvailable();
  els.assetSearchInput.value = state.assetSearch;
  els.assetTargetFilter.value = state.assetTargetFilter;
  setAssetControlsDisabled(!available || state.busy);
  if (!available) {
    els.assetManagerSummary.textContent = 'system.visual tools are not available';
    els.visualBindingList.innerHTML = '';
    els.visualAssetList.innerHTML = '';
    els.visualBindingList.append(emptyState('Visual asset tools unavailable.'));
    els.visualAssetList.append(emptyState('Enable system.visual first.'));
    renderVisualAssetPreview();
    return;
  }

  const filteredBindings = state.visualBindings
    .filter(matchesAssetTargetFilter)
    .filter(matchesAssetSearch);
  const filteredAssets = state.visualAssets
    .filter(matchesAssetSearch);
  els.assetManagerSummary.textContent = [
    `${state.visualAssets.length} assets`,
    `${state.visualBindings.length} bindings`,
    `${state.visualTargets.npc.length} NPC targets`,
    `${state.visualTargets.map.length} map targets`
  ].join(' · ');
  renderVisualBindingList(filteredBindings);
  renderVisualAssetList(filteredAssets);
  syncVisualTargetSelect();
  renderVisualAssetPreview();
}

function renderVisualBindingList(bindings) {
  els.visualBindingList.innerHTML = '';
  if (bindings.length === 0) {
    els.visualBindingList.append(emptyState('no visual bindings'));
    return;
  }
  for (const record of bindings) {
    const data = record.data || {};
    const row = document.createElement('button');
    row.type = 'button';
    row.role = 'listitem';
    row.className = `asset-row${visualBindingId(record) === state.selectedVisualBindingId ? ' active' : ''}${data.status && data.status !== 'active' ? ' muted' : ''}`;
    row.addEventListener('click', () => selectVisualBinding(visualBindingId(record)));

    const thumb = document.createElement('span');
    thumb.className = 'asset-thumb';
    thumb.textContent = data.targetType || 'bind';

    const main = document.createElement('span');
    main.className = 'asset-row-main';
    const title = document.createElement('span');
    title.className = 'asset-row-title';
    title.textContent = `${data.targetType || 'target'}:${data.targetId || ''}`;
    const subtitle = document.createElement('span');
    subtitle.className = 'asset-row-subtitle';
    subtitle.textContent = [
      data.slot || 'default',
      data.assetId,
      `priority ${data.priority ?? 0}`
    ].filter(Boolean).join(' · ');
    main.append(title, subtitle);

    const flags = document.createElement('span');
    flags.className = 'asset-row-flags';
    flags.append(flag(data.status || 'active', data.status === 'active' ? 'api' : 'warn'));
    flags.append(flag(data.targetType || 'target'));
    row.append(thumb, main, flags);
    els.visualBindingList.append(row);
  }
}

function renderVisualAssetList(assets) {
  els.visualAssetList.innerHTML = '';
  if (assets.length === 0) {
    els.visualAssetList.append(emptyState('no visual assets'));
    return;
  }
  for (const record of assets) {
    const data = record.data || {};
    const row = document.createElement('button');
    row.type = 'button';
    row.role = 'listitem';
    row.className = `asset-row${visualAssetId(record) === state.selectedVisualAssetId ? ' active' : ''}${data.status && data.status !== 'active' ? ' muted' : ''}`;
    row.addEventListener('click', () => selectVisualAsset(visualAssetId(record)));

    const thumb = document.createElement('span');
    thumb.className = 'asset-thumb';
    if (visualAssetIsImage(data) && data.uri) {
      thumb.style.backgroundImage = `url("${data.uri}")`;
    } else {
      thumb.textContent = visualAssetIcon(data.assetType);
    }

    const main = document.createElement('span');
    main.className = 'asset-row-main';
    const title = document.createElement('span');
    title.className = 'asset-row-title';
    title.textContent = data.name || data.assetId || record.id;
    const subtitle = document.createElement('span');
    subtitle.className = 'asset-row-subtitle';
    subtitle.textContent = [
      data.assetId,
      data.assetType || 'asset',
      data.uri || 'no uri'
    ].filter(Boolean).join(' · ');
    main.append(title, subtitle);
    row.append(thumb, main);
    els.visualAssetList.append(row);
  }
}

function setAssetControlsDisabled(disabled) {
  for (const element of [
    els.refreshAssetsButton,
    els.assetSearchInput,
    els.assetTargetFilter,
    els.newAssetBindingButton,
    els.resolveAssetBindingButton,
    els.saveVisualAssetButton,
    els.saveVisualBindingButton,
    els.saveVisualAssetBindingButton,
    els.archiveVisualAssetButton,
    els.archiveVisualBindingButton,
    els.visualTargetType,
    els.visualTargetSelect,
    els.visualTargetId,
    els.visualSlot,
    els.visualBindingId,
    els.visualPriority,
    els.visualBindingStatus,
    els.visualVisibility,
    els.visualConditionsJson,
    els.visualAssetId,
    els.visualAssetType,
    els.visualAssetName,
    els.visualAssetUri,
    els.visualMimeType,
    els.visualAssetStatus,
    els.visualAssetTags,
    els.visualAssetPrompt,
    els.visualMetadataJson
  ]) {
    element.disabled = disabled;
  }
  els.archiveVisualAssetButton.disabled = disabled || !state.selectedVisualAssetId;
  els.archiveVisualBindingButton.disabled = disabled || !state.selectedVisualBindingId;
}

function matchesAssetTargetFilter(record) {
  if (state.assetTargetFilter === 'all') return true;
  const data = record.data || {};
  if (state.assetTargetFilter === 'event') return Boolean(data.eventType);
  return String(data.targetType || '').toLowerCase() === state.assetTargetFilter;
}

function matchesAssetSearch(record) {
  if (!state.assetSearch) return true;
  const data = record.data || {};
  return [
    record.id,
    data.assetId,
    data.bindingId,
    data.name,
    data.targetType,
    data.targetId,
    data.slot,
    data.uri,
    data.prompt,
    ...(Array.isArray(data.tags) ? data.tags : []),
    ...(Array.isArray(data.aliases) ? data.aliases : [])
  ].filter(Boolean).join(' ').toLowerCase().includes(state.assetSearch);
}

function selectVisualAsset(assetId) {
  const record = state.visualAssets.find((candidate) => visualAssetId(candidate) === assetId);
  if (!record) return;
  state.selectedVisualAssetId = assetId;
  fillVisualAssetEditor(record);
  renderAssetPanel();
}

function selectVisualBinding(bindingId) {
  const record = state.visualBindings.find((candidate) => visualBindingId(candidate) === bindingId);
  if (!record) return;
  const assetId = record.data?.assetId || '';
  const asset = state.visualAssets.find((candidate) => visualAssetId(candidate) === assetId);
  state.selectedVisualBindingId = bindingId;
  state.selectedVisualAssetId = assetId;
  fillVisualBindingEditor(record, asset);
  renderAssetPanel();
}

function fillVisualBindingEditor(bindingRecord, assetRecord) {
  const binding = bindingRecord?.data || {};
  els.visualTargetType.value = binding.targetType || 'npc';
  syncVisualTargetSelect();
  els.visualTargetId.value = binding.targetId || '';
  els.visualSlot.value = binding.slot || fallbackVisualSlot(binding.targetType || 'npc');
  els.visualBindingId.value = binding.bindingId || bindingRecord?.id || '';
  els.visualPriority.value = String(binding.priority ?? 100);
  els.visualBindingStatus.value = binding.status || 'active';
  els.visualVisibility.value = binding.visibility || 'public';
  els.visualConditionsJson.value = pretty(binding.conditions || {});
  fillVisualAssetEditor(assetRecord, binding.assetId);
}

function fillVisualAssetEditor(assetRecord, fallbackAssetId = '') {
  const asset = assetRecord?.data || {};
  els.visualAssetId.value = asset.assetId || fallbackAssetId || els.visualAssetId.value || '';
  els.visualAssetType.value = asset.assetType || 'image';
  els.visualAssetName.value = asset.name || '';
  els.visualAssetUri.value = asset.uri || '';
  els.visualMimeType.value = asset.mimeType || '';
  els.visualAssetStatus.value = asset.status || 'active';
  els.visualAssetTags.value = Array.isArray(asset.tags) ? asset.tags.join(', ') : '';
  els.visualAssetPrompt.value = asset.prompt || '';
  els.visualMetadataJson.value = pretty(asset.metadata || {});
}

function createVisualAssetBindingDraft() {
  state.selectedVisualAssetId = '';
  state.selectedVisualBindingId = '';
  const targetType = ['npc', 'map'].includes(state.assetTargetFilter) ? state.assetTargetFilter : 'npc';
  els.visualTargetType.value = targetType;
  syncVisualTargetSelect();
  els.visualTargetId.value = '';
  els.visualSlot.value = fallbackVisualSlot(targetType);
  els.visualBindingId.value = '';
  els.visualPriority.value = '100';
  els.visualBindingStatus.value = 'active';
  els.visualVisibility.value = 'public';
  els.visualConditionsJson.value = '{}';
  els.visualAssetId.value = '';
  els.visualAssetType.value = 'image';
  els.visualAssetName.value = '';
  els.visualAssetUri.value = '';
  els.visualMimeType.value = '';
  els.visualAssetStatus.value = 'active';
  els.visualAssetTags.value = `${targetType}, ${els.visualSlot.value}`;
  els.visualAssetPrompt.value = '';
  els.visualMetadataJson.value = '{}';
  els.visualResolveOutput.textContent = '';
  renderAssetPanel();
}

function syncVisualTargetSelect() {
  const type = els.visualTargetType.value || 'npc';
  const targets = state.visualTargets[type] || [];
  const current = els.visualTargetId.value;
  els.visualTargetSelect.innerHTML = '';
  const manual = document.createElement('option');
  manual.value = '';
  manual.textContent = targets.length > 0 ? 'manual target id' : 'no known targets';
  els.visualTargetSelect.append(manual);
  for (const record of targets) {
    const id = visualTargetId(record, type);
    if (!id) continue;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = visualTargetLabel(record, type);
    els.visualTargetSelect.append(option);
  }
  els.visualTargetSelect.value = targets.some((record) => visualTargetId(record, type) === current) ? current : '';
}

function syncVisualSlotForTargetType() {
  const fallback = fallbackVisualSlot(els.visualTargetType.value);
  if (!els.visualSlot.value || ['portrait', 'background'].includes(els.visualSlot.value)) {
    els.visualSlot.value = fallback;
  }
  if (!els.visualAssetTags.value.trim()) {
    els.visualAssetTags.value = `${els.visualTargetType.value}, ${els.visualSlot.value}`;
  }
}

function applyKnownVisualTarget(targetId) {
  if (!targetId) return;
  els.visualTargetId.value = targetId;
  if (!els.visualAssetName.value.trim()) {
    const target = (state.visualTargets[els.visualTargetType.value] || [])
      .find((record) => visualTargetId(record, els.visualTargetType.value) === targetId);
    const label = visualTargetDisplayName(target, els.visualTargetType.value);
    els.visualAssetName.value = label ? `${label} ${els.visualSlot.value}` : '';
  }
  renderVisualAssetPreview();
}

function renderVisualAssetPreview() {
  if (!els.visualAssetPreview) return;
  const asset = readVisualAssetDraft({ tolerateErrors: true });
  const binding = readVisualBindingDraft({ tolerateErrors: true });
  els.assetEditorTitle.textContent = binding?.bindingId || asset?.assetId || 'Asset Binding';
  els.assetEditorSummary.textContent = [
    binding?.targetType && binding?.targetId ? `${binding.targetType}:${binding.targetId}` : '',
    binding?.slot,
    asset?.assetType,
    asset?.uri || 'no uri'
  ].filter(Boolean).join(' · ') || 'select or create a visual asset binding';
  els.visualAssetPreview.innerHTML = '';
  if (asset?.uri && visualAssetIsImage(asset)) {
    const image = document.createElement('img');
    image.src = asset.uri;
    image.alt = asset.name || asset.assetId || 'visual asset';
    els.visualAssetPreview.append(image);
    return;
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'asset-preview-placeholder';
  placeholder.textContent = asset?.uri
    ? `${visualAssetIcon(asset.assetType)} ${asset.assetType || 'asset'} · ${asset.uri}`
    : 'No preview URI. Add /assets/... or https://...';
  els.visualAssetPreview.append(placeholder);
}

async function saveVisualAssetAndBindingDraft() {
  await saveVisualAssetDraft({ binding: true });
  await saveVisualBindingDraft({ asset: true });
}

async function saveVisualAssetDraft({ binding = false } = {}) {
  let input;
  try {
    input = readVisualAssetDraft();
  } catch (error) {
    showToast(error.message || String(error));
    return;
  }
  setBusy(true);
  try {
    const output = await executeVisualTool('upsert_asset', input, { authorization: true });
    state.selectedVisualAssetId = output?.data?.assetId || input.assetId;
    if (!binding) showToast(`${state.selectedVisualAssetId} asset saved`);
    await refreshVisualAssetData({ silent: true });
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function saveVisualBindingDraft({ asset = false } = {}) {
  let input;
  try {
    input = readVisualBindingDraft();
  } catch (error) {
    showToast(error.message || String(error));
    return;
  }
  setBusy(true);
  try {
    const output = await executeVisualTool('upsert_binding', input, { authorization: true });
    state.selectedVisualBindingId = output?.data?.bindingId || input.bindingId;
    state.selectedVisualAssetId = input.assetId;
    showToast(asset ? `${input.bindingId} asset and binding saved` : `${input.bindingId} binding saved`);
    await refreshVisualAssetData({ silent: true });
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function resolveVisualAssetBindingDraft() {
  let binding;
  try {
    binding = readVisualBindingDraft({ allowMissingAsset: true });
  } catch (error) {
    showToast(error.message || String(error));
    return;
  }
  setBusy(true);
  try {
    const output = await executeVisualTool('resolve_assets', {
      targetType: binding.targetType,
      targetId: binding.targetId,
      slot: binding.slot,
      includePlaceholders: true
    });
    els.visualResolveOutput.textContent = pretty(output);
    showToast(output.noop ? 'no visual asset resolved' : `${output.assets?.length || 0} visual assets resolved`);
  } catch (error) {
    els.visualResolveOutput.textContent = pretty({ error: error.message || String(error) });
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function archiveSelectedVisualAsset() {
  if (!state.selectedVisualAssetId) {
    showToast('select an asset first');
    return;
  }
  if (!confirm(`Archive visual asset ${state.selectedVisualAssetId}?`)) return;
  try {
    const input = {
      ...readVisualAssetDraft(),
      assetId: state.selectedVisualAssetId,
      status: 'archived'
    };
    setBusy(true);
    await executeVisualTool('upsert_asset', input, { authorization: true });
    await refreshVisualAssetData({ silent: true });
    showToast(`${state.selectedVisualAssetId} archived`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function archiveSelectedVisualBinding() {
  if (!state.selectedVisualBindingId) {
    showToast('select a binding first');
    return;
  }
  if (!confirm(`Archive visual binding ${state.selectedVisualBindingId}?`)) return;
  try {
    const input = {
      ...readVisualBindingDraft(),
      bindingId: state.selectedVisualBindingId,
      status: 'archived'
    };
    setBusy(true);
    await executeVisualTool('upsert_binding', input, { authorization: true });
    await refreshVisualAssetData({ silent: true });
    showToast(`${state.selectedVisualBindingId} archived`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function readVisualAssetDraft({ tolerateErrors = false } = {}) {
  try {
    const targetType = els.visualTargetType.value || 'custom';
    const targetId = els.visualTargetId.value.trim();
    const slot = els.visualSlot.value || fallbackVisualSlot(targetType);
    const assetId = normalizeUiId(els.visualAssetId.value || `asset_${targetType}_${targetId || 'target'}_${slot}`, 'asset_visual');
    return {
      assetId,
      name: els.visualAssetName.value.trim() || assetId,
      assetType: els.visualAssetType.value || 'image',
      uri: els.visualAssetUri.value.trim(),
      mimeType: els.visualMimeType.value.trim(),
      prompt: els.visualAssetPrompt.value.trim(),
      status: els.visualAssetStatus.value || 'active',
      tags: splitCsv(els.visualAssetTags.value),
      metadata: parseJsonEditor(els.visualMetadataJson.value || '{}', 'Asset metadata JSON')
    };
  } catch (error) {
    if (tolerateErrors) return undefined;
    throw error;
  }
}

function readVisualBindingDraft({ tolerateErrors = false, allowMissingAsset = false } = {}) {
  try {
    const targetType = els.visualTargetType.value || 'custom';
    const targetId = els.visualTargetId.value.trim();
    const slot = els.visualSlot.value || fallbackVisualSlot(targetType);
    const assetId = els.visualAssetId.value.trim() || (!allowMissingAsset ? readVisualAssetDraft().assetId : '');
    if (!targetId) throw new Error('Target ID is required');
    if (!allowMissingAsset && !assetId) throw new Error('Asset ID is required');
    const bindingId = normalizeUiId(els.visualBindingId.value || `binding_${targetType}_${targetId}_${slot}_${assetId || 'asset'}`, 'binding_visual');
    return {
      bindingId,
      targetType,
      targetId,
      slot,
      assetId,
      priority: parseOptionalInteger(els.visualPriority.value, 100),
      conditions: parseJsonEditor(els.visualConditionsJson.value || '{}', 'Binding conditions JSON'),
      visibility: els.visualVisibility.value || 'public',
      status: els.visualBindingStatus.value || 'active',
      tags: splitCsv(els.visualAssetTags.value),
      metadata: {}
    };
  } catch (error) {
    if (tolerateErrors) return undefined;
    throw error;
  }
}

function visualAssetId(record) {
  return record?.data?.assetId || record?.id || '';
}

function visualBindingId(record) {
  return record?.data?.bindingId || record?.id || '';
}

function visualTargetId(record, type) {
  const data = record?.data || record || {};
  return data.targetId || data[`${type}Id`] || data.npcId || data.mapId || data.id || record?.id || '';
}

function visualTargetDisplayName(record, type) {
  const data = record?.data || record || {};
  return data.name || data.title || data.label || data.summary || visualTargetId(record, type);
}

function visualTargetLabel(record, type) {
  const id = visualTargetId(record, type);
  const name = visualTargetDisplayName(record, type);
  return name && name !== id ? `${name} · ${id}` : id;
}

function visualAssetIsImage(asset = {}) {
  const type = String(asset.assetType || asset.type || '').toLowerCase();
  const uri = String(asset.uri || '').toLowerCase();
  return type === 'image' || type === 'icon' || /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/.test(uri) || uri.startsWith('data:image/');
}

function visualAssetIcon(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'audio') return 'audio';
  if (normalized === 'video' || normalized === 'animation') return 'video';
  if (normalized === 'model') return '3d';
  if (normalized === 'icon') return 'icon';
  return 'asset';
}

function fallbackVisualSlot(targetType = '') {
  const normalized = String(targetType || '').toLowerCase();
  if (normalized === 'npc' || normalized === 'player' || normalized === 'combatant') return 'portrait';
  if (normalized === 'map' || normalized === 'scene') return 'background';
  return 'icon';
}

function splitCsv(value = '') {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeUiId(value, fallback) {
  return String(value || fallback || 'visual')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160)
    || fallback;
}

function parseOptionalInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function renderPromptInventory(selected = selectedTool()) {
  const allItems = promptInventoryItems();
  const filtered = allItems
    .filter(matchesPromptInventoryFilter)
    .filter(matchesPromptInventorySearch);
  const configured = allItems.filter((item) => item.hasConfig).length;
  const missing = allItems.filter((item) => item.unavailable).length;
  const referenceCapable = allItems.filter((item) => item.profile?.referenceFields?.length > 0 || item.profile?.contextFields?.length > 0 || item.profile?.llm).length;
  const summaryParts = [
    `${allItems.length} manageable`,
    `${configured} configured`,
    `${Math.max(allItems.length - configured - missing, 0)} need config`,
    `${referenceCapable} reference-capable`
  ];
  if (missing > 0) summaryParts.push(`${missing} stored for missing tools`);
  els.promptInventorySummary.textContent = summaryParts.join(' · ');
  if (els.promptInventorySearch.value !== state.promptInventorySearch) {
    els.promptInventorySearch.value = state.promptInventorySearch;
  }
  if (els.promptInventoryFilter.value !== state.promptInventoryFilter) {
    els.promptInventoryFilter.value = state.promptInventoryFilter;
  }

  els.promptInventoryList.innerHTML = '';
  if (filtered.length === 0) {
    els.promptInventoryList.append(emptyState(allItems.length === 0
      ? 'No tools declare LLM, prompt, reference, or context-compatible inputs yet.'
      : 'No tools match this prompt/reference filter.'));
    return;
  }

  for (const item of filtered) {
    const row = document.createElement('button');
    row.type = 'button';
    row.role = 'listitem';
    row.className = [
      'prompt-inventory-row',
      selected?.id === item.toolId ? 'active' : '',
      item.hasConfig ? 'saved' : '',
      item.unavailable ? 'disabled' : '',
      item.enabled ? 'enabled' : ''
    ].filter(Boolean).join(' ');
    row.disabled = Boolean(item.unavailable);
    row.setAttribute('aria-pressed', selected?.id === item.toolId ? 'true' : 'false');
    row.addEventListener('click', () => selectPromptInventoryTool(item.toolId));

    const main = document.createElement('span');
    main.className = 'prompt-inventory-main';
    const title = document.createElement('span');
    title.className = 'prompt-inventory-title';
    title.textContent = item.toolId;
    const subtitle = document.createElement('span');
    subtitle.className = 'prompt-inventory-subtitle';
    subtitle.textContent = promptInventorySubtitle(item);
    const fields = document.createElement('span');
    fields.className = 'prompt-inventory-fields';
    for (const summary of item.fieldSummaries.slice(0, 5)) {
      const chip = document.createElement('span');
      chip.textContent = summary;
      fields.append(chip);
    }
    if (item.fieldSummaries.length === 0) {
      const chip = document.createElement('span');
      chip.textContent = item.unavailable
        ? 'stored config; install the matching tool to inspect schema fields'
        : 'runtime LLM override only';
      fields.append(chip);
    }
    main.append(title, subtitle, fields);

    const flags = document.createElement('span');
    flags.className = 'prompt-inventory-flags';
    for (const itemFlag of promptInventoryFlags(item)) {
      flags.append(flag(itemFlag.label, itemFlag.tone));
    }

    row.append(main, flags);
    els.promptInventoryList.append(row);
  }
}

function promptInventoryItems() {
  const knownToolIds = new Set(state.tools.map((tool) => tool.id));
  const installed = state.tools
    .map((tool) => promptInventoryItemForTool(tool))
    .filter((item) => item.profile.manageable || item.hasConfig)
    .sort((a, b) => a.toolId.localeCompare(b.toolId));
  const storedForMissingTools = Object.entries(state.toolPrompts)
    .filter(([toolId]) => !knownToolIds.has(toolId))
    .map(([toolId, settings]) => {
      const normalized = normalizeToolPromptSettings(settings);
      return {
        tool: undefined,
        toolId,
        pluginId: '',
        title: toolId,
        description: '',
        profile: {
          manageable: true,
          llm: false,
          useLlmFields: [],
          promptFields: [],
          referenceFields: [],
          contextFields: [],
          reasons: ['stored config; tool not installed']
        },
        settings: normalized,
        hasConfig: toolPromptHasContent(normalized),
        enabled: normalized.enabled && toolPromptHasContent(normalized),
        quantification: false,
        unavailable: true,
        fieldSummaries: [],
        searchText: [toolId, JSON.stringify(normalized)].join(' ').toLowerCase()
      };
    })
    .filter((item) => item.hasConfig)
    .sort((a, b) => a.toolId.localeCompare(b.toolId));
  return [...installed, ...storedForMissingTools];
}

function promptInventoryItemForTool(tool) {
  const profile = promptProfileForTool(tool);
  const settings = promptSettingsForTool(tool.id);
  const hasConfig = toolPromptHasContent(settings);
  const fieldSummaries = promptInventoryFieldSummaries(tool, profile);
  const plugin = pluginById(tool.pluginId);
  const searchText = [
    tool.id,
    tool.name,
    tool.title,
    tool.description,
    tool.pluginId,
    plugin?.name,
    ...(tool.tags || []),
    ...profile.reasons,
    ...fieldSummaries,
    JSON.stringify(tool.metadata || {}),
    JSON.stringify(settings || {})
  ].filter(Boolean).join(' ').toLowerCase();
  return {
    tool,
    toolId: tool.id,
    pluginId: tool.pluginId,
    title: tool.title || tool.name || tool.id,
    description: tool.description || '',
    profile,
    settings,
    hasConfig,
    enabled: settings.enabled && hasConfig,
    quantification: toolHasQuantificationInputs(tool),
    unavailable: false,
    fieldSummaries,
    searchText
  };
}

function promptInventoryFieldSummaries(tool, profile) {
  const inputProperties = schemaProperties(tool.inputSchema);
  const outputProperties = schemaProperties(tool.outputSchema);
  const summaries = [];
  for (const field of profile.useLlmFields) {
    summaries.push(promptInventoryFieldSummary('in LLM', field, inputProperties[field], 'input'));
  }
  for (const field of profile.promptFields) {
    summaries.push(promptInventoryFieldSummary('in prompt', field, inputProperties[field], 'input'));
  }
  for (const field of profile.referenceFields) {
    summaries.push(promptInventoryFieldSummary('in reference', field, inputProperties[field], 'input'));
  }
  if (profile.referenceFields.length === 0) {
    for (const field of profile.contextFields) {
      summaries.push(promptInventoryFieldSummary('in context', field, inputProperties[field], 'input'));
    }
  }
  for (const field of promptInventoryOutputFields(outputProperties)) {
    summaries.push(promptInventoryFieldSummary('out', field, outputProperties[field], 'output'));
  }
  return [...new Set(summaries)];
}

function promptInventoryFieldSummary(prefix, field, property, direction) {
  const meaning = fieldMeaningFor(field, property || {}, direction).replace(/\s+/g, ' ').replace(/[.。]\s*$/, '');
  return `${prefix} ${field}: ${meaning}`;
}

function promptInventoryOutputFields(properties = {}) {
  const names = Object.keys(properties);
  const interesting = names.filter((name) => /prompt|reference|context|result|output|numeric|value|decision|fields/i.test(name));
  return (interesting.length > 0 ? interesting : names).slice(0, 2);
}

function promptInventorySubtitle(item) {
  if (item.unavailable) return 'Stored bundle entry. It will become active when that tool is installed.';
  const parts = [
    item.pluginId,
    item.description,
    item.profile.reasons.join(' · '),
    item.quantification ? 'quantification reference flow' : '',
    item.enabled ? 'override enabled' : item.hasConfig ? 'configured but disabled' : 'not configured'
  ].filter(Boolean);
  return parts.join(' · ');
}

function promptInventoryFlags(item) {
  const flags = [];
  if (item.enabled) flags.push({ label: 'enabled', tone: 'api' });
  else if (item.hasConfig) flags.push({ label: 'saved', tone: '' });
  else flags.push({ label: 'needs config', tone: 'warn' });
  if (item.profile.llm) flags.push({ label: 'llm', tone: 'api' });
  if (item.profile.promptFields.length > 0 || item.profile.llm) flags.push({ label: 'prompt', tone: '' });
  if (item.profile.referenceFields.length > 0 || item.profile.contextFields.length > 0 || item.profile.llm) flags.push({ label: 'ref', tone: 'rag' });
  if (item.quantification) flags.push({ label: 'quant', tone: 'db' });
  if (item.unavailable) flags.push({ label: 'missing', tone: 'warn' });
  return flags;
}

function matchesPromptInventoryFilter(item) {
  switch (state.promptInventoryFilter) {
    case 'unconfigured':
      return !item.unavailable && !item.hasConfig;
    case 'configured':
      return item.hasConfig;
    case 'reference':
      return item.profile.referenceFields.length > 0 || item.profile.contextFields.length > 0 || item.profile.llm || Boolean(item.settings.references);
    case 'prompt':
      return item.profile.promptFields.length > 0 || item.profile.llm || Boolean(item.settings.replacementPrompt || item.settings.promptPrefix || item.settings.promptSuffix || item.settings.systemPrompt);
    case 'llm':
      return item.profile.llm || item.profile.useLlmFields.length > 0;
    case 'quantification':
      return item.quantification;
    default:
      return true;
  }
}

function matchesPromptInventorySearch(item) {
  if (!state.promptInventorySearch) return true;
  return item.searchText.includes(state.promptInventorySearch);
}

function selectPromptInventoryTool(toolId) {
  const tool = state.tools.find((candidate) => candidate.id === toolId);
  if (!tool) return;
  state.selectedToolId = tool.id;
  state.selectedPluginId = tool.pluginId;
  state.toolScope = 'all';
  state.visibility = 'all';
  state.enabledFilter = 'all';
  state.toolSearch = '';
  els.toolScopeSelect.value = state.toolScope;
  els.visibilitySelect.value = state.visibility;
  els.enabledSelect.value = state.enabledFilter;
  els.toolSearch.value = state.toolSearch;
  els.toolPromptEnabled.dataset.toolId = '';
  saveSelection();
  render();
  activateDetailTab('prompt');
}

function toolHasQuantificationInputs(tool) {
  const properties = schemaProperties(tool.inputSchema);
  const fieldNames = Object.keys(properties);
  const schemaText = fieldNames
    .map((name) => `${name} ${properties[name]?.description || ''}`)
    .join(' ');
  const haystack = [
    tool.id,
    tool.name,
    tool.title,
    tool.description,
    ...(tool.tags || []),
    JSON.stringify(tool.metadata || {}),
    schemaText
  ].filter(Boolean).join(' ').toLowerCase();
  return fieldNames.some((name) => /^(quantificationdefinition|numericdefinition)$/i.test(name))
    || (/quantif|numeric definition|scoring|fuzzy/.test(haystack) && (fieldNames.some((name) => /^definition$/i.test(name)) || fieldNames.some((name) => isReferenceInputField(name, properties[name]))));
}

function renderPromptPanel(tool = selectedTool()) {
  renderPromptInventory(tool);
  if (!tool) {
    els.toolPromptTitle.textContent = 'LLM Prompt';
    els.toolPromptSummary.textContent = 'no selection';
    setPromptEditorDisabled(true);
    fillPromptEditor(DEFAULT_TOOL_PROMPT_SETTINGS);
    els.toolPromptLatestPreview.textContent = '';
    return;
  }

  const settings = promptSettingsForTool(tool.id);
  const profile = promptProfileForTool(tool);
  els.toolPromptTitle.textContent = tool.id;
  els.toolPromptSummary.textContent = profile.manageable ? [
    ...profile.reasons,
    settings.enabled ? 'override enabled' : 'override disabled',
    apiSettingsLabel(apiSettingsForTarget(tool.id))
  ].join(' · ') : 'This tool has no LLM marker or prompt/reference-compatible input fields.';
  setPromptEditorDisabled(!profile.manageable);
  if (els.toolPromptEnabled.dataset.toolId !== tool.id) {
    fillPromptEditor(profile.manageable ? settings : DEFAULT_TOOL_PROMPT_SETTINGS);
    els.toolPromptEnabled.dataset.toolId = tool.id;
    if (state.latestPromptToolId !== tool.id) {
      els.toolPromptLatestPreview.textContent = '';
    }
  }
}

function fillPromptEditor(settings) {
  const normalized = normalizeToolPromptSettings(settings);
  els.toolPromptEnabled.checked = normalized.enabled;
  els.toolPromptMode.value = normalized.mode;
  els.toolPromptReplacement.value = normalized.replacementPrompt;
  els.toolSystemPrompt.value = normalized.systemPrompt;
  els.toolPromptPrefix.value = normalized.promptPrefix;
  els.toolPromptSuffix.value = normalized.promptSuffix;
  els.toolPromptReferences.value = normalized.references;
}

function readPromptEditor() {
  return normalizeToolPromptSettings({
    enabled: els.toolPromptEnabled.checked,
    mode: els.toolPromptMode.value,
    replacementPrompt: els.toolPromptReplacement.value,
    systemPrompt: els.toolSystemPrompt.value,
    promptPrefix: els.toolPromptPrefix.value,
    promptSuffix: els.toolPromptSuffix.value,
    references: els.toolPromptReferences.value
  });
}

function setPromptEditorDisabled(disabled) {
  for (const element of [
    els.toolPromptEnabled,
    els.toolPromptMode,
    els.toolPromptReplacement,
    els.toolSystemPrompt,
    els.toolPromptPrefix,
    els.toolPromptSuffix,
    els.toolPromptReferences,
    els.loadLatestPromptButton,
    els.useLatestPromptButton,
    els.exportPromptButton,
    els.resetPromptButton,
    els.savePromptButton
  ]) {
    element.disabled = disabled;
  }
}

function saveSelectedPromptSettings() {
  const tool = selectedTool();
  if (!tool) return;
  if (!promptProfileForTool(tool).manageable) {
    showToast(`${tool.id} has no LLM prompt/reference inputs`);
    return;
  }
  state.toolPrompts[tool.id] = readPromptEditor();
  saveToolPrompts();
  renderPromptPanel(tool);
  updateButtons();
  showToast(`${tool.id} prompt saved`);
}

function resetSelectedPromptSettings() {
  const tool = selectedTool();
  if (!tool) return;
  delete state.toolPrompts[tool.id];
  saveToolPrompts();
  fillPromptEditor(DEFAULT_TOOL_PROMPT_SETTINGS);
  renderPromptPanel(tool);
  updateButtons();
  showToast(`${tool.id} prompt reset`);
}

function exportPromptSettings() {
  const tool = selectedTool();
  if (!tool) {
    showToast('select a tool first');
    return;
  }
  if (!promptProfileForTool(tool).manageable) {
    showToast(`${tool.id} has no prompt settings to export`);
    return;
  }
  downloadJson(`ai-dnd-tool-prompt-${tool.id}-${timestampForFilename()}.json`, {
    kind: 'ai-dnd-tool-prompt-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    prompts: {
      [tool.id]: readPromptEditor()
    }
  });
  showToast(`${tool.id} prompt exported`);
}

function exportAllPromptSettings() {
  const prompts = exportablePromptSettings();
  if (Object.keys(prompts).length === 0) {
    showToast('no prompt settings to export');
    return;
  }
  downloadJson(`ai-dnd-tool-prompts-all-${timestampForFilename()}.json`, {
    kind: 'ai-dnd-tool-prompt-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    prompts
  });
  showToast(`${Object.keys(prompts).length} prompt settings exported`);
}

function exportablePromptSettings() {
  const source = { ...state.toolPrompts };
  const tool = selectedTool();
  if (tool && promptProfileForTool(tool).manageable) {
    const current = readPromptEditor();
    if (toolPromptHasContent(current)) {
      source[tool.id] = current;
    }
  }
  return Object.fromEntries(Object.entries(source)
    .map(([toolId, settings]) => [toolId, normalizeToolPromptSettings(settings)])
    .filter(([toolId]) => promptSettingsAllowedForToolId(toolId))
    .filter(([, settings]) => toolPromptHasContent(settings)));
}

async function importPromptSettingsFromFile() {
  const file = els.promptImportFileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = normalizePromptImport(parsed, selectedTool()?.id);
    if (Object.keys(imported).length === 0) {
      showToast('no prompt settings found');
      return;
    }
    state.toolPrompts = {
      ...state.toolPrompts,
      ...imported
    };
    saveToolPrompts();
    renderPromptPanel();
    updateButtons();
    showToast(`${Object.keys(imported).length} prompt settings imported`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    els.promptImportFileInput.value = '';
  }
}

async function loadLatestPromptSnapshot() {
  const tool = selectedTool();
  if (!tool) return;
  if (!promptProfileForTool(tool).manageable) {
    showToast(`${tool.id} has no LLM prompt/reference inputs`);
    return;
  }

  setBusy(true);
  try {
    const payload = await api(`/v1/debug/traces/latest?toolId=${encodeURIComponent(tool.id)}`);
    const trace = payload.trace;
    const files = collectDebugFiles(trace);
    const promptFiles = files.filter((file) => /prompt|reference|context|input|output/i.test(`${file.label} ${file.path}`));
    const fragments = [];

    for (const file of promptFiles.slice(0, 8)) {
      try {
        const read = await api('/v1/debug/files/read', {
          method: 'POST',
          body: { path: file.path }
        });
        fragments.push(...extractPromptFragments(read.file?.content || '', file.label));
      } catch {
        // Ignore unreadable trace files; the latest trace may have been cleaned up.
      }
    }

    const text = fragments.length > 0
      ? fragments.map((fragment) => `# ${fragment.label}\n${fragment.text}`).join('\n\n')
      : '';
    state.latestPromptText = text;
    state.latestPromptToolId = tool.id;
    els.toolPromptLatestPreview.textContent = text || 'No prompt/reference content found in latest trace.';
    showToast(text ? 'latest prompt loaded' : 'no prompt found');
  } catch (error) {
    els.toolPromptLatestPreview.textContent = pretty({ error: error.message || String(error) });
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function useLatestPromptAsOverride() {
  const tool = selectedTool();
  if (!tool) return;
  if (!promptProfileForTool(tool).manageable) {
    showToast(`${tool.id} has no LLM prompt/reference inputs`);
    return;
  }
  if (state.latestPromptToolId !== tool.id || !state.latestPromptText.trim()) {
    await loadLatestPromptSnapshot();
  }
  if (!state.latestPromptText.trim()) return;
  els.toolPromptEnabled.checked = true;
  els.toolPromptMode.value = 'replace';
  els.toolPromptReplacement.value = state.latestPromptText;
  saveSelectedPromptSettings();
}

function normalizePromptImport(input, fallbackToolId = '') {
  const raw = input && typeof input === 'object' ? input : {};
  const source = raw.prompts && typeof raw.prompts === 'object'
    ? raw.prompts
    : fallbackToolId
      ? { [fallbackToolId]: raw }
      : {};
  return Object.fromEntries(Object.entries(source)
    .filter(([toolId]) => typeof toolId === 'string' && toolId.trim())
    .filter(([toolId]) => promptSettingsAllowedForToolId(toolId))
    .map(([toolId, settings]) => [toolId, normalizeToolPromptSettings(settings)]));
}

function extractPromptFragments(content, label) {
  const text = String(content || '');
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    const fragments = [];
    collectPromptFragments(parsed, [label], fragments);
    return fragments;
  } catch {
    return /prompt|reference|context/i.test(label)
      ? [{ label, text }]
      : [];
  }
}

function collectPromptFragments(value, trail, fragments) {
  if (typeof value === 'string') {
    const key = trail[trail.length - 1] || '';
    if (/prompt|reference|context/i.test(key) && value.trim()) {
      fragments.push({
        label: trail.join(' / '),
        text: value
      });
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPromptFragments(item, [...trail, String(index)], fragments));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    collectPromptFragments(child, [...trail, key], fragments);
  }
}

function applyPromptSettingsToToolInput(input, tool) {
  const settings = promptSettingsForTool(tool?.id);
  const profile = promptProfileForTool(tool);
  if (!profile.manageable || !settings.enabled || !toolPromptHasContent(settings) || !isPlainRecord(input)) {
    return input;
  }

  const properties = schemaProperties(tool.inputSchema);
  const next = { ...input };
  const switchField = profile.useLlmFields.find((field) => field === 'useLlm') || profile.useLlmFields[0];
  if (switchField) {
    next[switchField] = true;
  }

  const promptField = profile.promptFields[0];
  if (promptField) {
    const promptValue = composePromptInputValue(next[promptField], settings, promptField);
    if (promptValue) next[promptField] = promptValue;
  }

  if (settings.references) {
    const referenceField = profile.referenceFields[0];
    if (referenceField) {
      next[referenceField] = mergeReferenceInputValue(next[referenceField], settings.references, properties[referenceField], referenceField);
    } else if ((profile.llm || switchField) && profile.contextFields.length > 0) {
      const contextField = profile.contextFields[0];
      next[contextField] = mergeReferenceIntoContext(next[contextField], settings.references, properties[contextField]);
    }
  }

  return next;
}

function composePromptInputValue(existing, settings, fieldName = '') {
  const current = typeof existing === 'string' ? existing.trim() : '';
  const lower = String(fieldName || '').toLowerCase();
  if ((lower === 'systemprompt' || lower === 'instruction' || lower === 'instructions') && settings.systemPrompt) {
    return settings.systemPrompt;
  }
  if (settings.mode === 'replace' && settings.replacementPrompt) return settings.replacementPrompt;
  if (settings.promptPrefix || settings.promptSuffix) {
    return [
      settings.promptPrefix,
      current,
      settings.promptSuffix
    ].filter(Boolean).join('\n\n');
  }
  return current;
}

function mergeReferenceInputValue(existing, referenceText, property, fieldName) {
  const document = {
    name: 'tool-manager-reference',
    text: referenceText,
    source: 'tool-manager'
  };
  if (Array.isArray(existing)) return [...existing, document];
  if (typeof existing === 'string' && existing.trim()) return `${existing.trim()}\n\n${referenceText}`;
  if (isPlainRecord(existing)) {
    return {
      ...existing,
      text: [existing.text || existing.content || '', referenceText].filter(Boolean).join('\n\n') || referenceText,
      source: existing.source || 'tool-manager'
    };
  }
  const lower = String(fieldName || '').toLowerCase();
  if (lower.includes('document') || lower.includes('docs') || lower.includes('files') || schemaPropertyAcceptsType(property, 'array')) {
    return [document];
  }
  return referenceText;
}

function mergeReferenceIntoContext(existing, referenceText, property) {
  if (isPlainRecord(existing) || schemaPropertyAcceptsType(property, 'object')) {
    return {
      ...(isPlainRecord(existing) ? existing : {}),
      managedReferences: referenceText
    };
  }
  if (typeof existing === 'string' && existing.trim()) {
    return `${existing.trim()}\n\n[Tool Manager References]\n${referenceText}`;
  }
  return `[Tool Manager References]\n${referenceText}`;
}

function buildExecutionContext(context, tool) {
  const next = {
    ...(context || {}),
    source: context?.source || 'tool-manager'
  };
  const api = resolveApiForTool(tool);
  if (api && !next.api && !next.apiSettings && !next.llmApi && !next.llm?.api) {
    next.api = api;
  }
  next.llm = {
    ...(next.llm || {}),
    target: toolUsesLlm(tool) ? tool.id : 'tool-calling',
    toolId: tool.id,
    targets: buildApiTargetContext()
  };
  const promptOverrides = buildToolPromptContext();
  if (Object.keys(promptOverrides).length > 0) {
    next.llm.promptOverrides = {
      ...promptOverrides,
      ...(next.llm.promptOverrides || {})
    };
    next.llmPromptOverrides = {
      ...promptOverrides,
      ...(next.llmPromptOverrides || {})
    };
  }
  const agentAccessPolicy = buildAgentAccessContext();
  next.agentAccessPolicy = next.agentAccessPolicy || agentAccessPolicy;
  next.agentAccess = {
    ...(next.agentAccess || {}),
    policy: next.agentAccess?.policy || agentAccessPolicy,
    source: next.agentAccess?.source || 'tool-manager'
  };
  return next;
}

function resolveApiForTool(tool) {
  if (!tool) return activeApiSettings('tool-calling');
  const toolSettings = activeApiSettings(tool.id);
  if (toolSettings) return toolSettings;
  return activeApiSettings('tool-calling');
}

function buildApiTargetContext() {
  const targets = {};
  for (const target of getApiTargets()) {
    const settings = activeApiSettings(target.id);
    if (settings) targets[target.id] = settings;
  }
  return targets;
}

function buildToolPromptContext() {
  return Object.fromEntries(Object.entries(state.toolPrompts)
    .map(([toolId, settings]) => [toolId, normalizeToolPromptSettings(settings)])
    .filter(([toolId]) => promptSettingsAllowedForToolId(toolId))
    .filter(([, settings]) => toolPromptHasContent(settings) && settings.enabled));
}

function buildAgentAccessContext() {
  return normalizeAgentAccessPolicy(state.agentAccessPolicy);
}

function setLatestAccessCallCountsFromResult(result, sourceLabel = 'latest loop') {
  state.latestAccessCallCounts = extractAccessCallCounts(result) || createEmptyAccessCallStats();
  state.latestAccessCallCountsSource = sourceLabel;
  renderAccessPanel();
}

function extractAccessCallCounts(result) {
  const canonicalCounts = collectCanonicalAccessCallCounts(result);
  if (canonicalCounts.length > 0) return aggregateAccessCallCounts(canonicalCounts);
  const fallbackCounts = collectFallbackAccessCallCounts(result);
  return fallbackCounts.length > 0 ? aggregateAccessCallCounts(fallbackCounts) : undefined;
}

function collectCanonicalAccessCallCounts(result) {
  const root = unwrapToolOutput(result);
  if (!isPlainRecord(root)) return [];

  if (Array.isArray(root.steps)) {
    const stepCounts = root.steps.flatMap((step) => collectTurnAccessCallCounts(step?.output));
    if (stepCounts.length > 0) return stepCounts;
  }

  const turnCounts = collectTurnAccessCallCounts(root);
  if (turnCounts.length > 0) return turnCounts;

  const direct = databaseCallCountsFromValue(root);
  return direct ? [direct] : [];
}

function collectTurnAccessCallCounts(turnOutput) {
  const turn = unwrapToolOutput(turnOutput);
  if (!isPlainRecord(turn)) return [];

  const contextCounts = databaseCallCountsFromValue(turn.contextCompleteness)
    || databaseCallCountsFromValue(turn.contextPlan)
    || databaseCallCountsFromValue(turn.contextPlan?.output);
  if (contextCounts) return [contextCounts];

  const contextPhase = Array.isArray(turn.phases)
    ? turn.phases.find((phase) => phase.phaseId === 'context.budget')
    : undefined;
  const phaseCounts = databaseCallCountsFromValue(contextPhase?.output?.output)
    || databaseCallCountsFromValue(contextPhase?.output);
  return phaseCounts ? [phaseCounts] : [];
}

function unwrapToolOutput(value) {
  if (!isPlainRecord(value)) return value;
  if (value.result && isPlainRecord(value.result)) return unwrapToolOutput(value.result);
  if (value.output && isPlainRecord(value.output) && !isAccessCallCounts(value)) return unwrapToolOutput(value.output);
  return value;
}

function databaseCallCountsFromValue(value) {
  if (!isPlainRecord(value)) return undefined;
  if (isAccessCallCounts(value.databaseCallCounts)) return value.databaseCallCounts;
  if (isAccessCallCounts(value.debug?.databaseCallCounts)) return value.debug.databaseCallCounts;
  if (isAccessCallCounts(value.output?.debug?.databaseCallCounts)) return value.output.debug.databaseCallCounts;
  return undefined;
}

function collectFallbackAccessCallCounts(root) {
  const counts = [];
  const seen = new WeakSet();
  const signatures = new Set();
  const visit = (value, trail = []) => {
    if (!isPlainRecord(value)) return;
    if (seen.has(value)) return;
    seen.add(value);

    const direct = databaseCallCountsFromValue(value);
    if (direct) {
      const signature = accessCallCountSignature(direct);
      if (!signatures.has(signature)) {
        signatures.add(signature);
        counts.push(direct);
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'trace' || key === 'contextEnvelope' || key === 'contextEnvelopes') continue;
      visit(child, [...trail, key]);
    }
  };
  visit(root, ['result']);
  return counts;
}

function accessCallCountSignature(counts) {
  return JSON.stringify({
    rawCallCount: counts.rawCallCount,
    byImportance: counts.byImportance,
    byTool: counts.byTool
  });
}

function isAccessCallCounts(value) {
  return isPlainRecord(value) && (
    Number.isFinite(Number(value.rawCallCount))
    || isPlainRecord(value.total)
    || isPlainRecord(value.byImportance)
    || isPlainRecord(value.byTool)
  );
}

function aggregateAccessCallCounts(sources) {
  const aggregate = createEmptyAccessCallStats();
  for (const source of sources) mergeAccessCallCounts(aggregate, source);
  return aggregate;
}

function createEmptyAccessCallStats() {
  return {
    rawCallCount: 0,
    total: createAccessCallCounter(),
    byImportance: Object.fromEntries(ACCESS_CALL_COUNT_LAYERS.map((layer) => [layer, createAccessCallCounter()])),
    byTool: {},
    sourceCount: 0
  };
}

function mergeAccessCallCounts(target, source) {
  if (!isAccessCallCounts(source)) return target;
  const rawCallCount = Number(source.rawCallCount);
  target.rawCallCount += Number.isFinite(rawCallCount)
    ? rawCallCount
    : normalizeAccessCallCounter(source.total).attempted;
  mergeAccessCallCounter(target.total, source.total);

  for (const [layer, counter] of Object.entries(source.byImportance || {})) {
    target.byImportance[layer] ||= createAccessCallCounter();
    mergeAccessCallCounter(target.byImportance[layer], counter);
  }

  for (const [toolId, counter] of Object.entries(source.byTool || {})) {
    target.byTool[toolId] ||= createAccessCallCounter();
    mergeAccessCallCounter(target.byTool[toolId], counter);
  }

  target.sourceCount += 1;
  return target;
}

function createAccessCallCounter() {
  return Object.fromEntries(ACCESS_CALL_COUNTER_KEYS.map((key) => [key, 0]));
}

function normalizeAccessCallCounter(input) {
  const counter = createAccessCallCounter();
  if (!isPlainRecord(input)) return counter;
  for (const key of ACCESS_CALL_COUNTER_KEYS) {
    const value = Number(input[key]);
    if (Number.isFinite(value) && value > 0) counter[key] = value;
  }
  if (counter.attempted === 0) {
    counter.attempted = counter.ok + counter.error + counter.missing + counter.pending;
  }
  return counter;
}

function mergeAccessCallCounter(target, input) {
  const counter = normalizeAccessCallCounter(input);
  for (const key of ACCESS_CALL_COUNTER_KEYS) {
    target[key] = (target[key] || 0) + counter[key];
  }
  return target;
}

function setDebugFilesFromResult(result) {
  state.debugFiles = collectDebugFiles(result);
  if (!state.debugFiles.some((file) => file.path === state.selectedDebugFilePath)) {
    state.selectedDebugFilePath = state.debugFiles[0]?.path || '';
  }
  renderDebugPanel();
  if (state.activeDetailTab === 'debug') {
    refreshDebugFile();
  }
}

async function loadLatestDebugTrace() {
  const tool = selectedTool();
  if (!tool) {
    showToast('select a tool first');
    return;
  }

  setBusy(true);
  try {
    const payload = await api(`/v1/debug/traces/latest?toolId=${encodeURIComponent(tool.id)}`);
    const trace = payload.trace;
    state.debugFiles = collectDebugFiles(trace);
    state.selectedDebugFilePath = state.debugFiles[0]?.path || '';
    renderDebugPanel();
    if (state.debugFiles.length > 0) {
      await refreshDebugFile();
      showToast(`loaded latest trace for ${tool.id}`);
    } else {
      els.debugFileMeta.textContent = `no trace files for ${tool.id}`;
      els.debugFilePreview.textContent = 'Run this tool once, or execute it from chat, then come back to Debug.';
      showToast('no trace files found');
    }
  } catch (error) {
    els.debugFileMeta.textContent = `${tool.id} · ${error.message || String(error)}`;
    els.debugFilePreview.textContent = pretty({ error: error.message || String(error) });
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function renderDebugPanel() {
  els.debugAutoRefreshInput.checked = state.debugAutoRefresh;
  els.debugFileSelect.innerHTML = '';
  if (state.debugFiles.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'no trace files';
    els.debugFileSelect.append(option);
    els.debugFileSelect.disabled = true;
    els.refreshDebugFileButton.disabled = true;
    els.debugFileMeta.textContent = selectedTool() ? 'no trace files for current tool' : 'no tool selected';
    els.debugFilePreview.textContent = 'Use Run to execute the selected tool and capture trace files, or Latest to load its most recent trace from disk.';
    updateDebugAutoRefresh();
    return;
  }

  els.debugFileSelect.disabled = false;
  els.refreshDebugFileButton.disabled = false;
  for (const file of state.debugFiles) {
    const option = document.createElement('option');
    option.value = file.path;
    option.textContent = file.label;
    els.debugFileSelect.append(option);
  }
  els.debugFileSelect.value = state.selectedDebugFilePath || state.debugFiles[0].path;
  state.selectedDebugFilePath = els.debugFileSelect.value;
  const selected = selectedDebugFile();
  els.debugFileMeta.textContent = selected ? selected.path : 'no trace files';
  updateDebugAutoRefresh();
}

async function refreshDebugFile() {
  const file = selectedDebugFile();
  if (!file) {
    els.debugFileMeta.textContent = selectedTool() ? 'no trace files for current tool' : 'no tool selected';
    els.debugFilePreview.textContent = 'Use Run to execute the selected tool and capture trace files, or Latest to load its most recent trace from disk.';
    return;
  }
  try {
    const payload = await api('/v1/debug/files/read', {
      method: 'POST',
      body: { path: file.path }
    });
    const debugFile = payload.file || {};
    els.debugFileMeta.textContent = [
      file.label,
      `${debugFile.size ?? 0} bytes`,
      debugFile.modifiedAt || '',
      debugFile.truncated ? 'truncated' : ''
    ].filter(Boolean).join(' · ');
    els.debugFilePreview.textContent = debugFile.content || '';
  } catch (error) {
    els.debugFileMeta.textContent = `${file.label} · ${error.message || String(error)}`;
    els.debugFilePreview.textContent = pretty({ error: error.message || String(error), path: file.path });
  }
}

function updateDebugAutoRefresh() {
  if (debugRefreshTimer) {
    clearInterval(debugRefreshTimer);
    debugRefreshTimer = undefined;
  }
  if (state.debugAutoRefresh && state.activeDetailTab === 'debug' && state.selectedDebugFilePath) {
    debugRefreshTimer = setInterval(refreshDebugFile, 1500);
  }
}

function selectedDebugFile() {
  return state.debugFiles.find((file) => file.path === state.selectedDebugFilePath) || state.debugFiles[0];
}

function collectDebugFiles(root) {
  const files = new Map();
  const seen = new WeakSet();
  const visit = (value, trail = []) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (value.files && typeof value.files === 'object') {
      for (const [name, filePath] of Object.entries(value.files)) {
        if (typeof filePath !== 'string' || !looksLikeTracePath(filePath)) continue;
        const label = [...trail.slice(-2), name].filter(Boolean).join(' / ') || name;
        if (!files.has(filePath)) {
          files.set(filePath, { name, label, path: filePath });
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'files') continue;
      visit(child, [...trail, key]);
    }
  };
  visit(root, ['result']);
  return [...files.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function looksLikeTracePath(value) {
  return /[\\/]/.test(value) && /\.(json|txt|md|yaml|yml|xml|log)$/i.test(value);
}

async function copySchema() {
  try {
    await navigator.clipboard.writeText(els.schemaPreview.textContent || '');
    showToast('schema copied');
  } catch {
    showToast('clipboard unavailable');
  }
}

function activateDetailTab(tab) {
  const nextTab = ['detail', 'schema', 'execute', 'loop', 'prompt', 'debug', 'access', 'assets', 'api'].includes(tab) ? tab : 'detail';
  state.activeDetailTab = nextTab;
  if (els.detailViewSelect) {
    els.detailViewSelect.value = nextTab;
  }
  for (const button of document.querySelectorAll('.detail-tab')) {
    button.classList.toggle('active', button.dataset.detailTab === nextTab);
  }
  for (const panel of document.querySelectorAll('.detail-panel')) {
    panel.classList.toggle('active', panel.id === `${nextTab}Panel`);
  }
  saveSelection();
  updateDebugAutoRefresh();
  if (nextTab === 'debug') {
    refreshDebugFile();
  }
  if (nextTab === 'assets' && visualAssetManagerAvailable() && state.visualAssets.length === 0 && state.visualBindings.length === 0) {
    refreshVisualAssetData({ silent: true });
  }
}

function updateButtons() {
  const hasPlugin = Boolean(state.selectedPluginId);
  const tool = selectedTool();
  const hasTool = Boolean(tool);
  const promptManageable = hasTool && promptProfileForTool(tool).manageable;
  const batchToolCount = toolsForBatchScope().length;
  els.movePluginUpButton.disabled = state.busy || !hasPlugin || state.pluginOrder.indexOf(state.selectedPluginId) <= 0;
  els.movePluginDownButton.disabled = state.busy || !hasPlugin || state.pluginOrder.indexOf(state.selectedPluginId) >= state.pluginOrder.length - 1;
  els.executeToolButton.disabled = state.busy || !hasTool || tool?.enabled === false;
  els.runDebugToolButton.disabled = state.busy || !hasTool || tool?.enabled === false;
  els.loadLatestTraceButton.disabled = state.busy || !hasTool;
  els.loadLatestPromptButton.disabled = state.busy || !promptManageable;
  els.useLatestPromptButton.disabled = state.busy || !promptManageable;
  els.importPromptButton.disabled = state.busy;
  els.exportPromptButton.disabled = state.busy || !promptManageable;
  els.exportAllPromptsButton.disabled = state.busy || Object.keys(exportablePromptSettings()).length === 0;
  els.resetPromptButton.disabled = state.busy || !promptManageable;
  els.savePromptButton.disabled = state.busy || !promptManageable;
  els.importToolsButton.disabled = state.busy;
  els.exportToolsButton.disabled = state.busy || batchToolCount === 0;
  els.deleteToolsButton.disabled = state.busy || batchToolCount === 0;
  if (els.assetManagerSummary) {
    setAssetControlsDisabled(!visualAssetManagerAvailable() || state.busy);
  }
  updateLoopControlButtons();
}

function updateLoopControlButtons() {
  const available = loopManagerAvailable();
  for (const element of [
    els.refreshLoopConfigsButton,
    els.refreshLoopPreviewButton,
    els.newLoopConfigButton,
    els.importLoopConfigButton,
    els.exportLoopConfigButton,
    els.exportLoopPreviewButton,
    els.loopConfigSelect,
    els.loadLoopConfigButton,
    els.saveLoopConfigButton,
    els.switchLoopConfigButton,
    els.archiveLoopConfigButton,
    els.deleteLoopConfigButton,
    els.loopRouterPolicyJson,
    els.loadLoopRouterPolicyButton,
    els.applyLoopRouterPolicyButton,
    els.resetLoopRouterPolicyButton,
    els.loopConfigJson,
    els.loopRunInputJson,
    els.dryRunLoopConfigButton
  ]) {
    if (element) element.disabled = !available || state.busy;
  }
  if (els.refreshLoopPreviewButton) {
    els.refreshLoopPreviewButton.disabled = !available || !loopPreviewAvailable() || state.busy;
  }
  if (els.exportLoopPreviewButton) {
    els.exportLoopPreviewButton.disabled = !available || !state.loopPreview || state.busy;
  }
}

function setBusy(busy) {
  state.busy = busy;
  updateButtons();
}

function setConnection(text) {
  els.connectionStatus.textContent = text;
}

function selectedPlugin() {
  return pluginById(state.selectedPluginId);
}

function selectedTool() {
  return state.tools.find((tool) => tool.id === state.selectedToolId);
}

function pluginById(pluginId) {
  return state.plugins.find((plugin) => plugin.id === pluginId);
}

function toolsForPlugin(pluginId) {
  return state.tools.filter((tool) => tool.pluginId === pluginId);
}

function rawToolFor(tool) {
  const plugin = pluginById(tool.pluginId);
  return plugin?.tools?.find((candidate) => candidate.name === tool.name);
}

function orderedPlugins() {
  const byId = new Map(state.plugins.map((plugin) => [plugin.id, plugin]));
  return state.pluginOrder
    .map((id) => byId.get(id))
    .filter(Boolean);
}

function dependenciesFor(plugin) {
  const fromMap = BUILTIN_DEPENDENCIES[plugin.id] || [];
  const metadata = plugin.metadata || {};
  const fromMetadata = [
    ...(Array.isArray(metadata.reuses) ? metadata.reuses : []),
    metadata.diceTool ? pluginIdFromToolId(metadata.diceTool) : undefined
  ].filter(Boolean);
  return [...new Set([...fromMap, ...fromMetadata])]
    .filter((id) => id && id !== plugin.id)
    .sort((a, b) => a.localeCompare(b));
}

function dependencyStatus(pluginId) {
  const plugin = pluginById(pluginId);
  if (!plugin) return { label: '' };
  const deps = dependenciesFor(plugin);
  if (deps.length === 0) return { label: 'base' };
  const missing = deps.filter((id) => !pluginById(id));
  if (missing.length > 0) return { label: 'missing deps' };
  const disabled = deps.filter((id) => pluginById(id)?.enabled === false);
  if (disabled.length > 0) return { label: 'deps off' };
  return { label: `${deps.length} deps` };
}

function dependencyGroup(title, ids) {
  const group = document.createElement('div');
  group.className = 'dependency-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const list = document.createElement('div');
  list.className = 'dependency-list';
  if (ids.length === 0) {
    list.append(badge('none'));
  } else {
    for (const id of ids) {
      const plugin = pluginById(id);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `dependency-chip${!plugin ? ' missing' : ''}${plugin?.enabled === false ? ' disabled' : ''}`;
      chip.textContent = id;
      chip.disabled = !plugin;
      chip.addEventListener('click', () => selectPlugin(id));
      list.append(chip);
    }
  }
  group.append(heading, list);
  return group;
}

function exampleInputFor(schema, explicit) {
  if (explicit !== undefined) return explicit;
  if (!schema || schema.type !== 'object') return {};
  const output = {};
  const properties = schema.properties || {};
  for (const name of schema.required || []) {
    output[name] = exampleValue(properties[name]);
  }
  for (const [name, property] of Object.entries(properties)) {
    if (property && Object.hasOwn(property, 'default') && !Object.hasOwn(output, name)) {
      output[name] = property.default;
    }
  }
  return output;
}

function exampleValue(schema = {}) {
  if (Object.hasOwn(schema, 'default')) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return exampleValue(schema.anyOf[0]);
  if (schema.type === 'string') {
    const minLength = Number.isFinite(schema.minLength) ? schema.minLength : 0;
    return minLength > 0 ? 'example'.padEnd(minLength, 'x') : '';
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    if (Number.isFinite(schema.minimum)) return schema.minimum;
    if (Number.isFinite(schema.exclusiveMinimum)) return schema.exclusiveMinimum + 1;
    return 0;
  }
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') {
    const count = Number.isFinite(schema.minItems) ? schema.minItems : 0;
    return Array.from({ length: count }, () => exampleValue(schema.items || {}));
  }
  if (schema.type === 'object') return exampleInputFor(schema);
  return null;
}

function schemaTypeLabel(schema = {}) {
  if (schema.enum?.length) return `enum(${schema.enum.map(String).join(' | ')})`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (schema.type) return schema.type;
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key]) && schema[key].length > 0) {
      const types = [...new Set(schema[key].map(schemaTypeLabel).filter(Boolean))];
      return types.length > 0 ? types.join(' | ') : key;
    }
  }
  if (schema.properties) return 'object';
  return 'any';
}

function fieldMeaningFor(name, property = {}, direction = 'input') {
  if (property.description) return String(property.description);
  const lower = String(name || '').toLowerCase();
  const meanings = {
    chatsessionid: 'Chat session scope used to read or write chat-local state.',
    sceneid: 'Scene scope or current scene selector.',
    npcid: 'NPC record identifier.',
    mapid: 'Map record identifier.',
    id: direction === 'input' ? 'Record or entity identifier.' : 'Identifier returned for the created or selected record.',
    query: 'Search or planning query text.',
    text: 'Source text the tool parses, stores, or transforms.',
    content: 'Message or document content.',
    context: 'Structured or free-form scene context used by the tool.',
    contexttext: 'Free-form context text used when building an LLM prompt or plan.',
    recentcontext: 'Recent context text supplied as prompt material.',
    usellm: 'Enable the tool branch that calls an LLM through chatProvider.',
    preferllm: 'Prefer LLM quantification when a provider is available.',
    requirellm: 'Fail instead of using deterministic fallback when no LLM is available.',
    prompt: 'Prompt text consumed or emitted by this tool.',
    prompttext: 'Prompt text consumed or emitted by this tool.',
    progresslabel: 'User-facing progress text shown while this phase or tool call is running.',
    phaseprogresslabels: 'Map of phase id to user-facing progress text for a loop flow or step.',
    progresslabels: 'Alias for phaseProgressLabels.',
    executionmodel: 'Loop step execution mode: profile uses a saved profile; profile-modules applies the editable module list to that profile.',
    replaceprofilephases: 'When modules are present, replace the selected profile phase list instead of only patching matching phases.',
    modules: 'Ordered existing phase modules for a loop step. Edits here change phase order, phase config, prompts, and tool calls.',
    modulesequence: 'Compact readable order of modules inside a loop step.',
    toolcallsequence: 'Readable order of configured tool calls under loop modules.',
    toolcalls: 'Existing tools called by a phase/module after its handler runs.',
    toolid: 'Fully qualified existing tool id to call.',
    executeindryrun: 'Allow this non-mutating tool call to execute during dry-run instead of staying planned only.',
    plannerprompt: 'Override prompt text used by the planner LLM call.',
    systemprompt: 'System-level instruction passed to an LLM prompt.',
    plantemplate: 'Structured plan shape or template the LLM should fill.',
    templateid: 'Named template selector.',
    referencetext: 'Reference material text used by LLM or quantification logic.',
    referencetexts: 'Reference text snippets used by LLM or quantification logic.',
    referencedocuments: 'Reference document list used by LLM or quantification logic.',
    referencedocs: 'Reference document list used by LLM or quantification logic.',
    referencefiles: 'Reference file/document inputs used as supporting material.',
    referencefilepaths: 'Reference file path inputs. Local path reading requires explicit authorization.',
    quantificationdefinition: 'Field definitions, scoring rules, prompts, and references used to convert fuzzy text into structured values.',
    numericdefinition: 'Numeric field definitions and scoring rules used to quantify fuzzy text.',
    definition: 'Tool-specific schema, rule, or quantification definition used to interpret the request.',
    allowreferencefilepaths: 'Allows reading local reference paths when authorization is present.',
    dryrun: 'Validate or preview the operation without committing state.',
    limit: 'Maximum number of records or hits returned.',
    maxcontexttokens: 'Token budget for selected context sections.',
    minscore: 'Minimum retrieval or ranking score.',
    temperature: 'LLM sampling temperature for this tool call.',
    maxtokens: 'Maximum LLM completion tokens for this tool call.',
    output: direction === 'output' ? 'Tool-specific result payload.' : 'Expected output override or sample.',
    metadata: 'Additional machine-readable details for callers and debugging.'
  };
  return meanings[lower] || humanizeFieldName(name, direction);
}

function humanizeFieldName(name, direction) {
  const words = String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return direction === 'output'
    ? `Returned ${words || 'value'}.`
    : `Input ${words || 'value'} used by the tool.`;
}

function pluginIdFromToolId(toolId) {
  const text = String(toolId || '');
  const index = text.lastIndexOf('.');
  return index > 0 ? text.slice(0, index) : text;
}

function switchControl(checked, onChange) {
  const label = document.createElement('label');
  label.className = 'switch';
  label.addEventListener('click', (event) => event.stopPropagation());
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  label.append(input, span);
  return label;
}

function flag(text, tone = '') {
  const element = document.createElement('span');
  element.className = `flag ${tone}`.trim();
  element.textContent = text;
  return element;
}

function badge(text, tone = '') {
  const element = document.createElement('span');
  element.className = `badge ${tone}`.trim();
  element.textContent = text;
  return element;
}

function statPill(label, value) {
  const element = document.createElement('span');
  element.className = 'stat-pill';
  const strong = document.createElement('strong');
  strong.textContent = value;
  const span = document.createElement('span');
  span.textContent = label;
  element.append(strong, span);
  return element;
}

function emptyState(text) {
  const element = document.createElement('div');
  element.className = 'empty-state';
  element.textContent = text;
  return element;
}

function parseJsonEditor(text, label) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function apiSettingsForTarget(targetId) {
  return normalizeApiSettings(state.apiTargets[targetId] || DEFAULT_API_SETTINGS);
}

function activeApiSettings(targetId) {
  const settings = apiSettingsForTarget(targetId);
  return settings.provider === 'server' ? undefined : settings;
}

function apiSettingsLabel(settings) {
  if (!settings || settings.provider === 'server') return 'server';
  return [
    settings.provider,
    settings.model
  ].filter(Boolean).join(' / ');
}

function normalizeApiSettings(input = {}) {
  const provider = String(input.provider || DEFAULT_API_SETTINGS.provider).trim();
  return {
    provider,
    baseUrl: String(input.baseUrl || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    model: String(input.model || '').trim(),
    temperature: String(input.temperature ?? '').trim(),
    maxTokens: String(input.maxTokens ?? '').trim()
  };
}

function promptSettingsForTool(toolId) {
  return normalizeToolPromptSettings(state.toolPrompts[toolId] || DEFAULT_TOOL_PROMPT_SETTINGS);
}

function normalizeToolPromptSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const mode = raw.mode === 'replace' ? 'replace' : 'inject';
  return {
    enabled: raw.enabled === true,
    mode,
    replacementPrompt: String(raw.replacementPrompt || raw.replacement || raw.prompt || '').trim(),
    systemPrompt: String(raw.systemPrompt || raw.system || '').trim(),
    promptPrefix: String(raw.promptPrefix || raw.prefix || '').trim(),
    promptSuffix: String(raw.promptSuffix || raw.suffix || '').trim(),
    references: String(raw.references || raw.referenceMaterial || raw.reference || '').trim()
  };
}

function toolPromptHasContent(settings = {}) {
  return Boolean(
    settings.replacementPrompt ||
    settings.systemPrompt ||
    settings.promptPrefix ||
    settings.promptSuffix ||
    settings.references
  );
}

function promptSettingsAllowedForToolId(toolId) {
  const tool = state.tools.find((candidate) => candidate.id === toolId);
  return !tool || promptProfileForTool(tool).manageable;
}

function loadToolPrompts() {
  try {
    const parsed = JSON.parse(storageGet(TOOL_PROMPT_SETTINGS_KEY) || '{}');
    const rawPrompts = parsed.prompts && typeof parsed.prompts === 'object'
      ? parsed.prompts
      : parsed;
    return Object.fromEntries(Object.entries(rawPrompts || {})
      .filter(([toolId]) => typeof toolId === 'string')
      .map(([toolId, settings]) => [toolId, normalizeToolPromptSettings(settings)]));
  } catch {
    return {};
  }
}

function saveToolPrompts() {
  state.toolPrompts = Object.fromEntries(Object.entries(state.toolPrompts)
    .map(([toolId, settings]) => [toolId, normalizeToolPromptSettings(settings)])
    .filter(([toolId]) => promptSettingsAllowedForToolId(toolId))
    .filter(([, settings]) => toolPromptHasContent(settings)));
  storageSet(TOOL_PROMPT_SETTINGS_KEY, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    prompts: state.toolPrompts
  }));
}

function loadApiTargets() {
  try {
    const parsed = JSON.parse(storageGet(API_TARGET_SETTINGS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const rawTargets = parsed.targets && typeof parsed.targets === 'object'
      ? parsed.targets
      : parsed;
    return Object.fromEntries(Object.entries(rawTargets)
      .filter(([targetId]) => typeof targetId === 'string')
      .map(([targetId, settings]) => [targetId, normalizeApiSettings(settings)]));
  } catch {
    return {};
  }
}

function saveApiTargets() {
  storageSet(API_TARGET_SETTINGS_KEY, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    targets: state.apiTargets
  }));
}

function redactApiTargets(targets = {}) {
  return Object.fromEntries(Object.entries(targets).map(([targetId, settings]) => [
    targetId,
    {
      ...settings,
      apiKey: settings?.apiKey ? '[redacted]' : ''
    }
  ]));
}

function normalizeAgentAccessPolicy(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const rawTools = raw.tools && typeof raw.tools === 'object' ? raw.tools : {};
  const normalizeResource = (resource) => ({
    read: raw[resource]?.read !== false,
    write: raw[resource]?.write !== false
  });
  const normalizeSpecificResource = (resource, fallbackResource) => ({
    read: raw[resource]?.read ?? raw[fallbackResource]?.read ?? true,
    write: raw[resource]?.write ?? raw[fallbackResource]?.write ?? true
  });
  return {
    version: 1,
    database: normalizeResource('database'),
    databaseL1: normalizeSpecificResource('databaseL1', 'database'),
    databaseL2: normalizeSpecificResource('databaseL2', 'database'),
    databaseL3: normalizeSpecificResource('databaseL3', 'database'),
    rag: normalizeResource('rag'),
    permanentRag: normalizeSpecificResource('permanentRag', 'rag'),
    runtimeRag: normalizeSpecificResource('runtimeRag', 'rag'),
    tools: Object.fromEntries(Object.entries(rawTools)
      .filter(([toolId, mode]) => typeof toolId === 'string' && ['allowed', 'blocked'].includes(mode)))
  };
}

function loadAgentAccessPolicy() {
  try {
    const parsed = JSON.parse(storageGet(AGENT_ACCESS_POLICY_KEY) || '{}');
    return normalizeAgentAccessPolicy(parsed);
  } catch {
    return normalizeAgentAccessPolicy();
  }
}

function saveAgentAccessPolicy() {
  state.agentAccessPolicy = normalizeAgentAccessPolicy(state.agentAccessPolicy);
  storageSet(AGENT_ACCESS_POLICY_KEY, JSON.stringify({
    ...state.agentAccessPolicy,
    updatedAt: new Date().toISOString()
  }));
}

function api(path, { method = 'GET', body } = {}) {
  return fetch(apiUrl(path), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (response) => {
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(payload.error?.message || `HTTP ${response.status}`);
    }
    return payload;
  });
}

function apiUrl(path) {
  const text = String(path || '');
  if (!BACKEND_API_BASE || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  return `${BACKEND_API_BASE}${text.startsWith('/') ? text : `/${text}`}`;
}

function frontendUrl(path, hash = '') {
  const text = String(path || '/');
  try {
    const url = new URL(text, window.location.href);
    if (BACKEND_API_BASE) url.searchParams.set('apiBase', BACKEND_API_BASE);
    if (hash) url.hash = hash.startsWith('#') ? hash : `#${hash}`;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const [base, rawHash = ''] = text.split('#');
    const query = BACKEND_API_BASE ? `${base.includes('?') ? '&' : '?'}apiBase=${encodeURIComponent(BACKEND_API_BASE)}` : '';
    const nextHash = hash || (rawHash ? `#${rawHash}` : '');
    return `${base}${query}${nextHash}`;
  }
}

function syncNavigationLinks() {
  if (els.openChatLink) els.openChatLink.href = frontendUrl('/app/');
}

function resolveBackendApiBase() {
  const queryValue = readBackendApiBaseFromQuery();
  const storedValue = safeStorageGet(BACKEND_API_BASE_KEY);
  const globalValue = window.AI_DND_BACKEND_API_BASE || window.AI_DND_API_BASE || '';
  const normalized = normalizeBackendApiBase(queryValue || globalValue || storedValue);
  if (queryValue !== undefined) {
    if (normalized) safeStorageSet(BACKEND_API_BASE_KEY, normalized);
    else safeStorageRemove(BACKEND_API_BASE_KEY);
  }
  return normalized;
}

function readBackendApiBaseFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('apiBase')) return params.get('apiBase') || '';
    if (params.has('backend')) return params.get('backend') || '';
    if (params.has('backendUrl')) return params.get('backendUrl') || '';
  } catch {
    // Ignore malformed query strings.
  }
  return undefined;
}

function normalizeBackendApiBase(value) {
  const text = String(value || '').trim();
  if (!text || text === '.' || text.toLowerCase() === 'same-origin') return '';
  try {
    const url = new URL(text, window.location.href);
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return text.replace(/\/+$/, '');
  }
}

function safeStorageGet(key) {
  return storageGet(key) || '';
}

function safeStorageSet(key, value) {
  storageSet(key, value);
}

function safeStorageRemove(key) {
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.removeItem(key);
      return;
    }
  } catch {
    // Fall back to in-memory storage for restricted preview environments.
  }
  fallbackStorage.delete(key);
}

function loadOrder() {
  try {
    const parsed = JSON.parse(storageGet(ORDER_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveOrder() {
  storageSet(ORDER_KEY, JSON.stringify(state.pluginOrder));
}

function restoreSelection() {
  try {
    const stored = JSON.parse(storageGet(SELECTION_KEY) || '{}');
    state.selectedPluginId = stored.selectedPluginId || '';
    state.selectedToolId = stored.selectedToolId || '';
    state.toolScope = stored.toolScope || 'selected';
    state.toolBatchScope = stored.toolBatchScope || 'selected';
    state.visibility = stored.visibility || 'all';
    state.enabledFilter = stored.enabledFilter || 'all';
    state.selectedApiTargetId = stored.selectedApiTargetId || 'chat';
    state.activeDetailTab = stored.activeDetailTab || 'detail';
    els.toolScopeSelect.value = state.toolScope;
    els.toolBatchScopeSelect.value = state.toolBatchScope;
    els.visibilitySelect.value = state.visibility;
    els.enabledSelect.value = state.enabledFilter;
    els.detailViewSelect.value = state.activeDetailTab;
  } catch {
    state.selectedPluginId = '';
    state.selectedToolId = '';
    state.selectedApiTargetId = 'chat';
    state.activeDetailTab = 'detail';
    state.toolBatchScope = 'selected';
  }
}

function applyRouteHash() {
  const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  const aliases = {
    loop: 'loop',
    loops: 'loop',
    'agent-loop': 'loop',
    api: 'api',
    access: 'access',
    assets: 'assets',
    visual: 'assets',
    visuals: 'assets',
    prompt: 'prompt',
    debug: 'debug'
  };
  if (aliases[hash]) {
    state.activeDetailTab = aliases[hash];
    els.detailViewSelect.value = state.activeDetailTab;
  }
}

function saveSelection() {
  storageSet(SELECTION_KEY, JSON.stringify({
    selectedPluginId: state.selectedPluginId,
    selectedToolId: state.selectedToolId,
    toolScope: state.toolScope,
    toolBatchScope: state.toolBatchScope,
    visibility: state.visibility,
    enabledFilter: state.enabledFilter,
    selectedApiTargetId: state.selectedApiTargetId,
    activeDetailTab: state.activeDetailTab
  }));
}

function storageGet(key) {
  try {
    if (globalThis.localStorage) {
      return globalThis.localStorage.getItem(key);
    }
  } catch {
    // Fall back to in-memory storage for restricted preview environments.
  }
  return fallbackStorage.has(key) ? fallbackStorage.get(key) : null;
}

function storageSet(key, value) {
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Fall back to in-memory storage for restricted preview environments.
  }
  fallbackStorage.set(key, value);
}

function downloadJson(filename, payload) {
  const blob = new Blob([pretty(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('visible');
  }, 3200);
}
