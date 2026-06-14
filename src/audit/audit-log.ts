// @ts-nocheck
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createId, nowIso } from '../utils/id.js';
import { getDatabaseSync } from '../utils/node-sqlite.js';

let DatabaseSync;

const DEFAULT_AUDIT_DB = 'data/audit.sqlite';
const DEFAULT_TRACE_DIR = 'data/audit-traces';
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|token|secret|password|credential)/i;

export class AuditLog {
  constructor({
    databasePath = DEFAULT_AUDIT_DB,
    cwd = process.cwd(),
    now = nowIso,
    trace = {}
  } = {}) {
    this.cwd = cwd;
    this.databasePath = databasePath === ':memory:' ? databasePath : resolve(cwd, databasePath);
    this.now = now;
    this.trace = normalizeTraceOptions(trace, cwd);

    if (this.databasePath !== ':memory:' && !existsSync(dirname(this.databasePath))) {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }
    if (this.trace.enabled && this.trace.directory) {
      mkdirSync(this.trace.directory, { recursive: true });
    }

    DatabaseSync ||= getDatabaseSync();
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT,
        operation TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        status TEXT NOT NULL,
        reversible INTEGER NOT NULL DEFAULT 0,
        replayable INTEGER NOT NULL DEFAULT 0,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        before_json TEXT,
        after_json TEXT,
        error_json TEXT,
        inverse_json TEXT,
        trace_refs_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        reverted_at TEXT,
        reverted_by TEXT,
        replayed_from_event_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_scope
      ON audit_events (scope_type, scope_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_audit_operation
      ON audit_events (operation, created_at);

      CREATE INDEX IF NOT EXISTS idx_audit_status
      ON audit_events (status, created_at);
    `);
  }

  recordEvent(eventInput = {}) {
    const event = normalizeAuditEvent(eventInput, this.now);
    const traceSummary = this.writeTrace(event);
    const traceRefs = {
      ...event.traceRefs,
      ...(traceSummary ? { auditTrace: traceSummary } : {})
    };

    this.db.prepare(`
      INSERT INTO audit_events (
        id, scope_type, scope_id, operation, actor_type, actor_id, status,
        reversible, replayable, input_json, output_json, before_json,
        after_json, error_json, inverse_json, trace_refs_json, metadata_json,
        created_at, reverted_at, reverted_by, replayed_from_event_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.scopeType,
      event.scopeId ?? null,
      event.operation,
      event.actor.type,
      event.actor.id ?? null,
      event.status,
      event.reversible ? 1 : 0,
      event.replayable ? 1 : 0,
      stringifyJson(event.input ?? {}),
      stringifyOptionalJson(event.output),
      stringifyOptionalJson(event.before),
      stringifyOptionalJson(event.after),
      stringifyOptionalJson(event.error),
      stringifyOptionalJson(event.inverse),
      stringifyJson(traceRefs),
      stringifyJson(event.metadata ?? {}),
      event.createdAt,
      event.revertedAt ?? null,
      event.revertedBy ?? null,
      event.replayedFromEventId ?? null
    );

    return this.getEvent(event.id);
  }

  listEvents({
    scopeType,
    scopeId,
    operation,
    status,
    reversible,
    replayable,
    includeReverted = true,
    limit = 50,
    offset = 0
  } = {}) {
    const where = [];
    const params = [];
    if (scopeType) {
      where.push('scope_type = ?');
      params.push(String(scopeType));
    }
    if (scopeId) {
      where.push('scope_id = ?');
      params.push(String(scopeId));
    }
    if (operation) {
      where.push('operation = ?');
      params.push(String(operation));
    }
    if (status) {
      where.push('status = ?');
      params.push(String(status));
    }
    if (reversible !== undefined) {
      where.push('reversible = ?');
      params.push(reversible ? 1 : 0);
    }
    if (replayable !== undefined) {
      where.push('replayable = ?');
      params.push(replayable ? 1 : 0);
    }
    if (!includeReverted) {
      where.push('reverted_at IS NULL');
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM audit_events
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, clampLimit(limit), normalizeOffset(offset));

    return rows.map(rowToAuditEvent);
  }

  getEvent(id) {
    const row = this.db.prepare('SELECT * FROM audit_events WHERE id = ?').get(String(id));
    if (!row) throw notFound(`Audit event not found: ${id}`);
    return rowToAuditEvent(row);
  }

  markReverted(id, { by = 'user', at = this.now() } = {}) {
    const event = this.getEvent(id);
    this.db.prepare(`
      UPDATE audit_events
      SET reverted_at = ?, reverted_by = ?
      WHERE id = ?
    `).run(at, by, event.id);
    return this.getEvent(event.id);
  }

  writeTrace(event) {
    if (!this.trace.enabled || !this.trace.directory) return undefined;

    const day = event.createdAt.slice(0, 10);
    const directory = resolve(
      this.trace.directory,
      day,
      `${safePathSegment(event.createdAt)}_${safePathSegment(event.id)}_${safePathSegment(event.operation)}`
    );
    mkdirSync(directory, { recursive: true });

    const files = {
      event: resolve(directory, 'event.json'),
      input: resolve(directory, 'input.json'),
      output: resolve(directory, 'output.json'),
      before: resolve(directory, 'before.json'),
      after: resolve(directory, 'after.json'),
      error: resolve(directory, 'error.json'),
      inverse: resolve(directory, 'inverse.json'),
      summary: resolve(directory, 'summary.json')
    };

    writeJson(files.input, event.input ?? {});
    if (event.output !== undefined) writeJson(files.output, event.output);
    if (event.before !== undefined) writeJson(files.before, event.before);
    if (event.after !== undefined) writeJson(files.after, event.after);
    if (event.error !== undefined) writeJson(files.error, event.error);
    if (event.inverse !== undefined) writeJson(files.inverse, event.inverse);

    const summary = {
      eventId: event.id,
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      operation: event.operation,
      status: event.status,
      reversible: event.reversible,
      replayable: event.replayable,
      createdAt: event.createdAt,
      directory,
      files: removeUndefined({
        event: files.event,
        input: files.input,
        output: event.output !== undefined ? files.output : undefined,
        before: event.before !== undefined ? files.before : undefined,
        after: event.after !== undefined ? files.after : undefined,
        error: event.error !== undefined ? files.error : undefined,
        inverse: event.inverse !== undefined ? files.inverse : undefined,
        summary: files.summary
      })
    };
    writeJson(files.summary, summary);
    writeJson(files.event, {
      ...event,
      traceRefs: {
        ...event.traceRefs,
        auditTrace: summary
      }
    });
    return summary;
  }
}

export function serializeAuditError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    stack: error?.stack
  };
}

