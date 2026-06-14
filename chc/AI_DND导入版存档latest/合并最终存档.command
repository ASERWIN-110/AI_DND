#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INPUT_DIR="$PROJECT_ROOT/chc/设定资料包_txt"
OUTPUT_FILE="$PROJECT_ROOT/chc/AI_DND导入版存档latest/八荒RPG_最终设定存档.txt"

pause_if_needed() {
  local status="$1"
  if [[ "${AI_DND_NO_PAUSE:-0}" != "1" ]]; then
    printf '\n按回车退出...'
    read -r _ || true
  fi
  exit "$status"
}

cd "$PROJECT_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。请先安装 Node.js，或从项目根目录使用 npm run chc:merge-txt。"
  pause_if_needed 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
  echo "未找到输入目录：$INPUT_DIR"
  echo "请先核对并保留 chc/设定资料包_txt 中的分项 txt。"
  pause_if_needed 1
fi

echo "输入目录：$INPUT_DIR"
echo "输出文件：$OUTPUT_FILE"
echo
echo "开始合并..."

node scripts/merge-chc-setting-txt.mjs \
  --input "$INPUT_DIR" \
  --output "$OUTPUT_FILE" \
  --force

echo
echo "合并完成：$OUTPUT_FILE"
pause_if_needed 0
