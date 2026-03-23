#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/root/code/photo-staging"
RUNNER="/root/.config/opencode/skills/photo-visual-loop/scripts/run_loop.py"

if [ "$#" -lt 2 ]; then
  echo "用法: $0 <path> <name> [extra args...]" >&2
  echo "示例: $0 /dashboard dashboard --review vision" >&2
  exit 1
fi

PAGE_PATH="$1"
PAGE_NAME="$2"
shift 2

exec python3 "$RUNNER" \
  --project-root "$PROJECT_ROOT" \
  --path "$PAGE_PATH" \
  --name "$PAGE_NAME" \
  "$@"
