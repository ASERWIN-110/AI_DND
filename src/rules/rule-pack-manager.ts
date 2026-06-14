// @ts-nocheck
import YAML from 'yaml';
import { DEFAULT_SETTLEMENT_RULES } from '../combat/effect-settlement.js';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';
import { RESOURCE_LIFECYCLE_FIELDS, resourceLifecycleFields } from '../lifecycle/resource-lifecycle.js';
import { RESOURCE_TEMPLATES } from '../resources/resource-manager.js';
import {
  EXTENSION_DATABASE_TEMPLATES,
  extensionTemplateToRulePackTemplate
} from '../templates/extension-database-templates.js';
import { createId } from '../utils/id.js';

export const RULE_PACK_COLLECTION = 'rule_packs';
export const RULE_PACK_TEMPLATE_COLLECTION = 'rule_pack_templates';

export const RULE_PACK_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'version', type: 'text', description: 'Rule pack version or revision label.' },
  { name: 'status', type: 'text', description: 'active, draft, deprecated, hidden, etc.' },
  { name: 'priority', type: 'integer', description: 'Default compose order hint; higher priority is applied later.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'description', type: 'text', description: 'Readable rule pack summary.' },
  { name: 'sourceRef', type: 'text', description: 'Rulebook, prompt, module, campaign, or homebrew source.' },
  { name: 'parentPackIds', type: 'json', description: 'Optional parent rule packs this pack expects to overlay.' },
  { name: 'diceDefaults', type: 'json', description: 'Default dice check settings: diceCount, diceSides, criticalMode, rollMode, inspiration, modifiers.' },
  { name: 'actionEconomy', type: 'json', description: 'Default action, bonus action, reaction, movement, turn reset, and resource economy rules.' },
  { name: 'damageRules', type: 'json', description: 'Resistance, vulnerability, immunity, temporary HP, concentration, and damage settlement rules.' },
  { name: 'deathRules', type: 'json', description: 'Death saves, dying, instant death, revival, and zero-HP rules.' },
  { name: 'skillFields', type: 'json', description: 'Field definitions or reference schema for skills.' },
  { name: 'statusFields', type: 'json', description: 'Field definitions or reference schema for statuses/conditions.' },
  { name: 'questRewardStyle', type: 'json', description: 'Reward philosophy, reward factors, risk/difficulty scaling, and consequence style.' },
  { name: 'referenceTemplateIds', type: 'json', description: 'Rule pack template ids commonly used with this rule pack.' },
  { name: 'promptSections', type: 'json', description: 'Prompt-ready rule sections for GM, action, combat, quest, or world systems.' },
  { name: 'toolDefaults', type: 'json', description: 'Derived or explicit tool input defaults for dice, effects, resources, mechanics, and quests.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp.' }
];

export const RULE_PACK_TEMPLATE_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'category', type: 'text', description: 'dice, actionEconomy, damage, death, mechanics, questReward, prompt, reference, custom.' },
  { name: 'templateType', type: 'text', description: 'rulePack, fieldSchema, databaseSchema, promptSection, referenceTable, toolDefaults, custom.' },
  { name: 'status', type: 'text', description: 'active, draft, deprecated, hidden, etc.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'description', type: 'text', description: 'Readable template summary.' },
  { name: 'template', type: 'json', description: 'Template body, reference table, prompt block, schema, or example.' },
  { name: 'schema', type: 'json', description: 'Optional schema for validating or documenting the template body.' },
  { name: 'examples', type: 'json', description: 'Example records or tool inputs.' },
  { name: 'sourceRef', type: 'text', description: 'Rulebook, prompt, module, campaign, or homebrew source.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp.' }
];

