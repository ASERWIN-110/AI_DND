// @ts-nocheck
export class MockChatProvider {
  constructor({ name = 'mock' } = {}) {
    this.name = name;
  }

  async generate({ messages }) {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (/Semantic Database Write Planner/i.test(lastUser?.content || '')) {
      return {
        content: JSON.stringify(renderMockSemanticWriteDecision(lastUser?.content || '')),
        raw: {
          provider: this.name
        }
      };
    }
    const characterName = inferCharacterName(messages);
    const action = extractPlayerAction(lastUser?.content || '');
    const grounding = extractResolverGrounding(lastUser?.content || '');
    const content = renderMockNarration({ characterName, action, grounding });

    return {
      content,
      raw: {
        provider: this.name
      }
    };
  }
}

function renderMockSemanticWriteDecision(prompt) {
  const text = String(prompt || '');
  const sourceText = extractMarkdownSection(text, 'Source Text') || text;
  const updates = [];
  const tokenClassification = [];
  if (/俸禄|月俸|月供|每月灵石|灵石/u.test(text) && /system\.npc_state\.(?:patch_state|rewrite_state)/.test(text)) {
    const proposalId = text.match(/"id"\s*:\s*"([^"]*resource[^"]*)"/i)?.[1]
      || text.match(/"id"\s*:\s*"([^"]*inventory[^"]*)"/i)?.[1]
      || text.match(/"id"\s*:\s*"([^"]*)"/)?.[1];
    if (proposalId) {
      const currency = inferMockCurrencyFromPrompt(text);
      updates.push({
        proposalId,
        action: 'patch',
        input: {
          inventory: {
            currency: {
              [currency.key]: currency.amount
            }
          }
        },
        reason: '俸禄/月供在修仙语境下应作为灵石货币资源记录，而不是字面背包物品。',
        metadata: {
          originalTerm: currency.originalTerm,
          canonicalKind: 'currency',
          canonicalCurrency: currency.key
        }
      });
    }
  }
  const stability = sourceText.match(/灵脉稳定度(?:目前|当前|现在)?(?:为|是|=|：|:)?\s*([甲乙丙丁戊己庚辛壬癸A-Za-z0-9零一二两三四五六七八九十百千万.-]+)/u);
  if (stability) {
    tokenClassification.push({
      token: '灵脉稳定度',
      classification: 'extension_data',
      collection: 'story_extension_facts',
      field: '灵脉稳定度',
      value: stability[1].replace(/级$/u, ''),
      reason: '灵脉稳定度不属于内置人物、物品、地图或任务字段，应写入扩展事实库。'
    });
  }
  return {
    decisionId: 'mock_semantic_write_decision',
    summary: updates.length || tokenClassification.length
      ? 'Converted semantic database writes and classified missing extension facts.'
      : 'No semantic rewrite needed.',
    tokenClassification,
    updates,
    newProposals: [],
    droppedProposalIds: []
  };
}

function inferMockCurrencyFromPrompt(text = '') {
  const source = String(text || '');
  const sourceText = extractMarkdownSection(source, 'Source Text') || source;
  const key = /下品|低品/u.test(sourceText)
    ? 'low_grade_spirit_stone'
    : /中品/u.test(sourceText)
      ? 'mid_grade_spirit_stone'
      : /上品|高品/u.test(sourceText)
        ? 'high_grade_spirit_stone'
        : 'spirit_stone';
  const amount = extractMockCurrencyAmount(sourceText, key)
    || (/俸禄|月俸|月供|工资|津贴|配给|补给/u.test(sourceText) ? 1 : extractMockFirstPositiveNumber(sourceText))
    || 1;
  const originalTerm = /俸禄/u.test(sourceText)
    ? '俸禄'
    : key === 'low_grade_spirit_stone'
      ? '下品灵石'
      : key === 'mid_grade_spirit_stone'
        ? '中品灵石'
        : key === 'high_grade_spirit_stone'
          ? '上品灵石'
          : '灵石';
  return { key, amount, originalTerm };
}

