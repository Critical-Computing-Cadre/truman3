---

title: Ethics
description: What a researcher has to decide and justify when running a Truman study, what Truman does to help, and what it leaves to you and your IRB.
---

# Ethics

This page goes through the parts of a Truman study your ethics board will ask about. For each one, it says what the software does and what's left to you.

Most Truman studies deceive participants on purpose. That's what makes the tool useful, and it's what your board will look at hardest. Truman doesn't decide whether your deception is justified. Your protocol does.

::: tip For your ethics board
If your board wants to know what the software does with participants and their data, send them [For IRBs](/irb). It's written for them.
:::

## Deception

A typical study deceives participants about several things at once:

- **The other users.** They're a cast you wrote.
- **The site.** It has its own name and address, and participant screens don't say it's a research platform unless your study does.
- **The numbers.** Likes, followers, and view counts are whatever you typed.
- **Moderation.** A "moderator" removing a post, or telling a participant their post broke a rule, is your script. Nobody judged anything.

Telling a real person they broke a rule is aimed at them personally. Raise it with your IRB and cover it in your debriefing.

A few features carry their own warnings in the admin app. Adult content tags have no age check. An automatic rule's word list can catch someone disclosing something serious. Recording text that someone typed and chose not to post is off by default.

## Consent

Consent is a step in your study's flow, with the text your board approved. A new study has placeholder text, and Truman warns you at launch if it's still there. If someone declines, their data is deleted and their ID can't enter the study again. See [Consent, surveys, and debriefing](/guide/flow).

Participants enter with their recruitment ID and nothing else. That keeps email addresses out. It also means anyone who knew a participant's ID could enter as them. That suits a low-risk, anonymous study. It doesn't suit one collecting sensitive disclosures.

## Debriefing

Debriefing is a page you write. Put it after the feed as a page of text, or at the end of the survey that follows.

What goes in it is for you and your board. For a Truman study it usually needs to cover:

- that the site was built for the study
- that the other users were made up
- what differed between conditions
- anything aimed at them personally that wasn't real, such as a warning or a removal
- whether any of the cast's words were written by an AI
- how to withdraw their data

People who leave partway never reach a debriefing page inside Truman, so plan how you'll reach them.

## Withdrawal

A participant withdraws by contacting you. You then withdraw them on the Monitor page, and Truman deletes everything about them in that study, including what they wrote and uploaded. It keeps a note that a deletion happened and a scrambled form of their ID, so the same person can't re-enter. See [Your data](/guide/data).

Participants can't withdraw themselves from inside the site, so your consent and debriefing pages need to say how to reach you. Deletion also can't reach data you've already downloaded, so remove the person from your own copies.

## AI-written content

By default you write every word ahead of time. If you turn on live writing, an AI model writes some of the cast's lines. See [A cast that writes for itself](/guide/live-writing).

**What Truman does.** The study still decides whether and when something happens, and the model only writes the words. A second check reads every line before it's posted. It blocks slurs, sexual content, threats, real people's information, dangerous instructions, and anything on your own list. It also blocks a line that says it's an AI or a study. Every line is recorded with its prompt. You can pause live writing at any time, or require a researcher to approve each line.

**What's left to you.** Tell your board that some content is machine-written, and that what a participant writes is sent to the model so it can reply. Read what your cast says before launch, using rehearsed lines and persona runs. Say so in the debriefing.

## Shared worlds

Usually each participant is alone with the cast, and nothing they write is seen by another person. In a shared world, real participants see and message each other. Real people can be unkind, and you didn't write what they say. See [Several real people together](/guide/shared-worlds).

**What Truman does.** It warns you if the consent page doesn't say that others may be real. Automatic rules can remove posts containing words you choose. The Monitor page shows what's being written, and you can remove anything for everyone at once. When someone withdraws, what they wrote disappears for the others.

**What's left to you.** Consent that says other participants may be real. Someone watching while participants are active. A plan for what you'll do if a participant is targeted or discloses something serious. A debriefing that says who was real and who was the cast.

## Whose job is what

To sum up, here's how the work divides.

**Truman's job:**

- Keep email addresses and passwords out of the study
- Keep recruitment IDs out of exports unless an owner asks for them, and record every download
- Delete a participant's records and uploads when you withdraw them
- Record what was shown and done
- Check AI-written lines before they're posted

**Your job:**

- Ethics approval, the consent text, and the debriefing
- Justifying the deception, and everything the cast says
- Watching a shared-world study while it runs
- Acting on withdrawal requests
- Looking after exported data and any survey data, which may hold recruitment IDs
