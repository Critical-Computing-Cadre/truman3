#!/bin/sh
# Checks that every commit a pull request adds has a sign-off: a "Signed-off-by: Name <email>" line,
# which `git commit -s` writes. It's the Developer Certificate of Origin; see CONTRIBUTING.md.
# Merge commits are skipped, since they carry no change of their own.
#
#   sh scripts/check-sign-off.sh <base> <head>     for example: origin/main HEAD
set -eu

base="${1:?Give the base, such as origin/main}"
head="${2:-HEAD}"
missing=0

for commit in $(git rev-list --no-merges "$base..$head"); do
  if ! git log -1 --format=%B "$commit" | grep -qE '^Signed-off-by: .+ <.+@.+>$'; then
    echo "No sign-off: $(git log -1 --format='%h %s' "$commit")"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -ne 0 ]; then
  echo
  echo "$missing commit(s) have no Signed-off-by line. Add one with:"
  echo "  git commit --amend -s          for the newest commit"
  echo "  git rebase --signoff $base     for every commit on the branch"
  echo "CONTRIBUTING.md, \"Sign your work\", says what the line means."
  exit 1
fi
echo "Every commit is signed off."
