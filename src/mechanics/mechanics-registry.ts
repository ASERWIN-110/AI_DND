// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';
import {
  RESOURCE_LIFECYCLE_FIELDS,
  filterRecordsByLifecycle,
  getVisibleRecordByLifecycle,
  resourceLifecycleFields
} from '../lifecycle/resource-lifecycle.js';
import { quantifyTextSmart } from '../data/text-quantifier.js';
import {
  BACKGROUND_EXTENSION_FIELDS,
  CLASS_EXTENSION_FIELDS,
  EXTENSION_DATABASE_COMMON_FIELDS,
  EXTENSION_DATABASE_NUMERIC_SETTING_FIELDS,
  EXTENSION_DATABASE_TEMPLATES,
  RACE_EXTENSION_FIELDS
} from '../templates/extension-database-templates.js';

export const SKILL_REGISTRY_COLLECTION = 'skill_registry';
export const STATUS_REGISTRY_COLLECTION = 'status_registry';
export const FEAT_REGISTRY_COLLECTION = 'feat_registry';

export const MECHANIC_NUMERIC_SETTING_FIELDS = EXTENSION_DATABASE_NUMERIC_SETTING_FIELDS;

export const SKILL_REGISTRY_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'category', type: 'text', description: 'combat, social, exploration, knowledge, magic, craft, custom, etc.' },
  { name: 'ability', type: 'text', description: 'Primary ability or attribute, e.g. str, dex, int, charm.' },
  { name: 'rankScale', type: 'json', description: 'Optional rank or proficiency scale.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'description', type: 'text', description: 'Readable skill description.' },
  { name: 'mechanicalEffect', type: 'text', description: 'Compact mechanical effect or prompt-ready rule.' },
  { name: 'prerequisites', type: 'json', description: 'Prerequisite skills, feats, stats, or narrative conditions.' },
  { name: 'relatedStatusIds', type: 'json', description: 'Related status ids.' },
  { name: 'relatedFeatIds', type: 'json', description: 'Related feat ids.' },
  { name: 'sourceRef', type: 'text', description: 'Rulebook, module, prompt, or homebrew reference.' },
  { name: 'status', type: 'text', description: 'active, draft, deprecated, hidden, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  ...MECHANIC_NUMERIC_SETTING_FIELDS,
  { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp.' }
];

export const STATUS_REGISTRY_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'category', type: 'text', description: 'condition, buff, debuff, disease, curse, stance, aura, custom, etc.' },
  { name: 'severity', type: 'text', description: 'minor, moderate, major, critical, variable, etc.' },
  { name: 'durationType', type: 'text', description: 'instant, round, scene, encounter, timed, permanent, conditional.' },
  { name: 'stackRule', type: 'text', description: 'none, refresh, stack, highest, custom.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'description', type: 'text', description: 'Readable status description.' },
  { name: 'mechanicalEffect', type: 'text', description: 'Compact mechanical effect or prompt-ready rule.' },
  { name: 'counters', type: 'json', description: 'Cures, counters, removal checks, or opposite statuses.' },
  { name: 'immunities', type: 'json', description: 'Immunity tags or creature/status ids.' },
  { name: 'sourceRef', type: 'text', description: 'Rulebook, module, prompt, or homebrew reference.' },
  { name: 'status', type: 'text', description: 'active, draft, deprecated, hidden, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  ...MECHANIC_NUMERIC_SETTING_FIELDS,
  { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp.' }
];

export const FEAT_REGISTRY_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'category', type: 'text', description: 'combat, social, magic, heritage, background, class, custom, etc.' },
  { name: 'tier', type: 'text', description: 'novice, expert, master, legendary, variable, or custom tier.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'prerequisites', type: 'json', description: 'Prerequisite stats, levels, skills, statuses, feats, or narrative conditions.' },
  { name: 'description', type: 'text', description: 'Readable feat description.' },
  { name: 'mechanicalEffect', type: 'text', description: 'Compact mechanical effect or prompt-ready rule.' },
  { name: 'grants', type: 'json', description: 'Granted skills, statuses, bonuses, actions, resources, or proficiencies.' },
  { name: 'relatedSkillIds', type: 'json', description: 'Related skill ids.' },
  { name: 'relatedStatusIds', type: 'json', description: 'Related status ids.' },
  { name: 'sourceRef', type: 'text', description: 'Rulebook, module, prompt, or homebrew reference.' },
  { name: 'status', type: 'text', description: 'active, draft, deprecated, hidden, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  ...MECHANIC_NUMERIC_SETTING_FIELDS,
  { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp.' }
];

export const MECHANIC_TEMPLATE_COMMON_FIELDS = EXTENSION_DATABASE_COMMON_FIELDS;
export const CLASS_TEMPLATE_FIELDS = CLASS_EXTENSION_FIELDS;
export const RACE_TEMPLATE_FIELDS = RACE_EXTENSION_FIELDS;
export const BACKGROUND_TEMPLATE_FIELDS = BACKGROUND_EXTENSION_FIELDS;

export const MECHANIC_KIND_TEMPLATES = {
  skill: createMechanicTemplate({
    id: 'skill',
    title: 'Skill / Proficiency Template',
    description: 'Registered template for skills, proficiencies, abilities, and action-facing competencies.',
    registered: true,
    collection: SKILL_REGISTRY_COLLECTION,
    recordKey: 'skills',
    aliases: ['skills', 'skill_registry', 'abilities', 'proficiencies'],
    prefix: 'skill',
    fields: SKILL_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'lockpick',
      name: '开锁',
      category: 'exploration',
      ability: 'dex',
      rankScale: { untrained: 0, trained: 2, expert: 4 },
      tags: ['tool', 'exploration'],
      mechanicalEffect: 'Add toolBonus to checks using thieves tools.',
      numericValues: { toolBonus: 2 }
    }
  }),
  status: createMechanicTemplate({
    id: 'status',
    title: 'Status / Condition Template',
    description: 'Registered template for conditions, buffs, debuffs, curses, diseases, stances, and auras.',
    registered: true,
    collection: STATUS_REGISTRY_COLLECTION,
    recordKey: 'statuses',
    aliases: ['statuses', 'status_registry', 'conditions', 'effects', 'status_effects'],
    prefix: 'status',
    fields: STATUS_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'burning',
      name: '燃烧',
      category: 'debuff',
      severity: 'variable',
      durationType: 'round',
      stackRule: 'refresh',
      mechanicalEffect: 'Take fire damage at the start of each round until removed.',
      counters: ['water', 'stop_drop_roll'],
      numericValues: { damagePerRound: 2, durationRounds: 3 }
    }
  }),
  feat: createMechanicTemplate({
    id: 'feat',
    title: 'Feat / Perk Template',
    description: 'Registered template for feats, perks, talents, traits, specialties, and special features.',
    registered: true,
    collection: FEAT_REGISTRY_COLLECTION,
    recordKey: 'feats',
    aliases: ['feats', 'feat_registry', 'perks', 'talents', 'specialties', 'traits'],
    prefix: 'feat',
    fields: FEAT_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'duelist',
      name: '决斗者',
      category: 'combat',
      tier: 'novice',
      prerequisites: ['one_handed_weapon'],
      grants: ['reaction_parry'],
      mechanicalEffect: 'Gain a defensive reaction while wielding one melee weapon.',
      numericValues: { parryBonus: 2 }
    }
  }),
  class: createMechanicTemplate(EXTENSION_DATABASE_TEMPLATES.class),
  race: createMechanicTemplate(EXTENSION_DATABASE_TEMPLATES.race),
  background: createMechanicTemplate(EXTENSION_DATABASE_TEMPLATES.background)
};

const KIND_CONFIG = {
  skill: {
    collection: SKILL_REGISTRY_COLLECTION,
    fields: SKILL_REGISTRY_FIELDS,
    recordKey: 'skills',
    aliases: ['skills', 'skill_registry', 'abilities', 'proficiencies'],
    prefix: 'skill'
  },
  status: {
    collection: STATUS_REGISTRY_COLLECTION,
    fields: STATUS_REGISTRY_FIELDS,
    recordKey: 'statuses',
    aliases: ['statuses', 'status_registry', 'conditions', 'effects', 'status_effects'],
    prefix: 'status'
  },
  feat: {
    collection: FEAT_REGISTRY_COLLECTION,
    fields: FEAT_REGISTRY_FIELDS,
    recordKey: 'feats',
    aliases: ['feats', 'feat_registry', 'perks', 'talents', 'specialties', 'traits'],
    prefix: 'feat'
  }
};

export class MechanicsRegistry {
  constructor({
    dataManager = new SQLiteDataManager(),
    appDatabase,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.appDatabase = appDatabase;
    this.now = now || (() => new Date().toISOString());
    this.ensureRegistry();
  }

  ensureRegistry() {
    for (const [kind, config] of Object.entries(KIND_CONFIG)) {
      this.dataManager.ensureCollection(config.collection);
      this.dataManager.alterFields(config.collection, {
        add: config.fields,
        reason: `mechanicsRegistry:${kind}`
      });
    }
    return this.describe();
  }

  describe() {
    return Object.fromEntries(Object.entries(KIND_CONFIG).map(([kind, config]) => [
      kind,
      this.dataManager.describeCollection(config.collection)
    ]));
  }

  listTemplates(input = {}) {
    return listMechanicTemplates(input);
  }

  getTemplate(id, options = {}) {
    return getMechanicTemplate(id, options);
  }

  upsertSkill(skill, options = {}) {
    return this.upsertRecord('skill', skill, options);
  }

  async upsertSkillAsync(skill, options = {}) {
    return this.upsertRecordAsync('skill', skill, options);
  }

  patchSkill(id, patch, options = {}) {
    return this.patchRecord('skill', id, patch, options);
  }

  async patchSkillAsync(id, patch, options = {}) {
    return this.patchRecordAsync('skill', id, patch, options);
  }

  getSkill(id) {
    return this.getRecord('skill', id);
  }

  deleteSkill(id) {
    return this.deleteRecord('skill', id);
  }

  listSkills(input = {}) {
    return this.listRecords('skill', input);
  }

  upsertStatus(status, options = {}) {
    return this.upsertRecord('status', status, options);
  }

  async upsertStatusAsync(status, options = {}) {
    return this.upsertRecordAsync('status', status, options);
  }

  patchStatus(id, patch, options = {}) {
    return this.patchRecord('status', id, patch, options);
  }

  async patchStatusAsync(id, patch, options = {}) {
    return this.patchRecordAsync('status', id, patch, options);
  }

  getStatus(id) {
    return this.getRecord('status', id);
  }

  deleteStatus(id) {
    return this.deleteRecord('status', id);
  }

  listStatuses(input = {}) {
    return this.listRecords('status', input);
  }

  upsertFeat(feat, options = {}) {
    return this.upsertRecord('feat', feat, options);
  }

  async upsertFeatAsync(feat, options = {}) {
    return this.upsertRecordAsync('feat', feat, options);
  }

  patchFeat(id, patch, options = {}) {
    return this.patchRecord('feat', id, patch, options);
  }

  async patchFeatAsync(id, patch, options = {}) {
    return this.patchRecordAsync('feat', id, patch, options);
  }

  getFeat(id) {
    return this.getRecord('feat', id);
  }

  deleteFeat(id) {
    return this.deleteRecord('feat', id);
  }

  listFeats(input = {}) {
    return this.listRecords('feat', input);
  }

  upsertRecord(kind, input, options = {}) {
    const normalizedKind = normalizeKind(kind);
    const config = KIND_CONFIG[normalizedKind];
    const prepared = applyMechanicQuantification(normalizedKind, input, {
      now: this.now,
      context: options.context
    });
    const normalized = normalizeMechanicRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(config.collection, normalized, { id: normalized.id });
  }

  async upsertRecordAsync(kind, input, options = {}) {
    const normalizedKind = normalizeKind(kind);
    const config = KIND_CONFIG[normalizedKind];
    const prepared = await applyMechanicQuantificationAsync(normalizedKind, input, {
      now: this.now,
      context: options.context,
      chatProvider: options.chatProvider
    });
    const normalized = normalizeMechanicRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(config.collection, normalized, { id: normalized.id });
  }

  patchRecord(kind, id, patch, options = {}) {
    const normalizedKind = normalizeKind(kind);
    const current = this.getRecord(normalizedKind, id);
    const prepared = applyMechanicQuantification(normalizedKind, {
      ...current.data,
      ...patch,
      id: current.id,
      lifecycleCanonicalId: current.data.lifecycleCanonicalId || id
    }, {
      now: this.now,
      context: options.context
    });
    const normalized = normalizeMechanicRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(KIND_CONFIG[normalizedKind].collection, normalized, { id: current.id });
  }

  async patchRecordAsync(kind, id, patch, options = {}) {
    const normalizedKind = normalizeKind(kind);
    const current = this.getRecord(normalizedKind, id);
    const prepared = await applyMechanicQuantificationAsync(normalizedKind, {
      ...current.data,
      ...patch,
      id: current.id,
      lifecycleCanonicalId: current.data.lifecycleCanonicalId || id
    }, {
      now: this.now,
      context: options.context,
      chatProvider: options.chatProvider
    });
    const normalized = normalizeMechanicRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(KIND_CONFIG[normalizedKind].collection, normalized, { id: current.id });
  }

  getRecord(kind, id) {
    const normalizedKind = normalizeKind(kind);
    return getVisibleRecordByLifecycle(this.dataManager, KIND_CONFIG[normalizedKind].collection, id, {}, { appDatabase: this.appDatabase })
      || this.dataManager.getRecord(KIND_CONFIG[normalizedKind].collection, id);
  }

  deleteRecord(kind, id) {
    const normalizedKind = normalizeKind(kind);
    return this.dataManager.deleteRecord(KIND_CONFIG[normalizedKind].collection, id);
  }

  listRecords(kind, input = {}) {
    const {
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0
    } = input;
    const normalizedKind = normalizeKind(kind);
    const result = filterRecordsByLifecycle(this.dataManager.queryRecords(KIND_CONFIG[normalizedKind].collection, {
      filter,
      sort,
      limit,
      offset
    }), input, { appDatabase: this.appDatabase });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => matchesMechanicSearch(record, normalizedKind, {
      requiredTags,
      normalizedQuery
    }));
    return {
      ...result,
      kind: normalizedKind,
      records
    };
  }

  importDocument(input = {}, options = {}) {
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || defaultCollectionMap(),
      idField: input.idField || 'id'
    });
    const kinds = input.kind ? [normalizeKind(input.kind)] : Object.keys(KIND_CONFIG);
    const imported = {};
    const quantificationDefaults = mechanicImportQuantificationDefaults(input);
    for (const kind of kinds) {
      const selected = selectMechanicRecords(groups, kind, input.collection);
      imported[KIND_CONFIG[kind].recordKey] = selected.map((record) => this.upsertRecord(kind, {
        ...quantificationDefaults,
        ...lifecycleImportDefaults(input),
        ...record,
        importSource: input.source || 'document-import'
      }, options));
    }
    const counts = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.length]));
    const ids = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.map((record) => record.id)]));
    return {
      format: parsed.format,
      counts,
      ids,
      records: imported
    };
  }

  async importDocumentAsync(input = {}, options = {}) {
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || defaultCollectionMap(),
      idField: input.idField || 'id'
    });
    const kinds = input.kind ? [normalizeKind(input.kind)] : Object.keys(KIND_CONFIG);
    const imported = {};
    const quantificationDefaults = mechanicImportQuantificationDefaults(input);
    for (const kind of kinds) {
      const selected = selectMechanicRecords(groups, kind, input.collection);
      imported[KIND_CONFIG[kind].recordKey] = [];
      for (const record of selected) {
        imported[KIND_CONFIG[kind].recordKey].push(await this.upsertRecordAsync(kind, {
          ...quantificationDefaults,
          ...lifecycleImportDefaults(input),
          ...record,
          importSource: input.source || 'document-import'
        }, options));
      }
    }
    const counts = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.length]));
    const ids = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.map((record) => record.id)]));
    return {
      format: parsed.format,
      counts,
      ids,
      records: imported
    };
  }

  exportDocument({
    format = 'json',
    kind,
    filter = {},
    tags = [],
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const kinds = kind ? [normalizeKind(kind)] : Object.keys(KIND_CONFIG);
    const payload = {};
    for (const currentKind of kinds) {
      const listed = this.listRecords(currentKind, { filter, tags, query, limit, offset });
      payload[KIND_CONFIG[currentKind].recordKey] = listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }));
    }
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