export const DEFAULT_DND_LITE_RULE_PACK = {
  id: 'dnd_lite_default',
  name: 'D&D-Lite Default Rule Pack',
  version: '0.1.0',
  status: 'active',
  priority: 0,
  tags: ['default', 'dnd-like', 'debug-template'],
  aliases: ['default', 'dnd', 'dnd_lite'],
  description: 'A compact D&D-like default rule pack for dice, action economy, effect settlement, death saves, mechanics fields, and quest rewards.',
  sourceRef: 'ai-dnd-built-in',
  diceDefaults: {
    successThreshold: 10,
    diceCount: 1,
    diceSides: 20,
    modifier: 0,
    forceMode: 'normal',
    rollMode: 'normal',
    inspirationPoints: 0,
    criticalMode: 'd20'
  },
  actionEconomy: {
    ...RESOURCE_TEMPLATES.actionEconomy,
    turnReset: ['action', 'bonusAction', 'reaction', 'movement'],
    defaultActionCost: { action: 1 },
    note: 'One action, one bonus action, one reaction, and movement per turn by default.'
  },
  damageRules: {
    resistanceRounding: DEFAULT_SETTLEMENT_RULES.resistanceRounding,
    resistanceMultiplier: DEFAULT_SETTLEMENT_RULES.resistanceMultiplier,
    vulnerabilityMultiplier: DEFAULT_SETTLEMENT_RULES.vulnerabilityMultiplier,
    tempHpMode: DEFAULT_SETTLEMENT_RULES.tempHpMode,
    concentrationBaseDc: DEFAULT_SETTLEMENT_RULES.concentrationBaseDc,
    concentrationDamageDivisor: DEFAULT_SETTLEMENT_RULES.concentrationDamageDivisor,
    immunitiesBlockDamage: true
  },
  deathRules: {
    instantDeath: DEFAULT_SETTLEMENT_RULES.instantDeath,
    deathSaveSuccessesToStable: 3,
    deathSaveFailuresToDeath: 3,
    deathSaveFailuresFromDamageAtZero: DEFAULT_SETTLEMENT_RULES.deathSaveFailuresFromDamageAtZero,
    criticalDamageAtZeroFailures: DEFAULT_SETTLEMENT_RULES.criticalDamageAtZeroFailures,
    naturalTwentyReviveHp: 1,
    allowHealingDeadByDefault: false
  },
  skillFields: [
    { name: 'ability', type: 'text', description: 'Primary ability or attribute.' },
    { name: 'rankScale', type: 'json', description: 'Untrained/trained/expert/master or custom proficiency scale.' },
    { name: 'numericValues', type: 'json', description: 'DC, modifier, cooldown, duration, resource, or cost values.' },
    { name: 'mechanicalEffect', type: 'text', description: 'Compact prompt-ready mechanical rule.' }
  ],
  statusFields: [
    { name: 'severity', type: 'text', description: 'minor, moderate, major, critical, variable, or custom.' },
    { name: 'durationType', type: 'text', description: 'instant, round, scene, encounter, timed, permanent, conditional.' },
    { name: 'stackRule', type: 'text', description: 'none, refresh, stack, highest, custom.' },
    { name: 'remainingTurns', type: 'number', description: 'Turns before expiration.' },
    { name: 'tickTiming', type: 'text', description: 'startTurn, endTurn, endRound, or custom.' }
  ],
  questRewardStyle: {
    noFixedQuestLine: true,
    rewardFactors: ['difficulty', 'risk', 'process', 'questObject', 'completionQuality', 'collateralDamage'],
    principles: [
      'Reward achieving the objective, not following a fixed route.',
      'Scale rewards with difficulty and risk.',
      'Allow unusual solutions; consequences and rewards should match the method.',
      'Do not punish the player for merely encountering a hook.'
    ],
    examples: [
      { difficulty: 'small favor', rewards: ['coin', 'rumor', 'minor relationship gain'] },
      { difficulty: 'legendary', rewards: ['rare item', 'faction shift', 'world-state consequence'] }
    ]
  },
  referenceTemplateIds: ['dice_defaults', 'effect_settlement_rules', 'quest_reward_style'],
  promptSections: {
    gm: 'Use the active rule pack as defaults. User-specific rules and explicit scene context override defaults.',
    reward: 'Rewards depend on objective, difficulty, risk, process, patron resources, and completion quality.'
  },
  metadata: {
    builtIn: true,
    llm: false
  }
};

export const BUILTIN_EXTENSION_DATABASE_TEMPLATES = Object.fromEntries(
  Object.values(EXTENSION_DATABASE_TEMPLATES).map((template) => {
    const ruleTemplate = extensionTemplateToRulePackTemplate(template);
    return [ruleTemplate.id, ruleTemplate];
  })
);

export const BUILTIN_RULE_PACK_TEMPLATES = {
  dice_defaults: {
    id: 'dice_defaults',
    name: 'Dice Defaults Template',
    category: 'dice',
    templateType: 'toolDefaults',
    tags: ['dice', 'd20', 'defaults'],
    description: 'Reference shape for default dice check settings.',
    template: DEFAULT_DND_LITE_RULE_PACK.diceDefaults,
    examples: [{
      successThreshold: 15,
      diceCount: 1,
      diceSides: 20,
      modifier: 3,
      rollMode: 'advantage',
      inspirationPoints: 1,
      criticalMode: 'd20'
    }]
  },
  action_economy: {
    id: 'action_economy',
    name: 'Action Economy Template',
    category: 'actionEconomy',
    templateType: 'toolDefaults',
    tags: ['resources', 'turn', 'action-economy'],
    description: 'Reference shape for action, bonus action, reaction, movement, and default turn reset.',
    template: DEFAULT_DND_LITE_RULE_PACK.actionEconomy,
    examples: [RESOURCE_TEMPLATES.actionEconomy]
  },
  effect_settlement_rules: {
    id: 'effect_settlement_rules',
    name: 'Damage / Death Settlement Rules Template',
    category: 'damage',
    templateType: 'toolDefaults',
    tags: ['damage', 'resistance', 'death', 'effects'],
    description: 'Reference shape for damage resistance, vulnerability, death saves, concentration, and temp HP rules.',
    template: {
      damageRules: DEFAULT_DND_LITE_RULE_PACK.damageRules,
      deathRules: DEFAULT_DND_LITE_RULE_PACK.deathRules
    },
    examples: [{
      rules: buildEffectSettlementRules(DEFAULT_DND_LITE_RULE_PACK)
    }]
  },
  mechanics_fields: {
    id: 'mechanics_fields',
    name: 'Skill / Status Fields Template',
    category: 'mechanics',
    templateType: 'fieldSchema',
    tags: ['skills', 'statuses', 'fields'],
    description: 'Reference field definitions for skills and statuses.',
    template: {
      skillFields: DEFAULT_DND_LITE_RULE_PACK.skillFields,
      statusFields: DEFAULT_DND_LITE_RULE_PACK.statusFields
    }
  },
  quest_reward_style: {
    id: 'quest_reward_style',
    name: 'Quest Reward Style Template',
    category: 'questReward',
    templateType: 'promptSection',
    tags: ['quest', 'reward', 'style'],
    description: 'Reference shape for objective-based, route-free quest reward rules.',
    template: DEFAULT_DND_LITE_RULE_PACK.questRewardStyle
  },
  ...BUILTIN_EXTENSION_DATABASE_TEMPLATES
};

