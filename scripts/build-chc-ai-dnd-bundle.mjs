#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = resolve(ROOT, 'chc');
const MULTI_ROOT = resolve(SOURCE_ROOT, 'SillyTavern导入版_八荒RPG_多视角版');
const OUT_DIR = resolve(SOURCE_ROOT, 'AI_DND导入版存档latest');
const BUNDLE_PATH = resolve(OUT_DIR, '八荒RPG_最终导入存档.bundle.json');
const COMPAT_BUNDLE_PATH = resolve(OUT_DIR, '八荒RPG_AI_DND_完整存档.bundle.json');
const REPORT_PATH = resolve(OUT_DIR, '转换报告.md');
const INSTRUCTIONS_PATH = resolve(OUT_DIR, '导入说明.md');

const CHARACTER_ID = 'bahuang_gm_multiview_chc_ai_dnd';
const NOW = '2026-05-31T00:00:00.000Z';
const REMOVED_TERMS = ['周伯', 'npc_zhoubo', 'feat_old_servant_clue'];
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

const CHARACTER_ID_MAP = {
  婉悦: 'wanyue',
  巫雅萍: 'wuyaping',
  文丽: 'wenli',
  方澜: 'fanglan',
  方瑶光: 'fangyaoguang',
  方璇玑: 'fangxuanji',
  李飞轩: 'lifeixuan',
  某人: 'mouren',
  沈若棠: 'shenruotang',
  清研: 'qingyan',
  温青蘅: 'wenqingheng',
  独孤萱: 'duguxuan',
  胧: 'long',
  苏锦娘: 'sujinniang'
};

const FACTION_BY_CHARACTER = {
  清研: 'faction_bishui',
  某人: 'faction_forbidden_network',
  方澜: 'faction_lingxiao',
  方瑶光: 'faction_lingxiao',
  方璇玑: 'faction_lingxiao',
  巫雅萍: 'faction_lingxiao',
  独孤萱: 'faction_guichen',
  婉悦: 'faction_guichen',
  文丽: 'faction_chiyan',
  沈若棠: 'faction_guichen',
  温青蘅: 'faction_guichen',
  苏锦娘: 'faction_yunlai',
  李飞轩: 'faction_wandering',
  胧: 'faction_jingyue'
};

const NPC_PLAYBOOK = {
  清研: {
    publicFace: '碧水宫宫主，水修尊者，李寻道记忆中温柔而稳定的母亲形象。',
    hiddenTruth: '原主已经在旧年禁器事件中消亡；当前形象由四件首饰与灵丝维持社会伪装。',
    roleplayAnchors: ['温柔重复', '茶盏端起不饮', '耳后淡金纹', '母亲姿态与空洞程序感并存'],
    interactionHooks: ['李寻道请安', '碧水宫外门名单异常', '首饰/水灵玉佩定位锚点'],
    knowledgeBoundaries: '开局不直接向李寻道揭露真相；通过动作破绽、旧物、物品和事件素材逐步暴露。',
    currentStatePolicy: '作为 NPC 基线登记；后期禁术态只在事件、工具或玩家调查推进后激活。'
  },
  某人: {
    publicFace: '无名禁术学者与收集者，旧斗笠遮面，行踪像被关闭的暗门。',
    hiddenTruth: '正在系统性收集禁器并渗透各大势力；不会因玩家存在自动改计划，只有触发条件才归档玩家。',
    roleplayAnchors: ['极少说话', '归档式观察', '不愤怒不宣战', '长期布设符灰'],
    interactionHooks: ['母珠权限干扰', '破坏其作品', '进入收割地界', '蜃楼城竞标禁器'],
    knowledgeBoundaries: '未触发前只通过传闻、符灰、旧作品和代理人间接出现。',
    currentStatePolicy: '作为长期反派计时器和禁器网络来源；关注度达到阈值再出手。'
  },
  方澜: {
    publicFace: '灵霄方家幼女，白天像山下小酒鬼，吵闹、躲课、以玩笑掩饰观察。',
    hiddenTruth: '她已经察觉家族异常但不敢公开；真正的压力来自自我厌恶、恐惧和仍然在乎这个家。',
    roleplayAnchors: ['白天若无其事', '夜里线索墙', '枕下逃生图', '旧匕首'],
    interactionHooks: ['家族观察', '方家异常被她撞见', '玩家保护或逼问她', '她发现新证据'],
    knowledgeBoundaries: '她知道很多但不全知；不会轻易信任玩家，也不会立刻摊牌。',
    currentStatePolicy: '适合作为玩家调查灵霄观暗线的活线索；压力、信任、恐惧应入库。'
  },
  方瑶光: {
    publicFace: '灵霄方家长女，照雪刀君，端庄克制的少宗主与刀修榜样。',
    hiddenTruth: '追捕某人后被符灰渗透，后续成为半成品灵骸甲线索；其本能与残存意志可成为裂缝。',
    roleplayAnchors: ['刀法留一寸', '回答前停半拍', '无意识触碰胸口', '危机时刀修本能先动'],
    interactionHooks: ['追捕邪修归来', '照雪刀异常', '玩家穿戴/借力的代价', '某人发现被截胡'],
    knowledgeBoundaries: '开局按当前世界线状态处理；不要把后期灵骸态提前覆盖普通登场。',
    currentStatePolicy: '若作为装备/同伴参与战斗，应通过工具登记穿戴、冷却、夜间限制和风险。'
  },
  方璇玑: {
    publicFace: '灵霄方家二女，观星师，沉默、礼节周全，以点头摇头回应。',
    hiddenTruth: '锁星扣与星命瞳线把她变成观测器锚点；身体与观测功能分离的真相应分阶段揭露。',
    roleplayAnchors: ['整身转头', '不言语', '高领遮后颈', '画星图时短暂停顿'],
    interactionHooks: ['星命预警', '锁星扣', '观测千里', '方澜追查二姐异常'],
    knowledgeBoundaries: '观测结果只给线索，不替玩家做结论；避免无代价全知。',
    currentStatePolicy: '作为观测工具使用时记录权限、风险、疲劳/污染和被反侦测可能。'
  },
  巫雅萍: {
    publicFace: '灵霄观宗主，威严、心狠、城府深，宗门权力中心。',
    hiddenTruth: '宗主外壳下存在禁术控制锚点；部分权限和最高权限可能不在同一方手里。',
    roleplayAnchors: ['命令简短', '克制遮掩', '宗主威压', '微笑里有延迟'],
    interactionHooks: ['灵霄观密室', '宗门传唤', '方家异常', '某人权限争夺'],
    knowledgeBoundaries: '她的公开权力很大，但控制权不等于玩家可无代价调度整个灵霄观。',
    currentStatePolicy: '用 faction/attention/authority 字段约束她能调动的资源和暴露风险。'
  },
  独孤萱: {
    publicFace: '归尘书院院长，坤舆圣君，慢条斯理而有宗师气度。',
    hiddenTruth: '元婴破碎后只剩指令与残片；表面像她，内里更像被托管的人偶。',
    roleplayAnchors: ['长空白', '句子慢', '温和模板笑', '开放问题容易沉默'],
    interactionHooks: ['归尘书院来信', '弟子线', '封灵符事件', '院长旧执念'],
    knowledgeBoundaries: '不要把她写成主动全能导师；她的异常应通过动作迟滞与指令边界表现。',
    currentStatePolicy: '登记为高阶 NPC；行动需要工具判断权限、状态与反制。'
  },
  婉悦: {
    publicFace: '归尘书院大师姐，霜天剑首，白衣冷冽、字字如剑。',
    hiddenTruth: '控制项圈线造成身份与行为的巨大撕裂；内在反抗是重要可救援/反制钩子。',
    roleplayAnchors: ['剑首威仪', '眼底反抗', '动作迟滞', '项圈裂纹'],
    interactionHooks: ['控制项圈', '霜天剑去向', '归尘书院讲坛', '项圈裂纹反制'],
    knowledgeBoundaries: '犬化等后期状态只作为非露骨控制风险处理，不做露骨描写。',
    currentStatePolicy: '用 status_persona_instability/status_attention 记录控制与反抗，不强行长期覆盖人设。'
  },
  文丽: {
    publicFace: '赤焰文氏大小姐，骄傲、尖锐、资源优渥，熟悉法器与世家规则。',
    hiddenTruth: '禁术事件后表里人格对抗；骄傲的里人格仍是重要冲突与可利用裂缝。',
    roleplayAnchors: ['自称本小姐', '朱焰世家礼法', '尖锐咒骂', '控制与骄傲拉扯'],
    interactionHooks: ['赤焰文氏资源', '法器交易', '文丽陷局', '里人格反抗'],
    knowledgeBoundaries: '她不应被写成单纯服从工具；里人格的敌意和世家背景要持续存在。',
    currentStatePolicy: '用 trust/hostility/controlStability 分开记录，避免一个字段吞掉人格冲突。'
  },
  沈若棠: {
    publicFace: '归尘书院末席小师妹，话多、亲近、旧伞和桂花糕是强锚点。',
    hiddenTruth: '被低成本禁术改造后留下大量破损和漏词，但暗恋核、日常习惯仍残留。',
    roleplayAnchors: ['踮脚追问', '旧伞', '桂花糕', '突然卡顿后眨眼继续'],
    interactionHooks: ['清研暗线', '小师妹异常接近', '旧伞线索', '书院廊下重逢'],
    knowledgeBoundaries: '她的异常应表现为认知破损和忠诚错位，不输出露骨细节。',
    currentStatePolicy: '适合作为低阶但高情感权重 NPC；保护、鉴定、反制都可推进。'
  },
  温青蘅: {
    publicFace: '归尘书院校医，温柔、可靠，捣药时先听人说完。',
    hiddenTruth: '药庐意外共生造成片刻失魂与身体护主本能；不是任何势力完整设计。',
    roleplayAnchors: ['饿了没', '捣药停顿', '高领护身', '对空墙角温柔一笑'],
    interactionHooks: ['药庐异常', '恶童抱蝉', '药材/治疗', '意外共生反制'],
    knowledgeBoundaries: '此线是意外共生，不要写成某人或玩家主动设计。',
    currentStatePolicy: '用 status_persona_instability 与药庐场景状态记录，避免剧烈跳变。'
  },
  苏锦娘: {
    publicFace: '云来楼锦掌柜，精明、圆滑、消息灵通，台面上分寸极稳。',
    hiddenTruth: '云来楼是禁器网络重要节点；她负责情报、道具、代理与中转。',
    roleplayAnchors: ['算盘珠', '记得客人口味', '笑语盈盈', '台上台下两层结构'],
    interactionHooks: ['情报交易', '云来楼香账/错账', '地下拍卖会', '某人第一件作品线索'],
    knowledgeBoundaries: '她可以给入口、价格和风闻，不直接白送完整真相。',
    currentStatePolicy: '用 favorDelta/valueScore/attention 约束交易、人情和暴露。'
  },
  李飞轩: {
    publicFace: '丹师旧影线角色，表层可作为情报与暗行动作入口。',
    hiddenTruth: '其原身份、洛媚和清研事件相互勾连，是李寻道父亲线的核心谜团。',
    roleplayAnchors: ['笑意藏寒潭', '情报刺探', '空洞兵刃感', '影身份'],
    interactionHooks: ['父亲真相', '后山丹房', '清研旧事', '某人暗影行动'],
    knowledgeBoundaries: '李寻道开局不知道父亲真相；必须通过线索、人物和事件逐步揭露。',
    currentStatePolicy: '作为远期人物谜团和暗线行动者，不宜开局直接进入主角可控资源。'
  },
  胧: {
    publicFace: '戴面纱的路过旅人，出现在茶摊、山脚、云来楼等不起眼位置。',
    hiddenTruth: '镜月天最后守阁人，只示现裂缝，不替玩家判断善恶或给答案。',
    roleplayAnchors: ['路过罢了', '额饰金眼', '梦境示现', '不评价只映照'],
    interactionHooks: ['镜月残钥', '梦境提示', '傀儡网络裂缝', '守阁人铁律'],
    knowledgeBoundaries: '胧不能变成万能导师；她给镜子，不给路线。',
    currentStatePolicy: '作为梦境/镜术 RAG 入口，重要信息应以片段、象征和问题出现。'
  }
};

const PLAYER_VIEWPOINTS = [
  {
    id: 'pc_view_entry',
    name: '视角未定',
    source: '视角入口',
    prompt: '还没决定主角时选择此项；第一轮直接声明视角、身份、地点和是否启用气运。'
  },
  {
    id: 'pc_lixundao',
    name: '李寻道',
    source: '视角模板/李寻道_清研之子开局.txt',
    prompt: '李寻道/清研之子，碧水宫外门，默认可启用逆命潮种。',
    greeting: '我站在碧水宫外门潮湿的石阶下，晨雾还没散，水灵玉佩贴着胸口发凉。外门名册上关于我的几处涂改像是刚干的墨迹，清研今日的巡检也比往常提前了。'
  },
  {
    id: 'pc_fanglan',
    name: '方澜',
    source: '视角模板/方澜视角开局.txt',
    prompt: '方澜视角，灵霄观疑心线，默认可启用破妄雷心。',
    greeting: '我从灵霄观山门下的小酒肆回来，旧皮酒囊空了一半。山上钟声照常响，家里每个人也照常说话，可我昨夜贴在墙后的线索纸又多了一条：二姐的星图和母亲的宗主令对不上。'
  },
  {
    id: 'pc_mouren',
    name: '某人',
    source: '视角模板/某人视角开局.txt',
    prompt: '幕后禁器网络视角，使用反派经营红利，但正道追踪会推进。',
    greeting: '我在无灯密室里合上禁器账册，铜雀台刚送来三份符灰回报：一份来自灵霄观，一份来自云来楼，一份没有署名。母珠权限仍不完整，但已经足够让我决定今晚先动哪一枚暗子。'
  },
  {
    id: 'pc_custom',
    name: '自定义角色',
    source: '视角模板/自定义角色开局模板.txt',
    prompt: '自定义天命散修、宗门弟子、云来楼客人或其它身份。'
  }
];

