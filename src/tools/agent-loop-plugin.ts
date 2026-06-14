// @ts-nocheck
import { AgentTurnLoop } from '../loop/agent-turn-loop.js';

export const AGENT_LOOP_PLUGIN = {
  id: 'system.agent_loop',
  name: 'Agent Turn Loop Tools',
  version: '0.1.0',
  description: 'Configurable and debuggable one-turn agent loop orchestration. The loop is decoupled from business modules and dispatches them through editable phase profiles.',
  enabled: true,
  permissions: ['agent-loop:read', 'agent-loop:write', 'agent-loop:run'],
  metadata: {
    writesTrace: true,
    decoupled: true
  },
  tools: [
    {
      name: 'describe_loop',
      title: 'Describe Agent Loop',
      description: 'Describe the default phase order, extension points, lifecycle, profile storage, and trace behavior.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'schema', 'debug']
    },
    {
      name: 'list_templates',
      title: 'List Agent Loop Templates',
      description: 'List built-in editable loop templates. These are examples; users can copy and modify them.',
      inputSchema: {
        type: 'object',
        properties: {
          includePhases: { type: 'boolean', default: false }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'template', 'debug']
    },
    {
      name: 'get_template',
      title: 'Get Agent Loop Template',
      description: 'Get one built-in agent loop template with full editable phase definitions.',
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'template']
    },
    {
      name: 'list_profiles',
      title: 'List Agent Loop Profiles',
      description: 'List user-saved loop profiles stored in SQLite plus built-in template summaries.',
      inputSchema: listProfilesSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'profile', 'database']
    },
    {
      name: 'get_profile',
      title: 'Get Agent Loop Profile',
      description: 'Get a stored user loop profile or a built-in template by id.',
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'profile']
    },
    {
      name: 'upsert_profile',
      title: 'Create Or Replace Agent Loop Profile',
      description: 'Save a user-modified agent loop profile. Requires explicit user authorization.',
      inputSchema: upsertProfileSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        idempotent: true
      },
      tags: ['agent-loop', 'profile', 'write']
    },
    {
      name: 'delete_profile',
      title: 'Delete Agent Loop Profile',
      description: 'Delete one stored user loop profile. Built-in templates cannot be deleted. Requires explicit user authorization.',
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        destructive: true
      },
      tags: ['agent-loop', 'profile', 'delete']
    },
    {
      name: 'describe_loop_manager',
      title: 'Describe Loop Manager',
      description: 'Describe the higher-level loop config manager: profile vs flow config, step stitching, active hot-switch pointers, and config archives.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'config', 'flow', 'debug']
    },
    {
      name: 'list_configs',
      title: 'List Loop Flow Configs',
      description: 'List saved loop flow configs plus built-in flow templates. A config stitches one or more loop profiles into ordered steps.',
      inputSchema: listConfigsSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'config', 'flow', 'database']
    },
    {
      name: 'get_config',
      title: 'Get Loop Flow Config',
      description: 'Get a stored loop flow config or a built-in flow template by id, including step profile bindings and handoff settings.',
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'config', 'flow']
    },
    {
      name: 'preview_config',
      title: 'Preview Loop Flow Blueprint',
      description: 'Resolve a flow config into the unified ai-dnd-loop-flow-preview/v1 blueprint used by the graphical manager: ordered steps, resolved modules, data contracts, prompts, and tool calls.',
      inputSchema: previewConfigSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'config', 'flow', 'preview', 'debug']
    },
    {
      name: 'upsert_config',
      title: 'Create Or Replace Loop Flow Config',
      description: 'Save a loop flow config that defines step order, profile selection, handoff policy, and hot-switch defaults. Requires explicit user authorization.',
      inputSchema: upsertConfigSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        idempotent: true
      },
      tags: ['agent-loop', 'config', 'flow', 'write']
    },
    {
      name: 'delete_config',
      title: 'Delete Loop Flow Config',
      description: 'Delete one stored loop flow config. Built-in flow templates cannot be deleted. Requires explicit user authorization.',
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        destructive: true
      },
      tags: ['agent-loop', 'config', 'delete']
    },
    {
      name: 'get_active_config',
      title: 'Get Active Loop Config',
      description: 'Read the currently active loop flow config for a scope. This is the hot-switch pointer used when no explicit profileId/configId is supplied.',
      inputSchema: activeConfigSchema({ requireConfigId: false }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'config', 'hot-switch']
    },
    {
      name: 'switch_config',
      title: 'Hot-Switch Active Loop Config',
      description: 'Change the active loop flow config for a scope without restarting the app. Subsequent implicit loop runs use the selected config. Requires explicit user authorization.',
      inputSchema: activeConfigSchema({ requireConfigId: true }),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        hotSwitch: true
      },
      tags: ['agent-loop', 'config', 'hot-switch', 'write']
    },
    {
      name: 'archive_config',
      title: 'Archive Loop Config Snapshot',
      description: 'Create an immutable snapshot of a loop flow config for rollback, comparison, or per-loop record keeping. Requires explicit user authorization.',
      inputSchema: archiveConfigSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        requiresUserAuthorization: true,
        archival: true
      },
      tags: ['agent-loop', 'config', 'archive', 'write']
    },
    {
      name: 'list_config_archives',
      title: 'List Loop Config Archives',
      description: 'List archived loop flow config snapshots, optionally filtered by config id.',
      inputSchema: listConfigArchivesSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['agent-loop', 'config', 'archive']
    },
    {
      name: 'dry_run_config_turn',
      title: 'Dry-Run Loop Flow Config',
      description: 'Run all enabled steps in a loop flow config in dry-run mode. Each step keeps its own output and trace, and later steps receive previous output metadata.',
      inputSchema: configTurnInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      metadata: {
        writesTrace: true
      },
      tags: ['agent-loop', 'config', 'flow', 'dry-run', 'trace']
    },
    {
      name: 'run_config_turn',
      title: 'Run Loop Flow Config',
      description: 'Run all enabled steps in a loop flow config and execute each step according to its profile. Requires explicit user authorization.',
      inputSchema: configTurnInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        writesTrace: true,
        requiresUserAuthorization: true,
        openWorld: true
      },
      tags: ['agent-loop', 'config', 'flow', 'run', 'write']
    },
    {
      name: 'dry_run_turn',
      title: 'Dry-Run Agent Turn',
      description: 'Run the configured loop in dry-run mode and write explicit intermediate trace files without committing state.',
      inputSchema: turnInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      metadata: {
        writesTrace: true
      },
      tags: ['agent-loop', 'turn', 'dry-run', 'trace']
    },
    {
      name: 'run_turn',
      title: 'Run Agent Turn',
      description: 'Run the configured loop and execute phase tool calls. Mutating tools still require normal tool authorization. This outer call requires explicit user authorization.',
      inputSchema: turnInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        writesTrace: true,
        requiresUserAuthorization: true,
        openWorld: true
      },
      tags: ['agent-loop', 'turn', 'run', 'write']
    }
  ]
};

