# 示例数据导入说明

本文说明如何把仓库里的示例角色卡和配套数据库资料导入 AI DND。

## 示例文件

当前可用示例：

```text
examples/characters/beginner-moonwell.card.json
examples/characters/beginner-moonwell.resources.json
examples/characters/beginner-moonwell.bundle.json
examples/characters/beginner-moonwell.prompts.md
examples/characters/beginner-moonwell.INSTRUCTIONS.txt
examples/characters/harbor-bronze-door.card.json
examples/characters/harbor-bronze-door.resources.json
examples/characters/harbor-bronze-door.INSTRUCTIONS.txt
```

`beginner-moonwell.bundle.json` 是推荐的新手入门完整存档，只需要在角色导入窗口填一个文件路径。`beginner-moonwell.card.json` 是拆分版角色卡，包含完整中文设定和 GM Prompt。`beginner-moonwell.resources.json` 是拆分版配套 sidecar，包含主角、NPC、地图、任务、关系图、阵营和 RAG 资料。完整说明见 [新手入门范例：《月井失灯》](beginner-example-guide.md)。

`beginner-moonwell.resources.json` 还包含标准 `reference_texts` 和兼容 `beginner_reference_texts`。这不是剧情文本，而是给 GM 和工具使用的量尺，用来约束难度、物品效果、NPC 信任/恐慌、资源消耗和奖励价值，避免 AI 把普通物品或低压新手事件数值化得过强。

`harbor-bronze-door.card.json` 是 Character Card V2 风格角色卡。`harbor-bronze-door.resources.json` 是 sidecar，包含初始聊天数据库资料和全局关系图资料。

## 通过前端载入

推荐先导入新手完整存档：

1. 启动项目。
2. 打开 `http://127.0.0.1:8787/`。
3. 点击右侧角色区的“导入”。
4. 在 `Character Card JSON 文件路径` 输入：

```text
examples/characters/beginner-moonwell.bundle.json
```

5. `数据库/RAG sidecar JSON 文件路径` 留空。
6. 点击“导入角色”。
7. 创建新聊天。
8. 弹出“选择玩家 NPC 设定”时选择 `阿芦`。

拆分导入示例：

1. 启动项目。
2. 打开 `http://127.0.0.1:8787/`。
3. 点击右侧角色区的“导入”。
4. 在 `Character Card JSON 文件路径` 输入：

```text
examples/characters/harbor-bronze-door.card.json
```

5. 在 `数据库/RAG sidecar JSON 文件路径` 输入：

```text
examples/characters/harbor-bronze-door.resources.json
```

6. 点击“导入角色”。
7. 创建新聊天。
8. 弹出“选择玩家 NPC 设定”时选择 `Linya`。

## 示例包含的内容

- 角色卡：`Harbor GM - Bronze Door`。
- 玩家角色：`Linya`。
- NPC：`Mel`。
- 背包：`Salt chalk`、`Hooded lantern`、`Wax scraper`、`Evidence envelope`。
- 状态栏：HP、Sanity、conditions、resources、equipment、special statuses。
- 技能栏：`Trace observation`、`Low voice questioning`、`Salt warding`。
- 场景：`Bronze door under Old Bell Gate`。
- 地图：`Old Bell Gate threshold`。
- 关系图：NPC 关系、阵营节点、阵营关系和成员关系。
- 新手范例另有 `reference_texts`，可在数据面板中查看；旧兼容集合为 `beginner_reference_texts`。

## 推荐测试输入

```text
I inspect the broken salt line and drag marks without touching the bronze door.
```

```text
I mark the clean side of the salt line with salt chalk, then smell the black wax.
```

```text
I ask Mel who touched this door recently, in exact order, and watch his hands.
```

## 编入发布包

打包脚本会把 `examples/` 和 `manuals/` 一起复制进发布包。生成发布包：

```bash
npm run package:release
```

默认发布包不包含 `node_modules`，目标机器首次启动时会在项目目录内安装 npm 依赖。生成包含当前依赖环境的完整包：

```bash
npm run package:release:full
```

完整包会复制 `node_modules`，通常不需要重新安装 npm 依赖。若目标机器没有 Node.js 24 或更新版本，或 `.runtime/node` 是其它系统/CPU 的版本，启动器会在首次运行时尝试下载当前平台的官方 Node.js 24 到项目目录的 `.runtime/node`。发布包解压后仍使用同样的相对路径导入示例。

如果是源码包或开发目录，不建议跨 macOS/Windows/Linux 直接复用 `node_modules`；遇到 `esbuild`、`tsx` 或其它原生包平台不匹配时，删除 `node_modules` 后重新启动，让启动器在当前系统重新安装。

## 清空用户数据后重新载入

清空用户数据会删除运行期数据库、聊天数据库、trace、临时测试数据和浏览器本地选择状态，但不会删除 `examples/` 里的示例文件。

清空后重新启动项目，再按“通过前端载入”步骤导入示例即可恢复一份干净的可玩数据。
