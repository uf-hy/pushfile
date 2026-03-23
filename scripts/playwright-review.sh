#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/root/code/photo-staging"
AUTH_HELPER="$PROJECT_ROOT/tools/playwright-review-auth.py"

if [ -f "$PROJECT_ROOT/.env" ] && [ -z "${UPLOAD_SECRET:-}" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*)
        continue
        ;;
      UPLOAD_SECRET=*)
        export UPLOAD_SECRET="${line#UPLOAD_SECRET=}"
        ;;
    esac
  done < "$PROJECT_ROOT/.env"
fi

BASE_URL="${PLAYWRIGHT_REVIEW_BASE_URL:-https://phototest.xaihub.de}"
TARGET="${PLAYWRIGHT_REVIEW_TARGET:-/manage/dashboard}"
MODE="${PLAYWRIGHT_REVIEW_MODE:-capture}"
LOGIN_MODE="${PLAYWRIGHT_REVIEW_LOGIN:-auto}"
PROFILE_DIR="${PLAYWRIGHT_REVIEW_PROFILE_DIR:-$PROJECT_ROOT/.playwright-review/profile/default}"
ARTIFACTS_DIR="${PLAYWRIGHT_REVIEW_ARTIFACTS_DIR:-$PROJECT_ROOT/.playwright-review/artifacts}"
NAME="${PLAYWRIGHT_REVIEW_NAME:-}"
SETTLE_MS="${PLAYWRIGHT_REVIEW_SETTLE_MS:-1200}"

usage() {
  cat <<'EOF'
用法:
  bash scripts/playwright-review.sh [target] [options]

说明:
  一个最小的本地 Playwright 直连入口。
  默认复用仓库内持久化 profile，并把截图/运行产物写到 .playwright-review/ 下。

参数:
  target                 目标路径或完整 URL，默认 /manage/dashboard
  --open                 打开页面并保留浏览器，便于手动查看
  --capture              打开页面后截图并退出（默认）
  --refresh-login        强制刷新登录态（首次引导或登录失效时使用）
  --login                兼容旧写法，等同于 --refresh-login
  --no-login             不自动登录
  --base-url <url>       基础地址，默认 https://phototest.xaihub.de
  --profile-dir <path>   持久化浏览器目录，默认 .playwright-review/profile/default
  --artifacts-dir <path> 产物目录，默认 .playwright-review/artifacts
  --name <name>          自定义截图名（不带扩展名）
  --settle-ms <ms>       页面稳定等待毫秒数，默认 1200
  -h, --help             显示帮助

示例:
  bash scripts/playwright-review.sh /manage
  bash scripts/playwright-review.sh /manage/grid --open
  bash scripts/playwright-review.sh /login --capture --no-login --name login-page
  bash scripts/playwright-review.sh https://phototest.xaihub.de/manage/dashboard --open
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --open)
      MODE="open"
      shift
      ;;
    --capture)
      MODE="capture"
      shift
      ;;
    --refresh-login|--login)
      LOGIN_MODE="always"
      shift
      ;;
    --no-login)
      LOGIN_MODE="never"
      shift
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --profile-dir)
      PROFILE_DIR="$2"
      shift 2
      ;;
    --artifacts-dir)
      ARTIFACTS_DIR="$2"
      shift 2
      ;;
    --name)
      NAME="$2"
      shift 2
      ;;
    --settle-ms)
      SETTLE_MS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      TARGET="$1"
      shift
      ;;
  esac
done

mkdir -p "$PROFILE_DIR" "$ARTIFACTS_DIR"

BROWSER_PROFILE_DIR="$PROFILE_DIR/user-data"
STORAGE_STATE_PATH="$PROFILE_DIR/storage-state.json"

build_target_url() {
  python3 - "$BASE_URL" "$TARGET" <<'PY'
import sys
from urllib.parse import urljoin

base_url = sys.argv[1].rstrip('/') + '/'
target = sys.argv[2]
if target.startswith(('http://', 'https://')):
    print(target)
else:
    print(urljoin(base_url, target.lstrip('/')))
PY
}

build_capture_name() {
  if [ -n "$NAME" ]; then
    printf '%s\n' "$NAME"
    return
  fi

  python3 - "$TARGET" <<'PY'
import re
import sys
from datetime import datetime
from urllib.parse import urlsplit

target = sys.argv[1]
if target.startswith(('http://', 'https://')):
    target = urlsplit(target).path or '/'

slug = re.sub(r'[^a-zA-Z0-9._-]+', '-', target.strip('/').replace('/', '-')).strip('-') or 'capture'
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
print(f'{slug}-{stamp}')
PY
}

needs_login_bootstrap() {
  case "$LOGIN_MODE" in
    always)
      return 0
      ;;
    never)
      return 1
      ;;
  esac

  if [ -f "$STORAGE_STATE_PATH" ]; then
    return 1
  fi

  python3 - "$TARGET" <<'PY'
import sys
from urllib.parse import urlsplit

target = sys.argv[1]
if target.startswith(('http://', 'https://')):
    target = urlsplit(target).path
raise SystemExit(0 if target.startswith('/manage') else 1)
PY
}

TARGET_URL="$(build_target_url)"

if needs_login_bootstrap; then
  python3 "$AUTH_HELPER" \
    --base-url "$BASE_URL" \
    --state-file "$STORAGE_STATE_PATH"
fi

STORAGE_ARGS=(--save-storage "$STORAGE_STATE_PATH")
if [ -f "$STORAGE_STATE_PATH" ]; then
  STORAGE_ARGS=(--load-storage "$STORAGE_STATE_PATH" "${STORAGE_ARGS[@]}")
fi

if [ "$MODE" = "open" ]; then
  exec npx playwright open "$TARGET_URL" \
    --browser chromium \
    --ignore-https-errors \
    --timeout 30000 \
    --viewport-size "1440,960" \
    --user-data-dir "$BROWSER_PROFILE_DIR" \
    "${STORAGE_ARGS[@]}"
fi

CAPTURE_NAME="$(build_capture_name)"
CAPTURE_PATH="$ARTIFACTS_DIR/$CAPTURE_NAME.png"

exec npx playwright screenshot "$TARGET_URL" "$CAPTURE_PATH" \
  --browser chromium \
  --ignore-https-errors \
  --timeout 30000 \
  --viewport-size "1440,960" \
  --wait-for-timeout "$SETTLE_MS" \
  --full-page \
  "${STORAGE_ARGS[@]}"
