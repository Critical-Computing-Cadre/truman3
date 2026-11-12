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

The study now says **Open to participants**, the version is marked **Live**, and the **Study link** appears under the study's name.

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

You can give the study link to any recruitment platform that can add an ID to it. For Prolific, Truman does most of the setup. Open **Monitor and download** for the study, then press **Recruit on Prolific**.

1. **Connect your account.** Create a token in Prolific under Settings, then API tokens. Paste it under **Prolific API token** and press **Connect**. Each researcher connects their own. It's stored encrypted and can't be shown again.
2. **Create the study on Prolific.** Fill in what participants see, the pay, and **Number of people**, then press **Create the draft on Prolific**. This makes an unpublished draft with the right link and completion codes. Nothing is spent.
3. **Set what you expect before paying someone:** **Minutes viewing posts**, **Posts seen**, and actions. Not meeting a rule never rejects anyone. It means a person looks at them.
4. **Publish on Prolific.** Choose your audience and publish there. Truman never publishes for you. Launch the study in Truman first, or the link won't let anyone in.

As people take part, **Submissions** lists each Prolific ID with what they did and whether they pass your rules. Press **Select everyone who passes**, then the approve button. A confirmation comes first, because approving pays people from your Prolific balance. Bonuses work the same way.

When people finish, Truman sends them back to Prolific with the right code. Someone who declines consent is sent back with a code asking them to return their submission. If your study sends people to a survey after Truman, the page shows the link to put at the end of your survey. See [Consent, surveys, and debriefing](/guide/flow).

## Monitor

**Monitor and download** shows how a running study is going. It refreshes on its own and shows counts, never IDs.

- **Joined**, **In progress**, **Finished**, and **Active in the last 15 minutes**
- how many declined consent or withdrew
- **By condition:** people, the planned share, how many finished, and their posts, comments, likes, votes, and flags
- **People joining each day**
- **Where people in progress are**, by step of the flow

Test participants aren't counted.

The page also has the **Christof, the director** card, covered in [A cast that writes for itself](/guide/live-writing), and the **Shared worlds** section, covered in [Several real people together](/guide/shared-worlds).

## Stop

Press **Stop new participants** beside the live version, then confirm. New people can't join, but anyone already in the study can still come back. You can launch again whenever you like.

## Changing a study that's running

A saved version can't be changed. To change a running study, you make a new version and launch it.

1. On the **Studies** page, press **Edit a copy of version** and its number.
2. Make your changes and press **Save as new version**.
3. Test it. It isn't live yet.
4. Press **Launch** beside the new version.

People already in the study stay on the version they started with. Only new participants get the new one. The Launch window tells you how many people are on the old version, and that your data would span two versions, which your analysis will need to account for.

`study_version` in the export says which version each participant had, and the codebook describes each version's settings.

## When it's over

Stop the study and download the data. See [Your data](/guide/data).

A study that isn't open can be hidden with **Archive** on the Studies page, and brought back with **Restore**. Nothing is deleted. An archived study that only test participants took part in can be deleted for good by an owner.

Launching, stopping, and exporting can also be done from the command line. See [Studies as files](/developers/study-files).