export class RulePackManager {
  constructor({
    dataManager = new SQLiteDataManager(),
    appDatabase,
    now
  } = {}) {
    this.dataManager = dataManager;
    if (appDatabase && !this.dataManager.appDatabase) this.dataManager.appDatabase = appDatabase;
    this.now = now || (() => new Date().toISOString());
    this.ensureRegistry();
  }

  ensureRegistry() {
    this.dataManager.ensureCollection(RULE_PACK_COLLECTION);
    this.dataManager.alterFields(RULE_PACK_COLLECTION, {
      add: RULE_PACK_FIELDS,
      reason: 'rulePackManager:rulePacks'
    });
    this.dataManager.ensureCollection(RULE_PACK_TEMPLATE_COLLECTION);
    this.dataManager.alterFields(RULE_PACK_TEMPLATE_COLLECTION, {
      add: RULE_PACK_TEMPLATE_FIELDS,
      reason: 'rulePackManager:templates'
    });
    return this.describe();
  }

  describe() {
    return {
      rulePacks: this.dataManager.describeCollection(RULE_PACK_COLLECTION),
      templates: this.dataManager.describeCollection(RULE_PACK_TEMPLATE_COLLECTION),
      builtInDefaultPack: DEFAULT_DND_LITE_RULE_PACK,
      builtInTemplates: Object.values(BUILTIN_RULE_PACK_TEMPLATES),
      noLlm: true
    };
  }

  upsertRulePack(input = {}) {
    const normalized = normalizeRulePack(input, { now: this.now });
    return this.dataManager.upsertRecord(RULE_PACK_COLLECTION, normalized, { id: normalized.id });
  }

  patchRulePack(id, patch = {}) {
    const current = this.getRulePack(id);
    return this.upsertRulePack({
      ...current.data,
      ...patch,
      id: current.id
    });
  }

  getRulePack(id) {
    const normalizedId = normalizeRequiredText(id, 'id');
    if (matchesBuiltInPack(normalizedId)) {
      return {
        id: DEFAULT_DND_LITE_RULE_PACK.id,
        collection: 'built_in_rule_packs',
        data: cloneJson(normalizeRulePack(DEFAULT_DND_LITE_RULE_PACK, { now: this.now })),
        builtIn: true
      };
    }
    return this.dataManager.getRecord(RULE_PACK_COLLECTION, normalizedId);
  }

  deleteRulePack(id) {
    return this.dataManager.deleteRecord(RULE_PACK_COLLECTION, normalizeRequiredText(id, 'id'));
  }

  listRulePacks({
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'priority', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0,
    includeBuiltIn = true
  } = {}) {
    const result = this.dataManager.queryRecords(RULE_PACK_COLLECTION, {
      filter,
      sort,
      limit,
      offset
    });
    const records = result.records.filter((record) => matchesSearch(record, { tags, query }));
    const builtIns = includeBuiltIn
      ? [{
          id: DEFAULT_DND_LITE_RULE_PACK.id,
          collection: 'built_in_rule_packs',
          data: cloneJson(normalizeRulePack(DEFAULT_DND_LITE_RULE_PACK, { now: this.now })),
          builtIn: true
        }].filter((record) => matchesSearch(record, { tags, query }))
      : [];
    return {
      ...result,
      collection: RULE_PACK_COLLECTION,
      records: [...builtIns, ...records],
      builtInCount: builtIns.length
    };
  }

  upsertTemplate(input = {}) {
    const normalized = normalizeRulePackTemplate(input, { now: this.now });
    return this.dataManager.upsertRecord(RULE_PACK_TEMPLATE_COLLECTION, normalized, { id: normalized.id });
  }

