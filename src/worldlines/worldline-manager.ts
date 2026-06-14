// @ts-nocheck
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deleteScopedDataRecords, lifecycleFromData } from '../lifecycle/resource-lifecycle.js';
import { createId, nowIso } from '../utils/id.js';
import { getDatabaseSync } from '../utils/node-sqlite.js';

let DatabaseSync;

const DEFAULT_WORLDLINE_DB = 'data/worldlines.sqlite';
const DEFAULT_TRACE_DIR = 'data/worldline-traces';

export class WorldlineManager {
  constructor({
    databasePath = DEFAULT_WORLDLINE_DB,
    cwd = process.cwd(),
    now = nowIso,
    sessionStore,
    structuredInterfaceStore,
    appDatabase,
    dataManager,
    runtimeRagService,
    permanentRagService,
    auditLog,
    trace = {}
  } = {}) {
    this.cwd = cwd;
    this.databasePath = databasePath === ':memory:' ? databasePath : resolve(cwd, databasePath);
    this.now = now;
    this.sessionStore = sessionStore;
    this.structuredInterfaceStore = structuredInterfaceStore;
    this.appDatabase = appDatabase;
    this.dataManager = dataManager;
    this.runtimeRagService = runtimeRagService;
    this.permanentRagService = permanentRagService;
    this.auditLog = auditLog;
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
      CREATE TABLE IF NOT EXISTS worldline_branches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        parent_branch_id TEXT REFERENCES worldline_branches(id) ON DELETE SET NULL,
        source_savepoint_id TEXT,
        head_savepoint_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worldline_savepoints (
        id TEXT PRIMARY KEY,
        branch_id TEXT REFERENCES worldline_branches(id) ON DELETE SET NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL,
        snapshot_summary_json TEXT NOT NULL DEFAULT '{}',
        trace_refs_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worldline_active_state (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        active_branch_id TEXT REFERENCES worldline_branches(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id)
      );

      CREATE INDEX IF NOT EXISTS idx_worldline_branches_scope
      ON worldline_branches (scope_type, scope_id, updated_at);

      CREATE INDEX IF NOT EXISTS idx_worldline_savepoints_scope
      ON worldline_savepoints (scope_type, scope_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_worldline_savepoints_branch
      ON worldline_savepoints (branch_id, created_at);
    `);
  }

  async createSavepoint(input = {}) {
    const target = await this.resolveTarget(input);
    const timestamp = this.now();
    const id = input.id || createId('save');
    const branchId = input.branchId || this.getActiveBranch(target.scopeType, target.scopeId)?.id;
    const snapshot = await this.captureSnapshot({
      ...input,
      ...target
    });
    const summary = summarizeSnapshot(snapshot);
    const traceSummary = this.writeTrace('savepoint.create', {
      id,
      input,
      output: {
        id,
        branchId,
        target,
        summary
      },
      snapshot,
      createdAt: timestamp
    });

    this.db.prepare(`
      INSERT INTO worldline_savepoints (
        id, branch_id, scope_type, scope_id, label, description,
        snapshot_json, snapshot_summary_json, trace_refs_json, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      branchId ?? null,
      target.scopeType,
      target.scopeId,
      input.label || input.name || `Savepoint ${timestamp}`,
      input.description || '',
      JSON.stringify(snapshot),
      JSON.stringify(summary),
      JSON.stringify(traceSummary ? { worldlineTrace: traceSummary } : {}),
      JSON.stringify(input.metadata || {}),
      timestamp
    );

    if (branchId) {
      this.updateBranchHead(branchId, id);
    }

    const savepoint = this.getSavepoint(id, { includeSnapshot: input.includeSnapshot !== false });
    this.auditLog?.recordEvent({
      scopeType: target.scopeType,
      scopeId: target.scopeId,
      operation: 'worldline.savepoint.create',
      actor: normalizeActor(input.actor || 'user'),
      status: 'success',
      reversible: false,
      replayable: false,
      input,
      output: savepoint,
      traceRefs: traceSummary ? { worldlineTrace: traceSummary } : undefined,
      metadata: {
        savepointId: id,
        branchId,
        summary
      }
    });
    return savepoint;
  }

  listSavepoints({
    scopeType,
    scopeId,
    branchId,
    limit = 50,
    offset = 0,
    includeSnapshot = false
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
    if (branchId) {
      where.push('branch_id = ?');
      params.push(String(branchId));
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM worldline_savepoints
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, clampLimit(limit), normalizeOffset(offset));
    return rows.map((row) => rowToSavepoint(row, { includeSnapshot }));
  }

  getSavepoint(id, { includeSnapshot = true } = {}) {
    const row = this.db.prepare('SELECT * FROM worldline_savepoints WHERE id = ?').get(String(id));
    if (!row) throw notFound(`Worldline savepoint not found: ${id}`);
    return rowToSavepoint(row, { includeSnapshot });
  }

  async restoreSavepoint(id, {
    actor = 'user',
    reason,
    setActiveBranch = true,
    branchId
  } = {}) {
    const savepoint = this.getSavepoint(id, { includeSnapshot: true });
    const result = await this.restoreSnapshot(savepoint.snapshot);
    const activeBranchId = branchId || savepoint.branchId;
    if (setActiveBranch && activeBranchId) {
      this.setActiveBranch(savepoint.scopeType, savepoint.scopeId, activeBranchId);
    }
    if (activeBranchId) {
      this.updateBranchHead(activeBranchId, savepoint.id);
    }

    const traceSummary = this.writeTrace('savepoint.restore', {
      id: createId('worldtrace'),
      input: { savepointId: id, actor, reason, setActiveBranch, branchId },
      output: result,
      snapshot: savepoint.snapshot,
      createdAt: this.now()
    });

    this.auditLog?.recordEvent({
      scopeType: savepoint.scopeType,
      scopeId: savepoint.scopeId,
      operation: 'worldline.savepoint.restore',
      actor: normalizeActor(actor),
      status: 'success',
      reversible: false,
      replayable: false,
      input: { savepointId: id, reason, setActiveBranch, branchId },
      output: result,
      traceRefs: traceSummary ? { worldlineTrace: traceSummary } : undefined,
      metadata: {
        savepointId: id,
        branchId: activeBranchId
      }
    });

    return {
      restored: true,
      savepoint,
      activeBranch: activeBranchId ? this.getBranch(activeBranchId) : undefined,
      result,
      trace: traceSummary
    };
  }

  createBranch(input = {}) {
    const sourceSavepoint = this.getSavepoint(input.fromSavepointId || input.sourceSavepointId, {
      includeSnapshot: false
    });
    const timestamp = this.now();
    const id = input.id || createId('branch');
    const name = input.name || input.label || `Branch ${timestamp}`;
    const parentBranchId = input.parentBranchId || sourceSavepoint.branchId;

    this.db.prepare(`
      INSERT INTO worldline_branches (
        id, name, scope_type, scope_id, parent_branch_id, source_savepoint_id,
        head_savepoint_id, status, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      sourceSavepoint.scopeType,
      sourceSavepoint.scopeId,
      parentBranchId ?? null,
      sourceSavepoint.id,
      sourceSavepoint.id,
      input.status || 'active',
      JSON.stringify(input.metadata || {}),
      timestamp,
      timestamp
    );

    const branch = this.getBranch(id);
    this.auditLog?.recordEvent({
      scopeType: branch.scopeType,
      scopeId: branch.scopeId,
      operation: 'worldline.branch.create',
      actor: normalizeActor(input.actor || 'user'),
      status: 'success',
      reversible: false,
      replayable: false,
      input,
      output: branch,
      metadata: {
        branchId: id,
        sourceSavepointId: sourceSavepoint.id,
        parentBranchId
      }
    });
    return branch;
  }

  async createBranchAndMaybeSwitch(input = {}) {
    const branch = this.createBranch(input);
    if (!input.switchTo && !input.restore) return { branch };
    const restored = await this.switchBranch(branch.id, {
      actor: input.actor || 'user',
      reason: input.reason || 'create_branch.switch'
    });
    return { branch: restored.branch, restored };
  }

  listBranches({
    scopeType,
    scopeId,
    status,
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
    if (status) {
      where.push('status = ?');
      params.push(String(status));
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM worldline_branches
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, clampLimit(limit), normalizeOffset(offset));
    return rows.map((row) => this.attachActiveState(rowToBranch(row)));
  }

  getBranch(id) {
    const row = this.db.prepare('SELECT * FROM worldline_branches WHERE id = ?').get(String(id));
    if (!row) throw notFound(`Worldline branch not found: ${id}`);
    return this.attachActiveState(rowToBranch(row));
  }

  async switchBranch(id, { savepointId, actor = 'user', reason } = {}) {
    const branch = this.getBranch(id);
    const targetSavepointId = savepointId || branch.headSavepointId || branch.sourceSavepointId;
    if (!targetSavepointId) {
      throw validationError(`Branch has no savepoint to switch to: ${id}`);
    }
    const restored = await this.restoreSavepoint(targetSavepointId, {
      actor,
      reason,
      setActiveBranch: true,
      branchId: branch.id
    });
    this.setActiveBranch(branch.scopeType, branch.scopeId, branch.id);
    const active = this.getBranch(branch.id);
    this.auditLog?.recordEvent({
      scopeType: branch.scopeType,
      scopeId: branch.scopeId,
      operation: 'worldline.branch.switch',
      actor: normalizeActor(actor),
      status: 'success',
      reversible: false,
      replayable: false,
      input: { branchId: id, savepointId, reason },
      output: { branch: active, restored },
      metadata: {
        branchId: id,
        savepointId: targetSavepointId
      }
    });
    return {
      switched: true,
      branch: active,
      restored
    };
  }

  getActiveBranch(scopeType, scopeId) {
    if (!scopeType || !scopeId) return undefined;
    const row = this.db.prepare(`
      SELECT active_branch_id
      FROM worldline_active_state
      WHERE scope_type = ? AND scope_id = ?
    `).get(String(scopeType), String(scopeId));
    return row?.active_branch_id ? this.getBranch(row.active_branch_id) : undefined;
  }

  setActiveBranch(scopeType, scopeId, branchId) {
    const timestamp = this.now();
    this.db.prepare(`
      INSERT INTO worldline_active_state (scope_type, scope_id, active_branch_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        active_branch_id = excluded.active_branch_id,
        updated_at = excluded.updated_at
    `).run(String(scopeType), String(scopeId), branchId, timestamp);
    return this.getActiveBranch(scopeType, scopeId);
  }

  deleteScope(scopeType, scopeId) {
    const normalizedScopeType = String(scopeType || '');
    const normalizedScopeId = String(scopeId || '');
    if (!normalizedScopeType || !normalizedScopeId) {
      throw validationError('Worldline scope delete requires scopeType and scopeId');
    }
    const savepointCount = Number(this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM worldline_savepoints
      WHERE scope_type = ? AND scope_id = ?
    `).get(normalizedScopeType, normalizedScopeId)?.total || 0);
    const branchCount = Number(this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM worldline_branches
      WHERE scope_type = ? AND scope_id = ?
    `).get(normalizedScopeType, normalizedScopeId)?.total || 0);
    this.db.prepare(`
      DELETE FROM worldline_active_state
      WHERE scope_type = ? AND scope_id = ?
    `).run(normalizedScopeType, normalizedScopeId);
    this.db.prepare(`
      DELETE FROM worldline_savepoints
      WHERE scope_type = ? AND scope_id = ?
    `).run(normalizedScopeType, normalizedScopeId);
    this.db.prepare(`
      DELETE FROM worldline_branches
      WHERE scope_type = ? AND scope_id = ?
    `).run(normalizedScopeType, normalizedScopeId);
    return {
      deleted: true,
      scopeType: normalizedScopeType,
      scopeId: normalizedScopeId,
      savepoints: savepointCount,
      branches: branchCount
    };
  }

  async resolveTarget(input = {}) {
    if (input.scopeType && input.scopeId) {
      const scopeType = String(input.scopeType);
      const scopeId = String(input.scopeId);
      return {
        scopeType,
        scopeId,
        runtimeSessionId: input.runtimeSessionId || (scopeType === 'runtime-session' ? scopeId : undefined),
        appChatSessionId: input.appChatSessionId || (scopeType === 'app-chat' ? scopeId : undefined)
      };
    }
    if (input.runtimeSessionId || input.sessionId) {
      const runtimeSessionId = String(input.runtimeSessionId || input.sessionId);
      return {
        scopeType: 'runtime-session',
        scopeId: runtimeSessionId,
        runtimeSessionId
      };
    }
    if (input.appChatSessionId || input.chatSessionId || input.chatId) {
      const appChatSessionId = String(input.appChatSessionId || input.chatSessionId || input.chatId);
      return {
        scopeType: 'app-chat',
        scopeId: appChatSessionId,
        appChatSessionId
      };
    }
    throw validationError('Savepoint target requires runtimeSessionId, appChatSessionId, or scopeType + scopeId');
  }

  async captureSnapshot(input = {}) {
    const snapshot = {
      version: 'ai-dnd-worldline-snapshot-v1',
      capturedAt: this.now(),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      runtimeSession: undefined,
      structuredInterface: undefined,
      appChat: undefined,
      globalData: undefined,
      runtimeRag: undefined,
      permanentRag: undefined,
      audit: undefined
    };

    if (input.runtimeSessionId) {
      const session = await this.sessionStore.get(input.runtimeSessionId);
      if (!session) throw notFound(`Runtime session not found: ${input.runtimeSessionId}`);
      snapshot.runtimeSession = cloneJson(session);
      snapshot.structuredInterface = this.structuredInterfaceStore?.load(input.runtimeSessionId);
    }

    if (input.appChatSessionId) {
      if (!this.appDatabase) throw validationError('App chat savepoint requires appDatabase');
      snapshot.appChat = this.appDatabase.exportChatSession(input.appChatSessionId);
      if (this.dataManager && input.includeGlobalData !== false) {
        snapshot.globalData = exportScopedDataRecords(this.dataManager, {
          characterCardId: snapshot.appChat.chatSession.characterCardId,
          chatSessionId: input.appChatSessionId,
          lifecycleScope: 'chat'
        });
      }
    }

    const runtimeRagCollections = resolveRagCollections({
      service: this.runtimeRagService,
      inputCollections: input.runtimeRagCollections,
      include: input.includeRuntimeRag !== false,
      defaultCollection: snapshot.runtimeSession?.collection
    });
    if (runtimeRagCollections.length > 0) {
      snapshot.runtimeRag = {
        collections: this.runtimeRagService.exportCollections({ collections: runtimeRagCollections })
      };
    }

    const permanentRagCollections = resolveRagCollections({
      service: this.permanentRagService,
      inputCollections: input.permanentRagCollections,
      include: input.includePermanentRag === true || Array.isArray(input.permanentRagCollections),
      defaultCollection: undefined
    });
    if (permanentRagCollections.length > 0) {
      snapshot.permanentRag = {
        collections: this.permanentRagService.exportCollections({ collections: permanentRagCollections })
      };
    }

    if (this.auditLog && input.includeAudit !== false) {
      snapshot.audit = {
        scopeEvents: this.auditLog.listEvents({
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          limit: input.auditLimit || 500
        }).map((event) => ({
          id: event.id,
          operation: event.operation,
          status: event.status,
          createdAt: event.createdAt,
          metadata: event.metadata,
          traceRefs: event.traceRefs
        }))
      };
    }

    return removeUndefined(snapshot);
  }

  async restoreSnapshot(snapshot = {}) {
    const restored = {};

    if (snapshot.runtimeSession) {
      if (!this.sessionStore) throw validationError('Runtime session restore requires sessionStore');
      const current = await this.sessionStore.get(snapshot.runtimeSession.id);
      const next = {
        ...(current || {}),
        ...snapshot.runtimeSession
      };
      restored.runtimeSession = await this.sessionStore.update(snapshot.runtimeSession.id, next);
      if (!restored.runtimeSession) {
        restored.runtimeSession = await this.sessionStore.create(next);
      }
    }

    if (snapshot.structuredInterface?.sessionId && this.structuredInterfaceStore) {
      restored.structuredInterface = this.structuredInterfaceStore.save(
        snapshot.structuredInterface.sessionId,
        snapshot.structuredInterface.state || {},
        {
          source: 'worldline.restore',
          mode: 'restore',
          update: {
            savepointCapturedAt: snapshot.capturedAt
          }
        }
      );
    }

    if (snapshot.appChat) {
      if (!this.appDatabase) throw validationError('App chat restore requires appDatabase');
      const chatSessionId = snapshot.appChat.chatSession.id;
      if (snapshot.appChat.chatSession) {
        restored.appChatSession = this.appDatabase.restoreChatSessionSnapshot(snapshot.appChat.chatSession);
      }
      restored.appChatMessages = this.appDatabase.replaceChatMessages(chatSessionId, snapshot.appChat.messages || []);
      if (snapshot.appChat.dataDatabase) {
        restored.appChatData = this.appDatabase.replaceChatDataDatabase(chatSessionId, snapshot.appChat.dataDatabase);
      }
    }

    if (snapshot.globalData && this.dataManager) {
      restored.globalData = restoreScopedDataRecords(this.dataManager, snapshot.globalData);
    }

    if (snapshot.runtimeRag?.collections && this.runtimeRagService) {
      restored.runtimeRag = await this.runtimeRagService.restoreCollections(snapshot.runtimeRag.collections);
    }

    if (snapshot.permanentRag?.collections && this.permanentRagService) {
      restored.permanentRag = await this.permanentRagService.restoreCollections(snapshot.permanentRag.collections);
    }

    return restored;
  }

  updateBranchHead(branchId, savepointId) {
    const timestamp = this.now();
    this.db.prepare(`
      UPDATE worldline_branches
      SET head_savepoint_id = ?, updated_at = ?
      WHERE id = ?
    `).run(savepointId, timestamp, branchId);
  }

  attachActiveState(branch) {
    const row = this.db.prepare(`
      SELECT active_branch_id
      FROM worldline_active_state
      WHERE scope_type = ? AND scope_id = ?
    `).get(branch.scopeType, branch.scopeId);
    return {
      ...branch,
      active: row?.active_branch_id === branch.id
    };
  }

  writeTrace(operation, { id, input, output, snapshot, error, createdAt = this.now() } = {}) {
    if (!this.trace.enabled || !this.trace.directory) return undefined;
    const traceId = id || createId('worldtrace');
    const directory = resolve(
      this.trace.directory,
      createdAt.slice(0, 10),
      `${safePathSegment(createdAt)}_${safePathSegment(traceId)}_${safePathSegment(operation)}`
    );
    mkdirSync(directory, { recursive: true });
    const files = {
      input: resolve(directory, 'input.json'),
      snapshot: resolve(directory, 'snapshot.json'),
      output: resolve(directory, 'output.json'),
      error: resolve(directory, 'error.json'),
      summary: resolve(directory, 'summary.json')
    };
    writeJson(files.input, input || {});
    if (snapshot !== undefined) writeJson(files.snapshot, snapshot);
    if (output !== undefined) writeJson(files.output, output);
    if (error !== undefined) writeJson(files.error, serializeError(error));
    const summary = {
      traceId,
      operation,
      status: error ? 'error' : 'success',
      createdAt,
      directory,
      files: removeUndefined({
        input: files.input,
        snapshot: snapshot !== undefined ? files.snapshot : undefined,
        output: output !== undefined ? files.output : undefined,
        error: error !== undefined ? files.error : undefined,
        summary: files.summary
      })
    };
    writeJson(files.summary, summary);
    return summary;
  }
}

function rowToSavepoint(row, { includeSnapshot = true } = {}) {
  return removeUndefined({
    id: row.id,
    branchId: row.branch_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    label: row.label,
    description: row.description,
    snapshot: includeSnapshot ? parseJson(row.snapshot_json, {}) : undefined,
    snapshotSummary: parseJson(row.snapshot_summary_json, {}),
    traceRefs: parseJson(row.trace_refs_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at
  });
}

function rowToBranch(row) {
  return {
    id: row.id,
    name: row.name,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    parentBranchId: row.parent_branch_id,
    sourceSavepointId: row.source_savepoint_id,
    headSavepointId: row.head_savepoint_id,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function summarizeSnapshot(snapshot = {}) {
  return {
    runtimeMessages: snapshot.runtimeSession?.messages?.length || 0,
    appChatMessages: snapshot.appChat?.messages?.length || 0,
    chatDataCollections: snapshot.appChat?.dataDatabase?.collections?.length || 0,
    globalDataCollections: snapshot.globalData?.collections?.length || 0,
    runtimeRagCollections: snapshot.runtimeRag?.collections?.map(summarizeRagCollection) || [],
    permanentRagCollections: snapshot.permanentRag?.collections?.map(summarizeRagCollection) || [],
    auditEvents: snapshot.audit?.scopeEvents?.length || 0,
    hasStructuredInterface: Boolean(snapshot.structuredInterface)
  };
}

function summarizeRagCollection(collection) {
  return {
    collection: collection.collection,
    documents: collection.documents?.length || 0
  };
}

function resolveRagCollections({ service, inputCollections, include, defaultCollection } = {}) {
  if (!service || !include) return [];
  if (Array.isArray(inputCollections) && inputCollections.length > 0) {
    return [...new Set(inputCollections.map(String))];
  }
  if (defaultCollection) return [defaultCollection];
  return service.listCollections().map((collection) => collection.collection);
}

function exportScopedDataRecords(dataManager, criteria = {}) {
  const scope = { ...criteria };
  if (!dataManager) return { database: 'global-data', scope, collections: [], collectionDescriptions: [] };
  const collectionDescriptions = dataManager.listCollections().map((collection) => dataManager.describeCollection(collection));
  const collections = [];
  for (const collection of dataManager.listCollections()) {
    const records = dataManager.queryRecords(collection, {
      limit: 100000,
      lifecycleFilter: false
    }).records.filter((record) => resourceMatchesScope(record.data || {}, criteria));
    if (records.length > 0) {
      collections.push({ collection, records });
    }
  }
  return { database: 'global-data', scope, collectionDescriptions, collections };
}

function restoreScopedDataRecords(dataManager, snapshot = {}) {
  if (!dataManager) return { restoredCollections: [] };
  const scope = snapshot.scope || {};
  const beforeCollections = new Set((snapshot.collectionDescriptions || [])
    .map((collection) => collection.collection || collection.name)
    .filter(Boolean));
  const cleanup = deleteScopedDataRecords(dataManager, scope);
  const restoredCollections = [];
  for (const collection of snapshot.collections || []) {
    const name = collection.collection || collection.name;
    const records = [];
    for (const record of collection.records || []) {
      records.push(dataManager.upsertRecord(name, record.data || record, { id: record.id }));
    }
    restoredCollections.push({ collection: name, records: records.length });
  }
  const restoredNames = new Set(restoredCollections.map((collection) => collection.collection));
  for (const collection of dataManager.listCollections()) {
    if (beforeCollections.has(collection) || restoredNames.has(collection)) continue;
    const remaining = dataManager.queryRecords(collection, { limit: 1, lifecycleFilter: false }).records;
    if (remaining.length === 0) {
      dataManager.deleteCollection(collection);
    }
  }
  return {
    cleanup,
    restoredCollections
  };
}

function resourceMatchesScope(data = {}, criteria = {}) {
  const lifecycle = lifecycleFromData(data);
  if (!lifecycle.lifecycleManaged) return false;
  if (criteria.lifecycleScope && lifecycle.lifecycleScope !== criteria.lifecycleScope) return false;
  if (criteria.chatSessionId) {
    return lifecycle.lifecycleScope === 'chat' && lifecycle.chatSessionId === criteria.chatSessionId;
  }
  if (criteria.characterCardId) {
    return lifecycle.characterCardId === criteria.characterCardId;
  }
  return true;
}

function normalizeTraceOptions(trace, cwd) {
  if (trace === false) {
    return {
      enabled: false,
      directory: null
    };
  }
  const input = trace && typeof trace === 'object' ? trace : {};
  return {
    enabled: input.enabled !== false,
    directory: input.directory === null ? null : resolve(cwd, input.directory || DEFAULT_TRACE_DIR)
  };
}

function normalizeActor(actor) {
  if (typeof actor === 'string') {
    return {
      type: actor,
      id: undefined
    };
  }
  return {
    type: actor?.type || 'user',
    id: actor?.id
  };
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
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

function safePathSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 160);
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    stack: error?.stack
  };
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'WorldlineNotFoundError';
  error.statusCode = 404;
  return error;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'WorldlineValidationError';
  error.statusCode = 400;
  return error;
}
