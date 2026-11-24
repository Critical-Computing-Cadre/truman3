---

title: Running a study
description: How to launch and stop a study, where its link points, how to recruit on Prolific, what the Monitor page shows, and how to change a study that's already running.
---

# Running a study

This page takes you from a tested version to a study that's open, with real participants arriving through its link. It also covers how to watch a study, stop it, and change it.

One idea runs through all of it: saving a version never changes what participants get. A study points at one live version, and new participants get that one. You launch a version on purpose, and each launch and stop is recorded in your codebook.

## Launch

1. On the **Studies** page, find the version you want and press **Launch**.
2. Read the window. It says new participants will get this version, starting now. It warns you if:
   - the version's scenario tests haven't run, are still running, or didn't all pass
   - the consent page still has the placeholder text
   - some posts can never appear because of when they're timed
3. Press **Launch it**, or **Not yet**.

The study now says **Open to participants**, and the version is marked **Live**. The **Study link** under the study's name was there before, saying it works once the study is open. Now it works.

::: info On hosted Truman
A lab has to be approved before it can launch, and there's a limit on studies open at once. See [Your lab on hosted Truman](/guide/your-lab).
:::

## The study link, and where participants go

The link is the site's address, then `/join/`, then the link name you chose when you started the study. With a recruitment ID on the end it looks like this:

```
https://clikbrite.com/join/your-link-name?PROLIFIC_PID=TEST123
```

If the ID isn't in the link, the page asks for it. To come back on a later day, participants use the same link.

Participant screens don't say Truman or research unless your study does. That includes the address. On hosted Truman, studies run at clikbrite.com by default. To choose another address the server offers, use **Participants go to** under the study's name on the **Studies** page. The study link, test participant links, and the link Prolific uses all follow it.

Participants open the link in a browser, on a computer or a phone. There's also a phone app that adds push notifications, though it isn't in the app stores yet. See [The phone app](/guide/mobile-app).

## Recruit on Prolific

You can give the study link to any recruitment platform that can add an ID to it. On the **Studies** page, press **Recruit** beside the version's **Launch** button, and choose where you're recruiting. For Prolific, Truman does most of the setup: choose **Prolific**, then **Recruit on Prolific**.

1. **Connect your account.** Create a token in Prolific under Settings, then API tokens. Paste it under **Prolific API token** and press **Connect**. Each researcher connects their own. It's stored encrypted and can't be shown again.
2. **Create the study on Prolific.** Fill in what participants see, the pay, and **Number of people**, then press **Create the draft on Prolific**. This makes an unpublished draft with the right link and completion codes. Nothing is spent.
3. **Set what you expect before paying someone:** **Minutes viewing posts**, **Posts seen**, and actions. Not meeting a rule never rejects anyone. It means a person looks at them.
4. **Publish on Prolific.** Choose your audience and publish there. Truman never publishes for you. Launch the study in Truman first, or the link won't let anyone in.

As people take part, **Submissions** lists each Prolific ID with what they did and whether they pass your rules. Press **Select everyone who passes**, then the approve button. A confirmation comes first, because approving pays people from your Prolific balance. Bonuses work the same way.

When people finish, Truman sends them back to Prolific with the right code. Someone who declines consent is sent back with a code asking them to return their submission. If your study sends people to a survey after Truman, the page shows the link to put at the end of your survey. See [Consent, surveys, and debriefing](/guide/flow).

## Recruit on CloudResearch, SONA, or anywhere else

Every platform needs three things from a study: the link to give out, the name of the ID in it, and where people go when they finish. Press **Recruit**, choose the platform, and the page shows them.

- **CloudResearch Connect.** Copy the link into your Connect project's URL. Connect adds each person's ID as `participantId`. Paste the completion redirect Connect shows you when you set up the project, so people who finish are sent back to it.
- **SONA.** Copy the link, which ends in `?id=%SURVEY_CODE%`, into your SONA study. Paste SONA's client-side completion URL. Truman puts each person's code where it says `XXXX`, so SONA grants their credit.
- **Somewhere else.** Choose the name of the ID in the link, what it's called, and how it's recorded, and paste where people go at the end. `{externalId}` in that address is replaced by each person's ID.

Under **What the study does now**, the page checks the version people get. If something needs to change, press **Make these changes in a draft**. It opens a draft with the changes made, on its Settings page. Save it as a new version and launch that, as with any change.