export function createAgentLoopHandlers({
  toolManager,
  appDatabase,
  dataManager,
  chatProvider,
  loop,
  trace,
  progress
} = {}) {
  const agentLoop = loop || new AgentTurnLoop({
    toolManager,
    appDatabase,
    dataManager,
    chatProvider,
    trace,
    progress
  });
  return {
    describe_loop: async () => agentLoop.describe(),
    list_templates: async ({ input }) => agentLoop.listTemplates(input),
    get_template: async ({ input }) => agentLoop.getTemplate(input.id),
    list_profiles: async ({ input }) => agentLoop.listProfiles(input),
    get_profile: async ({ input }) => agentLoop.getProfile(input.id),
    upsert_profile: async ({ input }) => agentLoop.upsertProfile(input),
    delete_profile: async ({ input }) => agentLoop.deleteProfile(input.id),
    describe_loop_manager: async () => agentLoop.describeManagement(),
    list_configs: async ({ input }) => agentLoop.listConfigs(input),
    get_config: async ({ input }) => agentLoop.getConfig(input.id),
    preview_config: async ({ input }) => agentLoop.previewConfig(input),
    upsert_config: async ({ input }) => agentLoop.upsertConfig(input),
    delete_config: async ({ input }) => agentLoop.deleteConfig(input.id),
    get_active_config: async ({ input }) => agentLoop.getActiveConfig(input),
    switch_config: async ({ input }) => agentLoop.switchConfig(input),
    archive_config: async ({ input }) => agentLoop.archiveConfig(input),
    list_config_archives: async ({ input }) => agentLoop.listConfigArchives(input),
    dry_run_config_turn: async ({ input }) => agentLoop.dryRunConfigTurn(input),
    run_config_turn: async ({ input }) => agentLoop.runConfigTurn({
      ...input,
      dryRun: input.dryRun === true
    }),
    dry_run_turn: async ({ input }) => agentLoop.dryRunTurn(input),
    run_turn: async ({ input }) => agentLoop.runTurn({
      ...input,
      dryRun: input.dryRun === true
    })
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function idSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 }
    },
    required: ['id'],
    additionalProperties: false
  };
}

