// @ts-nocheck
import { MechanicsRegistry } from '../mechanics/mechanics-registry.js';
import { lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const MECHANICS_REGISTRY_PLUGIN = {
  id: 'system.mechanics_registry',
  name: 'Mechanics Registry Tools',
  version: '0.1.0',
  description: 'Global registry for skills, statuses/conditions, and feats/perks.',
  enabled: true,
  permissions: ['mechanics-registry:read', 'mechanics-registry:write'],
  tools: [
    ...mechanicTools('skill', 'skills', 'Skill'),
    ...mechanicTools('status', 'statuses', 'Status'),
    ...mechanicTools('feat', 'feats', 'Feat'),
    {
      name: 'list_templates',
      title: 'List Mechanics Templates',
      description: 'List editable mechanics templates. Template-only entries such as class, race, and background do not create collections.',
      inputSchema: templateListSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['mechanics', 'registry', 'templates', 'query']
    },
    {
      name: 'get_template',
      title: 'Get Mechanics Template',
      description: 'Get one editable mechanics template by id or alias.',
      inputSchema: templateIdSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['mechanics', 'registry', 'templates', 'query']
    },
    {
      name: 'import_document',
      title: 'Import Mechanics Registry Document',
      description: 'Import skills, statuses, and feats from JSON, YAML, or XML. Requires explicit user authorization.',
      inputSchema: importSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['mechanics', 'registry', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Mechanics Registry Document',
      description: 'Export skills, statuses, and feats to JSON or YAML.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['mechanics', 'registry', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_registry',
      title: 'Describe Mechanics Registry',
      description: 'Describe the underlying skill/status/feat registry collections and synchronized schema files.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['mechanics', 'registry', 'schema']
    }
  ]
};

export function createMechanicsRegistryHandlers({ dataManager, registry, appDatabase, chatProvider } = {}) {
  const mechanics = registry || new MechanicsRegistry({ dataManager, appDatabase });
  return {
    list_skills: async ({ input }) => mechanics.listSkills(input),
    get_skill: async ({ input }) => mechanics.getSkill(input.id),
    upsert_skill: async ({ input, context }) => mechanics.upsertSkillAsync(input, { context, chatProvider }),
    patch_skill: async ({ input, context }) => mechanics.patchSkillAsync(input.id, input.patch, { context, chatProvider }),
    delete_skill: async ({ input }) => mechanics.deleteSkill(input.id),
    list_statuses: async ({ input }) => mechanics.listStatuses(input),
    get_status: async ({ input }) => mechanics.getStatus(input.id),
    upsert_status: async ({ input, context }) => mechanics.upsertStatusAsync(input, { context, chatProvider }),
    patch_status: async ({ input, context }) => mechanics.patchStatusAsync(input.id, input.patch, { context, chatProvider }),
    delete_status: async ({ input }) => mechanics.deleteStatus(input.id),
    list_feats: async ({ input }) => mechanics.listFeats(input),
    get_feat: async ({ input }) => mechanics.getFeat(input.id),
    upsert_feat: async ({ input, context }) => mechanics.upsertFeatAsync(input, { context, chatProvider }),
    patch_feat: async ({ input, context }) => mechanics.patchFeatAsync(input.id, input.patch, { context, chatProvider }),
    delete_feat: async ({ input }) => mechanics.deleteFeat(input.id),
    list_templates: async ({ input }) => mechanics.listTemplates(input),
    get_template: async ({ input }) => mechanics.getTemplate(input.templateId || input.id, input),
    import_document: async ({ input, context }) => mechanics.importDocumentAsync(input, { context, chatProvider }),
    export_document: async ({ input }) => mechanics.exportDocument(input),
    describe_registry: async () => mechanics.describe()
  };
}

function mechanicTools(kind, plural, title) {
  return [
    {
      name: `list_${plural}`,
      title: `List ${title}s`,
      description: `List ${kind} registry entries with optional filters, tags, and text query.`,
      inputSchema: listSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['mechanics', kind, 'registry', 'query']
    },
    {
      name: `get_${kind}`,
      title: `Get ${title}`,
      description: `Get one ${kind} registry entry by id.`,
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['mechanics', kind, 'registry', 'query']
    },
    {
      name: `upsert_${kind}`,
      title: `Create Or Replace ${title}`,
      description: `Create or replace one ${kind} registry entry. Requires explicit user authorization.`,
      inputSchema: mechanicInputSchema(kind),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['mechanics', kind, 'registry', 'write']
    },
    {
      name: `patch_${kind}`,
      title: `Patch ${title}`,
      description: `Patch an existing ${kind} registry entry. Requires explicit user authorization.`,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: mechanicPatchSchema(kind)
        },
        required: ['id', 'patch'],
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['mechanics', kind, 'registry', 'write']
    },
    {
      name: `delete_${kind}`,
      title: `Delete ${title}`,
      description: `Delete one ${kind} registry entry. Requires explicit user authorization.`,
      inputSchema: idSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        ...AUTH_METADATA,
        destructive: true
      },
      tags: ['mechanics', kind, 'registry', 'delete']
    }
  ];
}

