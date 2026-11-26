# 102. A community written while the study runs

## Context

ADR 99 drafts a community ahead: a model writes it, a researcher reads it, and it's frozen with the version. Dominic asked for live communities to follow, as things a research team can choose. This is the first: one live community for each condition ("B" in the design note). A community of each participant's own ("C"), and the cast answering what participants post, come later.

The risk is that participants read text nobody has read. Dominic's answers: no approval by default, with an option to hold; written a day ahead, so a researcher can look at tomorrow; shared worlds left out for now.

## Decision

- **It's turned on in `beats.yaml`,** under `community`, with the same description a drafted community takes (now `communityBriefSchema` in core) and two more settings: `live`, and `hold`. The Community page writes it. So it's part of the saved version, like live writing's settings.
- **It's written a day ahead of whoever is furthest along.** At launch: the days before anyone arrives, and their first day. After that, a participant loading their feed on day N has day N+1 written if it isn't. Nothing runs on a timer, as with beats (ADR 51). Days are written in order, and each is told what came before.
- **A day is a row in `community_days`,** for a version, a condition (or all of them), and a day number. The row is made as writing starts, so two servers can't write the same day. It keeps what was written, what the check left out, the model, and the cost. A day that fails is tried again after ten minutes, and one whose server died is taken over after twenty.
- **The saved version doesn't change.** A database rule keeps a frozen version's own posts as they are, and that rule stays. A published day is copied into each participant's world when they reach it, timed from their own arrival, which is where everything else that happens during a study lives. `community_day_worlds` records which worlds have which days, so nothing is copied twice.
- **So everyone in a condition sees the same community** at the same point in their own study, whenever they join. The comparison between conditions is kept. In the export the same post has the same `source_ref` in every world.
- **Checked, and optionally held.** Every line goes through the same check as a drafted community, and what fails is left out. With `hold`, a day waits as `held` until a researcher approves or skips it on the Monitor page. A participant who reaches a held day sees nothing from it.
- **A researcher can take a post out,** with its replies: it's marked on the day, so nobody else gets it, and withdrawn from every world that has it.
- **One budget and one pause switch.** It spends from `live.budgetUsd`, which now counts community days as well as improvised lines, and stops while live writing is paused. When it can't write, the community goes quiet, and the Monitor page says why.

## Alternatives considered

- **Adding the posts to the version as scripted content.** One row for each post, not one for each participant. It means loosening the rule that a frozen version can't change, which replication, and trust in "this is what the study was", rest on.
- **A background job on a schedule.** Truman has none for study content, and a study with nobody in it would still spend. Writing when someone loads means a day can be late for the very first person if the model is slow. A day's head start makes that unlikely.
- **Writing by the calendar,** the same day for everyone whenever they joined. Study time is each participant's own everywhere else in Truman, and two people in a condition would see different communities.
- **A budget of its own.** One number for "what this study may spend on writing" is easier to reason about, and the pause switch already covers both.
- **Holding by default.** Safer, and Dominic chose otherwise: a held community stalls whenever nobody's watching. The builder says plainly what not holding means.

## Consequences

- **Unread model text reaches participants** unless `hold` is on. The guide and the ethics page say so.
- **Posts are stored once for each participant.** A week of six posts a day with replies is about a hundred rows a participant.
- **A replication bundle carries the description, not the posts.** Another lab running it gets its own community. What participants saw is in the export.
- **Not for shared worlds,** and a draft's preview doesn't show it. Validate warns about the first.
- **Taking a post out uses the mark shared worlds use for a withdrawn author** (`withdrawn_at`), which already leaves a post and its replies out of feeds.
