# AI DND 开发者文档

本文是前端、后端、工具、插件、数据库、RAG 和调试约定的统一开发文档。使用流程见 [使用手册](user-manual.md)。

## 项目定位

AI DND 是面向 AI 文字 RPG 的聊天运行时骨架。它借鉴 SillyTavern 的产品概念：角色卡、Prompt 分段组装、World Info、向量检索、模型 API 适配；但默认 prompt 文本和实现是原创的。

核心目标：

- 聊天体验保留自然语言叙事。
- 规则、数据库、RAG、战斗、任务、触发器、保存点等都可审计。
- 工具和插件可扩展，但危险写入必须走授权。
- 前端展示层和后端规则层解耦。
- 允许宽松内容字段，避免把作者和 LLM 锁死在过窄 schema 里。

## 代码结构

```text
src/
  api/                 HTTP API 与静态资源服务
  app/                 Web/App 角色卡、聊天和固定 schema 数据库
  runtime/             Chat Runtime、session store、消息和模型调用
  tools/               Tool Plugin Manager 与内置工具注册
  data/                SQLite Data Manager、结构化导入、量化、字段维护
  characters/          Character Card 与 World Info
  prompts/             Prompt preset 与 prompt builder
  rag/                 Embedding、Vector Store、Permanent/Runtime RAG
  context/             Context Planner 与上下文完整度补全
  structured/          小地图、状态栏、技能栏、背包等结构化界面状态
  actions/             行动裁决、Action Plan、荒诞判定、重裁
  social/              说服裁定
  combat/              战斗、敌人生成、敌方行为选择、战后结算
  resources/           行动经济、资源、冷却、弹药、消耗品
  items/               物品总表、装备、物品使用
  mechanics/           技能、状态、专长和可扩展机制模板
  npcs/                NPC 总表、L1-L3 Profile、关系图、场景挂载
  maps/                地图总表、地图关系、寻路、场景地图挂载
  factions/            阵营图、成员关系、反向影响和阵营 RAG 文档
  scenes/              场景管理器
  time/                时间、回合、持续效果、世界时钟
  triggers/            纯规则触发器
  encounters/          奇遇记录、推进、奖励和后果
  memory/              对话压缩与角色记忆
  rules/               规则包和参考模板
  audit/               Audit / Undo / Replay
  worldlines/          保存点和分支世界线
public/
  index.html           Chat UI
  app.js               Chat UI 主逻辑
  app-extensions.js    前端扩展宿主
  tool-manager.html    Tool Manager
  tool-manager.js      Tool Manager 主逻辑
manuals/
  README.md            文档入口
  user-manual.md       使用手册
  developer-guide.md   本文
  examples/            契约示例 JSON
```

## 运行入口

`package.json` 暴露的脚本：

```json
{
  "quickstart": "node scripts/quick-start.mjs",
  "quick-start": "node scripts/quick-start.mjs",
  "start": "node scripts/quick-start.mjs --no-open",
  "dev": "node scripts/quick-start.mjs --source --no-open",
  "build": "tsc -p tsconfig.json && node scripts/copy-build-assets.mjs",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "npm run build && node --test \"dist/tests/**/*.test.js\"",
  "demo": "node --import tsx examples/demo.mjs",
  "package:release": "node scripts/package-release.mjs",
  "package:release:full": "node scripts/package-release.mjs --include-node-modules"
}
```

Node 版本要求：`>=24`。

## 后端请求流

普通聊天请求的大致链路：

```text
POST /v1/chat/sessions/{id}/messages
-> AgentChatRuntime.sendMessage
-> 读取 session / app chat / structured state
-> prompt builder / context planner / world info / RAG
-> provider.generate
-> 格式化最终叙事文本
-> 解析结构化输出并更新 structured state
-> 记录消息、audit、progress events
-> 返回 session + assistant message
```

Agent Loop 是独立工具层能力，不是所有聊天都必须经过它。复杂流程可以通过 `system.agent_loop.*` dry-run 或正式运行，把一轮输入拆成 phase，然后调度 context、router、resolver、settlement、narration、postprocess 等工具。

## 前端边界

主应用负责：

- 聊天会话、消息、导入导出和持久化。
- 工具执行和 agent-loop progress。
- 骰子、裁决、战斗、说服、背包、状态、地图等 host-owned 状态展示。
- 数据库查询权限和玩家可见数据规则。

扩展层负责：

- 图片、音频、视频、Live2D、Spine、Lottie 等资源绑定。
- NPC、地图、战斗、说服和 UI renderer。
- BGM、环境音、SFX、固定语音、TTS 队列。
- 小型设置面板。
- 监听 `aidnd:*` 前端事件做表现增强。

