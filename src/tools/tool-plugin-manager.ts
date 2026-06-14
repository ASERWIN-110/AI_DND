// @ts-nocheck
import Ajv from 'ajv';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { serializeAuditError } from '../audit/audit-log.js';
import { createId, nowIso } from '../utils/id.js';
import { ToolTraceRecorder } from './tool-trace-recorder.js';

const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const PLUGIN_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{1,127}$/;
const toolExecutionContextStorage = new AsyncLocalStorage();

export const JsonSchemaSchema = z.record(z.string(), z.any());

export const ToolDefinitionSchema = z.object({
  type: z.enum(['function', 'custom']).default('function'),
  name: z.string().regex(TOOL_NAME_PATTERN),
  title: z.string().optional(),
  description: z.string().default(''),
  inputSchema: JsonSchemaSchema.default({
    type: 'object',
    properties: {},
    additionalProperties: false
  }),
  outputSchema: JsonSchemaSchema.optional(),
  annotations: JsonSchemaSchema.default({}),
  _meta: JsonSchemaSchema.default({}),
  strict: z.boolean().optional(),
  deferLoading: z.boolean().optional(),
  inputExamples: z.array(z.any()).optional(),
  cacheControl: JsonSchemaSchema.optional(),
  allowedCallers: z.array(z.string()).optional(),
  visibility: z.enum(['public', 'private', 'internal']).default('public'),
  enabled: z.boolean().default(true),
  autoCallable: z.boolean().default(false),
  mutatesState: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  metadata: JsonSchemaSchema.default({})
}).passthrough();

