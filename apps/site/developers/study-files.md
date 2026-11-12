---

title: Studies as files
description: The study folder format, and the pnpm study commands that check, test, import, launch, and export a study.
---

# Studies as files

A study can be a folder of CSV and YAML files. You can keep it in git, review it in a pull request, and check it from the command line. The builder in the admin app produces the same thing, and both paths go through the same checks in `packages/core/src/study/validate.ts`.

## What's in a folder

| File             | What it holds                                                                                                   | Needed                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `study.yaml`     | Settings: the site's name, how long it runs, conditions, the template, and the steps a participant goes through | Yes                        |
| `actors.csv`     | The cast. Each row needs a `username` and a `name`                                                              | Yes                        |
| `posts.csv`      | Posts. Each row needs an `id`, an `actor`, and a `time`                                                         | Yes                        |
| `comments.csv`   | Comments. Each row needs an `id`, `body`, `actor`, `postID`, and `time`                                         | No                         |
| `reactions.csv`  | Scripted likes and replies to what the participant posts                                                        | No                         |
| `beats.yaml`     | What the cast does in response to each participant                                                              | No                         |
| `scenarios.yaml` | Tests: made-up participants who act at set times, with what should be true                                      | No                         |
| `personas.yaml`  | Participants a model plays, for piloting                                                                        | No                         |
| `pages/`         | Markdown pages, such as `pages/consent.md`                                                                      | If `study.yaml` names them |
| `media/`         | Pictures, in `media/posts`, `media/actors`, and `media/spaces`                                                  | If rows name them          |

Features that need a sheet of their own have one, such as `spaces.csv`, `labels.csv`, `removals.csv`, and `auto-rules.csv`. The column lists for every sheet are at the top of `packages/study-files/src/load.ts`.

Times are hours and minutes from when a participant starts. `0:03` is three minutes in. A negative time is before they arrived, so `-40:00` is a post that's already forty hours old when they first open the feed.

Any row can have a `condition` column, to limit it to some conditions.

## A small example

This is `studies/starters/classic/study.yaml`, the sample content for the Classic template:

```yaml
schemaVersion: 1
slug: classic-starter
title: Classic sample
site: { name: Commons }
length: { days: 2 }
entry: { idParam: PROLIFIC_PID, idLabel: Prolific ID, source: prolific }
conditions:
  assignment: { method: uniform }
  arms: [{ key: control }]
platform: { style: mixed, template: classic }
likes: { posts: [3, 8, 12, 25, 40], comments: [0, 1, 2, 4] }
flow:
  - { step: consent, page: pages/consent.md }
  - { step: account }
  - { step: feed }
  - { step: exit }
```

`slug` is the study's address: participants join at `/join/<slug>`. `entry.idParam` is the query parameter that carries the recruitment ID. `flow` is the steps in order.

The first rows of its `posts.csv`:

```csv
id,actor,time,body,picture,likes
c1,maya_r,-40:00,Made it up the lake trail before sunrise. Worth every step.,lake-trail.png,34
c2,dev_patel,-36:30,"First loaf from the new starter! Crust came out better than I expected.",,12
```

And its `comments.csv`:

```csv
id,postID,actor,time,body
k1,c1,sam_w,-39:00,Beautiful! Which trailhead did you start from?
```

A beat, from `studies/examples/bystander/beats.yaml`:

```yaml
beats:
  - id: jake-mocks
    note: A few minutes in, Jake mocks Maya's painting.
    when: { time: "0:03" }
    do:
      action: comment
      actor: jake
      on: { post: maya-art }
      text: lol my little brother paints better than this
```

[Making things happen](/guide/beats) explains beats for researchers. The full format is in [docs/guides/writing-beats.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/writing-beats.md).

## The commands

All of these run from the repo's root. They're defined in `apps/cli/src/main.ts`.

| Command                                                            | What it does                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm study validate <folder>`                                     | Checks a folder and prints errors and warnings. Needs no database                                                                 |
| `pnpm study test <folder>`                                         | Runs its `scenarios.yaml`                                                                                                         |
| `pnpm study simulate <folder> [n]`                                 | Sends `n` random simulated participants through it, and reports how often each beat happened in each condition. 50 unless you say |
| `pnpm study import <folder>`                                       | Saves it as a frozen version, and uploads its pictures                                                                            |
| `pnpm study launch <slug> [version]`                               | Opens a version to new participants. The latest unless you say                                                                    |
| `pnpm study stop <slug>`                                           | Closes the study to new participants. People already in it can come back                                                          |
| `pnpm study export <slug> <folder>`                                | Writes the data as CSVs with a `codebook.md`                                                                                      |
| `pnpm study withdraw <slug> <recruitment ID> <your name> [reason]` | Deletes one participant's data, and records that it was deleted                                                                   |
| `pnpm study convert <old Truman repo> <new folder> <slug>`         | Turns an older Truman study into a folder                                                                                         |
| `pnpm study add-pack <folder> [name] [description]`                | Offers the folder's content as a pack that new studies on this server can start from                                              |

Some notes on these:

- `test` and `simulate` run in a database made for the run and dropped afterward, so nothing real is touched. They need the Docker services running. Neither uses a model, so they cost nothing.
- `simulate` prints a seed. Pass it back with `--seed N` to repeat a run exactly.
- `simulate --personas a,b --budget USD` has a model play personas from `personas.yaml`. It needs `ANTHROPIC_API_KEY` in `.env`.
- `export` leaves out recruitment IDs unless you add `--include-recruitment-ids`. It also takes `--min-dwell-ms N` and `--max-dwell-ms N`.
- `convert` writes a `study.yaml` that's a starting point. You still have to make the design decisions it marks, then run `validate`.

`import`, `add-pack`, `launch`, `stop`, `export`, and `withdraw` work on the database in `DATABASE_URL`, from `.env`.

## Importing an example study

The repo has five reference studies in `studies/examples`:

| Folder           | What it shows                                                                      |
| ---------------- | ---------------------------------------------------------------------------------- |
| `eatsnap`        | The classic study, converted from an older Truman. See [EatSnap](/studies/eatsnap) |
| `bystander`      | Beats, scenarios, and personas                                                     |
| `flag-source`    | Moderation notices, and who flagged a post                                         |
| `vaccine-frames` | Profile pictures that change by condition                                          |
| `town-talk`      | A shared world, where participants see each other                                  |

With the local setup from [Run your own Truman](/developers/run-your-own) running:

```
pnpm study validate studies/examples/bystander
pnpm study test studies/examples/bystander
pnpm study import studies/examples/bystander
pnpm study launch bystander
```

Then open `http://localhost:5180/join/bystander`. The page asks for a Prolific ID. Type anything.

To change a study, edit the folder and import it again. That saves a new version. People already in the study stay on the version they started with, and `launch` moves new participants to the new one.

## Testing before you launch

`scenarios.yaml` sits beside `study.yaml`. Each scenario is a made-up participant in a condition, who does things at set times. An `expect` step says what should be true by then: which beats have happened, and what's in their feed. `studies/examples/bystander/scenarios.yaml` is a good one to read.

The runner goes through the API's own routes with a clock it moves forward, so the test exercises what a real participant would. [docs/guides/testing-studies.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/testing-studies.md) lists every step and every kind of `expect`.
