// @ts-nocheck
import { createMessage, serializeDialogue } from '../core/messages.js';
import { normalizeCharacterCard } from '../characters/character-card.js';
import { selectWorldInfoEntries } from '../characters/world-info.js';
import { serializeAuditError } from '../audit/audit-log.js';
import { createToolStateSnapshotProvider, restoreToolStateSnapshot } from '../audit/state-snapshot.js';
import { MockChatProvider } from '../llm/mock-provider.js';
import { buildPrompt } from '../prompts/prompt-builder.js';
import { createPromptPreset } from '../prompts/preset.js';
import { RagService } from '../rag/rag-service.js';
import { OpenAICompatibleProvider } from '../llm/openai-compatible-provider.js';
import { OllamaProvider } from '../llm/ollama-provider.js';
import { ContextualChatProvider } from '../llm/contextual-chat-provider.js';
import {
  cloneScopedDataRecords,
  cloneScopedRagDocuments,
  deleteScopedDataRecords,
  deleteScopedRagDocuments,
  lifecycleFromData
} from '../lifecycle/resource-lifecycle.js';
import {
  StructuredInterfaceStateStore,
  buildStructuredInterfacePrompt
} from '../structured/structured-interface.js';
import { createDefaultToolPluginManager } from '../tools/core-utility-plugin.js';
import { AUDIT_PLUGIN, createAuditHandlers } from '../tools/audit-plugin.js';
import { SCENE_MANAGER_PLUGIN, createSceneManagerHandlers } from '../tools/scene-manager-plugin.js';
import { WORLDLINE_PLUGIN, createWorldlineHandlers } from '../tools/worldline-plugin.js';
import { normalizeExternalTool } from '../tools/tool-plugin-manager.js';
import { createId } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';
import { SceneManager } from '../scenes/scene-manager.js';
import { WorldlineManager } from '../worldlines/worldline-manager.js';
import { AgentProgressEventBus, agentRouterReviewStore } from './agent-progress-events.js';
import { InMemorySessionStore } from './session-store.js';

export class AgentChatRuntime {
  constructor({
    chatProvider = new MockChatProvider(),
    ragService = new RagService(),
    promptPreset,
    sessionStore = new InMemorySessionStore(),
    toolPluginManager,
    dataManager,
    appDatabase,
    permanentRagService,
    toolTrace,
    auditLog,
    auditSnapshot,
    worldlineManager,
    worldline,
    sceneManager,
    scene,
    structuredInterfaceStore,
    structuredInterface,
    progressEventBus
  } = {}) {
    this.chatProvider = chatProvider;
    this.ragService = ragService;
    this.promptPreset = createPromptPreset(promptPreset);
    this.sessionStore = sessionStore;
    this.dataManager = dataManager;
    this.appDatabase = appDatabase;
    this.auditLog = auditLog;
    this.auditSnapshot = auditSnapshot || createToolStateSnapshotProvider({ appDatabase, dataManager });
    this.progressEventBus = progressEventBus || new AgentProgressEventBus();
    this.permanentRagService = permanentRagService;
    this.toolChatProvider = new ContextualChatProvider({
      defaultProvider: chatProvider,
      resolveProvider: (options) => this.resolveChatProvider(options)
    });
    const publishToolResultEvents = (event) => {
      this.publishSettlementChangeFromToolResult(event);
      this.publishDiceRollFromToolResult(event);
      this.publishAdjudicationFromToolResult(event);
    };
    this.toolPluginManager = toolPluginManager || createDefaultToolPluginManager({
      dataManager,
      appDatabase,
      ragService,
      permanentRagService,
      chatProvider: this.toolChatProvider,
      trace: toolTrace,
      auditLog,
      auditSnapshot: this.auditSnapshot,
      progress: (event) => this.publishAgentProgress(event),
      onToolResult: publishToolResultEvents
    });
    this.toolPluginManager.setToolResultHandler?.(publishToolResultEvents);
    this.structuredInterfaceStore = structuredInterfaceStore || new StructuredInterfaceStateStore(structuredInterface?.store || {});
    this.structuredInterfaceDefaults = structuredInterface || {};
    this.sceneManager = sceneManager || (appDatabase ? new SceneManager({
      ...(scene && typeof scene === 'object' ? scene : {}),
      appDatabase,
      dataManager,
      runtimeRagService: ragService,
      permanentRagService,
      structuredInterfaceStore: this.structuredInterfaceStore,
      chatProvider: this.toolChatProvider,
      trace: scene === false ? false : scene?.trace
    }) : undefined);
    this.worldlineManager = worldlineManager || new WorldlineManager({
      ...(worldline && typeof worldline === 'object' ? worldline : {}),
      sessionStore,
      structuredInterfaceStore: this.structuredInterfaceStore,
      appDatabase,
      dataManager,
      runtimeRagService: ragService,
      permanentRagService,
      auditLog,
      trace: worldline === false ? false : worldline?.trace
    });
    this.registerAuditPlugin();
    this.registerSceneManagerPlugin();
    this.registerWorldlinePlugin();
  }

  resolveChatProvider(options = {}) {
    return resolveRequestChatProvider(this.chatProvider, options);
  }

  async testApiSettings(settings = {}) {
    return testRequestApiSettings(settings);
  }

  publishAgentProgress(event = {}) {
    return this.progressEventBus?.publish(event);
  }

  subscribeAgentProgress(filter = {}, listener) {
    return this.progressEventBus.subscribe(filter, listener);
  }

  listAgentProgressEvents(filter = {}) {
    return this.progressEventBus.list(filter);
  }

  requestAgentRouterItemSkip(input = {}) {
    const record = agentRouterReviewStore.requestSkip(input);
    if (record) {
      this.publishAgentProgress({
        type: 'router_item_skip_requested',
        status: 'skipped',
        chatSessionId: record.chatSessionId,
        turnId: record.turnId,
        routerItemId: record.itemId,
        routerItem: {
          id: record.itemId,
          status: 'skipped',
          skipReason: record.reason
        },
        skip: record,
        progressLabel: '玩家已跳过一个计划项'
      });
    }
    return record;
  }

  async createSession({
    characterCard,
    userName = 'User',
    playerPersona = '',
    collection = this.promptPreset.rag.collection,
    includeGreeting = true,
    structuredInterface
  }) {
    const card = normalizeCharacterCard(characterCard);
    const messages = [];

    if (includeGreeting && card.data.first_mes) {
      messages.push(createMessage({
        role: 'assistant',
        name: card.data.name || 'Character',
        content: card.data.first_mes
      }));
    }

    let session = await this.sessionStore.create({
      userName,
      playerPersona,
      collection,
      characterCard: card,
      messages,
      metadata: {}
    });

    const structuredConfig = normalizeStructuredSessionConfig(structuredInterface, this.structuredInterfaceDefaults);
    if (structuredConfig.enabled) {
      const saved = this.structuredInterfaceStore.save(
        session.id,
        structuredConfig.initialState || {},
        { source: 'session.create', mode: 'generate' }
      );
      session = await this.sessionStore.update(session.id, {
        ...session,
        metadata: {
          ...session.metadata,
          structuredInterface: {
            enabled: true,
            filePath: saved.filePath,
            mode: structuredConfig.mode,
            extraInstructions: structuredConfig.extraInstructions
          }
        }
      });
    }

    return session;
  }

  async getSession(sessionId) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  async listSessions() {
    return this.sessionStore.list();
  }

  async sendMessage(sessionId, content, options = {}) {
    const session = await this.getSession(sessionId);
    const auditBefore = this.auditLog
      ? { session: snapshotRuntimeSession(session) }
      : undefined;
    const userMessage = createMessage({
      role: 'user',
      name: session.userName,
      content
    });
    const messages = [...session.messages, userMessage];
    const preset = createPromptPreset({
      ...this.promptPreset,
      ...(options.promptPreset || {})
    });
    const structuredConfig = resolveStructuredInterfaceConfig(session, options.structuredInterface, this.structuredInterfaceDefaults);
    const structuredState = structuredConfig.enabled
      ? this.structuredInterfaceStore.load(sessionId)
      : undefined;
    if (auditBefore && structuredState) {
      auditBefore.structuredInterface = structuredState;
    }
    const structuredInterfacePrompt = structuredConfig.enabled
      ? buildStructuredInterfacePrompt({
        state: structuredState.state,
        mode: structuredConfig.mode,
        extraInstructions: structuredConfig.extraInstructions,
        includeCurrentState: structuredConfig.includeCurrentState
      })
      : '';

    const worldInfoEntries = selectWorldInfoEntries(
      session.characterCard.data.character_book,
      messages,
      preset.worldInfo
    );

    const agentAccessPolicy = normalizeRuntimeAgentAccessPolicy(options.agentAccessPolicy || options.agentAccess?.policy);
    const retrievalQuery = buildRetrievalQuery(messages);
    const ragContext = agentAccessAllows(agentAccessPolicy, 'rag', 'read') && agentAccessAllows(agentAccessPolicy, 'runtimeRag', 'read')
      ? await this.ragService.retrieve({
        collection: options.collection || session.collection,
        query: retrievalQuery,
        limit: options.ragLimit ?? preset.rag.limit,
        minScore: options.minScore ?? preset.rag.minScore,
        filter: options.ragFilter
      })
      : [];

    const prompt = buildPrompt({
      characterCard: session.characterCard,
      messages,
      userName: session.userName,
      playerPersona: session.playerPersona,
      promptPreset: preset,
      worldInfoEntries,
      ragContext,
      structuredInterfacePrompt
    });
    const structuredPromptTrace = structuredConfig.enabled
      ? this.structuredInterfaceStore.tracePrompt(sessionId, {
        prompt: structuredInterfacePrompt,
        state: structuredState,
        source: 'runtime.sendMessage',
        options: {
          mode: structuredConfig.mode,
          includeCurrentState: structuredConfig.includeCurrentState
        }
      })
      : undefined;

    const chatProvider = this.resolveChatProvider(options);
    const completion = await chatProvider.generate({
      messages: prompt.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      extra: options.extra
    });

    const structuredOutput = structuredConfig.enabled
      ? this.structuredInterfaceStore.applyModelOutput(sessionId, completion.content, {
        defaultMode: structuredConfig.mode,
        source: 'assistant'
      })
      : undefined;
    const assistantContent = structuredOutput ? structuredOutput.content : completion.content;

    const assistantMessage = createMessage({
      role: 'assistant',
      name: session.characterCard.data.name || 'Character',
      content: assistantContent,
      metadata: {
        promptItemization: prompt.itemization,
        ragContext: ragContext.map((hit) => ({
          id: hit.id,
          score: hit.score,
          metadata: hit.metadata
        })),
        worldInfoEntries: worldInfoEntries.map((entry) => ({
          uid: entry.uid,
          comment: entry.comment,
          key: entry.key
        })),
        provider: completion.raw?.provider,
        structuredInterface: structuredOutput
          ? {
            updated: structuredOutput.updated,
            updates: structuredOutput.updates,
            filePath: structuredOutput.filePath,
            trace: structuredOutput.trace,
            promptTrace: structuredPromptTrace
          }
          : undefined
      }
    });

    const metadata = { ...session.metadata };
    if (structuredConfig.enabled) {
      metadata.structuredInterface = {
        ...(metadata.structuredInterface || {}),
        enabled: true,
        filePath: structuredOutput?.filePath || structuredState?.filePath,
        mode: structuredConfig.mode,
        extraInstructions: structuredConfig.extraInstructions
      };
    }

    const updated = await this.sessionStore.update(sessionId, {
      ...session,
      metadata,
      messages: [...messages, assistantMessage]
    });

    if (this.auditLog) {
      this.auditLog.recordEvent({
        scopeType: 'runtime-session',
        scopeId: sessionId,
        operation: 'runtime.send_message',
        actor: {
          type: 'user',
          id: session.userName
        },
        status: 'success',
        reversible: true,
        replayable: true,
        input: {
          sessionId,
          content,
          options: redactRuntimeOptions(options)
        },
        output: {
          userMessage,
          assistantMessage,
          prompt,
          completion,
          ragContext,
          worldInfoEntries,
          structuredInterface: structuredOutput
            ? {
              ...structuredOutput,
              promptTrace: structuredPromptTrace
            }
            : undefined
        },
        before: auditBefore,
        after: {
          session: snapshotRuntimeSession(updated),
          structuredInterface: structuredOutput
        },
        metadata: {
          ...this.getWorldlineMetadata('runtime-session', sessionId),
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          ragHits: ragContext.length,
          worldInfoEntries: worldInfoEntries.length
        }
      });
    }

    return {
      session: updated,
      userMessage,
      assistantMessage,
      prompt,
      completion,
      structuredInterface: structuredOutput
        ? {
          ...structuredOutput,
          promptTrace: structuredPromptTrace
        }
        : undefined
    };
  }

  async getStructuredInterfaceState(sessionId) {
    await this.getSession(sessionId);
    return this.structuredInterfaceStore.load(sessionId);
  }

  async updateStructuredInterfaceState(sessionId, update, { mode = 'manual', source = 'manual' } = {}) {
    const session = await this.getSession(sessionId);
    const saved = this.structuredInterfaceStore.update(sessionId, update, { mode, source });
    await this.markStructuredInterfaceEnabled(session, saved);
    return saved;
  }

  async rewriteStructuredInterfaceState(sessionId, state, { source = 'manual' } = {}) {
    const session = await this.getSession(sessionId);
    const saved = this.structuredInterfaceStore.save(sessionId, state || {}, {
      source,
      mode: 'rewrite',
      update: state
    });
    await this.markStructuredInterfaceEnabled(session, saved);
    return saved;
  }

  async applyStructuredInterfaceOutput(sessionId, content, options = {}) {
    const session = await this.getSession(sessionId);
    const result = this.structuredInterfaceStore.applyModelOutput(sessionId, content, {
      defaultMode: options.defaultMode || 'patch',
      source: options.source || 'assistant'
    });
    await this.markStructuredInterfaceEnabled(session, result);
    return result;
  }

  async getStructuredInterfacePrompt(sessionId, options = {}) {
    const session = await this.getSession(sessionId);
    const config = resolveStructuredInterfaceConfig(session, options, this.structuredInterfaceDefaults);
    const current = this.structuredInterfaceStore.load(sessionId);
    const prompt = buildStructuredInterfacePrompt({
      state: current.state,
      mode: config.mode,
      extraInstructions: config.extraInstructions,
      includeCurrentState: config.includeCurrentState
    });
    return {
      prompt,
      state: current,
      trace: this.structuredInterfaceStore.tracePrompt(sessionId, {
        prompt,
        state: current,
        source: 'api.getStructuredInterfacePrompt',
        options: config
      })
    };
  }

  async markStructuredInterfaceEnabled(session, stateRecord) {
    await this.sessionStore.update(session.id, {
      ...session,
      metadata: {
        ...session.metadata,
        structuredInterface: {
          ...(session.metadata?.structuredInterface || {}),
          enabled: true,
          filePath: stateRecord.filePath,
          mode: session.metadata?.structuredInterface?.mode || 'patch',
          extraInstructions: session.metadata?.structuredInterface?.extraInstructions || ''
        }
      }
    });
  }

  async ingestMemory({ collection = this.promptPreset.rag.collection, sourceId, text, metadata }) {
    const input = { collection, sourceId, text, metadata };
    try {
      const documents = await this.ragService.ingestText(input);
      this.auditLog?.recordEvent({
        scopeType: 'rag-collection',
        scopeId: collection,
        operation: 'rag.ingest',
        actor: { type: 'agent' },
        status: 'success',
        reversible: true,
        replayable: true,
        input,
        output: { documents },
        after: {
          collection,
          sourceIds: [...new Set(documents.map((doc) => doc.metadata?.sourceId).filter(Boolean))]
        },
        metadata: {
          ...this.getWorldlineMetadata('rag-collection', collection),
          collection,
          sourceId: sourceId || documents[0]?.metadata?.sourceId,
          chunks: documents.length
        }
      });
      return documents;
    } catch (error) {
      this.auditLog?.recordEvent({
        scopeType: 'rag-collection',
        scopeId: collection,
        operation: 'rag.ingest',
        actor: { type: 'agent' },
        status: 'error',
        reversible: false,
        replayable: true,
        input,
        error: serializeAuditError(error)
      });
      throw error;
    }
  }

  async retrieveMemory({ collection = this.promptPreset.rag.collection, query, limit, minScore, filter }) {
    const input = {
      collection,
      query,
      limit: limit ?? this.promptPreset.rag.limit,
      minScore: minScore ?? this.promptPreset.rag.minScore,
      filter
    };
    try {
      const documents = await this.ragService.retrieve(input);
      this.auditLog?.recordEvent({
        scopeType: 'rag-collection',
        scopeId: collection,
        operation: 'rag.retrieve',
        actor: { type: 'agent' },
        status: 'success',
        reversible: false,
        replayable: true,
        input,
        output: { documents },
        metadata: {
          ...this.getWorldlineMetadata('rag-collection', collection),
          collection,
          hits: documents.length
        }
      });
      return documents;
    } catch (error) {
      this.auditLog?.recordEvent({
        scopeType: 'rag-collection',
        scopeId: collection,
        operation: 'rag.retrieve',
        actor: { type: 'agent' },
        status: 'error',
        reversible: false,
        replayable: true,
        input,
        error: serializeAuditError(error)
      });
      throw error;
    }
  }

  inspectWorldInfo({ worldBook, messages, options }) {
    return selectWorldInfoEntries(worldBook, messages, options);
  }

  createToolPlugin(plugin) {
    return this.toolPluginManager.createPlugin(plugin);
  }

  listToolPlugins(options) {
    return this.toolPluginManager.listPlugins(options);
  }

  getToolPlugin(pluginId) {
    return this.toolPluginManager.getPlugin(pluginId);
  }

  updateToolPlugin(pluginId, patch) {
    return this.toolPluginManager.updatePlugin(pluginId, patch);
  }

  deleteToolPlugin(pluginId) {
    return this.toolPluginManager.deletePlugin(pluginId);
  }

  createTool(pluginId, tool) {
    return this.toolPluginManager.createTool(pluginId, tool);
  }

  listTools(options) {
    if (options?.format && options.format !== 'internal') {
      return this.toolPluginManager.exportTools(options);
    }
    return this.toolPluginManager.listTools(options);
  }

  exportTools(options) {
    return this.toolPluginManager.exportTools(options);
  }

