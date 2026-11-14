#!/usr/bin/env bash
# Deploys one stage from GitHub Actions (ADR 88). Run by .github/workflows/deploy.yml, after the
# apps are built and AWS has let the job take the stage's deploy role.
#
#   bash scripts/deploy-from-ci.sh <stage> <commit before this push> <commit being deployed>
#
# It refuses two kinds of change, which a person has to deploy from a terminal instead:
#   - one that adds permissions or opens a firewall, since nobody is here to read it and type "y"
#   - one with a migration marked "-- stop-the-api:", which needs the API stopped first (ADR 86)
#
# These logs are public, so the stage's addresses are kept out of them.
# pipefail matters here: the deploy's output goes through a filter, and without it a deploy that
# failed would look like the filter succeeding.
set -euo pipefail

stage="$1"
before="${2:-}"
after="${3:-HEAD}"
cdk="pnpm --filter @truman3/infra exec cdk"
out="$(mktemp)"

# The stack's outputs include its address and the IDs of its network. Neither belongs in a public
# log. This also covers an address that turns up in a diff.
quietly() {
  sed -E \
    -e 's#[a-z0-9]+\.cloudfront\.net#(address)#g' \
    -e "/^truman3-${stage}\.[A-Za-z0-9]+ = /d"
}

refuse() {
  echo "::error title=A person has to deploy this::$1"
  echo
  echo "$1"
  echo "See docs/cloud.md, \"Deploys from GitHub\"."
  exit 1
}

# A migration that can't run under the old API.
if [ -n "$before" ] && git cat-file -e "$before^{commit}" 2>/dev/null; then
  changed="$(git diff --name-only "$before" "$after" -- packages/db/migrations | grep '\.sql$' || true)"
  for file in $changed; do
    if [ -f "$file" ] && grep -q -E '^--[[:space:]]*stop-the-api:' "$file"; then
      refuse "$file is marked stop-the-api, so the API has to be stopped before it runs."
    fi
  done
fi

echo "::group::What this deploy changes"
$cdk diff --no-lookups -c "stage=$stage" 2>&1 | quietly
echo "::endgroup::"

# With --security-only, the diff is only what adds permissions or opens a firewall, and --fail
# makes it exit 1 when there's any.
if ! $cdk diff --no-lookups -c "stage=$stage" --security-only --fail >"$out" 2>&1; then
  quietly <"$out"
  refuse "This change adds permissions or opens a firewall. Deploys like that wait for a person to read them."
fi

# Even so, this never turns the question off. If the check above missed something, the deploy
# stops here, because there's nobody to answer.
$cdk deploy --no-lookups -c "stage=$stage" --require-approval broadening \
  --outputs-file "$out.json" </dev/null 2>&1 | quietly

# Is it answering? The address comes from the stack and isn't printed.
address="$(node -e 'const o = require(process.argv[1]); console.log(Object.values(o)[0].Address)' "$out.json")"
for attempt in 1 2 3 4 5 6; do
  if curl --fail --silent --show-error --max-time 15 "$address/api/health" >/dev/null 2>&1; then
    echo "The API on $stage answers."
    exit 0
  fi
  sleep 10
done
echo "::error title=The API isn't answering::Deployed $stage, but its API didn't answer in a minute."
exit 1
