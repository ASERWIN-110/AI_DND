// @ts-nocheck
import { cosineSimilarity, tokenize } from './hash-embedding-provider.js';

const DEFAULT_VECTOR_WEIGHT = 0.62;
const DEFAULT_KEYWORD_WEIGHT = 0.24;
const DEFAULT_ENTITY_WEIGHT = 0.1;
const DEFAULT_RECENCY_WEIGHT = 0.025;
const DEFAULT_IMPORTANCE_WEIGHT = 0.04;
const DEFAULT_LIFECYCLE_WEIGHT = 0.025;
const DEFAULT_MMR_LAMBDA = 0.72;

export function rankRagDocuments(documents = [], {
  query,
  queryVector,
  limit = 4,
  minScore = 0.15,
  mode = 'hybrid',
  vectorWeight = DEFAULT_VECTOR_WEIGHT,
  keywordWeight = DEFAULT_KEYWORD_WEIGHT,
  entityWeight = DEFAULT_ENTITY_WEIGHT,
  recencyWeight = DEFAULT_RECENCY_WEIGHT,
  importanceWeight = DEFAULT_IMPORTANCE_WEIGHT,
  lifecycleWeight = DEFAULT_LIFECYCLE_WEIGHT,
  diversity = true,
  mmrLambda = DEFAULT_MMR_LAMBDA,
  now = () => new Date().toISOString()
} = {}) {
  const safeLimit = normalizePositiveInteger(limit, 4);
  const resolvedMode = normalizeMode(mode);
  const queryTokens = weightedQueryTokens(query);
  const entities = extractQueryEntities(query);
  const nowMs = Date.parse(now());
  const corpus = buildCorpusStats(documents);

  const ranked = documents
    .map((doc) => scoreDocument(doc, {
      query,
      queryVector,
      queryTokens,
      entities,
      corpus,
      mode: resolvedMode,
      weights: {
        vectorWeight,
        keywordWeight,
        entityWeight,
        recencyWeight,
        importanceWeight,
        lifecycleWeight
      },
      nowMs
    }))
    .filter((doc) => passesMinScore(doc, minScore, resolvedMode))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const selected = diversity
    ? selectDiverse(ranked, safeLimit, normalizeNumber(mmrLambda, DEFAULT_MMR_LAMBDA))
    : ranked.slice(0, safeLimit);

  return selected.map((hit, index) => ({
    ...hit,
    rank: index + 1,
    sourceRef: sourceRefFromHit(hit),
    compact: compactRagHit(hit)
  }));
}

export function compactRagHit(hit = {}) {
  const metadata = hit.metadata || {};
  const sourceRef = sourceRefFromHit(hit);
  const text = String(hit.text || hit.content || '').trim();
  return {
    id: hit.id || metadata.sourceId,
    score: hit.score,
    sourceRef,
    claim: summarizeClaim(text),
    text: text.length > 700 ? `${text.slice(0, 700).trimEnd()}...[truncated]` : text,
    metadata: compactMetadata(metadata),
    scores: hit.scores
  };
}

export function sourceRefFromHit(hit = {}) {
  const metadata = hit.metadata || {};
  return {
    collection: hit.collection || metadata.collection,
    id: hit.id,
    sourceId: metadata.sourceId,
    chunkIndex: metadata.chunkIndex,
    chunkKind: metadata.chunkKind,
    sourceKind: metadata.sourceKind,
    sourceCollection: metadata.sourceCollection,
    recordId: metadata.recordId,
    fieldPath: metadata.fieldPath,
    domain: metadata.domain,
    heading: metadata.heading,
    sceneId: metadata.sceneId,
    actorIds: metadata.actorIds,
    lifecycleScope: metadata.lifecycleScope,
    chatSessionId: metadata.chatSessionId,
    characterCardId: metadata.characterCardId
  };
}

export function isExpiredRagDocument(doc = {}, now = () => new Date().toISOString()) {
  const expiresAt = doc.metadata?.expiresAt;
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(typeof now === 'function' ? now() : now);
  return Number.isFinite(expiresMs) && Number.isFinite(nowMs) && expiresMs <= nowMs;
}