  normalizeTool(tool) {
    return normalizeExternalTool(tool);
  }

  getTool(toolIdOrPluginId, toolName) {
    return this.toolPluginManager.getTool(toolIdOrPluginId, toolName);
  }

  updateTool(pluginId, toolName, patch) {
    return this.toolPluginManager.updateTool(pluginId, toolName, patch);
  }

  deleteTool(pluginId, toolName) {
    return this.toolPluginManager.deleteTool(pluginId, toolName);
  }

  async executeTool(toolId, input, context = {}) {
    return this.toolPluginManager.executeTool(toolId, input, undefined, context);
  }

  publishSettlementChange(input = {}) {
    const notice = normalizeSettlementNotice(input);
    if (!notice?.chatSessionId) return undefined;
    return this.publishAgentProgress({
      type: 'settlement_changed',
      status: notice.status || 'success',
      chatSessionId: notice.chatSessionId,
      turnId: notice.turnId,
      toolId: notice.toolId,
      collection: notice.collection,
      recordId: notice.recordId,
      settlementNotice: {
        id: notice.id || createId('settlement_notice'),
        type: notice.type,
        title: notice.title,
        text: notice.text,
        detail: notice.detail,
        status: notice.status || 'success',
        toolId: notice.toolId,
        phaseId: notice.phaseId,
        collection: notice.collection,
        recordId: notice.recordId,
        mergeKey: notice.mergeKey,
        importance: notice.importance
      },
      progressLabel: notice.text
    });
  }

  publishSettlementChangeFromToolResult({ tool, result, input, context } = {}) {
    const chatSessionId = resolveSettlementChatSessionId({ input, context, output: result?.output });
    if (!chatSessionId || !isSettlementToolResult({ tool, toolId: result?.toolId })) return undefined;
    const notice = buildSettlementNoticeFromToolResult({
      tool,
      toolId: result.toolId,
      input,
      output: result.output,
      context
    });
    if (!notice) return undefined;
    return this.publishSettlementChange({
      chatSessionId,
      turnId: context?.turnId || input?.turnId || input?.sourceTurnId,
      toolId: result.toolId,
      phaseId: context?.phaseId || input?.phaseId,
      type: notice.type,
      title: notice.title,
      text: notice.text,
      detail: notice.detail,
      mergeKey: notice.mergeKey,
      importance: notice.importance
    });
  }

  publishDiceRoll(input = {}) {
    const notice = normalizeDiceRollNotice(input);
    if (!notice?.chatSessionId) return undefined;
    return this.publishAgentProgress({
      type: 'dice_roll_resolved',
      status: notice.status || 'success',
      chatSessionId: notice.chatSessionId,
      turnId: notice.turnId,
      toolId: notice.toolId,
      phaseId: notice.phaseId,
      diceRoll: {
        id: notice.id || createId('dice_roll'),
        title: notice.title,
        kind: notice.kind,
        path: notice.path,
        input: notice.input,
        result: notice.result,
        originalResult: notice.originalResult,
        inspiration: notice.inspiration,
        sourceToolId: notice.toolId
      },
      progressLabel: notice.title || '骰子结果已生成'
    });
  }

  publishDiceRollFromToolResult({ result, input, context } = {}) {
    const chatSessionId = resolveDiceChatSessionId({ input, context, output: result?.output });
    if (!chatSessionId) return undefined;
    const rolls = diceRollNoticesFromToolResult({
      toolId: result?.toolId,
      input,
      output: result?.output
    });
    if (!rolls.length) return undefined;
    return rolls.map((roll, index) => this.publishDiceRoll({
      ...roll,
      chatSessionId,
      turnId: normalizeOptionalString(
        context?.turnId
        || context?.agentLoop?.turnId
        || input?.turnId
        || input?.sourceTurnId
      ),
      phaseId: normalizeOptionalString(
        context?.phaseId
        || context?.agentLoop?.phaseId
        || input?.phaseId
      ),
      toolId: result?.toolId,
      id: roll.id || `${result?.toolId || 'dice'}:${Date.now()}:${index}`
    }));
  }

  publishAdjudication(input = {}) {
    const notice = normalizeAdjudicationNotice(input);
    if (!notice?.chatSessionId) return undefined;
    return this.publishAgentProgress({
      type: 'adjudication_resolved',
      status: notice.status || 'success',
      chatSessionId: notice.chatSessionId,
      turnId: notice.turnId,
      toolId: notice.toolId,
      phaseId: notice.phaseId,
      adjudication: {
        id: notice.id || createId('adjudication'),
        title: notice.title,
        toolId: notice.toolId,
        status: notice.status,
        final: notice.final,
        appealAvailable: notice.appealAvailable,
        prompt: notice.prompt,
        loopState: notice.loopState,
        choices: notice.choices,
        summary: notice.summary,
        resolution: notice.resolution,
        rejudgement: notice.rejudgement
      },
      progressLabel: notice.title || '裁决结果已生成'
    });
  }

  publishAdjudicationFromToolResult({ result, input, context } = {}) {
    if (!isActionAdjudicationTool(result?.toolId)) return undefined;
    const output = result?.output;
    if (!output || typeof output !== 'object') return undefined;
    const adjudicationOutput = normalizeToolOutputForAdjudication(result.toolId, output, input);
    if (!adjudicationOutput) return undefined;
    if (adjudicationOutput.final === true || adjudicationOutput.status === 'accepted') return undefined;
    const chatSessionId = resolveDiceChatSessionId({ input, context, output });
    if (!chatSessionId) return undefined;
    return this.publishAdjudication({
      id: `${result.toolId || 'adjudication'}:${Date.now()}`,
      chatSessionId,
      turnId: normalizeOptionalString(
        context?.turnId
        || context?.agentLoop?.turnId
        || input?.turnId
        || input?.sourceTurnId
      ),
      phaseId: normalizeOptionalString(
        context?.phaseId
        || context?.agentLoop?.phaseId
        || input?.phaseId
      ),
      toolId: result.toolId,
      output: adjudicationOutput,
      input
    });
  }

  registerAuditPlugin() {
    if (!this.auditLog) return;
    try {
      this.toolPluginManager.getPlugin(AUDIT_PLUGIN.id);
    } catch {
      this.toolPluginManager.createPlugin(AUDIT_PLUGIN, {
        handlers: createAuditHandlers({ runtime: this })
      });
    }
  }

  registerWorldlinePlugin() {
    if (!this.worldlineManager) return;
    try {
      this.toolPluginManager.getPlugin(WORLDLINE_PLUGIN.id);
    } catch {
      this.toolPluginManager.createPlugin(WORLDLINE_PLUGIN, {
        handlers: createWorldlineHandlers({ runtime: this })
      });
    }
  }

  registerSceneManagerPlugin() {
    if (!this.sceneManager) return;
    try {
      this.toolPluginManager.getPlugin(SCENE_MANAGER_PLUGIN.id);
    } catch {
      this.toolPluginManager.createPlugin(SCENE_MANAGER_PLUGIN, {
        handlers: createSceneManagerHandlers({ manager: this.sceneManager })
      });
    }
  }

  describeAudit() {
    return {
      enabled: Boolean(this.auditLog),
      eventDatabasePath: this.auditLog?.databasePath,
      traceDirectory: this.auditLog?.trace?.directory,
      operations: [
        'runtime.send_message',
        'runtime.messages.delete_after',
        'rag.ingest',
        'rag.retrieve',
        'tool.execute',
        'app.chat.message.add',
        'app.chat.message.delete',
        'app.chat.messages.delete_after',
        'audit.rollback',
        'audit.replay'
      ],
      rollbackSupport: {
        runtimeSendMessage: 'Restores the runtime message array and structured-interface state snapshot.',
        ragIngest: 'Deletes vector chunks by recorded sourceId.',
        toolExecute: 'Restores captured app-chat/global SQLite snapshots when available; RAG tools delete by sourceId.',
        appChatMessages: 'Restores or deletes persisted chat messages from audit snapshots.'
      }
    };
  }

  describeWorldlines() {
    return {
      enabled: Boolean(this.worldlineManager),
      eventDatabasePath: this.worldlineManager?.databasePath,
      traceDirectory: this.worldlineManager?.trace?.directory,
      snapshotCoverage: {
        runtimeSession: 'Runtime session messages, metadata, character card, and collection.',
        llmInputOutput: 'LLM prompt/completion is preserved through audit event references plus runtime message snapshots.',
        appChat: 'Persisted app chat messages and chat-local data database.',
        runtimeRag: 'Selected runtime RAG collections, including text, metadata, and stored vectors.',
        permanentRag: 'Optional selected permanent RAG collections; disabled by default.',
        structuredInterface: 'Runtime structured interface state file.'
      },
      tools: [
        'system.worldline.create_savepoint',
        'system.worldline.create_branch',
        'system.worldline.switch_branch',
        'system.worldline.restore_savepoint',
        'system.worldline.list_savepoints',
        'system.worldline.list_branches'
      ]
    };
  }

  createWorldlineSavepoint(input = {}) {
    return this.requireWorldlineManager().createSavepoint(input);
  }

  listWorldlineSavepoints(query = {}) {
    return this.requireWorldlineManager().listSavepoints(query);
  }

  getWorldlineSavepoint(id, options = {}) {
    return this.requireWorldlineManager().getSavepoint(id, options);
  }

  restoreWorldlineSavepoint(id, options = {}) {
    return this.requireWorldlineManager().restoreSavepoint(id, options);
  }

  createWorldlineBranch(input = {}) {
    return this.requireWorldlineManager().createBranchAndMaybeSwitch(input);
  }

  listWorldlineBranches(query = {}) {
    return this.requireWorldlineManager().listBranches(query);
  }

  getWorldlineBranch(id) {
    return this.requireWorldlineManager().getBranch(id);
  }

  switchWorldlineBranch(id, options = {}) {
    return this.requireWorldlineManager().switchBranch(id, options);
  }

  listAuditEvents(query = {}) {
    return this.requireAuditLog().listEvents(query);
  }

  getAuditEvent(id) {
    return this.requireAuditLog().getEvent(id);
  }

  async rollbackAuditEvent(id, { actor = 'user', reason, force = false } = {}) {
    const auditLog = this.requireAuditLog();
    const event = auditLog.getEvent(id);
    if (event.revertedAt && !force) {
      const error = new Error(`Audit event already reverted: ${id}`);
      error.name = 'AuditRollbackError';
      error.statusCode = 409;
      throw error;
    }
    if (!event.reversible && !force) {
      const error = new Error(`Audit event is not reversible: ${id}`);
      error.name = 'AuditRollbackError';
      error.statusCode = 400;
      throw error;
    }

    const result = await this.applyAuditRollback(event);
    const reverted = auditLog.markReverted(event.id, { by: actor });
    const rollbackEvent = auditLog.recordEvent({
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      operation: 'audit.rollback',
      actor: { type: 'user', id: actor },
      status: 'success',
      reversible: false,
      replayable: false,
      input: { eventId: event.id, reason, force },
      output: { result, revertedEvent: reverted },
      metadata: {
        rolledBackOperation: event.operation
      }
    });
    return {
      rolledBack: true,
      event: reverted,
      rollbackEvent,
      result
    };
  }

  async replayAuditEvent(id, {
    mode = 'captured',
    inputOverride,
    contextOverride,
    actor = 'user',
    reason
  } = {}) {
    const auditLog = this.requireAuditLog();
    const event = auditLog.getEvent(id);
    if (!event.replayable) {
      const error = new Error(`Audit event is not replayable: ${id}`);
      error.name = 'AuditReplayError';
      error.statusCode = 400;
      throw error;
    }

    const result = await this.applyAuditReplay(event, { mode, inputOverride, contextOverride });
    const replayEvent = auditLog.recordEvent({
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      operation: 'audit.replay',
      actor: { type: 'user', id: actor },
      status: 'success',
      reversible: false,
      replayable: false,
      input: { eventId: event.id, mode, inputOverride, contextOverride, reason },
      output: { result },
      replayedFromEventId: event.id,
      metadata: {
        replayedOperation: event.operation
      }
    });
    return {
      replayed: true,
      event,
      replayEvent,
      result
    };
  }

  async sendAppChatMessage(chatSessionId, content, options = {}) {
    if (options.agentLoop === false || options.mode === 'direct') {
      return this.sendAppChatMessageDirect(chatSessionId, content, options);
    }
    return this.sendAppChatMessageWithAgentLoop(chatSessionId, content, options);
  }

  async sendAppChatMessageWithAgentLoop(chatSessionId, content, options = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) {
      const error = new Error('content is required');
      error.name = 'AppChatValidationError';
      error.statusCode = 400;
      throw error;
    }

    const turnId = options.turnId || createId('turn');
    let savepoint;
    this.publishAgentProgress({
      type: 'savepoint_started',
      status: 'running',
      turnId,
      chatSessionId,
      progressLabel: '正在存档...'
    });
    try {
      savepoint = options.rollbackOnError === false || !this.worldlineManager
        ? undefined
        : await this.createWorldlineSavepoint({
          scopeType: 'app-chat',
          scopeId: chatSessionId,
          appChatSessionId: chatSessionId,
          label: `Before agent turn ${turnId}`,
          actor: options.actor || 'user',
          metadata: {
            turnId,
            source: options.source || 'app.chat.send'
          },
          includeRuntimeRag: false,
          includePermanentRag: false,
          includeAudit: false,
          includeSnapshot: false
        });
      this.publishAgentProgress({
        type: 'savepoint_finished',
        status: savepoint ? 'success' : 'skipped',
        turnId,
        chatSessionId,
        savepointId: savepoint?.id,
        progressLabel: savepoint ? '存档完成' : '未启用自动存档'
      });
    } catch (error) {
      this.publishAgentProgress({
        type: 'savepoint_failed',
        status: 'warning',
        turnId,
        chatSessionId,
        error: serializeAuditError(error),
        progressLabel: '自动存档失败，本轮仍会继续'
      });
    }

    const userMessageResult = this.addAppChatMessage(chatSessionId, {
      role: 'user',
      name: options.userName || this.appDatabase.getChatSession(chatSessionId, {
        includeMessages: false,
        includeCharacter: false,
        includeDataDatabase: false
      }).userName || 'User',
      content: normalizedContent,
      metadata: {
        source: options.source || 'app.chat.send',
        agentLoopTurnId: turnId
      }
    }, {
      actor: options.actor || 'user',
      reason: options.reason || 'app-chat-agent-loop-send'
    });

