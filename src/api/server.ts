// @ts-nocheck
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, normalize, relative, resolve, sep } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import {
  CreateSessionRequestSchema,
  RagDocumentRequestSchema,
  RagSearchRequestSchema,
  SendMessageRequestSchema,
  ToolDefinitionRequestSchema,
  ToolExecutionRequestSchema,
  ToolPluginPatchRequestSchema,
  ToolPluginRequestSchema,
  WorldInfoActivationRequestSchema,
  parseWithSchema
} from '../validation/schemas.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../../public', import.meta.url)));

export function createApiServer({ runtime, appDatabase }) {
  if (!runtime) throw new TypeError('createApiServer requires runtime');

  return http.createServer(async (request, response) => {
    try {
      await routeRequest({ runtime, appDatabase }, request, response);
    } catch (error) {
      writeJson(response, error.statusCode || 500, {
        error: {
          message: error.message,
          name: error.name
        }
      });
    }
  });
}

async function routeRequest({ runtime, appDatabase }, request, response) {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'OPTIONS') {
    writeJson(response, 204, {});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    writeJson(response, 200, { ok: true });
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && await routeStaticRequest(request, response, url)) {
    return;
  }

  if (await routeAuditRequest(runtime, request, response, url)) {
    return;
  }

  if (await routeWorldlineRequest(runtime, request, response, url)) {
    return;
  }

  if (await routeAgentProgressRequest(runtime, request, response, url)) {
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/chat/api-test') {
    const body = await readJson(request);
    writeJson(response, 200, await runtime.testApiSettings(body.api || body.apiSettings || body));
    return;
  }

  if (appDatabase && await routeAppRequest({ appDatabase, runtime }, request, response, url)) {
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/chat/sessions') {
    writeJson(response, 200, { sessions: await runtime.listSessions() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/chat/sessions') {
    const body = parseWithSchema(CreateSessionRequestSchema, await readJson(request));
    const session = await runtime.createSession(body);
    writeJson(response, 201, { session });
    return;
  }

  const sessionMatch = url.pathname.match(/^\/v1\/chat\/sessions\/([^/]+)$/);
  if (request.method === 'GET' && sessionMatch) {
    writeJson(response, 200, { session: await runtime.getSession(sessionMatch[1]) });
    return;
  }

  const structuredPromptMatch = url.pathname.match(/^\/v1\/chat\/sessions\/([^/]+)\/structured-interface\/prompt$/);
  if (request.method === 'GET' && structuredPromptMatch) {
    writeJson(response, 200, await runtime.getStructuredInterfacePrompt(decodeURIComponent(structuredPromptMatch[1])));
    return;
  }

  const structuredApplyMatch = url.pathname.match(/^\/v1\/chat\/sessions\/([^/]+)\/structured-interface\/apply-output$/);
  if (request.method === 'POST' && structuredApplyMatch) {
    const body = await readJson(request);
    writeJson(response, 200, await runtime.applyStructuredInterfaceOutput(
      decodeURIComponent(structuredApplyMatch[1]),
      body.content || '',
      {
        defaultMode: body.defaultMode || body.mode || 'patch',
        source: body.source || 'assistant'
      }
    ));
    return;
  }

  const structuredMatch = url.pathname.match(/^\/v1\/chat\/sessions\/([^/]+)\/structured-interface$/);
  if (structuredMatch) {
    const sessionId = decodeURIComponent(structuredMatch[1]);
    if (request.method === 'GET') {
      writeJson(response, 200, await runtime.getStructuredInterfaceState(sessionId));
      return;
    }
    if (request.method === 'PATCH' || request.method === 'POST') {
      const body = await readJson(request);
      writeJson(response, 200, await runtime.updateStructuredInterfaceState(
        sessionId,
        body.update || body.state || body,
        {
          mode: body.mode || 'manual',
          source: body.source || 'manual'
        }
      ));
      return;
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      writeJson(response, 200, await runtime.rewriteStructuredInterfaceState(
        sessionId,
        body.state || body,
        {
          source: body.source || 'manual'
        }
      ));
      return;
    }
  }

  const messageMatch = url.pathname.match(/^\/v1\/chat\/sessions\/([^/]+)\/messages$/);
  if (request.method === 'POST' && messageMatch) {
    const body = parseWithSchema(SendMessageRequestSchema, await readJson(request));
    const result = await runtime.sendMessage(messageMatch[1], body.content, body.options || {});
    writeJson(response, 200, {
      session: result.session,
      message: result.assistantMessage,
      prompt: body.includePrompt ? result.prompt : undefined
    });
    return;
  }

  const runtimeMessagesTruncateMatch = url.pathname.match(/^\/v1\/chat\/sessions\/([^/]+)\/messages\/truncate$/);
  if (request.method === 'POST' && runtimeMessagesTruncateMatch) {
    const body = await readJson(request);
    writeJson(response, 200, await runtime.deleteRuntimeMessagesAfter(decodeURIComponent(runtimeMessagesTruncateMatch[1]), {
      messageId: body.messageId,
      index: body.index,
      inclusive: body.inclusive === true,
      reason: body.reason,
      actor: body.actor || 'user'
    }));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/rag/documents') {
    const body = parseWithSchema(RagDocumentRequestSchema, await readJson(request));
    const documents = await runtime.ingestMemory(body);
    writeJson(response, 201, { documents });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/rag/search') {
    const body = parseWithSchema(RagSearchRequestSchema, await readJson(request));
    const documents = await runtime.retrieveMemory(body);
    writeJson(response, 200, { documents });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/world-info/activate') {
    const body = parseWithSchema(WorldInfoActivationRequestSchema, await readJson(request));
    const entries = runtime.inspectWorldInfo(body);
    writeJson(response, 200, { entries });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/tool-plugins') {
    writeJson(response, 200, { plugins: runtime.listToolPlugins({ includeDisabled: true }) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/tool-plugins') {
    const body = parseWithSchema(ToolPluginRequestSchema, await readJson(request));
    const plugin = runtime.createToolPlugin(body);
    writeJson(response, 201, { plugin });
    return;
  }

  const pluginMatch = url.pathname.match(/^\/v1\/tool-plugins\/([^/]+)$/);
  if (pluginMatch) {
    const pluginId = decodeURIComponent(pluginMatch[1]);
    if (request.method === 'GET') {
      writeJson(response, 200, { plugin: runtime.getToolPlugin(pluginId) });
      return;
    }
    if (request.method === 'PATCH') {
      const body = parseWithSchema(ToolPluginPatchRequestSchema, await readJson(request));
      writeJson(response, 200, { plugin: runtime.updateToolPlugin(pluginId, body) });
      return;
    }
    if (request.method === 'DELETE') {
      writeJson(response, 200, { plugin: runtime.deleteToolPlugin(pluginId) });
      return;
    }
  }

  const pluginToolsMatch = url.pathname.match(/^\/v1\/tool-plugins\/([^/]+)\/tools$/);
  if (pluginToolsMatch) {
    const pluginId = decodeURIComponent(pluginToolsMatch[1]);
    if (request.method === 'GET') {
      const format = url.searchParams.get('format') || 'internal';
      const nameStrategy = url.searchParams.get('nameStrategy') || 'qualified';
      const plugin = runtime.getToolPlugin(pluginId);
      const tools = plugin.tools.map((tool) => runtime.getTool(pluginId, tool.name));
      writeJson(response, 200, {
        tools: format === 'internal'
          ? tools
          : runtime.exportTools({
            format,
            nameStrategy,
            includeDisabled: true,
            pluginId
          })
      });
      return;
    }
    if (request.method === 'POST') {
      const body = parseWithSchema(ToolDefinitionRequestSchema, await readJson(request));
      writeJson(response, 201, { tool: runtime.createTool(pluginId, body) });
      return;
    }
  }

  const pluginToolMatch = url.pathname.match(/^\/v1\/tool-plugins\/([^/]+)\/tools\/([^/]+)$/);
  if (pluginToolMatch) {
    const pluginId = decodeURIComponent(pluginToolMatch[1]);
    const toolName = decodeURIComponent(pluginToolMatch[2]);
    if (request.method === 'GET') {
      writeJson(response, 200, { tool: runtime.getTool(pluginId, toolName) });
      return;
    }
    if (request.method === 'PATCH') {
      const body = parseWithSchema(ToolDefinitionRequestSchema, await readJson(request));
      writeJson(response, 200, { tool: runtime.updateTool(pluginId, toolName, body) });
      return;
    }
    if (request.method === 'DELETE') {
      writeJson(response, 200, { tool: runtime.deleteTool(pluginId, toolName) });
      return;
    }
  }

  if (request.method === 'GET' && url.pathname === '/v1/tools') {
    const includeDisabled = url.searchParams.get('includeDisabled') === 'true';
    const visibility = url.searchParams.get('visibility') || undefined;
    const format = url.searchParams.get('format') || 'internal';
    const nameStrategy = url.searchParams.get('nameStrategy') || 'qualified';
    writeJson(response, 200, { tools: runtime.listTools({ includeDisabled, visibility, format, nameStrategy }) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/normalize') {
    const body = await readJson(request);
    writeJson(response, 200, { tool: runtime.normalizeTool(body.tool || body) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/import') {
    writeJson(response, 200, await importTools(runtime, await readJson(request)));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/delete') {
    writeJson(response, 200, await deleteTools(runtime, await readJson(request)));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/debug/files/read') {
    const body = await readJson(request);
    writeJson(response, 200, { file: await readDebugFile(body.path) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/debug/traces/latest') {
    writeJson(response, 200, { trace: await readLatestDebugTrace(url.searchParams.get('toolId') || undefined) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/debug/tool-sequence') {
    writeJson(response, 200, await executeDebugToolSequence(runtime, await readJson(request)));
    return;
  }

  const toolMatch = url.pathname.match(/^\/v1\/tools\/([^/]+)$/);
  if (request.method === 'GET' && toolMatch) {
    writeJson(response, 200, { tool: runtime.getTool(decodeURIComponent(toolMatch[1])) });
    return;
  }

  const toolExecuteMatch = url.pathname.match(/^\/v1\/tools\/([^/]+)\/execute$/);
  if (request.method === 'POST' && toolExecuteMatch) {
    const body = parseWithSchema(ToolExecutionRequestSchema, await readJson(request));
    const result = await runtime.executeTool(decodeURIComponent(toolExecuteMatch[1]), body.input, body.context || {});
    writeJson(response, 200, { result });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/characters/normalize') {
    const { normalizeCharacterCard } = await import('../characters/character-card.js');
    const body = await readJson(request);
    writeJson(response, 200, { characterCard: normalizeCharacterCard(body.characterCard || body) });
    return;
  }

  const error = new Error(`Route not found: ${request.method} ${url.pathname}`);
  error.statusCode = 404;
  throw error;
}

async function importTools(runtime, body = {}) {
  const imports = normalizeToolImport(body);
  if (imports.length === 0) {
    const error = new Error('Tool import payload must include plugins or tools');
    error.statusCode = 400;
    throw error;
  }

  const mode = body?.mode === 'create' ? 'create' : 'upsert';
  const result = {
    mode,
    createdPlugins: [],
    updatedPlugins: [],
    createdTools: [],
    updatedTools: [],
    skippedTools: [],
    errors: []
  };

  for (const item of imports) {
    const pluginInput = sanitizeImportedPlugin(item.plugin);
    if (!pluginInput.id) {
      result.errors.push({ message: 'Imported plugin is missing id' });
      continue;
    }

    let existingPlugin;
    try {
      existingPlugin = runtime.getToolPlugin(pluginInput.id);
    } catch (error) {
      if (!isNotFoundError(error)) {
        result.errors.push({ pluginId: pluginInput.id, message: error.message });
        continue;
      }
    }

    if (!existingPlugin) {
      try {
        const created = runtime.createToolPlugin({
          ...pluginInput,
          tools: item.tools.map((tool) => sanitizeImportedTool(tool, pluginInput.id))
        });
        result.createdPlugins.push(created.id);
        for (const tool of created.tools || []) {
          result.createdTools.push(`${created.id}.${tool.name}`);
        }
      } catch (error) {
        result.errors.push({ pluginId: pluginInput.id, message: error.message });
      }
      continue;
    }

    try {
      const nextPermissions = [...new Set([
        ...(existingPlugin.permissions || []),
        ...(pluginInput.permissions || [])
      ])];
      const nextMetadata = {
        ...(existingPlugin.metadata || {}),
        ...(pluginInput.metadata || {})
      };
      runtime.updateToolPlugin(pluginInput.id, {
        permissions: nextPermissions,
        metadata: nextMetadata
      });
      result.updatedPlugins.push(pluginInput.id);
    } catch (error) {
      result.errors.push({ pluginId: pluginInput.id, message: error.message });
    }

    for (const rawTool of item.tools) {
      const toolInput = sanitizeImportedTool(rawTool, pluginInput.id);
      let normalized;
      try {
        normalized = runtime.normalizeTool(toolInput);
      } catch (error) {
        result.errors.push({ pluginId: pluginInput.id, toolName: toolInput.name, message: error.message });
        continue;
      }

      try {
        runtime.getTool(pluginInput.id, normalized.name);
        if (mode === 'create') {
          result.skippedTools.push(`${pluginInput.id}.${normalized.name}`);
          continue;
        }
        const updated = runtime.updateTool(pluginInput.id, normalized.name, toolInput);
        result.updatedTools.push(updated.id);
      } catch (error) {
        if (!isNotFoundError(error)) {
          result.errors.push({ pluginId: pluginInput.id, toolName: normalized.name, message: error.message });
          continue;
        }
        try {
          const created = runtime.createTool(pluginInput.id, toolInput);
          result.createdTools.push(created.id);
        } catch (createError) {
          result.errors.push({ pluginId: pluginInput.id, toolName: normalized.name, message: createError.message });
        }
      }
    }
  }

  return result;
}

async function deleteTools(runtime, body = {}) {
  const toolIds = normalizeToolDeleteIds(body);
  if (toolIds.length === 0) {
    const error = new Error('Tool delete payload must include toolIds');
    error.statusCode = 400;
    throw error;
  }

  const result = {
    requested: toolIds.length,
    deletedTools: [],
    errors: []
  };

  for (const toolId of toolIds) {
    try {
      const tool = runtime.getTool(toolId);
      const deleted = runtime.deleteTool(tool.pluginId, tool.name);
      result.deletedTools.push(deleted.id);
    } catch (error) {
      result.errors.push({ toolId, message: error.message });
    }
  }

  return result;
}

function normalizeToolImport(body = {}) {
  const raw = body && typeof body === 'object' ? body : {};
  const targetPluginId = typeof raw.targetPluginId === 'string' ? raw.targetPluginId : '';
  const byPlugin = new Map();

  const addPlugin = (pluginLike = {}, tools = []) => {
    if (!pluginLike || typeof pluginLike !== 'object') return;
    const pluginId = pluginLike.id || pluginLike.pluginId || pluginLike.plugin_id;
    if (!pluginId) return;
    if (!byPlugin.has(pluginId)) {
      byPlugin.set(pluginId, {
        plugin: {
          ...pluginLike,
          id: pluginId
        },
        tools: []
      });
    } else {
      byPlugin.get(pluginId).plugin = {
        ...byPlugin.get(pluginId).plugin,
        ...pluginLike,
        id: pluginId
      };
    }
    byPlugin.get(pluginId).tools.push(...tools);
  };

  const addTool = (entry = {}) => {
    if (!entry || typeof entry !== 'object') return;
    const tool = entry.tool || entry.descriptor || entry;
    const pluginId = entry.pluginId || entry.plugin_id || entry.plugin?.id || tool.pluginId || tool.plugin_id || targetPluginId || pluginIdFromImportedToolId(tool.id);
    if (!pluginId) return;
    addPlugin({
      id: pluginId,
      name: entry.plugin?.name || pluginId
    }, [tool]);
  };

  if (Array.isArray(raw)) {
    raw.forEach(addTool);
  }
  if (Array.isArray(raw.plugins)) {
    for (const plugin of raw.plugins) {
      addPlugin(plugin, Array.isArray(plugin.tools) ? plugin.tools : []);
    }
  }
  if (raw.id && Array.isArray(raw.tools) && !Array.isArray(raw.plugins)) {
    addPlugin(raw, raw.tools);
  } else if (Array.isArray(raw.tools)) {
    raw.tools.forEach(addTool);
  }

  return [...byPlugin.values()].map((item) => ({
    plugin: item.plugin,
    tools: item.tools.filter((tool) => tool && typeof tool === 'object')
  })).filter((item) => item.tools.length > 0 || item.plugin?.tools?.length > 0);
}

function normalizeToolDeleteIds(body = {}) {
  if (Array.isArray(body)) {
    return [...new Set(body.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
  }
  const rawIds = Array.isArray(body.toolIds) ? body.toolIds : [];
  const rawTools = Array.isArray(body.tools) ? body.tools : [];
  const ids = [
    ...rawIds,
    ...rawTools.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return undefined;
      if (entry.id) return entry.id;
      if (entry.pluginId && entry.name) return `${entry.pluginId}.${entry.name}`;
      if (entry.plugin_id && entry.name) return `${entry.plugin_id}.${entry.name}`;
      return undefined;
    })
  ];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
}

function sanitizeImportedPlugin(plugin = {}) {
  const sanitized = {
    id: plugin.id || plugin.pluginId || plugin.plugin_id,
    name: plugin.name || plugin.id || plugin.pluginId || plugin.plugin_id,
    version: plugin.version,
    description: plugin.description,
    enabled: plugin.enabled,
    author: plugin.author,
    homepage: plugin.homepage,
    permissions: Array.isArray(plugin.permissions) ? plugin.permissions : undefined,
    metadata: plugin.metadata && typeof plugin.metadata === 'object' ? plugin.metadata : undefined
  };
  return Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== undefined));
}

function sanitizeImportedTool(tool = {}, pluginId = '') {
  const source = tool.tool || tool.descriptor || tool;
  const {
    id,
    pluginId: _pluginId,
    plugin_id: _plugin_id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = source;
  if (!rest.name && id && pluginId && String(id).startsWith(`${pluginId}.`)) {
    rest.name = String(id).slice(pluginId.length + 1);
  }
  return rest;
}

function pluginIdFromImportedToolId(toolId) {
  const text = String(toolId || '');
  const splitIndex = text.lastIndexOf('.');
  return splitIndex > 0 ? text.slice(0, splitIndex) : '';
}

function isNotFoundError(error) {
  return error?.statusCode === 404 || /not found/i.test(error?.message || '');
}

async function readDebugFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    const error = new Error('Debug file path is required');
    error.statusCode = 400;
    throw error;
  }
  const resolvedPath = resolve(filePath);
  const workspaceRoot = resolve(process.cwd());
  if (!isInsideDirectory(resolvedPath, workspaceRoot)) {
    const error = new Error('Debug file must be inside the workspace');
    error.statusCode = 403;
    throw error;
  }
  const info = await stat(resolvedPath);
  if (!info.isFile()) {
    const error = new Error('Debug path is not a file');
    error.statusCode = 400;
    throw error;
  }
  const maxBytes = 1024 * 1024;
  const buffer = await readFile(resolvedPath);
  const truncated = buffer.byteLength > maxBytes;
  const content = buffer.subarray(0, maxBytes).toString('utf8');
  return {
    path: resolvedPath,
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    truncated,
    content
  };
}

async function readLatestDebugTrace(toolId) {
  const workspaceRoot = resolve(process.cwd());
  const traceRoot = resolve(process.env.AI_DND_TOOL_TRACE_DIR || 'data/tool-traces');
  if (!isInsideDirectory(traceRoot, workspaceRoot)) {
    const error = new Error('Debug trace directory must be inside the workspace');
    error.statusCode = 403;
    throw error;
  }

  try {
    const info = await stat(traceRoot);
    if (!info.isDirectory()) return undefined;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }

  let latest;
  for await (const summaryPath of walkDebugSummaries(traceRoot)) {
    let info;
    let summary;
    try {
      [info, summary] = await Promise.all([
        stat(summaryPath),
        readJsonFile(summaryPath)
      ]);
    } catch {
      continue;
    }
    if (!summaryMatchesTool(summary, summaryPath, toolId)) continue;
    if (!latest || info.mtimeMs > latest.modifiedMs) {
      latest = {
        modifiedMs: info.mtimeMs,
        summary: {
          ...summary,
          files: {
            ...(summary.files || {}),
            summary: summary.files?.summary || summaryPath
          }
        }
      };
    }
  }

  return latest?.summary;
}

async function executeDebugToolSequence(runtime, body = {}) {
  const steps = Array.isArray(body.steps)
    ? body.steps
    : Array.isArray(body.calls)
      ? body.calls
      : [];
  if (steps.length === 0) {
    const error = new Error('Debug tool sequence requires a non-empty steps array');
    error.statusCode = 400;
    throw error;
  }

  const sharedContext = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
    ? body.context
    : {};
  const continueOnError = body.continueOnError === true;
  const results = [];

  for (const [index, step] of steps.entries()) {
    const toolId = firstString(step?.toolId, step?.tool, step?.id, step?.name);
    if (!toolId) {
      results.push({
        index,
        ok: false,
        error: {
          name: 'ValidationError',
          message: 'Debug sequence step is missing toolId'
        }
      });
      if (!continueOnError) break;
      continue;
    }

    const stepContext = step.context && typeof step.context === 'object' && !Array.isArray(step.context)
      ? step.context
      : {};
    const context = {
      source: 'debug-tool-sequence',
      ...sharedContext,
      ...stepContext
    };
    if (body.authorization === true && context.authorization === undefined) {
      context.authorization = true;
    }

    try {
      const result = await runtime.executeTool(toolId, step.input || step.args || {}, context);
      results.push({
        index,
        toolId,
        ok: true,
        result
      });
    } catch (error) {
      results.push({
        index,
        toolId,
        ok: false,
        error: serializeDebugToolError(error)
      });
      if (!continueOnError) break;
    }
  }

  return {
    ok: results.every((result) => result.ok),
    count: results.length,
    results
  };
}

function serializeDebugToolError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode
  };
}

async function* walkDebugSummaries(directory, depth = 0, counter = { count: 0 }) {
  if (depth > 4 || counter.count > 5000) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (counter.count > 5000) return;
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkDebugSummaries(entryPath, depth + 1, counter);
    } else if (entry.isFile() && entry.name === 'summary.json') {
      counter.count += 1;
      yield entryPath;
    }
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function expandCharacterImportBody(body = {}) {
  const cardPath = firstString(body.characterCardPath, body.cardPath, body.characterPath, body.path, body.filePath);
  const sidecarPath = firstString(body.sidecarPath, body.resourcesPath, body.characterResourcesPath, body.resourcesSidecarPath);
  let expanded = omitKeys(body, [
    'characterCardPath',
    'cardPath',
    'characterPath',
    'path',
    'filePath',
    'sidecarPath',
    'resourcesPath',
    'characterResourcesPath',
    'resourcesSidecarPath'
  ]);
  if (cardPath) {
    const filePayload = await readLocalImportJson(cardPath, '角色卡 JSON 文件');
    if (filePayload?.format === 'ai-dnd-character-resources-v1') {
      const error = new Error('角色卡路径不能指向资源 sidecar 文件');
      error.statusCode = 400;
      throw error;
    }
    expanded = filePayload?.format === 'ai-dnd-character-bundle-v1' || filePayload?.characterCard
      ? { ...filePayload, ...expanded }
      : { ...expanded, characterCard: filePayload };
    if (!expanded.source) expanded.source = `file:${resolveImportPath(cardPath)}`;
  }
  if (sidecarPath) {
    expanded.sidecar = await readLocalImportJson(sidecarPath, '角色资源 sidecar JSON 文件');
  }
  return expanded;
}

async function expandChatImportBody(body = {}) {
  const chatPath = firstString(body.chatPath, body.chatJsonPath, body.path, body.filePath);
  const sidecarPath = firstString(body.sidecarPath, body.resourcesPath, body.chatResourcesPath, body.resourcesSidecarPath);
  let expanded = omitKeys(body, [
    'chatPath',
    'chatJsonPath',
    'path',
    'filePath',
    'sidecarPath',
    'resourcesPath',
    'chatResourcesPath',
    'resourcesSidecarPath'
  ]);
  if (chatPath) {
    const filePayload = await readLocalImportJson(chatPath, '聊天 JSON 文件');
    if (filePayload?.format === 'ai-dnd-chat-resources-v1') {
      const error = new Error('聊天路径不能指向资源 sidecar 文件');
      error.statusCode = 400;
      throw error;
    }
    expanded = { ...filePayload, ...expanded };
  }
  if (sidecarPath) {
    expanded.sidecar = await readLocalImportJson(sidecarPath, '聊天资源 sidecar JSON 文件');
  }
  return expanded;
}

async function readLocalImportJson(inputPath, label) {
  const filePath = resolveImportPath(inputPath);
  if (!isInsideDirectory(filePath, process.cwd())) {
    const error = new Error(`${label} 必须位于当前项目目录内`);
    error.statusCode = 400;
    throw error;
  }
  if (extname(filePath).toLowerCase() !== '.json') {
    const error = new Error(`${label} 必须是 .json 文件`);
    error.statusCode = 400;
    throw error;
  }
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    error.statusCode = error.statusCode || 400;
    error.message = `${label} 读取失败：${error.message}`;
    throw error;
  }
}

function resolveImportPath(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) {
    const error = new Error('导入文件路径不能为空');
    error.statusCode = 400;
    throw error;
  }
  if (raw.startsWith('file://')) return resolve(fileURLToPath(raw));
  return resolve(process.cwd(), raw);
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim());
}

function omitKeys(input, keys) {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(input || {}).filter(([key]) => !blocked.has(key)));
}

function summaryMatchesTool(summary, summaryPath, toolId) {
  if (!toolId) return true;
  const safeToolId = safeDebugPathSegment(toolId);
  const summaryDirectory = summary?.directory || summaryPath;
  const fileValues = Object.values(summary?.files || {});
  return summary?.toolId === toolId
    || basename(summaryDirectory).includes(safeToolId)
    || fileValues.some((filePath) => typeof filePath === 'string' && filePath.includes(safeToolId));
}

function safeDebugPathSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '-');
}