function listProfilesSchema() {
  return {
    type: 'object',
    properties: {
      filter: { type: 'object', additionalProperties: true },
      sort: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
      includePhases: { type: 'boolean', default: false },
      includeTemplatePhases: { type: 'boolean', default: false }
    },
    additionalProperties: false
  };
}

function upsertProfileSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      profileId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      tags: {
        type: 'array',
        items: { type: 'string' }
      },
      profile: profileSchema()
    },
    anyOf: [
      { required: ['profile'] },
      { required: ['id', 'phases'] }
    ],
    additionalProperties: true
  };
}

function listConfigsSchema() {
  return {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        description: 'SQLite/DataManager filter for saved loop configs.',
        additionalProperties: true
      },
      sort: {
        type: 'array',
        description: 'Sort fields for saved loop configs.',
        items: { type: 'object', additionalProperties: true }
      },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
      includeSteps: {
        type: 'boolean',
        description: 'Include saved config step summaries in the list response.',
        default: false
      },
      includeTemplateSteps: {
        type: 'boolean',
        description: 'Include built-in config template step summaries.',
        default: false
      }
    },
    additionalProperties: false
  };
}

function upsertConfigSchema() {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Stable id for the saved loop flow config.'
      },
      configId: {
        type: 'string',
        description: 'Alias for id.'
      },
      loopConfigId: {
        type: 'string',
        description: 'Alias for id.'
      },
      name: {
        type: 'string',
        description: 'Human-readable config name shown in managers.'
      },
      description: {
        type: 'string',
        description: 'What this loop flow is for.'
      },
      tags: {
        type: 'array',
        description: 'Search/filter tags for the flow.',
        items: { type: 'string' }
      },
      archiveExisting: {
        type: 'boolean',
        description: 'When true or omitted, replacing an existing config first writes an archive snapshot.',
        default: true
      },
      archiveLabel: {
        type: 'string',
        description: 'Optional label for the automatic archive snapshot.'
      },
      archiveReason: {
        type: 'string',
        description: 'Optional reason stored with the automatic archive snapshot.'
      },
      config: loopConfigSchema()
    },
    anyOf: [
      { required: ['config'] },
      { required: ['id', 'steps'] },
      { required: ['configId', 'steps'] },
      { required: ['loopConfigId', 'steps'] }
    ],
    additionalProperties: true
  };
}

function activeConfigSchema({ requireConfigId = false } = {}) {
  const schema = {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Loop flow config id to switch to.'
      },
      configId: {
        type: 'string',
        description: 'Loop flow config id to switch to.'
      },
      loopConfigId: {
        type: 'string',
        description: 'Loop flow config id to switch to.'
      },
      scope: {
        type: 'string',
        description: 'Hot-switch scope. Defaults to global.',
        default: 'global'
      },
      scopeId: {
        type: 'string',
        description: 'Scope instance id. Defaults to default; can be a campaign/chat id.',
        default: 'default'
      },
      reason: {
        type: 'string',
        description: 'Optional reason recorded on switch_config.'
      }
    },
    additionalProperties: false
  };
  if (requireConfigId) {
    schema.anyOf = [
      { required: ['id'] },
      { required: ['configId'] },
      { required: ['loopConfigId'] }
    ];
  }
  return schema;
}