  patchTemplate(id, patch = {}) {
    const current = this.getTemplate(id);
    if (current.builtIn) throw validationError(`Cannot patch built-in rule pack template: ${id}`);
    return this.upsertTemplate({
      ...current.data,
      ...patch,
      id: current.id
    });
  }

  getTemplate(id) {
    const normalizedId = normalizeRequiredText(id, 'id');
    const builtIn = resolveBuiltInTemplate(normalizedId);
    if (builtIn) {
      return {
        id: builtIn.id,
        collection: 'built_in_rule_pack_templates',
        data: cloneJson(normalizeRulePackTemplate(builtIn, { now: this.now })),
        builtIn: true
      };
    }
    return this.dataManager.getRecord(RULE_PACK_TEMPLATE_COLLECTION, normalizedId);
  }

  createCollectionFromTemplate(input = {}) {
    const templateId = normalizeRequiredText(input.templateId || input.id, 'templateId');
    const record = this.getTemplate(templateId);
    const normalized = normalizeRulePackTemplate(record.data, { now: this.now });
    const templateBody = normalizePlainObject(normalized.template);
    const collectionTemplates = extractDatabaseTemplateCollections(normalized);
    if (collectionTemplates.length > 0) {
      return this.createCollectionsFromTemplate(record, normalized, collectionTemplates, input);
    }

    const targetCollection = normalizeRequiredText(
      input.collection || templateBody.collection || templateBody.suggestedCollection,
      'collection'
    );
    const fields = extractDatabaseTemplateFields(normalized);
    if (fields.length === 0) {
      throw validationError(`Template does not contain database fields: ${templateId}`);
    }

    this.dataManager.ensureCollection(targetCollection);
    const change = this.dataManager.alterFields(targetCollection, {
      add: fields,
      reason: input.reason || `rulePackTemplate:${record.id}:createCollection`
    });
    const described = this.dataManager.describeCollection(targetCollection);
    const seedRecord = input.seedExample
      ? this.seedCollectionFromTemplate(targetCollection, normalized, input)
      : undefined;

    return {
      templateId: record.id,
      builtIn: Boolean(record.builtIn),
      collection: targetCollection,
      fieldCount: fields.length,
      added: change.added,
      formatFile: described.formatFile,
      schema: described,
      seedRecord
    };
  }

  createCollectionsFromTemplate(record, template, collectionTemplates, input = {}) {
    const templateBody = normalizePlainObject(template.template);
    const explicitBaseCollection = normalizeOptionalText(input.collection);
    const baseCollection = normalizeRequiredText(
      explicitBaseCollection || templateBody.collection || templateBody.suggestedCollection || templateBody.templateId || record.id,
      'collection'
    );
    const collectionMap = normalizePlainObject(input.collectionMap || input.collections);
    const lifecycleDefaults = normalizePlainObject(templateBody.lifecycleDefaults);
    const lifecycleInput = pickLifecycleInput(input);
    const createdCollections = collectionTemplates.map((collectionTemplate) => {
      const targetCollection = resolveTemplateCollectionName(collectionTemplate, {
        baseCollection,
        explicitBaseCollection: Boolean(explicitBaseCollection),
        collectionMap
      });
      this.dataManager.ensureCollection(targetCollection);
      const change = this.dataManager.alterFields(targetCollection, {
        add: collectionTemplate.fields,
        reason: input.reason || `rulePackTemplate:${record.id}:${collectionTemplate.role}:createCollection`
      });
      const described = this.dataManager.describeCollection(targetCollection);
      const seedRecord = input.seedExample
        ? this.seedCollectionFromCollectionTemplate(targetCollection, collectionTemplate, {
            lifecycleDefaults,
            lifecycleInput,
            seedRecordId: input.seedRecordId
          })
        : undefined;
      return {
        role: collectionTemplate.role,
        recordKey: collectionTemplate.recordKey,
        collection: targetCollection,
        idField: collectionTemplate.idField,
        optional: Boolean(collectionTemplate.optional),
        fieldCount: collectionTemplate.fields.length,
        added: change.added,
        formatFile: described.formatFile,
        schema: described,
        seedRecord
      };
    });

    return {
      templateId: record.id,
      builtIn: Boolean(record.builtIn),
      collection: baseCollection,
      multiCollection: true,
      collectionCount: createdCollections.length,
      fieldCount: createdCollections.reduce((sum, collection) => sum + collection.fieldCount, 0),
      collections: createdCollections,
      formatFiles: createdCollections.map((collection) => collection.formatFile).filter(Boolean)
    };
  }

  seedCollectionFromTemplate(collection, template, input = {}) {
    const example = normalizePlainObject(template.examples?.[0] || template.template?.exampleRecord);
    if (Object.keys(example).length === 0) return undefined;
    const lifecycleDefaults = normalizePlainObject(template.template?.lifecycleDefaults);
    const lifecycleInput = pickLifecycleInput(input);
    return this.dataManager.upsertRecord(collection, {
      ...lifecycleDefaults,
      ...example,
      ...lifecycleInput
    }, { id: input.seedRecordId || example.id });
  }

