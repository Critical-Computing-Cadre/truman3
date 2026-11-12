---

title: Your data
description: What a Truman export contains, how to read the codebook and the event log, how withdrawal and deletion work, and how to make synthetic data before a study runs.
---

# Your data

A Truman export is a zip of spreadsheets with what every participant saw and did, plus a codebook that explains each column. This page covers how to get it and how to read it. It also covers how to delete one person's data when they ask.

## Download it

1. On the **Studies** page, press **Monitor and download** for the study.
2. Find **Download the data** and press **Download**.

You get a zip of CSV files and `codebook.md`. Two options sit above the button:

- **Shortest view to count (ms)** and **Longest view to count (ms)** set which views of a post count toward the per-person summary. Every view stays in the full data, so you can apply other limits later. Blank counts them all.
- **Include recruitment IDs** adds a file linking study data to people, for things like paying bonuses. Only a lab's owner sees this option. Don't share that file.

Owners and editors can download. Viewers can't. Each download is recorded, and **Who has downloaded it** lists them.

Photos that participants uploaded are a separate download, **Download photos**. It includes `photos.csv`, which ties each photo to the data.

Test participants are never in a download.

## What's in the zip

| File                                                          | What it has                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `participants.csv`                                            | Each participant: their ID in this study, their version, their condition, how they were assigned, and how far they got |
| `summary.csv`                                                 | One row per person with totals: likes, flags, votes, follows, time active, views                                       |
| `events.csv`                                                  | The event log: everything participants did                                                                             |
| `impressions.csv`                                             | What each person was shown, in what order, and whether a post was removed or labeled then                              |
| `content.csv`                                                 | The study's own posts and comments, and what participants wrote                                                        |
| `beat_runs.csv`                                               | Every decision about a beat, and how each line was worded                                                              |
| `assignments.csv`                                             | Every assignment in order, when a decision point moved anyone                                                          |
| `removals.csv`, `labels.csv`, and the other moderation sheets | What the version scripted, when a study has some                                                                       |
| `recruitment_ids.csv`                                         | Only when asked for                                                                                                    |
| `codebook.md`                                                 | The guide to all of it                                                                                                 |

`participant_id` is specific to this study. It isn't the person's Prolific ID. If you passed it to your survey as in [Consent, surveys, and debriefing](/guide/flow), it's the column you join on.

## The codebook

Open `codebook.md` first. It's written for this export, so it describes exactly what you have. It lists every file and column, each version of the study with its settings and the features on in each condition, when each version was open, and the event types that appear. It also says how many people's data was deleted, split into declined consent and withdrew.

Whatever your study used is frozen with its version, so you can write your methods section from here.

## Events

`events.csv` has one row for each thing a participant did: a `type`, who did it, what it was done to, a `payload` with the details, and when. Some types you'll use often:

| Type                                                 | Means                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `content.created`                                    | They wrote a post, comment, or message                                                                         |
| `content.liked`, `content.voted`, `content.reposted` | They reacted to something                                                                                      |
| `content.flagged`, `actor.reported`, `actor.blocked` | They flagged a post, or reported or blocked an account                                                         |
| `content.viewed`                                     | A post was on their screen, with `dwell_ms` for how long                                                       |
| `actor.followed`                                     | They followed someone                                                                                          |
| `flow.step_completed`                                | They finished a step such as consent                                                                           |
| `decor.pressed`                                      | They pressed something that's only for show, such as Marketplace. `key` and `label` say what, and `page` where |

Three things are worth knowing when you read it:

- **Scripted content appearing on schedule isn't an event.** The version already says when each post appears. To see what someone was shown, use `impressions.csv`.
- **Being in `impressions.csv` doesn't mean it was seen.** It means the post was in the list sent to their browser. `content.viewed` records time actually on screen.
- **There are two clocks.** `occurred_at` is the participant's browser clock, which can be wrong. `recorded_at` is when the server received it.

## Withdrawal and deletion

When a participant asks to withdraw, you delete their data:

1. Open **Monitor and download** for the study.
2. Under **Withdraw a participant**, type **Their recruitment ID** and a **Reason**.
3. Press **Withdraw**, then **Delete their data** to confirm.

::: warning This can't be undone
This permanently deletes everything about them in this study, including their events and any photos they uploaded. The page tells you how many recorded events were deleted.
:::

What's kept is a record that a deletion happened, with its reason, and a scrambled form of their ID that stops it entering this study again. They can still join other studies. Declining consent does the same thing automatically.

Deleted participants don't appear in any later download. Truman can't reach a zip you already downloaded, though, so if you exported before a withdrawal, delete that person from your own copies too.

In a shared world, what a withdrawn person wrote is blanked and marked `withdrawn`, so other participants' events still make sense. See [Several real people together](/guide/shared-worlds).

## Synthetic data

You can have data shaped like your study's before a single participant arrives. That lets you write and debug your analysis ahead of time.

1. On the **Studies** page, press **Simulate** beside a saved version.
2. Choose **At random** or **Personas**, and how many.
3. Tick **Keep them as synthetic data**, and press **Simulate**.
4. When it's done, press **Download synthetic data** on the same page.

Its codebook says at the top that nobody real took part.

Synthetic participants are never in the study's real data, its counts, or the Monitor page. Their timestamps are in the past, starting one study length ago. If you want real and synthetic rows together, combine the two downloads yourself.

## Before you share data

- Leave `recruitment_ids.csv` out.
- Your survey data probably contains Prolific IDs now. Remove that column.
- Participants' own posts and comments are in `content.csv`. Read them before you publish them.

The export can also be written from the command line. See [Studies as files](/developers/study-files).
