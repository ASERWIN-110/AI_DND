import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'manuals', 'generated-debug', 'llm-tool-debug');
const MAX_PROMPT_CHARS = 900;

const PROMPT_KEYS = new Set([
  'plannerPrompt',
  'absurdityPrompt',
  'explanationPrompt',
  'appealPrompt',
  'persuasionPrompt',
  'startPrompt',
  'specialPrompt',
  'aftermathPrompt'
]);

const TEMPLATE_KEYS = new Set([
  'definition',
  'quantificationDefinition'
]);

const CONTEXT_KEYS = new Set([
  'sceneContext',
  'recentContext',
  'contextText'
]);

function main() {
  const manifest = readJson(join(OUT_DIR, 'manifest.json'));
  const sections = [
    '# LLM 工具输出简略审查',
    '',
    '说明：每个工具只保留人工审查需要看的字段。`prompt` 和参考数值模板单独列出；“实际输入”里去掉 prompt 字段、场景长参考和量化模板；“实际输出”只保留有效业务字段。',
    '',
    `工具数：${manifest.cases.length}`,
    `LLM 调用数：${manifest.cases.reduce((sum, item) => sum + item.llmCallCount, 0)}`,
    ''
  ];

  for (const entry of manifest.cases) {
    const dir = join(OUT_DIR, entry.directory);
    const inputBundle = readJson(join(dir, 'input.json'));
    const outputBundle = readJson(join(dir, 'output.json'));
    const llmCalls = readJson(join(dir, 'llm_calls.json'));
    const reference = readReference(join(dir, 'reference.md'));
    const input = inputBundle.input || {};
    const context = inputBundle.context || {};
    const effectiveOutput = cleanDeep(effectiveOutputFor(entry.toolId, outputBundle.output || outputBundle));

    sections.push(
      `## ${entry.toolId}`,
      '',
      `**工具作用**：${reference || inferPurpose(entry.toolId)}`,
      '',
      `**工具应该有的参数和输出**：参数 ${formatKeyList(expectedInputKeys(input))}；输出 ${formatKeyList(expectedOutputKeys(entry.toolId, effectiveOutput))}。`,
      '',
      '**使用的 prompt**：',
      '',
      '```text',
      promptSummary(input, llmCalls),
      '```',
      '',
      '**工具参考的数值设置模板**：',
      '',
      '```json',
      JSON.stringify(templateSummary(input), null, 2),
      '```',
      '',
      '**工具的实际输入（已去掉 prompt 和参考数值模板）**：',
      '',
      '```json',
      JSON.stringify({ input: sanitizeInput(input), context }, null, 2),
      '```',
      '',
      '**工具的实际输出（只看有效字段）**：',
      '',
      '```json',
      JSON.stringify(effectiveOutput, null, 2),
      '```',
      ''
    );
  }

  const report = `${sections.join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'LLM工具输出简略审查.md'), report);
  writeFileSync(join(OUT_DIR, 'LLM工具输出逐项审查.md'), report);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readReference(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const marker = '## 工具专用参考';
  if (!text.includes(marker)) return '';
  return text.slice(text.indexOf(marker) + marker.length).trim();
}

function expectedInputKeys(input) {
  return Object.keys(sanitizeInput(input));
}

function expectedOutputKeys(toolId, output) {
  if (toolId.includes('plan_consequence')) return ['consequencePlan'];
  if (toolId.includes('plan_reward')) return ['rewardPlan'];
  if (toolId.includes('resolve_investigation_tick') || toolId.includes('resolve_tick')) return ['tick', 'dryRun'];
  if (toolId.includes('check_completion') || toolId.includes('check_outcome') || toolId.includes('gate_relevance')) return ['decision', 'dryRun'];
  if (toolId.includes('create_hook')) return ['quest'];
  if (toolId.includes('create_encounter')) return ['encounter'];
  if (toolId.includes('interpret_advance')) return ['decision', 'llm'];
  if (toolId.includes('world_pulse')) return ['pulse', 'dryRun'];
  if (toolId.includes('registry') || toolId.includes('quantify_text')) return Object.keys(output);
  return Object.keys(output);
}

function promptSummary(input, llmCalls) {
  const prompts = collectPromptFields(input);
  if (prompts.length) return prompts.join('\n\n');

  const firstMessage = llmCalls?.[0]?.request?.messages?.find((message) => String(message.content || '').trim());
  const content = String(firstMessage?.content || '').trim();
  if (!content) return '未捕获到 prompt。';
  return truncate(content.replace(/\n{3,}/g, '\n\n'), MAX_PROMPT_CHARS);
}

function collectPromptFields(value, path = []) {
  if (Array.isArray(value)) return value.flatMap((item, index) => collectPromptFields(item, [...path, String(index)]));
  if (!value || typeof value !== 'object') return [];
  const result = [];
  for (const [key, entry] of Object.entries(value)) {
    if (PROMPT_KEYS.has(key) && typeof entry === 'string') {
      result.push(`${[...path, key].join('.')}\n${entry}`);
    } else {
      result.push(...collectPromptFields(entry, [...path, key]));
    }
  }
  return result;
}

function templateSummary(input) {
  const templates = collectTemplates(input);
  if (!templates.length) {
    return {
      type: '无专用数值模板',
      sharedNumericReference: ['DC 12 简单', 'DC 15 中等', 'DC 18 困难', '奖励和后果按风险、难度、过程成比例']
    };
  }
  return templates.map((template) => ({
    path: template.path,
    version: template.value.version || '',
    prompt: template.value.prompt || '',
    fields: (template.value.fields || []).map((field) => ({
      name: field.name,
      mode: field.mode,
      type: field.type,
      min: field.min,
      max: field.max,
      description: field.description
    }))
  }));
}

function collectTemplates(value, path = []) {
  if (Array.isArray(value)) return value.flatMap((item, index) => collectTemplates(item, [...path, String(index)]));
  if (typeof value === 'string' && looksLikeJson(value)) {
    try {
      return collectTemplates(JSON.parse(value), path);
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== 'object') return [];
  const result = [];
  for (const [key, entry] of Object.entries(value)) {
    if (TEMPLATE_KEYS.has(key) && entry && typeof entry === 'object') {
      result.push({ path: [...path, key].join('.'), value: entry });
    } else {
      result.push(...collectTemplates(entry, [...path, key]));
    }
  }
  return result;
}

function sanitizeInput(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeInput(item));
  if (typeof value === 'string' && looksLikeJson(value)) {
    try {
      return JSON.stringify(sanitizeInput(JSON.parse(value)), null, 2);
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PROMPT_KEYS.has(key) && !TEMPLATE_KEYS.has(key))
    .map(([key, entry]) => {
      if (CONTEXT_KEYS.has(key)) return [key, '[已省略：共享场景参考]'];
      return [key, sanitizeInput(entry)];
    }));
}

function effectiveOutputFor(toolId, output) {
  if (output.plan) {
    return {
      status: output.status,
      plan: summarizePlan(output.plan),
      apply: summarizeApply(output.apply)
    };
  }
  if (output.explanation) return { explanation: output.explanation, judgement: compactJudgement(output.judgement) };
  if (output.judgement) return { judgement: output.judgement, event: eventSummary(output.event) };
  if (output.decision) return { decision: output.decision, dryRun: output.dryRun };
  if (output.aftermath) return { aftermath: output.aftermath };
  if (output.rewardPlan) return { rewardPlan: output.rewardPlan };
  if (output.consequencePlan) return { consequencePlan: output.consequencePlan };
  if (output.tick) return { tick: output.tick, dryRun: output.dryRun };
  if (output.quest?.data) return { quest: summarizeQuest(output.quest.data), event: eventSummary(output.event), dryRun: output.dryRun };
  if (output.encounter?.data) return { encounter: summarizeEncounter(output.encounter.data), event: eventSummary(output.event), dryRun: output.dryRun };
  if (output.battle) return { battle: summarizeBattle(output.battle), event: eventSummary(output.event), decision: output.decision };
  if (output.pulse) return { dryRun: output.dryRun, scheduledEvents: output.scheduledEvents?.length || 0, pulse: summarizePulse(output.pulse) };
  if (toolId === 'system.time.interpret_advance') return { decision: output.decision, ruleDecision: output.ruleDecision, llmUsed: Boolean(output.llm?.used), autoApply: output.autoApply };
  if (toolId === 'system.data.quantify_text') return { values: cleanQuantifiedValues(output.values), decisions: summarizeDecisions(output.decisions), record: summarizeRegistryRecord(output.record) };
  if (output.records) return summarizeImportOutput(output);
  if (output.data) return summarizeRegistryRecord(output);
  return output;
}

function summarizePlan(plan = {}) {
  return {
    actionId: plan.actionId,
    intent: plan.intent,
    sourceText: plan.sourceText,
    checks: (plan.checks || []).map((check) => ({
      id: check.id,
      tool: check.tool,
      when: check.when,
      input: check.input
    })),
    proposals: (plan.proposals || []).map((proposal) => ({
      id: proposal.id,
      tool: proposal.tool,
      when: proposal.when,
      input: proposal.input
    })),
    narrationHints: plan.narrationHints,
    metadata: plan.metadata
  };
}

function summarizeApply(apply) {
  if (!apply) return undefined;
  return {
    status: apply.status,
    riskSummary: apply.riskReport?.summary,
    appliedToolCalls: apply.appliedToolCalls?.length || 0,
    skippedToolCalls: apply.skippedToolCalls?.length || 0,
    failedToolCalls: apply.failedToolCalls?.length || 0
  };
}

function compactJudgement(judgement) {
  if (!judgement) return undefined;
  return {
    judgementId: judgement.judgementId,
    status: judgement.status,
    absurdityLevel: judgement.absurdityLevel,
    canAttempt: judgement.canAttempt,
    requiresAbsurdityExplanationOnSuccess: judgement.requiresAbsurdityExplanationOnSuccess
  };
}

function summarizeQuest(data) {
  return pick(data, [
    'questId',
    'title',
    'status',
    'hookText',
    'objective',
    'successCriteria',
    'evidenceSlots',
    'openLeads',
    'difficultyHint',
    'riskHint',
    'rewardHints',
    'failureImpact',
    'investigationBudget',
    'budgetRemaining'
  ]);
}

function summarizeEncounter(data) {
  return pick(data, [
    'encounterId',
    'title',
    'status',
    'sceneId',
    'encounterType',
    'luckTier',
    'luckScore',
    'entryText',
    'immediateSituation',
    'objective',
    'resolutionCriteria',
    'stateFacts',
    'openQuestions',
    'difficultyHint',
    'riskHint',
    'rewardHints',
    'failureImpact',
    'noFreePunishmentRule',
    'resolutionBudget',
    'budgetRemaining'
  ]);
}

function summarizeBattle(battle) {
  const data = battle.data || battle;
  return pick(data, ['battleId', 'name', 'battleName', 'status', 'sceneId', 'participantIds', 'allyIds', 'enemyIds', 'objective', 'stakes']);
}

function summarizePulse(pulse) {
  return {
    pulseId: pulse.pulseId,
    worldClockId: pulse.worldClockId,
    source: pulse.source,
    dueInfo: pulse.dueInfo,
    events: (pulse.events || []).map((event) => pick(event, ['eventId', 'category', 'title', 'description', 'severity', 'proposedToolCalls']))
  };
}

function summarizeRegistryRecord(record) {
  const data = record?.data || record || {};
  return {
    collection: record?.collection,
    id: record?.id,
    name: data.name,
    category: data.category || data.itemType || data.equipmentType || data.weaponType || data.mountType || data.specialType,
    description: data.description,
    mechanicalEffect: data.mechanicalEffect,
    numericValues: data.numericValues,
    textSettings: data.textSettings,
    quantificationSourceText: data.quantificationSourceText
  };
}

function summarizeImportOutput(output) {
  const records = {};
  for (const [kind, list] of Object.entries(output.records || {})) {
    records[kind] = (Array.isArray(list) ? list : []).map((record) => summarizeRegistryRecord(record));
  }
  return {
    format: output.format,
    counts: output.counts,
    ids: output.ids,
    records
  };
}

function cleanQuantifiedValues(values = {}) {
  return Object.fromEntries(Object.entries(values)
    .filter(([key]) => !key.startsWith('lifecycle') && !['metadata', 'quantificationAudit'].includes(key)));
}

function summarizeDecisions(decisions = []) {
  return decisions.map((decision) => pick(decision, ['field', 'mode', 'value', 'confidence', 'reason', 'referencesUsed']));
}

function eventSummary(event) {
  if (!event) return undefined;
  const data = event.data || event;
  return pick(data, ['eventId', 'title', 'description', 'status', 'eventType', 'source']);
}

function pick(object = {}, keys = []) {
  return Object.fromEntries(keys
    .filter((key) => object[key] !== undefined)
    .map((key) => [key, object[key]]));
}

function cleanDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanDeep(item)).filter((item) => !isEmptyValue(item));
  }
  if (!value || typeof value !== 'object') return value;
  const entries = [];
  for (const [key, entry] of Object.entries(value)) {
    if (['phase', 'checkId'].includes(key)) continue;
    const cleaned = cleanDeep(entry);
    if (isEmptyValue(cleaned)) continue;
    if (key === 'metadata' && isPlainEmptyObject(cleaned)) continue;
    entries.push([key, cleaned]);
  }
  return Object.fromEntries(entries);
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === '' || isPlainEmptyObject(value) || (Array.isArray(value) && value.length === 0);
}

function isPlainEmptyObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

function formatKeyList(keys) {
  return keys.length ? keys.map((key) => `\`${key}\``).join('、') : '无';
}

function inferPurpose(toolId) {
  return `调试 ${toolId} 的 LLM 输入和有效输出。`;
}

function looksLikeJson(value) {
  const text = String(value).trim();
  return (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n...[已截断，完整 prompt 见对应工具目录的 prompt.md]`;
}

main();
