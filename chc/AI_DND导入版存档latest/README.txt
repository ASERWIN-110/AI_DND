这里是 CHC 的 AI_DND 最新导入存档目录。

用于导入的文件是：
八荒RPG_最终导入存档.bundle.json

兼容副本是：
八荒RPG_AI_DND_完整存档.bundle.json

审阅用的合并 TXT 是：
八荒RPG_最终设定存档.txt

注意：TXT 只给人工核对和留档，不能作为 AI_DND 角色导入文件。导入时请在角色卡导入路径中选择 .bundle.json。

如果只想重新合并审阅 TXT，双击：
合并最终存档.command

也可以在项目根目录运行：
npm run chc:merge-txt -- --force

如果需要重新生成可导入 JSON，运行：
node scripts/build-chc-ai-dnd-bundle.mjs

快速启动步骤见：
快速启动方案.md
