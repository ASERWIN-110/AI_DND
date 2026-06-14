#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
AI_DND_PAUSE_ON_EXIT=1 sh ./quick-start.sh "$@"
