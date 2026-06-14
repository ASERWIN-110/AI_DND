// @ts-nocheck
import { ensureString } from '../utils/id.js';
import { countTokens } from '../tokens/token-counter.js';

export function normalizeWorldBook(input) {
  if (!input) {
    return { name: 'inline', entries: [] };
  }

  if (Array.isArray(input.entries)) {
    return {
      name: input.name || 'inline',
      entries: input.entries.map(normalizeEntry).filter(Boolean)
    };
  }

  if (input.entries && typeof input.entries === 'object') {
    return {
      name: input.name || 'inline',
      entries: Object.values(input.entries).map(normalizeEntry).filter(Boolean)
    };
  }

  return { name: input.name || 'inline', entries: [] };
}

export function selectWorldInfoEntries(worldBook, messages, options = {}) {
  const normalized = normalizeWorldBook(worldBook);
  const scanDepth = options.scanDepth || 8;
  const budgetChars = options.budgetChars || 2500;
  const budgetTokens = options.budgetTokens || options.tokenBudget;
  const random = options.random || Math.random;
  const maxRecursionSteps = options.maxRecursionSteps ?? 1;
  const recentText = getRecentText(messages, scanDepth);

  const selected = selectEntriesRecursive(normalized.entries, recentText, {
    random,
    maxRecursionSteps
  })
    .filter((entry) => !entry.disable)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.insertion_order - b.insertion_order;
    });

  const result = [];
  let usedChars = 0;
  let usedTokens = 0;
  for (const entry of selected) {
    const content = entry.content.trim();
    if (!content) continue;

    const nextChars = usedChars + content.length;
    const nextTokens = usedTokens + countTokens(content);
    if (budgetChars && nextChars > budgetChars) break;
    if (budgetTokens && nextTokens > budgetTokens) break;

    usedChars = nextChars;
    usedTokens = nextTokens;
    result.push(entry);
  }

  return result;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return undefined;

  return {
    uid: entry.uid ?? entry.id,
    key: normalizeKeys(entry.key || entry.keys),
    keysecondary: normalizeKeys(entry.keysecondary || entry.secondary_keys),
    comment: ensureString(entry.comment || entry.name || ''),
    content: ensureString(entry.content),
    constant: Boolean(entry.constant),
    selective: Boolean(entry.selective),
    selective_logic: entry.selectiveLogic ?? entry.selective_logic,
    disable: Boolean(entry.disable || entry.disabled),
    case_sensitive: Boolean(entry.case_sensitive || entry.caseSensitive),
    match_whole_words: Boolean(entry.match_whole_words || entry.matchWholeWords),
    use_regex: Boolean(entry.use_regex || entry.useRegex),
    use_probability: Boolean(entry.use_probability || entry.useProbability),
    probability: Number(entry.probability ?? 100),
    priority: Number(entry.priority || 0),
    insertion_order: Number(entry.insertion_order || entry.order || 0),
    position: Number(entry.position || 0),
    role: entry.role,
    depth: entry.depth,
    exclude_recursion: Boolean(entry.exclude_recursion || entry.excludeRecursion),
    prevent_recursion: Boolean(entry.prevent_recursion || entry.preventRecursion),
    metadata: entry
  };
}

function normalizeKeys(value) {
  if (Array.isArray(value)) return value.map((item) => ensureString(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function hasKey(haystack, key, entry) {
  const needle = entry.case_sensitive ? key : key.toLowerCase();
  if (!needle) return false;

  if (entry.use_regex) {
    try {
      const flags = entry.case_sensitive ? 'u' : 'iu';
      return new RegExp(key, flags).test(haystack);
    } catch {
      return false;
    }
  }

  if (entry.match_whole_words) {
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}_])`, 'u').test(haystack);
  }

  return haystack.includes(needle);
}

function selectEntriesRecursive(entries, initialText, { random, maxRecursionSteps }) {
  const selected = new Map();
  let scanText = initialText;

  for (let step = 0; step <= maxRecursionSteps; step += 1) {
    const newlySelected = entries
      .filter((entry) => !entry.disable)
      .filter((entry) => !selected.has(getEntryIdentity(entry)))
      .filter((entry) => matchesEntryWithRandom(entry, scanText, random));

    if (newlySelected.length === 0) break;

    for (const entry of newlySelected) {
      selected.set(getEntryIdentity(entry), entry);
    }

    scanText = [
      scanText,
      ...newlySelected
        .filter((entry) => !entry.exclude_recursion && !entry.prevent_recursion)
        .map((entry) => entry.content)
    ].join('\n');
  }

  return [...selected.values()];
}

function getEntryIdentity(entry) {
  return entry.uid ?? entry.comment ?? `${entry.insertion_order}:${entry.content}`;
}

function matchesEntryWithRandom(entry, text, random) {
  if (entry.constant) return true;
  if (!passesProbability(entry, random)) return false;

  const haystack = entry.case_sensitive ? text : text.toLowerCase();
  const primary = entry.key.some((key) => hasKey(haystack, key, entry));
  if (!primary) return false;

  if (!entry.selective || entry.keysecondary.length === 0) return true;
  const secondaryMatches = entry.keysecondary.map((key) => hasKey(haystack, key, entry));

  if (entry.selective_logic === 'all' || entry.selective_logic === 'AND_ALL') {
    return secondaryMatches.every(Boolean);
  }

  return secondaryMatches.some(Boolean);
}

function passesProbability(entry, random = Math.random) {
  if (!entry.use_probability) return true;
  const probability = Math.max(0, Math.min(100, entry.probability));
  return random() * 100 <= probability;
}

function getRecentText(messages, scanDepth) {
  return messages
    .slice(Math.max(0, messages.length - scanDepth))
    .map((message) => message.content)
    .join('\n');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
