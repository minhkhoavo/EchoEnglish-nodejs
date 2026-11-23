#!/usr/bin/env bash
# Manual rollback on the VPS to a previously deployed immutable image.
#   ./rollback.sh <git-sha>          # e.g. ./rollback.sh 6dedaf1c0d...
#   ./rollback.sh                    # lists the 10 most recent local tags
# Requires DOCKER_USERNAME in the environment and /home/apps/EchoEnglish/.env on the host.
set -euo pipefail
: "${DOCKER_USERNAME:?set DOCKER_USERNAME}"
REPO="${DOCKER_USERNAME}/echo-english"
TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "Recent local tags for ${REPO}:"
  docker images "${REPO}" --format '{{.Tag}}\t{{.CreatedSince}}' | head -10
  exit 0
fi
IMAGE="${REPO}:${TAG}"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE"
docker stop echo-english 2>/dev/null || true
docker rm echo-english 2>/dev/null || true
docker run -d --name echo-english --restart unless-stopped \
  --env-file /home/apps/EchoEnglish/.env -p 4000:4000 "$IMAGE"
for i in $(seq 1 10); do
  # probe from inside the container: no dependency on curl on the host.
  # any HTTP status (401 from the auth gate is fine) proves the process is serving
  if docker exec echo-english node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||4000,path:'/',timeout:4000},r=>{r.resume();process.exit(0)}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})" >/dev/null 2>&1; then
    echo "Rolled back to ${TAG}"
    exit 0
  fi
  sleep 3
done
echo "Rollback target ${TAG} did not come up" >&2
exit 1
