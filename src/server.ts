// @ts-nocheck
import { AgentChatRuntime } from './runtime/agent-chat-runtime.js';
import { AuditLog } from './audit/audit-log.js';
import { AppDatabase } from './app/app-database.js';
import { createApiServer } from './api/server.js';
import { SQLiteDataManager } from './data/sqlite-data-manager.js';
import { MockChatProvider } from './llm/mock-provider.js';
import { OpenAICompatibleProvider } from './llm/openai-compatible-provider.js';
import { OpenAICompatibleEmbeddingProvider } from './rag/openai-compatible-embedding-provider.js';
import { RagService } from './rag/rag-service.js';
import { SQLiteVectorStore } from './rag/sqlite-vector-store.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);

const chatProvider = process.env.AI_DND_PROVIDER === 'openai-compatible'
  ? OpenAICompatibleProvider.fromEnv()
  : new MockChatProvider();
const dataManager = new SQLiteDataManager({
  databasePath: process.env.AI_DND_DB_PATH || 'data/ai-dnd.sqlite'
});
const appDatabase = new AppDatabase({
  databasePath: process.env.AI_DND_APP_DB_PATH || 'data/app.sqlite',
  chatDataDirectory: process.env.AI_DND_CHAT_DATA_DIR || 'data/chat-databases'
});
const embeddingProvider = process.env.AI_DND_EMBEDDING_PROVIDER === 'openai-compatible'
  ? OpenAICompatibleEmbeddingProvider.fromEnv()
  : undefined;
const runtimeRagService = new RagService({
  defaultCollection: process.env.AI_DND_RUNTIME_RAG_COLLECTION || 'runtime-default',
  ...(embeddingProvider ? { embeddingProvider } : {})
});
const permanentRagService = new RagService({
  defaultCollection: process.env.AI_DND_PERMANENT_RAG_COLLECTION || 'permanent-default',
  ...(embeddingProvider ? { embeddingProvider } : {}),
  vectorStore: new SQLiteVectorStore({
    databasePath: process.env.AI_DND_PERMANENT_RAG_DB_PATH || 'data/permanent-rag.sqlite'
  })
});
const auditLog = new AuditLog({
  databasePath: process.env.AI_DND_AUDIT_DB_PATH || 'data/audit.sqlite',
  trace: {
    enabled: process.env.AI_DND_AUDIT_TRACE !== 'off',
    directory: process.env.AI_DND_AUDIT_TRACE_DIR || 'data/audit-traces'
  }
});

const runtime = new AgentChatRuntime({
  chatProvider,
  ragService: runtimeRagService,
  permanentRagService,
  appDatabase,
  dataManager,
  auditLog,
  worldline: {
    databasePath: process.env.AI_DND_WORLDLINE_DB_PATH || 'data/worldlines.sqlite',
    trace: {
      enabled: process.env.AI_DND_WORLDLINE_TRACE !== 'off',
      directory: process.env.AI_DND_WORLDLINE_TRACE_DIR || 'data/worldline-traces'
    }
  },
  scene: {
    trace: {
      enabled: process.env.AI_DND_SCENE_TRACE !== 'off',
      directory: process.env.AI_DND_SCENE_TRACE_DIR || 'data/scene-traces'
    }
  },
  toolTrace: {
    enabled: process.env.AI_DND_TOOL_TRACE !== 'off',
    directory: process.env.AI_DND_TOOL_TRACE_DIR || 'data/tool-traces',
    actionResolver: {
      enabled: process.env.AI_DND_ACTION_RESOLVER_TRACE !== 'off',
      directory: process.env.AI_DND_ACTION_RESOLVER_TRACE_DIR || 'data/action-resolver-traces'
    },
    protagonist: {
      enabled: process.env.AI_DND_PROTAGONIST_TRACE !== 'off',
      directory: process.env.AI_DND_PROTAGONIST_TRACE_DIR || 'data/protagonist-switch-traces'
    },
    resources: {
      enabled: process.env.AI_DND_RESOURCE_TRACE !== 'off',
      directory: process.env.AI_DND_RESOURCE_TRACE_DIR || 'data/resource-traces'
    },
    persuasion: {
      enabled: process.env.AI_DND_PERSUASION_TRACE !== 'off',
      directory: process.env.AI_DND_PERSUASION_TRACE_DIR || 'data/persuasion-traces'
    },
    combat: {
      enabled: process.env.AI_DND_COMBAT_TRACE !== 'off',
      directory: process.env.AI_DND_COMBAT_TRACE_DIR || 'data/combat-traces'
    },
    itemUse: {
      enabled: process.env.AI_DND_ITEM_USE_TRACE !== 'off',
      directory: process.env.AI_DND_ITEM_USE_TRACE_DIR || 'data/item-use-traces'
    },
    contextPlanner: {
      enabled: process.env.AI_DND_CONTEXT_PLANNER_TRACE !== 'off',
      directory: process.env.AI_DND_CONTEXT_PLANNER_TRACE_DIR || 'data/context-planner-traces'
    }
  },
  structuredInterface: {
    store: {
      directory: process.env.AI_DND_STRUCTURED_INTERFACE_DIR || 'data/structured-interface',
      trace: {
        enabled: process.env.AI_DND_STRUCTURED_INTERFACE_TRACE !== 'off',
        directory: process.env.AI_DND_STRUCTURED_INTERFACE_TRACE_DIR || 'data/structured-interface-traces'
      }
    }
  }
});
const server = createApiServer({ runtime, appDatabase });

server.listen(port, host, () => {
  console.log(`AI DND agent framework listening on http://${host}:${port}`);
});
