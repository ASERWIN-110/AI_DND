# 玩家视角前端游玩验证报告

日期：2026-05-31

目标：按“修 bug -> 验证修复 -> 继续游玩 -> 记录新问题”的循环，从玩家视角验证前端能否正常导入角色卡、创建聊天、选择主角并完成约 5 轮游玩，同时监控前端和后台数据。

## 验证环境

| 项目 | 值 |
| --- | --- |
| 前端地址 | `http://127.0.0.1:8787/` |
| 视口 | 桌面端 `1280 x 900` |
| 测试角色卡 | `Harbor GM Path 632014` |
| 测试聊天 | `Path UI loop cycle 632014` |
| Chat ID | `chat_mptmyimr_pufxtd4a` |
| Character ID | `char_mptmw7jf_r3ki6ryo` |
| Provider | Mock provider |

说明：这是 2026-05-31 的历史验证记录。原测试使用的临时导入文件和截图已经按运行产物清理规则删除，不应再作为可复现路径使用。当前复现前端文件路径导入，请使用稳定示例：

```text
examples/characters/beginner-moonwell.bundle.json
examples/characters/beginner-moonwell.card.json
examples/characters/beginner-moonwell.resources.json
```

## 本轮已修复并验证的偏差

| 偏差 | 修复结果 | 验证方式 |
| --- | --- | --- |
| 角色卡导入只能粘贴 JSON，不适合只给文件地址 | 已支持角色卡 JSON 和 sidecar JSON 的项目内文件路径导入 | 当时从前端导入临时角色卡和 sidecar，toast 显示“角色已导入”；当前复现应使用 `examples/characters/...` 稳定示例 |
| 角色卡 sidecar 资源没有默认归属到角色卡生命周期 | 未显式 scope 的资源会按角色卡或聊天导入入口补齐生命周期 scope | API 测试覆盖 path import 和 sidecar lifecycle |
| 创建聊天并绑定主角时，导入的玩家状态可能被空状态覆盖 | 绑定主角时保留候选 state 的 HP、背包、技能、资源、装备、特殊状态 | Chat Data DB 中 `npcstate_current_pc_linya_632014` 保留 HP、物品和技能 |
| Context planner 旧路径可能触发失败的 `system.npc_registry.get_npc` trace | L0 读取优先使用 `system.npc_registry.list_npcs` 过滤查询 | 精确统计本轮没有新增失败 tool trace |
| Mock provider 对“watch badge”等动作容易走泛化门检查回复 | 增加 watch badge 分支并让下一步 hook 随动作变化 | 5 轮回复能响应盐线、黑蜡、Mel、提灯、徽章等具体动作 |
| 桌面端右侧面板聊天列表被压缩过小 | 调整右侧栏滚动和聊天列表最小高度 | 1280 x 900 下聊天列表高度约 150px，无越界 |

## 前置设定验证

导入的初始设定包含：

- 玩家候选：`Linya`，`npcId = pc_linya_632014`。
- NPC 候选：`Mel`，`npcId = npc_mel_632014`。
- 场景：`Bronze door under Old Bell Gate`。
- 地图：`Old Bell Gate threshold`。
- 背包：`Salt chalk`、`Hooded lantern`、`Wax scraper`、`Evidence envelope`。
- 技能：`Trace observation`、`Low voice questioning`、`Salt warding`。
- 关系图：NPC 关系 2 节点 1 边；阵营图 6 节点 5 边。

创建聊天后选择主角：

```text
Linya
pc_linya_632014
npc_structured_states
已标记玩家角色
```

后台 Chat Data DB 验证：

```text
npcstate_current_pc_linya_632014
npcId: pc_linya_632014
playerId: pc_linya_632014
isPlayer: 1
HP: 18 / 20
inventory items: 4
skills: 3
special statuses: 2
```

## 5 轮玩家游玩记录