  seedCollectionFromCollectionTemplate(collection, collectionTemplate, {
    lifecycleDefaults = {},
    lifecycleInput = {},
    seedRecordId
  } = {}) {
    const example = normalizePlainObject(
      collectionTemplate.exampleRecord
      || collectionTemplate.example
      || collectionTemplate.examples?.[0]
    );
    if (Object.keys(example).length === 0) return undefined;
    const id = seedRecordId || example.id || example[collectionTemplate.idField];
    return this.dataManager.upsertRecord(collection, {
      ...lifecycleDefaults,
      ...example,
      ...lifecycleInput
    }, { id });
  }

  deleteTemplate(id) {
    return this.dataManager.deleteRecord(RULE_PACK_TEMPLATE_COLLECTION, normalizeRequiredText(id, 'id'));
  }

  listTemplates({
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'category', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0,
    includeBuiltIn = true
  } = {}) {
    const result = this.dataManager.queryRecords(RULE_PACK_TEMPLATE_COLLECTION, {
      filter,
      sort,
      limit,
      offset
    });
    const records = result.records.filter((record) => matchesSearch(record, { tags, query }));
    const builtIns = includeBuiltIn
      ? Object.values(BUILTIN_RULE_PACK_TEMPLATES)
          .map((template) => ({
            id: template.id,
            collection: 'built_in_rule_pack_templates',
            data: cloneJson(normalizeRulePackTemplate(template, { now: this.now })),
            builtIn: true
          }))
          .filter((record) => matchesSearch(record, { tags, query }))
      : [];
    return {
      ...result,
      collection: RULE_PACK_TEMPLATE_COLLECTION,
      records: [...builtIns, ...records],
      builtInCount: builtIns.length
    };
  }

  composeRulePack(input = {}) {
    const includeBuiltInDefault = input.includeBuiltInDefault !== false;
    const packIds = normalizeStringArray(input.packIds || input.rulePackIds || input.ids || input.id);
    const inlinePacks = normalizePlainObjectArray(input.packs || input.rulePacks);
    const overrides = normalizePlainObject(input.overrides || input.override);
    const sources = [];
    let composed = {};

    if (includeBuiltInDefault) {
      const pack = normalizeRulePack(DEFAULT_DND_LITE_RULE_PACK, { now: this.now });
      composed = mergeRulePack(composed, pack);
      sources.push({ source: 'built_in', id: pack.id, name: pack.name });
    }

    for (const packId of packIds) {
      const record = this.getRulePack(packId);
      const normalized = normalizeRulePack(record.data, { now: this.now });
      composed = mergeRulePack(composed, normalized);
      sources.push({ source: record.builtIn ? 'built_in' : RULE_PACK_COLLECTION, id: record.id, name: normalized.name });
    }

    for (const pack of inlinePacks) {
      const normalized = normalizeRulePack(pack, { now: this.now, partial: true });
      composed = mergeRulePack(composed, normalized);
      sources.push({ source: 'inline', id: normalized.id, name: normalized.name });
    }

    if (Object.keys(overrides).length) {
      const normalized = normalizeRulePack({ id: 'inline_overrides', name: 'Inline Overrides', ...overrides }, { now: this.now, partial: true });
      composed = mergeRulePack(composed, normalized);
      sources.push({ source: 'overrides', id: normalized.id, name: normalized.name });
    }

    const normalizedComposed = normalizeRulePack({
      ...composed,
      id: input.composedId || composed.id || 'composed_rule_pack',
      name: input.name || composed.name || 'Composed Rule Pack'
    }, { now: this.now, partial: true });
    const templateIds = [
      ...normalizeStringArray(normalizedComposed.referenceTemplateIds),
      ...normalizeStringArray(input.templateIds || input.referenceTemplateIds)
    ];
    const templates = templateIds.map((templateId) => {
      try {
        const record = this.getTemplate(templateId);
        return { id: record.id, builtIn: Boolean(record.builtIn), data: record.data };
      } catch (error) {
        return { id: templateId, missing: true, error: error.message };
      }
    });
    return {
      rulePack: {
        ...normalizedComposed,
        toolDefaults: buildToolDefaults(normalizedComposed)
      },
      sources,
      templates,
      noLlm: true
    };
  }

