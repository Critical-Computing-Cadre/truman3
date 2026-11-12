---

title: Bystander
description: Someone's first painting gets mocked, and what the cast does next depends on the condition and on the participant.
---

# Bystander

Maya posts her first real painting. "Be nice lol," she writes. Three minutes after the participant arrives, Jake isn't.

This one is made up for testing. It isn't from a published study. We wrote it to show beats: things the cast does at a set time, or because of what the participant just did.

## The question

What does a bystander do when a pile-on starts? Does it change if someone else speaks up first, or if someone else quietly sides with the bully?

## What a participant sees and does

1. They arrive with their Prolific ID and read the consent page. The one in the example is a placeholder. It notes that a study like this shows people being unkind, so consent and debriefing need to say so.
2. They make an account.
3. They land in the feed of a site called Commons.

It's a small site. Five people, three posts: Priya's pasta, Leo asking about the art fair, and Maya's painting with nine likes. The participant can post, like, comment, reply under a specific comment, and send private messages to people in the cast.

## The conditions

Two, assigned in blocks of two.

| Condition  | What happens after Jake mocks the painting                                        |
| ---------- | --------------------------------------------------------------------------------- |
| `defended` | Sam steps in: "Not cool, Jake. It's her first painting. Maya, I love the colors!" |
| `silent`   | Nobody defends her. Leo likes Jake's comment, as if agreeing.                     |

## What's scripted to happen

**To everyone:**

- At minute 3, Jake comments on the painting: "lol my little brother paints better than this".
- A minute or two later he adds: "seriously why would you even post this".

**In `defended`:** one to three minutes after that, Sam defends Maya. There's one exception. If the participant has already answered Jake, Sam stays out of it. The participant got there first, and the data should show that.

**In `silent`:** Leo likes the mocking comment within a minute.

**Because of what the participant does:**

| If the participant...        | Then...                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| replies under Jake's comment | Jake brushes them off: "relax, it's a joke"                                 |
| comments on Maya's post      | Maya thanks them. In `defended`, Sam also likes what they said              |
| answered Jake                | Maya messages them privately a few minutes later to say thanks              |
| messages Maya                | She answers, up to three times                                              |
| messages Jake                | He answers defensively, up to three times: "it was a joke. why do you care" |

Delays are drawn at random within a range, so replies don't arrive on the dot.

## Who writes the cast's lines

As shipped, every line is written ahead of time. Maya has three thank-you lines, and each participant gets one of them.

The study is also set up for live writing, which is turned off. With it on, an AI model writes Jake's and Maya's replies to fit what the participant actually said. Each has a short character card. Jake is "lowercase, short, sarcastic". Maya is "warm and a little shy". The study sets a red line, "Insulting anyone's appearance, family, or identity", and a $5 budget. Every line is checked before it's posted, and if the check fails, the written fallback line is used. [A cast that writes for itself](/guide/live-writing) explains how it works.

## What gets recorded

- whether the participant replied to Jake, commented on Maya's post, liked anything, flagged anything, or messaged anyone
- what they wrote, and when
- every beat: whether it happened or was skipped, and why

That last one matters here. If Sam didn't defend Maya, the record says whether that was the condition or the participant beating him to it.

## How long it runs

The study is set to one day. The scripted events are over within about ten minutes unless the participant keeps the conversation going.

## Trying it before anyone real does

The folder has six scenario tests. Each one has a made-up participant do something at a set minute and checks what should be true afterward. For example: answer Jake at minute 3, and by minute 10 Jake has answered back and Sam hasn't stepped in.

It also has two personas for piloting: a quiet bystander who rarely gets involved, and an upstander who is quick to defend people. A model plays each one through the study, and you read what they saw and did. [Testing a study](/guide/testing) covers both.

## Getting it

It's in the repository at `studies/examples/bystander`. Import it with:

```
pnpm study import studies/examples/bystander
```

[Making things happen](/guide/beats) explains how to write beats. [Studies as files](/developers/study-files) explains the folder.
