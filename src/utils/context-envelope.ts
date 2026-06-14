// @ts-nocheck
const IMPORTANT_SCALAR_KEYS = new Set([
  'id',
  'recordId',
  'traceId',
  'toolId',
  'phaseId',
  'stepId',
  'profileId',
  'configId',
  'loopConfigId',
  'flowId',
  'planId',
  'actionId',
  'battleId',
  'eventId',
  'questId',
  'encounterId',
  'sceneId',
  'mapId',
  'npcId',
  'actorId',
  'targetId',
  'chatSessionId',
  'collection',
  'status',
  'ok',
  'dryRun',
  'llmUsed',
  'intent',
  'confidence',
  'outcome'
]);

const SUMMARY_KEYS = [
  'summary',
  'narrativeSummary',
  'reason',
  'status',
  'intent',
  'outcome',
  'query',
  'title',
  'name'
];

export function createContextEnvelope({
  id,
  kind = 'context',
  title,
  status,
  output,
  trace,
  artifactRefs = [],
  maxSummaryChars = 600,
  maxScalars = 40
} = {}) {
  const normalizedRefs = [
    ...normalizeArtifactRefs(artifactRefs),
    ...traceToArtifactRefs(trace)
  ];
  const topLevelKeys = output && typeof output === 'object' && !Array.isArray(output)
    ? Object.keys(output).slice(0, 30)
    : [];
  const stateDelta = extractStateDelta(output, { maxScalars });
  return removeUndefined({
    id,
    kind,
    title,
    status,
    compactSummary: summarizeForTransfer(output, { maxChars: maxSummaryChars }),
    stateDelta,
    artifactRefs: normalizedRefs,
    stats: {
      approxChars: estimateJsonChars(output),
      topLevelKeys,
      scalarCount: Object.keys(stateDelta.scalars || {}).length,
      countKeys: Object.keys(stateDelta.counts || {}).length
    },
    transferPolicy: 'Pass compactSummary, stateDelta, and artifactRefs downstream by default. Read full output only from trace/artifact refs when exact fields are required.'
  });
}

function summarizeForTransfer(value, { maxChars }) {
  if (value === undefined) return 'No output.';
  if (value === null) return 'Output is null.';
  if (typeof value === 'string') return clampText(value, maxChars);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return clampText(`Array with ${value.length} item(s).`, maxChars);

  const fragments = [];
  for (const key of SUMMARY_KEYS) {
    const scalar = value[key];
    if (isScalar(scalar)) fragments.push(`${key}: ${scalar}`);
  }
  if (value.usage && typeof value.usage === 'object') {
    const usage = ['selectedTokens', 'omittedTokens', 'totalCandidateTokens', 'selectedCount', 'omittedCount']
      .filter((key) => value.usage[key] !== undefined)
      .map((key) => `${key}=${value.usage[key]}`);
    if (usage.length) fragments.push(`usage: ${usage.join(', ')}`);
  }
  const counts = Object.entries(value)
    .filter(([, child]) => Array.isArray(child))
    .slice(0, 8)
    .map(([key, child]) => `${key}: ${child.length} item(s)`);
  fragments.push(...counts);

  if (!fragments.length) {
    const keys = Object.keys(value).slice(0, 12);
    fragments.push(keys.length ? `Object keys: ${keys.join(', ')}` : 'Empty object.');
  }
  return clampText(fragments.join(' | '), maxChars);
}

function extractStateDelta(value, { maxScalars }) {
  const scalars = {};
  const counts = {};
  collectImportantScalars(value, scalars, { maxScalars });
  collectCounts(value, counts);
  return {
    scalars,
    counts
  };
}

function collectImportantScalars(value, scalars, { path = '', maxScalars, depth = 0 } = {}) {
  if (Object.keys(scalars).length >= maxScalars || depth > 4) return;
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((item, index) => {
      collectImportantScalars(item, scalars, {
        path: `${path}[${index}]`,
        maxScalars,
        depth: depth + 1
      });
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (Object.keys(scalars).length >= maxScalars) return;
    const childPath = path ? `${path}.${key}` : key;
    if (IMPORTANT_SCALAR_KEYS.has(key) && isScalar(child)) {
      scalars[childPath] = child;
    } else if (child && typeof child === 'object') {
      collectImportantScalars(child, scalars, {
        path: childPath,
        maxScalars,
        depth: depth + 1
      });
    }
  }
}

function collectCounts(value, counts, { path = '', depth = 0 } = {}) {
  if (!value || typeof value !== 'object' || depth > 2) return;
  if (Array.isArray(value)) {
    if (path) counts[path] = value.length;
    value.slice(0, 6).forEach((item, index) => collectCounts(item, counts, {
      path: `${path}[${index}]`,
      depth: depth + 1
    }));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(child)) counts[childPath] = child.length;
    else if (child && typeof child === 'object') collectCounts(child, counts, {
      path: childPath,
      depth: depth + 1
    });
  }
}

function traceToArtifactRefs(trace) {
  if (!trace || typeof trace !== 'object') return [];
  return [removeUndefined({
    kind: 'trace',
    id: trace.traceId || trace.id,
    directory: trace.directory,
    files: trace.files
      ? {
          input: trace.files.input,
          output: trace.files.output,
          summary: trace.files.summary
        }
      : undefined
  })];
}

function normalizeArtifactRefs(refs) {
  return (Array.isArray(refs) ? refs : [refs])
    .filter((ref) => ref && typeof ref === 'object')
    .map((ref) => removeUndefined({
      kind: ref.kind || ref.type || 'artifact',
      id: ref.id || ref.traceId,
      directory: ref.directory,
      files: ref.files,
      note: ref.note
    }));
}

function estimateJsonChars(value) {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function clampText(value, maxChars) {
  const text = String(value || '');
  if (!Number.isFinite(maxChars) || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}
