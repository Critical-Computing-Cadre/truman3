# 24. A post has a list of attachments

## Context

Photo platforms need several images on a post, and video is planned. A single `media_key` allows neither.

## Decision

`content.attachments` is a JSON list in order, where each item has a `type` and a `key`. `image` is the only type for now. The feed sends each with a `type` and a `url`.

- **`galleries` is a feature, off in Classic.** Without it, a post shows only its first photo, and the server refuses more than one from a participant. Validation warns when written posts would lose photos.
- **Spreadsheets keep one `picture` column,** with photos separated by `|`, the same way `condition` works. Definitions and drafts hold `pictures`, a list.
- **Up to 10 per post.** If any photo can't be used, the whole post is refused.
- **A builder can only add images it stored,** or keep ones already on that post, which is how a post imported with hosted URLs can still gain a photo.

## Alternatives

- **An `attachments` table.** It would add a query per feed and another thing to copy when freezing, for a list that's only ever read with its post. The key can move to a table if something needs to look up content by its file.
- **Keeping `media_key` and adding more beside it.** There would be two places for the same thing, and no real data to protect by doing it.

## Consequences

Migration 0018 has to change frozen content, which the `content_frozen` trigger forbids, so it turns that trigger off for one statement. It runs as the owner, and only moves the same image into the new form. It's the only migration that does this, and shouldn't become a habit.

The `media` column in `content.csv` can now hold several values. Video needs its own type, playback, and hosting decisions, which this doesn't make.