function archiveConfigSchema() {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Loop flow config id to archive.'
      },
      configId: {
        type: 'string',
        description: 'Loop flow config id to archive.'
      },
      loopConfigId: {
        type: 'string',
        description: 'Loop flow config id to archive.'
      },
      archiveId: {
        type: 'string',
        description: 'Optional explicit archive record id.'
      },
      label: {
        type: 'string',
        description: 'Human-readable archive label.'
      },
      reason: {
        type: 'string',
        description: 'Why this snapshot is being kept.'
      },
      source: {
        type: 'string',
        description: 'Caller/source marker for this archive.'
      }
    },
    anyOf: [
      { required: ['id'] },
      { required: ['configId'] },
      { required: ['loopConfigId'] }
    ],
    additionalProperties: false
  };
}

function listConfigArchivesSchema() {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Optional config id filter.'
      },
      configId: {
        type: 'string',
        description: 'Optional config id filter.'
      },
      loopConfigId: {
        type: 'string',
        description: 'Optional config id filter.'
      },
      filter: {
        type: 'object',
        description: 'Additional DataManager filter.',
        additionalProperties: true
      },
      sort: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function previewConfigSchema() {
  const base = configTurnInputSchema();
  return {
    type: 'object',
    properties: {
      ...base.properties,
      id: {
        type: 'string',
        description: 'Loop flow config id to preview. Alias for configId.'
      },
      includeSourceConfig: {
        type: 'boolean',
        description: 'Reserved for managers. The current preview includes sourceConfig summaries by default.',
        default: true
      }
    },
    additionalProperties: true
  };
}

function configTurnInputSchema() {
  const base = turnInputSchema();
  return {
    type: 'object',
    properties: {
      ...base.properties,
      configId: {
        type: 'string',
        description: 'Loop flow config id to run. If omitted, the active hot-switch config is used.'
      },
      loopConfigId: {
        type: 'string',
        description: 'Alias for configId.'
      },
      config: loopConfigSchema(),
      useActiveConfig: {
        type: 'boolean',
        description: 'When true or omitted, use the active config if configId is not supplied.',
        default: true
      },
      scope: {
        type: 'string',
        description: 'Active-config scope used when configId is omitted.',
        default: 'global'
      },
      scopeId: {
        type: 'string',
        description: 'Active-config scope id used when configId is omitted.',
        default: 'default'
      }
    },
    additionalProperties: true
  };
}

function turnInputSchema() {
  return {
    type: 'object',
    properties: {
      turnId: { type: 'string' },
      chatSessionId: { type: 'string' },
      chatId: { type: 'string' },
      sessionId: { type: 'string' },
      sceneId: { type: 'string' },
      currentSceneId: { type: 'string' },
      text: { type: 'string' },
      currentInput: { type: 'string' },
      userInput: { type: 'string' },
      query: { type: 'string' },
      messages: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      profileId: { type: 'string' },
      configId: {
        type: 'string',
        description: 'Optional loop flow config id. When supplied without profileId, its activeProfileId selects the profile.'
      },
      loopConfigId: {
        type: 'string',
        description: 'Alias for configId.'
      },
      useActiveConfig: {
        type: 'boolean',
        description: 'When true or omitted, implicit runs may use the hot-switched active config profile.',
        default: true
      },
      scope: {
        type: 'string',
        description: 'Active-config scope for implicit profile selection.',
        default: 'global'
      },
      scopeId: {
        type: 'string',
        description: 'Active-config scope id for implicit profile selection.',
        default: 'default'
      },
      profile: profileSchema(),
      config: loopConfigSchema(),
      phaseOverrides: {
        type: 'array',
        items: phaseSchema()
      },
      routerPolicy: routerPolicySchema(),
      dryRun: { type: 'boolean' },
      allowExternalApiInDryRun: {
        type: 'boolean',
        description: 'Default false. When false, dry-run does not call external LLM/API providers; LLM phases and LLM-tagged tool calls are planned/skipped only.'
      },
      dryRunAllowExternalApi: {
        type: 'boolean',
        description: 'Alias for allowExternalApiInDryRun.'
      },
      useLlm: { type: 'boolean' },
      useLlmNarrative: { type: 'boolean' },
      maxContextTokens: { type: 'integer', minimum: 1 },
      recentMessageCount: { type: 'integer', minimum: 0 },
      contextPlanner: { type: 'boolean' },
      contextPlannerInput: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true },
      toolContext: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  };
}

