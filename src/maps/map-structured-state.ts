// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';

export const MAP_STRUCTURED_STATE_TAG = 'AI_DND_MAP_STATE';
export const MAP_STRUCTURED_STATE_COLLECTION = 'map_structured_states';

export const MAP_STRUCTURED_STATE_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'sceneId', type: 'text', description: 'Scene id or label. Use "current" when no scene id exists yet.' },
  { name: 'mapId', type: 'text', description: 'Map id from registry, scene mount, or local state.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'position', type: 'json', description: 'Current party/player position in this map.' },
  { name: 'areas', type: 'json', description: 'Known areas, rooms, zones, or sublocations.' },
  { name: 'exits', type: 'json', description: 'Exits, doors, paths, passages, portals, stairs, or routes.' },
  { name: 'objects', type: 'json', description: 'Interactive objects, clues, containers, mechanisms, and visible props.' },
  { name: 'hazards', type: 'json', description: 'Traps, patrols, environmental hazards, and danger zones.' },
  { name: 'fogOfWar', type: 'json', description: 'Explored, hidden, unknown, or revealed map information.' },
  { name: 'routes', type: 'json', description: 'Known route graph fragments or navigation links.' },
  { name: 'values', type: 'json', description: 'Numeric map state only, e.g. lightLevel, noiseLevel, alertLevel.' },
  { name: 'source', type: 'text', description: 'assistant, manual, tool, import, etc.' },
  { name: 'stateUpdatedAt', type: 'text', description: 'Latest map structured state update timestamp.' }
];

const DEFAULT_SCENE_ID = 'current';