export const ToolDefinitionPatchSchema = z.object({
  type: z.enum(['function', 'custom']).optional(),
  name: z.string().regex(TOOL_NAME_PATTERN).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: JsonSchemaSchema.optional(),
  outputSchema: JsonSchemaSchema.optional(),
  annotations: JsonSchemaSchema.optional(),
  _meta: JsonSchemaSchema.optional(),
  strict: z.boolean().optional(),
  deferLoading: z.boolean().optional(),
  inputExamples: z.array(z.any()).optional(),
  cacheControl: JsonSchemaSchema.optional(),
  allowedCallers: z.array(z.string()).optional(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
  enabled: z.boolean().optional(),
  autoCallable: z.boolean().optional(),
  mutatesState: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  metadata: JsonSchemaSchema.optional()
}).passthrough();

export const ToolPluginManifestSchema = z.object({
  id: z.string().regex(PLUGIN_ID_PATTERN),
  name: z.string().min(1),
  version: z.string().default('0.1.0'),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  author: z.string().optional(),
  homepage: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  tools: z.array(z.any()).default([]),
  metadata: JsonSchemaSchema.default({})
}).passthrough();

export const ToolPluginPatchSchema = z.object({
  id: z.string().regex(PLUGIN_ID_PATTERN).optional(),
  name: z.string().min(1).optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  tools: z.array(z.any()).optional(),
  metadata: JsonSchemaSchema.optional()
}).passthrough();

export class ToolPluginManager {
  constructor({
    plugins = [],
    ajvOptions = {},
    now = nowIso,
    trace,
    traceRecorder,
    auditLog,
    auditSnapshot,
    onToolResult
  } = {}) {
    this.plugins = new Map();
    this.handlers = new Map();
    this.validators = new Map();
    this.now = now;
    this.auditLog = auditLog;
    this.auditSnapshot = auditSnapshot;
    this.onToolResult = typeof onToolResult === 'function' ? onToolResult : undefined;
    this.traceRecorder = traceRecorder || new ToolTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      now
    });
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      removeAdditional: false,
      ...ajvOptions
    });

    for (const plugin of plugins) {
      this.createPlugin(plugin);
    }
  }

  createPlugin(pluginInput, { handlers = {} } = {}) {
    const plugin = normalizePlugin(pluginInput, this.now);
    if (this.plugins.has(plugin.id)) {
      throw conflict(`Tool plugin already exists: ${plugin.id}`);
    }

    assertUniqueToolNames(plugin.tools);
    this.compilePluginSchemas(plugin);
    this.plugins.set(plugin.id, plugin);
    this.bindHandlers(plugin.id, handlers);
    return plugin;
  }

  getPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw notFound(`Tool plugin not found: ${pluginId}`);
    return plugin;
  }

  listPlugins({ includeDisabled = true } = {}) {
    return [...this.plugins.values()]
      .filter((plugin) => includeDisabled || plugin.enabled)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  updatePlugin(pluginId, patchInput, { handlers } = {}) {
    const current = this.getPlugin(pluginId);
    const patch = parseZod(ToolPluginPatchSchema, patchInput);
    const nextId = patch.id || current.id;
    if (nextId !== pluginId && this.plugins.has(nextId)) {
      throw conflict(`Tool plugin already exists: ${nextId}`);
    }

    const next = normalizePlugin({
      ...current,
      ...patch,
      id: nextId,
      metadata: patch.metadata ?? current.metadata,
      permissions: patch.permissions ?? current.permissions,
      tools: patch.tools ?? current.tools,
      createdAt: current.createdAt,
      updatedAt: this.now()
    }, this.now);

    assertUniqueToolNames(next.tools);
    this.deleteCompiledSchemas(pluginId);
    this.compilePluginSchemas(next);

    this.plugins.delete(pluginId);
    this.plugins.set(next.id, next);
    if (next.id !== pluginId) {
      this.renameHandlers(pluginId, next.id);
    }
    if (handlers) {
      this.bindHandlers(next.id, handlers);
    }
    return next;
  }

  deletePlugin(pluginId) {
    const plugin = this.getPlugin(pluginId);
    this.plugins.delete(pluginId);
    this.handlers.delete(pluginId);
    this.deleteCompiledSchemas(pluginId);
    return plugin;
  }

  setPluginEnabled(pluginId, enabled) {
    return this.updatePlugin(pluginId, { enabled });
  }

  createTool(pluginId, toolInput, { handler } = {}) {
    const plugin = this.getPlugin(pluginId);
    const tool = normalizeTool(toolInput);
    if (plugin.tools.some((existing) => existing.name === tool.name)) {
      throw conflict(`Tool already exists: ${pluginId}.${tool.name}`);
    }

    this.compileToolSchema(pluginId, tool);
    const next = {
      ...plugin,
      tools: [...plugin.tools, tool],
      updatedAt: this.now()
    };
    this.plugins.set(pluginId, next);

    if (handler) {
      this.bindHandlers(pluginId, { [tool.name]: handler });
    }

    return this.decorateTool(pluginId, tool);
  }

  getTool(toolIdOrPluginId, maybeToolName) {
    const { pluginId, toolName } = this.resolveToolRef(toolIdOrPluginId, maybeToolName);
    const plugin = this.getPlugin(pluginId);
    const tool = plugin.tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw notFound(`Tool not found: ${pluginId}.${toolName}`);
    return this.decorateTool(pluginId, tool);
  }

  listTools({ includeDisabled = false, visibility } = {}) {
    return this.listPlugins({ includeDisabled: true })
      .flatMap((plugin) => plugin.tools.map((tool) => this.decorateTool(plugin.id, tool)))
      .filter((tool) => includeDisabled || tool.enabled)
      .filter((tool) => !visibility || tool.visibility === visibility)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  updateTool(pluginId, toolName, patchInput, { handler } = {}) {
    const plugin = this.getPlugin(pluginId);
    const currentIndex = plugin.tools.findIndex((tool) => tool.name === toolName);
    if (currentIndex === -1) throw notFound(`Tool not found: ${pluginId}.${toolName}`);

    const patch = parseZod(ToolDefinitionPatchSchema, patchInput);
    const nextTool = normalizeTool({
      ...plugin.tools[currentIndex],
      ...patch,
      name: patch.name || plugin.tools[currentIndex].name,
      metadata: patch.metadata ?? plugin.tools[currentIndex].metadata,
      tags: patch.tags ?? plugin.tools[currentIndex].tags
    });

    const duplicate = plugin.tools.some((tool, index) => index !== currentIndex && tool.name === nextTool.name);
    if (duplicate) throw conflict(`Tool already exists: ${pluginId}.${nextTool.name}`);

    this.deleteCompiledSchema(pluginId, toolName);
    this.compileToolSchema(pluginId, nextTool);

    const tools = [...plugin.tools];
    tools[currentIndex] = nextTool;
    this.plugins.set(pluginId, {
      ...plugin,
      tools,
      updatedAt: this.now()
    });

    if (nextTool.name !== toolName) {
      this.renameHandler(pluginId, toolName, nextTool.name);
    }
    if (handler) {
      this.bindHandlers(pluginId, { [nextTool.name]: handler });
    }

    return this.decorateTool(pluginId, nextTool);
  }

  deleteTool(pluginId, toolName) {
    const plugin = this.getPlugin(pluginId);
    const tool = plugin.tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw notFound(`Tool not found: ${pluginId}.${toolName}`);

    this.plugins.set(pluginId, {
      ...plugin,
      tools: plugin.tools.filter((candidate) => candidate.name !== toolName),
      updatedAt: this.now()
    });
    this.deleteCompiledSchema(pluginId, toolName);
    this.deleteHandler(pluginId, toolName);
    return this.decorateTool(pluginId, tool);
  }

  bindHandlers(pluginId, handlers = {}) {
    if (!this.handlers.has(pluginId)) {
      this.handlers.set(pluginId, new Map());
    }
    const pluginHandlers = this.handlers.get(pluginId);

    for (const [toolName, handler] of Object.entries(handlers)) {
      if (typeof handler !== 'function') {
        throw new TypeError(`Handler for ${pluginId}.${toolName} must be a function`);
      }
      pluginHandlers.set(toolName, handler);
    }
  }

  async executeTool(toolIdOrPluginId, maybeToolNameOrInput, maybeInput, context = {}) {
    const hasExplicitToolName = typeof maybeToolNameOrInput === 'string';
    const toolRef = hasExplicitToolName
      ? this.resolveToolRef(toolIdOrPluginId, maybeToolNameOrInput)
      : this.resolveToolRef(toolIdOrPluginId);
    const input = hasExplicitToolName ? maybeInput : maybeToolNameOrInput;
    const parentExecution = toolExecutionContextStorage.getStore();
    const notificationContext = inheritToolNotificationContext({
      context,
      input,
      parentExecution
    });

    const plugin = this.getPlugin(toolRef.pluginId);
    if (!plugin.enabled) throw disabled(`Tool plugin is disabled: ${plugin.id}`);

    const tool = plugin.tools.find((candidate) => candidate.name === toolRef.toolName);
    if (!tool) throw notFound(`Tool not found: ${toolRef.pluginId}.${toolRef.toolName}`);

    const decorated = this.decorateTool(plugin.id, tool);
    if (!decorated.enabled) throw disabled(`Tool is disabled: ${decorated.id}`);

    const startedAt = this.now();
    const redactedContext = redactToolExecutionContext(context);
    const trace = this.traceRecorder.startToolCall({
      tool: decorated,
      plugin,
      input,
      context: redactedContext
    });
    const shouldAudit = Boolean(this.auditLog) && !context?.audit?.skipAudit && plugin.id !== 'system.audit';
    let beforeState;

    try {
      this.validateToolInput(plugin.id, tool.name, input);
      this.validateToolAuthorization(decorated, context);
      this.validateAgentAccessPolicy(decorated, plugin, context, input);
      beforeState = shouldAudit && decorated.mutatesState
        ? await this.captureAuditSnapshot({ tool: decorated, input, context })
        : undefined;

      const handler = this.handlers.get(plugin.id)?.get(tool.name);
      if (!handler) throw notImplemented(`Tool has no handler registered: ${decorated.id}`);

      const output = await toolExecutionContextStorage.run({
        input,
        tool: decorated,
        plugin,
        context
      }, () => handler({
        input,
        tool: decorated,
        plugin,
        context
      }));
      const finishedAt = this.now();
      const traceSummary = this.traceRecorder.finishToolCall(trace, { output, finishedAt });
      const afterState = shouldAudit && decorated.mutatesState
        ? await this.captureAuditSnapshot({ tool: decorated, input, context })
        : undefined;

      const result = {
        toolId: decorated.id,
        pluginId: plugin.id,
        toolName: tool.name,
        input,
        output,
        startedAt,
        finishedAt,
        trace: traceSummary
      };
      if (shouldAudit) {
        await this.recordToolAuditEvent({
          tool: decorated,
          plugin,
          input,
          context: redactedContext,
          startedAt,
          finishedAt,
          output,
          traceSummary,
          beforeState,
          afterState
        });
      }
      await this.notifyToolResult({
        tool: decorated,
        plugin,
        input,
        context: notificationContext,
        result
      });
      return result;
    } catch (error) {
      const finishedAt = this.now();
      const traceSummary = this.traceRecorder.failToolCall(trace, { error, finishedAt });
      if (shouldAudit) {
        await this.recordToolAuditEvent({
          tool: decorated,
          plugin,
          input,
          context: redactedContext,
          startedAt,
          finishedAt,
          error,
          traceSummary,
          beforeState
        });
      }
      throw error;
    }
  }

  setToolResultHandler(handler) {
    this.onToolResult = typeof handler === 'function' ? handler : undefined;
  }

  async notifyToolResult(event) {
    if (!this.onToolResult) return;
    try {
      await this.onToolResult(event);
    } catch {
      // Progress notifications must not change tool execution semantics.
    }
  }

  async captureAuditSnapshot({ tool, input, context }) {
    if (!this.auditSnapshot?.capture) return undefined;
    return this.auditSnapshot.capture({ tool, input, context });
  }

  async recordToolAuditEvent({
    tool,
    plugin,
    input,
    context,
    startedAt,
    finishedAt,
    output,
    error,
    traceSummary,
    beforeState,
    afterState
  }) {
    if (!this.auditLog) return undefined;
    const chatSessionId = input?.chatSessionId || input?.chatId || input?.sessionId ||
      context?.chatSessionId || context?.chatId || context?.sessionId;
    const event = this.auditLog.recordEvent({
      scopeType: chatSessionId ? 'app-chat' : 'tool',
      scopeId: chatSessionId || tool.id,
      operation: 'tool.execute',
      actor: context?.actor || { type: 'agent' },
      status: error ? 'error' : 'success',
      reversible: Boolean(tool.mutatesState && (beforeState || isReversibleRagTool(tool.id))),
      replayable: true,
      input: {
        toolId: tool.id,
        pluginId: plugin.id,
        toolName: tool.name,
        input,
        context
      },
      output: error ? undefined : output,
      before: beforeState ? { stateSnapshot: beforeState } : undefined,
      after: afterState ? { stateSnapshot: afterState } : undefined,
      error: error ? serializeAuditError(error) : undefined,
      traceRefs: {
        toolTrace: traceSummary
      },
      metadata: {
        toolId: tool.id,
        pluginId: plugin.id,
        toolName: tool.name,
        mutatesState: Boolean(tool.mutatesState),
        autoCallable: Boolean(tool.autoCallable),
        chatSessionId,
        startedAt,
        finishedAt
      }
    });
    return event;
  }

  exportTools({ format = 'mcp', includeDisabled = false, visibility, pluginId, nameStrategy = 'qualified' } = {}) {
    const tools = this.listTools({ includeDisabled, visibility })
      .filter((tool) => !pluginId || tool.pluginId === pluginId)
      .filter((tool) => tool.visibility === 'public' || tool.visibility === 'internal');

    switch (format) {
      case 'internal':
        return tools;
      case 'mcp':
      case 'codex':
      case 'agent':
        return tools.map((tool) => toMcpTool(tool, { format, nameStrategy }));
      case 'claude':
      case 'anthropic':
        return tools.map((tool) => toClaudeTool(tool, { nameStrategy }));
      case 'openai':
      case 'openai-responses':
      case 'responses':
        return tools.map((tool) => toOpenAIResponsesTool(tool, { nameStrategy }));
      case 'openai-chat':
      case 'chat-completions':
        return tools.map((tool) => toOpenAIChatTool(tool, { nameStrategy }));
      default:
        throw badRequest(`Unsupported tool export format: ${format}`);
    }
  }

  toMcpTools(options = {}) {
    return this.exportTools({ ...options, format: 'mcp' });
  }

  toClaudeTools(options = {}) {
    return this.exportTools({ ...options, format: 'claude' });
  }

  toOpenAIResponsesTools(options = {}) {
    return this.exportTools({ ...options, format: 'openai-responses' });
  }

  toOpenAIChatTools(options = {}) {
    return this.exportTools({ ...options, format: 'openai-chat' });
  }

  toOpenAITools(options = {}) {
    return this.toOpenAIResponsesTools(options);
  }

  toCodexTools(options = {}) {
    return this.exportTools({ ...options, format: 'codex' });
  }

  resolveToolRef(toolIdOrPluginId, maybeToolName) {
    if (maybeToolName) {
      return {
        pluginId: toolIdOrPluginId,
        toolName: maybeToolName
      };
    }

    const exact = String(toolIdOrPluginId || '');
    const byProviderName = this.resolveProviderToolName(exact);
    if (byProviderName) {
      return byProviderName;
    }

    for (const plugin of this.plugins.values()) {
      for (const tool of plugin.tools) {
        if (`${plugin.id}.${tool.name}` === exact) {
          return {
            pluginId: plugin.id,
            toolName: tool.name
          };
        }
      }
    }

    const matches = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.tools.some((tool) => tool.name === exact)) {
        matches.push(plugin.id);
      }
    }

    if (matches.length === 1) {
      return {
        pluginId: matches[0],
        toolName: exact
      };
    }
    if (matches.length > 1) {
      throw conflict(`Ambiguous tool name "${exact}". Use pluginId.toolName.`);
    }

    const splitIndex = exact.lastIndexOf('.');
    if (splitIndex > 0) {
      return {
        pluginId: exact.slice(0, splitIndex),
        toolName: exact.slice(splitIndex + 1)
      };
    }

    throw notFound(`Tool not found: ${exact}`);
  }

  resolveProviderToolName(providerToolName) {
    const exact = String(providerToolName || '');
    if (!exact) return undefined;

    const strategies = ['qualified', 'native'];
    const formats = ['mcp', 'claude', 'openai-responses'];
    const matches = [];

    for (const tool of this.listTools({ includeDisabled: true })) {
      for (const format of formats) {
        for (const nameStrategy of strategies) {
          if (formatToolName(tool, { format, nameStrategy }) === exact) {
            matches.push({
              pluginId: tool.pluginId,
              toolName: tool.name
            });
          }
        }
      }
    }

    const unique = uniqueToolRefs(matches);
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) {
      throw conflict(`Ambiguous provider tool name "${exact}". Use pluginId.toolName.`);
    }
    return undefined;
  }

  validateToolInput(pluginId, toolName, input) {
    const key = schemaKey(pluginId, toolName);
    const validator = this.validators.get(key);
    if (!validator) return;

    const valid = validator(input ?? {});
    if (valid) return;

    const details = this.ajv.errorsText(validator.errors, { separator: '; ' });
    const error = new Error(`Invalid input for ${pluginId}.${toolName}: ${details}`);
    error.name = 'ToolInputValidationError';
    error.statusCode = 400;
    error.details = validator.errors;
    throw error;
  }

  validateToolAuthorization(tool, context = {}) {
    if (!toolRequiresUserAuthorization(tool)) return;
    if (isUserAuthorized(context)) return;

    throw forbidden(`Tool requires explicit user authorization: ${tool.id}`);
  }

  validateAgentAccessPolicy(tool, plugin, context = {}, input = {}) {
    const policy = normalizeAgentAccessPolicy(resolveAgentAccessPolicy(context));
    if (!policy) return;

    const override = policy.tools?.[tool.id];
    if (override === 'allowed') return;
    if (override === 'blocked') {
      throw forbidden(`Agent access policy blocks tool: ${tool.id}`);
    }

    for (const capability of classifyToolResourceAccess(tool, plugin, input)) {
      const [resource, operation] = capability.split(':');
      if (policy[resource]?.[operation] === false) {
        throw forbidden(`Agent access policy blocks ${resource} ${operation} for tool: ${tool.id}`);
      }
    }
  }

  compilePluginSchemas(plugin) {
    for (const tool of plugin.tools) {
      this.compileToolSchema(plugin.id, tool);
    }
  }

  compileToolSchema(pluginId, tool) {
    try {
      this.validators.set(schemaKey(pluginId, tool.name), this.ajv.compile(tool.inputSchema));
    } catch (error) {
      error.statusCode = 400;
      error.message = `Invalid inputSchema for ${pluginId}.${tool.name}: ${error.message}`;
      throw error;
    }
  }

  deleteCompiledSchemas(pluginId) {
    for (const key of this.validators.keys()) {
      if (key.startsWith(`${pluginId}:`)) {
        this.validators.delete(key);
      }
    }
  }

  deleteCompiledSchema(pluginId, toolName) {
    this.validators.delete(schemaKey(pluginId, toolName));
  }

  decorateTool(pluginId, tool) {
    const plugin = this.getPlugin(pluginId);
    return {
      ...tool,
      id: `${pluginId}.${tool.name}`,
      pluginId,
      enabled: plugin.enabled && tool.enabled !== false
    };
  }

  renameHandlers(oldPluginId, newPluginId) {
    const existing = this.handlers.get(oldPluginId);
    if (!existing) return;
    this.handlers.delete(oldPluginId);
    this.handlers.set(newPluginId, existing);
  }

  renameHandler(pluginId, oldToolName, newToolName) {
    const pluginHandlers = this.handlers.get(pluginId);
    if (!pluginHandlers || !pluginHandlers.has(oldToolName)) return;
    const handler = pluginHandlers.get(oldToolName);
    pluginHandlers.delete(oldToolName);
    pluginHandlers.set(newToolName, handler);
  }

  deleteHandler(pluginId, toolName) {
    this.handlers.get(pluginId)?.delete(toolName);
  }
}

