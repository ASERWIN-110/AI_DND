// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createId, nowIso } from '../utils/id.js';

export const STRUCTURED_INTERFACE_TAG = 'AI_DND_STRUCTURED_STATE';

export const DEFAULT_STRUCTURED_INTERFACE_STATE = {
  sceneMap: {
    title: '',
    summary: '',
    currentAreaId: '',
    areas: [],
    exits: [],
    hazards: [],
    visibleObjects: []
  },
  statusBar: {
    characters: []
  },
  skillBar: {
    skills: []
  },
  inventory: {
    currency: {},
    items: []
  },
  npcSummary: {
    npcs: []
  },
  notes: []
};

export class StructuredInterfaceTraceRecorder {
  constructor({
    enabled = true,
    directory = 'data/structured-interface-traces',
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    this.enabled = enabled;
    this.directory = directory === null ? null : resolve(cwd, directory);
    this.now = now;
    if (this.enabled && this.directory) mkdirSync(this.directory, { recursive: true });
  }

  start(operation, { sessionId, input, stateBefore } = {}) {
    if (!this.enabled || !this.directory) return undefined;

    const traceId = createId('structuredtrace');
    const startedAt = this.now();
    const traceDirectory = resolve(
      this.directory,
      startedAt.slice(0, 10),
      `${safePathSegment(startedAt)}_${safePathSegment(traceId)}_${safePathSegment(operation)}_${safePathSegment(sessionId)}`
    );
    mkdirSync(traceDirectory, { recursive: true });

    const trace = {
      traceId,
      operation,
      sessionId,
      startedAt,
      directory: traceDirectory,
      files: {
        input: resolve(traceDirectory, 'input.json'),
        stateBefore: resolve(traceDirectory, 'state-before.json'),
        stateAfter: resolve(traceDirectory, 'state-after.json'),
        output: resolve(traceDirectory, 'output.json'),
        error: resolve(traceDirectory, 'error.json'),
        prompt: resolve(traceDirectory, 'prompt.txt'),
        summary: resolve(traceDirectory, 'summary.json')
      }
    };

    writeJson(trace.files.input, {
      traceId,
      operation,
      sessionId,
      stage: 'input',
      input
    });
    writeJson(trace.files.stateBefore, {
      traceId,
      operation,
      sessionId,
      stage: 'state_before',
      state: stateBefore
    });
    writeJson(trace.files.summary, {
      traceId,
      operation,
      sessionId,
      status: 'started',
      startedAt,
      directory: traceDirectory,
      files: {
        input: trace.files.input,
        stateBefore: trace.files.stateBefore,
        summary: trace.files.summary
      }
    });

    return trace;
  }

  finish(trace, { output, stateAfter, prompt, finishedAt = this.now() } = {}) {
    if (!trace) return undefined;

    if (prompt !== undefined) {
      writeFileSync(trace.files.prompt, String(prompt));
    }
    writeJson(trace.files.stateAfter, {
      traceId: trace.traceId,
      operation: trace.operation,
      sessionId: trace.sessionId,
      stage: 'state_after',
      state: stateAfter
    });
    writeJson(trace.files.output, {
      traceId: trace.traceId,
      operation: trace.operation,
      sessionId: trace.sessionId,
      stage: 'output',
      output
    });

    const files = {
      input: trace.files.input,
      stateBefore: trace.files.stateBefore,
      stateAfter: trace.files.stateAfter,
      output: trace.files.output,
      summary: trace.files.summary
    };
    if (prompt !== undefined) files.prompt = trace.files.prompt;

    const summary = {
      traceId: trace.traceId,
      operation: trace.operation,
      sessionId: trace.sessionId,
      status: 'success',
      startedAt: trace.startedAt,
      finishedAt,
      durationMs: durationMs(trace.startedAt, finishedAt),
      directory: trace.directory,
      files
    };
    writeJson(trace.files.summary, summary);
    return summary;
  }

  fail(trace, { error, finishedAt = this.now() } = {}) {
    if (!trace) return undefined;

    writeJson(trace.files.error, {
      traceId: trace.traceId,
      operation: trace.operation,
      sessionId: trace.sessionId,
      stage: 'error',
      error: serializeError(error)
    });

    const summary = {
      traceId: trace.traceId,
      operation: trace.operation,
      sessionId: trace.sessionId,
      status: 'error',
      startedAt: trace.startedAt,
      finishedAt,
      durationMs: durationMs(trace.startedAt, finishedAt),
      directory: trace.directory,
      files: {
        input: trace.files.input,
        stateBefore: trace.files.stateBefore,
        error: trace.files.error,
        summary: trace.files.summary
      }
    };
    writeJson(trace.files.summary, summary);
    return summary;
  }
}

export class StructuredInterfaceStateStore {
  constructor({
    directory = 'data/structured-interface',
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    this.directory = directory === null ? null : resolve(cwd, directory);
    this.now = now;
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      cwd,
      now
    });
    if (this.directory) mkdirSync(this.directory, { recursive: true });
  }

