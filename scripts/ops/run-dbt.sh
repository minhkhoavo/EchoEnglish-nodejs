#!/usr/bin/env bash
# Runs the dbt project against ClickHouse inside a pinned container (image is built once and
# cached, keyed by the hash of requirements.txt), so no Python toolchain is needed on the host.
#   DBT_CH_HOST=... DBT_CH_PORT=8123 DBT_CH_USER=... DBT_CH_PASSWORD=... DBT_CH_DATABASE=echo \
#     scripts/ops/run-dbt.sh [build|run|test|compile]   (default: build)
set -euo pipefail
cd "$(dirname "$0")/../../analytics/dbt"
CMD="${1:-build}"
IMAGE="echo-dbt:$(sha256sum requirements.txt | cut -c1-8)"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -q -t "$IMAGE" . >/dev/null
docker run --rm --network host \
  -v "$PWD":/dbt -w /dbt \
  -e DBT_PROFILES_DIR=/dbt \
  -e DBT_CH_HOST -e DBT_CH_PORT -e DBT_CH_USER -e DBT_CH_PASSWORD -e DBT_CH_DATABASE \
  "$IMAGE" dbt "$CMD" --no-partial-parse