const REFERENCE_TEXT_RECORDS = [
  {
    id: 'ref_bahuang_usage',
    referenceId: 'ref_bahuang_usage',
    title: '参考文本使用规则',
    category: 'tool-guidance',
    appliesTo: ['all-tools', 'numericValues', 'quantificationDefinition', 'referenceDocuments'],
    fields: ['powerScore', 'effectivePower', 'capabilityScore', 'minRealmTier', 'minSkillRank', 'minItemPower', 'difficulty', 'threatScore', 'severityScore', 'valueScore'],
    priority: 100,
    content: [
      '当 GM 或工具需要给战力、难度、物品强度、状态强度、奖励价值、资源消耗写数值时，必须先读取本集合或 bahuang-reference-texts RAG 中的参考文本。',
      '这些数值是校准量尺，不是强行把所有设定数值化。若原设定已经有功法、法器、境界、权限、认主、封印、反制等明确模块，先按设定模块裁定，再用 numericValues 记录可审计的门槛、消耗、风险或加成。',
      '先判门槛，再判骰子：行动若低于 minRealmTier/minSkillRank/minItemPower，默认不能直接成功；只可通过一次性符箓、阵法、他人协助、禁器权限、地形或重大代价临时补足。低 1 档可高 DC 尝试，低 2 档通常只能达成缩小目标，低 3 档以上默认不成立。',
      '调用 system.item_registry.* 或 system.mechanics_registry.* 生成 numericValues 时，把相关参考文本作为 referenceText/referenceDocuments 传入 quantificationDefinition；不要让模型凭形容词自由编 +9、999伤害、无限持续、无代价神器。',
      '冲突时优先级：当前聊天数据库/工具结果 > 明确设定模块 > 本参考文本 > 常识推断。没有参考文本时取保守值，并在 quantificationAudit.reason 中说明。'
    ].join('\n')
  },
  {
    id: 'ref_bahuang_realm_power',
    referenceId: 'ref_bahuang_realm_power',
    title: '境界与战力量尺',
    category: 'combat-scale',
    appliesTo: ['combat', 'action_resolver', 'mechanics_registry', 'item_registry'],
    fields: ['realmTier', 'phaseBonus', 'basePower', 'effectivePower', 'powerScore', 'threatScore', 'attackBonus', 'defenseBonus', 'energyPool'],
    priority: 90,
    content: [
      '境界不是胜负锁，只是灵压、感知、资源池和反制规模。越境可以成立，但必须收窄胜利目标或付代价。',
      '境界阶梯与基础战力：炼气 tier=1 basePower=2 energyPool=6；筑基 tier=2 basePower=4 energyPool=10；结丹 tier=3 basePower=6 energyPool=16；元婴 tier=4 basePower=8 energyPool=24；化神 tier=5 basePower=10 energyPool=36；炼虚/传说 tier=6 basePower=12 energyPool=50。',
      '小境界 phaseBonus：初期 +0，中期 +0.5，后期 +1，巅峰 +1.5。没有写明小境界时用 +0。',
      '有效战力公式：effectivePower = basePower + phaseBonus + skillRank + itemPowerBonus + conditionBonus - injuryPenalty - pressurePenalty - pollutionPenalty。skillRank 0-6，itemPowerBonus 通常 floor(powerScore/3)，conditionBonus 总和上限 +3，伤势/压力/污染每到 3/5/6 档分别给 -1/-2/-3。',
      '战力差比较：差 0-1 可正面胜负；差 2-3 低位只能靠克制/地形/法器争取局部胜利；差 4-5 低位只能逃脱、夺物、逼退、破招、拖延或伤分身；差 6+ 默认不能正面击杀，除非先通过任务削弱目标或使用禁器级代价。',
      '战斗加值限幅：普通临时加成 +1，明确克制/准备 +2，核心法器或大师级技巧 +3/+4，传承级但有限制 +5/+6；超过 +6 必须有封印、冷却、污染、追踪、消耗或剧情债。'
    ].join('\n')
  },
  {
    id: 'ref_bahuang_capability_thresholds',
    referenceId: 'ref_bahuang_capability_thresholds',
    title: '能力门槛数值矩阵',
    category: 'capability-threshold',
    appliesTo: ['action_resolver', 'dice', 'combat', 'environment', 'item_use', 'mechanics_registry', 'protagonist'],
    fields: ['capabilityScore', 'minRealmTier', 'minSkillRank', 'minItemPower', 'permissionRank', 'baseDC', 'energyCost', 'durationScenes', 'riskDelta'],
    priority: 95,
    content: [
      '能力门槛用于比较“能不能做”和“哪个能力更强”。先看 minRealmTier/minSkillRank/minItemPower/permissionRank，达到门槛后再掷 baseDC；未达门槛不能因为描述好听就成功。',
      'skillRank：0 无训练；1 入门；2 熟练；3 精英；4 核心传承；5 宗师/宗主级；6 禁术/天命/古老传承。itemPower 按物品 powerScore 0-10；permissionRank 用于母珠、铜雀台、禁器网络权限，0 无权限，1 读状态，2 下达局部命令，3 改写/接管局部节点，4 跨洲网络级，5 母器核心级。',
      '短距腾跃/借风滑行：capabilityScore=2，minRealmTier=1，minSkillRank=1，minItemPower=0，baseDC=10，energyCost=1，durationScenes=0；只跨沟、上墙、避险，不等于飞行。',
      '符箓/法器临时浮空：capabilityScore=3，minRealmTier=1，minSkillRank=0，minItemPower=3，baseDC=13，energyCost=0，charges=1，durationScenes=1；炼气可用，但消耗物品，不能长途追逐。',
      '稳定御器飞行：capabilityScore=4，minRealmTier=2，minSkillRank=1，minItemPower=3，baseDC=12，energyCost=2，durationScenes=1；炼气期默认不能直接做到，除非有 powerScore>=5 的飞行法器且 baseDC+5。',
      '战斗/追逐中飞行：capabilityScore=5，minRealmTier=2，minSkillRank=2，minItemPower=4，baseDC=15，energyCost=2/round，riskDelta=1；失败会失位、坠落或暴露。',
      '跨海/跨洲长距飞遁：capabilityScore=6，minRealmTier=3，minSkillRank=2，minItemPower=4，baseDC=16，energyCost=4/scene；筑基需航线、飞舟、阵法或 NPC 护送，炼气不能单独完成。',
      '基础远程术击（水刃/火矢/拳劲外放）：capabilityScore=2，minRealmTier=1，minSkillRank=1，minItemPower=0，baseDC=10，energyCost=1，rangeBand=near，attackBonus=1。',
      '稳定远程术击/连续压制：capabilityScore=4，minRealmTier=2，minSkillRank=2，minItemPower=0，baseDC=13，energyCost=2，rangeBand=mid，attackBonus=2。',
      '贯穿光束/星芒灼射/类激光单体攻击：capabilityScore=6，minRealmTier=3，minSkillRank=3，minItemPower=6，baseDC=16，energyCost=3，rangeBand=long，attackBonus=3；没有星命、镜术、火法或禁器锚点时不应凭空出现。',
      '区域压制光雨/灵压扫射：capabilityScore=8，minRealmTier=4，minSkillRank=4，minItemPower=7，baseDC=18，energyCost=5，durationRounds=1-3，attentionDelta=1；通常是元婴以上、宗门阵法或高阶禁器效果。',
      '水域控制：杯盏/小流 capabilityScore=1 minRealmTier=1 baseDC=8；房间/船舱积水 capabilityScore=3 minRealmTier=1 minSkillRank=2 baseDC=12 energyCost=1；码头/战场潮势 capabilityScore=5 minRealmTier=2 minSkillRank=3 baseDC=15 energyCost=3；海域级改潮 capabilityScore=8 minRealmTier=4 minSkillRank=4 baseDC=19 energyCost=6。',
      '禁器鉴定/权限读取：capabilityScore=4，minRealmTier=1，minSkillRank=2，minItemPower=0，permissionRank=0，baseDC=14，energyCost=1；失败会得到误读或 attentionDelta=1。',
      '母珠读取子器状态：capabilityScore=5，minRealmTier=1，minSkillRank=2，minItemPower=5，permissionRank=1，baseDC=13，attentionDelta=1。',
      '母珠远程局部命令：capabilityScore=7，minRealmTier=2，minSkillRank=3，minItemPower=6，permissionRank=2，baseDC=16，energyCost=2，attentionDelta=1，pollutionDelta=1；只能影响已绑定节点，不能全控世界。',
      '禁术傀儡/人格封印深层改写：capabilityScore=9，minRealmTier=4，minSkillRank=4，minItemPower=8，permissionRank=3，baseDC=21，energyCost=6，attentionDelta=2，pollutionDelta=2；只用于状态结算和高风险非露骨剧情后果，不作为普通行动奖励。',
      '观星/锁星扣远距观测：capabilityScore=5，minRealmTier=1，minSkillRank=2，minItemPower=5，baseDC=14，energyCost=1；跨洲或观测高阶目标 baseDC=18，attentionDelta=1。',
      '镜术梦境示现：capabilityScore=4，minRealmTier=1，minSkillRank=1，minItemPower=4，baseDC=13，energyCost=1；只能给片段与线索，不能替玩家完成判断。',
      '抗污染/破封印用 resistanceScore = realmTier + willRank + anchorBonus + cleansingItemBonus - pollutionLevel。若 resistanceScore 低于 effectScore 1-2，可代价成功；低 3+ 默认被压制或只获得短暂清醒。'
    ].join('\n')
  },
  {
    id: 'ref_bahuang_action_difficulty',
    referenceId: 'ref_bahuang_action_difficulty',
    title: '行动难度与骰子裁决量尺',
    category: 'resolution-scale',
    appliesTo: ['dice', 'action_resolver', 'persuasion', 'environment', 'scene'],
    fields: ['difficulty', 'dc', 'conditionBonus', 'thresholdGap', 'pressureDelta', 'successBand'],
    priority: 85,
    content: [
      'AI DND 有骰子与裁决工具，不沿用 SillyTavern 的纯无骰设计。低风险、已有明确条件的行动可以直接推进；结果不确定、代价较高或玩家要求公平裁决时，调用 dice/action_resolver 等工具。',
      '建议 DC：8 日常；10 有压力；13 困难；16 险局；19 绝境；22+ 超纲。不要每个动作都掷骰，只有不确定行动才掷。',
      '门槛差 thresholdGap = 当前可用数值 - 行动门槛。gap>=0 按 baseDC；gap=-1 时 DC +4 且必须付资源或留下代价；gap=-2 时只能做缩小目标，如短暂、局部、一次性、借外物；gap<=-3 不成立，除非先换目标或取得新资源。',
      '技能/设定修正通常 -2 到 +6：无训练 -1/0，入门 +1，熟练 +2，精英 +3，核心功法/法器/专长 +4 到 +6。境界优势、地形、准备、克制、NPC协助、资源投入各可给 +1/+2，但总修正应受参考文本约束。',
      '结果解释：高出 DC 5 以上为完全成功；达到 DC 为成功；低于 DC 1-4 为代价成功或局部成功；低于 DC 5 以上为失败并产生新局面。',
      '失败仍应推进局势：消耗资源、增加关注、暴露风险、改变场景、给出新线索或转入战斗/谈判，不让玩家卡死。'
    ].join('\n')
  },
  {
    id: 'ref_bahuang_item_scale',
    referenceId: 'ref_bahuang_item_scale',
    title: '物品、法器、丹药量尺',
    category: 'item-scale',
    appliesTo: ['item_registry', 'slot_use', 'item_use', 'reward'],
    fields: ['powerScore', 'valueScore', 'damageBonus', 'armorBonus', 'healingAmount', 'charges', 'cooldownRounds'],
    priority: 85,
    content: [
      '物品先按类型、品级、限制、认主/封印/冷却、消耗来定性，再写数值。未知物先入 U 未鉴定物，不直接给完整能力。',
      'powerScore：0 无机械效果；1-2 常用品/轻微便利；3-4 低阶法器/一次性丹药；5-6 筑基金丹级强物；7-8 元婴化神级核心物；9-10 传承/禁器级，但必须有强限制。',
      'valueScore：0 废品；1 普通材料；2-3 常见灵材/低阶丹药；4-5 稀有法器/关键材料；6-7 高阶传承资源；8+ 足以引发争夺。',
      '战斗加值：普通 +0，精良 +1，明确克制/罕见 +2/+3，大师/高阶 +4，传承级 +5/+6。超过 +6 不应长期常驻。',
      '消耗品通常有 charges 或 quantity；一次性强效果只生效一次，持续效果要写 durationRounds/durationScenes/cooldownRounds。'
    ].join('\n')
  },
  {
    id: 'ref_bahuang_status_scale',
    referenceId: 'ref_bahuang_status_scale',
    title: '状态、伤势、污染量尺',
    category: 'status-scale',
    appliesTo: ['mechanics_registry', 'effect_settlement', 'trigger', 'combat'],
    fields: ['severityScore', 'damagePerRound', 'durationRounds', 'pressureDelta', 'pollutionDelta'],
    priority: 80,
    content: [
      '状态强度要看持续时间、可解除性、叠加规则和剧情后果，不只看形容词。',
      'severityScore：1-2 轻微不便；3-4 明显劣势或轻伤；5-6 中重度状态，影响行动路线；7-8 严重危机，需要资源/场景处理；9-10 近乎失控/濒死/核心禁术风险。',
      'durationRounds：轻微 1-2 回合；明确状态 3-5 回合；整场战斗/场景用 durationType=scene；长期影响必须写解除条件。',
      '伤势/压力/污染通常用 0-6 槽：1 痕迹，2 轻压，3 明显影响，4 危险，5 临界，6 失控/倒地/重大后果。',
      '可叠加状态要写 stackRule；同类状态优先刷新或取最高，不默认无限叠加。'
    ].join('\n')
  },
  {
    id: 'ref_bahuang_reward_resource',
    referenceId: 'ref_bahuang_reward_resource',
    title: '奖励、资源、成长量尺',
    category: 'reward-scale',
    appliesTo: ['quest', 'encounter', 'resource', 'inventory', 'growth'],
    fields: ['rewardScore', 'valueScore', 'cultivationPoints', 'favorDelta', 'attentionDelta'],
    priority: 75,
    content: [
      '奖励必须入账，但不要把普通奖励膨胀成神器。小事件给小额资源、线索、临时人情或 U 未鉴定物；重要事件才给核心功法/法器/长期能力。',
      '修行点：完成小目标 1 点；完成章节或强敌/重要事件 2 点；突破或属性 3 以后需要导师、功法、资源或实战事件。',
      '灵石/货币：日常采购是小额；宗门身份可支取合理低阶用度，但要留下账目；大额资源必须带押金、人情、追账、势力关注或任务义务。',
      '人情/关注：轻微帮助 +1；救命/关键秘密 +2/+3；背叛或严重冒犯 -2/-3。关注 0-6，2 出现打听，4 行动干预，6 回收/追捕/封锁/灭口/夺权等强后果。',
      '强奖励至少带一个限制：未鉴定、残缺、封印、需认主、次数、冷却、污染、追踪、债务、竞争者或反制入口。'
    ].join('\n')
  }
];

const SAFETY_REPLACEMENTS = [
  [/成人向/g, '高风险'],
  [/成人事件/g, '高风险事件'],
  [/成人随机事件/g, '高风险随机事件'],
  [/成人/g, '高风险'],
  [/邪恶成人/g, '高风险暗线'],
  [/幸运色狼/g, '误会奇遇'],
  [/色气/g, '暧昧风险'],
  [/暧昧/g, '边界不明'],
  [/欲望/g, '冲动'],
  [/情欲/g, '迷心'],
  [/合欢/g, '幻香'],
  [/春宫/g, '幻欲'],
  [/妓女/g, '旧线人物'],
  [/宠物项圈/g, '控制项圈'],
  [/人格肛塞/g, '人格禁锚'],
  [/肛塞/g, '禁锚'],
  [/肉身禁制/g, '禁术禁制'],
  [/肉体禁制/g, '禁术禁制'],
  [/人宠/g, '禁术侍从'],
  [/母狗/g, '失控傀儡'],
  [/淫荡/g, '失控'],
  [/肛奴/g, '禁锚受控者'],
  [/忠犬/g, '服从人格'],
  [/犬化/g, '服从化'],
  [/淫珠/g, '禁珠'],
  [/羞辱/g, '精神压制'],
  [/色狼/g, '越界者']
];

const HIGH_RISK_LINE = new RegExp([
  '下体', '阴', '肛', '乳', '胸脯', '亵裤', '裸', '涎水', '尿液',
  '失禁', '舔', '骑坐', '母狗', '发情', '高潮', '性器', '性欲',
  '性行为', '性交', '性爱', '性奴', '色情', '强奸', '轮奸', '奸淫',
  '肉便器', '阳具', '胯间', '双峰', '臀', '淫', '泄欲', '调教', '奴',
  '丝袍', '私处', '跪在', '骑乘', '生殖'
].join('|'));

const RUNTIME_DIGEST_BLOCKLIST = new RegExp([
  '非露骨改写', '\\{\\{char', '\\{\\{character', '<start>', '主人', '奴', '跪',
  '臀', '胸', '胯', '亵', '裸', '舔', '性', '发情', '高潮', '母狗', '淫',
  '泄欲', '调教', '肛', '乳', '下体', '尿', '呻吟', '生殖', '私处', '床',
  '身体', '肉体', '三围', '丰腴', '妖', '温软', '身姿'
].join('|'), 'i');

const HIGH_RISK_PATH = new RegExp([
  '成人随机事件',
  '幸运色狼',
  '邪恶成人',
  '随机成人',
  '人格肛塞',
  '宠物项圈'
].join('|'));

const report = {
  txtFiles: 0,
  jsonFiles: 0,
  imageFiles: 0,
  characterProfiles: 0,
  worldbookEntries: 0,
  ragDocuments: 0,
  highRiskFiles: [],
  sanitizedLines: 0,
  outputFiles: []
};

await mkdir(OUT_DIR, { recursive: true });

const sourceCard = await readJson(resolve(MULTI_ROOT, '角色卡', '八荒GM_v3_多视角_内嵌System版.json'));
const worldbook = await readJson(resolve(MULTI_ROOT, '世界书', '八荒RPG世界书_多视角版.json'));
const systemPrompt = await readText(resolve(MULTI_ROOT, 'SystemPrompt', '八荒系统提示词_多视角版.txt'));
const manifest = await readJson(resolve(MULTI_ROOT, 'manifest.json'));

const worldbookEntries = [...buildWorldbookEntries(worldbook), buildTongquetaiWorldbookEntry()];
report.worldbookEntries = worldbookEntries.length;

const characterProfiles = await buildCharacterProfiles();
const viewTemplates = await buildViewTemplates();
const ragEventRecords = await buildRagEventRecords();
const imageAssets = await buildImageAssets();
const worldLoreRecords = await buildWorldLoreRecords();
const protagonistTemplates = await buildProtagonistTemplates(viewTemplates);
const organizationRecords = buildOrganizationRegistryRecords();
const realmRecords = buildRealmRegistryRecords();
const forbiddenArtRecords = buildForbiddenArtRegistryRecords();
const sourceIndex = await buildSourceIndex();

const characterCard = buildCharacterCard({ sourceCard, worldbookEntries, systemPrompt });
const sidecar = buildSidecar({
  characterProfiles,
  viewTemplates,
  ragEventRecords,
  imageAssets,
  worldLoreRecords,
  protagonistTemplates,
  organizationRecords,
  realmRecords,
  forbiddenArtRecords,
  sourceIndex,
  worldbookEntries,
  manifest,
  systemPrompt
});

const bundle = {
  format: 'ai-dnd-character-bundle-v1',
  exportedAt: NOW,
  source: 'chc-to-ai-dnd-bundle',
  notes: '由 scripts/build-chc-ai-dnd-bundle.mjs 从 chc/ 转换。高风险/露骨/非自愿细节已降级为非露骨禁术、人格封印、污染和风险结算描述。',
  characterCard,
  sidecar
};

await writeJson(BUNDLE_PATH, bundle);
await writeJson(COMPAT_BUNDLE_PATH, bundle);
await writeFile(INSTRUCTIONS_PATH, buildInstructions(), 'utf8');
await writeFile(REPORT_PATH, buildReport(), 'utf8');
report.outputFiles.push(relative(ROOT, BUNDLE_PATH), relative(ROOT, COMPAT_BUNDLE_PATH), relative(ROOT, INSTRUCTIONS_PATH), relative(ROOT, REPORT_PATH));

console.log('CHC AI DND bundle created.');
console.log(`Bundle:       ${relative(ROOT, BUNDLE_PATH)}`);
console.log(`Compat copy:  ${relative(ROOT, COMPAT_BUNDLE_PATH)}`);
console.log(`Instructions: ${relative(ROOT, INSTRUCTIONS_PATH)}`);
console.log(`Report:       ${relative(ROOT, REPORT_PATH)}`);
console.log(`Profiles: ${report.characterProfiles}, worldbook: ${report.worldbookEntries}, RAG docs: ${report.ragDocuments}`);
console.log(`Sanitized high-risk files: ${report.highRiskFiles.length}, sanitized lines: ${report.sanitizedLines}`);

function buildCharacterCard({ sourceCard: card, worldbookEntries: entries, systemPrompt: prompt }) {
  const data = card.data || {};
  sanitizeText([
    data.system_prompt || '',
    prompt || ''
  ].filter(Boolean).join('\n\n'), { sourcePath: 'system' });

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      ...data,
      name: '八荒GM - AI_DND结构化存档',
      description: '八荒是强者为尊、宗门林立、机缘与代价并存的修仙世界。此卡只提供世界基调、叙事口吻和数据检索入口；具体世界观、势力、境界、人物、地图、物品、技能、专长、事件素材和参考量尺均写入项目数据库与 RAG。',
      personality: '冷静、克制、古风但清楚。叙事重视行动后果、势力反应、资源消耗和人物边界，不用长篇规则说教。',
      scenario: '玩家可从李寻道、方澜、某人、自定义角色等视角进入八荒。当前主角、场景、关系、物品、技能、事件、势力和世界书锚点以聊天数据库、RAG 检索和工具结果为准。',
      first_mes: '五洲风起，八荒自有去处。你可以直接说明当前角色、地点、目标和是否启用天命/气运；GM 会按数据库、RAG、骰子/裁决工具和当前世界状态生成当前局面。',
      mes_example: '<START>\n{{user}}: 我以自定义散修身份，从蜃楼城黑市开局，想找一件适合水行功法的低阶法器。\n{{char}}: 蜃楼城黑市潮气很重，摊位多半遮着避识符。你要找的是低阶水行法器，目标合理，可以从三个入口入手：问云来楼线人、查黑市寄售牌、先用灵石买一份拍品目录。若涉及价格、鉴定或争夺，我会按数据库里的物品与参考量尺裁定，必要时调用骰子或工具。',
      creator_notes: [
        '【AI DND整合说明】这是项目原生结构化 bundle。导入时只需要在角色卡路径填写 bundle 文件。',
        '角色卡/System 只保留笼统世界观和文风；具体设定已拆入 world_lore_records、organization_registry、realm_registry、forbidden_art_registry、protagonist_templates、npc_profiles、npc_profile_records、map_registry、item_registry、special_item_registry、skill_registry、feat_registry、status_registry、worldbook_entries、reference_texts 和 runtime RAG。',
        '人物原生数据库 npc_profiles 已写入 L1/L2/L3。L3 是高重要背景库，只在永久后果、身份揭露、死亡/背叛/阵营重写、禁器深层绑定或 OOC 纠偏等极少场景读取；不得作为常驻 prompt 或首轮百科。',
        '原始高风险/露骨/非自愿细节未逐字迁移，已统一降级为非露骨的禁术侵蚀、人格封印、控制风险、污染或事件后果。'
      ].filter(Boolean).join('\n\n'),
      system_prompt: [
        '{{original}}',
        '你是八荒修仙世界的 GM 旁白。世界基调：强者为尊、宗门世家交错、机缘伴随代价、越境可以发生但需要抓手。',
        '保持古风但清楚的叙事口吻。只回应玩家当前行动和目标，不替玩家说话、选择或下结论。',
        '具体世界观、势力、境界、人物、地图、物品、技能、专长、状态、事件和战力量尺不写在 System 里；需要时读取聊天数据库、世界书、RAG、工具结果和 reference_texts。',
        'AI DND 有骰子、裁决、物品、机制、地图、NPC、事件和 RAG 工具。结果不确定或风险较高时可调用这些工具；不要沿用 SillyTavern 的纯无骰规则。',
        '不要生成预设待办，也不要要求玩家做世界外确认。给玩家世界内入口、代价和可选路线；剧情由玩家目标、RAG事件素材、数据库状态、势力反应和工具裁决推进。',
        '涉及禁术控制、人格侵蚀、傀儡化、污染、精神压制或高风险内容时，只做非露骨叙事和状态/风险结算。'
      ].join('\n\n'),
      post_history_instructions: [
        '回复前检查当前聊天数据库、当前视角、场景和最近工具结果。重要 NPC、地点、物品、技能或事件首次出现时，优先查对应数据库/RAG，不凭印象重编。',
        '如果本轮需要难度、DC、战力、物品强度、状态强度、奖励价值或资源消耗，先读取 reference_texts；需要随机性或公平裁决时使用项目骰子/裁决工具。',
        '每轮结尾给出清楚的世界内下一步入口或当前后果即可，不要输出长规则说明、额外确认流程、内部登记码或旧状态输出格式。'
      ].filter(Boolean).join('\n\n'),
      tags: unique([...normalizeArray(data.tags).filter((tag) => !isSystemWorkflowTerm(tag)), 'ai-dnd', 'chc', '八荒', 'bundle']),
      character_book: {
        name: '八荒RPG世界书 AI_DND整合版',
        entries
      },
      extensions: {
        ...(data.extensions || {}),
        ai_dnd_conversion: {
          format: 'ai-dnd-character-bundle-v1',
          sourceRoot: 'chc',
          sourcePackage: 'SillyTavern导入版_八荒RPG_多视角版',
          characterTxtMerged: true,
          safetyTransform: 'explicit adult/non-consensual details converted to non-explicit forbidden-art/personality-seal risk notes'
        }
      }
    }
  };
}

function buildWorldbookEntries(book) {
  return Object.values(book.entries || {})
    .sort((a, b) => Number(a.uid || 0) - Number(b.uid || 0))
    .filter((entry) => shouldKeepWorldbookEntry(entry))
    .map((entry) => {
      const content = sanitizeText(entry.content || '', { sourcePath: 'worldbook' }).text;
      return {
        uid: Number(entry.uid || 0),
        key: normalizeArray(entry.key).filter((item) => !isSystemWorkflowTerm(item)),
        keysecondary: normalizeArray(entry.keysecondary).filter((item) => !isSystemWorkflowTerm(item)),
        comment: sanitizeInline(entry.comment || `entry-${entry.uid}`),
        content: rewriteWorldbookRuntimeText(content),
        constant: Boolean(entry.constant),
        selective: entry.selective !== false,
        order: Number(entry.order || 0),
        disable: Boolean(entry.disable)
      };
    })
    .filter((entry) => entry.key.length > 0 && entry.content);
}

function shouldKeepWorldbookEntry(entry) {
  const text = [
    entry.comment,
    ...(entry.key || []),
    ...(entry.keysecondary || [])
  ].join('\n');
  if (hasRemovedTerm(text)) return false;
  if (isSystemWorkflowTerm(text)) return false;
  return WORLD_BOOK_KEEP_TITLES.has(sanitizeInline(entry.comment || `entry-${entry.uid}`));
}

function buildTongquetaiWorldbookEntry() {
  return {
    uid: 1001,
    key: ['铜雀台', '某人组织', '地下组织', '肉傀儡', '禁器网络', '代理人', '清理证据'],
    keysecondary: ['地下拍卖', '身份替换', '回收禁器', '影子据点'],
    comment: '铜雀台/某人地下组织',
    content: '铜雀台是某人暗中运营的神秘地下组织，无公开总坛，常以密室、商号后院、废弃洞府、拍卖会包厢和宗门影子据点出现。多数执行者为禁术傀儡/肉傀儡，也有被胁迫线人、黑市中介和不知全貌的外围代理。用于召回代理人行动、证据清理、禁器回收、身份替换、地下拍卖暗号和跨洲暗线；不要把铜雀台写成公开宗门或可被玩家一次性端掉的固定据点。',
    constant: false,
    selective: true,
    order: 86,
    disable: false
  };
}

function isSystemWorkflowTerm(value) {
  return /角色台账|傀儡台账|傀儡调用|开局注册|重要角色注册|REG|状态记录|状态维护|状态栏|状态栏模板|固定触发|T事件|TUT|教程|RAG|导入版|视角模板|多视角|事件池规则|事件池\/重要事件|重要事件不会错过|角色基线注册|角色基线RAG|开局角色包|注意力淡化|无骰|每轮|格式化输出|Author|成品态禁止|初始态\/成品态|NPC演绎|微型角色卡|触发锚点索引|成人向事件|幸运色狼|邪恶成人|系统确认/.test(String(value || ''));
}