function loopConfigSchema() {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Stable loop flow id.'
      },
      configId: {
        type: 'string',
        description: 'Alias for id.'
      },
      loopConfigId: {
        type: 'string',
        description: 'Alias for id.'
      },
      name: {
        type: 'string',
        description: 'Human-readable name.'
      },
      title: {
        type: 'string',
        description: 'Alias for name.'
      },
      description: {
        type: 'string',
        description: 'What this loop flow is for.'
      },
      version: {
        type: 'string',
        description: 'Config version label.'
      },
      inherit: {
        type: 'boolean',
        description: 'When false with an inline config, replace the base config instead of merging.'
      },
      replaceSteps: {
        type: 'boolean',
        description: 'When true, replace all base flow steps with this config steps array.'
      },
      mutableByUser: {
        type: 'boolean',
        description: 'Whether managers should allow editing this config.'
      },
      activeProfileId: {
        type: 'string',
        description: 'Default profile id used by implicit single-loop runs and by steps without profileId.'
      },
      tags: {
        type: 'array',
        items: { type: 'string' }
      },
      metadata: {
        type: 'object',
        description: 'Free-form manager metadata for this flow.',
        additionalProperties: true
      },
      phaseProgressLabels: progressLabelsSchema('Flow-wide fallback progress labels keyed by phase id. step.phaseProgressLabels and phase.progressLabel can override these.'),
      progressLabels: progressLabelsSchema('Alias for phaseProgressLabels.'),
      routerPolicy: routerPolicySchema(),
      hotSwitch: {
        type: 'object',
        description: 'Hot-switch defaults such as enabled, scope, and scopeId.',
        additionalProperties: true
      },
      archive: {
        type: 'object',
        description: 'Archive policy metadata.',
        additionalProperties: true
      },
      handoff: {
        type: 'object',
        description: 'Default handoff policy for all steps. step.handoff can override it.',
        properties: {
          tokenMode: handoffTokenModeSchema()
        },
        additionalProperties: true
      },
      steps: {
        type: 'array',
        description: 'Ordered loop steps. Each step usually points at one loop profile.',
        items: loopConfigStepSchema()
      }
    },
    additionalProperties: true
  };
}

