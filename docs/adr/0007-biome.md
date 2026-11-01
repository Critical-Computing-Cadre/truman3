# 7. Biome for formatting and linting

**Status:** Accepted

## Decision

Biome handles both formatting and linting, with its recommended rules on.

## Why

One tool and one config file, and it's fast enough to run constantly.

## Alternatives

- **ESLint plus Prettier:** more widely known, with more rules, but two tools and more configuration. We can revisit this if we need a rule Biome lacks.

## Worth knowing

Running `biome migrate` set the lint preset to `none`, which silently disabled linting. Check `biome.json` after running it.