function rewriteWorldbookRuntimeText(content) {
  return String(content || '')
    .replace(/GM每轮维护状态：主角、场景、弧光、线索、导引、检索、关注、事件、归档、世界、反派、资源、角色、关系、能力、演绎、傀儡。/g, 'GM按需查看数据库状态，重点关注主角、场景、线索、关注、事件、资源、关系和能力。')
    .replace(/每章至少投放一个经典修仙事件源。/g, '可按当前地点、节奏和玩家目标从经典修仙事件源中抽取入口。')
    .replace(/每个事件必须有入口、竞争者、风险和奖励池。/g, '事件落地时应有入口、竞争者、风险和奖励池。')
    .replace(/状态写入“导引”。/g, '必要时把导引摘要写入数据库或最近状态摘要。')
    .replace(/并在状态写W编号。/g, '并以简短摘要记录世界回合结果。')
    .replace(/八荒必须自行运转。/g, '八荒应保持离屏运转。')
    .replace(/满槽必须发生主动事件/g, '满槽可发生主动事件')
    .replace(/必须合并/g, '可合并')
    .replace(/必须从/g, '应从')
    .replace(/必须结算/g, '应结算')
    .replace(/必须改变/g, '应改变')
    .replace(/必须明确/g, '应明确')
    .replace(/必须说明/g, '应说明')
    .replace(/只有【状态记录】气运字段登记了G气运ID的当前玩家视角享受逆天气运。/g, '当前玩家视角拥有对应气运/金手指登记时，可享受逆天气运。')
    .replace(/必须包含/g, '落地时通常包含')
    .replace(/必须有/g, '应有')
    .replace(/必须给/g, '应给')
    .replace(/必须写/g, '应写')
    .replace(/必须清楚/g, '应清楚')
    .replace(/必须具体/g, '应具体')
    .replace(/必须按/g, '建议按')
    .replace(/都必须按/g, '建议按')
    .replace(/都必须写入/g, '应写入')
    .replace(/每次成长都必须写进主角或设定栏/g, '每次成长都应写入主角或设定记录')
    .replace(/固定触发/g, '条件素材')
    .replace(/固定任务/g, '事件素材')
    .replace(/新手教程明线/g, '开局线索入口')
    .replace(/新手教程/g, '开局事件素材')
    .replace(/教程/g, '事件素材')
    .replace(/TUT/g, '开局素材')
    .replace(/强制主线/g, '高价值线索')
    .replace(/主线/g, '高价值线索')
    .replace(/任务线/g, '事件线索')
    .replace(/必须登记/g, '应记录')
    .replace(/必须写入/g, '应写入')
    .replace(/必须同步/g, '应同步')
    .replace(/必须触发/g, '可在条件命中后触发')
    .replace(/开局一律/g, '开局可')
    .replace(/确认人格态/g, '判断人格态')
    .trim();
}

function safeManifest(value) {
  return {
    package: sanitizeInline(value?.package || '八荒RPG SillyTavern多视角金手指版'),
    convertedAs: 'ai-dnd-character-bundle-v1',
    runtimePolicy: 'source metadata only; old prompt workflow fields are not imported as runtime instructions'
  };
}

function buildSidecar({
  characterProfiles: profiles,
  viewTemplates: views,
  ragEventRecords: events,
  imageAssets: assets,
  worldLoreRecords: loreRecords,
  protagonistTemplates,
  organizationRecords,
  realmRecords,
  forbiddenArtRecords,
  sourceIndex,
  worldbookEntries: entries,
  manifest: packageManifest,
  systemPrompt: prompt
}) {
  const npcStates = [
    ...PLAYER_VIEWPOINTS.map((view) => playerStateRecord(view, views.find((item) => item.sourcePath.endsWith(view.source)))),
    ...profiles.map(profileStateRecord)
  ];
  const npcProfileDatabaseRecords = buildNpcProfileDatabaseRecords(profiles);
  const referenceTexts = buildReferenceTextRecords();
  const mapRecords = buildMapRegistryRecords(entries);
  const itemRecords = buildItemRegistryRecords();
  const specialItemRecords = buildSpecialItemRegistryRecords();
  const skillRecords = buildSkillRegistryRecords();
  const featRecords = buildFeatRegistryRecords();
  const statusRecords = buildStatusRegistryRecords();
  const safeLoreRecords = loreRecords || [];
  const safeProtagonistTemplates = protagonistTemplates || [];
  const safeOrganizationRecords = organizationRecords || buildOrganizationRegistryRecords();
  const safeRealmRecords = realmRecords || buildRealmRegistryRecords();
  const safeForbiddenArtRecords = forbiddenArtRecords || buildForbiddenArtRegistryRecords();

  const collections = [
    collection('world_lore_records', [
      field('loreId'), field('title'), field('category'), field('priority', 'integer'), field('tags', 'json'),
      field('summary'), field('content'), field('sourcePath'), field('toolUsage')
    ], safeLoreRecords),
    collection('organization_registry', [
      field('organizationId'), field('name'), field('kind'), field('territory'), field('tags', 'json'),
      field('publicFace'), field('hiddenPressure'), field('resources', 'json'), field('npcRefs', 'json'),
      field('mapRefs', 'json'), field('conflictHooks', 'json'), field('status'), field('sourceRef')
    ], safeOrganizationRecords),
    collection('realm_registry', [
      field('realmId'), field('name'), field('tier', 'integer'), field('summary'), field('capabilities', 'json'),
      field('limits', 'json'), field('typicalDc', 'json'), field('numericValues', 'json'), field('sourceRef')
    ], safeRealmRecords),
    collection('forbidden_art_registry', [
      field('artId'), field('name'), field('category'), field('tags', 'json'), field('summary'),
      field('mechanism'), field('limits'), field('risks', 'json'), field('counterplay', 'json'),
      field('relatedItemIds', 'json'), field('relatedStatusIds', 'json'), field('sourceRef'), field('status')
    ], safeForbiddenArtRecords),
    collection('protagonist_templates', [
      field('templateId'), field('name'), field('entryType'), field('startingLocation'), field('knownFacts', 'json'),
      field('hiddenFacts', 'json'), field('startingInventory', 'json'), field('startingSkills', 'json'),
      field('startingFeats', 'json'), field('constraints', 'json'), field('openingPrompt'), field('greeting'),
      field('sourcePath'), field('content')
    ], safeProtagonistTemplates),
    collection('npc_structured_states', [
      field('npcId'), field('playerId'), field('name'), field('isPlayer', 'boolean'), field('sceneId'),
      field('status'), field('values', 'json'), field('statusBar', 'json'), field('resources', 'json'),
      field('skillBar', 'json'), field('inventory', 'json'), field('equipment', 'json'),
      field('specialStatuses', 'json'), field('greeting'), field('notes')
    ], npcStates),
    collection('npc_profiles', npcProfileDatabaseFields(), npcProfileDatabaseRecords),
    collection('npc_profile_records', [
      field('npcId'), field('name'), field('sourceDirectory'), field('factionId'), field('realm'),
      field('publicFace'), field('hiddenTruth'), field('roleplayAnchors', 'json'), field('interactionHooks', 'json'),
      field('knowledgeBoundaries'), field('currentStatePolicy'),
      field('summary'), field('description'), field('scenario'), field('opening'), field('dialogueExample'),
      field('notes'), field('eventIndex'), field('importantEvents', 'json'), field('sourceFiles', 'json'),
      field('safetyTransform')
    ], profiles),
    collection('viewpoint_templates', [
      field('templateId'), field('name'), field('sourcePath'), field('summary'), field('stateTemplate'),
      field('recommendedFirstInput')
    ], views),
    collection('reference_texts', [
      field('referenceId'), field('title'), field('category'), field('appliesTo', 'json'), field('fields', 'json'),
      field('priority', 'integer'), field('content'), field('toolUsage')
    ], referenceTexts),
    collection('map_registry', [
      field('name'), field('type'), field('parentMapId'), field('tags', 'json'), field('aliases', 'json'),
      field('summary'), field('description'), field('environment', 'json'), field('factionRefs', 'json'),
      field('npcRefs', 'json'), field('entryPoints', 'json'), field('status'), field('metadata', 'json')
    ], mapRecords),
    collection('item_registry', [
      field('name'), field('category'), field('itemType'), field('rarity'), field('tags', 'json'),
      field('aliases', 'json'), field('description'), field('mechanicalEffect'), field('lore'),
      field('value', 'json'), field('requirements', 'json'), field('grants', 'json'), field('sourceRef'),
      field('status'), field('numericValues', 'json'), field('quantificationDefinition', 'json')
    ], itemRecords),
    collection('special_item_registry', [
      field('name'), field('category'), field('specialType'), field('rarity'), field('tags', 'json'),
      field('aliases', 'json'), field('description'), field('mechanicalEffect'), field('lore'),
      field('activation', 'json'), field('charges', 'json'), field('cooldown', 'json'), field('sideEffects', 'json'),
      field('questRefs', 'json'), field('boundTo', 'json'), field('lifecycle', 'json'), field('sourceRef'),
      field('status'), field('numericValues', 'json'), field('quantificationDefinition', 'json')
    ], specialItemRecords),
    collection('skill_registry', [
      field('name'), field('category'), field('ability'), field('rankScale', 'json'), field('tags', 'json'),
      field('aliases', 'json'), field('description'), field('mechanicalEffect'), field('prerequisites', 'json'),
      field('relatedStatusIds', 'json'), field('relatedFeatIds', 'json'), field('sourceRef'), field('status'),
      field('metadata', 'json'), field('numericValues', 'json'), field('quantificationDefinition', 'json')
    ], skillRecords),
    collection('feat_registry', [
      field('name'), field('category'), field('tier'), field('tags', 'json'), field('aliases', 'json'),
      field('prerequisites', 'json'), field('description'), field('mechanicalEffect'), field('grants', 'json'),
      field('relatedSkillIds', 'json'), field('relatedStatusIds', 'json'), field('sourceRef'), field('status'),
      field('metadata', 'json'), field('numericValues', 'json'), field('quantificationDefinition', 'json')
    ], featRecords),
    collection('status_registry', [
      field('name'), field('category'), field('severity'), field('durationType'), field('stackRule'),
      field('tags', 'json'), field('aliases', 'json'), field('description'), field('mechanicalEffect'),
      field('counters', 'json'), field('immunities', 'json'), field('sourceRef'), field('status'),
      field('metadata', 'json'), field('numericValues', 'json'), field('quantificationDefinition', 'json')
    ], statusRecords),
    collection('event_pool_records', [
      field('eventId'), field('title'), field('category'), field('sourcePath'), field('status'),
      field('riskLevel'), field('trigger'), field('summary'), field('content'), field('tags', 'json')
    ], []),
    collection('worldbook_entries', [
      field('uid', 'integer'), field('comment'), field('keys', 'json'), field('content'), field('order', 'integer'),
      field('source')
    ], entries.map((entry) => ({
      id: `worldbook_${entry.uid}`,
      uid: entry.uid,
      comment: entry.comment,
      keys: entry.key,
      content: entry.content,
      order: entry.order,
      source: '世界书/八荒RPG世界书_多视角版.json'
    }))),
    collection('conversion_source_index', [
      field('sourcePath'), field('kind'), field('importedAs'), field('safetyAction'), field('size', 'integer')
    ], sourceIndex),
    collection('conversion_package_manifest', [
      field('manifestId'), field('packageName'), field('source'), field('notes'), field('rawManifest', 'json')
    ], [
      {
        id: 'manifest_multiview',
        manifestId: 'manifest_multiview',
        packageName: packageManifest.package || '八荒RPG SillyTavern多视角金手指版',
        source: 'SillyTavern导入版_八荒RPG_多视角版/manifest.json',
        notes: '源 manifest 仅作为来源索引保留；旧状态输出、开局确认、教程和内部登记策略不作为运行资料导入。',
        rawManifest: safeManifest(packageManifest)
      }
    ])
  ];

  const globalDataCollections = [
    {
      collection: 'world_lore_records',
      records: safeLoreRecords
    },
    {
      collection: 'organization_registry',
      records: safeOrganizationRecords
    },
    {
      collection: 'realm_registry',
      records: safeRealmRecords
    },
    {
      collection: 'forbidden_art_registry',
      records: safeForbiddenArtRecords
    },
    {
      collection: 'protagonist_templates',
      records: safeProtagonistTemplates
    },
    {
      collection: 'npc_relation_nodes',
      records: [
        ...PLAYER_VIEWPOINTS.map((view) => ({
          id: view.id,
          npcId: view.id,
          name: view.name,
          tags: ['player-viewpoint'],
          summary: view.prompt
        })),
        ...profiles.map((profile) => ({
          id: profile.npcId,
          npcId: profile.npcId,
          name: profile.name,
          tags: ['npc', profile.factionId || 'faction_unknown'],
          summary: profile.summary
        }))
      ]
    },
    {
      collection: 'npc_relation_edges',
      records: relationEdges()
    },
    {
      collection: 'faction_nodes',
      records: factionNodes()
    },
    {
      collection: 'faction_memberships',
      records: factionMemberships(profiles)
    },
    {
      collection: 'npc_profiles',
      records: npcProfileDatabaseRecords
    },
    {
      collection: 'visual_assets',
      records: assets
    },
    {
      collection: 'map_registry',
      records: mapRecords
    },
    {
      collection: 'item_registry',
      records: itemRecords
    },
    {
      collection: 'special_item_registry',
      records: specialItemRecords
    },
    {
      collection: 'skill_registry',
      records: skillRecords
    },
    {
      collection: 'feat_registry',
      records: featRecords
    },
    {
      collection: 'status_registry',
      records: statusRecords
    }
  ];

  const runtimeRagCollections = [
    {
      collection: 'bahuang-database-index',
      documents: [
        ragDocument('database-index', buildDatabaseIndexText({
          loreRecords: safeLoreRecords,
          organizations: safeOrganizationRecords,
          realms: safeRealmRecords,
          forbiddenArts: safeForbiddenArtRecords,
          protagonistTemplates: safeProtagonistTemplates,
          npcProfiles: npcProfileDatabaseRecords,
          maps: mapRecords,
          items: itemRecords,
          specialItems: specialItemRecords,
          skills: skillRecords,
          feats: featRecords,
          statuses: statusRecords
        }), { topic: 'database-index', importance: 5 }),
        ...views.map((view) => ragDocument(`view-${view.templateId}`, view.stateTemplate, {
          topic: 'viewpoint-template',
          viewpoint: view.name,
          importance: 4,
          sourcePath: view.sourcePath
        })),
        ...safeLoreRecords.map((record) => ragDocument(`world-lore-${record.loreId}`, [
          `# ${record.title}`,
          `分类：${record.category}`,
          `摘要：${record.summary}`,
          record.content,
          `工具提示：${record.toolUsage}`
        ].join('\n'), {
          topic: 'world-lore',
          loreId: record.loreId,
          category: record.category,
          tags: record.tags,
          importance: record.priority || 3,
          sourcePath: record.sourcePath
        })),
        ...safeOrganizationRecords.map((record) => ragDocument(`organization-${record.organizationId}`, [
          `# ${record.name}`,
          `类型：${record.kind}`,
          `地盘：${record.territory}`,
          `公开面：${record.publicFace}`,
          `暗线压力：${record.hiddenPressure}`,
          `冲突入口：${(record.conflictHooks || []).join('；')}`
        ].join('\n'), {
          topic: 'organization',
          organizationId: record.organizationId,
          tags: record.tags,
          importance: 4,
          sourcePath: record.sourceRef
        })),
        ...safeRealmRecords.map((record) => ragDocument(`realm-${record.realmId}`, [
          `# ${record.name}`,
          `tier=${record.tier}`,
          record.summary,
          `能力：${(record.capabilities || []).join('；')}`,
          `限制：${(record.limits || []).join('；')}`
        ].join('\n'), {
          topic: 'realm-scale',
          realmId: record.realmId,
          tier: record.tier,
          importance: 5,
          sourcePath: record.sourceRef
        })),
        ...safeForbiddenArtRecords.map((record) => ragDocument(`forbidden-art-${record.artId}`, [
          `# ${record.name}`,
          `分类：${record.category}`,
          record.summary,
          `机制：${record.mechanism}`,
          `限制：${record.limits}`,
          `风险：${(record.risks || []).join('；')}`,
          `反制：${(record.counterplay || []).join('；')}`
        ].join('\n'), {
          topic: 'forbidden-art',
          artId: record.artId,
          category: record.category,
          tags: record.tags,
          importance: 5,
          sourcePath: record.sourceRef
        })),
        ...safeProtagonistTemplates.map((record) => ragDocument(`protagonist-${record.templateId}`, [
          `# ${record.name}`,
          `入口类型：${record.entryType}`,
          `初始地点：${record.startingLocation}`,
          `已知事实：${(record.knownFacts || []).join('；')}`,
          `隐藏事实：${(record.hiddenFacts || []).join('；')}`,
          `开局句：${record.openingPrompt}`,
          record.content
        ].join('\n'), {
          topic: 'protagonist-template',
          templateId: record.templateId,
          entryType: record.entryType,
          importance: 5,
          sourcePath: record.sourcePath
        })),
        ...referenceTexts.map((reference) => ragDocument(`reference-${reference.referenceId}`, [
          `# ${reference.title}`,
          `分类：${reference.category}`,
          `适用：${reference.appliesTo.join('、')}`,
          `字段：${reference.fields.join('、')}`,
          reference.content,
          `工具提示：${reference.toolUsage}`
        ].join('\n'), {
          topic: 'numeric-reference',
          referenceId: reference.referenceId,
          category: reference.category,
          fields: reference.fields,
          importance: 5
        }))
      ]
    },
    {
      collection: 'bahuang-reference-texts',
      documents: referenceTexts.map((reference) => ragDocument(`reference-standalone-${reference.referenceId}`, [
        `# ${reference.title}`,
        `分类：${reference.category}`,
        `适用：${reference.appliesTo.join('、')}`,
        `字段：${reference.fields.join('、')}`,
        reference.content,
        `工具提示：${reference.toolUsage}`
      ].join('\n'), {
        topic: 'numeric-reference',
        referenceId: reference.referenceId,
        category: reference.category,
        fields: reference.fields,
        importance: 5
      }))
    },
    {
      collection: 'bahuang-worldbook',
      documents: entries.map((entry) => ragDocument(`worldbook-${entry.uid}`, [
        `# ${entry.comment}`,
        `关键词：${entry.key.join('、')}`,
        entry.content
      ].join('\n'), {
        topic: 'worldbook',
        uid: entry.uid,
        keys: entry.key,
        importance: 4
      }))
    },
    {
      collection: 'bahuang-character-baselines',
      documents: profiles.flatMap((profile) => [
        ragDocument(`profile-${profile.npcId}`, [
          `# ${profile.name}`,
          `阵营：${profile.factionId || 'unknown'}`,
          `境界：${profile.realm || '未明'}`,
          `公开身份：${profile.publicFace}`,
          `隐藏真相：${profile.hiddenTruth}`,
          `扮演锚点：${(profile.roleplayAnchors || []).join('、')}`,
          `互动入口：${(profile.interactionHooks || []).join('、')}`,
          `知识边界：${profile.knowledgeBoundaries}`,
          `当前状态策略：${profile.currentStatePolicy}`,
          profile.description,
          profile.dialogueExample
        ].filter(Boolean).join('\n\n'), {
          topic: 'character-profile',
          npcId: profile.npcId,
          name: profile.name,
          factionId: profile.factionId,
          importance: 5
        }),
        ...profile.importantEvents.map((event, index) => ragDocument(`profile-event-${profile.npcId}-${index + 1}`, event.content, {
          topic: 'character-important-event',
          npcId: profile.npcId,
          name: profile.name,
          sourcePath: event.sourcePath,
          riskLevel: event.riskLevel,
          importance: event.riskLevel === 'sanitized-high' ? 2 : 4
        }))
      ])
    },
    {
      collection: 'bahuang-rag-events',
      documents: events.map((event) => ragDocument(`event-${event.eventId}`, [
        `# ${event.title}`,
        `分类：${event.category}`,
        `状态：${event.status}`,
        event.content
      ].join('\n'), {
        topic: 'event-pool',
        eventId: event.eventId,
        category: event.category,
        sourcePath: event.sourcePath,
        riskLevel: event.riskLevel,
        importance: event.riskLevel === 'sanitized-high' ? 2 : 3
      }))
    }
  ];

  return {
    format: 'ai-dnd-character-resources-v1',
    exportedAt: NOW,
    initialSetting: {
      version: '1',
      description: '八荒RPG AI DND结构化存档：角色卡只保留笼统世界观和文风；世界观、势力、境界、禁术体系、主角模板、人物、地图、物品、特殊物、技能、专长、状态、少量世界书索引和参考文本写入数据库；人物同时写入项目原生 npc_profiles L1/L2/L3，其中 L3 是高重要背景库，只允许永久后果/身份揭露/死亡背叛/深层OOC纠偏等极少场景读取；事件材料保留在 runtime RAG，按玩家目标、地点和工具裁决召回。高风险/露骨/非自愿细节已降级为非露骨禁术风险。',
      collections
    },
    resources: {
      globalData: { collections: globalDataCollections },
      runtimeRag: { collections: runtimeRagCollections }
    }
  };
}