function isInsideDirectory(filePath, directory) {
  const rel = relative(directory, filePath);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !normalize(rel).startsWith('..'));
}

async function routeAuditRequest(runtime, request, response, url) {
  if (request.method === 'GET' && url.pathname === '/v1/audit/events') {
    writeJson(response, 200, {
      events: runtime.listAuditEvents({
        scopeType: url.searchParams.get('scopeType') || undefined,
        scopeId: url.searchParams.get('scopeId') || undefined,
        operation: url.searchParams.get('operation') || undefined,
        status: url.searchParams.get('status') || undefined,
        reversible: parseOptionalBoolean(url.searchParams.get('reversible')),
        replayable: parseOptionalBoolean(url.searchParams.get('replayable')),
        includeReverted: url.searchParams.get('includeReverted') !== 'false',
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        offset: url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined
      })
    });
    return true;
  }

  const auditEventMatch = url.pathname.match(/^\/v1\/audit\/events\/([^/]+)$/);
  if (request.method === 'GET' && auditEventMatch) {
    writeJson(response, 200, { event: runtime.getAuditEvent(decodeURIComponent(auditEventMatch[1])) });
    return true;
  }

  const auditRollbackMatch = url.pathname.match(/^\/v1\/audit\/events\/([^/]+)\/rollback$/);
  if (request.method === 'POST' && auditRollbackMatch) {
    const body = await readJson(request);
    writeJson(response, 200, await runtime.rollbackAuditEvent(decodeURIComponent(auditRollbackMatch[1]), {
      actor: body.actor || 'user',
      reason: body.reason,
      force: body.force === true
    }));
    return true;
  }

  const auditReplayMatch = url.pathname.match(/^\/v1\/audit\/events\/([^/]+)\/replay$/);
  if (request.method === 'POST' && auditReplayMatch) {
    const body = await readJson(request);
    writeJson(response, 200, await runtime.replayAuditEvent(decodeURIComponent(auditReplayMatch[1]), {
      mode: body.mode || 'captured',
      inputOverride: body.inputOverride,
      contextOverride: body.contextOverride,
      actor: body.actor || 'user',
      reason: body.reason
    }));
    return true;
  }

  return false;
}

