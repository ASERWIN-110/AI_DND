// @ts-nocheck
export function createToolStateSnapshotProvider({ appDatabase, dataManager } = {}) {
  return {
    capture: ({ tool, input, context } = {}) => captureToolStateSnapshot({
      appDatabase,
      dataManager,
      tool,
      input,
      context
    }),
    restore: (snapshot) => restoreToolStateSnapshot({
      appDatabase,
      dataManager,
      snapshot
    })
  };
}

export function captureToolStateSnapshot({
  appDatabase,
  dataManager,
  tool,
  input = {},
  context = {}
} = {}) {
  const snapshot = {};
  const chatSessionId = detectChatSessionId(input, context);

  if (appDatabase && chatSessionId) {
    snapshot.appChatData = appDatabase.exportChatDataDatabase(chatSessionId);
  }

  if (dataManager && shouldSnapshotGlobalData(tool)) {
    snapshot.globalData = exportDataManagerSnapshot(dataManager);
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

export function restoreToolStateSnapshot({
  appDatabase,
  dataManager,
  snapshot
} = {}) {
  const restored = {};
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      restored,
      skipped: true,
      reason: 'missing_snapshot'
    };
  }

  if (snapshot.appChatData) {
    if (!appDatabase) throw validationError('Cannot restore app chat data without appDatabase');
    restored.appChatData = appDatabase.replaceChatDataDatabase(
      snapshot.appChatData.database.chatSessionId,
      snapshot.appChatData
    );
  }

  if (snapshot.globalData) {
    if (!dataManager) throw validationError('Cannot restore global data without dataManager');
    restored.globalData = replaceDataManagerSnapshot(dataManager, snapshot.globalData);
  }

  return {
    restored,
    skipped: Object.keys(restored).length === 0
  };
}

export function exportDataManagerSnapshot(manager) {
  if (!manager) return undefined;
  const collections = manager.listCollections().map((collection) => ({
    collection,
    description: manager.describeCollection(collection),
    records: manager.queryRecords(collection, { limit: 500 }).records
  }));
  return {
    databasePath: manager.databasePath,
    exportedAt: new Date().toISOString(),
    collections
  };
}

export function replaceDataManagerSnapshot(manager, snapshot = {}) {
  if (!manager) throw validationError('dataManager is required');
  const existing = manager.listCollections();
  for (const collection of existing) {
    manager.deleteCollection(collection);
  }

  const collections = Array.isArray(snapshot.collections) ? snapshot.collections : [];
  for (const collectionSnapshot of collections) {
    const name = collectionSnapshot.collection || collectionSnapshot.name;
    if (!name) continue;
    manager.ensureCollection(name);
    const fields = extractSnapshotFields(collectionSnapshot);
    if (fields.length > 0) {
      manager.alterFields(name, {
        add: fields,
        reason: 'audit.restore'
      });
    }
    const records = Array.isArray(collectionSnapshot.records) ? collectionSnapshot.records : [];
    for (const record of records) {
      manager.upsertRecord(name, record.data || record, { id: record.id });
    }
  }

  return {
    restored: true,
    collections: collections.map((collection) => collection.collection || collection.name).filter(Boolean)
  };
}

export function detectChatSessionId(input = {}, context = {}) {
  return input.chatSessionId ||
    input.chatId ||
    input.sessionId ||
    context.chatSessionId ||
    context.chatId ||
    context.sessionId;
}

function shouldSnapshotGlobalData(tool = {}) {
  if (!tool?.mutatesState) return false;
  const scope = tool.metadata?.scope || tool.annotations?.scope;
  if (scope && ['runtime-rag', 'permanent-rag'].includes(scope)) return false;
  if (tool.pluginId && [
    'core.utility',
    'game.dice',
    'system.audit',
    'system.action',
    'system.worldline'
  ].includes(tool.pluginId)) return false;
  return true;
}

function extractSnapshotFields(collectionSnapshot = {}) {
  const candidates = collectionSnapshot.description?.fields ||
    collectionSnapshot.description?.format?.fields ||
    collectionSnapshot.format?.fields ||
    [];
  return candidates
    .filter((field) => field && !field.system && field.name)
    .map((field) => ({
      name: field.name,
      type: field.type || 'text',
      description: field.description,
      defaultValue: field.defaultValue
    }));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'AuditSnapshotError';
  error.statusCode = 400;
  return error;
}