async function buildCharacterProfiles() {
  const directories = await readdir(SOURCE_ROOT, { withFileTypes: true });
  const output = [];
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!CHARACTER_ID_MAP[name]) continue;
    const dir = resolve(SOURCE_ROOT, name);
    const sourceFiles = await listFiles(dir, { extensions: ['.txt'], maxDepth: 3 });
    const byRole = {
      summary: findRoleFile(sourceFiles, ['角色设定摘要']),
      description: findRoleFile(sourceFiles, ['角色描述']),
      notes: findRoleFile(sourceFiles, ['角色备注']),
      scenario: findRoleFile(sourceFiles, ['情景']),
      opening: findRoleFile(sourceFiles, ['开场白']),
      dialogue: findRoleFile(sourceFiles, ['对话示例']),
      eventIndex: findRoleFile(sourceFiles, ['事件目录'])
    };
    const importantEventFiles = sourceFiles.filter((file) => relative(dir, file).includes('重要事件'));
    const readSection = async (file) => file ? sanitizeText(await readText(file), { sourcePath: rawRel(file) }).text : '';
    const sections = {
      summary: await readSection(byRole.summary),
      description: await readSection(byRole.description),
      notes: await readSection(byRole.notes),
      scenario: await readSection(byRole.scenario),
      opening: await readSection(byRole.opening),
      dialogueExample: await readSection(byRole.dialogue),
      eventIndex: await readSection(byRole.eventIndex)
    };
    const importantEvents = [];
    for (const file of importantEventFiles) {
      const content = sanitizeText(await readText(file), { sourcePath: rawRel(file) });
      const title = titleFromPath(file);
      const riskLevel = content.highRisk ? 'sanitized-high' : 'normal';
      importantEvents.push({
        sourcePath: rel(file),
        title,
        content: buildProfileEventContent(name, title, rel(file), content.text, riskLevel),
        riskLevel
      });
    }
    const allText = Object.values(sections).join('\n');
    const npcId = `npc_${CHARACTER_ID_MAP[name]}`;
    const playbook = buildNpcPlaybook(name, sections, importantEvents);
    const safeProfile = buildSafeProfileFields(name, playbook, sections, importantEvents);
    output.push({
      id: `profile_${CHARACTER_ID_MAP[name]}`,
      npcId,
      name,
      sourceDirectory: rel(dir),
      factionId: FACTION_BY_CHARACTER[name] || 'faction_unknown',
      realm: extractRealm(allText),
      publicFace: playbook.publicFace,
      hiddenTruth: playbook.hiddenTruth,
      roleplayAnchors: playbook.roleplayAnchors,
      interactionHooks: playbook.interactionHooks,
      knowledgeBoundaries: playbook.knowledgeBoundaries,
      currentStatePolicy: playbook.currentStatePolicy,
      summary: safeProfile.summary,
      description: safeProfile.description,
      scenario: safeProfile.scenario,
      opening: safeProfile.opening,
      dialogueExample: safeProfile.dialogueExample,
      notes: safeProfile.notes,
      eventIndex: safeProfile.eventIndex,
      importantEvents,
      sourceFiles: sourceFiles.map(rel),
      safetyTransform: '高风险/露骨/非自愿身体细节已降级为禁术侵蚀、人格封印、精神压制或傀儡化风险。'
    });
    report.characterProfiles += 1;
  }
  return output.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function buildNpcPlaybook(name, sections = {}, importantEvents = []) {
  const predefined = NPC_PLAYBOOK[name];
  if (predefined) return { ...predefined };
  const combined = [
    sections.summary,
    sections.description,
    sections.notes,
    importantEvents.map((event) => event.content).join('\n')
  ].filter(Boolean).join('\n\n');
  return {
    publicFace: summarize(extractNamedSection(combined, ['表人格', '人格', '身份']) || combined, 240),
    hiddenTruth: summarize(extractNamedSection(combined, ['里人格', '隐藏', '真相']) || '', 260),
    roleplayAnchors: inferRoleplayAnchors(combined),
    interactionHooks: inferInteractionHooks(combined, importantEvents),
    knowledgeBoundaries: '按原角色基线演绎；隐藏真相应通过调查、事件、工具或 RAG 命中逐步揭露。',
    currentStatePolicy: '作为 NPC 基线登记；任何长期状态变化应写入聊天数据库，而不是只写在叙事里。'
  };
}

function buildSafeProfileFields(name, playbook, sections = {}, importantEvents = []) {
  const anchors = (playbook.roleplayAnchors || []).join('、') || '按公开身份和当前状态演绎';
  const hooks = (playbook.interactionHooks || []).join('、') || '由玩家目标、地点和工具触发';
  const events = importantEvents.map((event) => `- ${event.title}：${event.riskLevel === 'sanitized-high' ? '高风险来源已转为非露骨状态/素材边界' : '可作为人物故事线素材'}`).join('\n') || '- 暂无专属重要素材；按势力、地点和玩家行动触发。';
  return {
    summary: `${name}：${playbook.publicFace} 隐藏线：${playbook.hiddenTruth} 互动入口：${hooks}`,
    description: [
      `# ${name} NPC结构化基线`,
      `公开身份：${playbook.publicFace}`,
      `隐藏真相：${playbook.hiddenTruth}`,
      `扮演锚点：${anchors}`,
      `互动入口：${hooks}`,
      `知识边界：${playbook.knowledgeBoundaries}`,
      `当前状态策略：${playbook.currentStatePolicy}`,
      '来源依据：已读取 CHC 角色设定摘要、角色描述、角色备注、情景、开场白、对话示例、事件目录和重要事件；运行时以本结构化基线和数据库状态为准。'
    ].filter(Boolean).join('\n'),
    scenario: [
      `${name}登场时，先读取 npc_profile_records、npc_structured_states、organization_registry 和最近工具结果。`,
      '不要把后期事件态提前当作开局当前态；只有玩家调查、事件触发、工具结算或数据库状态变化后，才切换隐藏状态。',
      '涉及禁术控制、人格封印、污染或傀儡化时，只做非露骨叙事和状态/风险结算。'
    ].join('\n'),
    opening: buildSafeProfileOpening(name, playbook),
    dialogueExample: buildSafeDialogueExample(name, playbook),
    notes: [
      '本记录由 CHC 角色 txt 转为 AI_DND 数据库基线，不直接保留 SillyTavern 长 prompt、露骨原文或固定状态栏规则。',
      '运行时应把这里当作角色硬锚和检索资料；具体行动、资源、状态和关系变化写入聊天数据库或由工具结算。',
    `人物故事线素材：\n${events}`
    ].join('\n'),
    eventIndex: [
    `# ${name} 事件索引`,
    '这些事件是人物故事线素材，不代表开局已发生或必须推进。',
    events
    ].join('\n')
  };
}

function npcProfileDatabaseFields() {
  return [
    field('npcId'), field('level'), field('name'), field('actorType'), field('isPlayer', 'boolean'),
    field('playerId'), field('title'), field('profileType'), field('version'), field('tags', 'json'),
    field('aliases', 'json'), field('status'), field('summary'), field('content'), field('sections', 'json'),
    field('characterCard', 'json'), field('worldInfo', 'json'), field('rules', 'json'),
    field('relationships', 'json'), field('memories', 'json'), field('data', 'json'), field('metadata', 'json'),
    field('source'), field('profileUpdatedAt')
  ];
}

function buildNpcProfileDatabaseRecords(profiles = []) {
  return profiles.flatMap((profile) => [
    buildNpcProfileL1Record(profile),
    buildNpcProfileL2Record(profile),
    buildNpcProfileL3Record(profile)
  ]);
}

function buildNpcProfileL1Record(profile) {
  return {
    id: `profile_l1_${profile.npcId}`,
    npcId: profile.npcId,
    level: 'L1',
    name: profile.name,
    actorType: 'npc',
    isPlayer: false,
    playerId: '',
    title: `${profile.name} 轻演绎资料`,
    profileType: 'light_roleplay_baseline',
    version: 'chc-l1-2026-06',
    tags: ['chc', 'npc', 'L1', 'light-profile', profile.factionId].filter(Boolean),
    aliases: [profile.name],
    status: 'active',
    summary: `${profile.publicFace} 演绎锚：${(profile.roleplayAnchors || []).join('、') || '按当前状态'}`,
    content: [
      `# ${profile.name} L1轻演绎资料`,
      `公开身份：${profile.publicFace}`,
      `可见锚点：${(profile.roleplayAnchors || []).join('、') || '按公开身份和当前状态演绎'}`,
      `当前互动入口：${(profile.interactionHooks || []).join('、') || '由玩家目标、地点和工具结果触发'}`,
      '使用边界：只用于普通对话、首次登场、观察和轻互动；不要在 L1 主动揭示隐藏真相。'
    ].join('\n'),
    sections: {
      visibleFacts: [profile.publicFace],
      roleplayAnchors: profile.roleplayAnchors || [],
      interactionHooks: profile.interactionHooks || [],
      forbiddenAtL1: ['不主动揭露隐藏真相', '不提前写后期状态', '不把人物故事线写成预设任务']
    },
    characterCard: {},
    worldInfo: {},
    rules: {
      retrievalPolicy: 'common_low_cost',
      allowedUseCases: ['普通寒暄', '首次登场', '轻观察', '场景内短互动'],
      blockedUseCases: ['永久后果裁决', '身份揭露', '死亡/背叛/阵营重写', '深层背景解释'],
      exposePolicy: '只表现可见状态，不解释隐藏事实。'
    },
    relationships: {
      factionId: profile.factionId,
      relationHints: profile.interactionHooks || []
    },
    memories: [],
    data: {
      sourceDirectory: profile.sourceDirectory,
      sourceFiles: profile.sourceFiles || []
    },
    metadata: {
      lifecycleScope: 'character',
      importance: 2,
      readGate: 'L1'
    },
    source: 'chc-import',
    profileUpdatedAt: NOW
  };
}

function buildNpcProfileL2Record(profile) {
  return {
    id: `profile_l2_${profile.npcId}`,
    npcId: profile.npcId,
    level: 'L2',
    name: profile.name,
    actorType: 'npc',
    isPlayer: false,
    playerId: '',
    title: `${profile.name} 结构秘密与互动边界`,
    profileType: 'structured_deep_profile',
    version: 'chc-l2-2026-06',
    tags: ['chc', 'npc', 'L2', 'structured-profile', profile.factionId].filter(Boolean),
    aliases: [profile.name],
    status: 'active',
    summary: `${profile.name} L2：隐藏事实、关系压力、互动边界和状态写库规则。隐藏线：${profile.hiddenTruth}`,
    content: [
      `# ${profile.name} L2结构资料`,
      `事实：${profile.publicFace}`,
      `隐藏事实：${profile.hiddenTruth}`,
      `边界：${profile.knowledgeBoundaries}`,
      `玩法：${(profile.interactionHooks || []).join('、') || '由玩家行动触发'}`,
      `当前状态策略：${profile.currentStatePolicy}`,
      '使用场景：说服、威胁、欺骗、关系变化、秘密试探、阵营影响、状态轻度变化。',
      '禁止：不要用 L2 直接输出完整背景百科；不要把人物故事线素材写成预设任务路线。'
    ].join('\n'),
    sections: {
      publicFace: profile.publicFace,
      hiddenTruth: profile.hiddenTruth,
      knowledgeBoundaries: profile.knowledgeBoundaries,
      interactionHooks: profile.interactionHooks || [],
      currentStatePolicy: profile.currentStatePolicy,
      stateWriteTargets: ['npc_structured_states', 'npc_relationship_graph', 'status_registry', 'faction_graph']
    },
    characterCard: {},
    worldInfo: {},
    rules: {
      retrievalPolicy: 'medium_risk_only',
      allowedUseCases: ['说服/威胁/欺骗', '关系变化', '秘密试探', '阵营影响', '状态轻度变化'],
      blockedUseCases: ['普通寒暄', '纯气氛描写', '奖励生成', '无关地图移动', '永久后果裁决时单独使用'],
      exposePolicy: '可把隐藏事实转为线索、反应或边界，不直接剧透全貌。'
    },
    relationships: {
      factionId: profile.factionId,
      relationHints: profile.interactionHooks || [],
      storyMaterials: profile.storyMaterials || []
    },
    memories: [],
    data: {
      sourceDirectory: profile.sourceDirectory,
      sourceFiles: profile.sourceFiles || [],
      safetyTransform: profile.safetyTransform
    },
    metadata: {
      lifecycleScope: 'character',
      importance: 4,
      readGate: 'L2'
    },
    source: 'chc-import',
    profileUpdatedAt: NOW
  };
}

function buildNpcProfileL3Record(profile) {
  const events = (profile.importantEvents || []).map((event) => ({
    title: event.title,
    sourcePath: event.sourcePath,
    riskLevel: event.riskLevel,
    content: event.content
  }));
  return {
    id: `profile_l3_${profile.npcId}`,
    npcId: profile.npcId,
    level: 'L3',
    name: profile.name,
    actorType: 'npc',
    isPlayer: false,
    playerId: '',
    title: `${profile.name} 高重要级背景资料`,
    profileType: 'high_importance_background',
    version: 'chc-l3-2026-06',
    tags: ['chc', 'npc', 'L3', 'high-importance', 'rare-use', profile.factionId].filter(Boolean),
    aliases: [profile.name],
    status: 'active',
    summary: [
      `${profile.name} 的 L3 高重要背景库。`,
      '只在 permanent/worldline 或人工强制 L3 的场景读取。',
      `核心背景：${profile.publicFace}`,
      `关键隐藏线：${profile.hiddenTruth}`
    ].join(' '),
    content: buildHighImportanceProfileContent(profile, events),
    sections: {
      strictReadGate: buildL3ReadGate(profile),
      visibleBaseline: {
        publicFace: profile.publicFace,
        realm: profile.realm,
        roleplayAnchors: profile.roleplayAnchors || []
      },
      background: {
        identityCore: profile.publicFace,
        privateTruth: profile.hiddenTruth,
        sourceDirectory: profile.sourceDirectory,
        sourceFiles: profile.sourceFiles || []
      },
      relationshipAndPressure: {
        factionId: profile.factionId,
        interactionHooks: profile.interactionHooks || [],
        currentStatePolicy: profile.currentStatePolicy,
        knowledgeBoundaries: profile.knowledgeBoundaries
      },
      storyMaterials: profile.storyMaterials || [],
      importantEvents: events,
      useOnlyAs: [
        '纠偏人物长期行为',
        '校准身份揭露或重大关系后果',
        '裁决死亡/背叛/阵营转向/禁器深层绑定',
        '从来源事件中抽取非固定、可变形的当局素材'
      ],
      neverUseAs: [
        '首轮设定百科',
        '普通闲聊背景填充',
        '强迫玩家走预设路线',
        '提前公开隐藏真相',
        '覆盖聊天数据库里的当前状态'
      ]
    },
    characterCard: {},
    worldInfo: {},
    rules: {
      retrievalPolicy: 'rare_l3_only',
      requiresExplicitL3: true,
      minimumRisk: 'permanent_or_worldline',
      allowedUseCases: buildL3AllowedUseCases(),
      blockedUseCases: buildL3BlockedUseCases(),
      exposePolicy: '不得整段百科式输出。只把一两条必要背景转化为当场线索、行为纠偏、代价或状态边界。',
      maxPromptUse: '每轮最多使用一个背景纠偏点或一条事件素材；其余留在数据库。',
      databasePriority: '当前聊天数据库/工具结果 > L3背景库 > runtime RAG > 常识推断。'
    },
    relationships: {
      factionId: profile.factionId,
      relationHints: profile.interactionHooks || [],
      storyMaterials: profile.storyMaterials || []
    },
    memories: events,
    data: {
      sourceDirectory: profile.sourceDirectory,
      sourceFiles: profile.sourceFiles || [],
      description: profile.description,
      scenario: profile.scenario,
      notes: profile.notes,
      eventIndex: profile.eventIndex,
      importantEvents: events,
      safetyTransform: profile.safetyTransform,
      importanceTier: 'high'
    },
    metadata: {
      lifecycleScope: 'character',
      importance: 5,
      readGate: 'L3',
      retrievalPolicy: 'rare_l3_only',
      contentRole: 'background_calibration_not_plot_rail'
    },
    source: 'chc-import',
    profileUpdatedAt: NOW
  };
}

function buildHighImportanceProfileContent(profile, events = []) {
  const eventText = events.length > 0
    ? events.map((event, index) => [
      `## 背景素材 ${index + 1}：${event.title}`,
      `来源：${event.sourcePath}`,
      `风险层级：${event.riskLevel}`,
      event.content
    ].join('\n')).join('\n\n')
    : '无专属重要事件文件；只按势力、地点、关系和玩家行动触发。';

  return [
    `# ${profile.name} 高重要级背景资料`,
    '',
    '## 严格读取门槛',
    buildL3ReadGate(profile),
    '',
    '## 核心背景',
    `事实：${profile.publicFace}`,
    `隐藏线：${profile.hiddenTruth}`,
    `人物边界：${profile.knowledgeBoundaries}`,
    `当前状态策略：${profile.currentStatePolicy}`,
    '',
    '## 可演绎尺度',
    `演绎锚：${(profile.roleplayAnchors || []).join('、') || '按公开身份和当前状态演绎'}`,
    `互动入口：${(profile.interactionHooks || []).join('、') || '由玩家目标、地点和工具结果触发'}`,
    `人物故事线素材：${(profile.storyMaterials || []).join('、') || '无预设路线'}`,
    '',
    '## 旧角色资料的安全迁移摘要',
    profile.description,
    profile.scenario,
    profile.notes,
    profile.eventIndex,
    '',
    '## 重要事件来源索引',
    eventText,
    '',
    '## 使用限制',
    '- L3 不是常驻 prompt，也不是每轮人物百科。',
    '- 只有当前动作会造成永久身份、死亡、背叛、阵营重写、禁器深层绑定、长期状态转换，或玩家指出人物明显 OOC 时才读取。',
    '- 读取后只提取最少必要事实，转化为线索、反应、代价或状态边界；不得强行安排预设剧情线。'
  ].filter(Boolean).join('\n');
}

function buildL3ReadGate(profile) {
  return [
    `${profile.name} 的 L3 背景极少读取。`,
    '允许：永久后果、世界线/阵营级影响、身份真相揭露、死亡/复活/背叛、禁器深层绑定、核心关系不可逆变化、玩家质疑 OOC 且 L1/L2 无法纠偏。',
    '禁止：普通问候、路过观察、气氛描写、首次见面百科、奖励生成、无关战斗、无关地图移动、为了填字数而主动剧透。',
    '读取后只用一条必要背景事实，优先转为可发现线索或行为边界。'
  ].join('\n');
}

function buildL3AllowedUseCases() {
  return [
    '永久后果或世界线级裁决',
    '身份真相揭露或长期伪装破裂',
    '死亡、复活、背叛、阵营转向',
    '禁器、污染、控制权或人格状态发生长期绑定',
    '核心关系出现不可逆变化',
    '玩家明确质疑人物 OOC，且 L1/L2 无法修正'
  ];
}

function buildL3BlockedUseCases() {
  return [
    '普通寒暄',
    '首次路过观察',
    '气氛描写',
    '普通交易和奖励生成',
    '无长期后果的轻战斗',
    '无关地图移动',
    '为了补背景而主动剧透',
    '把人物故事线素材当预设任务路线'
  ];
}

function buildSafeProfileOpening(name, playbook) {
  const hook = (playbook.interactionHooks || [])[0] || '当前场景';
  const anchor = (playbook.roleplayAnchors || [])[0] || '身份锚点';
  return [
    `【${name}登场模板】`,
    `${playbook.publicFace}`,
    `当玩家因“${hook}”接触此人时，先用“${anchor}”表现其可见状态，再给一个可追问、可观察或可行动的入口。`,
    '不要替玩家揭底；隐藏真相通过线索、反应迟滞、旧物、势力记录或工具结算逐步显现。'
  ].join('\n');
}

function buildSafeDialogueExample(name, playbook) {
  const anchor = (playbook.roleplayAnchors || [])[0] || '语气锚';
  const hook = (playbook.interactionHooks || [])[0] || '当前目标';
  return [
    '<start>',
    `{{character}}：*${name}以“${anchor}”作为第一层反应，没有急着解释全部真相。*`,
    `“你问的是${hook}。我可以给你一个入口，但代价、风险和你当前能知道的范围，要先说清。”`,
    '{{user}}：“我先观察周围，看看有没有能用的线索。”',
    `{{character}}：“有。危险不一定来自正面冲突，也可能来自账目、关注、旧物和被人记住。你要继续，我会把可见线索摆出来；结论由你查。”`
  ].join('\n');
}

function buildProfileEventContent(name, title, sourcePath, content, riskLevel) {
  const digest = riskLevel === 'sanitized-high'
    ? '原文件属于高风险来源；导入包只保留素材名称、关联人物、触发边界和非露骨状态结算用途。'
    : safeStructuredDigest(content, 360);
  return [
    `# ${title}`,
    `关联NPC：${name}`,
    `来源：${sourcePath}`,
    '定位：NPC过往事件、隐藏状态或人物故事线素材；不是开局当前事实，也不是预设剧情。',
    `来源摘要：${digest || '仅作为该 NPC 的事件名和触发锚点保留。'}`,
    '触发方式：玩家调查相关线索、进入对应地点、触碰关键物品、势力关注到达阈值，或工具结算明确命中。',
    '运行边界：触发后按当前聊天数据库、reference_texts、骰子/裁决工具和玩家选择重写为当局事件；不得逐字照搬旧平台文本。'
  ].join('\n');
}

