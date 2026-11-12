---

title: Vaccine frames
description: A one-minute study of whether seeing more "vaccinated" profile frames changes what people think is normal.
---

# Vaccine frames

If more people in a community visibly show they're vaccinated, do newcomers think vaccination is the norm there? And does that change how they say they'd respond to misinformation?

A participant scrolls a feed of ordinary posts for about a minute: a new ramen place, a first 10k, a sunset from the pier. Some of the people posting have a "vaccinated" frame around their profile picture. How many depends on the condition. Then the participant moves on to a survey.

## Where it comes from

This is a rebuild, for testing, of:

> Aghajari, Z., Baumer, E. P. S., Lazard, A., Dasgupta, N., & DiFranzo, D. (2024). Investigating the mechanisms by which prevalent online community behaviors influence responses to misinformation: Do perceived norms really act as a mediator? _CHI '24_.

It follows the paper's design. It doesn't use the paper's materials.

::: info What a lab would replace
The frame here is a plain teal border standing in for real artwork, and the 30 posts were written for this example. A lab running it would swap in a proper frame, like the one in the paper's Figure 3b.
:::

## What a participant sees and does

1. They arrive with their Prolific ID and read the consent page. The one in the example is a placeholder.
2. They go straight to the feed of a site called Clikbrite. There's no account step.
3. After one minute, they're allowed to move on.
4. Moving on sends them to a survey.

In the feed they can like, reply, and flag. They can't post. Participants in the original only liked, replied, and flagged, so posting is turned off.

## What's scripted

Thirty people each post once. The posts are everyday and non-political: a new ramen place, a first 10k, a sunset from the pier, a request for podcast recommendations. Sixteen of them have one comment from another cast member.

Nothing happens in response to the participant. The feed is the same from the moment they arrive.

## The conditions

There are three, assigned in blocks of three.

| Condition | People with a frame | Share of the 30 |
| --------- | ------------------- | --------------- |
| `low`     | 2                   | About 5%        |
| `medium`  | 5                   | About 15%       |
| `high`    | 9                   | About 30%       |

The sets are nested. The two people framed in `low` are framed in all three conditions, and the five in `medium` are also framed in `high`.

A frame on a small profile picture is easy to miss. So, as on Facebook, the feed also shows a post for each framed person: "Dana Cox updated their profile picture." A participant in `low` sees two of those posts, and one in `high` sees nine.

Everything else is identical: the same 30 posts, the same comments, the same order.

## What gets measured

The measures are in the survey: perceived norms, and intentions to respond to misinformation. Truman's part is the exposure.

The exit step sends each participant to the survey with two IDs in the link. One is their Prolific ID. The other is their Truman participant ID, which is what you use to match survey answers to what they did in the feed without handling Prolific IDs. The survey address in the example is a placeholder for your own.

Truman still records what each participant was shown, how long each post was on screen, and any likes, replies, or flags.

## How long it runs

About a minute.

::: info One difference from the original
The original session ended at one minute. A Truman feed step can say when someone may move on, and it can't force them out, so this version lets them leave after a minute.
:::

## How it's built

The frames take one column. In `actors.csv`, a `pictures` column gives a person a different profile picture in named conditions. The "updated their profile picture" posts are ordinary posts that only appear in the conditions where that person is framed.

The scenario tests check which of those posts a participant sees in each condition. They can't check the frames themselves, since those are pictures. To check the frames, preview the study in each condition and look, as [Testing a study](/guide/testing) describes.

## Getting it

It's in the repository at `studies/examples/vaccine-frames`. Import it with:

```
pnpm study import studies/examples/vaccine-frames
```

[Studies as files](/developers/study-files) explains the folder. [Consent, surveys, and debriefing](/guide/flow) covers sending people on to a survey. The original debriefed participants in the survey, explaining that the people and posts were made by the researchers.