function extractMockCurrencyAmount(source = '', key = '') {
  const text = String(source || '');
  const term = key === 'low_grade_spirit_stone'
    ? '(?:下品|低品)\\s*灵石'
    : key === 'mid_grade_spirit_stone'
      ? '中品\\s*灵石'
      : key === 'high_grade_spirit_stone'
        ? '(?:上品|高品)\\s*灵石'
        : '灵石';
  const after = text.match(new RegExp(`${term}\\s*([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)\\s*(?:个|枚|块|颗|份)?`, 'u'));
  if (after) return parseMockQuantityToken(after[1]);
  const before = text.match(new RegExp(`([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)\\s*(?:个|枚|块|颗|份)?\\s*${term}`, 'u'));
  if (before) return parseMockQuantityToken(before[1]);
  return undefined;
}

function parseMockQuantityToken(value = '') {
  const token = String(value || '').trim();
  if (!token) return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(token)) {
    const number = Number(token);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }
  const number = parseMockChineseInteger(token);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function extractMockFirstPositiveNumber(source = '') {
  const text = String(source || '');
  const match = text.match(/\d+(?:\.\d+)?/u);
  const number = match ? Number(match[0]) : parseMockChineseQuantity(text);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseMockChineseQuantity(source = '') {
  const text = String(source || '');
  const match = text.match(/([零一二两三四五六七八九十百千万]+)\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件)?/u);
  if (!match) return undefined;
  return parseMockChineseInteger(match[1]);
}

function parseMockChineseInteger(value = '') {
  const text = String(value || '').trim();
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^[零一二两三四五六七八九]$/u.test(text)) return digits[text];
  let total = 0;
  let section = 0;
  let number = 0;
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  for (const char of text) {
    if (digits[char] !== undefined) {
      number = digits[char];
      continue;
    }
    const unit = units[char];
    if (!unit) continue;
    if (unit === 10000) {
      section = (section + number) || 1;
      total += section * unit;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  return total + section + number;
}

function renderMockNarration({ characterName, action, grounding }) {
  const visibleAction = trimForNarration(action || '继续观察周围的变化。');
  if (grounding?.resolutionMode === 'automatic_progress' && grounding.success !== false) {
    return renderAutomaticProgressNarration({ characterName, action: visibleAction, grounding });
  }
  if (grounding?.status === 'prepared') {
    return renderPreparedBattleNarration({ characterName, action: visibleAction });
  }
  if (grounding?.resolutionMode === 'combat_end' || grounding?.combat?.battleStatus === 'won') {
    return renderCombatEndNarration({ characterName, action: visibleAction, grounding });
  }
  if (grounding?.resolutionMode === 'combat_action') {
    return renderCombatActionNarration({ characterName, action: visibleAction, grounding });
  }
  if (grounding?.success === false && grounding.diceRolled) {
    return renderFailedCheckNarration({ characterName, action: visibleAction, grounding });
  }
  if (grounding?.success === false && grounding.status) {
    return renderUnsettledNarration({ characterName, action: visibleAction, grounding });
  }
  if (grounding?.success !== false && (Number(grounding?.appliedToolCallCount) > 0 || grounding?.resolutionMode === 'explicit_world_fact_updates')) {
    return renderSuccessfulStateChangeNarration({ characterName, action, displayAction: visibleAction, grounding });
  }
  const cue = inferNarrativeCue(visibleAction);
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  return [
    `${speaker}${cue.opening}`,
    `${cue.action} ${cue.detail}`,
    `${cue.npc}${cue.result || '行动结果：局面已经推进，你获得了新的可用细节。'}`,
    `接下来：${cue.next || '你要怎么继续推进？'}`
  ].join('\n');
}

function extractPlayerAction(content) {
  const rawInput = extractMarkdownSection(content, 'Raw Input');
  if (rawInput) return normalizeActionText(rawInput);
  const currentInput = extractMarkdownSection(content, 'Current Input');
  if (currentInput) return normalizeActionText(currentInput);
  return normalizeActionText(content);
}

function extractResolverGrounding(content) {
  const section = extractMarkdownSection(content, 'Resolver Grounding');
  if (!section) return undefined;
  try {
    return JSON.parse(section);
  } catch {
    return undefined;
  }
}

function extractMarkdownSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content || '').match(new RegExp(`(?:^|\\n)# ${escaped}\\n([\\s\\S]*?)(?=\\n# |$)`));
  return match?.[1]?.trim() || '';
}

