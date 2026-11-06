# 39. Photo, and stories

## Context

The fourth template, like Instagram in a browser, from the vault notes `Photo template design` and `Template looks`. Dominic added screenshots of real platforms, and asked for templates to look and work more like them. This is Photo's first part.

## Decision

- **Template `photo`, layout `photo`.** A rail of icons down the left on a wide screen, and icons along the bottom on a phone. Square photos, edge to edge, with icons under them, then who liked it and the caption. It has no tabs and no quotes by default, as Dominic answered. It uses no real platform's name, logo, or colors.
- **Icons are drawn here,** in `packages/ui/src/icons.tsx`, as simple outlines. A button can have the usual words or an icon, chosen by the layout through `look`. The words stay for screen readers.
- **A story is a row in `content`, with kind `story`.** So it has an author, a photo, a time, conditions, a world for what participants post, and withdrawal, just as a post does. Stories are left out of every list of posts, by kind. `lasts_ms` says how long one lasts, a day unless a study says otherwise.
- **A study writes stories in `stories.csv` or the builder's Stories page:** who posts each, its photo, when, and how long it lasts.
- **The row shows stories that are up now, grouped by who posted them.** The participant's own come first, then ones they haven't finished, then the rest, each newest first. Anyone blocked, muted, or banned since is left out.
- **Each story seen is `story.viewed`,** with how long and how it ended: they went on, went back, closed it, or it moved on after five seconds. Seen ones lose their colored ring, from an ordinary `view` interaction.
- **Participants can post stories,** since it would be odd to see them and not make them. Who "viewed" one is a scripted `read` reaction on their nth story. That shows in their own story, as on these platforms, and not as a notification.
- **"Liked by Ann and 41 others" names someone a study writes,** as `likedBy` on a post. With a world per person, there's nobody real to name.
- **A profile is a grid of photos** with `profileGrid`. Each opens the post's own page.
- **A layout's feed frame has a `top`,** for something above the posts, such as stories. Every layout puts it there.

## Alternatives

- **A table of its own for stories.** A story needs nearly everything a post has, so it would copy most of `content`, and withdrawal and conditions would need doing twice.
- **Counting a story as seen when the row loads.** Someone could scroll past without opening one. Only opening it counts.
- **A real platform's icons.** They're recognizable, which is the point of not using them.

## Consequences

- Stories can't be replied to, since there are no private messages yet.
- The story viewer is full screen, and moves on by itself after five seconds, which a study may want to know when reading `dwell_ms`. A screen reader hasn't tried it.
- Photo's page reuses Forum's frame for a community and a post's own page.
- The look of Classic, Forum, and Short posts comes next, and uses the same icons.
