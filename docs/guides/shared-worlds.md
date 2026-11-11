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
- **Seeing each other's posts** happens when they load a page. Live updates are coming next.

## Ethics

Participants can now meet real people, who can be unkind. Before you run one:
- **Say so in the consent page.** Participants should know others in the study may be real people, even if not which.
- **Use the study's automatic rules** (`autoRules`), such as removing posts with words you choose, and watch the Monitor page while it runs.
- **Plan the debriefing** to say who was real and who was the cast.

## Withdrawal

When someone withdraws, everything about them is deleted, as usual. What they wrote disappears for everyone else, and anything posted under it goes with it. The others' own records stay. In the export, what they wrote is still a row in `content.csv`, with nothing in it and `withdrawn` set, so others' events on it still make sense. Their name is "withdrawn".

## The export

`world_id` in `participants.csv`, `content.csv`, and `beat_runs.csv` says who was together. In a shared world, a post's `participant_id` is whoever wrote it, and is empty for the cast's posts, which belong to everyone in that world.