扩展不应直接 patch `app.js` 内部状态。如果需要改变游戏状态，应通过受控工具桥请求后端工具。

## 接口说明

主要接口类别：

| 类别 | 接口 |
| --- | --- |
| 健康检查 | `GET /health` |
| Chat runtime | `GET/POST /v1/chat/sessions`、`POST /v1/chat/sessions/{id}/messages` |
| 结构化界面 | `GET/PATCH/PUT /v1/chat/sessions/{id}/structured-interface`、`GET /prompt`、`POST /apply-output` |
| RAG | `POST /v1/rag/documents`、`POST /v1/rag/search` |
| World Info | `POST /v1/world-info/activate` |
| App characters | `POST /v1/app/characters/import`、`GET /v1/app/characters/{id}/export`、`GET /v1/app/characters/{id}/export/resources`、`POST /v1/app/characters/{id}/resources/import` |
| App chats | `POST /v1/app/chats`、`POST /v1/app/chats/import`、`GET /v1/app/chats/{id}/export`、`GET /v1/app/chats/{id}/export/resources`、`POST /v1/app/chats/{id}/resources/import`、`DELETE /v1/app/chats/{id}` |
| Worldlines | `GET/POST /v1/worldlines/savepoints`、`POST /v1/worldlines/savepoints/{id}/restore`、`GET/POST /v1/worldlines/branches`、`POST /v1/worldlines/branches/{id}/switch` |
| Tool plugins | `GET/POST /v1/tool-plugins`、`GET/PATCH/DELETE /v1/tool-plugins/{pluginId}` |
| Tool descriptors | `GET /v1/tools`、`POST /v1/tools/normalize`、`POST /v1/tools/import`、`POST /v1/tools/delete` |
| Tool execution | `POST /v1/tools/{toolId}/execute` |
| Debug | `POST /v1/debug/files/read`、`GET /v1/debug/traces/latest`、`POST /v1/debug/tool-sequence` |
| Character card normalize | `POST /v1/characters/normalize` |

App Database 还提供角色卡、角色卡版本、聊天会话、消息和初始化设定相关 API；它们是网页应用层能力，不是 agent 工具。

接口层分工：

| 层 | 使用者 | 稳定输入输出 |
| --- | --- | --- |
| HTTP API | 网页前端、外部调试脚本、管理面板 | JSON request/response，错误使用 `{ error: { message, name } }` |
| Tool API | Agent loop、Tool Manager、前端工具桥 | Tool descriptor 的 `inputSchema/outputSchema` 和 tool trace |
| App Database API | 角色卡/聊天管理 UI | 固定 schema，不暴露给 agent 自动调用 |
| Frontend Extension API | 前端 mod、renderer、音频插件 | `window.AiDndFrontendExtensions` 服务和 `aidnd:*` 事件 |
| Provider API | LLM provider adapter | OpenAI-compatible chat completion 风格请求 |

接口兼容原则：

- 新增字段默认向后兼容；旧调用方可以忽略未知字段。
- 删除或改名字段必须提供兼容别名或迁移路径。
- 写接口必须明确是否需要用户授权。
- 前端展示用字段和规则结算字段分离：展示字段放 `display`，结算字段放 `directToolCall`、`proposedToolCalls`、`statePreview` 或业务结果。
- 能通过现有工具表达的功能不要新增平行接口。
- 涉及 AI 生成 `numericValues`、难度、战力、物品强度、状态强度或奖励价值时，应提供 `referenceText` / `referenceDocuments`。示例 sidecar 使用 `reference_texts` 这类集合保存量尺，并同步到 runtime RAG；工具调用时再把相关记录传给 `quantificationDefinition`。

前后端分离：

- 后端监听由 `HOST` / `PORT` 控制；手机、局域网或 Tailscale 测试时用 `npm run quickstart -- --tailscale --no-open`。
- Chat 和 Tool Manager 默认使用同源相对 API。若静态前端单独托管，可在 URL 上加 `?apiBase=http://<backend-host>:8787`。
- `apiBase` 会写入 `localStorage["ai-dnd-backend-api-base-v1"]`，后续 Chat、Tool Manager、fetch 和 EventSource 进度流都会指向该后端。
- CORS 对 JSON API 和进度 SSE 已开放；生产部署仍建议放在 Tailscale、局域网或反向代理的访问控制后面。

### 主要 HTTP 调用示例

发送聊天消息：

```http
POST /v1/chat/sessions/{sessionId}/messages
Content-Type: application/json

{
  "content": "我检查井底的门。",
  "options": {}
}
```

执行工具：

```http
POST /v1/tools/system.slot_use.preview_use/execute
Content-Type: application/json

{
  "input": {
    "chatSessionId": "chat_001",
    "actorId": "pc_arin",
    "slotType": "inventory",
    "slotId": "inv_potion_healing"
  },
  "context": {
    "actor": "user"
  }
}
```