| 轮次 | 玩家输入 | 结果 |
| --- | --- | --- |
| 1 | `I inspect the broken salt line and drag marks without touching the bronze door.` | 回复指出盐线从内侧被抹断、拖痕在门缝前变窄，并给出继续追踪或询问 Mel 的下一步 |
| 2 | `I mark the clean side of the salt line with salt chalk, then smell the black wax.` | 回复识别盐粉、黑蜡气味和蓝线头，推动追问或取证 |
| 3 | `I ask Mel who touched this door recently, in exact order, and watch his hands.` | 回复聚焦 Mel 的时间顺序和回避点，没有偏离为泛泛叙述 |
| 4 | `I send Mel to the street lamp and shine the hooded lantern through the door gap.` | 回复呈现提灯照出的湿亮弧线和“往里”的方向 |
| 5 | `If nothing attacks, I slide the wax scraper under the bent badge and open the bronze door a narrow crack.` | 回复聚焦弯曲徽章、黑蜡和求援含义，没有卡死 |

消息入库结果：

```text
assistant: 6
user: 5
total: 11
```

每轮发送验证：

- 输入框内容与玩家输入一致。
- 点击发送后输入框清空。
- 每轮都新增玩家消息和 GM 回复。
- 发送按钮恢复可用。
- 未出现卡死、无限 loading、重复 raw JSON 或工具输出泄漏。

## 前端与后台监控

前端：

- Console `error/warn`：无新增。
- 聊天区：消息可滚动，输入区未遮挡。
- 右侧栏：角色区、聊天区均可见，聊天列表不再只有极小高度。
- 玩家动作菜单：可打开和关闭。

后台：

- 本轮精确统计 `summary.json.status != "success"`：无新增失败 trace。
- 粗略全文搜索里出现的 `get_npc` 增量来自输出文本或旧 trace，不代表本轮失败调用。
- `chat_messages` 与前端消息数量一致。
- Chat Data DB 中主角状态、地图挂载和场景记录可读。

## 玩家面板检查

| 面板 | 结果 |
| --- | --- |
| 背包 | 显示 4 件物品：`Salt chalk`、`Hooded lantern`、`Wax scraper`、`Evidence envelope` |
| 状态栏 | 显示 HP `18 / 20`、状态 `careful`、`rain-soaked`、资源和装备 |
| 技能 | 显示 3 个技能：`Trace observation`、`Low voice questioning`、`Salt warding` |
| 地图 | 显示当前场景地图、区域、可互动对象、危险和场景记录 |
| NPC 关系图 | 显示 Linya 与 Mel，2 节点 1 边 |
| 阵营图 | 显示 3 个阵营和 3 个角色隶属节点，合计 6 节点 5 边 |

## 对话质量评估

当前 Mock provider 的 5 轮质量可以支撑前端游玩验证：

- 回复都与玩家动作直接相关。
- 每轮有明确线索推进和下一步选择。
- 没有大量空话、说明书式废话或无意义重复。
- 没有泄漏 prompt、数据库 JSON、工具调用细节。

仍然存在的产品层改进点：

- 背包面板标题区域包含“货币无记录”，属于真实空数据提示，不是错误；后续可以弱化展示，避免被误读为整页无数据。
- `activeChatTitle` 的隐藏字段为空，但可见 header 和聊天列表显示正确；如果后续有脚本依赖该节点文本，建议统一同步。
- 玩家动作菜单按钮文案在 DOM 文本中呈现为“包背包/态状态栏”等，视觉上可用；后续可改为图标加可访问标签，减少文本抓取噪声。

## 自动化测试

已运行：

```bash
npm test -- tests/mock-provider.test.js tests/context-completeness.test.js tests/context-planner.test.js tests/api.test.js
```

结果：

```text
tests: 15
pass: 15
fail: 0
```

## 结论

本轮从玩家视角可以正常游玩，没有卡死。前端主要流程、桌面布局、文件路径导入、主角绑定、玩家数据面板和后台消息入库均验证通过。未发现需要立即进入下一轮修复的阻断级 bug。