function mechanicInputSchema(kind) {
  const common = {
    id: { type: 'string' },
    [`${kind}Id`]: { type: 'string' },
    name: { type: 'string' },
    category: { type: 'string' },
    type: { type: 'string' },
    tags: stringArraySchema(),
    aliases: stringArraySchema(),
    description: { type: 'string' },
    summary: { type: 'string' },
    text: { type: 'string' },
    mechanicalEffect: { type: 'string' },
    effect: { type: 'string' },
    rule: { type: 'string' },
    rulesText: { type: 'string' },
    sourceRef: { type: 'string' },
    source: { type: 'string' },
    bookRef: { type: 'string' },
    status: { type: 'string' },
    metadata: { type: 'object', additionalProperties: true },
    campaignId: { type: 'string' },
    chatSessionId: { type: 'string' },
    actor: actorMarkerSchema(),
    createdBy: { type: 'string' },
    updatedBy: { type: 'string' },
    sourceActor: { type: 'string' },
    author: { type: 'string' },
    numericValues: numericValuesSchema(),
    values: numericValuesSchema(),
    numericSettings: numericValuesSchema(),
    settingValues: numericValuesSchema(),
    textSettings: jsonObjectSchema(),
    specialTextSettings: jsonObjectSchema(),
    quantify: { type: 'boolean' },
    quantifyNumeric: { type: 'boolean' },
    autoQuantify: { type: 'boolean' },
    quantificationDefinition: quantificationDefinitionSchema(),
    numericDefinition: quantificationDefinitionSchema(),
    definition: quantificationDefinitionSchema(),
    quantification: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        definition: quantificationDefinitionSchema()
      },
      additionalProperties: true
    },
    quantificationValues: jsonObjectSchema(),
    providedValues: jsonObjectSchema(),
    quantificationSourceText: { type: 'string' },
    numericSourceText: { type: 'string' },
    quantificationText: { type: 'string' },
    quantificationAudit: jsonObjectSchema(),
    numericQuantification: jsonObjectSchema(),
    quantificationUpdatedAt: { type: 'string' },
    useLlm: { type: 'boolean' },
    preferLlm: { type: 'boolean' },
    requireLlm: { type: 'boolean' },
    allowNewFields: { type: 'boolean' },
    maxNewFields: { type: 'integer', minimum: 0, maximum: 50 },
    referenceText: referenceInputSchema(),
    referenceDocuments: referenceInputSchema(),
    referenceDocs: referenceInputSchema(),
    referenceFiles: referenceInputSchema(),
    referenceFilePaths: referenceInputSchema(),
    allowReferenceFilePaths: { type: 'boolean' },
    cwd: { type: 'string' },
    temperature: { type: 'number' },
    maxTokens: { type: 'integer', minimum: 1 },
    newFieldsMaxTokens: { type: 'integer', minimum: 1 },
    ...lifecycleSchemaProperties()
  };
  const specific = kind === 'skill'
    ? {
      ability: { type: 'string' },
      attribute: { type: 'string' },
      stat: { type: 'string' },
      rankScale: arrayOrObjectSchema(),
      ranks: arrayOrObjectSchema(),
      proficiency: arrayOrObjectSchema(),
      prerequisites: arrayOrObjectSchema(),
      requires: arrayOrObjectSchema(),
      relatedStatusIds: stringArraySchema(),
      statusRefs: stringArraySchema(),
      statuses: stringArraySchema(),
      relatedFeatIds: stringArraySchema(),
      featRefs: stringArraySchema(),
      feats: stringArraySchema()
    }
    : kind === 'status'
      ? {
        severity: { type: 'string' },
        durationType: { type: 'string' },
        duration: { type: 'string' },
        stackRule: { type: 'string' },
        stacking: { type: 'string' },
        counters: arrayOrObjectSchema(),
        removal: arrayOrObjectSchema(),
        cures: arrayOrObjectSchema(),
        immunities: stringArraySchema(),
        immuneTags: stringArraySchema()
      }
      : {
        tier: { type: 'string' },
        level: { type: 'string' },
        prerequisites: arrayOrObjectSchema(),
        requires: arrayOrObjectSchema(),
        grants: arrayOrObjectSchema(),
        bonuses: arrayOrObjectSchema(),
        unlocks: arrayOrObjectSchema(),
        relatedSkillIds: stringArraySchema(),
        skillRefs: stringArraySchema(),
        skills: stringArraySchema(),
        relatedStatusIds: stringArraySchema(),
        statusRefs: stringArraySchema(),
        statuses: stringArraySchema()
      };
  return {
    type: 'object',
    properties: {
      ...common,
      ...specific
    },
    required: ['name'],
    additionalProperties: false
  };
}

