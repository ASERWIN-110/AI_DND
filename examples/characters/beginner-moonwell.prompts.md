# 《月井失灯》Prompt 说明

这个文件用于阅读和改写 Prompt，不需要在前端单独导入。可导入内容已经写入：

- `examples/characters/beginner-moonwell.card.json` 的 `data.system_prompt`
- `examples/characters/beginner-moonwell.card.json` 的 `data.post_history_instructions`
- `examples/characters/beginner-moonwell.resources.json` 的 `runtimeRag`
- `examples/characters/beginner-moonwell.bundle.json` 中同样内置了以上内容，可作为完整存档直接导入

## 主 Prompt 写什么

主 Prompt 负责固定 GM 的行为边界：

- 只处理玩家本轮明确行动。
- 回复包含确定事实、行动结果、状态或线索变化、下一步方向。
- 失败也推进剧情，不让新手卡死。
- 输入含糊时给 2 到 3 个解释选项。
- 不编造工具或数据库数值。
- 涉及难度、物品效果、NPC 信任/恐慌或资源消耗时，先参考标准集合 `reference_texts`；旧兼容集合是 `beginner_reference_texts`。
- 每轮通常控制在 120 到 220 个中文字。
- 不输出设定百科，不一次揭开隐藏真相。

这段 Prompt 放在角色卡：

```json
"system_prompt": "{{original}}\n\n# 新手教学 GM 主 Prompt\n..."
```

`{{original}}` 会保留系统默认 Prompt 和角色卡基础设定。不要删掉它，除非你想完全替换默认行为。

## 后置 Prompt 写什么

后置 Prompt 每轮都提醒 GM 做最后检查：

- 是否默认玩家视角是阿芦。
- 是否有新增线索、资源消耗、NPC 态度或任务进度。
- 玩家卡住时给观察、询问、使用物品三类方向。
- 不连续两轮只描写气氛。
- 不一次列出超过 4 个选项。

这段 Prompt 放在角色卡：

```json
"post_history_instructions": "{{original}}\n\n# 每轮回复前检查\n..."
```

## 数据库资料写什么

`beginner-moonwell.resources.json` 放系统可读取、可展示、可克隆到新聊天的数据：

- `npc_structured_states`：主角阿芦、莓婆婆、小砚、灰砾、银点。
- `scene_records`：月井村中央、旧磨坊。
- `map_structured_states`：区域、路线、物件、危险。
- `quest_records`：找回月井灯芯。
- `beginner_rule_cards`：新手三类行动、失败推进。
- `reference_texts`：标准参考文本量尺；约束难度、物品效果、NPC 态度、资源消耗和奖励价值，不让 AI 随意生成过强数值。
- `beginner_reference_texts`：简化兼容参考文本，保留给旧说明或人工查看。
- `npc_relation_*`：NPC 关系图。
- `faction_*`：阵营和成员关系。
- `runtimeRag`：真相、教学节奏、失败推进规则和参考文本摘要。

## 参考文本写什么

参考文本不是剧情设定，而是给工具和 GM 的量尺。它回答“这个题材下多大才合理”：

- 难度范围：本范例只用 0 到 4，避免新手局突然出现高压战斗。
- 物品强度：小提灯、月火柴、温面包、白粉笔、旧铜钥匙都只是低强度工具。
- NPC 数值：信任、恐慌、害怕用 0 到 4，每次通常只变化 1 到 2 点。
- 工具用法：生成 `numericValues` 时，把相关记录作为 `referenceText` 或 `quantificationDefinition.referenceDocuments`。

导入后查看位置：Chat 页面打开右侧数据面板，在当前聊天数据库集合里选择 `reference_texts`。完整存档导入时只需要把 `examples/characters/beginner-moonwell.bundle.json` 填到角色导入窗口的 `Character Card JSON 文件路径`，sidecar 输入框留空。

## 为什么这样写

这个范例不是为了写长篇小说，而是为了测试和教学：

- 新手知道能做什么。
- 前端能显示状态、背包、技能、地图和任务资料。
- GM 不会用废话填充回合。
- 每一轮都能推动线索或状态。
- 5 到 8 回合可以自然完成。

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

## 改成自己的题材

最少改这几处：

1. `card.json` 的 `name`、`description`、`scenario`、`first_mes`。
2. `card.json` 的 `system_prompt` 里的场景真相和教学节奏。
3. `resources.json` 的主角、NPC、地图、任务、参考文本、RAG 文档。
4. `INSTRUCTIONS.txt` 的导入路径和推荐输入。
