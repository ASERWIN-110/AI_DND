# 新手入门范例：《月井失灯》

本文说明《月井失灯》新手范例的文件用途、导入位置和推荐游玩方式。

## 文件清单

| 文件 | 写什么 | 在哪里导入 |
| --- | --- | --- |
| `examples/characters/beginner-moonwell.bundle.json` | 推荐使用的完整项目存档。包含角色卡、sidecar 初始数据库、`reference_texts` 参考文本、全局关系数据和 runtime RAG。 | Chat 页面右侧角色区，点击“导入”，只填 `Character Card JSON 文件路径`，sidecar 留空。 |
| `examples/characters/beginner-moonwell.card.json` | 角色卡。包含 GM 名称、开场白、场景简介、主 Prompt、每轮后置 Prompt、示例对话和小型 lore book。 | Chat 页面右侧角色区，点击“导入”，填入 `Character Card JSON 文件路径`。 |
| `examples/characters/beginner-moonwell.resources.json` | Sidecar 数据。包含主角阿芦、NPC、背包、技能栏、状态栏、地图、场景、任务、关系图、阵营和 RAG 资料。 | 同一个导入窗口，填入 `数据库/RAG sidecar JSON 文件路径`。 |
| `examples/characters/beginner-moonwell.prompts.md` | 给人看的 Prompt 说明。解释主 Prompt、后置 Prompt、数据库资料和改写方式。 | 不导入。阅读或复制片段时使用。 |
| `examples/characters/beginner-moonwell.INSTRUCTIONS.txt` | 简短导入步骤和推荐首轮输入。 | 不导入。给发布包使用者快速查看。 |

## 推荐导入：完整存档

1. 启动项目。
2. 打开：

```text
http://127.0.0.1:8787/
```

3. 点击右侧角色区的“导入”。
4. 在 `Character Card JSON 文件路径` 输入：

```text
examples/characters/beginner-moonwell.bundle.json
```

5. `或粘贴 Character Card JSON` 留空。
6. `数据库/RAG sidecar JSON 文件路径（可选）` 留空。
7. `或粘贴数据库/RAG sidecar JSON（可选）` 留空。
8. 点击“导入角色”。
9. 在角色列表里选择 `新手GM - 月井失灯`。
10. 在聊天区点击“创建聊天”。
11. 弹出“选择玩家 NPC 设定”时选择：

```text
阿芦
```

## 拆分导入：角色卡 + sidecar

只有在你想单独编辑角色卡或 sidecar 时才用这个方式。

1. 点击右侧角色区的“导入”。
2. 在 `Character Card JSON 文件路径` 输入：

```text
examples/characters/beginner-moonwell.card.json
```

3. 在 `数据库/RAG sidecar JSON 文件路径（可选）` 输入：

```text
examples/characters/beginner-moonwell.resources.json
```

4. 两个粘贴框都留空。
5. 点击“导入角色”。
6. 创建新聊天。
7. 弹出“选择玩家 NPC 设定”时选择 `阿芦`。

## 范例内容

- 题材：轻量奇幻村庄调查。
- 预计长度：5 到 8 回合。
- 主角：阿芦，第一次独立处理村中小事件的巡路人。
- 核心任务：找回月井灯芯，让井灯安全重新亮起。
- 新手教学目标：观察、询问、使用物品、移动场景、安抚 NPC、推进任务。
- 主要 NPC：莓婆婆、小砚、灰砾、银点。
- 初始物品：小提灯、月火柴、温面包、白粉笔、旧铜钥匙。
- 初始技能：观察、交涉、巧手、安抚。

## 推荐首轮输入

```text
我先观察井口、空灯罩和地上的痕迹。
```

```text
我问莓婆婆昨晚谁最后靠近过月井灯。
```

```text
我用白粉笔标记湿脚印，然后沿着脚印去旧磨坊。
```

## Prompt 放在哪里

主要 Prompt 已经写进 `beginner-moonwell.card.json`：

- `data.system_prompt`：GM 行为、回复质量、教学节奏、场景真相。
- `data.post_history_instructions`：每轮回复前检查事项。
- `data.character_book`：可被激活的小型 lore book。

补充资料写进 `beginner-moonwell.resources.json`：

- `initialSetting.collections`：会在新建聊天时克隆为聊天工作数据。
- `initialSetting.collections[].name = reference_texts`：标准参考文本量尺，用来提示难度、物品效果、NPC 信任/恐慌、资源消耗和奖励范围，避免 AI 凭形容词生成过强数值。
- `initialSetting.collections[].name = beginner_reference_texts`：兼容旧说明的简化参考文本。
- `resources.globalData`：角色级全局数据和关系图。
- `resources.runtimeRag`：真相、教学节奏、失败推进等可检索资料。

`beginner-moonwell.prompts.md` 只是说明文档，不需要导入。

## 在哪里查看参考文本

导入角色并创建聊天后：

1. 在聊天页面打开右侧的玩家/数据面板。
2. 找到“数据”或“数据库”区域。
3. 选择当前聊天的数据集合。
4. 打开 `reference_texts`。
5. 你应该能看到这些记录：

```text
ref_moonwell_usage
ref_moonwell_action_difficulty
ref_moonwell_item_scale
ref_moonwell_npc_attitude
ref_moonwell_resource_cost
ref_moonwell_reward_progress
```

如果你只看到 `beginner_reference_texts`，说明导入的是旧版 sidecar；重新导入 `beginner-moonwell.bundle.json` 或新版 `beginner-moonwell.resources.json`。

## 判断范例是否正常

导入并新建聊天后，应能看到：

- 可选择玩家角色 `阿芦`。
- 主角状态栏包含 HP、专注、好运和条件。
- 背包包含小提灯、月火柴、温面包、白粉笔、旧铜钥匙。
- 技能栏包含观察、交涉、巧手、安抚。
- 地图/场景数据包含月井村中央和旧磨坊。
- 数据面板包含 `reference_texts`，可看到难度 0-4、物品强度、NPC 信任/恐慌、资源消耗和奖励量尺。
- 对话不会长篇空转，每轮应给出线索、结果或下一步选择。
