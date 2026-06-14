// @ts-nocheck
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';
import { resolveResourceLifecycle, RESOURCE_LIFECYCLE_FIELDS } from '../lifecycle/resource-lifecycle.js';
import { createId } from '../utils/id.js';

export const VISUAL_ASSET_COLLECTION = 'visual_assets';
export const VISUAL_ASSET_BINDING_COLLECTION = 'visual_asset_bindings';
export const VISUAL_EVENT_BINDING_COLLECTION = 'visual_event_bindings';

export const VISUAL_ASSET_FIELDS = [
  { name: 'assetId', type: 'text', description: 'Stable visual asset id.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'assetType', type: 'text', description: 'image, animation, sprite, video, audio, model, icon, effect, or custom.' },
  { name: 'uri', type: 'text', description: 'Local path, URL, storage key, or future asset reference.' },
  { name: 'mimeType', type: 'text', description: 'Optional MIME type.' },
  { name: 'prompt', type: 'text', description: 'Optional generation prompt or art direction for future asset generation.' },
  { name: 'source', type: 'text', description: 'manual, imported, generated, external, placeholder, etc.' },
  { name: 'status', type: 'text', description: 'active, draft, missing, hidden, archived, deprecated, etc.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative asset names.' },
  { name: 'dimensions', type: 'json', description: 'Width, height, duration, frame count, or model bounds.' },
  { name: 'variants', type: 'json', description: 'Alternative sizes, states, crops, languages, or quality variants.' },
  { name: 'credits', type: 'json', description: 'Author, license, model, source URL, attribution, or rights notes.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt asset metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'assetUpdatedAt', type: 'text', description: 'Latest visual asset update timestamp.' }
];

export const VISUAL_ASSET_BINDING_FIELDS = [
  { name: 'bindingId', type: 'text', description: 'Stable visual binding id.' },
  { name: 'targetType', type: 'text', description: 'npc, player, map, item, skill, status, scene, faction, quest, encounter, combatant, custom, etc.' },
  { name: 'targetId', type: 'text', description: 'Target object id in its owning database.' },
  { name: 'slot', type: 'text', description: 'portrait, token, background, icon, overlay, idle_animation, hit_effect, panel, etc.' },
  { name: 'assetId', type: 'text', description: 'Visual asset id from visual_assets.' },
  { name: 'priority', type: 'integer', description: 'Higher priority wins when multiple assets match.' },
  { name: 'conditions', type: 'json', description: 'Optional matching conditions such as sceneId, status, result, biome, time, equipment, or metadata.' },
  { name: 'visibility', type: 'text', description: 'public, player, gm, hidden, debug, etc.' },
  { name: 'status', type: 'text', description: 'active, inactive, hidden, archived, missing, etc.' },
  { name: 'tags', type: 'json', description: 'Binding tags.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt binding metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'bindingUpdatedAt', type: 'text', description: 'Latest visual binding update timestamp.' }
];

export const VISUAL_EVENT_BINDING_FIELDS = [
  { name: 'eventBindingId', type: 'text', description: 'Stable visual event binding id.' },
  { name: 'eventType', type: 'text', description: 'dice_roll, adjudication, persuasion, combat_hit, combat_miss, status_tick, quest_complete, scene_enter, custom, etc.' },
  { name: 'slot', type: 'text', description: 'animation, effect, panel, sound, overlay, icon, background, etc.' },
  { name: 'assetId', type: 'text', description: 'Visual asset id from visual_assets.' },
  { name: 'priority', type: 'integer', description: 'Higher priority wins when multiple event assets match.' },
  { name: 'conditions', type: 'json', description: 'Optional matching conditions such as result, diceSides, damageType, statusId, intent, risk, or metadata.' },
  { name: 'status', type: 'text', description: 'active, inactive, hidden, archived, missing, etc.' },
  { name: 'visibility', type: 'text', description: 'public, player, gm, hidden, debug, etc.' },
  { name: 'tags', type: 'json', description: 'Event binding tags.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt event binding metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'visualEventUpdatedAt', type: 'text', description: 'Latest visual event binding update timestamp.' }
];

export const VISUAL_ASSET_TEMPLATES = {
  asset: {
    id: 'visual_asset',
    collection: VISUAL_ASSET_COLLECTION,
    description: 'Resource reference only. The URI may be empty until a real image/animation/audio/model is added.',
    fields: VISUAL_ASSET_FIELDS,
    example: {
      assetId: 'asset_mira_portrait',
      name: 'Mira Portrait Placeholder',
      assetType: 'image',
      uri: '',
      prompt: 'Portrait art direction for Mira, if generated later.',
      source: 'placeholder',
      status: 'draft',
      tags: ['npc', 'portrait']
    }
  },
  binding: {
    id: 'visual_asset_binding',
    collection: VISUAL_ASSET_BINDING_COLLECTION,
    description: 'Bind a visual asset to an object such as NPC, map, item, status, scene, faction, or skill.',
    fields: VISUAL_ASSET_BINDING_FIELDS,
    example: {
      bindingId: 'binding_mira_portrait',
      targetType: 'npc',
      targetId: 'npc_mira',
      slot: 'portrait',
      assetId: 'asset_mira_portrait',
      priority: 100,
      conditions: {},
      status: 'active'
    }
  },
  eventBinding: {
    id: 'visual_event_binding',
    collection: VISUAL_EVENT_BINDING_COLLECTION,
    description: 'Bind a visual asset to an event such as dice roll, adjudication, persuasion, combat, status tick, or quest completion.',
    fields: VISUAL_EVENT_BINDING_FIELDS,
    example: {
      eventBindingId: 'event_binding_d20_critical',
      eventType: 'dice_roll',
      slot: 'animation',
      assetId: 'asset_d20_critical_flash',
      priority: 100,
      conditions: { result: 'critical_success' },
      status: 'active'
    }
  }
};

export class VisualAssetManager {
  constructor({
    dataManager = new SQLiteDataManager(),
    appDatabase,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.appDatabase = appDatabase;
    this.now = now || (() => new Date().toISOString());
    this.ensureCollections();
  }

  ensureCollections() {
    this.dataManager.ensureCollection(VISUAL_ASSET_COLLECTION);
    this.dataManager.alterFields(VISUAL_ASSET_COLLECTION, {
      add: VISUAL_ASSET_FIELDS,
      reason: 'visualAssets:asset-registry'
    });
    this.dataManager.ensureCollection(VISUAL_ASSET_BINDING_COLLECTION);
    this.dataManager.alterFields(VISUAL_ASSET_BINDING_COLLECTION, {
      add: VISUAL_ASSET_BINDING_FIELDS,
      reason: 'visualAssets:object-bindings'
    });
    this.dataManager.ensureCollection(VISUAL_EVENT_BINDING_COLLECTION);
    this.dataManager.alterFields(VISUAL_EVENT_BINDING_COLLECTION, {
      add: VISUAL_EVENT_BINDING_FIELDS,
      reason: 'visualAssets:event-bindings'
    });
    return {
      assets: this.dataManager.describeCollection(VISUAL_ASSET_COLLECTION),
      bindings: this.dataManager.describeCollection(VISUAL_ASSET_BINDING_COLLECTION),
      eventBindings: this.dataManager.describeCollection(VISUAL_EVENT_BINDING_COLLECTION)
    };
  }

  describe() {
    return {
      noLlm: true,
      policy: 'Visual assets are presentation hints only. No rendering, generation, animation playback, or prompt image injection is performed here.',
      collections: this.ensureCollections(),
      templates: VISUAL_ASSET_TEMPLATES,
      resolveTool: 'system.visual.resolve_assets',
      noopBehavior: 'If no matching bindings or real asset URIs exist, resolve_assets returns noop=true and does not affect gameplay.'
    };
  }

  listTemplates({ query = '', tags = [], limit = 100, offset = 0 } = {}) {
    const normalizedQuery = normalizeSearchText(query);
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const records = Object.values(VISUAL_ASSET_TEMPLATES)
      .filter((template) => {
        if (normalizedQuery) {
          const haystack = normalizeSearchText([
            template.id,
            template.collection,
            template.description,
            JSON.stringify(template.example || {})
          ].join(' '));
          if (!haystack.includes(normalizedQuery)) return false;
        }
        if (requiredTags.length > 0) {
          const haystack = normalizeSearchText([
            template.id,
            template.collection,
            template.description
          ].join(' '));
          if (!requiredTags.every((tag) => haystack.includes(tag))) return false;
        }
        return true;
      });
    return {
      records: records.slice(offset, offset + limit).map(cloneJson),
      count: records.length,
      limit,
      offset
    };
  }

  getTemplate(id) {
    const normalized = normalizeOptionalText(id);
    const template = Object.values(VISUAL_ASSET_TEMPLATES)
      .find((candidate) => candidate.id === normalized || candidate.collection === normalized);
    if (!template) throw notFound(`Visual asset template not found: ${id}`);
    return cloneJson(template);
  }

  upsertAsset(input = {}) {
    const record = normalizeAsset(input, { now: this.now, appDatabase: this.appDatabase });
    return this.dataManager.upsertRecord(VISUAL_ASSET_COLLECTION, record, { id: record.assetId });
  }

  upsertBinding(input = {}) {
    const record = normalizeBinding(input, { now: this.now, appDatabase: this.appDatabase });
    return this.dataManager.upsertRecord(VISUAL_ASSET_BINDING_COLLECTION, record, { id: record.bindingId });
  }

  upsertEventBinding(input = {}) {
    const record = normalizeEventBinding(input, { now: this.now, appDatabase: this.appDatabase });
    return this.dataManager.upsertRecord(VISUAL_EVENT_BINDING_COLLECTION, record, { id: record.eventBindingId });
  }

  listAssets(input = {}) {
    return this.listCollection(VISUAL_ASSET_COLLECTION, input, ['assetId', 'name', 'assetType', 'uri', 'prompt', 'source', 'status']);
  }

  listBindings(input = {}) {
    return this.listCollection(VISUAL_ASSET_BINDING_COLLECTION, input, ['bindingId', 'targetType', 'targetId', 'slot', 'assetId', 'status']);
  }

  listEventBindings(input = {}) {
    return this.listCollection(VISUAL_EVENT_BINDING_COLLECTION, input, ['eventBindingId', 'eventType', 'slot', 'assetId', 'status']);
  }

  listCollection(collection, {
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'priority', direction: 'desc' }, { field: 'assetUpdatedAt', direction: 'desc' }],
    limit = 100,
    offset = 0,
    ...lifecycle
  } = {}, searchFields = []) {
    const listed = this.dataManager.queryRecords(collection, {
      filter,
      sort,
      limit,
      offset,
      ...lifecycle
    });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const records = listed.records.filter((record) => {
      const data = record.data || {};
      if (requiredTags.length > 0) {
        const tagSet = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => tagSet.has(tag))) return false;
      }
      if (normalizedQuery) {
        const haystack = normalizeSearchText([
          record.id,
          ...searchFields.map((field) => data[field]),
          ...(Array.isArray(data.tags) ? data.tags : []),
          ...(Array.isArray(data.aliases) ? data.aliases : [])
        ].filter(Boolean).join(' '));
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });
    return {
      ...listed,
      records
    };
  }

  resolveAssets(input = {}) {
    const targets = normalizeResolveTargets(input);
    const bindings = this.dataManager.queryRecords(VISUAL_ASSET_BINDING_COLLECTION, {
      filter: activeFilter(input.bindingFilter),
      limit: normalizeLimit(input.bindingLimit, 500)
    }).records;
    const eventBindings = this.dataManager.queryRecords(VISUAL_EVENT_BINDING_COLLECTION, {
      filter: activeFilter(input.eventBindingFilter),
      limit: normalizeLimit(input.eventBindingLimit, 500)
    }).records;

    const assets = [];
    const missing = [];
    for (const target of targets) {
      const matchedBindings = target.eventType
        ? eventBindings.filter((record) => eventBindingMatches(record.data, target))
        : bindings.filter((record) => objectBindingMatches(record.data, target));
      if (matchedBindings.length === 0) {
        missing.push({
          target,
          reason: 'no_binding'
        });
        continue;
      }
      for (const binding of sortByPriority(matchedBindings)) {
        const assetId = normalizeOptionalText(binding.data?.assetId);
        const asset = assetId ? this.dataManager.getRecord(VISUAL_ASSET_COLLECTION, assetId, { missing: 'undefined' }) : undefined;
        if (!asset) {
          missing.push({
            target,
            binding: compactRecord(binding),
            assetId,
            reason: assetId ? 'asset_not_found' : 'binding_missing_asset_id'
          });
          continue;
        }
        const assetData = asset.data || {};
        if (!input.includePlaceholders && !normalizeOptionalText(assetData.uri)) {
          missing.push({
            target,
            binding: compactRecord(binding),
            asset: compactRecord(asset),
            reason: 'asset_placeholder_without_uri'
          });
          continue;
        }
        assets.push({
          target,
          binding: compactRecord(binding),
          asset: compactRecord(asset)
        });
      }
    }

    return {
      noLlm: true,
      noop: assets.length === 0,
      targetCount: targets.length,
      assets,
      missing,
      policy: {
        rendering: false,
        generation: false,
        gameplayEffect: false,
        note: 'Resolved visual assets are optional presentation references. Empty results are expected until resources are added.'
      }
    };
  }
}

function normalizeAsset(input = {}, { now, appDatabase } = {}) {
  const assetId = safeId(input.assetId || input.id || input.name || createId('asset'));
  return {
    assetId,
    name: normalizeOptionalText(input.name || input.title || assetId),
    assetType: normalizeAssetType(input.assetType || input.type),
    uri: normalizeOptionalText(input.uri || input.url || input.path || input.href),
    mimeType: normalizeOptionalText(input.mimeType || input.mime),
    prompt: normalizeOptionalText(input.prompt || input.generationPrompt || input.artPrompt),
    source: normalizeOptionalText(input.source || input.importSource || 'manual'),
    status: normalizeOptionalText(input.status || 'active'),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    dimensions: normalizeObject(input.dimensions),
    variants: normalizeArrayOrObject(input.variants),
    credits: normalizeArrayOrObject(input.credits || input.license),
    metadata: normalizeObject(input.metadata),
    ...visualLifecycleFields(input, { appDatabase, now }),
    assetUpdatedAt: now()
  };
}

function normalizeBinding(input = {}, { now, appDatabase } = {}) {
  const targetType = normalizeTargetType(input.targetType || input.type || input.kind);
  const targetId = normalizeRequiredText(input.targetId || input.npcId || input.mapId || input.itemId || input.actorId || input.id, 'targetId');
  const slot = normalizeSlot(input.slot || input.visualSlot || input.role || 'default');
  const assetId = normalizeRequiredText(input.assetId || input.visualAssetId, 'assetId');
  const bindingId = safeId(input.bindingId || input.id || `binding_${targetType}_${targetId}_${slot}_${assetId}`);
  return {
    bindingId,
    targetType,
    targetId,
    slot,
    assetId,
    priority: normalizeInteger(input.priority, 0),
    conditions: normalizeObject(input.conditions || input.when),
    visibility: normalizeOptionalText(input.visibility || 'public'),
    status: normalizeOptionalText(input.status || 'active'),
    tags: normalizeStringArray(input.tags),
    metadata: normalizeObject(input.metadata),
    ...visualLifecycleFields(input, { appDatabase, now }),
    bindingUpdatedAt: now()
  };
}

function normalizeEventBinding(input = {}, { now, appDatabase } = {}) {
  const eventType = normalizeEventType(input.eventType || input.type || input.event);
  const slot = normalizeSlot(input.slot || input.visualSlot || 'effect');
  const assetId = normalizeRequiredText(input.assetId || input.visualAssetId, 'assetId');
  const eventBindingId = safeId(input.eventBindingId || input.bindingId || input.id || `event_${eventType}_${slot}_${assetId}`);
  return {
    eventBindingId,
    eventType,
    slot,
    assetId,
    priority: normalizeInteger(input.priority, 0),
    conditions: normalizeObject(input.conditions || input.when),
    status: normalizeOptionalText(input.status || 'active'),
    visibility: normalizeOptionalText(input.visibility || 'public'),
    tags: normalizeStringArray(input.tags),
    metadata: normalizeObject(input.metadata),
    ...visualLifecycleFields(input, { appDatabase, now }),
    visualEventUpdatedAt: now()
  };
}

function normalizeResolveTargets(input = {}) {
  const rawTargets = Array.isArray(input.targets) ? input.targets : [];
  const rawEvents = Array.isArray(input.events) ? input.events : [];
  const direct = input.targetType || input.targetId || input.eventType
    ? [input]
    : [];
  return [...direct, ...rawTargets, ...rawEvents].map((target) => ({
    targetType: normalizeTargetType(target.targetType || target.type || target.kind),
    targetId: normalizeOptionalText(target.targetId || target.npcId || target.mapId || target.itemId || target.actorId || target.id),
    slot: normalizeSlot(target.slot || target.visualSlot || ''),
    eventType: normalizeOptionalText(target.eventType || target.event),
    result: normalizeOptionalText(target.result || target.outcome),
    sceneId: normalizeOptionalText(target.sceneId || input.sceneId),
    metadata: normalizeObject(target.metadata),
    raw: cloneJson(target)
  })).filter((target) => target.eventType || target.targetId || target.targetType);
}

function visualLifecycleFields(input = {}, { appDatabase, now } = {}) {
  return resolveResourceLifecycle(input, {
    appDatabase,
    defaultLevel: 'L1',
    now
  }) || {};
}

function objectBindingMatches(binding = {}, target = {}) {
  if (!isActive(binding)) return false;
  if (target.targetType && normalizeTargetType(binding.targetType) !== target.targetType) return false;
  if (target.targetId && normalizeOptionalText(binding.targetId) !== target.targetId) return false;
  if (target.slot && normalizeSlot(binding.slot) !== target.slot) return false;
  return conditionsMatch(binding.conditions, target);
}

function eventBindingMatches(binding = {}, target = {}) {
  if (!isActive(binding)) return false;
  if (target.eventType && normalizeEventType(binding.eventType) !== normalizeEventType(target.eventType)) return false;
  if (target.slot && normalizeSlot(binding.slot) !== target.slot) return false;
  return conditionsMatch(binding.conditions, target);
}

function conditionsMatch(conditions = {}, target = {}) {
  const normalized = normalizeObject(conditions);
  for (const [key, expected] of Object.entries(normalized)) {
    if (expected === undefined || expected === null || expected === '') continue;
    const actual = key in target ? target[key] : target.metadata?.[key];
    if (Array.isArray(expected)) {
      if (!expected.map(String).includes(String(actual))) return false;
    } else if (typeof expected === 'object') {
      if (!objectSubsetMatches(expected, actual)) return false;
    } else if (String(actual) !== String(expected)) {
      return false;
    }
  }
  return true;
}

function objectSubsetMatches(expected = {}, actual = {}) {
  const actualObject = normalizeObject(actual);
  return Object.entries(expected).every(([key, value]) => String(actualObject[key]) === String(value));
}

function activeFilter(filter = {}) {
  return {
    status: 'active',
    ...normalizeObject(filter)
  };
}

function isActive(record = {}) {
  const status = normalizeOptionalText(record.status || 'active').toLowerCase();
  return !['inactive', 'archived', 'deleted', 'hidden', 'disabled'].includes(status);
}

function sortByPriority(records = []) {
  return [...records].sort((a, b) => normalizeInteger(b.data?.priority, 0) - normalizeInteger(a.data?.priority, 0));
}

function compactRecord(record) {
  if (!record) return undefined;
  return {
    id: record.id,
    collection: record.collection,
    data: record.data
  };
}

function normalizeAssetType(value) {
  const normalized = normalizeOptionalText(value).toLowerCase();
  return normalized || 'image';
}

function normalizeTargetType(value) {
  return normalizeOptionalText(value).toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff.-]+/g, '_');
}

function normalizeEventType(value) {
  return normalizeOptionalText(value).toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff.-]+/g, '_');
}

function normalizeSlot(value) {
  return normalizeOptionalText(value).toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff.-]+/g, '_');
}

function normalizeLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), 1000);
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeStringArray(item));
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeArrayOrObject(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  return {};
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRequiredText(value, field) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSearchText(value) {
  return normalizeOptionalText(value).toLowerCase();
}

function safeId(value) {
  return normalizeOptionalText(value)
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160)
    || createId('visual');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'VisualAssetValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'VisualAssetNotFoundError';
  error.statusCode = 404;
  return error;
}