function scoreDocument(doc, context) {
  const vectorScore = Array.isArray(context.queryVector) && Array.isArray(doc.vector)
    ? cosineSimilarity(context.queryVector, doc.vector)
    : 0;
  const keywordScore = scoreKeywords(doc, context.queryTokens, context.corpus);
  const entityScore = scoreEntities(doc, context.entities);
  const recencyBoost = scoreRecency(doc, context.nowMs);
  const importanceBoost = scoreImportance(doc);
  const lifecycleBoost = scoreLifecycle(doc);
  const finalScore = combineScores({
    vectorScore,
    keywordScore,
    entityScore,
    recencyBoost,
    importanceBoost,
    lifecycleBoost,
    mode: context.mode,
    weights: context.weights
  });

  return {
    ...doc,
    score: finalScore,
    scores: {
      vector: vectorScore,
      keyword: keywordScore,
      entity: entityScore,
      recency: recencyBoost,
      importance: importanceBoost,
      lifecycle: lifecycleBoost,
      final: finalScore
    }
  };
}

function combineScores({ vectorScore, keywordScore, entityScore, recencyBoost, importanceBoost, lifecycleBoost, mode, weights }) {
  if (mode === 'vector') return vectorScore;
  if (mode === 'keyword') return keywordScore + entityScore;
  return (
    normalizeScore(vectorScore) * normalizeNumber(weights.vectorWeight, DEFAULT_VECTOR_WEIGHT)
    + keywordScore * normalizeNumber(weights.keywordWeight, DEFAULT_KEYWORD_WEIGHT)
    + entityScore * normalizeNumber(weights.entityWeight, DEFAULT_ENTITY_WEIGHT)
    + recencyBoost * normalizeNumber(weights.recencyWeight, DEFAULT_RECENCY_WEIGHT)
    + importanceBoost * normalizeNumber(weights.importanceWeight, DEFAULT_IMPORTANCE_WEIGHT)
    + lifecycleBoost * normalizeNumber(weights.lifecycleWeight, DEFAULT_LIFECYCLE_WEIGHT)
  );
}

function scoreKeywords(doc, queryTokens, corpus) {
  if (queryTokens.length === 0) return 0;
  const terms = documentTerms(doc);
  const termCounts = new Map();
  for (const term of terms) termCounts.set(term, (termCounts.get(term) || 0) + 1);
  const length = terms.length || 1;
  const averageLength = corpus?.averageLength || length;
  const docCount = corpus?.docCount || 1;
  const k1 = 1.4;
  const b = 0.75;
  let bm25 = 0;
  let exactMatched = 0;
  for (const token of queryTokens) {
    const frequency = termCounts.get(token.value) || 0;
    if (frequency > 0) {
      exactMatched += token.weight;
      const documentFrequency = corpus?.documentFrequency?.get(token.value) || 0;
      const idf = Math.log(1 + ((docCount - documentFrequency + 0.5) / (documentFrequency + 0.5)));
      bm25 += token.weight * idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * (length / averageLength))));
    } else if (String(doc.text || '').toLowerCase().includes(token.value)) {
      exactMatched += token.weight * 0.5;
    }
  }
  const possible = queryTokens.reduce((sum, token) => sum + token.weight, 0);
  const overlapScore = possible > 0 ? exactMatched / possible : 0;
  const bm25Score = bm25 / (bm25 + 3);
  return Math.max(Math.min(1, overlapScore), Math.max(0, Math.min(1, bm25Score)));
}

function scoreEntities(doc, entities) {
  if (entities.length === 0) return 0;
  const haystack = `${doc.id || ''}\n${doc.text || ''}\n${JSON.stringify(doc.metadata || {})}`.toLowerCase();
  const matched = entities.filter((entity) => haystack.includes(entity.toLowerCase())).length;
  return matched / entities.length;
}

function scoreRecency(doc, nowMs) {
  const timestamp = doc.metadata?.lastAccessedAt
    || doc.metadata?.rememberedAt
    || doc.metadata?.importedAt
    || doc.updatedAt
    || doc.createdAt
    || doc.metadata?.createdAt;
  const thenMs = Date.parse(timestamp);
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return 0;
  const ageDays = Math.max(0, (nowMs - thenMs) / 86400000);
  return Math.max(0, Math.min(1, 1 / (1 + ageDays)));
}

function scoreImportance(doc) {
  const value = Number(doc.metadata?.importance ?? doc.metadata?.priority ?? doc.metadata?.weight);
  if (!Number.isFinite(value)) return 0;
  if (value <= 1 && value >= 0) return value;
  return Math.max(0, Math.min(1, value / 10));
}

function scoreLifecycle(doc) {
  const scope = doc.metadata?.lifecycleScope;
  if (scope === 'chat') return 1;
  if (scope === 'character') return 0.7;
  if (scope === 'global') return 0.45;
  return 0;
}