  importDocument(input = {}) {
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || defaultCollectionMap(),
      idField: input.idField || 'id'
    });
    const preferredCollection = normalizeOptionalText(input.collection);
    const packRecords = selectRecords(groups, preferredCollection && !isTemplateCollection(preferredCollection) ? preferredCollection : undefined, [
      RULE_PACK_COLLECTION,
      'rulePacks',
      'rule_packs',
      'packs'
    ]);
    const templateRecords = selectRecords(groups, preferredCollection && !isPackCollection(preferredCollection) ? preferredCollection : undefined, [
      RULE_PACK_TEMPLATE_COLLECTION,
      'rulePackTemplates',
      'rule_pack_templates',
      'referenceTemplates',
      'templates'
    ]);
    const packs = packRecords.map((record) => this.upsertRulePack({
      ...record,
      importSource: input.source || 'document-import'
    }));
    const templates = templateRecords.map((record) => this.upsertTemplate({
      ...record,
      importSource: input.source || 'document-import'
    }));
    return {
      format: parsed.format,
      counts: {
        rulePacks: packs.length,
        templates: templates.length
      },
      ids: {
        rulePacks: packs.map((record) => record.id),
        templates: templates.map((record) => record.id)
      },
      records: {
        rulePacks: packs,
        templates
      }
    };
  }

  exportDocument({
    format = 'json',
    filter = {},
    tags = [],
    query = '',
    limit = 500,
    offset = 0,
    includeBuiltIn = false
  } = {}) {
    const payload = {
      rulePacks: this.listRulePacks({ filter, tags, query, limit, offset, includeBuiltIn }).records.map((record) => ({
        id: record.id,
        ...record.data,
        builtIn: record.builtIn || undefined
      })),
      templates: this.listTemplates({ filter: {}, tags, query, limit, offset, includeBuiltIn }).records.map((record) => ({
        id: record.id,
        ...record.data,
        builtIn: record.builtIn || undefined
      }))
    };
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        text: `${JSON.stringify(payload, null, 2)}\n`,
        payload
      };
    }
    if (normalizedFormat === 'yaml' || normalizedFormat === 'yml') {
      return {
        format: 'yaml',
        text: YAML.stringify(payload),
        payload
      };
    }
    throw validationError('export format must be json or yaml');
  }
}

export function normalizeRulePack(input = {}, { now = () => new Date().toISOString(), partial = false } = {}) {
  if (!isPlainObject(input)) throw validationError('rule pack must be a plain object');
  const name = normalizeOptionalText(input.name || input.title);
  if (!partial && !name) throw validationError('rulePack.name is required');
  const id = normalizeRecordId(input.id || input.rulePackId || name || createId('rulepack'), 'rulepack');
  const normalized = {
    id,
    name: name || id,
    version: normalizeOptionalText(input.version || input.revision || '0.1.0'),
    status: normalizeOptionalText(input.status || 'active'),
    priority: normalizeInteger(input.priority ?? 0, 'priority'),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    description: normalizeOptionalText(input.description || input.summary || input.text),
    sourceRef: normalizeOptionalText(input.sourceRef || input.source || input.bookRef),
    parentPackIds: normalizeStringArray(input.parentPackIds || input.parents || input.extends),
    diceDefaults: normalizePlainObject(input.diceDefaults || input.dice || input.diceCheck),
    actionEconomy: normalizePlainObject(input.actionEconomy || input.resources || input.turnEconomy),
    damageRules: normalizePlainObject(input.damageRules || input.damage || input.resistanceRules || input.effectRules),
    deathRules: normalizePlainObject(input.deathRules || input.death || input.deathSaveRules),
    skillFields: normalizeFieldArray(input.skillFields || input.skills),
    statusFields: normalizeFieldArray(input.statusFields || input.statuses || input.conditionFields),
    questRewardStyle: normalizePlainObject(input.questRewardStyle || input.rewardStyle || input.questRewards),
    referenceTemplateIds: normalizeStringArray(input.referenceTemplateIds || input.templateIds || input.templates),
    promptSections: normalizePlainObject(input.promptSections || input.prompts),
    toolDefaults: normalizePlainObject(input.toolDefaults || input.tools),
    metadata: normalizeMetadata(input),
    ...resourceLifecycleFields(input),
    registryUpdatedAt: normalizeOptionalText(input.registryUpdatedAt) || now()
  };
  normalized.toolDefaults = mergeRulePack(buildToolDefaults(normalized), normalized.toolDefaults);
  return normalized;
}

export function normalizeRulePackTemplate(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!isPlainObject(input)) throw validationError('rule pack template must be a plain object');
  const name = normalizeOptionalText(input.name || input.title);
  if (!name) throw validationError('template.name is required');
  const id = normalizeRecordId(input.id || input.templateId || name, 'template');
  return {
    id,
    name,
    category: normalizeOptionalText(input.category || input.kind || input.type || 'custom'),
    templateType: normalizeOptionalText(input.templateType || input.mode || 'custom'),
    status: normalizeOptionalText(input.status || 'active'),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    description: normalizeOptionalText(input.description || input.summary || input.text),
    template: cloneJson(input.template ?? input.content ?? input.body ?? {}),
    schema: normalizePlainObject(input.schema || input.jsonSchema),
    examples: normalizeArray(input.examples || input.example),
    sourceRef: normalizeOptionalText(input.sourceRef || input.source || input.bookRef),
    metadata: normalizeMetadata(input),
    ...resourceLifecycleFields(input),
    registryUpdatedAt: normalizeOptionalText(input.registryUpdatedAt) || now()
  };
}

