// @ts-nocheck
export async function evaluateRagRetrieval({
  ragService,
  collection,
  cases = [],
  limit = 5,
  minScore = 0,
  mode = 'hybrid',
  filter
} = {}) {
  if (!ragService || typeof ragService.retrieve !== 'function') {
    throw new TypeError('evaluateRagRetrieval requires ragService');
  }
  const results = [];
  for (const testCase of cases) {
    const expected = normalizeExpected(testCase.expected || testCase.expectedIds || testCase.expectedSourceIds);
    const hits = await ragService.retrieve({
      collection: testCase.collection || collection,
      query: testCase.query,
      limit: testCase.limit || limit,
      minScore: testCase.minScore ?? minScore,
      mode: testCase.mode || mode,
      filter: testCase.filter || filter
    });
    const hitKeys = hits.map(hitKeysFor).flat();
    const matched = expected.filter((key) => hitKeys.includes(key));
    const unexpected = normalizeExpected(testCase.unexpected || testCase.unexpectedIds || testCase.unexpectedSourceIds)
      .filter((key) => hitKeys.includes(key));
    results.push({
      id: testCase.id,
      query: testCase.query,
      expected,
      matched,
      unexpected,
      pass: expected.length === 0 ? unexpected.length === 0 : matched.length > 0 && unexpected.length === 0,
      recall: expected.length > 0 ? matched.length / expected.length : 1,
      precision: hits.length > 0 ? matched.length / hits.length : (expected.length === 0 ? 1 : 0),
      hitIds: hits.map((hit) => hit.id),
      hits: hits.map((hit) => ({
        id: hit.id,
        score: hit.score,
        sourceRef: hit.sourceRef,
        compact: hit.compact
      }))
    });
  }
  const total = results.length;
  const passed = results.filter((result) => result.pass).length;
  const recallAtK = total > 0
    ? results.reduce((sum, result) => sum + result.recall, 0) / total
    : 0;
  const precisionAtK = total > 0
    ? results.reduce((sum, result) => sum + result.precision, 0) / total
    : 0;
  return {
    collection,
    limit,
    minScore,
    mode,
    total,
    passed,
    failed: total - passed,
    recallAtK,
    precisionAtK,
    results
  };
}

function normalizeExpected(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((entry) => normalizeExpected(entry));
  if (typeof value === 'object') {
    return [
      value.id,
      value.sourceId,
      value.recordId,
      value.fieldPath ? `${value.recordId || value.sourceId || value.id || ''}:${value.fieldPath}` : undefined
    ].filter(Boolean).map(String);
  }
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function hitKeysFor(hit = {}) {
  const sourceRef = hit.sourceRef || hit.compact?.sourceRef || {};
  const metadata = hit.metadata || {};
  const recordId = sourceRef.recordId || metadata.recordId;
  const fieldPath = sourceRef.fieldPath || metadata.fieldPath;
  return [
    hit.id,
    sourceRef.id,
    sourceRef.sourceId,
    sourceRef.recordId,
    metadata.sourceId,
    metadata.recordId,
    fieldPath && recordId ? `${recordId}:${fieldPath}` : undefined,
    fieldPath && metadata.sourceId ? `${metadata.sourceId}:${fieldPath}` : undefined
  ].filter(Boolean).map(String);
}