Truman can't approve or pay people on these platforms for you, as it does on Prolific. Download your data, and match `recruitment_ids.csv` to the platform's list.

## Reminders to come back

In a study that lasts more than a day, people need a nudge to return. Truman can't write to a participant itself: it knows their recruitment ID and nothing else. Prolific can, so reminders go to their Prolific inbox.

On the **Recruit on Prolific** page, once the study is linked to its Prolific study, find **Reminders to come back**.

1. Tick **Send them automatically**.
2. Set **Hours since their last visit**. It starts at 20, which catches people the next day.
3. Write **What it says**. It has to have `{link}` in it, which becomes each person's own link back in. `{site}` becomes the site's name.
4. Press **Save reminders**.

From then on Truman checks every 15 minutes and sends a reminder to anyone who:

- is part way through the study, and hasn't finished or withdrawn
- hasn't done anything for that many hours
- hasn't had a reminder yet that day
- still has days of the study left

The link gets them back in as the same person, on any browser or computer. They don't need to have kept anything.

**Send now** sends to everyone due one, there and then. The page says how many that is first.

A few things to know:

- **They're sent as you,** with your Prolific connection. If you disconnect it, or leave the lab, they stop until someone else turns them on.
- **Keep the message in character.** Participant screens don't say Truman or research unless your study does, and this message shouldn't either.
- **Only people who came through Prolific get them,** and only for a study whose Prolific draft was made from this page.
- **Check how long Prolific gives people.** A Prolific study has a maximum time. If a submission times out there before your study's last day, that person stops getting reminders, and may not be paid. Set it up on Prolific for the days your study runs.

Each send is listed under **What's been done from here**, with how many people.

## Monitor

**Monitor and download** shows how a running study is going. It refreshes on its own and shows counts, never IDs.

- **Joined**, **In progress**, **Finished**, and **Active in the last 15 minutes**
- how many declined consent or withdrew
- **By condition:** people, the planned share, how many finished, and their posts, comments, likes, votes, and flags
- **People joining each day**
- **Where people in progress are**, by step of the flow

Test participants aren't counted.

### Photos to look at

On hosted Truman, every photo a participant uploads is scanned automatically for nudity, violence, gore, and hate symbols. When one is flagged, a **Photos to look at** card appears on this page. It doesn't appear when there's nothing to look at.

Each photo is covered until you press **Show photo**. The card says what it was flagged for, and then you choose:

- **Release** or **It's fine** keeps the photo.
- **Remove** deletes it for good. Anyone who would have seen it sees "This photo was removed."

What happens before you decide depends on the study. In a study where each participant has a world of their own, nobody else can see their photo, so it's only listed for you. In a [shared world](/guide/shared-worlds), a flagged photo is **held**: the person who uploaded it still sees it, and everyone else in their world sees "This photo is being reviewed" until you decide.

The scan reads JPEG and PNG photos. A GIF or WebP can't be scanned, so in a shared world it's held and listed for you the same way. The scan makes mistakes in both directions, so it's a prompt to look, not a verdict.

The page also has the **Christof, the director** card, covered in [A cast that writes for itself](/guide/live-writing), and the **Shared worlds** section, covered in [Several real people together](/guide/shared-worlds).

## Stop

Press **Stop new participants** beside the live version, then confirm. New people can't join, but anyone already in the study can still come back. You can launch again whenever you like.

## Changing a study that's running

A saved version can't be changed. To change a running study, you make a new version and launch it.

1. On the **Studies** page, press **Edit a copy of version** and its number.
2. Make your changes and press **Save as new version**. With nothing changed, the window says it's still the same version.
3. Test it. It isn't live yet.
4. Press **Launch** beside the new version.

People already in the study stay on the version they started with. Only new participants get the new one. The Launch window tells you how many people are on the old version, and that your data would span two versions, which your analysis will need to account for.

`study_version` in the export says which version each participant had, and the codebook describes each version's settings.

## When it's over

Stop the study and download the data. To deposit the study itself with your paper, so others can rerun it, download its replication bundle. Both are in [Your data](/guide/data).

A study that isn't open can be hidden with **Archive** on the Studies page, and brought back with **Restore**. Nothing is deleted. An archived study that only test participants took part in can be deleted for good by an owner.

Launching, stopping, and exporting can also be done from the command line. See [Studies as files](/developers/study-files).
