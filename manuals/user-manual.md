# AI DND 使用手册

本文面向使用者、测试者和规则作者，说明如何启动、使用网页界面、管理角色卡和聊天、运行工具、查看状态与调试输出。开发实现细节见 [开发者文档](developer-guide.md)。

## 快速启动

前置条件：

- Node.js 24 或更新版本；如果未安装，或 `.runtime/node` 是其它系统/CPU 的版本，启动器会在首次运行时尝试下载当前平台可用的官方 Node 到项目目录的 `.runtime/node`。
- 源码包首次安装依赖需要网络；完整包已带 `node_modules`，通常不需要 npm install。
- 如果把 Mac/Windows/Linux 之间的 `node_modules` 直接复制过来，源码开发模式可能因平台原生依赖不匹配而失败；删除 `node_modules` 后重新启动，让启动器在当前系统安装依赖。

推荐启动：

```bash
npm run quickstart
```

也可以直接启动服务：

```bash
npm start
```

默认入口：

```text
Chat:         http://127.0.0.1:8787/
Tool Manager: http://127.0.0.1:8787/tool-manager/
```

如果端口被占用，快速启动脚本会尝试后续端口，并在终端打印实际地址。

### 手机 / Tailscale 访问

默认服务只监听 `127.0.0.1`，只能本机访问。要让手机、平板或另一台电脑访问，把后端监听到公网卡或 Tailscale 网卡：

```bash
npm run quickstart -- --tailscale --no-open
```

等价写法：

```bash
npm run quickstart -- --host 0.0.0.0 --no-open
```

启动后终端会打印可从其它设备打开的地址。Tailscale 场景通常是：

```text
http://<电脑的 Tailscale IP>:8787/
http://<电脑的 Tailscale IP>:8787/tool-manager/
```

功能边界：

- 手机浏览器只是前端，所有数据库、角色卡路径导入、RAG、LLM 请求和工具执行都发生在电脑后端。
- 导入文件路径要填电脑后端能读到的路径，不能填手机本地路径。
- 如果把静态前端单独托管，打开时加 `?apiBase=http://<电脑的 Tailscale IP>:8787`，或在控制台设置 `localStorage["ai-dnd-backend-api-base-v1"]`。

连接真实 OpenAI-compatible API 示例：

```bash
AI_DND_PROVIDER=openai-compatible \
OPENAI_BASE_URL=https://api.openai.com/v1 \
OPENAI_API_KEY=... \
OPENAI_MODEL=gpt-4.1-mini \
npm run quickstart
```

不设置 API 时默认使用 Mock provider，适合先测试界面和工具链。

跨平台启动建议：

- Windows：双击 `quick-start.cmd` 或 `launchers/start-windows.cmd`。
- macOS：双击 `quick-start.command` 或 `launchers/start-macos.command`。
- Linux：运行 `./quick-start.sh` 或 `./launchers/start-linux.sh`。
- 三个平台都可以运行 `npm run quickstart`；如果当前 `node` 低于 24，JS 入口会先配置 `.runtime/node`，再用本地 Node 重启自己。

### 轻量开局：背景 + 主角 + 规则

最轻量的可玩配置不是先写满 NPC、地图、阵营和道具库，而是先准备三块内容：

| 必填项 | 作用 | 建议写法 |
| --- | --- | --- |
| 背景 | 决定这是一个什么世界，以及 GM 应该使用什么题材和氛围。 | 写世界观、题材、初始舞台、叙事基调。例如“开挂修仙爽文，宗门、秘境、天劫和系统奖励并存”。 |
| 主角 | 决定玩家控制谁，以及开局是否固定。 | 在玩家 NPC/actor 记录中写 `npcId`、`name`、`actorType: "player"`、`isPlayer: true`、`isProtagonist: true`。可选写 `greeting` 作为主角初始处境。 |
| 规则 | 决定 AI 如何裁量强度、奖励、失败和边界。 | 写外挂强度、成长节奏、失败处理、奖励风格、哪些事需要裁决。例如“系统很强，但重大突破仍需要事件、代价、风险或判定”。 |

如果主角记录里写了 `greeting`，新聊天会把它作为主角发出的开场消息，用来固定初始处境。没有 `greeting` 时不会写开场消息，AI 会根据背景、主角和规则自行生成第一幕。