function mechanicPatchSchema(kind) {
  const schema = mechanicInputSchema(kind);
  delete schema.required;
  return schema;
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

function idSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' }
    },
    required: ['id'],
    additionalProperties: false
  };
}

function templateListSchema() {
  return {
    type: 'object',
    properties: {
      query: { type: 'string' },
      registeredOnly: { type: 'boolean', default: false },
      templateOnly: { type: 'boolean' },
      includeFields: { type: 'boolean', default: true },
      includeExamples: { type: 'boolean', default: true }
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
      includeFields: { type: 'boolean', default: true },
      includeExamples: { type: 'boolean', default: true }
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
      kind: { type: 'string', enum: ['skill', 'skills', 'status', 'statuses', 'feat', 'feats'] },
      collection: { type: 'string' },
      collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
      idField: { type: 'string', default: 'id' },
      source: { type: 'string', default: 'agent-import' },
      useLlm: { type: 'boolean' },
      preferLlm: { type: 'boolean' },
      requireLlm: { type: 'boolean' },
      allowNewFields: { type: 'boolean' },
      maxNewFields: { type: 'integer', minimum: 0, maximum: 50 },
      referenceText: referenceInputSchema(),
      referenceDocuments: referenceInputSchema(),
      referenceDocs: referenceInputSchema(),
      referenceFiles: referenceInputSchema(),
      referenceFilePaths: referenceInputSchema(),
      allowReferenceFilePaths: { type: 'boolean' },
      cwd: { type: 'string' },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1 },
      newFieldsMaxTokens: { type: 'integer', minimum: 1 },
      ...lifecycleSchemaProperties()
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
      kind: { type: 'string', enum: ['skill', 'skills', 'status', 'statuses', 'feat', 'feats'] },
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
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
        direction: { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}

function stringArraySchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
    ]
  };
}

function arrayOrObjectSchema() {
  return {
    anyOf: [
      { type: 'array', items: true },
      { type: 'object', additionalProperties: true },
      { type: 'string' }
    ]
  };
}

function numericValuesSchema() {
  return {
    type: 'object',
    additionalProperties: {
      anyOf: [
        { type: 'number' },
        { type: 'integer' },
        { type: 'string' }
      ]
    }
  };
}

function jsonObjectSchema() {
  return {
    type: 'object',
    additionalProperties: true
  };
}

function quantificationDefinitionSchema() {
  return {
    type: 'object',
    properties: {
      version: { type: 'string' },
      prompt: { type: 'string' },
      fields: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      numericFields: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      textFields: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      }
    },
    additionalProperties: true
  };
}

function actorMarkerSchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        additionalProperties: true
      }
    ]
  };
}

function referenceInputSchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'array',
        items: {
          anyOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true }
          ]
        }
      },
      { type: 'object', additionalProperties: true }
    ]
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}