export function buildToolDefaults(rulePack = {}) {
  return {
    diceCheck: normalizePlainObject(rulePack.diceDefaults),
    resourceManager: {
      actionEconomy: normalizePlainObject(rulePack.actionEconomy)
    },
    effectSettlement: {
      rules: buildEffectSettlementRules(rulePack)
    },
    mechanicsRegistry: {
      skillFields: normalizeFieldArray(rulePack.skillFields),
      statusFields: normalizeFieldArray(rulePack.statusFields)
    },
    questManager: {
      rewardStyle: normalizePlainObject(rulePack.questRewardStyle)
    }
  };
}

export function buildEffectSettlementRules(rulePack = {}) {
  const damage = normalizePlainObject(rulePack.damageRules);
  const death = normalizePlainObject(rulePack.deathRules);
  return {
    ...DEFAULT_SETTLEMENT_RULES,
    resistanceRounding: damage.resistanceRounding ?? DEFAULT_SETTLEMENT_RULES.resistanceRounding,
    resistanceMultiplier: damage.resistanceMultiplier ?? DEFAULT_SETTLEMENT_RULES.resistanceMultiplier,
    vulnerabilityMultiplier: damage.vulnerabilityMultiplier ?? DEFAULT_SETTLEMENT_RULES.vulnerabilityMultiplier,
    tempHpMode: damage.tempHpMode ?? DEFAULT_SETTLEMENT_RULES.tempHpMode,
    concentrationBaseDc: damage.concentrationBaseDc ?? DEFAULT_SETTLEMENT_RULES.concentrationBaseDc,
    concentrationDamageDivisor: damage.concentrationDamageDivisor ?? DEFAULT_SETTLEMENT_RULES.concentrationDamageDivisor,
    instantDeath: death.instantDeath ?? DEFAULT_SETTLEMENT_RULES.instantDeath,
    deathSaveFailuresFromDamageAtZero: death.deathSaveFailuresFromDamageAtZero ?? DEFAULT_SETTLEMENT_RULES.deathSaveFailuresFromDamageAtZero,
    criticalDamageAtZeroFailures: death.criticalDamageAtZeroFailures ?? DEFAULT_SETTLEMENT_RULES.criticalDamageAtZeroFailures
  };
}

export function mergeRulePack(base = {}, override = {}) {
  return deepMergeRulePack(normalizePlainObject(base), normalizePlainObject(override));
}

function deepMergeRulePack(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      output[key] = mergeArrays(output[key], value);
      continue;
    }
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMergeRulePack(output[key], value);
      continue;
    }
    output[key] = cloneJson(value);
  }
  return output;
}

function mergeArrays(current = [], incoming = []) {
  const base = Array.isArray(current) ? current : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const byKey = new Map();
  const noKey = [];
  for (const item of [...base, ...next]) {
    if (isPlainObject(item)) {
      const key = normalizeOptionalText(item.id || item.name || item.field || item.key);
      if (key) {
        byKey.set(key, { ...(byKey.get(key) || {}), ...cloneJson(item) });
      } else {
        noKey.push(cloneJson(item));
      }
    } else {
      const key = JSON.stringify(item);
      if (!byKey.has(key)) byKey.set(key, cloneJson(item));
    }
  }
  return [...byKey.values(), ...noKey];
}

function matchesBuiltInPack(id) {
  const normalized = normalizeSearchText(id);
  return [DEFAULT_DND_LITE_RULE_PACK.id, ...(DEFAULT_DND_LITE_RULE_PACK.aliases || [])]
    .map(normalizeSearchText)
    .includes(normalized);
}

function resolveBuiltInTemplate(id) {
  const normalized = normalizeSearchText(id);
  return Object.values(BUILTIN_RULE_PACK_TEMPLATES).find((template) => [
    template.id,
    template.name,
    ...(template.aliases || [])
  ].map(normalizeSearchText).includes(normalized));
}

function extractDatabaseTemplateFields(template = {}) {
  const body = normalizePlainObject(template.template);
  const schema = normalizePlainObject(template.schema);
  return normalizeFieldArray(
    body.fields
      || body.fieldSchema
      || body.collectionFields
      || schema.fields
      || schema.properties?.fields?.default
      || []
  );
}

function extractDatabaseTemplateCollections(template = {}) {
  const body = normalizePlainObject(template.template);
  return normalizePlainObjectArray(
    body.collections
    || body.collectionTemplates
    || body.collectionSchemas
    || body.schemas
  )
    .map((collection, index) => {
      const role = normalizeOptionalText(
        collection.role
        || collection.name
        || collection.recordKey
        || collection.suffix
        || `collection_${index + 1}`
      );
      return {
        ...collection,
        role,
        recordKey: normalizeOptionalText(collection.recordKey || role),
        suffix: normalizeOptionalText(collection.suffix || role),
        collection: normalizeOptionalText(collection.collection),
        suggestedCollection: normalizeOptionalText(collection.suggestedCollection),
        idField: normalizeOptionalText(collection.idField || collection.primaryKey || 'id'),
        optional: Boolean(collection.optional),
        fields: normalizeFieldArray(
          collection.fields
          || collection.fieldSchema
          || collection.collectionFields
          || []
        )
      };
    })
    .filter((collection) => collection.role && collection.fields.length > 0);
}