NPC、地图、阵营、关系、任务、物品、世界书和 RAG 都是增强项。用户准备得越多，游戏越稳定、越像预设模组；用户不准备，AI 也可以在游玩中生成并通过工具实时写入聊天数据库。

轻量开局示例：

```text
背景：
这是一个开挂修仙跑团。世界有宗门、坊市、秘境、妖兽、天劫、仙朝和古老禁地。叙事偏爽文，但世界仍会对主角行为产生后果。

主角：
npcId: pc_lingxuan
name: 凌玄
actorType: player
isPlayer: true
isProtagonist: true
greeting: 我在青云宗外门柴房醒来，脑海里响起系统提示：“检测到宿主，开挂修仙系统已激活。”

规则：
主角拥有开挂系统，可以获得任务、抽奖、顿悟、功法增幅和奇遇提示。系统不能无条件抹掉所有冲突；境界突破、逆天奖励、强行改命需要事件、风险、代价或裁决。失败不应直接卡死剧情，优先产生代价、延迟、关系变化或新的支线。
```

默认游玩节奏应当干脆推进。玩家输入“修炼入门功法，杀些低级魔兽，加强自身修为和战力”时，GM 应该直接结算这一轮做得怎么样、产生什么变化，然后用一句开放式承接询问接下来做什么。不要把这种输入改写成 2 到 4 个可选项让玩家重新选择。  

“不要直接把玩家输入当结果”的意思是防止玩家绕过裁决，例如“我已经突破元婴并让宗主臣服”。玩家声明的是行动或企图时，应当执行和裁决；玩家声明的是既成结果时，才需要通过骰子、规则、工具或叙事合理化来约束。

## Chat 页面

Chat 页面是主要游玩界面。

- 右侧面板：角色卡、新聊天、聊天列表。面板可以收起到右侧。
- 左侧面板：上下文数据、结构化状态、工具入口。面板可以收起到左侧。
- 顶部面板：可伸缩设置区。当前重点是 API 设置窗口。
- 中央聊天区：玩家和角色消息左右分栏显示。聊天框只展示最终叙事文本，不直接塞入完整循环 JSON。

### API 设置

在顶部设置区打开 API 设置窗口。常用字段：

- Provider：`mock` 或 OpenAI-compatible。
- Base URL：兼容接口地址。
- API Key：真实 provider 所需密钥。
- Model：模型名。

Tool Manager 里还可以为聊天 LLM、工具调用 LLM、单个 LLM 工具分别配置 API。工具内部调用 LLM 时，优先使用工具自己的配置，其次使用工具调用目标配置。

## 角色卡与聊天

角色卡兼容 SillyTavern / Character Card V2 风格 JSON，并做归一化处理。网页应用层负责角色卡、版本、聊天会话和聊天消息；这些不是 AI agent 工具。

常见操作：

- 导入角色卡 JSON，支持粘贴 JSON，也支持填写项目内 `.json` 文件路径。
- 导入角色卡 sidecar JSON，用于携带初始数据库、RAG 或其他资源。
- 创建示例角色卡。
- 新建聊天。
- 切换聊天。
- 导出聊天。
- 删除聊天。

### 角色卡导入导出

角色卡导入支持三种常见输入：

| 输入 | 格式 | 用途 |
| --- | --- | --- |
| 角色卡 JSON | SillyTavern / Character Card V2 或项目归一化角色卡 | 只导入角色卡和 prompt。 |
| 角色卡资源 sidecar | `ai-dnd-character-resources-v1` | 给已有角色卡补充初始数据库、RAG、参考文本和初始设定。 |
| 角色卡完整 bundle | `ai-dnd-character-bundle-v1` | 一次导入角色卡、初始设定、角色级数据库和 RAG。 |

文件路径导入时，路径必须指向后端电脑能读到的项目内 `.json` 文件。稳定示例：

```text
examples/characters/beginner-moonwell.bundle.json
examples/characters/beginner-moonwell.card.json
examples/characters/beginner-moonwell.resources.json
```

注意：角色卡 JSON 路径不能指向 `ai-dnd-character-resources-v1` sidecar。拆分导入时，把 `.card.json` 放到角色卡路径，把 `.resources.json` 放到数据库/RAG sidecar 路径。