function normalizeActionText(text) {
  return String(text || '')
    .replace(/^\s*[\[{【][^\]\}】]+[\]\}】]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimForNarration(text) {
  const normalized = normalizeActionText(text);
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}...`;
}

function renderAutomaticProgressNarration({ characterName, action, grounding }) {
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  const trainingName = extractTrainingName(action);
  const resourceName = extractResourceName(action);
  const progressParts = [];
  const stateParts = [];
  if (trainingName) {
    progressParts.push(`完成了${trainingName}的基础修炼`);
    stateParts.push(`${trainingName}进度已记录`);
  }
  if (resourceName) {
    progressParts.push(`领取了${resourceName}`);
    stateParts.push(`${resourceName}已写入背包`);
  }
  if (progressParts.length === 0) {
    progressParts.push('完成了这次低风险日常行动');
    stateParts.push('相关状态已写入');
  }
  const writeCount = Number(grounding?.appliedToolCallCount) || 0;
  const writeText = writeCount > 0 ? `，本轮有 ${writeCount} 项状态写入` : '';
  return [
    `${speaker}这次行动按低风险日常进展直接结算，没有进行掷骰。`,
    `你${progressParts.join('，')}。`,
    `行动结果：${stateParts.join('，')}${writeText}。`,
    '接下来：你打算如何利用这次进展？'
  ].join('\n');
}

function renderCombatActionNarration({ characterName, action, grounding }) {
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  const combat = grounding?.combat || {};
  const target = combat.targetName || combat.targetId || '目标';
  const damage = Array.isArray(combat.damage) && combat.damage.length
    ? combat.damage.map((item) => `${item.amount ?? 0}点${item.type || '伤害'}`).join('、')
    : '';
  if (combat.hit === false || grounding.success === false) {
    return [
      `${speaker}这次战斗动作已经按数值结算，但没有命中。`,
      `你尝试执行：${action}`,
      `行动结果：${target}没有受到新的可确认伤害。`,
      '接下来：你要继续攻击、防御，还是改用其他行动？'
    ].join('\n');
  }
  return [
    `${speaker}这次战斗动作已经按数值结算。`,
    `你执行的是：${action}`,
    `行动结果：${target}${damage ? `受到${damage}` : '的战斗状态已更新'}。`,
    '接下来：你要继续攻击、防御，还是查看战斗状态？'
  ].join('\n');
}

function renderCombatEndNarration({ characterName, action, grounding }) {
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  const combat = grounding?.combat || {};
  const rewards = mergeRewardLabels(Array.isArray(combat.rewards) ? combat.rewards : []);
  const rewardText = rewards.length
    ? rewards.map((item) => `${item.name || item.id} x${item.quantity}`).join('、')
    : '';
  return [
    `${speaker}最后一名敌人的战斗状态已经归零，战斗按胜利结算。`,
    `你执行的是：${action}`,
    combat.rewardStatus === 'applied' && rewardText
      ? `行动结果：战斗结束，战利品已写入背包：${rewardText}。`
      : '行动结果：战斗结束；没有可确认写入的战利品。',
    '接下来：你要查看背包、检查现场，还是继续前进？'
  ].join('\n');
}

function mergeRewardLabels(rewards = []) {
  const byId = new Map();
  for (const item of rewards) {
    if (!item) continue;
    const id = item.id || item.name;
    if (!id) continue;
    const previous = byId.get(id) || { id, name: item.name || id, quantity: 0 };
    byId.set(id, {
      ...previous,
      name: item.name || previous.name,
      quantity: (Number(previous.quantity) || 0) + (Number(item.quantity) || 1)
    });
  }
  return [...byId.values()];
}

function renderPreparedBattleNarration({ characterName, action }) {
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  return [
    `${speaker}这次行动触发了战斗，敌人与回合数据已经建立。`,
    `你开始执行：${action}`,
    '行动结果：战斗已进入独立战斗界面，普通攻击、防御、闪避和状态结算将由战斗模块处理。',
    '接下来：请在战斗界面选择行动；战斗结束后结果会回到剧情。'
  ].join('\n');
}

function renderFailedCheckNarration({ characterName, action, grounding }) {
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  const primary = Array.isArray(grounding?.diceResults) ? grounding.diceResults[0] : undefined;
  const diceText = primary
    ? `检定结果为${primary.total ?? '?'} / ${primary.threshold ?? '?'}，未达到成功条件。`
    : '检定没有通过。';
  return [
    `${speaker}${diceText}`,
    `你尝试执行：${action}`,
    '行动结果：这次尝试没有按成功结果写入状态；若你认为裁决遗漏了关键依据，可以申请重新裁定。',
    '接下来：你要调整做法，还是接受失败结果继续推进？'
  ].join('\n');
}

function renderUnsettledNarration({ characterName, action }) {
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  return [
    `${speaker}这次行动没有产生可确认的成功写库结果。`,
    `你尝试执行：${action}`,
    '行动结果：当前状态保持谨慎，不把未写入的变化当作既成事实。',
    '接下来：你要补充依据、改用工具，还是换一种行动？'
  ].join('\n');
}

function renderSuccessfulStateChangeNarration({ characterName, action, displayAction, grounding }) {
  const speaker = characterName && characterName !== 'Agent' ? `${characterName}：` : '旁白：';
  const facts = extractStoryFactLabels(action);
  const writeCount = Number(grounding?.appliedToolCallCount) || 0;
  const written = writeCount > 0 ? `本轮有 ${writeCount} 项状态或设定写入。` : '相关状态或设定已按裁决写入。';
  const details = [];
  if (facts.quest) details.push(`任务线索「${facts.quest}」已进入追踪。`);
  if (facts.npc) details.push(`新人物「${facts.npc}」已登场。`);
  if (facts.item) details.push(`物品「${facts.item}」已记录。`);
  if (facts.map) details.push(`地点「${facts.map}」已开放为可用地图。`);
  if (facts.factions.length >= 2) details.push(`${facts.factions[0]}与${facts.factions[1]}的关系变化已记录。`);
  if (facts.metric) details.push(`扩展数值「${facts.metric.name}=${facts.metric.value}」已记录。`);
  return [
    `${speaker}这次行动已按本轮裁决推进。`,
    `你执行的是：${displayAction || action}`,
    details.length ? `行动结果：${details.join('')}` : `行动结果：${written}`,
    details.length ? `记录：${written}` : '',
    '接下来：你要先追哪条线索，还是查看当前状态？'
  ].filter(Boolean).join('\n');
}

function extractStoryFactLabels(action) {
  const text = String(action || '');
  const npcRaw = text.match(/(?:新NPC|遇见新NPC|遇到新NPC)\s*([^，。；;]{2,24})/u)?.[1]
    || text.match(/(?:遇见|遇到|结识|认识)\s*(?:新NPC)?\s*([^，。；;]{2,24}?)(?:，|他|她|给|把|请|$)/u)?.[1]
    || text.match(/\bnew NPC\s+(.{2,60}?)(?:\s+END|\s+new item\b|\s+new map\b|\s+accept quest\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/i)?.[1]
    || text.match(/\bmeet\s+new NPC\s+(.{2,60}?)(?:\s+END|\s+he\b|\s+she\b|\s+gives\b|\s+asks\b|$)/i)?.[1]
    || '';
  const mapRaw = text.match(/新地图\s*([^，。；;]{2,24})/u)?.[1]
    || text.match(/\bnew map\s+(.{2,50}?)(?:\s+END|\s+new NPC\b|\s+new item\b|\s+accept quest\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/i)?.[1]
    || '';
  const itemRaw = [
    ...[...text.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴))/gu)].map((match) => match[1]),
    ...[...text.matchAll(/\b(?:new item|item)\s+(.{2,60}?(?:Token|Key|Potion|Scroll|Relic|Orb|Gem|Charm|Talisman|Blade|Sword|Herb|Pill))(?:\s+END|\s+new map\b|\s+accept quest\b|\s+quest\b|\s+new NPC\b|\s+faction\b|\s+metric\b|$)/gi)].map((match) => match[1]),
    ...[...text.matchAll(/\bgives me\s+(.{2,60}?(?:Token|Key|Potion|Scroll|Relic|Orb|Gem|Charm|Talisman|Blade|Sword|Herb|Pill))(?:\s+END|\s+asks\b|\s+new map\b|\s+faction\b|\s+metric\b|$)/gi)].map((match) => match[1])
  ]
    .map((value) => cleanupItemLabel(value))
    .filter(Boolean)[0] || '';
  const questRaw = text.match(/(?:接下|接受|领取).{0,12}(调查[^，。；;]{2,24}?)(?:的委托|委托|任务|$)/u)?.[1]
    || text.match(/\b(?:accept|take|track)\s+quest\s+(.{2,80}?)(?:\s+END|\s+new NPC\b|\s+new item\b|\s+new map\b|\s+faction\b|\s+metric\b|$)/i)?.[1]
    || text.match(/\bquest\s+(.{2,80}?)(?:\s+END|\s+new NPC\b|\s+new item\b|\s+new map\b|\s+faction\b|\s+metric\b|$)/i)?.[1]
    || '';
  const metricMatch = text.match(/(?:^|[,，.。;；:：\s])([^,，.。;；:：]{1,20}指数)(?:目前|当前|为|是|[:：]){0,3}\s*(\d+(?:\.\d+)?)/u)
    || text.match(/\bmetric\s+(.{2,50}?(?:Index|Score|Level|Rating|Value))(?:\s+currently|\s+now|\s+is|\s+at|\s*=|\s+){0,3}\s*(\d+(?:\.\d+)?)/i);
  const factions = [
    ...[...text.matchAll(/([^\s,，.。;；:：和]{1,8}(?:商会|帮|宗|派|门|盟|国|城|家|族|教|团))/gu)].map((match) => match[1]),
    ...[...text.matchAll(/\bfaction\s+(.{2,60}?(?:Gang|Sect|Guild|Clan|Order|Alliance|Kingdom|House|Cult|Band|Company|Church|Temple))(?:\s+END|\s+hostile\b|\s+relation\b|\s+and\b|\s+starts\b|\s+becomes\b|$)/gi)].map((match) => match[1]),
    ...[...text.matchAll(/\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,4}\s+(?:Gang|Sect|Guild|Clan|Order|Alliance|Kingdom|House|Cult|Band|Company|Church|Temple))\b/g)].map((match) => match[1])
  ]
    .map((value) => cleanupFactionLabel(value))
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index);
  return {
    npc: cleanupLabel(npcRaw),
    map: cleanupLabel(mapRaw),
    item: cleanupLabel(itemRaw),
    quest: cleanupLabel(questRaw),
    factions,
    metric: metricMatch ? { name: cleanupLabel(metricMatch[1]), value: metricMatch[2] } : undefined
  };
}

function cleanupLabel(value = '') {
  return String(value || '')
    .replace(/^[：:，,。；;\s]+|[：:，,。；;\s]+$/gu, '')
    .replace(/^(?:但|一个|一位|一枚|一件|新|的|去|到|前往|请我去)/u, '')
    .replace(/\s+END$/i, '')
    .trim();
}

function cleanupItemLabel(value = '') {
  const cleaned = cleanupLabel(value)
    .replace(/^.*(?:一枚|一件|一个|一把)/u, '')
    .trim();
  const suffixMatch = cleaned.match(/([\u4e00-\u9fa5A-Za-z0-9]{1,8}(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴))$/u);
  return suffixMatch?.[1] || cleaned;
}

function cleanupFactionLabel(value = '') {
  const cleaned = cleanupLabel(value);
  const suffixMatch = cleaned.match(/([^和,，.。;；:：]{1,8}(?:商会|帮|宗|派|门|盟|国|城|家|族|教|团))$/u);
  return suffixMatch?.[1] || cleaned;
}

function extractTrainingName(action) {
  const text = String(action || '');
  const explicit = text.match(/(?:修炼|学习|研习|练习|参悟)([^，。,.；;、]{1,24})/u)?.[1]?.trim();
  if (explicit) return explicit.replace(/^(?:一下|一些|一门|一套)/u, '').trim() || explicit;
  if (/入门功法/u.test(text)) return '入门功法';
  return '';
}

function extractResourceName(action) {
  const text = String(action || '');
  if (/俸禄|月俸|供奉/u.test(text)) return '俸禄';
  const explicit = text.match(/(?:领取|领|拿|收取|领取本期|领取每月)([^，。,.；;、]{1,24})/u)?.[1]?.trim();
  if (explicit) return explicit.replace(/^(?:一下|一些|本期|每月)/u, '').trim() || explicit;
  return '';
}

function inferNarrativeCue(action) {
  const text = String(action || '');
  const lower = text.toLowerCase();
  if (/修炼|学习|研习|练习|参悟|功法|俸禄|月俸|供奉/.test(text)) {
    const trainingName = extractTrainingName(text) || '当前功课';
    const resourceName = extractResourceName(text);
    return {
      opening: `${trainingName}的基础脉络被你重新梳理了一遍。`,
      action: '这次行动按日常进展推进，没有额外制造阻碍。',
      detail: resourceName ? `你同时领取了${resourceName}，资源已经归入可用储备。` : '你的掌握程度出现了可记录的小幅提升。',
      npc: '',
      result: resourceName
        ? `行动结果：${trainingName}进度推进，${resourceName}已经入账。`
        : `行动结果：${trainingName}进度推进。`,
      next: '你打算如何利用这次进展？'
    };
  }
  if (/巡夜灯徽|灯徽|徽章|门槛内侧|门槛|跪/.test(text) || /watch badge|badge|threshold|kneel|step inside|stepping inside/.test(lower)) {
    return {
      opening: '门槛内侧的冷雾贴着地面翻卷，倒扣的巡夜灯徽没有立刻移动。',
      action: '你先蹲下检查徽章边缘，没有把身体探进门内。',
      detail: '徽章背面沾着黑蜡，边缘有一道新鲜刮痕，像是被人从里面推出来的。',
      npc: '梅尔盯着徽章，低声说：“这是巡夜人只在求援时才会摘下的东西。”',
      result: '行动结果：你确认徽章是求援信号，黑蜡和刮痕成为新的线索。',
      next: '你要怎么处理这枚求援灯徽？'
    };
  }
  if (/提灯|照|灯|光|门缝/.test(text) || /lantern|light|lamp|shine|door gap/.test(lower)) {
    return {
      opening: '遮光提灯的窄光贴着门缝切进去，雾尘在光里慢慢转动。',
      action: '你让光线先探路，自己仍留在门外的安全角度。',
      detail: '光线没有照到人影，只照出地面上一段被拖拽过的湿亮弧线。',
      npc: '梅尔往后退了半步，声音发紧：“那痕迹不是往外，是往里。”',
      result: '行动结果：你确认门内没有直接伏击，但拖痕指向更深处。',
      next: '你要怎么利用这段拖痕？'
    };
  }
  if (/问|询问|时间顺序|谁碰/.test(text) || /ask|question|who touched|exact order|time order|sequence|recently/.test(lower)) {
    return {
      opening: '梅尔听完后先看了看雾里的门缝，才压低声音回答。',
      action: '你把问题压到具体的时间顺序上，没有让他用传闻带偏。',
      detail: '他的顺序开始变得清楚，但有一个时间点明显被他绕开了。',
      npc: '梅尔补了一句：“二更之后，有人从门里敲了三下，可街上没有脚印。”',
      result: '行动结果：你逼出了新的时间线，梅尔仍隐瞒了一个关键时间点。',
      next: '你要怎么追问这个被绕开的时间点？'
    };
  }
  if (/推开|开门|打开|撬/.test(text) || /push|open|crack|pry/.test(lower)) {
    return {
      opening: '青铜门发出很轻的摩擦声，像有人在另一侧屏住呼吸。',
      action: '你只把门推开一线，先确认门槛和地面。',
      detail: '门缝只开了一线，冷雾先涌出来，门内地面有一枚倒扣的巡夜灯徽。',
      npc: '梅尔没有靠近，只用手势示意你先看门槛内侧。',
      result: '行动结果：门被安全打开一线，新的门内线索暴露出来。',
      next: '你要怎么处理门缝后的冷雾和灯徽？'
    };
  }
  if (/粉笔|标记|黑蜡|蜡|闻/.test(text) || /chalk|\bmark\b|wax|smell/.test(lower)) {
    return {
      opening: '盐粉落在旧盐线旁，短暂亮了一下，很快被湿气压暗。',
      action: '你先做标记，再用气味和残留物确认痕迹来源。',
      detail: '黑蜡有苦杏仁和铁锈味，残迹边缘还粘着一丝蓝线头。',
      npc: '梅尔盯着蓝线头，明显认出了什么，却没有立刻开口。',
      result: '行动结果：你保留了黑蜡证据，并发现蓝线头与梅尔的反应有关。',
      next: '你要怎么利用这份证据？'
    };
  }
  if (/检查|观察|痕|门槛|门缝|青铜门|开门|推门|门内|门外|门锁|门扉|门口|碰门|不碰门|青铜|盐/.test(text) || /inspect|observe|trace|drag|mark|door|bronze|salt line|touching/.test(lower)) {
    return {
      opening: '你没有碰门，先把门槛前的痕迹一寸寸看过去。',
      action: '你的检查保持在门外，重点落在盐线和拖痕的方向。',
      detail: '湿盐线确实是从门内侧被抹断，拖痕在门缝前突然变窄。',
      npc: '梅尔压低声音：“巡夜人的灯灭前，也是在这里停住的。”',
      result: '行动结果：你确认拖痕来自门内，巡夜人失踪与门槛直接相关。',
      next: '你要怎么追踪门槛后的痕迹？'
    };
  }
  return {
    opening: '雾声压低，现场没有立刻给出危险反应。',
    action: '你的行动被直接推进。',
    detail: '你完成了本轮尝试，并把局面推向一个更明确的结果。',
    npc: '梅尔观察你的处理方式，没有贸然打断。',
    result: '行动结果：局面已经变化，后续可以基于这个结果继续行动。',
    next: '你要怎么利用这个结果？'
  };
}

function inferCharacterName(messages) {
  const namedMessage = [...messages].reverse().find((message) => (
    message.name && !/^user|player$/i.test(String(message.name))
  ));
  if (namedMessage?.name) return String(namedMessage.name).trim();

  const joined = messages.map((message) => message.content).join('\n');
  const match = joined.match(/Character Name\n(.+)/);
  if (match?.[1]?.trim()) return match[1].trim();

  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
  const personaMatch = systemText.match(/你是([^。\n]{2,40})(?:。|\n|$)/);
  return personaMatch?.[1]?.trim() || 'Agent';
}