function loopConfigStepSchema() {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Stable step id within the flow.'
      },
      title: {
        type: 'string',
        description: 'Human-readable step label.'
      },
      name: {
        type: 'string',
        description: 'Alias for title.'
      },
      description: {
        type: 'string',
        description: 'What this step does in the stitched flow.'
      },
      order: {
        type: 'number',
        description: 'Numeric execution order.'
      },
      enabled: {
        type: 'boolean',
        description: 'Disabled steps are skipped entirely.'
      },
      required: {
        type: 'boolean',
        description: 'When false, a failing step is recorded and the next step can continue.'
      },
      mode: {
        type: 'string',
        description: 'Execution mode label. Current runtime supports turn-style profile execution.'
      },
      executionModel: {
        type: 'string',
        description: 'How this step is executed. profile uses the selected profile as-is; profile-modules patches the editable modules array over the selected profile.'
      },
      profileId: {
        type: 'string',
        description: 'Loop profile id to run for this step.'
      },
      replaceProfilePhases: {
        type: 'boolean',
        description: 'When true and modules are present, modules replace the selected profile phases. When false, modules are merged as phase overrides.'
      },
      modules: {
        type: 'array',
        description: 'Editable ordered phase/module list for this step. These are existing loop phase modules; changing order, enabled, config, promptTemplate, and toolCalls changes runtime behavior.',
        items: loopStepModuleSchema()
      },
      moduleSequence: {
        type: 'array',
        description: 'Compact module order. Prefer modules for editable details; string entries here are expanded as phase ids.',
        items: {
          anyOf: [
            { type: 'string' },
            loopStepModuleSchema()
          ]
        }
      },
      toolCallSequence: {
        type: 'array',
        description: 'Derived readable order of tool calls under modules. Runtime executes module.toolCalls in module order.',
        items: {
          type: 'object',
          additionalProperties: true
        }
      },
      profile: profileSchema(),
      phaseOverrides: {
        type: 'array',
        description: 'Optional per-step phase overrides merged into the selected profile.',
        items: phaseSchema()
      },
      phaseProgressLabels: progressLabelsSchema('Per-step progress labels keyed by phase id, for example {"route.intent":"正在理解玩家意图..."}.' ),
      progressLabels: progressLabelsSchema('Alias for phaseProgressLabels.'),
      routerPolicy: routerPolicySchema(),
      input: {
        type: 'object',
        description: 'Per-step input override. Supports {{request.*}}, {{config.*}}, {{step.*}}, and {{previous.*}} templates.',
        additionalProperties: true
      },
      handoff: {
        type: 'object',
        description: 'How prior step output is handed to this step. tokenMode selects full, light, super, or extreme compaction.',
        properties: {
          tokenMode: handoffTokenModeSchema(),
          input: {
            type: 'string',
            description: 'preserve, previous_narrative, or previous_intent.'
          },
          previousOutput: {
            type: 'string',
            description: 'Documented destination for the selected previous output object. Its shape depends on tokenMode.'
          },
          previousSummary: {
            type: 'string',
            description: 'Documented destination for the clipped previous loop summary.'
          }
        },
        additionalProperties: true
      },
      metadata: {
        type: 'object',
        description: 'Per-step metadata merged into runtime metadata.',
        additionalProperties: true
      }
    },
    required: ['id'],
    additionalProperties: true
  };
}

function loopStepModuleSchema() {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Existing phase/module id, for example route.intent or narrative.render.'
      },
      phaseId: {
        type: 'string',
        description: 'Alias for id.'
      },
      title: {
        type: 'string',
        description: 'Human-readable module label.'
      },
      description: {
        type: 'string',
        description: 'What this module contributes to the loop.'
      },
      order: {
        type: 'number',
        description: 'Execution order inside the step.'
      },
      enabled: {
        type: 'boolean',
        description: 'Disabled modules are skipped.'
      },
      required: {
        type: 'boolean',
        description: 'When false, this module can fail without aborting the step.'
      },
      mode: {
        type: 'string',
        description: 'Phase handler mode label. Existing built-in ids use their registered handlers.'
      },
      llm: {
        type: 'boolean',
        description: 'Whether this module prepares or calls LLM logic.'
      },
      mutatesState: {
        type: 'boolean',
        description: 'Whether this module is expected to write state.'
      },
      mayMutate: {
        type: 'boolean',
        description: 'Whether this module may write state through configured toolCalls.'
      },
      progressLabel: {
        type: 'string',
        description: 'User-facing progress text while this module runs.'
      },
      promptTemplate: {
        type: 'string',
        description: 'Prompt template used by LLM-capable modules.'
      },
      config: {
        type: 'object',
        description: 'Module-specific configuration passed to its phase handler.',
        additionalProperties: true
      },
      toolCalls: {
        type: 'array',
        description: 'Ordered calls to existing tools after this module handler runs.',
        items: toolCallSchema()
      },
      metadata: {
        type: 'object',
        description: 'Free-form manager metadata for this module.',
        additionalProperties: true
      }
    },
    required: ['id'],
    additionalProperties: true
  };
}

function toolCallSchema() {
  return {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Stable call id within the module.'
      },
      toolId: {
        type: 'string',
        description: 'Existing tool id to call.'
      },
      order: {
        type: 'number',
        description: 'Execution order inside module.toolCalls.'
      },
      enabled: {
        type: 'boolean',
        description: 'Disabled tool calls are skipped.'
      },
      required: {
        type: 'boolean',
        description: 'When true, a failed tool call records an error for the phase.'
      },
      execute: {
        type: 'boolean',
        description: 'Set false to keep this as a planned call only.'
      },
      executeInDryRun: {
        type: 'boolean',
        description: 'Allow executing this non-mutating tool during dry-run.'
      },
      progressLabel: {
        type: 'string',
        description: 'User-facing progress text while the tool call runs.'
      },
      input: {
        type: 'object',
        description: 'Tool input. Supports {{state.*}}, {{request.*}}, and {{phase.*}} templates at runtime.',
        additionalProperties: true
      },
      context: {
        type: 'object',
        description: 'Additional tool execution context.',
        additionalProperties: true
      }
    },
    required: ['toolId'],
    additionalProperties: true
  };
}