导入 descriptor-only 插件：

```http
POST /v1/tool-plugins
Content-Type: application/json

{
  "id": "campaign.alchemy",
  "name": "Campaign Alchemy",
  "version": "0.1.0",
  "tools": []
}
```

读取最新工具 trace：

```http
GET /v1/debug/traces/latest?toolId=system.slot_use.preview_use
```

一次执行多个调试工具步骤：

```http
POST /v1/debug/tool-sequence
Content-Type: application/json

{
  "context": {
    "authorization": true,
    "source": "manual-debug"
  },
  "steps": [
    {
      "toolId": "system.npc_state.patch_state",
      "input": {
        "chatSessionId": "chat_001",
        "sceneId": "camp",
        "npcId": "pc_debug",
        "actorType": "player",
        "isPlayer": true,
        "name": "Debug PC",
        "inventory": {
          "items": [
            { "id": "plain_stone", "name": "普通石头", "quantity": 1 }
          ]
        }
      }
    },
    {
      "toolId": "system.slot_use.commit_use",
      "input": {
        "chatSessionId": "chat_001",
        "sceneId": "camp",
        "actorId": "pc_debug",
        "sourceKind": "item",
        "itemId": "plain_stone"
      }
    }
  ]
}
```

这个接口只做开发调试用。它按顺序调用现有工具，不绕过工具权限；需要写入的工具仍然应在 `context.authorization` 里显式授权。

### 角色卡和聊天导入导出 API

角色卡导入：

```http
POST /v1/app/characters/import
Content-Type: application/json

{
  "characterCardPath": "examples/characters/beginner-moonwell.card.json",
  "sidecarPath": "examples/characters/beginner-moonwell.resources.json"
}
```

如果 `characterCardPath` 指向 `ai-dnd-character-bundle-v1`，sidecar 可以省略。`characterCardPath` 不能指向 `ai-dnd-character-resources-v1`，否则会返回 400。

聊天导出分两步：

```http
GET /v1/app/chats/{chatId}/export
GET /v1/app/chats/{chatId}/export/resources
```

第一步返回 `ai-dnd-chat-v1`，包含角色卡副本、聊天元数据、消息和 Chat Data DB 快照。第二步返回 `ai-dnd-chat-resources-v1`，包含聊天级 Global Data、Runtime RAG 和 Permanent RAG sidecar。前端通常保存为：

```text
*.chat.json
*.chat.resources.json
```

聊天导入：

```http
POST /v1/app/chats/import
Content-Type: application/json

{
  "chatPath": "exports/example.chat.json",
  "sidecarPath": "exports/example.chat.resources.json"
}
```

导入时会重建一个新的聊天 id，并把 sidecar 中的旧 `chatSessionId` / `characterCardId` remap 到新聊天。只导入主聊天 JSON 时，聊天消息和 Chat Data DB 会恢复；同时导入 resources sidecar 时，聊天级 Global Data 和 RAG 也会恢复。

## Tool Plugin Manager

内部 canonical tool descriptor 采用 MCP 风格：

```js
{
  name: "echo",
  title: "Echo",
  description: "Return supplied text.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, description: "Text to echo." }
    },
    required: ["text"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      text: { type: "string" }
    }
  },
  visibility: "public",
  autoCallable: false,
  mutatesState: false,
  tags: ["debug"]
}
```

支持的导出格式：

- `internal` / `mcp` / `codex` / `agent`
- `claude` / `anthropic`
- `openai` / `openai-responses`
- `openai-chat` / `chat-completions`

Provider 导出默认使用 qualified name，例如 `campaign.notes.add_note` 导出为 `campaign_notes_add_note`，兼容 Claude 工具名限制，并避免不同插件里的同名工具冲突。执行时管理器可以用 provider name 反向解析回内部工具。

每次工具执行都会写入：

```text
data/tool-traces/{yyyy-mm-dd}/{timestamp}_{traceId}_{toolId}/
  tool.json
  input.json
  output.json 或 error.json
  summary.json
```

## 统一规范

本项目的统一规范用于约束“工具怎么描述、接口怎么返回、前端怎么展示、内容怎么扩展、调试怎么追踪”。后续新增模块优先遵守这里的规则。