    try {
      const session = this.appDatabase.getChatSession(chatSessionId, {
        includeMessages: true,
        includeCharacter: true,
        includeDataDatabase: false
      });
      const sceneId = resolveAppChatSceneId(this, chatSessionId, options);
      const resolvedOptions = {
        ...options,
        sceneId
      };
      const loopInput = buildAppChatAgentLoopInput({
        chatSessionId,
        turnId,
        content: normalizedContent,
        session,
        userMessage: userMessageResult.message,
        options: resolvedOptions
      });
      const loopContext = buildAppChatAgentLoopContext(resolvedOptions);
      const loopResult = await this.toolPluginManager.executeTool(
        'system.agent_loop.run_config_turn',
        loopInput,
        undefined,
        loopContext
      );
      const loopOutput = loopResult.output;
      const assistantContent = extractAgentLoopAssistantContent(loopOutput);
      const characterCard = normalizeCharacterCard(session.characterCard);
      const assistantMessageResult = this.addAppChatMessage(chatSessionId, {
        role: 'assistant',
        name: characterCard.data.name || 'Character',
        content: assistantContent,
        metadata: {
          source: 'agent-loop',
          agentLoopTurnId: turnId,
          agentLoop: summarizeAgentLoopOutput(loopOutput),
          agentLoopTrace: loopResult.trace,
          completion: extractAgentLoopCompletion(loopOutput),
          savepointId: savepoint?.id
        }
      }, {
        actor: options.actor || 'assistant',
        reason: options.reason || 'app-chat-agent-loop-send'
      });
      this.publishAgentProgress({
        type: 'assistant_message_committed',
        status: 'success',
        turnId,
        chatSessionId,
        messageId: assistantMessageResult.message.id,
        progressLabel: '回复已写入聊天'
      });
      return {
        chat: this.appDatabase.getChatSession(chatSessionId),
        userMessage: userMessageResult.message,
        assistantMessage: assistantMessageResult.message,
        agentLoop: loopOutput,
        agentLoopTrace: loopResult.trace,
        savepoint
      };
    } catch (error) {
      const serialized = serializeAuditError(error);
      this.publishAgentProgress({
        type: 'agent_loop_failed',
        status: 'error',
        turnId,
        chatSessionId,
        error: serialized,
        progressLabel: 'Agent 循环出了问题'
      });
      if (savepoint?.id) {
        this.publishAgentProgress({
          type: 'rollback_started',
          status: 'running',
          turnId,
          chatSessionId,
          savepointId: savepoint.id,
          error: serialized,
          progressLabel: 'Agent 循环出了问题，正在回滚...'
        });
        try {
          const rollback = await this.restoreWorldlineSavepoint(savepoint.id, {
            actor: 'system',
            reason: `agent-loop-error:${turnId}`,
            setActiveBranch: false
          });
          this.publishAgentProgress({
            type: 'rollback_finished',
            status: 'success',
            turnId,
            chatSessionId,
            savepointId: savepoint.id,
            progressLabel: '已回滚到发送前状态'
          });
          error.rollback = rollback;
        } catch (rollbackError) {
          this.publishAgentProgress({
            type: 'rollback_failed',
            status: 'error',
            turnId,
            chatSessionId,
            savepointId: savepoint.id,
            error: serializeAuditError(rollbackError),
            progressLabel: '回滚失败，需要手动检查'
          });
          error.rollbackError = rollbackError;
        }
      } else {
        this.publishAgentProgress({
          type: 'rollback_unavailable',
          status: 'warning',
          turnId,
          chatSessionId,
          progressLabel: '没有可用存档，无法自动回滚'
        });
      }
      throw error;
    }
  }

  async sendAppChatMessageDirect(chatSessionId, content, options = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) {
      const error = new Error('content is required');
      error.name = 'AppChatValidationError';
      error.statusCode = 400;
      throw error;
    }
    const chatProvider = this.resolveChatProvider(options);

    const baseSession = this.appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: true,
      includeDataDatabase: false
    });
    const userMessageResult = this.addAppChatMessage(chatSessionId, {
      role: 'user',
      name: options.userName || baseSession.userName || 'User',
      content: normalizedContent,
      metadata: {
        source: options.source || 'app.chat.send'
      }
    }, {
      actor: options.actor || 'user',
      reason: options.reason || 'app-chat-send'
    });

    const session = this.appDatabase.getChatSession(chatSessionId, {
      includeMessages: true,
      includeCharacter: true,
      includeDataDatabase: false
    });
    const characterCard = normalizeCharacterCard(session.characterCard);
    const messages = session.messages;
    const preset = createPromptPreset({
      ...this.promptPreset,
      ...(options.promptPreset || {})
    });
    const structuredConfig = resolveStructuredInterfaceConfig(session, options.structuredInterface, this.structuredInterfaceDefaults);
    const structuredState = structuredConfig.enabled
      ? this.structuredInterfaceStore.load(chatSessionId)
      : undefined;
    const structuredInterfacePrompt = structuredConfig.enabled
      ? buildStructuredInterfacePrompt({
        state: structuredState.state,
        mode: structuredConfig.mode,
        extraInstructions: structuredConfig.extraInstructions,
        includeCurrentState: structuredConfig.includeCurrentState
      })
      : '';
    const worldInfoEntries = selectWorldInfoEntries(
      characterCard.data.character_book,
      messages,
      preset.worldInfo
    );
    const agentAccessPolicy = normalizeRuntimeAgentAccessPolicy(options.agentAccessPolicy || options.agentAccess?.policy);
    const retrievalQuery = buildRetrievalQuery(messages);
    const ragContext = agentAccessAllows(agentAccessPolicy, 'rag', 'read') && agentAccessAllows(agentAccessPolicy, 'runtimeRag', 'read')
      ? await this.ragService.retrieve({
        collection: options.collection || session.metadata?.collection || preset.rag.collection,
        query: retrievalQuery,
        limit: options.ragLimit ?? preset.rag.limit,
        minScore: options.minScore ?? preset.rag.minScore,
        filter: options.ragFilter
      })
      : [];
    const prompt = buildPrompt({
      characterCard,
      messages,
      userName: session.userName,
      playerPersona: session.playerPersona,
      promptPreset: preset,
      worldInfoEntries,
      ragContext,
      structuredInterfacePrompt
    });
    const structuredPromptTrace = structuredConfig.enabled
      ? this.structuredInterfaceStore.tracePrompt(chatSessionId, {
        prompt: structuredInterfacePrompt,
        state: structuredState,
        source: 'app.chat.send',
        options: {
          mode: structuredConfig.mode,
          includeCurrentState: structuredConfig.includeCurrentState
        }
      })
      : undefined;

    const completion = await chatProvider.generate({
      messages: prompt.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      extra: options.extra
    });
    const structuredOutput = structuredConfig.enabled
      ? this.structuredInterfaceStore.applyModelOutput(chatSessionId, completion.content, {
        defaultMode: structuredConfig.mode,
        source: 'assistant'
      })
      : undefined;
    const assistantContent = structuredOutput ? structuredOutput.content : completion.content;
    const assistantMessageResult = this.addAppChatMessage(chatSessionId, {
      role: 'assistant',
      name: characterCard.data.name || 'Character',
      content: assistantContent,
      metadata: {
        completion,
        structuredOutput: structuredOutput ? {
          updated: structuredOutput.updated,
          trace: structuredOutput.trace
        } : undefined,
        structuredPromptTrace
      }
    }, {
      actor: options.actor || 'assistant',
      reason: options.reason || 'app-chat-send'
    });

    return {
      chat: this.appDatabase.getChatSession(chatSessionId),
      userMessage: userMessageResult.message,
      assistantMessage: assistantMessageResult.message,
      prompt: options.includePrompt ? prompt : undefined,
      completion,
      structuredOutput,
      structuredPromptTrace
    };
  }

  async deleteRuntimeMessagesAfter(sessionId, {
    messageId,
    index,
    inclusive = false,
    reason,
    actor = 'user'
  } = {}) {
    const session = await this.getSession(sessionId);
    const cutoffIndex = resolveRuntimeMessageCutoff(session.messages, { messageId, index });
    const deleteFrom = inclusive ? cutoffIndex : cutoffIndex + 1;
    const keptMessages = session.messages.slice(0, Math.max(0, deleteFrom));
    const deletedMessages = session.messages.slice(Math.max(0, deleteFrom));
    const updated = await this.sessionStore.update(sessionId, {
      ...session,
      messages: keptMessages
    });

    const event = this.auditLog?.recordEvent({
      scopeType: 'runtime-session',
      scopeId: sessionId,
      operation: 'runtime.messages.delete_after',
      actor: { type: 'user', id: actor },
      status: 'success',
      reversible: deletedMessages.length > 0,
      replayable: false,
      input: { sessionId, messageId, index, inclusive, reason },
      before: {
        session: snapshotRuntimeSession(session),
        deletedMessages
      },
      after: {
        session: snapshotRuntimeSession(updated)
      },
      metadata: {
        deletedCount: deletedMessages.length
      }
    });

    return {
      session: updated,
      deletedMessages,
      auditEvent: event
    };
  }

  addAppChatMessage(chatSessionId, messageInput, { actor = 'user', reason } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const message = this.appDatabase.addChatMessage(chatSessionId, messageInput);
    const event = this.auditLog?.recordEvent({
      scopeType: 'app-chat',
      scopeId: chatSessionId,
      operation: 'app.chat.message.add',
      actor: { type: 'user', id: actor },
      status: 'success',
      reversible: true,
      replayable: false,
      input: { chatSessionId, messageInput, reason },
      after: { message },
      metadata: {
        ...this.getWorldlineMetadata('app-chat', chatSessionId),
        messageId: message.id,
        role: message.role
      }
    });
    return { message, auditEvent: event };
  }

  updateAppChatMessage(chatSessionId, messageId, patch = {}, { actor = 'user', reason } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const before = this.appDatabase.getChatMessage(messageId);
    if (before.chatSessionId !== chatSessionId) {
      const error = new Error(`Chat message does not belong to chat session: ${messageId}`);
      error.name = 'AppDataValidationError';
      error.statusCode = 400;
      throw error;
    }

    const metadata = {
      ...(patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata) ? patch.metadata : {}),
      editedBy: actor
    };
    if (reason) metadata.editReason = reason;
    const message = this.appDatabase.updateChatMessage(chatSessionId, messageId, {
      ...patch,
      metadata
    });
    const event = this.auditLog?.recordEvent({
      scopeType: 'app-chat',
      scopeId: chatSessionId,
      operation: 'app.chat.message.update',
      actor: { type: 'user', id: actor },
      status: 'success',
      reversible: true,
      replayable: false,
      input: { chatSessionId, messageId, patch, reason },
      before: { message: before },
      after: { message },
      metadata: {
        ...this.getWorldlineMetadata('app-chat', chatSessionId),
        messageId,
        role: message.role
      }
    });
    return { message, before, auditEvent: event };
  }

  async exportAppCharacterResources(characterCardId) {
    if (!this.appDatabase) throw missingAppDatabase();
    const character = this.appDatabase.getCharacterCard(characterCardId);
    const sidecar = {
      format: 'ai-dnd-character-resources-v1',
      exportedAt: new Date().toISOString(),
      character: {
        id: character.id,
        name: character.name,
        spec: character.spec,
        specVersion: character.specVersion,
        currentRevisionId: character.currentRevisionId,
        createdAt: character.createdAt,
        updatedAt: character.updatedAt
      },
      appDatabase: {
        initialSetting: this.appDatabase.getInitialSetting(characterCardId),
        chats: this.appDatabase.listChatSessions({
          characterCardId,
          includeArchived: true
        })
      },
      resources: {
        globalData: exportScopedDataRecords(this.dataManager, { characterCardId, lifecycleScope: 'character' }),
        runtimeRag: exportScopedRagDocuments(this.ragService, { characterCardId, lifecycleScope: 'character' }),
        permanentRag: this.permanentRagService
          ? exportScopedRagDocuments(this.permanentRagService, { characterCardId, lifecycleScope: 'character' })
          : emptyRagSnapshot({ characterCardId, lifecycleScope: 'character' })
      }
    };
    return stripUndefinedDeep(sidecar);
  }

  async exportAppCharacterBundle(characterCardId, { revisionId } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const characterCard = this.appDatabase.exportCharacterCard(characterCardId, { revisionId });
    const sidecar = await this.exportAppCharacterResources(characterCardId);
    return stripUndefinedDeep({
      format: 'ai-dnd-character-bundle-v1',
      exportedAt: sidecar.exportedAt,
      characterCard,
      character: sidecar.character,
      appDatabase: sidecar.appDatabase,
      resources: sidecar.resources
    });
  }

  async importAppCharacterBundle(payload = {}, options = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const bundle = payload.characterCard || payload.card || payload.character || payload.data
      ? payload
      : { characterCard: payload };
    const character = this.appDatabase.importCharacterCard(bundle.characterCard || bundle.card || bundle.character || bundle, {
      characterCardId: options.characterCardId || bundle.characterCardId,
      source: options.source || bundle.source || 'character-bundle-import',
      notes: options.notes || bundle.notes || ''
    });

    const sidecar = bundle.sidecar || bundle.resourcesSidecar || (
      bundle.format === 'ai-dnd-character-resources-v1' || bundle.resources || bundle.appDatabase
        ? bundle
        : undefined
    );
    const resources = sidecar
      ? await this.importAppCharacterResources(character.id, sidecar)
      : emptyImportedResources();
    return { character, resources };
  }

  async importAppCharacterResources(characterCardId, sidecar = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    this.appDatabase.getCharacterCard(characterCardId);
    const previousCharacterId = sidecar.character?.id
      || sidecar.characterCardId
      || sidecar.appDatabase?.initialSetting?.character?.id
      || '';
    const initialSetting = sidecar.appDatabase?.initialSetting?.initialSetting
      || sidecar.initialSetting
      || sidecar.dataSchema
      || sidecar.schema;
    if (initialSetting) {
      this.appDatabase.saveInitialSetting(characterCardId, initialSetting, {
        syncExisting: false,
        syncMode: 'merge'
      });
    }

    const remap = {
      fromCharacterCardId: previousCharacterId,
      toCharacterCardId: characterCardId
    };
    const resources = sidecar.resources || {};
    const defaultScope = {
      lifecycleScope: 'character',
      characterCardId
    };
    return {
      globalData: importScopedDataRecords(this.dataManager, resources.globalData || sidecar.globalData, remap, defaultScope),
      runtimeRag: await importScopedRagDocuments(this.ragService, resources.runtimeRag || sidecar.runtimeRag, remap, defaultScope),
      permanentRag: this.permanentRagService
        ? await importScopedRagDocuments(this.permanentRagService, resources.permanentRag || sidecar.permanentRag, remap, defaultScope)
        : { importedCollections: [] }
    };
  }

  async createAppChatSession(input = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const includeGreeting = input.includeGreeting !== false;
    const result = this.appDatabase.createChatSession({
      ...input,
      includeGreeting: false,
      metadata: {
        ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
        deferredGreeting: includeGreeting
      }
    });
    const chatSessionId = result.session?.id;
    const resourceClones = chatSessionId ? await this.cloneAppChatResources(chatSessionId) : undefined;
    const initialization = chatSessionId
      ? await this.initializeAppChatSession(chatSessionId, { source: 'app.chat.create' })
      : undefined;
    const greeting = chatSessionId && includeGreeting
      ? await this.addAppChatProtagonistGreeting(chatSessionId, {
        source: 'app.chat.create',
        initialization
      })
      : { status: 'skipped', reason: 'includeGreeting_false' };
    return stripUndefinedDeep({
      ...result,
      session: chatSessionId ? this.appDatabase.getChatSession(chatSessionId) : result.session,
      resourceClones,
      initialization,
      greeting
    });
  }

  async exportAppChatResources(chatSessionId) {
    if (!this.appDatabase) throw missingAppDatabase();
    const session = this.appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    return stripUndefinedDeep({
      format: 'ai-dnd-chat-resources-v1',
      exportedAt: new Date().toISOString(),
      chatSession: {
        id: session.id,
        characterCardId: session.characterCardId,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      },
      resources: {
        globalData: exportScopedDataRecords(this.dataManager, {
          characterCardId: session.characterCardId,
          chatSessionId,
          lifecycleScope: 'chat'
        }),
        runtimeRag: exportScopedRagDocuments(this.ragService, {
          characterCardId: session.characterCardId,
          chatSessionId,
          lifecycleScope: 'chat'
        }),
        permanentRag: this.permanentRagService
          ? exportScopedRagDocuments(this.permanentRagService, {
            characterCardId: session.characterCardId,
            chatSessionId,
            lifecycleScope: 'chat'
          })
          : emptyRagSnapshot({ characterCardId: session.characterCardId, chatSessionId, lifecycleScope: 'chat' })
      }
    });
  }

  async exportAppChatBundle(chatSessionId) {
    if (!this.appDatabase) throw missingAppDatabase();
    const exported = this.appDatabase.exportChatSession(chatSessionId);
    const sidecar = await this.exportAppChatResources(chatSessionId);
    return stripUndefinedDeep({
      ...exported,
      format: 'ai-dnd-chat-bundle-v1',
      resources: sidecar.resources
    });
  }

  async importAppChatBundle(payload = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const previousChatSessionId = payload.chatSession?.id || payload.session?.id || payload.chatSessionId || '';
    const previousCharacterCardId = payload.chatSession?.characterCardId
      || payload.character?.id
      || payload.characterCardId
      || '';
    const chat = this.appDatabase.importChatSession(payload);
    const sidecar = payload.sidecar || payload.resourcesSidecar || (
      payload.format === 'ai-dnd-chat-resources-v1' || payload.resources
        ? payload
        : undefined
    );
    const resources = sidecar
      ? await this.importAppChatResources(chat.id, sidecar, {
        previousChatSessionId,
        previousCharacterCardId
      })
      : emptyImportedResources();
    const initialization = await this.initializeAppChatSession(chat.id, {
      source: 'app.chat.import'
    });
    return { chat, resources, initialization };
  }

  async importAppChatResources(chatSessionId, sidecar = {}, {
    previousChatSessionId,
    previousCharacterCardId
  } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const session = this.appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const remap = {
      fromCharacterCardId: previousCharacterCardId
        || sidecar.chatSession?.characterCardId
        || sidecar.characterCardId
        || '',
      toCharacterCardId: session.characterCardId,
      fromChatSessionId: previousChatSessionId
        || sidecar.chatSession?.id
        || sidecar.chatSessionId
        || '',
      toChatSessionId: chatSessionId
    };
    const resources = sidecar.resources || {};
    const defaultScope = {
      lifecycleScope: 'chat',
      characterCardId: session.characterCardId,
      chatSessionId
    };
    return {
      globalData: importScopedDataRecords(this.dataManager, resources.globalData || sidecar.globalData, remap, defaultScope),
      runtimeRag: await importScopedRagDocuments(this.ragService, resources.runtimeRag || sidecar.runtimeRag, remap, defaultScope),
      permanentRag: this.permanentRagService
        ? await importScopedRagDocuments(this.permanentRagService, resources.permanentRag || sidecar.permanentRag, remap, defaultScope)
        : { importedCollections: [] }
    };
  }

  async cloneAppChatResources(chatSessionId) {
    if (!this.appDatabase) throw missingAppDatabase();
    const session = this.appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    return {
      chatSessionId,
      characterCardId: session.characterCardId,
      data: cloneScopedDataRecords(this.dataManager, {
        characterCardId: session.characterCardId,
        chatSessionId,
        now: () => new Date().toISOString()
      }),
      runtimeRag: await cloneScopedRagDocuments(this.ragService, {
        characterCardId: session.characterCardId,
        chatSessionId,
        now: () => new Date().toISOString()
      }),
      permanentRag: this.permanentRagService
        ? await cloneScopedRagDocuments(this.permanentRagService, {
          characterCardId: session.characterCardId,
          chatSessionId,
          now: () => new Date().toISOString()
        })
        : { cloned: [] }
    };
  }

  async initializeAppChatSession(chatSessionId, {
    source = 'app.chat.initialize',
    sceneId = 'current',
    force = false
  } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    this.appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: true
    });

    const toolContext = {
      source,
      authorization: true,
      chatSessionId,
      actor: { type: 'system', id: 'app-initializer' }
    };
    const contextRead = await this.executeInitializationTool('system.actor_control.get_context', {
      chatSessionId,
      sceneId
    }, toolContext);
    const existingContext = contextRead.output?.context || {};
    if (!force
      && existingContext.controlledActorId
      && existingContext.requiresInitialization !== true
      && existingContext.source !== 'player_state') {
      return stripUndefinedDeep({
        status: 'already_bound',
        bound: true,
        source: existingContext.source,
        actorId: existingContext.controlledActorId,
        playerId: existingContext.controlledPlayerId,
        sceneId: existingContext.sceneId,
        context: existingContext
      });
    }

    const playerStates = await this.listInitializationPlayerStates(chatSessionId, toolContext);
    const selected = selectInitializationPlayerState({
      states: playerStates.records,
      existingContext
    });
    if (!selected) {
      const protagonistCount = playerStates.records
        .filter((record) => compactInitializationPlayerState(record).isProtagonist === true)
        .length;
      const reason = protagonistCount > 1
        ? 'multiple_protagonist_markers'
        : (playerStates.records.length > 1 ? 'multiple_player_actors' : 'no_player_actor');
      return stripUndefinedDeep({
        status: 'requires_selection',
        bound: false,
        reason,
        candidateCount: playerStates.records.length,
        candidates: playerStates.records.map(compactInitializationPlayerState),
        context: existingContext,
        warnings: [
          reason === 'multiple_protagonist_markers'
            ? 'Multiple active protagonist markers exist; frontend should ask the user which one to keep.'
            : reason === 'multiple_player_actors'
            ? 'Multiple player actors exist; frontend should ask the user which protagonist to control.'
            : 'No player actor state exists yet; frontend should create or select one before normal play.'
        ]
      });
    }

    const actor = compactInitializationPlayerState(selected);
    const resolvedSceneId = actor.sceneId || sceneId || 'current';
    const writes = [];
    const errors = [];
    const protagonistMarker = await this.markUniqueInitializationProtagonist({
      chatSessionId,
      selected: actor,
      candidates: playerStates.records,
      toolContext,
      source
    });
    writes.push(...protagonistMarker.writes);
    errors.push(...protagonistMarker.errors);
    const protagonist = await this.executeInitializationTool('system.protagonist.switch_perspective', {
      chatSessionId,
      sceneId: resolvedSceneId,
      toActorId: actor.actorId,
      toPlayerId: actor.playerId || actor.actorId,
      toName: actor.name || actor.actorId,
      greeting: actor.greeting,
      createTargetState: false,
      reason: source,
      metadata: {
        source,
        autoInitialized: true,
        selectedFrom: actor.recordId || actor.actorId,
        greeting: actor.greeting
      }
    }, toolContext);
    if (protagonist.error) errors.push(protagonist.error);
    else writes.push({ toolId: 'system.protagonist.switch_perspective', output: protagonist.output });

    const actorControl = await this.executeInitializationTool('system.actor_control.set_context', {
      chatSessionId,
      sceneId: resolvedSceneId,
      controlledActorId: actor.actorId,
      controlledActorTitle: actor.name || actor.actorId,
      controlledPlayerId: actor.playerId || actor.actorId,
      viewpointActorId: actor.actorId,
      viewpointActorTitle: actor.name || actor.actorId,
      embodiedActorId: actor.actorId,
      embodiedActorTitle: actor.name || actor.actorId,
      inputAuthority: 'actor_claim',
      source: 'app-initializer',
      operation: 'auto_bind_single_player_actor',
      reason: source,
      metadata: {
        source,
        autoInitialized: true,
        selectedFrom: actor.recordId || actor.actorId,
        greeting: actor.greeting
      }
    }, toolContext);
    if (actorControl.error) errors.push(actorControl.error);
    else writes.push({ toolId: 'system.actor_control.set_context', output: actorControl.output });

    return stripUndefinedDeep({
      status: errors.length > 0 ? 'partial' : 'bound',
      bound: writes.length > 0,
      actorId: actor.actorId,
      playerId: actor.playerId,
      sceneId: resolvedSceneId,
      selected: actor,
      writes,
      errors
    });
  }

  async addAppChatProtagonistGreeting(chatSessionId, {
    source = 'app.chat.greeting',
    initialization,
    force = false
  } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const session = this.appDatabase.getChatSession(chatSessionId, {
      includeMessages: true,
      includeCharacter: true,
      includeDataDatabase: true
    });
    const existingGreeting = (session.messages || []).find((message) => message.metadata?.greeting);
    if (existingGreeting && !force) {
      return {
        status: 'skipped',
        reason: 'greeting_exists',
        message: existingGreeting
      };
    }

    const contextResult = await this.executeInitializationTool('system.actor_control.get_context', {
      chatSessionId,
      sceneId: initialization?.sceneId || 'current'
    }, {
      source,
      authorization: true,
      chatSessionId,
      actor: { type: 'system', id: 'app-initializer' }
    });
    const context = contextResult.output?.context || {};
    if (!context.controlledActorId || context.requiresInitialization === true) {
      return stripUndefinedDeep({
        status: 'skipped',
        reason: 'missing_bound_protagonist',
        initialization,
        context,
        error: contextResult.error
      });
    }
    const greeting = await this.resolveAppChatProtagonistGreeting(chatSessionId, {
      context,
      initialization,
      source
    });
    if (!greeting.text) {
      return stripUndefinedDeep({
        status: 'skipped',
        reason: 'missing_protagonist_greeting',
        initialization,
        context,
        actorState: greeting.actorState,
        warning: 'No protagonist greeting is stored in npc_structured_states; the opening is intentionally left unfixed for the AI narrative layer.'
      });
    }

    const messageResult = this.addAppChatMessage(chatSessionId, {
      role: 'user',
      name: context.controlledActorTitle || context.controlledActorId || session.userName || 'Player',
      content: greeting.text,
      metadata: {
        greeting: true,
        protagonistGreeting: true,
        synthetic: true,
        source,
        greetingSource: greeting.source,
        actorControl: compactActorControlMetadata(context),
        protagonist: {
          actorId: context.controlledActorId,
          playerId: context.controlledPlayerId,
          name: context.controlledActorTitle,
          sceneId: context.sceneId,
          greetingSource: greeting.source
        },
        inputAuthority: context.inputAuthority || 'actor_claim'
      }
    }, {
      actor: 'system',
      reason: source
    });

    return {
      status: 'created',
      message: messageResult.message,
      context
    };
  }

  async resolveAppChatProtagonistGreeting(chatSessionId, {
    context = {},
    initialization,
    source = 'app.chat.greeting'
  } = {}) {
    const initializedText = firstNonEmptyRuntimeString(initialization?.selected?.greeting, initialization?.greeting);
    if (initializedText) return { text: initializedText, source: 'initialization.selected' };
    const actorId = context.controlledActorId;
    if (!actorId) return { text: '', source: 'missing_actor' };
    const listed = await this.executeInitializationTool('system.npc_state.list_states', {
      chatSessionId,
      sceneId: context.sceneId || 'current',
      npcId: actorId,
      limit: 5
    }, {
      source,
      authorization: true,
      chatSessionId,
      actor: { type: 'system', id: 'app-initializer' }
    });
    const records = Array.isArray(listed.output?.records) ? listed.output.records : [];
    const actorState = records.find((record) => compactInitializationPlayerState(record).actorId === actorId) || records[0];
    const stateData = actorState?.data || {};
    const text = firstNonEmptyRuntimeString(
      stateData.greeting,
      stateData.initialGreeting,
      stateData.initialSituation,
      stateData.openingSituation,
      stateData.metadata?.greeting
    );
    return stripUndefinedDeep({
      text,
      source: text ? 'npc_structured_states.greeting' : 'npc_structured_states.missing_greeting',
      actorState: actorState ? {
        id: actorState.id,
        actorId,
        sceneId: stateData.sceneId,
        hasGreeting: Boolean(text)
      } : undefined,
      error: listed.error
    });
  }

  async listInitializationPlayerStates(chatSessionId, toolContext) {
    const listed = await this.executeInitializationTool('system.npc_state.list_states', {
      chatSessionId,
      isPlayer: true,
      limit: 10
    }, toolContext);
    if (listed.error) {
      return {
        records: [],
        error: listed.error
      };
    }
    const records = Array.isArray(listed.output?.records) ? listed.output.records : [];
    return {
      records: records.filter((record) => compactInitializationPlayerState(record).actorId)
    };
  }

  async markUniqueInitializationProtagonist({
    chatSessionId,
    selected = {},
    candidates = [],
    toolContext,
    source = 'app.chat.initialize'
  } = {}) {
    const writes = [];
    const errors = [];
    const selectedKey = `${selected.sceneId || 'current'}:${selected.actorId}`;
    for (const candidateRecord of candidates || []) {
      const candidate = compactInitializationPlayerState(candidateRecord);
      if (!candidate.actorId) continue;
      const isSelected = `${candidate.sceneId || 'current'}:${candidate.actorId}` === selectedKey;
      if (!isSelected && candidate.isProtagonist !== true) continue;
      const input = stripUndefinedDeep({
        chatSessionId,
        recordId: candidate.recordId,
        sceneId: candidate.sceneId || 'current',
        npcId: candidate.actorId,
        isPlayer: candidate.isPlayer !== false,
        isProtagonist: isSelected,
        greeting: isSelected ? candidate.greeting : undefined,
        source: `${source}.protagonist_marker`
      });
      const result = await this.executeInitializationTool('system.npc_state.patch_state', input, toolContext);
      if (result.error) errors.push(result.error);
      else writes.push({
        toolId: 'system.npc_state.patch_state',
        output: {
          recordId: result.output?.record?.id,
          actorId: candidate.actorId,
          isProtagonist: isSelected
        }
      });
    }
    return { writes, errors };
  }

  async executeInitializationTool(toolId, input, context) {
    try {
      return await this.toolPluginManager.executeTool(toolId, input, undefined, context);
    } catch (error) {
      return {
        output: undefined,
        error: {
          toolId,
          input,
          ...serializeAuditError(error)
        }
      };
    }
  }

  async cleanupAppChatResources(chatSessionId) {
    return {
      chatSessionId,
      data: deleteScopedDataRecords(this.dataManager, { chatSessionId }),
      runtimeRag: await deleteScopedRagDocuments(this.ragService, { chatSessionId }),
      permanentRag: this.permanentRagService
        ? await deleteScopedRagDocuments(this.permanentRagService, { chatSessionId })
        : { collections: [], sources: [] },
      worldline: this.worldlineManager
        ? this.worldlineManager.deleteScope('app-chat', chatSessionId)
        : undefined
    };
  }

  async cleanupAppCharacterResources(characterCardId) {
    return {
      characterCardId,
      data: deleteScopedDataRecords(this.dataManager, { characterCardId }),
      runtimeRag: await deleteScopedRagDocuments(this.ragService, { characterCardId }),
      permanentRag: this.permanentRagService
        ? await deleteScopedRagDocuments(this.permanentRagService, { characterCardId })
        : { collections: [], sources: [] }
    };
  }

  deleteAppChatMessage(chatSessionId, messageId, { actor = 'user', reason } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const before = this.appDatabase.getChatMessage(messageId);
    if (before.chatSessionId !== chatSessionId) {
      const error = new Error(`Chat message does not belong to chat session: ${messageId}`);
      error.name = 'AppDataValidationError';
      error.statusCode = 400;
      throw error;
    }
    const deleted = this.appDatabase.deleteChatMessage(messageId);
    const event = this.auditLog?.recordEvent({
      scopeType: 'app-chat',
      scopeId: chatSessionId,
      operation: 'app.chat.message.delete',
      actor: { type: 'user', id: actor },
      status: 'success',
      reversible: deleted.deleted,
      replayable: false,
      input: { chatSessionId, messageId, reason },
      before: { message: before },
      output: deleted,
      metadata: {
        ...this.getWorldlineMetadata('app-chat', chatSessionId),
        messageId
      }
    });
    return { ...deleted, auditEvent: event };
  }

  deleteAppChatMessagesAfter(chatSessionId, {
    messageId,
    orderIndex,
    inclusive = false,
    reason,
    actor = 'user'
  } = {}) {
    if (!this.appDatabase) throw missingAppDatabase();
    const beforeMessages = this.appDatabase.listChatMessages(chatSessionId);
    const result = this.appDatabase.deleteChatMessagesAfter(chatSessionId, {
      messageId,
      orderIndex,
      inclusive
    });
    const afterMessages = this.appDatabase.listChatMessages(chatSessionId);
    const event = this.auditLog?.recordEvent({
      scopeType: 'app-chat',
      scopeId: chatSessionId,
      operation: 'app.chat.messages.delete_after',
      actor: { type: 'user', id: actor },
      status: 'success',
      reversible: result.deletedMessages.length > 0,
      replayable: false,
      input: { chatSessionId, messageId, orderIndex, inclusive, reason },
      before: {
        messages: beforeMessages,
        deletedMessages: result.deletedMessages
      },
      after: {
        messages: afterMessages
      },
      output: result,
      metadata: {
        ...this.getWorldlineMetadata('app-chat', chatSessionId),
        deletedCount: result.deletedMessages.length
      }
    });
    return {
      ...result,
      auditEvent: event
    };
  }

  requireAuditLog() {
    if (!this.auditLog) {
      const error = new Error('Audit log is not configured');
      error.name = 'AuditDisabledError';
      error.statusCode = 503;
      throw error;
    }
    return this.auditLog;
  }

  requireWorldlineManager() {
    if (!this.worldlineManager) {
      const error = new Error('Worldline manager is not configured');
      error.name = 'WorldlineDisabledError';
      error.statusCode = 503;
      throw error;
    }
    return this.worldlineManager;
  }

  getWorldlineMetadata(scopeType, scopeId) {
    try {
      const active = this.worldlineManager?.getActiveBranch(scopeType, scopeId);
      if (!active) return {};
      return {
        worldlineBranchId: active.id,
        worldlineBranchName: active.name
      };
    } catch {
      return {};
    }
  }

  async applyAuditRollback(event) {
    switch (event.operation) {
      case 'runtime.send_message':
        return this.restoreRuntimeSessionSnapshot(event.before);
      case 'runtime.messages.delete_after':
        return this.restoreRuntimeSessionSnapshot(event.before);
      case 'rag.ingest':
        return this.rollbackRagIngest(event, this.ragService);
      case 'tool.execute':
        return this.rollbackToolExecution(event);
      case 'app.chat.message.add':
        return this.appDatabase.deleteChatMessage(event.after?.message?.id);
      case 'app.chat.message.delete':
        return this.appDatabase.restoreChatMessages(event.scopeId, [event.before?.message], { replaceExisting: true });
      case 'app.chat.message.update':
        return this.appDatabase.restoreChatMessages(event.scopeId, [event.before?.message], { replaceExisting: true });
      case 'app.chat.messages.delete_after':
        return this.appDatabase.restoreChatMessages(event.scopeId, event.before?.deletedMessages || [], { replaceExisting: true });
      default: {
        const error = new Error(`Unsupported rollback operation: ${event.operation}`);
        error.name = 'AuditRollbackError';
        error.statusCode = 400;
        throw error;
      }
    }
  }

  async applyAuditReplay(event, { mode, inputOverride, contextOverride } = {}) {
    switch (event.operation) {
      case 'tool.execute': {
        const request = event.input || {};
        const context = {
          ...(request.context || {}),
          ...(contextOverride || {}),
          audit: {
            ...(request.context?.audit || {}),
            ...(contextOverride?.audit || {}),
            skipAudit: true,
            replayOf: event.id
          }
        };
        return this.toolPluginManager.executeTool(
          request.toolId,
          inputOverride || request.input || {},
          undefined,
          context
        );
      }
      case 'runtime.send_message':
        if (mode === 'regenerate') {
          return this.sendMessage(
            event.input.sessionId,
            inputOverride?.content ?? event.input.content,
            inputOverride?.options ?? event.input.options ?? {}
          );
        }
        return {
          mode: 'captured',
          prompt: event.output?.prompt,
          completion: event.output?.completion,
          assistantMessage: event.output?.assistantMessage
        };
      case 'rag.ingest':
        return this.ragService.ingestText({
          ...(event.input || {}),
          ...(inputOverride || {})
        });
      case 'rag.retrieve':
        return this.ragService.retrieve({
          ...(event.input || {}),
          ...(inputOverride || {})
        });
      default: {
        const error = new Error(`Unsupported replay operation: ${event.operation}`);
        error.name = 'AuditReplayError';
        error.statusCode = 400;
        throw error;
      }
    }
  }

  async restoreRuntimeSessionSnapshot(snapshot = {}) {
    const sessionSnapshot = snapshot.session;
    if (!sessionSnapshot?.id) {
      const error = new Error('Runtime session snapshot is missing');
      error.name = 'AuditRollbackError';
      error.statusCode = 400;
      throw error;
    }
    const current = await this.getSession(sessionSnapshot.id);
    const restored = await this.sessionStore.update(sessionSnapshot.id, {
      ...current,
      ...sessionSnapshot,
      messages: sessionSnapshot.messages || [],
      metadata: sessionSnapshot.metadata || {}
    });
    if (snapshot.structuredInterface) {
      this.structuredInterfaceStore.save(sessionSnapshot.id, snapshot.structuredInterface.state || {}, {
        source: 'audit.rollback',
        mode: 'restore',
        update: snapshot.structuredInterface
      });
    }
    return {
      session: restored,
      structuredInterface: snapshot.structuredInterface
    };
  }

  async rollbackRagIngest(event, ragService) {
    const collection = event.input?.collection || event.scopeId;
    const sourceIds = [
      ...(event.after?.sourceIds || []),
      event.metadata?.sourceId,
      event.input?.sourceId
    ].filter(Boolean);
    const uniqueSourceIds = [...new Set(sourceIds)];
    const deleted = [];
    for (const sourceId of uniqueSourceIds) {
      deleted.push({
        collection,
        sourceId,
        deleted: await ragService.deleteSource({ collection, sourceId })
      });
    }
    return { deleted };
  }

  async rollbackToolExecution(event) {
    const toolId = event.metadata?.toolId || event.input?.toolId;
    if (toolId === 'system.rag_runtime.remember') {
      return this.rollbackRagToolRemember(event, this.ragService);
    }
    if (toolId?.startsWith('system.rag_permanent.') && this.permanentRagService) {
      return this.rollbackRagToolRemember(event, this.permanentRagService);
    }
    const snapshot = event.before?.stateSnapshot;
    if (!snapshot) {
      const error = new Error(`No state snapshot available for tool rollback: ${toolId}`);
      error.name = 'AuditRollbackError';
      error.statusCode = 400;
      throw error;
    }
    return restoreToolStateSnapshot({
      appDatabase: this.appDatabase,
      dataManager: this.dataManager,
      snapshot
    });
  }

  async rollbackRagToolRemember(event, ragService) {
    const output = event.output || {};
    const input = event.input?.input || {};
    const collection = output.collection || input.collection || event.scopeId;
    const sourceId = output.sourceId || input.sourceId || event.metadata?.sourceId;
    if (!sourceId) {
      const error = new Error('Cannot rollback RAG tool event without sourceId');
      error.name = 'AuditRollbackError';
      error.statusCode = 400;
      throw error;
    }
    return {
      collection,
      sourceId,
      deleted: await ragService.deleteSource({ collection, sourceId })
    };
  }
}

