# Shared worlds

Usually, each participant has a world of their own, and everyone they meet is the study's cast. In a **shared world**, several participants are in one world together. They see each other's posts, like and reply to each other, follow and message each other, and are told when the others do. The cast is there too, as usual. ADR 67 explains the choices.

## Turning it on

In `study.yaml`:

```yaml
worlds:
  size: 8 # how many participants in each world, from 2 to 500
  waitMinutes: 15 # the longest the first person waits for the others
```

- **A world fills up as people join.** When it has `size` people, it starts for all of them at once. If it isn't full after `waitMinutes` from its first person joining, it starts with whoever's there. Then the next person starts a new world.
- **While they wait,** after consent and making their account, participants see "Waiting for others to join", with how many are there. Everything in the study is timed from when the world starts, so nobody misses anything.
- **Everyone in a world is in the same condition,** drawn when the world starts filling. `participants.csv` records the first person's assignment as usual, and everyone else's with method `world`.
- **Pilots are always in a world of their own.**

Recruit in bursts, so people arrive close together. With Prolific, that means opening places at a set time. `waitMinutes: 0` means nobody waits, so everyone would be alone, and `pnpm study validate` warns about it.

## What it changes

- **Beats** happen once for the world, or once for each participant. [Writing beats](writing-beats.md#in-a-shared-world) explains which, and `per` changes it.
- **Decision points** aren't available in shared worlds yet.
- **Moderation** shows to everyone in the world, as on a real site. That includes a removal in answer to one participant's flag, or by an automatic rule (`autoRules`). Hiding a post, or muting someone, is still only for the person who did it.
- **What others do arrives as it happens** (ADR 68). A new post shows a "New posts" button at the top of the home feed, as on real sites, so the feed doesn't move while someone reads it. Comments appear at once on a post's own page, and notifications and messages update their counts. A moderator's removal leaves every page at once.

## Ethics and safety

Participants can now meet real people, who can be unkind. Before you run one:
- **Say so in the consent page.** Participants should know others in the study may be real people, even if not which. `pnpm study validate` warns when the consent page doesn't seem to say so.
- **Use the study's automatic rules** (`auto-rules.csv`, with `autoRules` and `removal` on), such as removing posts with words you choose. `studies/examples/town-talk` has one for threats of self-harm.
- **Have a moderator in the cast,** with `moderator: yes` in `actors.csv`, and watch while it runs (below).
- **Plan the debriefing** to say who was real and who was the cast.

## Watching, and taking things down

The Monitor page has a **Shared worlds** section while a study has any. It shows what participants write, newest first, and checks every five seconds. Remove takes something down for everyone, as the study's moderator, with a reason others see if you give one. To everyone in the world, it's an ordinary removal, and its author is told on their Notifications page. It's recorded as `moderation.removed_live`.

This works even if the study has the removal feature off, since it's for everyone's safety. Agents' tokens can't see or use it.

## Withdrawal

When someone withdraws, everything about them is deleted, as usual. What they wrote disappears for everyone else, and anything posted under it goes with it. The others' own records stay. When the last person in a world withdraws, the whole world is deleted. In the export, what they wrote is still a row in `content.csv`, with nothing in it and `withdrawn` set, so others' events on it still make sense. Their name is "withdrawn".

## Testing

- **Scenario tests** can have several participants in one world. See [Testing studies](testing-studies.md#several-participants).
- **Simulations** put simulated participants in worlds of the study's size, and they meet, as real ones would.
- **A load test:** `pnpm load-test <address> <slug> [participants] [minutes]` sends made-up participants to a running Truman, through its public address. It reports how long pages took, and how long new posts took to reach the others: as the "New posts" button, and on screen once each made-up participant pressed it, 1 to 6 seconds later, as a person would. Use it only with a study made for it, like `studies/load-test`, never one with real participants. Their IDs start with `load-`, to withdraw afterwards.

## The export

`world_id` in `participants.csv`, `content.csv`, and `beat_runs.csv` says who was together. In a shared world, a post's `participant_id` is whoever wrote it, and is empty for the cast's posts, which belong to everyone in that world.
