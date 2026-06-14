# AI DND 文档入口

本目录是项目正式手册目录。正式说明、开发规范、前端扩展契约和示例索引都放在这里；运行脚本如需生成 Markdown 调试报告，也应写入 `manuals/generated-debug/`。示例素材、导入包或第三方运行环境中自带的 `.md` 只作为外部资料，不作为项目手册入口。

## 文档

- [使用手册](user-manual.md)：启动、网页界面、角色卡、聊天、Tool Manager、常见玩法系统和排障。
- [开发者文档](developer-guide.md)：前后端架构、数据流、接口、可扩展性、统一规范、工具插件、数据库/RAG 生命周期和测试方式。
- [Prompt 流表](prompt-flow-table.md)：按玩家输入、固定功能性 prompt、参考文本和中文工具输出整理 Agent Loop 的 prompt 拼合关系。
- [示例数据导入说明](example-data-guide.md)：示例角色卡、sidecar 数据、导入步骤和打包说明。
- [新手入门范例：《月井失灯》](beginner-example-guide.md)：完整新手 bundle 存档、Prompt、sidecar 数据、参考文本、文件用途和导入位置。
- [玩家视角前端游玩验证报告](generated-debug/player-playtest-2026-05-31.md)：文件路径导入、主角绑定、5 轮聊天、桌面布局和玩家面板验证记录。

## 规范索引

- 接口说明：见 [开发者文档 / 接口说明](developer-guide.md#接口说明)。
- 可扩展性说明：见 [开发者文档 / 可扩展性说明](developer-guide.md#可扩展性说明)。
- 统一规范：见 [开发者文档 / 统一规范](developer-guide.md#统一规范)。
- LLM 语义写库与 SQLite 分类器：见 [开发者文档 / SQLite 管理与语义写库分类器](developer-guide.md#sqlite-管理与语义写库分类器)。
- 聊天导入导出：见 [使用手册 / 聊天导入导出](user-manual.md#聊天导入导出)。
- 删除聊天资源清理：见 [使用手册 / 删除聊天后的资源清理](user-manual.md#删除聊天后的资源清理)。
- 使用侧功能说明：见 [使用手册 / 常用系统](user-manual.md#常用系统)。

## 目录约定

```text
manuals/
  README.md             文档入口
  user-manual.md        用户和测试人员使用手册
  developer-guide.md    开发、扩展、调试和维护文档
  examples/             插件、前端工具返回、宽松字段示例
  generated-debug/      调试脚本生成的 Markdown 报告目录
```

旧的根目录 README、`docs/` 下的分散说明，以及 `LLM_Tool_Debug/`、`Combat_Module_Debug/`、`No_LLM_Combat_Debug/` 里的旧 Markdown 运行产物已经合并或清理。需要重新生成调试材料时，使用对应脚本，输出应进入 `manuals/generated-debug/`。

生成产物不应提交或当作源码维护：

```text
dist/                TypeScript 构建输出，可由 npm run build 重建
tmp/                 临时服务日志或端到端测试数据
.codex-screenshots/  前端验证截图
.DS_Store            macOS 系统文件
```

不要把正式导入示例或手册引用路径放在 `tmp/`。不要把 `data/`、`.runtime/`、`chc/`、`node_modules/` 当成可随意清理的产物。它们分别可能包含运行数据、本地运行环境、导入素材和依赖。

## 快速启动

需要 Node.js 24 或更新版本；如果未安装，或 `.runtime/node` 是其它系统/CPU 的版本，启动器会在首次运行时尝试下载安装到项目目录的 `.runtime/node`。

```bash
npm run quickstart
```

默认地址：

```text
Chat:         http://127.0.0.1:8787/
Tool Manager: http://127.0.0.1:8787/tool-manager/
```

手机、局域网或 Tailscale 访问：

```bash
npm run quickstart -- --tailscale --no-open
```

然后在手机浏览器打开终端打印的 `http://<电脑IP>:8787/`。

验证：

```bash
npm test
```

轻量源码检查：

```bash
npm run typecheck
```

跨平台注意：如果项目目录从 macOS、Windows 或 Linux 的另一台机器复制过来，`node_modules` 可能包含错误平台的原生依赖。源码开发模式启动失败时，删除 `node_modules` 后重新启动，让启动器在当前系统重新安装依赖。

轻量开局只需要先准备背景、主角和规则；NPC、地图、阵营、物品、世界书和 RAG 可按需要后续生成或导入。详细说明见 [使用手册 / 轻量开局：背景 + 主角 + 规则](user-manual.md#轻量开局背景--主角--规则)。

## 当前验证状态

当前版本已经按开放跑团目标做过系统级回归：

- 多题材普通动作：克苏鲁、神话、修仙、校园、赛博朋克、蒸汽朋克、低武、星战等常见调查、社交、技术、移动和资源动作不会被单一剧本假设锁死。
- 玩家结果宣称：玩家把“将要做的事”写成“已经成功”“无需判定”“write it as fact”等结果时，系统会标记为结果宣称，但仍按尝试动作进入骰子/裁决流程。
- 荒诞动作：说服重力、把月亮装进口袋、向影子借钱等不合常理动作可以被当作高荒诞尝试处理；成功也会被限制为短暂、局部、有代价的世界内解释。
- 模糊 DC：日常调查、阅读、打听、邀请、扫描、普通撬锁等动作默认不会全部压到 10 以上；普通高风险和极端现实改写仍有更高 DC。
- 重新裁决：玩家指出遗漏熟练、工具、优势、证据、DC 过高等可核验依据时，系统会生成修正计划并重跑裁决；单纯要求“必须成功”不会直接改判。
- 长线对话与数据库：端到端测试覆盖多轮聊天中动态创建 `story_metrics` 集合，并更新同一条 `霓虹污染指数` 记录，验证 schema/collection/record 的实时扩展路径没有被收窄。

最近一次完整验证命令：

```bash
npm test
```

结果为 319 项通过，0 项失败。
