# 12. Drafts are saved item by item

**Status:** Accepted

## Decision

A study being worked on is a draft: a copy of its settings, plus one row per actor, post, comment, and reaction. Each item saves on its own, and every change goes into a history saying who changed what, and when. A study has one open draft at a time, so a team works on the same thing. Saving a draft creates a new frozen version through the same code an import uses, and closes the draft.

Every item records where it came from: a file, a researcher, a pack, or a model.

## Why

Researchers work together at the same time, usually in a shared Google Sheet. If each item saves separately, two people working on different posts can't conflict. If two people change the same post, the last save wins, and the other version stays in the history.

Researchers shouldn't have to learn a second set of rules, so a draft is converted to a study definition and checked by the same validation as a study in files.

Provenance is recorded from the start because it belongs in a methods section, and it can't be reconstructed later.

## Alternatives

- **One large document per draft:** simple, but any two people editing at once would overwrite each other.
- **Character-by-character merging (CRDTs), as in Google Docs:** a lot of complexity for short posts, where two people rarely edit the same one. It remains possible for longer pages if this falls short.
- **Editing versions directly:** versions are frozen on purpose, so that data always ties to exactly what participants saw.
- **Several open drafts per study:** flexible, but people would need a way to merge them.

## Costs

Draft items point at each other by ID, while study definitions use usernames and references, so there's a conversion step. Saving a draft makes it live for new participants right away, which the app warns about. A separate launch step can come later.