export function buildRetrievalQuery(messages, maxMessages = 6) {
  return serializeDialogue(messages.slice(Math.max(0, messages.length - maxMessages)));
}

function buildAppChatAgentLoopInput({
  chatSessionId,
  turnId,
  content,
  session,
  userMessage,
  options = {}
}) {
  const agentLoopInput = options.agentLoopInput && typeof options.agentLoopInput === 'object'
    ? options.agentLoopInput
    : {};
  const phaseOverrides = [
    ...(Array.isArray(agentLoopInput.phaseOverrides) ? agentLoopInput.phaseOverrides : []),
    ...(Array.isArray(options.phaseOverrides) ? options.phaseOverrides : [])
  ];
  const narrativeOverride = buildNarrativePhaseOverride(options);
  if (narrativeOverride) phaseOverrides.push(narrativeOverride);
  const sceneId = firstNonEmptyRuntimeString(
    options.sceneId,
    options.currentSceneId,
    agentLoopInput.sceneId,
    agentLoopInput.currentSceneId,
    options.contextPlannerInput?.sceneId,
    agentLoopInput.contextPlannerInput?.sceneId
  );

  const toolContext = {
    ...(agentLoopInput.toolContext && typeof agentLoopInput.toolContext === 'object' ? agentLoopInput.toolContext : {}),
    ...(options.toolContext && typeof options.toolContext === 'object' ? options.toolContext : {}),
    source: options.source || 'app.chat.send',
    chatSessionId,
    sceneId,
    turnId,
    authorization: options.authorization === false ? false : true,
    api: options.api,
    llm: options.llm,
    llmPromptOverrides: options.llmPromptOverrides,
    agentAccessPolicy: options.agentAccessPolicy
  };

  return stripUndefinedDeep({
    ...agentLoopInput,
    chatSessionId,
    sceneId,
    currentSceneId: sceneId,
    text: content,
    messages: session.messages,
    dryRun: false,
    movement: options.movement || agentLoopInput.movement,
    path: options.path || agentLoopInput.path,
    pathfinding: options.pathfinding || agentLoopInput.pathfinding,
    startMapId: options.startMapId ?? agentLoopInput.startMapId,
    targetMapId: options.targetMapId ?? agentLoopInput.targetMapId,
    fromMapId: options.fromMapId ?? agentLoopInput.fromMapId,
    toMapId: options.toMapId ?? agentLoopInput.toMapId,
    startNodeId: options.startNodeId ?? agentLoopInput.startNodeId,
    targetNodeId: options.targetNodeId ?? agentLoopInput.targetNodeId,
    from: options.from ?? agentLoopInput.from,
    to: options.to ?? agentLoopInput.to,
    includeGlobal: options.includeGlobal ?? agentLoopInput.includeGlobal,
    includeMountedMaps: options.includeMountedMaps ?? agentLoopInput.includeMountedMaps,
    includeStructuredState: options.includeStructuredState ?? agentLoopInput.includeStructuredState,
    includeParentLinks: options.includeParentLinks ?? agentLoopInput.includeParentLinks,
    includeInactive: options.includeInactive ?? agentLoopInput.includeInactive,
    includeBlocked: options.includeBlocked ?? agentLoopInput.includeBlocked,
    includeHidden: options.includeHidden ?? agentLoopInput.includeHidden,
    maxDepth: options.maxDepth ?? agentLoopInput.maxDepth,
    relationType: options.relationType ?? agentLoopInput.relationType,
    relationTypes: options.relationTypes ?? agentLoopInput.relationTypes,
    travelMode: options.travelMode ?? agentLoopInput.travelMode,
    includeAbsurdity: options.includeAbsurdity ?? agentLoopInput.includeAbsurdity,
    useAbsurdityLlm: options.useAbsurdityLlm ?? agentLoopInput.useAbsurdityLlm,
    useAbsurdityExplanationLlm: options.useAbsurdityExplanationLlm ?? agentLoopInput.useAbsurdityExplanationLlm,
    forceAbsurdityExplanation: options.forceAbsurdityExplanation ?? agentLoopInput.forceAbsurdityExplanation,
    explainAbsurdityOnDryRun: options.explainAbsurdityOnDryRun ?? agentLoopInput.explainAbsurdityOnDryRun,
    absurdityRules: options.absurdityRules ?? agentLoopInput.absurdityRules,
    turnId,
    useLlmNarrative: options.useLlmNarrative !== false,
    useLlm: options.useLlm,
    configId: options.agentLoopConfigId || options.configId || options.loopConfigId || agentLoopInput.configId,
    loopConfigId: options.loopConfigId || agentLoopInput.loopConfigId,
    profileId: options.agentLoopProfileId || options.profileId || agentLoopInput.profileId,
    scope: options.loopScope || agentLoopInput.scope || 'chat',
    scopeId: options.loopScopeId || agentLoopInput.scopeId || chatSessionId,
    maxContextTokens: options.maxContextTokens ?? agentLoopInput.maxContextTokens,
    recentMessageCount: options.recentMessageCount ?? agentLoopInput.recentMessageCount,
    contextPlanner: options.contextPlanner ?? agentLoopInput.contextPlanner,
    contextPlannerInput: options.contextPlannerInput || agentLoopInput.contextPlannerInput,
    metadata: {
      ...(agentLoopInput.metadata && typeof agentLoopInput.metadata === 'object' ? agentLoopInput.metadata : {}),
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
      source: options.source || 'app.chat.send',
      userMessageId: userMessage.id
    },
    toolContext,
    phaseOverrides: phaseOverrides.length > 0 ? phaseOverrides : undefined
  });
}

