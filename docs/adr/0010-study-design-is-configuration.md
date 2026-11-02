# 10. Study design choices are settings, and CSV is only one way to write them

**Status:** Accepted

## Decision

Two related rules:

1. **Values from older Truman studies are not platform constants.** Things like a 24-hour feed window, a 10-minute pin on new posts, how like counts get drawn, or a 1.5-second read threshold are study design decisions. Each one is a setting. If a study doesn't turn on a behavior, it doesn't happen. Whatever a study used is frozen with its version, so it can be reported in a methods section.

   Some choices have no default at all, so a researcher has to make them. Condition assignment is one: every study has to choose `uniform` or `blocked`.

2. **A study definition is a data structure, not a set of files.** `packages/core` defines what a valid study is and how to check it, independent of where it came from. CSV and YAML files are one way to produce a study definition. A visual builder, a script, or an agent are others, and they share the same rules and plain-language error messages.

## Why

Researchers have found building simulations in CSV files painful. CSV was the least bad option available at the time, and it's kept because people know it, but it shouldn't shape the core of the system. Better authoring tools for non-technical researchers are an explicit goal.

Keeping the rules in `core` also means they can run in a browser, so a future builder can show errors as someone types.

## Alternatives

- **Default to classic Truman's values:** convenient, but design choices get made silently, and they're easy to leave out of a methods section.
- **Make CSV the source of truth:** simplest today, but every future tool would have to generate spreadsheets.

## Costs

`study.yaml` is longer, since it states more. Starter templates can handle this later.
