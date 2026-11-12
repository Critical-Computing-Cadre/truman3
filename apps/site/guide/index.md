---

title: What Truman is
description: Truman is a social media site you build for a study, where every post and every other user is yours and the only real person is the participant.
---

::: warning Truman 3 is in beta
You can build, preview, and test studies today. Don't run real participants on hosted Truman yet: its terms and privacy policy are still being reviewed, and a few safeguards aren't finished. [What's left](/guide/your-lab#what-s-left-before-real-participants).
:::

# What Truman is

Truman is a social media site built for research. You write every post and make up every other user. Then a participant signs up and scrolls, thinking it's an ordinary site, and you get a record of what they saw and what they did.

Because you control everything on the site, you can change one thing between two groups of participants and leave the rest alone. Take the [Bystander](/studies/bystander) example, where someone posts her first painting and another user mocks it. Some participants see a third user stick up for her, and others see nobody do it. What each participant does next is the data.

## The parts of a study

A study is made of five parts. Each is covered in more depth later in this guide, so this is only the short version.

**The site.** Its name, its look, and what people can do on it. You pick one of four kinds: a classic feed, a photo app, a short-posts app, or a forum. Then you turn features on or off, such as likes, votes, reposts, stories, or direct messages. See [Kinds of site](/guide/kinds-of-site).

**The cast.** These are the made-up people. Each has a name, a username, a picture, a bio, and the posts and comments you write for them. See [Posts and the cast](/guide/posts-and-cast).

**The plot.** Everything has a time, counted from the moment each participant starts. A post can already be there when they arrive, or show up at hour 26. The cast can also answer what the participant does: reply to their first post, thank them for a flag, pile on three minutes in. See [Making things happen](/guide/beats) and [Moderation](/guide/moderation).

**The conditions.** These are the versions of the study that participants are assigned to. A post, a comment, a setting, or a whole feature can be limited to some conditions. See [Conditions](/guide/conditions).

**The flow.** These are the steps a participant goes through: consent, making a profile, the feed, any pages of text, and the exit, which can send them on to your survey. See [Consent, surveys, and debriefing](/guide/flow).

## Each participant gets their own world

When a participant joins, Truman starts a world for them. It's their own copy of the study, and the study's clock starts at zero for them. What they post stays in their world, so nobody else sees it, and everyone they meet is the cast.

If you want real participants to meet each other, a study can use shared worlds instead. Groups of participants are put in one world and see each other's posts. See [Several real people together](/guide/shared-worlds).

## Hosted, or your own

There are two ways to use Truman.

**Hosted Truman** is run for you. Your lab applies at [app.truman-research.org/admin](https://app.truman-research.org/admin/), and you build and run studies in the browser, with nothing to install. Most of this guide assumes you're here. See [Your lab on hosted Truman](/guide/your-lab).

**Your own Truman** runs on a server your university or lab controls. Truman is open source, so this is free, but someone has to set it up and look after it. Once it's running, the admin app is the same. See [Run your own Truman](/developers/run-your-own).

## You don't need to write code

You build a study in the admin app, mostly by clicking on things. Click a post to change its text, drop a photo on it, or drag it along a timeline to change when it appears. For a large cast or hundreds of posts, you can fill in spreadsheets and upload them.

Two things are written as short text files inside the admin app: beats and scenario tests. Each of those pages shows a reference beside the editor and tells you what's wrong as you save.

If you'd rather work in files, a study can also be kept as a folder and worked on from the command line. That's covered in [Studies as files](/developers/study-files).

## How this guide is organised

**Start**

- [Your first study](/guide/first-study) takes you from nothing to a link you can open yourself.
- [Your lab on hosted Truman](/guide/your-lab) covers applying, limits, and teammates.

**Build**

- [Kinds of site](/guide/kinds-of-site)
- [Posts and the cast](/guide/posts-and-cast)
- [Conditions](/guide/conditions)
- [Consent, surveys, and debriefing](/guide/flow)
- [Moderation](/guide/moderation)
- [Making things happen](/guide/beats)
- [A cast that writes for itself](/guide/live-writing)
- [Several real people together](/guide/shared-worlds)
- [AI in Truman](/guide/ai) is an overview of every place a model is involved.

**Test and run**

- [Testing a study](/guide/testing)
- [Running a study](/guide/running)
- [The phone app](/guide/mobile-app)
- [Your data](/guide/data)
- [Ethics](/guide/ethics)

If you'd like to see finished studies first, the [example studies](/studies/) show what each one tests and how it's put together. And if your ethics board is asking questions, send them to [For IRBs](/irb).