async function routeWorldlineRequest(runtime, request, response, url) {
  if (request.method === 'GET' && url.pathname === '/v1/worldlines/savepoints') {
    writeJson(response, 200, {
      savepoints: runtime.listWorldlineSavepoints({
        scopeType: url.searchParams.get('scopeType') || undefined,
        scopeId: url.searchParams.get('scopeId') || undefined,
        branchId: url.searchParams.get('branchId') || undefined,
        includeSnapshot: url.searchParams.get('includeSnapshot') === 'true',
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        offset: url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined
      })
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/worldlines/savepoints') {
    const body = await readJson(request);
    writeJson(response, 201, { savepoint: await runtime.createWorldlineSavepoint(body) });
    return true;
  }

  const savepointRestoreMatch = url.pathname.match(/^\/v1\/worldlines\/savepoints\/([^/]+)\/restore$/);
  if (request.method === 'POST' && savepointRestoreMatch) {
    const body = await readJson(request);
    writeJson(response, 200, await runtime.restoreWorldlineSavepoint(decodeURIComponent(savepointRestoreMatch[1]), {
      actor: body.actor || 'user',
      reason: body.reason,
      setActiveBranch: body.setActiveBranch !== false,
      branchId: body.branchId
    }));
    return true;
  }

  const savepointMatch = url.pathname.match(/^\/v1\/worldlines\/savepoints\/([^/]+)$/);
  if (request.method === 'GET' && savepointMatch) {
    writeJson(response, 200, {
      savepoint: runtime.getWorldlineSavepoint(decodeURIComponent(savepointMatch[1]), {
        includeSnapshot: url.searchParams.get('includeSnapshot') !== 'false'
      })
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/worldlines/branches') {
    writeJson(response, 200, {
      branches: runtime.listWorldlineBranches({
        scopeType: url.searchParams.get('scopeType') || undefined,
        scopeId: url.searchParams.get('scopeId') || undefined,
        status: url.searchParams.get('status') || undefined,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        offset: url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined
      })
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/worldlines/branches') {
    const body = await readJson(request);
    writeJson(response, 201, await runtime.createWorldlineBranch(body));
    return true;
  }

  const branchSwitchMatch = url.pathname.match(/^\/v1\/worldlines\/branches\/([^/]+)\/switch$/);
  if (request.method === 'POST' && branchSwitchMatch) {
    const body = await readJson(request);
    writeJson(response, 200, await runtime.switchWorldlineBranch(decodeURIComponent(branchSwitchMatch[1]), {
      savepointId: body.savepointId,
      actor: body.actor || 'user',
      reason: body.reason
    }));
    return true;
  }

  const branchMatch = url.pathname.match(/^\/v1\/worldlines\/branches\/([^/]+)$/);
  if (request.method === 'GET' && branchMatch) {
    writeJson(response, 200, { branch: runtime.getWorldlineBranch(decodeURIComponent(branchMatch[1])) });
    return true;
  }

  return false;
}

async function routeAgentProgressRequest(runtime, request, response, url) {
  if (request.method === 'GET' && url.pathname === '/v1/agent-progress/events') {
    writeJson(response, 200, {
      events: runtime.listAgentProgressEvents?.({
        chatSessionId: url.searchParams.get('chatSessionId') || undefined,
        turnId: url.searchParams.get('turnId') || undefined,
        afterSequence: url.searchParams.get('afterSequence') || undefined
      }) || []
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/agent-progress/stream') {
    streamAgentProgress(runtime, request, response, url);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/agent-progress/router-items/skip') {
    if (!runtime.requestAgentRouterItemSkip) {
      const error = new Error('Router review skip is not available');
      error.statusCode = 503;
      throw error;
    }
    const body = await readJson(request);
    const skip = runtime.requestAgentRouterItemSkip({
      chatSessionId: body.chatSessionId || body.chatId || url.searchParams.get('chatSessionId'),
      turnId: body.turnId || url.searchParams.get('turnId'),
      itemId: body.itemId || body.routerItemId,
      reason: body.reason,
      actor: body.actor || 'user'
    });
    if (!skip) {
      const error = new Error('chatSessionId, turnId, and itemId are required');
      error.statusCode = 400;
      throw error;
    }
    writeJson(response, 200, { skip });
    return true;
  }

  return false;
}

function streamAgentProgress(runtime, request, response, url) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*'
  });
  response.write(': connected\n\n');

  const filter = {
    chatSessionId: url.searchParams.get('chatSessionId') || undefined,
    turnId: url.searchParams.get('turnId') || undefined,
    afterSequence: url.searchParams.get('afterSequence') || undefined
  };
  for (const event of runtime.listAgentProgressEvents?.(filter) || []) {
    writeSse(response, 'agent-progress', event);
  }

  const unsubscribe = runtime.subscribeAgentProgress?.(filter, (event) => {
    writeSse(response, 'agent-progress', event);
  }) || (() => {});
  const heartbeat = setInterval(() => {
    response.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeSse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function routeAppRequest({ appDatabase, runtime }, request, response, url) {
  if (request.method === 'GET' && url.pathname === '/v1/app/characters') {
    writeJson(response, 200, {
      characters: appDatabase.listCharacterCards({
        includeArchived: url.searchParams.get('includeArchived') === 'true'
      })
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/app/characters/import') {
    const body = await expandCharacterImportBody(await readJson(request));
    const result = runtime?.appDatabase === appDatabase && runtime?.importAppCharacterBundle
      ? await runtime.importAppCharacterBundle(body, {
        characterCardId: body.characterCardId,
        source: body.source || 'api-import',
        notes: body.notes || ''
      })
      : {
        character: appDatabase.importCharacterCard(body.characterCard || body.card || body, {
          characterCardId: body.characterCardId,
          source: body.source || 'api-import',
          notes: body.notes || ''
        })
      };
    writeJson(response, 201, result);
    return true;
  }

  const characterResourcesImportMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/resources\/import$/);
  if (request.method === 'POST' && characterResourcesImportMatch) {
    if (!(runtime?.appDatabase === appDatabase && runtime?.importAppCharacterResources)) {
      const error = new Error('Character resource import requires the app runtime');
      error.statusCode = 503;
      throw error;
    }
    const characterCardId = decodeURIComponent(characterResourcesImportMatch[1]);
    const resources = await runtime.importAppCharacterResources(characterCardId, await readJson(request));
    writeJson(response, 200, { resources });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/app/initial-settings/export') {
    writeJson(response, 200, appDatabase.exportAllInitialSettings({
      includeArchived: parseOptionalBoolean(url.searchParams.get('includeArchived')) ?? true,
      includeEmpty: url.searchParams.get('includeEmpty') === 'true',
      includeLocations: url.searchParams.get('includeLocations') !== 'false',
      includeChats: url.searchParams.get('includeChats') === 'true'
    }));
    return true;
  }

  const characterResourcesExportMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/export\/resources$/);
  if (request.method === 'GET' && characterResourcesExportMatch) {
    const characterCardId = decodeURIComponent(characterResourcesExportMatch[1]);
    const character = appDatabase.getCharacterCard(characterCardId);
    const result = runtime?.appDatabase === appDatabase && runtime?.exportAppCharacterResources
      ? await runtime.exportAppCharacterResources(characterCardId)
      : {
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
          initialSetting: appDatabase.getInitialSetting(characterCardId)
        },
        resources: {}
      };
    writeJson(response, 200, result);
    return true;
  }

  const characterExportMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/export$/);
  if (request.method === 'GET' && characterExportMatch) {
    const characterCardId = decodeURIComponent(characterExportMatch[1]);
    writeJson(response, 200, appDatabase.exportCharacterCard(characterCardId, {
      revisionId: url.searchParams.get('revisionId') || undefined
    }));
    return true;
  }

  const characterSwitchMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/switch$/);
  if (request.method === 'POST' && characterSwitchMatch) {
    const body = await readJson(request);
    const result = appDatabase.switchCharacterCard(decodeURIComponent(characterSwitchMatch[1]), body);
    if (runtime?.appDatabase === appDatabase && runtime?.cloneAppChatResources && result.session?.id) {
      result.resourceClones = await runtime.cloneAppChatResources(result.session.id);
    }
    writeJson(response, 200, result);
    return true;
  }

  const characterArchiveMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/archive$/);
  if (request.method === 'POST' && characterArchiveMatch) {
    const body = await readJson(request);
    writeJson(response, 200, appDatabase.archiveCharacterCard(decodeURIComponent(characterArchiveMatch[1]), {
      archiveChats: body.archiveChats !== false
    }));
    return true;
  }

  const characterRestoreMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/restore$/);
  if (request.method === 'POST' && characterRestoreMatch) {
    const body = await readJson(request);
    writeJson(response, 200, appDatabase.restoreCharacterCard(decodeURIComponent(characterRestoreMatch[1]), {
      restoreChats: body.restoreChats === true
    }));
    return true;
  }

  const characterDataSchemaMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/data-schema$/);
  if (characterDataSchemaMatch) {
    const characterCardId = decodeURIComponent(characterDataSchemaMatch[1]);
    if (request.method === 'GET') {
      writeJson(response, 200, { dataSchema: appDatabase.getCharacterDataSchema(characterCardId) });
      return true;
    }
    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await readJson(request);
      const dataSchema = appDatabase.registerCharacterDataSchema(characterCardId, body.schema || body, {
        syncExisting: body.syncExisting !== false,
        syncMode: body.syncMode || 'merge'
      });
      writeJson(response, 200, { dataSchema });
      return true;
    }
    if (request.method === 'DELETE') {
      writeJson(response, 200, appDatabase.unregisterCharacterDataSchema(characterCardId));
      return true;
    }
  }

  const characterInitialSettingPreviewMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/initial-setting\/preview$/);
  if (request.method === 'POST' && characterInitialSettingPreviewMatch) {
    const body = await readJson(request);
    writeJson(response, 200, appDatabase.previewInitialSetting(decodeURIComponent(characterInitialSettingPreviewMatch[1]), body));
    return true;
  }

  const characterInitialSettingApplyMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/initial-setting\/apply$/);
  if (request.method === 'POST' && characterInitialSettingApplyMatch) {
    const body = await readJson(request);
    writeJson(response, 200, appDatabase.applyInitialSettingToCharacterChats(
      decodeURIComponent(characterInitialSettingApplyMatch[1]),
      body
    ));
    return true;
  }

  const characterInitialSettingExportMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/initial-setting\/export$/);
  if (request.method === 'GET' && characterInitialSettingExportMatch) {
    writeJson(response, 200, appDatabase.exportInitialSetting(
      decodeURIComponent(characterInitialSettingExportMatch[1]),
      {
        includeLocations: url.searchParams.get('includeLocations') !== 'false',
        includeChats: url.searchParams.get('includeChats') !== 'false'
      }
    ));
    return true;
  }

  const characterInitialSettingFieldMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/initial-setting\/collections\/([^/]+)\/fields\/([^/]+)$/);
  if (characterInitialSettingFieldMatch) {
    const characterCardId = decodeURIComponent(characterInitialSettingFieldMatch[1]);
    const collection = decodeURIComponent(characterInitialSettingFieldMatch[2]);
    const field = decodeURIComponent(characterInitialSettingFieldMatch[3]);
    if (request.method === 'PATCH' || request.method === 'PUT') {
      const body = await readJson(request);
      writeJson(response, 200, appDatabase.updateInitialSettingField(
        characterCardId,
        collection,
        field,
        body.field || body,
        {
          syncExisting: body.syncExisting === true || url.searchParams.get('syncExisting') === 'true',
          includeArchived: body.includeArchived === true || url.searchParams.get('includeArchived') === 'true',
          chatSessionIds: body.chatSessionIds
        }
      ));
      return true;
    }
    if (request.method === 'DELETE') {
      const body = await readJson(request);
      writeJson(response, 200, appDatabase.deleteInitialSettingField(
        characterCardId,
        collection,
        field,
        {
          syncExisting: body.syncExisting === true || url.searchParams.get('syncExisting') === 'true',
          includeArchived: body.includeArchived === true || url.searchParams.get('includeArchived') === 'true',
          chatSessionIds: body.chatSessionIds
        }
      ));
      return true;
    }
  }

  const characterInitialSettingMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)\/initial-setting$/);
  if (characterInitialSettingMatch) {
    const characterCardId = decodeURIComponent(characterInitialSettingMatch[1]);
    if (request.method === 'GET') {
      writeJson(response, 200, appDatabase.getInitialSetting(characterCardId));
      return true;
    }
    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await readJson(request);
      writeJson(response, 200, appDatabase.saveInitialSetting(characterCardId, body, {
        syncExisting: body.syncExisting === true,
        syncMode: body.syncMode || 'merge'
      }));
      return true;
    }
    if (request.method === 'DELETE') {
      writeJson(response, 200, appDatabase.deleteInitialSetting(characterCardId));
      return true;
    }
  }

  const characterMatch = url.pathname.match(/^\/v1\/app\/characters\/([^/]+)$/);
  if (characterMatch) {
    const characterCardId = decodeURIComponent(characterMatch[1]);
    if (request.method === 'GET') {
      writeJson(response, 200, { character: appDatabase.getCharacterCard(characterCardId) });
      return true;
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      const character = appDatabase.updateCharacterCard(
        characterCardId,
        body.characterCard || body.card || body,
        {
          source: body.source || 'api-update',
          notes: body.notes || ''
        }
      );
      writeJson(response, 200, { character });
      return true;
    }
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const character = appDatabase.patchCharacterCard(characterCardId, body.patch || body, {
        source: body.source || 'api-patch',
        notes: body.notes || ''
      });
      writeJson(response, 200, { character });
      return true;
    }
    if (request.method === 'DELETE') {
      const mode = url.searchParams.get('mode') || (url.searchParams.get('archive') === 'true' ? 'archive' : 'delete');
      if (mode === 'archive') {
        writeJson(response, 200, appDatabase.archiveCharacterCard(characterCardId));
      } else {
        const resourceCleanup = runtime?.appDatabase === appDatabase && runtime?.cleanupAppCharacterResources
          ? await runtime.cleanupAppCharacterResources(characterCardId)
          : undefined;
        writeJson(response, 200, {
          ...appDatabase.deleteCharacterCard(characterCardId),
          resourceCleanup
        });
      }
      return true;
    }
  }

  if (request.method === 'GET' && url.pathname === '/v1/app/chats') {
    writeJson(response, 200, {
      chats: appDatabase.listChatSessions({
        characterCardId: url.searchParams.get('characterCardId') || undefined,
        includeArchived: url.searchParams.get('includeArchived') === 'true'
      }),
      active: appDatabase.getActiveChatState()
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/app/chats') {
    const body = await readJson(request);
    const result = runtime?.appDatabase === appDatabase && runtime?.createAppChatSession
      ? await runtime.createAppChatSession(body)
      : appDatabase.createChatSession(body);
    if (!result.resourceClones && runtime?.appDatabase === appDatabase && runtime?.cloneAppChatResources && result.session?.id) {
      result.resourceClones = await runtime.cloneAppChatResources(result.session.id);
    }
    writeJson(response, 201, result);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/app/chats/import') {
    const body = await expandChatImportBody(await readJson(request));
    const result = runtime?.appDatabase === appDatabase && runtime?.importAppChatBundle
      ? await runtime.importAppChatBundle(body)
      : { chat: appDatabase.importChatSession(body) };
    writeJson(response, 201, result);
    return true;
  }

  const chatResourcesImportMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/resources\/import$/);
  if (request.method === 'POST' && chatResourcesImportMatch) {
    if (!(runtime?.appDatabase === appDatabase && runtime?.importAppChatResources)) {
      const error = new Error('Chat resource import requires the app runtime');
      error.statusCode = 503;
      throw error;
    }
    const chatSessionId = decodeURIComponent(chatResourcesImportMatch[1]);
    const resources = await runtime.importAppChatResources(chatSessionId, await readJson(request));
    const initialization = runtime.initializeAppChatSession
      ? await runtime.initializeAppChatSession(chatSessionId, {
        source: 'app.chat.resources.import'
      })
      : undefined;
    writeJson(response, 200, { resources, initialization });
    return true;
  }

  const chatResourcesExportMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/export\/resources$/);
  if (request.method === 'GET' && chatResourcesExportMatch) {
    const chatSessionId = decodeURIComponent(chatResourcesExportMatch[1]);
    const session = appDatabase.getChatSession(chatSessionId, {
      includeMessages: false,
      includeCharacter: false,
      includeDataDatabase: false
    });
    const result = runtime?.appDatabase === appDatabase && runtime?.exportAppChatResources
      ? await runtime.exportAppChatResources(chatSessionId)
      : {
        format: 'ai-dnd-chat-resources-v1',
        exportedAt: new Date().toISOString(),
        chatSession: {
          id: session.id,
          characterCardId: session.characterCardId,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        },
        resources: {}
      };
    writeJson(response, 200, result);
    return true;
  }

  const chatExportMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/export$/);
  if (request.method === 'GET' && chatExportMatch) {
    const chatSessionId = decodeURIComponent(chatExportMatch[1]);
    writeJson(response, 200, appDatabase.exportChatSession(chatSessionId));
    return true;
  }

  const chatSwitchMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/switch$/);
  if (request.method === 'POST' && chatSwitchMatch) {
    writeJson(response, 200, appDatabase.switchChatSession(decodeURIComponent(chatSwitchMatch[1])));
    return true;
  }

  const chatInitialSettingApplyMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/initial-setting\/apply$/);
  if (request.method === 'POST' && chatInitialSettingApplyMatch) {
    const body = await readJson(request);
    const chatSessionId = decodeURIComponent(chatInitialSettingApplyMatch[1]);
    const applied = appDatabase.applyInitialSettingToChat(chatSessionId, body);
    const initialization = runtime?.appDatabase === appDatabase && runtime?.initializeAppChatSession
      ? await runtime.initializeAppChatSession(chatSessionId, {
        source: 'app.chat.initial-setting.apply',
        force: body.forceInitialize === true
      })
      : undefined;
    const greeting = body.includeGreeting === true && runtime?.appDatabase === appDatabase && runtime?.addAppChatProtagonistGreeting
      ? await runtime.addAppChatProtagonistGreeting(chatSessionId, {
        source: 'app.chat.initial-setting.apply',
        initialization,
        force: body.forceGreeting === true
      })
      : undefined;
    writeJson(response, 200, {
      ...applied,
      initialization,
      greeting
    });
    return true;
  }

  const chatInitializeMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/initialize$/);
  if (request.method === 'POST' && chatInitializeMatch) {
    if (!(runtime?.appDatabase === appDatabase && runtime?.initializeAppChatSession)) {
      const error = new Error('App chat initialization requires the app runtime');
      error.statusCode = 503;
      throw error;
    }
    const chatSessionId = decodeURIComponent(chatInitializeMatch[1]);
    const body = await readJson(request);
    const initialization = await runtime.initializeAppChatSession(chatSessionId, {
      source: body.source || 'app.chat.initialize',
      sceneId: body.sceneId || body.currentSceneId || 'current',
      force: body.force === true
    });
    const greeting = body.includeGreeting === true && runtime.addAppChatProtagonistGreeting
      ? await runtime.addAppChatProtagonistGreeting(chatSessionId, {
        source: body.source || 'app.chat.initialize',
        initialization,
        force: body.forceGreeting === true
      })
      : undefined;
    writeJson(response, 200, {
      initialization,
      greeting,
      chat: appDatabase.getChatSession(chatSessionId)
    });
    return true;
  }

  const chatDataDbMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/data-db$/);
  if (request.method === 'GET' && chatDataDbMatch) {
    writeJson(response, 200, { dataDatabase: appDatabase.getChatDataDatabase(decodeURIComponent(chatDataDbMatch[1])) });
    return true;
  }

  const chatDataDbSyncMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/data-db\/sync$/);
  if (request.method === 'POST' && chatDataDbSyncMatch) {
    const body = await readJson(request);
    const dataDatabase = appDatabase.ensureChatDataDatabase(decodeURIComponent(chatDataDbSyncMatch[1]), {
      forceSync: true,
      syncMode: body.syncMode || 'merge'
    });
    writeJson(response, 200, { dataDatabase });
    return true;
  }

  const chatDataCollectionsMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/data-db\/collections$/);
  if (request.method === 'GET' && chatDataCollectionsMatch) {
    writeJson(response, 200, appDatabase.listChatDataCollections(decodeURIComponent(chatDataCollectionsMatch[1])));
    return true;
  }

  const chatDataRecordMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/data-db\/collections\/([^/]+)\/records\/([^/]+)$/);
  if (chatDataRecordMatch) {
    const chatId = decodeURIComponent(chatDataRecordMatch[1]);
    const collection = decodeURIComponent(chatDataRecordMatch[2]);
    const recordId = decodeURIComponent(chatDataRecordMatch[3]);
    if (request.method === 'GET') {
      writeJson(response, 200, { record: appDatabase.getChatDataRecord(chatId, collection, recordId) });
      return true;
    }
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const record = appDatabase.patchChatDataRecord(chatId, collection, recordId, body.patch || body);
      publishChatDataSettlementChange(runtime, {
        chatSessionId: chatId,
        collection,
        recordId,
        action: 'patch',
        record
      });
      writeJson(response, 200, {
        record
      });
      return true;
    }
    if (request.method === 'DELETE') {
      const result = appDatabase.deleteChatDataRecord(chatId, collection, recordId);
      publishChatDataSettlementChange(runtime, {
        chatSessionId: chatId,
        collection,
        recordId,
        action: 'delete'
      });
      writeJson(response, 200, result);
      return true;
    }
  }

  const chatDataRecordsMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/data-db\/collections\/([^/]+)\/records$/);
  if (request.method === 'POST' && chatDataRecordsMatch) {
    const body = await readJson(request);
    const chatId = decodeURIComponent(chatDataRecordsMatch[1]);
    const collection = decodeURIComponent(chatDataRecordsMatch[2]);
    const record = appDatabase.upsertChatDataRecord(
      chatId,
      collection,
      body.record || body,
      { id: body.id }
    );
    publishChatDataSettlementChange(runtime, {
      chatSessionId: chatId,
      collection,
      recordId: record?.id || body.id,
      action: 'upsert',
      record
    });
    writeJson(response, 201, { record });
    return true;
  }

  const chatDataQueryMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/data-db\/collections\/([^/]+)\/query$/);
  if (request.method === 'POST' && chatDataQueryMatch) {
    const body = await readJson(request);
    writeJson(response, 200, appDatabase.queryChatDataRecords(
      decodeURIComponent(chatDataQueryMatch[1]),
      decodeURIComponent(chatDataQueryMatch[2]),
      body
    ));
    return true;
  }

  const chatDataCollectionMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/data-db\/collections\/([^/]+)$/);
  if (request.method === 'GET' && chatDataCollectionMatch) {
    writeJson(response, 200, {
      collection: appDatabase.describeChatDataCollection(
        decodeURIComponent(chatDataCollectionMatch[1]),
        decodeURIComponent(chatDataCollectionMatch[2])
      )
    });
    return true;
  }

  const chatMessagesMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/messages$/);
  if (chatMessagesMatch) {
    const chatId = decodeURIComponent(chatMessagesMatch[1]);
    if (request.method === 'GET') {
      writeJson(response, 200, { messages: appDatabase.listChatMessages(chatId) });
      return true;
    }
    if (request.method === 'POST') {
      const body = await readJson(request);
      const result = runtime?.appDatabase === appDatabase && runtime?.addAppChatMessage
        ? runtime.addAppChatMessage(chatId, body, {
          actor: body.actor || 'user',
          reason: body.reason
        })
        : { message: appDatabase.addChatMessage(chatId, body) };
      writeJson(response, 201, result);
      return true;
    }
  }

  const chatSendMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/send$/);
  if (request.method === 'POST' && chatSendMatch) {
    if (!runtime?.sendAppChatMessage) {
      const error = new Error('App chat send is not available');
      error.name = 'AppChatSendUnavailableError';
      error.statusCode = 503;
      throw error;
    }
    const body = await readJson(request);
    const result = await runtime.sendAppChatMessage(
      decodeURIComponent(chatSendMatch[1]),
      body.content,
      body.options || {}
    );
    writeJson(response, 200, {
      chat: result.chat,
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      prompt: body.includePrompt ? result.prompt : undefined,
      completion: result.completion,
      structuredOutput: result.structuredOutput,
      agentLoop: result.agentLoop,
      agentLoopTrace: result.agentLoopTrace,
      savepoint: result.savepoint
    });
    return true;
  }

  const chatMessagesTruncateMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/messages\/truncate$/);
  if (request.method === 'POST' && chatMessagesTruncateMatch) {
    const chatId = decodeURIComponent(chatMessagesTruncateMatch[1]);
    const body = await readJson(request);
    const result = runtime?.appDatabase === appDatabase && runtime?.deleteAppChatMessagesAfter
      ? runtime.deleteAppChatMessagesAfter(chatId, {
        messageId: body.messageId,
        orderIndex: body.orderIndex,
        inclusive: body.inclusive === true,
        reason: body.reason,
        actor: body.actor || 'user'
      })
      : appDatabase.deleteChatMessagesAfter(chatId, body);
    writeJson(response, 200, result);
    return true;
  }

  const chatMessageMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/messages\/([^/]+)$/);
  const chatMessageUpdateMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/messages\/([^/]+)\/update$/);
  if (request.method === 'POST' && chatMessageUpdateMatch) {
    const chatId = decodeURIComponent(chatMessageUpdateMatch[1]);
    const messageId = decodeURIComponent(chatMessageUpdateMatch[2]);
    const body = await readJson(request);
    const patch = {};
    if (Object.hasOwn(body, 'content')) patch.content = body.content;
    if (Object.hasOwn(body, 'metadata')) patch.metadata = body.metadata;
    const result = runtime?.appDatabase === appDatabase && runtime?.updateAppChatMessage
      ? runtime.updateAppChatMessage(chatId, messageId, patch, {
        actor: body.actor || 'user',
        reason: body.reason
      })
      : { message: appDatabase.updateChatMessage(chatId, messageId, patch) };
    writeJson(response, 200, result);
    return true;
  }

  if ((request.method === 'PATCH' || request.method === 'PUT') && chatMessageMatch) {
    const chatId = decodeURIComponent(chatMessageMatch[1]);
    const messageId = decodeURIComponent(chatMessageMatch[2]);
    const body = await readJson(request);
    const patch = {};
    if (Object.hasOwn(body, 'content')) patch.content = body.content;
    if (Object.hasOwn(body, 'metadata')) patch.metadata = body.metadata;
    const result = runtime?.appDatabase === appDatabase && runtime?.updateAppChatMessage
      ? runtime.updateAppChatMessage(chatId, messageId, patch, {
        actor: body.actor || 'user',
        reason: body.reason
      })
      : { message: appDatabase.updateChatMessage(chatId, messageId, patch) };
    writeJson(response, 200, result);
    return true;
  }

  if (request.method === 'DELETE' && chatMessageMatch) {
    const chatId = decodeURIComponent(chatMessageMatch[1]);
    const messageId = decodeURIComponent(chatMessageMatch[2]);
    const body = await readJson(request);
    const result = runtime?.appDatabase === appDatabase && runtime?.deleteAppChatMessage
      ? runtime.deleteAppChatMessage(chatId, messageId, {
        actor: body.actor || 'user',
        reason: body.reason
      })
      : appDatabase.deleteChatMessage(messageId);
    writeJson(response, 200, result);
    return true;
  }

  const chatUpdateMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)\/update$/);
  if (request.method === 'POST' && chatUpdateMatch) {
    const body = await readJson(request);
    writeJson(response, 200, {
      chat: appDatabase.updateChatSession(decodeURIComponent(chatUpdateMatch[1]), body)
    });
    return true;
  }

  const chatMatch = url.pathname.match(/^\/v1\/app\/chats\/([^/]+)$/);
  if (chatMatch) {
    const chatId = decodeURIComponent(chatMatch[1]);
    if (request.method === 'GET') {
      writeJson(response, 200, { chat: appDatabase.getChatSession(chatId) });
      return true;
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      const body = await readJson(request);
      writeJson(response, 200, { chat: appDatabase.updateChatSession(chatId, body) });
      return true;
    }
    if (request.method === 'DELETE') {
      const resourceCleanup = runtime?.appDatabase === appDatabase && runtime?.cleanupAppChatResources
        ? await runtime.cleanupAppChatResources(chatId)
        : undefined;
      writeJson(response, 200, {
        ...appDatabase.deleteChatSession(chatId),
        resourceCleanup
      });
      return true;
    }
  }

  return false;
}

