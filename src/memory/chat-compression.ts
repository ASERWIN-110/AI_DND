// @ts-nocheck
import YAML from 'yaml';
import { serializeDialogue } from '../core/messages.js';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { estimateTokens } from '../tokens/token-counter.js';

export const CHAT_COMPRESSION_TAG = 'AI_DND_CHAT_COMPRESSION';
export const CHAT_COMPRESSION_COLLECTION = 'chat_compressions';

export const CHAT_COMPRESSION_TYPES = new Set([
  'rolling_summary',
  'segment_summary',
  'pinned_fact',
  'scene_summary',
  'manual_note'
]);

export const CHAT_COMPRESSION_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'type', type: 'text', description: 'Compression record type: rolling_summary, segment_summary, pinned_fact, scene_summary, or manual_note.' },
  { name: 'title', type: 'text', description: 'Short human-readable title.' },
  { name: 'summary', type: 'text', description: 'Compressed memory text.' },
  { name: 'facts', type: 'json', description: 'Stable facts preserved from the source messages.' },
  { name: 'openThreads', type: 'json', description: 'Unresolved goals, questions, hooks, or promises.' },
  { name: 'npcNotes', type: 'json', description: 'Compact per-NPC notes derived from the source messages.' },
  { name: 'sceneNotes', type: 'json', description: 'Compact scene/location notes derived from the source messages.' },
  { name: 'sourceMessageIds', type: 'json', description: 'Raw chat message ids covered by this compression record.' },
  { name: 'fromMessageId', type: 'text', description: 'First raw message id covered by this record.' },
  { name: 'toMessageId', type: 'text', description: 'Last raw message id covered by this record.' },
  { name: 'fromOrderIndex', type: 'integer', description: 'First raw message order_index covered by this record.' },
  { name: 'toOrderIndex', type: 'integer', description: 'Last raw message order_index covered by this record.' },
  { name: 'tokenEstimate', type: 'integer', description: 'Approximate token count of the compressed record.' },
  { name: 'importance', type: 'number', description: '0-1 importance score for prompt selection.' },
  { name: 'status', type: 'text', description: 'active, superseded, archived, or draft.' },
  { name: 'source', type: 'text', description: 'assistant, manual, import, tool, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra debug or integration metadata.' },
  { name: 'compressionUpdatedAt', type: 'text', description: 'Latest compression update timestamp.' }
];

const DEFAULT_RECENT_MESSAGE_COUNT = 12;
const DEFAULT_COMPRESSION_MESSAGE_COUNT = 40;
const DEFAULT_SUMMARY_LIMIT = 12;
const DEFAULT_PINNED_LIMIT = 50;