function isReversibleRagTool(toolId) {
  return toolId === 'system.rag_runtime.remember' ||
    toolId === 'system.rag_permanent.import_file' ||
    toolId === 'system.rag_permanent.import_database_snapshot';
}

function redactToolExecutionContext(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactToolExecutionContext);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    if (/api[_-]?key/i.test(key)) return [key, nested ? '[redacted]' : nested];
    return [key, redactToolExecutionContext(nested)];
  }));
}

export function normalizePlugin(input, now = nowIso) {
  const parsed = parseZod(ToolPluginManifestSchema, input);
  const createdAt = input.createdAt || now();
  const updatedAt = input.updatedAt || createdAt;

  return {
    ...parsed,
    tools: parsed.tools.map(normalizeTool),
    createdAt,
    updatedAt
  };
}

export function normalizeTool(input) {
  const parsed = parseZod(ToolDefinitionSchema, coerceToolDefinition(input));
  return {
    ...parsed,
    title: parsed.title || parsed.name
  };
}

export function normalizeExternalTool(input) {
  return normalizeTool(input);
}

export function detectToolFormat(input = {}) {
  if (input.type === 'function' && input.function && typeof input.function === 'object') {
    return 'openai-chat';
  }
  if (input.type === 'function' && input.name && input.parameters) {
    return 'openai-responses';
  }
  if (input.name && input.input_schema) {
    return 'claude';
  }
  if (input.name && input.inputSchema) {
    return 'mcp';
  }
  if (input.name && input.parameters) {
    return 'parameters';
  }
  return 'internal';
}