| 主题 | 规范 |
| --- | --- |
| 命名 | 插件 id 使用命名空间：`system.combat`、`campaign.alchemy`；工具 id 为 `{pluginId}.{toolName}` |
| Tool descriptor | 采用 MCP 风格 canonical descriptor，并可导出到 Claude、Codex、OpenAI tool 格式 |
| JSON Schema | 所有工具入参必须有 `inputSchema`；关键字段写 `description`；写工具建议提供 `outputSchema` |
| 前端工具返回 | 使用稳定 `status` envelope，区分目标选择、确认、裁决、已结算和错误 |
| 内容字段 | 保留通用顶层字段，把扩展写入 `metadata.extension.<pluginId>` |
| 权限 | 用户手动权限高于 agent；agent 自动写入受 descriptor、Agent Access 和工具内部授权共同限制 |
| Trace | 工具必须通过 Tool Plugin Manager 执行，保留输入、输出、错误和 summary |
| LLM 工具 | 必须声明 `metadata.usesLlm`、`requiresLlm` 或 `tags: ["llm"]`，prompt/reference 可被覆盖 |
| 数据生命周期 | 角色卡级初始非空资料开新聊天时克隆；聊天内只改工作副本 |
| 语义写库 | 裁决后的数据库写入先走专门工具；字段归属不明时再走 `system.data.quantify_text` 或扩展集合 |
| 兼容 | 新增字段不破坏旧字段；不要让前端依赖未声明的私有内部结构 |

### 状态返回规范

前端工具、快捷栏、背包和战斗按钮应优先使用这些 `status`：

| status | 前端行为 |
| --- | --- |
| `ready` | 显示可执行按钮，可直接调用 `directToolCall` |
| `dry_run` | 只展示预览，不写库 |
| `needs_target` | 打开目标选择 UI |
| `needs_confirmation` | 打开确认窗口，显示风险、消耗和影响 |
| `needs_adjudication` | 转入聊天裁决或特殊裁决面板 |
| `blocked` | 展示规则阻止原因 |
| `resolved` | 展示结算结果并刷新状态 |
| `resolved_with_pending_adjudication` | 刷新确定性结算，同时提示还有裁决待处理 |
| `dry_run_with_pending_adjudication` | 预览中提示需要裁决 |
| `skipped` | 静默或低优先级提示 |
| `error` | 展示错误，并保留 trace 链接 |

### 字段保留规范

读写 NPC、地图、物品、技能、状态、专长、任务、奇遇或自定义内容时：

- 不认识的字段必须尽量原样保留。
- `metadata` 下的未知对象必须保留。
- 插件私有字段只能写入自己的 `metadata.extension.<pluginId>`。
- 结构化数字写 `numericValues` 或明确 schema 字段。
- 特殊文字设定写 `textValues`、`description` 或 `metadata.specialHandling`。
- 前端视觉绑定写 `metadata.visual` 或资源绑定库，不要塞进规则结算字段。

### 授权规范

写操作按风险分级：

| 风险 | 要求 |
| --- | --- |
| 只读 | 可自动调用，但仍受 Agent Access 限制 |
| Chat-local 写入 | 可由 agent 调用，但 descriptor 必须标记 `mutatesState` |
| 角色卡原始设定写入 | 需要用户授权 |
| Permanent RAG 写入 | 需要用户授权 |
| 删除、回滚、世界线恢复 | 需要用户授权，并提供 trace/audit |
| 执行外部代码或脚本 | 当前不开放通用 HTTP 执行；未来必须沙箱化 |

## 可扩展性说明

扩展分三类，优先级从轻到重：

| 扩展类型 | 适合内容 | 推荐方式 |
| --- | --- | --- |
| 内容扩展 | 新物品、技能、状态、NPC、地图、阵营、任务模板 | 使用宽松字段、规则包模板、导入导出 |
| 展示扩展 | 立绘、地图图层、战斗动画、音效、TTS、Live2D | 使用前端扩展宿主和资源绑定 |
| 功能扩展 | 新 resolver、新结算器、新外部服务桥、新规则系统 | 新增 runtime-bound 工具插件 |

设计原则：

- 内容扩展优先走数据和模板，不要为每个作者需求写一套硬编码数据库。
- 功能扩展优先复用已有工具，例如骰子、资源、效果结算、RAG、Context Planner、Audit。
- 前端扩展不直接改 agent loop；需要状态变化时请求工具。
- LLM 适合处理模糊判断，不适合替代已经数值化的战斗、资源和触发器。
- 工具应返回中间文件和可读 trace，方便用户和开发者 debug。

扩展落点：

| 目标 | 落点 |
| --- | --- |
| 新按钮或快捷栏行为 | 前端调用 `system.slot_use.*` 或新工具，返回前端工具契约 |
| 新数据库模板 | `system.rule_packs.*` 和宽松字段 |
| 新规则结算 | 新工具插件，复用底层 data/resource/effects/dice |
| 新视觉资源 | `assetRegistry`、资源绑定库、`metadata.visual` |
| 新 LLM prompt 规则 | Tool metadata + Prompt / Reference Inventory |
| 新 agent loop 流程 | `system.agent_loop.*` flow config |