export class ChatCompressionMemory {
  constructor({
    appDatabase,
    collection = CHAT_COMPRESSION_COLLECTION,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('ChatCompressionMemory requires appDatabase');
    this.appDatabase = appDatabase;
    this.collection = collection;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/chat-compression-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollection(chatSessionId) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    manager.ensureCollection(this.collection);
    manager.alterFields(this.collection, {
      add: CHAT_COMPRESSION_FIELDS,
      reason: 'chatCompression:derived-chat-memory'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    return this.ensureCollection(chatSessionId);
  }

  listSummaries({
    chatSessionId,
    type,
    status,
    query = '',
    filter = {},
    sort = [{ field: 'type', direction: 'asc' }, { field: 'fromOrderIndex', direction: 'asc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (type) mergedFilter.type = normalizeCompressionType(type);
    if (status) mergedFilter.status = normalizeStatus(status);

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
      return summaryHaystack(data).includes(normalizedQuery);
    });

    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  getSummary({ chatSessionId, id, recordId, summaryId } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const normalizedId = normalizeRequiredText(recordId || summaryId || id, 'id');
    const { manager } = this.openManager(normalizedChatSessionId);
    return manager.getRecord(this.collection, normalizedId);
  }

  upsertSummary(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.compressionSnapshot({ chatSessionId });
    const trace = this.traceRecorder.start('chat-compression-upsert', {
      sessionId: chatSessionId,
      input: { source, summary: input },
      stateBefore: before
    });

    try {
      const record = this.applySummaryRecord(input, { source });
      const after = this.compressionSnapshot({ chatSessionId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  patchSummary(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.getSummary(input);
    const patch = normalizeObject(input.patch || input.update || input);
    const before = this.compressionSnapshot({ chatSessionId });
    const trace = this.traceRecorder.start('chat-compression-patch', {
      sessionId: chatSessionId,
      input: { source, id: current.id, patch },
      stateBefore: before
    });

    try {
      const record = this.applySummaryRecord({
        ...current.data,
        ...patch,
        chatSessionId,
        id: current.id
      }, { source });
      const after = this.compressionSnapshot({ chatSessionId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  deleteSummary(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.getSummary(input);
    const before = this.compressionSnapshot({ chatSessionId });
    const trace = this.traceRecorder.start('chat-compression-delete', {
      sessionId: chatSessionId,
      input: { id: current.id },
      stateBefore: before
    });

    try {
      const { manager } = this.openManager(chatSessionId);
      const deleted = manager.deleteRecord(this.collection, current.id);
      const after = this.compressionSnapshot({ chatSessionId });
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

  buildPrompt(chatSessionId, {
    type = 'segment_summary',
    messageIds,
    fromMessageId,
    toMessageId,
    fromOrderIndex,
    toOrderIndex,
    recentCount = DEFAULT_COMPRESSION_MESSAGE_COUNT,
    includeExistingContext = true,
    extraInstructions = ''
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const selected = this.selectMessages(normalizedChatSessionId, {
      messageIds,
      fromMessageId,
      toMessageId,
      fromOrderIndex,
      toOrderIndex,
      recentCount
    });
    const existingContext = includeExistingContext
      ? this.getPromptContext(normalizedChatSessionId, {
        recentMessageCount: 0,
        includeSegmentSummaries: false,
        includePinnedFacts: true,
        includeRolling: true
      })
      : undefined;
    const prompt = buildChatCompressionPrompt({
      chatSessionId: normalizedChatSessionId,
      type,
      selected,
      existingContext,
      extraInstructions
    });
    const trace = this.tracePrompt(normalizedChatSessionId, {
      prompt,
      state: this.compressionSnapshot({ chatSessionId: normalizedChatSessionId }),
      source: 'chat-compression.buildPrompt',
      options: {
        type,
        messageIds,
        fromMessageId,
        toMessageId,
        fromOrderIndex,
        toOrderIndex,
        recentCount,
        includeExistingContext,
        extraInstructions
      }
    });
    return {
      prompt,
      messages: selected.messages,
      range: selected.range,
      existingContext,
      trace
    };
  }

  applyModelOutput(chatSessionId, content, {
    source = 'assistant',
    defaultType = 'segment_summary'
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.compressionSnapshot({ chatSessionId: normalizedChatSessionId });
    const trace = this.traceRecorder.start('chat-compression-apply-model-output', {
      sessionId: normalizedChatSessionId,
      input: { source, defaultType, content },
      stateBefore: before
    });

    try {
      const extracted = extractChatCompressionUpdates(content);
      const records = [];
      for (const update of extracted.updates) {
        records.push(...this.applyChatCompressionUpdate(normalizedChatSessionId, update, {
          source,
          defaultType
        }));
      }
      const output = {
        content: stripChatCompressionUpdates(content),
        updates: extracted.updates,
        records,
        state: this.compressionSnapshot({ chatSessionId: normalizedChatSessionId }),
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

  getPromptContext(chatSessionId, {
    query = '',
    recentMessageCount = DEFAULT_RECENT_MESSAGE_COUNT,
    includeRolling = true,
    includeSegmentSummaries = true,
    includePinnedFacts = true,
    summaryLimit = DEFAULT_SUMMARY_LIMIT,
    pinnedLimit = DEFAULT_PINNED_LIMIT,
    maxContextTokens,
    includeRawMessages = true
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const all = manager.queryRecords(this.collection, {
      filter: { status: 'active' },
      limit: 500,
      sort: [{ field: 'updatedAt', direction: 'desc' }]
    }).records;
    const normalizedQuery = normalizeSearchText(query);
    const matching = normalizedQuery
      ? all.filter((record) => summaryHaystack(record.data || {}).includes(normalizedQuery))
      : all;

    const rolling = includeRolling
      ? matching
        .filter((record) => record.data?.type === 'rolling_summary')
        .sort(compareRecordUpdatedDesc)
        .slice(0, 1)
      : [];
    const segmentSummaries = includeSegmentSummaries
      ? matching
        .filter((record) => ['segment_summary', 'scene_summary', 'manual_note'].includes(record.data?.type))
        .sort(compareCompressionRangeAsc)
        .slice(-safePositiveInteger(summaryLimit, DEFAULT_SUMMARY_LIMIT))
      : [];
    const pinnedFacts = includePinnedFacts
      ? matching
        .filter((record) => record.data?.type === 'pinned_fact')
        .sort(compareImportanceDesc)
        .slice(0, safePositiveInteger(pinnedLimit, DEFAULT_PINNED_LIMIT))
      : [];
    const messages = includeRawMessages && recentMessageCount > 0
      ? this.selectMessages(normalizedChatSessionId, {
        recentCount: safePositiveInteger(recentMessageCount, DEFAULT_RECENT_MESSAGE_COUNT)
      }).messages
      : [];
    const sections = {
      rolling,
      segmentSummaries,
      pinnedFacts,
      recentMessages: messages
    };
    const rawContext = renderPromptContext(sections);
    const context = trimContextByTokenBudget(rawContext, maxContextTokens);

    return {
      chatSessionId: normalizedChatSessionId,
      context,
      sections,
      tokenEstimate: estimateTokens(context),
      truncated: context.length < rawContext.length,
      options: {
        query,
        recentMessageCount,
        includeRolling,
        includeSegmentSummaries,
        includePinnedFacts,
        summaryLimit,
        pinnedLimit,
        maxContextTokens,
        includeRawMessages
      }
    };
  }

  importDocument(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        chatCompressions: this.collection,
        chat_compressions: this.collection,
        compression: this.collection,
        compressions: this.collection,
        summaries: this.collection,
        memory: this.collection,
        records: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectCompressionRecords(groups, input.collection || this.collection);
    const records = selected.map((record) => this.applySummaryRecord({
      ...record,
      chatSessionId
    }, {
      source: input.source || record.source || 'document-import',
      defaultType: input.defaultType || record.type || 'manual_note'
    }));
    return {
      format: parsed.format,
      collection: this.collection,
      chatSessionId,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    chatSessionId,
    format = 'json',
    type,
    status,
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listSummaries({
      chatSessionId,
      type,
      status,
      query,
      limit,
      offset
    });
    const payload = {
      chatSessionId: listed.chatSessionId,
      chatCompressions: listed.records.map((record) => ({
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

  selectMessages(chatSessionId, {
    messageIds,
    fromMessageId,
    toMessageId,
    fromOrderIndex,
    toOrderIndex,
    recentCount = DEFAULT_COMPRESSION_MESSAGE_COUNT
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const allMessages = this.appDatabase.listChatMessages(normalizedChatSessionId);
    let selected = [...allMessages];

    if (Array.isArray(messageIds) && messageIds.length > 0) {
      const ids = new Set(messageIds.map(String));
      selected = allMessages.filter((message) => ids.has(message.id));
    } else {
      const fromIndex = fromMessageId
        ? allMessages.find((message) => message.id === fromMessageId)?.orderIndex
        : fromOrderIndex;
      const toIndex = toMessageId
        ? allMessages.find((message) => message.id === toMessageId)?.orderIndex
        : toOrderIndex;

      if (Number.isInteger(fromIndex)) {
        selected = selected.filter((message) => message.orderIndex >= fromIndex);
      }
      if (Number.isInteger(toIndex)) {
        selected = selected.filter((message) => message.orderIndex <= toIndex);
      }
      if (!Number.isInteger(fromIndex) && !Number.isInteger(toIndex)) {
        selected = selected.slice(Math.max(0, selected.length - safePositiveInteger(recentCount, DEFAULT_COMPRESSION_MESSAGE_COUNT)));
      }
    }

    const range = selected.length > 0
      ? {
        fromMessageId: selected[0].id,
        toMessageId: selected[selected.length - 1].id,
        fromOrderIndex: selected[0].orderIndex,
        toOrderIndex: selected[selected.length - 1].orderIndex,
        count: selected.length
      }
      : {
        count: 0
      };

    return {
      chatSessionId: normalizedChatSessionId,
      messages: selected,
      range
    };
  }

  applyChatCompressionUpdate(chatSessionId, update = {}, { source = 'assistant', defaultType = 'segment_summary' } = {}) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) return [];
    const entries = extractCompressionEntries(update, defaultType);
    return entries.map((entry) => this.applySummaryRecord({
      sourceMessageIds: update.sourceMessageIds,
      fromMessageId: update.fromMessageId,
      toMessageId: update.toMessageId,
      fromOrderIndex: update.fromOrderIndex,
      toOrderIndex: update.toOrderIndex,
      ...entry,
      chatSessionId,
      type: entry.type || update.type || defaultType
    }, {
      source: entry.source || update.source || source,
      defaultType
    }));
  }

  applySummaryRecord(input = {}, { source = 'manual', defaultType = 'segment_summary' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const explicitId = normalizeOptionalText(input.recordId || input.summaryId || input.id);
    const existing = explicitId
      ? manager.getRecord(this.collection, explicitId, { missing: 'undefined' })
      : undefined;
    const normalized = normalizeChatCompressionRecord(input, {
      chatSessionId,
      existing: existing?.data,
      source,
      defaultType,
      now: this.now
    });
    const recordId = explicitId || compressionRecordId(normalized);
    return manager.upsertRecord(this.collection, normalized, { id: recordId });
  }

  compressionSnapshot({ chatSessionId, type, status = 'active' } = {}) {
    const listed = this.listSummaries({
      chatSessionId,
      type,
      status,
      limit: 500
    });
    return {
      chatSessionId: listed.chatSessionId,
      type,
      status,
      summaries: listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }))
    };
  }

  tracePrompt(chatSessionId, { prompt, state, source = 'prompt', options = {} } = {}) {
    const trace = this.traceRecorder.start('chat-compression-build-prompt', {
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

  openManager(chatSessionId) {
    this.ensureCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

export function buildChatCompressionPrompt({
  chatSessionId,
  type = 'segment_summary',
  selected = { messages: [], range: {} },
  existingContext,
  extraInstructions = '',
  tag = CHAT_COMPRESSION_TAG
} = {}) {
  const normalizedType = normalizeCompressionType(type);
  const range = selected.range || {};
  const sourceMessages = serializeMessagesForCompression(selected.messages || []);
  const template = {
    summaries: [
      {
        type: normalizedType,
        title: 'short title',
        summary: 'dense but readable compressed memory',
        facts: [
          { id: 'fact_stable_id', text: 'important stable fact', importance: 0.8 }
        ],
        openThreads: [
          { id: 'thread_stable_id', summary: 'unresolved hook or promise', status: 'open' }
        ],
        npcNotes: [
          { npcId: 'npc_id', name: 'NPC name', summary: 'compact current memory for this NPC' }
        ],
        sceneNotes: [
          { sceneId: 'scene_id', summary: 'compact current scene memory' }
        ],
        sourceMessageIds: (selected.messages || []).map((message) => message.id),
        fromMessageId: range.fromMessageId || '',
        toMessageId: range.toMessageId || '',
        fromOrderIndex: Number.isInteger(range.fromOrderIndex) ? range.fromOrderIndex : 0,
        toOrderIndex: Number.isInteger(range.toOrderIndex) ? range.toOrderIndex : 0,
        importance: 0.5,
        status: 'active'
      }
    ]
  };

  return [
    'Compress chat history for an interactive text RPG framework.',
    'The raw chat_messages database is the source of truth. Do not rewrite or delete raw messages.',
    'Your job is to create compact derived memory records that can replace older raw messages in future prompts.',
    'Preserve decisions, revealed facts, promises, unresolved hooks, scene changes, inventory-significant events, and NPC relationship changes.',
    'Do not invent facts. If something is uncertain, mark it as uncertain in the summary text.',
    'Keep summaries dense; avoid prose flourish. Prefer stable ids for facts, threads, NPC notes, and scene notes.',
    `Return exactly one JSON block wrapped as <${tag}>JSON</${tag}>.`,
    `Default summary type for this job: ${normalizedType}.`,
    `Chat session id: ${chatSessionId || ''}.`,
    range.count !== undefined ? `Covered message range: ${JSON.stringify(range)}.` : '',
    existingContext?.context ? `Existing compressed context, for continuity:\n${existingContext.context}` : '',
    extraInstructions ? `Additional instructions:\n${extraInstructions}` : '',
    `Source messages:\n${sourceMessages || '(no source messages selected)'}`,
    `Output JSON shape reference:\n${JSON.stringify(template, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function extractChatCompressionUpdates(content, { tag = CHAT_COMPRESSION_TAG } = {}) {
  const text = String(content || '');
  const updates = [];
  const tagPattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'gi');
  let match;

  while ((match = tagPattern.exec(text))) {
    updates.push(parseCompressionUpdate(match[1]));
  }

  const fencePattern = /```(?:json)?\s*ai-dnd-chat-compression\s*([\s\S]*?)```/gi;
  while ((match = fencePattern.exec(text))) {
    updates.push(parseCompressionUpdate(match[1]));
  }

  return { updates };
}

export function stripChatCompressionUpdates(content, { tag = CHAT_COMPRESSION_TAG } = {}) {
  return String(content || '')
    .replace(new RegExp(`\\s*<${tag}>\\s*[\\s\\S]*?\\s*<\\/${tag}>\\s*`, 'gi'), '\n')
    .replace(/\s*```(?:json)?\s*ai-dnd-chat-compression\s*[\s\S]*?```\s*/gi, '\n')
    .trim();
}

export function normalizeChatCompressionRecord(input = {}, {
  chatSessionId,
  existing,
  source = 'manual',
  defaultType = 'segment_summary',
  now = () => new Date().toISOString()
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('chat compression record must be a plain object');
  }

  const base = normalizeExistingCompression(existing);
  const type = normalizeCompressionType(pickDefined(input.type, base.type, defaultType));
  const summary = normalizeOptionalText(pickDefined(input.summary, input.text, base.summary));
  const title = normalizeOptionalText(pickDefined(input.title, base.title));
  const facts = normalizeRecordArray(pickDefined(input.facts, base.facts));
  const openThreads = normalizeRecordArray(pickDefined(input.openThreads, input.threads, base.openThreads));
  const npcNotes = normalizeRecordArray(pickDefined(input.npcNotes, input.npcs, base.npcNotes));
  const sceneNotes = normalizeRecordArray(pickDefined(input.sceneNotes, input.scenes, base.sceneNotes));
  const sourceMessageIds = normalizeStringArray(pickDefined(input.sourceMessageIds, input.messageIds, base.sourceMessageIds));
  const fromMessageId = normalizeOptionalText(pickDefined(input.fromMessageId, base.fromMessageId));
  const toMessageId = normalizeOptionalText(pickDefined(input.toMessageId, base.toMessageId));
  const fromOrderIndex = normalizeOptionalInteger(pickDefined(input.fromOrderIndex, base.fromOrderIndex));
  const toOrderIndex = normalizeOptionalInteger(pickDefined(input.toOrderIndex, base.toOrderIndex));
  const metadata = normalizeObject(pickDefined(input.metadata, base.metadata));
  const importance = normalizeImportance(pickDefined(input.importance, base.importance, defaultImportance(type)));
  const status = normalizeStatus(pickDefined(input.status, base.status, 'active'));
  const tokenEstimate = normalizeOptionalInteger(
    pickDefined(input.tokenEstimate, estimateTokens(renderCompressionText({
      title,
      summary,
      facts,
      openThreads,
      npcNotes,
      sceneNotes
    })))
  );

  return {
    chatSessionId: normalizeRequiredText(chatSessionId || input.chatSessionId || base.chatSessionId, 'chatSessionId'),
    type,
    title,
    summary,
    facts,
    openThreads,
    npcNotes,
    sceneNotes,
    sourceMessageIds,
    fromMessageId,
    toMessageId,
    fromOrderIndex,
    toOrderIndex,
    tokenEstimate,
    importance,
    status,
    source: normalizeOptionalText(source || input.source || base.source || 'manual'),
    metadata,
    compressionUpdatedAt: now()
  };
}

function extractCompressionEntries(update, defaultType) {
  if (Array.isArray(update.summaries)) return update.summaries;
  if (Array.isArray(update.chatCompressions)) return update.chatCompressions;
  if (Array.isArray(update.records)) return update.records;

  const entries = [];
  if (update.rollingSummary !== undefined) {
    entries.push({
      ...normalizeObject(update.rollingSummary),
      type: 'rolling_summary',
      summary: typeof update.rollingSummary === 'string' ? update.rollingSummary : update.rollingSummary?.summary
    });
  }
  if (update.segmentSummary !== undefined) {
    entries.push({
      ...normalizeObject(update.segmentSummary),
      type: 'segment_summary',
      summary: typeof update.segmentSummary === 'string' ? update.segmentSummary : update.segmentSummary?.summary
    });
  }
  if (Array.isArray(update.pinnedFacts)) {
    for (const fact of update.pinnedFacts) {
      entries.push({
        type: 'pinned_fact',
        title: fact?.title || fact?.id || '',
        summary: fact?.summary || fact?.text || String(fact || ''),
        facts: fact && typeof fact === 'object' ? [fact] : [],
        importance: fact?.importance
      });
    }
  }
  if (entries.length > 0) return entries;

  if (update.summary !== undefined || update.text !== undefined || update.type !== undefined) {
    return [{ ...update, type: update.type || defaultType }];
  }
  return [];
}

function selectCompressionRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const selected = preferred || groups.find((group) => [
    'chatCompressions',
    'chat_compressions',
    CHAT_COMPRESSION_COLLECTION,
    'compression',
    'compressions',
    'summaries',
    'memory',
    'records'
  ].includes(group.collection)) || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function renderPromptContext({ rolling = [], segmentSummaries = [], pinnedFacts = [], recentMessages = [] } = {}) {
  const sections = [];
  if (rolling.length > 0) {
    sections.push(`Rolling summary:\n${rolling.map((record) => `- ${record.data.summary}`).join('\n')}`);
  }
  if (segmentSummaries.length > 0) {
    sections.push(`Segment summaries:\n${segmentSummaries.map((record) => {
      const data = record.data || {};
      const range = Number.isInteger(data.fromOrderIndex) || Number.isInteger(data.toOrderIndex)
        ? `[${data.fromOrderIndex ?? '?'}-${data.toOrderIndex ?? '?'}] `
        : '';
      return `- ${range}${data.title ? `${data.title}: ` : ''}${data.summary}`;
    }).join('\n')}`);
  }
  if (pinnedFacts.length > 0) {
    sections.push(`Pinned facts:\n${pinnedFacts.map((record) => {
      const data = record.data || {};
      return `- ${data.title ? `${data.title}: ` : ''}${data.summary}`;
    }).join('\n')}`);
  }
  if (recentMessages.length > 0) {
    sections.push(`Recent raw messages:\n${serializeDialogue(recentMessages)}`);
  }
  return sections.join('\n\n');
}

function trimContextByTokenBudget(context, maxContextTokens) {
  const budget = Number(maxContextTokens);
  if (!Number.isFinite(budget) || budget <= 0) return context;
  if (estimateTokens(context) <= budget) return context;
  const approxChars = Math.max(200, Math.floor(budget * 3));
  return context.slice(Math.max(0, context.length - approxChars)).trimStart();
}

function serializeMessagesForCompression(messages = []) {
  return messages.map((message) => {
    const name = message.name ? `/${message.name}` : '';
    return `[${message.orderIndex}] ${message.id} ${message.role}${name}: ${message.content}`;
  }).join('\n');
}

function renderCompressionText(record) {
  return [
    record.title,
    record.summary,
    JSON.stringify(record.facts || []),
    JSON.stringify(record.openThreads || []),
    JSON.stringify(record.npcNotes || []),
    JSON.stringify(record.sceneNotes || [])
  ].filter(Boolean).join('\n');
}

function compressionRecordId(record) {
  if (record.type === 'rolling_summary') return 'chatcomp_rolling_active';
  if (record.type === 'pinned_fact') {
    return `chatcomp_pinned_${safeSegment(record.title || record.summary || shortHash(record.summary))}`.slice(0, 128);
  }
  const from = Number.isInteger(record.fromOrderIndex)
    ? String(record.fromOrderIndex)
    : safeSegment(record.fromMessageId || 'start');
  const to = Number.isInteger(record.toOrderIndex)
    ? String(record.toOrderIndex)
    : safeSegment(record.toMessageId || record.title || shortHash(record.summary));
  return `chatcomp_${safeSegment(record.type)}_${from}_${to}`.slice(0, 128);
}

function normalizeExistingCompression(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    chatSessionId: '',
    type: 'segment_summary',
    title: '',
    summary: '',
    facts: [],
    openThreads: [],
    npcNotes: [],
    sceneNotes: [],
    sourceMessageIds: [],
    fromMessageId: '',
    toMessageId: '',
    fromOrderIndex: undefined,
    toOrderIndex: undefined,
    tokenEstimate: undefined,
    importance: undefined,
    status: 'active',
    source: '',
    metadata: {},
    ...input,
    facts: normalizeRecordArray(input.facts || []),
    openThreads: normalizeRecordArray(input.openThreads || []),
    npcNotes: normalizeRecordArray(input.npcNotes || []),
    sceneNotes: normalizeRecordArray(input.sceneNotes || []),
    sourceMessageIds: normalizeStringArray(input.sourceMessageIds || []),
    metadata: normalizeObject(input.metadata)
  };
}

function parseCompressionUpdate(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.message = `Invalid chat compression JSON: ${error.message}`;
    error.statusCode = 400;
    throw error;
  }
}

function summaryHaystack(data) {
  return normalizeSearchText([
    data.type,
    data.title,
    data.summary,
    JSON.stringify(data.facts || []),
    JSON.stringify(data.openThreads || []),
    JSON.stringify(data.npcNotes || []),
    JSON.stringify(data.sceneNotes || []),
    (data.sourceMessageIds || []).join(' ')
  ].filter(Boolean).join(' '));
}

function compareRecordUpdatedDesc(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function compareCompressionRangeAsc(a, b) {
  const aIndex = Number.isInteger(a.data?.toOrderIndex) ? a.data.toOrderIndex : Number.MAX_SAFE_INTEGER;
  const bIndex = Number.isInteger(b.data?.toOrderIndex) ? b.data.toOrderIndex : Number.MAX_SAFE_INTEGER;
  return aIndex - bIndex || String(a.id).localeCompare(String(b.id));
}

function compareImportanceDesc(a, b) {
  return Number(b.data?.importance || 0) - Number(a.data?.importance || 0) || compareRecordUpdatedDesc(a, b);
}

function normalizeCompressionType(type) {
  const normalized = String(type || 'segment_summary').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (CHAT_COMPRESSION_TYPES.has(normalized)) return normalized;
  throw validationError(`Unsupported chat compression type: ${type}`);
}

function normalizeStatus(status) {
  const normalized = String(status || 'active').trim().toLowerCase();
  if (['active', 'superseded', 'archived', 'draft'].includes(normalized)) return normalized;
  throw validationError(`Unsupported chat compression status: ${status}`);
}

function defaultImportance(type) {
  if (type === 'rolling_summary') return 0.9;
  if (type === 'pinned_fact') return 0.8;
  if (type === 'segment_summary') return 0.5;
  return 0.4;
}

function normalizeImportance(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw validationError(`importance must be a finite number: ${value}`);
  return Math.max(0, Math.min(1, number));
}

function normalizeRecordArray(value) {
  if (value === undefined || value === null || value === '') return [];
  const input = Array.isArray(value) ? value : [value];
  return input
    .filter((item) => item !== undefined && item !== null && item !== '')
    .map((item) => item && typeof item === 'object' && !Array.isArray(item)
      ? { ...item }
      : { text: String(item) });
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number)) throw validationError(`Expected integer, got: ${value}`);
  return number;
}

function safePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
  return number;
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
  return String(value || '').normalize('NFKC').toLowerCase();
}

function pickDefined(...values) {
  return values.find((value) => value !== undefined);
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'item';
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'chat-compression');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ChatCompressionValidationError';
  error.statusCode = 400;
  return error;
}