export function coerceToolDefinition(input = {}) {
  const format = detectToolFormat(input);

  if (format === 'openai-chat') {
    const fn = input.function;
    return {
      type: 'function',
      name: normalizeIncomingToolName(fn.name),
      description: fn.description || '',
      inputSchema: fn.parameters || emptyInputSchema(),
      strict: fn.strict ?? input.strict,
      metadata: mergeMetadata(input.metadata, {
        sourceFormat: format,
        externalName: fn.name
      })
    };
  }

  if (format === 'openai-responses') {
    return {
      type: 'function',
      name: normalizeIncomingToolName(input.name),
      description: input.description || '',
      inputSchema: input.parameters || emptyInputSchema(),
      strict: input.strict,
      deferLoading: input.defer_loading ?? input.deferLoading,
      metadata: mergeMetadata(input.metadata, {
        sourceFormat: format,
        externalName: input.name
      })
    };
  }

  if (format === 'claude') {
    return {
      type: 'function',
      name: normalizeIncomingToolName(input.name),
      description: input.description || '',
      inputSchema: input.input_schema || emptyInputSchema(),
      inputExamples: input.input_examples || input.inputExamples,
      strict: input.strict,
      deferLoading: input.defer_loading ?? input.deferLoading,
      cacheControl: input.cache_control || input.cacheControl,
      allowedCallers: input.allowed_callers || input.allowedCallers,
      metadata: mergeMetadata(input.metadata, {
        sourceFormat: format,
        externalName: input.name
      })
    };
  }

  if (format === 'parameters') {
    return {
      ...input,
      name: normalizeIncomingToolName(input.name),
      inputSchema: input.parameters || emptyInputSchema(),
      metadata: mergeMetadata(input.metadata, {
        sourceFormat: format,
        externalName: input.name
      })
    };
  }

  return {
    ...input,
    name: normalizeIncomingToolName(input.name),
    inputSchema: input.inputSchema || input.input_schema || input.parameters || emptyInputSchema(),
    outputSchema: input.outputSchema || input.output_schema,
    inputExamples: input.inputExamples || input.input_examples,
    deferLoading: input.deferLoading ?? input.defer_loading,
    cacheControl: input.cacheControl || input.cache_control,
    allowedCallers: input.allowedCallers || input.allowed_callers,
    metadata: mergeMetadata(input.metadata, {
      sourceFormat: format,
      externalName: input.name
    })
  };
}

