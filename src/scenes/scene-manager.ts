// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { ChatCompressionMemory } from '../memory/chat-compression.js';
import { SceneMapMountManager } from '../maps/scene-map-mounts.js';
import { SceneNpcMountManager } from '../npcs/scene-npc-mounts.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { TimeTurnManager } from '../time/time-turn-manager.js';

export const SCENE_RECORDS_COLLECTION = 'scene_records';

export const SCENE_RECORD_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning app chat session id. Duplicated for readable exports.' },
  { name: 'sceneId', type: 'text', description: 'Stable scene id inside one chat.' },
  { name: 'title', type: 'text', description: 'Human-readable scene title.' },
  { name: 'summary', type: 'text', description: 'Compact prompt-facing scene summary.' },
  { name: 'status', type: 'text', description: 'active, paused, ended, archived, or draft.' },
  { name: 'locationLabel', type: 'text', description: 'Display location or area label.' },
  { name: 'mapRefs', type: 'json', description: 'Maps requested or mounted for this scene.' },
  { name: 'npcRefs', type: 'json', description: 'NPCs requested or mounted for this scene.' },
  { name: 'ragQueries', type: 'json', description: 'RAG queries used to load scene context.' },
  { name: 'ragContext', type: 'json', description: 'Compact RAG hits loaded on scene enter.' },
  { name: 'timeConfig', type: 'json', description: 'Time, event, and encounter initialization request/result.' },
  { name: 'structuredInterface', type: 'json', description: 'Structured UI injection request/result for this scene.' },
  { name: 'memorySummaryId', type: 'text', description: 'Scene summary compression record id created on scene end.' },
  { name: 'metadata', type: 'json', description: 'Extra scene metadata.' },
  { name: 'enteredAt', type: 'text', description: 'Scene enter timestamp.' },
  { name: 'endedAt', type: 'text', description: 'Scene end timestamp.' },
  { name: 'sceneUpdatedAt', type: 'text', description: 'Latest scene update timestamp.' }
];

const DEFAULT_SCENE_ID = 'current';
const DEFAULT_RAG_LIMIT = 4;
const DEFAULT_RAG_MIN_SCORE = 0.15;