  getFilePath(sessionId) {
    if (!this.directory) return undefined;
    return resolve(this.directory, `${safePathSegment(sessionId)}.json`);
  }

  load(sessionId) {
    const filePath = this.getFilePath(sessionId);
    if (!filePath || !existsSync(filePath)) {
      return {
        sessionId,
        filePath,
        updatedAt: undefined,
        state: createStructuredInterfaceState(),
        history: []
      };
    }

    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      sessionId,
      filePath,
      updatedAt: parsed.updatedAt,
      state: normalizeStructuredInterfaceState(parsed.state),
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  }

  save(sessionId, state, { source = 'manual', mode = 'rewrite', update, trace: shouldTrace = true } = {}) {
    const filePath = this.getFilePath(sessionId);
    const previous = this.load(sessionId);
    const trace = shouldTrace
      ? this.traceRecorder.start('save', {
        sessionId,
        input: { source, mode, update, state },
        stateBefore: previous.state
      })
      : undefined;

    try {
    const timestamp = this.now();
    const record = {
      sessionId,
      updatedAt: timestamp,
      state: normalizeStructuredInterfaceState(state),
      history: [
        ...previous.history,
        {
          at: timestamp,
          source,
          mode,
          update
        }
      ].slice(-100)
    };

    if (filePath) {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
    }

    return {
      ...record,
      filePath,
      trace: this.traceRecorder.finish(trace, {
        output: { filePath, source, mode, updatedAt: record.updatedAt },
        stateAfter: record.state
      })
    };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  update(sessionId, update, { mode = 'manual', source = 'manual' } = {}) {
    const current = this.load(sessionId);
    const trace = this.traceRecorder.start('update', {
      sessionId,
      input: { source, mode, update },
      stateBefore: current.state
    });

    try {
      const state = applyStructuredInterfaceUpdate(current.state, update, { mode });
      const saved = this.save(sessionId, state, { source, mode, update, trace: false });
      const traceSummary = this.traceRecorder.finish(trace, {
        output: { filePath: saved.filePath, source, mode, updatedAt: saved.updatedAt },
        stateAfter: saved.state
      });
      return {
        ...saved,
        trace: traceSummary
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  applyModelOutput(sessionId, content, { defaultMode = 'patch', source = 'assistant' } = {}) {
    const current = this.load(sessionId);
    const trace = this.traceRecorder.start('apply-model-output', {
      sessionId,
      input: { source, defaultMode, content },
      stateBefore: current.state
    });

    try {
      const extracted = extractStructuredInterfaceUpdates(content);
      let state = current.state;
      let saved = current;

      for (const update of extracted.updates) {
        const mode = update.mode || defaultMode;
        state = applyStructuredInterfaceUpdate(state, update, { mode });
        saved = this.save(sessionId, state, { source, mode, update, trace: false });
      }

      const output = {
        content: stripStructuredInterfaceUpdates(content),
        updates: extracted.updates,
        state,
        filePath: saved.filePath,
        updated: extracted.updates.length > 0
      };
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output: {
            content: output.content,
            updates: output.updates,
            filePath: output.filePath,
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

  tracePrompt(sessionId, { prompt, state, source = 'prompt', options = {} } = {}) {
    const current = this.load(sessionId);
    const stateBefore = state?.state || state || current.state;
    const trace = this.traceRecorder.start('build-prompt', {
      sessionId,
      input: { source, options },
      stateBefore
    });

    return this.traceRecorder.finish(trace, {
      output: {
        source,
        options,
        promptChars: String(prompt || '').length
      },
      stateAfter: stateBefore,
      prompt
    });
  }

  failPromptTrace(sessionId, error, { source = 'prompt', options = {} } = {}) {
    const current = this.load(sessionId);
    const trace = this.traceRecorder.start('build-prompt', {
      sessionId,
      input: { source, options },
      stateBefore: current.state
    });
    return this.traceRecorder.fail(trace, { error });
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(sanitizeForJson(value), null, 2)}\n`);
}

function sanitizeForJson(value, seen = new WeakSet()) {
  if (value === undefined) return '[undefined]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function${value.name ? `:${value.name}` : ''}]`;
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item, seen));
  }
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, entryValue]) => [
      String(key),
      sanitizeForJson(entryValue, seen)
    ]));
  }
  if (value instanceof Set) {
    return [...value.values()].map((item) => sanitizeForJson(item, seen));
  }

  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    sanitizeForJson(entryValue, seen)
  ]));
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    stack: error?.stack
  };
}