export function createToolPluginId(prefix = 'tool-plugin') {
  return createId(prefix);
}

export function getCurrentToolExecutionContext() {
  return toolExecutionContextStorage.getStore();
}

function inheritToolNotificationContext({ context = {}, input = {}, parentExecution } = {}) {
  if (!parentExecution || typeof parentExecution !== 'object') return context || {};
  const parentContext = normalizeObject(parentExecution.context);
  const parentInput = normalizeObject(parentExecution.input);
  const currentContext = normalizeObject(context);
  const currentInput = normalizeObject(input);
  const merged = { ...currentContext };
  const chatSessionId = firstDefinedText(
    currentContext.chatSessionId,
    currentContext.chatId,
    currentContext.sessionId,
    currentContext.agentLoop?.chatSessionId,
    currentInput.chatSessionId,
    currentInput.chatId,
    currentInput.sessionId,
    parentContext.chatSessionId,
    parentContext.chatId,
    parentContext.sessionId,
    parentContext.agentLoop?.chatSessionId,
    parentInput.chatSessionId,
    parentInput.chatId,
    parentInput.sessionId
  );
  const turnId = firstDefinedText(
    currentContext.turnId,
    currentContext.agentLoop?.turnId,
    currentInput.turnId,
    currentInput.sourceTurnId,
    parentContext.turnId,
    parentContext.agentLoop?.turnId,
    parentInput.turnId,
    parentInput.sourceTurnId
  );
  const phaseId = firstDefinedText(
    currentContext.phaseId,
    currentContext.agentLoop?.phaseId,
    currentInput.phaseId,
    parentContext.phaseId,
    parentContext.agentLoop?.phaseId,
    parentInput.phaseId
  );

  if (chatSessionId && merged.chatSessionId === undefined && merged.chatId === undefined && merged.sessionId === undefined) {
    merged.chatSessionId = chatSessionId;
  }
  if (turnId && merged.turnId === undefined) merged.turnId = turnId;
  if (phaseId && merged.phaseId === undefined) merged.phaseId = phaseId;

  const parentAgentLoop = normalizeObject(parentContext.agentLoop);
  const currentAgentLoop = normalizeObject(currentContext.agentLoop);
  const agentLoop = { ...parentAgentLoop, ...currentAgentLoop };
  if (chatSessionId && agentLoop.chatSessionId === undefined) agentLoop.chatSessionId = chatSessionId;
  if (turnId && agentLoop.turnId === undefined) agentLoop.turnId = turnId;
  if (phaseId && agentLoop.phaseId === undefined) agentLoop.phaseId = phaseId;
  if (Object.keys(agentLoop).length) merged.agentLoop = agentLoop;

  const parentToolId = firstDefinedText(
    parentContext.parentToolId,
    parentExecution.tool?.id,
    parentExecution.tool?.pluginId && parentExecution.tool?.name
      ? `${parentExecution.tool.pluginId}.${parentExecution.tool.name}`
      : undefined
  );
  if (parentToolId && merged.parentToolId === undefined) merged.parentToolId = parentToolId;

  return merged;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstDefinedText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function parseZod(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const error = new Error(result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
    return `${path}: ${issue.message}`;
  }).join('; '));
  error.name = 'ValidationError';
  error.statusCode = 400;
  throw error;
}