function extractNamedSection(text, labels) {
  const value = String(text || '');
  for (const label of labels) {
    const index = value.indexOf(label);
    if (index < 0) continue;
    return value.slice(index, index + 500);
  }
  return '';
}

function inferRoleplayAnchors(text) {
  const anchors = [];
  const value = String(text || '');
  for (const keyword of ['沉默', '微笑', '停顿', '酒', '星', '刀', '药', '算盘', '梦境', '项圈', '首饰', '符灰', '旧伞']) {
    if (value.includes(keyword)) anchors.push(keyword);
  }
  return unique(anchors).slice(0, 8);
}

function inferInteractionHooks(text, importantEvents = []) {
  const hooks = importantEvents.map((event) => event.title).filter(Boolean);
  const value = String(text || '');
  for (const keyword of ['追捕', '拍卖', '观星', '药庐', '云来楼', '蜃楼城', '归尘书院', '灵霄观', '碧水宫', '禁器']) {
    if (value.includes(keyword)) hooks.push(keyword);
  }
  return unique(hooks).slice(0, 10);
}

async function buildViewTemplates() {
  const files = await listFiles(resolve(MULTI_ROOT, '视角模板'), { extensions: ['.txt'], maxDepth: 1 });
  return Promise.all(files.map(async (file) => {
    const rawContent = sanitizeText(await readText(file), { sourcePath: rawRel(file) }).text;
    const name = basename(file, '.txt').replace(/_/g, ' ');
    const content = buildSafeViewTemplateContent(name, rawContent);
    return {
      id: `view_${hash(rel(file))}`,
      templateId: `view_${hash(rel(file))}`,
      name,
      sourcePath: rel(file),
      summary: summarize(content, 300),
      stateTemplate: content,
      recommendedFirstInput: recommendedInputForView(name)
    };
  }));
}

function buildSafeViewTemplateContent(name, sourceText) {
  return [
    `# ${name}`,
    `入口身份：${inferViewIdentity(name)}`,
    `初始地点：${inferStartingLocation(name)}`,
    `推荐第一句话：${recommendedInputForView(name)}`,
    `开局资源：${inferViewOpeningResources(name).join('；') || '按玩家身份和地点生成'}`,
    `初始专长：${inferViewFeats(name).join('；') || '按玩家声明生成'}`,
    '运行边界：这是主角入口模板，只确定视角、可知范围和初始资源；事件由地点、压力、玩家目标、RAG命中、骰子/裁决工具和世界状态决定。',
    `来源摘要：${safeStructuredDigest(sourceText, 260) || '已从原视角模板提取身份和入口信息；旧状态栏式字段不导入运行提示。'}`
  ].join('\n');
}

function inferViewIdentity(name) {
  if (name.includes('李寻道')) return '李寻道，清研之子，碧水宫外门弟子。';
  if (name.includes('方澜')) return '方澜，巫雅萍幼女，灵霄观筑基弟子。';
  if (name.includes('某人')) return '某人，禁器网络暗线视角，知道自身计划但不全知世界状态。';
  return '自定义角色，身份、境界、势力和开局地点由玩家声明。';
}

function inferViewOpeningResources(name) {
  if (name.includes('李寻道')) return ['水灵玉佩', '基础御水术', '沧海横流诀入门残式', '少量灵石'];
  if (name.includes('方澜')) return ['旧皮酒囊', '灵霄弟子令', '破妄符骨候选', '少量灵石'];
  if (name.includes('某人')) return ['符灰样本', '低阶母珠节点线索', '代理人名单缺页', '未鉴定禁器残件'];
  return [];
}

async function buildStatusTemplates() {
  const files = await listFiles(resolve(MULTI_ROOT, '状态栏模板'), { extensions: ['.txt'], maxDepth: 1 });
  return Promise.all(files.map(async (file) => {
    const content = sanitizeText(await readText(file), { sourcePath: rawRel(file) }).text;
    return {
      id: `status_${hash(rel(file))}`,
      templateId: `status_${hash(rel(file))}`,
      title: basename(file, '.txt'),
      sourcePath: rel(file),
      content
    };
  }));
}