export function normalizeMechanicRecord(kind, input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError(`${kind} must be a plain object`);
  }
  const normalizedKind = normalizeKind(kind);
  const name = normalizeOptionalText(input.name);
  if (!name) throw validationError(`${normalizedKind}.name is required`);
  const id = normalizeMechanicId(input.id || input[`${normalizedKind}Id`] || name, KIND_CONFIG[normalizedKind].prefix);
  const base = {
    id,
    name,
    category: normalizeOptionalText(input.category || input.type || 'custom'),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    description: normalizeOptionalText(input.description || input.summary || input.text),
    mechanicalEffect: normalizeOptionalText(input.mechanicalEffect || input.effect || input.rule || input.rulesText),
    sourceRef: normalizeOptionalText(input.sourceRef || input.source || input.bookRef),
    status: normalizeOptionalText(input.status || 'active'),
    metadata: normalizeMetadata(input),
    numericValues: normalizeNumericValues(input.numericValues || input.values || input.numericSettings || input.settingValues),
    textSettings: normalizePlainObject(input.textSettings || input.specialTextSettings),
    quantificationDefinition: normalizePlainObject(input.quantificationDefinition || input.numericDefinition || input.definition),
    quantificationSourceText: normalizeOptionalText(input.quantificationSourceText || input.numericSourceText || input.quantificationText),
    quantificationAudit: normalizePlainObject(input.quantificationAudit || input.numericQuantification),
    quantificationUpdatedAt: normalizeOptionalText(input.quantificationUpdatedAt),
    ...resourceLifecycleFields(input),
    registryUpdatedAt: now()
  };

  if (normalizedKind === 'skill') {
    return {
      ...base,
      ability: normalizeOptionalText(input.ability || input.attribute || input.stat),
      rankScale: normalizeArrayOrObject(input.rankScale || input.ranks || input.proficiency),
      prerequisites: normalizeArrayOrObject(input.prerequisites || input.requires),
      relatedStatusIds: normalizeStringArray(input.relatedStatusIds || input.statusRefs || input.statuses),
      relatedFeatIds: normalizeStringArray(input.relatedFeatIds || input.featRefs || input.feats)
    };
  }

  if (normalizedKind === 'status') {
    return {
      ...base,
      severity: normalizeOptionalText(input.severity || 'variable'),
      durationType: normalizeOptionalText(input.durationType || input.duration || 'conditional'),
      stackRule: normalizeOptionalText(input.stackRule || input.stacking || 'custom'),
      counters: normalizeArrayOrObject(input.counters || input.removal || input.cures),
      immunities: normalizeStringArray(input.immunities || input.immuneTags)
    };
  }

  return {
    ...base,
    tier: normalizeOptionalText(input.tier || input.level || 'variable'),
    prerequisites: normalizeArrayOrObject(input.prerequisites || input.requires),
    grants: normalizeArrayOrObject(input.grants || input.bonuses || input.unlocks),
    relatedSkillIds: normalizeStringArray(input.relatedSkillIds || input.skillRefs || input.skills),
    relatedStatusIds: normalizeStringArray(input.relatedStatusIds || input.statusRefs || input.statuses)
  };
}