## 动态插件 Manifest

Manifest 描述一个插件提供什么能力。当前后端支持 descriptor-only 和 runtime-bound 两种形态：

- descriptor-only：通过 HTTP 创建，能被管理、校验、导入导出和暴露 schema，但没有 JS handler，不能执行。
- runtime-bound：在进程内注册 descriptor + handler，能实际执行。

最小结构：

```json
{
  "id": "system.sample",
  "name": "Sample Tools",
  "version": "0.1.0",
  "description": "Example plugin.",
  "enabled": true,
  "permissions": [],
  "metadata": {},
  "tools": []
}
```

建议字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 稳定命名空间，如 `system.sample` 或 `campaign.alchemy` |
| `version` | 语义版本，用于迁移和兼容判断 |
| `permissions` | `db:read`、`db:write`、`rag:read`、`rag:write`、`frontend:script` 等 |
| `metadata.reuses` | 声明复用哪些系统插件 |
| `metadata.optionalLlmEntryPoints` | 哪些工具内部会调用 LLM |
| `metadata.frontend` | 前端面板、renderer、事件等提示 |
| `tools` | tool descriptors |

完整示例见 [plugin-manifest.example.json](examples/plugin-manifest.example.json)。

## 前端工具返回契约

前端从背包、技能栏、战斗按钮或工具面板发起操作时，后端应返回一个稳定 envelope，让 UI 能决定直接执行、请求目标、请求确认、交给裁决或报错。

推荐结构：

```json
{
  "status": "ready",
  "toolId": "system.slot_use.preview_use",
  "source": {
    "slotType": "inventory",
    "slotId": "inv_potion_healing"
  },
  "actor": {
    "actorId": "pc_arin",
    "displayName": "阿林"
  },
  "targetPolicy": {
    "requiresTarget": false,
    "allowedTargetTypes": ["self"]
  },
  "directToolCall": {
    "toolId": "system.slot_use.commit_use",
    "input": {}
  },
  "display": {
    "title": "使用治疗药水",
    "summary": "恢复生命并消耗 1 个药水。"
  },
  "trace": {
    "files": []
  }
}
```

稳定 `status`：

| status | 含义 |
| --- | --- |
| `ready` | 可直接执行 |
| `dry_run` | 只预览，不写入 |
| `needs_target` | 需要玩家选择目标 |
| `needs_confirmation` | 需要玩家确认风险或消耗 |
| `needs_adjudication` | 需要 LLM/GM 裁决 |
| `blocked` | 规则阻止 |
| `resolved` | 已结算 |
| `resolved_with_pending_adjudication` | 确定部分已结算，特殊部分待裁决 |
| `dry_run_with_pending_adjudication` | 预览中发现需裁决 |
| `skipped` | 无需执行 |
| `error` | API 或内部错误 |

示例见：

- [frontend-tool-response-ready.example.json](examples/frontend-tool-response-ready.example.json)
- [frontend-tool-response-needs-target.example.json](examples/frontend-tool-response-needs-target.example.json)

## 宽松字段约定

内容库不应强制所有作者和 LLM 进入固定 schema。推荐保留一组通用字段，把扩展放进 `metadata`：

```json
{
  "id": "item_mist_bomb",
  "name": "雾爆瓶",
  "type": "consumable",
  "description": "投掷后爆开浓雾。",
  "tags": ["alchemy", "escape"],
  "numericValues": {
    "durationRounds": 3,
    "radiusMeters": 6
  },
  "metadata": {
    "executionMode": "hybrid",
    "useEffects": [],
    "specialHandling": {
      "requiresAdjudication": true,
      "reason": "浓雾如何影响场景需结合上下文"
    },
    "extension": {
      "system.alchemy": {
        "stability": 0.72
      }
    }
  }
}
```

约定：

- 顶层保留 `id/name/type/description/tags/numericValues/textValues/metadata` 等通用字段。
- 未识别字段必须尽量保留，不应因为当前 UI 不懂就丢弃。
- 插件私有字段放在 `metadata.extension.<pluginId>`。
- 视觉资源提示放在 `metadata.visual`。
- 确定性效果放在 `metadata.useEffects`、`metadata.modifiers`、`metadata.combatAction`。
- 需要 LLM 的特殊文字效果放在 `metadata.specialHandling`。

示例见 [loose-content-record.example.json](examples/loose-content-record.example.json)。

## 数据库与 RAG 生命周期