export class MapStructuredStateDatabase {
  constructor({
    appDatabase,
    collection = MAP_STRUCTURED_STATE_COLLECTION,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('MapStructuredStateDatabase requires appDatabase');
    this.appDatabase = appDatabase;
    this.collection = collection;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/map-structured-state-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollection(chatSessionId) {
    const database = this.appDatabase.ensureChatDataDatabase(chatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
    manager.ensureCollection(this.collection);
    manager.alterFields(this.collection, {
      add: MAP_STRUCTURED_STATE_FIELDS,
      reason: 'mapStructuredState:scene-map-runtime'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    return this.ensureCollection(chatSessionId);
  }

  listMapStates({
    chatSessionId,
    sceneId,
    mapId,
    query = '',
    filter = {},
    sort = [{ field: 'sceneId', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (sceneId) mergedFilter.sceneId = normalizeSceneId(sceneId);
    if (mapId) mergedFilter.mapId = normalizeOptionalText(mapId);

    const result = manager.queryRecords(this.collection, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (!normalizedQuery) return true;
      const haystack = normalizeSearchText([
        data.mapId,
        data.name,
        data.sceneId,
        data.position?.areaId,
        data.position?.label,
        Object.keys(data.values || {}).join(' '),
        (data.areas || []).map((item) => `${item.id || ''} ${item.name || ''} ${item.summary || ''}`).join(' '),
        (data.exits || []).map((item) => `${item.id || ''} ${item.name || ''} ${item.toMapId || ''}`).join(' '),
        (data.objects || []).map((item) => `${item.id || ''} ${item.name || ''} ${item.summary || ''}`).join(' '),
        (data.hazards || []).map((item) => `${item.id || ''} ${item.name || ''} ${item.summary || ''}`).join(' ')
      ].filter(Boolean).join(' '));
      return haystack.includes(normalizedQuery);
    });

    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  getMapState(input = {}) {
    return this.resolveMapState(input);
  }

  patchMapState(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
    const trace = this.traceRecorder.start('map-state-update', {
      sessionId: chatSessionId,
      input: { source, mode: 'patch', update: input },
      stateBefore: before
    });

    try {
      const record = this.applyMapStateRecord(input, { mode: 'patch', source });
      const after = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source, mode: 'patch' },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  rewriteMapState(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
    const trace = this.traceRecorder.start('map-state-save', {
      sessionId: chatSessionId,
      input: { source, mode: 'rewrite', state: input },
      stateBefore: before
    });

    try {
      const record = this.applyMapStateRecord(input, { mode: 'rewrite', source });
      const after = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source, mode: 'rewrite' },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  deleteMapState(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
    const trace = this.traceRecorder.start('map-state-delete', {
      sessionId: chatSessionId,
      input,
      stateBefore: before
    });

    try {
      const current = this.resolveMapState(input);
      const { manager } = this.openManager(chatSessionId);
      const deleted = manager.deleteRecord(this.collection, current.id);
      const after = this.stateSnapshot({ chatSessionId, sceneId: current.data.sceneId });
      return {
        ...deleted,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: deleted,
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  applyModelOutput(chatSessionId, content, {
    defaultMode = 'patch',
    source = 'assistant',
    sceneId = DEFAULT_SCENE_ID
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId: normalizedChatSessionId, sceneId });
    const trace = this.traceRecorder.start('map-state-apply-model-output', {
      sessionId: normalizedChatSessionId,
      input: { source, defaultMode, sceneId, content },
      stateBefore: before
    });

    try {
      const extracted = extractMapStructuredStateUpdates(content);
      const records = [];
      for (const update of extracted.updates) {
        records.push(...this.applyMapStructuredUpdate(normalizedChatSessionId, update, {
          defaultMode,
          source,
          sceneId
        }));
      }
      const output = {
        content: stripMapStructuredStateUpdates(content),
        updates: extracted.updates,
        records,
        state: this.stateSnapshot({ chatSessionId: normalizedChatSessionId, sceneId }),
        updated: records.length > 0
      };
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output: {
            content: output.content,
            updates: output.updates,
            recordIds: records.map((record) => record.id),
            updated: output.updated
          },
          stateAfter: output.state
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  buildPrompt(chatSessionId, {
    sceneId = DEFAULT_SCENE_ID,
    includeCurrentState = true,
    mode = 'patch',
    extraInstructions = ''
  } = {}) {
    const state = this.stateSnapshot({ chatSessionId, sceneId });
    const prompt = buildMapStructuredStatePrompt({
      state,
      includeCurrentState,
      mode,
      extraInstructions
    });
    const trace = this.tracePrompt(chatSessionId, {
      prompt,
      state,
      source: 'map-state.buildPrompt',
      options: {
        sceneId,
        includeCurrentState,
        mode,
        extraInstructions
      }
    });
    return {
      prompt,
      state,
      trace
    };
  }

  tracePrompt(chatSessionId, { prompt, state, source = 'prompt', options = {} } = {}) {
    const trace = this.traceRecorder.start('map-state-build-prompt', {
      sessionId: chatSessionId,
      input: { source, options },
      stateBefore: state
    });
    return this.traceRecorder.finish(trace, {
      output: {
        source,
        options,
        promptChars: String(prompt || '').length
      },
      stateAfter: state,
      prompt
    });
  }

  importDocument(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const sceneId = normalizeSceneId(input.sceneId);
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        mapStates: this.collection,
        map_states: this.collection,
        map_structured_states: this.collection,
        maps: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectMapStateRecords(groups, input.collection || this.collection);
    const mode = input.mode || 'rewrite';
    const records = selected.map((record) => this.applyMapStateRecord({
      ...record,
      chatSessionId,
      sceneId: record.sceneId || sceneId
    }, {
      mode,
      source: input.source || record.source || 'document-import'
    }));
    return {
      format: parsed.format,
      collection: this.collection,
      chatSessionId,
      sceneId,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    chatSessionId,
    sceneId,
    format = 'json',
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listMapStates({
      chatSessionId,
      sceneId,
      query,
      limit,
      offset
    });
    const payload = {
      chatSessionId: listed.chatSessionId,
      sceneId: sceneId ? normalizeSceneId(sceneId) : undefined,
      mapStates: listed.records.map((record) => ({
        id: record.id,
        ...record.data
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

  applyMapStructuredUpdate(chatSessionId, update = {}, { defaultMode = 'patch', source = 'assistant', sceneId } = {}) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) return [];
    const mode = normalizeMode(update.mode || defaultMode);
    const resolvedSceneId = normalizeSceneId(update.sceneId || sceneId);
    const entries = Array.isArray(update.maps)
      ? update.maps
      : (update.map ? [update.map] : (update.mapId || update.name ? [update] : []));

    return entries.map((entry) => this.applyMapStateRecord({
      ...entry,
      chatSessionId,
      sceneId: entry.sceneId || resolvedSceneId
    }, { mode, source: entry.source || source }));
  }

  applyMapStateRecord(input = {}, { mode = 'patch', source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const sceneId = normalizeSceneId(input.sceneId);
    const mapId = normalizeMapId(input.mapId || input.id || input.name);
    const recordId = input.recordId || mapStateId(sceneId, mapId);
    const existing = manager.getRecord(this.collection, recordId, { missing: 'undefined' });
    const normalized = normalizeMapStructuredState(input, {
      chatSessionId,
      sceneId,
      mapId,
      existing: existing?.data,
      mode,
      source,
      now: this.now
    });
    return manager.upsertRecord(this.collection, normalized, { id: recordId });
  }

  stateSnapshot({ chatSessionId, sceneId, includeAllScenes = false } = {}) {
    const listed = this.listMapStates({
      chatSessionId,
      sceneId: includeAllScenes ? undefined : sceneId,
      limit: 500
    });
    return {
      chatSessionId: listed.chatSessionId,
      sceneId: includeAllScenes ? undefined : normalizeSceneId(sceneId),
      maps: listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }))
    };
  }

  resolveMapState({ chatSessionId, id, recordId, mapId, sceneId = DEFAULT_SCENE_ID } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const explicitId = normalizeOptionalText(recordId || id);
    if (explicitId && explicitId.startsWith('mapstate_')) return manager.getRecord(this.collection, explicitId);

    const normalizedMapId = normalizeMapId(mapId || id);
    return manager.getRecord(this.collection, mapStateId(normalizeSceneId(sceneId), normalizedMapId));
  }

  openManager(chatSessionId) {
    this.ensureCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

export function buildMapStructuredStatePrompt({
  state = { maps: [] },
  mode = 'patch',
  tag = MAP_STRUCTURED_STATE_TAG,
  includeCurrentState = true,
  extraInstructions = ''
} = {}) {
  const template = {
    mode,
    sceneId: 'string',
    maps: [{
      mapId: 'string',
      name: 'string',
      position: {
        areaId: 'string',
        label: 'string',
        x: 0,
        y: 0
      },
      areas: [{
        id: 'string',
        name: 'string',
        discovered: true,
        visibility: 'visible',
        summary: 'string'
      }],
      exits: [{
        id: 'string',
        name: 'string',
        toMapId: 'string',
        status: 'open',
        direction: 'north',
        requirements: ['string']
      }],
      objects: [{
        id: 'string',
        name: 'string',
        status: 'visible',
        areaId: 'string',
        summary: 'string'
      }],
      hazards: [{
        id: 'string',
        name: 'string',
        active: true,
        severity: 0,
        areaId: 'string',
        summary: 'string'
      }],
      fogOfWar: {
        exploredAreaIds: ['string'],
        hiddenAreaIds: ['string'],
        notes: ['string']
      },
      routes: [{
        id: 'string',
        fromAreaId: 'string',
        toAreaId: 'string',
        status: 'open',
        distance: 0
      }],
      values: {
        lightLevel: 0,
        noiseLevel: 0,
        alertLevel: 0
      }
    }]
  };

  return [
    'Maintain structured map runtime state for an interactive text RPG.',
    'Write normal narrative first. Then append exactly one structured JSON block only when map exploration, position, exits, hazards, objects, fog of war, routes, or numeric map values change.',
    `Use this exact wrapper: <${tag}>JSON</${tag}>.`,
    'Do not put NPC persona, inventory, combat stats, or long lore here. Use this for current scene map state only.',
    'Use stable mapId and stable ids for areas, exits, objects, hazards, and routes. For arrays of objects, the same id updates the previous item; include "_delete": true to remove it.',
    'The values object must contain numbers only.',
    'Use mode "patch" for normal updates and "rewrite" only when replacing one map state.',
    extraInstructions ? `Additional instructions:\n${extraInstructions}` : '',
    includeCurrentState ? `Current map structured state:\n${JSON.stringify(state || { maps: [] }, null, 2)}` : '',
    `Output JSON shape reference:\n${JSON.stringify(template, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function extractMapStructuredStateUpdates(content, { tag = MAP_STRUCTURED_STATE_TAG } = {}) {
  const text = String(content || '');
  const updates = [];
  const tagPattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'gi');
  let match;

  while ((match = tagPattern.exec(text))) {
    updates.push(parseStructuredUpdate(match[1]));
  }

  const fencePattern = /```(?:json)?\s*ai-dnd-map-state\s*([\s\S]*?)```/gi;
  while ((match = fencePattern.exec(text))) {
    updates.push(parseStructuredUpdate(match[1]));
  }

  return { updates };
}

export function stripMapStructuredStateUpdates(content, { tag = MAP_STRUCTURED_STATE_TAG } = {}) {
  return String(content || '')
    .replace(new RegExp(`\\s*<${tag}>\\s*[\\s\\S]*?\\s*<\\/${tag}>\\s*`, 'gi'), '\n')
    .replace(/\s*```(?:json)?\s*ai-dnd-map-state\s*[\s\S]*?```\s*/gi, '\n')
    .trim();
}

export function normalizeMapStructuredState(input = {}, {
  chatSessionId,
  sceneId = DEFAULT_SCENE_ID,
  mapId,
  existing,
  mode = 'patch',
  source = 'manual',
  now = () => new Date().toISOString()
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('map structured state must be a plain object');
  }

  const rewrite = ['rewrite', 'replace', 'generate'].includes(normalizeMode(mode));
  const base = rewrite ? emptyMapState() : normalizeExistingState(existing);
  const resolvedSceneId = normalizeSceneId(input.sceneId || sceneId || base.sceneId);
  const resolvedMapId = normalizeMapId(input.mapId || mapId || base.mapId || input.name);

  return {
    chatSessionId: normalizeRequiredText(chatSessionId || input.chatSessionId || base.chatSessionId, 'chatSessionId'),
    sceneId: resolvedSceneId,
    mapId: resolvedMapId,
    name: normalizeOptionalText(input.name ?? base.name) || resolvedMapId,
    position: updatePlainObject(base.position, input.position || {}, { rewrite }),
    areas: updateObjectArray(base.areas, input.areas || [], { rewrite }),
    exits: updateObjectArray(base.exits, input.exits || [], { rewrite }),
    objects: updateObjectArray(base.objects, input.objects || input.visibleObjects || [], { rewrite }),
    hazards: updateObjectArray(base.hazards, input.hazards || [], { rewrite }),
    fogOfWar: updatePlainObject(base.fogOfWar, input.fogOfWar || {}, { rewrite }),
    routes: updateObjectArray(base.routes, input.routes || [], { rewrite }),
    values: updateNumericValues(base.values, input.values || {}, { rewrite }),
    source: normalizeOptionalText(source || input.source || base.source || 'manual'),
    stateUpdatedAt: now()
  };
}

function updatePlainObject(current = {}, update = {}, { rewrite = false } = {}) {
  const base = rewrite ? {} : normalizeObject(current);
  const incoming = normalizeObject(update);
  return {
    ...base,
    ...incoming
  };
}

function updateNumericValues(current = {}, update = {}, { rewrite = false } = {}) {
  const output = rewrite ? {} : { ...normalizeNumericValues(current, { allowDelete: false }) };
  const incoming = normalizeNumericValues(update, { allowDelete: true });
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) {
      delete output[key];
    } else {
      output[key] = value;
    }
  }
  return output;
}

function normalizeNumericValues(values = {}, { allowDelete = false } = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(values)) {
    const field = normalizeStateFieldName(key);
    if (raw === null && allowDelete) {
      output[field] = null;
      continue;
    }
    if (typeof raw === 'object') {
      throw validationError(`Map numeric value must be a number: ${field}`);
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      throw validationError(`Map numeric value must be finite: ${field}`);
    }
    output[field] = value;
  }
  return output;
}

function updateObjectArray(current = [], update = [], { rewrite = false } = {}) {
  return mergeObjectArray(rewrite ? [] : normalizeObjectArray(current), normalizeObjectArray(update), 'item');
}

function normalizeObjectArray(items = []) {
  const input = Array.isArray(items) ? items : [items];
  return input
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      ...item,
      id: normalizeItemId(item.id || item.name || item.label, 'item'),
      _delete: item._delete === true
    }));
}

function mergeObjectArray(current = [], update = [], prefix = 'item') {
  const byId = new Map();
  for (const item of current) {
    if (!item?.id) continue;
    const { _delete, ...clean } = item;
    byId.set(clean.id, clean);
  }
  for (const item of update) {
    if (!item?.id) continue;
    if (item._delete) {
      byId.delete(item.id);
      continue;
    }
    const previous = byId.get(item.id) || {};
    const { _delete, ...clean } = item;
    byId.set(clean.id, { ...previous, ...clean });
  }
  return [...byId.values()].map((item) => ({
    ...item,
    id: item.id || normalizeItemId(item.name, prefix)
  }));
}

function selectMapStateRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const states = groups.find((group) => [
    'mapStates',
    'map_states',
    'map_structured_states',
    'maps',
    MAP_STRUCTURED_STATE_COLLECTION
  ].includes(group.collection));
  const selected = preferred || states || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function emptyMapState() {
  return {
    chatSessionId: '',
    sceneId: DEFAULT_SCENE_ID,
    mapId: '',
    name: '',
    position: {},
    areas: [],
    exits: [],
    objects: [],
    hazards: [],
    fogOfWar: {},
    routes: [],
    values: {},
    source: ''
  };
}

function normalizeExistingState(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...emptyMapState(),
    ...input,
    position: normalizeObject(input.position),
    areas: normalizeObjectArray(input.areas || []),
    exits: normalizeObjectArray(input.exits || []),
    objects: normalizeObjectArray(input.objects || []),
    hazards: normalizeObjectArray(input.hazards || []),
    fogOfWar: normalizeObject(input.fogOfWar),
    routes: normalizeObjectArray(input.routes || []),
    values: normalizeNumericValues(input.values || {})
  };
}

function parseStructuredUpdate(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.message = `Invalid map structured state JSON: ${error.message}`;
    error.statusCode = 400;
    throw error;
  }
}

function mapStateId(sceneId, mapId) {
  return `mapstate_${safeSegment(sceneId)}_${safeSegment(mapId)}`.slice(0, 128);
}

function normalizeMapId(value) {
  const text = normalizeRequiredText(value, 'mapId');
  return safeSegment(text) || `map_${shortHash(text)}`;
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || DEFAULT_SCENE_ID;
}

function normalizeStateFieldName(value) {
  const field = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  if (!field) throw validationError('Map numeric value field name is required');
  return field;
}

function normalizeItemId(value, prefix) {
  const text = normalizeOptionalText(value);
  return safeSegment(text) || `${prefix}_${shortHash(text || prefix)}`;
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function normalizeMode(mode) {
  const normalized = String(mode || 'patch').toLowerCase();
  if (['rewrite', 'replace', 'generate', 'manual', 'patch', 'auto'].includes(normalized)) return normalized;
  return 'patch';
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

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'MapStructuredStateValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'map-state');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