function buildNarrativePhaseOverride(options = {}) {
  const promptTemplate = options.promptPreset?.mainPrompt;
  const config = stripUndefinedDeep({
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    extra: options.extra
  });
  if (!promptTemplate && Object.keys(config).length === 0) return undefined;
  return {
    id: 'narrative.render',
    promptTemplate,
    config
  };
}

function buildAppChatAgentLoopContext(options = {}) {
  return stripUndefinedDeep({
    source: 'app.chat.agent-loop',
    actor: { type: 'user', id: options.actor || 'user' },
    authorization: true,
    sceneId: options.sceneId || options.currentSceneId,
    api: options.api,
    llm: options.llm,
    llmPromptOverrides: options.llmPromptOverrides,
    agentAccessPolicy: options.agentAccessPolicy
  });
}

function resolveAppChatSceneId(runtime, chatSessionId, options = {}) {
  const explicit = firstNonEmptyRuntimeString(
    options.sceneId,
    options.currentSceneId,
    options.agentLoopInput?.sceneId,
    options.agentLoopInput?.currentSceneId,
    options.contextPlannerInput?.sceneId,
    options.agentLoopInput?.contextPlannerInput?.sceneId
  );
  if (explicit) return explicit;

  const activeSceneId = resolveLatestActiveSceneId(runtime, chatSessionId);
  if (activeSceneId) return activeSceneId;

  const structuredSceneId = resolveStructuredSceneId(runtime, chatSessionId);
  if (structuredSceneId) return structuredSceneId;

  return 'current';
}

function resolveLatestActiveSceneId(runtime, chatSessionId) {
  if (!runtime?.sceneManager?.listScenes || !chatSessionId) return '';
  try {
    const listed = runtime.sceneManager.listScenes({
      chatSessionId,
      status: 'active',
      limit: 5
    });
    const records = Array.isArray(listed?.records) ? listed.records : [];
    const latest = records.find((record) => firstNonEmptyRuntimeString(record?.data?.sceneId, record?.sceneId, record?.id));
    return firstNonEmptyRuntimeString(latest?.data?.sceneId, latest?.sceneId);
  } catch {
    return '';
  }
}

function resolveStructuredSceneId(runtime, chatSessionId) {
  if (!runtime?.structuredInterfaceStore?.load || !chatSessionId) return '';
  try {
    const loaded = runtime.structuredInterfaceStore.load(chatSessionId);
    const sceneMap = loaded?.state?.sceneMap || {};
    return firstNonEmptyRuntimeString(
      loaded?.state?.sceneId,
      loaded?.state?.currentSceneId,
      sceneMap.sceneId,
      sceneMap.currentSceneId
    );
  } catch {
    return '';
  }
}

function firstNonEmptyRuntimeString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

export function extractAgentLoopAssistantContent(loopOutput = {}) {
  const finalOutput = loopOutput.finalOutput || loopOutput;
  const narrative = finalOutput?.narrative || loopOutput.narrative || {};
  const content = String(narrative.content || '').trim();
  if (content) return formatNarrativeForChat(content, narrative, finalOutput, loopOutput);
  const draft = String(narrative.draft || '').trim();
  if (draft) return formatNarrativeForChat(draft, narrative, finalOutput, loopOutput);
  const layers = narrative.layers && typeof narrative.layers === 'object' ? narrative.layers : {};
  const layerText = formatNarrativeLines({
    sceneName: inferNarrativeSceneName(narrative, finalOutput, loopOutput),
    scene: layers.scene,
    npcs: layers.npcs,
    narrator: layers.narrator
  });
  if (layerText) return layerText;
  return '本轮 Agent 循环已完成，但没有生成可显示的叙事内容。请检查循环配置里的 narrative.render 阶段。';
}

function formatNarrativeForChat(rawContent, narrative = {}, finalOutput = {}, loopOutput = {}) {
  const text = String(rawContent || '').trim();
  if (!text) return '';
  if (!looksLikeStructuredNarrative(text)) return text;
  const parsed = safeParseNarrativeObject(text);
  if (!parsed) return text;
  const formatted = formatNarrativeObject(parsed, narrative, finalOutput, loopOutput);
  return formatted || text;
}

function looksLikeStructuredNarrative(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('```')) return true;
  return /"(scene|sceneName|mapName|location|npcs|npc|narrator|narration|dialogue|choices|outcome)"\s*:/i.test(trimmed)
    || /"(地图名|场景|地点|旁白|对话|行动结果|状态变化)"\s*:/.test(trimmed);
}

function safeParseNarrativeObject(text) {
  try {
    return parseFirstJsonObject(text);
  } catch {
    return undefined;
  }
}

function formatNarrativeObject(object = {}, narrative = {}, finalOutput = {}, loopOutput = {}) {
  const layers = object.layers && typeof object.layers === 'object' ? object.layers : {};
  const sceneObject = normalizeNarrativeObject(object.scene || object.sceneLayer || object.map || object.location);
  const sceneName = firstNarrativeText(
    object.mapName,
    object.sceneName,
    object.locationName,
    object.areaName,
    object.placeName,
    object['地图名'],
    object['场景名'],
    object['地点'],
    sceneObject.name,
    sceneObject.title,
    sceneObject.mapName,
    sceneObject.locationName,
    layers.mapName,
    inferNarrativeSceneName(narrative, finalOutput, loopOutput)
  ) || '当前场景';
  const scene = firstNarrativeText(
    object.sceneDialogue,
    object.sceneText,
    object.sceneDescription,
    object.description,
    object.environment,
    object['场景对话'],
    object['场景描写'],
    object['环境描写'],
    sceneObject.dialogue,
    sceneObject.text,
    sceneObject.content,
    sceneObject.description,
    layers.scene
  );
  const narrator = firstNarrativeText(
    object.narrator,
    object.narration,
    object.aside,
    object.gm,
    object['旁白'],
    object['旁白对话'],
    layers.narrator
  );
  const result = firstNarrativeText(
    object.outcome,
    object.result,
    object.resolution,
    object.actionResult,
    object['行动结果'],
    object['结果']
  );
  const stateChanges = firstNarrativeText(
    object.stateChanges,
    object.statusChanges,
    object.changes,
    object.effects,
    object['状态变化'],
    object['变化']
  );
  const choices = normalizeNarrativeList(
    object.choices
    || object.options
    || object.followUps
    || object['可选项']
    || object['后续选择']
  );
  return formatNarrativeLines({
    sceneName,
    scene,
    npcs: object.npcs || object.npcDialogues || object.dialogues || object['NPC'] || object['npc'] || layers.npcs,
    narrator,
    result,
    stateChanges,
    choices
  });
}

function formatNarrativeLines({ sceneName = '当前场景', scene, npcs, narrator, result, stateChanges, choices } = {}) {
  const lines = [];
  const sceneText = normalizeNarrativeText(scene);
  if (sceneText) lines.push(`${sceneName || '当前场景'}：${sceneText}`);
  for (const npc of normalizeNarrativeNpcLines(npcs)) lines.push(npc);
  const narratorText = normalizeNarrativeText(narrator);
  if (narratorText) lines.push(`旁白：${narratorText}`);
  const resultText = normalizeNarrativeText(result);
  if (resultText) lines.push(`行动结果：${resultText}`);
  const stateText = normalizeNarrativeText(stateChanges);
  if (stateText) lines.push(`状态变化：${stateText}`);
  const choiceList = normalizeNarrativeList(choices);
  if (choiceList.length) lines.push(`接下来：${choiceList.join(' / ')}`);
  return lines.join('\n').trim();
}

function normalizeNarrativeNpcLines(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.trim() ? [`NPC：${value.trim()}`] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [`NPC：${item.trim()}`] : [];
      const object = normalizeNarrativeObject(item);
      const name = firstNarrativeText(object.name, object.npcName, object.speaker, object.character, object.id, 'NPC');
      const text = firstNarrativeText(object.dialogue, object.line, object.text, object.content, object.action, object.description);
      return text ? [`${name}：${text}`] : [];
    });
  }
  if (typeof value === 'object') {
    const object = normalizeNarrativeObject(value);
    const directText = firstNarrativeText(object.dialogue, object.line, object.text, object.content);
    if (directText) {
      const name = firstNarrativeText(object.name, object.npcName, object.speaker, object.character, object.id, 'NPC');
      return [`${name}：${directText}`];
    }
    return Object.entries(object)
      .map(([name, text]) => {
        const normalized = normalizeNarrativeText(text);
        return normalized ? `${name}：${normalized}` : '';
      })
      .filter(Boolean);
  }
  return [];
}

function normalizeNarrativeText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return normalizeNarrativeList(value).join('；');
  if (typeof value === 'object') {
    const object = normalizeNarrativeObject(value);
    const direct = firstNarrativeText(object.text, object.content, object.dialogue, object.description, object.summary);
    if (direct) return direct;
    return Object.entries(object)
      .map(([key, child]) => {
        const text = normalizeNarrativeText(child);
        return text ? `${key} ${text}` : '';
      })
      .filter(Boolean)
      .join('；');
  }
  return String(value).trim();
}

function normalizeNarrativeList(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => normalizeNarrativeText(item))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNarrativeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNarrativeText(...values) {
  for (const value of values) {
    const text = normalizeNarrativeText(value);
    if (text) return text;
  }
  return '';
}

function inferNarrativeSceneName(narrative = {}, finalOutput = {}, loopOutput = {}) {
  const candidates = [
    narrative.sceneName,
    narrative.mapName,
    narrative.locationName,
    finalOutput.sceneName,
    finalOutput.mapName,
    finalOutput.locationName,
    loopOutput.sceneName,
    loopOutput.mapName,
    loopOutput.locationName,
    finalOutput.contextPlan?.sceneName,
    finalOutput.contextPlan?.locationName,
    finalOutput.minimalContext?.sceneName,
    finalOutput.baseline?.sceneName
  ];
  return firstNarrativeText(...candidates);
}

function extractAgentLoopCompletion(loopOutput = {}) {
  const finalOutput = loopOutput.finalOutput || loopOutput;
  return finalOutput?.narrative?.completion || loopOutput.narrative?.completion;
}

function summarizeAgentLoopOutput(loopOutput = {}) {
  const finalOutput = loopOutput.finalOutput || loopOutput;
  return stripUndefinedDeep({
    turnId: loopOutput.turnId || finalOutput.turnId,
    configId: loopOutput.configId,
    profileId: finalOutput.profileId,
    sceneId: firstNonEmptyRuntimeString(loopOutput.sceneId, finalOutput.sceneId, finalOutput.request?.sceneId),
    dryRun: loopOutput.dryRun ?? finalOutput.dryRun,
    trace: loopOutput.trace || finalOutput.trace,
    steps: Array.isArray(loopOutput.steps)
      ? loopOutput.steps.map((step) => ({
        stepId: step.stepId,
        title: step.title,
        profileId: step.profileId,
        status: step.status,
        durationMs: step.durationMs
      }))
      : undefined,
    phases: Array.isArray(finalOutput.phases)
      ? finalOutput.phases.map((phase) => ({
        phaseId: phase.phaseId,
        title: phase.title,
        progressLabel: phase.progressLabel,
        status: phase.errors?.length ? 'error' : (phase.skipped ? 'skipped' : 'success'),
        durationMs: phase.durationMs,
        toolCallCount: phase.toolCalls?.length || 0
      }))
      : undefined,
    errors: loopOutput.errors?.length ? loopOutput.errors : finalOutput.errors,
    warnings: loopOutput.warnings?.length ? loopOutput.warnings : finalOutput.warnings
  });
}

function resolveRequestChatProvider(defaultProvider, options = {}) {
  const settings = normalizeRequestApiSettings(options.api || options.apiSettings);
  if (!settings || settings.provider === 'server') return defaultProvider;
  if (settings.provider === 'mock') {
    return new MockChatProvider({ name: 'ui-mock' });
  }
  if (settings.provider === 'ollama') {
    if (!settings.model) {
      const error = new Error('Ollama API settings require model');
      error.name = 'ApiSettingsValidationError';
      error.statusCode = 400;
      throw error;
    }
    return new OllamaProvider({
      baseUrl: settings.baseUrl || API_PROVIDER_DEFAULTS.ollama.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model
    });
  }
  if (isOpenAICompatibleProvider(settings.provider)) {
    if (!settings.model) {
      const label = API_PROVIDER_DEFAULTS[settings.provider]?.label || 'OpenAI Compatible';
      const error = new Error(`${label} API settings require model`);
      error.name = 'ApiSettingsValidationError';
      error.statusCode = 400;
      throw error;
    }
    const defaults = API_PROVIDER_DEFAULTS[settings.provider] || API_PROVIDER_DEFAULTS['openai-compatible'];
    return new OpenAICompatibleProvider({
      baseUrl: settings.baseUrl || defaults.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model
    });
  }
  const error = new Error(`Unsupported API provider: ${settings.provider}`);
  error.name = 'ApiSettingsValidationError';
  error.statusCode = 400;
  throw error;
}

async function testRequestApiSettings(input = {}) {
  const settings = normalizeRequestApiSettings(input);
  const startedAt = Date.now();
  if (!settings || settings.provider === 'server') {
    return {
      ok: true,
      provider: 'server',
      message: 'Using server default chat API settings.',
      latencyMs: Date.now() - startedAt
    };
  }
  if (settings.provider === 'mock') {
    return {
      ok: true,
      provider: 'mock',
      message: 'Mock provider is available.',
      latencyMs: Date.now() - startedAt
    };
  }
  if (settings.provider === 'ollama') {
    if (!settings.model) throw apiSettingsValidationError('Ollama API settings require model');
    const baseUrl = (settings.baseUrl || API_PROVIDER_DEFAULTS.ollama.baseUrl).replace(/\/$/, '');
    const json = await fetchProviderJson(`${baseUrl}/api/tags`, settings);
    const modelNames = Array.isArray(json.models)
      ? json.models.map((model) => model.name || model.model).filter(Boolean)
      : [];
    return {
      ok: true,
      provider: settings.provider,
      baseUrl,
      model: settings.model,
      modelFound: modelNames.length ? modelNames.includes(settings.model) : undefined,
      availableModels: modelNames.slice(0, 20),
      latencyMs: Date.now() - startedAt
    };
  }
  if (isOpenAICompatibleProvider(settings.provider)) {
    if (!settings.model) {
      const label = API_PROVIDER_DEFAULTS[settings.provider]?.label || 'OpenAI Compatible';
      throw apiSettingsValidationError(`${label} API settings require model`);
    }
    const defaults = API_PROVIDER_DEFAULTS[settings.provider] || API_PROVIDER_DEFAULTS['openai-compatible'];
    const baseUrl = (settings.baseUrl || defaults.baseUrl).replace(/\/$/, '');
    const json = await fetchProviderJson(`${baseUrl}/models`, settings);
    const modelNames = Array.isArray(json.data)
      ? json.data.map((model) => model.id || model.name).filter(Boolean)
      : [];
    return {
      ok: true,
      provider: settings.provider,
      baseUrl,
      model: settings.model,
      modelFound: modelNames.length ? modelNames.includes(settings.model) : undefined,
      availableModels: modelNames.slice(0, 20),
      latencyMs: Date.now() - startedAt
    };
  }
  throw apiSettingsValidationError(`Unsupported API provider: ${settings.provider}`);
}