function publishChatDataSettlementChange(runtime, { chatSessionId, collection, recordId, action, record } = {}) {
  if (!runtime?.publishSettlementChange || !chatSessionId || !collection) return;
  const category = chatDataSettlementCategory(collection);
  const verb = action === 'delete'
    ? '删除'
    : action === 'patch'
      ? '更新'
      : '入库';
  runtime.publishSettlementChange({
    chatSessionId,
    collection,
    recordId: recordId || record?.id,
    type: category.type,
    title: category.title,
    text: `${category.subject}已${verb}`,
    detail: [collection, recordId || record?.id].filter(Boolean).join(' · ')
  });
}

function chatDataSettlementCategory(collection = '') {
  const text = String(collection || '').toLowerCase();
  if (/inventory|item|equipment|resource|loot/.test(text)) return { type: 'inventory', title: '背包变化', subject: '背包' };
  if (/status|effect|time|clock|trigger/.test(text)) return { type: 'status', title: '状态变化', subject: '状态' };
  if (/npc|actor|party|relationship|faction|protagonist/.test(text)) return { type: 'npc', title: '人物变化', subject: 'NPC' };
  if (/map|scene|location|route|path/.test(text)) return { type: 'map', title: '地图变化', subject: '地图' };
  if (/quest|encounter/.test(text)) return { type: 'quest', title: '任务变化', subject: '任务' };
  if (/combat|battle|damage|dice/.test(text)) return { type: 'combat', title: '战斗变化', subject: '战斗' };
  if (/memory|rag|compression/.test(text)) return { type: 'memory', title: '记忆变化', subject: '记忆' };
  return { type: 'data', title: '数据变化', subject: '数据' };
}