function matchesMechanicSearch(record, kind, { requiredTags, normalizedQuery }) {
  const data = record.data || {};
  if (requiredTags.length > 0) {
    const tags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
    if (!requiredTags.every((tag) => tags.has(tag))) return false;
  }
  if (!normalizedQuery) return true;
  const common = [
    record.id,
    data.name,
    data.category,
    data.description,
    data.mechanicalEffect,
    data.sourceRef,
    JSON.stringify(data.numericValues || {}),
    JSON.stringify(data.textSettings || {}),
    ...(Array.isArray(data.tags) ? data.tags : []),
    ...(Array.isArray(data.aliases) ? data.aliases : [])
  ];
  const extra = kind === 'skill'
    ? [data.ability, ...(Array.isArray(data.relatedStatusIds) ? data.relatedStatusIds : []), ...(Array.isArray(data.relatedFeatIds) ? data.relatedFeatIds : [])]
    : kind === 'status'
      ? [data.severity, data.durationType, data.stackRule]
      : [data.tier, ...(Array.isArray(data.relatedSkillIds) ? data.relatedSkillIds : []), ...(Array.isArray(data.relatedStatusIds) ? data.relatedStatusIds : [])];
  return normalizeSearchText([...common, ...extra].filter(Boolean).join(' ')).includes(normalizedQuery);
}

