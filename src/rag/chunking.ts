// @ts-nocheck
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';

export const RAG_CHUNK_VERSION = 'rag-chunk-v2';

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 150;

export function chunkText(text, { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP } = {}) {
  return fixedSizeChunks(text, { chunkSize, overlap }).map((chunk) => chunk.text);
}

export function chunkDocuments(text, {
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
  strategy = 'auto',
  chunking,
  format = 'text',
  metadata = {},
  fieldChunking
} = {}) {
  const source = String(text || '').trim();
  if (!source) return [];

  const resolved = resolveChunkStrategy({ strategy: chunking || strategy, format, text: source, metadata });
  let chunks;
  if (resolved === 'database') {
    chunks = chunkDatabaseSnapshot(source, { format, metadata, fieldChunking });
  } else if (resolved === 'structured') {
    chunks = chunkStructuredDocument(source, { format, metadata, fieldChunking });
  } else if (resolved === 'markdown') {
    chunks = chunkMarkdown(source);
  } else if (resolved === 'chat') {
    chunks = chunkChatLike(source, { format });
  } else {
    chunks = fixedSizeChunks(source, { chunkSize, overlap });
  }

  const normalized = chunks
    .map((chunk) => normalizeChunk(chunk))
    .filter((chunk) => chunk.text);
  const split = [];
  for (const chunk of normalized) {
    if (chunk.text.length <= chunkSize) {
      split.push(chunk);
      continue;
    }
    const parts = fixedSizeChunks(chunk.text, { chunkSize, overlap });
    for (let index = 0; index < parts.length; index += 1) {
      split.push({
        ...parts[index],
        metadata: {
          ...chunk.metadata,
          parentChunkKind: chunk.metadata?.chunkKind,
          parentHeading: chunk.metadata?.heading,
          partIndex: index
        }
      });
    }
  }

  return split.map((chunk, index) => ({
    ...chunk,
    idSuffix: chunk.idSuffix || String(index + 1),
    metadata: {
      chunkVersion: RAG_CHUNK_VERSION,
      chunkStrategy: resolved,
      ...(chunk.metadata || {}),
      chunkIndex: index
    }
  }));
}