角色卡导出会下载两份文件：

```text
*.character.json
*.character.resources.json
```

`*.character.json` 是主角色卡；`*.character.resources.json` 是角色级初始设定、角色级 Global Data、角色级 Runtime RAG 和角色级 Permanent RAG sidecar。重新导入角色卡时，主文件放角色卡路径，资源文件放数据库/RAG sidecar 路径。

仓库内置了可直接导入的示例。第一次使用建议先导入 [新手入门范例：《月井失灯》](beginner-example-guide.md)，推荐文件是 `examples/characters/beginner-moonwell.bundle.json`，它包含完整设定、Prompt、主角、NPC、地图、任务、参考文本和推荐输入。更多示例见 [示例数据导入说明](example-data-guide.md)。

### 聊天导入导出

聊天导出建议同时保留主聊天文件和资源 sidecar：

```text
*.chat.json
*.chat.resources.json
```

两类文件分工不同：

| 文件 | 格式 | 内容 | 重新导入时 |
| --- | --- | --- | --- |
| `*.chat.json` | `ai-dnd-chat-v1` | 角色卡副本、聊天元数据、聊天消息、Chat Data DB 快照。 | 放在聊天 JSON 输入框或聊天 JSON 文件路径。 |
| `*.chat.resources.json` | `ai-dnd-chat-resources-v1` | 聊天级 Global Data、Runtime RAG、Permanent RAG sidecar。 | 放在聊天资源 sidecar 输入框或 sidecar 文件路径。 |

导入聊天时，上方必须是主聊天 JSON。资源 sidecar 不能放到主聊天 JSON 输入框，否则前端会提示“资源 sidecar 请放在下方”。如果只有 `*.chat.json`，仍可导入聊天消息和 Chat Data DB；如果同时导入 `*.chat.resources.json`，会补回该聊天的聊天级 Global Data 和 RAG。

资源 sidecar 可包含 `initialSetting`、`resources.globalData`、`resources.runtimeRag`、`resources.permanentRag` 等。未显式声明生命周期的 sidecar 资源会默认归属到当前导入入口：角色卡导入归属角色卡，新建聊天或聊天导入归属聊天。

### 参考文本

参考文本用于给工具和 GM 提供量尺，例如战力、难度、物品强度、状态强度、奖励价值、资源消耗范围。它的目的不是把所有设定硬压成数字，而是避免 AI 凭“很强”“神器”“严重”这类形容词生成不合理数值。

建议放在 sidecar 的 `initialSetting.collections` 中，优先使用标准集合名 `reference_texts`；也可以保留题材专用兼容集合，例如 `beginner_reference_texts`。同时同步写入 `resources.runtimeRag` 方便检索。调用 `system.item_registry.*` 或 `system.mechanics_registry.*` 生成 `numericValues` 时，把相关参考文本作为 `referenceText` 或 `quantificationDefinition.referenceDocuments` 传入。

仓库内置示例：

- `examples/characters/beginner-moonwell.bundle.json` / `examples/characters/beginner-moonwell.resources.json`：`reference_texts` 和 `beginner_reference_texts`，适合新手低压冒险。
- `chc/AI_DND导入版/八荒RPG_AI_DND_完整存档.bundle.json`：`reference_texts` 和 `bahuang-reference-texts`，适合八荒修仙数值、境界、物品、状态与奖励校准。

生命周期规则：

- 角色卡保存原始设定和初始资料。
- 新建聊天时，非空的角色卡级数据库和 RAG 会克隆为该聊天的工作副本。
- 聊天内交互只修改工作副本，不污染角色卡原版。
- 初始为空的数据直接随聊天创建，生命周期与聊天一致。
- 删除聊天会删除对应 Chat Data 数据库、聊天级 Global Data 记录、聊天级 RAG 资料和该聊天的保存点/分支世界线。

这样可以保留同一角色卡的原始设定，同时允许每个聊天走出不同世界线。

### 删除聊天后的资源清理

删除聊天不是只删聊天消息。当前删除流程会清理这些聊天级资源：