async function routeStaticRequest(request, response, url) {
  const asset = resolveStaticAsset(url.pathname);
  if (!asset) return false;

  const info = await stat(asset.filePath).catch(() => undefined);
  if (!info?.isFile()) {
    writeText(response, 404, 'Not found');
    return true;
  }

  response.writeHead(200, {
    'content-type': contentTypeFor(asset.filePath),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(asset.filePath);
    stream.on('error', reject);
    response.on('finish', resolvePromise);
    stream.pipe(response);
  });
  return true;
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
  }
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization'
  });

  if (statusCode === 204) {
    response.end();
    return;
  }

  response.end(JSON.stringify(payload, null, 2));
}

function writeText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*'
  });
  response.end(text);
}

function resolveStaticAsset(pathname) {
  if (pathname === '/' || pathname === '/app' || pathname === '/app/') {
    return {
      filePath: resolve(PUBLIC_DIR, 'index.html'),
      cacheable: false
    };
  }
  if (pathname === '/tool-manager' || pathname === '/tool-manager/') {
    return {
      filePath: resolve(PUBLIC_DIR, 'tool-manager.html'),
      cacheable: false
    };
  }
  if (pathname.startsWith('/tool-manager/')) {
    const rawRelative = decodeURIComponent(pathname.slice('/tool-manager/'.length));
    const relative = normalize(rawRelative).replace(/^(\.\.[/\\])+/, '');
    const filePath = resolve(PUBLIC_DIR, relative);
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
      return undefined;
    }
    return {
      filePath,
      cacheable: false
    };
  }
  if (!pathname.startsWith('/app/')) return undefined;
  const rawRelative = decodeURIComponent(pathname.slice('/app/'.length));
  const relative = normalize(rawRelative).replace(/^(\.\.[/\\])+/, '');
  const filePath = resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    return undefined;
  }
  return {
    filePath,
    cacheable: false
  };
}

function contentTypeFor(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function parseOptionalBoolean(value) {
  if (value === null || value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
