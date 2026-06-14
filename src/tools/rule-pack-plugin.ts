// @ts-nocheck
import { RulePackManager } from '../rules/rule-pack-manager.js';
import { lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const RULE_PACK_PLUGIN = {
  id: 'system.rule_packs',
  name: 'Rule Pack Manager Tools',
  version: '0.1.0',
  description: 'Global no-LLM registry for RPG rule packs, reference templates, and extension database creation templates.',
  enabled: true,
  permissions: ['rule-packs:read', 'rule-packs:write'],
  metadata: {
    llm: false,
    collections: ['rule_packs', 'rule_pack_templates']
  },
  tools: [
    tool('describe_manager', 'Describe Rule Pack Manager', 'Describe rule pack collections, built-in default pack, built-in reference templates, and extension database templates.', emptySchema(), false, ['rules', 'schema', 'templates', 'no-llm']),
    tool('list_rule_packs', 'List Rule Packs', 'List global rule packs with optional query, tags, filter, and built-in default pack.', listSchema(), false, ['rules', 'rule-pack', 'query']),
    tool('get_rule_pack', 'Get Rule Pack', 'Get one rule pack by id. The built-in default pack can be read by id or alias.', idSchema(), false, ['rules', 'rule-pack', 'query']),
    writeTool('upsert_rule_pack', 'Create Or Replace Rule Pack', 'Create or replace one global rule pack. Requires explicit user authorization.', rulePackInputSchema(), ['rules', 'rule-pack', 'write']),
    writeTool('patch_rule_pack', 'Patch Rule Pack', 'Patch an existing global rule pack. Requires explicit user authorization.', patchSchema(rulePackPatchSchema(), ['id', 'rulePackId']), ['rules', 'rule-pack', 'write']),
    writeTool('delete_rule_pack', 'Delete Rule Pack', 'Delete one global rule pack. Requires explicit user authorization.', idSchema(), ['rules', 'rule-pack', 'delete'], { destructive: true }),
    tool('compose_rule_pack', 'Compose Rule Pack', 'Merge the built-in default pack, stored packs, inline packs, templates, and overrides into one inspectable rule pack with toolDefaults.', composeSchema(), false, ['rules', 'compose', 'tool-defaults', 'no-llm']),
    tool('list_templates', 'List Rule Pack Templates', 'List global and built-in rule pack reference templates, including extension database creation templates.', listSchema(), false, ['rules', 'templates', 'query']),
    tool('get_template', 'Get Rule Pack Template', 'Get one built-in or stored rule pack reference or extension database template.', templateIdSchema(), false, ['rules', 'templates', 'query']),
    writeTool('create_collection_from_template', 'Create Collection From Template', 'Create a managed SQLite collection from a stored or built-in databaseSchema template. Requires explicit user authorization.', createCollectionFromTemplateSchema(), ['rules', 'templates', 'schema', 'database', 'write']),
    writeTool('upsert_template', 'Create Or Replace Rule Pack Template', 'Create or replace one rule pack reference template. Requires explicit user authorization.', templateInputSchema(), ['rules', 'templates', 'write']),
    writeTool('patch_template', 'Patch Rule Pack Template', 'Patch an existing stored rule pack reference template. Requires explicit user authorization.', patchSchema(templatePatchSchema(), ['id', 'templateId']), ['rules', 'templates', 'write']),
    writeTool('delete_template', 'Delete Rule Pack Template', 'Delete one stored rule pack reference template. Requires explicit user authorization.', idSchema(), ['rules', 'templates', 'delete'], { destructive: true }),
    writeTool('import_document', 'Import Rule Pack Document', 'Import rule packs and reference templates from JSON, YAML, or XML. Requires explicit user authorization.', importSchema(), ['rules', 'import', 'json', 'yaml', 'xml']),
    tool('export_document', 'Export Rule Pack Document', 'Export rule packs and reference templates to JSON or YAML.', exportSchema(), false, ['rules', 'export', 'json', 'yaml'])
  ]
};

export function createRulePackHandlers({ dataManager, manager, appDatabase } = {}) {
  const rulePacks = manager || new RulePackManager({ dataManager, appDatabase });
  return {
    describe_manager: async () => rulePacks.describe(),
    list_rule_packs: async ({ input }) => rulePacks.listRulePacks(input),
    get_rule_pack: async ({ input }) => rulePacks.getRulePack(input.id || input.rulePackId),
    upsert_rule_pack: async ({ input }) => rulePacks.upsertRulePack(input),
    patch_rule_pack: async ({ input }) => rulePacks.patchRulePack(input.id || input.rulePackId, input.patch),
    delete_rule_pack: async ({ input }) => rulePacks.deleteRulePack(input.id || input.rulePackId),
    compose_rule_pack: async ({ input }) => rulePacks.composeRulePack(input),
    list_templates: async ({ input }) => rulePacks.listTemplates(input),
    get_template: async ({ input }) => rulePacks.getTemplate(input.templateId || input.id),
    create_collection_from_template: async ({ input }) => rulePacks.createCollectionFromTemplate(input),
    upsert_template: async ({ input }) => rulePacks.upsertTemplate(input),
    patch_template: async ({ input }) => rulePacks.patchTemplate(input.templateId || input.id, input.patch),
    delete_template: async ({ input }) => rulePacks.deleteTemplate(input.templateId || input.id),
    import_document: async ({ input }) => rulePacks.importDocument(input),
    export_document: async ({ input }) => rulePacks.exportDocument(input)
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

function idSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      rulePackId: { type: 'string' }
    },
    anyOf: [
      { required: ['id'] },
      { required: ['rulePackId'] }
    ],
    additionalProperties: false
  };
}

function templateIdSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      templateId: { type: 'string' }
    },
    anyOf: [
      { required: ['id'] },
      { required: ['templateId'] }
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
      includeBuiltIn: { type: 'boolean', default: true }
    },
    additionalProperties: false
  };
}

function rulePackInputSchema() {
  return {
    type: 'object',
    properties: rulePackProperties(),
    required: ['name'],
    additionalProperties: false
  };
}

function rulePackPatchSchema() {
  return {
    type: 'object',
    properties: rulePackProperties(),
    additionalProperties: false
  };
}

function rulePackProperties() {
  return {
    id: { type: 'string' },
    rulePackId: { type: 'string' },
    name: { type: 'string' },
    title: { type: 'string' },
    version: { type: 'string' },
    revision: { type: 'string' },
    status: { type: 'string' },
    priority: { type: 'integer' },
    tags: stringArraySchema(),
    aliases: stringArraySchema(),
    description: { type: 'string' },
    summary: { type: 'string' },
    text: { type: 'string' },
    sourceRef: { type: 'string' },
    source: { type: 'string' },
    bookRef: { type: 'string' },
    parentPackIds: stringArraySchema(),
    parents: stringArraySchema(),
    extends: stringArraySchema(),
    diceDefaults: jsonObjectSchema(),
    dice: jsonObjectSchema(),
    diceCheck: jsonObjectSchema(),
    actionEconomy: jsonObjectSchema(),
    resources: jsonObjectSchema(),
    turnEconomy: jsonObjectSchema(),
    damageRules: jsonObjectSchema(),
    damage: jsonObjectSchema(),
    resistanceRules: jsonObjectSchema(),
    effectRules: jsonObjectSchema(),
    deathRules: jsonObjectSchema(),
    death: jsonObjectSchema(),
    deathSaveRules: jsonObjectSchema(),
    skillFields: fieldArraySchema(),
    skills: fieldArraySchema(),
    statusFields: fieldArraySchema(),
    statuses: fieldArraySchema(),
    conditionFields: fieldArraySchema(),
    questRewardStyle: jsonObjectSchema(),
    rewardStyle: jsonObjectSchema(),
    questRewards: jsonObjectSchema(),
    referenceTemplateIds: stringArraySchema(),
    templateIds: stringArraySchema(),
    templates: stringArraySchema(),
    promptSections: jsonObjectSchema(),
    prompts: jsonObjectSchema(),
    toolDefaults: jsonObjectSchema(),
    tools: jsonObjectSchema(),
    metadata: jsonObjectSchema(),
    importSource: { type: 'string' },
    campaignId: { type: 'string' },
    chatSessionId: { type: 'string' },
    createdBy: { type: 'string' },
    updatedBy: { type: 'string' },
    registryUpdatedAt: { type: 'string' },
    ...lifecycleSchemaProperties()
  };
}

