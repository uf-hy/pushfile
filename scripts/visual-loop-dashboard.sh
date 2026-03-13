#!/usr/bin/env bash
set -euo pipefail

exec /root/code/photo-staging/scripts/visual-loop-page.sh \
  /dashboard \
  dashboard \
  --review vision \
  --review-focus layout-balance \
  --review-focus whitespace-rhythm \
  --review-focus text-semantics \
  --review-focus data-consistency \
  --review-focus chart-semantics \
  "$@"