async function fetchProviderJson(url, settings = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {})
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Connection test failed: ${response.status} ${body.slice(0, 600)}`);
    }
    if (!body.trim()) return {};
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error(`Connection test returned non-JSON response: ${error.message}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Connection test timed out after 10s');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function apiSettingsValidationError(message) {
  const error = new Error(message);
  error.name = 'ApiSettingsValidationError';
  error.statusCode = 400;
  return error;
}

function normalizeRequestApiSettings(input) {
  if (!input || typeof input !== 'object') return undefined;
  const provider = String(input.provider || 'server').trim();
  return {
    provider,
    baseUrl: String(input.baseUrl || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    model: String(input.model || '').trim()
  };
}

const API_PROVIDER_DEFAULTS = Object.freeze({
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1'
  },
  'openai-compatible': {
    label: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1'
  },
  'llama.cpp': {
    label: 'llama.cpp',
    baseUrl: 'http://127.0.0.1:8080/v1'
  },
  vllm: {
    label: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1'
  },
  tabbyapi: {
    label: 'TabbyAPI',
    baseUrl: 'http://127.0.0.1:5000/v1'
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434'
  },
  'lm-studio': {
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1'
  },
  koboldcpp: {
    label: 'KoboldCpp',
    baseUrl: 'http://127.0.0.1:5001/v1'
  }
});

const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  'openai',
  'openai-compatible',
  'llama.cpp',
  'vllm',
  'tabbyapi',
  'lm-studio',
  'koboldcpp'
]);

function isOpenAICompatibleProvider(provider) {
  return OPENAI_COMPATIBLE_PROVIDERS.has(provider);
}

function redactRuntimeOptions(options = {}) {
  const redacted = { ...options };
  if (redacted.api) {
    redacted.api = redactApiSettings(redacted.api);
  }
  if (redacted.apiSettings) {
    redacted.apiSettings = redactApiSettings(redacted.apiSettings);
  }
  return redacted;
}

function redactApiSettings(settings = {}) {
  return {
    ...settings,
    apiKey: settings.apiKey ? '[redacted]' : ''
  };
}

function normalizeRuntimeAgentAccessPolicy(input) {
  if (!input || typeof input !== 'object') return undefined;
  const normalizeResource = (resource) => ({
    read: input[resource]?.read !== false,
    write: input[resource]?.write !== false
  });
  const normalizeSpecificResource = (resource, fallbackResource) => ({
    read: input[resource]?.read ?? input[fallbackResource]?.read ?? true,
    write: input[resource]?.write ?? input[fallbackResource]?.write ?? true
  });
  return {
    database: normalizeResource('database'),
    databaseL1: normalizeSpecificResource('databaseL1', 'database'),
    databaseL2: normalizeSpecificResource('databaseL2', 'database'),
    databaseL3: normalizeSpecificResource('databaseL3', 'database'),
    rag: normalizeResource('rag'),
    permanentRag: normalizeSpecificResource('permanentRag', 'rag'),
    runtimeRag: normalizeSpecificResource('runtimeRag', 'rag')
  };
}

function agentAccessAllows(policy, resource, operation) {
  if (!policy) return true;
  return policy[resource]?.[operation] !== false;
}

function snapshotRuntimeSession(session = {}) {
  return {
    id: session.id,
    userName: session.userName,
    playerPersona: session.playerPersona,
    collection: session.collection,
    characterCard: session.characterCard,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : [],
    metadata: session.metadata || {},
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function resolveRuntimeMessageCutoff(messages = [], { messageId, index } = {}) {
  if (Number.isInteger(index)) return index;
  if (messageId) {
    const found = messages.findIndex((message) => message.id === messageId);
    if (found === -1) {
      const error = new Error(`Runtime message not found: ${messageId}`);
      error.name = 'RuntimeMessageNotFoundError';
      error.statusCode = 404;
      throw error;
    }
    return found;
  }
  return messages.length - 1;
}

function exportScopedDataRecords(dataManager, criteria = {}) {
  const scope = { ...criteria };
  if (!dataManager) return { database: 'global-data', scope, collections: [] };
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
  return { database: 'global-data', scope, collections };
}

function importScopedDataRecords(dataManager, snapshot, remap = {}, defaultScope = {}) {
  if (!dataManager || !snapshot?.collections) return { importedCollections: [] };
  const importedCollections = [];
  for (const collection of snapshot.collections || []) {
    const name = collection.collection || collection.name;
    const records = [];
    for (const record of collection.records || []) {
      const data = remapResourceData(applyResourceScopeDefaults(record.data || record, defaultScope), remap);
      const id = remapResourceId(record.id || data.id, remap);
      records.push(dataManager.upsertRecord(name, data, { id }));
    }
    importedCollections.push({ collection: name, records: records.length });
  }
  return { importedCollections };
}

function exportScopedRagDocuments(ragService, criteria = {}) {
  const scope = { ...criteria };
  if (!ragService) return emptyRagSnapshot(scope);
  const collections = [];
  for (const collectionInfo of ragService.listCollections()) {
    const collection = collectionInfo.collection;
    const documents = ragService.listDocuments({ collection, limit: 100000 }).documents
      .filter((document) => resourceMatchesScope(document.metadata || {}, criteria))
      .map((document) => ({
        id: document.id,
        text: document.text,
        vector: document.vector,
        metadata: document.metadata || {}
      }));
    if (documents.length > 0) {
      collections.push({ collection, documents });
    }
  }
  return { scope, collections };
}

async function importScopedRagDocuments(ragService, snapshot, remap = {}, defaultScope = {}) {
  if (!ragService || !snapshot?.collections) return { importedCollections: [] };
  const importedCollections = [];
  for (const collection of snapshot.collections || []) {
    let count = 0;
    for (const document of collection.documents || []) {
      await ragService.upsertDocument({
        collection: collection.collection,
        id: remapResourceId(document.id, remap),
        text: document.text,
        vector: document.vector,
        metadata: remapResourceData(
          applyResourceScopeDefaults(document.metadata || {}, defaultScope),
          remap,
          { remapSourceId: true }
        )
      });
      count += 1;
    }
    importedCollections.push({ collection: collection.collection, documents: count });
  }
  return { importedCollections };
}

function emptyRagSnapshot(scope = {}) {
  return { scope, collections: [] };
}

function emptyImportedResources() {
  return {
    globalData: { importedCollections: [] },
    runtimeRag: { importedCollections: [] },
    permanentRag: { importedCollections: [] }
  };
}

function selectInitializationPlayerState({ states = [], existingContext = {} } = {}) {
  const records = Array.isArray(states) ? states.filter(Boolean) : [];
  if (existingContext?.controlledActorId) {
    const matched = records.find((record) => {
      const actor = compactInitializationPlayerState(record);
      return actor.actorId === existingContext.controlledActorId
        || actor.playerId === existingContext.controlledActorId;
    });
    if (matched) return matched;
  }
  const protagonists = records.filter((record) => compactInitializationPlayerState(record).isProtagonist === true);
  if (protagonists.length === 1) return protagonists[0];
  if (protagonists.length > 1) return undefined;
  return records.length === 1 ? records[0] : undefined;
}

function compactInitializationPlayerState(record = {}) {
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  const actorId = firstNonEmptyRuntimeString(data.npcId, data.playerId, data.protagonistId, data.id, record.id);
  return stripUndefinedDeep({
    recordId: record.id || data.id,
    actorId,
    playerId: firstNonEmptyRuntimeString(data.playerId, data.protagonistId, actorId),
    name: firstNonEmptyRuntimeString(data.name, data.displayName, actorId),
    sceneId: firstNonEmptyRuntimeString(data.sceneId, 'current'),
    actorType: data.actorType || data.type,
    isPlayer: data.isPlayer,
    isProtagonist: data.isProtagonist,
    greeting: firstNonEmptyRuntimeString(
      data.greeting,
      data.initialGreeting,
      data.initialSituation,
      data.openingSituation,
      data.metadata?.greeting
    ),
    source: data.source
  });
}

function compactActorControlMetadata(context = {}) {
  return stripUndefinedDeep({
    chatSessionId: context.chatSessionId,
    sceneId: context.sceneId,
    controlledActorId: context.controlledActorId,
    controlledActorTitle: context.controlledActorTitle,
    controlledPlayerId: context.controlledPlayerId,
    viewpointActorId: context.viewpointActorId,
    embodiedActorId: context.embodiedActorId,
    inputAuthority: context.inputAuthority,
    canAssertWorldFacts: context.canAssertWorldFacts,
    canAssertNpcDecisions: context.canAssertNpcDecisions,
    source: context.source
  });
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

function applyResourceScopeDefaults(data = {}, defaultScope = {}) {
  if (!defaultScope.lifecycleScope || hasExplicitResourceLifecycle(data)) return data;
  const next = {
    ...defaultScope,
    ...data
  };
  if (next.lifecycleScope !== 'chat') {
    delete next.chatSessionId;
  }
  if (next.lifecycleScope === 'global') {
    delete next.characterCardId;
  }
  return next;
}

function hasExplicitResourceLifecycle(data = {}) {
  if (!data || typeof data !== 'object') return false;
  return data.lifecycleScope !== undefined
    || data.lifecycleLevel !== undefined
    || data.importanceLevel !== undefined
    || data.characterCardId !== undefined
    || data.chatSessionId !== undefined
    || data.resourceLifecycle !== undefined
    || data.metadata?.resourceLifecycle !== undefined;
}

function remapResourceData(data = {}, remap = {}, { remapSourceId = false } = {}) {
  const next = clonePlain(data);
  remapLifecycleObject(next, remap);
  if (next.resourceLifecycle && typeof next.resourceLifecycle === 'object') {
    remapLifecycleObject(next.resourceLifecycle, remap);
  }
  if (next.metadata?.resourceLifecycle && typeof next.metadata.resourceLifecycle === 'object') {
    remapLifecycleObject(next.metadata.resourceLifecycle, remap);
  }
  if (remapSourceId && next.sourceId) {
    next.sourceId = remapResourceId(next.sourceId, remap);
  }
  return next;
}

function remapLifecycleObject(target, remap = {}) {
  if (!target || typeof target !== 'object') return;
  if (remap.toCharacterCardId && (!remap.fromCharacterCardId || target.characterCardId === remap.fromCharacterCardId)) {
    target.characterCardId = remap.toCharacterCardId;
  }
  if (remap.toChatSessionId && (!remap.fromChatSessionId || target.chatSessionId === remap.fromChatSessionId)) {
    target.chatSessionId = remap.toChatSessionId;
  }
  if (remap.toChatSessionId && target.lifecycleScope === 'chat') {
    target.lifecycleInherited = false;
  }
}

function remapResourceId(id, remap = {}) {
  const value = String(id || '');
  if (!value) return value;
  if (remap.toChatSessionId) return `${value}__chat_${safeSegment(remap.toChatSessionId)}`.slice(0, 220);
  if (remap.toCharacterCardId && remap.fromCharacterCardId && remap.toCharacterCardId !== remap.fromCharacterCardId) {
    return `${value}__char_${safeSegment(remap.toCharacterCardId)}`.slice(0, 220);
  }
  return value;
}

function normalizeSettlementNotice(input = {}) {
  const chatSessionId = normalizeOptionalString(input.chatSessionId || input.chatId || input.sessionId);
  if (!chatSessionId) return undefined;
  const category = settlementNoticeCategory(input.toolId || input.collection || input.type || '');
  return {
    id: input.id,
    chatSessionId,
    turnId: normalizeOptionalString(input.turnId),
    toolId: normalizeOptionalString(input.toolId),
    phaseId: normalizeOptionalString(input.phaseId),
    collection: normalizeOptionalString(input.collection),
    recordId: normalizeOptionalString(input.recordId),
    type: input.type || category?.type || 'data',
    title: input.title || category?.title || '数据变化',
    text: input.text || input.message || `${category?.subject || '数据'}已更新`,
    detail: input.detail || '',
    status: input.status || 'success',
    mergeKey: normalizeOptionalString(input.mergeKey),
    importance: normalizeOptionalString(input.importance)
  };
}

function resolveSettlementChatSessionId({ input, context, output } = {}) {
  return normalizeOptionalString(
    input?.chatSessionId
    || input?.chatId
    || input?.sessionId
    || context?.chatSessionId
    || context?.chatId
    || context?.sessionId
    || context?.audit?.chatSessionId
    || output?.chatSessionId
    || output?.chatId
  );
}

function resolveDiceChatSessionId({ input, context, output } = {}) {
  return normalizeOptionalString(
    input?.chatSessionId
    || input?.chatId
    || input?.sessionId
    || context?.chatSessionId
    || context?.chatId
    || context?.sessionId
    || context?.agentLoop?.chatSessionId
    || context?.audit?.chatSessionId
    || output?.chatSessionId
    || output?.chatId
  );
}

function normalizeDiceRollNotice(input = {}) {
  const chatSessionId = normalizeOptionalString(input.chatSessionId || input.chatId || input.sessionId);
  const result = normalizeDiceResult(input.result || input.diceResult || input.output);
  if (!chatSessionId || !result) return undefined;
  const toolId = normalizeOptionalString(input.toolId || input.sourceToolId);
  return {
    id: normalizeOptionalString(input.id),
    chatSessionId,
    turnId: normalizeOptionalString(input.turnId),
    phaseId: normalizeOptionalString(input.phaseId),
    toolId,
    status: input.status || 'success',
    title: input.title || diceRollTitle(input.kind, result),
    kind: normalizeOptionalString(input.kind) || (toolId === 'game.dice.offer_inspiration_reroll' ? 'inspiration_reroll' : 'check'),
    path: normalizeOptionalString(input.path),
    input: clonePlain(input.input || input.diceInput || {}),
    result,
    originalResult: normalizeDiceResult(input.originalResult),
    inspiration: input.inspiration && typeof input.inspiration === 'object' ? clonePlain(input.inspiration) : undefined
  };
}

function diceRollNoticesFromToolResult({ toolId, input, output } = {}) {
  const id = String(toolId || '');
  if (!output || typeof output !== 'object') return [];
  if (/^system\.agent_loop\./.test(id)) return [];

  if (id === 'game.dice.check') {
    const result = normalizeDiceResult(output);
    return result ? [{
      kind: 'check',
      input: clonePlain(input || {}),
      result
    }] : [];
  }

  if (id === 'game.dice.offer_inspiration_reroll') {
    const result = normalizeDiceResult(output.rerollResult || output.finalResult);
    if (output.status !== 'rerolled' || !result) return [];
    return [{
      kind: 'inspiration_reroll',
      title: '激励重投结果',
      input: clonePlain(output.rerollInput || input?.diceInput || {}),
      result,
      originalResult: normalizeDiceResult(output.originalResult),
      inspiration: {
        before: output.inspirationBefore,
        after: output.inspirationAfter,
        resourceField: output.resourceField
      }
    }];
  }

  return [];
}

function normalizeDiceResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const outcome = normalizeOptionalString(value.outcome || value.result);
  const total = Number(value.total ?? value.effectiveTotal);
  const dice = value.dice && typeof value.dice === 'object' ? value.dice : {};
  const sides = Number(dice.sides ?? value.diceSides ?? value.sides);
  const count = Number(dice.count ?? value.diceCount ?? value.rollCount ?? value.count);
  const rolls = Array.isArray(value.rolls) ? value.rolls.map(Number).filter(Number.isFinite) : [];
  const looksLikeDice = ['success', 'failure', 'criticalSuccess', 'criticalFailure'].includes(outcome)
    && Number.isFinite(total)
    && (Number.isFinite(sides) || rolls.length > 0 || value.selectedAttempt);
  if (!looksLikeDice) return undefined;
  return clonePlain(value);
}

function diceRollTitle(kind, result = {}) {
  const outcome = result.outcome || '';
  if (kind === 'inspiration_reroll') return '激励重投结果';
  if (outcome === 'criticalSuccess') return '骰子大成功';
  if (outcome === 'criticalFailure') return '骰子大失败';
  return result.success ? '骰子成功' : '骰子失败';
}

function isActionAdjudicationTool(toolId) {
  return [
    'system.action.resolve',
    'system.action.resolve_with_appeal',
    'system.action.resolve_once',
    'system.persuasion.resolve',
    'system.npc_behavior.resolve',
    'system.environment_behavior.resolve'
  ].includes(String(toolId || ''));
}

function normalizeToolOutputForAdjudication(toolId, output = {}, input = {}) {
  const id = String(toolId || '');
  if (id === 'system.persuasion.resolve') return normalizePersuasionOutputForAdjudication(output, input);
  return output;
}

function normalizePersuasionOutputForAdjudication(output = {}, input = {}) {
  const resolution = normalizeObject(output.resolution);
  const judgement = normalizeObject(output.judgement);
  const dice = normalizeObject(output.dice?.output || output.diceResult || output.rollResult || output.dice);
  const status = normalizeOptionalString(output.status || resolution.outcome) || (resolution.success === false ? 'failure' : 'success');
  const actionId = normalizeOptionalString(judgement.judgementId || resolution.judgementId) || 'persuasion';
  const checkId = `${actionId}:check`;
  const checkInput = removeUndefined({
    successThreshold: resolution.effectiveThreshold ?? resolution.baseThreshold ?? dice.successThreshold ?? input.successThreshold ?? input.dc,
    diceCount: dice.dice?.count ?? input.diceCount ?? input.rollCount,
    diceSides: dice.dice?.sides ?? input.diceSides ?? input.sides,
    modifier: resolution.argumentBonus
  });
  const diceRecord = {
    id: checkId,
    tool: 'game.dice.check',
    input: checkInput,
    output: {
      ...dice,
      total: resolution.effectiveTotal ?? dice.total,
      successThreshold: resolution.effectiveThreshold ?? dice.successThreshold,
      modifierTotal: resolution.argumentBonus ?? dice.modifierTotal,
      success: resolution.success ?? dice.success,
      failure: resolution.failure ?? dice.failure,
      outcome: resolution.outcome || dice.outcome
    },
    outcome: resolution.outcome || dice.outcome,
    success: resolution.success ?? dice.success,
    failure: resolution.failure ?? dice.failure
  };
  return {
    status,
    prompt: output.prompt || '说服模块已完成裁定。',
    currentSummary: {
      status,
      actionId,
      diceResults: [compactDiceTotal(diceRecord)]
    },
    currentResolution: {
      status,
      sourceText: input.sourceText || input.text || input.content || judgement.approachSummary || '',
      plan: {
        actionId,
        sourceText: input.sourceText || input.text || input.content || judgement.approachSummary || '',
        intent: {
          label: '说服',
          summary: judgement.approachSummary || input.playerSpeech || input.speech || input.argument || '玩家尝试说服目标。',
          target: removeUndefined({
            id: judgement.targetNpcId || input.targetNpcId || input.npcId || input.targetId,
            kind: 'npc'
          })
        },
        checks: [{
          id: checkId,
          tool: 'game.dice.check',
          input: checkInput,
          reason: judgement.summary || resolution.judgementSummary || '说服话术评分与骰子结果合并。',
          metadata: removeUndefined({
            reasoningQuality: resolution.reasoningQuality || judgement.reasoningQuality,
            argumentBonus: resolution.argumentBonus,
            dcAdjustment: resolution.dcAdjustment,
            targetLikelyReaction: resolution.targetLikelyReaction || judgement.targetLikelyReaction
          })
        }],
        proposals: []
      },
      apply: {
        status,
        diceResults: [diceRecord],
        appliedToolCalls: [],
        failedToolCalls: [],
        skippedToolCalls: [],
        narrationHints: resolution.narrationHints
      }
    },
    final: output.final === true,
    appealAvailable: false
  };
}

function normalizeAdjudicationNotice(input = {}) {
  const chatSessionId = normalizeOptionalString(input.chatSessionId || input.chatId || input.sessionId);
  const output = input.output && typeof input.output === 'object' ? input.output : {};
  const resolution = output.currentResolution || output.finalResolution || output.resolution || output;
  const summary = output.currentSummary || summarizeAdjudicationResolution(resolution);
  if (!chatSessionId || !Object.keys(summary || {}).length) return undefined;
  const status = normalizeOptionalString(summary.status || resolution.status || output.resolutionStatus || output.status) || 'success';
  return {
    id: normalizeOptionalString(input.id),
    chatSessionId,
    turnId: normalizeOptionalString(input.turnId),
    phaseId: normalizeOptionalString(input.phaseId),
    toolId: normalizeOptionalString(input.toolId),
    title: adjudicationTitle({ status, summary, output }),
    status,
    loopStatus: normalizeOptionalString(output.status),
    resolutionStatus: status,
    final: output.final === true,
    appealAvailable: output.appealAvailable !== false && output.final !== true && status !== 'accepted',
    prompt: normalizeOptionalString(output.prompt),
    loopState: clonePlain(output.loopState),
    choices: Array.isArray(output.choices)
      ? output.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        requiresPlayerInput: choice.requiresPlayerInput === true
      }))
      : [],
    summary: clonePlain(summary),
    resolution: compactAdjudicationResolution(resolution),
    rejudgement: compactRejudgement(output.rejudgement || resolution.rejudgement)
  };
}

