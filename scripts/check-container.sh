#!/bin/sh
# Builds the API's container and proves it works: it updates an empty database, can do that twice,
# starts as a non-root user, answers under /api, and reaches its database. Needs Docker. Nothing it
# creates is kept.
set -eu

PORT="${TRUMAN_CHECK_PORT:-3220}"
compose() { docker compose --file compose.production.yaml "$@"; }

finish() {
  status=$?
  if [ "$status" -ne 0 ]; then
    compose logs --no-color api migrate || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap finish EXIT

echo "Building, updating the database, and starting the API..."
compose up --build --detach --wait api

echo "Updating the database a second time, which should change nothing..."
compose run --rm migrate

echo "Checking it doesn't run as root..."
user="$(compose exec -T api id -u)"
[ "$user" != "0" ] || { echo "The API is running as root."; exit 1; }

echo "Checking it answers under /api, and reaches its database..."
curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/health/ready"
echo
curl --fail --silent --show-error "http://127.0.0.1:$PORT/health"
echo
status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "http://127.0.0.1:$PORT/api/studies/no-such-study/entry")"
[ "$status" = "404" ] || { echo "Asking for a missing study answered $status, not 404."; exit 1; }

echo "Checking a failed request keeps its values out of the logs..."
# Postgres can't store this character, so the query fails with the value in its error message.
curl --silent --output /dev/null "http://127.0.0.1:$PORT/api/studies/SECRET-VALUE%00/entry"
if compose logs --no-color api | grep -q "SECRET-VALUE"; then
  echo "A value from a request reached the logs."
  exit 1
fi

echo "Checking nothing it shouldn't hold is in the image..."
if compose exec -T api sh -c 'test -e /app/.env || test -e /app/apps/participant || test -e /app/e2e'; then
  echo "The image holds something it shouldn't."
  exit 1
fi

echo "The container works."