function routerPolicySchema() {
  return {
    type: 'object',
    description: 'Router manager policy. It can whitelist/block routed intents, intercept/remap intents, and whitelist/block resolver tools proposed by resolver.orchestration.',
    properties: {
      allowedIntents: {
        type: 'array',
        description: 'Optional intent whitelist. Empty or omitted means all intent ids can pass unless blocked.',
        items: { type: 'string' }
      },
      blockedIntents: {
        type: 'array',
        description: 'Intent ids to block before resolver candidates are generated.',
        items: { type: 'string' }
      },
      intercepts: {
        type: 'array',
        description: 'Intent intercept rules. action can be block, allow, or remap; remap uses toIntent.',
        items: {
          type: 'object',
          properties: {
            intent: { type: 'string' },
            intents: {
              type: 'array',
              items: { type: 'string' }
            },
            action: {
              type: 'string',
              enum: ['block', 'allow', 'remap']
            },
            toIntent: { type: 'string' },
            reason: { type: 'string' },
            enabled: { type: 'boolean' }
          },
          additionalProperties: true
        }
      },
      allowedResolverToolIds: {
        type: 'array',
        description: 'Resolver tool whitelist. When present, replaces the default top-level resolver allowlist.',
        items: { type: 'string' }
      },
      additionalResolverToolIds: {
        type: 'array',
        description: 'Resolver tool ids appended to the default allowlist.',
        items: { type: 'string' }
      },
      blockedResolverToolIds: {
        type: 'array',
        description: 'Resolver tool ids that are blocked even when otherwise allowed.',
        items: { type: 'string' }
      },
      allowUnlistedResolverTools: {
        type: 'boolean',
        description: 'When true, resolver.orchestration can propose tools outside the resolver whitelist.'
      }
    },
    additionalProperties: true
  };
}

function handoffTokenModeSchema() {
  return {
    type: 'string',
    enum: ['none', 'light', 'super', 'extreme'],
    description: 'none keeps full previous output; light keeps the current clipped summary/envelope; super keeps a tighter summary; extreme keeps only identifiers, envelope, and trace refs.'
  };
}

function progressLabelsSchema(description) {
  return {
    type: 'object',
    description,
    additionalProperties: {
      type: 'string'
    }
  };
}

function profileSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      version: { type: 'string' },
      inherit: { type: 'boolean' },
      replacePhases: { type: 'boolean' },
      mutableByUser: { type: 'boolean' },
      tags: {
        type: 'array',
        items: { type: 'string' }
      },
      metadata: { type: 'object', additionalProperties: true },
      llm: { type: 'object', additionalProperties: true },
      routes: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      phases: {
        type: 'array',
        items: phaseSchema()
      }
    },
    additionalProperties: true
  };
}

function phaseSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      progressLabel: {
        type: 'string',
        description: 'User-facing progress text for this phase, for example 正在理解玩家意图... If omitted, the runtime generates a Chinese fallback from the phase id/title.'
      },
      order: { type: 'number' },
      enabled: { type: 'boolean' },
      delete: { type: 'boolean' },
      mode: { type: 'string' },
      llm: { type: 'boolean' },
      mutatesState: { type: 'boolean' },
      mayMutate: { type: 'boolean' },
      required: { type: 'boolean' },
      description: { type: 'string' },
      promptTemplate: { type: 'string' },
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: { type: 'object', additionalProperties: true },
      config: { type: 'object', additionalProperties: true },
      toolCalls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            progressLabel: {
              type: 'string',
              description: 'User-facing progress text while this tool call runs. If omitted, the runtime generates a Chinese fallback from toolId.'
            }
          },
          additionalProperties: true
        }
      }
    },
    required: ['id'],
    additionalProperties: true
  };
}