| 层 | 生命周期 | 说明 |
| --- | --- | --- |
| Web/App DB | 应用级 | 角色卡、版本、聊天、消息，非 agent 工具 |
| Character Seed Data | 角色卡级 | 初始非空设定，开新聊天时克隆 |
| Chat Data DB | 聊天级 | 运行时状态、任务、场景、战斗、结构化 UI |
| Global Data DB | 工具级 | registry 类资料和可复用模板 |
| Permanent RAG | 用户维护 | agent 只查询，导入/写入需要授权 |
| Runtime RAG | 当前运行 | 临时增强记忆 |
| Audit DB | 应用级 | LLM、工具、RAG、消息变更和快照 |
| Worldline DB | 应用级 | 保存点、分支和恢复 |

关键规则：

- 所有初始非空的角色卡级数据库和 RAG 在创建聊天时克隆。
- 聊天内 agent 和用户操作只改聊天工作副本。
- 初始为空的数据随聊天创建和删除。
- 用户可以手动把聊天工作副本中的设定提升回角色卡级资料。
- Permanent RAG 不由 agent 自动写入。
- 删除聊天时应同步清理 Chat Data DB、聊天级 Global Data、聊天级 RAG 和该聊天的 Worldline scope。
- Worldline 恢复 App chat 时，聊天元数据和消息替换结果分开返回，避免调试输出混入恢复前旧消息。

删除聊天的当前实现链路：

```text
DELETE /v1/app/chats/{chatId}
-> AgentChatRuntime.cleanupAppChatResources(chatId)
   -> deleteScopedDataRecords(dataManager, { chatSessionId })
   -> deleteScopedRagDocuments(runtimeRagService, { chatSessionId })
   -> deleteScopedRagDocuments(permanentRagService, { chatSessionId })
   -> WorldlineManager.deleteScope("app-chat", chatId)
-> AppDatabase.deleteChatSession(chatId)
   -> deleteLifecycleResourcesForChat(chatId)
   -> deleteChatDataDatabase(chatId)
   -> DELETE chat_sessions
   -> clear active_chat_state when needed
```

返回结果中的 `resourceCleanup` 用于前端和测试确认清理结果，包含 `data`、`runtimeRag`、`permanentRag` 和 `worldline`。这个流程只删除聊天级资源，不删除角色卡级原始设定、角色级 RAG、其它聊天的工作副本或用户手动维护的全局资料。

## SQLite 管理与语义写库分类器

`system.data` 是零配置 SQLite 管理插件，服务于三类需求：

1. 从格式化文档自动建库和初始化记录。
2. 把模糊自然语言按用户规则量化成数字或特殊文本。
3. 在没有专门领域工具时，作为扩展数据库承接临时字段。

核心工具：

| 工具 | LLM | 写入 | 说明 |
| --- | --- | --- | --- |
| `system.data.import_document` | 否 | 是 | 解析 JSON/YAML/XML，推断 collection 和字段，自动建表。 |
| `system.data.semantic_update` | 否 | 是 | 接收已经结构化的 `values`，按字段规则写入记录，并可保存原始文本。 |
| `system.data.quantify_text` | 可选 | 是 | 根据 `definition`、字段参考文本和可选 LLM，把模糊描述量化并写库。 |
| `system.data.query_fields` | 否 | 否 | 按字段查询，避免拉取整条记录。 |
| `system.data.alter_fields` | 否 | 是 | 增删字段，并同步 schema/格式文件。 |
| `system.data.describe_collection` | 否 | 否 | 查看集合字段和 schema。 |
| `system.data.list_collections` | 否 | 否 | 列出集合。 |

`quantify_text` 的重要约定：

- `definition.numericFields` 只放需要数值化的字段。
- `definition.textFields` 放特殊文字设定、说明、标签和备注。
- `referenceText` / `referenceDocuments` / `referenceDocs` / `referenceFiles` 用于给字段提供量尺。
- 字段级参考要尽量窄：人物属性不要参考地图难度，地图危险不要参考物品稀有度。
- `allowNewFields` 允许 LLM 新建少量字段，但应保留在扩展集合或 `metadata.extension.<pluginId>` 里。
- `allowReferenceFilePaths` 需要显式用户授权，避免 agent 自动读取本地路径。

行动裁决中的 `Semantic Database Write Planner` 位于 `src/actions/action-resolver.ts`，它在 Action Plan 生成后、执行工具前运行。它会读取玩家输入、当前 proposals、可用写工具和上下文摘要，决定：

- 保留某个写库 proposal。
- patch proposal 的字段或输入。
- replace 到更合适的工具。
- drop 误导性 proposal。
- 新增 `system.data.quantify_text` 等扩展写库 proposal。

这层解决的是语义归类问题。例如模型初始计划把“俸禄”当作物品写入背包时，语义写库层可以把它改成 `inventory.currency.spirit_stone += N`，并把“宗门名望小幅上升”写入扩展指标集合。

调试产物：