function selectMechanicRecords(groups, kind, preferredCollection) {
  const config = KIND_CONFIG[kind];
  const candidates = [preferredCollection, config.collection, ...config.aliases].filter(Boolean);
  const selected = candidates
    .map((collection) => groups.find((group) => group.collection === collection))
    .find(Boolean);
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function defaultCollectionMap() {
  return Object.fromEntries(Object.values(KIND_CONFIG).flatMap((config) => (
    config.aliases.map((alias) => [alias, config.collection])
  )));
}

export function listMechanicTemplates({
  query = '',
  registeredOnly = false,
  templateOnly,
  includeFields = true,
  includeExamples = true
} = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const templates = Object.values(MECHANIC_KIND_TEMPLATES)
    .filter((template) => !registeredOnly || template.registered)
    .filter((template) => templateOnly === undefined || Boolean(template.templateOnly) === Boolean(templateOnly))
    .filter((template) => {
      if (!normalizedQuery) return true;
      return normalizeSearchText([
        template.id,
        template.title,
        template.description,
        template.recordKey,
        template.collection,
        template.suggestedCollection,
        ...(template.aliases || []),
        ...(template.tags || [])
      ].filter(Boolean).join(' ')).includes(normalizedQuery);
    })
    .map((template) => projectMechanicTemplate(template, { includeFields, includeExamples }));
  return {
    count: templates.length,
    templates
  };
}

export function getMechanicTemplate(id, {
  includeFields = true,
  includeExamples = true
} = {}) {
  const template = resolveMechanicTemplate(id);
  if (!template) throw validationError(`Mechanic template not found: ${id}`);
  return projectMechanicTemplate(template, { includeFields, includeExamples });
}

function createMechanicTemplate({
  id,
  title,
  description,
  registered = false,
  templateOnly = false,
  collection = '',
  suggestedCollection = '',
  recordKey = '',
  aliases = [],
  prefix = '',
  fields = [],
  exampleRecord = {},
  quantificationTemplate,
  tags = []
}) {
  return {
    id,
    title,
    description,
    registered: Boolean(registered),
    templateOnly: Boolean(templateOnly || !registered),
    collection,
    suggestedCollection,
    recordKey,
    aliases,
    prefix,
    tags: [...new Set(['mechanics', id, registered ? 'registered' : 'template-only', ...tags])],
    fields: cloneJson(fields),
    fieldNames: fields.map((field) => field.name),
    exampleRecord: cloneJson(exampleRecord),
    quantificationTemplate: cloneJson(quantificationTemplate || defaultQuantificationTemplate(id)),
    notes: registered
      ? ['This template is backed by an existing mechanics registry collection.']
      : ['Template only. It does not create a collection or CRUD surface until the user explicitly adds one later.']
  };
}

function defaultQuantificationTemplate(id) {
  return {
    prompt: `Quantify ${id} mechanics from fuzzy text using user-provided field references first.`,
    numericFields: [
      {
        name: 'powerScore',
        type: 'integer',
        min: 0,
        max: 10,
        defaultValue: 0,
        description: 'Optional generic power or impact score for debugging templates.'
      }
    ],
    referenceDocuments: []
  };
}

function resolveMechanicTemplate(id) {
  const normalized = normalizeSearchText(id);
  return Object.values(MECHANIC_KIND_TEMPLATES).find((template) => (
    normalizeSearchText(template.id) === normalized
    || normalizeSearchText(template.recordKey) === normalized
    || normalizeSearchText(template.collection) === normalized
    || normalizeSearchText(template.suggestedCollection) === normalized
    || (template.aliases || []).some((alias) => normalizeSearchText(alias) === normalized)
  ));
}

function projectMechanicTemplate(template, {
  includeFields = true,
  includeExamples = true
} = {}) {
  const output = {
    id: template.id,
    title: template.title,
    description: template.description,
    registered: template.registered,
    templateOnly: template.templateOnly,
    collection: template.collection,
    suggestedCollection: template.suggestedCollection,
    recordKey: template.recordKey,
    aliases: cloneJson(template.aliases),
    prefix: template.prefix,
    tags: cloneJson(template.tags),
    fieldNames: cloneJson(template.fieldNames),
    notes: cloneJson(template.notes)
  };
  if (includeFields) output.fields = cloneJson(template.fields);
  if (includeExamples) {
    output.exampleRecord = cloneJson(template.exampleRecord);
    output.quantificationTemplate = cloneJson(template.quantificationTemplate);
  }
  return output;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function mechanicImportQuantificationDefaults(input = {}) {
  const keys = [
    'quantify',
    'quantifyNumeric',
    'autoQuantify',
    'useLlm',
    'preferLlm',
    'requireLlm',
    'allowNewFields',
    'maxNewFields',
    'quantificationDefinition',
    'numericDefinition',
    'definition',
    'referenceText',
    'referenceDocuments',
    'referenceDocs',
    'referenceFiles',
    'referenceFilePaths',
    'allowReferenceFilePaths',
    'cwd',
    'temperature',
    'maxTokens',
    'newFieldsMaxTokens'
  ];
  return Object.fromEntries(keys
    .filter((key) => input[key] !== undefined)
    .map((key) => [key, input[key]]));
}

function normalizeKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (['skill', 'skills', 'ability', 'abilities', 'proficiency', 'proficiencies'].includes(normalized)) return 'skill';
  if (['status', 'statuses', 'condition', 'conditions', 'effect', 'effects'].includes(normalized)) return 'status';
  if (['feat', 'feats', 'perk', 'perks', 'talent', 'talents', 'specialty', 'specialties', 'trait', 'traits'].includes(normalized)) return 'feat';
  throw validationError(`Unsupported mechanics kind: ${kind}`);
}

function normalizeMechanicId(value, prefix) {
  const base = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return base || `${prefix}_${shortHash(value)}`;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeArrayOrObject(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value;
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function applyMechanicQuantification(kind, input = {}, {
  context = {}
} = {}) {
  const definition = selectQuantificationDefinition(input);
  const explicit = input.quantify === true
    || input.quantifyNumeric === true
    || input.autoQuantify === true
    || input.quantification?.enabled === true;
  const agentCreated = isAgentAuthored(input, context);
  const hasDirectNumericValues = hasPlainObject(input.numericValues)
    || hasPlainObject(input.values)
    || hasPlainObject(input.numericSettings)
    || hasPlainObject(input.settingValues);
  const shouldQuantify = explicit || (agentCreated && definition && !hasDirectNumericValues);

  if (!shouldQuantify) return input;
  throw validationError(`${kind} quantification must use the unified async quantification path. Use system.mechanics_registry.* tools or MechanicsRegistry *Async methods.`);
}

async function applyMechanicQuantificationAsync(kind, input = {}, {
  now = () => new Date().toISOString(),
  context = {},
  chatProvider
} = {}) {
  const definition = selectQuantificationDefinition(input);
  const explicit = input.quantify === true
    || input.quantifyNumeric === true
    || input.autoQuantify === true
    || input.quantification?.enabled === true;
  const agentCreated = isAgentAuthored(input, context);
  const hasDirectNumericValues = hasPlainObject(input.numericValues)
    || hasPlainObject(input.values)
    || hasPlainObject(input.numericSettings)
    || hasPlainObject(input.settingValues);
  const shouldQuantify = explicit || (agentCreated && definition && !hasDirectNumericValues);

  if (!shouldQuantify) return input;
  if (!definition) {
    throw validationError('quantificationDefinition, numericDefinition, or definition is required when quantifyNumeric is true');
  }

  const sourceText = selectQuantificationSourceText(input);
  if (!sourceText) {
    throw validationError('quantificationSourceText, numericSourceText, quantificationText, text, description, or mechanicalEffect is required for mechanic quantification');
  }

  const quantified = await quantifyTextSmart({
    text: sourceText,
    definition,
    values: normalizePlainObject(input.quantificationValues || input.providedValues || {}),
    useLlm: input.useLlm ?? input.preferLlm ?? Boolean(agentCreated && chatProvider),
    preferLlm: input.preferLlm,
    requireLlm: input.requireLlm,
    allowNewFields: input.allowNewFields ?? definition.allowNewFields,
    maxNewFields: input.maxNewFields ?? definition.maxNewFields,
    referenceText: input.referenceText,
    referenceDocuments: input.referenceDocuments || input.referenceDocs,
    referenceFiles: input.referenceFiles || input.referenceFilePaths,
    allowReferenceFilePaths: Boolean(input.allowReferenceFilePaths),
    cwd: input.cwd,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    newFieldsMaxTokens: input.newFieldsMaxTokens,
    storeRawText: false,
    storeAudit: false
  }, { chatProvider });
  const numericValues = {
    ...normalizeNumericValues(input.numericValues || input.values || input.numericSettings || input.settingValues),
    ...extractNumericQuantifiedValues(quantified.values)
  };
  const textSettings = {
    ...normalizePlainObject(input.textSettings || input.specialTextSettings),
    ...extractTextQuantifiedValues(quantified.values)
  };

  return {
    ...input,
    numericValues,
    textSettings,
    quantificationDefinition: definition,
    quantificationSourceText: sourceText,
    quantificationAudit: {
      kind,
      trigger: explicit ? 'explicit' : 'agent_authored',
      prompt: quantified.prompt,
      definitionVersion: quantified.definitionVersion,
      values: quantified.values,
      numericValues,
      textSettings,
      decisions: quantified.decisions,
      llm: quantified.llm
        ? {
          used: Boolean(quantified.llm.used),
          calls: (quantified.llm.calls || []).map((call) => ({
            field: call.field,
            content: call.content
          }))
        }
        : { used: false }
    },
    quantificationUpdatedAt: now()
  };
}

function selectQuantificationDefinition(input = {}) {
  if (hasPlainObject(input.quantificationDefinition)) return input.quantificationDefinition;
  if (hasPlainObject(input.numericDefinition)) return input.numericDefinition;
  if (hasPlainObject(input.definition)) return input.definition;
  if (hasPlainObject(input.quantification?.definition)) return input.quantification.definition;
  return undefined;
}

function selectQuantificationSourceText(input = {}) {
  return normalizeOptionalText(
    input.quantificationSourceText
    || input.numericSourceText
    || input.quantificationText
    || input.text
    || [input.description || input.summary, input.mechanicalEffect || input.effect || input.rule || input.rulesText]
      .filter(Boolean)
      .join('\n')
  );
}

function extractNumericQuantifiedValues(values = {}) {
  const output = {};
  for (const [field, value] of Object.entries(values || {})) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    output[field] = number;
  }
  return output;
}

function extractTextQuantifiedValues(values = {}) {
  const output = {};
  for (const [field, value] of Object.entries(values || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Number.isFinite(Number(value))) continue;
    output[field] = value;
  }
  return output;
}

function normalizeNumericValues(value) {
  if (value === undefined || value === null || value === '') return {};
  if (!hasPlainObject(value)) throw validationError('numericValues must be a plain object');
  const output = {};
  for (const [field, rawValue] of Object.entries(value)) {
    const name = normalizeSettingFieldName(field);
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const number = Number(rawValue);
    if (!Number.isFinite(number)) {
      throw validationError(`numericValues.${name} must be a finite number`);
    }
    output[name] = number;
  }
  return output;
}

function normalizePlainObject(value) {
  return hasPlainObject(value) ? value : {};
}

function hasPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSettingFieldName(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw validationError('numericValues field name is required');
  if (normalized.length > 128) throw validationError(`numericValues field name is too long: ${normalized}`);
  return normalized;
}

function isAgentAuthored(input = {}, context = {}) {
  return isAgentMarker(input.actor)
    || isAgentMarker(input.createdBy)
    || isAgentMarker(input.updatedBy)
    || isAgentMarker(input.sourceActor)
    || isAgentMarker(input.author)
    || isAgentMarker(context.actor)
    || isAgentMarker(context.sourceActor)
    || isAgentMarker(context.caller)
    || isAgentMarker(context.author);
}

function isAgentMarker(value) {
  if (!value) return false;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return isAgentMarker(value.type) || isAgentMarker(value.role) || isAgentMarker(value.kind);
  }
  const normalized = String(value).trim().toLowerCase();
  return ['agent', 'assistant', 'ai', 'llm', 'gm'].includes(normalized);
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMetadata(input) {
  const metadata = {
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {})
  };
  for (const key of ['source', 'importSource', 'campaignId', 'chatSessionId', 'characterCardId']) {
    if (input[key] !== undefined) metadata[key] = input[key];
  }
  if (input.metadata?.resourceLifecycle) metadata.resourceLifecycle = input.metadata.resourceLifecycle;
  return metadata;
}

function lifecycleImportDefaults(input = {}) {
  return {
    resourceLifecycle: input.resourceLifecycle,
    lifecycleScope: input.lifecycleScope,
    lifecycleLevel: input.lifecycleLevel,
    importanceLevel: input.importanceLevel,
    characterCardId: input.characterCardId,
    chatSessionId: input.chatSessionId
  };
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'MechanicsRegistryValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'mechanic');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