function resolveTemplateCollectionName(collectionTemplate, {
  baseCollection,
  explicitBaseCollection,
  collectionMap = {}
} = {}) {
  const mapKeys = [
    collectionTemplate.role,
    collectionTemplate.recordKey,
    collectionTemplate.suffix,
    collectionTemplate.collection,
    collectionTemplate.suggestedCollection
  ].map(normalizeOptionalText).filter(Boolean);
  for (const key of mapKeys) {
    if (collectionMap[key]) return normalizeRequiredText(collectionMap[key], `collectionMap.${key}`);
  }
  if (!explicitBaseCollection) {
    return normalizeRequiredText(
      collectionTemplate.collection || collectionTemplate.suggestedCollection,
      `collection for ${collectionTemplate.role}`
    );
  }
  const suffix = normalizeRequiredText(
    collectionTemplate.suffix || collectionTemplate.role || collectionTemplate.recordKey,
    `suffix for ${collectionTemplate.role}`
  );
  return `${baseCollection}_${suffix}`;
}

function pickLifecycleInput(input = {}) {
  const output = {};
  for (const key of [
    'resourceLifecycle',
    'lifecycleScope',
    'lifecycleLevel',
    'importanceLevel',
    'characterCardId',
    'chatSessionId',
    'lifecycleClonePolicy',
    'cloneForChat'
  ]) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

function matchesSearch(record, { tags = [], query = '' } = {}) {
  const data = record.data || {};
  const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
  if (requiredTags.length > 0) {
    const actualTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
    if (!requiredTags.every((tag) => actualTags.has(tag))) return false;
  }
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return normalizeSearchText(JSON.stringify({
    id: record.id,
    ...data
  })).includes(normalizedQuery);
}

function selectRecords(groups, preferredCollection, candidates = []) {
  const selected = [preferredCollection, ...candidates].filter(Boolean)
    .map((collection) => groups.find((group) => group.collection === collection))
    .find(Boolean);
  return (selected?.records || []).filter(isPlainObject);
}

function defaultCollectionMap() {
  return {
    rulePacks: RULE_PACK_COLLECTION,
    rule_packs: RULE_PACK_COLLECTION,
    packs: RULE_PACK_COLLECTION,
    rules: RULE_PACK_COLLECTION,
    rulePackTemplates: RULE_PACK_TEMPLATE_COLLECTION,
    rule_pack_templates: RULE_PACK_TEMPLATE_COLLECTION,
    referenceTemplates: RULE_PACK_TEMPLATE_COLLECTION,
    reference_templates: RULE_PACK_TEMPLATE_COLLECTION,
    templates: RULE_PACK_TEMPLATE_COLLECTION
  };
}

function isPackCollection(value) {
  return ['rule_packs', 'rulepacks', 'packs', 'rules'].includes(normalizeSearchText(value).replace(/[^a-z0-9]+/g, ''));
}

function isTemplateCollection(value) {
  return ['rule_pack_templates', 'rulepacktemplates', 'referencetemplates', 'templates'].includes(normalizeSearchText(value).replace(/[^a-z0-9]+/g, ''));
}

function normalizeFieldArray(value) {
  return normalizeArray(value)
    .filter((item) => typeof item === 'string' || isPlainObject(item))
    .map((item) => (typeof item === 'string' ? { name: item, type: 'custom' } : cloneJson(item)));
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizePlainObjectArray(value) {
  return normalizeArray(value).filter(isPlainObject);
}

function normalizePlainObject(value) {
  return isPlainObject(value) ? cloneJson(value) : {};
}

function normalizeMetadata(input = {}) {
  const metadata = {
    ...(isPlainObject(input.metadata) ? input.metadata : {})
  };
  for (const key of ['source', 'importSource', 'campaignId', 'characterCardId', 'chatSessionId', 'createdBy', 'updatedBy']) {
    if (input[key] !== undefined) metadata[key] = input[key];
  }
  return metadata;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value])
    .map((item) => normalizeOptionalText(item))
    .filter(Boolean);
}

function normalizeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw validationError(`${field} must be an integer`);
  return number;
}

function normalizeRecordId(value, prefix) {
  const text = normalizeOptionalText(value);
  if (!text) return createId(prefix);
  return text.replace(/\s+/g, '_').slice(0, 128);
}

function normalizeRequiredText(value, field) {
  const text = normalizeOptionalText(value);
  if (!text) throw validationError(`${field} is required`);
  return text;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSearchText(value) {
  return normalizeOptionalText(value).toLowerCase();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'RulePackValidationError';
  error.statusCode = 400;
  return error;
}