```text
data/action-traces/{...}/semantic-write-prompt.txt
data/action-traces/{...}/semantic-write-decision.json
data/action-traces/{...}/semantic-write-plan.json
```

开关和注入字段：

| 字段 | 作用 |
| --- | --- |
| `semanticWritePlanning` / `useSemanticWritePlanning` | 是否启用语义写库规划。 |
| `useSemanticWriteLlm` / `semanticWriteLlm` | 是否调用 LLM 判断字段和工具归属。 |
| `semanticWriteRules` / `databaseWriteRules` | 用户或模组提供的写库规则。 |
| `semanticWriteDecision` / `databaseWriteDecision` / `writeDecision` | 直接注入决策，用于测试和复现。 |
| `semanticWriteTemperature` / `semanticWriteMaxTokens` | 控制 LLM 分类调用。 |

回归测试覆盖：

- `tests/action-resolver.test.ts`：LLM 语义写库决策能把“俸禄”从字面物品改成灵石货币，并新增名望指标集合。
- `tests/e2e-trigger-sensitivity.test.ts`：聊天框输入能触发任务、NPC、物品、地图、关系、阵营、背包和扩展数据库写入。
- `tests/data-manager.test.ts`：自动建库、字段量化、字段级参考、XML/YAML/JSON 导入、字段增删和 schema 同步。

## 开放裁决不变量

行动裁决器必须保持“开放跑团”语义，不能退化成只适配单个剧本或单句输入的硬编码流程。维护 `src/actions/action-resolver.ts`、`src/loop/agent-turn-loop.ts` 和 `src/runtime/agent-chat-runtime.ts` 时，至少保留以下不变量：

- 跨题材普通动作可玩：调查、阅读、观察、打听、邀请、扫描、检查、普通撬锁等在克苏鲁、神话、修仙、校园、赛博朋克、蒸汽朋克、低武、星战等题材里都应进入通用动作/社交/调查裁决，而不是误判为战斗或寻路。
- 结果宣称不等于事实：玩家说“已经成功”“不用检定”“write it as fact”“I already succeeded”时，只能标记 `playerResultClaimDetected`，不能跳过检定、不能直接写库。
- 荒诞动作可尝试但要限界：说服重力、把月亮装进口袋、向影子借钱等可以得到 `impossibleButPlayable` 或 `extreme`，并在成功时要求解释；解释应限制为局部、短暂、有代价、世界内可延展的结果。
- DC 需要分层：日常和低风险进展动作默认约 DC 10；普通战斗约 DC 14；危险/强行动作约 DC 18；现实改写级请求才进入极端难度。不要把模糊动作全部推到高 DC。
- 重新裁决必须实际生效：玩家给出漏算熟练、工具、优势、证据、准备、地形、DC 过高等具体依据时，应生成修正计划并重跑裁决；单纯要求自动成功不应被接受。
- 动态数据库保持开放：行动裁决和语义写库层可以继续创建/更新扩展 collection 和字段，尤其是没有专门工具承接的新指标；不要把所有写入限制到固定 schema。

对应回归覆盖：

- `tests/action-resolver.test.ts` 的跨题材动作、结果宣称、无 LLM 荒诞解释和重判测试。
- `tests/e2e-trigger-sensitivity.test.ts` 的 app chat 路由、荒诞成功解释、长线对话与 `story_metrics` 创建/更新测试。
- `tests/system-test-campaign.test.ts` 的完整导入、场景、NPC、地图、阵营、RAG、移动、社交、战斗、物品和扩展数据流程。

## 规则与工具层级

底层工具通常不调用 LLM：

- 骰子。
- 资源和行动经济。
- 伤害/治疗/状态结算。
- 状态持续时间与周期效果。
- 触发器。
- 路径查询。
- 背包确定性使用。

LLM 工具只处理模糊判断：

- 行动裁决。
- 说服话术评分。
- 荒诞判定和荒诞成功解释。
- NPC 自发行为规划。
- 环境行为规划。
- 任务、奇遇、战后奖励和后果规划。
- 可选的时间流逝解释。

组合层工具负责路由和编排：

- `system.agent_loop.*`
- `system.context_planner.*`
- `system.scene_manager.*`
- `system.action.*`
- `system.combat.*`
- `system.slot_use.*`

## Agent Loop 建议结构

当前推荐把循环保持为可配置 phase，而不是写死：

