#!/usr/bin/env bash
set -u

cd "$(dirname "$0")" || exit 1

if [[ "${AI_DND_NO_PAUSE:-0}" == "1" ]]; then
  AI_DND_PAUSE_ON_EXIT=0
else
  AI_DND_PAUSE_ON_EXIT="${AI_DND_PAUSE_ON_EXIT:-1}"
fi

export AI_DND_PAUSE_ON_EXIT
sh ./quick-start.sh "$@"
status=$?

exit "$status"