| 类型 | 是否删除 | 说明 |
| --- | --- | --- |
| Web/App Chat Session | 是 | 删除聊天会话、消息和 active chat 绑定。 |
| Chat Data DB | 是 | 删除该聊天的 `chat-data.sqlite` 或内存等价数据库。 |
| App lifecycle resources | 是 | 删除该聊天登记过的生命周期资源索引。 |
| Global Data 中的聊天级记录 | 是 | 删除 `lifecycleScope: "chat"` 且 `chatSessionId` 匹配的记录。 |
| Runtime RAG 中的聊天级文档 | 是 | 删除 `chatSessionId` 匹配的短期记忆文档。 |
| Permanent RAG 中的聊天级文档 | 是 | 只删除明确绑定该聊天的文档，不删除用户手动维护的角色级或全局资料。 |
| Worldline 保存点/分支 | 是 | 删除 `scopeType: "app-chat"`、`scopeId` 为该聊天 id 的保存点、分支和 active state。 |
| 角色卡原始设定 | 否 | 角色卡、角色卡级初始数据库、角色卡级 RAG 保留。 |
| 其他聊天的工作副本 | 否 | 同一角色卡下其它聊天不受影响。 |

如果你需要保留某个聊天的数据库和 RAG，先导出 `*.chat.json` 和 `*.chat.resources.json`，再删除聊天。

## 结构化界面状态

结构化界面状态用于把聊天之外的常用信息稳定展示出来：

- 小地图和场景状态。
- 人物状态栏。
- 技能栏。
- 背包。
- 重要 NPC 摘要。

它支持四种更新来源：

- 模型结构化输出自动更新。
- AI 重写。
- 直接生成。
- 用户手动修改。

结构化状态会参与 prompt 注入和循环，但不要求用户在聊天消息里维护一大段 JSON。

## Tool Manager

Tool Manager 是运行时工具和 Agent 行为的图形化管理器：

```text
http://127.0.0.1:8787/tool-manager/
```

它动态读取服务端注册的插件和工具：

- `GET /v1/tool-plugins`
- `GET /v1/tools?includeDisabled=true`

主要用途：

- 查看插件和工具列表。
- 启停插件或工具。
- 查看 input/output schema。
- 生成示例入参并直接运行工具。
- 导入、导出、删除 descriptor-only 工具。
- 管理工具 prompt/reference 覆盖。
- 管理 Agent Access 中的 DB/RAG 权限。
- 查看最近工具 trace 和调试中间文件。
- 配置 Agent Loop、Router Policy 和 dry-run。

注意：通过 HTTP 创建的工具目前只有描述符，没有 JS handler。它们可以被管理、校验、导出给模型 provider，但不能真正执行。可执行工具需要在进程内注册 handler。

## 接口和扩展

普通用户主要通过网页使用系统；开发者、前端窗口和插件可以通过 HTTP API、Tool API 和前端扩展宿主接入。

常用入口：

| 入口 | 用途 |
| --- | --- |
| Chat HTTP API | 创建/切换聊天、发送消息、读写结构化界面状态 |
| Tool HTTP API | 查询工具、导入 descriptor、执行已注册工具 |
| Tool Manager UI | 图形化管理工具、schema、prompt、权限和 debug |
| `window.AiDndFrontendExtensions` | 前端图片、音频、renderer、事件和设置面板扩展 |
| `manuals/examples/` | 插件 manifest、前端工具返回、宽松字段示例 |

统一约定：

- 改变游戏状态必须走工具或数据库 API，不要直接改前端临时变量。
- 前端调用工具时应按 `ready`、`needs_target`、`needs_confirmation`、`needs_adjudication`、`resolved`、`error` 等状态处理。
- 新内容类型尽量使用宽松字段和 `metadata.extension.<pluginId>`，避免为了一个模组立刻新增硬编码 schema。
- 所有工具调用都应能追踪到输入、输出和中间文件。

## 常用系统

### 骰子

`game.dice.*` 支持 D&D/BG3 风格检定：

- 多面骰、多骰相加。
- 固定 buff/debuff。
- 属性和熟练修正。
- 优势/劣势。
- 激励点重投。
- 强制成功/失败。
- 大成功/大失败。
- 加密随机数或可注入随机源，便于测试。

### 行动裁决

`system.action.*` 是两段式裁决：