export function sanitizeAuditValue(value) {
  return sanitizeForJson(value);
}

function normalizeAuditEvent(input, now) {
  const createdAt = input.createdAt || now();
  return {
    id: input.id || createId('aud'),
    scopeType: String(input.scopeType || 'global'),
    scopeId: input.scopeId === undefined || input.scopeId === null ? undefined : String(input.scopeId),
    operation: String(input.operation || 'unknown'),
    actor: normalizeActor(input.actor),
    status: normalizeStatus(input.status || (input.error ? 'error' : 'success')),
    reversible: Boolean(input.reversible),
    replayable: Boolean(input.replayable),
    input: sanitizeAuditValue(input.input ?? {}),
    output: input.output === undefined ? undefined : sanitizeAuditValue(input.output),
    before: input.before === undefined ? undefined : sanitizeAuditValue(input.before),
    after: input.after === undefined ? undefined : sanitizeAuditValue(input.after),
    error: input.error === undefined ? undefined : sanitizeAuditValue(input.error),
    inverse: input.inverse === undefined ? undefined : sanitizeAuditValue(input.inverse),
    traceRefs: sanitizeAuditValue(input.traceRefs || {}),
    metadata: sanitizeAuditValue(input.metadata || {}),
    createdAt,
    revertedAt: input.revertedAt,
    revertedBy: input.revertedBy,
    replayedFromEventId: input.replayedFromEventId
  };
}

function normalizeActor(actor = {}) {
  if (typeof actor === 'string') {
    return {
      type: actor,
      id: undefined
    };
  }
  return {
    type: String(actor.type || 'system'),
    id: actor.id === undefined || actor.id === null ? undefined : String(actor.id)
  };
}

function normalizeStatus(status) {
  const normalized = String(status || 'success');
  return ['success', 'error', 'skipped', 'pending'].includes(normalized) ? normalized : 'success';
}

function rowToAuditEvent(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    operation: row.operation,
    actor: {
      type: row.actor_type,
      id: row.actor_id
    },
    status: row.status,
    reversible: Boolean(row.reversible),
    replayable: Boolean(row.replayable),
    input: parseJson(row.input_json, {}),
    output: parseOptionalJson(row.output_json),
    before: parseOptionalJson(row.before_json),
    after: parseOptionalJson(row.after_json),
    error: parseOptionalJson(row.error_json),
    inverse: parseOptionalJson(row.inverse_json),
    traceRefs: parseJson(row.trace_refs_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
    revertedBy: row.reverted_by,
    replayedFromEventId: row.replayed_from_event_id
  };
}

function normalizeTraceOptions(trace, cwd) {
  if (trace === false) {
    return {
      enabled: false,
      directory: null
    };
  }
  const input = trace && typeof trace === 'object' ? trace : {};
  const directory = input.directory === null
    ? null
    : resolve(cwd, input.directory || DEFAULT_TRACE_DIR);
  return {
    enabled: input.enabled !== false,
    directory
  };
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(sanitizeAuditValue(value), null, 2)}\n`);
}

function stringifyJson(value) {
  return JSON.stringify(sanitizeAuditValue(value));
}

function stringifyOptionalJson(value) {
  return value === undefined ? null : stringifyJson(value);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function parseOptionalJson(value) {
  if (value === null || value === undefined) return undefined;
  return parseJson(value, undefined);
}

function sanitizeForJson(value, seen = new WeakSet(), key = '') {
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (value === undefined) return '[undefined]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function${value.name ? `:${value.name}` : ''}]`;
  if (value instanceof Error) return serializeAuditError(value);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item, seen));
  }
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([entryKey, entryValue]) => [
      String(entryKey),
      sanitizeForJson(entryValue, seen, String(entryKey))
    ]));
  }
  if (value instanceof Set) {
    return [...value.values()].map((item) => sanitizeForJson(item, seen));
  }

  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    sanitizeForJson(entryValue, seen, entryKey)
  ]));
}

function safePathSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 160);
}

function clampLimit(limit) {
  const value = Number(limit ?? 50);
  if (!Number.isInteger(value) || value < 1) return 50;
  return Math.min(value, 500);
}

function normalizeOffset(offset) {
  const value = Number(offset || 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'AuditNotFoundError';
  error.statusCode = 404;
  return error;
}
