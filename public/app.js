const API_SETTINGS_KEY = 'ai-dnd-api-settings';
const BACKEND_API_BASE_KEY = 'ai-dnd-backend-api-base-v1';
const SYSTEM_PROMPT_SETTINGS_KEY = 'ai-dnd-system-prompt-settings';
const API_TARGET_SETTINGS_KEY = 'ai-dnd-api-target-settings';
const AGENT_ACCESS_POLICY_KEY = 'ai-dnd-agent-access-policy';
const TOOL_PROMPT_SETTINGS_KEY = 'ai-dnd-tool-prompt-settings';
const PLAYER_DB_QUERY_CONTROL_KEY = 'ai-dnd-player-db-query-control-v1';
const INITIAL_SETTING_EDITOR_POSITION_KEY = 'ai-dnd-initial-setting-editor-position';
const CHARACTER_DRAWER_EXPANDED_KEY = 'ai-dnd-character-drawer-expanded-v2';
const CHAT_DRAWER_EXPANDED_KEY = 'ai-dnd-chat-drawer-expanded-v2';
const WORLD_DRAWER_EXPANDED_KEY = 'ai-dnd-world-drawer-expanded-v1';
const WORLD_DRAWER_TAB_KEY = 'ai-dnd-world-drawer-tab-v1';
const SCENE_VISUAL_COLLAPSED_KEY = 'ai-dnd-scene-visual-collapsed-v1';
const SCENE_VISUAL_TOGGLE_ID = 'sceneVisualToggleButton';
const COMBAT_DEBUG_WIN_KEY = 'ai-dnd-combat-debug-win-visible-v1';
const COMBAT_ACTION_COOLDOWN_MS = 1400;
const INITIAL_SETTING_FIELD_TYPES = Object.freeze(['text', 'integer', 'number', 'boolean', 'json']);
const DEFAULT_API_SETTINGS = Object.freeze({
  provider: 'server',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: '',
  maxTokens: ''
});
const DEFAULT_SYSTEM_PROMPT_SETTINGS = Object.freeze({
  mainPrompt: ''
});
const BACKEND_API_BASE = resolveBackendApiBase();

const PLAYER_ACTIONS = Object.freeze({
  inventory: {
    title: '背包',
    subtitle: '读取当前聊天数据库里的玩家背包。',
    mark: '包'
  },
  status: {
    title: '状态栏',
    subtitle: '读取当前聊天数据库里的玩家状态栏。',
    mark: '态'
  },
  skills: {
    title: '技能',
    subtitle: '读取玩家技能栏，并允许直接使用或遗忘。',
    mark: '技'
  },
  map: {
    title: '地图',
    subtitle: '读取全局地图关系图，并合并当前聊天场景里的移动关系。',
    mark: '图'
  },
  npcGraph: {
    title: 'NPC关系图',
    subtitle: '读取全局 NPC 关系图，显示人物之间的关系链。',
    mark: '人'
  },
  factionGraph: {
    title: '阵营图',
    subtitle: '读取全局阵营图，显示阵营关系和角色隶属。',
    mark: '营'
  }
});

const PLAYER_ACTION_COLLECTIONS = Object.freeze({
  inventory: ['npc_structured_states'],
  status: ['npc_structured_states'],
  skills: ['npc_structured_states'],
  map: ['scene_map_mounts', 'map_structured_states', 'scene_records']
});

const PLAYER_ACTION_TECHNICAL_FIELDS = Object.freeze(new Set([
  'chatSessionId',
  'source',
  'stateUpdatedAt',
  'metadata',
  'lifecycleScope',
  'lifecycleLevel',
  'lifecycleClonePolicy',
  'lifecycleManaged',
  'lifecycleInherited',
  'lifecycleRegisteredAt',
  'createdAt',
  'updatedAt'
]));

const GRAPH_ACTION_PREFIX = 'graph-source:';
const RELATIONSHIP_SOURCE_LIMIT = 500;
const WORLD_DRAWER_COLLECTION_LIMIT = 12;
const WORLD_DRAWER_RECORD_LIMIT = 60;
const COMBAT_TERMINAL_STATUSES = new Set(['won', 'lost', 'fled', 'ended', 'archived']);
const SCENE_VISUAL_REFRESH_DELAY_MS = 280;
const SCENE_VISUAL_IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const SCENE_NPC_VISUAL_SLOTS = Object.freeze(['portrait', 'avatar', 'cg', 'sprite', 'token', 'image']);
const SCENE_MAP_VISUAL_SLOTS = Object.freeze(['background', 'cg', 'image']);
const BUILTIN_RELATIONSHIP_SOURCES = Object.freeze({
  'system.npc_relationships': { action: 'npcGraph', kind: 'npc', title: 'NPC关系图', mark: '人' },
  'system.map_relationships': { action: 'map', kind: 'map', title: '地图', mark: '图' },
  'system.factions': { action: 'factionGraph', kind: 'faction', title: '阵营图', mark: '营' }
});

const API_PROVIDER_CONFIG = Object.freeze({
  server: {
    label: '服务端配置',
    baseUrl: '',
    modelPlaceholder: ''
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: 'gpt-4.1-mini'
  },
  'openai-compatible': {
    label: 'Custom OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: 'model-name'
  },
  'llama.cpp': {
    label: 'llama.cpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    modelPlaceholder: 'local-model'
  },
  vllm: {
    label: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    modelPlaceholder: 'served-model-name'
  },
  tabbyapi: {
    label: 'TabbyAPI',
    baseUrl: 'http://127.0.0.1:5000/v1',
    modelPlaceholder: 'tabby-model'
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434',
    modelPlaceholder: 'llama3.2'
  },
  'lm-studio': {
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelPlaceholder: 'local-model'
  },
  koboldcpp: {
    label: 'KoboldCpp',
    baseUrl: 'http://127.0.0.1:5001/v1',
    modelPlaceholder: 'local-model'
  },
  mock: {
    label: 'Mock',
    baseUrl: '',
    modelPlaceholder: ''
  }
});

const state = {
  characters: [],
  chats: [],
  activeChatId: localStorage.getItem('ai-dnd-active-chat') || '',
  activeChat: undefined,
  messageEdit: emptyMessageEditState(),
  tools: [],
  characterDetails: {},
  characterEditor: {
    characterId: '',
    card: undefined
  },
  avatarCrop: emptyAvatarCropState(),
  busy: false,
  inspectorCollapsed: localStorage.getItem('ai-dnd-inspector-collapsed') !== 'false',
  sidebarCollapsed: localStorage.getItem('ai-dnd-sidebar-collapsed') !== 'false',
  settingsExpanded: localStorage.getItem('ai-dnd-settings-expanded') === 'true',
  characterDrawerExpanded: localStorage.getItem(CHARACTER_DRAWER_EXPANDED_KEY) === 'true',
  chatDrawerExpanded: localStorage.getItem(CHAT_DRAWER_EXPANDED_KEY) === 'true',
  worldDrawerExpanded: localStorage.getItem(WORLD_DRAWER_EXPANDED_KEY) === 'true',
  worldDrawer: emptyWorldDrawerState(),
  sceneVisual: emptySceneVisualState(),
  combatOverlay: emptyCombatOverlayState(),
  persuasionOverlay: emptyPersuasionOverlayState(),
  debugPanel: {
    loading: false,
    status: '选择一个调试动作。',
    statusKind: '',
    showCombatWinButton: localStorage.getItem(COMBAT_DEBUG_WIN_KEY) === 'true'
  },
  chatRename: emptyChatRenameState(),
  npcSettingOnboarding: emptyNpcSettingOnboardingState(),
  playerActionMenuOpen: false,
  playerActionViewer: {
    action: '',
    loading: false,
    data: undefined,
    error: '',
    slotIndex: new Map(),
    slotBusyKey: ''
  },
  relationshipSources: [],
  relationshipDiscovery: {
    loading: false,
    error: '',
    collectionMap: new Map()
  },
  playerDbQueryControl: loadPlayerDbQueryControl(),
  playerDbQueryController: {
    loading: false,
    error: '',
    draft: undefined,
    collectionMap: new Map()
  },
  agentProgress: emptyAgentProgressState(),
  routerReview: emptyRouterReviewState(),
  settlementNotices: emptySettlementNoticeState(),
  adjudicationOverlay: emptyAdjudicationOverlayState(),
  diceRollOverlay: emptyDiceRollOverlayState(),
  loopHotSwitch: emptyLoopHotSwitchState(),
  apiSettings: loadApiSettings(),
  systemPrompt: loadSystemPromptSettings(),
  initialSetting: {
    open: false,
    characterId: '',
    draft: emptyInitialSetting(),
    payload: undefined,
    activeCollectionIndex: 0,
    position: loadInitialSettingEditorPosition(),
    drag: undefined
  }
};

const SAMPLE_CHARACTER = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mira',
    description: 'A concise fantasy game master who tracks consequences and asks for player intent.',
    personality: 'Direct, atmospheric, fair, and rules-aware.',
    scenario: 'The player is exploring a city full of old debts, hidden factions, and strange ruins.',
    first_mes: '雨停了。旧市场的石板路反着微光，钟楼方向传来一声短促的金属碰撞。你要做什么？'
  }
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  bindElements();
  installSceneVisualDebugApi();
  bindEvents();
  applyLayoutState();
  applyCharacterDrawerState();
  applyChatDrawerState();
  applyWorldDrawerState();
  applyPlayerActionMenuState();
  renderCombatOverlay();
  renderPersuasionOverlay();
  renderWorldDrawer();
  renderPlayerActionMenuItems();
  renderApiSettingsSummary();
  renderSystemPromptSummary();
  renderDbQueryControllerSummary();
  loadInitial();
  setInterval(ensureAgentProgressStream, 1500);
  setInterval(pollActiveAgentProgressEvents, 900);
  window.addEventListener('ai-dnd-scene-visual-refresh', () => {
    scheduleSceneVisualRefresh({ force: true, delay: 0 });
  });
  window.addEventListener('hashchange', () => {
    if (window.location.hash.includes('scene-visual-refresh')) {
      scheduleSceneVisualRefresh({ force: true, delay: 0 });
    }
  });
});

function installSceneVisualDebugApi() {
  window.aiDndDebug = window.aiDndDebug || {};
  window.aiDndDebug.sceneVisual = {
    refresh: (options = {}) => refreshSceneVisual({ force: true, ...options }),
    schedule: () => scheduleSceneVisualRefresh({ force: true, delay: 0 }),
    state: () => JSON.parse(JSON.stringify({
      activeChatId: state.activeChatId,
      activeChatTitle: state.activeChat?.title,
      messageCount: state.activeChat?.messages?.length || 0,
      inferredSceneId: inferSceneVisualSceneId(),
      toolCount: state.tools.length,
      hasNpcTool: toolAvailable('system.scene_npcs.list_mounted_npcs'),
      hasMapTool: toolAvailable('system.scene_maps.list_mounted_maps'),
      hasVisualTool: toolAvailable('system.visual.resolve_assets'),
      sceneVisual: state.sceneVisual
    })),
    mounted: async () => {
      const sceneId = await resolveSceneVisualSceneId(state.activeChatId);
      return {
        sceneId,
        npcs: await loadSceneVisualMountedNpcs(state.activeChatId, sceneId),
        maps: await loadSceneVisualMountedMaps(state.activeChatId, sceneId)
      };
    }
  };
}

function frontendExtensions() {
  return window.AiDndFrontendExtensions || window.aiDndFrontendExtensions;
}

function emitFrontendEvent(type, detail = {}, meta = {}) {
  try {
    return frontendExtensions()?.events?.emit?.(type, detail, {
      source: 'web-ui',
      chatSessionId: state.activeChatId,
      ...meta
    });
  } catch (error) {
    console.warn('Frontend extension event failed:', error);
    return undefined;
  }
}

function registerFrontendAsset(asset = {}) {
  try {
    return frontendExtensions()?.assetRegistry?.register?.(asset) || asset;
  } catch (error) {
    console.warn('Frontend asset registration failed:', error);
    return asset;
  }
}

function renderFrontendNpcVisual(context = {}) {
  try {
    return frontendExtensions()?.sceneVisualRenderers?.renderNpc?.(context);
  } catch (error) {
    console.warn('Frontend NPC renderer failed:', error);
    return undefined;
  }
}

function renderFrontendVisual(context = {}) {
  try {
    return frontendExtensions()?.sceneVisualRenderers?.render?.(context);
  } catch (error) {
    console.warn('Frontend renderer failed:', error);
    return undefined;
  }
}

function bindElements() {
  for (const id of [
    'appShell',
    'connectionStatus',
    'refreshButton',
    'toggleInspectorButton',
    'toggleSidebarButton',
    'toggleWorldDrawerButton',
    'worldDrawer',
    'worldDrawerClockTabButton',
    'worldDrawerHistoryTabButton',
    'refreshWorldDrawerButton',
    'worldClockPanel',
    'worldHistoryPanel',
    'worldClockContent',
    'worldHistoryContent',
    'settingsTray',
    'toggleSettingsButton',
    'openApiSettingsButton',
    'apiSettingsSummary',
    'openSystemPromptButton',
    'systemPromptSummary',
    'openLoopSettingsButton',
    'loopHotSwitchSummary',
    'openDbQueryControllerButton',
    'dbQueryControllerSummary',
    'openDebugPanelButton',
    'debugPanelDialog',
    'debugCombatWinToggle',
    'debugStartCombatButton',
    'debugOpenPersuasionButton',
    'debugOpenDiceButton',
    'debugOpenAdjudicationButton',
    'debugPanelStatus',
    'combatOverlay',
    'combatWindow',
    'combatStatusBadge',
    'combatBattleTitle',
    'combatBattleSubtitle',
    'combatExitButton',
    'combatStageVisual',
    'combatStageTitle',
    'combatStageText',
    'combatTurnMeta',
    'combatAllyList',
    'combatEnemyList',
    'combatActionHint',
    'combatSkillDrawerToggle',
    'combatSkillDrawer',
    'combatSkillList',
    'combatSkillTooltip',
    'slotUseTooltip',
    'slotUseActionPopover',
    'combatSpecialPanel',
    'combatSpecialInput',
    'combatSpecialSubmitButton',
    'combatSpecialToggleButton',
    'combatSurrenderButton',
    'combatDebugWinButton',
    'combatFinishWinButton',
    'combatStatusText',
    'combatEventLog',
    'persuasionOverlay',
    'persuasionWindow',
    'persuasionTitle',
    'persuasionSubtitle',
    'persuasionCloseButton',
    'persuasionStageVisual',
    'persuasionStageTitle',
    'persuasionStageText',
    'persuasionSourceText',
    'persuasionTargetText',
    'persuasionInput',
    'persuasionCancelButton',
    'persuasionSubmitButton',
    'persuasionStatusText',
    'loopHotSwitchDialogSummary',
    'loopSettingsDialog',
    'refreshLoopHotSwitchButton',
    'loopConfigHotSelect',
    'switchLoopHotButton',
    'openLoopManagerButton',
    'openToolManagerButton',
    'characterDrawerSection',
    'toggleCharacterDrawerButton',
    'characterDrawerContent',
    'chatDrawerSection',
    'toggleChatDrawerButton',
    'chatDrawerContent',
    'openChatImportButton',
    'characterSelect',
    'characterAvatarButton',
    'characterAvatarFallback',
    'characterAvatarImage',
    'editCharacterButton',
    'exportCharacterButton',
    'deleteCharacterButton',
    'openInitialSettingButton',
    'seedCharacterButton',
    'openImportButton',
    'newChatTitle',
    'newChatButton',
    'chatCount',
    'chatList',
    'chatTitle',
    'chatSubtitle',
    'exportChatButton',
    'deleteChatButton',
    'sceneBackgroundLayerA',
    'sceneBackgroundLayerB',
    'sceneVisualPanel',
    'messageList',
    'playerActionMenu',
    'togglePlayerActionMenuButton',
    'playerActionMenuPanel',
    'playerActionDialog',
    'playerActionDialogTitle',
    'playerActionDialogSubtitle',
    'playerActionDialogContent',
    'refreshPlayerActionDialogButton',
    'composerForm',
    'messageInput',
    'sendButton',
    'agentProgressFloat',
    'agentProgressCloseButton',
    'agentProgressStatus',
    'agentProgressDetail',
    'routerReviewFloatStack',
    'settlementNoticeStack',
    'adjudicationOverlay',
    'adjudicationCard',
    'adjudicationTitle',
    'adjudicationSummary',
    'adjudicationCloseButton',
    'adjudicationOutcome',
    'adjudicationContent',
    'adjudicationStatus',
    'adjudicationAppealPanel',
    'adjudicationAppealText',
    'adjudicationCancelAppealButton',
    'adjudicationSubmitAppealButton',
    'adjudicationAppealButton',
    'adjudicationAcceptButton',
    'diceRollOverlay',
    'diceRollCard',
    'diceRollBadge',
    'diceRollTitle',
    'diceRollSummary',
    'diceRollCloseButton',
    'diceRollTotal',
    'diceRollDetails',
    'diceRollAttempts',
    'diceRollStatus',
    'diceRollRerollButton',
    'planContextButton',
    'contextUsage',
    'contextSections',
    'contextPreview',
    'refreshDataButton',
    'dataCollections',
    'refreshToolsButton',
    'toolSummary',
    'toolList',
    'importDialog',
    'characterJsonPath',
    'characterJson',
    'characterResourcesJsonPath',
    'characterResourcesJson',
    'fillSampleButton',
    'importCharacterButton',
    'chatImportDialog',
    'chatJsonPath',
    'chatJson',
    'chatResourcesJsonPath',
    'chatResourcesJson',
    'importChatButton',
    'npcSettingDialog',
    'npcSettingDialogTitle',
    'npcSettingDialogIntro',
    'npcSettingStatus',
    'npcSettingSelectView',
    'npcSettingList',
    'npcSettingCreateModeButton',
    'npcSettingCreateView',
    'npcSettingNameInput',
    'npcSettingIdInput',
    'npcSettingSummaryInput',
    'npcSettingGreetingInput',
    'npcSettingLaterButton',
    'npcSettingBackButton',
    'npcSettingConfirmButton',
    'characterEditorDialog',
    'editorAvatarButton',
    'editorAvatarFallback',
    'editorAvatarImage',
    'characterAvatarFile',
    'characterEditorName',
    'characterEditorJson',
    'exportCharacterFromEditorButton',
    'saveCharacterButton',
    'avatarCropDialog',
    'closeAvatarCropButton',
    'avatarCropCanvas',
    'avatarCropZoomInput',
    'avatarCropRotationInput',
    'rotateAvatarLeftButton',
    'rotateAvatarRightButton',
    'resetAvatarCropButton',
    'cancelAvatarCropButton',
    'applyAvatarCropButton',
    'avatarPreviewDialog',
    'closeAvatarPreviewButton',
    'avatarPreviewImage',
    'avatarPreviewFallback',
    'apiSettingsDialog',
    'apiProviderSelect',
    'apiBaseUrl',
    'apiKey',
    'apiModel',
    'apiTemperature',
    'apiMaxTokens',
    'testApiConnectionButton',
    'apiConnectionStatus',
    'saveApiSettingsButton',
    'resetApiSettingsButton',
    'systemPromptDialog',
    'systemPromptText',
    'saveSystemPromptButton',
    'resetSystemPromptButton',
    'dbQueryControllerDialog',
    'reloadDbQueryControllerButton',
    'dbQueryControllerContent',
    'resetDbQueryControllerButton',
    'saveDbQueryControllerButton',
    'initialSettingEditor',
    'initialSettingEditorHeader',
    'initialSettingCharacterName',
    'initialSettingReloadButton',
    'closeInitialSettingButton',
    'initialSettingStats',
    'initialSettingStorage',
    'initialSettingSyncExistingFields',
    'initialSettingAddCollectionButton',
    'initialSettingCollectionList',
    'initialSettingCollectionEditor',
    'initialSettingJson',
    'initialSettingPreviewButton',
    'initialSettingSaveButton',
    'initialSettingExportButton',
    'initialSettingExportAllButton',
    'initialSettingApplyChatButton',
    'initialSettingApplyAllButton',
    'initialSettingDeleteButton',
    'initialSettingOutput',
    'toast'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.refreshButton.addEventListener('click', () => loadInitial());
  els.toggleInspectorButton.addEventListener('click', toggleInspector);
  els.toggleSidebarButton.addEventListener('click', toggleSidebar);
  els.toggleWorldDrawerButton.addEventListener('click', toggleWorldDrawer);
  els.worldDrawerClockTabButton.addEventListener('click', () => setWorldDrawerTab('clock'));
  els.worldDrawerHistoryTabButton.addEventListener('click', () => setWorldDrawerTab('history'));
  els.refreshWorldDrawerButton.addEventListener('click', () => refreshWorldDrawer());
  els.toggleSettingsButton.addEventListener('click', toggleSettings);
  els.openApiSettingsButton.addEventListener('click', openApiSettings);
  els.openSystemPromptButton.addEventListener('click', openSystemPromptSettings);
  els.openLoopSettingsButton.addEventListener('click', openLoopSettings);
  els.openDbQueryControllerButton.addEventListener('click', openDbQueryController);
  els.openDebugPanelButton.addEventListener('click', openDebugPanel);
  els.debugCombatWinToggle.addEventListener('change', toggleDebugCombatWinButton);
  els.refreshLoopHotSwitchButton.addEventListener('click', () => loadLoopHotSwitch());
  els.loopConfigHotSelect.addEventListener('change', () => {
    state.loopHotSwitch.selectedConfigId = els.loopConfigHotSelect.value;
    renderLoopHotSwitchControls();
  });
  els.switchLoopHotButton.addEventListener('click', switchLoopHotConfig);
  els.openLoopManagerButton.addEventListener('click', openLoopManager);
  els.openToolManagerButton.addEventListener('click', openToolManager);
  els.apiProviderSelect.addEventListener('change', applyApiProviderDefaults);
  for (const input of [els.apiBaseUrl, els.apiKey, els.apiModel, els.apiTemperature, els.apiMaxTokens]) {
    input.addEventListener('input', markApiSettingsDraftChanged);
  }
  els.testApiConnectionButton.addEventListener('click', testApiConnection);
  els.saveApiSettingsButton.addEventListener('click', saveApiSettings);
  els.resetApiSettingsButton.addEventListener('click', resetApiSettings);
  els.saveSystemPromptButton.addEventListener('click', saveSystemPromptSettings);
  els.resetSystemPromptButton.addEventListener('click', resetSystemPromptSettings);
  els.reloadDbQueryControllerButton.addEventListener('click', () => loadDbQueryControllerSchema());
  els.resetDbQueryControllerButton.addEventListener('click', resetDbQueryController);
  els.saveDbQueryControllerButton.addEventListener('click', saveDbQueryController);
  els.dbQueryControllerContent.addEventListener('change', handleDbQueryControllerChange);
  els.combatExitButton.addEventListener('click', closeCombatOverlay);
  els.combatSkillDrawerToggle.addEventListener('click', toggleCombatSkillDrawer);
  els.combatSpecialToggleButton.addEventListener('click', toggleCombatSpecialPanel);
  els.combatSpecialSubmitButton.addEventListener('click', submitCombatSpecialAction);
  els.combatSpecialInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitCombatSpecialAction();
    }
  });
  els.combatSurrenderButton.addEventListener('click', surrenderCombat);
  els.combatDebugWinButton.addEventListener('click', debugWinCombat);
  els.debugStartCombatButton.addEventListener('click', startDebugCombat);
  els.debugOpenPersuasionButton.addEventListener('click', openDebugPersuasionOverlay);
  els.debugOpenDiceButton.addEventListener('click', openDebugDiceOverlay);
  els.debugOpenAdjudicationButton.addEventListener('click', openDebugAdjudicationOverlay);
  els.combatFinishWinButton.addEventListener('click', finishWonCombat);
  els.combatSkillList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-combat-action-id]');
    if (!button) return;
    useCombatSkill(button.dataset.combatActionId);
  });
  els.slotUseActionPopover.addEventListener('click', handleSlotUsePopoverClick);
  els.slotUseActionPopover.addEventListener('click', (event) => event.stopPropagation());
  window.addEventListener('resize', positionSceneVisualOverlays);
  els.openInitialSettingButton.addEventListener('click', openInitialSettingEditor);
  els.toggleCharacterDrawerButton.addEventListener('click', toggleCharacterDrawer);
  els.toggleChatDrawerButton.addEventListener('click', toggleChatDrawer);
  els.characterAvatarButton.addEventListener('click', openAvatarPreview);
  els.editCharacterButton.addEventListener('click', openCharacterEditor);
  els.exportCharacterButton.addEventListener('click', exportSelectedCharacter);
  els.deleteCharacterButton.addEventListener('click', deleteSelectedCharacter);
  els.editorAvatarButton.addEventListener('click', () => els.characterAvatarFile.click());
  els.characterAvatarFile.addEventListener('change', updateEditorAvatarFromFile);
  els.exportCharacterFromEditorButton.addEventListener('click', exportEditorCharacter);
  els.saveCharacterButton.addEventListener('click', saveCharacterEditor);
  els.closeAvatarCropButton.addEventListener('click', closeAvatarCrop);
  els.cancelAvatarCropButton.addEventListener('click', closeAvatarCrop);
  els.applyAvatarCropButton.addEventListener('click', applyAvatarCrop);
  els.rotateAvatarLeftButton.addEventListener('click', () => rotateAvatarCrop(-90));
  els.rotateAvatarRightButton.addEventListener('click', () => rotateAvatarCrop(90));
  els.resetAvatarCropButton.addEventListener('click', resetAvatarCropTransform);
  els.avatarCropZoomInput.addEventListener('input', updateAvatarCropZoom);
  els.avatarCropRotationInput.addEventListener('input', updateAvatarCropRotation);
  els.avatarCropCanvas.addEventListener('pointerdown', startAvatarCropDrag);
  els.avatarCropCanvas.addEventListener('pointermove', moveAvatarCropDrag);
  els.avatarCropCanvas.addEventListener('pointerup', endAvatarCropDrag);
  els.avatarCropCanvas.addEventListener('pointercancel', endAvatarCropDrag);
  els.avatarCropCanvas.addEventListener('wheel', zoomAvatarCropWithWheel, { passive: false });
  els.avatarCropDialog.addEventListener('click', (event) => {
    if (event.target === els.avatarCropDialog) closeAvatarCrop();
  });
  els.avatarCropDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeAvatarCrop();
  });
  els.closeAvatarPreviewButton.addEventListener('click', closeAvatarPreview);
  els.avatarPreviewDialog.addEventListener('click', (event) => {
    if (event.target === els.avatarPreviewDialog) closeAvatarPreview();
  });
  els.closeInitialSettingButton.addEventListener('click', closeInitialSettingEditor);
  els.initialSettingReloadButton.addEventListener('click', loadInitialSettingEditor);
  els.initialSettingPreviewButton.addEventListener('click', previewInitialSetting);
  els.initialSettingSaveButton.addEventListener('click', () => saveInitialSetting());
  els.initialSettingExportButton.addEventListener('click', exportCurrentInitialSetting);
  els.initialSettingExportAllButton.addEventListener('click', exportAllInitialSettings);
  els.initialSettingApplyChatButton.addEventListener('click', applyInitialSettingToActiveChat);
  els.initialSettingApplyAllButton.addEventListener('click', applyInitialSettingToAllChats);
  els.initialSettingDeleteButton.addEventListener('click', deleteCurrentInitialSetting);
  els.initialSettingAddCollectionButton.addEventListener('click', addInitialSettingCollection);
  els.initialSettingJson.addEventListener('change', applyInitialSettingJson);
  els.initialSettingEditorHeader.addEventListener('pointerdown', startInitialSettingDrag);
  els.seedCharacterButton.addEventListener('click', createSampleCharacter);
  els.openImportButton.addEventListener('click', () => {
    els.characterJsonPath.value = '';
    els.characterJson.value = '';
    els.characterResourcesJsonPath.value = '';
    els.characterResourcesJson.value = '';
    els.importDialog.showModal();
  });
  els.openChatImportButton.addEventListener('click', () => {
    els.chatJsonPath.value = '';
    els.chatJson.value = '';
    els.chatResourcesJsonPath.value = '';
    els.chatResourcesJson.value = '';
    els.chatImportDialog.showModal();
  });
  els.fillSampleButton.addEventListener('click', () => {
    els.characterJsonPath.value = '';
    els.characterJson.value = JSON.stringify(SAMPLE_CHARACTER, null, 2);
    els.characterResourcesJsonPath.value = '';
    els.characterResourcesJson.value = '';
  });
  els.importCharacterButton.addEventListener('click', importCharacter);
  els.importChatButton.addEventListener('click', importChat);
  els.npcSettingCreateModeButton.addEventListener('click', () => setNpcSettingOnboardingMode('create'));
  els.npcSettingBackButton.addEventListener('click', () => setNpcSettingOnboardingMode('select'));
  els.npcSettingLaterButton.addEventListener('click', closeNpcSettingOnboarding);
  els.npcSettingConfirmButton.addEventListener('click', confirmNpcSettingOnboarding);
  els.npcSettingNameInput.addEventListener('input', syncNpcSettingIdFromName);
  els.npcSettingList.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="npcSettingCandidate"]');
    if (!input) return;
    state.npcSettingOnboarding.selectedKey = input.value;
    renderNpcSettingDialog();
  });
  els.newChatButton.addEventListener('click', createChat);
  els.newChatTitle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      createChat();
    }
  });
  els.characterSelect.addEventListener('change', async () => {
    renderChats();
    renderCharacterCardPreview();
    await loadSelectedCharacterDetails();
    updateControls();
    if (state.initialSetting.open) {
      await loadInitialSettingEditor();
    }
  });
  els.composerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });
  els.messageInput.addEventListener('input', () => {
    els.messageInput.style.height = 'auto';
    els.messageInput.style.height = `${Math.min(150, els.messageInput.scrollHeight)}px`;
  });
  els.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendMessage();
    }
  });
  els.agentProgressCloseButton.addEventListener('click', hideAgentProgress);
  els.routerReviewFloatStack.addEventListener('click', (event) => {
    const button = event.target.closest('[data-router-review-dismiss]');
    if (!button) return;
    dismissRouterReviewItem(button.dataset.routerReviewDismiss);
  });
  els.settlementNoticeStack.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settlement-notice-dismiss]');
    if (!button) return;
    dismissSettlementNotice(button.dataset.settlementNoticeDismiss);
  });
  els.diceRollCloseButton.addEventListener('click', dismissDiceRollOverlay);
  els.diceRollRerollButton.addEventListener('click', rerollCurrentDiceRoll);
  els.adjudicationCloseButton.addEventListener('click', acceptAndCloseAdjudicationOverlay);
  els.adjudicationAcceptButton.addEventListener('click', acceptAndCloseAdjudicationOverlay);
  els.adjudicationAppealButton.addEventListener('click', openAdjudicationAppealPanel);
  els.adjudicationCancelAppealButton.addEventListener('click', closeAdjudicationAppealPanel);
  els.adjudicationSubmitAppealButton.addEventListener('click', submitAdjudicationAppeal);
  els.persuasionCloseButton.addEventListener('click', () => closePersuasionOverlay({ skipRouter: true }));
  els.persuasionCancelButton.addEventListener('click', () => closePersuasionOverlay({ skipRouter: true }));
  els.persuasionSubmitButton.addEventListener('click', submitPersuasionArgument);
  els.persuasionInput.addEventListener('input', renderPersuasionOverlay);
  els.persuasionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitPersuasionArgument();
    }
  });
  els.exportChatButton.addEventListener('click', exportActiveChat);
  els.deleteChatButton.addEventListener('click', deleteActiveChat);
  els.togglePlayerActionMenuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePlayerActionMenu();
  });
  els.playerActionMenu.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  els.playerActionMenuPanel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-player-action]');
    if (!button) return;
    event.stopPropagation();
    usePlayerAction(button.dataset.playerAction);
  });
  els.playerActionDialogContent.addEventListener('click', handlePlayerActionDialogClick);
  els.refreshPlayerActionDialogButton.addEventListener('click', () => {
    if (state.playerActionViewer.action) {
      usePlayerAction(state.playerActionViewer.action, { keepOpen: true });
    }
  });
  document.addEventListener('click', () => {
    closePlayerActionMenu();
    closeSlotUseActionPopover();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePlayerActionMenu();
      closeSlotUseActionPopover();
      hideSlotUseTooltip();
    }
  });
  els.planContextButton.addEventListener('click', planContext);
  els.refreshDataButton.addEventListener('click', loadChatData);
  els.refreshToolsButton.addEventListener('click', loadTools);

  for (const button of document.querySelectorAll('.tab-button')) {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  }
}

function toggleInspector() {
  state.inspectorCollapsed = !state.inspectorCollapsed;
  localStorage.setItem('ai-dnd-inspector-collapsed', String(state.inspectorCollapsed));
  applyLayoutState();
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem('ai-dnd-sidebar-collapsed', String(state.sidebarCollapsed));
  applyLayoutState();
}

function toggleSettings() {
  state.settingsExpanded = !state.settingsExpanded;
  localStorage.setItem('ai-dnd-settings-expanded', String(state.settingsExpanded));
  applyLayoutState();
}

function toggleCharacterDrawer() {
  state.characterDrawerExpanded = !state.characterDrawerExpanded;
  localStorage.setItem(CHARACTER_DRAWER_EXPANDED_KEY, String(state.characterDrawerExpanded));
  applyCharacterDrawerState();
}

function toggleChatDrawer() {
  state.chatDrawerExpanded = !state.chatDrawerExpanded;
  localStorage.setItem(CHAT_DRAWER_EXPANDED_KEY, String(state.chatDrawerExpanded));
  applyChatDrawerState();
}

function toggleWorldDrawer() {
  state.worldDrawerExpanded = !state.worldDrawerExpanded;
  localStorage.setItem(WORLD_DRAWER_EXPANDED_KEY, String(state.worldDrawerExpanded));
  applyWorldDrawerState();
  if (state.worldDrawerExpanded) {
    void refreshWorldDrawer({ silent: true });
  }
}

function setWorldDrawerTab(tab) {
  const nextTab = tab === 'history' ? 'history' : 'clock';
  if (state.worldDrawer.activeTab === nextTab) return;
  state.worldDrawer.activeTab = nextTab;
  localStorage.setItem(WORLD_DRAWER_TAB_KEY, nextTab);
  renderWorldDrawer();
  if (state.worldDrawerExpanded) {
    void refreshWorldDrawer({ silent: true });
  }
}

function togglePlayerActionMenu() {
  state.playerActionMenuOpen = !state.playerActionMenuOpen;
  applyPlayerActionMenuState();
}

function closePlayerActionMenu() {
  if (!state.playerActionMenuOpen) return;
  state.playerActionMenuOpen = false;
  applyPlayerActionMenuState();
}

function applyPlayerActionMenuState() {
  els.playerActionMenu.classList.toggle('open', state.playerActionMenuOpen);
  els.playerActionMenuPanel.hidden = !state.playerActionMenuOpen;
  els.togglePlayerActionMenuButton.setAttribute('aria-expanded', String(state.playerActionMenuOpen));
  els.togglePlayerActionMenuButton.textContent = state.playerActionMenuOpen ? '×' : '＋';
}

function renderPlayerActionMenuItems() {
  if (!els.playerActionMenuPanel) return;
  els.playerActionMenuPanel.innerHTML = '';
  for (const [action, config] of getPlayerActionDefinitions()) {
    const button = document.createElement('button');
    button.className = 'player-action-item';
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.playerAction = action;
    const mark = document.createElement('span');
    mark.className = 'player-action-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = config.mark || (config.title || '?').slice(0, 1);
    const label = document.createElement('span');
    label.className = 'player-action-label';
    label.textContent = config.title;
    button.title = config.subtitle || config.title;
    button.append(mark, label);
    els.playerActionMenuPanel.append(button);
  }
  updateControls();
}

function getPlayerActionDefinitions() {
  const definitions = new Map(Object.entries(PLAYER_ACTIONS).map(([action, config]) => [action, {
    ...config,
    action,
    dynamic: false
  }]));
  for (const source of state.relationshipSources || []) {
    if (source.staticAction && definitions.has(source.staticAction)) continue;
    const action = relationshipSourceActionId(source);
    definitions.set(action, {
      action,
      title: source.title || source.collection || source.key || '关系图',
      subtitle: source.subtitle || relationshipSourceSubtitle(source),
      mark: source.mark || relationshipSourceMark(source.title || source.key),
      dynamic: true,
      source
    });
  }
  return definitions;
}

function getPlayerActionDefinition(action) {
  return getPlayerActionDefinitions().get(action);
}

function getPlayerActionCollections(action) {
  if (PLAYER_ACTION_COLLECTIONS[action]) return PLAYER_ACTION_COLLECTIONS[action];
  const source = dynamicGraphSourceForAction(action);
  return source?.collections || [];
}

function relationshipSourceActionId(source = {}) {
  return `${GRAPH_ACTION_PREFIX}${source.id || source.key || source.title || 'unknown'}`;
}

function isDynamicGraphAction(action) {
  return String(action || '').startsWith(GRAPH_ACTION_PREFIX);
}

function dynamicGraphSourceForAction(action) {
  if (!isDynamicGraphAction(action)) return undefined;
  return (state.relationshipSources || []).find((source) => relationshipSourceActionId(source) === action);
}

function relationshipSourceSubtitle(source = {}) {
  if (source.sourceType === 'tool-graph') return `自动发现的关系图工具：${source.key || source.id}`;
  if (source.sourceType === 'collection-graph') return `自动发现的关系库：${source.edgeCollection || source.collection}`;
  return '自动发现的关系图。';
}

function relationshipSourceMark(value = '') {
  const text = String(value || '').replace(/关系图|图|graph|relationship|relation/ig, '').trim();
  return (text || value || '图').slice(0, 1);
}

async function usePlayerAction(action, { keepOpen = false } = {}) {
  const config = getPlayerActionDefinition(action);
  if (!config) return;
  if (!state.activeChatId) {
    showToast('先选择一个聊天');
    return;
  }
  if (state.busy) return;
  closePlayerActionMenu();
  state.playerActionViewer = {
    action,
    loading: true,
    data: undefined,
    error: '',
    slotIndex: new Map(),
    slotBusyKey: ''
  };
  renderPlayerActionDialog();
  if (!keepOpen && !els.playerActionDialog.open) {
    els.playerActionDialog.showModal();
  }
  try {
    state.playerActionViewer.data = await loadPlayerActionData(action);
    state.playerActionViewer.error = '';
  } catch (error) {
    state.playerActionViewer.error = error.message || String(error);
  } finally {
    state.playerActionViewer.loading = false;
    renderPlayerActionDialog();
  }
}

function applyLayoutState() {
  els.appShell.classList.toggle('inspector-collapsed', state.inspectorCollapsed);
  els.appShell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  els.settingsTray.classList.toggle('collapsed', !state.settingsExpanded);

  els.toggleInspectorButton.textContent = state.inspectorCollapsed ? '›' : '‹';
  els.toggleInspectorButton.title = state.inspectorCollapsed ? '展开左栏' : '收起左栏';
  els.toggleInspectorButton.setAttribute('aria-label', els.toggleInspectorButton.title);
  els.toggleInspectorButton.setAttribute('aria-expanded', String(!state.inspectorCollapsed));

  els.toggleSidebarButton.textContent = state.sidebarCollapsed ? '‹' : '›';
  els.toggleSidebarButton.title = state.sidebarCollapsed ? '展开右栏' : '收起右栏';
  els.toggleSidebarButton.setAttribute('aria-label', els.toggleSidebarButton.title);
  els.toggleSidebarButton.setAttribute('aria-expanded', String(!state.sidebarCollapsed));

  els.toggleSettingsButton.textContent = state.settingsExpanded ? '设置 ▲' : '设置 ▼';
  els.toggleSettingsButton.setAttribute('aria-expanded', String(state.settingsExpanded));
}

function applyCharacterDrawerState() {
  els.characterDrawerSection.classList.toggle('collapsed', !state.characterDrawerExpanded);
  els.toggleCharacterDrawerButton.setAttribute('aria-expanded', String(state.characterDrawerExpanded));
}

function applyChatDrawerState() {
  els.chatDrawerSection.classList.toggle('collapsed', !state.chatDrawerExpanded);
  els.toggleChatDrawerButton.setAttribute('aria-expanded', String(state.chatDrawerExpanded));
}

function applyWorldDrawerState() {
  els.appShell.classList.toggle('world-drawer-collapsed', !state.worldDrawerExpanded);
  els.toggleWorldDrawerButton.textContent = state.worldDrawerExpanded ? '⌃' : '⌄';
  els.toggleWorldDrawerButton.title = state.worldDrawerExpanded ? '收起世界抽屉' : '展开世界抽屉';
  els.toggleWorldDrawerButton.setAttribute('aria-label', els.toggleWorldDrawerButton.title);
  els.toggleWorldDrawerButton.setAttribute('aria-expanded', String(state.worldDrawerExpanded));
}

function openApiSettings() {
  syncApiSettingsForm();
  els.apiSettingsDialog.showModal();
}

function openSystemPromptSettings() {
  syncSystemPromptForm();
  els.systemPromptDialog.showModal();
}

function openLoopSettings() {
  renderLoopHotSwitchControls();
  els.loopSettingsDialog.showModal();
  void loadLoopHotSwitch({ silent: true });
}

function openDbQueryController() {
  state.playerDbQueryController.draft = clonePlayerDbQueryControl(state.playerDbQueryControl);
  state.playerDbQueryController.error = '';
  renderDbQueryController();
  els.dbQueryControllerDialog.showModal();
  void loadDbQueryControllerSchema({ silent: true });
}

function openToolManager() {
  window.location.assign(frontendUrl('/tool-manager/'));
}

function openLoopManager() {
  window.location.assign(frontendUrl('/tool-manager/', '#loop'));
}

function syncApiSettingsForm() {
  const settings = state.apiSettings;
  els.apiProviderSelect.value = settings.provider;
  els.apiBaseUrl.value = settings.baseUrl;
  els.apiKey.value = settings.apiKey;
  els.apiModel.value = settings.model;
  els.apiTemperature.value = settings.temperature;
  els.apiMaxTokens.value = settings.maxTokens;
  updateApiProviderPlaceholders();
  setApiConnectionStatus('上次保存的设置会自动用于聊天回复。');
}

function collectApiSettingsFromForm() {
  return normalizeApiSettings({
    provider: els.apiProviderSelect.value,
    baseUrl: els.apiBaseUrl.value,
    apiKey: els.apiKey.value,
    model: els.apiModel.value,
    temperature: els.apiTemperature.value,
    maxTokens: els.apiMaxTokens.value
  });
}

function saveApiSettings() {
  state.apiSettings = collectApiSettingsFromForm();
  localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(state.apiSettings));
  renderApiSettingsSummary();
  setApiConnectionStatus('已保存，并会自动用于之后的聊天回复。', 'success');
  els.apiSettingsDialog.close();
  showToast('API 设置已保存并应用');
}

function resetApiSettings() {
  state.apiSettings = { ...DEFAULT_API_SETTINGS };
  localStorage.removeItem(API_SETTINGS_KEY);
  syncApiSettingsForm();
  renderApiSettingsSummary();
  setApiConnectionStatus('已重置为服务端配置。', 'success');
}

async function testApiConnection() {
  const settings = collectApiSettingsFromForm();
  els.testApiConnectionButton.disabled = true;
  setApiConnectionStatus('正在测试连接...');
  try {
    const result = await api('/v1/chat/api-test', {
      method: 'POST',
      body: { api: settings }
    });
    const parts = [
      result.provider || settings.provider || 'server',
      result.model ? `model: ${result.model}` : '',
      result.modelFound === false ? '未在模型列表中找到该模型' : '',
      Number.isFinite(result.latencyMs) ? `${result.latencyMs} ms` : ''
    ].filter(Boolean);
    setApiConnectionStatus(`连接正常：${parts.join(' · ')}`, result.modelFound === false ? '' : 'success');
  } catch (error) {
    setApiConnectionStatus(`连接失败：${error.message || String(error)}`, 'error');
  } finally {
    els.testApiConnectionButton.disabled = false;
  }
}

function setApiConnectionStatus(message, status = '') {
  if (!els.apiConnectionStatus) return;
  els.apiConnectionStatus.textContent = message || '';
  els.apiConnectionStatus.dataset.status = status;
}

function renderApiSettingsSummary() {
  const settings = state.apiSettings;
  const label = API_PROVIDER_CONFIG[settings.provider]?.label || settings.provider || '服务端配置';
  const parts = [label];
  if (settings.model) parts.push(settings.model);
  if (settings.temperature !== '') parts.push(`T ${settings.temperature}`);
  if (settings.maxTokens !== '') parts.push(`${settings.maxTokens} tokens`);
  els.apiSettingsSummary.textContent = parts.join(' · ');
}

function syncSystemPromptForm() {
  els.systemPromptText.value = state.systemPrompt.mainPrompt || '';
}

function saveSystemPromptSettings() {
  state.systemPrompt = normalizeSystemPromptSettings({
    mainPrompt: els.systemPromptText.value
  });
  if (state.systemPrompt.mainPrompt) {
    localStorage.setItem(SYSTEM_PROMPT_SETTINGS_KEY, JSON.stringify(state.systemPrompt));
  } else {
    localStorage.removeItem(SYSTEM_PROMPT_SETTINGS_KEY);
  }
  renderSystemPromptSummary();
  els.systemPromptDialog.close();
  showToast('System Prompt 已保存');
}

function resetSystemPromptSettings() {
  state.systemPrompt = { ...DEFAULT_SYSTEM_PROMPT_SETTINGS };
  localStorage.removeItem(SYSTEM_PROMPT_SETTINGS_KEY);
  syncSystemPromptForm();
  renderSystemPromptSummary();
}

function renderSystemPromptSummary() {
  const text = state.systemPrompt.mainPrompt || '';
  els.systemPromptSummary.textContent = text
    ? `自定义 · ${text.length} chars`
    : '使用默认 System Prompt';
}

async function loadDbQueryControllerSchema({ silent = false } = {}) {
  if (!state.activeChatId) {
    state.playerDbQueryController.collectionMap = new Map();
    state.playerDbQueryController.error = '先选择一个聊天，才能读取当前聊天数据库 schema。';
    renderDbQueryController();
    return;
  }
  state.playerDbQueryController.loading = true;
  state.playerDbQueryController.error = '';
  renderDbQueryController();
  try {
    const [collections] = await Promise.all([
      loadAvailableChatDataCollections(),
      refreshRelationshipSources({ silent: true })
    ]);
    state.playerDbQueryController.collectionMap = collections;
    if (!silent) showToast('数据库字段已刷新');
  } catch (error) {
    state.playerDbQueryController.error = error.message || String(error);
    if (!silent) showToast(state.playerDbQueryController.error);
  } finally {
    state.playerDbQueryController.loading = false;
    renderDbQueryController();
  }
}

function renderDbQueryController() {
  if (!els.dbQueryControllerContent) return;
  const { loading, error, collectionMap } = state.playerDbQueryController;
  const draft = state.playerDbQueryController.draft || clonePlayerDbQueryControl(state.playerDbQueryControl);
  els.reloadDbQueryControllerButton.disabled = loading || !state.activeChatId;
  els.saveDbQueryControllerButton.disabled = loading;
  els.dbQueryControllerContent.innerHTML = '';

  if (loading) {
    els.dbQueryControllerContent.append(playerActionEmpty('正在读取当前聊天数据库 schema...'));
    return;
  }
  if (error) {
    els.dbQueryControllerContent.append(playerActionEmpty(error, 'error'));
    return;
  }
  if (!state.activeChatId) {
    els.dbQueryControllerContent.append(playerActionEmpty('先选择一个聊天。'));
    return;
  }

  els.dbQueryControllerContent.append(renderDbSourceClassificationPanel(collectionMap));

  for (const [action, config] of getPlayerActionDefinitions()) {
    const actionCollections = getPlayerActionCollections(action);
    if (actionCollections.length === 0) continue;
    const section = document.createElement('section');
    section.className = 'db-query-action-section';
    const header = document.createElement('div');
    header.className = 'db-query-action-header';
    const title = document.createElement('h3');
    title.textContent = config.title;
    const subtitle = document.createElement('small');
    subtitle.textContent = '默认全显示；切到自选后，新增字段默认不会给玩家看。';
    header.append(title, subtitle);
    section.append(header);

    for (const collection of actionCollections) {
      const collectionInfo = collectionMap.get(collection) || state.relationshipDiscovery.collectionMap.get(collection);
      section.append(renderDbQueryCollectionControl(draft, action, collection, collectionInfo));
    }
    els.dbQueryControllerContent.append(section);
  }
}

function renderDbSourceClassificationPanel(chatCollectionMap = new Map()) {
  const section = document.createElement('section');
  section.className = 'db-query-source-panel';
  const header = document.createElement('div');
  header.className = 'db-query-action-header';
  const title = document.createElement('h3');
  title.textContent = '数据库自动识别';
  const subtitle = document.createElement('small');
  subtitle.textContent = '规则：稳定端点字段和成对 nodes/edges 表按关系库处理；事件、历史、普通状态表按字段数据处理。';
  header.append(title, subtitle);
  section.append(header);

  if (state.relationshipDiscovery.loading) {
    section.append(playerActionEmpty('正在刷新全局关系库 schema...', 'compact'));
  }
  if (state.relationshipDiscovery.error) {
    section.append(playerActionEmpty(state.relationshipDiscovery.error, 'compact error'));
  }

  const rows = document.createElement('div');
  rows.className = 'db-query-source-grid';
  const chatNames = new Set(chatCollectionMap.keys());
  for (const [collection, info] of chatCollectionMap.entries()) {
    rows.append(renderDbSourceClassificationRow({
      scope: 'Chat Data',
      name: collection,
      classification: classifyCollectionSchema(info, chatNames)
    }));
  }
  for (const source of state.relationshipSources || []) {
    rows.append(renderDbSourceClassificationRow({
      scope: source.sourceType === 'tool-graph' ? 'Tool Graph' : 'Global Data',
      name: source.title || source.key,
      classification: {
        kind: 'relationship',
        role: source.sourceType === 'tool-graph' ? 'tool' : 'graph',
        reason: source.reason || relationshipSourceSubtitle(source)
      }
    }));
  }
  if (!rows.childElementCount) {
    rows.append(playerActionEmpty('还没有可识别的数据库来源。', 'compact'));
  }
  section.append(rows);
  return section;
}

function renderDbSourceClassificationRow({ scope, name, classification }) {
  const row = document.createElement('div');
  row.className = `db-query-source-row ${classification.kind === 'relationship' ? 'relationship' : 'field-data'}`;
  const heading = document.createElement('div');
  heading.className = 'db-query-source-heading';
  const title = document.createElement('strong');
  title.textContent = name;
  title.title = name;
  const badge = document.createElement('span');
  badge.textContent = classification.kind === 'relationship'
    ? `关系库 · ${relationshipRoleLabel(classification.role)}`
    : '字段数据';
  heading.append(title, badge);
  const meta = document.createElement('small');
  meta.textContent = `${scope} · ${classification.reason}`;
  row.append(heading, meta);
  return row;
}

function relationshipRoleLabel(role) {
  if (role === 'node') return '节点';
  if (role === 'edge') return '边';
  if (role === 'membership') return '隶属';
  if (role === 'tool') return '工具';
  return '图';
}

function renderDbQueryCollectionControl(draft, action, collection, collectionInfo) {
  const fieldNames = dbQueryFieldNames(collectionInfo);
  const config = getPlayerDbQueryCollectionConfig(draft, action, collection);
  const selectedFields = new Set(config.fields || []);
  const allMode = config.mode !== 'selected';
  const wrapper = document.createElement('div');
  wrapper.className = 'db-query-collection';

  const header = document.createElement('div');
  header.className = 'db-query-collection-header';
  const label = document.createElement('label');
  label.className = 'db-query-all-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = allMode;
  checkbox.dataset.dbQueryAction = action;
  checkbox.dataset.dbQueryCollection = collection;
  checkbox.dataset.dbQueryAll = 'true';
  const text = document.createElement('span');
  text.textContent = `${collection} · ${fieldNames.length} fields`;
  label.append(text, checkbox);
  const mode = document.createElement('small');
  mode.textContent = allMode ? '全显示，包括未来新增字段' : '只显示勾选字段';
  header.append(label, mode);
  wrapper.append(header);

  if (!collectionInfo) {
    wrapper.append(playerActionEmpty('当前还没有读取到这个 collection 的 schema。保存控制器仍然有效，collection 创建后会按这里的规则显示。', 'compact'));
    return wrapper;
  }

  const grid = document.createElement('div');
  grid.className = 'db-query-field-grid';
  for (const fieldName of fieldNames) {
    const fieldLabel = document.createElement('label');
    fieldLabel.className = 'db-query-field-toggle';
    const fieldCheckbox = document.createElement('input');
    fieldCheckbox.type = 'checkbox';
    fieldCheckbox.checked = allMode || selectedFields.has(fieldName);
    fieldCheckbox.disabled = allMode;
    fieldCheckbox.dataset.dbQueryAction = action;
    fieldCheckbox.dataset.dbQueryCollection = collection;
    fieldCheckbox.dataset.dbQueryField = fieldName;
    const name = document.createElement('span');
    name.textContent = fieldName;
    name.title = fieldName;
    fieldLabel.append(name, fieldCheckbox);
    grid.append(fieldLabel);
  }
  wrapper.append(grid);
  return wrapper;
}

function handleDbQueryControllerChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const action = target.dataset.dbQueryAction;
  const collection = target.dataset.dbQueryCollection;
  if (!action || !collection) return;
  const draft = state.playerDbQueryController.draft || clonePlayerDbQueryControl(state.playerDbQueryControl);
  state.playerDbQueryController.draft = draft;
  const collectionConfig = ensurePlayerDbQueryCollectionConfig(draft, action, collection);
  const fields = dbQueryFieldNames(state.playerDbQueryController.collectionMap.get(collection));

  if (target.dataset.dbQueryAll === 'true') {
    if (target.checked) {
      collectionConfig.mode = 'all';
      collectionConfig.fields = [];
    } else {
      collectionConfig.mode = 'selected';
      collectionConfig.fields = collectionConfig.fields.length > 0 ? collectionConfig.fields : fields;
    }
    renderDbQueryController();
    return;
  }

  const field = target.dataset.dbQueryField;
  if (!field) return;
  collectionConfig.mode = 'selected';
  const selected = new Set(collectionConfig.fields || []);
  if (target.checked) {
    selected.add(field);
  } else {
    selected.delete(field);
  }
  collectionConfig.fields = [...selected].filter((name) => fields.includes(name));
  renderDbQueryController();
}

function saveDbQueryController() {
  state.playerDbQueryControl = normalizePlayerDbQueryControl(state.playerDbQueryController.draft || {});
  localStorage.setItem(PLAYER_DB_QUERY_CONTROL_KEY, JSON.stringify(state.playerDbQueryControl));
  renderDbQueryControllerSummary();
  els.dbQueryControllerDialog.close();
  if (state.playerActionViewer.action && els.playerActionDialog.open) {
    renderPlayerActionDialog();
  }
  showToast('数据库查询控制器已保存');
}

function resetDbQueryController() {
  state.playerDbQueryController.draft = defaultPlayerDbQueryControl();
  renderDbQueryController();
}

function renderDbQueryControllerSummary() {
  if (!els.dbQueryControllerSummary) return;
  const count = playerDbQueryRestrictionCount(state.playerDbQueryControl);
  els.dbQueryControllerSummary.textContent = count > 0
    ? `${count} 个字段显示限制`
    : '默认全显示';
}

async function loadInitial() {
  setBusy(true);
  try {
    await Promise.all([loadCharacters(), loadChats(), loadTools()]);
    reconcileActiveChatSelection();
    if (!state.activeChatId && state.chats.length > 0) {
      state.activeChatId = state.chats[0].id;
    }
    if (state.activeChatId) {
      await loadChat(state.activeChatId);
    } else {
      state.activeChat = undefined;
      await loadLoopHotSwitch({ silent: true });
    }
    renderAll();
    scheduleSceneVisualRefresh({ force: true, delay: 0 });
    if (state.activeChatId) {
      await openAgentProgressStreamFromNow(state.activeChatId);
    }
    setConnection('已连接');
  } catch (error) {
    setConnection('连接失败');
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function reconcileActiveChatSelection() {
  if (!state.activeChatId) return;
  if (state.chats.some((chat) => chat.id === state.activeChatId)) return;
  state.activeChatId = '';
  state.activeChat = undefined;
  localStorage.removeItem('ai-dnd-active-chat');
}

async function loadCharacters() {
  const payload = await api('/v1/app/characters');
  state.characters = payload.characters || [];
}

async function loadChats() {
  const payload = await api('/v1/app/chats');
  state.chats = payload.chats || [];
  if (payload.active?.chatSessionId) {
    state.activeChatId = payload.active.chatSessionId;
  }
}

async function loadChat(chatId) {
  const payload = await api(`/v1/app/chats/${encodeURIComponent(chatId)}`);
  if (state.activeChatId && state.activeChatId !== payload.chat.id) {
    state.messageEdit = emptyMessageEditState();
    clearTimeout(state.sceneVisual.refreshTimer);
    state.sceneVisual = emptySceneVisualState();
    clearTimeout(state.combatOverlay.refreshTimer);
    clearTimeout(state.combatOverlay.actionCooldownTimer);
    state.combatOverlay = emptyCombatOverlayState();
  }
  state.activeChat = payload.chat;
  state.activeChatId = payload.chat.id;
  state.worldDrawer.clockData = undefined;
  state.worldDrawer.historyData = undefined;
  state.worldDrawer.error = '';
  state.worldDrawer.loadedChatId = '';
  state.worldDrawer.loadedTab = '';
  localStorage.setItem('ai-dnd-active-chat', state.activeChatId);
  await api(`/v1/app/chats/${encodeURIComponent(chatId)}/switch`, { method: 'POST' });
  await loadChatData();
  await loadLoopHotSwitch({ silent: true });
  await refreshCombatOverlayState({ autoOpen: false });
  await openAgentProgressStreamFromNow(state.activeChatId);
  scheduleSceneVisualRefresh({ force: true, delay: 0 });
}

async function loadTools() {
  const [publicPayload, allPayload] = await Promise.all([
    api('/v1/tools?visibility=public'),
    api('/v1/tools?includeDisabled=true')
  ]);
  const publicTools = publicPayload.tools || [];
  state.tools = allPayload.tools || [];
  els.toolSummary.innerHTML = '';
  els.toolSummary.append(metric(`public ${publicTools.length}`), metric(`all ${state.tools.length}`));
  renderToolList(publicTools);
  renderLoopHotSwitchControls();
  await refreshRelationshipSources({ silent: true });
}

async function loadLoopHotSwitch({ silent = false } = {}) {
  const available = loopHotSwitchAvailable();
  state.loopHotSwitch.available = available;
  if (!available) {
    state.loopHotSwitch.configs = [];
    state.loopHotSwitch.activeConfigId = '';
    state.loopHotSwitch.storage = 'unavailable';
    state.loopHotSwitch.error = '';
    renderLoopHotSwitchControls();
    return;
  }
  if (!state.activeChatId) {
    state.loopHotSwitch.activeConfigId = '';
    state.loopHotSwitch.storage = 'select chat';
    state.loopHotSwitch.error = '';
    renderLoopHotSwitchControls();
    return;
  }

  if (!silent) setBusy(true);
  state.loopHotSwitch.loading = true;
  renderLoopHotSwitchControls();
  try {
    const scope = activeLoopHotSwitchScope();
    const [listed, active] = await Promise.all([
      executeLoopHotTool('system.agent_loop.list_configs', {
        includeSteps: false,
        includeTemplateSteps: false
      }),
      executeLoopHotTool('system.agent_loop.get_active_config', scope)
    ]);
    state.loopHotSwitch.activeConfigId = active.activeConfigId || active.config?.id || 'default_flow_v1';
    state.loopHotSwitch.configs = normalizeLoopHotSwitchConfigs(listed);
    state.loopHotSwitch.selectedConfigId = state.loopHotSwitch.configs.some((config) => config.id === state.loopHotSwitch.selectedConfigId)
      ? state.loopHotSwitch.selectedConfigId
      : state.loopHotSwitch.activeConfigId;
    state.loopHotSwitch.storage = listed.storage || active.storage || 'unknown';
    state.loopHotSwitch.error = '';
    if (!silent) showToast('循环配置已刷新');
  } catch (error) {
    state.loopHotSwitch.error = error.message || String(error);
    if (!silent) showToast(state.loopHotSwitch.error);
  } finally {
    state.loopHotSwitch.loading = false;
    renderLoopHotSwitchControls();
    if (!silent) setBusy(false);
  }
}

async function switchLoopHotConfig() {
  if (!state.activeChatId) {
    showToast('先选择一个聊天');
    return;
  }
  const id = els.loopConfigHotSelect.value || state.loopHotSwitch.selectedConfigId;
  if (!id) {
    showToast('先选择循环配置');
    return;
  }

  setBusy(true);
  state.loopHotSwitch.loading = true;
  renderLoopHotSwitchControls();
  try {
    const scope = activeLoopHotSwitchScope();
    await executeLoopHotTool('system.agent_loop.switch_config', {
      ...scope,
      id,
      reason: 'web-ui hot switch'
    }, { authorization: true });
    state.loopHotSwitch.selectedConfigId = id;
    await loadLoopHotSwitch({ silent: true });
    showToast(`当前聊天已切换到 ${id}`);
  } catch (error) {
    state.loopHotSwitch.error = error.message || String(error);
    renderLoopHotSwitchControls();
    showToast(state.loopHotSwitch.error);
  } finally {
    state.loopHotSwitch.loading = false;
    setBusy(false);
  }
}

function renderLoopHotSwitchControls() {
  if (!els.loopHotSwitchSummary || !els.loopConfigHotSelect) return;
  const stateText = state.loopHotSwitch.loading ? '读取中' : loopHotSwitchSummaryText();
  els.loopHotSwitchSummary.textContent = stateText;
  if (els.loopHotSwitchDialogSummary) {
    els.loopHotSwitchDialogSummary.textContent = stateText;
  }

  const currentValue = els.loopConfigHotSelect.value;
  els.loopConfigHotSelect.innerHTML = '';
  for (const config of state.loopHotSwitch.configs) {
    const option = document.createElement('option');
    option.value = config.id;
    option.textContent = [
      config.name || config.title || config.id,
      config.id === state.loopHotSwitch.activeConfigId ? '当前' : '',
      config.source === 'template' ? '内置' : '已保存'
    ].filter(Boolean).join(' · ');
    els.loopConfigHotSelect.append(option);
  }
  const selected = state.loopHotSwitch.configs.some((config) => config.id === currentValue)
    ? currentValue
    : state.loopHotSwitch.selectedConfigId;
  if (selected && state.loopHotSwitch.configs.some((config) => config.id === selected)) {
    els.loopConfigHotSelect.value = selected;
  }
  updateControls();
}

function loopHotSwitchSummaryText() {
  if (!state.loopHotSwitch.available) return '循环管理器不可用';
  if (!state.activeChatId) return '未选择聊天';
  if (state.loopHotSwitch.error) return state.loopHotSwitch.error;
  const active = state.loopHotSwitch.activeConfigId || 'default_flow_v1';
  return `当前聊天：${active}`;
}

function normalizeLoopHotSwitchConfigs(listed = {}) {
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
    const activeDelta = Number(b.id === state.loopHotSwitch.activeConfigId) - Number(a.id === state.loopHotSwitch.activeConfigId);
    const sourceDelta = Number(a.source === 'template') - Number(b.source === 'template');
    return activeDelta || sourceDelta || a.id.localeCompare(b.id);
  });
}

function loopHotSwitchAvailable() {
  return [
    'system.agent_loop.list_configs',
    'system.agent_loop.get_active_config',
    'system.agent_loop.switch_config'
  ].every((id) => state.tools.some((tool) => tool.id === id && tool.enabled !== false));
}

function activeLoopHotSwitchScope() {
  return {
    scope: 'chat',
    scopeId: state.activeChatId
  };
}

async function executeLoopHotTool(toolId, input = {}, { authorization = false } = {}) {
  return executeTool(toolId, input, {
    source: 'web-ui.loop-hot-switch',
    ...(authorization ? { authorization: true } : {})
  });
}

async function executeTool(toolId, input = {}, context = {}) {
  const payload = await api(`/v1/tools/${encodeURIComponent(toolId)}/execute`, {
    method: 'POST',
    body: {
      input,
      context
    }
  });
  return payload.result?.output ?? payload.output ?? payload.result;
}

function toolAvailable(toolId) {
  return state.tools.some((tool) => tool.id === toolId && tool.enabled !== false);
}

async function refreshWorldDrawer({ silent = false } = {}) {
  if (!state.activeChatId) {
    state.worldDrawer.clockData = undefined;
    state.worldDrawer.historyData = undefined;
    state.worldDrawer.error = '';
    renderWorldDrawer();
    if (!silent) showToast('先选择一个聊天');
    return;
  }
  const tab = state.worldDrawer.activeTab;
  const chatId = state.activeChatId;
  state.worldDrawer.loading = true;
  state.worldDrawer.error = '';
  renderWorldDrawer();
  try {
    const data = tab === 'history'
      ? await loadAgentHistoryDrawerData(chatId)
      : await loadWorldClockDrawerData(chatId);
    if (state.activeChatId === chatId && state.worldDrawer.activeTab === tab) {
      if (tab === 'history') {
        state.worldDrawer.historyData = data;
      } else {
        state.worldDrawer.clockData = data;
      }
      state.worldDrawer.loadedChatId = chatId;
      state.worldDrawer.loadedTab = tab;
    }
  } catch (error) {
    state.worldDrawer.error = error.message || String(error);
    if (!silent) showToast(state.worldDrawer.error);
  } finally {
    state.worldDrawer.loading = false;
    renderWorldDrawer();
  }
}

async function loadWorldClockDrawerData(chatSessionId) {
  const data = {
    chatSessionId,
    clock: undefined,
    worldClocks: [],
    events: [],
    encounters: [],
    encounterEvents: [],
    triggerEvents: [],
    collectionSources: [],
    warnings: []
  };

  const [
    timeline,
    clock,
    worldClocks,
    timeEvents,
    timeEncounters,
    encounterRecords,
    encounterEvents,
    triggerEvents,
    collectionSources
  ] = await Promise.all([
    executeWorldDrawerTool('system.time.export_timeline', {
      chatSessionId,
      format: 'json',
      includeResolved: true
    }),
    executeWorldDrawerTool('system.time.get_clock', { chatSessionId, sceneId: 'current' }),
    executeWorldDrawerTool('system.time.list_world_clocks', { chatSessionId, limit: 200 }),
    executeWorldDrawerTool('system.time.list_events', { chatSessionId, includeResolved: true, limit: 300 }),
    executeWorldDrawerTool('system.time.list_encounters', { chatSessionId, limit: 200 }),
    executeWorldDrawerTool('system.encounters.list_encounters', { chatSessionId, limit: 200 }),
    executeWorldDrawerTool('system.encounters.list_events', { chatSessionId, limit: 300 }),
    executeWorldDrawerTool('system.triggers.list_trigger_events', { chatSessionId, limit: 300 }),
    loadWorldDrawerCollectionSources(chatSessionId)
  ]);

  collectWorldDrawerWarnings(data, [
    timeline,
    clock,
    worldClocks,
    timeEvents,
    timeEncounters,
    encounterRecords,
    encounterEvents,
    triggerEvents
  ]);

  const timelinePayload = timeline.output?.payload || parseWorldDrawerTimelineText(timeline.output?.text);
  if (timelinePayload && typeof timelinePayload === 'object') {
    data.clock = timelinePayload.clock || data.clock;
    data.worldClocks.push(...normalizeWorldDrawerRecords(timelinePayload.worldClocks, 'worldClock', 'time.timeline'));
    data.events.push(...normalizeWorldDrawerRecords(timelinePayload.events, 'timeEvent', 'time.timeline'));
    data.encounters.push(...normalizeWorldDrawerRecords(timelinePayload.encounters, 'timeEncounter', 'time.timeline'));
  }

  if (clock.output?.data || clock.output?.id) {
    data.clock = normalizeWorldDrawerRecord(clock.output, 'clock', 'system.time.get_clock').data;
  }
  data.worldClocks.push(...normalizeWorldDrawerRecords(worldClocks.output?.records || worldClocks.output?.worldClocks, 'worldClock', 'system.time.list_world_clocks'));
  data.events.push(...normalizeWorldDrawerRecords(timeEvents.output?.records || timeEvents.output?.events, 'timeEvent', 'system.time.list_events'));
  data.encounters.push(...normalizeWorldDrawerRecords(timeEncounters.output?.records || timeEncounters.output?.encounters, 'timeEncounter', 'system.time.list_encounters'));
  data.encounters.push(...normalizeWorldDrawerRecords(encounterRecords.output?.records || encounterRecords.output?.encounters, 'encounter', 'system.encounters.list_encounters'));
  data.encounterEvents.push(...normalizeWorldDrawerRecords(encounterEvents.output?.records || encounterEvents.output?.events, 'encounterEvent', 'system.encounters.list_events'));
  data.triggerEvents.push(...normalizeWorldDrawerRecords(triggerEvents.output?.records || triggerEvents.output?.events, 'triggerEvent', 'system.triggers.list_trigger_events'));
  data.collectionSources = collectionSources;

  data.worldClocks = dedupeWorldDrawerRecords(data.worldClocks);
  data.events = dedupeWorldDrawerRecords(data.events);
  data.encounters = dedupeWorldDrawerRecords(data.encounters);
  data.encounterEvents = dedupeWorldDrawerRecords(data.encounterEvents);
  data.triggerEvents = dedupeWorldDrawerRecords(data.triggerEvents);
  return data;
}

async function executeWorldDrawerTool(toolId, input = {}) {
  if (!toolAvailable(toolId)) {
    return { toolId, unavailable: true };
  }
  try {
    return {
      toolId,
      output: await executeTool(toolId, input, { source: 'web-ui.world-drawer' })
    };
  } catch (error) {
    return {
      toolId,
      error: error.message || String(error)
    };
  }
}

function collectWorldDrawerWarnings(data, results) {
  for (const result of results) {
    if (!result?.error) continue;
    data.warnings.push(`${result.toolId}: ${result.error}`);
  }
}

function parseWorldDrawerTimelineText(text) {
  if (!text || typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function loadWorldDrawerCollectionSources(chatSessionId) {
  let collections;
  try {
    collections = await loadAvailableChatDataCollections(chatSessionId);
  } catch {
    return [];
  }
  const sources = discoverWorldDrawerCollections(collections).slice(0, WORLD_DRAWER_COLLECTION_LIMIT);
  const loaded = await Promise.all(sources.map(async (source) => {
    try {
      const records = await queryChatDataCollectionIfAvailable(collections, source.collection, {
        sort: worldDrawerCollectionSort(source.fields),
        limit: WORLD_DRAWER_RECORD_LIMIT
      }, chatSessionId);
      return {
        ...source,
        records: normalizeWorldDrawerRecords(records, source.kind, `chat.${source.collection}`)
      };
    } catch (error) {
      return {
        ...source,
        records: [],
        error: error.message || String(error)
      };
    }
  }));
  return loaded.filter((source) => source.records.length > 0 || source.error);
}

function discoverWorldDrawerCollections(collectionMap = new Map()) {
  const sources = [];
  for (const [collection, info] of collectionMap.entries()) {
    const fields = dbQueryFieldNames(info);
    const classification = classifyCollectionSchema(info, new Set(collectionMap.keys()));
    if (classification.kind === 'relationship') continue;
    const kind = inferWorldDrawerCollectionKind(collection, fields);
    if (!kind) continue;
    sources.push({
      collection,
      fields,
      kind,
      title: worldDrawerCollectionTitle(collection, kind),
      reason: worldDrawerCollectionReason(collection, fields, kind)
    });
  }
  return sources.sort((a, b) => worldDrawerKindRank(a.kind) - worldDrawerKindRank(b.kind)
    || a.collection.localeCompare(b.collection));
}

function inferWorldDrawerCollectionKind(collection, fields = []) {
  const text = `${collection} ${fields.join(' ')}`;
  if (/(world[_-]?clocks?|clock|calendar|countdown|timer|deadline|due|elapsed|round|turn|时钟|倒计时|期限|回合)/i.test(text)) return 'clockCollection';
  if (/(encounters?|random[_-]?events?|luck|奇遇|遭遇)/i.test(text)) return 'encounterCollection';
  if (/(events?|trigger|timeline|journal|quest|schedule|scene_event|事件|触发|任务|时间线)/i.test(text)) return 'eventCollection';
  return '';
}

function worldDrawerCollectionTitle(collection, kind) {
  if (kind === 'clockCollection') return `${collection} · 时钟`;
  if (kind === 'encounterCollection') return `${collection} · 遭遇`;
  return `${collection} · 事件`;
}

function worldDrawerCollectionReason(collection, fields, kind) {
  const matched = fields.filter((field) => /(clock|event|encounter|trigger|due|deadline|round|elapsed|countdown|time|quest)/i.test(field)).slice(0, 5);
  const label = kind === 'clockCollection' ? '时钟库' : kind === 'encounterCollection' ? '遭遇库' : '事件库';
  return [label, matched.length ? `字段 ${matched.join(', ')}` : collection].join(' · ');
}

function worldDrawerKindRank(kind) {
  if (kind === 'clockCollection') return 0;
  if (kind === 'eventCollection') return 1;
  if (kind === 'encounterCollection') return 2;
  return 9;
}

function worldDrawerCollectionSort(fields = []) {
  const first = [
    'dueElapsedSeconds',
    'nextPulseElapsedSeconds',
    'dueRound',
    'updatedAt',
    'updated_at',
    'createdAt',
    'created_at'
  ].find((field) => fields.includes(field));
  return first ? [{ field: first, direction: /due|next/i.test(first) ? 'asc' : 'desc' }] : [];
}

function normalizeWorldDrawerRecords(records, kind, source) {
  const list = Array.isArray(records) ? records : [];
  return list.map((record, index) => normalizeWorldDrawerRecord(record, kind, source, index));
}

function normalizeWorldDrawerRecord(record = {}, kind, source, index = 0) {
  const data = record?.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data
    : (record && typeof record === 'object' ? record : { value: record });
  const id = record?.id
    || data.id
    || data.eventId
    || data.encounterId
    || data.worldClockId
    || data.clockId
    || data.triggerEventId
    || `${source}:${kind}:${index}`;
  return {
    id: String(id),
    kind,
    source,
    data,
    createdAt: record?.createdAt || data.createdAt || data.created_at || '',
    updatedAt: record?.updatedAt || data.updatedAt || data.updated_at || data.updatedAtIso || ''
  };
}

function dedupeWorldDrawerRecords(records = []) {
  const seen = new Set();
  const result = [];
  for (const record of records) {
    const key = `${record.kind}:${record.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

async function loadAgentHistoryDrawerData(chatSessionId) {
  await syncActiveChatSnapshot(chatSessionId);
  const [branches, savepoints] = await Promise.all([
    loadWorldlineBranches(chatSessionId),
    loadWorldlineSavepoints(chatSessionId)
  ]);
  return {
    chatSessionId,
    branches,
    savepoints,
    loadedAt: new Date().toISOString()
  };
}

async function syncActiveChatSnapshot(chatSessionId) {
  try {
    const payload = await api(`/v1/app/chats/${encodeURIComponent(chatSessionId)}`);
    if (state.activeChatId === chatSessionId && payload.chat) {
      state.activeChat = payload.chat;
      renderActiveChat();
      updateControls();
    }
  } catch {
    // History can still render from the currently loaded chat snapshot.
  }
}

async function loadWorldlineBranches(chatSessionId) {
  try {
    const payload = await api(`/v1/worldlines/branches?scopeType=app-chat&scopeId=${encodeURIComponent(chatSessionId)}&limit=100`);
    return payload.branches || [];
  } catch {
    return [];
  }
}

async function loadWorldlineSavepoints(chatSessionId) {
  try {
    const payload = await api(`/v1/worldlines/savepoints?scopeType=app-chat&scopeId=${encodeURIComponent(chatSessionId)}&includeSnapshot=false&limit=200`);
    return payload.savepoints || [];
  } catch {
    return [];
  }
}

function renderWorldDrawer() {
  if (!els.worldDrawer) return;
  const tab = state.worldDrawer.activeTab === 'history' ? 'history' : 'clock';
  els.worldDrawerClockTabButton.classList.toggle('active', tab === 'clock');
  els.worldDrawerHistoryTabButton.classList.toggle('active', tab === 'history');
  els.worldDrawerClockTabButton.setAttribute('aria-selected', String(tab === 'clock'));
  els.worldDrawerHistoryTabButton.setAttribute('aria-selected', String(tab === 'history'));
  els.worldClockPanel.hidden = tab !== 'clock';
  els.worldHistoryPanel.hidden = tab !== 'history';
  els.refreshWorldDrawerButton.disabled = !state.activeChatId || state.busy || state.worldDrawer.loading;
  if (tab === 'clock') {
    renderWorldClockContent();
  } else {
    renderAgentHistoryContent();
  }
}

function renderWorldClockContent() {
  const root = els.worldClockContent;
  root.innerHTML = '';
  if (appendWorldDrawerLoadState(root)) return;
  const data = state.worldDrawer.clockData;
  if (!data) {
    root.append(playerActionEmpty('暂无数据。', 'compact'));
    return;
  }
  root.append(renderWorldClockOverview(data));
  root.append(renderWorldRecordSection('世界钟 / 倒计时', data.worldClocks, {
    emptyText: '没有世界钟记录。',
    clock: data.clock
  }));
  root.append(renderWorldRecordSection('时间事件', data.events, {
    emptyText: '没有时间事件记录。',
    clock: data.clock
  }));
  root.append(renderWorldRecordSection('奇遇 / 遭遇', [...data.encounters, ...data.encounterEvents], {
    emptyText: '没有遭遇记录。',
    clock: data.clock
  }));
  root.append(renderWorldRecordSection('触发事件', data.triggerEvents, {
    emptyText: '没有触发事件记录。',
    clock: data.clock
  }));
  for (const source of data.collectionSources || []) {
    root.append(renderWorldRecordSection(source.title, source.records, {
      emptyText: source.error || '这个扩展库暂无记录。',
      clock: data.clock,
      subtitle: source.reason,
      error: source.error
    }));
  }
  if (data.warnings?.length) {
    const warning = playerActionEmpty(`部分工具读取失败：${data.warnings.slice(0, 3).join('；')}`, 'compact');
    root.append(warning);
  }
}

function appendWorldDrawerLoadState(root) {
  if (!state.activeChatId) {
    root.append(playerActionEmpty('先选择一个聊天。', 'compact'));
    return true;
  }
  if (state.worldDrawer.loading) {
    root.append(playerActionEmpty('正在读取当前聊天的数据库和工具输出...', 'compact'));
    return true;
  }
  if (state.worldDrawer.error) {
    root.append(playerActionEmpty(state.worldDrawer.error, 'compact error'));
    return true;
  }
  return false;
}

function renderWorldClockOverview(data = {}) {
  const card = worldDrawerCard('当前世界时间', data.clock?.clockId || data.clock?.sceneId || 'current');
  const clock = data.clock || {};
  const rows = [
    ['阶段', clock.phase || clock.mode || '叙事'],
    ['场景', clock.sceneId],
    ['经过时间', formatDurationSeconds(clock.elapsedSeconds)],
    ['轮数', clock.roundNumber],
    ['回合', clock.turnNumber],
    ['当前遭遇', clock.activeEncounterId]
  ];
  card.append(playerActionGrid(rows));
  return card;
}

function renderWorldRecordSection(title, records = [], {
  emptyText = '无记录',
  subtitle = '',
  clock,
  error = ''
} = {}) {
  const section = document.createElement('section');
  section.className = 'world-record-section';
  const header = document.createElement('div');
  header.className = 'world-record-section-header';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const meta = document.createElement('span');
  meta.textContent = subtitle || `${records.length} 条`;
  header.append(h3, meta);
  section.append(header);
  const list = document.createElement('div');
  list.className = 'world-record-list';
  if (!records.length) {
    list.append(playerActionEmpty(emptyText, `compact${error ? ' error' : ''}`));
  }
  for (const record of records.slice(0, 10)) {
    list.append(renderWorldRecordCard(record, clock));
  }
  if (records.length > 10) {
    list.append(playerActionEmpty(`还有 ${records.length - 10} 条记录。`, 'compact'));
  }
  section.append(list);
  return section;
}

function renderWorldRecordCard(record, clock) {
  const data = record.data || {};
  const card = worldDrawerCard(worldRecordTitle(record), worldRecordSubtitle(record, clock));
  const countdown = worldRecordCountdown(data, clock);
  if (countdown) {
    const badge = document.createElement('span');
    badge.className = `world-countdown-badge${countdown.due ? ' due' : ''}`;
    badge.textContent = countdown.text;
    appendWorldDrawerHeaderBadge(card, badge);
  }
  card.append(playerActionGrid(worldRecordRows(record, clock)));
  return card;
}

function worldDrawerCard(title, subtitle) {
  const card = playerActionCard(title, subtitle);
  card.classList.add('world-record-card');
  return card;
}

function worldRecordTitle(record) {
  const data = record.data || {};
  return String(firstPresent(
    data.name,
    data.title,
    data.summary,
    data.eventId,
    data.encounterId,
    data.worldClockId,
    data.clockId,
    data.triggerType,
    record.id
  ) || '未命名记录').slice(0, 120);
}

function worldRecordSubtitle(record, clock) {
  const data = record.data || {};
  return [
    worldRecordKindLabel(record.kind),
    data.status,
    data.sceneId,
    data.source,
    record.updatedAt ? `更新 ${formatTime(record.updatedAt)}` : '',
    record.source
  ].filter(Boolean).join(' · ');
}

function worldRecordRows(record, clock) {
  const data = record.data || {};
  const countdown = worldRecordCountdown(data, clock);
  const priority = [
    ['倒计时', countdown?.text],
    ['状态', data.status],
    ['类型', firstPresent(data.type, data.eventType, data.triggerType, data.mode, data.kind)],
    ['描述', firstPresent(data.description, data.detail, data.text, data.content)],
    ['结果', firstPresent(data.result, data.outcome, data.resolution)],
    ['阈值', firstPresent(data.threshold, data.difficulty, data.dc)],
    ['权重', firstPresent(data.weight, data.chance, data.luckTier)],
    ['间隔', formatDurationSeconds(data.intervalSeconds || data.pulseIntervalSeconds)],
    ['到期时间', formatWorldDueValue(data, clock)],
    ['关联', firstPresent(data.encounterId, data.questId, data.actorId, data.npcId, data.factionId)]
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const used = new Set(['status', 'type', 'eventType', 'triggerType', 'mode', 'kind', 'description', 'detail', 'text', 'content', 'result', 'outcome', 'resolution', 'threshold', 'difficulty', 'dc', 'weight', 'chance', 'luckTier', 'intervalSeconds', 'pulseIntervalSeconds', 'encounterId', 'questId', 'actorId', 'npcId', 'factionId']);
  const extra = Object.entries(data)
    .filter(([key, value]) => !used.has(key) && value !== undefined && value !== null && value !== '')
    .filter(([key]) => !/^chatSessionId$/i.test(key))
    .slice(0, Math.max(0, 8 - priority.length))
    .map(([key, value]) => [key, value]);
  return [...priority, ...extra].slice(0, 8);
}

function worldRecordKindLabel(kind) {
  if (/clock/i.test(kind)) return '时钟';
  if (/encounter/i.test(kind)) return '遭遇';
  if (/trigger/i.test(kind)) return '触发';
  if (/event/i.test(kind)) return '事件';
  return '记录';
}

function worldRecordCountdown(data = {}, clock = {}) {
  const elapsed = Number(clock?.elapsedSeconds || 0);
  const round = Number(clock?.roundNumber || 0);
  if (data.nextPulseElapsedSeconds !== undefined && data.nextPulseElapsedSeconds !== null && data.nextPulseElapsedSeconds !== '') {
    const remaining = Number(data.nextPulseElapsedSeconds) - elapsed;
    return {
      due: remaining <= 0,
      text: remaining <= 0 ? '已到世界钟触发点' : `${formatDurationSeconds(remaining)} 后触发`
    };
  }
  if (data.dueElapsedSeconds !== undefined && data.dueElapsedSeconds !== null && data.dueElapsedSeconds !== '') {
    const remaining = Number(data.dueElapsedSeconds) - elapsed;
    return {
      due: remaining <= 0,
      text: remaining <= 0 ? '已到期' : `剩余 ${formatDurationSeconds(remaining)}`
    };
  }
  if (data.remainingSeconds !== undefined && data.remainingSeconds !== null && data.remainingSeconds !== '') {
    const remaining = Number(data.remainingSeconds);
    return {
      due: remaining <= 0,
      text: remaining <= 0 ? '已到期' : `剩余 ${formatDurationSeconds(remaining)}`
    };
  }
  if (data.dueRound !== undefined && data.dueRound !== null && data.dueRound !== '') {
    const remainingRounds = Number(data.dueRound) - round;
    return {
      due: remainingRounds <= 0,
      text: remainingRounds <= 0 ? '本轮已到期' : `剩余 ${remainingRounds} 轮`
    };
  }
  return undefined;
}

function formatWorldDueValue(data = {}, clock = {}) {
  if (data.dueElapsedSeconds !== undefined && data.dueElapsedSeconds !== null && data.dueElapsedSeconds !== '') {
    return `${formatDurationSeconds(data.dueElapsedSeconds)} / 当前 ${formatDurationSeconds(clock?.elapsedSeconds || 0)}`;
  }
  if (data.nextPulseElapsedSeconds !== undefined && data.nextPulseElapsedSeconds !== null && data.nextPulseElapsedSeconds !== '') {
    return `${formatDurationSeconds(data.nextPulseElapsedSeconds)} / 当前 ${formatDurationSeconds(clock?.elapsedSeconds || 0)}`;
  }
  if (data.dueRound !== undefined && data.dueRound !== null && data.dueRound !== '') return `第 ${data.dueRound} 轮`;
  return firstPresent(data.dueAt, data.deadlineAt, data.endsAt);
}

function formatDurationSeconds(value) {
  if (value === undefined || value === null || value === '') return '';
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return String(value);
  const absolute = Math.abs(Math.round(seconds));
  const days = Math.floor(absolute / 86400);
  const hours = Math.floor((absolute % 86400) / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const secs = absolute % 60;
  const parts = [
    days ? `${days}天` : '',
    hours ? `${hours}小时` : '',
    minutes ? `${minutes}分` : '',
    !days && !hours && !minutes ? `${secs}秒` : ''
  ].filter(Boolean);
  return `${seconds < 0 ? '-' : ''}${parts.join('') || '0秒'}`;
}

function renderAgentHistoryContent() {
  const root = els.worldHistoryContent;
  root.innerHTML = '';
  if (appendWorldDrawerLoadState(root)) return;
  const worldline = state.worldDrawer.historyData || { branches: [], savepoints: [] };
  root.append(renderWorldlineHistorySummary(worldline));
  const records = buildAgentHistoryRecords(worldline);
  const section = document.createElement('section');
  section.className = 'world-record-section';
  const header = document.createElement('div');
  header.className = 'world-record-section-header';
  const title = document.createElement('h3');
  title.textContent = 'Agent 循环历史';
  const count = document.createElement('span');
  count.textContent = `${records.length} 条`;
  header.append(title, count);
  section.append(header);
  const list = document.createElement('div');
  list.className = 'agent-history-list';
  if (!records.length) {
    list.append(playerActionEmpty('当前聊天还没有可复用的 Agent 循环概要。', 'compact'));
  }
  for (const record of records.slice(0, 40)) {
    list.append(renderAgentHistoryCard(record));
  }
  section.append(list);
  root.append(section);
}

function renderWorldlineHistorySummary(worldline = {}) {
  const activeBranch = (worldline.branches || []).find((branch) => branch.active);
  const card = worldDrawerCard('时间线状态', activeBranch?.name || activeBranch?.id || '当前聊天');
  card.append(playerActionGrid([
    ['活动分支', activeBranch ? `${activeBranch.name || activeBranch.id}${activeBranch.id ? ` (${activeBranch.id})` : ''}` : '未读取到分支'],
    ['分支数', worldline.branches?.length || 0],
    ['存档数', worldline.savepoints?.length || 0],
    ['分支头存档', activeBranch?.headSavepointId],
    ['读取时间', formatTime(worldline.loadedAt)]
  ]));
  return card;
}

function buildAgentHistoryRecords(worldline = {}) {
  const messages = state.activeChat?.messages || [];
  const savepoints = worldline.savepoints || [];
  const branches = worldline.branches || [];
  const savepointById = new Map(savepoints.map((savepoint) => [savepoint.id, savepoint]));
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const userByTurn = new Map();
  for (const message of messages) {
    const metadata = messageMetadata(message);
    const turnId = metadata.agentLoopTurnId || metadata.agentLoop?.turnId;
    if (message.role === 'user' && turnId) userByTurn.set(turnId, message);
  }
  const records = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => {
      const metadata = messageMetadata(message);
      const loop = metadata.agentLoop;
      if (!loop || typeof loop !== 'object') return undefined;
      const turnId = metadata.agentLoopTurnId || loop.turnId || '';
      const savepoint = metadata.savepointId ? savepointById.get(metadata.savepointId) : findSavepointForTurn(savepoints, turnId);
      const branch = savepoint?.branchId ? branchById.get(savepoint.branchId) : branches.find((candidate) => candidate.active);
      return {
        id: message.id,
        type: 'committed',
        status: agentLoopHistoryStatus(loop),
        timestamp: message.createdAt || message.updatedAt,
        turnId,
        messageId: message.id,
        userMessage: userByTurn.get(turnId),
        loop,
        savepoint,
        branch,
        trace: metadata.agentLoopTrace
      };
    })
    .filter(Boolean);
  records.push(...buildLiveAgentHistoryRecords(records));
  return records.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
}

function buildLiveAgentHistoryRecords(committedRecords = []) {
  const committedTurnIds = new Set(committedRecords.map((record) => record.turnId).filter(Boolean));
  const groups = new Map();
  for (const event of state.agentProgress.events || []) {
    if (event.chatSessionId !== state.activeChatId || !event.turnId || committedTurnIds.has(event.turnId)) continue;
    const group = groups.get(event.turnId) || {
      id: `live:${event.turnId}`,
      type: 'running',
      status: 'running',
      turnId: event.turnId,
      timestamp: event.createdAt || new Date().toISOString(),
      events: []
    };
    group.events.push(event);
    group.timestamp = event.createdAt || group.timestamp;
    if (event.status === 'error') group.status = 'error';
    groups.set(event.turnId, group);
  }
  return [...groups.values()];
}

function renderAgentHistoryCard(record) {
  const card = worldDrawerCard(agentHistoryTitle(record), agentHistorySubtitle(record));
  const status = document.createElement('span');
  status.className = `agent-history-status ${record.status}`;
  status.textContent = agentHistoryStatusLabel(record.status);
  appendWorldDrawerHeaderBadge(card, status);
  card.append(playerActionGrid(agentHistoryRows(record)));
  const phases = agentHistoryPhaseList(record);
  if (phases.length) {
    card.append(playerActionList('阶段概要', phases, (phase) => ({
      title: phase.title,
      meta: phase.meta,
      detail: phase.detail
    })));
  }
  return card;
}

function agentHistoryTitle(record) {
  if (record.type === 'running') return `进行中 · ${record.turnId}`;
  return firstPresent(record.loop?.configId, record.loop?.profileId, record.turnId, record.messageId) || 'Agent 循环';
}

function agentHistorySubtitle(record) {
  return [
    formatTime(record.timestamp),
    record.turnId,
    record.branch?.name || record.branch?.id,
    record.savepoint?.label || record.savepoint?.id
  ].filter(Boolean).join(' · ');
}

function agentHistoryRows(record) {
  if (record.type === 'running') {
    const labels = record.events.map((event) => event.progressLabel || fallbackAgentProgressLabel(event)).filter(Boolean);
    const last = record.events.at(-1);
    return [
      ['时间戳', formatTime(record.timestamp)],
      ['状态', agentHistoryStatusLabel(record.status)],
      ['当前模块', labels.at(-1)],
      ['最近概要', labels.slice(-4).join(' / ')],
      ['错误', last?.error?.message || last?.error]
    ];
  }
  const loop = record.loop || {};
  return [
    ['时间戳', formatTime(record.timestamp)],
    ['状态', agentHistoryStatusLabel(record.status)],
    ['循环配置', loop.configId],
    ['Profile', loop.profileId],
    ['存档', record.savepoint?.label || record.savepoint?.id],
    ['分支', record.branch?.name || record.branch?.id],
    ['玩家输入', truncateWorldDrawerText(record.userMessage?.content, 180)],
    ['警告', truncateWorldDrawerText(normalizeHistoryMessages(loop.warnings).join('；'), 180)],
    ['错误', truncateWorldDrawerText(normalizeHistoryMessages(loop.errors).join('；'), 180)]
  ];
}

function agentHistoryPhaseList(record) {
  if (record.type === 'running') {
    return record.events.slice(-8).map((event) => ({
      title: event.progressLabel || fallbackAgentProgressLabel(event),
      meta: [event.phaseId, event.toolId, event.status].filter(Boolean).join(' · '),
      detail: event.error?.message || event.warning?.message || ''
    }));
  }
  const loop = record.loop || {};
  const phases = Array.isArray(loop.phases) && loop.phases.length
    ? loop.phases.map((phase) => ({
      title: phase.progressLabel || phase.title || phase.phaseId || '阶段',
      meta: [phase.phaseId, phase.status, phase.toolCallCount ? `${phase.toolCallCount} tools` : ''].filter(Boolean).join(' · '),
      detail: phase.durationMs ? `${phase.durationMs}ms` : ''
    }))
    : [];
  if (phases.length) return phases;
  return (loop.steps || []).map((step) => ({
    title: step.title || step.stepId || '步骤',
    meta: [step.stepId, step.status, step.profileId].filter(Boolean).join(' · '),
    detail: step.durationMs ? `${step.durationMs}ms` : ''
  }));
}

function appendWorldDrawerHeaderBadge(card, badge) {
  const header = card.querySelector('.player-info-card-header');
  const subtitle = header?.querySelector('small');
  if (!header) return;
  if (subtitle) {
    header.insertBefore(badge, subtitle);
  } else {
    header.append(badge);
  }
}

function agentLoopHistoryStatus(loop = {}) {
  if (normalizeHistoryMessages(loop.errors).length) return 'error';
  if (normalizeHistoryMessages(loop.warnings).length) return 'warning';
  return 'success';
}

function agentHistoryStatusLabel(status) {
  if (status === 'error') return '异常';
  if (status === 'warning') return '警告';
  if (status === 'running') return '进行中';
  return '完成';
}

function normalizeHistoryMessages(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return item.message || item.reason || item.error || compactObjectText(item);
  }).filter(Boolean);
}

function findSavepointForTurn(savepoints = [], turnId = '') {
  if (!turnId) return undefined;
  return savepoints.find((savepoint) => savepoint.metadata?.turnId === turnId
    || savepoint.label?.includes(turnId)
    || savepoint.description?.includes(turnId));
}

function truncateWorldDrawerText(value, limit = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function messageMetadata(message = {}) {
  if (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)) {
    return message.metadata;
  }
  if (typeof message.metadata === 'string') {
    try {
      const parsed = JSON.parse(message.metadata);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isCombatToolId(toolId) {
  return String(toolId || '').startsWith('system.combat.');
}

function isCombatTerminalStatus(status) {
  return COMBAT_TERMINAL_STATUSES.has(String(status || '').toLowerCase());
}

function isCombatOverlayLocked() {
  return state.combatOverlay.open
    && state.combatOverlay.battle
    && !isCombatTerminalStatus(state.combatOverlay.battle.data?.status || state.combatOverlay.battle.status);
}

function handleCombatProgressEvent(event = {}) {
  if (isCombatToolId(event.toolId)) {
    state.combatOverlay.lastCombatToolId = event.toolId;
    const failed = event.status === 'error' || event.type?.endsWith('_failed');
    const finished = event.status === 'success' || event.type?.endsWith('_finished') || failed;
    if (event.status === 'running' || event.type?.endsWith('_started')) {
      openCombatOverlay({ loading: true, statusText: combatToolProgressText(event.toolId) });
    }
    if (finished) {
      openCombatOverlay({
        loading: !failed,
        statusText: failed
          ? `战斗工具出了问题：${event.error?.message || event.error || event.progressLabel || event.toolId}`
          : `${combatToolLabel(event.toolId)}已更新`
      });
      scheduleCombatRefresh(failed ? 1200 : 180);
    }
    return;
  }
  if (state.combatOverlay.open && event.type === 'settlement_changed') {
    scheduleCombatRefresh(240);
  }
}

function combatToolProgressText(toolId) {
  if (/start_battle/.test(toolId)) return '正在进入战斗...';
  if (/resolve_action/.test(toolId)) return '正在结算玩家动作...';
  if (/resolve_enemy_turn|select_enemy_action/.test(toolId)) return '正在结算敌方行动...';
  if (/judge_special_action/.test(toolId)) return '正在裁定特殊动作...';
  if (/end_battle/.test(toolId)) return '正在结束战斗...';
  return '正在读取战斗模块...';
}

function combatToolLabel(toolId) {
  if (/start_battle/.test(toolId)) return '战斗开始';
  if (/resolve_action/.test(toolId)) return '玩家动作';
  if (/resolve_enemy_turn|select_enemy_action/.test(toolId)) return '敌方行动';
  if (/judge_special_action/.test(toolId)) return '特殊动作';
  if (/end_battle/.test(toolId)) return '战斗结算';
  return '战斗模块';
}

function isPersuasionToolId(toolId) {
  return String(toolId || '').startsWith('system.persuasion.');
}

function handlePersuasionProgressEvent(event = {}) {
  if (event.chatSessionId && state.activeChatId && event.chatSessionId !== state.activeChatId) return;
  if (event.routerItem && isPersuasionRouterItem(event.routerItem)) {
    maybeOpenPersuasionOverlayFromRouterItem(normalizeRouterReviewItem({
      ...event.routerItem,
      turnId: event.routerItem.turnId || event.turnId,
      chatSessionId: event.routerItem.chatSessionId || event.chatSessionId
    }), event);
    return;
  }
  if (isPersuasionToolId(event.toolId) && (event.status === 'running' || event.type?.endsWith('_started'))) {
    maybeOpenPersuasionOverlayFromRouterItem(normalizeRouterReviewItem({
      id: event.routerItemId || routerReviewItemIdFromProgress(event) || `persuasion:${event.turnId || Date.now()}`,
      turnId: event.turnId,
      chatSessionId: event.chatSessionId,
      kind: 'module',
      status: 'running',
      toolId: event.toolId,
      title: event.progressLabel || '说服',
      text: event.progressLabel || '说服模块正在等待玩家说服内容。',
      skippable: true
    }), event);
  }
}

function openCombatOverlay({ loading = false, statusText = '' } = {}) {
  const wasOpen = state.combatOverlay.open;
  state.combatOverlay.open = true;
  state.combatOverlay.loading = loading;
  if (statusText) state.combatOverlay.statusText = statusText;
  if (!wasOpen) {
    emitFrontendEvent('combat:start', {
      battle: state.combatOverlay.battle?.data || state.combatOverlay.battle || undefined,
      statusText
    });
  }
  renderCombatOverlay();
}

function closeCombatOverlay() {
  if (isCombatOverlayLocked()) {
    state.combatOverlay.statusText = combatEnemiesDefeated()
      ? '敌方已倒下，请先点击胜利退出完成结算。'
      : '战斗未结束，不能关闭。可以选择行动或投降。';
    renderCombatOverlay();
    return;
  }
  clearTimeout(state.combatOverlay.refreshTimer);
  clearTimeout(state.combatOverlay.actionCooldownTimer);
  state.combatOverlay.open = false;
  state.combatOverlay.specialOpen = false;
  state.combatOverlay.statusText = '';
  renderCombatOverlay();
  releaseRouterReviewItems(isCombatRouterItem, 'success', 250);
}

function scheduleCombatRefresh(delay = 250) {
  clearTimeout(state.combatOverlay.refreshTimer);
  state.combatOverlay.refreshTimer = setTimeout(() => {
    void refreshCombatOverlayState({ autoOpen: state.combatOverlay.open });
  }, delay);
}

async function refreshCombatOverlayState({ autoOpen = false, battleId = '' } = {}) {
  if (!state.activeChatId || !toolAvailable('system.combat.list_battles')) return;
  const chatSessionId = state.activeChatId;
  if (autoOpen) {
    state.combatOverlay.open = true;
    state.combatOverlay.loading = true;
    renderCombatOverlay();
  }
  try {
    const battle = await loadCombatBattle(chatSessionId, battleId || state.combatOverlay.battle?.data?.battleId || state.combatOverlay.battle?.battleId || '');
    if (!battle) {
      if (autoOpen) state.combatOverlay.statusText = '战斗模块已调用，但还没有 active battle。';
      state.combatOverlay.loading = false;
      renderCombatOverlay();
      return;
    }
    const data = battle.data || battle;
    const [events, combatants] = await Promise.all([
      loadCombatEvents(chatSessionId, data.battleId),
      loadCombatants(chatSessionId, data)
    ]);
    const actions = await loadCombatPlayerActions(chatSessionId, data, combatants);
    if (state.activeChatId !== chatSessionId) return;
    state.combatOverlay.battle = battle;
    state.combatOverlay.events = events;
    state.combatOverlay.allies = combatants.allies;
    state.combatOverlay.enemies = combatants.enemies;
    state.combatOverlay.actorId = combatants.actorId;
    state.combatOverlay.targetId = combatants.targetId;
    state.combatOverlay.actions = actions;
    state.combatOverlay.stageVisual = await resolveCombatStageVisual(chatSessionId, data, combatants);
    state.combatOverlay.loading = false;
    state.combatOverlay.error = '';
    state.combatOverlay.open = autoOpen || state.combatOverlay.open || !isCombatTerminalStatus(data.status);
    if (isCombatTerminalStatus(data.status)) {
      state.combatOverlay.statusText = `战斗已结束：${combatStatusLabel(data.status)}`;
      releaseRouterReviewItems(isCombatRouterItem, 'success', 900);
    } else if (combatEnemiesDefeated(combatants.enemies)) {
      state.combatOverlay.statusText = '敌方血量已归零，可以胜利退出。';
    } else if (!state.combatOverlay.statusText) {
      state.combatOverlay.statusText = '等待玩家行动。';
    }
  } catch (error) {
    state.combatOverlay.error = error.message || String(error);
    state.combatOverlay.loading = false;
  } finally {
    renderCombatOverlay();
  }
}

async function loadCombatBattle(chatSessionId, preferredBattleId = '') {
  if (preferredBattleId && toolAvailable('system.combat.get_battle')) {
    try {
      const current = await executeCombatTool('system.combat.get_battle', { chatSessionId, battleId: preferredBattleId });
      const status = current?.data?.status || current?.status;
      if (current && !isCombatTerminalStatus(status)) return current;
      if (current && state.combatOverlay.open) return current;
    } catch {
      // Fall back to active battle listing.
    }
  }
  const active = await executeCombatTool('system.combat.list_battles', {
    chatSessionId,
    status: 'active',
    limit: 10
  });
  const activeRecords = active.records || [];
  if (activeRecords.length) return activeRecords[0];
  if (!state.combatOverlay.open) return undefined;
  const recent = await executeCombatTool('system.combat.list_battles', {
    chatSessionId,
    limit: 10
  });
  return (recent.records || [])[0];
}

async function loadCombatEvents(chatSessionId, battleId) {
  if (!battleId || !toolAvailable('system.combat.list_events')) return [];
  try {
    const output = await executeCombatTool('system.combat.list_events', {
      chatSessionId,
      battleId,
      limit: 80
    });
    return output.records || [];
  } catch {
    return [];
  }
}

async function loadCombatants(chatSessionId, battle = {}) {
  const allyIds = normalizeCombatIdList(battle.allyIds);
  const enemyIds = normalizeCombatIdList(battle.enemyIds);
  const participantIds = normalizeCombatIdList(battle.participantIds);
  const fallbackAllyIds = allyIds.length ? allyIds : participantIds.filter((id) => !enemyIds.includes(id)).slice(0, 1);
  const ids = [...new Set([...fallbackAllyIds, ...enemyIds])];
  const states = await Promise.all(ids.map((id) => loadCombatantState(chatSessionId, battle.sceneId, id)));
  const byId = new Map(states.filter(Boolean).map((state) => [combatantId(state), state]));
  const allies = fallbackAllyIds.map((id) => byId.get(id) || fallbackCombatant(id, battle.sceneId));
  const enemies = enemyIds.map((id) => byId.get(id) || fallbackCombatant(id, battle.sceneId));
  const actorId = allies[0] ? combatantId(allies[0]) : fallbackAllyIds[0] || '';
  const aliveEnemy = enemies.find((enemy) => !combatantDefeated(enemy));
  const targetId = aliveEnemy ? combatantId(aliveEnemy) : enemies[0] ? combatantId(enemies[0]) : enemyIds[0] || '';
  return { allies, enemies, actorId, targetId };
}

async function loadCombatantState(chatSessionId, sceneId, actorId) {
  if (!actorId || !toolAvailable('system.npc_state.get_state')) return fallbackCombatant(actorId, sceneId);
  try {
    return await executeCombatTool('system.npc_state.get_state', {
      chatSessionId,
      sceneId: sceneId || 'current',
      npcId: actorId
    });
  } catch {
    return fallbackCombatant(actorId, sceneId);
  }
}

function fallbackCombatant(actorId, sceneId) {
  return {
    id: actorId,
    data: {
      npcId: actorId,
      name: actorId,
      sceneId,
      values: {}
    }
  };
}

async function loadCombatPlayerActions(chatSessionId, battle = {}, combatants = {}) {
  if (!toolAvailable('system.combat.list_player_actions')) return [];
  const actorId = combatants.actorId || state.combatOverlay.actorId || normalizeCombatIdList(battle.allyIds)[0] || '';
  const targetId = combatants.targetId || state.combatOverlay.targetId || normalizeCombatIdList(battle.enemyIds)[0] || '';
  const target = (combatants.enemies || state.combatOverlay.enemies || []).find((enemy) => combatantId(enemy) === targetId);
  const targetAc = combatantArmorClass(target);
  if (!actorId) return [];
  try {
    const listed = await executeCombatTool('system.combat.list_player_actions', {
      chatSessionId,
      sceneId: battle.sceneId || 'current',
      battleId: battle.battleId,
      actorId,
      targetId,
      targetAc,
      includeBasicAttack: true
    });
    return listed.choices || [];
  } catch (error) {
    return [{
      actionId: 'basic_attack',
      name: '基础攻击',
      description: error.message || '无法读取技能，使用默认基础攻击。',
      ready: true,
      actionKind: 'attack',
      mode: 'attack',
      requiresTarget: true
    }];
  }
}

async function resolveCombatStageVisual(chatSessionId, battle = {}, combatants = {}) {
  const target = combatStageTargetCombatant(combatants);
  const targetId = target ? combatantId(target) : combatants.targetId || normalizeCombatIdList(battle.enemyIds)[0] || '';
  const targetData = target?.data || target || {};
  const sceneId = battle.sceneId || targetData.sceneId || 'current';
  if (!targetId && !targetData.name) return emptyStageVisualState();
  return resolveNpcStageVisual({
    chatId: chatSessionId,
    sceneId,
    targetIds: [targetId, targetData.npcId, targetData.actorId, targetData.id],
    targetNames: [targetData.name, targetData.displayName],
    directRecords: target ? [target] : []
  });
}

function combatStageTargetCombatant(combatants = {}) {
  const enemies = combatants.enemies || state.combatOverlay.enemies || [];
  const targetId = combatants.targetId || state.combatOverlay.targetId || '';
  return enemies.find((enemy) => combatantId(enemy) === targetId)
    || enemies.find((enemy) => !combatantDefeated(enemy))
    || enemies[0];
}

async function refreshPersuasionStageVisual() {
  const prompt = state.persuasionOverlay;
  if (!prompt.open) return;
  const key = [
    prompt.chatSessionId || state.activeChatId || '',
    prompt.sceneId || 'current',
    ...prompt.targetIds,
    ...prompt.targetNames
  ].join(':');
  prompt.stageVisual = {
    ...emptyStageVisualState(),
    key,
    loading: true,
    sceneId: prompt.sceneId || 'current'
  };
  renderPersuasionOverlay();
  try {
    const visual = await resolveNpcStageVisual({
      chatId: prompt.chatSessionId || state.activeChatId,
      sceneId: prompt.sceneId || 'current',
      targetIds: prompt.targetIds,
      targetNames: prompt.targetNames
    });
    if (!state.persuasionOverlay.open || state.persuasionOverlay.stageVisual.key !== key) return;
    state.persuasionOverlay.stageVisual = {
      ...visual,
      key,
      loading: false
    };
  } catch (error) {
    if (!state.persuasionOverlay.open || state.persuasionOverlay.stageVisual.key !== key) return;
    state.persuasionOverlay.stageVisual = {
      ...emptyStageVisualState(),
      key,
      loading: false,
      error: error.message || String(error),
      sceneId: prompt.sceneId || 'current'
    };
  }
  renderPersuasionOverlay();
}

async function resolveNpcStageVisual({
  chatId,
  sceneId = 'current',
  targetIds = [],
  targetNames = [],
  directRecords = []
} = {}) {
  if (!chatId) return emptyStageVisualState();
  const ids = compactUnique(targetIds.map(normalizeSceneVisualTargetId));
  const names = compactUnique(targetNames.map((name) => String(name || '').trim()));
  const nameTokens = names.map(normalizeDialogueSpeaker).filter(Boolean);
  const scenes = compactUnique([sceneId || 'current', 'current']);
  const mountedRecords = [];
  for (const currentSceneId of scenes) {
    try {
      mountedRecords.push(...await loadSceneVisualMountedNpcs(chatId, currentSceneId));
    } catch {
      // Missing scene NPC tools should not block module overlays.
    }
  }
  const records = [
    ...directRecords.map((record) => normalizeSceneVisualRecord(record, 'npc')).filter(Boolean),
    ...mountedRecords.map((record) => normalizeSceneVisualRecord(record, 'npc')).filter(Boolean)
  ].filter((record) => record && sceneVisualRecordVisible(record.data));
  let candidates = records.filter((record) => npcStageVisualRecordMatches(record, ids, nameTokens));
  if (candidates.length === 0 && ids.length > 0) {
    candidates = ids.map((id, index) => ({
      id,
      data: {
        id,
        npcId: id,
        name: names[index] || names[0] || id,
        sceneId
      }
    }));
  }
  if (candidates.length === 0 && ids.length === 0 && nameTokens.length === 0) {
    candidates = records.filter((record) => extractSceneVisualUrl(record.data, 'npc'));
  }
  if (candidates.length === 0) return emptyStageVisualState();

  for (const record of candidates) {
    const url = extractSceneVisualUrl(record.data, 'npc');
    if (url) return stageVisualFromRecord(record, url, 'direct');
  }

  const assetMap = await resolveSceneVisualAssetReferences(candidates, [], sceneId);
  for (const record of candidates) {
    const url = visualAssetUrlForRecord(assetMap, 'npc', npcVisualTargetIds(record), SCENE_NPC_VISUAL_SLOTS);
    if (url) return stageVisualFromRecord(record, url, 'visual-assets');
  }
  return emptyStageVisualState();
}

function npcStageVisualRecordMatches(record, targetIds = [], targetNames = []) {
  if (targetIds.length === 0 && targetNames.length === 0) return true;
  const data = record?.data || {};
  const idValues = npcVisualTargetIds(record).map((value) => String(value || '').trim());
  if (targetIds.some((targetId) => idValues.includes(targetId))) return true;
  const nameValues = [
    data.name,
    data.displayName,
    data.npcId,
    data.actorId,
    ...(Array.isArray(data.aliases) ? data.aliases : [])
  ].map(normalizeDialogueSpeaker).filter(Boolean);
  return targetNames.some((target) => nameValues.some((value) => value === target || target.includes(value) || value.includes(target)));
}

function stageVisualFromRecord(record, url, source) {
  const data = record?.data || {};
  return {
    ...emptyStageVisualState(),
    url,
    name: data.name || data.displayName || data.npcId || record?.id || 'NPC',
    targetId: data.npcId || data.actorId || record?.id || '',
    sceneId: data.sceneId || '',
    source
  };
}

function renderModuleStageVisual(container, visual = {}, { emptyLabel = '暂无图片资源' } = {}) {
  if (!container) return;
  container.innerHTML = '';
  container.classList.remove('loading', 'image-broken');
  container.dataset.source = visual.source || '';
  container.dataset.targetId = visual.targetId || '';
  if (visual.loading) {
    container.hidden = false;
    container.classList.add('loading');
    const label = document.createElement('span');
    label.className = 'module-stage-visual-status';
    label.textContent = '正在读取目标图片...';
    container.append(label);
    return;
  }
  if (!visual.url) {
    container.hidden = true;
    container.title = visual.error || emptyLabel;
    return;
  }
  container.hidden = false;
  container.title = visual.name || emptyLabel;
  const image = document.createElement('img');
  image.src = visual.url;
  image.alt = `${visual.name || '目标 NPC'} CG`;
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    container.classList.add('image-broken');
  });
  const label = document.createElement('span');
  label.className = 'module-stage-visual-label';
  label.textContent = visual.name || '目标 NPC';
  container.append(image, label);
}

function persuasionRouterVisualPrompt(item = {}) {
  const input = item.input || item.metadata || {};
  return {
    targetIds: compactUnique([
      input.targetNpcId,
      input.npcId,
      input.targetId,
      input.target?.id,
      input.target?.npcId,
      input.actorId,
      input.enemyId
    ].map(normalizeSceneVisualTargetId)),
    targetNames: compactUnique([
      input.targetName,
      input.npcName,
      input.target?.name,
      input.target?.displayName,
      persuasionRouterTargetText(item)
    ])
  };
}

function persuasionPromptVisualTargets(prompt = {}) {
  return {
    ids: compactUnique([
      ...(Array.isArray(prompt.targetIds) ? prompt.targetIds : []),
      prompt.targetNpcId,
      prompt.npcId,
      prompt.targetId,
      prompt.target?.id,
      prompt.target?.npcId
    ].map(normalizeSceneVisualTargetId)),
    names: compactUnique([
      ...(Array.isArray(prompt.targetNames) ? prompt.targetNames : []),
      prompt.targetName,
      prompt.npcName,
      prompt.target?.name,
      prompt.target?.displayName,
      prompt.targetText
    ])
  };
}

async function executeCombatTool(toolId, input = {}, extraContext = {}) {
  return executeTool(toolId, input, buildManagedToolExecutionContext({
    source: 'web-ui.combat-overlay',
    authorization: true,
    ...extraContext
  }));
}

async function executeDebugTool(toolId, input = {}) {
  return executeTool(toolId, input, buildManagedToolExecutionContext({
    source: 'web-ui.debug-panel',
    authorization: true
  }));
}

function openDebugPanel() {
  renderDebugPanelControls();
  if (!els.debugPanelDialog.open) {
    els.debugPanelDialog.show();
  }
}

function toggleDebugCombatWinButton() {
  state.debugPanel.showCombatWinButton = Boolean(els.debugCombatWinToggle.checked);
  localStorage.setItem(COMBAT_DEBUG_WIN_KEY, String(state.debugPanel.showCombatWinButton));
  renderDebugPanelControls();
  renderCombatOverlay();
}

function setDebugPanelStatus(text, kind = '') {
  state.debugPanel.status = text || '';
  state.debugPanel.statusKind = kind;
  renderDebugPanelControls();
}

function renderDebugPanelControls() {
  if (!els.debugPanelStatus) return;
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle || {};
  const hasActiveBattle = Boolean(battle.battleId) && !isCombatTerminalStatus(battle.status);
  const combatToolsReady = toolAvailable('system.combat.start_battle')
    && toolAvailable('system.npc_state.patch_state');
  els.debugCombatWinToggle.checked = state.debugPanel.showCombatWinButton;
  els.debugStartCombatButton.disabled = state.debugPanel.loading || !state.activeChatId || !combatToolsReady;
  els.debugOpenPersuasionButton.disabled = state.debugPanel.loading || !state.activeChatId;
  els.debugOpenDiceButton.disabled = state.debugPanel.loading;
  els.debugOpenAdjudicationButton.disabled = state.debugPanel.loading;
  els.combatDebugWinButton.disabled = state.debugPanel.loading
    || state.combatOverlay.loading
    || !hasActiveBattle
    || !toolAvailable('system.combat.end_battle');
  els.debugPanelStatus.textContent = state.debugPanel.status || '选择一个调试动作。';
  els.debugPanelStatus.dataset.status = state.debugPanel.statusKind || '';
}

async function startDebugCombat() {
  if (state.debugPanel.loading) return;
  if (!state.activeChatId) {
    setDebugPanelStatus('先选择一个聊天。', 'error');
    return;
  }
  if (!toolAvailable('system.combat.start_battle') || !toolAvailable('system.npc_state.patch_state')) {
    setDebugPanelStatus('缺少战斗或 NPC 状态工具，不能创建调试战斗。', 'error');
    return;
  }

  state.debugPanel.loading = true;
  setDebugPanelStatus('正在准备调试战斗数据...');
  try {
    await refreshCombatOverlayState({ autoOpen: false });
    if (isCombatOverlayLocked()) {
      openCombatOverlay({ statusText: '已有战斗进行中。' });
      setDebugPanelStatus('已有战斗进行中，可以直接使用战斗界面。');
      return;
    }

    const sceneId = 'debug_arena';
    const battleId = `debug_battle_${Date.now().toString(36)}`;
    const playerId = 'debug_player';
    const enemyId = `debug_enemy_${Date.now().toString(36)}`;
    await seedDebugCombatant({
      sceneId,
      npcId: playerId,
      name: 'Debug 玩家',
      actorType: 'player',
      isPlayer: true,
      values: { hp: 18, maxHp: 18, armorClass: 13, speed: 30, attackModifier: 20, damageAmount: 4 },
      statusBar: {
        conditions: ['专注'],
        inspiration: 2,
        speed: 30,
        combatModifiers: {
          prepared: { name: '备战', acBonus: 1 }
        }
      },
      skillBar: {
        summary: '大量技能显示与结算测试',
        actions: buildDebugCombatActions()
      },
      resources: {
        combat: {
          actions: buildDebugCombatActions()
        },
        skillUses: {
          inspiration_point: { name: '激励点', current: 2, max: 2 },
          second_wind: { name: '复苏', current: 1, max: 1 }
        },
        spellSlots: {
          level1: { name: '1环', current: 2, max: 2 },
          level2: { name: '2环', current: 1, max: 1 }
        },
        ammo: {
          arrows: { name: '箭矢', current: 18, max: 20 }
        },
        cooldowns: {
          power_strike: { name: '强击', remainingTurns: 1, maxTurns: 3, ready: false }
        },
        consumables: {
          potion_healing: { name: '治疗药水', current: 2, max: 2 }
        }
      }
    });
    await seedDebugCombatant({
      sceneId,
      npcId: enemyId,
      name: 'Debug 训练假人',
      actorType: 'npc',
      isPlayer: false,
      values: { hp: 16, maxHp: 16, armorClass: 11, speed: 20, attackModifier: 8, damageAmount: 3 },
      statusBar: {
        conditions: ['警戒'],
        combatModifiers: {
          training: { name: '训练假人', acBonus: 0 }
        }
      },
      resources: {
        skillUses: {
          slam: { name: '猛击', current: 2, max: 2 }
        },
        cooldowns: {
          heavy_swing: { name: '重摆', remainingTurns: 2, maxTurns: 2, ready: false }
        }
      }
    });
    if (toolAvailable('system.scene_npcs.mount_npc')) {
      await executeDebugTool('system.scene_npcs.mount_npc', {
        chatSessionId: state.activeChatId,
        sceneId,
        npcId: enemyId,
        name: 'Debug 训练假人',
        actorType: 'npc',
        status: 'present',
        visibility: 'visible',
        disposition: 'hostile',
        portraitUrl: debugNpcPortraitDataUrl('combat'),
        summary: 'Debug 战斗目标，用于验证战斗目标图片绑定。',
        source: 'web-ui.debug-panel',
        orderIndex: 10
      });
    }
    if (toolAvailable('system.resources.reset_action_economy')) {
      await executeDebugTool('system.resources.reset_action_economy', {
        chatSessionId: state.activeChatId,
        sceneId,
        npcId: playerId,
        movementMax: 30
      });
      await executeDebugTool('system.resources.reset_action_economy', {
        chatSessionId: state.activeChatId,
        sceneId,
        npcId: enemyId,
        movementMax: 20
      });
    }

    await executeDebugTool('system.combat.start_battle', {
      chatSessionId: state.activeChatId,
      sceneId,
      battleId,
      name: 'Debug 战斗',
      status: 'active',
      shouldStartBattle: true,
      participantIds: [playerId, enemyId],
      allyIds: [playerId],
      enemyIds: [enemyId],
      objective: '测试战斗前端和按钮状态。',
      stakes: '调试战斗，不写入正式剧情后果。',
      sourceText: 'Debug 面板手动创建战斗。',
      useLlm: false,
      metadata: {
        debug: true,
        roundNumber: 1,
        turnActorId: playerId,
        source: 'web-ui.debug-panel'
      }
    });
    openCombatOverlay({ loading: true, statusText: 'Debug 战斗已创建，正在读取战斗数据...' });
    await refreshCombatOverlayState({ autoOpen: true, battleId });
    setDebugPanelStatus('Debug 战斗已开始。');
  } catch (error) {
    setDebugPanelStatus(error.message || String(error), 'error');
    showToast(error.message || String(error));
  } finally {
    state.debugPanel.loading = false;
    renderDebugPanelControls();
  }
}

async function openDebugPersuasionOverlay() {
  if (!state.activeChatId) {
    setDebugPanelStatus('先选择一个聊天。', 'error');
    return;
  }
  const sceneId = 'current';
  const targetNpcId = 'debug_persuasion_target';
  const targetName = 'Debug 谈判对象';
  state.debugPanel.loading = true;
  setDebugPanelStatus('正在准备 Debug 说服对象...');
  try {
    if (toolAvailable('system.scene_npcs.mount_npc')) {
      await executeDebugTool('system.scene_npcs.mount_npc', {
        chatSessionId: state.activeChatId,
        sceneId,
        npcId: targetNpcId,
        name: targetName,
        actorType: 'npc',
        status: 'present',
        visibility: 'visible',
        disposition: 'wary',
        portraitUrl: debugNpcPortraitDataUrl('persuasion'),
        summary: 'Debug 说服目标，用于验证说服目标图片绑定。',
        source: 'web-ui.debug-panel',
        orderIndex: 20
      });
    }
    if (els.debugPanelDialog.open) {
      els.debugPanelDialog.close();
    }
    openPersuasionOverlay({
      routerItemId: '',
      chatSessionId: state.activeChatId,
      sceneId,
      title: 'Debug 说服',
      subtitle: '调试说服前端与裁决弹窗',
      sourceText: 'Debug：玩家尝试说服对方透露旧仓库的钥匙下落。',
      targetNpcId,
      targetName,
      targetText: `${targetName} / 由裁决模块读取上下文判断`,
      stageText: '',
      initialSpeech: '我知道你不想惹麻烦。可钥匙如果继续藏着，今晚巡夜队会先查到你这里。我可以替你把责任挡下来，只需要你告诉我钥匙现在在哪。',
      debug: true
    });
    setDebugPanelStatus('已打开说服界面。');
  } catch (error) {
    setDebugPanelStatus(error.message || String(error), 'error');
    showToast(error.message || String(error));
  } finally {
    state.debugPanel.loading = false;
    renderDebugPanelControls();
  }
}

function debugNpcPortraitDataUrl(kind = 'combat') {
  const isPersuasion = kind === 'persuasion';
  const accent = isPersuasion ? '#5fb893' : '#c99a43';
  const shadow = isPersuasion ? '#16382d' : '#3d2b12';
  const label = isPersuasion ? 'TARGET' : 'ENEMY';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 560">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#1d1b22"/>
          <stop offset="0.52" stop-color="${shadow}"/>
          <stop offset="1" stop-color="#07070a"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="32%" r="55%">
          <stop offset="0" stop-color="${accent}" stop-opacity="0.65"/>
          <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="420" height="560" rx="28" fill="url(#bg)"/>
      <rect width="420" height="560" rx="28" fill="url(#glow)"/>
      <circle cx="210" cy="154" r="74" fill="#f5dfb3"/>
      <path d="M122 500c10-123 51-193 88-193s78 70 88 193" fill="${accent}"/>
      <path d="M106 248c34-32 58-48 104-48s70 16 104 48c-14 66-43 99-104 99s-90-33-104-99Z" fill="#101015"/>
      <path d="M154 168c31-90 93-90 124 0-40-25-84-25-124 0Z" fill="#101015"/>
      <text x="210" y="524" text-anchor="middle" fill="#f6efe1" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="800">${label}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function openDebugDiceOverlay() {
  if (els.debugPanelDialog.open) {
    els.debugPanelDialog.close();
  }
  showDiceRollNotice(normalizeDiceRollNotice({
    id: `debug-dice:${Date.now()}`,
    title: 'Debug 骰子检定',
    kind: 'check',
    input: {
      successThreshold: 15,
      diceCount: 1,
      diceSides: 20,
      modifier: 4,
      modifiers: [
        { name: '属性', value: 2, reason: '敏捷' },
        { name: '熟练', value: 2, reason: '开锁训练' }
      ]
    },
    result: {
      outcome: 'success',
      success: true,
      failure: false,
      criticalSuccess: false,
      criticalFailure: false,
      total: 18,
      successThreshold: 15,
      modifierTotal: 4,
      rollMode: 'normal',
      rolls: [14],
      dice: {
        count: 1,
        sides: 20,
        expression: '1d20'
      },
      modifierBreakdown: [
        { name: '属性', value: 2, reason: '敏捷' },
        { name: '熟练', value: 2, reason: '开锁训练' }
      ]
    }
  }));
  setDebugPanelStatus('已打开骰子界面。');
}

function openDebugAdjudicationOverlay() {
  if (els.debugPanelDialog.open) {
    els.debugPanelDialog.close();
  }
  showAdjudicationNotice(normalizeAdjudicationNotice({
    id: `debug-adjudication:${Date.now()}`,
    chatSessionId: state.activeChatId || 'debug_chat',
    title: 'Debug 裁决结果',
    status: 'success',
    prompt: 'Debug：展示裁决弹窗、数值来源和接受裁决流程。',
    appealAvailable: false,
    toolId: 'debug.adjudication.preview',
    summary: {
      status: 'success',
      actionId: 'debug_unlock_gate'
    },
    resolution: {
      status: 'success',
      sourceText: '玩家尝试在守卫巡逻间隙打开侧门。',
      actionId: 'debug_unlock_gate',
      intent: {
        label: '开锁',
        summary: '避开巡逻并打开侧门。',
        target: {
          kind: 'door',
          id: 'side_gate',
          name: '侧门'
        }
      },
      checks: [{
        id: 'debug_dexterity_check',
        tool: 'game.dice.check',
        diceTotal: 18,
        threshold: 15,
        modifierTotal: 4,
        success: true,
        outcome: 'success',
        reason: '侧门老旧但没有被额外加固。',
        modifierSources: [
          { name: '敏捷', value: 2, reason: '手法稳定' },
          { name: '熟练', value: 2, reason: '拥有开锁训练' }
        ]
      }],
      diceTotals: [{
        checkId: 'debug_dexterity_check',
        total: 18,
        threshold: 15,
        success: true,
        outcome: 'success'
      }]
    }
  }));
  setDebugPanelStatus('已打开裁决界面。');
}

function buildDebugCombatActions() {
  const templates = [
    ['slash', '斩击', 'attack', 'slashing', 4, 20, '近战基础攻击'],
    ['pierce', '突刺', 'attack', 'piercing', 5, 18, '高命中单体刺击'],
    ['hammer', '重击', 'attack', 'bludgeoning', 7, 14, '低命中高伤害'],
    ['firebolt', '火焰箭', 'attack', 'fire', 6, 17, '远程火焰伤害'],
    ['frost', '霜寒刃', 'attack', 'cold', 4, 16, '附带减速说明'],
    ['shock', '电弧', 'attack', 'lightning', 5, 15, '稳定法术伤害'],
    ['poison', '毒刃', 'attack', 'poison', 3, 18, '小伤害附毒'],
    ['radiant', '辉光打击', 'attack', 'radiant', 6, 16, '对不死敌有效'],
    ['shadow', '影袭', 'attack', 'necrotic', 5, 17, '潜行风格攻击'],
    ['wind', '风压斩', 'attack', 'force', 4, 15, '推开敌人'],
    ['bleed', '开膛', 'attack', 'slashing', 5, 16, '造成流血'],
    ['guard_break', '破防', 'attack', 'bludgeoning', 2, 18, '降低护甲'],
    ['quick', '速攻', 'attack', 'piercing', 3, 20, '高命中低伤害'],
    ['arcane', '秘法飞弹', 'attack', 'force', 4, 19, '稳定远程攻击'],
    ['holy', '圣印', 'attack', 'radiant', 5, 17, '带有祝福标记'],
    ['dark', '暗蚀', 'attack', 'necrotic', 6, 15, '消耗生命力'],
    ['sand', '扬沙', 'attack', 'bludgeoning', 1, 20, '干扰视线'],
    ['hook', '钩锁', 'attack', 'piercing', 3, 18, '拉近目标'],
    ['mark', '猎人标记', 'status', '', 0, 0, '给敌人挂易伤'],
    ['stun', '震慑喝令', 'status', '', 0, 0, '尝试震慑目标'],
    ['slow', '迟缓术', 'status', '', 0, 0, '降低速度'],
    ['burn', '燃烧瓶', 'status', '', 0, 0, '持续燃烧'],
    ['heal_minor', '小治疗', 'healing', '', 4, 0, '回复少量 HP'],
    ['heal_major', '大治疗', 'healing', '', 8, 0, '回复大量 HP'],
    ['barrier', '临时护盾', 'effect', '', 5, 0, '获得临时 HP'],
    ['focus', '专注姿态', 'effect', '', 0, 0, '下回合攻击更稳'],
    ['dodge', '闪避', 'dodge', '', 0, 0, '本轮防御动作'],
    ['defense', '防御架势', 'defense', '', 0, 0, '提高 AC'],
    ['taunt', '嘲讽', 'status', '', 0, 0, '吸引敌方火力'],
    ['cleanse', '净化', 'effect', '', 0, 0, '移除负面状态'],
    ['dash_cut', '冲刺斩', 'attack', 'slashing', 6, 16, '移动后攻击'],
    ['meteor', '小陨星', 'attack', 'fire', 9, 13, '高伤害测试'],
    ['ice_wall', '冰墙', 'defense', '', 0, 0, '制造掩体'],
    ['song', '战歌', 'effect', '', 0, 0, '队友增益'],
    ['chain', '锁链打击', 'attack', 'force', 5, 16, '限制移动'],
    ['needle', '飞针', 'attack', 'piercing', 2, 22, '超高命中'],
    ['quake', '震地', 'attack', 'bludgeoning', 6, 14, '群体控制说明'],
    ['curse', '诅咒', 'status', '', 0, 0, '降低敌方命中'],
    ['drain', '汲取', 'attack', 'necrotic', 4, 16, '伤害并回血说明'],
    ['finisher', '终结技', 'attack', 'slashing', 10, 12, '高风险高收益']
  ];
  return templates.map(([id, name, kind, damageType, amount, dc, description], index) => {
    const base = {
      id: `debug_${id}`,
      actionId: `debug_${id}`,
      name,
      description,
      actionKind: kind,
      mode: kind,
      consumeAction: false,
      requiresTarget: !['healing', 'effect', 'defense', 'dodge'].includes(kind),
      cooldown: `${(index % 4) + 1} 回合`,
      metadata: {
        debugIndex: index + 1,
        cooldown: `${(index % 4) + 1} 回合`,
        uiNote: description
      }
    };
    if (kind === 'attack') {
      return {
        ...base,
        successThreshold: dc,
        diceCount: 1,
        diceSides: 20,
        modifier: 20 - (index % 5),
        damage: [{ type: damageType, amount }]
      };
    }
    if (kind === 'healing') return { ...base, healing: [{ amount, type: 'hp' }] };
    if (kind === 'status') {
      return {
        ...base,
        statusEffects: [{
          id: `debug_status_${id}`,
          name,
          status: name,
          active: true,
          duration: (index % 3) + 1,
          description
        }]
      };
    }
    if (kind === 'defense') return { ...base, temporaryHp: 4, metadata: { ...base.metadata, acBonus: 2 } };
    if (kind === 'dodge') return { ...base, metadata: { ...base.metadata, disadvantageIncoming: true } };
    return { ...base, temporaryHp: amount || 2 };
  });
}

async function seedDebugCombatant({ sceneId, npcId, name, actorType, isPlayer, values, statusBar, skillBar, resources }) {
  await executeDebugTool('system.npc_state.patch_state', {
    chatSessionId: state.activeChatId,
    sceneId,
    npcId,
    actorType,
    isPlayer,
    playerId: isPlayer ? npcId : undefined,
    name,
    values,
    statusBar,
    skillBar,
    resources,
    source: 'web-ui.debug-panel'
  });
}

function renderCombatOverlay() {
  if (!els.combatOverlay) return;
  els.combatOverlay.hidden = !state.combatOverlay.open;
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle || {};
  const hasBattle = Boolean(battle.battleId);
  const terminal = isCombatTerminalStatus(battle.status);
  const enemiesDefeated = combatEnemiesDefeated();
  els.combatWindow.dataset.status = battle.status || (state.combatOverlay.loading ? 'loading' : 'active');
  els.combatStatusBadge.textContent = combatStatusLabel(battle.status || (state.combatOverlay.loading ? 'loading' : 'active'));
  els.combatBattleTitle.textContent = battle.name || battle.battleId || '战斗';
  els.combatBattleSubtitle.textContent = [
    battle.sceneId,
    battle.objective,
    battle.stakes
  ].filter(Boolean).join(' · ') || '战斗数据读取中';
  els.combatStageTitle.textContent = battle.name || '战斗';
  els.combatStageText.textContent = state.combatOverlay.loading
    ? '正在读取战斗数据...'
    : '';
  renderModuleStageVisual(els.combatStageVisual, state.combatOverlay.stageVisual, {
    emptyLabel: '敌方目标暂无图片资源'
  });
  renderCombatTurnMeta(battle, terminal, enemiesDefeated);
  els.combatSkillDrawer.hidden = !state.combatOverlay.skillDrawerOpen;
  els.combatSkillDrawerToggle.textContent = state.combatOverlay.skillDrawerOpen ? '收起技能' : '展开技能';
  els.combatSkillDrawerToggle.setAttribute('aria-expanded', String(state.combatOverlay.skillDrawerOpen));
  els.combatSpecialPanel.hidden = !state.combatOverlay.specialOpen;
  els.combatExitButton.hidden = hasBattle && !terminal;
  els.combatFinishWinButton.hidden = !hasBattle || terminal || !enemiesDefeated;
  els.combatDebugWinButton.hidden = !state.debugPanel.showCombatWinButton || !hasBattle || terminal;
  els.combatStatusText.textContent = state.combatOverlay.error || state.combatOverlay.statusText || '';
  els.combatStatusText.dataset.status = state.combatOverlay.error ? 'error' : '';
  renderCombatants(els.combatAllyList, state.combatOverlay.allies, '玩家方');
  renderCombatants(els.combatEnemyList, state.combatOverlay.enemies, '敌方');
  renderCombatSkills();
  renderCombatEventLog();
  updateCombatControls();
  renderDebugPanelControls();
}

function openPersuasionOverlay(prompt = {}) {
  state.persuasionOverlay.open = true;
  state.persuasionOverlay.loading = false;
  state.persuasionOverlay.error = '';
  state.persuasionOverlay.statusText = '';
  state.persuasionOverlay.routerItemId = prompt.routerItemId || prompt.id || '';
  state.persuasionOverlay.turnId = prompt.turnId || '';
  state.persuasionOverlay.chatSessionId = prompt.chatSessionId || state.activeChatId || '';
  state.persuasionOverlay.title = prompt.title || '说服模块';
  state.persuasionOverlay.subtitle = prompt.subtitle || 'Router 选择了说服模块';
  state.persuasionOverlay.sourceText = prompt.sourceText || prompt.text || 'Router 选择了说服模块。';
  state.persuasionOverlay.targetText = prompt.targetText || prompt.target || '由裁决模块读取上下文判断';
  state.persuasionOverlay.sceneId = prompt.sceneId || 'current';
  state.persuasionOverlay.stageText = prompt.stageText || '';
  state.persuasionOverlay.stageVisual = emptyStageVisualState();
  const targetRefs = persuasionPromptVisualTargets(prompt);
  state.persuasionOverlay.targetIds = targetRefs.ids;
  state.persuasionOverlay.targetNames = targetRefs.names;
  state.persuasionOverlay.input = prompt.initialSpeech || state.persuasionOverlay.input || '';
  state.persuasionOverlay.debug = prompt.debug === true;
  emitFrontendEvent('persuasion:start', {
    prompt,
    sceneId: state.persuasionOverlay.sceneId,
    targetIds: state.persuasionOverlay.targetIds,
    targetNames: state.persuasionOverlay.targetNames,
    routerItemId: state.persuasionOverlay.routerItemId
  });
  renderPersuasionOverlay();
  void refreshPersuasionStageVisual();
  updateControls();
  requestAnimationFrame(() => {
    if (state.persuasionOverlay.open) els.persuasionInput?.focus();
  });
}

function maybeOpenPersuasionOverlayFromRouterItem(item = {}, event = {}) {
  if (state.persuasionOverlay.open) return;
  if (!item.id || state.persuasionOverlay.promptedItemIds.has(item.id)) return;
  if (!isPersuasionRouterItem(item)) return;
  if (item.status === 'skipped' || item.status === 'success') return;
  state.persuasionOverlay.promptedItemIds.add(item.id);
  openPersuasionOverlay({
    routerItemId: item.id,
    turnId: item.turnId || event.turnId || '',
    chatSessionId: item.chatSessionId || event.chatSessionId || state.activeChatId,
    title: item.label || '说服',
    subtitle: routerReviewStatusLabel(item.status || 'planned'),
    sourceText: persuasionRouterSourceText(item),
    targetText: persuasionRouterTargetText(item),
    sceneId: item.sceneId || event.sceneId || item.input?.sceneId || 'current',
    ...persuasionRouterVisualPrompt(item)
  });
}

function closePersuasionOverlay({ skipRouter = false } = {}) {
  const routerItemId = state.persuasionOverlay.routerItemId;
  const routerItem = routerItemId ? state.routerReview.items.get(routerItemId) : undefined;
  if (skipRouter && routerItem && !canSkipRouterReviewItem(routerItem)) {
    showToast(routerReviewCannotSkipMessage(routerItem));
    renderPersuasionOverlay();
    updateControls();
    return;
  }
  state.persuasionOverlay.open = false;
  state.persuasionOverlay.loading = false;
  state.persuasionOverlay.error = '';
  state.persuasionOverlay.statusText = '';
  state.persuasionOverlay.input = '';
  state.persuasionOverlay.routerItemId = '';
  state.persuasionOverlay.stageVisual = emptyStageVisualState();
  state.persuasionOverlay.targetIds = [];
  state.persuasionOverlay.targetNames = [];
  state.persuasionOverlay.debug = false;
  renderPersuasionOverlay();
  updateControls();
  if (skipRouter && routerItemId) {
    dismissRouterReviewItem(routerItemId);
  }
}

function renderPersuasionOverlay() {
  if (!els.persuasionOverlay) return;
  const prompt = state.persuasionOverlay;
  els.persuasionOverlay.hidden = !prompt.open;
  if (!prompt.open) return;
  els.persuasionTitle.textContent = prompt.title || '说服模块';
  els.persuasionSubtitle.textContent = prompt.subtitle || '等待说服内容';
  els.persuasionStageTitle.textContent = prompt.title || '说服';
  els.persuasionStageText.textContent = prompt.loading ? '正在进入裁决循环...' : (prompt.stageText || '');
  renderModuleStageVisual(els.persuasionStageVisual, prompt.stageVisual, {
    emptyLabel: '说服目标暂无图片资源'
  });
  els.persuasionSourceText.textContent = truncateWorldDrawerText(prompt.sourceText || 'Router 选择了说服模块。', 180);
  els.persuasionTargetText.textContent = prompt.targetText || '由裁决模块读取上下文判断';
  if (document.activeElement !== els.persuasionInput) {
    els.persuasionInput.value = prompt.input || '';
  } else {
    prompt.input = els.persuasionInput.value;
  }
  const status = prompt.error || prompt.statusText || '';
  els.persuasionStatusText.textContent = status;
  els.persuasionStatusText.dataset.status = prompt.error ? 'error' : '';
  updatePersuasionControls();
}

function updatePersuasionControls() {
  if (!els.persuasionSubmitButton) return;
  const loading = state.persuasionOverlay.loading;
  const speech = els.persuasionInput?.value.trim() || state.persuasionOverlay.input.trim();
  const routerItem = state.persuasionOverlay.routerItemId
    ? state.routerReview.items.get(state.persuasionOverlay.routerItemId)
    : undefined;
  const canCloseAsSkip = !routerItem || canSkipRouterReviewItem(routerItem);
  els.persuasionInput.disabled = loading;
  els.persuasionSubmitButton.disabled = loading || !speech || !state.activeChatId;
  els.persuasionCancelButton.disabled = loading || !canCloseAsSkip;
  els.persuasionCloseButton.disabled = loading || !canCloseAsSkip;
  els.persuasionCancelButton.title = canCloseAsSkip ? '取消并跳过说服输入' : routerReviewCannotSkipMessage(routerItem);
  els.persuasionCloseButton.title = canCloseAsSkip ? '跳过说服输入' : routerReviewCannotSkipMessage(routerItem);
  els.persuasionSubmitButton.textContent = loading ? '正在裁决...' : '提交说服并裁决';
}

async function submitPersuasionArgument() {
  if (!state.persuasionOverlay.open || state.persuasionOverlay.loading) return;
  const speech = els.persuasionInput.value.trim();
  if (!speech) {
    state.persuasionOverlay.statusText = '请先写下实际说服内容。';
    renderPersuasionOverlay();
    return;
  }
  if (!state.activeChatId) {
    state.persuasionOverlay.error = '先选择一个聊天。';
    renderPersuasionOverlay();
    return;
  }
  if (!toolAvailable('system.action.resolve') && !toolAvailable('system.persuasion.resolve')) {
    state.persuasionOverlay.error = '缺少 system.action.resolve 或 system.persuasion.resolve，不能进入裁决。';
    renderPersuasionOverlay();
    return;
  }

  state.persuasionOverlay.loading = true;
  state.persuasionOverlay.error = '';
  state.persuasionOverlay.statusText = toolAvailable('system.action.resolve')
    ? '正在把说服内容交给裁决循环...'
    : '正在调用说服裁定工具...';
  state.persuasionOverlay.input = speech;
  renderPersuasionOverlay();
  try {
    const prompt = state.persuasionOverlay;
    const sourceText = buildPersuasionSourceText(prompt, speech);
    const deterministicDebug = prompt.debug === true && toolAvailable('system.action.resolve');
    const output = toolAvailable('system.action.resolve')
      ? await executeTool('system.action.resolve', {
        chatSessionId: state.activeChatId,
        sceneId: prompt.sceneId || 'current',
        sourceText,
        text: sourceText,
        query: sourceText,
        templateId: 'social',
        includeContext: true,
        includeRag: false,
        includeAbsurdity: !deterministicDebug,
        dryRun: false,
        useLlm: !deterministicDebug,
        ...(deterministicDebug ? { plan: buildDebugPersuasionActionPlan(sourceText, prompt) } : {})
      }, buildManagedToolExecutionContext({
        source: 'web-ui.persuasion-overlay',
        chatSessionId: state.activeChatId,
        authorization: true,
        actor: { type: 'user', id: 'user' }
      }))
      : await executeTool('system.persuasion.resolve', {
        chatSessionId: state.activeChatId,
        sceneId: prompt.sceneId || 'current',
        sourceText,
        text: sourceText,
        query: sourceText,
        playerSpeech: speech,
        speech,
        argument: speech,
        desiredOutcome: prompt.sourceText || '',
        includeContext: true,
        includeRag: false
      }, buildManagedToolExecutionContext({
        source: 'web-ui.persuasion-overlay',
        chatSessionId: state.activeChatId,
        authorization: true,
        actor: { type: 'user', id: 'user' }
      }));
    const notice = toolAvailable('system.action.resolve')
      ? normalizeAdjudicationNotice({
        id: `persuasion:${Date.now()}`,
        chatSessionId: state.activeChatId,
        title: '说服裁决',
        toolId: 'system.action.resolve',
        output,
        status: output?.status,
        loopState: output?.loopState,
        choices: output?.choices,
        summary: output?.currentSummary,
        resolution: output?.currentResolution,
        rejudgement: output?.rejudgement
      })
      : normalizePersuasionOutputAsAdjudication(output, prompt, sourceText);
    const routerItemId = state.persuasionOverlay.routerItemId;
    closePersuasionOverlay({ skipRouter: false });
    if (routerItemId) completeRouterReviewItem(routerItemId, 'success');
    if (toolAvailable('system.action.resolve')) showDiceRollNoticeFromActionResolution(output, '说服骰子');
    if (notice) showAdjudicationNotice(notice);
    if (output?.dice) showDiceRollNoticeFromPersuasion(output);
  } catch (error) {
    state.persuasionOverlay.loading = false;
    state.persuasionOverlay.error = error.message || String(error);
    renderPersuasionOverlay();
    showToast(error.message || String(error));
  }
}

function buildDebugPersuasionActionPlan(sourceText = '', prompt = {}) {
  return {
    actionId: 'debug_persuasion_action',
    sourceText,
    intent: {
      label: '说服',
      summary: prompt.sourceText || '玩家尝试说服目标。',
      target: {
        kind: 'npc',
        id: 'debug_tavern_keeper'
      }
    },
    checks: [{
      id: 'debug_persuasion_check',
      tool: 'game.dice.check',
      input: {
        successThreshold: 15,
        diceCount: 1,
        diceSides: 20,
        modifier: 4
      },
      metadata: {
        ability: 'charisma',
        skill: 'persuasion',
        reason: 'Debug 固定说服检定，用于确认骰子和裁决弹窗。'
      }
    }],
    proposals: [],
    narrationHints: {
      success: 'Debug：目标愿意透露一条可验证的线索。',
      failure: 'Debug：目标仍然保持戒备。'
    }
  };
}

function showDiceRollNoticeFromActionResolution(output = {}, title = '裁决骰子') {
  const diceRecord = output.currentResolution?.apply?.diceResults?.[0]
    || output.currentResolution?.diceResults?.[0]
    || output.finalResolution?.apply?.diceResults?.[0]
    || output.resolution?.apply?.diceResults?.[0];
  const result = diceRecord?.output || diceRecord?.result;
  if (!result || result.total === undefined) return;
  showDiceRollNotice(normalizeDiceRollNotice({
    id: `action-dice:${Date.now()}`,
    title,
    result,
    input: diceRecord.input || {}
  }));
}

function showDiceRollNoticeFromCombatResolution(output = {}, title = '战斗骰子') {
  const attack = output.attack || output.actionResult?.attack || output.result?.attack;
  const result = attack?.output || attack?.result;
  if (!result || result.total === undefined) return;
  showDiceRollNotice(normalizeDiceRollNotice({
    id: `combat-dice:${Date.now()}`,
    title,
    result,
    input: attack.input || {}
  }));
}

function buildPersuasionSourceText(prompt = {}, speech = '') {
  const base = String(prompt.sourceText || '').trim();
  return [
    base ? `Router 说服目标：${base}` : 'Router 选择了说服模块。',
    `玩家实际说服内容：${speech}`
  ].join('\n');
}

function normalizePersuasionOutputAsAdjudication(output = {}, prompt = {}, sourceText = '') {
  const resolution = output.resolution || {};
  const judgement = output.judgement || {};
  const diceResult = output.dice?.output || output.dice || {};
  return normalizeAdjudicationNotice({
    id: `persuasion:${Date.now()}`,
    chatSessionId: state.activeChatId,
    title: '说服裁决',
    status: output.status || resolution.outcome || (resolution.success ? 'success' : 'failure'),
    prompt: '说服模块已完成裁定。',
    appealAvailable: false,
    toolId: 'system.persuasion.resolve',
    summary: {
      status: output.status || resolution.outcome,
      actionId: 'persuasion'
    },
    resolution: {
      status: output.status || resolution.outcome,
      sourceText,
      actionId: 'persuasion',
      intent: {
        label: '说服',
        summary: prompt.sourceText || '玩家尝试说服目标'
      },
      checks: [{
        id: judgement.judgementId || 'persuasion_check',
        diceTotal: resolution.effectiveTotal ?? diceResult.total,
        threshold: resolution.effectiveThreshold ?? resolution.threshold ?? diceResult.threshold,
        modifierTotal: resolution.argumentBonus,
        success: resolution.success,
        failure: resolution.failure,
        reason: judgement.summary || resolution.summary || '说服话术评分与骰子结果合并',
        modifierSources: [
          resolution.argumentBonus !== undefined ? { name: '话术', value: resolution.argumentBonus, reason: judgement.summary || '' } : undefined,
          resolution.dcAdjustment !== undefined ? { name: '难度调整', value: -Number(resolution.dcAdjustment || 0), reason: '说服裁定' } : undefined
        ].filter(Boolean)
      }],
      diceTotals: diceResult.total !== undefined ? [{
        checkId: 'persuasion_roll',
        total: diceResult.total,
        threshold: diceResult.threshold ?? resolution.effectiveThreshold,
        success: diceResult.success ?? resolution.success
      }] : []
    }
  });
}

function showDiceRollNoticeFromPersuasion(output = {}) {
  const dice = output.dice?.output || output.dice;
  if (!dice || dice.total === undefined) return;
  showDiceRollNotice(normalizeDiceRollNotice({
    id: `persuasion-dice:${Date.now()}`,
    title: '说服骰子',
    result: dice,
    input: output.dice?.input || {},
    dice: dice.dice || {},
    expression: dice.expression
  }));
}

function persuasionRouterSourceText(item = {}) {
  return [
    item.text,
    item.detail,
    item.title && item.title !== item.text ? item.title : '',
    item.toolId ? `工具：${item.toolId}` : ''
  ].filter(Boolean).join(' · ') || 'Router 选择了说服模块。';
}

function persuasionRouterTargetText(item = {}) {
  const input = item.input || item.metadata || {};
  return input.targetNpcId || input.npcId || input.targetId || input.target?.name || input.target?.id || '由裁决模块读取上下文判断';
}

function updateCombatControls() {
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle || {};
  const hasBattle = Boolean(battle.battleId);
  const terminal = isCombatTerminalStatus(battle.status);
  const enemiesDefeated = combatEnemiesDefeated();
  const coolingDown = combatActionCoolingDown();
  const locked = state.combatOverlay.loading || coolingDown || !state.combatOverlay.open || terminal || enemiesDefeated || !hasBattle;
  els.combatSkillDrawerToggle.disabled = state.combatOverlay.loading;
  els.combatSpecialToggleButton.disabled = locked;
  els.combatSpecialSubmitButton.disabled = locked || !els.combatSpecialInput.value.trim();
  els.combatSpecialInput.disabled = locked;
  els.combatSurrenderButton.disabled = locked;
  els.combatDebugWinButton.disabled = state.combatOverlay.loading || terminal || !state.debugPanel.showCombatWinButton;
  els.combatFinishWinButton.disabled = state.combatOverlay.loading || terminal;
  for (const button of els.combatSkillList.querySelectorAll('[data-combat-action-id]')) {
    button.disabled = locked || button.dataset.ready === 'false';
  }
}

function combatActionCoolingDown() {
  return Number(state.combatOverlay.actionCooldownUntil || 0) > Date.now();
}

function startCombatActionCooldown(duration = COMBAT_ACTION_COOLDOWN_MS) {
  clearTimeout(state.combatOverlay.actionCooldownTimer);
  state.combatOverlay.actionCooldownUntil = Date.now() + duration;
  state.combatOverlay.actionCooldownTimer = setTimeout(() => {
    state.combatOverlay.actionCooldownUntil = 0;
    renderCombatOverlay();
  }, duration + 30);
}

function renderCombatants(container, combatants = [], fallbackTitle = '') {
  container.innerHTML = '';
  if (!combatants.length) {
    container.append(playerActionEmpty(`${fallbackTitle}暂无记录`, 'compact'));
    return;
  }
  for (const combatant of combatants) {
    container.append(renderCombatantCard(combatant));
  }
}

function renderCombatTurnMeta(battle = {}, terminal = false, enemiesDefeated = false) {
  if (!els.combatTurnMeta) return;
  els.combatTurnMeta.innerHTML = '';
  const round = combatRoundNumber(battle);
  const actionCount = combatActionEventCount();
  const actor = combatCurrentActorLabel(battle);
  const status = terminal
    ? `已结束：${combatStatusLabel(battle.status)}`
    : enemiesDefeated
      ? '敌方已倒下，待胜利退出'
      : '等待行动';
  const entries = [
    ['轮次', round ? `第 ${round} 轮` : '未同步'],
    ['当前', actor || '玩家行动'],
    ['行动', actionCount ? `已结算 ${actionCount}` : '未行动'],
    ['状态', status]
  ];
  for (const [label, value] of entries) {
    els.combatTurnMeta.append(combatValueChip(label, value));
  }
}

function renderCombatantCard(combatant) {
  const data = combatant.data || combatant || {};
  const hp = combatantHp(data);
  const card = document.createElement('section');
  card.className = `combatant-card${hp.defeated ? ' defeated' : ''}`;
  const header = document.createElement('div');
  header.className = 'combatant-header';
  const name = document.createElement('strong');
  name.textContent = data.name || data.displayName || data.npcId || data.playerId || combatant.id || '未知单位';
  const meta = document.createElement('span');
  meta.textContent = [data.npcId || data.playerId, data.actorType, hp.defeated ? '倒下' : ''].filter(Boolean).join(' · ');
  header.append(name, meta);
  const bar = document.createElement('div');
  bar.className = 'combat-hp-bar';
  const fill = document.createElement('span');
  fill.style.width = `${hp.percent}%`;
  bar.append(fill);
  const values = document.createElement('div');
  values.className = 'combatant-values';
  values.append(
    combatValueChip('HP', hp.max > 0 ? `${hp.current}/${hp.max}` : formatValue(hp.current || '未知')),
    combatValueChip('AC', firstPresent(data.values?.armorClass, data.values?.ac, data.statusBar?.armorClass, data.statusBar?.ac, '未知')),
    combatValueChip('状态', combatStatusSummary(data)),
    combatValueChip('资源', combatResourceSummary(data)),
    combatValueChip('轮次', combatActorTurnSummary(data))
  );
  card.append(header, bar, values);
  card.append(combatDetailDrawer(data));
  return card;
}

function combatValueChip(label, value) {
  const chip = document.createElement('span');
  chip.innerHTML = '<small></small><strong></strong>';
  chip.querySelector('small').textContent = label;
  chip.querySelector('strong').textContent = formatValue(value);
  return chip;
}

function combatDetailGroup(title, items = [], emptyText = '无') {
  const group = document.createElement('div');
  group.className = 'combat-detail-group';
  const heading = document.createElement('span');
  heading.className = 'combat-detail-heading';
  heading.textContent = title;
  const chips = document.createElement('div');
  chips.className = 'combat-detail-chips';
  const visibleItems = items.filter((item) => item && item.value !== undefined && item.value !== '').slice(0, 10);
  if (!visibleItems.length) {
    chips.append(combatValueChip('状态', emptyText));
  } else {
    for (const item of visibleItems) chips.append(combatValueChip(item.label, item.value));
  }
  group.append(heading, chips);
  return group;
}

function combatDetailDrawer(data = {}) {
  const details = document.createElement('details');
  details.className = 'combat-detail-drawer';
  const summary = document.createElement('summary');
  summary.textContent = '状态 / 资源详情';
  details.append(
    summary,
    combatDetailGroup('状态栏', combatStatusBarItems(data), '无额外状态'),
    combatDetailGroup('资源点', combatResourceItems(data), '无资源记录')
  );
  return details;
}

function combatRoundNumber(battle = {}) {
  const metadata = combatObject(battle.metadata);
  const explicit = firstPresent(
    battle.roundNumber,
    battle.round,
    battle.currentRound,
    battle.turn?.roundNumber,
    battle.turn?.round,
    metadata.roundNumber,
    metadata.round,
    metadata.currentRound
  );
  const explicitNumber = Number(explicit);
  if (Number.isFinite(explicitNumber) && explicitNumber > 0) return Math.floor(explicitNumber);
  const participantCount = Math.max(
    1,
    normalizeCombatIdList(battle.participantIds).length
      || state.combatOverlay.allies.length + state.combatOverlay.enemies.length
      || 1
  );
  return Math.max(1, Math.floor(combatActionEventCount() / participantCount) + 1);
}

function combatActionEventCount() {
  return (state.combatOverlay.events || []).filter((record) => {
    const data = record.data || record || {};
    return data.eventType === 'action' || data.result?.action;
  }).length;
}

function combatCurrentActorLabel(battle = {}) {
  const metadata = combatObject(battle.metadata);
  const actorId = firstPresent(
    battle.turnActorId,
    battle.currentActorId,
    battle.currentTurnActorId,
    battle.turn?.actorId,
    battle.turn?.participantId,
    metadata.turnActorId,
    metadata.currentActorId,
    state.combatOverlay.actorId
  );
  return actorId ? combatActorNameById(String(actorId)) : '';
}

function combatActorNameById(actorId = '') {
  const actor = [...state.combatOverlay.allies, ...state.combatOverlay.enemies]
    .find((item) => combatantId(item) === actorId);
  const data = actor?.data || actor || {};
  return data.name || data.displayName || actorId;
}

function combatStatusBarItems(data = {}) {
  const values = combatObject(data.values);
  const statusBar = combatObject(data.statusBar);
  const items = [];
  const conditions = combatConditionList(data);
  if (conditions.length) items.push({ label: '状态', value: conditions.slice(0, 4).join('，') });
  const temporaryHp = firstPresent(data.temporaryHp, values.temporaryHp, statusBar.temporaryHp);
  if (temporaryHp !== undefined) items.push({ label: '临时HP', value: temporaryHp });
  const speed = firstPresent(values.speed, statusBar.speed, data.speed);
  if (speed !== undefined) items.push({ label: '速度', value: speed });
  const inspiration = firstPresent(statusBar.inspiration, data.inspiration, values.inspiration);
  if (inspiration !== undefined) items.push({ label: '激励', value: inspiration });
  const deathSaves = combatObject(statusBar.deathSaves);
  if (Object.keys(deathSaves).length) {
    items.push({
      label: '死亡豁免',
      value: [
        deathSaves.successes !== undefined ? `成${deathSaves.successes}` : '',
        deathSaves.failures !== undefined ? `败${deathSaves.failures}` : '',
        deathSaves.dying ? '濒死' : '',
        deathSaves.dead ? '死亡' : ''
      ].filter(Boolean).join(' ')
    });
  }
  const concentration = combatObject(statusBar.concentration);
  if (concentration.active || concentration.spell || concentration.name) {
    items.push({ label: '专注', value: concentration.name || concentration.spell || '维持中' });
  }
  const modifiers = Object.entries(combatObject(statusBar.combatModifiers))
    .map(([key, value]) => {
      const modifier = combatObject(value);
      const name = modifier.name || key;
      const acBonus = modifier.acBonus === undefined ? '' : `AC ${formatSignedNumber(modifier.acBonus)}`;
      return [name, acBonus].filter(Boolean).join(' ');
    })
    .filter(Boolean);
  if (modifiers.length) items.push({ label: '修正', value: modifiers.slice(0, 3).join('，') });
  const turnId = firstPresent(statusBar.actionEconomy?.turnId, data.resources?.actionEconomy?.turnId);
  if (turnId) items.push({ label: '行动轮次', value: turnId });
  return items;
}

function combatResourceItems(data = {}) {
  const statusBar = combatObject(data.statusBar);
  const resources = combatObject(data.resources);
  const economy = {
    ...combatObject(statusBar.actionEconomy),
    ...combatObject(resources.actionEconomy)
  };
  const items = [];
  for (const [key, label] of [
    ['action', '行动'],
    ['bonusAction', '附赠'],
    ['reaction', '反应'],
    ['movement', '移动']
  ]) {
    if (economy[key] !== undefined) {
      items.push({ label, value: combatResourcePoolText(economy[key], key === 'movement' ? 'ft' : '') });
    }
  }
  items.push(
    ...combatResourceGroupItems(resources.skillUses || resources.skills, '技能'),
    ...combatResourceGroupItems(resources.spellSlots, '法术'),
    ...combatResourceGroupItems(resources.ammo || resources.ammunition, '弹药'),
    ...combatResourceGroupItems(resources.cooldowns, '冷却', 'cooldown'),
    ...combatResourceGroupItems(resources.consumables, '物品')
  );
  return items;
}

function combatResourceSummary(data = {}) {
  const resources = combatObject(data.resources);
  const economy = {
    ...combatObject(data.statusBar?.actionEconomy),
    ...combatObject(resources.actionEconomy)
  };
  if (economy.action !== undefined) return `行动 ${combatResourcePoolText(economy.action)}`;
  const firstResource = [
    resources.skillUses || resources.skills,
    resources.spellSlots,
    resources.ammo || resources.ammunition,
    resources.consumables
  ].map((group) => Object.entries(combatObject(group))[0]).find(Boolean);
  return firstResource ? combatResourceEntryText(firstResource[0], firstResource[1]) : '无';
}

function combatActorTurnSummary(data = {}) {
  const turnId = firstPresent(data.statusBar?.actionEconomy?.turnId, data.resources?.actionEconomy?.turnId);
  if (turnId) return turnId;
  const actorId = combatantId(data);
  if (actorId && actorId === state.combatOverlay.actorId) return '当前';
  return combatantDefeated(data) ? '倒下' : '待机';
}

function combatResourceGroupItems(group, label, mode = 'count') {
  return Object.entries(combatObject(group)).slice(0, 3).map(([id, value]) => ({
    label,
    value: combatResourceEntryText(id, value, mode)
  }));
}

function combatResourceEntryText(id, value, mode = 'count') {
  if (typeof value === 'number') return `${combatResourceName(id, value)} ${value}`;
  if (typeof value === 'boolean') return `${combatResourceName(id, value)} ${value ? '可用' : '耗尽'}`;
  const entry = combatObject(value);
  const name = combatResourceName(id, entry);
  if (mode === 'cooldown') {
    if (entry.ready === true) return `${name} 就绪`;
    const remaining = firstPresent(entry.remainingTurns, entry.turns, entry.duration);
    return `${name} ${remaining === undefined ? '冷却中' : `${remaining}T`}`;
  }
  const current = firstPresent(entry.current, entry.remaining, entry.value, entry.count, entry.quantity);
  const max = firstPresent(entry.max, entry.maximum, entry.total);
  if (current !== undefined && max !== undefined) return `${name} ${current}/${max}`;
  if (current !== undefined) return `${name} ${current}`;
  return name;
}

function combatResourceName(id, value = {}) {
  const entry = combatObject(value);
  return entry.name || entry.label || entry.resourceName || resourceIdLabel(id);
}

function combatResourcePoolText(value, fallbackUnit = '') {
  if (typeof value === 'boolean') return value ? '可用' : '已用';
  if (typeof value === 'number') return String(value);
  const pool = combatObject(value);
  const current = firstPresent(pool.current, pool.remaining, pool.value, pool.availableAmount);
  const max = firstPresent(pool.max, pool.maximum, pool.total);
  const unit = pool.unit || fallbackUnit || '';
  if (current !== undefined && max !== undefined) return `${current}/${max}${unit}`;
  if (current !== undefined) return `${current}${unit}`;
  if (pool.available !== undefined) return pool.available ? '可用' : '已用';
  return '未知';
}

function renderCombatSkills() {
  hideCombatSkillTooltip();
  els.combatSkillList.innerHTML = '';
  const actions = state.combatOverlay.actions || [];
  if (!actions.length) {
    els.combatSkillList.append(playerActionEmpty('没有读取到可用技能。', 'compact'));
    return;
  }
  for (const action of actions) {
    const button = document.createElement('button');
    button.className = 'combat-skill-button';
    button.type = 'button';
    button.dataset.combatActionId = action.actionId || action.id;
    button.dataset.ready = String(action.ready !== false);
    const title = document.createElement('strong');
    title.textContent = action.name || action.actionId || '未命名动作';
    button.setAttribute('aria-label', combatSkillAccessibleText(action));
    button.append(title);
    button.addEventListener('mouseenter', (event) => showCombatSkillTooltip(action, event));
    button.addEventListener('mouseover', (event) => showCombatSkillTooltip(action, event));
    button.addEventListener('mousemove', moveCombatSkillTooltip);
    button.addEventListener('mouseleave', hideCombatSkillTooltip);
    button.addEventListener('focus', () => showCombatSkillTooltip(action, null, button));
    button.addEventListener('blur', hideCombatSkillTooltip);
    els.combatSkillList.append(button);
  }
}

function combatActionMetaText(action = {}) {
  return [
    combatActionKindLabel(action.actionKind || action.mode),
    action.requiresTarget ? `目标 ${state.combatOverlay.targetId || '未选择'}` : '无需目标',
    action.ready === false ? action.reasonUnavailable || '不可用' : ''
  ].filter(Boolean).join(' · ');
}

function combatSkillAccessibleText(action = {}) {
  const name = action.name || action.actionId || '未命名动作';
  const detail = action.description || combatActionDetail(action);
  const stats = combatSkillStatItems(action).map((item) => `${item.label} ${item.value}`).join('，');
  return [name, combatActionMetaText(action), detail, stats].filter(Boolean).join('。');
}

function showCombatSkillTooltip(action = {}, event, anchor) {
  if (!els.combatSkillTooltip) return;
  const tooltip = els.combatSkillTooltip;
  tooltip.innerHTML = '';
  const title = document.createElement('strong');
  title.textContent = action.name || action.actionId || '未命名动作';
  const meta = document.createElement('span');
  meta.textContent = combatActionMetaText(action);
  const detail = document.createElement('p');
  detail.textContent = action.description || combatActionDetail(action);
  const stats = document.createElement('div');
  stats.className = 'combat-skill-tooltip-stats';
  for (const item of combatSkillStatItems(action)) {
    stats.append(combatValueChip(item.label, item.value));
  }
  tooltip.append(title, meta, detail, stats);
  tooltip.hidden = false;
  if (event) {
    positionCombatSkillTooltip(event.clientX, event.clientY);
  } else if (anchor) {
    const rect = anchor.getBoundingClientRect();
    positionCombatSkillTooltip(rect.right, rect.top);
  }
}

function moveCombatSkillTooltip(event) {
  if (!els.combatSkillTooltip || els.combatSkillTooltip.hidden) return;
  positionCombatSkillTooltip(event.clientX, event.clientY);
}

function positionCombatSkillTooltip(clientX = 0, clientY = 0) {
  const tooltip = els.combatSkillTooltip;
  if (!tooltip) return;
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  const left = clamp(clientX + offset, 8, maxLeft);
  const top = clamp(clientY + offset, 8, maxTop);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideCombatSkillTooltip() {
  if (!els.combatSkillTooltip) return;
  els.combatSkillTooltip.hidden = true;
}

function renderCombatSkillStats(action = {}) {
  const stats = document.createElement('div');
  stats.className = 'combat-skill-stats';
  for (const item of combatSkillStatItems(action)) {
    const chip = document.createElement('span');
    const label = document.createElement('small');
    label.textContent = item.label;
    const value = document.createElement('strong');
    value.textContent = item.value;
    chip.append(label, value);
    stats.append(chip);
  }
  return stats;
}

function renderCombatEventLog() {
  els.combatEventLog.innerHTML = '';
  const events = state.combatOverlay.events || [];
  if (!events.length) {
    els.combatEventLog.append(playerActionEmpty('暂无战斗记录。', 'compact'));
    return;
  }
  for (const record of events.slice(-10).reverse()) {
    const data = record.data || record;
    const row = document.createElement('div');
    row.className = 'combat-log-row';
    const title = document.createElement('strong');
    title.textContent = data.summary || combatEventTitle(data);
    const meta = document.createElement('span');
    meta.textContent = [data.eventType, data.actorId, formatTime(data.createdAtIso || record.createdAt)].filter(Boolean).join(' · ');
    row.append(title, meta);
    els.combatEventLog.append(row);
  }
}

function toggleCombatSkillDrawer() {
  state.combatOverlay.skillDrawerOpen = !state.combatOverlay.skillDrawerOpen;
  renderCombatOverlay();
}

function toggleCombatSpecialPanel() {
  state.combatOverlay.specialOpen = !state.combatOverlay.specialOpen;
  renderCombatOverlay();
  if (state.combatOverlay.specialOpen) {
    requestAnimationFrame(() => els.combatSpecialInput.focus());
  }
}

async function useCombatSkill(actionId) {
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle;
  if (!battle || !actionId || state.combatOverlay.loading || combatActionCoolingDown()) return;
  if (isCombatTerminalStatus(battle.status) || combatEnemiesDefeated()) {
    state.combatOverlay.statusText = isCombatTerminalStatus(battle.status)
      ? '战斗已经结束，不能继续出招。'
      : '敌方已倒下，请先点击胜利退出完成结算。';
    renderCombatOverlay();
    return;
  }
  startCombatActionCooldown();
  state.combatOverlay.loading = true;
  state.combatOverlay.statusText = `正在执行：${combatActionName(actionId)}`;
  emitFrontendEvent('combat:action', {
    status: 'started',
    actionId,
    actionName: combatActionName(actionId),
    battle,
    actorId: state.combatOverlay.actorId,
    targetId: state.combatOverlay.targetId
  });
  renderCombatOverlay();
  try {
    if (isDebugCombatBattle(battle) && toolAvailable('system.resources.reset_action_economy') && state.combatOverlay.actorId) {
      await executeCombatTool('system.resources.reset_action_economy', {
        chatSessionId: state.activeChatId,
        sceneId: battle.sceneId || 'current',
        npcId: state.combatOverlay.actorId,
        movementMax: 30
      });
    }
    const built = await executeCombatTool('system.combat.build_player_action', {
      chatSessionId: state.activeChatId,
      sceneId: battle.sceneId || 'current',
      battleId: battle.battleId,
      actorId: state.combatOverlay.actorId,
      targetId: state.combatOverlay.targetId,
      targetAc: combatantArmorClass(state.combatOverlay.enemies.find((enemy) => combatantId(enemy) === state.combatOverlay.targetId)),
      selectedActionId: actionId
    });
    const resolved = await executeCombatTool('system.combat.resolve_action', built.resolveActionInput);
    showDiceRollNoticeFromCombatResolution(resolved, '玩家攻击骰子');
    emitFrontendEvent('combat:action', {
      status: 'resolved',
      actionId,
      actionName: combatActionName(actionId),
      battle,
      actorId: state.combatOverlay.actorId,
      targetId: state.combatOverlay.targetId,
      built,
      resolved
    });
    state.combatOverlay.statusText = '玩家动作已结算。';
    await refreshCombatOverlayState({ autoOpen: true, battleId: battle.battleId });
    await resolveEnemyCounterTurn(battle.battleId);
  } catch (error) {
    state.combatOverlay.error = error.message || String(error);
    emitFrontendEvent('combat:action', {
      status: 'error',
      actionId,
      actionName: combatActionName(actionId),
      battle,
      error: error.message || String(error)
    });
  } finally {
    state.combatOverlay.loading = false;
    renderCombatOverlay();
  }
}

async function resolveEnemyCounterTurn(previousBattleId = '') {
  if (!toolAvailable('system.combat.resolve_enemy_turn')) return;
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle || {};
  if (!battle.battleId || isCombatTerminalStatus(battle.status) || combatEnemiesDefeated()) return;
  const enemy = state.combatOverlay.enemies.find((item) => !combatantDefeated(item));
  const target = state.combatOverlay.allies.find((item) => combatantId(item) === state.combatOverlay.actorId)
    || state.combatOverlay.allies.find((item) => !combatantDefeated(item));
  const enemyId = combatantId(enemy);
  const targetId = combatantId(target);
  if (!enemyId || !targetId) return;
  state.combatOverlay.loading = true;
  state.combatOverlay.statusText = '敌方正在行动...';
  renderCombatOverlay();
  try {
    if (isDebugCombatBattle(battle) && toolAvailable('system.resources.reset_action_economy')) {
      await executeCombatTool('system.resources.reset_action_economy', {
        chatSessionId: state.activeChatId,
        sceneId: battle.sceneId || 'current',
        npcId: enemyId,
        movementMax: 30
      });
    }
    const resolved = await executeCombatTool('system.combat.resolve_enemy_turn', {
      chatSessionId: state.activeChatId,
      sceneId: battle.sceneId || 'current',
      battleId: battle.battleId || previousBattleId,
      actorId: enemyId,
      targetId,
      targetAc: combatantArmorClass(target),
      sourceText: 'Enemy counter turn from combat UI'
    });
    showDiceRollNoticeFromCombatResolution(resolved, '敌方攻击骰子');
    state.combatOverlay.statusText = '敌方行动已结算。';
    await refreshCombatOverlayState({ autoOpen: true, battleId: battle.battleId || previousBattleId });
  } finally {
    state.combatOverlay.loading = false;
  }
}

async function submitCombatSpecialAction() {
  const text = els.combatSpecialInput.value.trim();
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle;
  if (!text || !battle || state.combatOverlay.loading || combatActionCoolingDown()) return;
  startCombatActionCooldown();
  state.combatOverlay.loading = true;
  state.combatOverlay.error = '';
  state.combatOverlay.statusText = '正在裁定特殊动作...';
  renderCombatOverlay();
  try {
    const judged = await executeCombatTool('system.combat.judge_special_action', {
      chatSessionId: state.activeChatId,
      sceneId: battle.sceneId || 'current',
      battleId: battle.battleId,
      actorId: state.combatOverlay.actorId,
      targetId: state.combatOverlay.targetId,
      text,
      sourceText: text,
      useLlm: true
    });
    const action = judged.judgement?.combatAction;
    if (action && judged.judgement?.actionMode === 'normalCombatAction') {
      const resolved = await executeCombatTool('system.combat.resolve_action', {
        ...action,
        chatSessionId: state.activeChatId,
        sceneId: battle.sceneId || 'current',
        battleId: battle.battleId,
        actorId: action.actorId || state.combatOverlay.actorId,
        targetIds: action.targetIds || (state.combatOverlay.targetId ? [state.combatOverlay.targetId] : undefined),
        sourceText: text
      });
      showDiceRollNoticeFromCombatResolution(resolved, '特殊动作骰子');
      state.combatOverlay.statusText = judged.judgement?.summary || '特殊动作已裁定并结算。';
    } else {
      state.combatOverlay.statusText = judged.judgement?.summary || '特殊动作已记录，等待后续裁定。';
    }
    els.combatSpecialInput.value = '';
    state.combatOverlay.specialOpen = false;
    await refreshCombatOverlayState({ autoOpen: true, battleId: battle.battleId });
  } catch (error) {
    state.combatOverlay.error = error.message || String(error);
  } finally {
    state.combatOverlay.loading = false;
    renderCombatOverlay();
  }
}

async function surrenderCombat() {
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle;
  if (!battle || state.combatOverlay.loading) return;
  await endCombatBattle('lost', '玩家选择投降。');
}

async function debugWinCombat() {
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle;
  if (!battle?.battleId || isCombatTerminalStatus(battle.status)) {
    setDebugPanelStatus('没有正在进行的战斗。', 'error');
    return;
  }
  if (state.combatOverlay.loading || state.debugPanel.loading) return;
  setDebugPanelStatus('正在执行战斗一键胜利...');
  await endCombatBattle('won', 'Debug 一键胜利。');
  setDebugPanelStatus('战斗已按 Debug 一键胜利结束。');
}

async function finishWonCombat() {
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle;
  if (!battle || state.combatOverlay.loading) return;
  await endCombatBattle('won', '敌方血量归零，玩家胜利。');
}

async function endCombatBattle(outcome, summary) {
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle;
  state.combatOverlay.loading = true;
  state.combatOverlay.error = '';
  state.combatOverlay.statusText = '正在结束战斗...';
  renderCombatOverlay();
  try {
    await executeCombatTool('system.combat.end_battle', {
      chatSessionId: state.activeChatId,
      sceneId: battle.sceneId || 'current',
      battleId: battle.battleId,
      outcome,
      summary
    });
    state.combatOverlay.statusText = `战斗已结束：${combatStatusLabel(outcome)}`;
    await refreshCombatOverlayState({ autoOpen: true, battleId: battle.battleId });
  } catch (error) {
    state.combatOverlay.error = error.message || String(error);
  } finally {
    state.combatOverlay.loading = false;
    renderCombatOverlay();
  }
}

function combatEnemiesDefeated(enemies = state.combatOverlay.enemies) {
  return enemies.length > 0 && enemies.every((enemy) => combatantDefeated(enemy));
}

function isDebugCombatBattle(battle = {}) {
  const data = battle.data || battle || {};
  const metadata = data.metadata || {};
  return metadata.debug === true
    || String(data.battleId || '').startsWith('debug_battle_')
    || /debug/i.test(String(data.name || ''));
}

function combatantDefeated(combatant = {}) {
  const data = combatant.data || combatant || {};
  const hp = combatantHp(data);
  const statuses = [
    data.status,
    data.statusBar?.deathState,
    ...(Array.isArray(data.specialStatuses) ? data.specialStatuses.map((item) => item.status || item.name || item.id) : [])
  ].join(' ').toLowerCase();
  return hp.current <= 0 || /(dead|defeated|dying|unconscious|死亡|击败|倒下)/i.test(statuses);
}

function combatantHp(data = {}) {
  const values = data.values || {};
  const statusBar = data.statusBar || {};
  const current = Number(firstPresent(data.currentHp, data.hp, values.hp, statusBar.hp, values.maxHp, statusBar.maxHp, 0)) || 0;
  const max = Number(firstPresent(data.maxHp, values.maxHp, statusBar.maxHp, current)) || 0;
  const percent = max > 0 ? clamp((current / max) * 100, 0, 100) : (current > 0 ? 100 : 0);
  return { current, max, percent, defeated: current <= 0 };
}

function combatantArmorClass(combatant = {}) {
  const data = combatant.data || combatant || {};
  const value = firstPresent(data.values?.armorClass, data.values?.ac, data.statusBar?.armorClass, data.statusBar?.ac);
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function combatantId(combatant = {}) {
  const data = combatant.data || combatant || {};
  return data.npcId || data.playerId || data.actorId || combatant.id || '';
}

function normalizeCombatIdList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function combatStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'loading') return '读取中';
  if (normalized === 'active') return '战斗中';
  if (normalized === 'won') return '胜利';
  if (normalized === 'lost') return '失败';
  if (normalized === 'fled') return '撤退';
  if (normalized === 'ended') return '结束';
  return status || '战斗';
}

function combatStatusSummary(data = {}) {
  const statuses = combatConditionList(data);
  return statuses.slice(0, 3).join('，') || '正常';
}

function combatConditionList(data = {}) {
  const statusBar = combatObject(data.statusBar);
  return [...new Set([
    data.status,
    statusBar.status,
    statusBar.deathState,
    ...normalizeCombatArray(statusBar.conditions),
    ...normalizeCombatArray(statusBar.statuses),
    ...normalizeCombatArray(statusBar.effects),
    ...normalizeCombatArray(data.specialStatuses).map((item) => {
      const status = combatObject(item);
      return status.name || status.status || status.id || (typeof item === 'string' ? item : '');
    })
  ].map((item) => String(item || '').trim()).filter(Boolean))];
}

function combatObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resourceIdLabel(id = '') {
  const labels = {
    action: '行动',
    bonusAction: '附赠',
    reaction: '反应',
    movement: '移动',
    level1: '1环',
    level2: '2环',
    level3: '3环',
    level4: '4环',
    level5: '5环',
    level6: '6环',
    level7: '7环',
    level8: '8环',
    level9: '9环'
  };
  if (labels[id]) return labels[id];
  return String(id || '资源').replace(/[_-]+/g, ' ');
}

function combatActionKindLabel(kind = '') {
  const value = String(kind || '').toLowerCase();
  if (/heal/.test(value)) return '治疗';
  if (/status|effect/.test(value)) return '状态';
  if (/defense|dodge/.test(value)) return '防御';
  return '攻击';
}

function combatActionDetail(action = {}) {
  const damage = Array.isArray(action.damage) && action.damage.length
    ? `伤害 ${action.damage.map((item) => `${item.amount || ''}${item.type || ''}`).join('，')}`
    : '';
  const cost = Array.isArray(action.resourceCosts) && action.resourceCosts.length
    ? `消耗 ${action.resourceCosts.map((item) => `${item.resource || item.resourceId || item.kind || ''} ${item.amount || 1}`).join('，')}`
    : '';
  return [damage, cost, action.source].filter(Boolean).join(' · ') || '普通战斗动作';
}

function combatSkillStatItems(action = {}) {
  const items = [];
  const attack = action.attack || {};
  const damage = normalizeCombatArray(action.damage);
  const healing = normalizeCombatArray(action.healing || action.heals);
  const statuses = normalizeCombatArray(action.statusEffects || action.statuses || action.conditions);
  const costs = normalizeCombatArray(action.resourceCosts || action.costs);
  const metadata = action.metadata || {};
  if (attack.successThreshold || attack.dc) items.push({ label: 'DC/AC', value: String(attack.successThreshold || attack.dc) });
  if (attack.modifier !== undefined) items.push({ label: '命中', value: formatSignedNumber(attack.modifier) });
  if (attack.diceCount || attack.diceSides) items.push({ label: '骰子', value: `${attack.diceCount || 1}d${attack.diceSides || 20}` });
  if (damage.length) {
    items.push({
      label: '伤害',
      value: damage.map((item) => `${item.amount ?? item.value ?? '?'} ${item.type || item.damageType || ''}`.trim()).join(' / ')
    });
  }
  if (healing.length) {
    items.push({
      label: '治疗',
      value: healing.map((item) => `${item.amount ?? item.value ?? '?'} ${item.type || 'HP'}`).join(' / ')
    });
  }
  if (action.temporaryHp) items.push({ label: '临时HP', value: formatValue(action.temporaryHp.amount ?? action.temporaryHp) });
  if (statuses.length) {
    items.push({
      label: '状态',
      value: statuses.map((item) => item.name || item.status || item.id || formatValue(item)).join(' / ')
    });
  }
  if (costs.length) {
    items.push({
      label: '消耗',
      value: costs.map((item) => `${item.resource || item.resourceId || item.kind || '资源'} ${item.amount || 1}`).join(' / ')
    });
  } else {
    items.push({ label: '动作', value: action.consumeAction === false ? '不耗行动' : '消耗行动' });
  }
  if (action.cooldown || metadata.cooldown) items.push({ label: 'CD', value: String(action.cooldown || metadata.cooldown) });
  if (action.source) items.push({ label: '来源', value: combatSkillSourceLabel(action.source) });
  return items.slice(0, 8);
}

function normalizeCombatArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function combatSkillSourceLabel(source = '') {
  if (source === 'actor_state') return '角色状态';
  if (source === 'mechanics_registry') return '机制库';
  if (source === 'default_basic_attack') return '默认';
  return source;
}

function combatActionName(actionId) {
  const action = state.combatOverlay.actions.find((item) => item.actionId === actionId || item.id === actionId);
  return action?.name || actionId;
}

function combatEventTitle(data = {}) {
  if (data.eventType === 'start') return '战斗开始';
  if (data.eventType === 'end') return '战斗结束';
  if (data.eventType === 'special_judgement') return '特殊动作裁定';
  if (data.eventType === 'action') return '战斗动作';
  return data.eventType || '战斗记录';
}

async function refreshRelationshipSources({ silent = false } = {}) {
  state.relationshipDiscovery.loading = true;
  state.relationshipDiscovery.error = '';
  renderPlayerActionMenuItems();
  try {
    const toolSources = discoverToolRelationshipSources(state.tools);
    let collectionMap = new Map();
    try {
      collectionMap = await loadGlobalCollectionSchemaMap();
    } catch (error) {
      state.relationshipDiscovery.error = `全局数据库 schema 读取失败：${error.message || String(error)}`;
    }
    const collectionSources = discoverCollectionRelationshipSources(collectionMap);
    state.relationshipDiscovery.collectionMap = collectionMap;
    state.relationshipSources = mergeRelationshipSources([...toolSources, ...collectionSources]);
    if (!silent && state.relationshipDiscovery.error) showToast(state.relationshipDiscovery.error);
  } catch (error) {
    state.relationshipDiscovery.error = error.message || String(error);
    if (!silent) showToast(state.relationshipDiscovery.error);
  } finally {
    state.relationshipDiscovery.loading = false;
    renderPlayerActionMenuItems();
    if (els.dbQueryControllerDialog?.open) renderDbQueryController();
  }
}

function mergeRelationshipSources(sources = []) {
  const byId = new Map();
  for (const source of sources) {
    if (!source?.id) continue;
    const current = byId.get(source.id);
    byId.set(source.id, current ? { ...current, ...source } : source);
  }
  return [...byId.values()].sort((a, b) => {
    const staticDelta = Number(Boolean(b.staticAction)) - Number(Boolean(a.staticAction));
    return staticDelta || String(a.title || a.id).localeCompare(String(b.title || b.id));
  });
}

function discoverToolRelationshipSources(tools = []) {
  const groups = new Map();
  for (const tool of tools) {
    if (!tool?.id || tool.enabled === false) continue;
    const parts = tool.id.split('.');
    if (parts.length < 3) continue;
    const operation = parts.at(-1);
    const key = parts.slice(0, -1).join('.');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...tool, operation });
  }

  const sources = [];
  for (const [key, groupTools] of groups.entries()) {
    const toolByOperation = new Map(groupTools.map((tool) => [tool.operation, tool]));
    const nodeTool = firstToolByOperation(toolByOperation, ['list_nodes', 'list_factions', 'list_vertices']);
    const edgeTool = firstToolByOperation(toolByOperation, ['list_edges', 'list_relations', 'list_links']);
    const memberTool = firstToolByOperation(toolByOperation, ['list_memberships', 'list_members', 'list_affiliations']);
    const sceneGraphTool = firstToolByOperation(toolByOperation, ['build_scene_graph', 'build_graph']);
    const describeTool = firstToolByOperation(toolByOperation, ['describe_graph']);
    const hasGraphTags = groupTools.some((tool) => {
      const text = `${tool.id} ${tool.title || ''} ${tool.description || ''} ${(tool.tags || []).join(' ')}`;
      return /\b(graph|relationship|relation|edge|node|membership|movement)\b/i.test(text);
    });
    if (!(edgeTool && (nodeTool || memberTool || sceneGraphTool || describeTool)) && !(sceneGraphTool && hasGraphTags)) continue;

    const builtIn = BUILTIN_RELATIONSHIP_SOURCES[key] || {};
    const title = builtIn.title || relationshipToolTitle(key, groupTools);
    sources.push({
      id: `tool:${key}`,
      key,
      sourceType: 'tool-graph',
      title,
      subtitle: `自动发现的关系图工具：${key}`,
      mark: builtIn.mark || relationshipSourceMark(title),
      graphKind: builtIn.kind || inferGraphKindFromText(`${key} ${title}`),
      nodeToolId: nodeTool?.id || '',
      edgeToolId: edgeTool?.id || '',
      memberToolId: memberTool?.id || '',
      sceneGraphToolId: sceneGraphTool?.id || '',
      describeToolId: describeTool?.id || '',
      toolProps: Object.fromEntries(groupTools.map((tool) => [
        tool.id,
        new Set(Object.keys(tool.inputSchema?.properties || {}))
      ])),
      staticAction: builtIn.action || '',
      reason: describeTool ? '工具组提供 describe_graph/list_* 图谱接口。' : '工具组提供节点和边读取接口。'
    });
  }
  return sources;
}

function firstToolByOperation(toolByOperation, operations) {
  return operations.map((operation) => toolByOperation.get(operation)).find(Boolean);
}

function relationshipToolTitle(key, tools = []) {
  const describe = tools.find((tool) => tool.operation === 'describe_graph');
  const list = tools.find((tool) => /^list_/.test(tool.operation));
  const title = describe?.title || list?.title || key.split('.').at(-1) || key;
  return title
    .replace(/^Describe\s+/i, '')
    .replace(/\s+(Nodes|Edges|Relations|Memberships)$/i, '')
    .replace(/\s+Graph$/i, ' 图')
    .replace(/Relationship/i, '关系');
}

async function loadGlobalCollectionSchemaMap() {
  if (!relationshipToolAvailable('system.data.list_collections') || !relationshipToolAvailable('system.data.describe_collection')) {
    return new Map();
  }
  const listed = await executeTool('system.data.list_collections', {}, { source: 'web-ui.relationship-discovery' });
  const names = normalizeCollectionNames(listed.collections || listed.records || []);
  const described = await Promise.all(names.slice(0, 160).map(async (name) => {
    try {
      const info = await executeTool('system.data.describe_collection', { collection: name }, { source: 'web-ui.relationship-discovery' });
      return normalizeCollectionInfo(name, info);
    } catch {
      return normalizeCollectionInfo(name, { collection: name, fields: [] });
    }
  }));
  return new Map(described.map((info) => [info.collection, info]));
}

function relationshipToolAvailable(toolId) {
  return toolAvailable(toolId);
}

function normalizeCollectionNames(collections = []) {
  return collections
    .map((item) => typeof item === 'string' ? item : item.collection || item.name)
    .map((name) => String(name || '').trim())
    .filter(Boolean);
}

function normalizeCollectionInfo(name, info = {}) {
  const collection = info.collection || info.name || name;
  return {
    ...info,
    name: collection,
    collection,
    fields: Array.isArray(info.fields) ? info.fields : []
  };
}

function discoverCollectionRelationshipSources(collectionMap = new Map()) {
  const sources = [];
  const names = new Set(collectionMap.keys());
  const classifications = new Map([...collectionMap.entries()].map(([name, info]) => [
    name,
    classifyCollectionSchema(info, names)
  ]));

  for (const [collection, classification] of classifications.entries()) {
    if (classification.kind !== 'relationship') continue;
    if (classification.role === 'node') continue;
    if (classification.role === 'membership' && siblingEdgeCollection(collection, collectionMap)) continue;
    const edgeCollection = collection;
    const nodeCollection = findNodeCollectionForEdge(edgeCollection, collectionMap);
    const memberCollection = findMembershipCollectionForEdge(edgeCollection, collectionMap);
    const source = {
      id: `collection:${edgeCollection}`,
      key: edgeCollection,
      sourceType: 'collection-graph',
      title: relationshipCollectionTitle(edgeCollection),
      subtitle: `自动发现的关系库：${edgeCollection}`,
      mark: relationshipSourceMark(edgeCollection),
      graphKind: inferGraphKindFromText(edgeCollection),
      edgeCollection,
      nodeCollection,
      memberCollection,
      collections: [nodeCollection, edgeCollection, memberCollection].filter(Boolean),
      collectionFields: Object.fromEntries([nodeCollection, edgeCollection, memberCollection]
        .filter(Boolean)
        .map((name) => [name, dbQueryFieldNames(collectionMap.get(name))])),
      endpointFields: classification.endpointFields || {},
      membershipFields: classifications.get(memberCollection)?.endpointFields || {},
      staticAction: staticActionForCollectionGraph(edgeCollection),
      reason: classification.reason
    };
    sources.push(source);
  }
  return sources;
}

function classifyCollectionSchema(collectionInfo = {}, allCollectionNames = new Set()) {
  const collection = String(collectionInfo.collection || collectionInfo.name || '').trim();
  const fields = dbQueryFieldNames(collectionInfo);
  const lowerName = collection.toLowerCase();
  const endpointFields = detectEndpointFields(fields);
  const nameLooksRelationship = /(relation|relationship|edge|graph|link|route|path|adjacency|membership|member|affiliation|alliance)/i.test(collection);
  const eventLike = /(events?|history|logs?|records?|journal|timeline|clock|battle|encounter|quest|trigger|compression)/i.test(collection);
  const relationMarkers = fields.some((field) => /^(relationType|relationshipType|edgeType|label|direction|directed|weight|strength|trust|tension|attitude|cost|distance|travelMode|visibility)$/i.test(field));
  const pairedNode = /_nodes?$/.test(lowerName) && hasLikelySiblingEdgeCollection(collection, allCollectionNames);

  if (endpointFields && (nameLooksRelationship || relationMarkers) && !eventLike) {
    return {
      kind: 'relationship',
      role: endpointFields.role,
      confidence: nameLooksRelationship ? 0.95 : 0.82,
      endpointFields,
      reason: `有端点字段 ${endpointFields.from} -> ${endpointFields.to}${relationMarkers ? '，并带关系属性字段。' : '。'}`
    };
  }
  if (pairedNode) {
    return {
      kind: 'relationship',
      role: 'node',
      confidence: 0.88,
      endpointFields: {},
      reason: '节点表与同前缀 edges/relations 表成对。'
    };
  }
  if (nameLooksRelationship && /(_edges?|_relations?|_links?|_memberships?)$/.test(lowerName)) {
    return {
      kind: 'relationship',
      role: /membership|member/.test(lowerName) ? 'membership' : 'edge',
      confidence: 0.7,
      endpointFields: endpointFields || {},
      reason: 'collection 名称表示边/关系/隶属；未识别端点时会尽量从记录里推断。'
    };
  }
  return {
    kind: 'field-data',
    role: 'data',
    confidence: eventLike && endpointFields ? 0.78 : 0.9,
    endpointFields: endpointFields || {},
    reason: eventLike && endpointFields
      ? '这是事件/历史记录表；端点字段表示一次事件的参与者，不按稳定关系图处理。'
      : '没有稳定的关系端点字段，按字段和数据列表处理。'
  };
}

function detectEndpointFields(fields = []) {
  const originalByLower = new Map(fields.map((field) => [field.toLowerCase(), field]));
  const findExact = (names) => names.map((name) => originalByLower.get(name.toLowerCase())).find(Boolean);
  const membership = [
    ['actorId', 'factionId'],
    ['npcId', 'factionId'],
    ['characterId', 'factionId'],
    ['memberId', 'partyId'],
    ['actorId', 'groupId'],
    ['memberId', 'groupId']
  ].map(([from, to]) => [findExact([from]), findExact([to])]).find(([from, to]) => from && to);
  if (membership) return { role: 'membership', from: membership[0], to: membership[1] };

  const from = fields.find((field) => isEndpointFieldName(field, ['from', 'source', 'start']));
  const to = fields.find((field) => isEndpointFieldName(field, ['to', 'target', 'end']));
  if (from && to) return { role: 'edge', from, to };
  return undefined;
}

function isEndpointFieldName(field, prefixes) {
  const lower = String(field || '').toLowerCase();
  if (/sourcetext|sourcefile|sourceidfield/.test(lower)) return false;
  return prefixes.some((prefix) => {
    if (lower === prefix) return prefix === 'from' || prefix === 'to';
    if (!lower.startsWith(prefix)) return false;
    return /(id|npc|faction|map|node|actor|character|member|group|area|location|scene)$/.test(lower);
  });
}

function hasLikelySiblingEdgeCollection(collection, allNames) {
  const base = collection.replace(/_nodes?$/i, '');
  return [
    `${base}_edges`,
    `${base}_edge`,
    `${base}_relations`,
    `${base}_relation_edges`,
    `${base.replace(/_relation$/i, '')}_edges`
  ].some((name) => allNames.has(name));
}

function findNodeCollectionForEdge(edgeCollection, collectionMap) {
  const base = relationshipCollectionBase(edgeCollection);
  return [
    `${base}_nodes`,
    `${base}_node`,
    `${base.replace(/_relation$/i, '')}_nodes`,
    edgeCollection.replace(/_edges?$/i, '_nodes').replace(/_relations?$/i, '_nodes').replace(/_links?$/i, '_nodes')
  ].find((name) => collectionMap.has(name)) || '';
}

function findMembershipCollectionForEdge(edgeCollection, collectionMap) {
  const base = relationshipCollectionBase(edgeCollection).replace(/_relation$/i, '');
  return [
    `${base}_memberships`,
    `${base}_membership`,
    `${base}_members`,
    `${relationshipCollectionBase(edgeCollection)}_memberships`
  ].find((name) => collectionMap.has(name)) || '';
}

function siblingEdgeCollection(membershipCollection, collectionMap) {
  const base = relationshipCollectionBase(membershipCollection).replace(/_membership$/i, '').replace(/_members$/i, '');
  return [
    `${base}_edges`,
    `${base}_relations`,
    `${base}_relation_edges`
  ].find((name) => collectionMap.has(name)) || '';
}

function relationshipCollectionBase(collection) {
  return String(collection || '')
    .replace(/_relation_edges?$/i, '_relation')
    .replace(/_edges?$/i, '')
    .replace(/_relations?$/i, '')
    .replace(/_links?$/i, '')
    .replace(/_memberships?$/i, '');
}

function staticActionForCollectionGraph(edgeCollection) {
  if (edgeCollection === 'npc_relation_edges') return 'npcGraph';
  if (edgeCollection === 'faction_edges') return 'factionGraph';
  if (edgeCollection === 'map_relation_edges') return 'map';
  return '';
}

function relationshipCollectionTitle(collection) {
  const base = relationshipCollectionBase(collection)
    .replace(/_relation$/i, '')
    .replace(/_/g, ' ')
    .trim();
  return `${titleCase(base || collection)}图`;
}

function inferGraphKindFromText(text = '') {
  if (/map|scene|movement|route|path/i.test(text)) return 'map';
  if (/faction|guild|group|party|membership/i.test(text)) return 'faction';
  if (/npc|actor|character|person/i.test(text)) return 'npc';
  return 'graph';
}

function titleCase(value = '') {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function loadChatData() {
  if (!state.activeChatId) {
    els.dataCollections.innerHTML = '';
    return;
  }
  const payload = await api(`/v1/app/chats/${encodeURIComponent(state.activeChatId)}/data-db/collections`);
  renderDataCollections(payload.collections || []);
}

async function loadPlayerActionData(action) {
  const collections = await loadAvailableChatDataCollections();
  if (isDynamicGraphAction(action)) {
    return loadDynamicRelationshipGraphData(action, collections);
  }
  if (action === 'inventory' || action === 'status' || action === 'skills') {
    const actors = await loadPlayerActorRecords(collections);
    const slotUseByActor = action === 'inventory' || action === 'skills'
      ? await loadPlayerSlotUseByActor(actors)
      : {};
    return {
      action,
      actors,
      slotUseByActor,
      collectionMap: collections,
      collections: ['npc_structured_states']
    };
  }
  if (action === 'map') {
    const [mounts, mapStates, scenes, sceneGraph] = await Promise.all([
      queryChatDataCollectionIfAvailable(collections, 'scene_map_mounts', {
        sort: [{ field: 'orderIndex', direction: 'asc' }, { field: 'updatedAt', direction: 'desc' }],
        limit: 100
      }),
      queryChatDataCollectionIfAvailable(collections, 'map_structured_states', {
        sort: [{ field: 'sceneId', direction: 'asc' }, { field: 'name', direction: 'asc' }],
        limit: 100
      }),
      queryChatDataCollectionIfAvailable(collections, 'scene_records', {
        sort: [{ field: 'updatedAt', direction: 'desc' }],
        limit: 10
      }),
      loadSceneMapGraph()
    ]);
    return {
      action,
      mounts,
      mapStates,
      scenes,
      sceneGraph,
      collectionMap: collections,
      collections: ['scene_map_mounts', 'map_structured_states', 'scene_records']
    };
  }
  if (action === 'npcGraph') {
    const [nodes, edges] = await Promise.all([
      executeTool('system.npc_relationships.list_nodes', { limit: 500 }, { source: 'web-ui.player-action.npc-graph' }),
      executeTool('system.npc_relationships.list_edges', {
        includeIncoming: true,
        includeOutgoing: true,
        includeArchived: false,
        limit: 500
      }, { source: 'web-ui.player-action.npc-graph' })
    ]);
    return {
      action,
      nodes: nodes.records || [],
      edges: edges.records || []
    };
  }
  if (action === 'factionGraph') {
    const [factions, relations, memberships] = await Promise.all([
      executeTool('system.factions.list_factions', {
        includeHidden: true,
        limit: 500
      }, { source: 'web-ui.player-action.faction-graph' }),
      executeTool('system.factions.list_relations', {
        includeArchived: false,
        limit: 500
      }, { source: 'web-ui.player-action.faction-graph' }),
      executeTool('system.factions.list_memberships', {
        includeArchived: false,
        limit: 500
      }, { source: 'web-ui.player-action.faction-graph' })
    ]);
    return {
      action,
      factions: factions.records || [],
      relations: relations.records || [],
      memberships: memberships.records || []
    };
  }
  return { action };
}

async function loadSceneMapGraph() {
  try {
    return await executeTool('system.map_relationships.build_scene_graph', {
      chatSessionId: state.activeChatId,
      sceneId: 'current',
      includeGlobal: true,
      includeMountedMaps: true,
      includeStructuredState: true,
      includeParentLinks: true,
      includeInactive: true,
      includeBlocked: true,
      includeHidden: true
    }, { source: 'web-ui.player-action.map-graph' });
  } catch (error) {
    return {
      nodes: [],
      edges: [],
      sources: [],
      error: error.message || String(error)
    };
  }
}

async function loadDynamicRelationshipGraphData(action) {
  const source = dynamicGraphSourceForAction(action);
  if (!source) throw new Error('没有找到这个关系图来源，刷新工具列表后再试。');
  if (source.sourceType === 'tool-graph') return loadToolRelationshipGraphData(action, source);
  if (source.sourceType === 'collection-graph') return loadCollectionRelationshipGraphData(action, source);
  return { action, graphSource: source, nodes: [], edges: [] };
}

async function loadToolRelationshipGraphData(action, source) {
  const context = { source: `web-ui.player-action.${source.key || source.id}` };
  if (source.sceneGraphToolId) {
    const sceneGraph = await executeRelationshipTool(source, source.sceneGraphToolId, {
      chatSessionId: state.activeChatId,
      sceneId: 'current',
      includeGlobal: true,
      includeMountedMaps: true,
      includeStructuredState: true,
      includeParentLinks: true,
      includeInactive: true,
      includeBlocked: true,
      includeHidden: true,
      limit: RELATIONSHIP_SOURCE_LIMIT
    }, context);
    return {
      action,
      graphSource: source,
      nodes: relationshipOutputRecords(sceneGraph.nodes || sceneGraph.records || []),
      edges: relationshipOutputRecords(sceneGraph.edges || []),
      sources: sceneGraph.sources || []
    };
  }

  const [nodes, edges, memberships] = await Promise.all([
    source.nodeToolId
      ? executeRelationshipTool(source, source.nodeToolId, { includeHidden: true, limit: RELATIONSHIP_SOURCE_LIMIT }, context)
      : Promise.resolve({ records: [] }),
    source.edgeToolId
      ? executeRelationshipTool(source, source.edgeToolId, {
        includeIncoming: true,
        includeOutgoing: true,
        includeArchived: false,
        includeHidden: true,
        includeBlocked: true,
        limit: RELATIONSHIP_SOURCE_LIMIT
      }, context)
      : Promise.resolve({ records: [] }),
    source.memberToolId
      ? executeRelationshipTool(source, source.memberToolId, {
        includeArchived: false,
        includeHidden: true,
        limit: RELATIONSHIP_SOURCE_LIMIT
      }, context)
      : Promise.resolve({ records: [] })
  ]);
  return {
    action,
    graphSource: source,
    nodes: relationshipOutputRecords(nodes.records || nodes.nodes || []),
    edges: relationshipOutputRecords(edges.records || edges.edges || []),
    memberships: relationshipOutputRecords(memberships.records || memberships.memberships || [])
  };
}

async function executeRelationshipTool(source, toolId, input, context) {
  const knownInput = filterToolInput(source, toolId, input);
  const attempts = [knownInput, { limit: RELATIONSHIP_SOURCE_LIMIT }, {}];
  let lastError;
  for (const attempt of attempts) {
    try {
      return await executeTool(toolId, attempt, context);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function filterToolInput(source, toolId, input) {
  const props = source.toolProps?.[toolId];
  if (!props || props.size === 0) return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) => props.has(key)));
}

async function loadCollectionRelationshipGraphData(action, source) {
  const queryCollection = async (collection) => {
    if (!collection) return [];
    const fields = source.collectionFields?.[collection] || [];
    const selectedFields = fields.filter((field) => !['id', 'created_at', 'updated_at', '_json'].includes(field));
    const output = await executeTool('system.data.query_fields', {
      collection,
      fields: selectedFields.length > 0 ? selectedFields : fields,
      limit: RELATIONSHIP_SOURCE_LIMIT
    }, { source: `web-ui.player-action.${source.key || source.id}` });
    return relationshipOutputRecords(output.records || []);
  };
  const [nodes, edges, memberships] = await Promise.all([
    queryCollection(source.nodeCollection),
    queryCollection(source.edgeCollection),
    queryCollection(source.memberCollection)
  ]);
  return {
    action,
    graphSource: source,
    collectionMap: state.relationshipDiscovery.collectionMap,
    collections: source.collections || [],
    nodes,
    edges,
    memberships
  };
}

function relationshipOutputRecords(records = []) {
  return Array.isArray(records) ? records : [];
}

async function loadAvailableChatDataCollections(chatId = state.activeChatId) {
  if (!chatId) return new Map();
  const payload = await api(`/v1/app/chats/${encodeURIComponent(chatId)}/data-db/collections`);
  const registeredNames = new Set((payload.database?.schemaSnapshot?.collections || [])
    .map((collection) => collection.name || collection.collection)
    .filter(Boolean));
  const collections = Array.isArray(payload.database?.schemaSnapshot?.collections)
    ? (payload.collections || []).filter((collection) => registeredNames.has(collection.collection || collection.name))
    : (payload.collections || []);
  return normalizeChatDataCollectionMap(collections);
}

function normalizeChatDataCollectionMap(collections = []) {
  const map = new Map();
  for (const collection of collections) {
    const name = collection.collection || collection.name;
    if (!name) continue;
    map.set(name, {
      ...collection,
      name,
      collection: name,
      fields: Array.isArray(collection.fields) ? collection.fields : []
    });
  }
  return map;
}

async function loadPlayerActorRecords(collections, chatId = state.activeChatId) {
  let records = await queryChatDataCollectionIfAvailable(collections, 'npc_structured_states', {
    filter: { isPlayer: true },
    sort: [{ field: 'updatedAt', direction: 'desc' }],
    limit: 50
  }, chatId);
  if (records.length === 0) {
    records = await queryChatDataCollectionIfAvailable(collections, 'npc_structured_states', {
      filter: { actorType: 'player' },
      sort: [{ field: 'updatedAt', direction: 'desc' }],
      limit: 50
    }, chatId);
  }
  if (records.length === 0) {
    const allActors = await queryChatDataCollectionIfAvailable(collections, 'npc_structured_states', {
      sort: [{ field: 'updatedAt', direction: 'desc' }],
      limit: 100
    }, chatId);
    records = allActors.filter((record) => isPlayerActor(record.data));
  }
  if (records.length === 0 && toolAvailable('system.npc_state.list_states')) {
    try {
      const output = await executeTool('system.npc_state.list_states', {
        chatSessionId: chatId,
        limit: 200
      }, buildManagedToolExecutionContext({
        source: 'web-ui.player-action.npc-state-fallback',
        authorization: true
      }));
      records = (output.records || []).filter((record) => isPlayerActor(record.data || record));
    } catch {
      // Chat Data schema compatibility fallback is optional.
    }
  }
  return records;
}

async function loadPlayerSlotUseByActor(actors = []) {
  const byActor = {};
  if (!toolAvailable('system.slot_use.list_slots')) {
    for (const record of actors) {
      const key = playerActionActorSlotKey(record);
      if (key) byActor[key] = { unavailable: true, itemSlots: [], skillSlots: [], slots: [] };
    }
    return byActor;
  }
  const entries = await Promise.all((actors || []).map(async (record) => {
    const actor = record.data || {};
    const actorId = playerActionActorId(actor, record);
    const sceneId = actor.sceneId || 'current';
    const key = playerActionActorSlotKey(record);
    if (!actorId || !key) return undefined;
    try {
      const output = await executeTool('system.slot_use.list_slots', {
        chatSessionId: state.activeChatId,
        sceneId,
        actorId,
        includeBasicAttack: false
      }, buildManagedToolExecutionContext({
        source: 'web-ui.player-action.slot-use.list',
        authorization: true
      }));
      return [key, output];
    } catch (error) {
      return [key, {
        error: error.message || String(error),
        itemSlots: [],
        skillSlots: [],
        slots: []
      }];
    }
  }));
  for (const entry of entries.filter(Boolean)) byActor[entry[0]] = entry[1];
  return byActor;
}

function playerActionActorSlotKey(record = {}) {
  const actor = record.data || {};
  const actorId = playerActionActorId(actor, record);
  const sceneId = actor.sceneId || 'current';
  return actorId ? `${sceneId}:${actorId}` : '';
}

function playerActionActorId(actor = {}, record = {}) {
  return actor.npcId || actor.playerId || actor.actorId || actor.id || String(record.id || '').replace(/^npcstate_[^_]+_/, '');
}

async function queryChatDataCollectionIfAvailable(collections, collection, body = {}, chatId = state.activeChatId) {
  if (!chatId || !collections.has(collection)) return [];
  try {
    const payload = await api(`/v1/app/chats/${encodeURIComponent(chatId)}/data-db/collections/${encodeURIComponent(collection)}/query`, {
      method: 'POST',
      body
    });
    return payload.records || [];
  } catch (error) {
    if (/not registered|Collection not found|collection/i.test(error.message || '')) return [];
    throw error;
  }
}

function isPlayerActor(data = {}) {
  return data.isPlayer === true
    || data.isProtagonist === true
    || data.data?.isPlayer === true
    || data.data?.isProtagonist === true
    || data.actorType === 'player'
    || Boolean(data.playerId)
    || Boolean(data.data?.playerId)
    || data.type === 'player';
}

async function maybeOpenNpcSettingOnboarding({ chatId = state.activeChatId, force = false } = {}) {
  if (!chatId) return false;
  if (!force && state.npcSettingOnboarding.prompted.has(chatId)) return false;

  const status = await readNpcSettingBindingStatus(chatId);
  if (status.bound) return false;

  const prompted = state.npcSettingOnboarding.prompted;
  const candidates = await loadNpcSettingCandidates(chatId);
  state.npcSettingOnboarding = {
    ...emptyNpcSettingOnboardingState(),
    prompted,
    chatId,
    mode: candidates.length > 0 ? 'select' : 'create',
    candidates,
    selectedKey: candidates[0]?.key || ''
  };
  prompted.add(chatId);
  if (state.npcSettingOnboarding.mode === 'create') {
    fillDefaultNpcSettingCreateFields();
  }
  renderNpcSettingDialog();
  if (!els.npcSettingDialog.open) els.npcSettingDialog.showModal();
  return true;
}

async function readNpcSettingBindingStatus(chatId) {
  try {
    const output = await executeTool('system.actor_control.get_context', { chatSessionId: chatId }, {
      source: 'web-ui.npc-setting-onboarding'
    });
    if (output?.context?.controlledActorId && output.context.requiresInitialization !== true) {
      return {
        bound: true,
        source: output.context.source || 'actor_control',
        actorId: output.context.controlledActorId
      };
    }
  } catch {
    // Fall through to the protagonist pointer.
  }

  try {
    const output = await executeTool('system.protagonist.get_active', { chatSessionId: chatId }, {
      source: 'web-ui.npc-setting-onboarding'
    });
    const actorId = output?.active?.data?.activeActorId;
    if (actorId) return { bound: true, source: 'protagonist_active', actorId };
  } catch {
    // Missing protagonist tooling should not block onboarding.
  }

  return { bound: false };
}

async function loadNpcSettingCandidates(chatId) {
  const candidates = new Map();
  const collections = await loadAvailableChatDataCollections(chatId);
  const stateRecords = await queryChatDataCollectionIfAvailable(collections, 'npc_structured_states', {
    sort: [{ field: 'updatedAt', direction: 'desc' }],
    limit: 200
  }, chatId);
  for (const record of stateRecords) {
    addNpcSettingCandidate(candidates, npcSettingCandidateFromStateRecord(record));
  }

  try {
    const output = await executeTool('system.npc_profiles.list_profiles', {
      includeArchived: false,
      limit: 300
    }, {
      source: 'web-ui.npc-setting-onboarding'
    });
    for (const record of output?.records || []) {
      addNpcSettingCandidate(candidates, npcSettingCandidateFromProfileRecord(record));
    }
  } catch {
    // Profiles are optional; chat-local state is enough to continue.
  }

  const allCandidates = [...candidates.values()].filter((candidate) => candidate?.npcId);
  const playerCandidates = allCandidates.filter((candidate) => candidate.isPlayer || candidate.isProtagonist);
  const visibleCandidates = playerCandidates.length > 0 ? playerCandidates : allCandidates;
  return visibleCandidates
    .sort((a, b) => npcSettingCandidateWeight(a) - npcSettingCandidateWeight(b)
      || String(a.name).localeCompare(String(b.name), 'zh-CN'));
}

function addNpcSettingCandidate(map, candidate) {
  if (!candidate?.npcId) return;
  const key = candidate.npcId;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }
  if (candidate.source === 'chat-state' && existing.source !== 'chat-state') {
    map.set(key, {
      ...candidate,
      profileId: existing.profileId,
      profileLevel: existing.profileLevel,
      summary: candidate.summary || existing.summary,
      greeting: candidate.greeting || existing.greeting
    });
    return;
  }
  if (!existing.profileLevel && candidate.profileLevel) {
    map.set(key, {
      ...existing,
      profileId: candidate.profileId,
      profileLevel: candidate.profileLevel,
      summary: existing.summary || candidate.summary,
      greeting: existing.greeting || candidate.greeting
    });
  }
}

function npcSettingCandidateFromStateRecord(record = {}) {
  const data = record.data || {};
  const npcId = normalizeNpcSettingId(data.npcId || data.playerId || data.protagonistId || record.id);
  const name = String(data.name || data.title || data.displayName || npcId || '玩家角色').trim();
  return {
    key: `state:${record.id}`,
    source: 'chat-state',
    npcId,
    playerId: normalizeNpcSettingId(data.playerId || data.protagonistId || npcId),
    name,
    summary: npcSettingSummary(data),
    greeting: npcSettingGreeting(data),
    detail: '当前聊天数据库 · npc_structured_states',
    isPlayer: isPlayerActor(data),
    isProtagonist: data.isProtagonist === true,
    recordId: record.id,
    stateData: data
  };
}

function npcSettingCandidateFromProfileRecord(record = {}) {
  const data = record.data || {};
  const npcId = normalizeNpcSettingId(data.npcId || data.playerId || data.protagonistId || data.data?.npcId || data.data?.playerId || record.id);
  const name = String(data.name || data.title || data.displayName || npcId || '玩家角色').trim();
  return {
    key: `profile:${record.id}`,
    source: 'npc-profile',
    npcId,
    playerId: normalizeNpcSettingId(data.playerId || data.protagonistId || data.data?.playerId || data.data?.protagonistId || npcId),
    name,
    summary: npcSettingSummary(data),
    greeting: npcSettingGreeting(data),
    detail: `NPC Profile${data.level ? ` · ${data.level}` : ''}`,
    isPlayer: isPlayerActor(data),
    isProtagonist: data.isProtagonist === true || data.data?.isProtagonist === true || data.metadata?.isProtagonist === true,
    profileId: record.id,
    profileLevel: data.level || ''
  };
}

function npcSettingSummary(data = {}) {
  const summary = data.summary || data.content || data.text || data.description || data.sections?.summary || data.metadata?.summary;
  if (summary && typeof summary === 'object') return JSON.stringify(summary).slice(0, 180);
  return String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function npcSettingGreeting(data = {}) {
  const greeting = firstPresent(
    data.greeting,
    data.initialGreeting,
    data.initialSituation,
    data.openingSituation,
    data.data?.greeting,
    data.data?.initialGreeting,
    data.data?.initialSituation,
    data.data?.openingSituation,
    data.metadata?.greeting,
    data.sections?.greeting,
    data.sections?.initialSituation
  );
  if (greeting && typeof greeting === 'object') return JSON.stringify(greeting).slice(0, 320);
  return String(greeting || '').replace(/\s+/g, ' ').trim().slice(0, 320);
}

function npcSettingCandidateWeight(candidate = {}) {
  if (candidate.isProtagonist) return 0;
  if (candidate.isPlayer) return 1;
  if (candidate.source === 'chat-state') return 2;
  return 3;
}

function renderNpcSettingDialog() {
  const stateView = state.npcSettingOnboarding;
  const createMode = stateView.mode === 'create';
  els.npcSettingDialogTitle.textContent = createMode ? '创建玩家 NPC 设定' : '选择玩家 NPC 设定';
  els.npcSettingDialogIntro.textContent = createMode
    ? '当前聊天没有可用的玩家候选。这里会创建一个最小设定并绑定为唯一主角；开局处境留空时不会固定 greeting。'
    : '选择本聊天要使用的玩家/主角 NPC 设定。多个玩家候选不会自动猜测；选中后会写入唯一 isProtagonist 标识。';
  els.npcSettingSelectView.hidden = createMode;
  els.npcSettingCreateView.hidden = !createMode;
  els.npcSettingBackButton.hidden = !createMode || stateView.candidates.length === 0;
  els.npcSettingCreateModeButton.hidden = stateView.candidates.length === 0;
  els.npcSettingConfirmButton.textContent = createMode ? '创建并使用' : '使用这个设定';
  els.npcSettingConfirmButton.disabled = stateView.loading;
  els.npcSettingLaterButton.disabled = stateView.loading;
  els.npcSettingBackButton.disabled = stateView.loading;
  els.npcSettingCreateModeButton.disabled = stateView.loading;
  els.npcSettingStatus.hidden = !stateView.loading && !stateView.error;
  els.npcSettingStatus.textContent = stateView.loading ? '正在写入数据库...' : stateView.error;
  els.npcSettingStatus.dataset.status = stateView.error ? 'error' : 'running';
  renderNpcSettingCandidateList();
}

function renderNpcSettingCandidateList() {
  els.npcSettingList.innerHTML = '';
  if (state.npcSettingOnboarding.candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'npc-setting-empty';
    empty.textContent = '没有找到可选择的 NPC 设定。';
    els.npcSettingList.append(empty);
    return;
  }
  for (const candidate of state.npcSettingOnboarding.candidates) {
    const label = document.createElement('label');
    label.className = 'npc-setting-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'npcSettingCandidate';
    input.value = candidate.key;
    input.checked = candidate.key === state.npcSettingOnboarding.selectedKey;
    input.disabled = state.npcSettingOnboarding.loading;
    const body = document.createElement('span');
    body.className = 'npc-setting-option-body';
    const title = document.createElement('strong');
    title.textContent = candidate.name || candidate.npcId;
    const meta = document.createElement('small');
    meta.textContent = [
      candidate.npcId,
      candidate.detail,
      candidate.isProtagonist ? '已标记主角' : (candidate.isPlayer ? '已标记玩家角色' : '未标记玩家角色'),
      candidate.greeting ? '有开局处境' : '无固定开局'
    ].filter(Boolean).join(' · ');
    body.append(title, meta);
    if (candidate.summary) {
      const summary = document.createElement('span');
      summary.className = 'npc-setting-option-summary';
      summary.textContent = candidate.summary;
      body.append(summary);
    }
    if (candidate.greeting) {
      const greeting = document.createElement('span');
      greeting.className = 'npc-setting-option-summary';
      greeting.textContent = `开局：${candidate.greeting}`;
      body.append(greeting);
    }
    label.append(input, body);
    els.npcSettingList.append(label);
  }
}

function setNpcSettingOnboardingMode(mode) {
  state.npcSettingOnboarding.mode = mode === 'create' ? 'create' : 'select';
  if (state.npcSettingOnboarding.mode === 'create') fillDefaultNpcSettingCreateFields();
  renderNpcSettingDialog();
}

function fillDefaultNpcSettingCreateFields() {
  if (!els.npcSettingNameInput.value.trim()) {
    const character = findCharacter(state.activeChat?.characterCardId || els.characterSelect.value);
    els.npcSettingNameInput.value = character?.name ? `${character.name}的玩家角色` : '玩家角色';
  }
  if (!els.npcSettingIdInput.value.trim()) {
    els.npcSettingIdInput.value = makeNpcSettingId(els.npcSettingNameInput.value);
  }
}

function closeNpcSettingOnboarding() {
  els.npcSettingDialog.close();
}

function syncNpcSettingIdFromName() {
  if (els.npcSettingIdInput.value.trim()) return;
  els.npcSettingIdInput.value = makeNpcSettingId(els.npcSettingNameInput.value);
}

async function confirmNpcSettingOnboarding() {
  const onboarding = state.npcSettingOnboarding;
  if (!onboarding.chatId || onboarding.loading) return;
  onboarding.loading = true;
  onboarding.error = '';
  renderNpcSettingDialog();
  try {
    const candidate = onboarding.mode === 'create'
      ? await createManualNpcSettingCandidate(onboarding.chatId)
      : selectedNpcSettingCandidate();
    if (!candidate) throw new Error('请选择一个 NPC 设定');
    await bindNpcSettingToChat(onboarding.chatId, candidate);
    els.npcSettingDialog.close();
    await loadChat(onboarding.chatId);
    await loadChats();
    renderAll();
    showToast('玩家 NPC 设定已绑定');
  } catch (error) {
    onboarding.error = error.message || String(error);
    showToast(onboarding.error);
  } finally {
    onboarding.loading = false;
    renderNpcSettingDialog();
  }
}

function selectedNpcSettingCandidate() {
  return state.npcSettingOnboarding.candidates.find((candidate) => candidate.key === state.npcSettingOnboarding.selectedKey);
}

async function createManualNpcSettingCandidate(chatId) {
  const name = els.npcSettingNameInput.value.trim();
  if (!name) throw new Error('请输入 NPC 名称');
  const npcId = normalizeNpcSettingId(els.npcSettingIdInput.value || makeNpcSettingId(name));
  if (!npcId) throw new Error('请输入 NPC ID');
  const summary = els.npcSettingSummaryInput.value.trim();
  const greeting = els.npcSettingGreetingInput.value.trim();
  const context = npcSettingToolContext(chatId);
  let profileId = '';
  try {
    const profile = await executeTool('system.npc_profiles.upsert_profile', {
      npcId,
      level: 'L1',
      name,
      actorType: 'player',
      isPlayer: true,
      playerId: npcId,
      status: 'active',
      summary,
      content: summary,
      source: 'web-ui.new-chat-onboarding',
      metadata: {
        chatSessionId: chatId,
        createdForChat: true,
        greeting
      }
    }, context);
    profileId = profile?.id || '';
  } catch {
    // The chat-local state below is sufficient even if the global profile tool is unavailable.
  }
  return {
    key: `manual:${npcId}`,
    source: 'manual',
    npcId,
    playerId: npcId,
    name,
    summary,
    greeting,
    detail: '手动创建',
    isPlayer: true,
    isProtagonist: true,
    profileId
  };
}

async function bindNpcSettingToChat(chatId, candidate = {}) {
  const npcId = normalizeNpcSettingId(candidate.npcId);
  const name = String(candidate.name || npcId || '玩家角色').trim();
  const playerId = normalizeNpcSettingId(candidate.playerId || npcId);
  if (!npcId) throw new Error('NPC 设定缺少 npcId');
  const context = npcSettingToolContext(chatId);
  const metadata = {
    selectedBy: 'web-ui',
    selectedAt: new Date().toISOString(),
    source: candidate.source,
    profileId: candidate.profileId || '',
    summary: candidate.summary || '',
    greeting: candidateGreeting(candidate)
  };
  const stateData = candidate.stateData && typeof candidate.stateData === 'object' && !Array.isArray(candidate.stateData)
    ? candidate.stateData
    : {};
  const greeting = candidateGreeting(candidate);
  await clearOtherProtagonistMarkers(chatId, { selectedNpcId: npcId, context });
  await executeTool('system.npc_state.patch_state', removeUndefined({
    chatSessionId: chatId,
    recordId: candidate.recordId,
    sceneId: stateData.sceneId || 'current',
    npcId,
    actorType: 'player',
    isPlayer: true,
    isProtagonist: true,
    playerId,
    name,
    greeting,
    values: stateData.values,
    statusBar: stateData.statusBar,
    skillBar: stateData.skillBar,
    specialStatuses: stateData.specialStatuses,
    inventory: stateData.inventory,
    equipment: stateData.equipment,
    resources: stateData.resources,
    source: 'web-ui.npc-setting-onboarding'
  }), context);
  await executeTool('system.protagonist.switch_perspective', {
    chatSessionId: chatId,
    sceneId: 'current',
    toActorId: npcId,
    toPlayerId: playerId,
    toName: name,
    greeting,
    createTargetState: true,
    reason: 'new chat npc setting selected',
    metadata
  }, context);
  await executeTool('system.actor_control.set_context', {
    chatSessionId: chatId,
    sceneId: 'current',
    controlledActorId: npcId,
    controlledActorTitle: name,
    controlledPlayerId: playerId,
    viewpointActorId: npcId,
    viewpointActorTitle: name,
    embodiedActorId: npcId,
    embodiedActorTitle: name,
    inputAuthority: 'actor_claim',
    source: 'web-ui.npc-setting-onboarding',
    operation: 'select_npc_setting',
    reason: 'new chat npc setting selected',
    metadata
  }, context);
  const initialized = await api(`/v1/app/chats/${encodeURIComponent(chatId)}/initialize`, {
    method: 'POST',
    body: {
      source: 'web-ui.npc-setting-onboarding',
      sceneId: 'current',
      force: false,
      includeGreeting: true
    }
  });
  if (state.activeChatId === chatId && initialized.chat) {
    state.activeChat = initialized.chat;
    renderActiveChat();
  }
}

function candidateGreeting(candidate = {}) {
  return String(firstPresent(
    candidate.greeting,
    candidate.stateData?.greeting,
    candidate.stateData?.initialGreeting,
    candidate.stateData?.initialSituation,
    candidate.stateData?.openingSituation,
    candidate.stateData?.metadata?.greeting
  ) || '').trim();
}

async function clearOtherProtagonistMarkers(chatId, { selectedNpcId, context } = {}) {
  if (!toolAvailable('system.npc_state.list_states') || !toolAvailable('system.npc_state.patch_state')) return;
  try {
    const output = await executeTool('system.npc_state.list_states', {
      chatSessionId: chatId,
      isProtagonist: true,
      limit: 100
    }, context);
    for (const record of output.records || []) {
      const data = record.data || {};
      const npcId = data.npcId || data.playerId || record.id;
      if (!npcId || npcId === selectedNpcId) continue;
      await executeTool('system.npc_state.patch_state', removeUndefined({
        chatSessionId: chatId,
        recordId: record.id,
        sceneId: data.sceneId || 'current',
        npcId,
        isProtagonist: false,
        source: 'web-ui.npc-setting-onboarding.clear-protagonist'
      }), context);
    }
  } catch {
    // Unique protagonist cleanup is best-effort; the initialize API will still refuse ambiguous state.
  }
}

function npcSettingToolContext(chatId) {
  return {
    source: 'web-ui.npc-setting-onboarding',
    actor: 'user',
    authorization: true,
    chatSessionId: chatId
  };
}

function makeNpcSettingId(name) {
  const base = String(name || '')
    .trim()
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return base ? `player_${base}` : `player_${Date.now().toString(36)}`;
}

function normalizeNpcSettingId(value) {
  return String(value || '').trim().replace(/\s+/g, '_').slice(0, 96);
}

function renderPlayerActionDialog() {
  const { action, loading, data, error } = state.playerActionViewer;
  const config = getPlayerActionDefinition(action) || { title: '玩家信息', subtitle: '读取当前聊天数据库。' };
  hideSlotUseTooltip();
  closeSlotUseActionPopover();
  state.playerActionViewer.slotIndex = new Map();
  els.playerActionDialogTitle.textContent = config.title;
  els.playerActionDialogSubtitle.textContent = config.subtitle;
  els.playerActionDialogContent.innerHTML = '';
  els.refreshPlayerActionDialogButton.disabled = loading || !state.activeChatId;

  if (loading) {
    els.playerActionDialogContent.append(playerActionEmpty('正在读取当前聊天数据库...'));
    return;
  }
  if (error) {
    els.playerActionDialogContent.append(playerActionEmpty(error, 'error'));
    return;
  }
  if (!data) {
    els.playerActionDialogContent.append(playerActionEmpty('没有可显示的数据。'));
    return;
  }

  if (action === 'inventory') {
    renderInventoryAction(data, els.playerActionDialogContent);
  } else if (action === 'status') {
    renderStatusAction(data, els.playerActionDialogContent);
  } else if (action === 'skills') {
    renderSkillsAction(data, els.playerActionDialogContent);
  } else if (action === 'map') {
    renderMapAction(data, els.playerActionDialogContent);
  } else if (action === 'npcGraph') {
    renderNpcGraphAction(data, els.playerActionDialogContent);
  } else if (action === 'factionGraph') {
    renderFactionGraphAction(data, els.playerActionDialogContent);
  } else if (isDynamicGraphAction(action)) {
    renderDynamicGraphAction(data, els.playerActionDialogContent);
  }
}

function renderInventoryAction(data, container) {
  const collection = 'npc_structured_states';
  const actors = data.actors || [];
  if (actors.length === 0) {
    container.append(playerActionEmpty('当前聊天数据库里没有玩家背包记录。'));
    return;
  }
  for (const record of actors) {
    const actor = record.data || {};
    const inventory = normalizePlayerActionObject(actor.inventory);
    const card = playerActionCard(
      playerActionRecordTitle(data, collection, record, ['name', 'displayName', 'npcId', 'playerId'], '玩家'),
      playerActionRecordSubtitle(data, collection, record, ['playerId', 'npcId', 'sceneId'])
    );
    if (playerActionFieldVisible(data, collection, 'inventory')) {
      const currency = inventory.currency && typeof inventory.currency === 'object' ? inventory.currency : {};
      card.append(playerActionKeyValue('货币', Object.keys(currency).length ? compactObjectText(currency) : '无记录'));
      card.append(renderSlotUseSection('物品', playerActionInventorySlots(data, record, inventory), record, 'item', {
        emptyText: toolAvailable('system.slot_use.list_slots') ? '背包里没有物品。' : '物品使用工具不可用。'
      }));
    }
    appendPlayerActionRecordFields(card, data, collection, record, {
      excludeFields: ['inventory', 'values', 'statusBar', 'specialStatuses', 'resources', 'skillBar', 'equipment']
    });
    container.append(card);
  }
}

function renderStatusAction(data, container) {
  const collection = 'npc_structured_states';
  const actors = data.actors || [];
  if (actors.length === 0) {
    container.append(playerActionEmpty('当前聊天数据库里没有玩家状态栏记录。'));
    return;
  }
  for (const record of actors) {
    const actor = record.data || {};
    const status = normalizePlayerActionObject(actor.statusBar);
    const values = normalizePlayerActionObject(actor.values);
    const card = playerActionCard(
      playerActionRecordTitle(data, collection, record, ['name', 'displayName', 'npcId', 'playerId'], '玩家'),
      playerActionRecordSubtitle(data, collection, record, ['playerId', 'npcId', 'sceneId'])
    );
    const showStatus = playerActionFieldVisible(data, collection, 'statusBar');
    const showValues = playerActionFieldVisible(data, collection, 'values');
    if (showStatus || showValues) {
      const hp = firstPresent(showStatus ? status.hp : undefined, showValues ? values.hp : undefined);
      const maxHp = firstPresent(showStatus ? status.maxHp : undefined, showValues ? values.maxHp : undefined);
      card.append(playerActionGrid([
        ['HP', hp !== undefined || maxHp !== undefined ? `${hp ?? '?'} / ${maxHp ?? '?'}` : '无记录'],
        ['临时 HP', firstPresent(showStatus ? status.temporaryHp : undefined, showValues ? values.temporaryHp : undefined)],
        ['AC', showStatus ? firstPresent(status.armorClass, status.ac) : undefined],
        ['速度', showStatus ? status.speed : undefined],
        ['先攻', showStatus ? status.initiative : undefined],
        ['灵感', showStatus ? status.inspiration : undefined]
      ]));
    }
    const conditions = [
      ...(showStatus ? normalizePlayerActionArray(status.conditions) : []),
      ...(playerActionFieldVisible(data, collection, 'specialStatuses')
        ? normalizePlayerActionArray(actor.specialStatuses).map((item) => item.name || item.id || item).filter(Boolean)
        : [])
    ];
    if (conditions.length > 0) card.append(playerActionChips('状态', conditions));
    if (showStatus && status.abilityScores) card.append(playerActionKeyValue('属性', compactObjectText(status.abilityScores)));
    const resources = normalizePlayerActionObject(actor.resources);
    const skillBar = normalizePlayerActionObject(actor.skillBar);
    const equipment = normalizePlayerActionObject(actor.equipment);
    if (playerActionFieldVisible(data, collection, 'resources') && Object.keys(resources).length > 0) card.append(playerActionKeyValue('资源', compactObjectText(resources)));
    if (playerActionFieldVisible(data, collection, 'skillBar') && Object.keys(skillBar).length > 0) card.append(playerActionKeyValue('技能栏', compactObjectText(skillBar)));
    if (playerActionFieldVisible(data, collection, 'equipment') && Object.keys(equipment).length > 0) card.append(playerActionKeyValue('装备', compactObjectText(equipment)));
    appendPlayerActionRecordFields(card, data, collection, record, {
      excludeFields: ['values', 'statusBar', 'specialStatuses', 'resources', 'skillBar', 'equipment', 'inventory']
    });
    container.append(card);
  }
}

function renderSkillsAction(data, container) {
  const collection = 'npc_structured_states';
  const actors = data.actors || [];
  if (actors.length === 0) {
    container.append(playerActionEmpty('当前聊天数据库里没有玩家技能记录。'));
    return;
  }
  for (const record of actors) {
    const actor = record.data || {};
    const card = playerActionCard(
      playerActionRecordTitle(data, collection, record, ['name', 'displayName', 'npcId', 'playerId'], '玩家'),
      playerActionRecordSubtitle(data, collection, record, ['playerId', 'npcId', 'sceneId'])
    );
    const skillBar = normalizePlayerActionObject(actor.skillBar);
    const resources = normalizePlayerActionObject(actor.resources);
    card.append(renderSlotUseSection('技能', playerActionSkillSlots(data, record, skillBar), record, 'skill', {
      emptyText: toolAvailable('system.slot_use.list_slots') ? '技能栏里没有技能。' : '技能使用工具不可用。'
    }));
    if (playerActionFieldVisible(data, collection, 'resources') && Object.keys(resources).length > 0) {
      card.append(playerActionKeyValue('资源', compactObjectText(resources)));
    }
    appendPlayerActionRecordFields(card, data, collection, record, {
      excludeFields: ['skillBar', 'resources', 'values', 'statusBar', 'specialStatuses', 'inventory', 'equipment']
    });
    container.append(card);
  }
}

function playerActionSlotUseForActor(data = {}, record = {}) {
  const key = playerActionActorSlotKey(record);
  const slotUse = data.slotUseByActor?.[key] || {};
  return {
    ...slotUse,
    itemSlots: Array.isArray(slotUse.itemSlots) ? slotUse.itemSlots : [],
    skillSlots: Array.isArray(slotUse.skillSlots) ? slotUse.skillSlots : [],
    slots: Array.isArray(slotUse.slots) ? slotUse.slots : []
  };
}

function playerActionInventorySlots(data = {}, record = {}, inventory = {}) {
  const toolSlots = playerActionSlotUseForActor(data, record).itemSlots;
  const databaseSlots = normalizePlayerActionArray(inventory.items).map(databaseItemToSlotUseSlot);
  return mergePlayerActionSlots(toolSlots, databaseSlots, 'item');
}

function playerActionSkillSlots(data = {}, record = {}, skillBar = {}) {
  const toolSlots = playerActionSlotUseForActor(data, record).skillSlots;
  const databaseSlots = playerActionSkillBarSlots(skillBar);
  return mergePlayerActionSlots(toolSlots, databaseSlots, 'skill');
}

function mergePlayerActionSlots(toolSlots = [], databaseSlots = [], sourceKind = 'item') {
  if (!databaseSlots.length) return toolSlots;
  const used = new Set();
  const merged = [];
  for (const databaseSlot of databaseSlots) {
    const matchIndex = toolSlots.findIndex((toolSlot, index) => !used.has(index) && slotUseIdentityMatches(databaseSlot, toolSlot, sourceKind));
    if (matchIndex >= 0) {
      used.add(matchIndex);
      const toolSlot = toolSlots[matchIndex];
      merged.push({
        ...databaseSlot,
        ...toolSlot,
        metadata: {
          ...normalizePlayerActionObject(databaseSlot.metadata),
          ...normalizePlayerActionObject(toolSlot.metadata)
        }
      });
    } else {
      merged.push(databaseSlot);
    }
  }
  for (const [index, toolSlot] of toolSlots.entries()) {
    if (!used.has(index)) merged.push(toolSlot);
  }
  return merged;
}

function databaseItemToSlotUseSlot(item = {}) {
  const metadata = normalizePlayerActionObject(item.metadata);
  return removeEmptyObjectValues({
    sourceKind: 'item',
    slotId: item.slotId || item.id || item.itemId || item.name,
    itemId: item.itemId || item.id,
    name: item.name || item.displayName || item.id || item.itemId,
    quantity: firstPresent(item.quantity, item.count),
    equipped: item.equipped,
    tags: item.tags,
    description: item.description || item.summary || item.notes || metadata.description,
    targetPolicy: item.targetPolicy || metadata.targetPolicy || metadata.targetMode,
    executionMode: item.executionMode || metadata.executionMode,
    directUseAllowed: item.directUseAllowed ?? metadata.directUseAllowed,
    routeHint: item.routeHint || metadata.routeHint,
    metadata
  });
}

function playerActionSkillBarSlots(skillBar = {}) {
  const slots = [];
  for (const key of ['actions', 'skills', 'spells', 'feats', 'abilities']) {
    for (const entry of normalizePlayerActionArray(skillBar[key])) {
      const slot = databaseSkillToSlotUseSlot(entry, key);
      if (slot) slots.push(slot);
    }
  }
  for (const key of ['skillIds', 'actionIds']) {
    for (const entry of normalizePlayerActionArray(skillBar[key])) {
      const slot = databaseSkillToSlotUseSlot(entry, key);
      if (slot) slots.push(slot);
    }
  }
  return uniquePlayerActionSlots(slots, 'skill');
}

function databaseSkillToSlotUseSlot(entry, sourceField = 'actions') {
  const skill = typeof entry === 'string' ? { id: entry, name: entry } : normalizePlayerActionObject(entry);
  const metadata = normalizePlayerActionObject(skill.metadata);
  const id = skill.id || skill.skillId || skill.actionId || skill.mechanicId || skill.featId || skill.statusId || skill.name;
  if (!id) return undefined;
  return removeEmptyObjectValues({
    sourceKind: 'skill',
    slotId: skill.slotId || id,
    skillId: skill.skillId || (skill.mechanicKind === 'skill' || sourceField === 'skills' || sourceField === 'skillIds' ? id : undefined),
    actionId: skill.actionId || skill.id || id,
    name: skill.name || skill.displayName || id,
    description: skill.description || skill.summary || skill.notes || metadata.description,
    actionKind: skill.actionKind || skill.kind || skill.mode,
    mode: skill.mode,
    targetPolicy: skill.targetPolicy || metadata.targetPolicy,
    requiresTarget: skill.requiresTarget,
    consumeAction: skill.consumeAction,
    ready: skill.ready,
    routeHint: skill.routeHint || metadata.routeHint,
    metadata
  });
}

function uniquePlayerActionSlots(slots = [], sourceKind = 'item') {
  const seen = new Set();
  const unique = [];
  for (const slot of slots) {
    const identities = slotUseIdentityValues(slot, sourceKind);
    const key = identities[0] || slot.name || unique.length;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slot);
  }
  return unique;
}

function slotUseIdentityMatches(a = {}, b = {}, sourceKind = 'item') {
  const left = new Set(slotUseIdentityValues(a, sourceKind));
  return slotUseIdentityValues(b, sourceKind).some((value) => left.has(value));
}

function slotUseIdentityValues(slot = {}, sourceKind = 'item') {
  const values = sourceKind === 'item'
    ? [slot.itemId, slot.slotId, slot.id, slot.name]
    : [slot.skillId, slot.actionId, slot.slotId, slot.id, slot.mechanic?.id, slot.name];
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function renderSlotUseSection(title, slots = [], record = {}, sourceKind = 'item', { emptyText = '无记录' } = {}) {
  const section = document.createElement('div');
  section.className = 'player-slot-section';
  const header = document.createElement('div');
  header.className = 'player-slot-section-header';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const count = document.createElement('span');
  count.textContent = `${slots.length} 个`;
  header.append(heading, count);
  section.append(header);

  const grid = document.createElement('div');
  grid.className = 'player-slot-grid';
  if (!slots.length) {
    grid.append(playerActionEmpty(emptyText, 'compact'));
  }
  for (const slot of slots) {
    const key = registerPlayerSlotUseSlot(record, slot, sourceKind);
    const button = document.createElement('button');
    button.className = 'player-slot-button';
    button.type = 'button';
    button.dataset.slotUseKey = key;
    button.dataset.sourceKind = sourceKind;
    button.disabled = slot.ready === false || Boolean(state.playerActionViewer.slotBusyKey);
    button.title = slotUseAccessibleText(slot, sourceKind);
    button.setAttribute('aria-label', slotUseAccessibleText(slot, sourceKind));
    const label = document.createElement('span');
    label.textContent = slot.name || slot.itemId || slot.actionId || slot.slotId || '未命名';
    button.append(label);
    button.addEventListener('mouseenter', (event) => showSlotUseTooltip(key, event));
    button.addEventListener('mouseover', (event) => showSlotUseTooltip(key, event));
    button.addEventListener('mousemove', moveSlotUseTooltip);
    button.addEventListener('mouseleave', hideSlotUseTooltip);
    button.addEventListener('pointerenter', (event) => showSlotUseTooltip(key, event));
    button.addEventListener('pointerover', (event) => showSlotUseTooltip(key, event));
    button.addEventListener('pointermove', moveSlotUseTooltip);
    button.addEventListener('pointerleave', hideSlotUseTooltip);
    button.addEventListener('focus', () => showSlotUseTooltip(key, null, button));
    button.addEventListener('blur', hideSlotUseTooltip);
    grid.append(button);
  }
  section.append(grid);
  return section;
}

function registerPlayerSlotUseSlot(record = {}, slot = {}, sourceKind = 'item') {
  const actor = record.data || {};
  const actorId = playerActionActorId(actor, record);
  const sceneId = actor.sceneId || 'current';
  const slotId = slot.slotId || slot.itemId || slot.skillId || slot.actionId || slot.id || slot.name;
  const key = `${sceneId}:${actorId}:${sourceKind}:${slotId}`;
  state.playerActionViewer.slotIndex.set(key, {
    key,
    record,
    actor,
    actorId,
    sceneId,
    sourceKind,
    slot
  });
  return key;
}

function handlePlayerActionDialogClick(event) {
  const button = event.target.closest('[data-slot-use-key]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  openSlotUseActionPopover(button.dataset.slotUseKey, button);
}

function slotUseEntryForKey(key) {
  return state.playerActionViewer.slotIndex?.get(key);
}

function slotUseAccessibleText(slot = {}, sourceKind = 'item') {
  const parts = [
    slot.name || slot.itemId || slot.actionId || '未命名',
    sourceKind === 'item' ? slotUseItemMeta(slot) : slotUseSkillMeta(slot),
    slot.description || slot.summary || slot.metadata?.description || '',
    slotUseStatItems(slot, sourceKind).map((item) => `${item.label} ${item.value}`).join('，')
  ];
  return parts.filter(Boolean).join('。');
}

function slotUseItemMeta(slot = {}) {
  return [
    slot.itemId || slot.slotId,
    slot.quantity !== undefined ? `x${slot.quantity}` : '',
    slot.equipped ? '已装备' : '',
    slot.routeHint ? slotUseRouteLabel(slot.routeHint) : ''
  ].filter(Boolean).join(' · ');
}

function slotUseSkillMeta(slot = {}) {
  return [
    combatActionKindLabel(slot.actionKind || slot.mode),
    slot.requiresTarget ? '需要目标' : '无需目标',
    slot.ready === false ? slot.reasonUnavailable || '不可用' : '',
    slot.routeHint ? slotUseRouteLabel(slot.routeHint) : ''
  ].filter(Boolean).join(' · ');
}

function slotUseRouteLabel(route = '') {
  const text = String(route || '').toLowerCase();
  if (text === 'deterministic') return '直接结算';
  if (text === 'hybrid') return '混合结算';
  if (text === 'adjudicated') return '需要裁决';
  return route;
}

function slotUseStatItems(slot = {}, sourceKind = 'item') {
  const metadata = slot.metadata || {};
  const items = [];
  if (sourceKind === 'item') {
    if (slot.quantity !== undefined) items.push({ label: '数量', value: slot.quantity });
    if (slot.equipped) items.push({ label: '装备', value: '已装备' });
    if (slot.targetPolicy || metadata.targetPolicy) items.push({ label: '目标', value: slot.targetPolicy || metadata.targetPolicy });
    for (const [field, label] of [
      ['healing', '治疗'],
      ['damage', '伤害'],
      ['temporaryHp', '临时HP'],
      ['acBonus', 'AC'],
      ['attackBonus', '攻击'],
      ['checkBonus', '检定']
    ]) {
      const value = firstPresent(slot[field], metadata[field], metadata.useEffects?.[field], metadata.effects?.[field]);
      if (value !== undefined) items.push({ label, value: formatValue(value) });
    }
  } else {
    for (const item of combatSkillStatItems(slot)) items.push(item);
    if (slot.targetPolicy) items.push({ label: '目标', value: slot.targetPolicy });
  }
  return items.slice(0, 8);
}

function showSlotUseTooltip(key, event, anchor) {
  const entry = slotUseEntryForKey(key);
  if (!entry || !els.slotUseTooltip) return;
  const { slot, sourceKind } = entry;
  const tooltip = els.slotUseTooltip;
  tooltip.innerHTML = '';
  const title = document.createElement('strong');
  title.textContent = slot.name || slot.itemId || slot.actionId || slot.slotId || '未命名';
  const meta = document.createElement('span');
  meta.textContent = sourceKind === 'item' ? slotUseItemMeta(slot) : slotUseSkillMeta(slot);
  const detail = document.createElement('p');
  detail.textContent = slot.description || slot.summary || slot.metadata?.description || '没有详细说明。';
  const stats = document.createElement('div');
  stats.className = 'slot-use-tooltip-stats';
  for (const item of slotUseStatItems(slot, sourceKind)) {
    stats.append(combatValueChip(item.label, item.value));
  }
  tooltip.append(title, meta, detail, stats);
  tooltip.hidden = false;
  if (event) {
    positionSlotUseTooltip(event.clientX, event.clientY);
  } else if (anchor) {
    const rect = anchor.getBoundingClientRect();
    positionSlotUseTooltip(rect.right, rect.top);
  }
}

function moveSlotUseTooltip(event) {
  if (!els.slotUseTooltip || els.slotUseTooltip.hidden) return;
  positionSlotUseTooltip(event.clientX, event.clientY);
}

function positionSlotUseTooltip(clientX = 0, clientY = 0) {
  const tooltip = els.slotUseTooltip;
  if (!tooltip) return;
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  tooltip.style.left = `${clamp(clientX + offset, 8, maxLeft)}px`;
  tooltip.style.top = `${clamp(clientY + offset, 8, maxTop)}px`;
}

function hideSlotUseTooltip() {
  if (!els.slotUseTooltip) return;
  els.slotUseTooltip.hidden = true;
}

function openSlotUseActionPopover(key, anchor) {
  const entry = slotUseEntryForKey(key);
  if (!entry || !els.slotUseActionPopover) return;
  const { slot, sourceKind } = entry;
  const popover = els.slotUseActionPopover;
  popover.innerHTML = '';
  popover.dataset.slotUseKey = key;
  const title = document.createElement('strong');
  title.textContent = slot.name || slot.itemId || slot.actionId || slot.slotId || '未命名';
  const actions = document.createElement('div');
  actions.className = 'slot-use-action-row';
  const useButton = document.createElement('button');
  useButton.className = 'primary-button';
  useButton.type = 'button';
  useButton.dataset.slotUseAction = 'use';
  useButton.textContent = '使用';
  const discardButton = document.createElement('button');
  discardButton.className = 'secondary-button';
  discardButton.type = 'button';
  discardButton.dataset.slotUseAction = 'discard';
  discardButton.textContent = sourceKind === 'skill' ? '遗忘' : '丢弃';
  const cancelButton = document.createElement('button');
  cancelButton.className = 'secondary-button';
  cancelButton.type = 'button';
  cancelButton.dataset.slotUseAction = 'cancel';
  cancelButton.textContent = '取消';
  actions.append(useButton, discardButton, cancelButton);
  popover.append(title, actions);
  popover.hidden = false;
  positionSlotUseActionPopover(anchor);
}

function positionSlotUseActionPopover(anchor) {
  const popover = els.slotUseActionPopover;
  if (!popover || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const own = popover.getBoundingClientRect();
  const top = clamp(rect.bottom + 8, 8, Math.max(8, window.innerHeight - own.height - 8));
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - own.width - 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function closeSlotUseActionPopover() {
  if (!els.slotUseActionPopover) return;
  els.slotUseActionPopover.hidden = true;
  els.slotUseActionPopover.dataset.slotUseKey = '';
}

function handleSlotUsePopoverClick(event) {
  const button = event.target.closest('[data-slot-use-action]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const key = els.slotUseActionPopover.dataset.slotUseKey;
  const action = button.dataset.slotUseAction;
  if (action === 'cancel') {
    closeSlotUseActionPopover();
    return;
  }
  if (action === 'use') {
    void commitPlayerSlotUse(key);
    return;
  }
  if (action === 'discard') {
    void discardPlayerSlotUse(key);
  }
}

function buildSlotUseInput(entry, extra = {}) {
  const { slot, sourceKind, actorId, sceneId } = entry;
  const battle = state.combatOverlay.battle?.data || state.combatOverlay.battle || {};
  const combatActive = sourceKind === 'skill'
    && state.combatOverlay.open
    && battle.battleId
    && !isCombatTerminalStatus(battle.status);
  return removeEmptyObjectValues({
    chatSessionId: state.activeChatId,
    sceneId,
    actorId,
    sourceKind,
    slotId: slot.slotId || slot.id,
    itemId: sourceKind === 'item' ? slot.itemId || slot.slotId || slot.id : undefined,
    itemName: sourceKind === 'item' ? slot.name : undefined,
    skillId: sourceKind === 'skill' ? slot.skillId || slot.actionId || slot.slotId || slot.id : undefined,
    selectedActionId: sourceKind === 'skill' ? slot.actionId || slot.slotId || slot.id : undefined,
    actionId: sourceKind === 'skill' ? slot.actionId || slot.slotId || slot.id : undefined,
    battleId: combatActive ? battle.battleId : undefined,
    targetId: combatActive ? state.combatOverlay.targetId : undefined,
    sourceText: slot.description || slot.summary || slot.metadata?.specialText || '',
    effects: sourceKind === 'item' ? slotUseInlineEffects(slot) : undefined,
    metadata: {
      uiSource: 'player-action-dialog',
      slotName: slot.name || ''
    },
    ...extra
  });
}

function slotUseInlineEffects(slot = {}) {
  const metadata = slot.metadata || {};
  const effects = removeEmptyObjectValues({
    hit: firstPresent(slot.hit, slot.attack, metadata.hit, metadata.attack),
    damage: firstPresent(slot.damage, slot.damages, metadata.damage, metadata.damages),
    damageRolls: firstPresent(slot.damageRolls, slot.damageDice, metadata.damageRolls, metadata.damageDice),
    healing: firstPresent(slot.healing, slot.heals, metadata.healing, metadata.heals),
    healingRolls: firstPresent(slot.healingRolls, slot.healingDice, metadata.healingRolls, metadata.healingDice),
    temporaryHp: firstPresent(slot.temporaryHp, slot.tempHp, metadata.temporaryHp, metadata.tempHp),
    statusEffects: firstPresent(slot.statusEffects, slot.statuses, slot.conditions, metadata.statusEffects, metadata.statuses, metadata.conditions),
    resourceChanges: firstPresent(slot.resourceChanges, slot.resourceEffects, metadata.resourceChanges, metadata.resourceEffects),
    resourceCosts: firstPresent(slot.resourceCosts, slot.costs, metadata.resourceCosts, metadata.costs),
    consume: firstPresent(slot.consume, metadata.consume, metadata.consumes, metadata.consumable),
    consumeQuantity: firstPresent(slot.consumeQuantity, metadata.consumeQuantity, metadata.quantity, metadata.amount)
  });
  return Object.keys(effects).length ? effects : undefined;
}

async function commitPlayerSlotUse(key) {
  const entry = slotUseEntryForKey(key);
  if (!entry || state.playerActionViewer.slotBusyKey) return;
  if (!toolAvailable('system.slot_use.commit_use')) {
    showToast('使用工具不可用');
    return;
  }
  hideSlotUseTooltip();
  closeSlotUseActionPopover();
  state.playerActionViewer.slotBusyKey = key;
  renderPlayerActionDialog();
  try {
    const output = await executeTool('system.slot_use.commit_use', buildSlotUseInput(entry), buildManagedToolExecutionContext({
      source: 'web-ui.player-action.slot-use.commit',
      authorization: true
    }));
    handleSlotUseOutput(output, entry, 'use');
    await refreshPlayerActionViewerData();
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    state.playerActionViewer.slotBusyKey = '';
    renderPlayerActionDialog();
  }
}

async function discardPlayerSlotUse(key) {
  const entry = slotUseEntryForKey(key);
  if (!entry || state.playerActionViewer.slotBusyKey) return;
  hideSlotUseTooltip();
  closeSlotUseActionPopover();
  state.playerActionViewer.slotBusyKey = key;
  renderPlayerActionDialog();
  try {
    if (entry.sourceKind === 'skill') {
      await forgetPlayerSkillSlot(entry);
      addSettlementNotice({
        id: `slot-forget:${Date.now()}`,
        type: 'status',
        title: '技能变化',
        text: `已遗忘 ${entry.slot.name || entry.slot.actionId || '技能'}`,
        detail: '玩家技能栏更新',
        status: 'success'
      });
    } else {
      await discardPlayerItemSlot(entry);
      addSettlementNotice({
        id: `slot-discard:${Date.now()}`,
        type: 'inventory',
        title: '背包变化',
        text: `已丢弃 ${entry.slot.name || entry.slot.itemId || '物品'}`,
        detail: '背包操作',
        status: 'success'
      });
    }
    await refreshPlayerActionViewerData();
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    state.playerActionViewer.slotBusyKey = '';
    renderPlayerActionDialog();
  }
}

async function discardPlayerItemSlot(entry) {
  const quantity = Number(entry.slot.quantity ?? 1);
  await executeTool('system.item_use.use_item', {
    chatSessionId: state.activeChatId,
    sceneId: entry.sceneId,
    actorId: entry.actorId,
    itemId: entry.slot.itemId || entry.slot.slotId || entry.slot.id,
    itemName: entry.slot.name,
    consumeItem: true,
    consumeQuantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    removeWhenZero: true,
    requireOwned: true,
    source: 'web-ui.player-action.slot-use.discard'
  }, buildManagedToolExecutionContext({
    source: 'web-ui.player-action.slot-use.discard',
    authorization: true
  }));
}

async function forgetPlayerSkillSlot(entry) {
  const skillBar = normalizePlayerActionObject(entry.actor.skillBar);
  const resources = normalizePlayerActionObject(entry.actor.resources);
  const skillBarPatch = filterSlotUseFromSkillContainer(skillBar, entry);
  const combatResourcesPatch = filterSlotUseFromSkillContainer(normalizePlayerActionObject(resources.combat), entry);
  const patch = removeEmptyObjectValues({
    chatSessionId: state.activeChatId,
    sceneId: entry.sceneId,
    npcId: entry.actorId,
    skillBar: Object.keys(skillBarPatch).length ? skillBarPatch : undefined,
    resources: Object.keys(combatResourcesPatch).length ? { combat: combatResourcesPatch } : undefined,
    source: 'web-ui.player-action.slot-use.forget'
  });
  if (!patch.skillBar && !patch.resources) {
    throw new Error('没有找到可从技能栏移除的技能记录。');
  }
  await executeTool('system.npc_state.patch_state', patch, buildManagedToolExecutionContext({
    source: 'web-ui.player-action.slot-use.forget',
    authorization: true
  }));
}

function filterSlotUseFromSkillContainer(container = {}, entry) {
  const patch = {};
  for (const key of ['actions', 'skills', 'spells', 'feats', 'abilities', 'skillIds', 'actionIds']) {
    if (!Array.isArray(container[key])) continue;
    const filtered = container[key].filter((item) => !slotUseSkillMatches(item, entry.slot));
    if (filtered.length !== container[key].length) patch[key] = filtered;
  }
  return patch;
}

function slotUseSkillMatches(item, slot = {}) {
  const ids = [
    slot.slotId,
    slot.skillId,
    slot.actionId,
    slot.id,
    slot.mechanic?.id,
    slot.name
  ].map((value) => String(value || '').trim()).filter(Boolean);
  if (!ids.length) return false;
  if (typeof item === 'string') return ids.includes(item);
  const values = [
    item.id,
    item.skillId,
    item.actionId,
    item.mechanicId,
    item.featId,
    item.statusId,
    item.name
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return ids.some((id) => values.includes(id));
}

function handleSlotUseOutput(output = {}, entry, action) {
  const name = entry.slot.name || entry.slot.itemId || entry.slot.actionId || '条目';
  if (output.ok === false || output.status === 'blocked') {
    const message = slotUseFailureMessage(output, name);
    showToast(message);
    addSettlementNotice({
      id: `slot-use-blocked:${Date.now()}`,
      type: entry.sourceKind === 'item' ? 'inventory' : 'combat',
      title: entry.sourceKind === 'item' ? '背包未变化' : '技能未结算',
      text: `无法使用 ${name}`,
      detail: message,
      status: 'error'
    });
    return;
  }
  if (output.status === 'needs_target') {
    const count = output.targetCandidates?.length || 0;
    showToast(`${name} 需要目标${count ? `，可选目标 ${count} 个` : ''}`);
    return;
  }
  if (output.status === 'needs_adjudication') {
    const tool = output.adjudicationToolCall?.tool || '裁决工具';
    showToast(`${name} 需要裁决：${tool}`);
    addSettlementNotice({
      id: `slot-adjudication:${Date.now()}`,
      type: 'status',
      title: '等待裁决',
      text: `${name} 需要裁决`,
      detail: tool,
      status: 'pending'
    });
    return;
  }
  if (output.directResult?.tool === 'system.combat.resolve_action') {
    showDiceRollNoticeFromCombatResolution(output.directResult.output, '技能骰子');
  }
  const pending = output.status === 'resolved_with_pending_adjudication' || output.status === 'ready_with_pending_adjudication';
  addSettlementNotice({
    id: `slot-use:${Date.now()}`,
    type: entry.sourceKind === 'item' ? 'inventory' : 'combat',
    title: entry.sourceKind === 'item' ? '背包变化' : '技能结算',
    text: `${action === 'use' ? '已使用' : '已处理'} ${name}`,
    detail: pending
      ? `数值已结算，特殊描述等待 ${output.adjudicationToolCall?.tool || '裁决'}`
      : slotUseOutputDetail(output),
    status: output.ok === false ? 'error' : 'success'
  });
  showToast(pending ? `${name} 数值已结算，特殊部分等待裁决` : `${name} 已结算`);
}

function slotUseFailureMessage(output = {}, name = '条目') {
  const reason = output.reason || output.directResult?.output?.reason || output.directPreview?.output?.reason || '';
  if (reason === 'item_has_no_direct_effect') {
    return `${name} 暂时不能在背包里直接使用。这个物品还没有写明可结算效果，可以先留着，或在聊天里描述你想怎么用。`;
  }
  if (reason === 'item_not_owned') return `背包中没有 ${name}。`;
  if (reason === 'insufficient_item_quantity') return `${name} 数量不足。`;
  if (reason === 'insufficient_resources') return `${name} 所需资源不足。`;
  if (reason === 'target_required') return `${name} 需要先选择目标。`;
  return output.error?.message || output.message || reason || `${name} 不能直接使用。`;
}

function slotUseOutputDetail(output = {}) {
  const tool = output.directResult?.tool || output.directToolCall?.tool || '';
  const route = output.route ? slotUseRouteLabel(output.route) : '';
  return [route, tool].filter(Boolean).join(' · ') || output.status || '';
}

async function refreshPlayerActionViewerData() {
  if (!state.playerActionViewer.action) return;
  state.playerActionViewer.data = await loadPlayerActionData(state.playerActionViewer.action);
  state.playerActionViewer.error = '';
}

function removeEmptyObjectValues(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''));
}

function normalizePlayerActionObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePlayerActionArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderMapAction(data, container) {
  const mounts = data.mounts || [];
  const mapStates = data.mapStates || [];
  const scenes = data.scenes || [];
  const graphModel = buildMapGraphModel(data);
  if (graphModel.nodes.length > 0 || graphModel.edges.length > 0) {
    container.append(renderGraphPanel({
      title: '移动关系图',
      subtitle: '合并全局地图关系、当前场景挂载和地图状态里的出口/路线。',
      model: graphModel,
      kind: 'map',
      emptyText: '当前没有可渲染的地图节点。'
    }));
  } else if (data.sceneGraph?.error) {
    container.append(playerActionEmpty(`地图关系图读取失败：${data.sceneGraph.error}`, 'error'));
  }
  if (mounts.length === 0 && mapStates.length === 0 && scenes.length === 0 && graphModel.nodes.length === 0 && graphModel.edges.length === 0) {
    container.append(playerActionEmpty('当前聊天数据库里没有地图记录。'));
    return;
  }
  if (mounts.length > 0) {
    container.append(playerActionSectionTitle('当前场景地图'));
    for (const record of mounts) {
      const collection = 'scene_map_mounts';
      const map = record.data || {};
      const card = playerActionCard(
        playerActionRecordTitle(data, collection, record, ['name', 'mapId'], record.id),
        playerActionRecordSubtitle(data, collection, record, ['sceneId', 'locationLabel', 'status', 'visibility'])
      );
      card.append(playerActionGrid([
        ['Map ID', playerActionVisibleValue(data, collection, map, 'mapId')],
        ['类型', playerActionVisibleValue(data, collection, map, 'type')],
        ['父地图', playerActionVisibleValue(data, collection, map, 'parentMapId')],
        ['摘要', playerActionVisibleValue(data, collection, map, 'summary')]
      ]));
      appendPlayerActionRecordFields(card, data, collection, record);
      container.append(card);
    }
  }
  if (mapStates.length > 0) {
    container.append(playerActionSectionTitle('地图状态'));
    for (const record of mapStates) {
      const collection = 'map_structured_states';
      const map = record.data || {};
      const card = playerActionCard(
        playerActionRecordTitle(data, collection, record, ['name', 'mapId'], record.id),
        playerActionRecordSubtitle(data, collection, record, ['sceneId', 'mapId', 'stateUpdatedAt'])
      );
      if (playerActionFieldVisible(data, collection, 'position') && map.position) {
        card.append(playerActionKeyValue('位置', compactObjectText(map.position)));
      }
      if (playerActionFieldVisible(data, collection, 'values') && map.values) {
        card.append(playerActionKeyValue('数值', compactObjectText(map.values)));
      }
      if (playerActionFieldVisible(data, collection, 'areas')) {
        card.append(playerActionList('区域', normalizeList(map.areas), (item) => ({
          title: item.name || item.id || '未命名区域',
          meta: [item.id, item.discovered === false ? '未发现' : '已发现', item.visibility].filter(Boolean).join(' · '),
          detail: item.summary || ''
        })));
      }
      if (playerActionFieldVisible(data, collection, 'exits')) {
        card.append(playerActionList('出口', normalizeList(map.exits), (item) => ({
          title: item.name || item.id || `${item.fromAreaId || '?'} -> ${item.toMapId || item.toAreaId || '?'}`,
          meta: [item.direction, item.status, item.cost ?? item.distance].filter((value) => value !== undefined && value !== '').join(' · '),
          detail: item.requirements ? `需要：${formatValue(item.requirements)}` : ''
        })));
      }
      if (playerActionFieldVisible(data, collection, 'objects')) {
        card.append(playerActionList('可互动', normalizeList(map.objects), (item) => ({
          title: item.name || item.id || '未命名对象',
          meta: [item.areaId, item.status].filter(Boolean).join(' · '),
          detail: item.summary || ''
        })));
      }
      if (playerActionFieldVisible(data, collection, 'hazards')) {
        card.append(playerActionList('危险', normalizeList(map.hazards), (item) => ({
          title: item.name || item.id || '未命名危险',
          meta: [item.areaId, item.active === false ? '未激活' : '激活', item.severity !== undefined ? `危险 ${item.severity}` : ''].filter(Boolean).join(' · '),
          detail: item.summary || ''
        })));
      }
      if (playerActionFieldVisible(data, collection, 'fogOfWar') && map.fogOfWar) {
        card.append(playerActionKeyValue('迷雾', compactObjectText(map.fogOfWar)));
      }
      appendPlayerActionRecordFields(card, data, collection, record);
      container.append(card);
    }
  }
  if (scenes.length > 0) {
    container.append(playerActionSectionTitle('最近场景记录'));
    for (const record of scenes.slice(0, 5)) {
      const collection = 'scene_records';
      const scene = record.data || {};
      const card = playerActionCard(
        playerActionRecordTitle(data, collection, record, ['title', 'name', 'sceneId'], record.id),
        playerActionRecordSubtitle(data, collection, record, ['status', 'locationLabel', 'sceneUpdatedAt'])
      );
      card.append(playerActionGrid([
        ['Scene ID', playerActionVisibleValue(data, collection, scene, 'sceneId')],
        ['地点', playerActionVisibleValue(data, collection, scene, 'locationLabel')],
        ['摘要', playerActionVisibleValue(data, collection, scene, 'summary')]
      ]));
      appendPlayerActionRecordFields(card, data, collection, record);
      container.append(card);
    }
  }
}

function renderNpcGraphAction(data, container) {
  const model = buildNpcGraphModel(data);
  container.append(renderGraphPanel({
    title: 'NPC 关系网络',
    subtitle: '节点来自全局 NPC 关系库；边表示盟友、敌对、债务、亲族、雇佣等关系。',
    model,
    kind: 'npc',
    emptyText: '全局 NPC 关系图里还没有节点或关系。'
  }));
}

function renderFactionGraphAction(data, container) {
  const model = buildFactionGraphModel(data);
  container.append(renderGraphPanel({
    title: '阵营关系网络',
    subtitle: '阵营节点、阵营关系和角色隶属会一起渲染；角色隶属用虚线连接。',
    model,
    kind: 'faction',
    emptyText: '全局阵营图里还没有阵营、关系或成员。'
  }));
}

function renderDynamicGraphAction(data, container) {
  const source = data.graphSource || {};
  const model = buildDynamicGraphModel(data);
  container.append(renderGraphPanel({
    title: source.title || '自动关系图',
    subtitle: source.reason || source.subtitle || '从自动发现的关系库读取节点和边。',
    model,
    kind: source.graphKind || 'graph',
    emptyText: '这个自动关系库里还没有可渲染的节点或关系。'
  }));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_VISIBLE_GRAPH_NODES = 120;
const MAX_VISIBLE_GRAPH_EDGES = 220;

function buildDynamicGraphModel(data = {}) {
  const source = data.graphSource || {};
  const kind = source.graphKind || 'graph';
  const nodes = [];
  const seenNodes = new Set();
  for (const record of data.nodes || []) {
    const item = graphRecordData(record);
    const nodeCollection = source.nodeCollection || '';
    const id = firstText(
      item.nodeId,
      item.npcId,
      item.factionId,
      item.mapId,
      item.actorId,
      item.characterId,
      item.memberId,
      item.id,
      record.id
    );
    if (!id || seenNodes.has(id)) continue;
    seenNodes.add(id);
    nodes.push({
      id,
      label: firstText(
        firstVisibleDynamicText(data, nodeCollection, item, ['name', 'title', 'label', 'displayName']),
        Array.isArray(visibleDynamicField(data, nodeCollection, item, 'aliases')) ? visibleDynamicField(data, nodeCollection, item, 'aliases')[0] : '',
        id
      ),
      kind,
      group: firstText(firstVisibleDynamicText(data, nodeCollection, item, ['kind', 'type', 'category', 'role']), kind),
      parentId: firstVisibleDynamicText(data, nodeCollection, item, ['parentId', 'parentMapId', 'parentFactionId']),
      summary: firstVisibleDynamicText(data, nodeCollection, item, ['summary', 'description', 'notes']),
      meta: compactGraphMeta([
        visibleDynamicField(data, nodeCollection, item, 'status'),
        visibleDynamicField(data, nodeCollection, item, 'visibility'),
        visibleDynamicField(data, nodeCollection, item, 'tags')
      ])
    });
  }

  const edges = [];
  for (const record of data.edges || []) {
    const item = graphRecordData(record);
    const edgeCollection = source.edgeCollection || '';
    const from = dynamicEndpointValue(item, source.endpointFields?.from, [
      'fromNodeId', 'fromNpcId', 'fromFactionId', 'fromMapId', 'fromActorId', 'fromCharacterId',
      'sourceNodeId', 'sourceNpcId', 'sourceFactionId', 'sourceMapId', 'sourceActorId', 'sourceCharacterId',
      'sourceId', 'from'
    ]);
    const to = dynamicEndpointValue(item, source.endpointFields?.to, [
      'toNodeId', 'toNpcId', 'toFactionId', 'toMapId', 'toActorId', 'toCharacterId',
      'targetNodeId', 'targetNpcId', 'targetFactionId', 'targetMapId', 'targetActorId', 'targetCharacterId',
      'targetId', 'to'
    ]);
    if (!from || !to) continue;
    const relationType = firstText(
      firstVisibleDynamicText(data, edgeCollection, item, ['relationType', 'relationshipType', 'edgeType', 'type', 'kind', 'label']),
      'relation'
    );
    edges.push({
      id: firstText(record.id, item.id, item.edgeId, item.relationId, `${from}->${to}:${relationType}`),
      from,
      to,
      type: relationType,
      label: firstText(visibleDynamicField(data, edgeCollection, item, 'label'), relationType),
      direction: firstText(visibleDynamicField(data, edgeCollection, item, 'direction'), visibleDynamicField(data, edgeCollection, item, 'directed') === true ? 'directed' : '', 'undirected'),
      weight: numericGraphValue(firstPresent(
        visibleDynamicField(data, edgeCollection, item, 'weight'),
        visibleDynamicField(data, edgeCollection, item, 'strength'),
        visibleDynamicField(data, edgeCollection, item, 'trust'),
        visibleDynamicField(data, edgeCollection, item, 'tension')
      )),
      cost: numericGraphValue(firstPresent(
        visibleDynamicField(data, edgeCollection, item, 'cost'),
        visibleDynamicField(data, edgeCollection, item, 'distance')
      )),
      travelMode: firstVisibleDynamicText(data, edgeCollection, item, ['travelMode', 'mode']),
      status: visibleDynamicField(data, edgeCollection, item, 'status') || '',
      visibility: visibleDynamicField(data, edgeCollection, item, 'visibility') || '',
      summary: firstVisibleDynamicText(data, edgeCollection, item, ['summary', 'description', 'evidence', 'notes']),
      meta: compactGraphMeta([
        visibleDynamicField(data, edgeCollection, item, 'attitude'),
        visibleDynamicField(data, edgeCollection, item, 'role'),
        visibleDynamicField(data, edgeCollection, item, 'status'),
        visibleDynamicField(data, edgeCollection, item, 'visibility'),
        visibleDynamicField(data, edgeCollection, item, 'tags')
      ]),
      dashed: isGraphHidden({
        visibility: visibleDynamicField(data, edgeCollection, item, 'visibility'),
        status: visibleDynamicField(data, edgeCollection, item, 'status')
      }) || isGraphBlocked({
        visibility: visibleDynamicField(data, edgeCollection, item, 'visibility'),
        status: visibleDynamicField(data, edgeCollection, item, 'status')
      })
    });
  }

  for (const record of data.memberships || []) {
    const item = graphRecordData(record);
    const memberCollection = source.memberCollection || '';
    const from = dynamicEndpointValue(item, source.membershipFields?.from, ['actorId', 'npcId', 'characterId', 'memberId']);
    const to = dynamicEndpointValue(item, source.membershipFields?.to, ['factionId', 'groupId', 'partyId', 'organizationId']);
    if (!from || !to) continue;
    const actorNodeId = nodes.some((node) => node.id === from) ? from : `actor:${from}`;
    if (!seenNodes.has(actorNodeId)) {
      seenNodes.add(actorNodeId);
      nodes.push({
        id: actorNodeId,
        label: firstText(firstVisibleDynamicText(data, memberCollection, item, ['actorName', 'name']), from),
        kind: 'actor',
        group: 'member',
        summary: firstVisibleDynamicText(data, memberCollection, item, ['summary', 'description', 'evidence']),
        meta: compactGraphMeta([
          visibleDynamicField(data, memberCollection, item, 'actorType'),
          visibleDynamicField(data, memberCollection, item, 'role'),
          visibleDynamicField(data, memberCollection, item, 'status'),
          visibleDynamicField(data, memberCollection, item, 'visibility')
        ])
      });
    }
    edges.push({
      id: firstText(record.id, item.id, item.membershipId, `membership:${from}->${to}`),
      from: actorNodeId,
      to,
      type: 'membership',
      label: firstText(firstVisibleDynamicText(data, memberCollection, item, ['role', 'rank', 'status']), 'member'),
      direction: 'directed',
      status: visibleDynamicField(data, memberCollection, item, 'status') || '',
      visibility: visibleDynamicField(data, memberCollection, item, 'visibility') || '',
      summary: firstVisibleDynamicText(data, memberCollection, item, ['summary', 'description', 'evidence']),
      meta: compactGraphMeta([
        visibleDynamicField(data, memberCollection, item, 'loyalty') !== undefined ? `loyalty ${visibleDynamicField(data, memberCollection, item, 'loyalty')}` : '',
        visibleDynamicField(data, memberCollection, item, 'influence') !== undefined ? `influence ${visibleDynamicField(data, memberCollection, item, 'influence')}` : ''
      ]),
      dashed: true
    });
  }
  return { nodes, edges };
}

function dynamicEndpointValue(item, preferred, candidates) {
  if (preferred && item[preferred] !== undefined) return firstText(item[preferred]);
  for (const field of candidates) {
    if (item[field] !== undefined) return firstText(item[field]);
  }
  return '';
}

function visibleDynamicField(data, collection, item, field) {
  if (!field) return undefined;
  if (!collection || playerActionFieldVisible(data, collection, field)) return item[field];
  return undefined;
}

function firstVisibleDynamicText(data, collection, item, fields) {
  return firstText(...fields.map((field) => visibleDynamicField(data, collection, item, field)));
}

function buildNpcGraphModel(data = {}) {
  const nodes = (data.nodes || []).map((record) => {
    const item = graphRecordData(record);
    const id = firstText(item.npcId, record.id, item.id);
    return {
      id,
      label: firstText(item.name, item.displayName, item.aliases?.[0], id),
      kind: 'npc',
      group: 'npc',
      summary: item.summary || '',
      meta: compactGraphMeta([item.tags, item.status, item.visibility])
    };
  }).filter((node) => node.id);
  const edges = (data.edges || []).map((record) => {
    const item = graphRecordData(record);
    const from = firstText(item.fromNpcId, item.from, item.sourceNpcId);
    const to = firstText(item.toNpcId, item.to, item.targetNpcId);
    const relationType = firstText(item.relationType, item.type, item.kind, 'relation');
    return {
      id: firstText(record.id, item.id, `${from}->${to}:${relationType}`),
      from,
      to,
      type: relationType,
      label: firstText(item.label, relationType),
      direction: firstText(item.direction, 'undirected'),
      weight: numericGraphValue(item.weight),
      status: item.status || '',
      visibility: item.visibility || '',
      summary: firstText(item.summary, item.evidence, item.attitude),
      meta: compactGraphMeta([item.attitude, item.trust !== undefined ? `trust ${item.trust}` : '', item.familiarity !== undefined ? `familiarity ${item.familiarity}` : ''])
    };
  }).filter((edge) => edge.from && edge.to);
  return { nodes, edges };
}

function buildFactionGraphModel(data = {}) {
  const nodes = [];
  for (const record of data.factions || []) {
    const item = graphRecordData(record);
    const id = firstText(item.factionId, record.id, item.id);
    nodes.push({
      id,
      label: firstText(item.name, item.aliases?.[0], id),
      kind: 'faction',
      group: firstText(item.kind, item.scale, 'faction'),
      summary: firstText(item.summary, item.publicFace),
      meta: compactGraphMeta([item.kind, item.scale, item.status, item.visibility])
    });
  }
  const actorIds = new Set();
  for (const record of data.memberships || []) {
    const item = graphRecordData(record);
    const actorId = firstText(item.actorId, item.npcId, item.id);
    if (!actorId || actorIds.has(actorId)) continue;
    actorIds.add(actorId);
    nodes.push({
      id: `actor:${actorId}`,
      label: firstText(item.actorName, item.name, actorId),
      kind: 'actor',
      group: 'member',
      summary: firstText(item.summary, item.evidence),
      meta: compactGraphMeta([item.actorType, item.status, item.visibility])
    });
  }
  const edges = (data.relations || []).map((record) => {
    const item = graphRecordData(record);
    const from = firstText(item.fromFactionId, item.from, item.sourceFactionId);
    const to = firstText(item.toFactionId, item.to, item.targetFactionId);
    const relationType = firstText(item.relationType, item.type, item.kind, 'relation');
    return {
      id: firstText(record.id, item.id, item.relationId, `${from}->${to}:${relationType}`),
      from,
      to,
      type: relationType,
      label: firstText(item.label, relationType),
      direction: firstText(item.direction, 'undirected'),
      weight: numericGraphValue(item.weight),
      status: item.status || '',
      visibility: item.visibility || '',
      summary: firstText(item.summary, item.coreConflict, item.evidence, item.decisionNotes),
      meta: compactGraphMeta([
        item.trust !== undefined ? `trust ${item.trust}` : '',
        item.tension !== undefined ? `tension ${item.tension}` : '',
        item.influence !== undefined ? `influence ${item.influence}` : ''
      ])
    };
  }).filter((edge) => edge.from && edge.to);
  for (const record of data.memberships || []) {
    const item = graphRecordData(record);
    const actorId = firstText(item.actorId, item.npcId, item.id);
    const factionId = firstText(item.factionId, item.faction);
    if (!actorId || !factionId) continue;
    edges.push({
      id: firstText(record.id, item.id, `membership:${actorId}->${factionId}`),
      from: `actor:${actorId}`,
      to: factionId,
      type: 'membership',
      label: firstText(item.role, item.rank, item.status, 'member'),
      direction: 'directed',
      status: item.status || '',
      visibility: item.visibility || '',
      summary: firstText(item.summary, item.evidence),
      meta: compactGraphMeta([
        item.loyalty !== undefined ? `loyalty ${item.loyalty}` : '',
        item.influence !== undefined ? `influence ${item.influence}` : ''
      ]),
      dashed: true
    });
  }
  return { nodes, edges };
}

function buildMapGraphModel(data = {}) {
  const graph = data.sceneGraph || {};
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  for (const record of graph.nodes || []) {
    const item = graphRecordData(record);
    const id = firstText(item.mapId, record.id, item.id);
    if (!id || nodeIds.has(id)) continue;
    nodeIds.add(id);
    nodes.push({
      id,
      label: firstText(item.name, item.title, item.aliases?.[0], id),
      kind: 'map',
      group: firstText(item.type, item.kind, 'map'),
      parentId: firstText(item.parentMapId, item.parentId),
      summary: item.summary || '',
      meta: compactGraphMeta([item.type, item.status, item.visibility, item.source])
    });
  }
  for (const record of graph.edges || []) {
    const item = graphRecordData(record);
    const from = firstText(item.fromMapId, item.from, item.sourceMapId);
    const to = firstText(item.toMapId, item.to, item.targetMapId);
    const relationType = firstText(item.relationType, item.type, item.kind, 'path');
    edges.push({
      id: firstText(record.id, item.id, `${from}->${to}:${relationType}`),
      from,
      to,
      type: relationType,
      label: firstText(item.label, relationType),
      direction: firstText(item.direction, 'undirected'),
      travelMode: item.travelMode || '',
      cost: numericGraphValue(item.cost ?? item.distance ?? item.weight),
      status: item.status || '',
      visibility: item.visibility || '',
      summary: firstText(item.summary, item.evidence),
      meta: compactGraphMeta([
        item.travelMode,
        item.cost !== undefined ? `cost ${item.cost}` : '',
        item.difficulty !== undefined ? `difficulty ${item.difficulty}` : ''
      ]),
      dashed: isGraphHidden(item) || isGraphBlocked(item)
    });
  }
  if (nodes.length === 0) {
    addMapFallbackData(nodes, edges, data);
  }
  return { nodes, edges, sources: graph.sources || [] };
}

function addMapFallbackData(nodes, edges, data = {}) {
  const seen = new Set();
  for (const record of data.mounts || []) {
    const item = graphRecordData(record);
    const id = firstText(item.mapId, record.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({
      id,
      label: firstText(item.name, item.locationLabel, id),
      kind: 'map',
      group: firstText(item.type, 'scene'),
      parentId: item.parentMapId || '',
      summary: item.summary || '',
      meta: compactGraphMeta([item.type, item.status, item.visibility])
    });
    if (item.parentMapId) {
      edges.push({
        id: `fallback-parent:${item.parentMapId}->${id}`,
        from: item.parentMapId,
        to: id,
        type: 'contains',
        label: '包含',
        direction: 'undirected',
        status: item.status || 'active',
        visibility: item.visibility || 'visible'
      });
    }
  }
  for (const record of data.mapStates || []) {
    const item = graphRecordData(record);
    const mapId = firstText(item.mapId, record.id);
    if (mapId && !seen.has(mapId)) {
      seen.add(mapId);
      nodes.push({
        id: mapId,
        label: firstText(item.name, mapId),
        kind: 'map',
        group: 'state',
        summary: item.summary || ''
      });
    }
    for (const exit of normalizeList(item.exits)) {
      const from = firstText(exit.fromAreaId, exit.fromMapId, mapId);
      const to = firstText(exit.toMapId, exit.toAreaId, exit.targetMapId);
      if (!from || !to) continue;
      edges.push({
        id: firstText(exit.id, `${from}->${to}:${exit.direction || 'exit'}`),
        from,
        to,
        type: 'exit',
        label: firstText(exit.name, exit.direction, '出口'),
        direction: firstText(exit.directionality, exit.directionType, 'undirected'),
        status: exit.status || '',
        visibility: exit.visibility || '',
        cost: numericGraphValue(exit.cost ?? exit.distance),
        summary: exit.summary || ''
      });
    }
  }
}

function renderGraphPanel({ title, subtitle, model, kind, emptyText }) {
  const prepared = prepareGraphModel(model, kind);
  const section = document.createElement('section');
  section.className = `graph-panel graph-panel-${kind}`;
  const header = document.createElement('div');
  header.className = 'graph-panel-header';
  const text = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const small = document.createElement('small');
  small.textContent = subtitle;
  text.append(h3, small);
  header.append(text, renderGraphStats(prepared));
  section.append(header);

  if (prepared.allNodes.length === 0 && prepared.allEdges.length === 0) {
    section.append(playerActionEmpty(emptyText, 'compact'));
    return section;
  }

  if (prepared.omittedNodes > 0 || prepared.omittedEdges > 0) {
    const note = document.createElement('div');
    note.className = 'graph-render-note';
    note.textContent = `图很大，画布优先显示连接度最高的 ${prepared.visibleNodes.length} 个节点和 ${prepared.visibleEdges.length} 条边；下方相邻关系仍按完整数据列出。`;
    section.append(note);
  }
  section.append(renderGraphViewport(prepared, kind));
  section.append(renderGraphLegend(kind));
  section.append(renderGraphAdjacency(prepared));
  return section;
}

function renderGraphStats(prepared) {
  const stats = document.createElement('div');
  stats.className = 'graph-stats';
  for (const text of [
    `节点 ${prepared.allNodes.length}`,
    `边 ${prepared.allEdges.length}`,
    `可视 ${prepared.visibleNodes.length}/${prepared.visibleEdges.length}`,
    `分量 ${prepared.componentCount}`
  ]) {
    const chip = document.createElement('span');
    chip.textContent = text;
    stats.append(chip);
  }
  return stats;
}

function prepareGraphModel(model = {}, kind = 'graph') {
  const nodeMap = new Map();
  const addNode = (node) => {
    const id = firstText(node.id);
    if (!id) return;
    const current = nodeMap.get(id) || {};
    const hasCurrent = nodeMap.has(id);
    nodeMap.set(id, {
      id,
      label: hasCurrent ? firstText(current.label, node.label, id) : firstText(node.label, id),
      kind: current.kind || node.kind || kind,
      group: current.group || node.group || node.kind || kind,
      parentId: current.parentId || node.parentId || '',
      summary: current.summary || node.summary || '',
      meta: current.meta || node.meta || '',
      degree: current.degree || 0
    });
  };
  for (const node of model.nodes || []) addNode(node);

  const allEdges = [];
  for (const edge of model.edges || []) {
    const from = firstText(edge.from);
    const to = firstText(edge.to);
    if (!from || !to) continue;
    addNode({ id: from, label: from, kind });
    addNode({ id: to, label: to, kind });
    const item = {
      id: firstText(edge.id, `${from}->${to}:${edge.type || 'edge'}`),
      from,
      to,
      type: firstText(edge.type, 'edge'),
      label: firstText(edge.label, edge.type, '关系'),
      direction: firstText(edge.direction, 'undirected'),
      weight: edge.weight,
      cost: edge.cost,
      travelMode: edge.travelMode || '',
      status: edge.status || '',
      visibility: edge.visibility || '',
      summary: edge.summary || '',
      meta: edge.meta || '',
      dashed: Boolean(edge.dashed)
    };
    allEdges.push(item);
    nodeMap.get(from).degree += 1;
    nodeMap.get(to).degree += 1;
  }

  const allNodes = [...nodeMap.values()].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
  const selectedNodeIds = selectVisibleNodeIds(allNodes, allEdges);
  const visibleNodes = allNodes.filter((node) => selectedNodeIds.has(node.id));
  let visibleEdges = allEdges
    .filter((edge) => selectedNodeIds.has(edge.from) && selectedNodeIds.has(edge.to))
    .sort((a, b) => edgeImportance(b) - edgeImportance(a) || a.id.localeCompare(b.id));
  if (visibleEdges.length > MAX_VISIBLE_GRAPH_EDGES) visibleEdges = visibleEdges.slice(0, MAX_VISIBLE_GRAPH_EDGES);
  const positions = layoutGraph(visibleNodes, visibleEdges, kind);
  const componentCount = countGraphComponents(allNodes, allEdges);
  return {
    allNodes,
    allEdges,
    visibleNodes,
    visibleEdges,
    positions,
    width: positions.width,
    height: positions.height,
    omittedNodes: Math.max(0, allNodes.length - visibleNodes.length),
    omittedEdges: Math.max(0, allEdges.length - visibleEdges.length),
    componentCount
  };
}

function selectVisibleNodeIds(nodes, edges) {
  if (nodes.length <= MAX_VISIBLE_GRAPH_NODES) return new Set(nodes.map((node) => node.id));
  const edgeScore = new Map();
  for (const edge of edges) {
    edgeScore.set(edge.from, (edgeScore.get(edge.from) || 0) + edgeImportance(edge));
    edgeScore.set(edge.to, (edgeScore.get(edge.to) || 0) + edgeImportance(edge));
  }
  const ranked = [...nodes].sort((a, b) => {
    const scoreDelta = (b.degree * 100 + (edgeScore.get(b.id) || 0)) - (a.degree * 100 + (edgeScore.get(a.id) || 0));
    return scoreDelta || a.label.localeCompare(b.label);
  });
  return new Set(ranked.slice(0, MAX_VISIBLE_GRAPH_NODES).map((node) => node.id));
}

function edgeImportance(edge) {
  const numeric = Math.abs(Number(edge.weight ?? edge.cost ?? 0));
  const typeBoost = /enemy|ally|contains|membership|road|path|door|portal|route/i.test(edge.type || '') ? 25 : 0;
  return numeric + typeBoost + (edge.summary ? 10 : 0);
}

function layoutGraph(nodes, edges, kind) {
  const width = 960;
  const height = kind === 'map'
    ? Math.max(680, Math.min(1280, 540 + nodes.length * 7))
    : Math.max(500, Math.min(980, 420 + nodes.length * 4));
  const components = graphComponents(nodes, edges);
  const componentCenters = componentCenterMap(components, width, height);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map();
  const velocities = new Map();

  for (const component of components) {
    const center = componentCenters.get(component.id);
    const radius = Math.max(44, Math.min(center.cellWidth, center.cellHeight) * 0.32);
    component.nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index / Math.max(1, component.nodes.length)) + seededAngle(node.id);
      const spread = component.nodes.length <= 2 ? radius * 0.35 : radius * (0.72 + (hashNumber(node.id) % 19) / 100);
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * spread,
        y: center.y + Math.sin(angle) * spread
      });
      velocities.set(node.id, { x: 0, y: 0 });
    });
  }

  const iterations = nodes.length > 80 ? 130 : 170;
  const desiredDistance = kind === 'map' ? 154 : 96;
  const repulsion = kind === 'map' ? 3400 : 1850;
  const attraction = kind === 'map' ? 0.012 : 0.018;
  for (let step = 0; step < iterations; step += 1) {
    const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = positions.get(nodes[i].id);
        const b = positions.get(nodes[j].id);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distanceSq = Math.max(64, dx * dx + dy * dy);
        const force = repulsion / distanceSq;
        const distance = Math.sqrt(distanceSq);
        const fx = dx / distance * force;
        const fy = dy / distance * force;
        forces.get(nodes[i].id).x += fx;
        forces.get(nodes[i].id).y += fy;
        forces.get(nodes[j].id).x -= fx;
        forces.get(nodes[j].id).y -= fy;
      }
    }
    for (const edge of edges) {
      if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const pull = (distance - desiredDistance) * attraction;
      const fx = dx / distance * pull;
      const fy = dy / distance * pull;
      forces.get(edge.from).x += fx;
      forces.get(edge.from).y += fy;
      forces.get(edge.to).x -= fx;
      forces.get(edge.to).y -= fy;
    }
    for (const component of components) {
      const center = componentCenters.get(component.id);
      for (const node of component.nodes) {
        const position = positions.get(node.id);
        const force = forces.get(node.id);
        force.x += (center.x - position.x) * 0.006;
        force.y += (center.y - position.y) * 0.006;
      }
    }
    for (const node of nodes) {
      const velocity = velocities.get(node.id);
      const force = forces.get(node.id);
      velocity.x = (velocity.x + force.x) * 0.72;
      velocity.y = (velocity.y + force.y) * 0.72;
      const position = positions.get(node.id);
      position.x = clampNumber(position.x + velocity.x, 36, width - 36);
      position.y = clampNumber(position.y + velocity.y, 42, height - 52);
    }
  }
  fitGraphPositions(positions, width, height);
  return { width, height, map: positions };
}

function fitGraphPositions(positions, width, height) {
  const values = [...positions.values()];
  if (values.length <= 1) return;
  const minX = Math.min(...values.map((item) => item.x));
  const maxX = Math.max(...values.map((item) => item.x));
  const minY = Math.min(...values.map((item) => item.y));
  const maxY = Math.max(...values.map((item) => item.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const marginX = 84;
  const marginY = 76;
  const scale = Math.min((width - marginX * 2) / spanX, (height - marginY * 2) / spanY);
  const safeScale = clampNumber(scale, 0.75, 4.25);
  const sourceCenterX = minX + spanX / 2;
  const sourceCenterY = minY + spanY / 2;
  for (const position of values) {
    position.x = width / 2 + (position.x - sourceCenterX) * safeScale;
    position.y = height / 2 + (position.y - sourceCenterY) * safeScale;
    position.x = clampNumber(position.x, 38, width - 38);
    position.y = clampNumber(position.y, 46, height - 58);
  }
}

function graphComponents(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  }
  const visited = new Set();
  const components = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const ids = [];
    visited.add(node.id);
    while (queue.length > 0) {
      const id = queue.shift();
      ids.push(id);
      for (const next of adjacency.get(id) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    components.push({
      id: `component-${components.length}`,
      nodes: ids.map((id) => nodes.find((item) => item.id === id)).filter(Boolean)
    });
  }
  return components.sort((a, b) => b.nodes.length - a.nodes.length);
}

function countGraphComponents(nodes, edges) {
  return graphComponents(nodes, edges).length;
}

function componentCenterMap(components, width, height) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length * width / height)));
  const rows = Math.max(1, Math.ceil(components.length / columns));
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const centers = new Map();
  components.forEach((component, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    centers.set(component.id, {
      x: cellWidth * column + cellWidth / 2,
      y: cellHeight * row + cellHeight / 2,
      cellWidth,
      cellHeight
    });
  });
  return centers;
}

function renderGraphViewport(prepared, kind) {
  const viewport = document.createElement('div');
  viewport.className = 'graph-viewport';
  const toolbar = document.createElement('div');
  toolbar.className = 'graph-toolbar';
  const zoomOut = graphToolButton('−', '缩小图谱');
  const zoomReset = graphToolButton('1:1', '重置图谱视图');
  const zoomIn = graphToolButton('+', '放大图谱');
  const zoomIndicator = document.createElement('span');
  zoomIndicator.className = 'graph-zoom-indicator';
  zoomIndicator.textContent = '100%';
  toolbar.append(zoomOut, zoomReset, zoomIn, zoomIndicator);

  const canvas = document.createElement('div');
  canvas.className = 'graph-canvas';
  const svg = renderGraphSvg(prepared, kind);
  canvas.append(svg);
  viewport.append(toolbar, canvas);
  setupGraphPanZoom(svg, canvas, { zoomIn, zoomOut, zoomReset, zoomIndicator });
  return viewport;
}

function graphToolButton(text, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'graph-tool-button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.textContent = text;
  return button;
}

function renderGraphSvg(prepared, kind) {
  const svg = svgElement('svg', {
    class: 'graph-svg',
    viewBox: `0 0 ${prepared.width} ${prepared.height}`,
    role: 'img',
    'aria-label': '关系图'
  });
  svg.dataset.graphWidth = String(prepared.width);
  svg.dataset.graphHeight = String(prepared.height);
  const defs = svgElement('defs');
  const marker = svgElement('marker', {
    id: `graphArrow-${kind}`,
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '6',
    markerHeight: '6',
    orient: 'auto-start-reverse'
  });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'graph-arrow' }));
  defs.append(marker);
  svg.append(defs);

  const transformLayer = svgElement('g', { class: 'graph-transform-layer' });
  const edgeLayer = svgElement('g', { class: 'graph-edge-layer' });
  const nodeLayer = svgElement('g', { class: 'graph-node-layer' });
  const multiEdges = parallelEdgeMap(prepared.visibleEdges);
  prepared.visibleEdges.forEach((edge) => {
    const from = prepared.positions.map.get(edge.from);
    const to = prepared.positions.map.get(edge.to);
    if (!from || !to) return;
    const parallel = multiEdges.get(parallelEdgeKey(edge));
    const parallelIndex = parallel.indexOf(edge.id);
    const offset = (parallelIndex - (parallel.length - 1) / 2) * 16;
    const path = graphEdgePath(from, to, offset);
    const pathEl = svgElement('path', {
      class: `graph-edge ${graphEdgeClass(edge)}${edge.dashed ? ' dashed' : ''}`,
      d: path.d,
      'marker-end': isDirectedGraphEdge(edge) ? `url(#graphArrow-${kind})` : undefined
    });
    pathEl.append(svgElement('title', {}, graphEdgeTitle(edge)));
    edgeLayer.append(pathEl);
    if (prepared.visibleEdges.length <= 140) {
      const label = svgElement('text', {
        class: 'graph-edge-label',
        x: String(path.labelX),
        y: String(path.labelY)
      }, trimLabel(edge.label || edge.type, 18));
      edgeLayer.append(label);
    }
  });

  for (const node of prepared.visibleNodes) {
    const position = prepared.positions.map.get(node.id);
    if (!position) continue;
    const radius = clampNumber(17 + Math.sqrt(node.degree || 0) * 3, 18, 32);
    const group = svgElement('g', {
      class: `graph-node graph-node-${node.kind || kind}`,
      transform: `translate(${position.x.toFixed(1)} ${position.y.toFixed(1)})`
    });
    group.append(svgElement('circle', { r: String(radius), class: 'graph-node-dot' }));
    group.append(svgElement('text', {
      class: 'graph-node-label',
      y: String(radius + 13)
    }, trimLabel(node.label || node.id, 18)));
    group.append(svgElement('title', {}, graphNodeTitle(node)));
    nodeLayer.append(group);
  }

  transformLayer.append(edgeLayer, nodeLayer);
  svg.append(transformLayer);
  return svg;
}

function setupGraphPanZoom(svg, canvas, controls) {
  const layer = svg.querySelector('.graph-transform-layer');
  if (!layer) return;
  const state = {
    x: 0,
    y: 0,
    scale: 1,
    minScale: 0.35,
    maxScale: 5,
    width: Number(svg.dataset.graphWidth || 960),
    height: Number(svg.dataset.graphHeight || 640),
    dragging: false,
    lastClientX: 0,
    lastClientY: 0
  };

  const update = () => {
    layer.setAttribute('transform', `matrix(${state.scale.toFixed(4)} 0 0 ${state.scale.toFixed(4)} ${state.x.toFixed(2)} ${state.y.toFixed(2)})`);
    controls.zoomIndicator.textContent = `${Math.round(state.scale * 100)}%`;
  };
  const clampTranslation = () => {
    const maxPanX = state.width * Math.max(1, state.scale) * 0.7;
    const maxPanY = state.height * Math.max(1, state.scale) * 0.7;
    state.x = clampNumber(state.x, -maxPanX, maxPanX);
    state.y = clampNumber(state.y, -maxPanY, maxPanY);
  };
  const zoomAt = (clientX, clientY, factor) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const viewX = (clientX - rect.left) / rect.width * state.width;
    const viewY = (clientY - rect.top) / rect.height * state.height;
    const graphX = (viewX - state.x) / state.scale;
    const graphY = (viewY - state.y) / state.scale;
    const nextScale = clampNumber(state.scale * factor, state.minScale, state.maxScale);
    state.x = viewX - graphX * nextScale;
    state.y = viewY - graphY * nextScale;
    state.scale = nextScale;
    clampTranslation();
    update();
  };
  const zoomFromCenter = (factor) => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const reset = () => {
    state.x = 0;
    state.y = 0;
    state.scale = 1;
    update();
  };

  controls.zoomIn.addEventListener('click', () => zoomFromCenter(1.25));
  controls.zoomOut.addEventListener('click', () => zoomFromCenter(0.8));
  controls.zoomReset.addEventListener('click', reset);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.88);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    state.dragging = true;
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const rect = svg.getBoundingClientRect();
    const dx = (event.clientX - state.lastClientX) / Math.max(1, rect.width) * state.width;
    const dy = (event.clientY - state.lastClientY) / Math.max(1, rect.height) * state.height;
    state.x += dx;
    state.y += dy;
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    clampTranslation();
    update();
  });
  const stopDrag = (event) => {
    state.dragging = false;
    canvas.classList.remove('dragging');
    if (event?.pointerId !== undefined) canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('pointerleave', stopDrag);
  canvas.addEventListener('dblclick', (event) => zoomAt(event.clientX, event.clientY, 1.5));
  update();
}

function renderGraphLegend(kind) {
  const legend = document.createElement('div');
  legend.className = 'graph-legend';
  const items = kind === 'map'
    ? [['good', '开放/可走'], ['danger', '封锁/危险'], ['warn', '隐藏/特殊'], ['muted', '普通连接']]
    : [['good', '盟友/正向'], ['danger', '敌对/冲突'], ['warn', '隶属/包含/混合'], ['muted', '普通关系']];
  for (const [tone, label] of items) {
    const item = document.createElement('span');
    item.className = `graph-legend-item tone-${tone}`;
    item.textContent = label;
    legend.append(item);
  }
  return legend;
}

function renderGraphAdjacency(prepared) {
  const block = document.createElement('div');
  block.className = 'graph-adjacency';
  const heading = document.createElement('h4');
  heading.textContent = '相邻关系';
  block.append(heading);
  const list = document.createElement('div');
  list.className = 'graph-adjacency-list';
  const nodeMap = new Map(prepared.allNodes.map((node) => [node.id, node]));
  const adjacency = new Map(prepared.allNodes.map((node) => [node.id, []]));
  for (const edge of prepared.allEdges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push({ edge, neighborId: edge.to, direction: 'out' });
    if (!isDirectedGraphEdge(edge)) {
      adjacency.get(edge.to).push({ edge, neighborId: edge.from, direction: 'in' });
    }
  }
  const rows = [...adjacency.entries()]
    .sort((a, b) => (b[1].length - a[1].length) || graphNodeName(nodeMap.get(a[0])).localeCompare(graphNodeName(nodeMap.get(b[0]))));
  if (rows.length === 0) {
    list.append(playerActionEmpty('没有边关系。', 'compact'));
  }
  for (const [nodeId, links] of rows) {
    const row = document.createElement('div');
    row.className = 'graph-adjacency-row';
    const name = document.createElement('strong');
    name.textContent = graphNodeName(nodeMap.get(nodeId));
    const detail = document.createElement('span');
    detail.textContent = links.length
      ? links.map(({ edge, neighborId }) => {
        const neighbor = graphNodeName(nodeMap.get(neighborId) || { id: neighborId, label: neighborId });
        const label = edge.label || edge.type || '关系';
        const meta = [edge.status, edge.visibility, edge.meta].filter(Boolean).join(' · ');
        return `${label} -> ${neighbor}${meta ? ` (${meta})` : ''}`;
      }).join('；')
      : '无相邻节点';
    row.append(name, detail);
    list.append(row);
  }
  block.append(list);
  return block;
}

function graphRecordData(record) {
  if (record?.data && typeof record.data === 'object') return record.data;
  if (record?.fields && typeof record.fields === 'object') return record.fields;
  return record && typeof record === 'object' ? record : {};
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const item = firstText(...value);
      if (item) return item;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function numericGraphValue(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function compactGraphMeta(values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => firstText(value))
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ');
}

function isGraphBlocked(data = {}) {
  return /blocked|locked|sealed|collapsed|unreachable|closed|inactive|removed/i.test(String(data.status || ''));
}

function isGraphHidden(data = {}) {
  return /hidden|secret|unknown|fogged/i.test(String(data.visibility || ''));
}

function graphEdgeClass(edge) {
  const text = `${edge.type || ''} ${edge.status || ''} ${edge.visibility || ''}`.toLowerCase();
  if (/enemy|hostile|rival|conflict|blocked|locked|sealed|danger|hazard/.test(text)) return 'tone-danger';
  if (/ally|friend|support|open|active|road|path/.test(text)) return 'tone-good';
  if (/contains|membership|member|mixed|hidden|secret|portal|shortcut|suspected/.test(text)) return 'tone-warn';
  return 'tone-muted';
}

function graphEdgeTitle(edge) {
  return [
    `${edge.from} -> ${edge.to}`,
    edge.label || edge.type,
    edge.summary,
    edge.meta
  ].filter(Boolean).join('\n');
}

function graphNodeTitle(node) {
  return [
    node.label || node.id,
    node.id,
    node.group,
    node.summary,
    node.meta
  ].filter(Boolean).join('\n');
}

function graphNodeName(node = {}) {
  return node.label || node.id || '未命名';
}

function isDirectedGraphEdge(edge) {
  return /directed|one-way|one_way/i.test(String(edge.direction || '')) || edge.type === 'membership';
}

function parallelEdgeMap(edges) {
  const map = new Map();
  for (const edge of edges) {
    const key = parallelEdgeKey(edge);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(edge.id);
  }
  return map;
}

function parallelEdgeKey(edge) {
  return [edge.from, edge.to].sort().join('|');
}

function graphEdgePath(from, to, offset) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / distance;
  const ny = dx / distance;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const controlX = midX + nx * offset;
  const controlY = midY + ny * offset;
  return {
    d: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
    labelX: controlX,
    labelY: controlY - 4
  };
}

function svgElement(name, attrs = {}, text = '') {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === '') continue;
    element.setAttribute(key, value);
  }
  if (text) element.textContent = text;
  return element;
}

function trimLabel(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededAngle(value) {
  return (hashNumber(value) % 628) / 100;
}

function hashNumber(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function appendPlayerActionRecordFields(card, context, collection, record, { excludeFields = [] } = {}) {
  const excluded = new Set(excludeFields);
  const rows = playerActionRecordFieldEntries(context, collection, record)
    .filter(([field]) => !excluded.has(field));
  const block = document.createElement('div');
  block.className = 'player-info-list-block player-info-raw-fields';
  const heading = document.createElement('h4');
  heading.textContent = '数据库字段';
  block.append(heading);
  if (rows.length === 0) {
    block.append(playerActionEmpty('没有允许显示的字段。', 'compact'));
    card.append(block);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'player-info-grid player-info-field-grid';
  for (const [field, value] of rows) {
    grid.append(playerActionKeyValue(field, value));
  }
  block.append(grid);
  card.append(block);
}

function playerActionRecordFieldEntries(context, collection, record) {
  const data = record?.data || {};
  const collectionInfo = context.collectionMap?.get(collection);
  const schemaFields = dbQueryFieldNames(collectionInfo);
  const dataFields = Object.keys(data).filter((field) => !schemaFields.includes(field));
  return [...schemaFields, ...dataFields]
    .filter((field) => Object.hasOwn(data, field))
    .filter((field) => playerActionRawFieldVisible(context, collection, field))
    .filter((field) => data[field] !== undefined && data[field] !== null && data[field] !== '')
    .map((field) => [field, data[field]]);
}

function playerActionRecordTitle(context, collection, record, fields, fallback) {
  const data = record?.data || {};
  for (const field of fields) {
    const value = playerActionVisibleValue(context, collection, data, field);
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return fallback || record?.id || '未命名';
}

function playerActionRecordSubtitle(context, collection, record, fields) {
  const data = record?.data || {};
  const parts = fields.map((field) => {
    const value = playerActionVisibleValue(context, collection, data, field);
    if (!value) return '';
    return /At$|UpdatedAt|Iso/i.test(field) ? formatTime(value) : String(value);
  }).filter(Boolean);
  if (record?.updatedAt) parts.push(`更新 ${formatTime(record.updatedAt)}`);
  return parts.join(' · ');
}

function playerActionVisibleValue(context, collection, data, field) {
  return playerActionFieldVisible(context, collection, field) ? data?.[field] : undefined;
}

function playerActionFieldVisible(context, collection, field) {
  return isPlayerDbQueryFieldVisible(context?.action, collection, field);
}

function playerActionRawFieldVisible(context, collection, field) {
  if (!playerActionFieldVisible(context, collection, field)) return false;
  const config = getPlayerDbQueryCollectionConfig(state.playerDbQueryControl, context?.action, collection);
  if (config.mode === 'selected') return true;
  return !PLAYER_ACTION_TECHNICAL_FIELDS.has(field);
}

function playerActionCard(title, subtitle) {
  const card = document.createElement('section');
  card.className = 'player-info-card';
  const header = document.createElement('div');
  header.className = 'player-info-card-header';
  const h3 = document.createElement('h3');
  h3.textContent = title || '未命名';
  const small = document.createElement('small');
  small.textContent = subtitle || '';
  header.append(h3, small);
  card.append(header);
  return card;
}

function playerActionGrid(rows) {
  const grid = document.createElement('div');
  grid.className = 'player-info-grid';
  for (const [key, value] of rows) {
    if (value === undefined || value === null || value === '') continue;
    grid.append(playerActionKeyValue(key, value));
  }
  if (!grid.childElementCount) grid.append(playerActionKeyValue('状态', '无记录'));
  return grid;
}

function playerActionKeyValue(key, value) {
  const row = document.createElement('div');
  row.className = 'player-info-kv';
  const label = document.createElement('span');
  label.textContent = key;
  const detail = document.createElement('strong');
  detail.textContent = formatValue(value);
  row.append(label, detail);
  return row;
}

function playerActionChips(title, values) {
  const wrapper = document.createElement('div');
  wrapper.className = 'player-info-chip-block';
  const label = document.createElement('span');
  label.textContent = title;
  const chips = document.createElement('div');
  chips.className = 'player-info-chips';
  for (const value of values.filter(Boolean)) {
    const chip = document.createElement('span');
    chip.textContent = String(value);
    chips.append(chip);
  }
  if (!chips.childElementCount) {
    const empty = document.createElement('span');
    empty.textContent = '无';
    chips.append(empty);
  }
  wrapper.append(label, chips);
  return wrapper;
}

function playerActionList(title, items, mapItem) {
  const section = document.createElement('div');
  section.className = 'player-info-list-block';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading);
  const list = document.createElement('div');
  list.className = 'player-info-list';
  if (!items.length) {
    list.append(playerActionEmpty('无记录', 'compact'));
  }
  for (const item of items) {
    const mapped = mapItem(item || {});
    const row = document.createElement('div');
    row.className = 'player-info-list-item';
    const strong = document.createElement('strong');
    strong.textContent = mapped.title || '未命名';
    const meta = document.createElement('span');
    meta.textContent = mapped.meta || '';
    row.append(strong, meta);
    if (mapped.detail) {
      const detail = document.createElement('small');
      detail.textContent = mapped.detail;
      row.append(detail);
    }
    list.append(row);
  }
  section.append(list);
  return section;
}

function playerActionSectionTitle(title) {
  const heading = document.createElement('h3');
  heading.className = 'player-info-section-title';
  heading.textContent = title;
  return heading;
}

function playerActionEmpty(text, variant = '') {
  const empty = document.createElement('div');
  empty.className = `player-info-empty${variant ? ` ${variant}` : ''}`;
  empty.textContent = text;
  return empty;
}

function actorDisplayName(actor, fallback) {
  return actor.name || actor.displayName || actor.npcId || actor.playerId || fallback || '玩家';
}

function actorSummary(actor, record) {
  return [
    actor.playerId,
    actor.npcId,
    actor.sceneId,
    record.updatedAt ? `更新 ${formatTime(record.updatedAt)}` : ''
  ].filter(Boolean).join(' · ');
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function compactObjectText(value) {
  if (!value || typeof value !== 'object') return formatValue(value);
  if (Array.isArray(value)) return value.map(formatValue).join('，');
  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && item !== '')
    .map(([key, item]) => `${key}: ${formatValue(item)}`)
    .join('，') || '无记录';
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return '无记录';
  if (Array.isArray(value)) return value.map(formatValue).join('，') || '无记录';
  if (typeof value === 'object') return compactObjectText(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function renderAll() {
  renderCharacters();
  renderChats();
  renderActiveChat();
  renderCharacterCardPreview();
  renderWorldDrawer();
  renderCombatOverlay();
  updateControls();
  renderPlayerActionMenuItems();
  updateInitialSettingEditorLabels();
  renderLoopHotSwitchControls();
  renderDbQueryControllerSummary();
  void loadSelectedCharacterDetails();
  if (state.worldDrawerExpanded) {
    void refreshWorldDrawer({ silent: true });
  }
}

function renderCharacters() {
  const selectedId = els.characterSelect.value || state.activeChat?.characterCardId || '';
  els.characterSelect.innerHTML = '';
  for (const character of state.characters) {
    const option = document.createElement('option');
    option.value = character.id;
    option.textContent = character.name || character.id;
    els.characterSelect.append(option);
  }
  if (selectedId && state.characters.some((character) => character.id === selectedId)) {
    els.characterSelect.value = selectedId;
  }
}

function renderCharacterCardPreview() {
  const characterId = els.characterSelect.value;
  const character = findCharacter(characterId);
  const details = state.characterDetails[characterId];
  const data = details?.currentRevision?.data || {};
  const avatar = characterAvatarUrl(data);
  els.characterAvatarImage.hidden = !avatar;
  els.characterAvatarFallback.hidden = Boolean(avatar);
  if (avatar) {
    els.characterAvatarImage.src = avatar;
  } else {
    els.characterAvatarImage.removeAttribute('src');
    els.characterAvatarFallback.textContent = initials(character?.name || data.name || '?');
  }
}

async function loadSelectedCharacterDetails({ force = false } = {}) {
  const characterId = els.characterSelect.value;
  if (!characterId || (!force && state.characterDetails[characterId])) {
    renderCharacterCardPreview();
    return state.characterDetails[characterId];
  }
  try {
    const payload = await api(`/v1/app/characters/${encodeURIComponent(characterId)}`);
    state.characterDetails[characterId] = payload.character;
    renderCharacterCardPreview();
    return payload.character;
  } catch (error) {
    showToast(error.message || String(error));
    return undefined;
  }
}

async function openAvatarPreview() {
  const characterId = els.characterSelect.value;
  if (!characterId) {
    showToast('先选择或导入角色卡');
    return;
  }

  setBusy(true);
  try {
    const character = await loadSelectedCharacterDetails();
    const data = character?.currentRevision?.data || {};
    renderAvatarPreview(data, findCharacter(characterId));
    els.avatarPreviewDialog.showModal();
  } finally {
    setBusy(false);
  }
}

function closeAvatarPreview() {
  els.avatarPreviewDialog.close();
}

function renderAvatarPreview(data = {}, character) {
  const avatar = characterAvatarUrl(data);
  const fallback = initials(data.name || character?.name || '?');
  els.avatarPreviewImage.hidden = !avatar;
  els.avatarPreviewFallback.hidden = Boolean(avatar);
  if (avatar) {
    els.avatarPreviewImage.src = avatar;
  } else {
    els.avatarPreviewImage.removeAttribute('src');
    els.avatarPreviewFallback.textContent = fallback;
  }
}

async function openCharacterEditor() {
  const characterId = els.characterSelect.value;
  if (!characterId) {
    showToast('先选择或导入角色卡');
    return;
  }

  setBusy(true);
  try {
    const character = await loadSelectedCharacterDetails({ force: true });
    if (!character) return;
    const card = characterToCard(character);
    state.characterEditor = { characterId, card };
    els.characterEditorName.textContent = character.name || card.data.name || characterId;
    els.characterEditorJson.value = JSON.stringify(card, null, 2);
    renderEditorAvatar();
    els.characterEditorDialog.showModal();
  } finally {
    setBusy(false);
  }
}

async function saveCharacterEditor() {
  const characterId = state.characterEditor.characterId;
  if (!characterId) return;

  let card;
  try {
    card = parseCharacterEditorJson();
  } catch (error) {
    showToast(error.message);
    return;
  }

  setBusy(true);
  try {
    const payload = await api(`/v1/app/characters/${encodeURIComponent(characterId)}`, {
      method: 'PUT',
      body: {
        characterCard: card,
        source: 'web-ui',
        notes: 'character editor'
      }
    });
    state.characterDetails[characterId] = payload.character;
    state.characterEditor.card = characterToCard(payload.character);
    els.characterEditorJson.value = JSON.stringify(state.characterEditor.card, null, 2);
    await loadCharacters();
    renderAll();
    renderEditorAvatar();
    showToast('角色卡已保存');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function exportSelectedCharacter() {
  const characterId = els.characterSelect.value;
  if (!characterId) return;
  try {
    const card = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/export`);
    const resources = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/export/resources`);
    const baseName = safeFileName(card?.data?.name || resources.character?.name || findCharacter(characterId)?.name || characterId);
    downloadJson(`${baseName}.character.json`, card);
    downloadJson(`${baseName}.character.resources.json`, resources);
  } catch (error) {
    showToast(error.message || String(error));
  }
}

function exportEditorCharacter() {
  try {
    const card = parseCharacterEditorJson();
    const filename = `${safeFileName(card.data?.name || state.characterEditor.characterId || 'character')}.character.json`;
    downloadJson(filename, card);
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteSelectedCharacter() {
  const characterId = els.characterSelect.value;
  if (!characterId) return;
  const character = findCharacter(characterId);
  const name = character?.name || characterId;
  if (!confirm(`删除角色卡「${name}」以及关联聊天？此操作不可撤销。`)) return;

  setBusy(true);
  try {
    await api(`/v1/app/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE' });
    delete state.characterDetails[characterId];
    if (state.characterEditor.characterId === characterId) {
      state.characterEditor = { characterId: '', card: undefined };
      if (els.characterEditorDialog.open) els.characterEditorDialog.close();
    }
    if (state.initialSetting.characterId === characterId) {
      closeInitialSettingEditor();
      state.initialSetting.characterId = '';
    }

    const deletedActiveChat = state.activeChat?.characterCardId === characterId
      || state.chats.some((chat) => chat.id === state.activeChatId && chat.characterCardId === characterId);
    if (deletedActiveChat) {
      state.activeChatId = '';
      state.activeChat = undefined;
      localStorage.removeItem('ai-dnd-active-chat');
    }

    await Promise.all([loadCharacters(), loadChats()]);
    if (!state.activeChatId && state.chats.length > 0) {
      state.activeChatId = state.chats[0].id;
    }
    if (state.activeChatId && state.chats.some((chat) => chat.id === state.activeChatId)) {
      await loadChat(state.activeChatId);
    } else {
      state.activeChatId = '';
      state.activeChat = undefined;
      localStorage.removeItem('ai-dnd-active-chat');
    }
    renderAll();
    showToast('角色卡已删除');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function updateEditorAvatarFromFile(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件');
    event.target.value = '';
    return;
  }

  let card;
  try {
    card = parseCharacterEditorJson();
  } catch (error) {
    showToast(`先修正角色卡 JSON：${error.message}`);
    event.target.value = '';
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    state.avatarCrop = {
      ...emptyAvatarCropState(),
      card,
      image,
      sourceName: file.name || 'avatar'
    };
    syncAvatarCropControls();
    clampAvatarCropOffset();
    renderAvatarCropCanvas();
    els.avatarCropDialog.showModal();
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    event.target.value = '';
  }
}

function closeAvatarCrop() {
  if (els.avatarCropDialog.open) els.avatarCropDialog.close();
  state.avatarCrop = emptyAvatarCropState();
  renderAvatarCropCanvas();
}

function applyAvatarCrop() {
  const crop = state.avatarCrop;
  if (!crop.image || !crop.card) return;
  try {
    const croppedAvatar = renderCroppedAvatarDataUrl();
    const card = crop.card;
    card.data.avatar = croppedAvatar;
    state.characterEditor.card = card;
    els.characterEditorJson.value = JSON.stringify(card, null, 2);
    renderEditorAvatar();
    closeAvatarCrop();
    showToast('头像已裁剪，保存后生效');
  } catch (error) {
    showToast(error.message || String(error));
  }
}

function resetAvatarCropTransform() {
  if (!state.avatarCrop.image) return;
  state.avatarCrop.zoom = 1;
  state.avatarCrop.rotation = 0;
  state.avatarCrop.offsetX = 0;
  state.avatarCrop.offsetY = 0;
  syncAvatarCropControls();
  renderAvatarCropCanvas();
}

function rotateAvatarCrop(delta) {
  if (!state.avatarCrop.image) return;
  state.avatarCrop.rotation = normalizeDegrees(state.avatarCrop.rotation + delta);
  syncAvatarCropControls();
  clampAvatarCropOffset();
  renderAvatarCropCanvas();
}

function updateAvatarCropZoom() {
  if (!state.avatarCrop.image) return;
  state.avatarCrop.zoom = clamp(Number(els.avatarCropZoomInput.value) || 1, 1, 4);
  clampAvatarCropOffset();
  renderAvatarCropCanvas();
}

function updateAvatarCropRotation() {
  if (!state.avatarCrop.image) return;
  state.avatarCrop.rotation = clamp(Number(els.avatarCropRotationInput.value) || 0, -180, 180);
  clampAvatarCropOffset();
  renderAvatarCropCanvas();
}

function startAvatarCropDrag(event) {
  if (!state.avatarCrop.image) return;
  event.preventDefault();
  state.avatarCrop.dragging = true;
  state.avatarCrop.lastX = event.clientX;
  state.avatarCrop.lastY = event.clientY;
  els.avatarCropCanvas.setPointerCapture(event.pointerId);
}

function moveAvatarCropDrag(event) {
  const crop = state.avatarCrop;
  if (!crop.dragging || !crop.image) return;
  event.preventDefault();
  const rect = els.avatarCropCanvas.getBoundingClientRect();
  const scaleX = els.avatarCropCanvas.width / rect.width;
  const scaleY = els.avatarCropCanvas.height / rect.height;
  crop.offsetX += (event.clientX - crop.lastX) * scaleX;
  crop.offsetY += (event.clientY - crop.lastY) * scaleY;
  crop.lastX = event.clientX;
  crop.lastY = event.clientY;
  clampAvatarCropOffset();
  renderAvatarCropCanvas();
}

function endAvatarCropDrag(event) {
  if (!state.avatarCrop.dragging) return;
  state.avatarCrop.dragging = false;
  if (els.avatarCropCanvas.hasPointerCapture(event.pointerId)) {
    els.avatarCropCanvas.releasePointerCapture(event.pointerId);
  }
}

function zoomAvatarCropWithWheel(event) {
  if (!state.avatarCrop.image) return;
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.08 : 0.08;
  state.avatarCrop.zoom = clamp(state.avatarCrop.zoom + delta, 1, 4);
  syncAvatarCropControls();
  clampAvatarCropOffset();
  renderAvatarCropCanvas();
}

function syncAvatarCropControls() {
  els.avatarCropZoomInput.value = String(state.avatarCrop.zoom);
  els.avatarCropRotationInput.value = String(state.avatarCrop.rotation);
}

function renderAvatarCropCanvas() {
  const canvas = els.avatarCropCanvas;
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0b0b0e';
  context.fillRect(0, 0, width, height);

  const crop = state.avatarCrop;
  if (!crop.image) return;

  drawAvatarCropImage(context, crop, 1);

  const frame = avatarCropFrame();
  context.fillStyle = 'rgba(5, 5, 7, 0.58)';
  context.fillRect(0, 0, width, frame.y);
  context.fillRect(0, frame.y + frame.size, width, height - frame.y - frame.size);
  context.fillRect(0, frame.y, frame.x, frame.size);
  context.fillRect(frame.x + frame.size, frame.y, width - frame.x - frame.size, frame.size);

  context.strokeStyle = 'rgba(226, 189, 102, 0.95)';
  context.lineWidth = 2;
  context.strokeRect(frame.x + 1, frame.y + 1, frame.size - 2, frame.size - 2);

  context.strokeStyle = 'rgba(244, 238, 231, 0.24)';
  context.lineWidth = 1;
  for (const ratio of [1 / 3, 2 / 3]) {
    const offset = frame.size * ratio;
    context.beginPath();
    context.moveTo(frame.x + offset, frame.y);
    context.lineTo(frame.x + offset, frame.y + frame.size);
    context.moveTo(frame.x, frame.y + offset);
    context.lineTo(frame.x + frame.size, frame.y + offset);
    context.stroke();
  }
}

function renderCroppedAvatarDataUrl() {
  const outputSize = 512;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputSize;
  outputCanvas.height = outputSize;
  const context = outputCanvas.getContext('2d');
  context.fillStyle = '#111014';
  context.fillRect(0, 0, outputSize, outputSize);
  const factor = outputSize / avatarCropFrame().size;
  drawAvatarCropImage(context, state.avatarCrop, factor, outputSize);
  return outputCanvas.toDataURL('image/png');
}

function drawAvatarCropImage(context, crop, factor = 1, outputSize = els.avatarCropCanvas.width) {
  const image = crop.image;
  const scale = avatarCropImageScale(crop) * factor;
  context.save();
  context.translate(outputSize / 2 + crop.offsetX * factor, outputSize / 2 + crop.offsetY * factor);
  context.rotate(degreesToRadians(crop.rotation));
  context.scale(scale, scale);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();
}

function clampAvatarCropOffset() {
  const crop = state.avatarCrop;
  if (!crop.image) return;
  const bounds = avatarCropImageBounds(crop);
  const frame = avatarCropFrame();
  const maxX = Math.max(0, (bounds.width - frame.size) / 2);
  const maxY = Math.max(0, (bounds.height - frame.size) / 2);
  crop.offsetX = clamp(crop.offsetX, -maxX, maxX);
  crop.offsetY = clamp(crop.offsetY, -maxY, maxY);
}

function avatarCropFrame() {
  const canvas = els.avatarCropCanvas;
  const size = Math.min(canvas.width, canvas.height) - 96;
  return {
    size,
    x: (canvas.width - size) / 2,
    y: (canvas.height - size) / 2
  };
}

function avatarCropImageScale(crop) {
  return avatarCropCoverScale(crop) * crop.zoom;
}

function avatarCropCoverScale(crop) {
  const bounds = avatarCropRawRotatedBounds(crop);
  const frame = avatarCropFrame();
  return Math.max(frame.size / bounds.width, frame.size / bounds.height);
}

function avatarCropImageBounds(crop) {
  const raw = avatarCropRawRotatedBounds(crop);
  const scale = avatarCropImageScale(crop);
  return {
    width: raw.width * scale,
    height: raw.height * scale
  };
}

function avatarCropRawRotatedBounds(crop) {
  const radians = degreesToRadians(crop.rotation);
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = crop.image?.naturalWidth || 1;
  const height = crop.image?.naturalHeight || 1;
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos
  };
}

function parseCharacterEditorJson() {
  let parsed;
  try {
    parsed = JSON.parse(els.characterEditorJson.value.trim() || '{}');
  } catch {
    throw new Error('角色卡 JSON 格式无效');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('角色卡 JSON 必须是对象');
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    const data = { ...parsed };
    delete data.data;
    delete data.spec;
    delete data.spec_version;
    delete data.specVersion;
    parsed.data = data;
    parsed.spec = 'chara_card_v2';
    parsed.spec_version = '2.0';
  }
  if (!parsed.spec) parsed.spec = 'chara_card_v2';
  if (!parsed.spec_version && parsed.specVersion) parsed.spec_version = parsed.specVersion;
  if (!parsed.spec_version) parsed.spec_version = '2.0';
  return parsed;
}

function characterToCard(character) {
  return {
    spec: character.spec || 'chara_card_v2',
    spec_version: character.specVersion || character.spec_version || '2.0',
    data: {
      ...(character.currentRevision?.data || {}),
      name: character.currentRevision?.data?.name || character.name || ''
    }
  };
}

function renderEditorAvatar() {
  const card = state.characterEditor.card || {};
  const data = card.data || {};
  const avatar = characterAvatarUrl(data);
  els.editorAvatarImage.hidden = !avatar;
  els.editorAvatarFallback.hidden = Boolean(avatar);
  if (avatar) {
    els.editorAvatarImage.src = avatar;
  } else {
    els.editorAvatarImage.removeAttribute('src');
    els.editorAvatarFallback.textContent = initials(data.name || els.characterEditorName.textContent || '?');
  }
}

function characterAvatarUrl(data = {}) {
  return data.avatar
    || data.avatar_url
    || data.image
    || data.icon
    || data.extensions?.avatar
    || data.extensions?.avatar_url
    || '';
}

function emptyAvatarCropState() {
  return {
    card: undefined,
    image: undefined,
    sourceName: '',
    zoom: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('头像文件读取失败')));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('头像图片读取失败')));
    image.src = src;
  });
}

function renderChats() {
  const characterId = els.characterSelect.value;
  const chats = characterId
    ? state.chats.filter((chat) => chat.characterCardId === characterId)
    : state.chats;
  els.chatCount.textContent = String(chats.length);
  els.chatList.innerHTML = '';
  if (state.chatRename.chatId && !chats.some((chat) => chat.id === state.chatRename.chatId)) {
    state.chatRename = emptyChatRenameState();
  }

  if (chats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'info-row';
    empty.innerHTML = '<strong>暂无聊天</strong><span>选择角色后创建一个聊天。</span>';
    els.chatList.append(empty);
    return;
  }

  for (const chat of chats) {
    els.chatList.append(renderChatRow(chat));
  }
}

function renderChatRow(chat) {
  const isRenaming = state.chatRename.chatId === chat.id;
  const row = document.createElement('div');
  row.className = `chat-row${chat.id === state.activeChatId ? ' active' : ''}${isRenaming ? ' renaming' : ''}`;
  row.setAttribute('role', 'listitem');

  if (isRenaming) {
    const editor = document.createElement('div');
    editor.className = 'chat-rename-editor';
    const input = document.createElement('input');
    input.className = 'chat-rename-input';
    input.type = 'text';
    input.value = state.chatRename.title;
    input.addEventListener('input', () => {
      state.chatRename.title = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelChatRename();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        saveChatRename(chat.id);
      }
    });
    const actions = document.createElement('div');
    actions.className = 'chat-rename-actions';
    const saveButton = chatActionButton('保存', '保存聊天标题');
    saveButton.classList.add('primary');
    saveButton.disabled = state.busy;
    saveButton.addEventListener('click', () => saveChatRename(chat.id));
    const cancelButton = chatActionButton('放弃', '放弃改名');
    cancelButton.disabled = state.busy;
    cancelButton.addEventListener('click', cancelChatRename);
    actions.append(saveButton, cancelButton);
    editor.append(input, actions);
    row.append(editor);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(0, input.value.length);
    });
    return row;
  }

  const selectButton = document.createElement('button');
  selectButton.className = 'chat-select-button';
  selectButton.type = 'button';
  selectButton.innerHTML = '<strong></strong><span></span>';
  selectButton.querySelector('strong').textContent = chat.title || chat.id;
  selectButton.querySelector('span').textContent = formatTime(chat.updatedAt);
  selectButton.addEventListener('click', async () => {
    if (state.busy) return;
    setBusy(true);
    try {
      state.chatRename = emptyChatRenameState();
      await loadChat(chat.id);
      renderAll();
    } catch (error) {
      showToast(error.message || String(error));
    } finally {
      setBusy(false);
    }
  });

  const actions = document.createElement('div');
  actions.className = 'chat-row-actions';
  const renameButton = chatActionButton('改', '改名聊天');
  renameButton.disabled = state.busy || Boolean(state.chatRename.chatId);
  renameButton.addEventListener('click', () => startChatRename(chat));
  const exportButton = chatActionButton('导', '导出聊天');
  exportButton.disabled = state.busy;
  exportButton.addEventListener('click', () => exportChat(chat));
  const deleteButton = chatActionButton('删', '删除聊天');
  deleteButton.classList.add('danger');
  deleteButton.disabled = state.busy;
  deleteButton.addEventListener('click', () => deleteChat(chat));
  actions.append(renameButton, exportButton, deleteButton);
  row.append(selectButton, actions);
  return row;
}

function chatActionButton(text, title) {
  const button = document.createElement('button');
  button.className = 'chat-action-button';
  button.type = 'button';
  button.title = title;
  button.textContent = text;
  return button;
}

function emptyChatRenameState() {
  return {
    chatId: '',
    title: ''
  };
}

function emptyNpcSettingOnboardingState() {
  return {
    chatId: '',
    mode: 'select',
    loading: false,
    error: '',
    candidates: [],
    selectedKey: '',
    prompted: new Set()
  };
}

function emptyLoopHotSwitchState() {
  return {
    available: false,
    loading: false,
    configs: [],
    activeConfigId: '',
    selectedConfigId: '',
    storage: '',
    error: ''
  };
}

function emptyWorldDrawerState() {
  const storedTab = localStorage.getItem(WORLD_DRAWER_TAB_KEY);
  return {
    activeTab: storedTab === 'history' ? 'history' : 'clock',
    loading: false,
    error: '',
    clockData: undefined,
    historyData: undefined,
    loadedChatId: '',
    loadedTab: ''
  };
}

function emptySceneVisualState() {
  return {
    key: '',
    loading: false,
    error: '',
    collapsed: localStorage.getItem(SCENE_VISUAL_COLLAPSED_KEY) === 'true',
    loadedChatId: '',
    sceneId: 'current',
    backgroundUrl: '',
    backgroundTitle: '',
    activeBackgroundLayer: 'A',
    npcs: [],
    speechByNpcId: {},
    debug: {},
    refreshTimer: undefined
  };
}

function emptyStageVisualState() {
  return {
    key: '',
    loading: false,
    error: '',
    url: '',
    name: '',
    targetId: '',
    sceneId: '',
    source: ''
  };
}

function emptyCombatOverlayState() {
  return {
    open: false,
    loading: false,
    error: '',
    battle: undefined,
    events: [],
    allies: [],
    enemies: [],
    actions: [],
    actorId: '',
    targetId: '',
    skillDrawerOpen: true,
    specialOpen: false,
    stageVisual: emptyStageVisualState(),
    statusText: '',
    lastCombatToolId: '',
    actionCooldownUntil: 0,
    actionCooldownTimer: undefined,
    refreshTimer: undefined
  };
}

function emptyPersuasionOverlayState() {
  return {
    open: false,
    loading: false,
    error: '',
    title: '说服模块',
    subtitle: '等待说服内容',
    sourceText: '',
    targetText: '',
    sceneId: 'current',
    stageText: '',
    stageVisual: emptyStageVisualState(),
    targetIds: [],
    targetNames: [],
    input: '',
    statusText: '',
    routerItemId: '',
    turnId: '',
    chatSessionId: '',
    debug: false,
    promptedItemIds: new Set()
  };
}

function emptyAgentProgressState() {
  return {
    eventSource: undefined,
    pollTimer: undefined,
    chatSessionId: '',
    lastSequence: 0,
    events: [],
    lastWarning: '',
    hideTimer: undefined
  };
}

function emptyRouterReviewState() {
  return {
    items: new Map(),
    dismissed: new Set(),
    timers: new Map(),
    startedAt: 0
  };
}

function emptySettlementNoticeState() {
  return {
    items: new Map(),
    timers: new Map(),
    startedAt: 0
  };
}

function emptyAdjudicationOverlayState() {
  return {
    current: undefined,
    appealOpen: false,
    submitting: false,
    accepting: false,
    status: ''
  };
}

function emptyDiceRollOverlayState() {
  return {
    current: undefined,
    hideTimer: undefined,
    rerolling: false,
    status: ''
  };
}

function startChatRename(chat) {
  if (state.busy || !chat?.id) return;
  state.chatRename = {
    chatId: chat.id,
    title: chat.title || ''
  };
  renderChats();
  updateControls();
}

function cancelChatRename() {
  state.chatRename = emptyChatRenameState();
  renderChats();
  updateControls();
}

function resetSceneVisualDisplay() {
  clearTimeout(state.sceneVisual.refreshTimer);
  state.sceneVisual = emptySceneVisualState();
  applySceneBackground('', '');
  renderSceneVisualPanel();
}

function sceneVisualRefreshKey() {
  const chat = state.activeChat;
  const latest = latestAssistantMessage(chat);
  return [
    state.activeChatId || '',
    latest?.id || '',
    latest?.updatedAt || latest?.createdAt || latest?.timestamp || '',
    (chat?.messages || []).length
  ].join(':');
}

function ensureSceneVisualForActiveChat() {
  if (!state.activeChatId || !state.activeChat) return;
  const key = sceneVisualRefreshKey();
  if (state.sceneVisual.loading) return;
  if (state.sceneVisual.loadedChatId === state.activeChatId && state.sceneVisual.key === key) return;
  scheduleSceneVisualRefresh({ force: true, delay: 0 });
}

function scheduleSceneVisualRefresh({ force = false, delay = SCENE_VISUAL_REFRESH_DELAY_MS } = {}) {
  if (!state.activeChatId) return;
  if (force) state.sceneVisual.key = '';
  clearTimeout(state.sceneVisual.refreshTimer);
  state.sceneVisual.refreshTimer = setTimeout(() => {
    void refreshSceneVisual({ force });
  }, delay);
}

async function refreshSceneVisual({ force = false } = {}) {
  const chatId = state.activeChatId;
  if (!chatId) {
    resetSceneVisualDisplay();
    return;
  }
  const key = sceneVisualRefreshKey();
  if (!force && state.sceneVisual.loadedChatId === chatId && state.sceneVisual.key === key) return;

  state.sceneVisual.loading = true;
  state.sceneVisual.error = '';
  state.sceneVisual.loadedChatId = chatId;
  state.sceneVisual.key = key;
  renderSceneVisualPanel();

  try {
    const sceneId = await resolveSceneVisualSceneId(chatId);
    const [mountedNpcs, mountedMaps] = await Promise.all([
      loadSceneVisualMountedNpcs(chatId, sceneId),
      loadSceneVisualMountedMaps(chatId, sceneId)
    ]);
    if (state.activeChatId !== chatId) return;

    const visibleNpcs = mountedNpcs
      .map((record) => normalizeSceneVisualRecord(record, 'npc'))
      .filter((record) => record && sceneVisualRecordVisible(record.data) && !sceneVisualRecordIsPlayer(record.data));
    const visibleMaps = mountedMaps
      .map((record) => normalizeSceneVisualRecord(record, 'map'))
      .filter((record) => record && sceneVisualRecordVisible(record.data));
    const debug = {
      sceneId,
      mountedNpcCount: mountedNpcs.length,
      mountedMapCount: mountedMaps.length,
      visibleNpcCount: visibleNpcs.length,
      visibleMapCount: visibleMaps.length
    };
    const assetMap = await resolveSceneVisualAssetReferences(visibleNpcs, visibleMaps, sceneId);
    if (state.activeChatId !== chatId) return;

    const speechByNpcId = extractLatestNpcSpeech(visibleNpcs);
    const npcs = visibleNpcs
      .map((record) => {
        const data = record.data || {};
        const npcId = sceneVisualRecordId(record, 'npc');
        const inlineUrl = extractSceneVisualUrl(data, 'npc');
        const boundAsset = visualAssetForRecord(assetMap, 'npc', npcVisualTargetIds(record), SCENE_NPC_VISUAL_SLOTS)
          || frontendAssetForRecord('npc', npcVisualTargetIds(record), SCENE_NPC_VISUAL_SLOTS);
        const imageUrl = inlineUrl || sceneVisualAssetUrl(boundAsset);
        if (!imageUrl) return undefined;
        const asset = registerSceneVisualAsset({
          ...(typeof boundAsset === 'object' ? boundAsset : {}),
          id: `scene:${sceneId}:npc:${npcId}:visual`,
          type: sceneVisualAssetTypeHint(data, 'npc') || (typeof boundAsset === 'object' ? boundAsset.type : '') || 'image',
          renderer: sceneVisualRendererHint(data, 'npc') || (typeof boundAsset === 'object' ? boundAsset.renderer : ''),
          targetType: 'npc',
          targetId: npcId,
          slot: sceneVisualSlotHint(data, 'npc') || (typeof boundAsset === 'object' ? boundAsset.slot : '') || 'portrait',
          url: imageUrl,
          metadata: {
            ...(typeof boundAsset === 'object' ? boundAsset.metadata : {}),
            ...sceneVisualMetadata(data),
            sourceCollection: record.collection || '',
            sceneId
          }
        });
        return {
          id: npcId,
          name: data.name || data.displayName || data.npcId || record.id || 'NPC',
          imageUrl,
          asset,
          renderer: asset?.renderer || sceneVisualRendererHint(data, 'npc') || 'static-image',
          visual: sceneVisualMetadata(data),
          speech: speechByNpcId[sceneVisualRecordId(record, 'npc')] || '',
          status: data.status || '',
          visibility: data.visibility || ''
        };
      })
      .filter(Boolean)
      .slice(0, 12);
    const backgroundRecord = visibleMaps.find((record) => {
      const data = record.data || {};
      return extractSceneVisualUrl(data, 'map')
        || visualAssetUrlForRecord(assetMap, 'map', mapVisualTargetIds(record), SCENE_MAP_VISUAL_SLOTS)
        || sceneVisualAssetUrl(frontendAssetForRecord('map', mapVisualTargetIds(record), SCENE_MAP_VISUAL_SLOTS));
    });
    let backgroundAsset;
    let backgroundUrl = '';
    if (backgroundRecord) {
      const data = backgroundRecord.data || {};
      const inlineUrl = extractSceneVisualUrl(data, 'map');
      const boundAsset = visualAssetForRecord(assetMap, 'map', mapVisualTargetIds(backgroundRecord), SCENE_MAP_VISUAL_SLOTS)
        || frontendAssetForRecord('map', mapVisualTargetIds(backgroundRecord), SCENE_MAP_VISUAL_SLOTS);
      backgroundUrl = inlineUrl || sceneVisualAssetUrl(boundAsset);
      if (backgroundUrl) {
        backgroundAsset = registerSceneVisualAsset({
          ...(typeof boundAsset === 'object' ? boundAsset : {}),
          id: `scene:${sceneId}:map:${sceneVisualRecordId(backgroundRecord, 'map')}:background`,
          type: sceneVisualAssetTypeHint(data, 'map') || (typeof boundAsset === 'object' ? boundAsset.type : '') || 'image',
          renderer: sceneVisualRendererHint(data, 'map') || (typeof boundAsset === 'object' ? boundAsset.renderer : ''),
          targetType: 'map',
          targetId: sceneVisualRecordId(backgroundRecord, 'map'),
          slot: sceneVisualSlotHint(data, 'map') || (typeof boundAsset === 'object' ? boundAsset.slot : '') || 'background',
          url: backgroundUrl,
          metadata: {
            ...(typeof boundAsset === 'object' ? boundAsset.metadata : {}),
            ...sceneVisualMetadata(data),
            sourceCollection: backgroundRecord.collection || '',
            sceneId
          }
        });
      }
    }

    state.sceneVisual = {
      ...state.sceneVisual,
      loading: false,
      error: '',
      loadedChatId: chatId,
      key,
      sceneId,
      npcs,
      speechByNpcId,
      debug: {
        ...debug,
        npcImageCount: npcs.length,
        hasBackground: Boolean(backgroundUrl)
      }
    };
    applySceneBackground(backgroundUrl, backgroundRecord?.data?.name || backgroundRecord?.data?.mapId || '', backgroundAsset);
    emitFrontendEvent('scene:changed', {
      sceneId,
      backgroundUrl,
      backgroundAsset,
      backgroundRecord: backgroundRecord?.data || undefined,
      npcs
    });
    emitFrontendEvent('npc:mounted', {
      sceneId,
      npcs
    });
    for (const npc of npcs) {
      if (npc.speech) {
        emitFrontendEvent('npc:speech', {
          sceneId,
          npcId: npc.id,
          speakerName: npc.name,
          text: npc.speech,
          npc
        });
      }
    }
    renderSceneVisualPanel();
  } catch (error) {
    state.sceneVisual.loading = false;
    state.sceneVisual.error = error.message || String(error);
    state.sceneVisual.debug = {
      sceneId: inferSceneVisualSceneId(),
      error: error.message || String(error)
    };
    renderSceneVisualPanel();
  }
}

async function loadSceneVisualMountedNpcs(chatId, sceneId) {
  if (toolAvailable('system.scene_npcs.list_mounted_npcs')) {
    const output = await executeTool('system.scene_npcs.list_mounted_npcs', {
      chatSessionId: chatId,
      sceneId,
      includeInactive: false,
      limit: 100
    }, { source: 'web-ui.scene-visual' });
    return output.records || output.npcs || [];
  }
  const collections = await loadAvailableChatDataCollections(chatId);
  return queryChatDataCollectionIfAvailable(collections, 'scene_npc_mounts', {
    filter: { sceneId },
    sort: [{ field: 'orderIndex', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit: 100
  }, chatId);
}

async function loadSceneVisualMountedMaps(chatId, sceneId) {
  if (toolAvailable('system.scene_maps.list_mounted_maps')) {
    const output = await executeTool('system.scene_maps.list_mounted_maps', {
      chatSessionId: chatId,
      sceneId,
      includeInactive: false,
      limit: 100
    }, { source: 'web-ui.scene-visual' });
    return output.records || output.maps || [];
  }
  const collections = await loadAvailableChatDataCollections(chatId);
  return queryChatDataCollectionIfAvailable(collections, 'scene_map_mounts', {
    filter: { sceneId },
    sort: [{ field: 'orderIndex', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit: 100
  }, chatId);
}

async function resolveSceneVisualAssetReferences(npcs = [], maps = [], sceneId = 'current') {
  const assets = new Map();
  if (!toolAvailable('system.visual.resolve_assets')) return assets;
  const targets = [];
  for (const record of npcs) {
    for (const targetId of npcVisualTargetIds(record)) {
      for (const slot of SCENE_NPC_VISUAL_SLOTS) {
        targets.push({ targetType: 'npc', targetId, slot, sceneId });
      }
    }
  }
  for (const record of maps) {
    for (const targetId of mapVisualTargetIds(record)) {
      for (const slot of SCENE_MAP_VISUAL_SLOTS) {
        targets.push({ targetType: 'map', targetId, slot, sceneId });
      }
    }
  }
  const uniqueTargets = dedupeSceneVisualTargets(targets).slice(0, 240);
  if (uniqueTargets.length === 0) return assets;
  try {
    const output = await executeTool('system.visual.resolve_assets', {
      sceneId,
      targets: uniqueTargets,
      bindingLimit: 500
    }, { source: 'web-ui.scene-visual' });
    for (const item of output.assets || []) {
      const assetData = item.asset?.data || item.asset || {};
      const uri = normalizeSceneVisualUri(assetData.uri || assetData.url || assetData.src);
      const targetType = String(item.target?.targetType || '').toLowerCase();
      if (!uri) continue;
      if (targetType === 'map' && !sceneVisualAssetIsRenderable(assetData)) continue;
      if (targetType !== 'map' && !sceneVisualAssetIsRenderable(assetData)) continue;
      const key = sceneVisualTargetKey(item.target);
      if (key && !assets.has(key)) {
        assets.set(key, registerSceneVisualAsset({
          ...assetData,
          id: assetData.id || item.asset?.id || key,
          targetType: item.target?.targetType,
          targetId: item.target?.targetId,
          slot: item.target?.slot,
          url: uri,
          metadata: {
            ...normalizePlayerActionObject(assetData.metadata),
            binding: item.binding?.data || item.binding,
            sceneId
          }
        }));
      }
    }
  } catch (error) {
    console.warn('Scene visual asset resolution failed:', error);
  }
  return assets;
}

function renderSceneVisualPanel() {
  const panel = els.sceneVisualPanel;
  if (!panel) return;
  removeSceneVisualSpeechLayer();
  removeSceneVisualToggle();
  panel.innerHTML = '';
  const visual = state.sceneVisual;
  const hasNpcs = visual.npcs.length > 0;
  const shouldShow = Boolean(state.activeChat && (hasNpcs || visual.loading || visual.error));
  panel.dataset.sceneVisualDebug = JSON.stringify({
    loading: visual.loading,
    error: visual.error,
    loadedChatId: visual.loadedChatId,
    key: visual.key,
    sceneId: visual.sceneId,
    npcCount: visual.npcs.length,
    hasBackground: Boolean(visual.backgroundUrl),
    collapsed: Boolean(visual.collapsed),
    ...visual.debug
  });
  panel.hidden = !shouldShow;
  panel.classList.toggle('collapsed', Boolean(visual.collapsed));
  if (!shouldShow) return;

  const toggle = document.createElement('button');
  toggle.id = SCENE_VISUAL_TOGGLE_ID;
  toggle.className = 'scene-visual-toggle';
  toggle.type = 'button';
  toggle.title = visual.collapsed ? '显示人物图片' : '隐藏人物图片';
  toggle.setAttribute('aria-controls', 'sceneVisualPanel');
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-pressed', String(Boolean(visual.collapsed)));
  toggle.textContent = visual.collapsed ? '▴' : '▾';
  toggle.addEventListener('click', toggleSceneVisualCollapsed);
  document.body.append(toggle);
  requestAnimationFrame(positionSceneVisualOverlays);
  if (visual.collapsed) return;

  if (visual.error) {
    const warning = document.createElement('div');
    warning.className = 'scene-visual-warning';
    warning.textContent = `场景视觉读取失败：${visual.error}`;
    panel.append(warning);
    return;
  }
  if (visual.loading && !hasNpcs) {
    const loading = document.createElement('div');
    loading.className = 'scene-visual-loading';
    loading.textContent = '正在读取场景视觉...';
    panel.append(loading);
    return;
  }

  const stage = document.createElement('div');
  stage.className = 'scene-visual-stage';
  for (const npc of visual.npcs) {
    stage.append(renderSceneVisualNpc(npc));
  }
  stage.addEventListener('scroll', positionSceneVisualSpeechFloats, { passive: true });
  panel.append(stage);
  renderSceneVisualSpeechLayer(visual.npcs);
}

function toggleSceneVisualCollapsed(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  state.sceneVisual.collapsed = !state.sceneVisual.collapsed;
  localStorage.setItem(SCENE_VISUAL_COLLAPSED_KEY, String(state.sceneVisual.collapsed));
  renderSceneVisualPanel();
}

function renderSceneVisualNpc(npc) {
  const figure = document.createElement('figure');
  figure.className = 'scene-npc-figure';
  figure.dataset.npcId = npc.id;

  const visual = renderFrontendNpcVisual({
    npc,
    asset: npc.asset || {
      type: 'image',
      targetType: 'npc',
      targetId: npc.id,
      slot: 'portrait',
      url: npc.imageUrl,
      renderer: npc.renderer
    },
    onError: () => figure.classList.add('image-broken')
  }) || renderSceneVisualStaticImage(npc, figure);
  visual.classList.add('scene-npc-visual');

  const caption = document.createElement('figcaption');
  caption.textContent = npc.name;

  figure.append(visual, caption);
  return figure;
}

function renderSceneVisualStaticImage(npc, figure) {
  const image = document.createElement('img');
  image.src = npc.imageUrl;
  image.alt = `${npc.name} CG`;
  image.loading = 'lazy';
  image.dataset.renderer = 'static-image';
  image.addEventListener('error', () => {
    figure.classList.add('image-broken');
  });
  return image;
}

function renderSceneVisualSpeechLayer(npcs = []) {
  const spoken = npcs.filter((npc) => npc.speech);
  if (!spoken.length) return;
  const layer = document.createElement('div');
  layer.id = 'sceneVisualSpeechLayer';
  layer.className = 'scene-visual-speech-layer';
  for (const npc of spoken) {
    const speech = document.createElement('div');
    speech.className = 'scene-npc-speech';
    speech.dataset.npcId = npc.id;
    speech.textContent = npc.speech;
    layer.append(speech);
  }
  document.body.append(layer);
  requestAnimationFrame(positionSceneVisualSpeechFloats);
}

function removeSceneVisualSpeechLayer() {
  document.getElementById('sceneVisualSpeechLayer')?.remove();
}

function removeSceneVisualToggle() {
  document.getElementById(SCENE_VISUAL_TOGGLE_ID)?.remove();
}

function positionSceneVisualOverlays() {
  positionSceneVisualToggle();
  positionSceneVisualSpeechFloats();
}

function positionSceneVisualToggle() {
  const panel = els.sceneVisualPanel;
  const toggle = document.getElementById(SCENE_VISUAL_TOGGLE_ID);
  if (!panel || !toggle || panel.hidden) {
    toggle?.remove();
    return;
  }
  const rect = panel.getBoundingClientRect();
  const left = clamp(rect.left + 8, 8, Math.max(8, window.innerWidth - 34));
  const top = clamp(rect.top + 6, 8, Math.max(8, window.innerHeight - 32));
  toggle.style.setProperty('--scene-visual-toggle-left', `${left}px`);
  toggle.style.setProperty('--scene-visual-toggle-top', `${top}px`);
}

function positionSceneVisualSpeechFloats() {
  const panel = els.sceneVisualPanel;
  const stage = panel?.querySelector('.scene-visual-stage');
  const layer = document.getElementById('sceneVisualSpeechLayer');
  if (!layer) return;
  if (!panel || !stage || panel.hidden || state.sceneVisual.collapsed) {
    hideSceneVisualSpeechBubbles(layer);
    return;
  }
  layer.hidden = false;
  const panelRect = panel.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const clipRect = intersectRects(stageRect, panelRect, {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight
  });
  if (!clipRect) {
    hideSceneVisualSpeechBubbles(layer);
    return;
  }
  const figures = new Map([...stage.querySelectorAll('.scene-npc-figure')].map((figure) => [figure.dataset.npcId, figure]));
  const entries = [];
  for (const bubble of layer.querySelectorAll('.scene-npc-speech')) {
    const figure = figures.get(bubble.dataset.npcId);
    if (!figure || !sceneVisualFigureCanOwnSpeech(figure, clipRect)) {
      bubble.hidden = true;
      continue;
    }
    const rect = figure.getBoundingClientRect();
    bubble.hidden = false;
    const bubbleRect = bubble.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    entries.push({
      bubble,
      centerX,
      width: bubbleRect.width,
      height: bubbleRect.height,
      desiredLeft: clamp(centerX - bubbleRect.width / 2, 8, Math.max(8, window.innerWidth - bubbleRect.width - 8)),
      baseTop: rect.top - bubbleRect.height - 10
    });
  }
  const lanes = [];
  for (const entry of entries.sort((a, b) => a.desiredLeft - b.desiredLeft)) {
    let laneIndex = lanes.findIndex((right) => entry.desiredLeft > right + 8);
    if (laneIndex < 0) {
      laneIndex = lanes.length;
      lanes.push(0);
    }
    const top = clamp(entry.baseTop - laneIndex * (entry.height + 8), 8, Math.max(8, window.innerHeight - entry.height - 8));
    entry.bubble.style.left = `${entry.desiredLeft}px`;
    entry.bubble.style.top = `${top}px`;
    entry.bubble.style.setProperty('--speech-arrow-left', `${clamp(entry.centerX - entry.desiredLeft, 14, Math.max(14, entry.width - 14))}px`);
    lanes[laneIndex] = entry.desiredLeft + entry.width;
  }
}

function hideSceneVisualSpeechBubbles(layer) {
  layer.hidden = true;
  for (const bubble of layer.querySelectorAll('.scene-npc-speech')) {
    bubble.hidden = true;
  }
}

function sceneVisualFigureCanOwnSpeech(figure, clipRect) {
  if (figure.hidden || !figure.isConnected) return false;
  const style = window.getComputedStyle(figure);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.02) return false;
  const rect = figure.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  const horizontalVisible = Math.max(0, Math.min(rect.right, clipRect.right) - Math.max(rect.left, clipRect.left));
  const verticalOverlap = Math.max(0, Math.min(rect.bottom, clipRect.bottom) - Math.max(rect.top, clipRect.top));
  if (verticalOverlap < 6) return false;
  const horizontalRatio = horizontalVisible / rect.width;
  return horizontalRatio >= 0.88;
}

function intersectRects(...rects) {
  const validRects = rects.filter(Boolean);
  if (!validRects.length) return undefined;
  const left = Math.max(...validRects.map((rect) => rect.left));
  const top = Math.max(...validRects.map((rect) => rect.top));
  const right = Math.min(...validRects.map((rect) => rect.right));
  const bottom = Math.min(...validRects.map((rect) => rect.bottom));
  if (right <= left || bottom <= top) return undefined;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function applySceneBackground(nextUrl, title = '', asset = undefined) {
  const layerA = els.sceneBackgroundLayerA;
  const layerB = els.sceneBackgroundLayerB;
  if (!layerA || !layerB) return;
  if (!nextUrl) {
    layerA.classList.remove('active');
    layerB.classList.remove('active');
    layerA.style.backgroundImage = '';
    layerB.style.backgroundImage = '';
    layerA.replaceChildren();
    layerB.replaceChildren();
    state.sceneVisual.backgroundUrl = '';
    state.sceneVisual.backgroundTitle = '';
    return;
  }
  if (state.sceneVisual.backgroundUrl === nextUrl) return;
  const current = state.sceneVisual.activeBackgroundLayer === 'B' ? layerB : layerA;
  const next = state.sceneVisual.activeBackgroundLayer === 'B' ? layerA : layerB;
  next.replaceChildren();
  current.replaceChildren();
  next.style.backgroundImage = '';
  const rendered = renderSceneBackgroundMedia(asset, nextUrl, title);
  if (rendered) {
    next.append(rendered);
  } else {
    next.style.backgroundImage = `url("${cssUrlEscape(nextUrl)}")`;
  }
  next.setAttribute('aria-label', title ? `场景背景：${title}` : '场景背景');
  requestAnimationFrame(() => {
    next.classList.add('active');
    current.classList.remove('active');
  });
  state.sceneVisual.activeBackgroundLayer = next === layerA ? 'A' : 'B';
  state.sceneVisual.backgroundUrl = nextUrl;
  state.sceneVisual.backgroundTitle = title || '';
}

function renderSceneBackgroundMedia(asset, url, title = '') {
  if (!asset || !url) return undefined;
  const type = String(asset.type || asset.assetType || '').toLowerCase();
  const renderer = String(asset.renderer || '').toLowerCase();
  const needsElement = renderer && renderer !== 'static-image'
    || ['video', 'live2d', 'spine', 'lottie'].includes(type);
  if (!needsElement) return undefined;
  const element = renderFrontendVisual({
    targetType: 'map',
    map: { title, url },
    asset,
    renderer,
    onError: () => {
      state.sceneVisual.backgroundUrl = '';
      applySceneBackground(url, title, { ...asset, type: 'image', renderer: 'static-image' });
    }
  });
  if (!element) return undefined;
  element.classList.add('scene-background-media');
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function inferSceneVisualSceneId() {
  const latest = latestAssistantMessage(state.activeChat);
  const latestMetadata = messageMetadata(latest);
  const chatMetadata = state.activeChat?.metadata && typeof state.activeChat.metadata === 'object'
    ? state.activeChat.metadata
    : {};
  const inferred = firstSceneVisualSceneId(
    chatMetadata.sceneId,
    chatMetadata.currentSceneId,
    latestMetadata.agentLoop?.sceneId,
    latestMetadata.agentLoop?.currentSceneId,
    latestMetadata.sceneId,
    latestMetadata.currentSceneId,
    state.sceneVisual?.sceneId
  );
  return inferred || 'current';
}

async function resolveSceneVisualSceneId(chatId) {
  const activeSceneId = await loadLatestActiveSceneId(chatId);
  return activeSceneId || inferSceneVisualSceneId();
}

async function loadLatestActiveSceneId(chatId) {
  if (!chatId || !toolAvailable('system.scene_manager.list_scenes')) return '';
  try {
    const output = await executeTool('system.scene_manager.list_scenes', {
      chatSessionId: chatId,
      status: 'active',
      limit: 5
    }, { source: 'web-ui.scene-visual' });
    const records = output.records || output.scenes || [];
    const latest = records.find((record) => firstSceneVisualSceneId(record?.data?.sceneId, record?.sceneId, record?.id));
    return firstSceneVisualSceneId(latest?.data?.sceneId, latest?.sceneId);
  } catch {
    return '';
  }
}

function firstSceneVisualSceneId(...values) {
  for (const value of values) {
    const sceneId = normalizeSceneVisualSceneIdValue(value);
    if (sceneId) return sceneId;
  }
  return '';
}

function normalizeSceneVisualSceneIdValue(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text || '';
}

function normalizeSceneVisualRecord(record, kind) {
  if (!record || typeof record !== 'object') return undefined;
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  return {
    id: record.id || data.id || data[`${kind}Id`] || data.name || '',
    collection: record.collection || '',
    data
  };
}

function sceneVisualRecordId(record, kind) {
  const data = record?.data || {};
  return String(record?.id || data.id || data[`${kind}Id`] || data.npcId || data.mapId || data.name || '').trim();
}

function sceneVisualRecordVisible(data = {}) {
  const status = String(data.status || '').toLowerCase();
  const visibility = String(data.visibility || '').toLowerCase();
  if (['inactive', 'departed', 'dead', 'removed', 'archived', 'collapsed', 'unreachable'].includes(status)) return false;
  if (['hidden', 'offscreen', 'unknown', 'gm', 'private'].includes(visibility)) return false;
  return true;
}

function sceneVisualRecordIsPlayer(data = {}) {
  return data.isPlayer === true
    || data.actorType === 'player'
    || data.type === 'player'
    || Boolean(data.playerId);
}

function npcVisualTargetIds(record) {
  const data = record?.data || {};
  return compactUnique([
    data.npcId,
    data.registryId,
    data.registryRef && String(data.registryRef).replace(/^npc_registry:/, ''),
    record?.id,
    data.id,
    data.name
  ].map(normalizeSceneVisualTargetId));
}

function mapVisualTargetIds(record) {
  const data = record?.data || {};
  return compactUnique([
    data.mapId,
    data.registryId,
    data.registryRef,
    record?.id,
    data.id,
    data.name
  ].map(normalizeSceneVisualTargetId));
}

function normalizeSceneVisualTargetId(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function dedupeSceneVisualTargets(targets = []) {
  const seen = new Set();
  const result = [];
  for (const target of targets) {
    const key = sceneVisualTargetKey(target);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function sceneVisualTargetKey(target = {}) {
  return [
    String(target.targetType || '').toLowerCase(),
    String(target.targetId || '').trim(),
    String(target.slot || '').toLowerCase()
  ].join(':');
}

function visualAssetUrlForRecord(assetMap, targetType, ids = [], slots = []) {
  return sceneVisualAssetUrl(visualAssetForRecord(assetMap, targetType, ids, slots));
}

function visualAssetForRecord(assetMap, targetType, ids = [], slots = []) {
  for (const slot of slots) {
    for (const id of ids) {
      const asset = assetMap.get(sceneVisualTargetKey({ targetType, targetId: id, slot }));
      if (asset) return asset;
    }
  }
  return undefined;
}

function frontendAssetForRecord(targetType, ids = [], slots = []) {
  const registry = frontendExtensions()?.assetRegistry;
  if (!registry) return undefined;
  for (const slot of slots) {
    for (const id of ids) {
      const asset = registry.find?.({ targetType, targetId: id, slot });
      if (asset) return asset;
    }
  }
  return undefined;
}

function sceneVisualAssetUrl(asset) {
  if (!asset) return '';
  if (typeof asset === 'string') return asset;
  return normalizeSceneVisualUri(asset.url || asset.uri || asset.src || asset.path || asset.href);
}

function registerSceneVisualAsset(asset = {}) {
  return registerFrontendAsset(asset);
}

function sceneVisualMetadata(data = {}) {
  return {
    ...normalizePlayerActionObject(data.visual),
    ...normalizePlayerActionObject(data.metadata?.visual),
    ...normalizePlayerActionObject(data.asset),
    ...normalizePlayerActionObject(data.metadata?.asset)
  };
}

function sceneVisualRendererHint(data = {}, kind = 'npc') {
  const metadata = sceneVisualMetadata(data);
  return firstText(
    data.renderer,
    data.visualRenderer,
    data[`${kind}Renderer`],
    metadata.renderer,
    metadata.visualRenderer
  );
}

function sceneVisualAssetTypeHint(data = {}, kind = 'npc') {
  const metadata = sceneVisualMetadata(data);
  return firstText(
    data.assetType,
    data.type,
    data[`${kind}AssetType`],
    metadata.assetType,
    metadata.type
  );
}

function sceneVisualSlotHint(data = {}, kind = 'npc') {
  const metadata = sceneVisualMetadata(data);
  return firstText(data.slot, data.visualSlot, data[`${kind}Slot`], metadata.slot, metadata.visualSlot);
}

function sceneVisualAssetIsImage(asset = {}) {
  const type = String(asset.assetType || asset.type || '').toLowerCase();
  const mime = String(asset.mimeType || asset.mime || '').toLowerCase();
  const uri = String(asset.uri || asset.url || '').toLowerCase();
  if (!type && !mime) return isSceneVisualImageUri(uri);
  return type === 'image' || type === 'sprite' || mime.startsWith('image/');
}

function sceneVisualAssetIsRenderable(asset = {}) {
  if (sceneVisualAssetIsImage(asset)) return true;
  const type = String(asset.assetType || asset.type || asset.kind || '').toLowerCase();
  const mime = String(asset.mimeType || asset.mime || '').toLowerCase();
  const uri = String(asset.uri || asset.url || asset.src || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  if (['video', 'live2d', 'spine', 'lottie'].includes(type)) return true;
  return /\.(mp4|webm|mov|json|model3\.json|skel|atlas)(\?|#|$)/i.test(uri);
}

function extractSceneVisualUrl(record = {}, kind = 'npc') {
  const fields = kind === 'map'
    ? ['backgroundUrl', 'backgroundImageUrl', 'background', 'backgroundImage', 'cgUrl', 'cg', 'imageUrl', 'imageUri', 'image', 'url', 'uri', 'src']
    : ['portraitUrl', 'portraitImage', 'portrait', 'avatarUrl', 'avatar', 'cgUrl', 'cg', 'spriteUrl', 'sprite', 'tokenUrl', 'token', 'imageUrl', 'imageUri', 'image', 'url', 'uri', 'src'];
  const sources = [
    record,
    record.visual,
    record.metadata,
    record.metadata?.visual,
    record.overrides,
    record.overrides?.visual,
    record.assets,
    record.media,
    record.images
  ].filter(Boolean);
  for (const source of sources) {
    const uri = findSceneVisualUrlByFields(source, fields);
    if (uri) return uri;
  }
  for (const source of sources) {
    const uri = findSceneVisualUrlByMeaning(source, kind);
    if (uri) return uri;
  }
  return '';
}

function findSceneVisualUrlByFields(source, fields) {
  if (!source) return '';
  if (typeof source === 'string') return normalizeSceneVisualUri(source);
  if (Array.isArray(source)) {
    for (const item of source) {
      const uri = findSceneVisualUrlByFields(item, fields);
      if (uri) return uri;
    }
    return '';
  }
  if (typeof source !== 'object') return '';
  for (const field of fields) {
    const uri = normalizeSceneVisualUri(source[field]);
    if (uri) return uri;
  }
  const direct = normalizeSceneVisualUri(source.uri || source.url || source.src || source.path || source.href);
  if (direct) return direct;
  for (const key of ['visual', 'image', 'images', 'asset', 'assets', 'media', 'default', 'portrait', 'avatar', 'background', 'cg']) {
    const uri = findSceneVisualUrlByFields(source[key], fields);
    if (uri) return uri;
  }
  return '';
}

function findSceneVisualUrlByMeaning(source, kind, depth = 0) {
  if (!source || depth > 4) return '';
  if (typeof source === 'string') return '';
  if (Array.isArray(source)) {
    for (const item of source) {
      const uri = findSceneVisualUrlByMeaning(item, kind, depth + 1);
      if (uri) return uri;
    }
    return '';
  }
  if (typeof source !== 'object') return '';
  const pattern = kind === 'map'
    ? /(background|backdrop|map|scene|cg|image|photo|picture|背景|地图|场景|图片)/i
    : /(portrait|avatar|token|sprite|cg|image|photo|picture|立绘|头像|图片)/i;
  for (const [key, value] of Object.entries(source)) {
    if (pattern.test(key)) {
      const uri = normalizeSceneVisualUri(value);
      if (uri) return uri;
      const nested = findSceneVisualUrlByFields(value, ['uri', 'url', 'src', 'path', 'href']);
      if (nested) return nested;
    }
  }
  for (const value of Object.values(source)) {
    const uri = findSceneVisualUrlByMeaning(value, kind, depth + 1);
    if (uri) return uri;
  }
  return '';
}

function normalizeSceneVisualUri(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    return normalizeSceneVisualUri(value.uri || value.url || value.src || value.path || value.href || value.imageUrl);
  }
  const uri = String(value).trim();
  if (!uri) return '';
  if (/^(data:(image|video)\/|blob:|https?:\/\/|\/|\.\/|\.\.\/)/i.test(uri)) return uri;
  if (isSceneVisualImageUri(uri) || isSceneVisualRenderableUri(uri)) return uri;
  return '';
}

function isSceneVisualImageUri(uri) {
  return SCENE_VISUAL_IMAGE_EXTENSIONS.test(String(uri || ''));
}

function isSceneVisualRenderableUri(uri) {
  return /\.(mp4|webm|mov|json|model3\.json|skel|atlas)(\?|#|$)/i.test(String(uri || ''));
}

function extractLatestNpcSpeech(npcs = []) {
  const message = latestAssistantMessage(state.activeChat);
  const content = String(message?.content || '');
  if (!content.trim()) return {};
  const speakerMap = new Map();
  for (const record of npcs) {
    const data = record.data || {};
    const id = sceneVisualRecordId(record, 'npc');
    for (const name of [data.name, data.displayName, data.npcId, ...(Array.isArray(data.aliases) ? data.aliases : [])]) {
      const normalized = normalizeDialogueSpeaker(name);
      if (normalized) speakerMap.set(normalized, id);
    }
  }
  const speech = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:：]{1,40})\s*[:：]\s*(.+?)\s*$/);
    if (!match) continue;
    const speaker = normalizeDialogueSpeaker(match[1]);
    const npcId = speakerMap.get(speaker);
    if (!npcId) continue;
    const text = match[2].trim();
    if (!text) continue;
    speech[npcId] = compactUnique([speech[npcId], text]).join(' / ').slice(0, 180);
  }
  return speech;
}

function normalizeDialogueSpeaker(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[「」『』"'“”]/g, '')
    .trim()
    .toLowerCase();
}

function compactUnique(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function latestAssistantMessage(chat = state.activeChat) {
  const messages = chat?.messages || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index];
  }
  return undefined;
}

function cssUrlEscape(value) {
  return String(value || '').replace(/["\\\n\r]/g, (char) => `\\${char}`);
}

function renderActiveChat() {
  const chat = state.activeChat;
  els.messageList.innerHTML = '';
  if (!chat) {
    resetSceneVisualDisplay();
    els.chatTitle.textContent = '未选择聊天';
    els.chatSubtitle.textContent = '创建或选择一个聊天开始。';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.characters.length === 0
      ? '先创建或导入一个角色卡。'
      : '选择已有聊天，或用右侧表单创建新聊天。';
    els.messageList.append(empty);
    return;
  }

  els.chatTitle.textContent = chat.title || chat.id;
  const characterName = chat.characterCard?.data?.name || findCharacter(chat.characterCardId)?.name || 'Character';
  els.chatSubtitle.textContent = `${characterName} · ${chat.messages?.length || 0} 条消息`;
  renderSceneVisualPanel();

  const messages = chat.messages || [];
  if (messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无消息。';
    els.messageList.append(empty);
  } else {
    for (const message of messages) {
      els.messageList.append(renderMessage(message, characterName));
    }
  }
  if (!state.messageEdit.messageId) {
    requestAnimationFrame(() => {
      els.messageList.scrollTop = els.messageList.scrollHeight;
    });
  }
  ensureSceneVisualForActiveChat();
}

function renderMessage(message, characterName) {
  const isUser = message.role === 'user';
  const isEditing = state.messageEdit.messageId === message.id;
  const row = document.createElement('article');
  row.className = `message ${isUser ? 'user' : 'assistant'}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = initials(message.name || (isUser ? 'User' : characterName));

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const heading = document.createElement('div');
  heading.className = 'message-heading';
  const headingMain = document.createElement('div');
  headingMain.className = 'message-heading-main';
  const name = document.createElement('div');
  name.className = 'message-name';
  name.textContent = message.name || message.role;
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = formatTime(message.createdAt || message.updatedAt || message.timestamp);
  const tools = document.createElement('div');
  tools.className = 'message-tools';
  const editButton = messageToolButton('改', '修改这条消息');
  editButton.disabled = state.busy || isEditing;
  editButton.addEventListener('click', () => startMessageEdit(message));
  const deleteButton = messageToolButton('删', '删除这条消息');
  deleteButton.classList.add('danger');
  deleteButton.disabled = state.busy;
  deleteButton.addEventListener('click', () => deleteMessage(message));
  headingMain.append(name);
  if (meta.textContent) headingMain.append(meta);
  tools.append(editButton, deleteButton);
  heading.append(headingMain, tools);
  if (isEditing) {
    const editor = renderMessageEditor(message);
    bubble.append(heading, editor);
  } else {
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message.content || '';
    bubble.append(heading, content);
  }
  row.append(avatar, bubble);
  queueMicrotask(() => {
    emitFrontendEvent('message:rendered', {
      message,
      messageId: message.id,
      role: message.role,
      name: message.name || message.role,
      element: row
    });
  });
  return row;
}

function renderMessageEditor(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-edit';
  const textarea = document.createElement('textarea');
  textarea.className = 'message-edit-textarea';
  textarea.value = state.messageEdit.content;
  textarea.rows = Math.max(3, Math.min(12, Math.ceil((textarea.value.length || 1) / 42)));
  textarea.addEventListener('input', () => {
    state.messageEdit.content = textarea.value;
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelMessageEdit();
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveMessageEdit(message.id);
    }
  });

  const actions = document.createElement('div');
  actions.className = 'message-edit-actions';
  const saveButton = messageToolButton('保存', '保存修改');
  saveButton.classList.add('primary');
  saveButton.disabled = state.busy;
  saveButton.addEventListener('click', () => saveMessageEdit(message.id));
  const cancelButton = messageToolButton('放弃', '放弃修改');
  cancelButton.disabled = state.busy;
  cancelButton.addEventListener('click', cancelMessageEdit);
  actions.append(saveButton, cancelButton);
  wrapper.append(textarea, actions);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
  return wrapper;
}

function messageToolButton(text, title) {
  const button = document.createElement('button');
  button.className = 'message-tool-button';
  button.type = 'button';
  button.title = title;
  button.textContent = text;
  return button;
}

function emptyMessageEditState() {
  return {
    messageId: '',
    content: ''
  };
}

function startMessageEdit(message) {
  if (state.busy || !message?.id) return;
  state.messageEdit = {
    messageId: message.id,
    content: message.content || ''
  };
  renderActiveChat();
  updateControls();
}

function cancelMessageEdit() {
  state.messageEdit = emptyMessageEditState();
  renderActiveChat();
  updateControls();
}

async function saveMessageEdit(messageId) {
  if (state.busy || !state.activeChatId || state.messageEdit.messageId !== messageId) return;
  const chatId = state.activeChatId;
  const content = state.messageEdit.content;
  setBusy(true);
  try {
    await api(`/v1/app/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/update`, {
      method: 'POST',
      body: {
        content,
        actor: 'user',
        reason: 'web-ui message edit'
      }
    });
    state.messageEdit = emptyMessageEditState();
    await loadChat(chatId);
    await loadChats();
    renderAll();
    showToast('消息已修改');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function deleteMessage(message) {
  if (state.busy || !state.activeChatId || !message?.id) return;
  const label = message.name || (message.role === 'user' ? '用户' : 'AI');
  if (!confirm(`删除这条${label}消息？`)) return;
  const chatId = state.activeChatId;
  setBusy(true);
  try {
    await api(`/v1/app/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(message.id)}`, {
      method: 'DELETE',
      body: {
        actor: 'user',
        reason: 'web-ui message delete'
      }
    });
    if (state.messageEdit.messageId === message.id) {
      state.messageEdit = emptyMessageEditState();
    }
    await loadChat(chatId);
    await loadChats();
    renderAll();
    showToast('消息已删除');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function renderDataCollections(collections) {
  els.dataCollections.innerHTML = '';
  if (collections.length === 0) {
    els.dataCollections.append(infoRow('无集合', '当前聊天还没有可显示的 Chat Data collection。'));
    return;
  }
  for (const collection of collections) {
    const fieldCount = collection.fields?.length || 0;
    const name = collection.name || collection.collection || collection.id || 'collection';
    els.dataCollections.append(infoRow(
      name,
      `${fieldCount} fields · ${collection.schemaFile || 'schema'}`
    ));
  }
}

function renderToolList(tools) {
  els.toolList.innerHTML = '';
  const interesting = tools
    .filter((tool) => tool.id.startsWith('system.context_planner.') || tool.id.startsWith('system.scene_') || tool.id.startsWith('system.quests.') || tool.id.startsWith('system.rag_'))
    .slice(0, 18);
  for (const tool of interesting) {
    els.toolList.append(infoRow(tool.id, tool.description || tool.title || ''));
  }
}

async function openInitialSettingEditor() {
  if (!els.characterSelect.value) {
    showToast('先选择或创建角色');
    return;
  }
  state.initialSetting.open = true;
  els.initialSettingEditor.hidden = false;
  placeInitialSettingEditor();
  await loadInitialSettingEditor();
}

function closeInitialSettingEditor() {
  state.initialSetting.open = false;
  els.initialSettingEditor.hidden = true;
}

async function loadInitialSettingEditor() {
  const characterId = els.characterSelect.value;
  if (!characterId) {
    closeInitialSettingEditor();
    return;
  }
  state.initialSetting.characterId = characterId;
  updateInitialSettingEditorLabels();
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting`);
    setInitialSettingEditorPayload(payload, 'loaded');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function previewInitialSetting() {
  const characterId = selectedInitialSettingCharacterId();
  if (!characterId) return;
  let schema;
  try {
    schema = parseInitialSettingJson();
  } catch (error) {
    showToast(error.message);
    return;
  }
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting/preview`, {
      method: 'POST',
      body: { schema }
    });
    setInitialSettingEditorPayload(payload, 'preview', { keepActiveCollection: true });
    showToast('初始设定预览完成');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function saveInitialSetting({ quiet = false } = {}) {
  const characterId = selectedInitialSettingCharacterId();
  if (!characterId) return undefined;
  let schema;
  try {
    schema = parseInitialSettingJson();
  } catch (error) {
    showToast(error.message);
    return undefined;
  }
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting`, {
      method: 'PUT',
      body: { schema }
    });
    setInitialSettingEditorPayload(payload, 'saved', { keepActiveCollection: true });
    if (!quiet) showToast('初始设定已保存');
    return payload;
  } catch (error) {
    showToast(error.message || String(error));
    return undefined;
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function applyInitialSettingToActiveChat() {
  if (!state.activeChatId) {
    showToast('先选择一个聊天');
    return;
  }
  const saved = await saveInitialSetting({ quiet: true });
  if (!saved) return;
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(`/v1/app/chats/${encodeURIComponent(state.activeChatId)}/initial-setting/apply`, {
      method: 'POST',
      body: { mode: 'merge' }
    });
    renderInitialSettingStats(payload.stats);
    updateInitialSettingLocations(payload.locations);
    renderInitialSettingOutput(payload, 'applied');
    await loadChatData();
    showToast('已应用到当前聊天');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function applyInitialSettingToAllChats() {
  const characterId = selectedInitialSettingCharacterId();
  if (!characterId) return;
  const saved = await saveInitialSetting({ quiet: true });
  if (!saved) return;
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting/apply`, {
      method: 'POST',
      body: { mode: 'merge' }
    });
    renderInitialSettingOutput(payload, 'appliedAll');
    if (state.activeChatId) await loadChatData();
    showToast(`已应用到 ${payload.count || 0} 个聊天`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function exportCurrentInitialSetting() {
  const characterId = selectedInitialSettingCharacterId();
  if (!characterId) return;
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting/export`);
    const characterName = payload.character?.name || findCharacter(characterId)?.name || characterId;
    downloadJson(`${safeFileName(characterName)}.initial-setting.json`, payload);
    renderInitialSettingOutput(payload, 'exported');
    showToast('当前初始设定已导出');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function exportAllInitialSettings() {
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api('/v1/app/initial-settings/export?includeChats=true');
    downloadJson('initial-settings.bundle.json', payload);
    renderInitialSettingOutput(payload, 'exportedAll');
    showToast(`已导出 ${payload.count || 0} 个初始设定`);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function deleteCurrentInitialSetting() {
  const characterId = selectedInitialSettingCharacterId();
  if (!characterId) return;
  const character = findCharacter(characterId);
  const name = character?.name || characterId;
  if (!confirm(`删除「${name}」的初始设定？已应用到聊天里的运行时数据会保留。`)) return;

  setInitialSettingEditorBusy(true);
  try {
    const deleted = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting`, {
      method: 'DELETE'
    });
    const fresh = await api(`/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting`);
    setInitialSettingEditorPayload(fresh, 'loaded');
    renderInitialSettingOutput(deleted, 'deleted');
    if (state.activeChatId) await loadChatData();
    showToast(deleted.deleted ? '初始设定已删除' : '没有可删除的初始设定');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

function selectedInitialSettingCharacterId() {
  const characterId = state.initialSetting.characterId || els.characterSelect.value;
  if (!characterId) showToast('先选择或创建角色');
  return characterId;
}

function parseInitialSettingJson() {
  try {
    const parsed = JSON.parse(els.initialSettingJson.value.trim() || '{}');
    return normalizeInitialSettingDraft(parsed.initialSetting || parsed.schema || parsed);
  } catch {
    throw new Error('初始设定 JSON 格式无效');
  }
}

function applyInitialSettingJson() {
  let schema;
  try {
    schema = parseInitialSettingJson();
  } catch (error) {
    showToast(error.message);
    return;
  }
  state.initialSetting.draft = schema;
  clampInitialSettingActiveCollection();
  renderInitialSettingStats(summarizeInitialSettingDraft(schema));
  renderInitialSettingStorage(state.initialSetting.payload?.locations);
  renderInitialSettingCollections();
  showToast('已按 JSON 更新分组编辑区');
}

function setInitialSettingEditorPayload(payload = {}, mode = 'loaded', { keepActiveCollection = false } = {}) {
  const previousName = keepActiveCollection
    ? state.initialSetting.draft.collections?.[state.initialSetting.activeCollectionIndex]?.name
    : undefined;
  state.initialSetting.payload = payload;
  state.initialSetting.draft = normalizeInitialSettingDraft(payload.initialSetting || emptyInitialSetting());

  if (previousName) {
    const nextIndex = state.initialSetting.draft.collections.findIndex((collection) => collection.name === previousName);
    state.initialSetting.activeCollectionIndex = nextIndex >= 0 ? nextIndex : state.initialSetting.activeCollectionIndex;
  } else {
    state.initialSetting.activeCollectionIndex = 0;
  }

  clampInitialSettingActiveCollection();
  syncInitialSettingJson();
  renderInitialSettingStats(payload.stats || summarizeInitialSettingDraft(state.initialSetting.draft));
  renderInitialSettingStorage(payload.locations);
  renderInitialSettingCollections();
  renderInitialSettingOutput(payload, mode);
}

function updateInitialSettingLocations(locations) {
  if (!locations) return;
  state.initialSetting.payload = {
    ...(state.initialSetting.payload || {}),
    locations
  };
  renderInitialSettingStorage(locations);
  renderInitialSettingCollections();
}

function renderInitialSettingStats(stats = {}) {
  els.initialSettingStats.innerHTML = '';
  els.initialSettingStats.append(
    metric(`collections ${stats.collectionCount || 0}`),
    metric(`fields ${stats.fieldCount || 0}`),
    metric(`records ${stats.seedRecordCount || 0}`)
  );
}

function renderInitialSettingOutput(payload = {}, mode = 'loaded') {
  const labels = {
    loaded: 'loaded',
    preview: 'preview',
    saved: 'saved',
    applied: 'applied',
    appliedAll: 'applied all',
    exported: 'exported',
    exportedAll: 'exported all',
    deleted: 'deleted',
    fieldUpdated: 'field updated',
    fieldDeleted: 'field deleted'
  };
  const summary = {
    status: labels[mode] || mode,
    stats: payload.stats,
    diff: payload.diff,
    applied: payload.applied,
    count: payload.count,
    deleted: payload.deleted,
    fieldOperation: payload.fieldOperation ? {
      type: payload.fieldOperation.type,
      collection: payload.fieldOperation.collection,
      from: payload.fieldOperation.from,
      to: payload.fieldOperation.to,
      field: payload.fieldOperation.field,
      deleted: payload.fieldOperation.deleted,
      syncedChats: payload.fieldOperation.syncedChats?.length || 0
    } : undefined,
    previous: payload.previous ? {
      stats: payload.previous.stats,
      character: payload.previous.character
    } : undefined,
    storage: payload.locations ? {
      canonical: summarizeLocation(payload.locations.characterSchema),
      collections: payload.locations.collections?.map((collection) => ({
        name: collection.name,
        jsonPath: collection.characterSchema?.jsonPath,
        targets: collection.chatTargets?.length || 0
      }))
    } : undefined,
    dataDatabase: payload.dataDatabase ? {
      chatSessionId: payload.dataDatabase.chatSessionId,
      updatedAt: payload.dataDatabase.updatedAt
    } : undefined
  };
  els.initialSettingOutput.textContent = JSON.stringify(removeUndefined(summary), null, 2);
}

function renderInitialSettingStorage(locations = {}) {
  els.initialSettingStorage.innerHTML = '';
  const characterSchema = locations.characterSchema;
  if (characterSchema) {
    els.initialSettingStorage.append(infoRow(
      '保存位置',
      `${formatStorageLocation(characterSchema)} · ${characterSchema.jsonPath || '$'}`
    ));
  } else {
    els.initialSettingStorage.append(infoRow('保存位置', '尚未从后端取得位置元数据。'));
  }

  const targets = locations.chatTargets || [];
  const readyCount = targets.filter((target) => target.databasePath).length;
  els.initialSettingStorage.append(infoRow(
    '应用目标',
    `${readyCount}/${targets.length} 个聊天已有数据文件；保存只改角色级 schema，应用后才改聊天数据。`
  ));
}

function renderInitialSettingCollections() {
  renderInitialSettingCollectionList();
  renderInitialSettingCollectionEditor();
}

function renderInitialSettingCollectionList() {
  const draft = state.initialSetting.draft || emptyInitialSetting();
  els.initialSettingCollectionList.innerHTML = '';
  if (draft.collections.length === 0) {
    els.initialSettingCollectionList.append(infoRow('无 schema', '点击 + 新增 collection。'));
    return;
  }

  draft.collections.forEach((collection, index) => {
    const button = document.createElement('button');
    button.className = 'schema-list-item';
    button.type = 'button';
    button.dataset.index = String(index);
    button.classList.toggle('active', index === state.initialSetting.activeCollectionIndex);
    button.append(
      textSpan(collection.name || `collection_${index + 1}`, 'schema-list-name'),
      textSpan(`${collection.fields?.length || 0} fields · ${collection.seedRecords?.length || 0} records`, 'schema-list-meta')
    );
    button.addEventListener('click', () => {
      state.initialSetting.activeCollectionIndex = index;
      renderInitialSettingCollections();
    });
    els.initialSettingCollectionList.append(button);
  });
}

function renderInitialSettingCollectionEditor() {
  const draft = state.initialSetting.draft || emptyInitialSetting();
  const collection = draft.collections[state.initialSetting.activeCollectionIndex];
  els.initialSettingCollectionEditor.innerHTML = '';

  if (!collection) {
    const empty = document.createElement('div');
    empty.className = 'schema-empty-state';
    const addButton = document.createElement('button');
    addButton.className = 'primary-button';
    addButton.type = 'button';
    addButton.textContent = '新增 collection';
    addButton.addEventListener('click', addInitialSettingCollection);
    empty.append(infoRow('还没有 collection', '初始设定会按 collection 拆分写入聊天数据表。'), addButton);
    els.initialSettingCollectionEditor.append(empty);
    return;
  }

  const location = findInitialSettingCollectionLocation(collection, state.initialSetting.activeCollectionIndex);
  const header = document.createElement('div');
  header.className = 'schema-detail-header';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = collection.name || '';
  nameInput.placeholder = 'collection_name';
  nameInput.addEventListener('input', () => {
    collection.name = nameInput.value;
    commitInitialSettingDraft({ renderList: true });
  });

  const descriptionInput = document.createElement('textarea');
  descriptionInput.rows = 2;
  descriptionInput.value = collection.description || '';
  descriptionInput.placeholder = 'collection 描述';
  descriptionInput.addEventListener('input', () => {
    collection.description = descriptionInput.value;
    commitInitialSettingDraft();
  });

  const deleteButton = document.createElement('button');
  deleteButton.className = 'secondary-button danger-button';
  deleteButton.type = 'button';
  deleteButton.textContent = '删除 collection';
  deleteButton.addEventListener('click', () => deleteInitialSettingCollection(state.initialSetting.activeCollectionIndex));

  header.append(
    labelledControl('Collection', nameInput),
    labelledControl('描述', descriptionInput),
    deleteButton
  );

  els.initialSettingCollectionEditor.append(
    header,
    renderInitialSettingCollectionLocation(location),
    renderInitialSettingFields(collection),
    renderInitialSettingSeedRecords(collection)
  );
}

function renderInitialSettingCollectionLocation(location) {
  const panel = document.createElement('div');
  panel.className = 'location-panel';
  panel.append(sectionLabel('修改位置'));

  if (!location) {
    panel.append(infoRow('角色级 schema', '保存后写入角色绑定的数据 schema。'));
    return panel;
  }

  panel.append(infoRow(
    '角色级 schema',
    `${formatStorageLocation(location.characterSchema)} · ${location.characterSchema?.jsonPath || '$'}`
  ));

  const activeTarget = location.chatTargets?.find((target) => target.active) || location.chatTargets?.[0];
  if (activeTarget) {
    panel.append(infoRow(
      activeTarget.active ? '当前聊天落点' : '聊天落点示例',
      [
        activeTarget.databasePath ? `db ${activeTarget.databasePath}` : 'db 应用时创建',
        `table ${activeTarget.table}`,
        activeTarget.schemaFile ? `schema ${activeTarget.schemaFile}` : 'schema file 应用时创建'
      ].join(' · ')
    ));
  }

  return panel;
}

function renderInitialSettingFields(collection) {
  const section = document.createElement('section');
  section.className = 'schema-section';
  const addButton = document.createElement('button');
  addButton.className = 'secondary-button';
  addButton.type = 'button';
  addButton.textContent = '新增字段';
  addButton.addEventListener('click', () => addInitialSettingField(collection));
  section.append(sectionHeading('字段', addButton));

  const grid = document.createElement('div');
  grid.className = 'schema-grid field-grid';
  grid.append(gridHeader(['name', 'type', 'required', 'default', 'description', '操作']));

  if ((collection.fields || []).length === 0) {
    grid.append(emptyGridRow('还没有字段。'));
  } else {
    collection.fields.forEach((field, index) => {
      grid.append(renderInitialSettingFieldRow(collection, field, index));
    });
  }

  section.append(grid);
  return section;
}

function renderInitialSettingFieldRow(collection, field, index) {
  const row = document.createElement('div');
  row.className = 'schema-grid-row';
  const savedField = findSavedInitialSettingField(collection, state.initialSetting.activeCollectionIndex, index);

  const nameInput = compactInput(field.name || '', 'field_name');
  nameInput.addEventListener('input', () => {
    field.name = nameInput.value;
    commitInitialSettingDraft();
    renderInitialSettingCollectionList();
  });

  const typeSelect = document.createElement('select');
  const currentType = field.type || 'text';
  const fieldTypes = INITIAL_SETTING_FIELD_TYPES.includes(currentType)
    ? INITIAL_SETTING_FIELD_TYPES
    : [currentType, ...INITIAL_SETTING_FIELD_TYPES];
  for (const type of fieldTypes) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    option.selected = currentType === type;
    typeSelect.append(option);
  }
  typeSelect.addEventListener('change', () => {
    field.type = typeSelect.value;
    commitInitialSettingDraft();
    renderInitialSettingCollectionEditor();
  });

  const requiredInput = document.createElement('input');
  requiredInput.type = 'checkbox';
  requiredInput.checked = Boolean(field.required);
  requiredInput.addEventListener('change', () => {
    field.required = requiredInput.checked;
    commitInitialSettingDraft();
  });

  const defaultInput = compactInput(formatEditableValue(field.defaultValue, field.type), '空值不设置');
  defaultInput.addEventListener('change', () => {
    try {
      const value = parseEditableValue(defaultInput.value, field.type);
      if (value === undefined) {
        delete field.defaultValue;
      } else {
        field.defaultValue = value;
      }
      commitInitialSettingDraft();
    } catch (error) {
      showToast(error.message);
    }
  });

  const descriptionInput = compactInput(field.description || '', '字段说明');
  descriptionInput.addEventListener('input', () => {
    field.description = descriptionInput.value;
    commitInitialSettingDraft();
  });

  const actions = document.createElement('div');
  actions.className = 'field-actions';

  const updateButton = document.createElement('button');
  updateButton.className = 'small-button';
  updateButton.type = 'button';
  updateButton.textContent = savedField ? (savedField.name === field.name ? '更新' : '改名') : '保存';
  updateButton.title = savedField ? '保存字段变更' : '先保存到初始设定';
  updateButton.addEventListener('click', () => saveInitialSettingField(collection, field, index, savedField));

  const deleteButton = iconTextButton('×', '删除字段');
  deleteButton.classList.add('danger-icon-button');
  deleteButton.addEventListener('click', () => {
    deleteInitialSettingField(collection, field, index, savedField);
  });
  actions.append(updateButton, deleteButton);

  row.append(nameInput, typeSelect, checkboxCell(requiredInput), defaultInput, descriptionInput, actions);
  return row;
}

function renderInitialSettingSeedRecords(collection) {
  const section = document.createElement('section');
  section.className = 'schema-section';
  const addButton = document.createElement('button');
  addButton.className = 'secondary-button';
  addButton.type = 'button';
  addButton.textContent = '新增记录';
  addButton.addEventListener('click', () => addInitialSettingSeedRecord(collection));
  section.append(sectionHeading('初始记录', addButton));

  const fields = collection.fields || [];
  const grid = document.createElement('div');
  grid.className = 'schema-grid record-grid';
  grid.style.setProperty('--record-columns', String(Math.max(1, fields.length)));
  grid.append(gridHeader(['id', ...fields.map((field) => field.name || 'field'), '']));

  if ((collection.seedRecords || []).length === 0) {
    grid.append(emptyGridRow('还没有初始记录。'));
  } else {
    collection.seedRecords.forEach((record, recordIndex) => {
      grid.append(renderInitialSettingSeedRecordRow(collection, record, recordIndex));
    });
  }

  section.append(grid);
  return section;
}

function renderInitialSettingSeedRecordRow(collection, record, recordIndex) {
  const row = document.createElement('div');
  row.className = 'schema-grid-row seed-record-row';
  row.style.setProperty('--record-columns', String(Math.max(1, collection.fields.length)));

  const idInput = compactInput(record.id || '', 'record_id');
  idInput.addEventListener('input', () => {
    record.id = idInput.value;
    commitInitialSettingDraft();
  });
  row.append(idInput);

  for (const field of collection.fields || []) {
    row.append(createSeedValueControl(field, record));
  }

  const deleteButton = iconTextButton('×', '删除记录');
  deleteButton.addEventListener('click', () => {
    collection.seedRecords.splice(recordIndex, 1);
    commitInitialSettingDraft();
    renderInitialSettingCollections();
  });
  row.append(deleteButton);

  return row;
}

function createSeedValueControl(field, record) {
  if ((field.type || 'text') === 'boolean') {
    const select = document.createElement('select');
    for (const [value, label] of [['', ''], ['true', 'true'], ['false', 'false']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = formatEditableValue(record[field.name], field.type) === value;
      select.append(option);
    }
    select.addEventListener('change', () => {
      updateSeedRecordValue(record, field, select.value);
    });
    return select;
  }

  const input = (field.type || 'text') === 'json'
    ? document.createElement('textarea')
    : document.createElement('input');
  if (input.tagName === 'TEXTAREA') {
    input.rows = 2;
    input.className = 'inline-json-input';
  } else {
    input.type = 'text';
  }
  input.value = formatEditableValue(record[field.name], field.type);
  input.placeholder = field.required ? 'required' : '';
  input.addEventListener('change', () => {
    updateSeedRecordValue(record, field, input.value);
  });
  return input;
}

function updateSeedRecordValue(record, field, rawValue) {
  try {
    const value = parseEditableValue(rawValue, field.type);
    if (value === undefined) {
      delete record[field.name];
    } else {
      record[field.name] = value;
    }
    commitInitialSettingDraft();
  } catch (error) {
    showToast(error.message);
  }
}

async function saveInitialSettingField(collection, field, fieldIndex, savedField) {
  const characterId = selectedInitialSettingCharacterId();
  if (!characterId) return;

  if (!field.name) {
    showToast('字段名不能为空');
    return;
  }

  const savedName = savedField?.name;
  if (!savedName) {
    const payload = await saveInitialSetting({ quiet: true });
    if (payload) showToast('字段已保存');
    return;
  }

  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(initialSettingFieldPath(characterId, collection.name, savedName), {
      method: 'PATCH',
      body: {
        field: initialSettingFieldPayload(field),
        syncExisting: shouldSyncInitialSettingFields()
      }
    });
    setInitialSettingEditorPayload(payload, 'fieldUpdated', { keepActiveCollection: true });
    if (state.activeChatId && shouldSyncInitialSettingFields()) await loadChatData();
    showToast(payload.fieldOperation?.type === 'rename' ? '字段已改名' : '字段已更新');
  } catch (error) {
    showToast(error.message || String(error));
    renderInitialSettingCollections();
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

async function deleteInitialSettingField(collection, field, fieldIndex, savedField) {
  const savedName = savedField?.name;
  const label = savedName || field.name || `field ${fieldIndex + 1}`;
  if (!confirm(`删除字段「${label}」？同步已有聊天数据时会移除聊天数据库里的同名字段。`)) return;

  if (!savedName) {
    removeInitialSettingFieldLocally(collection, fieldIndex, field.name);
    showToast('字段已从草稿删除');
    return;
  }

  const characterId = selectedInitialSettingCharacterId();
  if (!characterId) return;
  setInitialSettingEditorBusy(true);
  try {
    const payload = await api(`${initialSettingFieldPath(characterId, collection.name, savedName)}?syncExisting=${shouldSyncInitialSettingFields()}`, {
      method: 'DELETE'
    });
    setInitialSettingEditorPayload(payload, 'fieldDeleted', { keepActiveCollection: true });
    if (state.activeChatId && shouldSyncInitialSettingFields()) await loadChatData();
    showToast(payload.fieldOperation?.deleted ? '字段已删除' : '字段不存在');
  } catch (error) {
    showToast(error.message || String(error));
    renderInitialSettingCollections();
  } finally {
    setInitialSettingEditorBusy(false);
  }
}

function removeInitialSettingFieldLocally(collection, fieldIndex, fieldName) {
  collection.fields.splice(fieldIndex, 1);
  for (const record of collection.seedRecords || []) {
    if (fieldName) delete record[fieldName];
  }
  commitInitialSettingDraft();
  renderInitialSettingCollections();
}

function addInitialSettingCollection() {
  const draft = state.initialSetting.draft || emptyInitialSetting();
  const name = uniqueName('collection', draft.collections.map((collection) => collection.name));
  draft.collections.push({
    name,
    description: '',
    fields: [],
    seedRecords: []
  });
  state.initialSetting.draft = draft;
  state.initialSetting.activeCollectionIndex = draft.collections.length - 1;
  commitInitialSettingDraft();
  renderInitialSettingCollections();
}

function deleteInitialSettingCollection(index) {
  const draft = state.initialSetting.draft || emptyInitialSetting();
  draft.collections.splice(index, 1);
  state.initialSetting.activeCollectionIndex = Math.max(0, index - 1);
  commitInitialSettingDraft();
  renderInitialSettingCollections();
}

function addInitialSettingField(collection) {
  collection.fields ||= [];
  collection.fields.push({
    name: uniqueName('field', collection.fields.map((field) => field.name)),
    type: 'text',
    required: false,
    description: ''
  });
  commitInitialSettingDraft();
  renderInitialSettingCollections();
}

function addInitialSettingSeedRecord(collection) {
  collection.seedRecords ||= [];
  collection.seedRecords.push({
    id: uniqueName('record', collection.seedRecords.map((record) => record.id))
  });
  commitInitialSettingDraft();
  renderInitialSettingCollections();
}

function commitInitialSettingDraft({ renderList = false } = {}) {
  clampInitialSettingActiveCollection();
  syncInitialSettingJson();
  renderInitialSettingStats(summarizeInitialSettingDraft(state.initialSetting.draft));
  if (renderList) renderInitialSettingCollectionList();
}

function syncInitialSettingJson() {
  els.initialSettingJson.value = JSON.stringify(state.initialSetting.draft || emptyInitialSetting(), null, 2);
}

function clampInitialSettingActiveCollection() {
  const count = state.initialSetting.draft?.collections?.length || 0;
  if (count === 0) {
    state.initialSetting.activeCollectionIndex = 0;
    return;
  }
  state.initialSetting.activeCollectionIndex = Math.min(
    Math.max(0, state.initialSetting.activeCollectionIndex || 0),
    count - 1
  );
}

function normalizeInitialSettingDraft(input = {}) {
  const source = Array.isArray(input) ? { collections: input } : (input || {});
  const rawCollections = Array.isArray(source.collections)
    ? source.collections
    : Object.entries(source.collections || {}).map(([name, collection]) => (
      collection && typeof collection === 'object'
        ? { ...collection, name }
        : { name, fields: [] }
    ));
  return {
    version: String(source.version || '1'),
    description: source.description || '',
    collections: rawCollections.map((collection = {}) => ({
      name: collection.name || collection.collection || '',
      description: collection.description || '',
      fields: normalizeInitialSettingFields(collection.fields),
      seedRecords: Array.isArray(collection.seedRecords)
        ? collection.seedRecords.map((record) => ({ ...(record || {}) }))
        : (Array.isArray(collection.records) ? collection.records.map((record) => ({ ...(record || {}) })) : [])
    }))
  };
}

function normalizeInitialSettingFields(fields) {
  const rawFields = Array.isArray(fields)
    ? fields
    : Object.entries(fields || {}).map(([name, field]) => (
      field && typeof field === 'object'
        ? { ...field, name }
        : { name, type: String(field || 'text') }
    ));
  return rawFields.map((field) => {
    if (typeof field === 'string') {
      return {
        name: field,
        type: 'text',
        required: false,
        description: ''
      };
    }
    return {
      name: field?.name || '',
      type: INITIAL_SETTING_FIELD_TYPES.includes(field?.type) ? field.type : (field?.type || 'text'),
      required: Boolean(field?.required),
      description: field?.description || '',
      ...(Object.hasOwn(field || {}, 'defaultValue') ? { defaultValue: field.defaultValue } : {})
    };
  });
}

function summarizeInitialSettingDraft(schema = {}) {
  const draft = normalizeInitialSettingDraft(schema);
  const collections = draft.collections.map((collection) => ({
    name: collection.name,
    fieldCount: collection.fields.length,
    requiredFieldCount: collection.fields.filter((field) => field.required).length,
    seedRecordCount: collection.seedRecords.length
  }));
  return {
    collectionCount: collections.length,
    fieldCount: collections.reduce((total, collection) => total + collection.fieldCount, 0),
    requiredFieldCount: collections.reduce((total, collection) => total + collection.requiredFieldCount, 0),
    seedRecordCount: collections.reduce((total, collection) => total + collection.seedRecordCount, 0),
    collections
  };
}

function findInitialSettingCollectionLocation(collection, index) {
  const payloadLocations = state.initialSetting.payload?.locations;
  const locations = payloadLocations?.collections || [];
  const matched = locations.find((candidate) => candidate.name === collection.name)
    || locations.find((candidate) => candidate.index === index);
  if (matched || !payloadLocations?.characterSchema) return matched;
  return {
    name: collection.name,
    index,
    characterSchema: {
      ...payloadLocations.characterSchema,
      jsonPath: `$.collections[${index}]`
    },
    chatTargets: (payloadLocations.chatTargets || []).map((target) => ({
      ...target,
      table: collection.name,
      schemaFile: target.schemaDirectory
        ? `${target.schemaDirectory}/${collection.name}.schema.json`
        : undefined,
      seedRecordIds: (collection.seedRecords || []).map((record) => record.id)
    }))
  };
}

function findSavedInitialSettingCollection(collection, index) {
  const collections = state.initialSetting.payload?.initialSetting?.collections || [];
  return collections.find((candidate) => candidate.name === collection.name)
    || collections[index];
}

function findSavedInitialSettingField(collection, collectionIndex, fieldIndex) {
  const savedCollection = findSavedInitialSettingCollection(collection, collectionIndex);
  return savedCollection?.fields?.[fieldIndex];
}

function initialSettingFieldPayload(field = {}) {
  return removeUndefined({
    name: field.name,
    type: field.type || 'text',
    description: field.description || '',
    required: Boolean(field.required),
    defaultValue: Object.hasOwn(field, 'defaultValue') ? field.defaultValue : undefined
  });
}

function initialSettingFieldPath(characterId, collection, field) {
  return `/v1/app/characters/${encodeURIComponent(characterId)}/initial-setting/collections/${encodeURIComponent(collection)}/fields/${encodeURIComponent(field)}`;
}

function shouldSyncInitialSettingFields() {
  return els.initialSettingSyncExistingFields?.checked !== false;
}

function formatStorageLocation(location = {}) {
  return [
    location.databasePath ? `db ${location.databasePath}` : undefined,
    location.table ? `table ${location.table}` : undefined,
    location.column ? `column ${location.column}` : undefined
  ].filter(Boolean).join(' · ') || '未记录';
}

function summarizeLocation(location = {}) {
  return removeUndefined({
    databasePath: location.databasePath,
    table: location.table,
    column: location.column,
    jsonPath: location.jsonPath
  });
}

function labelledControl(label, control) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field-label inline-field-label';
  wrapper.append(document.createTextNode(label), control);
  return wrapper;
}

function sectionHeading(title, action) {
  const heading = document.createElement('div');
  heading.className = 'schema-section-heading';
  const label = sectionLabel(title);
  heading.append(label);
  if (action) heading.append(action);
  return heading;
}

function sectionLabel(text) {
  const label = document.createElement('h3');
  label.textContent = text;
  return label;
}

function gridHeader(labels) {
  const row = document.createElement('div');
  row.className = 'schema-grid-row schema-grid-header';
  row.style.setProperty('--record-columns', String(Math.max(1, labels.length - 2)));
  for (const label of labels) {
    const cell = document.createElement('span');
    cell.textContent = label;
    row.append(cell);
  }
  return row;
}

function emptyGridRow(message) {
  const row = document.createElement('div');
  row.className = 'schema-grid-empty';
  row.textContent = message;
  return row;
}

function compactInput(value = '', placeholder = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function checkboxCell(input) {
  const wrapper = document.createElement('span');
  wrapper.className = 'checkbox-cell';
  wrapper.append(input);
  return wrapper;
}

function iconTextButton(text, title) {
  const button = document.createElement('button');
  button.className = 'icon-button';
  button.type = 'button';
  button.title = title;
  button.textContent = text;
  return button;
}

function textSpan(text, className) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function uniqueName(base, existing = []) {
  const names = new Set(existing.filter(Boolean));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function formatEditableValue(value, type = 'text') {
  if (value === undefined || value === null) return '';
  if (type === 'json') return JSON.stringify(value);
  if (type === 'boolean') return value === true ? 'true' : (value === false ? 'false' : '');
  return String(value);
}

function parseEditableValue(rawValue, type = 'text') {
  const text = String(rawValue ?? '');
  if (text.trim() === '') return undefined;
  switch (type) {
    case 'integer': {
      const value = Number(text);
      if (!Number.isInteger(value)) throw new Error('整数类型必须输入整数');
      return value;
    }
    case 'number': {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error('数字类型必须输入数字');
      return value;
    }
    case 'boolean':
      if (text === 'true') return true;
      if (text === 'false') return false;
      throw new Error('布尔类型必须是 true 或 false');
    case 'json':
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('JSON 字段格式无效');
      }
    case 'text':
    default:
      return text;
  }
}

function updateInitialSettingEditorLabels() {
  const character = findCharacter(state.initialSetting.characterId || els.characterSelect.value);
  els.initialSettingCharacterName.textContent = character?.name || '未选择角色';
}

function setInitialSettingEditorBusy(busy) {
  for (const button of [
    els.initialSettingReloadButton,
    els.initialSettingAddCollectionButton,
    els.initialSettingPreviewButton,
    els.initialSettingSaveButton,
    els.initialSettingExportButton,
    els.initialSettingExportAllButton,
    els.initialSettingApplyChatButton,
    els.initialSettingApplyAllButton,
    els.initialSettingDeleteButton
  ]) {
    button.disabled = busy || !els.characterSelect.value;
  }
}

function emptyInitialSetting() {
  return {
    version: '1',
    description: '',
    collections: []
  };
}

async function createSampleCharacter() {
  setBusy(true);
  try {
    const payload = await api('/v1/app/characters/import', {
      method: 'POST',
      body: { characterCard: SAMPLE_CHARACTER }
    });
    if (payload.character?.id) {
      state.characterDetails[payload.character.id] = payload.character;
    }
    await loadCharacters();
    renderCharacters();
    if (payload.character?.id) {
      els.characterSelect.value = payload.character.id;
    }
    renderAll();
    showToast('示例角色已创建');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function importCharacter() {
  const characterPath = els.characterJsonPath.value.trim();
  const sidecarPath = els.characterResourcesJsonPath.value.trim();
  const text = els.characterJson.value.trim();
  if (!text && !characterPath) {
    showToast('请输入角色卡 JSON 或文件路径');
    return;
  }
  setBusy(true);
  try {
    let body;
    if (characterPath) {
      body = { characterCardPath: characterPath };
      if (sidecarPath) {
        body.sidecarPath = sidecarPath;
      } else {
        const sidecar = parseOptionalJson(els.characterResourcesJson.value, '角色资源 sidecar');
        if (sidecar) body.sidecar = sidecar;
      }
    } else {
      const parsed = JSON.parse(text);
      if (parsed.format === 'ai-dnd-character-resources-v1') {
        throw new Error('上方需要放角色卡 JSON，资源 sidecar 请放在下方');
      }
      const sidecar = sidecarPath
        ? undefined
        : parseOptionalJson(els.characterResourcesJson.value, '角色资源 sidecar');
      body = parsed.format === 'ai-dnd-character-bundle-v1' || parsed.characterCard
        ? { ...parsed, sidecar: sidecar || parsed.sidecar }
        : { characterCard: parsed, sidecar };
      if (sidecarPath) body.sidecarPath = sidecarPath;
    }
    const payload = await api('/v1/app/characters/import', {
      method: 'POST',
      body
    });
    if (payload.character?.id) {
      state.characterDetails[payload.character.id] = payload.character;
    }
    els.importDialog.close();
    await loadCharacters();
    renderCharacters();
    if (payload.character?.id) {
      els.characterSelect.value = payload.character.id;
    }
    renderAll();
    showToast('角色已导入');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function importChat() {
  const chatPath = els.chatJsonPath.value.trim();
  const sidecarPath = els.chatResourcesJsonPath.value.trim();
  const text = els.chatJson.value.trim();
  if (!text && !chatPath) {
    showToast('请输入聊天 JSON 或文件路径');
    return;
  }
  let importedChatId = '';
  setBusy(true);
  try {
    let body;
    if (chatPath) {
      body = { chatPath };
      if (sidecarPath) {
        body.sidecarPath = sidecarPath;
      } else {
        const sidecar = parseOptionalJson(els.chatResourcesJson.value, '聊天资源 sidecar');
        if (sidecar) body.sidecar = sidecar;
      }
    } else {
      const parsed = JSON.parse(text);
      if (parsed.format === 'ai-dnd-chat-resources-v1') {
        throw new Error('上方需要放聊天 JSON，资源 sidecar 请放在下方');
      }
      const sidecar = sidecarPath
        ? undefined
        : parseOptionalJson(els.chatResourcesJson.value, '聊天资源 sidecar');
      body = sidecar && parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...parsed, sidecar }
        : sidecar
          ? { chat: parsed, sidecar }
          : parsed;
      if (sidecarPath) body.sidecarPath = sidecarPath;
    }
    const payload = await api('/v1/app/chats/import', {
      method: 'POST',
      body
    });
    els.chatImportDialog.close();
    await loadCharacters();
    await loadChats();
    if (payload.chat?.id) {
      importedChatId = payload.chat.id;
      await loadChat(payload.chat.id);
    }
    renderAll();
    showToast('聊天已导入');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
  if (importedChatId) {
    await maybeOpenNpcSettingOnboarding({ chatId: importedChatId, force: true });
  }
}

async function createChat() {
  const characterCardId = els.characterSelect.value;
  if (!characterCardId) {
    showToast('先选择或创建角色');
    return;
  }
  let createdChatId = '';
  setBusy(true);
  try {
    const title = els.newChatTitle.value.trim() || `${findCharacter(characterCardId)?.name || '新角色'} Chat`;
    const payload = await api('/v1/app/chats', {
      method: 'POST',
      body: {
        characterCardId,
        title,
        userName: 'Player',
        includeGreeting: true
      }
    });
    createdChatId = payload.session.id;
    state.activeChat = payload.session;
    state.activeChatId = payload.session.id;
    localStorage.setItem('ai-dnd-active-chat', state.activeChatId);
    els.newChatTitle.value = '';
    await loadChats();
    await loadChat(createdChatId);
    renderAll();
    showToast('聊天已创建');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
  if (createdChatId) {
    await maybeOpenNpcSettingOnboarding({ chatId: createdChatId, force: true });
  }
}

async function saveChatRename(chatId) {
  if (state.busy || state.chatRename.chatId !== chatId) return;
  const title = state.chatRename.title.trim();
  if (!title) {
    showToast('聊天标题不能为空');
    return;
  }

  setBusy(true);
  try {
    const payload = await api(`/v1/app/chats/${encodeURIComponent(chatId)}/update`, {
      method: 'POST',
      body: { title }
    });
    state.chatRename = emptyChatRenameState();
    if (state.activeChatId === chatId) {
      state.activeChat = payload.chat;
    }
    await loadChats();
    if (state.activeChatId === chatId) {
      await loadChat(chatId);
    }
    renderAll();
    showToast('聊天已改名');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function sendMessage() {
  if (state.busy || !state.activeChatId) return;
  if (state.adjudicationOverlay.current) {
    showToast('请先接受当前裁决，或在裁决弹窗里申请重新裁决。');
    return;
  }
  if (isCombatOverlayLocked()) {
    showToast('战斗还没有结束，不能开启下一轮 Agent 循环。');
    return;
  }
  if (state.persuasionOverlay.open) {
    showToast('请先提交或取消当前说服内容。');
    return;
  }
  const content = els.messageInput.value.trim();
  if (!content) return;

  setBusy(true);
  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';
  try {
    clearRouterReviewItems({ startedAt: Date.now() - 250 });
    clearSettlementNotices({ startedAt: Date.now() - 250 });
    openAgentProgressStream(state.activeChatId);
    showAgentProgress('正在排队进入 Agent 循环...', { status: 'running' });
    const payload = await api(`/v1/app/chats/${encodeURIComponent(state.activeChatId)}/send`, {
      method: 'POST',
      body: {
        content,
        options: buildChatRequestOptions()
      }
    });
    state.activeChat = payload.chat;
    await loadChats();
    renderAll();
  } catch (error) {
    els.messageInput.value = content;
    showAgentProgress('Agent 循环出了问题', {
      status: 'error',
      detail: error.message || String(error)
    });
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function openAgentProgressStreamFromNow(chatSessionId) {
  if (!chatSessionId) return;
  try {
    const payload = await api(`/v1/agent-progress/events?chatSessionId=${encodeURIComponent(chatSessionId)}`);
    const afterSequence = Math.max(0, ...(payload.events || []).map((event) => Number(event.sequence) || 0));
    openAgentProgressStream(chatSessionId, { afterSequence });
  } catch {
    openAgentProgressStream(chatSessionId);
  }
}

function openAgentProgressStream(chatSessionId, { afterSequence } = {}) {
  if (!chatSessionId) return;
  if (
    state.agentProgress.chatSessionId === chatSessionId
    && (state.agentProgress.eventSource || state.agentProgress.pollTimer)
  ) {
    return;
  }
  closeAgentProgressStream();
  state.agentProgress.chatSessionId = chatSessionId;
  state.agentProgress.lastSequence = Number.isFinite(afterSequence) ? afterSequence : 0;
  startAgentProgressPolling(chatSessionId);
  if (typeof EventSource === 'undefined') return;
  const url = apiUrl(`/v1/agent-progress/stream?chatSessionId=${encodeURIComponent(chatSessionId)}${Number.isFinite(afterSequence) ? `&afterSequence=${encodeURIComponent(afterSequence)}` : ''}`);
  const source = new EventSource(url);
  state.agentProgress.eventSource = source;
  source.addEventListener('agent-progress', (event) => {
    try {
      const parsed = JSON.parse(event.data);
      state.agentProgress.lastSequence = Math.max(state.agentProgress.lastSequence || 0, Number(parsed.sequence) || 0);
      handleAgentProgressEvent(parsed);
    } catch (error) {
      showAgentProgress('进度事件解析失败', {
        status: 'warning',
        detail: error.message || String(error)
      });
    }
  });
  source.onerror = () => {
    showAgentProgress('进度连接暂时中断', {
      status: 'warning',
      detail: 'Agent 仍可能在后台运行，完成后聊天会刷新。'
    });
  };
}

function ensureAgentProgressStream() {
  if (!state.activeChatId) return;
  if (
    state.agentProgress.chatSessionId === state.activeChatId
    && (state.agentProgress.eventSource || state.agentProgress.pollTimer)
  ) {
    return;
  }
  openAgentProgressStreamFromNow(state.activeChatId);
}

async function pollActiveAgentProgressEvents() {
  const chatSessionId = state.activeChatId;
  if (!chatSessionId) return;
  if (state.agentProgress.chatSessionId && state.agentProgress.chatSessionId !== chatSessionId) {
    closeAgentProgressStream();
  }
  if (!state.agentProgress.chatSessionId) {
    state.agentProgress.chatSessionId = chatSessionId;
    try {
      const payload = await api(`/v1/agent-progress/events?chatSessionId=${encodeURIComponent(chatSessionId)}`);
      state.agentProgress.lastSequence = Math.max(0, ...(payload.events || []).map((event) => Number(event.sequence) || 0));
    } catch {
      state.agentProgress.chatSessionId = '';
    }
    return;
  }
  try {
    const payload = await api(`/v1/agent-progress/events?chatSessionId=${encodeURIComponent(chatSessionId)}&afterSequence=${encodeURIComponent(state.agentProgress.lastSequence || 0)}`);
    for (const event of payload.events || []) {
      state.agentProgress.lastSequence = Math.max(state.agentProgress.lastSequence || 0, Number(event.sequence) || 0);
      handleAgentProgressEvent(event);
    }
  } catch {
    // The SSE path or the next poll can recover; avoid noisy warnings for one missed poll.
  }
}

function startAgentProgressPolling(chatSessionId) {
  const poll = async () => {
    if (state.agentProgress.chatSessionId !== chatSessionId) return;
    try {
      const payload = await api(`/v1/agent-progress/events?chatSessionId=${encodeURIComponent(chatSessionId)}&afterSequence=${encodeURIComponent(state.agentProgress.lastSequence || 0)}`);
      for (const event of payload.events || []) {
        state.agentProgress.lastSequence = Math.max(state.agentProgress.lastSequence || 0, Number(event.sequence) || 0);
        handleAgentProgressEvent(event);
      }
    } catch (error) {
      showAgentProgress('进度连接暂时中断', {
        status: 'warning',
        detail: error.message || String(error)
      });
    }
    if (state.agentProgress.chatSessionId === chatSessionId) {
      state.agentProgress.pollTimer = setTimeout(poll, 900);
    }
  };
  state.agentProgress.pollTimer = setTimeout(poll, 250);
}

function closeAgentProgressStream() {
  if (state.agentProgress.eventSource) {
    state.agentProgress.eventSource.close();
  }
  if (state.agentProgress.pollTimer) {
    clearTimeout(state.agentProgress.pollTimer);
  }
  state.agentProgress.eventSource = undefined;
  state.agentProgress.pollTimer = undefined;
  state.agentProgress.chatSessionId = '';
  state.agentProgress.lastSequence = 0;
}

function handleAgentProgressEvent(event = {}) {
  state.agentProgress.events.push(event);
  state.agentProgress.events = state.agentProgress.events.slice(-30);
  handleCombatProgressEvent(event);
  handlePersuasionProgressEvent(event);
  handleRouterReviewProgressEvent(event);
  finishRouterReviewTurn(event);
  handleSettlementNoticeProgressEvent(event);
  handleDiceRollProgressEvent(event);
  handleAdjudicationProgressEvent(event);
  handleSceneVisualProgressEvent(event);
  if (event.type === 'settlement_changed') return;
  const status = event.status === 'error'
    ? 'error'
    : event.status === 'warning'
      ? 'warning'
      : event.status === 'success' || event.type?.endsWith('_finished')
        ? 'success'
        : 'running';
  if (event.warning?.message) {
    state.agentProgress.lastWarning = event.warning.message;
  }
  const detail = agentProgressDetail(event);
  showAgentProgress(event.progressLabel || fallbackAgentProgressLabel(event), {
    status,
    detail
  });
  if ([
    'assistant_message_committed',
    'turn_finished',
    'flow_finished',
    'rollback_finished',
    'rollback_failed',
    'rollback_unavailable'
  ].includes(event.type)) {
    scheduleAgentProgressHide(event.status === 'error' ? 8000 : 2600);
  }
  if (state.worldDrawerExpanded && state.worldDrawer.activeTab === 'history') {
    renderWorldDrawer();
  }
}

function handleSceneVisualProgressEvent(event = {}) {
  if (!state.activeChatId) return;
  if (event.chatSessionId && event.chatSessionId !== state.activeChatId) return;
  const toolId = String(event.toolId || '');
  const type = String(event.type || '');
  const sceneAffectingTool = [
    'system.scene_npcs.',
    'system.scene_maps.',
    'system.scene_manager.',
    'system.visual.'
  ].some((prefix) => toolId.startsWith(prefix));
  const committedNarrative = type === 'assistant_message_committed'
    || type === 'turn_finished'
    || type === 'flow_finished';
  const settlementChangedScene = type === 'settlement_changed'
    && /(scene|map|npc|visual|asset|background|portrait)/i.test([
      event.collection,
      event.database,
      event.toolId,
      event.category,
      event.title,
      event.detail
    ].filter(Boolean).join(' '));
  if (sceneAffectingTool || committedNarrative || settlementChangedScene) {
    scheduleSceneVisualRefresh({ force: true });
  }
}

function handleRouterReviewProgressEvent(event = {}) {
  if (isStaleRouterReviewEvent(event)) return;
  if (event.type === 'router_plan_updated') {
    addRouterReviewItems(event.routerPlan?.items || [], event);
    return;
  }
  if (event.type === 'router_item_skip_requested') {
    completeRouterReviewItem(event.routerItemId || event.routerItem?.id, 'skipped');
    return;
  }
  if (event.routerItem) {
    addRouterReviewItems([event.routerItem], event);
  }
  const itemId = event.routerItemId || event.routerItem?.id || routerReviewItemIdFromProgress(event);
  if (!itemId) return;
  if (event.status === 'running' || event.type?.endsWith('_started')) {
    updateRouterReviewItemStatus(itemId, 'running');
    return;
  }
  if (event.status === 'skipped' || event.type?.endsWith('_skipped')) {
    completeRouterReviewItem(itemId, 'skipped');
    return;
  }
  if (event.status === 'error' || event.type?.endsWith('_failed')) {
    updateRouterReviewItemStatus(itemId, 'error');
    scheduleRouterReviewItemRemoval(itemId, 4200);
    return;
  }
  if (event.status === 'success' || event.type?.endsWith('_finished')) {
    completeRouterReviewItem(itemId, 'success');
  }
}

function finishRouterReviewTurn(event = {}) {
  if (![
    'assistant_message_committed',
    'turn_finished',
    'flow_finished'
  ].includes(event.type)) return;
  const status = event.status === 'error' ? 'error' : 'success';
  let changed = false;
  for (const item of state.routerReview.items.values()) {
    if (!item?.id || state.routerReview.dismissed.has(item.id)) continue;
    if (event.chatSessionId && item.chatSessionId && item.chatSessionId !== event.chatSessionId) continue;
    if (event.turnId && item.turnId && item.turnId !== event.turnId) continue;
    if (shouldHoldCombatRouterItem(item) || shouldHoldPersuasionRouterItem(item)) continue;
    state.routerReview.items.set(item.id, {
      ...item,
      status
    });
    scheduleRouterReviewItemRemoval(item.id, status === 'error' ? 4200 : 650);
    changed = true;
  }
  if (changed) renderRouterReviewStack();
}

function isStaleRouterReviewEvent(event = {}) {
  if (!state.routerReview.startedAt || !event.createdAt) return false;
  const createdAt = Date.parse(event.createdAt);
  return Number.isFinite(createdAt) && createdAt < state.routerReview.startedAt;
}

function addRouterReviewItems(items = [], event = {}) {
  let changed = false;
  for (const item of items) {
    if (!item?.id || state.routerReview.dismissed.has(item.id)) continue;
    if (!shouldDisplayRouterReviewItem(item, event)) continue;
    const existing = state.routerReview.items.get(item.id) || {};
    const normalized = normalizeRouterReviewItem({
      ...existing,
      ...item,
      turnId: item.turnId || event.turnId || existing.turnId,
      chatSessionId: item.chatSessionId || event.chatSessionId || existing.chatSessionId
    });
    state.routerReview.items.set(item.id, normalized);
    maybeOpenPersuasionOverlayFromRouterItem(normalized, event);
    changed = true;
  }
  if (changed) renderRouterReviewStack();
}

function shouldDisplayRouterReviewItem(item = {}, event = {}) {
  if (item?.id && state.routerReview.items.has(item.id)) return true;
  const kind = item.kind || '';
  const status = item.status || event.status || '';
  if (kind === 'module') {
    return shouldHoldCombatRouterItem(item) || shouldHoldPersuasionRouterItem(item);
  }
  if (event.type === 'router_plan_updated' && status === 'planned') {
    return false;
  }
  return true;
}

function updateRouterReviewItemStatus(itemId, status) {
  const item = state.routerReview.items.get(itemId);
  if (!item) return;
  state.routerReview.items.set(itemId, {
    ...item,
    status
  });
  renderRouterReviewStack();
}

function completeRouterReviewItem(itemId, status = 'success') {
  if (!itemId) return;
  const item = state.routerReview.items.get(itemId);
  if (!item) return;
  if (shouldHoldCombatRouterItem(item) || shouldHoldPersuasionRouterItem(item)) {
    state.routerReview.items.set(itemId, {
      ...item,
      status: 'running'
    });
    renderRouterReviewStack();
    return;
  }
  state.routerReview.items.set(itemId, {
    ...item,
    status
  });
  renderRouterReviewStack();
  scheduleRouterReviewItemRemoval(itemId, status === 'skipped' ? 350 : 650);
}

function scheduleRouterReviewItemRemoval(itemId, delay = 650) {
  clearTimeout(state.routerReview.timers.get(itemId));
  const timer = setTimeout(() => {
    const item = state.routerReview.items.get(itemId);
    if (shouldHoldCombatRouterItem(item) || shouldHoldPersuasionRouterItem(item)) {
      state.routerReview.timers.delete(itemId);
      renderRouterReviewStack();
      return;
    }
    state.routerReview.items.delete(itemId);
    state.routerReview.timers.delete(itemId);
    renderRouterReviewStack();
  }, delay);
  state.routerReview.timers.set(itemId, timer);
}

function releaseRouterReviewItems(predicate, status = 'success', delay = 650) {
  if (typeof predicate !== 'function') return;
  let changed = false;
  for (const item of state.routerReview.items.values()) {
    if (!predicate(item)) continue;
    if (state.routerReview.dismissed.has(item.id)) continue;
    state.routerReview.items.set(item.id, {
      ...item,
      status
    });
    scheduleRouterReviewItemRemoval(item.id, delay);
    changed = true;
  }
  if (changed) renderRouterReviewStack();
}

function clearRouterReviewItems({ startedAt = 0 } = {}) {
  for (const timer of state.routerReview.timers.values()) clearTimeout(timer);
  const heldCombatItems = [...state.routerReview.items.values()].filter((item) => (
    shouldHoldCombatRouterItem(item) || shouldHoldPersuasionRouterItem(item)
  ));
  state.routerReview = emptyRouterReviewState();
  state.routerReview.startedAt = startedAt;
  for (const item of heldCombatItems) {
    state.routerReview.items.set(item.id, {
      ...item,
      status: 'running'
    });
  }
  renderRouterReviewStack();
}

function normalizeRouterReviewItem(item = {}) {
  const title = String(item.title || item.text || item.toolId || item.phaseId || '计划项').trim();
  const normalized = {
    id: String(item.id),
    turnId: item.turnId || '',
    chatSessionId: item.chatSessionId || state.activeChatId || '',
    kind: item.kind || 'module',
    status: item.status || 'pending',
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : 9999,
    phaseId: item.phaseId || '',
    toolId: item.toolId || '',
    intent: item.intent || item.originalIntent || '',
    originalIntent: item.originalIntent || '',
    input: item.input && typeof item.input === 'object' ? item.input : undefined,
    metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : undefined,
    sceneId: item.sceneId || item.input?.sceneId || item.metadata?.sceneId || '',
    title,
    text: item.text || `AI 认为需要：${title}`,
    detail: item.detail || '',
    skippable: item.skippable !== false
  };
  normalized.label = item.label || item.actionLabel || routerReviewActionLabel(normalized);
  return normalized;
}

function renderRouterReviewStack() {
  if (!els.routerReviewFloatStack) return;
  const items = [...state.routerReview.items.values()]
    .filter((item) => !state.routerReview.dismissed.has(item.id))
    .sort((a, b) => routerReviewStatusRank(a.status) - routerReviewStatusRank(b.status) || a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, 8);
  els.routerReviewFloatStack.innerHTML = '';
  els.routerReviewFloatStack.hidden = items.length === 0;
  for (const item of items) {
    els.routerReviewFloatStack.append(renderRouterReviewItem(item));
  }
}

function renderRouterReviewItem(item) {
  const card = document.createElement('article');
  card.className = `router-review-card router-review-${item.kind}`;
  card.dataset.routerReviewId = item.id;
  card.dataset.status = item.status;
  const header = document.createElement('div');
  header.className = 'router-review-header';
  const label = document.createElement('strong');
  label.className = 'router-review-label';
  label.textContent = item.label || routerReviewActionLabel(item);
  const status = document.createElement('span');
  status.className = 'router-review-status';
  status.textContent = routerReviewStatusLabel(item.status);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'router-review-close';
  const canSkip = canSkipRouterReviewItem(item);
  button.title = canSkip ? '取消这个待做行为' : routerReviewCannotSkipMessage(item);
  button.setAttribute('aria-label', button.title);
  button.dataset.routerReviewDismiss = item.id;
  button.disabled = !canSkip;
  button.textContent = '×';
  header.append(label, status, button);
  card.append(header);
  return card;
}

function shouldHoldCombatRouterItem(item) {
  return Boolean(item && isCombatOverlayLocked() && isCombatRouterItem(item));
}

function shouldHoldPersuasionRouterItem(item) {
  return Boolean(item
    && state.persuasionOverlay.open
    && state.persuasionOverlay.routerItemId === item.id
    && isPersuasionRouterItem(item));
}

function isCombatRouterItem(item = {}) {
  const values = [
    item.toolId,
    item.phaseId,
    item.kind,
    item.title,
    item.text,
    item.label
  ].join(' ').toLowerCase();
  return values.includes('system.combat.')
    || /\bcombat\b|battle|战斗/.test(values);
}

function isPersuasionRouterItem(item = {}) {
  const values = [
    item.toolId,
    item.phaseId,
    item.kind,
    item.intent,
    item.originalIntent,
    item.title,
    item.text,
    item.detail,
    item.label
  ].join(' ').toLowerCase();
  return values.includes('system.persuasion.')
    || /\bpersuad|social_action|social\b|speech|convince|deceive|intimidat|说服|交涉|谈判|威胁|欺骗|劝说|话术/.test(values);
}

function isRouterReviewItemRunning(item = {}) {
  return item.status === 'running'
    || shouldHoldCombatRouterItem(item)
    || shouldHoldPersuasionRouterItem(item);
}

function canSkipRouterReviewItem(item = {}) {
  return Boolean(item?.id)
    && item.skippable !== false
    && item.status !== 'success'
    && !isRouterReviewItemRunning(item);
}

function routerReviewCannotSkipMessage(item = {}) {
  if (!item) return '当前行为不能跳过。';
  if (shouldHoldCombatRouterItem(item)) return '战斗已经开始，不能从气泡跳过。';
  if (shouldHoldPersuasionRouterItem(item)) return '说服正在进行，不能从气泡跳过。';
  if (item.status === 'running') return '这个行为已经在执行，不能跳过。';
  if (item.status === 'success') return '这个行为已经完成。';
  if (item.skippable === false) return '这个行为不能跳过。';
  return '当前行为不能跳过。';
}

async function dismissRouterReviewItem(itemId) {
  const item = state.routerReview.items.get(itemId);
  if (!item) return;
  if (!canSkipRouterReviewItem(item)) {
    showToast(routerReviewCannotSkipMessage(item));
    renderRouterReviewStack();
    return;
  }
  state.routerReview.dismissed.add(itemId);
  state.routerReview.items.delete(itemId);
  renderRouterReviewStack();
  try {
    await api('/v1/agent-progress/router-items/skip', {
      method: 'POST',
      body: {
        chatSessionId: item.chatSessionId || state.activeChatId,
        turnId: item.turnId,
        itemId,
        reason: 'player_dismissed_router_float'
      }
    });
  } catch (error) {
    showToast(`跳过请求未送达：${error.message || String(error)}`);
  }
}

function routerReviewItemIdFromProgress(event = {}) {
  if (!event.turnId) return '';
  if (event.type?.startsWith('phase_') && event.phaseId) {
    return `router:phase:${safeRouterSegment(event.turnId)}:${safeRouterSegment(event.phaseId)}`;
  }
  if (event.type?.startsWith('tool_') && event.phaseId && event.toolId) {
    return `router:tool:${safeRouterSegment(event.turnId)}:${safeRouterSegment(event.phaseId)}:${safeRouterSegment(`${event.phaseId}:${event.toolId}`)}`;
  }
  if (event.type?.startsWith('resolver_') && event.phaseId && event.toolId) {
    return '';
  }
  return '';
}

function safeRouterSegment(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .slice(0, 96) || 'item';
}

function routerReviewKindLabel(kind) {
  if (kind === 'tool') return '工具';
  if (kind === 'resolver') return 'Router';
  return '模块';
}

function routerReviewActionLabel(item = {}) {
  const text = [
    item.intent,
    item.toolId,
    item.phaseId,
    item.title,
    item.text,
    item.detail
  ].filter(Boolean).join(' ').toLowerCase();
  if (/resolver|adjudication|route.intent|intent|action.resolve|裁决|意图|行动/.test(text)) return '行动';
  if (/persuad|social|speech|说服|交涉|谈判|威胁|欺骗/.test(text)) return '说服';
  if (/combat|battle|attack|damage|initiative|战斗|攻击|伤害|先攻/.test(text)) return '战斗';
  if (/\b(move|movement|travel|route|path|map|scene|location)\b|移动|路线|路径|地图|场景|地点|酒窖|后巷/.test(text)) return '移动';
  if (/inventory|item|equipment|loot|背包|物品|装备|道具/.test(text)) return '背包';
  if (/status|effect|resource|clock|time|状态|资源|效果|时间|持续/.test(text)) return '状态';
  if (/faction|relationship|npc|actor|party|阵营|关系|npc|角色|队伍/.test(text)) return 'NPC';
  if (/quest|encounter|trigger|event|任务|遭遇|触发|事件/.test(text)) return '事件';
  if (/observation|observe|inspect|check|search|look|查看|观察|检查|搜索|调查/.test(text)) return '观察';
  if (/memory|rag|retrieval|context|worldbook|history|记忆|检索|上下文|世界书|历史/.test(text)) return '记忆';
  if (/impact|commit|postprocess|结算|写入|后处理/.test(text)) return '结算';
  if (/narrative|render|description|描述|叙事/.test(text)) return '描述';
  if (/snapshot|baseline|debug|准备|快照|调试/.test(text)) return '准备';
  const title = String(item.title || '计划').trim();
  return Array.from(title.replace(/\s+/g, '')).slice(0, 4).join('') || '计划';
}

function routerReviewStatusLabel(status) {
  if (status === 'running') return '执行中';
  if (status === 'success') return '完成';
  if (status === 'skipped') return '跳过';
  if (status === 'error') return '出错';
  if (status === 'planned') return '提案';
  return '等待';
}

function routerReviewStatusRank(status) {
  if (status === 'running') return 0;
  if (status === 'pending') return 1;
  if (status === 'planned') return 2;
  if (status === 'error') return 3;
  return 4;
}

function handleSettlementNoticeProgressEvent(event = {}) {
  if (isStaleSettlementNoticeEvent(event)) return;
  const notice = normalizeSettlementNotice(event.settlementNotice, event);
  if (!notice) return;
  addSettlementNotice(notice);
}

function isStaleSettlementNoticeEvent(event = {}) {
  if (!state.settlementNotices.startedAt || !event.createdAt) return false;
  const createdAt = Date.parse(event.createdAt);
  return Number.isFinite(createdAt) && createdAt < state.settlementNotices.startedAt;
}

function inferSettlementNoticeFromProgress(event = {}) {
  if (event.type !== 'tool_finished' || event.status !== 'success' || !event.toolId) return undefined;
  const toolId = String(event.toolId);
  if (!isSettlementToolId(toolId)) return undefined;
  const category = settlementNoticeCategory(toolId, event.phaseId);
  if (!category) return undefined;
  return {
    type: category.type,
    title: category.title,
    text: `${category.subject}已结算`,
    detail: category.detail || ''
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

function normalizeSettlementNotice(notice, event = {}) {
  if (!notice || typeof notice !== 'object') return undefined;
  const category = settlementNoticeCategory(notice.toolId || event.toolId || '', notice.phaseId || event.phaseId || '') || {
    type: notice.type || 'settlement',
    title: notice.title || '结算变化',
    subject: notice.subject || '结算'
  };
  const text = String(notice.text || notice.message || `${category.subject}已结算`).trim();
  return {
    id: String(notice.id || `${event.id || event.sequence || Date.now()}:${category.type}:${text}`),
    type: notice.type || category.type,
    title: String(notice.title || category.title || '结算变化').trim(),
    text,
    detail: String(notice.detail || settlementNoticeDetail(notice.toolId || event.toolId || '', notice.output || event.output || event.result)).trim(),
    status: notice.status || event.status || 'success',
    mergeKey: String(notice.mergeKey || '').trim(),
    importance: String(notice.importance || '').trim()
  };
}

function settlementNoticeDetail(toolId = '', output) {
  const text = String(toolId || '').toLowerCase();
  if (/system\.npc_behavior\.resolve/.test(text)) {
    return behaviorSettlementDetail(output, 'NPC');
  }
  if (/system\.environment_behavior\.resolve/.test(text)) {
    return behaviorSettlementDetail(output, '环境');
  }
  return '';
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
  const parts = [
    noOp ? `${subject}没有产生独立反应` : summary,
    calls.length ? `执行 ${calls.length} 项` : '',
    failed.length ? `失败 ${failed.length} 项` : '',
    !calls.length && !failed.length && !noOp && status ? `状态 ${status}` : ''
  ].filter(Boolean);
  return parts.join(' · ');
}

function addSettlementNotice(notice) {
  if (!notice || notice.importance === 'silent') return;
  if (notice.mergeKey) {
    for (const [id, item] of state.settlementNotices.items.entries()) {
      if (item.mergeKey !== notice.mergeKey) continue;
      clearTimeout(state.settlementNotices.timers.get(id));
      state.settlementNotices.timers.delete(id);
      state.settlementNotices.items.delete(id);
    }
  }
  state.settlementNotices.items.set(notice.id, notice);
  emitSettlementFrontendEvent(notice);
  renderSettlementNoticeStack();
  scheduleSettlementNoticeRemoval(notice.id, 12000);
}

function emitSettlementFrontendEvent(notice = {}) {
  if (notice.type === 'inventory') {
    emitFrontendEvent('inventory:changed', { notice });
  } else if (notice.type === 'status') {
    emitFrontendEvent('status:changed', { notice });
  }
}

function scheduleSettlementNoticeRemoval(id, delay = 5200) {
  clearTimeout(state.settlementNotices.timers.get(id));
  const timer = setTimeout(() => {
    state.settlementNotices.items.delete(id);
    state.settlementNotices.timers.delete(id);
    renderSettlementNoticeStack();
  }, delay);
  state.settlementNotices.timers.set(id, timer);
}

function clearSettlementNotices({ startedAt = 0 } = {}) {
  for (const timer of state.settlementNotices.timers.values()) clearTimeout(timer);
  state.settlementNotices = emptySettlementNoticeState();
  state.settlementNotices.startedAt = startedAt;
  renderSettlementNoticeStack();
}

function dismissSettlementNotice(id) {
  if (!id) return;
  clearTimeout(state.settlementNotices.timers.get(id));
  state.settlementNotices.timers.delete(id);
  state.settlementNotices.items.delete(id);
  renderSettlementNoticeStack();
}

function renderSettlementNoticeStack() {
  if (!els.settlementNoticeStack) return;
  const items = [...state.settlementNotices.items.values()].slice(-5).reverse();
  els.settlementNoticeStack.innerHTML = '';
  els.settlementNoticeStack.hidden = items.length === 0;
  for (const item of items) {
    els.settlementNoticeStack.append(renderSettlementNoticeItem(item));
  }
}

function renderSettlementNoticeItem(item) {
  const card = document.createElement('article');
  card.className = `settlement-notice-card settlement-notice-${item.type}`;
  card.dataset.status = item.status;
  const header = document.createElement('div');
  header.className = 'settlement-notice-header';
  const title = document.createElement('strong');
  title.className = 'settlement-notice-title';
  title.textContent = item.title;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settlement-notice-close';
  button.title = '关闭';
  button.setAttribute('aria-label', '关闭结算提示');
  button.dataset.settlementNoticeDismiss = item.id;
  button.textContent = '×';
  header.append(title, button);
  const text = document.createElement('div');
  text.className = 'settlement-notice-text';
  text.textContent = item.text;
  card.append(header, text);
  if (item.detail) {
    const detail = document.createElement('div');
    detail.className = 'settlement-notice-detail';
    detail.textContent = item.detail;
    card.append(detail);
  }
  return card;
}

function handleAdjudicationProgressEvent(event = {}) {
  if (event.type !== 'adjudication_resolved' && !event.adjudication) return;
  if (event.chatSessionId && state.activeChatId && event.chatSessionId !== state.activeChatId) return;
  const notice = normalizeAdjudicationNotice(event.adjudication || event, event);
  if (!notice || notice.final || notice.status === 'accepted') return;
  showAdjudicationNotice(notice);
}

function normalizeAdjudicationNotice(raw = {}, event = {}) {
  const resolution = compactAdjudicationResolutionForUi(raw.resolution || raw.currentResolution || {});
  const summary = raw.summary || {};
  if (!resolution && !summary) return undefined;
  const chatSessionId = raw.chatSessionId || event.chatSessionId || state.activeChatId || '';
  return {
    id: String(raw.id || event.id || `adjudication:${Date.now()}`),
    chatSessionId,
    title: String(raw.title || '裁决结果').trim(),
    status: String(raw.status || summary.status || resolution.status || event.status || 'success'),
    final: raw.final === true,
    appealAvailable: raw.appealAvailable !== false && raw.final !== true,
    prompt: raw.prompt || '',
    toolId: raw.toolId || event.toolId || '',
    loopState: raw.loopState,
    choices: Array.isArray(raw.choices) ? raw.choices : [],
    summary,
    resolution,
    rejudgement: raw.rejudgement || resolution.rejudgement,
    createdAt: event.createdAt || new Date().toISOString()
  };
}

function compactAdjudicationResolutionForUi(resolution = {}) {
  if (!resolution || typeof resolution !== 'object') return {};
  const applyWrapper = combatObject(resolution.apply || resolution.application?.apply || {});
  const apply = combatObject(applyWrapper.apply || applyWrapper);
  const plan = combatObject(resolution.plan || applyWrapper.plan || apply.plan || resolution.currentPlan);
  const checks = Array.isArray(resolution.checks)
    ? resolution.checks
    : Array.isArray(plan.checks)
      ? plan.checks.map((check) => compactAdjudicationCheckForUi(check, apply.diceResults))
      : [];
  const diceTotals = Array.isArray(resolution.diceTotals)
    ? resolution.diceTotals
    : Array.isArray(apply.diceResults)
      ? apply.diceResults.map(compactAdjudicationDiceForUi)
      : [];
  return {
    ...resolution,
    status: resolution.status || apply.status,
    actionId: resolution.actionId || plan.actionId || apply.plan?.actionId,
    sourceText: resolution.sourceText || plan.sourceText,
    intent: resolution.intent || plan.intent,
    checks,
    diceTotals,
    appliedToolCalls: resolution.appliedToolCalls || apply.appliedToolCalls,
    failedToolCalls: resolution.failedToolCalls || apply.failedToolCalls,
    skippedToolCalls: resolution.skippedToolCalls || apply.skippedToolCalls,
    riskSummary: resolution.riskSummary || compactAdjudicationRiskForUi(apply.riskReport),
    narrationHints: resolution.narrationHints || apply.narrationHints || plan.narrationHints
  };
}

function compactAdjudicationCheckForUi(check = {}, diceResults = []) {
  const diceRecord = Array.isArray(diceResults)
    ? diceResults.find((record) => record.id === check.id || record.checkId === check.id)
    : undefined;
  const diceInput = combatObject(check.input);
  const diceOutput = combatObject(diceRecord?.output || diceRecord?.result);
  return {
    id: check.id,
    tool: check.tool,
    threshold: diceInput.successThreshold ?? diceInput.dc ?? diceOutput.successThreshold,
    dice: diceInput.diceSides || diceInput.sides || diceOutput.dice?.sides
      ? `${diceInput.diceCount ?? diceInput.rollCount ?? diceOutput.dice?.count ?? 1}d${diceInput.diceSides ?? diceInput.sides ?? diceOutput.dice?.sides}`
      : undefined,
    modifierTotal: diceOutput.modifierTotal ?? diceInput.modifier,
    modifierSources: compactAdjudicationModifierSourcesForUi(diceInput, diceOutput),
    metadata: check.metadata,
    reason: check.reason || check.description || check.metadata?.reason,
    diceTotal: diceOutput.total,
    outcome: diceOutput.outcome || diceRecord?.outcome,
    success: diceOutput.success ?? diceRecord?.success,
    failure: diceOutput.failure ?? diceRecord?.failure,
    criticalSuccess: diceOutput.criticalSuccess ?? diceRecord?.criticalSuccess,
    criticalFailure: diceOutput.criticalFailure ?? diceRecord?.criticalFailure
  };
}

function compactAdjudicationDiceForUi(record = {}) {
  const output = combatObject(record.output || record.result || record);
  return {
    checkId: record.id || record.checkId,
    total: output.total ?? record.total,
    outcome: output.outcome || record.outcome,
    success: output.success ?? record.success,
    threshold: output.successThreshold,
    modifierTotal: output.modifierTotal,
    criticalSuccess: output.criticalSuccess ?? record.criticalSuccess,
    criticalFailure: output.criticalFailure ?? record.criticalFailure
  };
}

function compactAdjudicationModifierSourcesForUi(diceInput = {}, diceOutput = {}) {
  if (Array.isArray(diceOutput.modifierBreakdown) && diceOutput.modifierBreakdown.length) {
    return diceOutput.modifierBreakdown.map((item) => ({
      name: item.name || item.source || '修正',
      value: item.value ?? item.modifier,
      reason: item.reason || item.detail || ''
    }));
  }
  const sources = [];
  for (const [key, label] of [
    ['modifier', '固定修正'],
    ['abilityModifier', '属性修正'],
    ['proficiencyBonus', '熟练加值'],
    ['buff', '增益'],
    ['debuff', '减益']
  ]) {
    if (diceInput[key] !== undefined) sources.push({ name: label, value: diceInput[key] });
  }
  return sources;
}

function compactAdjudicationRiskForUi(riskReport = {}) {
  if (!riskReport || typeof riskReport !== 'object') return undefined;
  const calls = Array.isArray(riskReport.toolCalls) ? riskReport.toolCalls : [];
  return {
    blocked: calls.filter((call) => call.allowed === false).map((call) => ({
      id: call.id,
      tool: call.tool,
      reason: call.blockReason || call.reason
    }))
  };
}

function showAdjudicationNotice(notice) {
  state.adjudicationOverlay.current = notice;
  state.adjudicationOverlay.appealOpen = false;
  state.adjudicationOverlay.submitting = false;
  state.adjudicationOverlay.accepting = false;
  state.adjudicationOverlay.status = '';
  renderAdjudicationOverlay();
  updateControls();
}

function dismissAdjudicationOverlay() {
  state.adjudicationOverlay = emptyAdjudicationOverlayState();
  renderAdjudicationOverlay();
  updateControls();
}

function renderAdjudicationOverlay() {
  if (!els.adjudicationOverlay) return;
  const notice = state.adjudicationOverlay.current;
  els.adjudicationOverlay.hidden = !notice;
  if (!notice) return;
  const outcome = adjudicationOutcomeKey(notice);
  els.adjudicationCard.dataset.outcome = outcome;
  els.adjudicationTitle.textContent = notice.title || '裁决结果';
  els.adjudicationSummary.textContent = adjudicationSummaryLine(notice);
  els.adjudicationOutcome.textContent = adjudicationOutcomeText(notice);
  els.adjudicationContent.innerHTML = '';
  for (const section of buildAdjudicationSections(notice)) {
    els.adjudicationContent.append(section);
  }
  const status = state.adjudicationOverlay.status;
  els.adjudicationStatus.hidden = !status;
  els.adjudicationStatus.textContent = status;
  els.adjudicationAppealPanel.hidden = !state.adjudicationOverlay.appealOpen;
  els.adjudicationAppealButton.disabled = state.adjudicationOverlay.submitting
    || state.adjudicationOverlay.accepting
    || !notice.appealAvailable
    || !notice.loopState;
  els.adjudicationSubmitAppealButton.disabled = state.adjudicationOverlay.submitting || state.adjudicationOverlay.accepting;
  els.adjudicationCancelAppealButton.disabled = state.adjudicationOverlay.submitting || state.adjudicationOverlay.accepting;
  els.adjudicationAcceptButton.disabled = state.adjudicationOverlay.submitting || state.adjudicationOverlay.accepting;
  els.adjudicationCloseButton.disabled = state.adjudicationOverlay.submitting || state.adjudicationOverlay.accepting;
  els.adjudicationSubmitAppealButton.textContent = state.adjudicationOverlay.submitting ? '正在重新裁决...' : '提交重新裁决';
  els.adjudicationAcceptButton.textContent = state.adjudicationOverlay.accepting ? '正在接受...' : '接受裁决';
}

function buildAdjudicationSections(notice) {
  const resolution = notice.resolution || {};
  const sections = [];
  const intentRows = [
    ['行动', resolution.sourceText || notice.summary?.actionId || resolution.actionId || '未标注'],
    ['意图', resolution.intent?.summary || resolution.intent?.label || '未标注'],
    ['目标', adjudicationTargetText(resolution.intent?.target)]
  ].filter(([, value]) => value);
  sections.push(adjudicationSection('判定依据', intentRows.map(([label, value]) => adjudicationInfoRow(label, value))));

  const checks = Array.isArray(resolution.checks) ? resolution.checks : [];
  if (checks.length) {
    sections.push(adjudicationSection('数值与加成', checks.map(renderAdjudicationCheck)));
  }

  const diceTotals = Array.isArray(resolution.diceTotals) ? resolution.diceTotals : [];
  if (diceTotals.length && !checks.length) {
    sections.push(adjudicationSection('骰子最终点数', diceTotals.map((dice) => adjudicationInfoRow(
      dice.checkId || '检定',
      `${dice.total ?? '未知'} / 阈值 ${dice.threshold ?? '未标注'} / ${adjudicationSuccessText(dice)}`
    ))));
  }

  if (resolution.absurdity) {
    sections.push(adjudicationSection('荒谬性判断', renderAbsurdityRows(resolution.absurdity)));
  }

  const rejudgement = notice.rejudgement || resolution.rejudgement;
  if (rejudgement?.decision) {
    sections.push(adjudicationSection('重裁意见', renderRejudgementRows(rejudgement.decision)));
  }

  const toolRows = renderAdjudicationToolRows(resolution);
  if (toolRows.length) sections.push(adjudicationSection('执行与影响', toolRows));

  if (resolution.riskSummary?.blocked?.length) {
    sections.push(adjudicationSection('未执行项', resolution.riskSummary.blocked.map((item) => adjudicationInfoRow(
      item.tool || item.id || '工具',
      item.reason || '被权限或策略拦截'
    ))));
  }

  return sections;
}

function adjudicationSection(title, children = []) {
  const section = document.createElement('section');
  section.className = 'adjudication-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading, ...children);
  return section;
}

function adjudicationInfoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'adjudication-row';
  const key = document.createElement('span');
  key.textContent = label;
  const detail = document.createElement('strong');
  detail.textContent = value === undefined || value === null || value === '' ? '未标注' : String(value);
  row.append(key, detail);
  return row;
}

function renderAdjudicationCheck(check = {}) {
  const wrap = document.createElement('article');
  wrap.className = 'adjudication-check';
  const title = document.createElement('div');
  title.className = 'adjudication-check-title';
  const name = document.createElement('strong');
  name.textContent = check.id || check.tool || '检定';
  const result = document.createElement('span');
  result.textContent = `${check.diceTotal ?? '未知'} / ${check.threshold ?? '未标注'} · ${adjudicationSuccessText(check)}`;
  title.append(name, result);
  wrap.append(title);
  const rows = [
    ['骰子最终点数', check.diceTotal ?? '未知'],
    ['成功阈值', check.threshold ?? '未标注'],
    ['加成合计', check.modifierTotal === undefined ? '未标注' : formatSignedNumber(check.modifierTotal)],
    ['来源说明', check.reason || check.metadata?.reason || adjudicationMetadataText(check.metadata)]
  ];
  for (const [label, value] of rows) {
    if (value !== undefined && value !== '') wrap.append(adjudicationInfoRow(label, value));
  }
  const sources = Array.isArray(check.modifierSources) ? check.modifierSources : [];
  if (sources.length) {
    const list = document.createElement('div');
    list.className = 'adjudication-chip-list';
    for (const source of sources) {
      const chip = document.createElement('span');
      chip.textContent = `${source.name || '修正'} ${formatSignedNumber(source.value)}${source.reason ? ` · ${source.reason}` : ''}`;
      list.append(chip);
    }
    wrap.append(list);
  }
  return wrap;
}

function renderAbsurdityRows(absurdity = {}) {
  const rows = [
    adjudicationInfoRow('等级', absurdity.level || '未评估'),
    adjudicationInfoRow('结论', absurdity.summary || '未标注'),
    adjudicationInfoRow('是否可尝试', absurdity.canAttempt === false ? '不可尝试' : '可尝试'),
    adjudicationInfoRow('是否需要解释', absurdity.requiresExplanationOnSuccess ? '成功后需要解释' : '不需要额外解释')
  ];
  if (absurdity.explanation) rows.push(adjudicationInfoRow('解释', absurdity.explanation));
  for (const factor of Array.isArray(absurdity.factors) ? absurdity.factors.slice(0, 4) : []) {
    rows.push(adjudicationInfoRow(factor.name || '因素', [factor.judgement, factor.note].filter(Boolean).join(' · ')));
  }
  return rows;
}

function renderRejudgementRows(decision = {}) {
  const rows = [
    adjudicationInfoRow('状态', rejudgementStatusText(decision.status)),
    adjudicationInfoRow('理由', decision.summary || '未标注')
  ];
  if (decision.correction?.recommendedOutcome) rows.push(adjudicationInfoRow('建议结果', decision.correction.recommendedOutcome));
  if (decision.correction?.shouldChangeRuling !== undefined) {
    rows.push(adjudicationInfoRow('是否改变裁决', decision.correction.shouldChangeRuling ? '建议改变' : '维持原裁决'));
  }
  for (const finding of Array.isArray(decision.findings) ? decision.findings.slice(0, 4) : []) {
    rows.push(adjudicationInfoRow(finding.issue || '依据', `${finding.supportsPlayer ? '支持玩家' : '不支持玩家'} · ${finding.evaluation || ''}`));
  }
  return rows;
}

function renderAdjudicationToolRows(resolution = {}) {
  const rows = [];
  const applied = Array.isArray(resolution.appliedToolCalls) ? resolution.appliedToolCalls : [];
  const failed = Array.isArray(resolution.failedToolCalls) ? resolution.failedToolCalls : [];
  const skipped = Array.isArray(resolution.skippedToolCalls) ? resolution.skippedToolCalls : [];
  if (applied.length) rows.push(adjudicationInfoRow('已执行工具', applied.map((item) => item.tool || item.id).filter(Boolean).join('，')));
  if (failed.length) rows.push(adjudicationInfoRow('失败工具', failed.map((item) => `${item.tool || item.id}: ${item.error || '出错'}`).join('，')));
  if (skipped.length) rows.push(adjudicationInfoRow('跳过工具', skipped.slice(0, 4).map((item) => `${item.tool || item.id}: ${item.reason || '未执行'}`).join('，')));
  const proposals = Array.isArray(resolution.proposals) ? resolution.proposals : [];
  if (proposals.length) rows.push(adjudicationInfoRow('候选影响', proposals.slice(0, 5).map((item) => `${item.id || item.tool}(${Array.isArray(item.when) ? item.when.join('/') : item.when || 'always'})`).join('，')));
  return rows;
}

function openAdjudicationAppealPanel() {
  if (!state.adjudicationOverlay.current) return;
  state.adjudicationOverlay.appealOpen = true;
  state.adjudicationOverlay.status = '';
  renderAdjudicationOverlay();
  els.adjudicationAppealText.focus();
}

function closeAdjudicationAppealPanel() {
  state.adjudicationOverlay.appealOpen = false;
  state.adjudicationOverlay.status = '';
  renderAdjudicationOverlay();
}

async function submitAdjudicationAppeal() {
  const notice = state.adjudicationOverlay.current;
  if (!notice || state.adjudicationOverlay.submitting) return;
  const playerArgument = els.adjudicationAppealText.value.trim();
  if (!playerArgument) {
    state.adjudicationOverlay.status = '请先写明反驳理由。';
    renderAdjudicationOverlay();
    return;
  }
  state.adjudicationOverlay.submitting = true;
  state.adjudicationOverlay.status = '正在重新裁决...';
  renderAdjudicationOverlay();
  try {
    const output = await executeTool('system.action.resolve', {
      action: 'appeal',
      loopState: notice.loopState,
      playerArgument,
      appealText: playerArgument,
      additionalInfo: playerArgument,
      useRejudgementLlm: true,
      applyRejudgement: false,
      dryRun: false
    }, buildManagedToolExecutionContext({
      source: 'web-ui.adjudication-overlay',
      chatSessionId: notice.chatSessionId || state.activeChatId,
      authorization: true,
      actor: { type: 'user', id: 'user' }
    }));
    const updated = normalizeAdjudicationNotice({
      id: `${notice.id}:appeal:${Date.now()}`,
      chatSessionId: notice.chatSessionId || state.activeChatId,
      title: '重新裁决结果',
      toolId: 'system.action.resolve',
      output,
      status: output?.status,
      loopState: output?.loopState,
      choices: output?.choices,
      summary: output?.currentSummary,
      resolution: output?.currentResolution,
      rejudgement: output?.rejudgement
    });
    if (updated) showAdjudicationNotice(updated);
    state.adjudicationOverlay.status = '重新裁决完成。';
    els.adjudicationAppealText.value = '';
    renderAdjudicationOverlay();
  } catch (error) {
    state.adjudicationOverlay.submitting = false;
    state.adjudicationOverlay.status = `重新裁决失败：${error.message || String(error)}`;
    renderAdjudicationOverlay();
    showToast(error.message || String(error));
  }
}

async function acceptAndCloseAdjudicationOverlay() {
  const notice = state.adjudicationOverlay.current;
  if (!notice || state.adjudicationOverlay.accepting) return;
  state.adjudicationOverlay.accepting = true;
  state.adjudicationOverlay.status = '正在接受裁决...';
  renderAdjudicationOverlay();
  try {
    if (notice.loopState) {
      await executeTool('system.action.resolve', {
        action: 'accept',
        loopState: notice.loopState
      }, buildManagedToolExecutionContext({
        source: 'web-ui.adjudication-overlay',
        chatSessionId: notice.chatSessionId || state.activeChatId,
        authorization: true,
        actor: { type: 'user', id: 'user' }
      }));
    }
    dismissAdjudicationOverlay();
  } catch (error) {
    state.adjudicationOverlay.accepting = false;
    state.adjudicationOverlay.status = `接受裁决失败：${error.message || String(error)}`;
    renderAdjudicationOverlay();
    showToast(error.message || String(error));
  }
}

function adjudicationSummaryLine(notice) {
  const resolution = notice.resolution || {};
  const parts = [
    resolution.intent?.label || resolution.actionId,
    resolution.diceTotals?.length ? `骰子 ${resolution.diceTotals.map((dice) => dice.total).filter((value) => value !== undefined).join('/')}` : '',
    adjudicationOutcomeText(notice)
  ];
  return parts.filter(Boolean).join(' · ') || notice.prompt || '裁决结果已生成';
}

function adjudicationOutcomeKey(notice) {
  const resolution = notice.resolution || {};
  if (resolution.rejudgement?.decision?.status === 'rejected') return 'failure';
  if (resolution.rejudgement?.decision?.status === 'accepted' || resolution.rejudgement?.decision?.status === 'partiallyAccepted') return 'success';
  if (resolution.status === 'failure' || notice.status === 'failure') return 'failure';
  if (resolution.status === 'partial_failure' || notice.status === 'partial_failure') return 'warning';
  const dice = Array.isArray(resolution.diceTotals) ? resolution.diceTotals : [];
  if (dice.length && dice.every((item) => item.success === false)) return 'failure';
  return 'success';
}

function adjudicationOutcomeText(notice) {
  const key = adjudicationOutcomeKey(notice);
  if (key === 'failure') return '失败';
  if (key === 'warning') return '部分完成';
  const rejudgement = notice.rejudgement?.decision || notice.resolution?.rejudgement?.decision;
  if (rejudgement?.status) return rejudgementStatusText(rejudgement.status);
  return '成功';
}

function adjudicationSuccessText(value = {}) {
  if (value.outcome === 'criticalSuccess' || value.criticalSuccess) return '大成功';
  if (value.outcome === 'criticalFailure' || value.criticalFailure) return '大失败';
  return value.success === false ? '失败' : '成功';
}

function rejudgementStatusText(status) {
  if (status === 'accepted') return '接受反驳';
  if (status === 'partiallyAccepted') return '部分接受';
  if (status === 'rejected') return '维持原裁决';
  if (status === 'needsMoreInfo') return '需要更多信息';
  if (status === 'pending') return '等待裁决';
  return status || '未标注';
}

function adjudicationTargetText(target) {
  if (!target) return '';
  if (typeof target === 'string') return target;
  if (typeof target === 'object') return [target.kind, target.id, target.name].filter(Boolean).join(' / ');
  return String(target);
}

function adjudicationMetadataText(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  return Object.entries(metadata)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join('，');
}

function handleDiceRollProgressEvent(event = {}) {
  if (event.type !== 'dice_roll_resolved' && !event.diceRoll) return;
  const notice = normalizeDiceRollNotice(event.diceRoll || event, event);
  if (!notice) return;
  showDiceRollNotice(notice);
}

function normalizeDiceRollNotice(raw = {}, event = {}) {
  const result = raw.result || raw.diceResult || raw.output;
  if (!result || typeof result !== 'object') return undefined;
  const dice = result.dice || {};
  const sides = numberOrUndefined(dice.sides ?? result.diceSides ?? result.sides);
  const count = numberOrUndefined(dice.count ?? result.diceCount ?? result.rollCount ?? result.count) || 1;
  const expression = String(dice.expression || `${count}d${sides || '?'}`).trim();
  const rolls = Array.isArray(result.rolls) ? result.rolls : [];
  return {
    id: String(raw.id || event.id || `${Date.now()}:${expression}:${result.total}`),
    title: String(raw.title || diceRollOutcomeTitle(result)).trim(),
    kind: raw.kind || 'check',
    toolId: raw.sourceToolId || raw.toolId || event.toolId || '',
    phaseId: raw.phaseId || event.phaseId || '',
    input: raw.input || raw.diceInput || {},
    result,
    originalResult: raw.originalResult,
    inspiration: raw.inspiration,
    expression,
    sides,
    count,
    rolls,
    createdAt: event.createdAt || new Date().toISOString()
  };
}

function showDiceRollNotice(notice) {
  clearTimeout(state.diceRollOverlay.hideTimer);
  state.diceRollOverlay.current = notice;
  state.diceRollOverlay.status = '';
  state.diceRollOverlay.rerolling = false;
  renderDiceRollOverlay();
  state.diceRollOverlay.hideTimer = setTimeout(dismissDiceRollOverlay, 18000);
}

function dismissDiceRollOverlay() {
  clearTimeout(state.diceRollOverlay.hideTimer);
  state.diceRollOverlay.current = undefined;
  state.diceRollOverlay.status = '';
  state.diceRollOverlay.rerolling = false;
  renderDiceRollOverlay();
}

function renderDiceRollOverlay() {
  if (!els.diceRollOverlay) return;
  const notice = state.diceRollOverlay.current;
  els.diceRollOverlay.hidden = !notice;
  if (!notice) return;
  const result = notice.result || {};
  const outcome = diceRollOutcomeKey(result);
  els.diceRollCard.dataset.outcome = outcome;
  els.diceRollBadge.textContent = notice.expression || `d${notice.sides || '?'}`;
  els.diceRollTitle.textContent = notice.title || diceRollOutcomeTitle(result);
  els.diceRollSummary.textContent = diceRollSummaryText(notice);
  els.diceRollTotal.textContent = formatSignedNumber(result.total, { showPlus: false });
  els.diceRollDetails.innerHTML = '';
  for (const [term, description] of diceRollDetailRows(notice)) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = description;
    els.diceRollDetails.append(dt, dd);
  }
  els.diceRollAttempts.innerHTML = '';
  const attempts = diceRollAttemptLines(result);
  els.diceRollAttempts.hidden = attempts.length === 0;
  for (const line of attempts) {
    const item = document.createElement('div');
    item.textContent = line;
    els.diceRollAttempts.append(item);
  }
  const status = state.diceRollOverlay.status;
  els.diceRollStatus.hidden = !status;
  els.diceRollStatus.textContent = status;
  els.diceRollRerollButton.disabled = state.diceRollOverlay.rerolling || !state.activeChatId || result.forced === true;
  els.diceRollRerollButton.textContent = state.diceRollOverlay.rerolling ? '正在重投...' : '消耗激励点重投';
  els.diceRollRerollButton.title = result.forced === true
    ? '强制结果不能重投'
    : '读取当前玩家角色的激励点，成功消耗后重投一次';
}

async function rerollCurrentDiceRoll() {
  const notice = state.diceRollOverlay.current;
  if (!notice || state.diceRollOverlay.rerolling) return;
  state.diceRollOverlay.rerolling = true;
  state.diceRollOverlay.status = '正在读取当前玩家角色并消耗激励点...';
  renderDiceRollOverlay();
  try {
    const actor = await resolveDiceRerollActor();
    if (!actor?.actorId) throw new Error('没有找到当前玩家角色，无法消耗激励点重投。');
    const output = await executeTool('game.dice.offer_inspiration_reroll', {
      chatSessionId: state.activeChatId,
      sceneId: 'current',
      actorId: actor.actorId,
      playerId: actor.playerId,
      diceResult: notice.result,
      diceInput: notice.input,
      decision: 'reroll',
      offerOn: 'any',
      source: 'web-ui.dice-roll-overlay'
    }, {
      source: 'web-ui.dice-roll-overlay',
      chatSessionId: state.activeChatId,
      authorization: true,
      actor: { type: 'user', id: 'user' }
    });
    if (output?.status !== 'rerolled' || !output.rerollResult) {
      state.diceRollOverlay.rerolling = false;
      state.diceRollOverlay.status = diceRerollSkipText(output);
      renderDiceRollOverlay();
      return;
    }
    showDiceRollNotice(normalizeDiceRollNotice({
      id: `${notice.id}:reroll:${Date.now()}`,
      title: '激励重投结果',
      kind: 'inspiration_reroll',
      input: output.rerollInput || notice.input,
      result: output.rerollResult,
      originalResult: output.originalResult || notice.result,
      inspiration: {
        before: output.inspirationBefore,
        after: output.inspirationAfter,
        resourceField: output.resourceField
      },
      sourceToolId: 'game.dice.offer_inspiration_reroll'
    }) || notice);
    if (output.inspirationAfter !== undefined) {
      state.diceRollOverlay.status = `已消耗 1 点激励，剩余 ${output.inspirationAfter}。`;
      renderDiceRollOverlay();
    }
  } catch (error) {
    state.diceRollOverlay.rerolling = false;
    state.diceRollOverlay.status = `重投失败：${error.message || String(error)}`;
    renderDiceRollOverlay();
    showToast(error.message || String(error));
  }
}

async function resolveDiceRerollActor() {
  if (!state.activeChatId) return undefined;
  try {
    const output = await executeTool('system.actor_control.get_context', { chatSessionId: state.activeChatId }, {
      source: 'web-ui.dice-roll-overlay'
    });
    const context = output?.context || {};
    if (context.controlledActorId && context.requiresInitialization !== true) {
      return {
        actorId: context.controlledActorId,
        playerId: context.controlledPlayerId || context.playerId || context.controlledActorId
      };
    }
  } catch {
    // Fall back to protagonist and player-marked records below.
  }
  try {
    const output = await executeTool('system.protagonist.get_active', { chatSessionId: state.activeChatId }, {
      source: 'web-ui.dice-roll-overlay'
    });
    const actorId = output?.active?.actorId || output?.actorId || output?.protagonist?.actorId;
    if (actorId) return { actorId, playerId: output?.active?.playerId || actorId };
  } catch {
    // Missing protagonist tooling should not block a final record scan.
  }
  const collections = await loadAvailableChatDataCollections(state.activeChatId);
  const records = await loadPlayerActorRecords(collections, state.activeChatId);
  const record = records[0];
  if (!record?.data) return undefined;
  return {
    actorId: record.data.npcId || record.data.actorId || record.data.playerId || record.id,
    playerId: record.data.playerId || record.data.npcId || record.id
  };
}

function diceRollDetailRows(notice) {
  const result = notice.result || {};
  const selected = result.selectedAttempt || {};
  const natural = numberOrUndefined(result.naturalTotal ?? selected.naturalTotal);
  const modifier = numberOrUndefined(result.modifierTotal ?? selected.modifierTotal) || 0;
  const threshold = numberOrUndefined(result.successThreshold ?? notice.input?.successThreshold ?? notice.input?.dc);
  const rows = [
    ['骰子', notice.expression || `${notice.count || 1}d${notice.sides || '?'}`],
    ['随机点数', diceRollRandomText(notice)],
    ['加成', diceRollModifierText(result, modifier)],
    ['合计', `${natural ?? '?'} ${formatSignedNumber(modifier)} = ${result.total ?? '?'}`],
    ['阈值', threshold === undefined ? '未设置' : String(threshold)],
    ['判断', diceRollOutcomeText(result)]
  ];
  if (result.rollMode && result.rollMode !== 'normal') rows.splice(2, 0, ['模式', diceRollModeText(result.rollMode)]);
  if (result.inspiration?.used) rows.push(['自动重投', `已使用 ${result.inspiration.used} 次`]);
  return rows;
}

function diceRollRandomText(notice) {
  const result = notice.result || {};
  const rolls = notice.rolls.length ? notice.rolls : (result.selectedAttempt?.rolls || []);
  const natural = result.naturalTotal ?? result.selectedAttempt?.naturalTotal;
  if (rolls.length > 1) return `${rolls.join(' + ')} = ${natural ?? rolls.reduce((sum, value) => sum + Number(value || 0), 0)}`;
  if (rolls.length === 1) return String(rolls[0]);
  return natural === undefined ? '未知' : String(natural);
}

function diceRollModifierText(result, modifier) {
  const breakdown = Array.isArray(result.modifierBreakdown) ? result.modifierBreakdown : [];
  if (!breakdown.length) return formatSignedNumber(modifier);
  return `${formatSignedNumber(modifier)}（${breakdown.map((item) => `${diceModifierName(item.name)} ${formatSignedNumber(item.value)}`).join('，')}）`;
}

function diceRollAttemptLines(result = {}) {
  const lines = [];
  const selected = result.selectedAttempt || {};
  if (Array.isArray(selected.candidates) && selected.candidates.length > 1) {
    lines.push(`候选点数：${selected.candidates.map((candidate) => candidate.naturalTotal ?? candidate.rolls?.join('+')).join(' / ')}，取第 ${(selected.selectedCandidateIndex ?? 0) + 1} 组`);
  }
  if (Array.isArray(result.attempts) && result.attempts.length > 1) {
    for (const attempt of result.attempts.slice(0, 4)) {
      lines.push(`第 ${attempt.attempt} 次：${attempt.naturalTotal} ${formatSignedNumber(attempt.modifierTotal || 0)} = ${attempt.total}，${diceRollOutcomeText(attempt)}`);
    }
  }
  if (result.remoteControl?.enabled) {
    lines.push(result.remoteControl.fixedRollActive
      ? `调试骰已启用：d${result.remoteControl.effectiveDiceSides} 固定 ${result.remoteControl.fixedRoll}`
      : `调试骰已启用：改用 d${result.remoteControl.effectiveDiceSides}`);
  }
  return lines;
}

function diceRollSummaryText(notice) {
  const result = notice.result || {};
  const threshold = result.successThreshold ?? notice.input?.successThreshold ?? notice.input?.dc;
  const parts = [
    notice.expression,
    `总计 ${result.total ?? '?'}`,
    threshold === undefined ? '' : `阈值 ${threshold}`,
    diceRollOutcomeText(result)
  ];
  return parts.filter(Boolean).join(' · ');
}

function diceRollOutcomeKey(result = {}) {
  if (result.outcome === 'criticalSuccess') return 'critical-success';
  if (result.outcome === 'criticalFailure') return 'critical-failure';
  return result.success ? 'success' : 'failure';
}

function diceRollOutcomeTitle(result = {}) {
  if (result.outcome === 'criticalSuccess') return '骰子大成功';
  if (result.outcome === 'criticalFailure') return '骰子大失败';
  return result.success ? '骰子成功' : '骰子失败';
}

function diceRollOutcomeText(result = {}) {
  if (result.outcome === 'criticalSuccess') return '大成功';
  if (result.outcome === 'criticalFailure') return '大失败';
  return result.success ? '成功' : '失败';
}

function diceRollModeText(mode) {
  if (mode === 'advantage') return '优势';
  if (mode === 'disadvantage') return '劣势';
  return '普通';
}

function diceModifierName(name) {
  const labels = {
    fixed: '固定',
    buff: '增益',
    debuff: '减益',
    ability: '属性',
    proficiency: '熟练'
  };
  return labels[name] || name || '修正';
}

function diceRerollSkipText(output = {}) {
  const reason = output?.reason || output?.status;
  if (reason === 'no_inspiration') return '当前角色没有可消耗的激励点。';
  if (reason === 'actor_state_not_found') return '没有找到当前玩家角色的状态记录。';
  if (reason === 'missing_user_authorization') return '缺少用户授权，无法消耗激励点。';
  if (reason === 'forced_result') return '这是强制结果，不能重投。';
  if (reason === 'player_declined') return '已保留原结果。';
  return output?.prompt || '当前不能重投。';
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatSignedNumber(value, { showPlus = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  if (number > 0 && showPlus) return `+${number}`;
  return String(number);
}

function showAgentProgress(label, { status = 'running', detail = '' } = {}) {
  clearTimeout(state.agentProgress.hideTimer);
  els.agentProgressFloat.hidden = false;
  els.agentProgressFloat.dataset.status = status;
  els.agentProgressStatus.textContent = label || 'Agent 正在运行...';
  const warning = state.agentProgress.lastWarning && status !== 'error'
    ? `提示：${state.agentProgress.lastWarning}`
    : '';
  els.agentProgressDetail.textContent = [detail, warning].filter(Boolean).join(' · ');
}

function hideAgentProgress() {
  clearTimeout(state.agentProgress.hideTimer);
  els.agentProgressFloat.hidden = true;
}

function scheduleAgentProgressHide(delay) {
  clearTimeout(state.agentProgress.hideTimer);
  state.agentProgress.hideTimer = setTimeout(() => {
    hideAgentProgress();
  }, delay);
}

function agentProgressDetail(event = {}) {
  const parts = [];
  if (event.title && event.title !== event.progressLabel) parts.push(event.title);
  if (event.phaseId) parts.push(`阶段 ${event.phaseId}`);
  if (event.toolId) parts.push(`工具 ${event.toolId}`);
  if (event.error?.message) parts.push(event.error.message);
  return parts.join(' · ');
}

function fallbackAgentProgressLabel(event = {}) {
  if (event.type === 'rollback_started') return '出了问题，正在回滚...';
  if (event.type === 'rollback_finished') return '已回滚到发送前状态';
  if (event.type?.includes('failed')) return `${event.title || '当前模块'}出了问题`;
  if (event.type?.includes('started')) return `正在处理${event.title || '当前模块'}...`;
  if (event.type?.includes('finished')) return `${event.title || '当前模块'}已完成`;
  return 'Agent 正在运行...';
}

async function planContext() {
  if (!state.activeChatId) return;
  setBusy(true);
  try {
    const query = els.messageInput.value.trim() || lastUserMessage(state.activeChat)?.content || lastMessage(state.activeChat)?.content || '';
    const payload = await api('/v1/tools/system.context_planner.plan_context/execute', {
      method: 'POST',
      body: {
        input: {
          chatSessionId: state.activeChatId,
          sceneId: 'current',
          query,
          maxContextTokens: 6000,
          minScore: 0
        },
        context: buildManagedToolExecutionContext({ source: 'web-ui.context-plan' })
      }
    });
    renderContextPlan(payload.result.output);
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function renderContextPlan(plan) {
  const usage = plan.usage || {};
  els.contextUsage.innerHTML = '';
  els.contextUsage.append(
    metric(`selected ${usage.selectedCount || 0}`),
    metric(`tokens ${usage.selectedTokens || 0}`)
  );
  els.contextSections.innerHTML = '';
  for (const section of plan.selectedSections || []) {
    els.contextSections.append(infoRow(
      section.title || section.id,
      `${section.id} · ${section.tokenEstimate || 0} tokens${section.truncated ? ' · truncated' : ''}`
    ));
  }
  if ((plan.omittedSections || []).length > 0) {
    els.contextSections.append(infoRow(
      'omitted',
      plan.omittedSections.map((section) => `${section.id}:${section.reason}`).join(', ')
    ));
  }
  els.contextPreview.value = plan.promptContext || '';
}

async function exportActiveChat() {
  if (!state.activeChatId) return;
  await exportChat(state.activeChat || state.chats.find((chat) => chat.id === state.activeChatId));
}

async function exportChat(chat) {
  if (!chat?.id) return;
  try {
    const payload = await api(`/v1/app/chats/${encodeURIComponent(chat.id)}/export`);
    const resources = await api(`/v1/app/chats/${encodeURIComponent(chat.id)}/export/resources`);
    const baseName = safeFileName(chat.title || payload.chatSession?.title || chat.id);
    downloadJson(`${baseName}.chat.json`, payload);
    downloadJson(`${baseName}.chat.resources.json`, resources);
  } catch (error) {
    showToast(error.message || String(error));
  }
}

async function deleteActiveChat() {
  if (!state.activeChatId) return;
  await deleteChat(state.activeChat || state.chats.find((chat) => chat.id === state.activeChatId));
}

async function deleteChat(chat) {
  if (!chat?.id) return;
  const title = chat.title || chat.id;
  if (!confirm(`删除聊天「${title}」？`)) return;
  setBusy(true);
  try {
    await api(`/v1/app/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
    if (state.activeChatId === chat.id) {
      state.activeChatId = '';
      state.activeChat = undefined;
      localStorage.removeItem('ai-dnd-active-chat');
    }
    if (state.chatRename.chatId === chat.id) {
      state.chatRename = emptyChatRenameState();
    }
    await loadChats();
    renderAll();
    showToast('聊天已删除');
  } catch (error) {
    showToast(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function activateTab(tab) {
  for (const button of document.querySelectorAll('.tab-button')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const panel of document.querySelectorAll('.inspector-panel')) {
    panel.classList.toggle('active', panel.id === `${tab}Panel`);
  }
}

function updateControls() {
  const hasCharacter = Boolean(els.characterSelect.value);
  const hasChat = Boolean(state.activeChatId);
  const adjudicationLocked = Boolean(state.adjudicationOverlay.current);
  const combatLocked = isCombatOverlayLocked();
  const persuasionLocked = Boolean(state.persuasionOverlay.open);
  els.characterAvatarButton.disabled = !hasCharacter || state.busy;
  els.editCharacterButton.disabled = !hasCharacter || state.busy;
  els.exportCharacterButton.disabled = !hasCharacter || state.busy;
  els.deleteCharacterButton.disabled = !hasCharacter || state.busy;
  els.saveCharacterButton.disabled = !state.characterEditor.characterId || state.busy;
  els.exportCharacterFromEditorButton.disabled = !state.characterEditor.characterId || state.busy;
  els.openInitialSettingButton.disabled = !hasCharacter || state.busy;
  els.openChatImportButton.disabled = state.busy;
  els.newChatButton.disabled = !hasCharacter || state.busy;
  els.importChatButton.disabled = state.busy;
  if ((!hasChat || state.busy || adjudicationLocked || combatLocked || persuasionLocked) && state.playerActionMenuOpen) {
    closePlayerActionMenu();
  }
  els.messageInput.disabled = !hasChat || state.busy || adjudicationLocked || combatLocked || persuasionLocked;
  els.sendButton.disabled = !hasChat || state.busy || adjudicationLocked || combatLocked || persuasionLocked;
  els.togglePlayerActionMenuButton.disabled = !hasChat || state.busy || adjudicationLocked || combatLocked || persuasionLocked;
  for (const button of els.playerActionMenuPanel?.querySelectorAll('[data-player-action]') || []) {
    button.disabled = !hasChat || state.busy || adjudicationLocked || combatLocked || persuasionLocked;
  }
  els.exportChatButton.disabled = !hasChat || state.busy;
  els.deleteChatButton.disabled = !hasChat || state.busy;
  els.planContextButton.disabled = !hasChat || state.busy;
  els.refreshDataButton.disabled = !hasChat || state.busy;
  const canSwitchLoop = hasChat
    && state.loopHotSwitch.available
    && state.loopHotSwitch.configs.length > 0
    && !state.loopHotSwitch.loading
    && !state.busy;
  els.refreshLoopHotSwitchButton.disabled = state.busy || state.loopHotSwitch.loading;
  els.loopConfigHotSelect.disabled = !canSwitchLoop;
  els.switchLoopHotButton.disabled = !canSwitchLoop
    || !state.loopHotSwitch.selectedConfigId
    || state.loopHotSwitch.selectedConfigId === state.loopHotSwitch.activeConfigId;
  if (els.refreshWorldDrawerButton) {
    els.refreshWorldDrawerButton.disabled = !hasChat || state.busy || state.worldDrawer.loading;
  }
  for (const button of els.messageList?.querySelectorAll('.message-tool-button') || []) {
    button.disabled = state.busy || (button.title === '修改这条消息' && Boolean(state.messageEdit.messageId));
  }
  for (const button of els.chatList?.querySelectorAll('.chat-action-button') || []) {
    button.disabled = state.busy || (button.title === '改名聊天' && Boolean(state.chatRename.chatId));
  }
  const chatRenameInput = els.chatList?.querySelector('.chat-rename-input');
  if (chatRenameInput) chatRenameInput.disabled = state.busy;
  const messageEditor = els.messageList?.querySelector('.message-edit-textarea');
  if (messageEditor) messageEditor.disabled = state.busy;
  setInitialSettingEditorBusy(state.busy);
  renderDebugPanelControls();
}

function setBusy(busy) {
  state.busy = busy;
  updateControls();
}

function setConnection(text) {
  els.connectionStatus.textContent = text;
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
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private or file contexts.
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private or file contexts.
  }
}

function loadInitialSettingEditorPosition() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INITIAL_SETTING_EDITOR_POSITION_KEY) || 'null');
    if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function placeInitialSettingEditor() {
  requestAnimationFrame(() => {
    const rect = els.initialSettingEditor.getBoundingClientRect();
    const fallback = {
      left: Math.max(12, window.innerWidth - rect.width - 24),
      top: 86
    };
    const position = state.initialSetting.position || fallback;
    setInitialSettingEditorPosition(position.left, position.top);
  });
}

function setInitialSettingEditorPosition(left, top) {
  const rect = els.initialSettingEditor.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  const next = {
    left: Math.min(Math.max(8, Number(left) || 8), maxLeft),
    top: Math.min(Math.max(8, Number(top) || 8), maxTop)
  };
  els.initialSettingEditor.style.left = `${next.left}px`;
  els.initialSettingEditor.style.top = `${next.top}px`;
  els.initialSettingEditor.style.right = 'auto';
  state.initialSetting.position = next;
  localStorage.setItem(INITIAL_SETTING_EDITOR_POSITION_KEY, JSON.stringify(next));
}

function startInitialSettingDrag(event) {
  if (event.button !== 0 || event.target.closest('button')) return;
  const rect = els.initialSettingEditor.getBoundingClientRect();
  state.initialSetting.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top
  };
  els.initialSettingEditorHeader.setPointerCapture?.(event.pointerId);
  document.addEventListener('pointermove', moveInitialSettingEditor);
  document.addEventListener('pointerup', stopInitialSettingDrag, { once: true });
}

function moveInitialSettingEditor(event) {
  const drag = state.initialSetting.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  setInitialSettingEditorPosition(
    drag.left + event.clientX - drag.startX,
    drag.top + event.clientY - drag.startY
  );
}

function stopInitialSettingDrag(event) {
  if (state.initialSetting.drag?.pointerId === event.pointerId) {
    els.initialSettingEditorHeader.releasePointerCapture?.(event.pointerId);
    state.initialSetting.drag = undefined;
  }
  document.removeEventListener('pointermove', moveInitialSettingEditor);
}

function loadPlayerDbQueryControl() {
  try {
    return normalizePlayerDbQueryControl(JSON.parse(localStorage.getItem(PLAYER_DB_QUERY_CONTROL_KEY) || 'null'));
  } catch {
    return defaultPlayerDbQueryControl();
  }
}

function defaultPlayerDbQueryControl() {
  return {
    version: 1,
    actions: {}
  };
}

function clonePlayerDbQueryControl(input) {
  return normalizePlayerDbQueryControl(JSON.parse(JSON.stringify(input || defaultPlayerDbQueryControl())));
}

function normalizePlayerDbQueryControl(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const normalized = defaultPlayerDbQueryControl();
  const actions = raw.actions && typeof raw.actions === 'object' ? raw.actions : {};
  for (const action of new Set([...Object.keys(PLAYER_ACTIONS), ...Object.keys(actions)])) {
    const actionInput = actions[action];
    if (!actionInput || typeof actionInput !== 'object') continue;
    const collections = actionInput.collections && typeof actionInput.collections === 'object'
      ? actionInput.collections
      : {};
    const allowedCollections = getPlayerActionCollections(action);
    const collectionNames = allowedCollections.length > 0 ? allowedCollections : Object.keys(collections);
    for (const collection of collectionNames) {
      const collectionInput = collections[collection];
      if (!collectionInput || typeof collectionInput !== 'object') continue;
      const mode = collectionInput.mode === 'selected' ? 'selected' : 'all';
      const fields = Array.isArray(collectionInput.fields)
        ? [...new Set(collectionInput.fields.map((field) => String(field || '').trim()).filter(Boolean))]
        : [];
      if (mode === 'selected') {
        ensurePlayerDbQueryCollectionConfig(normalized, action, collection).mode = 'selected';
        ensurePlayerDbQueryCollectionConfig(normalized, action, collection).fields = fields;
      }
    }
  }
  return normalized;
}

function getPlayerDbQueryCollectionConfig(control, action, collection) {
  return control?.actions?.[action]?.collections?.[collection] || { mode: 'all', fields: [] };
}

function ensurePlayerDbQueryCollectionConfig(control, action, collection) {
  control.actions ||= {};
  control.actions[action] ||= { collections: {} };
  control.actions[action].collections ||= {};
  control.actions[action].collections[collection] ||= { mode: 'all', fields: [] };
  return control.actions[action].collections[collection];
}

function isPlayerDbQueryFieldVisible(action, collection, field) {
  const config = getPlayerDbQueryCollectionConfig(state.playerDbQueryControl, action, collection);
  return config.mode !== 'selected' || (config.fields || []).includes(field);
}

function playerDbQueryRestrictionCount(control) {
  let count = 0;
  for (const action of new Set([...Object.keys(PLAYER_ACTIONS), ...Object.keys(control?.actions || {})])) {
    const configured = Object.keys(control?.actions?.[action]?.collections || {});
    const known = getPlayerActionCollections(action);
    for (const collection of known.length > 0 ? known : configured) {
      if (getPlayerDbQueryCollectionConfig(control, action, collection).mode === 'selected') count += 1;
    }
  }
  return count;
}

function dbQueryFieldNames(collectionInfo = {}) {
  return (collectionInfo.fields || [])
    .map((field) => field.name)
    .filter(Boolean);
}

function loadApiSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(API_SETTINGS_KEY) || 'null');
    return normalizeApiSettings(stored || DEFAULT_API_SETTINGS);
  } catch {
    return { ...DEFAULT_API_SETTINGS };
  }
}

function loadSystemPromptSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SYSTEM_PROMPT_SETTINGS_KEY) || 'null');
    return normalizeSystemPromptSettings(stored || DEFAULT_SYSTEM_PROMPT_SETTINGS);
  } catch {
    return { ...DEFAULT_SYSTEM_PROMPT_SETTINGS };
  }
}

function normalizeSystemPromptSettings(input = {}) {
  return {
    mainPrompt: String(input.mainPrompt || '').trim()
  };
}

function normalizeApiSettings(input = {}) {
  const provider = Object.prototype.hasOwnProperty.call(API_PROVIDER_CONFIG, input.provider)
    ? input.provider
    : DEFAULT_API_SETTINGS.provider;
  return {
    provider,
    baseUrl: String(input.baseUrl || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    model: String(input.model || '').trim(),
    temperature: String(input.temperature ?? '').trim(),
    maxTokens: String(input.maxTokens ?? '').trim()
  };
}

function applyApiProviderDefaults() {
  const provider = els.apiProviderSelect.value;
  const currentBaseUrl = els.apiBaseUrl.value.trim();
  const knownBaseUrls = new Set(Object.values(API_PROVIDER_CONFIG).map((config) => config.baseUrl).filter(Boolean));
  const nextBaseUrl = API_PROVIDER_CONFIG[provider]?.baseUrl || '';
  if (!currentBaseUrl || knownBaseUrls.has(currentBaseUrl)) {
    els.apiBaseUrl.value = nextBaseUrl;
  }
  updateApiProviderPlaceholders();
  markApiSettingsDraftChanged();
}

function updateApiProviderPlaceholders() {
  const config = API_PROVIDER_CONFIG[els.apiProviderSelect.value] || API_PROVIDER_CONFIG.server;
  els.apiBaseUrl.placeholder = config.baseUrl || '服务端配置';
  els.apiModel.placeholder = config.modelPlaceholder || '';
}

function markApiSettingsDraftChanged() {
  setApiConnectionStatus('当前表单尚未保存；点击“保存并应用”后会用于聊天回复。');
}

function buildChatRequestOptions() {
  const options = { source: 'web-ui' };
  const sceneId = inferChatRequestSceneId();
  if (sceneId) {
    options.sceneId = sceneId;
    options.currentSceneId = sceneId;
  }
  const agentAccessPolicy = loadManagedAgentAccessPolicy();
  if (agentAccessPolicy) {
    options.agentAccessPolicy = agentAccessPolicy;
  }
  const llmPromptOverrides = loadManagedToolPromptOverrides();
  if (llmPromptOverrides) {
    options.llmPromptOverrides = llmPromptOverrides;
    options.llm = {
      ...(options.llm || {}),
      promptOverrides: llmPromptOverrides
    };
  }
  const effectiveSettings = resolveEffectiveChatApiSettings();
  const temperature = parseFiniteNumber(effectiveSettings?.temperature);
  if (temperature !== undefined) {
    options.temperature = temperature;
  }
  const maxTokens = parsePositiveInteger(effectiveSettings?.maxTokens);
  if (maxTokens !== undefined) {
    options.maxTokens = maxTokens;
  }
  const api = buildRequestApiSettings();
  if (api) {
    options.api = api;
  }
  if (state.systemPrompt.mainPrompt) {
    options.promptPreset = {
      ...(options.promptPreset || {}),
      mainPrompt: state.systemPrompt.mainPrompt,
      ignoreCharacterSystemPrompt: true
    };
  }
  return options;
}

function inferChatRequestSceneId() {
  const latest = latestAssistantMessage(state.activeChat);
  const latestMetadata = messageMetadata(latest);
  const chatMetadata = state.activeChat?.metadata && typeof state.activeChat.metadata === 'object'
    ? state.activeChat.metadata
    : {};
  const sceneId = firstSceneVisualSceneId(
    chatMetadata.sceneId,
    chatMetadata.currentSceneId,
    latestMetadata.agentLoop?.sceneId,
    latestMetadata.agentLoop?.currentSceneId,
    latestMetadata.sceneId,
    latestMetadata.currentSceneId
  );
  return sceneId && sceneId !== 'current' ? sceneId : '';
}

function buildManagedToolExecutionContext(base = {}) {
  const context = { ...(base || {}) };
  const agentAccessPolicy = loadManagedAgentAccessPolicy();
  if (agentAccessPolicy) {
    context.agentAccessPolicy = context.agentAccessPolicy || agentAccessPolicy;
    context.agentAccess = {
      ...(context.agentAccess || {}),
      policy: context.agentAccess?.policy || agentAccessPolicy,
      source: context.agentAccess?.source || 'web-ui'
    };
  }

  const llmPromptOverrides = loadManagedToolPromptOverrides();
  if (llmPromptOverrides) {
    context.llmPromptOverrides = {
      ...llmPromptOverrides,
      ...(context.llmPromptOverrides || {})
    };
    context.llm = {
      ...(context.llm || {}),
      promptOverrides: {
        ...llmPromptOverrides,
        ...(context.llm?.promptOverrides || {})
      }
    };
  }

  const targets = loadManagedApiTargets();
  if (targets) {
    context.llm = {
      ...(context.llm || {}),
      targets: {
        ...targets,
        ...(context.llm?.targets || {})
      }
    };
    if (!context.api && targets['tool-calling']) {
      context.api = targets['tool-calling'];
    }
  }
  return context;
}

function buildRequestApiSettings() {
  const settings = resolveEffectiveChatApiSettings();
  if (!settings || settings.provider === 'server') return undefined;
  const api = { provider: settings.provider };
  for (const key of ['baseUrl', 'apiKey', 'model']) {
    if (settings[key]) {
      api[key] = settings[key];
    }
  }
  return api;
}

function resolveEffectiveChatApiSettings() {
  if (state.apiSettings?.provider && state.apiSettings.provider !== 'server') {
    return state.apiSettings;
  }
  return loadManagedApiTarget('chat') || state.apiSettings;
}

function loadManagedApiTarget(targetId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_TARGET_SETTINGS_KEY) || '{}');
    const targets = parsed.targets && typeof parsed.targets === 'object' ? parsed.targets : parsed;
    const settings = targets?.[targetId];
    const normalized = normalizeApiSettings(settings || {});
    return normalized.provider === 'server' ? undefined : normalized;
  } catch {
    return undefined;
  }
}

function loadManagedApiTargets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_TARGET_SETTINGS_KEY) || '{}');
    const rawTargets = parsed.targets && typeof parsed.targets === 'object' ? parsed.targets : parsed;
    if (!rawTargets || typeof rawTargets !== 'object') return undefined;
    const targets = Object.fromEntries(Object.entries(rawTargets)
      .map(([targetId, settings]) => [targetId, normalizeApiSettings(settings || {})])
      .filter(([targetId, settings]) => targetId && settings.provider && settings.provider !== 'server'));
    return Object.keys(targets).length > 0 ? targets : undefined;
  } catch {
    return undefined;
  }
}

function loadManagedAgentAccessPolicy() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENT_ACCESS_POLICY_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return undefined;
    const normalizeResource = (resource) => ({
      read: parsed[resource]?.read !== false,
      write: parsed[resource]?.write !== false
    });
    const normalizeSpecificResource = (resource, fallbackResource) => ({
      read: parsed[resource]?.read ?? parsed[fallbackResource]?.read ?? true,
      write: parsed[resource]?.write ?? parsed[fallbackResource]?.write ?? true
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
      tools: parsed.tools && typeof parsed.tools === 'object' ? parsed.tools : {}
    };
  } catch {
    return undefined;
  }
}

function loadManagedToolPromptOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOOL_PROMPT_SETTINGS_KEY) || 'null');
    const rawPrompts = parsed?.prompts && typeof parsed.prompts === 'object'
      ? parsed.prompts
      : parsed;
    if (!rawPrompts || typeof rawPrompts !== 'object') return undefined;
    const prompts = Object.fromEntries(Object.entries(rawPrompts)
      .map(([toolId, settings]) => [toolId, normalizeManagedToolPromptSettings(settings)])
      .filter(([toolId, settings]) => toolId && settings.enabled && toolPromptHasManagedContent(settings)));
    return Object.keys(prompts).length > 0 ? prompts : undefined;
  } catch {
    return undefined;
  }
}

function normalizeManagedToolPromptSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: raw.enabled === true,
    mode: raw.mode === 'replace' ? 'replace' : 'inject',
    replacementPrompt: String(raw.replacementPrompt || raw.replacement || raw.prompt || '').trim(),
    systemPrompt: String(raw.systemPrompt || raw.system || '').trim(),
    promptPrefix: String(raw.promptPrefix || raw.prefix || '').trim(),
    promptSuffix: String(raw.promptSuffix || raw.suffix || '').trim(),
    references: String(raw.references || raw.referenceMaterial || raw.reference || '').trim()
  };
}

function toolPromptHasManagedContent(settings = {}) {
  return Boolean(
    settings.replacementPrompt ||
    settings.systemPrompt ||
    settings.promptPrefix ||
    settings.promptSuffix ||
    settings.references
  );
}

function parseFiniteNumber(value) {
  if (value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parsePositiveInteger(value) {
  if (value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.floor(number);
}

function findCharacter(id) {
  return state.characters.find((character) => character.id === id);
}

function lastMessage(chat) {
  const messages = chat?.messages || [];
  return messages[messages.length - 1];
}

function lastUserMessage(chat) {
  return [...(chat?.messages || [])].reverse().find((message) => message.role === 'user');
}

function metric(text) {
  const element = document.createElement('span');
  element.textContent = text;
  return element;
}

function infoRow(title, detail) {
  const row = document.createElement('div');
  row.className = 'info-row';
  const strong = document.createElement('strong');
  strong.textContent = title || '';
  const span = document.createElement('span');
  span.textContent = detail || '';
  row.append(strong, span);
  return row;
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefined(item)])
    );
  }
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function normalizeDegrees(value) {
  let normalized = value;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

function initials(value) {
  const text = String(value || '?').trim();
  if (!text) return '?';
  const letters = Array.from(text.replace(/\s+/g, ''));
  return letters.slice(0, 2).join('').toUpperCase();
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function safeFileName(value) {
  return String(value || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'chat';
}

function parseOptionalJson(value, label) {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} JSON 格式错误：${error.message}`);
  }
}

function downloadJson(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
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