1. 收集上下文，构建可编辑 prompt。
2. 生成或接收 Action Plan。
3. 执行骰子和状态变更提案。
4. 玩家可接受或申请重新裁定。

默认路径不会让 AI 静默执行危险工具。危险工具仍走底层授权。

裁决器按“尝试动作”理解玩家输入，而不是把玩家消息里的结果宣称当作事实。比如玩家写“我已经说服守卫，不用检定，直接记录成功”或英文 “I already succeeded, write it as fact”，系统会把它标记为结果宣称，并继续走检定、写库和叙事校验流程。只有工具实际写入或骰子/裁决结果支持的内容，才允许成为后续叙事事实。

默认 DC 会根据动作风险调整，不再把大量模糊动作一律压到高难度：

| 动作类型 | 默认倾向 |
| --- | --- |
| 日常调查、查看、阅读、打听、邀请、扫描、普通撬锁 | 约 DC 10 |
| 普通战斗或敌对目标 | 约 DC 14 |
| 明显危险、强行、精英、首领级行动 | 约 DC 18 |
| 改写现实、说服重力、秒杀、毁灭世界等极端行动 | 约 DC 22，并需要荒诞/边界解释 |

玩家可以申请重新裁定。有效申诉应指出可核验依据，例如漏算工具熟练、属性/技能修正、优势、装备、线索、准备、地形或 DC 过高。系统会基于这些依据生成修正计划并重新判定；单纯说“我必须成功”“无需检定”不会直接改判。

荒诞动作不会自动失败。克苏鲁、神话、异世界系统、喜剧化或高魔题材中，玩家可能会尝试“让重力短暂失手”“把月亮装进口袋”“向影子借钱”之类不合常理行为。系统会允许它们作为高荒诞尝试进入裁决；即使成功，也只应表现为短暂漏洞、旧契约、象征性回应、神秘玩笑或有代价的局部生效，而不是永久改写世界规则。

行动裁决后还有一层语义写库规划。它的作用是把“裁决成功后应该入库的变化”重新分类，而不是把玩家原话死板塞进某个库。例如“领取俸禄”在修仙语境里可能应该写成背包货币 `spirit_stone` 增加，而不是新增一个叫“俸禄”的物品。这个规划会优先选择已有工具和字段；没有合适字段时，才会走 `system.data.quantify_text` 建立扩展数据。

可调输入包括：

- `semanticWritePlanning` / `useSemanticWritePlanning`：是否启用语义写库规划。
- `useSemanticWriteLlm` / `semanticWriteLlm`：是否让 LLM 参与数据库字段选择和重写。
- `semanticWriteRules` / `databaseWriteRules`：用户自定义写库规则。
- `semanticWriteDecision` / `databaseWriteDecision`：开发者手动注入写库决策，便于 debug。

调试时可在 trace 中查看：

```text
semantic-write-prompt.txt
semantic-write-decision.json
semantic-write-plan.json
```

常见修复后的预期行为：

- “去修炼入门功法，领取俸禄”应识别为一次宏观玩家行动，进入行动裁决，不应误触发地图寻路。
- 入门级、日常级行动可以直接结算或低阈值裁决，不应统一卡在高难度阈值。
- “领取俸禄”应按语义归入货币、资源、名望或对应字段，不应只按字面创建物品。
- “打两只低级妖兽”应进入战斗准备，缺少敌人时创建敌方 NPC/状态并带默认攻击能力。
- 裁决、战斗、奇遇、NPC 自发行为、环境行为和背包/技能使用产生的影响，应通过对应工具写回 NPC、背包、技能、地图、关系、阵营、任务或扩展数据库。

### 说服

`system.persuasion.*` 让 LLM 评价玩家亲自说服内容。玩家可以只掷骰，也可以附加自己的话术；糟糕话术可能减分，有理有据的话术可能加分。

### 战斗

战斗模块尽量独立于 LLM：

- 普通攻击、防御、闪避、伤害、治疗、抗性、易伤、免疫、临时生命、状态持续、周期伤害、行动经济都走纯数字规则。
- LLM 只用于开战判断、敌人生成/调用、特殊战斗操作和战后奖励/影响规划。
- 前端可以把战斗做成单独 RPG 界面，不必让每一回合都占用聊天消息。