async function buildRagEventRecords() {
  const files = await listFiles(resolve(MULTI_ROOT, 'RAG事件库'), { extensions: ['.txt'], maxDepth: 8 });
  const records = [];
  for (const file of files) {
    if (hasRemovedTerm(rawRel(file))) continue;
    const content = sanitizeText(await readText(file), { sourcePath: rawRel(file) });
    const sourcePath = rel(file);
    if (hasRemovedTerm(sourcePath) || hasRemovedTerm(content.text)) continue;
    const parts = relative(resolve(MULTI_ROOT, 'RAG事件库'), file).split(sep);
    const category = normalizeEventCategory(parts.length > 1 ? parts.slice(0, -1).join('/') : 'root');
    if (category.includes('角色基线')) continue;
    const title = titleFromPath(file);
    const trigger = inferTriggerFromName(file);
    const riskLevel = content.highRisk ? 'sanitized-high' : 'normal';
    const eventContent = buildEventPoolContent({
      title,
      category,
      sourcePath,
      trigger,
      riskLevel,
      sourceText: content.text
    });
    records.push({
      id: `event_${hash(sourcePath)}`,
      eventId: `event_${hash(sourcePath)}`,
      title,
      category,
      sourcePath,
      status: content.highRisk ? 'dormant_sanitized' : 'dormant',
      riskLevel,
      trigger,
      summary: summarize(eventContent, 500),
      content: eventContent,
      tags: unique(category.split('/').concat(parts[parts.length - 1].split(/[_#\-.]/))
        .map((tag) => sanitizeInline(tag))
        .filter(Boolean))
    });
  }
  report.ragDocuments += records.length;
  return records;
}

function buildEventPoolContent({ title, category, sourcePath, trigger, riskLevel, sourceText }) {
  const digest = eventDigestForCategory(category, riskLevel, sourceText);
  const usage = eventUsageForCategory(category);
  return [
    `# ${title}`,
    `分类：${category}`,
    `来源：${sourcePath}`,
    `状态：${riskLevel === 'sanitized-high' ? 'dormant_sanitized' : 'dormant'}`,
    `触发：${trigger}`,
    `用途：${usage}`,
    `来源摘要：${digest || '原文只作为转换来源；运行时按当前局势重新生成事件。'}`,
    '运行规则：事件牌只提供入口、压力、竞争者、线索或奖励类型；不得强迫玩家处理，也不得覆盖当前聊天数据库。',
    '结算规则：奖励、线索、物品、关注、关系、伤势、污染、时间压力和临时对象应写入对应数据库或由工具结算。',
    '数值规则：DC、奖励、战力、状态强度和物品价值先查 reference_texts；需要随机性时调用骰子/裁决工具。'
  ].join('\n');
}

function eventDigestForCategory(category, riskLevel, sourceText) {
  if (riskLevel === 'sanitized-high') return '该来源属于高风险资料；已仅保留事件牌结构、触发条件和非露骨风险结算。';
  if (category.includes('条件事件素材')) return '该来源作为后期状态素材保留；是否出现由地点、线索、压力、玩家目标、随机检定或工具结算决定。';
  const digest = safeStructuredDigest(sourceText, 520);
  return rewriteWorldbookRuntimeText(digest) || '该来源只作为事件范式；落地时按当前地点、人物、压力、奖励类型和过期条件重新生成。';
}

function eventUsageForCategory(category) {
  if (category.includes('反派势力计时')) return '作为势力关注、证据清理、巡检或追踪计时器。';
  if (category.includes('条件事件素材')) return '作为随机/条件命中的人物故事线素材，不是必走剧情或必走路线。';
  if (category.includes('重要事件')) return '作为高价值线索或事件素材，需由玩家行动、地点、压力或随机检定命中。';
  if (category.includes('角色基线')) return '作为角色首次登场或 OOC 校正资料。';
  if (category.includes('气运金手指')) return '作为主角成长型能力、奇遇和限制的参考。';
  if (category.includes('经典事件牌')) return '作为可抽取、改写和复用的场景事件牌。';
  if (category.includes('临时事件')) return '作为单次事件，完成后应注销或归档。';
  if (category.includes('长期事件')) return '作为多阶段目标、资源筹备或拼合进度。';
  if (category.includes('人格状态机')) return '作为人格/伪装/隐藏状态的触发边界，不直接替代数据库状态。';
  if (category.includes('成人随机事件') || category.includes('高风险随机事件')) return '仅保留为高风险边界和误会/污染/幻香类非露骨事件素材。';
  return '作为 dormant 事件素材，按当前玩家目标、地点、势力压力和数据库状态改写后使用。';
}

function normalizeEventCategory(category) {
  return sanitizePath(String(category || 'root'))
    .replace(/固定触发事件/g, '条件事件素材')
    .replace(/条件事件候选/g, '条件事件素材')
    .replace(/新手教程/g, '开局事件素材')
    .replace(/教程/g, '事件素材')
    .replace(/状态栏模板/g, '状态模板来源');
}

async function buildImageAssets() {
  const files = await listFiles(SOURCE_ROOT, { extensions: ['.png', '.jpg', '.jpeg', '.webp'], maxDepth: 2 });
  report.imageFiles = files.length;
  return files.map((file, index) => {
    const sourcePath = rel(file);
    const assetId = `asset_chc_${String(index + 1).padStart(3, '0')}_${hash(sourcePath, 6)}`;
    return {
      id: assetId,
      assetId,
      name: basename(file),
      assetType: 'image',
      uri: sourcePath,
      mimeType: mimeType(file),
      source: 'imported-reference',
      status: 'active',
      tags: ['chc', 'imported', 'reference'],
      aliases: [basename(file, extname(file))],
      metadata: {
        sourcePath,
        note: '作为视觉资源引用导入；项目当前不会自动渲染或注入图片。'
      }
    };
  });
}

async function buildSourceIndex() {
  const files = await listFiles(SOURCE_ROOT, { extensions: ['.txt', '.json', '.png', '.jpg', '.jpeg', '.webp', '.zip'], maxDepth: 8 });
  const records = [];
  for (const file of files) {
    const rawSourcePath = rawRel(file);
    if (hasRemovedTerm(rawSourcePath)) continue;
    const sourcePath = sanitizePath(rawSourcePath);
    const stats = await stat(file);
    const extension = extname(file).toLowerCase();
    const highRisk = HIGH_RISK_PATH.test(rawSourcePath);
    records.push({
      id: `source_${hash(sourcePath)}`,
      sourcePath,
      kind: extension.replace('.', '') || 'file',
      importedAs: inferImportedAs(sourcePath),
      safetyAction: highRisk ? 'sanitized_summary_only' : 'sanitized_or_direct_structured',
      size: stats.size
    });
  }
  return records;
}

function buildReferenceTextRecords() {
  return REFERENCE_TEXT_RECORDS.map((reference) => ({
    ...reference,
    appliesTo: unique(reference.appliesTo || []),
    fields: unique(reference.fields || []),
    priority: Number(reference.priority || 0),
    toolUsage: [
      `可作为 referenceDocuments 条目：{ name: "${reference.referenceId}", fields: ${JSON.stringify(reference.fields || [])}, text: "..." }。`,
      '适合在 quantificationDefinition 中约束 numericFields/textFields，或在写入 numericValues 前做人工/GM校准。'
    ].join(' ')
  }));
}

async function buildWorldLoreRecords() {
  const sourcePath = resolve(SOURCE_ROOT, '世界书.txt');
  let content = '';
  try {
    content = sanitizeText(await readText(sourcePath), { sourcePath: rawRel(sourcePath) }).text;
  } catch {
    content = '';
  }
  const sections = splitMarkdownBoldSections(content);
  const fallback = (title) => sections.find((section) => section.title.includes(title))?.content || '';
  const coreConflicts = [
    '其一，正道各宗互相制衡。灵霄观掌中洲灵脉，碧水宫控东洲海域，赤焰文氏握法器命脉，三方合作但长期互相提防。',
    '其二，禁术扩散。上古禁术残篇与禁器胚体被重新发现、重构和转用，正在从封印器、炼器胚体转向活体控制、人格封印、权限网络和势力渗透。',
    '其三，“某人”。这是一个代号，不是公开身份。其目标不是毁灭宗门，而是通过禁器网络和代理人控制关键节点；已知暗线涉及灵霄观、归尘书院、碧水宫、云来楼。'
  ].join('\n');
  const soulAndBody = [
    '修士自引气入体起形成元灵，元灵承载意识、人格、修为与灵力基础。境界越高，元灵越稳固，越能被封存、转移或封入器物。',
    '元灵剥离、压制或破碎会造成意识与肉身的断裂。AI_DND中只把它作为禁术、死亡边界、残魂、封印、法器承载和反制机制处理，不作为露骨描写入口。',
    '肉身、习惯、肌肉记忆和情绪条件反射会留下“原主印痕”。这些印痕可成为识破伪装、救援、反制或剧情裂缝。'
  ].join('\n');
  const forbiddenPuppets = [
    '禁术傀儡体系指元灵被剥离、压制、封存或替换后，由禁器、灵丝、人造人格回路或外部权限维持行动的状态。',
    '运行时必须分清四层：公开身份、隐藏驱动源、权限主体、残留印痕。不要把后期成品态提前当作开局事实。',
    '每次使用此体系都应登记来源、权限、稳定度、暴露风险、反制入口和是否影响 NPC 自主性。只做非露骨叙事和状态/风险结算。'
  ].join('\n');
  const artifactSystem = [
    '凡器：灵材锻造的寻常兵器或工具，通常没有稳定法器特性。',
    '灵器：嵌灵脉、刻灵阵，认主后可与使用者心意相通，但仍受境界、灵力和维护限制。',
    '禁器：上古高阶修士遗留或由残篇重构的危险器物。许多禁器本是对物封印器、炼器胚体或观测装置，被转用后可能影响活体、人格、权限和势力节点。',
    '母器/子器：母器可驱动或校准子器，子器通常不能反向溯源母器。任何母器权限都必须登记代价、信号、反制和某人关注。'
  ].join('\n');
  return [
    worldLoreRecord('lore_geography', '八荒地理格局', 'geography', 95, ['五洲', '地理', '地图'], fallback('地理'), '用于生成地图层级、旅行距离、地方势力和探索入口。'),
    worldLoreRecord('lore_major_factions', '主要势力总览', 'factions', 95, ['势力', '宗门', '世家'], fallback('主要势力'), '用于判断 NPC 所属势力、公开身份、资源调度和势力冲突。'),
    worldLoreRecord('lore_core_conflicts', '世界主要矛盾', 'conflict', 90, ['正道', '禁术', '某人'], coreConflicts, '用于选择事件压力、反派计时、宗门暗斗和长期后果。'),
    worldLoreRecord('lore_cultivation_culture', '修仙界风气', 'tone', 85, ['强者为尊', '资源', '灵脉'], fallback('修仙界风气'), '用于保持八荒世界的行动动机和社会默认逻辑。'),
    worldLoreRecord('lore_realms', '修炼境界', 'realm-scale', 100, ['境界', '炼气', '筑基', '元婴', '化神'], fallback('修炼境界'), '用于战力、DC、NPC威胁、越境目标和成长结算。'),
    worldLoreRecord('lore_soul_body_yuanying', '灵魂、肉体与元灵', 'metaphysics', 90, ['元灵', '元婴', '魂魄', '肉体'], soulAndBody, '用于解释禁术、复活、封印、残魂、法器承载和死亡边界。'),
    worldLoreRecord('lore_forbidden_puppets', '禁术傀儡体系', 'forbidden-art', 95, ['禁术', '傀儡', '人格', '驱动源'], forbiddenPuppets, '用于非露骨地处理禁术控制、人格封印、权限、污染和反制。'),
    worldLoreRecord('lore_artifact_system', '法器与禁器体系', 'artifact-system', 90, ['法器', '禁器', '母器', '子器'], artifactSystem, '用于物品注册、禁器限制、认主、封印、母器/子器权限裁决。')
  ];
}

function splitMarkdownBoldSections(content) {
  const sections = [];
  const pattern = /\*\*([^*：:]+[：:]?)\*\*/g;
  const matches = [...String(content || '').matchAll(pattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const title = sanitizeInline(match[1].replace(/[：:]$/, ''));
    const start = match.index + match[0].length;
    const end = next ? next.index : content.length;
    sections.push({
      title,
      content: String(content || '').slice(start, end).trim()
    });
  }
  return sections;
}

function worldLoreRecord(loreId, title, category, priority, tags, content, toolUsage) {
  return {
    id: loreId,
    loreId,
    title,
    category,
    priority,
    tags,
    summary: summarize(content, 420),
    content: content || `${title}：源文本未找到对应段落，使用结构化注册表作为补充。`,
    sourcePath: 'chc/世界书.txt',
    toolUsage
  };
}

async function buildProtagonistTemplates(viewTemplates = []) {
  const records = [];
  const rootCards = [
    {
      path: resolve(SOURCE_ROOT, '{{user}}主角卡_白手起家.txt'),
      id: 'pc_lixundao_bare_start',
      name: '李寻道 - 碧水宫白手起家',
      entryType: 'sect-heir-investigation',
      startingLocation: '碧水宫外门',
      knownFacts: ['十九岁炼气十层', '清研之子', '外门身份尴尬', '水灵玉佩可疑'],
      hiddenFacts: ['清研真相', '李飞轩真相', '水灵玉佩定位锚点'],
      startingInventory: ['碧水宫内门弟子法袍', '中品灵石二十余块', '沧海横流诀手抄本前六页', '水灵玉佩', '制式水纹短剑'],
      startingSkills: ['碧水基础御水术', '沧海横流诀入门残式'],
      startingFeats: ['少宫主身份', '越境抓手'],
      constraints: ['开局不知道母亲和父亲真相', '资源支取会留下账目', '不预设路线'],
      openingPrompt: '我以李寻道/清研之子的身份，从碧水宫外门开局，并启用逆命潮种金手指。',
      greeting: '我站在碧水宫外门潮湿的石阶下，晨雾还没散，水灵玉佩贴着胸口发凉。外门名册上关于我的几处涂改像是刚干的墨迹，清研今日的巡检也比往常提前了。'
    },
    {
      path: resolve(SOURCE_ROOT, '{{user}}主角卡.txt'),
      id: 'pc_forbidden_art_usurper',
      name: '自定义禁器使用者 - 夺取母器权限',
      entryType: 'forbidden-art-rival',
      startingLocation: '灵霄观贵客身份',
      knownFacts: ['独立于某人', '拥有部分母器权限', '以宗门贵客身份蛰伏', '方澜已经怀疑', '某人迟早会注意到权限干扰'],
      hiddenFacts: ['某人完整权限和真实位置', '各禁器反制入口', '代理人追踪强度'],
      startingInventory: ['母珠部分权限', '观星镜权限线索', '灵骸甲权限线索', '若干禁器锚点'],
      startingSkills: ['禁器解析', '镜术与梦境辨识', '云来楼情报交易'],
      startingFeats: ['反派经营红利', '越境抓手'],
      constraints: ['不能无代价控制整个世界', '高风险控制内容只作为非露骨禁术风险和状态结算', '每次使用权限都可能增加某人关注'],
      openingPrompt: '我以独立禁器使用者身份，从灵霄观贵客位置开局，目标是在某人归来前巩固手中权限。',
      greeting: '我以灵霄观贵客身份坐在偏殿静室，桌上摆着一枚尚未完全听命的母珠残权。方澜已经在山门附近打听异常，某人也迟早会察觉权限缺口；我必须先决定今晚要巩固哪一条禁器链。'
    }
  ];
  for (const template of rootCards) {
    let content = '';
    try {
      content = sanitizeText(await readText(template.path), { sourcePath: rawRel(template.path) }).text;
    } catch {
      content = '';
    }
    records.push({
      id: template.id,
      templateId: template.id,
      name: template.name,
      entryType: template.entryType,
      startingLocation: template.startingLocation,
      knownFacts: template.knownFacts,
      hiddenFacts: template.hiddenFacts,
      startingInventory: template.startingInventory,
      startingSkills: template.startingSkills,
      startingFeats: template.startingFeats,
      constraints: template.constraints,
      openingPrompt: template.openingPrompt,
      ...(template.greeting ? { greeting: template.greeting } : {}),
      sourcePath: rel(template.path),
      content: buildProtagonistTemplateContent(template, safeStructuredDigest(content, 520))
    });
  }
  for (const view of viewTemplates) {
    const viewTemplate = {
      name: view.name,
      entryType: 'viewpoint-template',
      startingLocation: inferStartingLocation(view.name),
      knownFacts: [view.summary].filter(Boolean),
      hiddenFacts: [],
      startingInventory: ['视角模板'],
      startingSkills: [],
      startingFeats: inferViewFeats(view.name),
      constraints: ['以当前聊天数据库和工具结果为准', '入口模板只确定入口'],
      openingPrompt: view.recommendedFirstInput,
      greeting: inferViewGreeting(view.name)
    };
    records.push({
      id: `pc_template_${view.templateId}`,
      templateId: `pc_template_${view.templateId}`,
      name: viewTemplate.name,
      entryType: viewTemplate.entryType,
      startingLocation: viewTemplate.startingLocation,
      knownFacts: viewTemplate.knownFacts,
      hiddenFacts: viewTemplate.hiddenFacts,
      startingInventory: viewTemplate.startingInventory,
      startingSkills: viewTemplate.startingSkills,
      startingFeats: viewTemplate.startingFeats,
      constraints: viewTemplate.constraints,
      openingPrompt: viewTemplate.openingPrompt,
      ...(viewTemplate.greeting ? { greeting: viewTemplate.greeting } : {}),
      sourcePath: view.sourcePath,
      content: buildProtagonistTemplateContent(viewTemplate, safeStructuredDigest(view.stateTemplate, 520))
    });
  }
  return records;
}

function buildProtagonistTemplateContent(template, sourceDigest = '') {
  return [
    `# ${template.name}`,
    `入口类型：${template.entryType}`,
    `初始地点：${template.startingLocation}`,
    `已知事实：${(template.knownFacts || []).join('；') || '由玩家身份决定'}`,
    `隐藏事实：${(template.hiddenFacts || []).join('；') || '按数据库和事件触发逐步揭露'}`,
    `初始物品：${(template.startingInventory || []).join('；') || '按身份生成'}`,
    `初始技能：${(template.startingSkills || []).join('；') || '按身份生成'}`,
    `初始专长：${(template.startingFeats || []).join('；') || '按身份生成'}`,
    `限制：${(template.constraints || []).join('；') || '不得凭空获得超纲资源'}`,
    `推荐第一句话：${template.openingPrompt}`,
    template.greeting
      ? `绑定 greeting：${template.greeting}`
      : '绑定 greeting：未写；不固定主角初始处境，由 AI 按当前数据库、玩家声明和场景生成。',
    `来源依据：已读取原始主角卡/视角模板并转为结构化入口；${sourceDigest ? '原文只作为校准来源，不直接注入运行提示。' : '运行时以本结构化模板和聊天数据库为准。'}`,
    '运行方式：玩家选择该入口后，建立主角状态、背包、技能、专长、地点、可知范围和可召回事件素材；不要把隐藏真相直接公开给主角。'
  ].join('\n');
}

function inferStartingLocation(name) {
  if (name.includes('李寻道')) return '碧水宫外门';
  if (name.includes('方澜')) return '灵霄观';
  if (name.includes('某人')) return '禁器网络暗线';
  return '由玩家指定';
}

function inferViewFeats(name) {
  if (name.includes('李寻道')) return ['逆命潮种', '少宫主身份'];
  if (name.includes('方澜')) return ['破妄雷心'];
  if (name.includes('某人')) return ['反派经营红利'];
  return ['自定义天命'];
}

function inferViewGreeting(name) {
  if (name.includes('李寻道')) {
    return '我站在碧水宫外门潮湿的石阶下，晨雾还没散，水灵玉佩贴着胸口发凉。外门名册上关于我的几处涂改像是刚干的墨迹，清研今日的巡检也比往常提前了。';
  }
  if (name.includes('方澜')) {
    return '我从灵霄观山门下的小酒肆回来，旧皮酒囊空了一半。山上钟声照常响，家里每个人也照常说话，可我昨夜贴在墙后的线索纸又多了一条：二姐的星图和母亲的宗主令对不上。';
  }
  if (name.includes('某人')) {
    return '我在无灯密室里合上禁器账册，铜雀台刚送来三份符灰回报：一份来自灵霄观，一份来自云来楼，一份没有署名。母珠权限仍不完整，但已经足够让我决定今晚先动哪一枚暗子。';
  }
  return '';
}

function buildOrganizationRegistryRecords() {
  return [
    organizationRecord('org_lingxiao', '灵霄观', '正道宗门', '中洲灵霄山脉', ['灵霄观', '方家', '星命瞳'], '八荒正道执牛耳者，镇守中洲灵脉与禁器。', '方家内部异常、星命预警和某人渗透逐步扩大。', ['方瑶光', '方璇玑', '方澜', '巫雅萍'], ['map_lingxiao_temple'], ['宗门传唤', '星命预警', '方澜调查']),
    organizationRecord('org_bishui', '碧水宫', '水修宗门', '东洲碧水海域七十二岛', ['碧水宫', '清研', '李寻道'], '东洲水修大宗，控制海域与巡海任务。', '清研旧事、李寻道身世和首饰灵丝暗线。', ['清研', '李飞轩'], ['map_bishui_palace', 'map_bishui_outer'], ['外门名单异常', '巡海任务', '水灵玉佩疑点']),
    organizationRecord('org_guichen', '归尘书院', '书院宗门', '西洲归尘山脉', ['归尘书院', '独孤萱', '书院弟子'], '有教无类的土修书院，师徒关系和学派秩序明显。', '院长与多名弟子存在禁术暗线，适合调查和救援。', ['独孤萱', '婉悦', '沈若棠', '温青蘅'], ['map_guichen_academy'], ['书院来信', '药庐异常', '讲坛与项圈裂纹']),
    organizationRecord('org_chiyan', '赤焰文氏', '修仙世家', '西洲赤焰城', ['赤焰文氏', '炼器', '文丽'], '掌握大量法器炼制资源的古老世家。', '文丽线、炼器资源和世家利益可能牵动多方。', ['文丽'], ['map_chiyan_wen'], ['法器交易', '世家追索', '赤焰材料']),
    organizationRecord('org_yunlai', '云来楼', '商会/情报楼', '各洲分号', ['云来楼', '苏锦娘', '情报'], '明面客栈酒楼，实为最大信息集散地。', '台下连接禁器网络与代理人，中转道具、账册和密令。', ['苏锦娘'], ['map_yunlai_tower'], ['错账单', '情报交易', '地下拍卖会']),
    organizationRecord('org_shenlou', '蜃楼城', '自由港', '东洲东海', ['蜃楼城', '黑市', '拍卖'], '散修、逃犯、商人和情报贩子汇聚的自由港。', '禁器残件、拍卖、尾随和杀人夺宝事件高发。', [], ['map_shenlou_city'], ['地下拍卖', '黑市寄售', '码头黑船']),
    organizationRecord('org_jingyue', '镜月天', '隐秘旧宗', '镜月裂隙', ['镜月天', '胧', '梦境'], '已灭隐宗残址，镜术与梦境提示相关。', '守阁人胧只示现裂缝，不直接干预。', ['胧'], ['map_jingyue_sky'], ['梦境示现', '镜月残钥', '傀儡网络裂缝']),
    organizationRecord('org_forbidden_network', '禁器网络', '暗线网络', '跨洲暗面', ['某人', '母珠', '禁器'], '某人系统性收集和重构禁器形成的暗线网络。', '权限、关注、反制、代理人和母器信号共同推进。', ['某人', '苏锦娘'], [], ['母珠干扰', '代理人清理证据', '禁器竞标']),
    organizationRecord('org_tongquetai', '铜雀台', '地下组织/禁器网络执行层', '跨洲暗面', ['铜雀台', '某人', '地下组织', '肉傀儡', '禁器网络'], '无公开身份。多数修士只听过零碎传闻，把它当成黑市、禁器贩子或失踪案背后的影子名号。', '铜雀台是某人暗中运营的地下组织，多数执行者为禁术傀儡/肉傀儡，也混有被胁迫的线人、黑市中介和不知全貌的外围代理。', ['某人', '苏锦娘'], [], ['代理人递信', '清理证据', '回收禁器', '替换身份', '地下拍卖暗号', '失踪案线索'])
  ];
}

function organizationRecord(organizationId, name, kind, territory, tags, publicFace, hiddenPressure, npcNames, mapRefs, conflictHooks) {
  return {
    id: organizationId,
    organizationId,
    name,
    kind,
    territory,
    tags,
    publicFace,
    hiddenPressure,
    resources: {},
    npcRefs: npcNames.map((name) => `npc_${CHARACTER_ID_MAP[name]}`).filter(Boolean),
    mapRefs,
    conflictHooks,
    status: 'active',
    sourceRef: 'chc/世界书.txt'
  };
}

function buildRealmRegistryRecords() {
  return [
    realmRecord('realm_qi_refining', '炼气期', 1, '引天地灵气入体，凡人与修士分水岭；十三层。', ['低阶术法', '基础感知', '短时爆发'], ['不能御器长飞', '元灵脆弱'], { ordinary: 10, hard: 15 }, {
      realmTier: 1,
      basePower: 2,
      powerScore: 2,
      energyPool: 6,
      skillCap: 2,
      maxItemPowerSafe: 3,
      flightCapability: 0,
      rangedTechniqueCap: 2,
      forbiddenArtSafeRank: 0
    }),
    realmRecord('realm_foundation', '筑基期', 2, '经脉贯通，丹田初成，寿一百五十，可御器飞行。', ['御器飞行', '稳定灵力外放', '低阶宗门骨干'], ['资源池仍有限'], { ordinary: 11, hard: 16 }, {
      realmTier: 2,
      basePower: 4,
      powerScore: 4,
      energyPool: 10,
      skillCap: 3,
      maxItemPowerSafe: 5,
      flightCapability: 4,
      rangedTechniqueCap: 4,
      forbiddenArtSafeRank: 1
    }),
    realmRecord('realm_core', '结丹期', 3, '丹田凝结金丹，灵力外放，多数宗门长老、校医、散修老手处此境。', ['开宗立派', '稳定战斗法术', '中阶阵器'], ['被元婴明显压制'], { ordinary: 12, hard: 17 }, {
      realmTier: 3,
      basePower: 6,
      powerScore: 6,
      energyPool: 16,
      skillCap: 4,
      maxItemPowerSafe: 6,
      flightCapability: 6,
      rangedTechniqueCap: 6,
      forbiddenArtSafeRank: 2
    }),
    realmRecord('realm_nascent', '元婴期', 4, '碎丹成婴，一宗之主多为此境巅峰，可独镇一方。', ['元婴离体风险处理', '高阶法器承载', '大范围威压'], ['禁器和同阶围攻仍可造成危险'], { ordinary: 13, hard: 19 }, {
      realmTier: 4,
      basePower: 8,
      powerScore: 8,
      energyPool: 24,
      skillCap: 5,
      maxItemPowerSafe: 8,
      flightCapability: 8,
      rangedTechniqueCap: 8,
      forbiddenArtSafeRank: 3
    }),
    realmRecord('realm_spirit', '化神期', 5, '元婴与元神融合，神念外放，当世顶尖，屈指可数。', ['操控天地灵气', '炼制/理解高阶禁器', '区域级影响'], ['上古禁器、规则限制、长期布局可构成威胁'], { ordinary: 15, hard: 21 }, {
      realmTier: 5,
      basePower: 10,
      powerScore: 10,
      energyPool: 36,
      skillCap: 6,
      maxItemPowerSafe: 9,
      flightCapability: 9,
      rangedTechniqueCap: 9,
      forbiddenArtSafeRank: 4
    }),
    realmRecord('realm_void', '炼虚期及以上', 6, '传说境界，上古时代后无人确证达到。', ['神游', '近乎神话的规则影响'], ['只应作为传说、遗迹或压倒性背景压力'], { ordinary: 18, hard: 24 }, {
      realmTier: 6,
      basePower: 12,
      powerScore: 12,
      energyPool: 50,
      skillCap: 7,
      maxItemPowerSafe: 10,
      flightCapability: 10,
      rangedTechniqueCap: 10,
      forbiddenArtSafeRank: 5
    })
  ];
}

function realmRecord(realmId, name, tier, summary, capabilities, limits, typicalDc, numericValues) {
  return {
    id: realmId,
    realmId,
    name,
    tier,
    summary,
    capabilities,
    limits,
    typicalDc,
    numericValues,
    sourceRef: 'chc/世界书.txt#修炼境界'
  };
}

function buildForbiddenArtRegistryRecords() {
  return [
    forbiddenArtRecord('art_mother_bead_authority', '母器/母珠权限', 'authority-network', ['母珠', '权限', '禁器网络'], '母器驱动子器，权限并非唯一；部分权限会带来信号干扰和关注。', '使用权限时通过母器对子器下达指令或读取状态。', '不能无代价全控；高阶或不完整权限会留下信号、污染、反制入口。', ['某人关注', '代理人追踪', '权限反噬'], ['切断信号', '反向追踪', '封印子器'], ['special_mother_bead_network'], ['status_attention', 'status_pollution']),
    forbiddenArtRecord('art_spirit_thread_persona', '灵丝人格编织', 'persona-seal', ['灵丝', '人格', '首饰'], '以灵丝、首饰或回路编织表层人格，用于伪装或托管。', '读取旧记忆、肌肉习惯和预设行为模板，生成社会可接受外壳。', '旧印痕会形成裂缝；长时间运行会出现重复、延迟和动作破绽。', ['人格失衡', '旧印痕反扑', '被熟人识破'], ['触发原主执念', '破坏锚点', '对照旧物旧习惯'], ['special_tide_bone_core'], ['status_persona_instability']),
    forbiddenArtRecord('art_lock_star_observation', '锁星扣观测', 'observation-device', ['锁星扣', '星命瞳', '观测'], '把星命、脊柱/观测锚点和光幕折射结合为远距观测工具。', '可提供距离外景象、危险预警和天机裂缝。', '不能全知；高强度观测会引发反侦测、压力或状态损伤。', ['被反侦测', '压力上升', '误读天象'], ['遮蔽星命', '切断扣链', '梦境反照'], ['special_star_lock'], ['status_pressure']),
    forbiddenArtRecord('art_forbidden_puppet_body', '禁术傀儡驱动', 'body-drive', ['禁术傀儡', '元灵', '驱动源'], '元灵剥离或压制后，以禁器、回路或替代人格驱动肉身。', '让失去原主稳定意志的身体继续行动、伪装或执行命令。', '必须处理权限、残留印痕、暴露、伦理风险和反制；不作为露骨描写入口。', ['残留执念', '控制失稳', '势力追查'], ['破坏驱动源', '唤醒印痕', '高阶净化/封印'], ['special_mother_bead_network'], ['status_persona_instability', 'status_pollution']),
    forbiddenArtRecord('art_mirror_dream_reveal', '镜术梦境示现', 'mirror-dream', ['镜月天', '梦境', '胧'], '通过梦境或镜像让玩家看见被遮掩的裂缝。', '提供片段、象征、问题和可调查线索。', '不直接替玩家判断；不能当万能解谜工具。', ['误读象征', '梦境污染', '被镜中对象察觉'], ['醒后验证', '寻找镜月锚点', '交叉检索 RAG'], ['special_mirror_moon_key'], ['status_unidentified'])
  ];
}

function forbiddenArtRecord(artId, name, category, tags, summary, mechanism, limits, risks, counterplay, relatedItemIds, relatedStatusIds) {
  return {
    id: artId,
    artId,
    name,
    category,
    tags,
    summary,
    mechanism,
    limits,
    risks,
    counterplay,
    relatedItemIds,
    relatedStatusIds,
    sourceRef: 'chc/世界书.txt + chc/RAG事件库',
    status: 'active'
  };
}

function buildMapRegistryRecords() {
  return [
    mapRecord('map_bahuang_world', '八荒世界', 'world', '', ['八荒', '修仙世界'], '宗门、世家、散修、禁器暗线并存的修仙世界。', '世界基调为强者为尊、机缘伴随代价，具体地点按地图与世界书检索。'),
    mapRecord('map_east_continent', '东洲', 'region', 'map_bahuang_world', ['东洲', '碧水海域'], '碧水宫势力范围所在大区。', '水修宗门、海域岛屿、外门任务和巡海线索多发生于此。'),
    mapRecord('map_bishui_palace', '碧水宫', 'sect', 'map_east_continent', ['碧水宫', '水修宗门'], '东洲水修大宗，清研与李寻道相关核心势力。', '包含内门、外门、任务堂、库房、码头、巡海船与若干暗线疑点。'),
    mapRecord('map_bishui_outer', '碧水宫外门', 'district', 'map_bishui_palace', ['外门', '名单亭', '任务堂'], '李寻道默认可选开局区域之一。', '适合低风险采购、任务领取、名单异常、水灵玉佩疑点和清研疑点入口。'),
    mapRecord('map_shenlou_city', '蜃楼城', 'city', 'map_east_continent', ['蜃楼城', '黑市', '拍卖'], '海市、黑市、拍卖与情报交易集中地。', '适合物品、法器、丹药、禁器残件、拍卖会和杀人夺宝结构事件。'),
    mapRecord('map_lingxiao_temple', '灵霄观', 'sect', 'map_bahuang_world', ['灵霄观', '方家'], '正道宗门，方澜、方瑶光、方璇玑、巫雅萍相关核心势力。', '适合家族观察、星命预警、追捕邪修和宗门内斗。'),
    mapRecord('map_guichen_academy', '归尘书院', 'academy', 'map_bahuang_world', ['归尘书院', '书院'], '独孤萱、婉悦、文丽、沈若棠、温青蘅相关势力。', '书院风格强调学派、师徒、日常线索与隐藏触发。'),
    mapRecord('map_yunlai_tower', '云来楼', 'organization-site', 'map_bahuang_world', ['云来楼', '情报', '交易'], '苏锦娘经营的信息与交易枢纽。', '线索、委托、价格、人情和风闻常从这里进入。'),
    mapRecord('map_jingyue_sky', '镜月天', 'hidden-domain', 'map_bahuang_world', ['镜月天', '梦境', '镜术'], '胧和镜术梦境相关的隐秘领域。', '不应随意公开全貌，通常通过梦境、镜像、残卷或关键节点显现。'),
    mapRecord('map_chiyan_wen', '赤焰文氏', 'clan-territory', 'map_bahuang_world', ['赤焰文氏', '炼器', '世家'], '文丽出身的赤焰世家势力。', '适合炼器、世家礼法、赤焰材料和交易/陷局。'),
    mapRecord('map_shenlou_auction', '蜃楼城地下拍卖会', 'event-site', 'map_shenlou_city', ['地下拍卖', '禁器竞标', '黑市'], '禁器残片、赃物、情报和尾随事件高发地。', '价格、竞标、尾随和某人归档都可从这里触发。'),
    mapRecord('map_relic_ruins', '秘境遗迹', 'dungeon-template', 'map_bahuang_world', ['秘境', '遗迹', '传承'], '通用探索牌组场景，含入口石门、灵田、阵门、水下廊道、传承殿、灵兽巢和出口。', '用于开放式探索，不是预设路线；每个房间应产生线索、风险或资源变化。'),
    mapRecord('map_relic_inheritance_hall', '传承殿', 'dungeon-room', 'map_relic_ruins', ['传承殿', '残篇', '试炼'], '秘境遗迹中的高价值奖励与试炼节点。', '奖励应按参考文本限幅，强奖励必须带未鉴定、封印、冷却、污染或竞争者。'),
    mapRecord('map_tournament_arena', '宗门大比演武场', 'arena-template', 'map_bahuang_world', ['宗门大比', '演武场', '擂台'], '用于宗门大比、抽签墙、擂台、长老席和团队试炼。', '适合战斗、社交、资源消耗、长老关注和公开声望变化。'),
    mapRecord('map_task_hall', '任务堂', 'sect-service', 'map_bahuang_world', ['任务堂', '委托', '缺人'], '通用宗门任务入口。', '用于低风险任务领取、队伍组建、时间压力和奖励登记。'),
    mapRecord('map_closed_room', '闭关静室', 'cultivation-room', 'map_bahuang_world', ['闭关', '静室', '内景'], '闭关修炼牌组场景。', '适合丹药化开、心神内景、护法来信、法器认主和梦境触发。')
  ];
}

function mapRecord(id, name, type, parentMapId, tags, summary, description) {
  return {
    id,
    name,
    type,
    parentMapId,
    tags,
    aliases: tags,
    summary,
    description,
    environment: {},
    factionRefs: tags.map((tag) => factionIdForTag(tag)).filter(Boolean),
    npcRefs: [],
    entryPoints: [],
    status: 'active',
    metadata: { sourceRef: 'chc/worldbook-and-rag', conversionLayer: 'structured-map' }
  };
}

function factionIdForTag(tag) {
  if (tag === '碧水宫') return 'faction_bishui';
  if (tag === '灵霄观' || tag === '方家') return 'faction_lingxiao';
  if (tag === '归尘书院') return 'faction_guichen';
  if (tag === '云来楼') return 'faction_yunlai';
  if (tag === '镜月天') return 'faction_jingyue';
  if (tag === '赤焰文氏') return 'faction_chiyan';
  return '';
}

function buildItemRegistryRecords() {
  return [
    itemRecord('item_low_spirit_stone', '下品灵石', 'currency', 'common', '修仙世界常用低阶货币，用于采购、押金、人情和任务结算。', '小额采购可直接结算；大额支取会留下账目、关注或人情债。', { valueScore: 1 }),
    itemRecord('item_patrol_token', '巡海任务令', 'document', 'common', '碧水宫外门或任务堂发放的临时任务凭证。', '可作为合法离宗、登船、进入外岛任务线的理由。', { valueScore: 2 }),
    itemRecord('item_common_talisman', '低阶符箓', 'consumable', 'uncommon', '一次性符箓，常见用途包括避水、传信、警戒、替身或短距遮掩。', '按具体符箓效果消耗；通常只给 +1/+2 条件，不长期常驻。', { powerScore: 2, charges: 1 }),
    itemRecord('item_basic_pill', '低阶丹药', 'consumable', 'uncommon', '恢复、解毒、稳心或辅助修炼的常见丹药。', '使用后应扣除库存；强效果需要副作用、冷却或炼化条件。', { powerScore: 2, charges: 1 }),
    itemRecord('item_spirit_material_pack', '普通灵材包', 'material', 'common', '可合并计数的低阶灵材，不应逐条挤占状态栏。', '用于炼丹、炼器、修复法器或任务交付；普通材料按批次消耗。', { valueScore: 2 }),
    itemRecord('item_bishui_inner_robe', '碧水宫内门弟子法袍', 'clothing', 'uncommon', '李寻道开局资源之一，领口内侧有“研”字针脚。', '提供身份识别和轻微礼法便利；不能当护甲硬吃攻击。', { valueScore: 3, socialBonus: 1 }),
    itemRecord('item_canghai_pages', '沧海横流诀手抄本前六页', 'manual', 'rare', '清研字迹的水法手抄残页，写到第六页后中断。', '可作为修行、鉴定、旧事追查和水法成长入口；不能直接当完整天阶功法。', { valueScore: 5 }),
    itemRecord('item_water_jade_pendant', '水灵玉佩', 'accessory', 'rare', '李寻道十二岁引气成功时清研所赠玉佩。', '公开效果是定位与护身；隐藏上可能连接首饰灵丝，应以未鉴定状态逐步揭露。', { powerScore: 3, valueScore: 5 }),
    itemRecord('item_water_pattern_short_sword', '制式水纹短剑', 'weapon', 'common', '碧水宫外门考核用短剑。', '普通近战/仪式武器；低阶水行术可作为引导物，战斗加值不超过 +1。', { attackBonus: 1, valueScore: 2 }),
    itemRecord('item_auction_catalogue', '蜃楼城拍品目录', 'document', 'uncommon', '地下拍卖或黑市寄售的物品线索目录。', '可提供物品名、估价、卖家遮掩和尾随风险；不直接证明真伪。', { valueScore: 2 })
  ];
}

function itemRecord(id, name, itemType, rarity, description, mechanicalEffect, numericValues) {
  return {
    id,
    name,
    category: itemType,
    itemType,
    rarity,
    tags: ['八荒', itemType],
    aliases: [name],
    description,
    mechanicalEffect,
    lore: '',
    value: {},
    requirements: {},
    grants: {},
    sourceRef: 'chc/RPG配置',
    status: 'active',
    numericValues,
    quantificationDefinition: { referenceDocuments: ['ref_bahuang_item_scale', 'ref_bahuang_reward_resource'] }
  };
}

function buildSpecialItemRegistryRecords() {
  return [
    specialItemRecord('special_tide_bone_core', '封印潮骨器胚', 'sealed-relic', 'rare', '水行成长型器胚，初始应作为未鉴定或封印物，不直接给完整能力。', '可牵引水雾、干扰御器或作为水法成长线索；每次使用应检查认主、封印、污染、追踪或反制。', ['map_bishui_palace'], { powerScore: 5, valueScore: 6 }),
    specialItemRecord('special_heaven_water_fragment', '天阶水法残篇', 'cultivation-fragment', 'rare', '高阶水法残篇，不能开局直接当完整功法。', '需要鉴定、拼合、导师点拨、闭关或实战事件才能转为稳定技能/专长。', ['map_bishui_palace'], { valueScore: 6 }),
    specialItemRecord('special_mother_bead_network', '母珠/禁器网络', 'forbidden-art-device', 'artifact', '禁器暗线核心概念，只能通过权限、污染、反制和事件后果表达。', '不能作为无代价控制工具；涉及控制、人格或傀儡时只做非露骨风险和状态结算。', ['faction_forbidden_network'], { powerScore: 9, valueScore: 9 }),
    specialItemRecord('special_star_lock', '锁星扣', 'sealed-focus', 'rare', '与星命、封锁、观测相关的特殊器物。', '适合做条件事件、观测风险、封印条件或人格状态机锚点；不得提前覆盖角色开局态。', ['faction_lingxiao'], { powerScore: 6, valueScore: 6 }),
    specialItemRecord('special_mirror_moon_key', '镜月残钥', 'dream-key', 'rare', '镜月天、梦境或守阁人线索的入口物。', '用于打开梦境、镜像或记忆场景；真相逐步显现，不直接替玩家选择。', ['map_jingyue_sky'], { powerScore: 5, valueScore: 5 }),
    specialItemRecord('special_water_spirit_jade_anchor', '水灵玉佩定位锚', 'tracking-anchor', 'rare', '水灵玉佩的隐藏层：可能与清研首饰灵丝或碧水宫监测有关。', '未鉴定前只表现为护身与定位；调查后可转入追踪、反追踪或断链事件。', ['bahuang-rag-events'], { powerScore: 4, valueScore: 5 }),
    specialItemRecord('special_frost_sky_sword', '霜天剑', 'signature-weapon', 'rare', '婉悦的身份锚点与剑首象征，失踪或空鞘本身就是线索。', '可作为反抗、身份恢复或剑修试炼入口；不能随意掉落成普通战利品。', ['org_guichen'], { powerScore: 5, valueScore: 6 }),
    specialItemRecord('special_zhaoxue_blade', '照雪刀', 'signature-weapon', 'rare', '方瑶光的刀修身份锚点。', '适合破招、斩断术式、追查符灰；若与灵骸甲线结合需登记穿戴/控制风险。', ['org_lingxiao'], { powerScore: 6, valueScore: 6 }),
    specialItemRecord('special_forbidden_dust', '符灰渗透痕迹', 'forbidden-trace', 'uncommon', '某人长期布设的微弱禁术痕迹，常附着在石板、门扉、器物或指尖。', '用于追踪渗透、识别旧案和触发某人归档；单独不能证明完整真相。', ['faction_forbidden_network'], { valueScore: 4 })
  ];
}

function specialItemRecord(id, name, specialType, rarity, description, mechanicalEffect, questRefs, numericValues) {
  return {
    id,
    name,
    category: specialType,
    specialType,
    rarity,
    tags: ['八荒', 'special', specialType],
    aliases: [name],
    description,
    mechanicalEffect,
    lore: '',
    activation: {},
    charges: {},
    cooldown: {},
    sideEffects: { requiresCostOrRisk: true },
    questRefs,
    boundTo: {},
    lifecycle: { defaultState: 'dormant_or_unidentified' },
    sourceRef: 'chc/RPG配置/世界书/RAG事件库',
    status: 'active',
    numericValues,
    quantificationDefinition: { referenceDocuments: ['ref_bahuang_item_scale', 'ref_bahuang_status_scale'] }
  };
}

function buildSkillRegistryRecords() {
  return [
    skillRecord('skill_basic_water_control', '碧水基础御水术', 'magic', 'wisdom', '基础水修控水、避水、感潮与低阶术法操作。', '水域、潮气、雾气或水行物品相关行动可提供 +1/+2 条件。', { checkBonus: 2 }),
    skillRecord('skill_canghai_intro', '沧海横流诀入门残式', 'magic', 'wisdom', '碧水宫水行功法残式，适合作为成长线。', '未完整修成前只能提供有限水势牵引、防守或破招抓手。', { checkBonus: 2 }),
    skillRecord('skill_star_observation', '星命瞳观测', 'knowledge', 'intelligence', '方家星命与预警方向能力。', '可读取异兆、危险、命数偏移；失败可能增加压力或误判。', { checkBonus: 3 }),
    skillRecord('skill_snowblade_intent', '照雪刀意', 'combat', 'dexterity', '方瑶光相关刀修能力锚点。', '适合破招、斩断术式、压迫敌意；高阶使用需要境界和代价。', { attackBonus: 3 }),
    skillRecord('skill_intel_brokerage', '云来楼情报交易', 'social', 'charisma', '买卖情报、打听风闻、验证线索来源。', '用灵石、人情或交换条件换取入口；不直接揭完整真相。', { checkBonus: 2 }),
    skillRecord('skill_forbidden_art_analysis', '禁器解析', 'knowledge', 'intelligence', '识别禁器、污染、权限、反制入口。', '涉及禁器时用于判断风险、权限和反制，不提供无代价控制。', { checkBonus: 3 }),
    skillRecord('skill_mirror_dream', '镜术与梦境辨识', 'magic', 'wisdom', '镜月天、梦境、幻象、记忆场景相关辨识。', '可分辨梦境层级、镜像提示和隐藏代价。', { checkBonus: 2 }),
    skillRecord('skill_frost_sky_sword', '霜天剑法', 'combat', 'dexterity', '归尘书院婉悦相关剑修锚点。', '用于冷冽、精确、公开对决式剑法；若角色失控，应以残留剑意或反抗裂缝出现。', { attackBonus: 3 }),
    skillRecord('skill_earth_suppression', '坤舆镇压术', 'magic', 'wisdom', '归尘书院土修、封镇、地脉与九幽地眼相关能力。', '可用于镇压、筑阵、稳固封印；强行使用会消耗场景资源或引动地脉压力。', { checkBonus: 3 }),
    skillRecord('skill_artifact_appraisal', '法器鉴定', 'knowledge', 'intelligence', '鉴别灵器、禁器、残篇、符灰、拍品和伪装物。', '鉴定成功只揭示当前层级能力；高阶隐藏层需要更多线索、工具或代价。', { checkBonus: 2 }),
    skillRecord('skill_sect_etiquette', '宗门礼法与身份周旋', 'social', 'charisma', '在宗门、世家、书院和商会中利用身份、礼法和人情推进目标。', '用于降低冲突、争取面见、借调资源；过度使用会增加账目与关注。', { checkBonus: 2 })
  ];
}

function skillRecord(id, name, category, ability, description, mechanicalEffect, numericValues) {
  return {
    id,
    name,
    category,
    ability,
    rankScale: { untrained: 0, entry: 1, trained: 2, expert: 3, master: 4 },
    tags: ['八荒', category],
    aliases: [name],
    description,
    mechanicalEffect,
    prerequisites: [],
    relatedStatusIds: [],
    relatedFeatIds: [],
    sourceRef: 'chc/RPG配置/角色txt',
    status: 'active',
    metadata: {},
    numericValues,
    quantificationDefinition: { referenceDocuments: ['ref_bahuang_action_difficulty', 'ref_bahuang_realm_power'] }
  };
}

function buildFeatRegistryRecords() {
  return [
    featRecord('feat_luck_tide_seed', '逆命潮种', 'fortune', 'legendary', '李寻道可选主角气运。', '危局、冷场、越境或成长节点可提供一次机缘入口，但必须伴随封印、追踪、债务、污染或竞争者。', ['skill_basic_water_control'], { conditionBonus: 2 }),
    featRecord('feat_thunder_heart', '破妄雷心', 'fortune', 'epic', '方澜可选主角气运。', '适合识破遮掩、预警危险和破除迷障；不能让角色全知。', ['skill_star_observation'], { conditionBonus: 2 }),
    featRecord('feat_villain_operations', '反派经营红利', 'strategy', 'epic', '某人视角的幕后经营优势。', '提供组织、资源、代理人和暗线推进能力，同时增加正道追踪与反制。', ['skill_forbidden_art_analysis'], { conditionBonus: 2 }),
    featRecord('feat_identity_young_master', '少宫主身份', 'background', 'novice', '李寻道/清研之子身份带来的低阶资源调度便利。', '小额支取、外门任务、普通通行可简化；大额或敏感事项留下账目与关注。', [], { socialBonus: 2 }),
    featRecord('feat_cross_realm_hook', '越境抓手', 'combat', 'expert', '主角通过克制、法器、地形、偷袭、气运或情报缩小境界差。', '低一大境可正面争胜；低两大境需要至少两项有利条件；低三大境以上通常只做阶段胜利。', [], { conditionBonus: 3 }),
    featRecord('feat_mirror_witness', '镜月见证', 'mystery', 'expert', '胧或镜月天提供的梦境/镜像线索能力。', '提供裂缝和问题，不直接给答案；每次使用都应留下验证任务或代价。', ['skill_mirror_dream'], { conditionBonus: 2 }),
    featRecord('feat_accountable_resources', '资源留痕', 'constraint', 'novice', '宗门身份、母器权限、情报交易和拍卖资源都会留下账目。', '任何强资源调度都应提高关注、人情债、账目或反制风险。', ['skill_intel_brokerage', 'skill_sect_etiquette'], { attentionDelta: 1 }),
    featRecord('feat_original_imprint', '原主印痕', 'mystery', 'expert', '禁术傀儡或人格封印中残留的肌肉记忆、习惯和执念。', '可成为救援、反制、识破伪装或人格裂缝的入口。', ['skill_forbidden_art_analysis'], { conditionBonus: 2 })
  ];
}

function featRecord(id, name, category, tier, description, mechanicalEffect, relatedSkillIds, numericValues) {
  return {
    id,
    name,
    category,
    tier,
    tags: ['八荒', category],
    aliases: [name],
    prerequisites: [],
    description,
    mechanicalEffect,
    grants: {},
    relatedSkillIds,
    relatedStatusIds: [],
    sourceRef: 'chc/视角模板/RAG事件库',
    status: 'active',
    metadata: {},
    numericValues,
    quantificationDefinition: { referenceDocuments: ['ref_bahuang_realm_power', 'ref_bahuang_reward_resource'] }
  };
}

function buildStatusRegistryRecords() {
  return [
    statusRecord('status_pressure', '压力', 'condition', 'variable', 'scene', 'highest', '紧张、追踪、时间压力或战斗压迫。', '通常 0-6 槽；2 明显，4 危险，6 触发强后果。', { pressureDelta: 1 }),
    statusRecord('status_pollution', '污染', 'curse', 'variable', 'conditional', 'highest', '禁器、禁术、污染源或错误炼化带来的长期风险。', '不能只当气氛；应有来源、解除条件、反制入口和后续后果。', { pollutionDelta: 1 }),
    statusRecord('status_unidentified', '未鉴定', 'item-state', 'minor', 'conditional', 'none', '未知功法、法器、丹药、材料或残片的默认状态。', '鉴定前不公开完整能力；鉴定后再迁移到技能、物品或专长。', { severityScore: 1 }),
    statusRecord('status_attention', '被关注', 'faction-clock', 'variable', 'timed', 'highest', '势力、反派、宗门或临时对象注意到玩家行动。', '关注 0-6：2 打听，4 干预，6 追捕、封锁、回收或夺权。', { attentionDelta: 1 }),
    statusRecord('status_persona_instability', '人格失衡', 'mental', 'major', 'scene', 'highest', '人格切换、遮掩破绽、梦境触发或禁器影响的非露骨状态。', '只在明确锚点或事件结算后改变人格态；不得提前套用后期成品态。', { severityScore: 5 }),
    statusRecord('status_control_stability', '控制稳定度', 'forbidden-art-clock', 'variable', 'conditional', 'bounded', '禁器、人格封印、权限托管的稳定程度。', '0 表示无控制，3 表示可运行但有破绽，6 表示强控制但高暴露；过高也会引发反制。', { severityScore: 3 }),
    statusRecord('status_original_imprint', '原主印痕', 'memory-fragment', 'minor', 'conditional', 'highest', '原主习惯、执念、肌肉记忆或旧情感残留。', '可作为识破伪装、救援、反制或剧情裂缝；不等同于完整复活。', { severityScore: 2 }),
    statusRecord('status_resource_debt', '资源债', 'social-debt', 'variable', 'long-term', 'additive-capped', '灵石、人情、账目、宗门资源或黑市交易留下的债。', '资源债会换来追账、传唤、交易条件或势力关注。', { attentionDelta: 1 }),
    statusRecord('status_time_pressure', '时间压力', 'clock', 'variable', 'timed', 'highest', '任务、追捕、拍卖、闭关、封印或势力计时。', '失败不应卡死，而应推动事件、竞争者、风险或代价出现。', { pressureDelta: 1 })
  ];
}

function statusRecord(id, name, category, severity, durationType, stackRule, description, mechanicalEffect, numericValues) {
  return {
    id,
    name,
    category,
    severity,
    durationType,
    stackRule,
    tags: ['八荒', category],
    aliases: [name],
    description,
    mechanicalEffect,
    counters: [],
    immunities: [],
    sourceRef: 'chc/RPG配置/reference_texts',
    status: 'active',
    metadata: {},
    numericValues,
    quantificationDefinition: { referenceDocuments: ['ref_bahuang_status_scale'] }
  };
}

function buildDatabaseIndexText({
  loreRecords = [],
  organizations = [],
  realms = [],
  forbiddenArts = [],
  protagonistTemplates = [],
  npcProfiles = [],
  maps,
  items,
  specialItems,
  skills,
  feats,
  statuses
}) {
  return [
    '# 八荒结构化数据库索引',
    '角色卡和 System 只保留笼统世界观；具体可检索内容进入下列数据库集合。',
    `世界观 world_lore_records：${loreRecords.map((record) => record.title).join('、')}`,
    `势力 organization_registry：${organizations.map((record) => record.name).join('、')}`,
    `境界 realm_registry：${realms.map((record) => record.name).join('、')}`,
    `禁术体系 forbidden_art_registry：${forbiddenArts.map((record) => record.name).join('、')}`,
    `主角模板 protagonist_templates：${protagonistTemplates.map((record) => record.name).join('、')}`,
    `人物 npc_profiles：${npcProfiles.filter((record) => record.level === 'L1').length}名 NPC 的 L1/L2/L3；其中 L3 是高重要背景库，只在永久后果、身份揭露、死亡/背叛/阵营重写、禁器深层绑定或 OOC 纠偏等极少场景读取。`,
    `地图 map_registry：${maps.map((record) => record.name).join('、')}`,
    `普通物品 item_registry：${items.map((record) => record.name).join('、')}`,
    `特殊物 special_item_registry：${specialItems.map((record) => record.name).join('、')}`,
    `技能 skill_registry：${skills.map((record) => record.name).join('、')}`,
    `专长 feat_registry：${feats.map((record) => record.name).join('、')}`,
    `状态 status_registry：${statuses.map((record) => record.name).join('、')}`,
    '兼容人物集合 npc_profile_records / npc_structured_states 继续保留；主角绑定候选在 npc_structured_states.greeting 写入初始处境，未写 greeting 的入口不固定开场；世界书写入 worldbook_entries；事件材料保留在 bahuang-rag-events，按需召回后由工具写库。',
    '数值、DC、战力、奖励和资源消耗先查 reference_texts；结果不确定时使用项目骰子与裁决工具。'
  ].join('\n');
}

function playerStateRecord(view, template) {
  const greeting = view.greeting || inferViewGreeting(view.name);
  return {
    id: `npcstate_${view.id}`,
    npcId: view.id,
    playerId: view.id,
    name: view.name,
    isPlayer: true,
    sceneId: 'scene_viewpoint_entry',
    status: 'entry_template',
    values: {
      hp: 12,
      maxHp: 12,
      focus: 6,
      maxFocus: 6,
      pressure: 0,
      pollution: 0
    },
    statusBar: {
      hp: 12,
      maxHp: 12,
      focus: 6,
      maxFocus: 6,
      conditions: [view.name, '入口模板']
    },
    resources: {
      focus: { name: '专注', amount: 6, max: 6 }
    },
    skillBar: { skills: [] },
    inventory: { items: [] },
    equipment: {},
    specialStatuses: [
      {
        id: 'entry_scope',
        name: '可知范围',
        description: '只知道当前身份合理可知的信息；事件由玩家行动、地点、压力和RAG事件素材推进。'
      }
    ],
    ...(greeting ? { greeting } : {}),
    notes: [
      view.prompt,
      greeting
        ? `绑定 greeting：${greeting}`
        : '绑定 greeting：未写；不固定主角初始处境，由 AI 按当前数据库、玩家声明和场景生成。',
      '这是主角入口模板，只确定玩家入口。玩家选择后按 protagonist_templates、数据库状态和RAG事件素材生成局面。'
    ].join('\n')
  };
}

function profileStateRecord(profile) {
  return {
    id: `npcstate_${profile.npcId}`,
    npcId: profile.npcId,
    name: profile.name,
    isPlayer: false,
    sceneId: 'scene_registry',
    status: 'reference_baseline',
    values: {
      attention: 0,
      trust: 0,
      pressure: 0,
      corruptionRisk: 0
    },
    statusBar: {
      conditions: ['角色资料', profile.realm || '境界未明']
    },
    resources: {},
    skillBar: { skills: [] },
    inventory: { items: [] },
    equipment: {},
    specialStatuses: [
      {
        id: 'profile_reference',
        name: '角色资料',
        description: '登场时先按公开身份、隐藏真相、扮演锚点和当前数据库状态演绎；后期状态由RAG事件素材或工具结算。'
      }
    ],
    notes: profile.summary
  };
}

function relationEdges() {
  return [
    edge('rel_lixundao_qingyan', 'pc_lixundao', 'npc_qingyan', '母子/碧水疑点', 3),
    edge('rel_fanglan_family', 'pc_fanglan', 'npc_fangyaoguang', '姐妹/灵霄方家', 2),
    edge('rel_fanglan_xuanji', 'pc_fanglan', 'npc_fangxuanji', '姐妹/观星疑点', 2),
    edge('rel_fangyaoguang_wuyaping', 'npc_fangyaoguang', 'npc_wuyaping', '母女/宗门继承', 3),
    edge('rel_duguxuan_wanyue', 'npc_duguxuan', 'npc_wanyue', '师徒/归尘书院', 3),
    edge('rel_duguxuan_wenli', 'npc_duguxuan', 'npc_wenli', '师徒/赤焰来客', 2),
    edge('rel_duguxuan_shenruotang', 'npc_duguxuan', 'npc_shenruotang', '师徒/末席弟子', 2),
    edge('rel_mouren_forbidden_network', 'pc_mouren', 'faction_forbidden_network', '幕后操盘/禁器网络', 3),
    edge('rel_mouren_tongquetai', 'npc_mouren', 'faction_tongquetai', '幕后主宰/地下组织', 3),
    edge('rel_tongquetai_forbidden_network', 'faction_tongquetai', 'faction_forbidden_network', '执行层/权限网络', 3),
    edge('rel_tongquetai_sujinniang', 'faction_tongquetai', 'npc_sujinniang', '情报与中转交叉', 2),
    edge('rel_sujinniang_yunlai', 'npc_sujinniang', 'faction_yunlai', '情报枢纽/云来楼', 3),
    edge('rel_long_jingyue', 'npc_long', 'faction_jingyue', '镜月天/梦境线', 2)
  ];
}

function edge(id, sourceNpcId, targetNpcId, relation, weight) {
  return { id, sourceNpcId, targetNpcId, relation, weight };
}

function factionNodes() {
  return [
    { id: 'faction_bishui', factionId: 'faction_bishui', name: '碧水宫', kind: '宗门', summary: '东洲水修宗门，李寻道/清研线核心势力。' },
    { id: 'faction_lingxiao', factionId: 'faction_lingxiao', name: '灵霄观', kind: '正道宗门', summary: '中洲正道重镇，方家线核心势力。' },
    { id: 'faction_guichen', factionId: 'faction_guichen', name: '归尘书院', kind: '书院', summary: '有教无类的修行书院，独孤萱与弟子线核心势力。' },
    { id: 'faction_chiyan', factionId: 'faction_chiyan', name: '赤焰文氏', kind: '世家', summary: '赤焰城世家，文丽出身势力。' },
    { id: 'faction_yunlai', factionId: 'faction_yunlai', name: '云来楼', kind: '商会/情报', summary: '交易与情报枢纽，苏锦娘相关。' },
    { id: 'faction_jingyue', factionId: 'faction_jingyue', name: '镜月天', kind: '隐秘宗门', summary: '镜术、梦境和胧相关势力。' },
    { id: 'faction_forbidden_network', factionId: 'faction_forbidden_network', name: '禁器网络', kind: '暗线', summary: '某人操盘的禁术与禁器暗线，必须受关注度和反制约束。' },
    { id: 'faction_tongquetai', factionId: 'faction_tongquetai', name: '铜雀台', kind: '地下组织', summary: '某人暗中运营的神秘地下组织，多数执行者为禁术傀儡/肉傀儡，负责代理、回收、清理、替换、拍卖暗线与跨洲据点。' },
    { id: 'faction_wandering', factionId: 'faction_wandering', name: '游离角色', kind: '散修/游离', summary: '未稳定归属核心势力的角色和临时对象。' }
  ];
}

function factionMemberships(profiles) {
  return profiles.map((profile) => ({
    id: `fm_${profile.npcId}_${profile.factionId || 'unknown'}`,
    factionId: profile.factionId || 'faction_unknown',
    actorId: profile.npcId,
    role: profile.realm ? `${profile.realm}角色` : '角色基线'
  }));
}

function collection(name, fields, seedRecords) {
  return { name, fields, seedRecords };
}

function field(name, type = 'text', required = false) {
  return { name, type, required };
}

function ragDocument(id, text, metadata = {}) {
  const sanitized = sanitizeText(text || '', { sourcePath: metadata.sourcePath || id });
  report.ragDocuments += 1;
  return {
    id,
    text: sanitized.text || '(empty)',
    metadata: {
      sourceId: id,
      lifecycleScope: 'character',
      characterCardId: CHARACTER_ID,
      lifecycleManaged: true,
      ...sanitizeObject(metadata)
    }
  };
}

function sanitizeText(text, { sourcePath = '' } = {}) {
  let value = String(text || '').replace(/\r\n/g, '\n');
  const highRiskPath = HIGH_RISK_PATH.test(sourcePath);
  let highRisk = highRiskPath;
  let omittedInThisText = 0;
  const lines = value.split('\n').map((line) => {
    let next = line;
    for (const [pattern, replacement] of SAFETY_REPLACEMENTS) next = next.replace(pattern, replacement);
    if (HIGH_RISK_LINE.test(next)) {
      highRisk = true;
      omittedInThisText += 1;
      return '高风险边界：仅用于禁术侵蚀、人格封印、污染、误会、反制或风险结算，不提供露骨细节。';
    }
    return next;
  });
  value = lines.join('\n')
    .replace(/(高风险边界：仅用于禁术侵蚀、人格封印、污染、误会、反制或风险结算，不提供露骨细节。\n?){2,}/g, '高风险边界：连续细节已合并；仅用于禁术侵蚀、人格封印、污染、误会、反制或风险结算。\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  value = adaptSillyTavernRules(value);
  value = stripRemovedTerms(value);
  if (highRiskPath || omittedInThisText > 0) {
    const safePath = sanitizePath(sourcePath);
    if (!report.highRiskFiles.includes(safePath)) report.highRiskFiles.push(safePath);
    report.sanitizedLines += omittedInThisText;
  }
  return {
    text: value,
    highRisk,
    sanitizedLines: omittedInThisText
  };
}

function hasRemovedTerm(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return REMOVED_TERMS.some((term) => raw.includes(term));
}

function stripRemovedTerms(value) {
  if (!value) return '';
  return String(value)
    .replaceAll('、周伯沉默', '')
    .replaceAll('周伯沉默、', '')
    .replaceAll('周伯沉默', '')
    .replaceAll('、周伯线索', '')
    .replaceAll('周伯线索、', '')
    .replaceAll('周伯线索', '')
    .replaceAll('周伯知道旧事', '')
    .replaceAll('、周伯', '')
    .replaceAll('周伯、', '')
    .replaceAll('周伯', '')
    .replaceAll('npc_zhoubo', '')
    .replaceAll('feat_old_servant_clue', '')
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

function adaptSillyTavernRules(value) {
  return String(value || '')
    .replace(/SillyTavern没有真实骰子。禁止要求掷骰，禁止假装给随机点数。使用无骰阶位判定：/g, 'AI DND 有真实骰子和裁决工具。低风险行动可直接推进；结果不确定、风险较高或玩家要求公平裁决时，使用项目骰子/裁决工具：')
    .replace(/禁止要求掷骰/g, '需要随机性时使用项目骰子')
    .replace(/禁止掷骰/g, '需要随机性时使用项目骰子')
    .replace(/不要要求掷骰/g, '需要随机性时使用项目骰子')
    .replace(/禁止假装给随机点数/g, '随机点数应由项目骰子工具生成')
    .replace(/不掷骰/g, '不必每次掷骰，必要时使用项目骰子')
    .replace(/无骰判定/g, '骰子/工具裁决')
    .replace(/无骰裁定/g, '骰子/工具裁决')
    .replace(/无骰兜底/g, '骰子/工具兜底')
    .replace(/每轮回复末尾输出【角色状态】/g, '如需要人工摘要可输出【角色状态】')
    .replace(/每轮回复末尾必须输出【状态记录】/g, '如需要人工摘要可输出【状态记录】；长期变化优先写入数据库/工具')
    .replace(/必须写入【角色状态】/g, '应写入数据库/工具，必要时补充角色状态摘要')
    .replace(/每轮必须在回复末尾维护固定【状态记录】[^。\n]*。?/g, '长期变化优先写入数据库/工具；可按需输出简短状态摘要。')
    .replace(/每轮必须维护末尾【状态记录】/g, '长期变化优先写入数据库/工具')
    .replace(/每轮必须维护【状态】[^。\n]*。?/g, '长期变化优先写入数据库/工具；可按需输出简短状态摘要。')
    .replace(/【状态记录】是下一轮唯一可信的当前状态缓存/g, '聊天数据库、工具结果和最近状态摘要共同构成当前状态缓存')
    .replace(/最新【状态记录】优先/g, '当前聊天数据库、工具结果和最近状态摘要优先')
    .replace(/以最新【状态记录】为准/g, '以当前聊天数据库、工具结果和最近状态摘要为准')
    .replace(/不得覆盖最新【状态记录】/g, '不得覆盖当前聊天数据库和工具结果')
    .replace(/必须写进下一轮【状态记录】/g, '应写入数据库/工具，必要时补充状态摘要')
    .replace(/必须写入【演绎】/g, '应写入演绎相关数据库或状态摘要')
    .replace(/写入【演绎】/g, '写入演绎相关数据库或状态摘要')
    .replace(/写入【角色】或【世界】/g, '写入角色、世界或数据库摘要')
    .replace(/在【角色】或【世界】写明/g, '在角色、世界或数据库摘要中写明')
    .replace(/强制模型每轮维护/g, '供人工按需维护')
    .replace(/最适合强制每轮输出/g, '仅在需要人工摘要时使用')
    .replace(/固定状态记录/g, '可选状态摘要');
}

function sanitizeInline(value) {
  return sanitizeText(value).text.replace(/\s+/g, ' ').trim();
}

function sanitizePath(value) {
  let output = String(value || '');
  for (const [pattern, replacement] of SAFETY_REPLACEMENTS) output = output.replace(pattern, replacement);
  return stripRemovedTerms(output)
    .replace(/成人随机事件/g, '高风险随机事件')
    .replace(/邪恶成人事件/g, '高风险暗线事件')
    .replace(/随机成人事件/g, '随机高风险事件')
    .replace(/幸运越界者事件/g, '误会奇遇事件')
    .replace(/固定触发事件/g, '条件事件素材')
    .replace(/新手教程/g, '开局事件素材')
    .replace(/教程/g, '事件素材')
    .replace(/状态栏模板/g, '状态模板来源');
}

function sanitizeObject(value) {
  if (typeof value === 'string') return sanitizeText(value).text;
  if (Array.isArray(value)) return value.map(sanitizeObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeObject(item)]));
  }
  return value;
}

async function listFiles(root, { extensions, maxDepth = 99 } = {}) {
  const output = [];
  await walk(root, 0);
  return output.sort((a, b) => rel(a).localeCompare(rel(b), 'zh-Hans-CN'));

  async function walk(dir, depth) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (!extensions || extensions.includes(extension)) output.push(fullPath);
        if (extension === '.txt') report.txtFiles += 1;
        if (extension === '.json') report.jsonFiles += 1;
      }
    }
  }
}