function selectDiverse(ranked, limit, mmrLambda) {
  const selected = [];
  const remaining = [...ranked];
  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const redundancy = selected.reduce((max, existing) => Math.max(max, documentSimilarity(candidate, existing)), 0);
      const sameSourcePenalty = selected.some((existing) => sourceKey(existing) === sourceKey(candidate)) ? 0.08 : 0;
      const mmrScore = (mmrLambda * (candidate.score || 0)) - ((1 - mmrLambda) * redundancy) - sameSourcePenalty;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function documentSimilarity(a, b) {
  if (Array.isArray(a.vector) && Array.isArray(b.vector)) {
    return Math.max(0, cosineSimilarity(a.vector, b.vector));
  }
  const aTokens = new Set(tokenize(a.text || ''));
  const bTokens = new Set(tokenize(b.text || ''));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.min(aTokens.size, bTokens.size);
}

function passesMinScore(doc, minScore, mode) {
  const threshold = Number(minScore);
  if (!Number.isFinite(threshold)) return true;
  if ((doc.score || 0) >= threshold) return true;
  if (mode === 'hybrid' && ((doc.scores?.keyword || 0) > 0 || (doc.scores?.entity || 0) > 0)) {
    return threshold <= 0.3;
  }
  return false;
}

function weightedQueryTokens(query) {
  const counts = new Map();
  for (const token of tokenize(query)) {
    if (!token || token.length < 1) continue;
    const weight = token.length === 1 ? 0.35 : Math.min(2, 0.75 + (token.length / 4));
    counts.set(token, Math.max(counts.get(token) || 0, weight));
  }
  return [...counts.entries()].map(([value, weight]) => ({ value, weight }));
}

function buildCorpusStats(documents = []) {
  const documentFrequency = new Map();
  let totalLength = 0;
  for (const doc of documents) {
    const terms = documentTerms(doc);
    totalLength += terms.length;
    for (const term of new Set(terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }
  return {
    docCount: Math.max(1, documents.length),
    averageLength: documents.length > 0 ? Math.max(1, totalLength / documents.length) : 1,
    documentFrequency
  };
}

function documentTerms(doc) {
  return tokenize(`${doc.text || ''} ${JSON.stringify(compactTermMetadata(doc.metadata || {}))}`);
}

function compactTermMetadata(metadata = {}) {
  return {
    id: metadata.id,
    sourceId: metadata.sourceId,
    sourceCollection: metadata.sourceCollection,
    recordId: metadata.recordId,
    fieldPath: metadata.fieldPath,
    domain: metadata.domain,
    heading: metadata.heading,
    actorIds: metadata.actorIds,
    sceneId: metadata.sceneId,
    tags: metadata.tags,
    memoryType: metadata.memoryType
  };
}

function extractQueryEntities(query) {
  const text = String(query || '');
  const entities = new Set();
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9_.:-]{2,}/g)) entities.add(match[0]);
  for (const match of text.matchAll(/[\p{Script=Han}]{2,}/gu)) entities.add(match[0]);
  for (const match of text.matchAll(/[「“"']([^「」“”"']{2,80})[」”"']/gu)) entities.add(match[1]);
  return [...entities].slice(0, 24);
}

function summarizeClaim(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentence = cleaned.split(/(?<=[。！？.!?])\s+/u)[0] || cleaned;
  return sentence.length > 180 ? `${sentence.slice(0, 180).trimEnd()}...` : sentence;
}

function compactMetadata(metadata = {}) {
  const keys = [
    'sourceId',
    'sourceKind',
    'sourceCollection',
    'recordId',
    'domain',
    'sceneId',
    'actorIds',
    'memoryType',
    'importance',
    'rememberedAt',
    'expiresAt',
    'importedAt',
    'chunkKind',
    'heading',
    'chunkIndex',
    'lifecycleScope',
    'chatSessionId',
    'characterCardId',
    'embeddingModel',
    'embeddingProvider',
    'embeddingVersion'
  ];
  return Object.fromEntries(keys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '')
    .map((key) => [key, metadata[key]]));
}

function sourceKey(hit) {
  return hit.metadata?.lifecycleCanonicalId || hit.metadata?.sourceId || hit.id;
}

function normalizeMode(mode) {
  const normalized = String(mode || 'hybrid').toLowerCase();
  if (['vector', 'keyword', 'hybrid'].includes(normalized)) return normalized;
  return 'hybrid';
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeScore(score) {
  const number = Number(score);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