function compactAdjudicationResolution(resolution = {}) {
  const applyWrapper = normalizeObject(resolution.apply || resolution.application?.apply || resolution);
  const apply = normalizeObject(applyWrapper.apply || applyWrapper);
  const plan = normalizeObject(resolution.plan || applyWrapper.plan || apply.plan || resolution.currentPlan);
  const checks = Array.isArray(plan.checks)
    ? plan.checks
    : Array.isArray(resolution.checks)
      ? resolution.checks
      : [];
  const diceResults = Array.isArray(apply.diceResults)
    ? apply.diceResults
    : Array.isArray(resolution.diceTotals)
      ? resolution.diceTotals
      : [];
  const checkById = new Map(diceResults.map((record) => [record.id || record.checkId, record]));
  return removeUndefined({
    status: normalizeOptionalString(resolution.status || apply.status),
    actionId: normalizeOptionalString(plan.actionId || apply.plan?.actionId),
    sourceText: normalizeOptionalString(plan.sourceText || resolution.sourceText),
    resolutionMode: normalizeOptionalString(plan.metadata?.resolutionMode || apply.plan?.metadata?.resolutionMode),
    intent: compactIntent(plan.intent),
    checks: checks.map((check) => compactAdjudicationCheck(check, checkById.get(check.id))),
    diceTotals: diceResults.map((record) => compactDiceTotal(record)),
    proposals: Array.isArray(plan.proposals)
      ? plan.proposals.map((proposal) => ({
        id: proposal.id,
        when: proposal.when,
        tool: proposal.tool,
        summary: proposal.metadata?.summary || proposal.description || proposal.reason || ''
      }))
      : [],
    appliedToolCalls: compactToolCallList(apply.appliedToolCalls),
    failedToolCalls: compactToolCallList(apply.failedToolCalls),
    skippedToolCalls: compactToolCallList(apply.skippedToolCalls),
    riskSummary: compactRiskSummary(apply.riskReport),
    narrationHints: clonePlain(apply.narrationHints || plan.narrationHints),
    absurdity: compactAbsurdity(resolution.absurdityJudgement, resolution.absurdityExplanation),
    rejudgement: compactRejudgement(resolution.rejudgement)
  });
}

function summarizeAdjudicationResolution(resolution = {}) {
  const compact = compactAdjudicationResolution(resolution);
  return removeUndefined({
    status: compact.status,
    actionId: compact.actionId,
    resolutionMode: compact.resolutionMode,
    appliedToolCallCount: compact.appliedToolCalls?.length,
    failedToolCallCount: compact.failedToolCalls?.length,
    skippedToolCallCount: compact.skippedToolCalls?.length,
    appliedToolCalls: compact.appliedToolCalls,
    failedToolCalls: compact.failedToolCalls,
    diceResults: compact.diceTotals?.map((item) => ({
      checkId: item.checkId,
      outcome: item.outcome,
      total: item.total,
      success: item.success
    })),
    riskSummary: compact.riskSummary,
    narrationHints: compact.narrationHints,
    appealDecision: compact.rejudgement?.decision
  });
}

function compactAdjudicationCheck(check = {}, diceRecord = {}) {
  const diceInput = normalizeObject(check.input);
  const diceOutput = normalizeObject(diceRecord.output || diceRecord.result);
  return removeUndefined({
    id: check.id,
    tool: check.tool,
    threshold: diceInput.successThreshold ?? diceInput.dc ?? diceOutput.successThreshold,
    dice: diceInput.diceSides || diceInput.sides || diceOutput.dice?.sides
      ? `${diceInput.diceCount ?? diceInput.rollCount ?? diceOutput.dice?.count ?? 1}d${diceInput.diceSides ?? diceInput.sides ?? diceOutput.dice?.sides}`
      : undefined,
    modifierTotal: diceOutput.modifierTotal ?? diceInput.modifier,
    modifierSources: compactModifierSources(diceInput, diceOutput),
    metadata: clonePlain(check.metadata),
    reason: normalizeOptionalString(check.reason || check.description || check.metadata?.reason),
    diceTotal: diceOutput.total,
    outcome: diceOutput.outcome || diceRecord.outcome,
    success: diceOutput.success ?? diceRecord.success
  });
}

function compactModifierSources(diceInput = {}, diceOutput = {}) {
  const sources = [];
  const push = (name, value, reason) => {
    const number = Number(value);
    if (Number.isFinite(number) && number !== 0) sources.push({ name, value: number, reason });
  };
  push('固定修正', diceInput.modifier ?? diceInput.fixedModifier, 'diceInput.modifier');
  push('增益', diceInput.buff, 'diceInput.buff');
  push('减益', diceInput.debuff === undefined ? undefined : -Number(diceInput.debuff), 'diceInput.debuff');
  push('属性', diceInput.abilityModifier, 'diceInput.abilityModifier');
  push('熟练', diceInput.proficiencyBonus, 'diceInput.proficiencyBonus');
  for (const modifier of Array.isArray(diceInput.modifiers) ? diceInput.modifiers : []) {
    push(modifier.name || '自定义修正', modifier.value, 'diceInput.modifiers');
  }
  if (!sources.length && Array.isArray(diceOutput.modifierBreakdown)) {
    for (const modifier of diceOutput.modifierBreakdown) {
      push(modifier.name || '修正', modifier.value, 'diceResult.modifierBreakdown');
    }
  }
  return sources;
}

function compactDiceTotal(record = {}) {
  const output = normalizeObject(record.output || record.result || record);
  return removeUndefined({
    checkId: record.id || record.checkId,
    total: output.total ?? record.total,
    outcome: output.outcome || record.outcome,
    success: output.success ?? record.success,
    threshold: output.successThreshold,
    modifierTotal: output.modifierTotal,
    criticalSuccess: output.criticalSuccess ?? record.criticalSuccess,
    criticalFailure: output.criticalFailure ?? record.criticalFailure
  });
}

function compactIntent(intent = {}) {
  if (!intent || typeof intent !== 'object') return undefined;
  return removeUndefined({
    label: intent.label,
    summary: intent.summary,
    target: intent.target
  });
}

function compactToolCallList(list) {
  return Array.isArray(list)
    ? list.map((call) => removeUndefined({
      id: call.id,
      phase: call.phase,
      tool: call.tool,
      reason: call.reason,
      status: call.status,
      error: call.error?.message || call.error?.name || call.error
    }))
    : [];
}

function compactRiskSummary(riskReport = {}) {
  if (!riskReport || typeof riskReport !== 'object') return undefined;
  return removeUndefined({
    summary: riskReport.summary,
    allowed: riskReport.allowed,
    requestedAllowedTools: riskReport.requestedAllowedTools,
    effectiveAllowedTools: riskReport.effectiveAllowedTools,
    blocked: Array.isArray(riskReport.toolCalls)
      ? riskReport.toolCalls
        .filter((call) => call.allowed === false)
        .map((call) => ({ id: call.id, phase: call.phase, tool: call.tool, reason: call.blockReason }))
      : undefined
  });
}

function compactAbsurdity(absurdityJudgement, absurdityExplanation) {
  const judgement = normalizeObject(absurdityJudgement?.judgement || absurdityJudgement);
  const explanation = normalizeObject(absurdityExplanation?.explanation || absurdityExplanation);
  if (!Object.keys(judgement).length && !Object.keys(explanation).length) return undefined;
  return removeUndefined({
    status: judgement.status,
    level: judgement.absurdityLevel,
    summary: judgement.summary,
    canAttempt: judgement.canAttempt,
    shouldRollOrResolve: judgement.shouldRollOrResolve,
    requiresExplanationOnSuccess: judgement.requiresAbsurdityExplanationOnSuccess,
    factors: Array.isArray(judgement.factors)
      ? judgement.factors.map((factor) => ({
        name: factor.name,
        judgement: factor.judgement,
        supportsAttempt: factor.supportsAttempt,
        note: factor.note
      }))
      : undefined,
    explanation: explanation.explanation,
    acceptedOutcome: explanation.acceptedOutcome,
    consequences: explanation.consequences,
    followUpHooks: explanation.followUpHooks
  });
}

function compactRejudgement(rejudgement = {}) {
  const decision = normalizeObject(rejudgement.decision || rejudgement);
  if (!Object.keys(decision).length) return undefined;
  return removeUndefined({
    decision: {
      appealId: decision.appealId,
      status: decision.status,
      summary: decision.summary,
      playerArgument: decision.playerArgument,
      requestedOutcome: decision.requestedOutcome,
      correction: decision.correction,
      findings: decision.findings,
      narrationGuidance: decision.narrationGuidance
    },
    applicationStatus: rejudgement.application?.status
  });
}

function adjudicationTitle({ status, summary, output } = {}) {
  if (output?.rejudgement?.decision) return '重新裁决结果';
  if (status === 'failure' || summary?.status === 'failure') return '裁决失败';
  if (status === 'partial_failure' || summary?.status === 'partial_failure') return '裁决部分完成';
  return '裁决结果';
}

function isSettlementToolResult({ tool, toolId } = {}) {
  const id = String(toolId || tool?.id || '').toLowerCase();
  if (!id) return false;
  if (tool?.mutatesState === true) return !isReadOnlySettlementToolId(id);
  return isWriteLikeSettlementToolId(id);
}

function isReadOnlySettlementToolId(toolId) {
  return /(\.list_|\.get_|\.query_|\.search_|\.find_|\.describe_|\.export_|context_planner|agent_loop|rag\.search|worldbook)/.test(String(toolId || '').toLowerCase());
}

function isWriteLikeSettlementToolId(toolId) {
  const text = String(toolId || '').toLowerCase();
  if (isReadOnlySettlementToolId(text)) return false;
  return /(upsert|patch|delete|import|apply|resolve|commit|update|set_|clear_|start|end|advance|tick|create|spend|use|equip|unequip|switch|enter|expire)/.test(text);
}

function settlementNoticeCategory(source = '') {
  const text = String(source || '').toLowerCase();
  if (/system\.npc_behavior\.resolve/.test(text)) {
    return { type: 'npc-behavior', title: 'NPC自发行为', subject: 'NPC自发行为' };
  }
  if (/system\.environment_behavior\.resolve/.test(text)) {
    return { type: 'environment-behavior', title: '环境自发行为', subject: '环境自发行为' };
  }
  if (/inventory|item|equipment|loot|resource/.test(text)) return { type: 'inventory', title: '背包变化', subject: '背包' };
  if (/status|effect|time|clock|trigger/.test(text)) return { type: 'status', title: '状态变化', subject: '状态' };
  if (/npc|actor|party|relationship|faction|protagonist/.test(text)) return { type: 'npc', title: '人物变化', subject: 'NPC' };
  if (/map|scene|location|route|path/.test(text)) return { type: 'map', title: '地图变化', subject: '地图' };
  if (/quest|encounter/.test(text)) return { type: 'quest', title: '任务变化', subject: '任务' };
  if (/combat|battle|damage|dice/.test(text)) return { type: 'combat', title: '战斗变化', subject: '战斗' };
  if (/memory|rag|compression/.test(text)) return { type: 'memory', title: '记忆变化', subject: '记忆' };
  return { type: 'data', title: '数据变化', subject: '数据' };
}

function buildSettlementNoticeFromToolResult({ tool, toolId, input, output, context } = {}) {
  const id = String(toolId || tool?.id || '');
  if (!id || shouldSuppressSettlementNotice({ toolId: id, input, output, context })) return undefined;
  const category = settlementNoticeCategory(id);
  if (!category) return undefined;
  const custom = combatSettlementNotice(id, output, input)
    || behaviorSettlementNotice(id, output)
    || effectSettlementNotice(id, output)
    || resourceSettlementNotice(id, output, input)
    || genericSettlementNotice(id, output);
  return removeUndefined({
    type: custom.type || category.type,
    title: custom.title || category.title,
    text: custom.text || `${category.subject}已结算`,
    detail: custom.detail ?? settlementNoticeDetail(id, output),
    mergeKey: custom.mergeKey || settlementNoticeMergeKey(id, input, output),
    importance: custom.importance || 'normal'
  });
}

function shouldSuppressSettlementNotice({ toolId, context } = {}) {
  const id = String(toolId || '').toLowerCase();
  const parentToolId = String(context?.parentToolId || '').toLowerCase();
  const source = String(context?.source || '').toLowerCase();
  if (id === 'system.resources.reset_action_economy' && /combat-overlay/.test(source)) return true;
  if (!parentToolId) return false;
  if (/^system\.combat\.(resolve_action|resolve_enemy_turn|judge_special_action|start_battle|end_battle)/.test(parentToolId)) {
    return /^system\.effects\.(apply|preview)_settlement/.test(id)
      || /^system\.resources\.(reset_action_economy|spend_action_economy|restore_action_economy)/.test(id)
      || /^system\.modifiers\./.test(id);
  }
  return false;
}

function combatSettlementNotice(toolId, output = {}, input = {}) {
  const id = String(toolId || '').toLowerCase();
  if (!/^system\.combat\./.test(id)) return undefined;
  if (/start_battle/.test(id)) {
    const battle = normalizeObject(output.battle?.data || output.battle || output);
    const name = battle.name || input.name || output.decision?.battleName || '遭遇战';
    return {
      type: 'combat',
      title: '战斗开始',
      text: `战斗开始：${name}`,
      detail: [
        battle.objective || output.decision?.objective,
        listCountText('参战', battle.participantIds || output.decision?.participantIds)
      ].filter(Boolean).join(' · ')
    };
  }
  if (/end_battle/.test(id)) {
    const battle = normalizeObject(output.battle?.data || output.battle || {});
    const aftermath = normalizeObject(output.aftermath);
    const outcome = battle.status || aftermath.outcome || input.outcome || input.status || 'ended';
    return {
      type: 'combat',
      title: combatOutcomeTitle(outcome),
      text: `战斗结束：${combatOutcomeLabel(outcome)}`,
      detail: aftermath.narrativeSummary || input.summary || output.event?.data?.summary || ''
    };
  }
  if (/judge_special_action/.test(id)) {
    const judgement = normalizeObject(output.judgement);
    return {
      type: 'combat',
      title: '特殊动作裁定',
      text: judgement.summary || judgement.rulingGuidance || '特殊动作已裁定',
      detail: [judgement.actionMode, judgement.consumesResourcesAfterResolution === false ? '不消耗资源' : '等待后续结算'].filter(Boolean).join(' · ')
    };
  }
  if (/resolve_enemy_turn/.test(id)) {
    if (output.actionResult) {
      return combatActionSettlementNotice(output.actionResult, {
        title: '敌方行动',
        fallbackActorId: output.actorId,
        fallbackTargetId: output.targetId
      });
    }
    const selected = normalizeObject(output.ordinaryAction?.selected);
    const mode = selected.mode || output.actionKind || '行动';
    const actor = actorLabel(output.actorId);
    return {
      type: 'combat',
      title: '敌方行动',
      text: `${actor}${combatModeText(mode)}`,
      detail: effectSettlementDetail(output.settlement) || resourceCostDetail(output.costApplications)
    };
  }
  if (/resolve_action/.test(id)) {
    return combatActionSettlementNotice(output, { title: '战斗结算' });
  }
  return undefined;
}