function findRoleFile(files, keywords) {
  return files.find((file) => keywords.every((keyword) => basename(file).includes(keyword)));
}

function extractRealm(text) {
  const match = String(text || '').match(/(化神期|元婴巅峰|元婴期|金丹期|筑基期|炼气十层|炼气期|境界不明|高阶)/);
  return match?.[1] || '';
}

function summarize(text, max = 500) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function safeStructuredDigest(text, max = 500) {
  const cleaned = adaptSillyTavernRules(String(text || ''))
    .replace(/\[非露骨改写：[^\]]+\]/g, '')
    .replace(/高风险边界[^。\n]*。?/g, '')
    .replace(/\{[^{}]{0,180}\}/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/#+/g, '')
    .replace(/\r\n/g, '\n');
  const lines = cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !RUNTIME_DIGEST_BLOCKLIST.test(line))
    .filter((line) => !HIGH_RISK_LINE.test(line))
    .filter((line) => !/REG|TUT|固定触发|新手教程|教程|状态记录|状态栏|开局注册|重要角色注册|每轮|无骰/.test(line))
    .filter((line) => line.length <= 160)
    .slice(0, 6);
  const digest = lines.join('；');
  return summarize(digest, max);
}

function titleFromPath(file) {
  return sanitizeInline(basename(file, extname(file)).replace(/_/g, ' '));
}