```text
1. 备份 / 保存点 / audit
2. 纯规则自动系统：触发器、世界时钟、任务到期、状态 tick
3. 历史信息：最近消息、摘要、角色记忆
4. 路由层：判断需要哪些信息和 resolver
5. 上下文预算层：拼合场景、NPC、地图、任务、RAG、摘要
6. 事件触发层：移动、战斗、说服、调查、物品使用等
7. 裁决层：执行 resolver
8. 语义写库层：把裁决后的状态变化归类到合适工具、字段或扩展集合
9. 影响结算层：把结果转成状态变更
10. 演绎层：场景层、NPC 层、旁白层
11. 影响路由层：决定最终要调用哪些工具
12. 后处理层：入库、RAG、压缩、audit
```

世界书和 RAG 的推荐位置：

- 世界书用于引导检索、补充规则和风格条件。
- Permanent RAG 提供长期资料。
- Runtime RAG 提供短期记忆。
- Context Planner 决定本轮实际塞进 prompt 的内容。

## 前端扩展服务

`window.AiDndFrontendExtensions` 暴露稳定服务：

- `events`
- `assetRegistry`
- `sceneVisualRenderers`
- `audioManager`
- `settingsPanels`
- `modManager`

前端 mod manifest 轻量结构：

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "0.1.0",
  "permissions": [],
  "requiresTools": [],
  "events": ["npc:speech"],
  "assets": [
    {
      "id": "mira-live2d",
      "type": "live2d",
      "targetType": "npc",
      "targetId": "npc_mira",
      "slot": "portrait",
      "url": "/mods/my-mod/mira.model3.json",
      "renderer": "live2d",
      "metadata": {}
    }
  ]
}
```

Script mod 默认关闭。启用时必须 same-origin，并声明 `frontend:script`。

## 添加新可执行工具

推荐步骤：

1. 在合适领域模块实现纯业务逻辑。
2. 在 `src/tools/` 下创建或扩展 plugin 注册文件。
3. 提供完整 `inputSchema` 和必要 `outputSchema`。
4. 标记 `mutatesState`、`autoCallable`、`annotations.requiresUserAuthorization`。
5. LLM 工具声明 `metadata.usesLlm` 或 `tags: ["llm"]`。
6. 走 `ToolPluginManager.executeTool()`，不要绕过 trace/audit。
7. 写 focused test。
8. 如前端需要直接调用，返回前端工具契约 envelope。

## 添加新内容类型

如果只是新设定类型，优先用宽松字段和规则包模板，不要立刻新增数据库。确实需要独立 collection 时：

1. 在规则包模板里声明 schema。
2. 使用 `system.rule_packs.create_collection_from_template` 创建。
3. 保留未知字段。
4. 扩展字段写入 `metadata.extension.<pluginId>`。
5. 需要数值化时复用 `system.data.quantify_text`，按字段选择参考文件。

## 测试

全量测试：

```bash
npm test
```

常用定向测试：

```bash
npm run build
node --test dist/tests/modding-contracts.test.js
node --test dist/tests/slot-use.test.js
node --test dist/tests/tools.test.js
node --test dist/tests/action-resolver.test.js
node --test dist/tests/e2e-trigger-sensitivity.test.js
node --test dist/tests/data-manager.test.js
```

新增测试应覆盖：

- descriptor/schema 是否能被 Tool Plugin Manager 接受。
- 输入校验失败路径。
- 是否产生 trace。
- 写操作是否要求授权。
- 是否复用已有底层工具，而不是复制状态逻辑。
- 前端 contract 是否返回稳定 `status`。

## 文档与调试产物

正式项目手册统一放在 `manuals/`。不要在项目根目录、`docs/`、调试输出目录或业务模块旁边新增新的项目说明文档。示例素材、导入包或第三方运行环境中自带的 `.md` 可以保留在原位置，但不作为项目手册入口。

调试脚本生成的 Markdown 报告统一写入：

```text
manuals/generated-debug/
```

非 Markdown 的 JSON trace 仍可以放在 `data/*-traces/` 或脚本自己的调试目录中。

运行产物和清理规则：

| 路径 | 类型 | 可否删除 | 说明 |
| --- | --- | --- | --- |
| `dist/` | 构建输出 | 可删 | `npm run build` 和 `npm test` 会重建。 |
| `tmp/` | 临时日志、端到端测试数据 | 可删 | 不应把正式导入示例放在这里。 |
| `.codex-screenshots/` | 前端验证截图 | 可删 | 仅用于人工检查 UI。 |
| `.DS_Store` | macOS 系统文件 | 可删 | 与项目无关。 |
| `data/` | 运行数据库和 trace | 谨慎 | 可能包含用户聊天、RAG、世界线、audit 和工具 trace。 |
| `.runtime/` | 本地 Node 运行环境 | 谨慎 | 删除后启动器可能重新下载。 |
| `chc/` | 导入素材 | 谨慎 | 这里通常是用户或示例导入资料。 |
| `node_modules/` | npm 依赖 | 谨慎 | 删除后需要重新安装依赖。 |
