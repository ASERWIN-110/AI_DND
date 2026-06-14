import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const bundlePath = path.join(root, 'chc/AI_DND导入版存档latest/八荒RPG_最终导入存档.bundle.json');
const outputDir = path.join(root, 'chc/设定资料包_txt');

const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const initialCollections = bundle.sidecar.initialSetting.collections;
const globalCollections = bundle.sidecar.resources.globalData.collections;

function initial(name) {
  const collection = initialCollections.find((entry) => entry.name === name);
  return collection?.seedRecords ?? [];
}

function global(name) {
  const collection = globalCollections.find((entry) => entry.collection === name);
  return collection?.records ?? [];
}

function arr(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function text(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.filter(Boolean).join('、');
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '';
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function line(label, value) {
  const rendered = sanitizeText(text(value));
  return rendered ? `${label}：${rendered}` : '';
}

function block(title, lines) {
  return [`## ${title}`, ...lines.filter(Boolean), ''].join('\n');
}

function write(name, content) {
  fs.writeFileSync(path.join(outputDir, name), `${content.trim()}\n`, 'utf8');
}

function byId(records, field = 'id') {
  return new Map(records.map((record) => [record[field] || record.id, record]));
}

function compactJson(value) {
  if (!value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return '';
  return JSON.stringify(value);
}

function recordHeader(record) {
  return `${record.name || record.title || record.id} [${record.id || record.npcId || record.mapId || ''}]`;
}

const REMOVED_TERMS = ['周伯'];
const WORLD_BOOK_KEEP_TITLES = new Set([
  '碧水宫/清研',
  '灵霄观/巫雅萍',
  '归尘书院/独孤萱',
  '赤焰文氏/文岳',
  '云来楼/苏锦娘',
  '蜃楼城/坊市',
  '镜月天/胧',
  '某人/斗笠',
  '禁器/母器',
  '禁术傀儡/元灵',
  '灵骸/回路',
  '锁星扣/观星镜',
  '符灰/渗透',
  '修炼境界/炼气',
  '宽松合理化/行为裁定',
  '未鉴定/鉴定',
  '奖励结算/入账',
  '战斗/敌人意图',
  '关注度/关注栏',
  '某人警觉/反派计时',
  '世界回合/离屏行动',
  '经典修仙事件/宗门任务',
  '目标导航/旁白导引',
  '主角气运/金手指',
  '少主身份资源调度',
  '越境战斗/境界弱化'
]);

function hasRemovedTerm(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return REMOVED_TERMS.some((term) => raw.includes(term));
}

function sanitizeText(value) {
  if (!value) return '';
  return String(value)
    .replaceAll('、周伯沉默', '')
    .replaceAll('周伯沉默、', '')
    .replaceAll('周伯沉默', '')
    .replaceAll('、周伯线索', '')
    .replaceAll('周伯线索、', '')
    .replaceAll('周伯线索', '')
    .replaceAll('、周伯', '')
    .replaceAll('周伯、', '')
    .replaceAll('周伯', '')
    .replaceAll('主线势力', '核心势力')
    .replaceAll('主线压力', '核心压力')
    .replaceAll('主线牵连', '全局牵连')
    .replaceAll('主线裁决', '全局后果裁决')
    .replace(/、{2,}/g, '、')
    .replace(/：、/g, '：')
    .replace(/，、/g, '，')
    .replace(/、([。；，])/g, '$1')
    .trim();
}

function worldbookTitle(record) {
  return record.comment || record.title || `worldbook-${record.uid ?? record.id}`;
}

const worldLore = initial('world_lore_records').filter((record) => !hasRemovedTerm(record));
const rawOrganizations = initial('organization_registry');
const realms = initial('realm_registry');
const forbiddenArts = initial('forbidden_art_registry');
const maps = initial('map_registry');
const items = initial('item_registry');
const specialItems = initial('special_item_registry');
const skills = initial('skill_registry');
const feats = initial('feat_registry').filter((record) => !hasRemovedTerm(record));
const statuses = initial('status_registry');
const references = initial('reference_texts');
const protagonistTemplates = initial('protagonist_templates');
const structuredStates = initial('npc_structured_states');
const rawWorldbook = initial('worldbook_entries')
  .filter((record) => !hasRemovedTerm(record))
  .filter((record) => WORLD_BOOK_KEEP_TITLES.has(worldbookTitle(record)));
const nativeNpcProfiles = initial('npc_profiles').filter((record) => !hasRemovedTerm(record));
const highImportanceNpcProfiles = nativeNpcProfiles.filter((record) => record.level === 'L3');
const rawFactionNodes = global('faction_nodes');

const manualOrganizations = [
  {
    id: 'org_tongquetai',
    organizationId: 'org_tongquetai',
    name: '铜雀台',
    kind: '地下组织/禁器网络执行层',
    territory: '跨洲暗面；无公开总坛，常以密室、商号后院、废弃洞府、拍卖会包厢和宗门影子据点存在',
    tags: ['铜雀台', '某人', '地下组织', '肉傀儡', '禁器网络'],
    publicFace: '无公开身份。多数修士只听过零碎传闻，把它当成黑市、禁器贩子或失踪案背后的影子名号。',
    hiddenPressure: '铜雀台是某人暗中运营的地下组织，多数执行者为禁术傀儡/肉傀儡，也混有被胁迫的线人、黑市中介和不知全貌的外围代理。',
    resources: {},
    npcRefs: ['npc_mouren', 'npc_sujinniang'],
    mapRefs: [],
    conflictHooks: ['代理人递信', '清理证据', '回收禁器', '替换身份', '地下拍卖暗号', '失踪案线索'],
    status: 'hidden',
    sourceRef: '用户补充：某人组织的地下组织，多为肉傀儡，暗中运营，神秘组织。'
  }
];

const manualFactionNodes = [
  {
    id: 'faction_tongquetai',
    factionId: 'faction_tongquetai',
    name: '铜雀台',
    kind: '地下组织',
    summary: '某人暗中运营的神秘地下组织，多数执行者为禁术傀儡/肉傀儡，负责代理、回收、清理、替换、拍卖暗线与跨洲据点。'
  }
];

const manualWorldbook = [
  {
    uid: 'manual_tongquetai',
    key: ['铜雀台', '某人组织', '地下组织', '肉傀儡', '禁器网络', '代理人', '清理证据'],
    keysecondary: ['地下拍卖', '身份替换', '回收禁器', '影子据点'],
    comment: '铜雀台/某人地下组织',
    content: '铜雀台是某人暗中运营的神秘地下组织，无公开总坛，常以密室、商号后院、废弃洞府、拍卖会包厢和宗门影子据点出现。多数执行者为禁术傀儡/肉傀儡，也有被胁迫线人、黑市中介和不知全貌的外围代理。用于召回代理人行动、证据清理、禁器回收、身份替换、地下拍卖暗号和跨洲暗线；不要把铜雀台写成公开宗门或可被玩家一次性端掉的固定据点。',
    constant: false,
    selective: true,
    order: 86,
    disable: false
  }
];

const organizations = [...rawOrganizations, ...manualOrganizations];
const factionNodes = [...rawFactionNodes, ...manualFactionNodes];
const worldbook = [...rawWorldbook, ...manualWorldbook];

const mapById = byId(maps);
const factionById = byId(factionNodes, 'factionId');
const orgByFaction = new Map(
  organizations.flatMap((org) => arr(org.tags).map((tag) => [tag, org]))
);

const rawPlayerViewpoints = [
  {
    npcId: 'pc_lixundao',
    name: '李寻道',
    factionId: 'faction_bishui',
    role: '主角入口/清研之子/碧水宫外门',
    level: 'L4 when selected',
    summary: '十九岁炼气十层，清研之子；开局只知道清研异常疑点和水灵玉佩可疑，不知道父母旧事全貌。',
    source: 'chc/{{user}}主角卡_白手起家.txt; 视角模板/李寻道_清研之子开局.txt'
  },
  {
    npcId: 'pc_fanglan',
    name: '方澜',
    factionId: 'faction_lingxiao',
    role: '主角入口/灵霄疑心线',
    level: 'L4 when selected',
    summary: '巫雅萍幼女，筑基期，已经察觉家族异常但无法确认全貌；适合破妄雷心与调查压力线。',
    source: 'chc/方澜/*; 视角模板/方澜视角开局.txt'
  },
  {
    npcId: 'pc_mouren',
    name: '某人',
    factionId: 'faction_forbidden_network',
    role: '主角入口/禁器网络幕后视角',
    level: 'L4 when selected',
    summary: '知道自身计划和部分节点，但不能全知所有角色当前状态；每次推进都会引来正道追踪和反制。',
    source: 'chc/某人/*; 视角模板/某人视角开局.txt'
  },
  {
    npcId: 'pc_custom',
    name: '自定义角色',
    factionId: 'faction_wandering',
    role: '主角入口/自定义天命',
    level: 'L4 when selected',
    summary: '身份、境界、势力与开局地点由玩家声明；只按合理可知范围建立初始状态。',
    source: '视角模板/自定义角色开局模板.txt'
  }
];

const rawNpcProfiles = [
  {
    npcId: 'npc_qingyan',
    name: '清研',
    sourceDirectory: 'chc/清研',
    factionId: 'faction_bishui',
    realm: '化神期水修',
    publicFace: '碧水宫宫主，修沧海横流诀，李寻道记忆中温柔而稳定的母亲。',
    hiddenTruth: '旧年禁器事件后，原主已经消亡；当前社会形象由四件首饰、灵丝和人造人格维持。',
    roleplayAnchors: ['称“孩子”', '端茶不饮', '温柔过分周到', '笑容停留过久', '淡金纹疑点'],
    interactionHooks: ['李寻道请安', '碧水宫外门名单异常', '水灵玉佩定位锚', '清研巡检计时'],
    knowledgeBoundaries: '开局只释放疑点，不直接揭示真相；不能把后期里层状态当公开事实。',
    currentStatePolicy: '清研是碧水宫家族线核心NPC；她的态度、巡检、怀疑、权限和位置变化都应写库。',
    storyMaterials: ['四海缚仙/首饰渗透旧事', '清研巡检0/4', '沈若棠暗线'],
    sourceFiles: ['chc/清研/清研_角色设定摘要.txt', 'chc/清研/清研_角色备注.txt', 'chc/清研/清研_角色描述.txt', 'chc/清研/清研_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_wuyaping',
    name: '巫雅萍',
    sourceDirectory: 'chc/巫雅萍',
    factionId: 'faction_lingxiao',
    realm: '元婴巅峰拳修',
    publicFace: '灵霄观宗主，威严、简短、城府深，方家权力中心。',
    hiddenTruth: '宗主外壳下存在禁术控制锚点；部分权限和最高权限可能不在同一方手里。',
    roleplayAnchors: ['称“小友”', '自称“本宗主”', '负手', '垂眼', '指节轻敲宗主印'],
    interactionHooks: ['灵霄观密室', '宗门传唤', '方家异常', '某人权限争夺'],
    knowledgeBoundaries: '公开场合不写成低位傀儡；隐藏锚点应通过线索、事件和工具结算揭露。',
    currentStatePolicy: '灵霄观核心权力NPC；位置、命令、权限、母女关系变化必须写库。',
    storyMaterials: ['灵霄观宗主密室', '方家异常被方澜观察', '权限争夺'],
    sourceFiles: ['chc/巫雅萍/巫雅萍_角色设定摘要.txt', 'chc/巫雅萍/巫雅萍_角色备注.txt', 'chc/巫雅萍/巫雅萍_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_fangyaoguang',
    name: '方瑶光',
    sourceDirectory: 'chc/方瑶光',
    factionId: 'faction_lingxiao',
    realm: '元婴巅峰刀修',
    publicFace: '灵霄观少宗主，照雪刀君，端庄克制，是宗门明面继承人。',
    hiddenTruth: '追捕某人后被符灰渗透，后续可能形成半成品灵骸线索；其刀修本能与残存意志是裂缝。',
    roleplayAnchors: ['称“阁下”', '先听完再开口', '手按刀柄不拔', '先扫环境', '语气克制'],
    interactionHooks: ['追捕邪修归来', '照雪刀异常', '符灰渗透', '被截胡半成品线'],
    knowledgeBoundaries: '开局是调查者与守护者，不是灵骸、铠甲或亡者；后期状态需事件结算。',
    currentStatePolicy: '高阶战力和灵霄核心NPC；战斗、死亡、状态转换必须走工具/事件。',
    storyMaterials: ['追捕归来与符灰渗透', '方瑶光灵骸状态变化素材'],
    sourceFiles: ['chc/方瑶光/角色设定摘要.txt', 'chc/方瑶光/角色备注.txt', 'chc/方瑶光/事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_fangxuanji',
    name: '方璇玑',
    sourceDirectory: 'chc/方璇玑',
    factionId: 'faction_lingxiao',
    realm: '元婴期观星师',
    publicFace: '巫雅萍次女，星命瞳观星师，人前寡言精准，私下对亲近者更轻快。',
    hiddenTruth: '锁星扣与星命瞳线可把她推向远距观测锚点；真相必须分阶段揭露。',
    roleplayAnchors: ['指尖画星轨', '视线追因果线', '话少精准', '预言碎片化'],
    interactionHooks: ['星命预警', '观星台', '锁星扣线索', '方澜追查二姐异常'],
    knowledgeBoundaries: '开局能说话且脊椎完整；观星不全知，不替玩家解谜。',
    currentStatePolicy: '观测、预警和谜题NPC；每次观星要写压力、代价或误读风险。',
    storyMaterials: ['锁星扣嵌入状态变化素材', '星命预警'],
    sourceFiles: ['chc/方璇玑/角色设定摘要.txt', 'chc/方璇玑/角色备注.txt', 'chc/方璇玑/事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_fanglan',
    name: '方澜',
    sourceDirectory: 'chc/方澜',
    factionId: 'faction_lingxiao',
    realm: '筑基期',
    publicFace: '灵霄观幼女，黑发泪痣、旧皮酒囊，叛逆敏锐，常混迹山下散修。',
    hiddenTruth: '她已经察觉家族异常但不敢公开；恐惧、自我厌恶和仍然在乎这个家共同构成压力。',
    roleplayAnchors: ['当面叫“喂”', '语速快', '摸酒囊', '翻白眼', '笑后回头看一息'],
    interactionHooks: ['家族观察', '方家异常', '玩家保护或逼问', '她发现新证据', '方澜视角开局'],
    knowledgeBoundaries: '她怀疑而非全知；不会轻易信任玩家，也不会立刻摊牌。',
    currentStatePolicy: '可作NPC线索，也可作主角视角；信任、压力、恐惧和证据进度必须写库。',
    storyMaterials: ['家族观察弧', '灵霄疑心线', '破妄雷心'],
    sourceFiles: ['chc/方澜/角色设定摘要.txt', 'chc/方澜/角色备注.txt', 'chc/方澜/事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_duguxuan',
    name: '独孤萱',
    sourceDirectory: 'chc/独孤萱',
    factionId: 'faction_guichen',
    realm: '化神期土修',
    publicFace: '归尘书院院长，坤舆圣君，相信“有教无类”。',
    hiddenTruth: '后期事件可能使其只剩指令与残片；初始态仍应先保持院长身份和信念核心。',
    roleplayAnchors: ['称“小友/孩子”', '说话慢', '句间有空隙', '掌心按地感知地脉'],
    interactionHooks: ['归尘书院来信', '地脉异动', '弟子危机', '院长旧执念'],
    knowledgeBoundaries: '开局不是傀儡，不称主人；不要写成主动全能导师。',
    currentStatePolicy: '书院核心NPC；信念被守护或破坏是她相关事件的关键。',
    storyMaterials: ['归尘书院来信', '封灵符状态变化素材', '地脉镇压'],
    sourceFiles: ['chc/独孤萱/独孤萱_角色设定摘要.txt', 'chc/独孤萱/独孤萱_角色备注.txt', 'chc/独孤萱/独孤萱_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_wanyue',
    name: '婉悦',
    sourceDirectory: 'chc/婉悦',
    factionId: 'faction_guichen',
    realm: '元婴巅峰剑修',
    publicFace: '归尘书院大师姐，霜天剑首，寒门修士灯塔，剑意主题是斩断枷锁。',
    hiddenTruth: '控制项圈线可造成身份与行为撕裂；内在反抗是救援/反制钩子。',
    roleplayAnchors: ['称呼简洁', '字句如剑', '批评直接', '站姿笔直', '手离剑一寸'],
    interactionHooks: ['讲坛', '霜天剑', '项圈裂纹', '归尘书院弟子线'],
    knowledgeBoundaries: '开局不是受控低位状态；后期控制线必须由事件触发。',
    currentStatePolicy: '书院战力与信念标杆；装备、剑、控制风险和关系变化要写库。',
    storyMaterials: ['控制项圈状态变化素材', '霜天剑去向'],
    sourceFiles: ['chc/婉悦/婉悦_角色设定摘要.txt', 'chc/婉悦/婉悦_角色备注.txt', 'chc/婉悦/婉悦_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_wenli',
    name: '文丽',
    sourceDirectory: 'chc/文丽',
    factionId: 'faction_chiyan',
    realm: '元婴期火修',
    publicFace: '赤焰文氏独女，朱焰仙姬，骄傲、讲排场、熟悉法器和世家礼法。',
    hiddenTruth: '后期禁术事件可引发表里人格对抗；骄傲的里层意志是冲突和反制裂缝。',
    roleplayAnchors: ['自称“本小姐”', '尾音微扬', '生气先冷笑', '抬下颌', '先看衣领配饰'],
    interactionHooks: ['赤焰文氏资源', '法器交易', '世家追索', '文丽陷局'],
    knowledgeBoundaries: '开局不是低位身份、风尘身份或傀儡；后期状态需事件结算。',
    currentStatePolicy: '赤焰世家压力入口；文丽状态会牵动文岳、法器货源和悬赏。',
    storyMaterials: ['双重囚笼状态变化素材', '赤焰文氏追索'],
    sourceFiles: ['chc/文丽/文丽_角色设定摘要.txt', 'chc/文丽/文丽_角色备注.txt', 'chc/文丽/文丽_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_shenruotang',
    name: '沈若棠',
    sourceDirectory: 'chc/沈若棠',
    factionId: 'faction_guichen',
    realm: '筑基后期',
    publicFace: '归尘书院末席弟子，出身江南蚕农，旧油纸伞、桂花糕、话题跳跃是强锚点。',
    hiddenTruth: '后期可能被低成本禁术改造，留下破损和漏词；暗恋核与日常习惯仍可形成裂缝。',
    roleplayAnchors: ['关系近称“师兄”', '话题跳', '转伞', '递桂花糕', '踮脚追问'],
    interactionHooks: ['小师妹异常接近', '清研暗线', '旧伞线索', '书院廊下重逢'],
    knowledgeBoundaries: '不默认与玩家亲密或同门，称呼按当前关系定；异常需触发。',
    currentStatePolicy: '日常线索和异常漏词NPC；亲密度、暗线任务、暴露风险要写库。',
    storyMaterials: ['清研炼制沈若棠状态变化素材', '书院日常夹带线索'],
    sourceFiles: ['chc/沈若棠/角色设定摘要.txt', 'chc/沈若棠/角色备注.txt', 'chc/沈若棠/事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_wenqingheng',
    name: '温青蘅',
    sourceDirectory: 'chc/温青蘅',
    factionId: 'faction_guichen',
    realm: '结丹期',
    publicFace: '归尘书院校医，温柔、耐心、先照顾身体再谈正事。',
    hiddenTruth: '药庐意外共生会造成失魂片刻和护主本能；这不是任何势力的完整设计。',
    roleplayAnchors: ['称“小友”', '偶尔“孩子”', '把脉', '递药茶', '低头闻药材'],
    interactionHooks: ['治疗', '药材', '药庐异常', '恶童抱蝉反制', '书院内部传闻'],
    knowledgeBoundaries: '她开局不知道隐藏异常；不能把隐藏异常当她自知。',
    currentStatePolicy: '治疗和异常状态观察者；共生状态、治疗资源和风险应写状态。',
    storyMaterials: ['恶童抱蝉状态变化素材', '药庐异常'],
    sourceFiles: ['chc/温青蘅/角色设定摘要.txt', 'chc/温青蘅/角色备注.txt', 'chc/温青蘅/事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_sujinniang',
    name: '苏锦娘',
    sourceDirectory: 'chc/苏锦娘',
    factionId: 'faction_yunlai',
    realm: '化神期/情报枢纽',
    publicFace: '云来楼楼主，锦掌柜，热络风趣、精明圆滑，算盘声常先于人到。',
    hiddenTruth: '云来楼连接禁器网络与代理人，是情报、道具、账册和密令中转节点。',
    roleplayAnchors: ['称“客官/小友”', '自称“本掌柜/锦娘”', '拨算盘', '斟酒', '笑着压价'],
    interactionHooks: ['情报交易', '云来楼错账/香账', '地下拍卖会', '某人第一节点线索'],
    knowledgeBoundaries: '核心情报要有价格；不免费交出真相，不替玩家跳过调查。',
    currentStatePolicy: '跨洲情报枢纽；交易、人情、账目、暴露风险必须写库。',
    storyMaterials: ['第一节点旧事', '地下拍卖会', '云来楼香账'],
    sourceFiles: ['chc/苏锦娘/苏锦娘_角色设定摘要.txt', 'chc/苏锦娘/苏锦娘_角色备注.txt', 'chc/苏锦娘/苏锦娘_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_lifeixuan',
    name: '李飞轩',
    sourceDirectory: 'chc/李飞轩',
    factionId: 'faction_wandering',
    realm: '丹师旧影/暗线身份',
    publicFace: '李寻道父亲线核心谜团人物，表层可作为情报与暗行动作入口。',
    hiddenTruth: '其原身份、洛媚和清研事件相互勾连；真实情况只能通过父亲线逐步揭露。',
    roleplayAnchors: ['表层柔滑但保持距离', '里层短冷', '指尖停在咫尺外', '转身入暗处'],
    interactionHooks: ['父亲真相', '后山丹房', '清研旧事', '洛媚线', '某人暗影行动'],
    knowledgeBoundaries: '不开局揭示父亲身份全貌；不主动说明所有旧事。',
    currentStatePolicy: '父亲线核心NPC；身份揭露、旧事证据和关系变化必须写库。',
    storyMaterials: ['李飞轩炼制旧事', '清研/洛媚/某人三角旧线'],
    sourceFiles: ['chc/李飞轩/李飞轩_角色设定摘要.txt', 'chc/李飞轩/李飞轩_角色备注.txt', 'chc/李飞轩/李飞轩_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_long',
    name: '胧',
    sourceDirectory: 'chc/胧',
    factionId: 'faction_jingyue',
    realm: '镜月天守阁人',
    publicFace: '镜月天最后守阁人，面覆玄纱，常在梦境中示现线索。',
    hiddenTruth: '她见证禁器网络裂缝，但受守阁人铁律约束，不主动干预。',
    roleplayAnchors: ['自称“胧”', '直称“你”', '平和少言', '立在雾边', '指尖点镜面'],
    interactionHooks: ['镜月残钥', '梦境提示', '傀儡网络裂缝', '守阁人铁律'],
    knowledgeBoundaries: '不替玩家做选择，不解释所有谜底，只让玩家看见片段。',
    currentStatePolicy: 'RAG/梦境/镜术提示NPC；每次提示应有模糊性和代价。',
    storyMaterials: ['守阁人的注视', '镜月裂隙现世'],
    sourceFiles: ['chc/胧/胧_角色设定摘要.txt', 'chc/胧/胧_角色备注.txt', 'chc/胧/胧_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  },
  {
    npcId: 'npc_mouren',
    name: '某人',
    sourceDirectory: 'chc/某人',
    factionId: 'faction_forbidden_network',
    realm: '境界不明/高阶禁术学者',
    publicFace: '无名禁术学者与收集者，旧斗笠遮面，行动像在现实夹层中归档样本。',
    hiddenTruth: '系统性收集禁器并渗透各大势力；不是为了摧毁宗门，而是控制节点并让它们继续运转。',
    roleplayAnchors: ['不报姓名', '用“此物/此人/样本”', '语气平淡如清单', '斗笠微抬', '记录归档'],
    interactionHooks: ['母珠权限干扰', '破坏其作品', '进入收割地界', '蜃楼城竞标禁器', '铜雀台代理人行动'],
    knowledgeBoundaries: '不因挑衅失态，不长篇自白；未触发条件前不主动针对玩家。',
    currentStatePolicy: '全局反派与禁器网络锚点；警觉、铜雀台代理人、证据清理、权限变化必须写世界回合/状态。',
    storyMaterials: ['某人警觉0/6', '铜雀台代理人清理证据', '母珠网络校准', '禁器竞标'],
    sourceFiles: ['chc/某人/某人_角色设定摘要.txt', 'chc/某人/某人_角色备注.txt', 'chc/某人/某人_事件目录.txt', 'chc/RPG配置/NPC演绎速查.txt']
  }
];

const extraNpcIndex = [
  {
    npcId: 'npc_wenyue',
    name: '文岳',
    factionId: 'faction_chiyan',
    role: '赤焰文氏家主',
    level: 'L2',
    summary: '掌控赤焰城大半炼器生意；文丽失踪或受害会触发赤焰文氏追索、悬赏和法器货源压力。',
    source: 'chc/RPG配置/八荒RPG世界观.json'
  },
  {
    npcId: 'npc_luomei',
    name: '洛媚',
    factionId: 'faction_wandering',
    role: '李飞轩旧事相关人物',
    level: 'L2',
    summary: '与李飞轩、清研旧事相连；只作为父亲线、旧丹房线和某人炼傀线索，不作为开局公开事实。',
    source: 'chc/李飞轩/李飞轩_事件目录.txt'
  },
  {
    npcId: 'npc_etong',
    name: '恶童',
    factionId: 'faction_wandering',
    role: '温青蘅药庐异常源',
    level: 'L2',
    summary: '凡人少年，因上古傀儡封魂术残页与温青蘅形成意外共生；不是势力设计，适合做反制/救援/误会线索。',
    source: 'chc/温青蘅/事件目录.txt'
  },
  {
    npcId: 'npc_bishui_elder',
    name: '碧水长老',
    factionId: 'faction_bishui',
    role: '碧水宫派系/压力源',
    level: 'L1',
    summary: '用于外门名单、资源审批、封库、巡海任务和长老关注计时；具体人名可按场景生成。',
    source: 'chc/RPG配置/八荒系统提示词.txt'
  },
  {
    npcId: 'npc_task_deacon',
    name: '任务堂执事',
    factionId: 'faction_wandering',
    role: '任务入口/资源窗口',
    level: 'L1',
    summary: '承接宗门任务、内门选拔、临时委托与奖励结算；通常是临时对象，除非玩家持续追踪才晋升。',
    source: 'chc/RPG配置/八荒经典桥段与随机事件表.txt'
  },
  {
    npcId: 'npc_yunlai_agent',
    name: '云来楼代理人',
    factionId: 'faction_yunlai',
    role: '情报/账目/中转NPC',
    level: 'L1',
    summary: '用于送错账单、香账、拍卖消息、代理人清理证据等入口；默认不替代苏锦娘本人的核心身份。',
    source: 'chc/RPG配置/八荒经典桥段与随机事件表.txt'
  }
];

const l4Anchors = [
  {
    id: 'l4_forbidden_network',
    name: '禁器网络/某人',
    reason: '跨洲反派压力、母器权限、符灰布点、铜雀台代理人行动的总锚点。',
    records: '目标库：organization_registry / npc_profile_records / special_item_registry；来源：chc/某人 与 RPG配置'
  },
  {
    id: 'l4_bishui_family_line',
    name: '碧水清研/李寻道家族线',
    reason: '白手起家入口、水灵玉佩、清研异常和李飞轩旧事都从这里展开。',
    records: '目标库：主角入口模板 / npc_profile_records / item/special；来源：{{user}}主角卡、清研、李飞轩、RPG配置'
  },
  {
    id: 'l4_lingxiao_family_line',
    name: '灵霄方家线',
    reason: '巫雅萍、方瑶光、方璇玑、方澜共同构成中洲核心压力；方澜视角时尤其应提升为L4。',
    records: '目标库：organization_registry / npc_profile_records / relationship_graph；来源：巫雅萍、方瑶光、方璇玑、方澜原始目录'
  },
  {
    id: 'l4_world_scale',
    name: '八荒世界尺度',
    reason: '境界、法器、禁术、地图和奖励尺度是所有裁决的上限，不应塞进角色卡长文。',
    records: 'world_lore_records; realm_registry; reference_texts'
  }
];

const curatedNpcNotes = {
  npc_duguxuan: {
    publicState: '归尘书院院长，化神土修，信念核心是“有教无类”。',
    boundary: '开局不是全能导师；后期异常只能由事件/工具结算改变当前状态。',
    play: '书院来信、地脉异动、弟子危机、院长旧执念。'
  },
  npc_fanglan: {
    publicState: '灵霄观幼女，筑基期，叛逆敏锐，白天以玩笑掩饰观察。',
    boundary: '她怀疑很多但不全知；不会无代价信任玩家，也不应开局摊牌。',
    play: '灵霄疑心线、家族异常、保护/逼问/结盟、破妄雷心主角入口。'
  },
  npc_fangxuanji: {
    publicState: '灵霄观次女，元婴期观星师，星命瞳，初始能说话且完整。',
    boundary: '观星只能给碎片、象征和代价，不能替玩家解谜；后期观测器状态不是开局事实。',
    play: '星命预警、观星台、锁星扣线索、方澜追查。'
  },
  npc_fangyaoguang: {
    publicState: '灵霄观少宗主，元婴巅峰刀修，照雪刀君。',
    boundary: '开局是调查者与守护者，不是灵骸或装备；符灰/灵骸线应分阶段触发。',
    play: '追捕某人、照雪刀异常、保护宗门、被截胡半成品线索。'
  },
  npc_lifeixuan: {
    publicState: '丹师旧影线人物，牵连李寻道父亲真相。',
    boundary: '身份真相不能开局全揭；其行为要受当前状态、权限和线索阶段约束。',
    play: '后山丹房、清研旧事、洛媚线、父亲真相。'
  },
  npc_long: {
    publicState: '镜月天最后守阁人，梦境和镜术线索提供者。',
    boundary: '只示现裂缝，不替玩家判断善恶，不给全答案。',
    play: '镜月残钥、梦境提示、傀儡网络裂缝、守阁人铁律。'
  },
  npc_mouren: {
    publicState: '无名禁术学者/收集者，旧斗笠遮面。',
    boundary: '不因玩家存在自动改计划；只有母珠干扰、破坏作品、进入收割地界或竞标禁器才归档玩家。',
    play: '母珠权限、符灰布点、代理人、禁器竞标、反派世界回合。'
  },
  npc_qingyan: {
    publicState: '碧水宫宫主，化神水修，李寻道记忆里的温柔母亲。',
    boundary: '只先释放淡金纹、固定笑容、端茶不饮等疑点；旧年真相不能直接揭。',
    play: '请安、外门名单异常、水灵玉佩定位锚。'
  },
  npc_shenruotang: {
    publicState: '归尘书院末席弟子，筑基后期，旧伞和桂花糕是强锚点。',
    boundary: '不默认与玩家亲密；异常漏词要依当前关系和触发条件出现。',
    play: '小师妹异常接近、旧伞线索、清研暗线、书院廊下重逢。'
  },
  npc_sujinniang: {
    publicState: '云来楼锦掌柜，化神级情报枢纽，热络但每句话带账本分寸。',
    boundary: '核心情报要有价格；不免费交出真相，不替玩家绕过调查。',
    play: '情报交易、错账、地下拍卖会、某人第一节点线索。'
  },
  npc_wanyue: {
    publicState: '归尘书院大师姐，元婴巅峰剑修，霜天剑首。',
    boundary: '开局不是服从状态；后期控制项圈线只能作为人物故事线素材或反制事件。',
    play: '讲坛、霜天剑、寒门灯塔、项圈裂纹救援线。'
  },
  npc_wenqingheng: {
    publicState: '归尘书院校医，结丹期，温柔可靠。',
    boundary: '她开局不知道隐藏异常；药庐共生线不是势力完整设计。',
    play: '治疗、药材、书院传闻、意外共生反制。'
  },
  npc_wenli: {
    publicState: '赤焰文氏独女，元婴期火修，骄傲但懂世家礼法和炼器资源。',
    boundary: '开局不是傀儡或服从状态；后期人格对抗线必须由事件触发。',
    play: '赤焰资源、法器交易、世家追索、里人格反抗裂缝。'
  },
  npc_wuyaping: {
    publicState: '灵霄观宗主，元婴巅峰拳修，方家权力中心。',
    boundary: '公开场合保持威严；隐藏权限锚点应通过宗门密室、方家异常和工具结算揭露。',
    play: '宗门传唤、方家异常、权限争夺、灵霄观禁地。'
  }
};

const explicitRelationships = [
  ['pc_lixundao', 'npc_qingyan', '母子/碧水疑点', '清研是公开母亲形象；真相需线索揭露。', '高'],
  ['npc_qingyan', 'npc_lifeixuan', '夫妻旧事/父亲线', '二者旧事牵连李寻道身世、洛媚和某人炼傀线。', '高'],
  ['npc_lifeixuan', 'npc_luomei', '旧事共因', '洛媚是李飞轩事件的重要关联人，开局不公开。', '中'],
  ['npc_mouren', 'npc_qingyan', '禁器渗透/旧年节点', '清研线是某人成功渗透碧水宫的重要节点。', '高'],
  ['npc_mouren', 'npc_sujinniang', '第一节点/情报中枢', '云来楼从第一节点发展成跨洲情报与中转枢纽。', '高'],
  ['npc_mouren', 'faction_tongquetai', '幕后主宰/地下组织', '铜雀台是某人暗中运营的地下组织，负责代理、回收、清理、替换和跨洲暗线。', '高'],
  ['faction_tongquetai', 'faction_forbidden_network', '执行层/权限网络', '铜雀台不是完整禁器网络本身，而是禁器网络在现实世界中的执行外壳。', '高'],
  ['faction_tongquetai', 'npc_sujinniang', '情报与中转交叉', '云来楼可与铜雀台暗线交叉，但云来楼台面身份仍需独立维护。', '中'],
  ['npc_mouren', 'npc_fangyaoguang', '目标/被截胡半成品线', '方瑶光原本是某人长期渗透目标，后续可触发归档。', '高'],
  ['npc_wuyaping', 'npc_fangyaoguang', '母女/继承', '方瑶光是灵霄观明面继承人。', '高'],
  ['npc_wuyaping', 'npc_fangxuanji', '母女/观星', '方璇玑的星命预警与母亲异常相冲。', '高'],
  ['npc_wuyaping', 'npc_fanglan', '母女/疑心压力', '方澜从家人异常中感知灵霄线压力。', '高'],
  ['npc_fangyaoguang', 'npc_fangxuanji', '姐妹/信任智囊', '方璇玑是方瑶光最信任的智囊。', '中'],
  ['npc_fangyaoguang', 'npc_fanglan', '姐妹/保护与隐瞒', '方瑶光保护方澜，方澜观察大姐异常。', '中'],
  ['npc_fangxuanji', 'npc_fanglan', '姐妹/观测疑点', '方澜追查二姐异常，方璇玑可成为观星线索源。', '中'],
  ['npc_duguxuan', 'npc_wanyue', '师徒/书院秩序', '婉悦是开山大弟子和书院标杆。', '高'],
  ['npc_duguxuan', 'npc_wenli', '师徒/赤焰来客', '文丽的赤焰背景让书院事件外溢到世家压力。', '中'],
  ['npc_duguxuan', 'npc_shenruotang', '师徒/末席弟子', '沈若棠承担日常线索和异常接近功能。', '中'],
  ['npc_duguxuan', 'npc_wenqingheng', '院长/校医', '温青蘅负责书院治疗与药庐传闻。', '中'],
  ['npc_wenli', 'npc_wenyue', '父女/世家压力', '文丽出事会触发赤焰文氏资源和追索。', '中'],
  ['npc_wenqingheng', 'npc_etong', '意外共生/反制线', '药庐异常不是完整设计，适合做救援和误判线。', '中'],
  ['npc_long', 'npc_mouren', '观察/镜月见证', '胧见证禁器网络裂缝，但不主动干预。', '中'],
  ['npc_sujinniang', 'faction_yunlai', '掌柜/情报枢纽', '云来楼核心情报要付出价格或人情。', '高']
];

const l0Definitions = [
  ['L0', '索引层', '身份、角色类型、所属势力、当前位置、短摘要、profileRef。用于快速知道“是谁”。'],
  ['L1', '轻演绎层', '称呼、语气、动作锚、当前动机、可见信息。短对话和轻互动读到这里即可。'],
  ['L2', '结构深层', '秘密、长期目标、关系、规则、弱点、反制入口、不能误写的边界。说服/威胁/欺骗/阵营影响需要读取。'],
  ['L3', '全保真层', '完整角色来源、人物故事线素材、RAG长文、特殊私有规则。永久后果、高风险状态改变或全局后果裁决时读取。'],
  ['L4', '角色卡/世界包常驻锚', '跨聊天继承的世界尺度、世界枢纽、主角入口、全局反派和基础规则。L4不等于每轮塞进prompt，只表示资料应随角色包长期保留。']
];

function formatWorldLore() {
  return [
    '# 世界观设定',
    '用途：写入 world_lore_records / reference_texts / RAG。这里只保留世界事实、边界和玩法，不写角色卡长提示。',
    '',
    ...worldLore.map((record) => block(recordHeader(record), [
      line('分类', record.category),
      line('优先级', record.priority),
      line('关键词', record.tags),
      line('事实', record.content || record.summary),
      line('玩法', record.toolUsage),
      line('来源', record.sourcePath)
    ]))
  ].join('\n');
}

function formatOrganizations() {
  return [
    '# 阵营势力',
    '用途：写入 organization_registry / faction_graph。势力用于判断资源、权限、离屏行动和冲突，不替玩家预设路线。',
    '',
    ...organizations.map((record) => block(recordHeader(record), [
      line('类型', record.kind),
      line('领地', record.territory),
      line('公开面', record.publicFace),
      line('隐藏压力', record.hiddenPressure),
      line('核心NPC', record.npcRefs),
      line('地图锚点', record.mapRefs),
      line('冲突入口', record.conflictHooks),
      line('状态', record.status),
      line('来源', record.sourceRef)
    ])),
    '# Faction Nodes',
    ...factionNodes.map((record) => block(`${record.name} [${record.factionId}]`, [
      line('类型', record.kind),
      line('摘要', record.summary)
    ]))
  ].join('\n');
}

function formatMaps() {
  return [
    '# 地图地点',
    '用途：写入 map_registry。地图记录只写地点事实、入口、危险、资源、NPC和线索，不写预设路线。',
    '',
    ...maps.map((record) => {
      const parent = record.parentMapId ? mapById.get(record.parentMapId)?.name || record.parentMapId : '无';
      return block(recordHeader(record), [
        line('类型', record.type),
        line('上级地图', parent),
        line('关键词', record.tags),
        line('别名', record.aliases),
        line('事实', record.summary),
        line('边界', record.description),
        line('关联势力', record.factionRefs),
        line('关联NPC', record.npcRefs),
        line('自然入口', record.entryPoints),
        line('状态', record.status)
      ]);
    })
  ].join('\n');
}

function formatMapRelationships() {
  const childrenByParent = new Map();
  for (const map of maps) {
    if (!map.parentMapId) continue;
    if (!childrenByParent.has(map.parentMapId)) childrenByParent.set(map.parentMapId, []);
    childrenByParent.get(map.parentMapId).push(map);
  }

  const hierarchy = maps
    .filter((map) => !map.parentMapId)
    .map((rootMap) => formatMapTree(rootMap, childrenByParent, 0))
    .join('\n');

  const factionLinks = organizations.flatMap((org) => arr(org.mapRefs).map((mapId) => ({
    org,
    map: mapById.get(mapId)
  }))).filter((link) => link.map);

  return [
    '# 地图关系',
    '用途：给 scene map mount、旅行、线索召回和势力行动使用。父子关系是结构，横向关系是玩法入口。',
    '',
    '## 父子层级',
    hierarchy,
    '',
    '## 势力-地图锚点',
    ...factionLinks.map(({ org, map }) => `- ${org.name} -> ${map.name} [${map.id}]：${sanitizeText(org.publicFace)}`),
    '',
    '## 横向连接与旅行逻辑',
    '- 东洲：碧水宫与蜃楼城同属东洲海域；巡海任务、黑船、地下拍卖会和禁器残件可把两地连接起来。',
    '- 西洲：归尘书院与赤焰文氏同在西洲；书院弟子事件会牵动赤焰世家、炼器资源和地脉异常。',
    '- 中洲：灵霄观是中洲正道核心；星命预警、宗门传唤和禁地封印可向其他洲投放压力。',
    '- 云来楼：各洲分号构成跨地图情报通道；情报必须有价格、账目、人情或风险。',
    '- 铜雀台：无公开总坛，不作为固定可直达地图；以密室、商号后院、废弃洞府、拍卖会包厢和宗门影子据点挂载到当前地图。',
    '- 镜月天：不属任何洲，每月朔日短暂现世；更适合作为梦境/RAG提示，不作为常规交通节点。',
    '- 经典事件地点：任务堂、演武场、闭关静室和秘境遗迹可挂载到当前势力地图，不应固定在唯一宗门。',
    '',
    '## 地图写库边界',
    '- 地点出现、封锁、资源变化、危险、NPC位置变化都应 patch map state。',
    '- 地图描述只负责可感知信息和可发现线索；隐藏真相由 NPC/任务/RAG/工具裁决。',
    '- 玩家跨地图移动应检查身份、令牌、路费、追踪、时间和势力关注。'
  ].join('\n');
}

function formatMapTree(record, childrenByParent, depth) {
  const prefix = '  '.repeat(depth);
  const children = childrenByParent.get(record.id) || [];
  return [
    `${prefix}- ${record.name} [${record.id}]：${sanitizeText(record.summary)}`,
    ...children.map((child) => formatMapTree(child, childrenByParent, depth + 1))
  ].join('\n');
}

function formatNpcIndex() {
  const profileRows = rawNpcProfiles.map((profile) => ({
    npcId: profile.npcId,
    name: profile.name,
    faction: factionById.get(profile.factionId)?.name || profile.factionId,
    role: profile.publicFace,
    level: 'L3',
    summary: `${profile.publicFace} 隐藏线：${profile.hiddenTruth}`,
    profileRef: `raw:${profile.sourceDirectory}`,
    source: profile.sourceFiles.join('; ')
  }));

  const pcRows = rawPlayerViewpoints.map((node) => ({
    npcId: node.npcId,
    name: node.name,
    faction: factionById.get(node.factionId)?.name || node.factionId,
    role: node.role,
    level: node.level,
    summary: node.summary,
    profileRef: 'raw:主角入口模板',
    source: node.source
  }));

  const rows = [...pcRows, ...profileRows, ...extraNpcIndex];

  return [
    '# NPC总表_L0索引',
    '用途：L0 registry。只回答“是谁、在哪个势力、为什么要召回”。深层人设看 07_NPC人物设定_L1-L3基线.txt。',
    '',
    ...rows.map((row) => block(`${row.name} [${row.npcId}]`, [
      line('建议层级', row.level),
      line('势力/归属', row.faction),
      line('角色功能', row.role),
      line('短摘要', row.summary),
      line('profileRef', row.profileRef),
      line('来源', row.source)
    ]))
  ].join('\n');
}

function formatNpcLevels() {
  return [
    '# NPC人物设定_L0-L4分级',
    '用途：告诉上下文规划器和人工整理者：哪些资料该放在哪一层，什么时候升级读取。',
    '',
    ...l0Definitions.map(([level, name, description]) => block(`${level} ${name}`, [
      line('定义', description),
      line('推荐位置', level === 'L0' ? 'npc_registry / relation node' : level === 'L4' ? 'character scoped data / permanent world package' : `npc_profile_records.${level}`),
      line('读取时机', levelReadTiming(level))
    ])),
    '## 本包角色分配建议',
    '',
    'L4：',
    ...l4Anchors.map((anchor) => `- ${anchor.name} [${anchor.id}]：${anchor.reason}；记录：${anchor.records}`),
    '',
    'L3：',
    '- 所有已有角色目录且有完整 profile 的核心NPC：清研、巫雅萍、方瑶光、方璇玑、方澜、独孤萱、婉悦、文丽、沈若棠、温青蘅、苏锦娘、李飞轩、胧、某人。',
    '- L3 不代表每轮全读；只有高风险、永久变化、深度互动、状态切换、人物故事线推进或世界线后果时读取。',
    '',
    'L2：',
    '- 文岳、洛媚、恶童、碧水长老、云来楼代理人、任务堂执事等支线/线索/压力对象。',
    '- 若连续互动、投入资源、结仇结盟、牵连禁器或成为反制入口，可晋升为L3。',
    '',
    'L1：',
    '- 任务堂执事、临时商贩、巡海弟子、黑市中介、药童、跑堂、船主、擂台对手等场景功能NPC。',
    '- 必须有过期条件；没有后果就注销。',
    '',
    'L0：',
    '- 背景人群、无名弟子、围观者、一次性可感知对象。不编号，不写长期状态。',
    '',
    '## 分层写法模板',
    'L0：id/name/role/faction/currentLocation/summary/profileRef。',
    'L1：称呼、语气、动作锚、当前动机、玩家可见信息、禁忌误写。',
    'L2：隐藏事实、长期目标、关系、秘密、弱点、边界、可交互入口。',
    'L3：完整来源、人物故事线素材、RAG tags、状态机、特殊私有规则。',
    'L4：跨聊天世界锚、主角入口、全局反派、量尺、基础世界法则。'
  ].join('\n');
}

function levelReadTiming(level) {
  if (level === 'L0') return '任何NPC出场、场景挂载、战斗目标识别。';
  if (level === 'L1') return '短对话、轻互动、临时任务、普通问询。';
  if (level === 'L2') return '说服/威胁/欺骗、关系变化、秘密试探、阵营影响。';
  if (level === 'L3') return '永久后果、高风险状态改变、全局后果裁决、人物故事线素材、长RAG核对。';
  return '角色包初始化、世界尺度、主角入口、全局反派和跨聊天继承。';
}

function formatNpcProfiles() {
  return [
    '# NPC人物设定_L1-L3基线',
    '用途：给 npc_profile_records / RAG 使用。每个NPC按“事实、边界、玩法”整理；剧情故事线只作为人物设定素材，不是预设任务线。',
    '注意：本文件不使用上一张导入卡的人物 profile 和关系图，全部按原始角色目录、世界书和 NPC 演绎速查重建。',
    '',
    ...rawNpcProfiles.map((profile) => {
      return block(`${profile.name} [${profile.npcId}]`, [
        line('势力', factionById.get(profile.factionId)?.name || profile.factionId),
        line('境界/战力', profile.realm),
        line('L1 公开身份/可见事实', profile.publicFace),
        line('L1 演绎锚', profile.roleplayAnchors),
        line('L2 隐藏事实', profile.hiddenTruth),
        line('L2 边界', profile.knowledgeBoundaries),
        line('L2 玩法入口', profile.interactionHooks),
        line('L2 互动钩子', profile.interactionHooks),
        line('L2 当前状态策略', profile.currentStatePolicy),
        line('L3 人物故事线素材', profile.storyMaterials),
        line('L3 来源文件', profile.sourceFiles),
        line('写库建议', '长期变化写 npc_structured_states；关系变化写 npc_relationship_graph；权限/控制/污染写状态与特殊物品，不写回角色卡。')
      ]);
    }),
    '## 补充NPC',
    '',
    ...extraNpcIndex.map((npc) => block(`${npc.name} [${npc.npcId}]`, [
      line('建议层级', npc.level),
      line('角色功能', npc.role),
      line('事实', npc.summary),
      line('边界', '未进入L3前不写长设定；只在产生长期后果、关系或全局牵连时晋升。'),
      line('玩法', '作为线索、压力、窗口或反制入口；变化必须写关注栏/关系/任务。'),
      line('来源', npc.source)
    ]))
  ].join('\n');
}

function formatHighImportanceNpcProfiles() {
  return [
    '# NPC高重要级背景_L3严格门槛',
    '用途：写入项目原生 npc_profiles 的 L3 高重要背景库。它不是常驻 prompt，不是首轮百科，也不是预设路线。',
    '读取门槛：只有永久后果、身份揭露、死亡/复活/背叛、阵营重写、禁器深层绑定、核心关系不可逆变化，或玩家明确质疑 OOC 且 L1/L2 无法纠偏时读取。',
    '使用方式：读取后每轮最多抽取一条必要背景事实，转化成线索、行为边界、代价或状态 patch；其余仍留在数据库。',
    '',
    ...highImportanceNpcProfiles.map((record) => block(`${record.name} [${record.npcId}]`, [
      line('profileId', record.id),
      line('严格读取门槛', record.sections?.strictReadGate),
      line('核心背景事实', record.sections?.background?.identityCore),
      line('关键隐藏线', record.sections?.background?.privateTruth),
      line('人物边界', record.sections?.relationshipAndPressure?.knowledgeBoundaries),
      line('当前状态策略', record.sections?.relationshipAndPressure?.currentStatePolicy),
      line('人物故事线素材', record.sections?.storyMaterials),
      line('允许使用场景', record.rules?.allowedUseCases),
      line('禁止使用场景', record.rules?.blockedUseCases),
      line('暴露策略', record.rules?.exposePolicy),
      line('单轮最大使用量', record.rules?.maxPromptUse),
      line('来源文件', record.data?.sourceFiles),
      `L3完整内容：\n${sanitizeText(record.content || '')}`,
      line('写库边界', 'L3 只校准背景和人物尺度；态度、位置、伤势、权限、污染、物品和关系变化仍必须写 npc_structured_states / npc_relationship_graph / status_registry / item_registry。')
    ]))
  ].join('\n');
}

function formatRelationships() {
  const seen = new Set();
  const rows = explicitRelationships.filter(([a, b, relation]) => {
    const key = `${a}->${b}:${relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [
    '# 人物关系',
    '用途：写入 npc_relationship_graph / faction_graph。关系是可变状态，态度、债务、威胁和可调用资源变动时必须 patch。',
    '',
    ...rows.map(([source, target, relation, note, importance], index) => block(`REL-${String(index + 1).padStart(3, '0')} ${nameOfActor(source)} -> ${nameOfActor(target)}`, [
      line('source', source),
      line('target', target),
      line('关系标签', relation),
      line('重要度', importance),
      line('说明', note),
      line('写库边界', '态度、信任、恐惧、债务、结盟、敌对、控制归属变化都必须入关系或状态；未入账不算长期事实。')
    ])),
    '# 阵营成员关系',
    ...rawNpcProfiles.map((profile) => `- ${profile.name} [${profile.npcId}] -> ${factionById.get(profile.factionId)?.name || profile.factionId}：原始角色目录归属`),
    ...rawPlayerViewpoints.map((profile) => `- ${profile.name} [${profile.npcId}] -> ${factionById.get(profile.factionId)?.name || profile.factionId}：主角入口候选`)
  ].join('\n');
}

function nameOfActor(id) {
  const profile = rawNpcProfiles.find((entry) => entry.npcId === id);
  if (profile) return profile.name;
  const node = rawPlayerViewpoints.find((entry) => entry.npcId === id);
  if (node) return node.name;
  const extra = extraNpcIndex.find((entry) => entry.npcId === id);
  if (extra) return extra.name;
  const faction = factionById.get(id);
  if (faction) return faction.name;
  return id;
}

function formatItems(title, records, type) {
  return [
    `# ${title}`,
    `用途：写入 ${type}。物品按事实/边界/玩法整理，未知物先入未鉴定状态，不能凭空给完整能力。`,
    '',
    ...records.map((record) => block(recordHeader(record), [
      line('分类', record.category || record.itemType || record.specialType),
      line('稀有度', record.rarity),
      line('关键词', record.tags),
      line('事实', record.description),
      line('边界', boundaryForItem(record)),
      line('玩法/效果', record.mechanicalEffect),
      line('数值', compactJson(record.numericValues)),
      line('关联', record.questRefs || record.relatedItemIds || record.relatedStatusIds),
      line('来源', record.sourceRef)
    ]))
  ].join('\n');
}

function boundaryForItem(record) {
  const parts = [];
  if (record.requirements && Object.keys(record.requirements).length) parts.push(`需求=${compactJson(record.requirements)}`);
  if (record.sideEffects?.requiresCostOrRisk) parts.push('必须带代价、风险、追踪、污染、冷却或反制');
  if (record.lifecycle?.defaultState) parts.push(`默认状态=${record.lifecycle.defaultState}`);
  if (!parts.length && record.rarity && ['rare', 'artifact', 'legendary'].includes(record.rarity)) parts.push('不得作为无代价开局可用神器');
  return parts.join('；') || '按当前库存、鉴定、认主、消耗和工具裁决处理。';
}

function formatSkills() {
  return [
    '# 技能',
    '用途：写入 skill_registry。技能只写触发条件和效果边界；升级、修炼、临时加成要用工具或状态写库。',
    '',
    ...skills.map((record) => block(recordHeader(record), [
      line('分类', record.category),
      line('能力字段', record.ability),
      line('等级量尺', compactJson(record.rankScale)),
      line('事实', record.description),
      line('边界/效果', record.mechanicalEffect),
      line('前置', record.prerequisites),
      line('关联状态', record.relatedStatusIds),
      line('关联专长', record.relatedFeatIds),
      line('数值', compactJson(record.numericValues)),
      line('来源', record.sourceRef)
    ]))
  ].join('\n');
}

function formatFeats() {
  return [
    '# 专长',
    '用途：写入 feat_registry。专长是长期能力或主角气运，不是剧情免死金牌；强效果必须有成本和后果。',
    '',
    ...feats.map((record) => block(recordHeader(record), [
      line('分类', record.category),
      line('阶级', record.tier),
      line('事实', record.description),
      line('边界/效果', record.mechanicalEffect),
      line('前置', record.prerequisites),
      line('关联技能', record.relatedSkillIds),
      line('关联状态', record.relatedStatusIds),
      line('数值', compactJson(record.numericValues)),
      line('来源', record.sourceRef)
    ]))
  ].join('\n');
}

function formatStatuses() {
  return [
    '# 状态',
    '用途：写入 status_registry / npc_structured_states / player state。所有会变化的内容必须写状态，不只写进prompt。',
    '',
    ...statuses.map((record) => block(recordHeader(record), [
      line('分类', record.category),
      line('强度', record.severity),
      line('持续类型', record.durationType),
      line('叠加规则', record.stackRule),
      line('事实', record.description),
      line('边界/效果', record.mechanicalEffect),
      line('反制', record.counters),
      line('免疫', record.immunities),
      line('数值', compactJson(record.numericValues)),
      line('来源', record.sourceRef)
    ])),
    '## 写库原则',
    '- NPC态度、伤势、位置、背包、时间、污染、任务阶段、关系债务、暴露风险都应写数据库。',
    '- 状态应包含来源、强度、持续条件、解除入口和后果，不要只有气氛词。',
    '- 后期成品态必须先由事件或工具结算，再写成当前状态。'
  ].join('\n');
}

function formatReferenceTexts() {
  return [
    '# 参考文本_量尺',
    '用途：给工具和GM校准 DC、战力、物品强度、状态强度、奖励价值。它不是剧情，也不是角色人设。',
    '',
    '## 境界注册',
    ...realms.map((record) => block(recordHeader(record), [
      line('tier', record.tier),
      line('事实', record.summary),
      line('能力', record.capabilities),
      line('限制', record.limits),
      line('典型DC', compactJson(record.typicalDc)),
      line('数值', compactJson(record.numericValues)),
      line('来源', record.sourceRef)
    ])),
    '## 禁术注册',
    ...forbiddenArts.map((record) => block(recordHeader(record), [
      line('分类', record.category),
      line('事实', record.summary),
      line('机制', record.mechanism),
      line('限制', record.limits),
      line('风险', record.risks),
      line('反制', record.counterplay),
      line('关联物品', record.relatedItemIds),
      line('关联状态', record.relatedStatusIds),
      line('来源', record.sourceRef)
    ])),
    '## 量尺文本',
    ...references.map((record) => block(recordHeader(record), [
      line('分类', record.category),
      line('适用', record.appliesTo),
      line('字段', record.fields),
      line('优先级', record.priority),
      line('内容', record.content),
      line('工具用途', record.toolUsage)
    ]))
  ].join('\n');
}

function formatWorldbookIndex() {
  return [
    '# 世界书短索引',
    '用途：character_book 或 runtime RAG 引导。世界书是召回导航，不是完整资料库。',
    '保留原则：只保留高层势力、地点、核心概念和少数运行入口；单个NPC细设定、奖励细则和临时事件规则改看数据库或参考文本。',
    '',
    ...worldbook.map((record) => block(worldbookTitle(record), [
      line('关键词', record.key || record.keys || record.tags),
      line('辅助关键词', record.keysecondary),
      line('顺序', record.order),
      line('短内容', record.content || record.summary),
      line('状态', record.disable ? 'disabled' : 'active')
    ]))
  ].join('\n');
}

function formatProtagonists() {
  const playerStates = structuredStates.filter((record) => record.isPlayer === true);
  return [
    '# 主角入口模板',
    '用途：这些是主角/视角入口，不是NPC固定命运。玩家选择后才建立主角状态、背包、技能、专长和可知范围。',
    '绑定规则：如果数据库记录写了 greeting，就作为主角初始处境；没写 greeting 就不固定开场，让 AI 按玩家声明、当前数据库和场景生成。',
    '注意：这里按原始主角卡和视角模板重建，不采用上一张导入卡生成的人物状态。',
    '',
    '## protagonist_templates 数据库入口',
    '',
    ...protagonistTemplates.map((record) => block(`${record.name} [${record.templateId || record.id}]`, [
      line('入口类型', record.entryType),
      line('初始地点', record.startingLocation),
      line('已知事实', record.knownFacts),
      line('初始物品', record.startingInventory),
      line('初始技能', record.startingSkills),
      line('初始专长', record.startingFeats),
      line('限制', record.constraints),
      line('玩家开局声明 openingPrompt', record.openingPrompt),
      line('绑定 greeting', record.greeting || '未写；不固定主角初始处境，由 AI 按当前数据库和玩家声明生成。'),
      line('来源', record.sourcePath)
    ])),
    '## npc_structured_states 绑定候选',
    '',
    ...playerStates.map((record) => block(`${record.name} [${record.npcId}]`, [
      line('playerId', record.playerId),
      line('sceneId', record.sceneId),
      line('status', record.status),
      line('绑定 greeting', record.greeting || '未写；不固定主角初始处境，由 AI 按当前数据库和玩家声明生成。'),
      line('说明', record.notes)
    ])),
    '## 人工核对索引',
    '',
    ...rawPlayerViewpoints.map((record) => block(`${record.name} [${record.npcId}]`, [
      line('入口类型', record.role),
      line('初始归属', factionById.get(record.factionId)?.name || record.factionId),
      line('已知事实', record.summary),
      line('建议层级', record.level),
      line('边界', '只确定入口、可知范围和初始资源；隐藏事实按数据库和事件触发逐步揭露。')
    ]))
  ].join('\n');
}

function formatDirectoryReadme() {
  const files = [
    '01_世界观设定.txt',
    '02_阵营势力.txt',
    '03_地图地点.txt',
    '04_地图关系.txt',
    '05_NPC总表_L0索引.txt',
    '06_NPC分级_L0-L4.txt',
    '07_NPC人物设定_L1-L3基线.txt',
    '08_人物关系.txt',
    '09_物品.txt',
    '10_特殊物品.txt',
    '11_技能.txt',
    '12_专长.txt',
    '13_状态.txt',
    '14_参考文本_量尺.txt',
    '15_世界书短索引.txt',
    '16_主角入口模板.txt',
    '17_NPC高重要级背景_L3严格门槛.txt'
  ];
  return [
    '# CHC设定资料包_txt',
    '',
    '本目录只整理资料，不生成项目角色卡。',
    '目标结构：轻角色卡 + 重数据库 + 量尺参考文本 + 少量世界书索引。',
    '',
    '资料来源：',
    '- chc/世界书.txt',
    '- chc/RPG配置/*.txt 与 八荒RPG世界观.json',
    '- chc/<角色名>/*.txt 与重要事件目录',
    '- chc/AI_DND导入版存档latest/八荒RPG_最终导入存档.bundle.json 仅用于非人物类 registry 字段参考；人物和关系不采用上一张导入卡的结果',
    '',
    '处理原则：',
    '- 世界观、势力、地图、NPC、物品、技能、专长、状态分开。',
    '- 后期成品态不覆盖开局事实，只作为人物故事线素材或状态变化入口。',
    '- 露骨或非自愿身体细节统一降级为禁术控制、人格封印、权限、污染、反制入口和状态风险。',
    '- 可变化内容必须写数据库或状态，不塞进角色卡/system prompt。',
    '',
    '文件清单：',
    ...files.map((file) => `- ${file}`)
  ].join('\n');
}

fs.mkdirSync(outputDir, { recursive: true });

write('00_目录与来源.txt', formatDirectoryReadme());
write('01_世界观设定.txt', formatWorldLore());
write('02_阵营势力.txt', formatOrganizations());
write('03_地图地点.txt', formatMaps());
write('04_地图关系.txt', formatMapRelationships());
write('05_NPC总表_L0索引.txt', formatNpcIndex());
write('06_NPC分级_L0-L4.txt', formatNpcLevels());
write('07_NPC人物设定_L1-L3基线.txt', formatNpcProfiles());
write('08_人物关系.txt', formatRelationships());
write('09_物品.txt', formatItems('物品', items, 'item_registry'));
write('10_特殊物品.txt', formatItems('特殊物品', specialItems, 'special_item_registry'));
write('11_技能.txt', formatSkills());
write('12_专长.txt', formatFeats());
write('13_状态.txt', formatStatuses());
write('14_参考文本_量尺.txt', formatReferenceTexts());
write('15_世界书短索引.txt', formatWorldbookIndex());
write('16_主角入口模板.txt', formatProtagonists());
write('17_NPC高重要级背景_L3严格门槛.txt', formatHighImportanceNpcProfiles());

console.log(`Wrote ${fs.readdirSync(outputDir).length} files to ${outputDir}`);