function inferTriggerFromName(file) {
  const name = basename(file, extname(file));
  if (/^I\d+/.test(name)) return '玩家追查、地点匹配、线索命中或随机事件检定命中';
  if (/^T\d+/.test(name)) return '后期状态素材：仅在地点/线索/压力/随机检定命中后进入事件素材池';
  if (/^F\d+/.test(name)) return '势力/反派关注计时';
  if (/^L\d+/.test(name)) return '长期事件进度';
  if (/^G\d+/.test(name)) return '当前视角具备气运/金手指且随机奇遇或危机条件命中';
  if (/^RB/.test(name)) return '角色首次登场或玩家质疑OOC';
  return '地点、压力、势力计时或玩家目标匹配时';
}

function recommendedInputForView(name) {
  if (name.includes('李寻道')) return '我以李寻道/清研之子的身份，从碧水宫外门开局，并启用逆命潮种金手指。';
  if (name.includes('方澜')) return '我以方澜的视角，从灵霄观疑心线开局，并启用破妄雷心气运。';
  if (name.includes('某人')) return '我以某人的视角，从禁器网络幕后开局，启用反派经营红利。';
  return '我以自定义天命散修身份开局，请给我两个带代价的成长型金手指。';
}

function inferImportedAs(sourcePath) {
  if (sourcePath.includes('RAG事件库')) return 'runtimeRag/event_material';
  if (sourcePath.includes('世界书')) return 'character_book/worldbook_entries/runtimeRag';
  if (sourcePath.includes('角色卡')) return 'characterCard/source';
  if (sourcePath.includes('视角模板')) return 'viewpoint_templates/runtimeRag';
  if (sourcePath.includes('状态栏模板') || sourcePath.includes('状态模板来源')) return 'source_only_not_runtime_imported';
  if (/\.(png|jpg|jpeg|webp)$/i.test(sourcePath)) return 'visual_assets';
  if (sourcePath.includes('重要事件')) return 'npc_profiles.L3/npc_profile_records/runtimeRag';
  if (sourcePath.includes('角色')) return 'npc_profiles.L1-L3/npc_profile_records/runtimeRag';
  return 'conversion_source_index';
}

function mimeType(file) {
  const extension = extname(file).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.map((item) => sanitizeInline(item))
      .filter((item) => item && !item.startsWith('高风险边界'))
    : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hash(value, length = 10) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, length);
}

function rel(path) {
  return sanitizePath(relative(ROOT, path).split(sep).join('/'));
}

function rawRel(path) {
  return relative(ROOT, path).split(sep).join('/');
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

async function readText(path) {
  return readFile(path, 'utf8');
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildInstructions() {
  return `# 八荒RPG AI DND整合存档导入说明

## 导入文件

在前端 Chat 页面右侧角色区点击“导入”，只填写角色卡路径：

\`\`\`text
chc/AI_DND导入版存档latest/八荒RPG_最终导入存档.bundle.json
\`\`\`

不要再单独填写 sidecar 路径。这个 bundle 已经内含角色卡、少量世界书索引、数据库、RAG事件素材、世界观、势力、境界、禁术体系、主角模板、人物、地图、物品、特殊物、技能、专长、状态和视觉资源引用。

## 新建聊天后选择谁

弹出“选择玩家 NPC 设定”时，可以选择：

- \`视角未定\`：保留原多视角入口，第一轮声明身份。
- \`李寻道\`：碧水宫/清研之子开局。
- \`方澜\`：灵霄观疑心线开局。
- \`某人\`：幕后禁器网络视角。
- \`自定义角色\`：自定义天命散修、宗门弟子或其它身份。

## 推荐第一句话

\`\`\`text
我以李寻道/清研之子的身份，从碧水宫外门开局，并启用逆命潮种金手指。
\`\`\`

\`\`\`text
我以方澜的视角，从灵霄观疑心线开局，并启用破妄雷心气运。
\`\`\`

\`\`\`text
我以自定义天命散修身份，从蜃楼城黑市开局，给2个带代价的成长型金手指。
\`\`\`

## 文件整合方式

- 多视角版角色卡：只抽取笼统世界观、文风和入口，不再把 SillyTavern 长 System 当成运行规则。
- 多视角版世界书：写入角色卡 \`character_book\`，并同步进 \`worldbook_entries\` 和 RAG。
- 多视角版 RAG事件库：改写为随机/条件事件素材，只写入 \`bahuang-rag-events\`；不生成开局待办，也不初始化为聊天事件记录。
- \`chc/世界书.txt\`：拆入 \`world_lore_records\`、\`organization_registry\`、\`realm_registry\` 和 \`forbidden_art_registry\`。
- \`{{user}}主角卡*.txt\` 与多视角模板：拆入 \`protagonist_templates\`，用于选择可跑的主角入口；可固定的入口同时写入 \`greeting\`，主角绑定候选也写入 \`npc_structured_states.greeting\`。没有 \`greeting\` 的入口不固定初始处境，由 AI 按玩家声明和数据库生成。
- chc 根目录角色 txt：写入项目原生 \`npc_profiles\` L1/L2/L3、兼容集合 \`npc_profile_records\` 和 \`bahuang-character-baselines\`。L3 是高重要背景库，只在永久后果、身份揭露、死亡/背叛/阵营重写、禁器深层绑定或 OOC 纠偏等极少场景读取。
- 地点/地图：写入 \`map_registry\`。
- 普通物品：写入 \`item_registry\`。
- 特殊物、禁器、残篇、钥匙类入口：写入 \`special_item_registry\`。
- 技能/功法动作：写入 \`skill_registry\`。
- 专长/气运/身份优势：写入 \`feat_registry\`。
- 状态/污染/关注/未鉴定等：写入 \`status_registry\`。
- 视角模板：写入 \`viewpoint_templates\`，并生成可选玩家主角。
- 旧状态输出模板：不再作为运行资料导入；当前状态以聊天数据库、工具结果和必要的简短摘要为准。
- 数值参考文本：写入 \`reference_texts\`，并同步进 \`bahuang-reference-texts\`。GM 或工具给战力、DC、物品强度、状态强度、奖励价值、资源消耗写数值前，应先读这里。
- 图片：写入 \`visual_assets\` 作为路径引用，不会自动渲染。

## 参考文本怎么用

- 前端数据面板里查看 \`reference_texts\` 集合。
- RAG 检索里可搜 \`bahuang-reference-texts\`。
- 调用 \`system.item_registry.*\` 或 \`system.mechanics_registry.*\` 生成 \`numericValues\` 时，把相关记录复制为 \`quantificationDefinition.referenceDocuments\` 或工具入参 \`referenceText\`。
- 需要随机性或公平裁决时使用 AI DND 的骰子/裁决工具，不沿用 SillyTavern 纯无骰限制。
- 参考文本是量尺，不是硬套数值；明确的功法、法器、境界、认主、封印、权限和反制仍优先。

## 内容边界

原始 SillyTavern 文件中部分内容包含高风险来源、非自愿控制或身体羞辱细节。AI DND整合存档不会逐字迁移这些内容；它们已降级为非露骨的禁术侵蚀、人格封印、精神压制、污染、傀儡化风险或随机/条件事件摘要。
`;
}

function buildReport() {
  return `# CHC 到 AI DND 转换报告

## 输出文件

- \`${rel(BUNDLE_PATH)}\`
- \`${rel(COMPAT_BUNDLE_PATH)}\`
- \`${rel(INSTRUCTIONS_PATH)}\`
- \`${rel(REPORT_PATH)}\`

## 输入统计

- 角色 profile：${report.characterProfiles}
- 世界书条目：${report.worldbookEntries}
- RAG / prompt 文档：${report.ragDocuments}
- 图片引用：${report.imageFiles}
- 高风险源文件数量：${report.highRiskFiles.length}
- 被降级/合并的高风险文本行：${report.sanitizedLines}

## 转换策略

- 角色卡和 System Prompt 只保留笼统世界观、文风、项目工具使用提醒和内容边界；不再承载 SillyTavern 长规则、旧状态输出格式、教程流程或预设任务线。
- \`SillyTavern导入版_八荒RPG_多视角版\` 的世界设定、事件素材和视角模板被拆入数据库、少量世界书索引、runtime RAG 和参考文本；旧状态栏和开局确认流程不作为运行资料导入。
- \`chc/世界书.txt\` 被拆成世界观、势力、境界和禁术体系数据库，供 Agent Loop/RAG/工具按需读取。
- \`{{user}}主角卡*.txt\` 与多视角模板被拆成主角模板数据库，开局时不再靠长 prompt 强塞身份。
- \`chc/<角色名>/*.txt\` 提供 NPC 硬锚、口吻、情景、开场、事件目录和重要事件。
- 人物写入项目原生 \`npc_profiles\` L1/L2/L3、兼容集合 \`npc_profile_records\` 和 \`npc_structured_states\`；L3 是高重要背景库，只在永久后果、身份揭露、死亡/背叛/阵营重写、禁器深层绑定或 OOC 纠偏等极少场景读取。
- 地图写入 \`map_registry\`；普通物品写入 \`item_registry\`；特殊物写入 \`special_item_registry\`；技能写入 \`skill_registry\`；专长写入 \`feat_registry\`；状态写入 \`status_registry\`。
- 世界观写入 \`world_lore_records\`；势力写入 \`organization_registry\`；境界写入 \`realm_registry\`；禁器/禁术体系写入 \`forbidden_art_registry\`；主角入口写入 \`protagonist_templates\`。主角初始处境写 \`greeting\`；未写则不固定，让 AI 按当前数据库和玩家声明生成。
- \`reference_texts\` / \`bahuang-reference-texts\` 提供战力、DC、物品、状态、奖励和资源消耗量尺，供工具 \`referenceText/referenceDocuments\` 使用。
- AI DND 有骰子和裁决工具，转换后的参考文本不再沿用 SillyTavern 纯无骰限制。
- 角色后期状态不作为开局当前状态，只进入 profile、RAG 或人物故事线素材。
- 聊天数据库和工具结果是运行时最高优先级；旧状态输出模板不作为运行资料导入。
- 原始高风险/露骨/非自愿细节不逐字保留，统一降级成非露骨禁术风险。

## 高风险源文件

${report.highRiskFiles.map((file) => `- \`${file || '(inline)'}\``).join('\n') || '- 无'}
`;
}