export class SceneManager {
  constructor({
    appDatabase,
    dataManager,
    sceneMaps,
    sceneNpcs,
    timeManager,
    chatCompression,
    runtimeRagService,
    permanentRagService,
    structuredInterfaceStore,
    collection = SCENE_RECORDS_COLLECTION,
    trace,
    traceRecorder,
    chatProvider,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('SceneManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.collection = collection;
    this.sceneMaps = sceneMaps || new SceneMapMountManager({ appDatabase, dataManager });
    this.sceneNpcs = sceneNpcs || new SceneNpcMountManager({ appDatabase, dataManager });
    this.timeManager = timeManager || new TimeTurnManager({
      appDatabase,
      chatProvider,
      trace: trace === false ? false : trace?.time
    });
    this.chatCompression = chatCompression || new ChatCompressionMemory({
      appDatabase,
      trace: trace === false ? false : trace?.chatCompression
    });
    this.runtimeRagService = runtimeRagService;
    this.permanentRagService = permanentRagService;
    this.structuredInterfaceStore = structuredInterfaceStore;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/scene-traces',
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
      add: SCENE_RECORD_FIELDS,
      reason: 'sceneManager:scene-records'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    const scene = this.ensureCollection(chatSessionId);
    return {
      scene,
      dependencies: {
        maps: this.sceneMaps.describe(chatSessionId),
        npcs: this.sceneNpcs.describe(chatSessionId),
        time: this.timeManager.describe(chatSessionId),
        compression: this.chatCompression.describe(chatSessionId)
      }
    };
  }

  upsertScene(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const existing = input.id || input.sceneId
      ? this.getScene({ chatSessionId, id: input.id, sceneId: input.sceneId, missing: 'undefined' })
      : undefined;
    const record = normalizeSceneRecord(input, {
      chatSessionId,
      now: this.now,
      existing: existing?.data
    });
    return manager.upsertRecord(this.collection, record, { id: record.id });
  }

  patchScene(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.getScene({
      chatSessionId,
      id: input.id,
      sceneId: input.sceneId
    });
    const patch = normalizeObject(input.patch || input.update || {});
    return this.upsertScene({
      ...current.data,
      ...patch,
      id: current.id,
      chatSessionId
    });
  }

  getScene({ chatSessionId, id, sceneId, missing = 'throw' } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    if (id) return manager.getRecord(this.collection, id, { missing });

    const normalizedSceneId = normalizeSceneId(sceneId);
    const recordId = sceneRecordId(normalizedSceneId);
    const direct = manager.getRecord(this.collection, recordId, { missing: 'undefined' });
    if (direct) return direct;
    const listed = manager.queryRecords(this.collection, {
      filter: { sceneId: normalizedSceneId },
      limit: 2
    }).records;
    if (listed.length === 1) return listed[0];
    if (listed.length > 1) throw validationError(`Multiple scene records matched sceneId: ${normalizedSceneId}; use id`);
    if (missing === 'undefined') return undefined;
    throw notFound(`Scene record not found: ${normalizedSceneId}`);
  }

  listScenes({
    chatSessionId,
    status,
    query = '',
    filter = {},
    sort = [{ field: 'enteredAt', direction: 'desc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (status) mergedFilter.status = String(status);
    const result = manager.queryRecords(this.collection, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      if (!normalizedQuery) return true;
      const data = record.data || {};
      return normalizeSearchText([
        record.id,
        data.sceneId,
        data.title,
        data.summary,
        data.status,
        data.locationLabel
      ].filter(Boolean).join(' ')).includes(normalizedQuery);
    });
    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  async enterScene(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const sceneId = normalizeSceneId(input.sceneId || input.id || input.title || DEFAULT_SCENE_ID);
    const before = await this.sceneSnapshot({ chatSessionId, sceneId, includeRag: true });
    const trace = this.traceRecorder.start('scene-enter', {
      sessionId: chatSessionId,
      input,
      stateBefore: before
    });

    try {
      const timestamp = this.now();
      const endedPrevious = input.endPreviousActive
        ? await this.endPreviousActiveScene({ chatSessionId, sceneId, source: input.source || 'scene-manager' })
        : [];
      const requestedMaps = normalizeArray(input.maps || input.mapMounts || input.mapRefs);
      const requestedNpcs = normalizeArray(input.npcs || input.npcMounts || input.npcRefs);
      const scene = this.upsertScene({
        ...input,
        id: input.id || sceneRecordId(sceneId),
        sceneId,
        status: input.status || 'active',
        mapRefs: requestedMaps,
        npcRefs: requestedNpcs,
        enteredAt: input.enteredAt || timestamp,
        endedAt: '',
        sceneUpdatedAt: timestamp
      });

      const mountedMaps = [];
      for (let index = 0; index < requestedMaps.length; index += 1) {
        mountedMaps.push(this.sceneMaps.mountMap({
          ...normalizeMapMountInput(requestedMaps[index]),
          chatSessionId,
          sceneId,
          orderIndex: normalizeMapMountInput(requestedMaps[index]).orderIndex ?? index,
          mountReason: normalizeMapMountInput(requestedMaps[index]).mountReason || 'enter_scene',
          source: normalizeMapMountInput(requestedMaps[index]).source || input.source || 'scene-manager'
        }));
      }

      const mountedNpcs = [];
      for (let index = 0; index < requestedNpcs.length; index += 1) {
        mountedNpcs.push(this.sceneNpcs.mountNpc({
          ...normalizeNpcMountInput(requestedNpcs[index]),
          chatSessionId,
          sceneId,
          orderIndex: normalizeNpcMountInput(requestedNpcs[index]).orderIndex ?? index,
          mountReason: normalizeNpcMountInput(requestedNpcs[index]).mountReason || 'enter_scene',
          source: normalizeNpcMountInput(requestedNpcs[index]).source || input.source || 'scene-manager'
        }));
      }

      const ragContext = await this.loadRagContext({
        chatSessionId,
        sceneId,
        scene: scene.data,
        rag: input.rag || {},
        defaultQuery: input.ragQuery || input.summary || input.title
      });
      const time = this.initializeTime({
        chatSessionId,
        sceneId,
        time: input.time || {},
        source: input.source || 'scene-manager'
      });
      const structuredInterface = this.injectStructuredInterface({
        chatSessionId,
        sceneId,
        scene: scene.data,
        mountedMaps,
        mountedNpcs,
        ragContext,
        input
      });
      const updatedScene = this.patchScene({
        chatSessionId,
        sceneId,
        patch: {
          mapRefs: mountedMaps.map(compactRecord),
          npcRefs: mountedNpcs.map(compactRecord),
          ragQueries: ragContext.queries,
          ragContext,
          timeConfig: time,
          structuredInterface,
          sceneUpdatedAt: this.now()
        }
      });
      const after = await this.sceneSnapshot({ chatSessionId, sceneId, includeRag: true });
      const output = {
        scene: updatedScene,
        endedPrevious,
        mountedMaps,
        mountedNpcs,
        ragContext,
        time,
        structuredInterface
      };
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output,
          stateAfter: after,
          prompt: this.buildScenePromptContext({ chatSessionId, sceneId }).prompt
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async endScene(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = input.id || input.sceneId
      ? this.getScene({
        chatSessionId,
        id: input.id,
        sceneId: input.sceneId
      })
      : this.getActiveScene({ chatSessionId });
    const sceneId = current.data.sceneId || normalizeSceneId(input.sceneId);
    const before = await this.sceneSnapshot({ chatSessionId, sceneId, includeRag: true });
    const trace = this.traceRecorder.start('scene-end', {
      sessionId: chatSessionId,
      input,
      stateBefore: before
    });

    try {
      const timestamp = this.now();
      const memory = input.compressMemory === false
        ? undefined
        : this.compressSceneMemory({
          chatSessionId,
          scene: current,
          summary: input.summary,
          facts: input.facts,
          openThreads: input.openThreads,
          npcNotes: input.npcNotes,
          sceneNotes: input.sceneNotes,
          sourceMessageIds: input.sourceMessageIds,
          fromMessageId: input.fromMessageId,
          toMessageId: input.toMessageId,
          fromOrderIndex: input.fromOrderIndex,
          toOrderIndex: input.toOrderIndex
        });
      const unmountedNpcs = input.unmountNpcs === false
        ? undefined
        : this.sceneNpcs.clearSceneNpcs({
          chatSessionId,
          sceneId,
          mode: input.npcUnmountMode || 'markDeparted',
          includeInactive: true,
          source: input.source || 'scene-manager.end_scene'
        });
      const unmountedMaps = input.unmountMaps === false
        ? undefined
        : this.sceneMaps.clearSceneMaps({
          chatSessionId,
          sceneId,
          mode: input.mapUnmountMode || 'markInactive',
          includeInactive: true,
          source: input.source || 'scene-manager.end_scene'
        });
      const structuredInterface = this.clearStructuredInterface({
        chatSessionId,
        sceneId,
        input
      });
      const scene = this.patchScene({
        chatSessionId,
        id: current.id,
        patch: {
          status: input.status || 'ended',
          endedAt: input.endedAt || timestamp,
          memorySummaryId: memory?.record?.id || current.data.memorySummaryId || '',
          structuredInterface: {
            ...(current.data.structuredInterface || {}),
            end: structuredInterface
          },
          sceneUpdatedAt: timestamp
        }
      });
      const after = await this.sceneSnapshot({ chatSessionId, sceneId, includeRag: true });
      const output = {
        scene,
        memory,
        unmountedNpcs,
        unmountedMaps,
        structuredInterface
      };
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output,
          stateAfter: after,
          prompt: this.buildScenePromptContext({ chatSessionId, sceneId }).prompt
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async sceneSnapshot({ chatSessionId, sceneId = DEFAULT_SCENE_ID, includeRag = false } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const normalizedSceneId = normalizeSceneId(sceneId);
    const scene = this.getScene({
      chatSessionId: normalizedChatSessionId,
      sceneId: normalizedSceneId,
      missing: 'undefined'
    });
    return {
      chatSessionId: normalizedChatSessionId,
      sceneId: normalizedSceneId,
      scene,
      maps: this.sceneMaps.listMountedMaps({
        chatSessionId: normalizedChatSessionId,
        sceneId: normalizedSceneId,
        includeInactive: true,
        limit: 500
      }).records,
      npcs: this.sceneNpcs.listMountedNpcs({
        chatSessionId: normalizedChatSessionId,
        sceneId: normalizedSceneId,
        includeInactive: true,
        limit: 500
      }).records,
      time: this.timeManager.timelineSnapshot({
        chatSessionId: normalizedChatSessionId,
        includeResolved: false
      }),
      ragContext: includeRag ? scene?.data?.ragContext : undefined
    };
  }

  buildScenePromptContext({ chatSessionId, sceneId = DEFAULT_SCENE_ID, includeInactive = false } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const normalizedSceneId = normalizeSceneId(sceneId);
    const scene = this.getScene({
      chatSessionId: normalizedChatSessionId,
      sceneId: normalizedSceneId,
      missing: 'undefined'
    });
    const maps = this.sceneMaps.listMountedMaps({
      chatSessionId: normalizedChatSessionId,
      sceneId: normalizedSceneId,
      includeInactive,
      limit: 500
    }).records;
    const npcs = this.sceneNpcs.listMountedNpcs({
      chatSessionId: normalizedChatSessionId,
      sceneId: normalizedSceneId,
      includeInactive,
      limit: 500
    }).records;
    const time = this.timeManager.timelineSnapshot({
      chatSessionId: normalizedChatSessionId,
      includeResolved: false
    });
    const context = {
      chatSessionId: normalizedChatSessionId,
      sceneId: normalizedSceneId,
      scene,
      maps,
      npcs,
      ragContext: scene?.data?.ragContext,
      time
    };
    return {
      context,
      prompt: renderScenePromptContext(context)
    };
  }

  getActiveScene({ chatSessionId } = {}) {
    const active = this.listScenes({
      chatSessionId,
      status: 'active',
      limit: 2
    }).records;
    if (active.length === 1) return active[0];
    if (active.length > 1) throw validationError('Multiple active scenes found; pass sceneId or id');
    return this.getScene({
      chatSessionId,
      sceneId: DEFAULT_SCENE_ID
    });
  }

  importDocument(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        scenes: this.collection,
        sceneRecords: this.collection,
        scene_records: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectSceneRecords(groups, input.collection || this.collection);
    const records = selected.map((record) => this.upsertScene({
      ...record,
      chatSessionId,
      sceneId: record.sceneId || record.id || input.sceneId || DEFAULT_SCENE_ID,
      source: input.source || record.source || 'document-import'
    }));
    return {
      format: parsed.format,
      chatSessionId,
      collection: this.collection,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    chatSessionId,
    format = 'json',
    status,
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listScenes({
      chatSessionId,
      status,
      query,
      limit,
      offset
    });
    const payload = {
      chatSessionId: listed.chatSessionId,
      scenes: listed.records.map((record) => ({
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

  async endPreviousActiveScene({ chatSessionId, sceneId, source } = {}) {
    const active = this.listScenes({
      chatSessionId,
      status: 'active',
      limit: 50
    }).records.filter((record) => record.data.sceneId !== sceneId);
    const ended = [];
    for (const record of active) {
      ended.push(await this.endScene({
        chatSessionId,
        sceneId: record.data.sceneId,
        summary: record.data.summary,
        source,
        unmountMaps: true,
        unmountNpcs: true,
        compressMemory: false
      }));
    }
    return ended;
  }

  async loadRagContext({ scene, rag = {}, defaultQuery } = {}) {
    const normalizedRag = normalizeObject(rag);
    const queries = normalizeStringArray(normalizedRag.queries || normalizedRag.query || defaultQuery)
      .filter(Boolean);
    if (queries.length === 0) {
      return {
        queries: [],
        runtime: [],
        permanent: [],
        skipped: true,
        reason: 'no_queries'
      };
    }

    const runtimeCollections = normalizeStringArray(
      normalizedRag.runtimeCollections
      || normalizedRag.collections
      || normalizedRag.collection
      || this.runtimeRagService?.defaultCollection
    ).filter(Boolean);
    const permanentCollections = normalizeStringArray(
      normalizedRag.permanentCollections
      || (normalizedRag.includePermanent ? normalizedRag.collections : undefined)
      || this.permanentRagService?.defaultCollection
    ).filter(Boolean);
    const limit = normalizePositiveInteger(normalizedRag.limit ?? DEFAULT_RAG_LIMIT, 'limit');
    const minScore = normalizeNumber(normalizedRag.minScore ?? DEFAULT_RAG_MIN_SCORE, 'minScore');
    const filter = normalizeObject(normalizedRag.filter);
    const runtime = [];
    const permanent = [];

    if (this.runtimeRagService && normalizedRag.runtime !== false) {
      for (const query of queries) {
        for (const collection of runtimeCollections) {
          const hits = await this.runtimeRagService.retrieve({
            collection,
            query,
            limit,
            minScore,
            filter
          });
          runtime.push({
            query,
            collection,
            hits: hits.map(compactRagHit)
          });
        }
      }
    }

    if (this.permanentRagService && normalizedRag.permanent !== false) {
      for (const query of queries) {
        for (const collection of permanentCollections) {
          const hits = await this.permanentRagService.retrieve({
            collection,
            query,
            limit,
            minScore,
            filter
          });
          permanent.push({
            query,
            collection,
            hits: hits.map(compactRagHit)
          });
        }
      }
    }

    return {
      sceneId: scene?.sceneId,
      queries,
      runtime,
      permanent,
      limit,
      minScore,
      filter
    };
  }

  initializeTime({ chatSessionId, sceneId, time = {}, source = 'scene-manager' } = {}) {
    const config = normalizeObject(time);
    const result = {
      initialized: false,
      clock: undefined,
      advanced: undefined,
      encounter: undefined,
      events: []
    };

    if (config.initializeClock !== false) {
      result.clock = this.timeManager.getClock({
        chatSessionId,
        sceneId,
        source
      });
      result.initialized = true;
    }

    if (config.advance) {
      result.advanced = this.timeManager.advanceTime({
        ...normalizeObject(config.advance),
        chatSessionId,
        sceneId,
        source
      });
    }

    if (config.encounter) {
      result.encounter = this.timeManager.startEncounter({
        ...normalizeObject(config.encounter),
        chatSessionId,
        sceneId,
        source
      });
    }

    for (const event of normalizeArray(config.events)) {
      result.events.push(this.timeManager.scheduleEvent({
        ...normalizeObject(event),
        chatSessionId,
        sceneId,
        source: event.source || source
      }));
    }

    return result;
  }

  injectStructuredInterface({ chatSessionId, sceneId, scene, mountedMaps, mountedNpcs, ragContext, input } = {}) {
    const config = normalizeObject(input.structuredInterface || input.ui);
    const sessionId = normalizeOptionalText(
      config.sessionId
      || input.runtimeSessionId
      || input.structuredSessionId
    );
    const update = config.update || config.state || (sessionId ? buildSceneStructuredUpdate({
      scene,
      mountedMaps,
      mountedNpcs,
      ragContext
    }) : undefined);

    if (!sessionId || !this.structuredInterfaceStore || !update) {
      return {
        applied: false,
        reason: !sessionId ? 'missing_runtime_session_id' : (!this.structuredInterfaceStore ? 'missing_structured_store' : 'missing_update'),
        update
      };
    }

    const mode = config.mode || 'scene-enter';
    const saved = config.rewrite
      ? this.structuredInterfaceStore.save(sessionId, update, {
        source: config.source || 'scene-manager.enter_scene',
        mode: 'rewrite',
        update
      })
      : this.structuredInterfaceStore.update(sessionId, update, {
        source: config.source || 'scene-manager.enter_scene',
        mode
      });
    return {
      applied: true,
      sessionId,
      mode,
      filePath: saved.filePath,
      updatedAt: saved.updatedAt,
      update
    };
  }

  clearStructuredInterface({ input } = {}) {
    const config = normalizeObject(input.structuredInterface || input.ui);
    const sessionId = normalizeOptionalText(
      config.sessionId
      || input.runtimeSessionId
      || input.structuredSessionId
    );
    const update = config.endUpdate || config.clearUpdate;
    if (!sessionId || !this.structuredInterfaceStore || !update) {
      return {
        applied: false,
        reason: !sessionId ? 'missing_runtime_session_id' : (!this.structuredInterfaceStore ? 'missing_structured_store' : 'missing_end_update'),
        update
      };
    }
    const saved = this.structuredInterfaceStore.update(sessionId, update, {
      source: config.source || 'scene-manager.end_scene',
      mode: config.endMode || 'scene-end'
    });
    return {
      applied: true,
      sessionId,
      filePath: saved.filePath,
      updatedAt: saved.updatedAt,
      update
    };
  }

  compressSceneMemory({
    chatSessionId,
    scene,
    summary,
    facts,
    openThreads,
    npcNotes,
    sceneNotes,
    sourceMessageIds,
    fromMessageId,
    toMessageId,
    fromOrderIndex,
    toOrderIndex
  } = {}) {
    const data = scene?.data || {};
    const summaryText = normalizeOptionalText(summary || data.summary);
    if (!summaryText && normalizeArray(facts).length === 0 && normalizeArray(sceneNotes).length === 0) {
      return {
        skipped: true,
        reason: 'missing_summary_or_notes'
      };
    }
    return this.chatCompression.upsertSummary({
      id: data.memorySummaryId || `scene_summary_${safeIdSegment(data.sceneId || scene?.id || DEFAULT_SCENE_ID)}`,
      chatSessionId,
      type: 'scene_summary',
      title: data.title || data.sceneId || scene?.id || 'Scene summary',
      summary: summaryText,
      facts: normalizeArray(facts),
      openThreads: normalizeArray(openThreads),
      npcNotes: normalizeArray(npcNotes),
      sceneNotes: normalizeArray(sceneNotes).length > 0
        ? normalizeArray(sceneNotes)
        : [{
          sceneId: data.sceneId,
          title: data.title,
          locationLabel: data.locationLabel,
          endedAt: this.now()
        }],
      sourceMessageIds: normalizeArray(sourceMessageIds),
      fromMessageId,
      toMessageId,
      fromOrderIndex,
      toOrderIndex,
      importance: 0.7,
      status: 'active',
      source: 'scene-manager',
      metadata: {
        sceneId: data.sceneId,
        sceneRecordId: scene?.id
      }
    }, { source: 'scene-manager.end_scene' });
  }

  openManager(chatSessionId) {
    this.ensureCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

export function normalizeSceneRecord(input = {}, {
  chatSessionId,
  now = () => new Date().toISOString(),
  existing
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('scene record must be a plain object');
  }
  const resolvedChatSessionId = normalizeRequiredText(chatSessionId || input.chatSessionId, 'chatSessionId');
  const sceneId = normalizeSceneId(input.sceneId || input.id || input.title || existing?.sceneId);
  const timestamp = now();
  const id = normalizeOptionalText(input.id || existing?.id) || sceneRecordId(sceneId);
  return {
    id,
    chatSessionId: resolvedChatSessionId,
    sceneId,
    title: normalizeOptionalText(input.title ?? existing?.title) || sceneId,
    summary: normalizeOptionalText(input.summary ?? input.description ?? existing?.summary),
    status: normalizeOptionalText(input.status ?? existing?.status) || 'draft',
    locationLabel: normalizeOptionalText(input.locationLabel ?? input.location ?? existing?.locationLabel),
    mapRefs: normalizeArray(input.mapRefs ?? input.maps ?? existing?.mapRefs),
    npcRefs: normalizeArray(input.npcRefs ?? input.npcs ?? existing?.npcRefs),
    ragQueries: normalizeArray(input.ragQueries ?? existing?.ragQueries),
    ragContext: normalizeObject(input.ragContext ?? existing?.ragContext),
    timeConfig: normalizeObject(input.timeConfig ?? input.time ?? existing?.timeConfig),
    structuredInterface: normalizeObject(input.structuredInterface ?? existing?.structuredInterface),
    memorySummaryId: normalizeOptionalText(input.memorySummaryId ?? existing?.memorySummaryId),
    metadata: normalizeObject(input.metadata ?? existing?.metadata),
    enteredAt: normalizeOptionalText(input.enteredAt ?? existing?.enteredAt) || timestamp,
    endedAt: normalizeOptionalText(input.endedAt ?? existing?.endedAt),
    sceneUpdatedAt: timestamp
  };
}

function renderScenePromptContext(context = {}) {
  const scene = context.scene?.data || {};
  const maps = context.maps || [];
  const npcs = context.npcs || [];
  const runtimeHits = flattenRagGroups(context.ragContext?.runtime);
  const permanentHits = flattenRagGroups(context.ragContext?.permanent);
  const lines = [
    '[Scene Context]',
    `sceneId: ${context.sceneId}`,
    scene.title ? `title: ${scene.title}` : '',
    scene.summary ? `summary: ${scene.summary}` : '',
    scene.locationLabel ? `location: ${scene.locationLabel}` : '',
    maps.length > 0 ? 'maps:' : '',
    ...maps.map((record) => {
      const data = record.data || {};
      return `- ${data.name || data.mapId || record.id}: ${data.summary || data.locationLabel || data.status || ''}`.trim();
    }),
    npcs.length > 0 ? 'npcs:' : '',
    ...npcs.map((record) => {
      const data = record.data || {};
      return `- ${data.name || data.npcId || record.id}: ${data.summary || data.role || data.status || ''}`.trim();
    }),
    runtimeHits.length > 0 ? 'runtime_rag:' : '',
    ...runtimeHits.map((hit) => `- ${hit.collection}/${hit.id}: ${hit.text || ''}`.trim()),
    permanentHits.length > 0 ? 'permanent_rag:' : '',
    ...permanentHits.map((hit) => `- ${hit.collection}/${hit.id}: ${hit.text || ''}`.trim()),
    context.time?.clock ? `time: ${context.time.clock.phase || ''} elapsed=${context.time.clock.elapsedSeconds || 0}s round=${context.time.clock.roundNumber || 0}` : ''
  ];
  return `${lines.filter(Boolean).join('\n')}\n`;
}

function buildSceneStructuredUpdate({ scene, mountedMaps, mountedNpcs } = {}) {
  return {
    sceneMap: {
      title: scene?.title || scene?.sceneId || '',
      summary: scene?.summary || '',
      currentAreaId: mountedMaps?.[0]?.data?.mapId || '',
      areas: (mountedMaps || []).map((record) => ({
        id: record.data.mapId || record.id,
        name: record.data.name || record.data.mapId || record.id,
        type: record.data.type || '',
        status: record.data.status || '',
        visibility: record.data.visibility || '',
        summary: record.data.summary || ''
      }))
    },
    npcSummary: {
      npcs: (mountedNpcs || []).map((record) => ({
        id: record.data.npcId || record.id,
        name: record.data.name || record.data.npcId || record.id,
        role: record.data.role || '',
        status: record.data.status || '',
        visibility: record.data.visibility || '',
        disposition: record.data.disposition || '',
        summary: record.data.summary || ''
      }))
    }
  };
}

function normalizeMapMountInput(value) {
  if (typeof value === 'string') return { mapId: value };
  return normalizeObject(value);
}

function normalizeNpcMountInput(value) {
  if (typeof value === 'string') return { npcId: value };
  return normalizeObject(value);
}

function compactRecord(record) {
  return {
    id: record.id,
    ...record.data
  };
}

function compactRagHit(hit) {
  const compact = hit.compact && typeof hit.compact === 'object' ? hit.compact : undefined;
  return {
    id: hit.id,
    score: hit.score,
    text: String(compact?.claim || compact?.text || hit.text || '').slice(0, 800),
    metadata: compact?.metadata || hit.metadata || {},
    sourceRef: compact?.sourceRef || hit.sourceRef,
    scores: hit.scores
  };
}

function flattenRagGroups(groups = []) {
  return normalizeArray(groups).flatMap((group) => (
    normalizeArray(group.hits).map((hit) => ({
      ...hit,
      collection: group.collection,
      query: group.query
    }))
  ));
}

function selectSceneRecords(groups, collection) {
  const preferred = String(collection || SCENE_RECORDS_COLLECTION);
  const selected = groups.find((group) => group.collection === preferred)
    || groups.find((group) => ['scenes', 'sceneRecords', 'scene_records'].includes(group.collection))
    || groups[0];
  return selected?.records || [];
}

function sceneRecordId(sceneId) {
  return `scene_${safeIdSegment(sceneId || DEFAULT_SCENE_ID)}`;
}

function normalizeSceneId(value) {
  const text = normalizeOptionalText(value) || DEFAULT_SCENE_ID;
  return text;
}

function safeIdSegment(value) {
  return String(value || 'id')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
    || 'id';
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeRequiredText(value, name) {
  const text = normalizeOptionalText(value);
  if (!text) throw validationError(`${name} is required`);
  return text;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw validationError(`${name} must be a positive integer`);
  return number;
}

function normalizeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`${name} must be a finite number`);
  return number;
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'SceneManagerValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'SceneManagerNotFoundError';
  error.statusCode = 404;
  return error;
}
