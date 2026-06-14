// @ts-nocheck
import { lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';
import { VisualAssetManager } from '../visual/visual-asset-manager.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const VISUAL_ASSET_PLUGIN = {
  id: 'system.visual',
  name: 'Visual Asset Binding Tools',
  version: '0.1.0',
  description: 'No-op visual asset reference layer for future images, animations, sounds, models, and event effects.',
  enabled: true,
  permissions: ['visual-assets:read', 'visual-assets:write'],
  metadata: {
    llm: false,
    rendering: false,
    generation: false,
    collections: ['visual_assets', 'visual_asset_bindings', 'visual_event_bindings']
  },
  tools: [
    tool('describe_manager', 'Describe Visual Asset Manager', 'Describe the visual asset collections, templates, and no-op behavior.', emptySchema(), false, ['visual', 'assets', 'schema', 'no-llm']),
    tool('list_templates', 'List Visual Asset Templates', 'List built-in visual asset, object binding, and event binding templates.', listTemplatesSchema(), false, ['visual', 'assets', 'templates', 'query']),
    tool('get_template', 'Get Visual Asset Template', 'Get one visual asset template by id or collection name.', templateIdSchema(), false, ['visual', 'assets', 'templates', 'query']),
    tool('list_assets', 'List Visual Assets', 'List visual asset references with optional query, tags, filters, and lifecycle visibility.', listSchema(), false, ['visual', 'assets', 'query']),
    tool('list_bindings', 'List Visual Object Bindings', 'List object-to-asset bindings such as NPC portraits, map backgrounds, item icons, or status overlays.', listSchema(), false, ['visual', 'assets', 'bindings', 'query']),
    tool('list_event_bindings', 'List Visual Event Bindings', 'List event-to-asset bindings such as dice animations, adjudication panels, combat hit effects, or quest completion effects.', listSchema(), false, ['visual', 'assets', 'events', 'query']),
    tool('resolve_assets', 'Resolve Visual Assets', 'Resolve optional presentation references for targets or events. If nothing is bound, returns noop=true and does not affect gameplay.', resolveSchema(), false, ['visual', 'assets', 'resolve', 'no-llm']),
    writeTool('upsert_asset', 'Create Or Replace Visual Asset', 'Create or replace one visual asset reference. Requires explicit user authorization.', assetInputSchema(), ['visual', 'assets', 'write']),
    writeTool('upsert_binding', 'Create Or Replace Visual Object Binding', 'Bind a visual asset to an object such as NPC, player, map, item, status, scene, faction, quest, or skill. Requires explicit user authorization.', bindingInputSchema(), ['visual', 'assets', 'bindings', 'write']),
    writeTool('upsert_event_binding', 'Create Or Replace Visual Event Binding', 'Bind a visual asset to an event such as dice roll, adjudication, persuasion, combat, status tick, or quest completion. Requires explicit user authorization.', eventBindingInputSchema(), ['visual', 'assets', 'events', 'write'])
  ]
};

export function createVisualAssetHandlers({ dataManager, manager, appDatabase } = {}) {
  const visuals = manager || new VisualAssetManager({ dataManager, appDatabase });
  return {
    describe_manager: async () => visuals.describe(),
    list_templates: async ({ input }) => visuals.listTemplates(input),
    get_template: async ({ input }) => visuals.getTemplate(input.id || input.templateId || input.collection),
    list_assets: async ({ input }) => visuals.listAssets(input),
    list_bindings: async ({ input }) => visuals.listBindings(input),
    list_event_bindings: async ({ input }) => visuals.listEventBindings(input),
    resolve_assets: async ({ input }) => visuals.resolveAssets(input),
    upsert_asset: async ({ input }) => visuals.upsertAsset(input),
    upsert_binding: async ({ input }) => visuals.upsertBinding(input),
    upsert_event_binding: async ({ input }) => visuals.upsertEventBinding(input)
  };
}

function tool(name, title, description, inputSchema, mutatesState, tags, metadata = {}) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable: true,
    mutatesState,
    metadata: {
      scope: 'global-data',
      writesSchemaFile: mutatesState,
      noLlm: true,
      rendering: false,
      generation: false,
      ...metadata
    },
    tags
  };
}

