---

title: For IRBs
description: What Truman does with participants and their data, written for an ethics board reviewing a study that uses it.
---

# For IRBs

A researcher has probably sent you this page because their study uses Truman. This is what the software does. What the study does with it is in their protocol.

Truman is open-source software for building a simulated social media site. The researcher writes the posts and the other users. A participant uses the site, and Truman records what they see and do.

## What a participant experiences

They open a link, usually from a recruitment service such as Prolific, and enter with their recruitment ID. They read the consent page and agree or decline. They choose a username and profile, then use the site for as long as the study runs, from a minute to several days. At the end they're sent on, often to a survey.

## Deception and debriefing

Most Truman studies involve deception. The other users are a cast written by the researcher, and the site has its own name. Participant screens don't say it's a research platform unless the study does. A study can also show made-up terms of service, or tell a participant their post broke a rule.

Truman doesn't decide whether that is justified. The protocol does. Debriefing is a page the researcher writes, shown at the end or in the survey that follows.

## Consent

Consent is a step the researcher puts in the study, with their approved text. Truman warns the researcher if the placeholder text is still there. Some labs put consent in a survey before Truman instead.

If someone declines, their data is deleted and that ID can't enter the study again.

## What's recorded

- What the participant was shown, in what order, and how long each post was on screen
- What they did, with times: likes, flags, follows, blocks, and so on
- What they wrote or uploaded: posts, comments, private messages, and photos
- Their condition and how it was assigned
- Device type (phone, tablet, or desktop) and browser name
- In the phone app: when it was opened and closed, and a notification token if they allow notifications

## What isn't

- **Email addresses and passwords.** Truman doesn't ask for them.
- **IP addresses.** Off by default. A study can turn storage on, and the protocol should say if it does.
- **The browser's full user-agent string.** Only the device type and browser name are kept.
- **IDs in server logs.** Logs can't be cleaned later, so they leave IDs out.

## Recruitment IDs

Truman keeps the recruitment ID so a participant can return to a multi-day study. Data exports leave it out, and each participant has a separate Truman ID for analysis. Only the team's owner can download recruitment IDs, and every download is recorded.

The recruitment ID is the only credential, so someone who knew a participant's ID could enter as them. That suits a low-risk study. It doesn't suit one collecting sensitive disclosures.

## Who can see the data

The research team that owns the study. Members are owners, editors, or viewers, and viewers can't download data.

On hosted Truman, the operator's pages show counts for each lab, such as how many studies and participants it has. They never show a study's content or anything a participant did.

## Withdrawal and deletion

A participant withdraws by contacting the research team. A researcher then withdraws them, and Truman deletes their records and uploads. It keeps a note that a deletion happened, and a one-way hash of the ID so the same person can't re-enter that study.

On hosted Truman, database backups are kept for 30 days, so a deleted record can remain in a backup for up to that long.

## Where data is stored

- **Hosted Truman:** Amazon Web Services, in the us-east-1 region in the United States. The database and file storage are encrypted, and connections use HTTPS.
- **Self-hosted:** on servers the lab or its university runs, set up as they choose.

On hosted Truman, each photo a participant uploads is checked by an automated image-moderation service, Amazon Rekognition, for nudity, violence, gore, and hate symbols. Rekognition is part of Amazon Web Services, where the photo is already stored. A flagged photo is shown to the study's researchers to keep or remove. In a study where participants see each other, it's hidden from the other participants until a researcher decides. A self-hosted Truman scans only if whoever runs it turns that on.

## AI-written content

By default the researcher writes every word ahead of time. A study can turn on live writing, where an AI model (Anthropic's Claude) writes a cast member's reply.

- The study still decides whether and when something happens. The model writes only the words.
- A second check reads every line before it's posted. It blocks slurs, sexual content, threats, real people's information, and dangerous instructions, plus limits the researcher adds. If it fails, a line the researcher wrote ahead is used.
- To write a reply, the model is sent the post and nearby comments, which can include what the participant wrote.
- Every line is recorded. A researcher can pause live writing at any time.

## Shared worlds

Usually each participant is alone with the cast. In a shared world, several real participants see and message each other. Real people can be unkind, and what one writes is seen by the others.

- Truman warns the researcher if the consent page doesn't say that others may be real.
- A study can set rules that remove posts containing chosen words.
- A researcher can watch what's written and remove anything at once.
- When someone withdraws, what they wrote disappears for the others.

## What the researcher is responsible for

- Ethics approval, the consent text, and the debriefing
- Justifying the deception, and everything the cast says
- Watching a shared-world study while it runs
- Acting on withdrawal requests
- Exported data, and any survey data, which may hold recruitment IDs

## Still being finished

Hosted Truman's terms of service and privacy policy are under review and aren't final. Two things are planned and not yet in place. One is encrypting each lab's data with its own key. The other is opting hosted Truman's account out of Amazon's default terms for its AI services, under which Amazon may keep photos sent for scanning and use them to improve those services.

The code is public at [github.com/Critical-Computing-Cadre/truman3](https://github.com/Critical-Computing-Cadre/truman3). Researchers can read more in [Ethics](/guide/ethics) and [Your data](/guide/data).