export function fixedSizeChunks(text, { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP } = {}) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= chunkSize) return [{ text: source, metadata: { chunkKind: 'text' } }];

  const chunks = [];
  let start = 0;
  while (start < source.length) {
    const end = Math.min(source.length, start + chunkSize);
    chunks.push({
      text: source.slice(start, end).trim(),
      metadata: {
        chunkKind: 'text',
        charStart: start,
        charEnd: end
      }
    });
    if (end === source.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks.filter((chunk) => chunk.text);
}

function resolveChunkStrategy({ strategy, format, text, metadata }) {
  const explicit = String(strategy || 'auto').toLowerCase();
  if (explicit && explicit !== 'auto') {
    if (['database', 'structured', 'markdown', 'chat', 'text', 'plain'].includes(explicit)) {
      return explicit === 'plain' ? 'text' : explicit;
    }
    return 'text';
  }

  const normalizedFormat = String(format || metadata?.format || '').toLowerCase();
  if (metadata?.sourceKind === 'database') return 'database';
  if (['json', 'yaml', 'yml', 'xml'].includes(normalizedFormat)) return 'structured';
  if (['markdown', 'md'].includes(normalizedFormat) || /^#{1,6}\s+/m.test(text)) return 'markdown';
  if (looksLikeChat(text)) return 'chat';
  return 'text';
}

function chunkMarkdown(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let current = { heading: '', level: 0, lines: [] };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      if (current.lines.join('\n').trim()) sections.push(current);
      current = {
        heading: heading[2].trim(),
        level: heading[1].length,
        lines: [line]
      };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.join('\n').trim()) sections.push(current);
  if (sections.length === 0) return fixedSizeChunks(text);

  return sections.map((section, index) => ({
    text: section.lines.join('\n').trim(),
    idSuffix: headingSuffix(section.heading, index),
    metadata: {
      chunkKind: 'markdown-section',
      heading: section.heading,
      headingLevel: section.level
    }
  }));
}

function chunkStructuredDocument(text, { format, metadata, fieldChunking }) {
  try {
    const parsed = parseStructuredDocument({
      text,
      format: normalizeStructuredFormat(format)
    });
    return collectionsToRecordChunks(documentToCollections({
      data: parsed.data,
      collection: metadata?.sourceCollection || metadata?.collection
    }), { parsedFormat: parsed.format, fieldChunking });
  } catch {
    return fixedSizeChunks(text);
  }
}

function chunkDatabaseSnapshot(text, { format, metadata, fieldChunking }) {
  try {
    const parsed = parseStructuredDocument({
      text,
      format: normalizeStructuredFormat(format)
    });
    const data = parsed.data;
    const collections = Array.isArray(data?.collections)
      ? data.collections.map((collection) => ({
        collection: collection.collection || collection.name || metadata?.sourceCollection || 'records',
        records: normalizeSnapshotRecords(collection.records || collection.documents || collection.items || [])
      }))
      : documentToCollections({
        data,
        collection: metadata?.sourceCollection || metadata?.collection
      });
    return collectionsToRecordChunks(collections, {
      parsedFormat: parsed.format,
      database: data?.database || metadata?.database,
      fieldChunking
    });
  } catch {
    return fixedSizeChunks(text);
  }
}

function chunkChatLike(text, { format }) {
  try {
    const parsed = parseStructuredDocument({
      text,
      format: normalizeStructuredFormat(format)
    });
    const messages = Array.isArray(parsed.data?.messages) ? parsed.data.messages : [];
    if (messages.length > 0) {
      return messages.map((message, index) => ({
        text: [
          message.role ? `role: ${message.role}` : '',
          message.name ? `name: ${message.name}` : '',
          message.createdAt ? `createdAt: ${message.createdAt}` : '',
          '',
          message.content || message.text || ''
        ].filter((line) => line !== undefined).join('\n').trim(),
        idSuffix: `message-${message.id || index + 1}`,
        metadata: {
          chunkKind: 'chat-message',
          messageId: message.id,
          role: message.role,
          speaker: message.name,
          createdAt: message.createdAt
        }
      }));
    }
  } catch {
    // Fall through to line grouping.
  }

  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  const groups = [];
  let current = [];
  for (const line of lines) {
    if (/^(\[[^\]]+\]\s*)?[^:：]{1,32}[:：]\s+/.test(line) && current.length > 0) {
      groups.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) groups.push(current.join('\n'));
  return groups.map((entry, index) => ({
    text: entry,
    idSuffix: `chat-${index + 1}`,
    metadata: { chunkKind: 'chat-turn' }
  }));
}

function collectionsToRecordChunks(collections = [], { parsedFormat, database, fieldChunking } = {}) {
  const chunks = [];
  const shouldChunkFields = fieldChunking !== false;
  for (const group of collections) {
    const collection = group.collection || 'records';
    const records = normalizeSnapshotRecords(group.records || []);
    for (const record of records) {
      const data = record.data && typeof record.data === 'object' ? record.data : record;
      const recordId = String(record.id || data.id || data.npcId || data.mapId || data.questId || chunks.length + 1);
      chunks.push({
        text: [
          `collection: ${collection}`,
          `recordId: ${recordId}`,
          database ? `database: ${database}` : '',
          '',
          JSON.stringify(data, null, 2)
        ].filter(Boolean).join('\n'),
        idSuffix: `${safeId(collection)}.${safeId(recordId)}`,
        metadata: {
          chunkKind: 'record',
          sourceCollection: collection,
          recordId,
          fieldPath: '$',
          domain: inferDomain(collection),
          parsedFormat
        }
      });
      if (shouldChunkFields) {
        for (const field of recordFieldChunks(data)) {
          chunks.push({
            text: [
              `collection: ${collection}`,
              `recordId: ${recordId}`,
              `fieldPath: ${field.fieldPath}`,
              database ? `database: ${database}` : '',
              '',
              field.text
            ].filter(Boolean).join('\n'),
            idSuffix: `${safeId(collection)}.${safeId(recordId)}.${safeId(field.fieldPath)}`,
            metadata: {
              chunkKind: 'record-field',
              sourceCollection: collection,
              recordId,
              fieldPath: field.fieldPath,
              domain: inferDomain(collection),
              parsedFormat
            }
          });
        }
      }
    }
  }
  return chunks.length > 0 ? chunks : [];
}

function recordFieldChunks(value, { path = '$', depth = 0 } = {}) {
  if (!value || typeof value !== 'object' || depth > 3) return [];
  const chunks = [];
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'id') continue;
    const fieldPath = `${path}.${key}`;
    if (nested === undefined || nested === null || nested === '') continue;
    if (typeof nested === 'string') {
      if (nested.trim().length >= 24) {
        chunks.push({ fieldPath, text: nested.trim() });
      }
      continue;
    }
    if (typeof nested === 'number' || typeof nested === 'boolean') continue;
    if (Array.isArray(nested)) {
      const scalarText = nested
        .filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry))
        .join('\n')
        .trim();
      if (scalarText.length >= 24) chunks.push({ fieldPath, text: scalarText });
      nested.forEach((entry, index) => {
        if (entry && typeof entry === 'object') {
          chunks.push(...recordFieldChunks(entry, { path: `${fieldPath}[${index}]`, depth: depth + 1 }));
        }
      });
      continue;
    }
    const summary = JSON.stringify(nested, null, 2);
    if (summary.length >= 120) {
      chunks.push({ fieldPath, text: summary });
    } else {
      chunks.push(...recordFieldChunks(nested, { path: fieldPath, depth: depth + 1 }));
    }
  }
  return chunks;
}

function normalizeSnapshotRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => {
    if (record && typeof record === 'object' && record.data && typeof record.data === 'object') {
      return { id: record.id || record.data.id, ...record.data };
    }
    return record;
  });
}

function normalizeChunk(chunk) {
  if (typeof chunk === 'string') {
    return { text: chunk.trim(), metadata: { chunkKind: 'text' } };
  }
  return {
    ...chunk,
    text: String(chunk?.text || '').trim(),
    metadata: {
      chunkKind: 'text',
      ...(chunk?.metadata || {})
    }
  };
}

function normalizeStructuredFormat(format) {
  const normalized = String(format || 'auto').toLowerCase();
  if (['json', 'yaml', 'yml', 'xml'].includes(normalized)) return normalized;
  return 'auto';
}

function headingSuffix(heading, index) {
  const suffix = safeId(heading);
  return suffix ? `section-${index + 1}-${suffix}` : `section-${index + 1}`;
}

function safeId(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_\u4e00-\u9fff.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function inferDomain(collection) {
  const text = String(collection || '').toLowerCase();
  if (/npc|actor|character/.test(text)) return 'npc';
  if (/map|scene|location|area/.test(text)) return 'map';
  if (/quest|encounter|trigger/.test(text)) return 'quest';
  if (/faction|relation|membership/.test(text)) return 'faction';
  if (/item|equipment|weapon|mount|accessory/.test(text)) return 'item';
  if (/rule|mechanic|skill|status|feat/.test(text)) return 'rules';
  if (/chat|message|memory|compression/.test(text)) return 'memory';
  return undefined;
}

function looksLikeChat(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 12);
  if (lines.length < 3) return false;
  const speakerLines = lines.filter((line) => /^(\[[^\]]+\]\s*)?[^:：]{1,32}[:：]\s+/.test(line));
  return speakerLines.length >= Math.min(3, lines.length);
}
