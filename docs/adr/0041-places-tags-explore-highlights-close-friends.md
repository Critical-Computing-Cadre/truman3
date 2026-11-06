# 41. Places, tags, Explore, highlights, and close friends

## Context

Photo's second part, from the vault note `Photo template design`, section 8. Part 1 (ADR 39) added the template, stories, and a profile grid. This adds the rest of what Instagram-like platforms have that a study might use. Each is its own feature (ADR 18), so a study can turn it off or compare it across conditions.

## Decision

- **`places`: a post can say where it was.** A study writes `place` in `posts.csv`, and participants can add one when they post. Tapping a place lists every post there (`/feed?surface=place`). On in Photo only.
- **`photoTags`: a study can tag people from the cast in a post,** as `tagged` in `posts.csv`, separated by `|`. They're stored as `content.tagged_actor_ids`, checked against the cast when the study is saved. Photo shows a person icon on the photo that shows their names. Other layouts say "with Ann and Bob." A profile gets a Tagged tab (`/feed?surface=tagged`). On in Photo only.
- **`exploreGrid`: Explore is a grid of photos from people someone doesn't follow,** not their own, not ads, and not reposts (`/feed?surface=explore`). It's in the condition's feed order. The feed's orders sort by votes, not likes, so "most liked first" would need a new order. What it showed is in impressions, as for any list. On in Photo only.
- **`highlights`: a story can be in a highlight,** as `highlight` in `stories.csv`, which keeps it on its poster's profile under that name after it's gone from the row. Seeing one from a highlight is `story.viewed` with `from: highlight`. The server only takes that for a story in a highlight, with the feature on.
- **`closeFriends`: a story can be for close friends only,** as `closeFriends` in `stories.csv`. It gets a green ring and a label, which tells the participant they're on that person's list. Participants keep their own list of cast members, as a new relation, `closeFriend`, with events `actor.close_friend_added` and `actor.close_friend_removed`. They can post a story to only them, recorded as `audience` on `content.created`. Who "viewed" a close-friends story of theirs only includes people on the list.
- **New features are off in the other templates,** even where a real platform has them, like Facebook's places. A saved study keeps the features it had, and takes anything newer from its template, so turning one on in Classic would change Classic studies already running. A study can turn them on.
- **A grid is one component,** `PostGrid`, used by profiles, Explore, and a place's page.

## Alternatives

- **A table for tags.** An array on `content` is enough for a short list from the cast, and is what a draft and the export need. Nothing looks posts up by who's tagged except the Tagged tab, which reads one study's posts anyway.
- **Highlights as their own rows, listing stories.** A name on each story is simpler for a study to write in one CSV, and keeps a story in one highlight, as on these platforms.
- **Letting participants tag people, make highlights, or be tagged by the study.** Each changes what a study can do, so they're questions in the design note rather than choices made here.

## Consequences

- `content` has four new columns: `place`, `tagged_actor_ids`, `highlight`, and `close_friends`. The export adds them to `content.csv`.
- Participants can't tag people or make highlights yet.
- A close-friends story's ring only says the participant is on the list. Nothing stops a study writing one for someone the participant hasn't met, which may be what a study wants.