function writeTool(name, title, description, inputSchema, tags, metadata = {}) {
  return {
    ...tool(name, title, description, inputSchema, true, tags, {
      ...AUTH_METADATA,
      ...metadata
    }),
    annotations: { requiresUserAuthorization: true },
    autoCallable: false
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function listTemplatesSchema() {
  return {
    type: 'object',
    properties: {
      query: { type: 'string' },
      tags: stringArraySchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function templateIdSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      templateId: { type: 'string' },
      collection: { type: 'string' }
    },
    anyOf: [
      { required: ['id'] },
      { required: ['templateId'] },
      { required: ['collection'] }
    ],
    additionalProperties: false
  };
}

function listSchema() {
  return {
    type: 'object',
    properties: {
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
      ...lifecycleSchemaProperties()
    },
    additionalProperties: false
  };
}

function resolveSchema() {
  return {
    type: 'object',
    properties: {
      targetType: { type: 'string' },
      targetId: { type: 'string' },
      npcId: { type: 'string' },
      mapId: { type: 'string' },
      itemId: { type: 'string' },
      actorId: { type: 'string' },
      eventType: { type: 'string' },
      event: { type: 'string' },
      slot: { type: 'string' },
      visualSlot: { type: 'string' },
      result: { type: 'string' },
      outcome: { type: 'string' },
      sceneId: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      targets: {
        type: 'array',
        items: resolveTargetSchema()
      },
      events: {
        type: 'array',
        items: resolveEventSchema()
      },
      bindingFilter: { type: 'object', additionalProperties: true },
      eventBindingFilter: { type: 'object', additionalProperties: true },
      bindingLimit: { type: 'integer', minimum: 1, maximum: 1000 },
      eventBindingLimit: { type: 'integer', minimum: 1, maximum: 1000 },
      includePlaceholders: { type: 'boolean', default: false }
    },
    additionalProperties: false
  };
}

function resolveTargetSchema() {
  return {
    type: 'object',
    properties: {
      targetType: { type: 'string' },
      type: { type: 'string' },
      kind: { type: 'string' },
      targetId: { type: 'string' },
      npcId: { type: 'string' },
      mapId: { type: 'string' },
      itemId: { type: 'string' },
      actorId: { type: 'string' },
      id: { type: 'string' },
      slot: { type: 'string' },
      visualSlot: { type: 'string' },
      sceneId: { type: 'string' },
      result: { type: 'string' },
      outcome: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function resolveEventSchema() {
  return {
    type: 'object',
    properties: {
      eventType: { type: 'string' },
      event: { type: 'string' },
      type: { type: 'string' },
      slot: { type: 'string' },
      visualSlot: { type: 'string' },
      result: { type: 'string' },
      outcome: { type: 'string' },
      sceneId: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    anyOf: [
      { required: ['eventType'] },
      { required: ['event'] },
      { required: ['type'] }
    ],
    additionalProperties: false
  };
}

function assetInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      assetId: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      assetType: { type: 'string' },
      type: { type: 'string' },
      uri: { type: 'string' },
      url: { type: 'string' },
      path: { type: 'string' },
      href: { type: 'string' },
      mimeType: { type: 'string' },
      mime: { type: 'string' },
      prompt: { type: 'string' },
      generationPrompt: { type: 'string' },
      artPrompt: { type: 'string' },
      source: { type: 'string' },
      importSource: { type: 'string' },
      status: { type: 'string' },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      dimensions: { type: 'object', additionalProperties: true },
      variants: arrayOrObjectSchema(),
      credits: arrayOrObjectSchema(),
      license: arrayOrObjectSchema(),
      metadata: { type: 'object', additionalProperties: true },
      ...lifecycleSchemaProperties()
    },
    anyOf: [
      { required: ['assetId'] },
      { required: ['id'] },
      { required: ['name'] }
    ],
    additionalProperties: false
  };
}

function bindingInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      bindingId: { type: 'string' },
      targetType: { type: 'string' },
      type: { type: 'string' },
      kind: { type: 'string' },
      targetId: { type: 'string' },
      npcId: { type: 'string' },
      mapId: { type: 'string' },
      itemId: { type: 'string' },
      actorId: { type: 'string' },
      slot: { type: 'string' },
      visualSlot: { type: 'string' },
      role: { type: 'string' },
      assetId: { type: 'string' },
      visualAssetId: { type: 'string' },
      priority: { type: 'integer' },
      conditions: { type: 'object', additionalProperties: true },
      when: { type: 'object', additionalProperties: true },
      visibility: { type: 'string' },
      status: { type: 'string' },
      tags: stringArraySchema(),
      metadata: { type: 'object', additionalProperties: true },
      ...lifecycleSchemaProperties()
    },
    allOf: [
      {
        anyOf: [
          { required: ['targetType'] },
          { required: ['type'] },
          { required: ['kind'] }
        ]
      },
      {
        anyOf: [
          { required: ['targetId'] },
          { required: ['npcId'] },
          { required: ['mapId'] },
          { required: ['itemId'] },
          { required: ['actorId'] }
        ]
      },
      {
        anyOf: [
          { required: ['assetId'] },
          { required: ['visualAssetId'] }
        ]
      }
    ],
    additionalProperties: false
  };
}

function eventBindingInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      bindingId: { type: 'string' },
      eventBindingId: { type: 'string' },
      eventType: { type: 'string' },
      event: { type: 'string' },
      type: { type: 'string' },
      slot: { type: 'string' },
      visualSlot: { type: 'string' },
      assetId: { type: 'string' },
      visualAssetId: { type: 'string' },
      priority: { type: 'integer' },
      conditions: { type: 'object', additionalProperties: true },
      when: { type: 'object', additionalProperties: true },
      status: { type: 'string' },
      visibility: { type: 'string' },
      tags: stringArraySchema(),
      metadata: { type: 'object', additionalProperties: true },
      ...lifecycleSchemaProperties()
    },
    allOf: [
      {
        anyOf: [
          { required: ['eventType'] },
          { required: ['event'] },
          { required: ['type'] }
        ]
      },
      {
        anyOf: [
          { required: ['assetId'] },
          { required: ['visualAssetId'] }
        ]
      }
    ],
    additionalProperties: false
  };
}

function sortSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        direction: { type: 'string', enum: ['asc', 'desc'] },
        dir: { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}

function stringArraySchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'array',
        items: { type: 'string' }
      }
    ]
  };
}

function arrayOrObjectSchema() {
  return {
    anyOf: [
      { type: 'object', additionalProperties: true },
      { type: 'array', items: { type: 'object', additionalProperties: true } },
      { type: 'string' }
    ]
  };
}
