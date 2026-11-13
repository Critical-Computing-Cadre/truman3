---

title: Your lab on hosted Truman
description: How a lab applies for hosted Truman, what it can do while it waits, its limits, its people, and how Claude is paid for.
---

# Your lab on hosted Truman

Hosted Truman is a Truman that's run for you. Your lab gets an account, and everyone in the lab builds and runs studies from the browser. This page covers getting in and what your lab gets.

![The Your lab page: who's on the team, invitations, and the lab's Claude key](/shots/your-lab.png)

## Apply

1. Go to [app.truman-research.org/admin](https://app.truman-research.org/admin/).
2. Under the sign-in form, press **Apply for your lab**.
3. Fill in the form:
   - **Lab or group**
   - **University or institution**
   - **Lab or faculty web page**, which is optional and helps show who you are
   - **What you'd like to study with Truman**, in a few sentences
   - **Your name** and **Your email**. A university address gets you approved sooner.
   - **Choose a password**, at least 12 characters
4. Press **Apply**.

You're signed in straight away, as the owner of your lab. You'll also get an email saying the application arrived.

## While you wait

A person reads each application, so approval isn't instant. Until then a bar at the top of every page says your lab is waiting to be approved.

You don't have to sit idle, though. While you wait, you can:

- build studies
- preview them at any time in the study
- save versions and go through them as a test participant
- run scenario tests and random simulated participants

You can't launch a study, so no real participant can reach anything you build. If you try, launching tells you why. You also can't use Claude yet, so live writing, rehearsing lines, personas, and agents wait for approval.

When your lab is approved, its owners get an email with its limits.

## Limits

An approved lab starts with:

| Limit                           | Starts at |
| ------------------------------- | --------- |
| New participants in any 30 days | 1,000     |
| Studies open at once            | 10        |
| Photos from participants        | 5 GB      |
| Starter budget for Claude       | $5        |

**New participants** counts people entering any of your lab's studies in the last 30 days. When you reach it, your studies take nobody new until the oldest of those entries is more than 30 days old. People already in a study can always come back. Test participants don't count.

**Studies open at once** counts launched studies. Launching another is refused until you stop one.

**Photos from participants** adds up what participants have uploaded across all your studies. At a few megabytes a photo, 5 GB is a few thousand photos. Once it's reached, a participant who tries to add a photo is told it can't be used, so ask for more before a photo-heavy study gets there. Withdrawing a participant or deleting a study frees what they used. Photos you put in a study yourself don't count.

::: tip Planning something bigger
Whoever runs hosted Truman can raise any of these for your lab. If you're planning a study that needs more, ask before you recruit.
:::

## Teammates and roles

Open **Your lab** in the bar at the top. It lists everyone on the lab and anyone you've invited.

To add someone:

1. Type their address under **Invite by email**.
2. Choose a role under **As**.
3. Press **Send invitation**. The link in the email works for 7 days. Press **Cancel invitation** to take it back.

There are three roles:

- **Owner:** everything, including who's on the team.
- **Editor:** builds, launches, and exports studies.
- **Viewer:** sees studies and results, changes nothing.

Two things are kept for owners. Only an owner can include recruitment IDs in a data download, and only an owner can change the lab's Claude key. Viewers can't download data at all.

Owners can change someone's role from the same list. Anyone who forgets their password can press **Forgot your password?** on the sign-in page and get a link by email, which works for an hour.

## Claude, and who pays for it

Four things in Truman call Claude, an AI model made by Anthropic:

- cast members writing live (see [A cast that writes for itself](/guide/live-writing))
- rehearsing lines for a beat
- personas, where a model plays a participant (see [Testing a study](/guide/testing))
- agents that draft parts of a study for you

Each call costs a little. To get you started, your lab has a **$5 starter budget**, paid for by hosted Truman. It's a one-time amount, counted across all your studies. The **Claude** section of the **Your lab** page shows how much is spent.

When the starter budget is gone, nothing breaks. Studies use the fixed lines they were written with until you add a key.

To keep using Claude, an owner adds the lab's own key:

1. Make a key in the Claude Console, under API keys.
2. On **Your lab**, paste it under **Add your lab's Claude key**.
3. Press **Save key**.

From then on your lab pays Anthropic for what it uses, and the page shows what's been spent so far and in the last 30 days. The key is stored encrypted. Nobody can read it back, including you. **Remove key** takes it out again.

## What the people running hosted Truman can see

They see your application, your owners' names and emails, and counts: members, studies, open studies, participants, and what's been spent on Claude. They don't see what's in a study or anything a participant did.

They can suspend a lab for abuse or a security problem. A suspended lab's studies close to participants at once. Its researchers can still sign in and export their data.

## Where your participants go

Studies on hosted Truman run at clikbrite.com by default, so the address bar doesn't say "research". See [Running a study](/guide/running).

## What's left before real participants

Hosted Truman is in beta. These have to be done before anyone runs a real study on it:

- **Terms of service and a privacy policy,** reviewed by the university that hosts it.
- **Each lab's data encrypted with its own key,** with any access by the host logged and told to the lab.
- **Opting out of Amazon keeping scanned photos.** Photos participants upload are scanned by Amazon Rekognition. By default Amazon may keep what it scans to improve its services, and hosted Truman's account hasn't opted out yet.

Until then, use it to build and pilot. Everything you make now stays when it opens.
