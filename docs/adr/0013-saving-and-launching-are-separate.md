# 13. Saving and launching are separate

**Status:** Accepted

## Decision

Saving a version, from a draft or a file import, never changes what participants get. Each study points at one live version, and new participants get that. A researcher launches a version explicitly, and can stop new participants at any time. Each launch and stop is recorded, and appears in the codebook.

Any saved version can be tried with a test participant, in a chosen condition. Test participants don't use up block positions, and stay out of exports and participant counts.

## Why

Researchers need to check a study as a participant would before anyone real sees it. If saving went live immediately, nobody could save work without affecting a running study.

## Alternatives

- **Newest version is always live:** simple, and how this first worked, but a team could change a running study by accident.
- **A separate staging copy of the platform:** heavier, and it wouldn't test the same data.
- **Test participants as a flag in exports:** it would leave cleaning up to every analyst, and someone would eventually forget.

## Costs

There's one more step before a study runs. A study can now have people on an older version after a new launch, which the launch dialog points out, since the analysis has to account for it.