function assertUniqueToolNames(tools) {
  const seen = new Set();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw conflict(`Duplicate tool name in plugin manifest: ${tool.name}`);
    }
    seen.add(tool.name);
  }
}

function schemaKey(pluginId, toolName) {
  return `${pluginId}:${toolName}`;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.name = 'NotFoundError';
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.name = 'ConflictError';
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.name = 'ValidationError';
  return error;
}

function disabled(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.name = 'ToolDisabledError';
  return error;
}

function notImplemented(message) {
  const error = new Error(message);
  error.statusCode = 501;
  error.name = 'ToolHandlerMissingError';
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  error.name = 'ToolAuthorizationError';
  return error;
}

function emptyInputSchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function mergeMetadata(metadata, extra) {
  return {
    ...(metadata || {}),
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined))
  };
}

function normalizeIncomingToolName(name) {
  return String(name || '')
    .replace(/__+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '_');
}

function toMcpTool(tool, { format, nameStrategy }) {
  const exported = {
    name: formatToolName(tool, { format, nameStrategy }),
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      ...deriveAnnotations(tool),
      ...tool.annotations
    },
    _meta: toolMeta(tool, format)
  };

  if (tool.outputSchema) exported.outputSchema = tool.outputSchema;
  return exported;
}

function toClaudeTool(tool, { nameStrategy }) {
  const exported = {
    name: formatToolName(tool, { format: 'claude', nameStrategy }),
    description: tool.description,
    input_schema: tool.inputSchema
  };

  if (tool.inputExamples) exported.input_examples = tool.inputExamples;
  if (typeof tool.strict === 'boolean') exported.strict = tool.strict;
  if (typeof tool.deferLoading === 'boolean') exported.defer_loading = tool.deferLoading;
  if (tool.cacheControl) exported.cache_control = tool.cacheControl;
  if (tool.allowedCallers) exported.allowed_callers = tool.allowedCallers;
  return exported;
}

