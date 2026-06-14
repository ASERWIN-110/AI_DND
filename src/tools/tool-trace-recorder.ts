// @ts-nocheck
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createId, nowIso } from '../utils/id.js';

const DEFAULT_TRACE_DIR = 'data/tool-traces';
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|token|secret|password|credential)/i;

export class ToolTraceRecorder {
  constructor({
    enabled = true,
    directory = DEFAULT_TRACE_DIR,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    this.enabled = enabled;
    this.directory = directory === null ? null : resolve(cwd, directory || DEFAULT_TRACE_DIR);
    this.now = now;
  }

  startToolCall({ tool, plugin, input, context }) {
    if (!this.enabled || !this.directory) return undefined;

    const traceId = createId('tooltrace');
    const startedAt = this.now();
    const day = startedAt.slice(0, 10);
    const traceDirectory = resolve(
      this.directory,
      day,
      `${safePathSegment(startedAt)}_${safePathSegment(traceId)}_${safePathSegment(tool.id)}`
    );
    mkdirSync(traceDirectory, { recursive: true });

    const trace = {
      id: traceId,
      directory: traceDirectory,
      startedAt,
      files: {
        tool: resolve(traceDirectory, 'tool.json'),
        input: resolve(traceDirectory, 'input.json'),
        output: resolve(traceDirectory, 'output.json'),
        error: resolve(traceDirectory, 'error.json'),
        summary: resolve(traceDirectory, 'summary.json')
      }
    };

    writeJson(trace.files.tool, {
      traceId,
      stage: 'tool_descriptor',
      tool,
      plugin: {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        permissions: plugin.permissions,
        metadata: plugin.metadata
      }
    });
    writeJson(trace.files.input, {
      traceId,
      stage: 'before_handler',
      toolId: tool.id,
      pluginId: plugin.id,
      toolName: tool.name,
      input,
      context
    });
    writeJson(trace.files.summary, {
      traceId,
      status: 'started',
      toolId: tool.id,
      pluginId: plugin.id,
      toolName: tool.name,
      startedAt,
      directory: traceDirectory,
      files: {
        tool: trace.files.tool,
        input: trace.files.input,
        summary: trace.files.summary
      }
    });

    return trace;
  }

  finishToolCall(trace, { output, finishedAt = this.now() } = {}) {
    if (!trace) return undefined;

    writeJson(trace.files.output, {
      traceId: trace.id,
      stage: 'after_handler',
      output
    });
    const summary = {
      traceId: trace.id,
      status: 'success',
      startedAt: trace.startedAt,
      finishedAt,
      durationMs: durationMs(trace.startedAt, finishedAt),
      directory: trace.directory,
      files: {
        tool: trace.files.tool,
        input: trace.files.input,
        output: trace.files.output,
        summary: trace.files.summary
      }
    };
    writeJson(trace.files.summary, summary);
    return summary;
  }

  failToolCall(trace, { error, finishedAt = this.now() } = {}) {
    if (!trace) return undefined;

    writeJson(trace.files.error, {
      traceId: trace.id,
      stage: 'handler_or_validation_error',
      error: serializeError(error)
    });
    const summary = {
      traceId: trace.id,
      status: 'error',
      startedAt: trace.startedAt,
      finishedAt,
      durationMs: durationMs(trace.startedAt, finishedAt),
      directory: trace.directory,
      files: {
        tool: trace.files.tool,
        input: trace.files.input,
        error: trace.files.error,
        summary: trace.files.summary
      }
    };
    writeJson(trace.files.summary, summary);
    return summary;
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(sanitizeForJson(value), null, 2)}\n`);
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
  if (value instanceof Error) return serializeError(value);
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

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    stack: error?.stack
  };
}

function safePathSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '-');
}

function durationMs(startedAt, finishedAt) {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? duration : undefined;
}
