# 26. Spaces and several feeds

## Context

A forum needs posts that belong to communities, and more than one list of posts with its own order. Dominic decided how much of this a study controls. The reasoning and his answers are in the vault note `Spaces and feeds design`.

## Decision

`spaces` is a feature, off in Classic.

- **Only researchers make spaces,** and they freeze with a version, by the same trigger as actors. There's no plan for participants making them.
- **A post is in one space at most.** A comment goes where its post goes.
- **Whether people start in a space, can join and leave, and which conditions see it are study design,** so they're settings with no opinion from Truman. A row in `space_memberships` exists only once someone has joined or left, and until then the space's `starts_joined` decides. Each change is also an event.
- **Home shows posts with no space, and posts from spaces this person is in.** A space's page shows its posts either way. A post in a space a condition can't see is hidden everywhere, and can't be acted on.
- **With the feature off in a condition, posts in spaces show as ordinary posts.** So a study can compare one feed against communities using the same content. The builder warns about it.
- **A surface is a list of posts:** `GET /feed?surface=home`, the default, and `surface=space&space=<key>`. Home is still recorded as `feed`, so its data reads the same as before. The order on a space's page is `feed.spaceRanker`, or else the study's `ranker`.
- **Two new rankers, each with a version.** `new` is newest first, and `top` is highest score first, with ties going to the newer post. A score is what the study wrote, plus scripted votes that have happened, plus this person's own vote. So one vote moves a post by one, as on a real forum. Scores are recorded in `feed_impressions`.
- **Participants choosing an order is a setting, off by default.** Each change is an event, and each impression records what was chosen, in `sort`. A choice lasts until the page reloads, and isn't stored.
- **A moderator is a tag on someone in the cast,** and nothing more. It isn't tied to spaces, since studies without them have had moderators. Rules are text on a space.

## Alternatives

- **Storing spaces in settings.** Posts need to point at them, and they'd have no history or undo in a draft.
- **A row per person per space when someone joins a study.** It writes a lot for a choice most people won't make, and wouldn't say whether someone chose it.
- **Pictures on spaces.** Left out for now, since each image kind needs a folder, an upload, and copying into packs. Nothing else depends on it.

## Consequences

- Removing posts, judgments, and banning aren't here. They need their own design, and nothing here blocks them.
- "Communities" is the word participants see, for now. A template should decide this later.
- Following, titles on posts, and the Forum template are still to come.
- Space pages have no order of their own by condition in the builder, only in study files.