function toOpenAIResponsesTool(tool, { nameStrategy }) {
  const exported = {
    type: 'function',
    name: formatToolName(tool, { format: 'openai-responses', nameStrategy }),
    description: tool.description,
    parameters: tool.inputSchema
  };

  if (typeof tool.strict === 'boolean') exported.strict = tool.strict;
  if (typeof tool.deferLoading === 'boolean') exported.defer_loading = tool.deferLoading;
  return exported;
}

function toOpenAIChatTool(tool, { nameStrategy }) {
  const exported = {
    type: 'function',
    function: {
      name: formatToolName(tool, { format: 'openai-chat', nameStrategy }),
      description: tool.description,
      parameters: tool.inputSchema
    }
  };

  if (typeof tool.strict === 'boolean') exported.function.strict = tool.strict;
  return exported;
}

function formatToolName(tool, { format, nameStrategy = 'qualified' }) {
  const base = nameStrategy === 'native' ? tool.name : `${tool.pluginId}.${tool.name}`;

  if (format === 'mcp' && nameStrategy === 'native') {
    return base;
  }

  const normalized = base
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (format === 'claude' || format === 'anthropic') {
    return truncateWithHash(normalized || 'tool', 64);
  }

  return truncateWithHash(normalized || 'tool', 128);
}

function truncateWithHash(value, maxLength) {
  if (value.length <= maxLength) return value;
  const suffix = `_${shortHash(value)}`;
  return `${value.slice(0, maxLength - suffix.length)}${suffix}`;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 7);
}

function toolMeta(tool, format) {
  return {
    ...tool._meta,
    'ai-dnd/format': format,
    'ai-dnd/toolId': tool.id,
    'ai-dnd/pluginId': tool.pluginId,
    'ai-dnd/toolName': tool.name,
    'ai-dnd/autoCallable': tool.autoCallable,
    'ai-dnd/mutatesState': tool.mutatesState,
    'ai-dnd/requiresUserAuthorization': toolRequiresUserAuthorization(tool)
  };
}

function deriveAnnotations(tool) {
  return {
    readOnlyHint: !tool.mutatesState,
    destructiveHint: Boolean(tool.metadata?.destructive),
    idempotentHint: Boolean(tool.metadata?.idempotent),
    openWorldHint: Boolean(tool.metadata?.openWorld),
    requiresUserAuthorization: toolRequiresUserAuthorization(tool)
  };
}

function toolRequiresUserAuthorization(tool) {
  return Boolean(
    tool.metadata?.requiresUserAuthorization ||
    tool.annotations?.requiresUserAuthorization ||
    tool._meta?.['ai-dnd/requiresUserAuthorization']
  );
}

function isUserAuthorized(context = {}) {
  const authorization = context.authorization ?? context.userAuthorization ?? context.approval;
  if (authorization === true) return true;
  if (!authorization || typeof authorization !== 'object') return false;
  return authorization.approved === true || authorization.userApproved === true || authorization.granted === true;
}

function resolveAgentAccessPolicy(context = {}) {
  return context.agentAccessPolicy ||
    context.agentAccess?.policy ||
    context.permissions?.agentAccessPolicy ||
    context.permissions?.agentAccess;
}

function normalizeAgentAccessPolicy(input) {
  if (!input || typeof input !== 'object') return undefined;
  const rawTools = input.tools && typeof input.tools === 'object' ? input.tools : {};
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
    runtimeRag: normalizeSpecificResource('runtimeRag', 'rag'),
    tools: Object.fromEntries(Object.entries(rawTools)
      .filter(([toolId, mode]) => typeof toolId === 'string' && ['allowed', 'blocked'].includes(mode)))
  };
}