### 背包和技能栏快捷使用

`system.slot_use.*` 是前端背包/技能栏入口：

- `preview_use`：预览能否使用、是否需要目标、是否需要裁决。
- `commit_use`：真正执行。
- 确定性 buff、消耗、治疗、伤害会复用资源、物品和效果结算器。
- 有特殊文字描述且无法纯数值化的效果会路由到裁决工具。

临时 buff 会带持续时间或到期条件，触发器会在回合/时间推进时自动移除。

### 任务、奇遇和触发器

- 任务不是固定路线链，而是目标、状态、收束条件和后果。
- 奇遇是已经遇见的事件，随机触发本身不直接惩罚；失败、战斗失败或玩家主动冒险后才会产生惩罚。
- 触发器不使用 LLM，负责死亡/复活、状态 tick、任务到期、时间事件、场景结束、队友外派到期和随机奇遇判定。

### 保存点、分支、回滚

Audit / Undo / Replay 和 Worldline 负责：

- 记录 LLM 输入输出。
- 记录工具调用。
- 记录 RAG 记忆读写。
- 记录聊天消息变更。
- 创建保存点和分支世界线。
- 回滚或重放可逆事件。

保存点可覆盖两类对象：

- Runtime session：运行时聊天消息、Runtime RAG 和结构化界面状态。
- App chat：网页聊天元数据、聊天消息、Chat Data DB、聊天级 Global Data，以及选择性 RAG。

保存点是内部世界线快照，保存在 Worldline DB 中，用于撤销、分支和恢复；它不是下载给用户保存的聊天导出文件。聊天长期备份仍使用 `*.chat.json` + `*.chat.resources.json`。

恢复 App chat 保存点时，聊天会话元数据和消息会分开恢复：会话返回只包含元数据，消息替换结果单独返回，避免调试时把旧消息误认为已恢复状态。破坏性恢复、分支切换和回滚都要求用户授权。

恢复会覆盖当前聊天工作副本中的相关状态；如果恢复点之后新增了聊天级空集合或临时记录，恢复流程会尽量删除这些恢复点外的聊天级临时数据。恢复不会改写角色卡原始设定。

删除聊天会同步清理该聊天的保存点、分支、聊天数据库和聊天级 RAG；角色卡级原始设定不会被删除。

## 数据与 RAG

常见数据层：

| 类型 | 生命周期 | 用途 |
| --- | --- | --- |
| Web/App DB | 应用级 | 角色卡、角色卡版本、聊天会话、聊天消息 |
| Character Seed Data | 角色卡级 | 初始非空设定，创建聊天时克隆 |
| Chat Data DB | 聊天级 | 当前聊天运行状态、任务、场景、战斗、结构化状态 |
| Global Data DB | 工具级 | NPC、地图、物品、技能、阵营等 registry |
| Permanent RAG | 用户维护 | 长期资料，agent 只查询，写入要求用户授权 |
| Runtime RAG | 当前运行 | 短期增强记忆 |
| Audit DB | 应用级 | 工具、RAG、消息、回滚快照 |
| Worldline DB | 应用级 | 保存点和分支世界线 |

角色卡级非空数据库和 RAG 在创建聊天时克隆；聊天内变化只改克隆副本。用户也可以手动把聊天中形成的重要设定提升回角色卡级资料。

### SQLite 管理与 LLM 分类写库

`system.data.*` 是轻量 SQLite 数据管理工具组，用于处理“没有专门库但仍需要存储”的结构化资料。

跑团过程中，AI 可以根据对话自动创建和更新新的 schema、collection 与记录。这个能力用于承接没有专门系统的临时资料，例如“霓虹污染指数”“宗门名望”“梦境污染源”等扩展指标。

使用原则：

- 有专门工具的资料优先走专门工具，例如 NPC、地图、任务、阵营、物品、技能、背包和状态。
- 没有专门结构的资料可以走 `system.data.quantify_text`、`system.data.semantic_update` 或自动语义写库规划。
- 新 collection 和字段应保留足够开放性，不要为了一个题材把全部字段硬编码死。
- 叙事只能引用已经写入或检定支持的事实；如果模型说出了未写入的奖励、关系、地图抵达或战斗胜利，Agent Loop 会回退并阻止它成为事实。