function templateInputSchema() {
  return {
    type: 'object',
    properties: templateProperties(),
    required: ['name'],
    additionalProperties: false
  };
}

function templatePatchSchema() {
  return {
    type: 'object',
    properties: templateProperties(),
    additionalProperties: false
  };
}

function templateProperties() {
  return {
    id: { type: 'string' },
    templateId: { type: 'string' },
    name: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string' },
    kind: { type: 'string' },
    type: { type: 'string' },
    templateType: { type: 'string' },
    mode: { type: 'string' },
    status: { type: 'string' },
    tags: stringArraySchema(),
    aliases: stringArraySchema(),
    description: { type: 'string' },
    summary: { type: 'string' },
    text: { type: 'string' },
    template: {},
    content: {},
    body: {},
    schema: jsonObjectSchema(),
    jsonSchema: jsonObjectSchema(),
    examples: arraySchema(),
    example: {},
    sourceRef: { type: 'string' },
    source: { type: 'string' },
    bookRef: { type: 'string' },
    metadata: jsonObjectSchema(),
    importSource: { type: 'string' },
    campaignId: { type: 'string' },
    chatSessionId: { type: 'string' },
    createdBy: { type: 'string' },
    updatedBy: { type: 'string' },
    registryUpdatedAt: { type: 'string' },
    ...lifecycleSchemaProperties()
  };
}

function patchSchema(patch, idFields = ['id']) {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      rulePackId: { type: 'string' },
      templateId: { type: 'string' },
      patch
    },
    required: ['patch'],
    anyOf: idFields.map((field) => ({ required: [field] })),
    additionalProperties: false
  };
}

function composeSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      ids: stringArraySchema(),
      packIds: stringArraySchema(),
      rulePackIds: stringArraySchema(),
      includeBuiltInDefault: { type: 'boolean', default: true },
      packs: {
        type: 'array',
        items: rulePackPatchSchema()
      },
      rulePacks: {
        type: 'array',
        items: rulePackPatchSchema()
      },
      overrides: rulePackPatchSchema(),
      override: rulePackPatchSchema(),
      templateIds: stringArraySchema(),
      referenceTemplateIds: stringArraySchema(),
      composedId: { type: 'string' },
      name: { type: 'string' }
    },
    additionalProperties: false
  };
}

function createCollectionFromTemplateSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      templateId: { type: 'string' },
      collection: { type: 'string', description: 'Target collection for single-collection templates, or base prefix for multi-collection templates.' },
      collectionMap: {
        type: 'object',
        description: 'Optional role-to-collection map for multi-collection templates, e.g. { nodes, edges, memberships }.',
        additionalProperties: { type: 'string' }
      },
      collections: {
        type: 'object',
        description: 'Alias of collectionMap.',
        additionalProperties: { type: 'string' }
      },
      seedExample: { type: 'boolean', default: false },
      seedRecordId: { type: 'string' },
      reason: { type: 'string' },
      ...lifecycleSchemaProperties()
    },
    anyOf: [
      { required: ['id'] },
      { required: ['templateId'] }
    ],
    additionalProperties: false
  };
}

function importSchema() {
  return {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1 },
      format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
      collection: { type: 'string' },
      collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
      idField: { type: 'string', default: 'id' },
      source: { type: 'string', default: 'document-import' }
    },
    required: ['text'],
    additionalProperties: false
  };
}

function exportSchema() {
  return {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
      includeBuiltIn: { type: 'boolean', default: false }
    },
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
        direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}

function fieldArraySchema() {
  return {
    oneOf: [
      {
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true }
          ]
        }
      },
      { type: 'object', additionalProperties: true },
      { type: 'string' }
    ]
  };
}

function jsonObjectSchema() {
  return {
    type: 'object',
    additionalProperties: true
  };
}

function arraySchema() {
  return {
    type: 'array',
    items: {}
  };
}

function stringArraySchema() {
  return {
    oneOf: [
      { type: 'string' },
      {
        type: 'array',
        items: { type: 'string' }
      }
    ]
  };
}