function durationMs(startedAt, finishedAt) {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? duration : undefined;
}

export function createStructuredInterfaceState(initial = {}) {
  return normalizeStructuredInterfaceState({
    ...DEFAULT_STRUCTURED_INTERFACE_STATE,
    ...initial
  });
}

export function normalizeStructuredInterfaceState(state = {}) {
  return {
    sceneMap: normalizeObject(state.sceneMap, DEFAULT_STRUCTURED_INTERFACE_STATE.sceneMap),
    statusBar: normalizeObject(state.statusBar, DEFAULT_STRUCTURED_INTERFACE_STATE.statusBar),
    skillBar: normalizeObject(state.skillBar, DEFAULT_STRUCTURED_INTERFACE_STATE.skillBar),
    inventory: normalizeObject(state.inventory, DEFAULT_STRUCTURED_INTERFACE_STATE.inventory),
    npcSummary: normalizeObject(state.npcSummary, DEFAULT_STRUCTURED_INTERFACE_STATE.npcSummary),
    notes: Array.isArray(state.notes) ? state.notes : []
  };
}

export function buildStructuredInterfacePrompt({
  state = createStructuredInterfaceState(),
  mode = 'patch',
  tag = STRUCTURED_INTERFACE_TAG,
  includeCurrentState = true,
  extraInstructions = ''
} = {}) {
  const normalized = normalizeStructuredInterfaceState(state);
  const template = {
    mode,
    sceneMap: {
      title: 'string',
      summary: 'string',
      currentAreaId: 'string',
      areas: [{ id: 'string', name: 'string', description: 'string', discovered: true }],
      exits: [{ id: 'string', from: 'string', to: 'string', label: 'string', locked: false }],
      hazards: [{ id: 'string', name: 'string', severity: 0, description: 'string' }],
      visibleObjects: [{ id: 'string', name: 'string', description: 'string' }]
    },
    statusBar: {
      characters: [{
        id: 'string',
        name: 'string',
        hp: 0,
        maxHp: 0,
        mp: 0,
        stats: {},
        conditions: [],
        specialSkills: []
      }]
    },
    skillBar: {
      skills: [{ id: 'string', name: 'string', ready: true, cooldown: 0, charges: 0, description: 'string' }]
    },
    inventory: {
      currency: {},
      items: [{ id: 'string', name: 'string', quantity: 1, equipped: false, description: 'string' }]
    },
    npcSummary: {
      npcs: [{ id: 'string', name: 'string', status: 'string', attitude: 'string', location: 'string', summary: 'string' }]
    },
    notes: []
  };

  return [
    'You are maintaining a structured game interface state for an interactive text RPG.',
    'Write normal narrative first. Then append exactly one structured JSON block when the visible interface state should change.',
    `Use this exact wrapper: <${tag}>JSON</${tag}>.`,
    'Use mode "patch" for normal automatic updates, "rewrite" when regenerating the full state, and "manual" only for host/user edits.',
    'Only include fields that changed when using patch mode. Use stable ids for areas, characters, skills, items, and NPCs.',
    'For arrays of objects, an item with the same id updates the previous item; include "_delete": true to remove it.',
    'Never put dice results, tool results, or facts into the state unless they were supplied by the host context.',
    extraInstructions ? `Additional instructions:\n${extraInstructions}` : '',
    includeCurrentState ? `Current structured state:\n${JSON.stringify(normalized, null, 2)}` : '',
    `Output JSON shape reference:\n${JSON.stringify(template, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function extractStructuredInterfaceUpdates(content, { tag = STRUCTURED_INTERFACE_TAG } = {}) {
  const text = String(content || '');
  const updates = [];
  const tagPattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'gi');
  let match;

  while ((match = tagPattern.exec(text))) {
    updates.push(parseStructuredUpdate(match[1]));
  }

  const fencePattern = /```(?:json)?\s*ai-dnd-state\s*([\s\S]*?)```/gi;
  while ((match = fencePattern.exec(text))) {
    updates.push(parseStructuredUpdate(match[1]));
  }

  return { updates };
}

export function stripStructuredInterfaceUpdates(content, { tag = STRUCTURED_INTERFACE_TAG } = {}) {
  return String(content || '')
    .replace(new RegExp(`\\s*<${tag}>\\s*[\\s\\S]*?\\s*<\\/${tag}>\\s*`, 'gi'), '\n')
    .replace(/\s*```(?:json)?\s*ai-dnd-state\s*[\s\S]*?```\s*/gi, '\n')
    .trim();
}

export function applyStructuredInterfaceUpdate(currentState, update = {}, { mode = 'patch' } = {}) {
  const updateMode = normalizeMode(update.mode || mode);
  const cleanUpdate = stripUpdateControlFields(update);

  if (updateMode === 'rewrite' || updateMode === 'generate' || updateMode === 'replace') {
    return normalizeStructuredInterfaceState({
      ...DEFAULT_STRUCTURED_INTERFACE_STATE,
      ...cleanUpdate
    });
  }

  return normalizeStructuredInterfaceState(deepMergeStructured(
    normalizeStructuredInterfaceState(currentState),
    cleanUpdate
  ));
}

function parseStructuredUpdate(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.message = `Invalid structured interface JSON: ${error.message}`;
    error.statusCode = 400;
    throw error;
  }
}

function stripUpdateControlFields(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return {};
  const { mode, source, reason, ...rest } = update;
  return rest;
}

function deepMergeStructured(current, update) {
  if (update === undefined) return current;
  if (update === null) return null;
  if (Array.isArray(current) || Array.isArray(update)) {
    return mergeArrays(Array.isArray(current) ? current : [], Array.isArray(update) ? update : []);
  }
  if (isPlainObject(current) && isPlainObject(update)) {
    const merged = { ...current };
    for (const [key, value] of Object.entries(update)) {
      merged[key] = deepMergeStructured(current[key], value);
    }
    return merged;
  }
  return update;
}

function mergeArrays(current, update) {
  const byKey = new Map();
  const passthrough = [];

  for (const item of current) {
    const key = itemKey(item);
    if (key) byKey.set(key, item);
    else passthrough.push(item);
  }

  for (const item of update) {
    const key = itemKey(item);
    if (!key) {
      passthrough.push(item);
      continue;
    }
    if (item && item._delete) {
      byKey.delete(key);
      continue;
    }
    byKey.set(key, deepMergeStructured(byKey.get(key) || {}, stripDeleteFlag(item)));
  }

  return [...byKey.values(), ...passthrough];
}

function itemKey(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  return item.id ? `id:${item.id}` : (item.name ? `name:${item.name}` : undefined);
}

function stripDeleteFlag(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const { _delete, ...rest } = item;
  return rest;
}

function normalizeObject(value, fallback) {
  return isPlainObject(value) ? { ...fallback, ...value } : { ...fallback };
}

function normalizeMode(mode) {
  const normalized = String(mode || 'patch').toLowerCase();
  if (['rewrite', 'replace', 'generate', 'manual', 'patch', 'auto'].includes(normalized)) return normalized;
  return 'patch';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safePathSegment(value) {
  return String(value || 'session').replace(/[^A-Za-z0-9_.-]/g, '_');
}