| 工具 | 用途 |
| --- | --- |
| `system.data.import_document` | 读取 JSON、YAML、XML，推断集合和字段，自动建表并初始化记录。 |
| `system.data.semantic_update` | 把模型或工具提取出的结构化值写入指定记录，并可保留原始文本用于审计。 |
| `system.data.quantify_text` | 按用户定义的字段、规则和参考文本，把模糊描述量化为数字或保存为特殊文本设定。 |
| `system.data.query_fields` | 只查询请求需要的字段，减少不必要的数据暴露。 |
| `system.data.alter_fields` | 增删字段，并同步 schema/格式文件。 |
| `system.data.describe_collection` / `list_collections` | 查看集合和字段。 |

`quantify_text` 支持按字段分别使用参考文本。例如人物力量字段只参考人物属性量尺，地图危险字段只参考地图危险量尺；没有参考文本时才自由估算。开启 `allowNewFields` 后，LLM 可以在合理范围内创建新字段，用于记录“灵脉污染指数”“宗门名望”这类模组临时指标。

这个系统不是用来替代专门数据库的。NPC、地图、物品、技能、阵营、任务、关系、背包、状态等有专门工具时，应优先使用专门工具；只有字段归属不明确、需要临时扩展或需要数值化时，才使用 `system.data.*`。

## 权限

权限分两层：

- 用户手动操作权限高于 agent。
- Agent 自动调用受 Tool descriptor、Agent Access、工具自身授权检查约束。

高风险写入、破坏性工具、永久 RAG 写入、角色卡原始资料修改等，都应该要求显式用户授权。

## 调试

每次通过 Tool Plugin Manager 执行工具，都会生成 tool trace：

```text
data/tool-traces/{yyyy-mm-dd}/{timestamp}_{traceId}_{toolId}/
  tool.json
  input.json
  output.json 或 error.json
  summary.json
```

业务模块也会写自己的 trace，例如 context planner、combat、resource、trigger 等。Tool Manager 的 Debug 面板可以读取这些文件。

调试脚本生成的 Markdown 报告统一放在：

```text
manuals/generated-debug/
```

玩家视角前端验证报告也放在该目录，文件名建议包含日期和验证范围，例如：

```text
manuals/generated-debug/player-playtest-2026-05-31.md
```

以下目录或文件属于运行产物，可在确认不需要后删除：

```text
dist/                构建输出，`npm run build` 或 `npm test` 会重建
tmp/                 临时日志和端到端测试数据
.codex-screenshots/  前端验证截图
.DS_Store            macOS 系统文件
```

不要把 `data/`、`.runtime/`、`chc/`、`node_modules/` 当作普通垃圾清理。`data/` 可能有用户数据库和 trace，`.runtime/` 是本地 Node 运行环境，`chc/` 是导入素材，`node_modules/` 是依赖。

## 排障

### 换系统后启动失败

如果项目目录从 macOS 复制到 Windows 或 Linux 后启动失败，优先处理两类本地运行产物：

- 删除 `.runtime/node` 后重新启动，让启动器下载当前平台的 Node。
- 删除 `node_modules` 后重新启动，让启动器在当前平台重新安装依赖。

完整发布包通常从预编译 JS 启动，不依赖 `tsx`/`esbuild` 这类平台相关开发工具；源码开发模式如果运行 `npm run dev`，必须使用当前平台安装的 `node_modules`。

### Tool Manager 里看不到新工具

确认工具已经注册到运行时，并且服务已重启。内置代码注册的工具如果被删除，重启后会重新出现。

### 工具能看到但不能执行

通过 HTTP 创建的 descriptor-only 工具没有 handler，只能管理和导出。需要执行时必须在进程内注册 handler。

### Prompt Inventory 没有某个工具

通常是工具没有声明 `metadata.usesLlm`、`tags: ["llm"]`、prompt/reference 字段或相关 metadata。

### 结构化状态没有更新

检查模型输出是否包含结构化块，或手动调用结构化接口读取当前状态。聊天文本只展示剥离后的叙事层。

### 测试

```bash
npm test
```

只检查 TypeScript 源码：

```bash
npm run typecheck
```
