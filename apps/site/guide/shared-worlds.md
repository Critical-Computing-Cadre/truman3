---

title: Several real people together
description: How to put several real participants in one world, how the waiting room works, what changes for consent and safety, and how to take something down while a study runs.
---

# Several real people together

Usually every participant has a world of their own, and everyone they meet is made up. A shared world changes that. Groups of real participants share one site, where they see each other's posts, reply to each other, and follow and message each other. The cast is there too, as usual.

In the town-talk example, six real people join one town forum. The cast's first answers are polite in one condition and rude in the other. How civil the participants are to each other is the measure.

::: warning Read the safety section first
Real people can be unkind to each other. Read [the safety section](#safety-before-you-run-one) before you turn this on.
:::

## Turn it on

1. In the builder, press **Settings** and find the **Conditions** card.
2. Under **Shared worlds**, tick **Put participants together, so they see each other**.
3. Set **People in a world**, from 2 to 500.
4. Set **Longest wait for others (minutes)**.
5. Press **Save changes**.

## How a world fills

A world fills up as people join. When it has the number you set, it starts for all of them at once. If it isn't full when the longest wait runs out, counted from its first person, it starts with whoever's there. The next person to arrive starts a new world.

While they wait, after consent and making their profile, participants see "Waiting for others to join" with how many are there. The study's clock starts when the world does, so nobody misses anything by arriving first.

Two things help worlds fill well:

- **Recruit in bursts,** so people arrive close together. On Prolific, open places at a set time.
- **Don't set the wait to 0.** Nobody would wait, so everyone would be alone. The builder warns you.

Everyone in a world is in the same condition, drawn when the world starts filling. Test participants are always in a world of their own.

## What participants see

A new post from someone else shows as a "New posts" button at the top of the home feed, as on real sites, so the feed doesn't move while someone reads it. Comments appear at once on a post's own page. Notifications and messages update their counts. Hiding a post or muting someone is still only for the person who did it.

## What changes for beats and moderation

With several people in a world, a beat now happens either once for the world or once for each participant:

- **Set off by a participant:** it's theirs. Each person's first post can get its own reply from Jake.
- **Done to the participant,** like a message, a follow, or a warning: once for each of them.
- **Anything else,** like a timed post: once for the world.

Add `per: world` or `per: participant` to a beat to change that. See [Making things happen](/guide/beats).

Moderation shows to everyone in the world, as on a real site. That includes a removal in answer to one person's flag, or by an automatic rule.

Decision points aren't available in shared worlds yet.

## Safety, before you run one

**Say so in the consent page.** Participants should know that others in the study may be real people, even if not which. The builder warns you when the consent page doesn't seem to say it. A sentence like "Some people you meet will be other participants" does it.

**Use automatic rules.** Turn on **Automatic rules** and **Moderators removing things**, then write rules on the **Moderation** page that remove posts containing words you choose. The town-talk example has one for threats of self-harm:

```csv
id,on,match,action,actor,after,message
self-harm,both,kill yourself|kys,remove,commons_team,0:00,This breaks our community guidelines.
```

**Have a moderator in the cast.** On the **Cast** page, tick **Show a moderator tag on their name** for one account. Live removals are made in that account's name.

**Watch while it runs,** as described next.

**Plan the debriefing** to say who was real and who was the cast.

## Watching, and taking things down

While a study has shared worlds, its **Monitor and download** page has a **Shared worlds** section. It lists what participants write, newest first, with who wrote it and which world it's in. It checks every five seconds.

To take something down:

1. Press **Remove** beside it.
2. Type a **Reason others see** if you want one.
3. Press **Remove for everyone**.

It leaves every participant's screen at once. To everyone in the world it's an ordinary removal by the study's moderator, and its author is told on their Notifications page. It's recorded as `moderation.removed_live`.

This works even if the study has the removal feature off, since it's for everyone's safety.

## Withdrawal

When someone in a shared world withdraws, everything about them is deleted, as usual. What they wrote disappears for everyone else, and anything posted under it goes too. The others' own records stay. When the last person in a world withdraws, the whole world is deleted.

In the export, what the withdrawn person wrote is still a row in `content.csv`, with nothing in it and `withdrawn` set, so others' events on it still make sense.

## Testing

Scenario tests can have several made-up participants in one world, who see each other. Simulated participants are put in worlds of the study's size and meet, as real ones would. Both are in [Testing a study](/guide/testing).

## In your data

`world_id` in `participants.csv`, `content.csv`, and `beat_runs.csv` says who was together. A post's `participant_id` is whoever wrote it, and it's empty for the cast's posts, which belong to everyone in that world.