function combatActionSettlementNotice(result = {}, { title = '战斗结算', fallbackActorId = '', fallbackTargetId = '' } = {}) {
  if (!result || typeof result !== 'object') return undefined;
  if (result.ok === false || result.status === 'blocked') {
    const action = normalizeObject(result.action);
    return {
      type: 'combat',
      title: '动作受阻',
      text: `${actorLabel(action.actorId || fallbackActorId)}动作无法执行`,
      detail: blockedCombatDetail(result)
    };
  }
  const action = normalizeObject(result.action);
  const settlement = normalizeObject(result.settlement);
  const target = firstSettlementTarget(settlement, action.targetIds?.[0] || fallbackTargetId);
  const actorState = normalizeObject(result.actorState?.data || result.actorState);
  const actor = actorLabel(actorState.name || action.metadata?.actorName || action.actorName || action.actorId || fallbackActorId);
  const targetName = actorLabel(target.name || target.targetId || action.targetIds?.[0] || fallbackTargetId || '目标');
  const hitState = combatHitState(result.attack);
  const totalDamage = firstFiniteNumber(settlement.totalDamage, target.totals?.damageToHp, target.totals?.damageAfterDefenses, 0) || 0;
  const totalHealing = firstFiniteNumber(settlement.totalHealing, target.totals?.healingApplied, 0) || 0;
  const statuses = settlementStatusNames(settlement);
  let text;
  if (hitState === 'miss') {
    text = `${actor}未命中${targetName}`;
  } else if (totalDamage > 0) {
    text = `${actor}命中${targetName}，造成 ${formatNumber(totalDamage)} 点伤害`;
  } else if (totalHealing > 0) {
    text = `${actor}治疗${targetName} ${formatNumber(totalHealing)} 点`;
  } else if (statuses.length) {
    text = `${actor}影响${targetName}：${statuses.slice(0, 3).join('，')}`;
  } else {
    text = `${actor}行动已结算`;
  }
  if (targetDefeated(target)) text += `，${targetName}倒下`;
  return {
    type: 'combat',
    title,
    text,
    detail: [
      meaningfulActionLabel(action),
      targetHpDetail(target),
      resourceCostDetail(result.costApplications),
      statuses.length ? `状态：${statuses.slice(0, 4).join('，')}` : ''
    ].filter(Boolean).join(' · ')
  };
}

function behaviorSettlementNotice(toolId, output) {
  const text = String(toolId || '').toLowerCase();
  const subject = /system\.npc_behavior\.resolve/.test(text)
    ? 'NPC'
    : /system\.environment_behavior\.resolve/.test(text)
      ? '环境'
      : '';
  if (!subject) return undefined;
  const detail = behaviorSettlementDetail(output, subject);
  const primary = detail.split(' · ').find(Boolean);
  return {
    type: subject === 'NPC' ? 'npc-behavior' : 'environment-behavior',
    title: subject === 'NPC' ? 'NPC自发行为' : '环境自发行为',
    text: primary || `${subject}自发行为已结算`,
    detail
  };
}

function effectSettlementNotice(toolId, output = {}) {
  const id = String(toolId || '').toLowerCase();
  if (!/^system\.effects\.(apply|preview)_settlement/.test(id)) return undefined;
  const target = firstSettlementTarget(output);
  const targetName = actorLabel(target.name || target.targetId || '目标');
  const damage = firstFiniteNumber(output.totalDamage, target.totals?.damageToHp, target.totals?.damageAfterDefenses, 0) || 0;
  const healing = firstFiniteNumber(output.totalHealing, target.totals?.healingApplied, 0) || 0;
  const statuses = settlementStatusNames(output);
  let text = `${targetName}状态已更新`;
  if (damage > 0) text = `${targetName}受到 ${formatNumber(damage)} 点伤害`;
  if (healing > 0) text = `${targetName}恢复 ${formatNumber(healing)} 点生命`;
  if (!damage && !healing && statuses.length) text = `${targetName}状态变化：${statuses.slice(0, 3).join('，')}`;
  if (targetDefeated(target)) text += `，${targetName}倒下`;
  return {
    type: 'status',
    title: '状态变化',
    text,
    detail: [targetHpDetail(target), statuses.length ? `状态：${statuses.slice(0, 4).join('，')}` : ''].filter(Boolean).join(' · ')
  };
}

function resourceSettlementNotice(toolId, output = {}, input = {}) {
  const id = String(toolId || '').toLowerCase();
  if (!/^system\.resources\./.test(id)) return undefined;
  const actor = actorLabel(output.actorId || input.npcId || input.actorId || input.playerId || '角色');
  if (/reset_action_economy/.test(id)) {
    return {
      type: 'status',
      title: '行动资源',
      text: `${actor}行动资源已刷新`,
      detail: actionEconomyDetail(output.actionEconomy)
    };
  }
  if (/spend_action_economy|restore_action_economy/.test(id)) {
    const resource = actionResourceLabel(output.resource || input.resource || input.actionType || 'action');
    const verb = /restore_action_economy/.test(id) ? '恢复' : '消耗';
    return {
      type: 'status',
      title: '行动资源',
      text: `${actor}${verb}${resource}`,
      detail: beforeAfterDetail(output.before, output.after)
    };
  }
  if (/consume_item/.test(id)) {
    return {
      type: 'inventory',
      title: '背包变化',
      text: `${actor}消耗 ${resourceName(output, input)} ×${formatNumber(output.amount || input.amount || input.quantity || 1)}`,
      detail: beforeAfterDetail(output.before, output.after)
    };
  }
  if (/spend_resource|restore_resource|set_resource|start_cooldown|tick_cooldowns/.test(id)) {
    return {
      type: /cooldown/.test(id) ? 'status' : 'inventory',
      title: /cooldown/.test(id) ? '状态变化' : '资源变化',
      text: resourceChangeText(id, actor, output, input),
      detail: resourceChangeDetail(output)
    };
  }
  return undefined;
}

function genericSettlementNotice(toolId, output) {
  const parts = [settlementNoticeDetail(toolId, output)].filter(Boolean);
  return {
    text: parts[0] || undefined,
    detail: parts.slice(1).join(' · ')
  };
}

function settlementNoticeDetail(toolId, output) {
  const text = String(toolId || '').toLowerCase();
  if (/system\.npc_behavior\.resolve/.test(text)) {
    return behaviorSettlementDetail(output, 'NPC');
  }
  if (/system\.environment_behavior\.resolve/.test(text)) {
    return behaviorSettlementDetail(output, '环境');
  }
  if (/^system\.effects\.(apply|preview)_settlement/.test(text)) {
    return effectSettlementDetail(output);
  }
  if (/^system\.combat\./.test(text)) {
    return combatSettlementNotice(toolId, output)?.text || '';
  }
  if (/^system\.resources\./.test(text)) {
    return resourceSettlementNotice(toolId, output)?.text || '';
  }
  const parts = [humanizeRuntimeToolId(toolId)];
  if (output && typeof output === 'object') {
    const count = firstFiniteNumber(
      output.count,
      output.updated,
      output.created,
      output.deleted,
      output.records?.length,
      output.nodes?.count,
      output.edges?.count,
      output.factions?.count,
      output.relations?.count,
      output.memberships?.count
    );
    if (count !== undefined) parts.push(`${count}项`);
  }
  return parts.filter(Boolean).join(' · ');
}

function settlementNoticeMergeKey(toolId, input = {}, output = {}) {
  return [
    toolId,
    input.chatSessionId || output.chatSessionId,
    input.battleId || output.battle?.data?.battleId || output.battleId,
    input.actorId || output.actorId || output.action?.actorId,
    input.targetId || output.targetId || output.action?.targetIds?.[0]
  ].filter(Boolean).join(':');
}

function effectSettlementDetail(output = {}) {
  if (!output || typeof output !== 'object') return '';
  const target = firstSettlementTarget(output);
  return [
    targetHpDetail(target),
    output.totalDamage ? `伤害 ${formatNumber(output.totalDamage)}` : '',
    output.totalHealing ? `治疗 ${formatNumber(output.totalHealing)}` : '',
    settlementStatusNames(output).length ? `状态：${settlementStatusNames(output).slice(0, 4).join('，')}` : ''
  ].filter(Boolean).join(' · ');
}

function firstSettlementTarget(settlement = {}, fallbackTargetId = '') {
  const targets = Array.isArray(settlement.targets) ? settlement.targets : [];
  return normalizeObject(targets[0] || (fallbackTargetId ? { targetId: fallbackTargetId } : {}));
}

function settlementStatusNames(settlement = {}) {
  const targets = Array.isArray(settlement.targets) ? settlement.targets : [];
  const names = [];
  for (const target of targets) {
    const statuses = normalizeObject(target.statuses);
    const added = Array.isArray(statuses.added) ? statuses.added : [];
    const removed = Array.isArray(statuses.removed) ? statuses.removed : [];
    const special = Array.isArray(statuses.specialStatuses) ? statuses.specialStatuses : [];
    for (const status of [...added, ...removed, ...special]) {
      const object = normalizeObject(status);
      const name = object.name || object.status || object.id || (typeof status === 'string' ? status : '');
      if (name) names.push(object._delete ? `移除${name}` : name);
    }
  }
  return [...new Set(names)];
}

function targetHpDetail(target = {}) {
  const hp = normalizeObject(target.hp);
  const before = firstFiniteNumber(hp.before);
  const after = firstFiniteNumber(hp.final, hp.afterHealing, hp.afterDamage);
  const max = firstFiniteNumber(hp.maxHp);
  if (before === undefined || after === undefined) return '';
  return `HP ${formatNumber(before)} -> ${formatNumber(after)}${max !== undefined ? ` / ${formatNumber(max)}` : ''}`;
}

function targetDefeated(target = {}) {
  const hp = normalizeObject(target.hp);
  const finalHp = firstFiniteNumber(hp.final, hp.afterHealing, hp.afterDamage);
  const deathState = normalizeObject(target.deathSaves?.state);
  return finalHp !== undefined && finalHp <= 0 || deathState.dead || deathState.dying || deathState.unconscious;
}

function combatHitState(attack = {}) {
  const hit = normalizeObject(attack);
  const outcome = String(hit.outcome || hit.result || '').toLowerCase();
  if (hit.hit === false || /miss|failure|fail/.test(outcome)) return 'miss';
  if (hit.hit === true || /hit|success|critical/.test(outcome)) return 'hit';
  return '';
}

function blockedCombatDetail(result = {}) {
  const costs = Array.isArray(result.costValidation?.costs) ? result.costValidation.costs : [];
  const failed = costs.find((cost) => cost && cost.ok === false);
  if (failed) {
    return `${actionResourceLabel(failed.cost?.resource || failed.cost?.resourceId || failed.cost?.kind)}不足：需要 ${formatNumber(failed.requested)}，当前 ${formatNumber(failed.available)}`;
  }
  return result.reason || '资源不足或动作不可用';
}

function resourceCostDetail(costApplications = []) {
  if (!Array.isArray(costApplications) || !costApplications.length) return '';
  const parts = costApplications.map((entry) => {
    const output = entry?.result?.output || entry?.output || {};
    return `${actionResourceLabel(output.resource || entry?.cost?.resource || entry?.cost?.resourceId || entry?.cost?.kind)} ${formatNumber(output.before)} -> ${formatNumber(output.after)}`;
  }).filter((part) => !/undefined/.test(part));
  return parts.length ? `资源：${parts.slice(0, 3).join('，')}` : '';
}

function actionEconomyDetail(economy = {}) {
  const object = normalizeObject(economy);
  return ['action', 'bonusAction', 'reaction', 'movement']
    .map((key) => {
      const pool = normalizeObject(object[key]);
      if (pool.current === undefined) return '';
      return `${actionResourceLabel(key)} ${formatNumber(pool.current)}/${formatNumber(pool.max ?? pool.current)}`;
    })
    .filter(Boolean)
    .join('，');
}

function resourceChangeText(toolId, actor, output = {}, input = {}) {
  if (/start_cooldown/.test(toolId)) {
    return `${actor}进入冷却：${resourceName(output, input)}`;
  }
  if (/tick_cooldowns/.test(toolId)) {
    const ready = Array.isArray(output.results)
      ? output.results.flatMap((result) => result.updates || []).filter((item) => item.ready).length
      : 0;
    return ready ? `${actor}有 ${ready} 个冷却已就绪` : `${actor}冷却减少`;
  }
  const verb = /restore_resource/.test(toolId) ? '恢复' : /spend_resource/.test(toolId) ? '消耗' : '更新';
  return `${actor}${verb}${resourceName(output, input)}`;
}

function resourceChangeDetail(output = {}) {
  const beforeAfter = beforeAfterDetail(output.before, output.after);
  if (beforeAfter) return beforeAfter;
  if (Array.isArray(output.results)) {
    return output.results
      .flatMap((result) => result.updates || [])
      .slice(0, 4)
      .map((item) => `${resourceIdLabel(item.cooldownId)} ${formatNumber(item.before)} -> ${formatNumber(item.after)}`)
      .join('，');
  }
  return '';
}

function beforeAfterDetail(before, after) {
  if (before === undefined || after === undefined) return '';
  return `${formatNumber(before)} -> ${formatNumber(after)}`;
}

function resourceName(output = {}, input = {}) {
  return resourceIdLabel(output.resourceId || output.cooldownId || input.resourceId || input.itemId || input.id || input.name || '资源');
}

function actorLabel(value) {
  return String(value || '角色').replace(/^(pc|npc)[_-]+/i, '').replace(/[_-]+/g, ' ');
}

function meaningfulActionLabel(action = {}) {
  const label = action.sourceText || action.name || '';
  if (label && !/^(enemy counter turn from combat ui|ordinary enemy attack|ordinary enemy (attack|defense|dodge))$/i.test(label.trim())) return label;
  const id = String(action.actionId || '');
  return /^combataction[_-]/i.test(id) ? '' : id;
}

function resourceIdLabel(value = '') {
  const labels = {
    action: '行动',
    bonusAction: '附赠动作',
    reaction: '反应',
    movement: '移动',
    spellSlots: '法术位',
    skillUses: '技能次数',
    consumables: '物品',
    ammo: '弹药'
  };
  return labels[value] || String(value || '资源').replace(/[_-]+/g, ' ');
}

function actionResourceLabel(value = '') {
  return resourceIdLabel(String(value || 'action'));
}

function listCountText(label, values) {
  const count = Array.isArray(values) ? values.length : 0;
  return count ? `${label} ${count}` : '';
}

function combatModeText(mode = '') {
  const normalized = String(mode || '').toLowerCase();
  if (/defense|defend/.test(normalized)) return '采取防御姿态';
  if (/dodge|evade/.test(normalized)) return '尝试闪避';
  if (/attack/.test(normalized)) return '发动攻击';
  return '完成行动';
}

function combatOutcomeLabel(outcome = '') {
  const normalized = String(outcome || '').toLowerCase();
  if (normalized === 'won') return '胜利';
  if (normalized === 'lost') return '失败';
  if (normalized === 'fled') return '撤退';
  if (normalized === 'ended') return '结束';
  return outcome || '结束';
}

function combatOutcomeTitle(outcome = '') {
  const normalized = String(outcome || '').toLowerCase();
  if (normalized === 'won') return '胜利';
  if (normalized === 'lost') return '失败';
  return '战斗结束';
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function behaviorSettlementDetail(output, subject = '行为') {
  if (!output || typeof output !== 'object') return '';
  const plan = output.plan || output.apply?.plan || {};
  const apply = output.apply?.apply || output.apply || {};
  const intent = plan.intent || {};
  const calls = Array.isArray(apply.appliedToolCalls) ? apply.appliedToolCalls : [];
  const failed = Array.isArray(apply.failedToolCalls) ? apply.failedToolCalls : [];
  const skipped = Array.isArray(apply.skippedToolCalls) ? apply.skippedToolCalls : [];
  const status = output.status || apply.status || '';
  const summary = intent.summary || plan.narrationHints?.success || plan.narrationHints?.noTrigger || '';
  const noOp = !calls.length && !failed.length && !skipped.length && (/noop|no-op|noTrigger|没有产生独立反应|did not/.test(String(summary)));
  return [
    noOp ? `${subject}没有产生独立反应` : summary,
    calls.length ? `执行 ${calls.length} 项` : '',
    failed.length ? `失败 ${failed.length} 项` : '',
    !calls.length && !failed.length && !noOp && status ? `状态 ${status}` : ''
  ].filter(Boolean).join(' · ');
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function humanizeRuntimeToolId(toolId) {
  const last = String(toolId || '')
    .split('.')
    .filter(Boolean)
    .pop() || '';
  return last.replace(/[_-]+/g, ' ') || '工具';
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function removeUndefined(value) {
  return stripUndefinedDeep(value);
}

function safeSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
}

function clonePlain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stripUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [key, stripUndefinedDeep(entry)]));
}

function missingAppDatabase() {
  const error = new Error('App database is not configured');
  error.name = 'AppDatabaseMissingError';
  error.statusCode = 503;
  return error;
}

function normalizeStructuredSessionConfig(config, defaults = {}) {
  const merged = {
    ...defaults,
    ...(config || {})
  };
  return {
    enabled: Boolean(merged.enabled || merged.initialState),
    initialState: merged.initialState,
    mode: merged.mode || 'patch',
    extraInstructions: merged.extraInstructions || '',
    includeCurrentState: merged.includeCurrentState !== false
  };
}

function resolveStructuredInterfaceConfig(session, options = {}, defaults = {}) {
  const sessionConfig = session.metadata?.structuredInterface || {};
  const merged = {
    ...defaults,
    ...sessionConfig,
    ...(options || {})
  };
  return {
    enabled: Boolean(merged.enabled),
    mode: merged.mode || 'patch',
    extraInstructions: merged.extraInstructions || '',
    includeCurrentState: merged.includeCurrentState !== false
  };
}
