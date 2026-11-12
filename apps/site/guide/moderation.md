---

title: Moderation
description: How to script a study's moderation, including removals, labels, answers to flags and reports, automatic rules, appeals, bans, and context notes.
---

# Moderation

By the end of this page your site has moderation that participants can watch and run into: a post taken down, a label over a comment, an answer when they flag something. All of it is scripted by you.

Nobody real moderates anything on Truman. You write what a moderator does and when, and it can differ between conditions. The one exception is a researcher taking something down during a shared world. See [Several real people together](/guide/shared-worlds).

## Before you start

**Turn the features on.** Each kind of moderation is a feature. Photo, Short posts, and Forum sites start with most of them on. On a Classic site, press **Settings** and tick the ones you want under **What's on this platform?**, such as **Moderators removing things**. Once any is on, a **Moderation** button appears in the builder.

**Decide who the moderator is.** A moderator is anyone in the cast, including an account named as automatic. On the **Cast** page, tick **Show a moderator tag on their name**.

**Talk to your IRB.** Telling a real person they broke a rule is a deception. Raise it with your IRB and cover it in your debriefing.

## The Moderation page

Press **Moderation** in the builder. There's a section for each thing a moderator can do. Each item has **Only in these conditions**, where none ticked means all. Times are hours:minutes.

### Removing what the study wrote

Press **Add a removal**. Choose **What it removes**, the moderator, **When**, and an optional **Reason shown**.

At that time, the post or comment loses everything it said. A note takes its place, with the moderator's name and the reason. Its comments stay. Participants watch this happen to someone else.

### Labeling what the study wrote

Press **Add a label**. Fill in **What it labels**, **The label** (such as Spam or Misleading), and **When**.

- Tick **Cover it until someone presses Show** to hide the post behind the label. Pressing Show is recorded. Unticked, the label sits above the post.
- **Say who gave it** shows the moderator's name. Leave it off for a notice from nobody in particular.
- You can add a yes-or-no question, such as "Do you agree with this flag?" The answer is recorded.

The flag-source example labels one comment three ways, as flagged by other users, by an automated system, or by nobody in particular, to test whether the source matters.

### Responding to what a participant writes

Press **Add a response**. Choose **What happens**: **Remove it**, **Warn them**, or **Label it**. Then choose **Which one they write**, such as their first post or third comment, and **How long after**.

A warning stays on their screen until they press its button. A removed post stays visible to its author, with a note saying nobody else can see it.

### Automatic rules

Press **Add a rule**.

1. Type the **Words to look for**, separated by `|`. Whole words are matched, ignoring case. End one with `*` to match the start of a word.
2. Type a sentence under **Try it on a sentence** to see whether the rule catches it.
3. Choose whether it **Looks at** posts, comments, or both.
4. Choose **What happens**:
   - **Ask if they're sure, before it posts**
   - **Hold it for approval**, which ends as **Approved** or **Removed**
   - **Remove it**
   - **Warn them**

The first rule that matches applies, in the order on the page.

The text someone typed and then chose not to post is kept only if you turn that on in Settings. It's off by default.

A word list can catch someone disclosing something serious about themselves. Try yours on real sentences, and raise it with your IRB.

### Answering what someone flags

Press **Add an answer**. Under **When someone flags**, pick a particular post or comment, or **Anything without its own answer here**. Under **What happens**, choose **Answer with a message** or **Remove it**, and set **How long after**.

An answer naming a post comes first. So flagging one planted post can get it removed, while flagging anything else gets "We looked at this, and no rule was broken." A removal from a flag only happens for the person who flagged.

### Answering when someone reports a person

The same, for reports of an account. **What happens** is **Answer with a message** or **Ban them**. A ban from a report only applies for the person who reported.

### Banning someone in the cast

Press **Add a ban**. Choose **Who's banned**, **When**, and **From**: **Everywhere**, or one space.

What they wrote before stays. What they were written to post afterwards doesn't appear, and their scripted reactions stop. Others see a "Banned" tag. Participants are never banned themselves.

### Answering appeals

With **Appeals** on, a participant can appeal a removal of something they wrote, once. Press **Add an answer** and choose **The removal stands** or **It goes back up**, with **What the answer says**. With no answer written, they hear nothing, which some studies want.

### Context notes

Press **Add a note**. Pick the post under **On this post**, set **When**, and write **What the note says**. It appears as if readers had added context. You can set the helpful and not helpful ratings it starts with. Participants' own ratings are recorded.

## The mod log

With **A public mod log** on, participants can open a page listing what moderators removed, who removed it, and why, without what it said. Looking at it is recorded.

## Beats and your data

For moderation that depends on what else has happened, such as removing replies under one particular comment, write a beat. See [Making things happen](/guide/beats).

`impressions.csv` says whether each post was removed or labeled at the moment a participant saw it. See [Your data](/guide/data).