function classifyToolResourceAccess(tool, plugin, input = {}) {
  const access = new Set();
  if (!tool) return access;
  const text = resourceAccessHaystack(tool, plugin);
  const operationText = resourceOperationHaystack(tool);
  const permissions = (plugin?.permissions || []).map((permission) => String(permission).toLowerCase());
  const usesRag = /\brag\b|runtime-rag|permanent-rag|vector|embedding/.test(text)
    || permissions.some((permission) => permission.includes('rag'));
  const usesPermanentRag = plugin?.id === 'system.rag_permanent'
    || /permanent[-_\s]?rag|rag[-_\s]?permanent|permanentrag/.test(text)
    || permissions.some((permission) => permission.includes('rag-permanent'));
  const usesRuntimeRag = plugin?.id === 'system.rag_runtime'
    || /runtime[-_\s]?rag|rag[-_\s]?runtime|runtimerag/.test(text)
    || permissions.some((permission) => permission.includes('rag-runtime'));
  const usesDatabase = /database|sqlite|chat-local|global-data|app-chat|collection|record|registry|profile|state|graph|relationship|timeline|savepoint/.test(text)
    || permissions.some((permission) => /:read|:write/.test(permission) && !permission.includes('rag'));
  const usesProfileLevels = plugin?.id === 'system.npc_profiles'
    || /l1\/l2\/l3|profilelevels|profile levels|npc[-_\s]?profiles/.test(text);
  const writes = Boolean(tool.mutatesState)
    || /\b(write|create|upsert|update|patch|delete|import|ingest|remember|index|store|restore|rewrite|mount|unmount)\b/.test(operationText);
  const reads = !writes || /\b(read|search|list|get|query|export|describe|build|context|snapshot|prompt|retrieve)\b/.test(operationText);

  if (usesDatabase) {
    if (writes) access.add('database:write');
    if (reads || /database snapshot|sourcecollection|source collection/.test(text)) access.add('database:read');
  }
  if (usesRag) {
    if (writes || /\bremember|index|import|ingest\b/.test(text)) access.add('rag:write');
    if (reads || /\bsearch|retrieve|list|export|context\b/.test(text)) access.add('rag:read');
  }
  if (usesPermanentRag && input?.includePermanentRag !== false) {
    if (writes || /\bindex|import|ingest\b/.test(text)) access.add('permanentRag:write');
    if (reads || /\bsearch|retrieve|list|export|context\b/.test(text)) access.add('permanentRag:read');
  }
  if (usesRuntimeRag && input?.includeRuntimeRag !== false) {
    if (writes || /\bremember|index|import|ingest|prune\b/.test(text)) access.add('runtimeRag:write');
    if (reads || /\bsearch|retrieve|list|context\b/.test(text)) access.add('runtimeRag:read');
  }
  if (usesProfileLevels && isProfileDataAccessTool(tool, plugin) && input?.includeNpcProfiles !== false) {
    const levels = profileLevelsForToolInput(tool, plugin, input);
    for (const level of levels) {
      const resource = `database${level}`;
      if (writes) access.add(`${resource}:write`);
      if (reads) access.add(`${resource}:read`);
    }
  }
  return access;
}

function isProfileDataAccessTool(tool = {}, plugin = {}) {
  if (plugin?.id === 'system.npc_profiles') {
    return [
      'list_profiles',
      'get_profile',
      'get_profile_bundle',
      'upsert_profile',
      'patch_profile',
      'delete_profile',
      'import_document',
      'export_document'
    ].includes(tool.name);
  }
  const text = resourceAccessHaystack(tool, plugin);
  return /profilelevels|profile levels|l1\/l2\/l3/.test(text);
}

function profileLevelsForToolInput(tool = {}, plugin = {}, input = {}) {
  const explicit = normalizeProfileLevelList(
    input.levels
      ?? input.level
      ?? input.profileLevels
      ?? input.lifecycleLevel
      ?? input.importanceLevel
  );
  if (explicit.length > 0) return explicit;
  if (plugin?.id === 'system.npc_profiles' && ['get_profile', 'upsert_profile', 'patch_profile', 'delete_profile'].includes(tool.name)) {
    return ['L1', 'L2', 'L3'];
  }
  const text = resourceAccessHaystack(tool, plugin).toUpperCase();
  const matched = ['L1', 'L2', 'L3'].filter((level) => text.includes(level));
  return matched.length ? matched : ['L1', 'L2', 'L3'];
}

function normalizeProfileLevelList(value) {
  const values = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[,，\s]+/) : []);
  return [...new Set(values
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => ['L1', 'L2', 'L3'].includes(item)))];
}

function resourceAccessHaystack(tool, plugin) {
  return [
    tool.id,
    tool.name,
    tool.title,
    tool.description,
    ...(tool.tags || []),
    JSON.stringify(tool.inputSchema || {}),
    JSON.stringify(tool.metadata || {}),
    plugin?.id,
    plugin?.name,
    plugin?.description,
    ...(plugin?.permissions || []),
    JSON.stringify(plugin?.metadata || {})
  ].filter(Boolean).join(' ').toLowerCase();
}

function resourceOperationHaystack(tool) {
  return [
    tool.id,
    tool.name,
    tool.title,
    tool.description,
    ...(tool.tags || []),
    JSON.stringify(tool.metadata || {})
  ].filter(Boolean).join(' ').toLowerCase();
}

function uniqueToolRefs(refs) {
  const seen = new Set();
  const unique = [];
  for (const ref of refs) {
    const key = `${ref.pluginId}.${ref.toolName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}
