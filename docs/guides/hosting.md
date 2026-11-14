# Running a hosted Truman

A hosted Truman lets other labs run studies on your server, instead of deploying their own. This guide is for whoever runs it, the **operator**. Why it works this way is in [ADR 70](../adr/0070-hosted-truman-applying-and-approving.md).

This guide covers labs applying, approving them, their limits, paying for Claude, email, and participant domains. Production runs this way, at app.truman-research.org ([ADR 73](../adr/0073-production-stage.md)). What's still to come before labs you don't know sign up is under Not ready yet in `docs/guides/deploying.md`.

## Turning it on

Set `HOSTED=true` in the API's settings. On AWS, that's `hosted: true` for the stage in `infra/lib/stages.ts`.

Then make yourself an operator, on the server:

```
pnpm admin operator you@example.edu
```

You need an account first. `pnpm admin setup` makes one, with a team of your own.

## When a lab applies

1. **It applies** from the sign-in page: "New to Truman? Apply for your lab". It gives the lab's name, institution, an optional web page, and what it wants to study.
2. **It's signed in at once,** and told it's waiting for approval. Meanwhile it can build, preview, and test studies, but not open them to participants.
3. **You see it** under **Labs** in the admin app, at the top, with its application and who applied.
4. **You approve it.** It gets the starting limits: 1,000 new participants in any 30 days, 10 studies open at once, and a $5 starter budget on your Claude key.

Email keeps everyone told (ADR 72), once it's set up (see Email in `docs/guides/deploying.md`):
- **The applicant** is told their application arrived.
- **You and every other operator** are told there's one to look at, with what the lab wants to study.
- **The lab's owners** are told when it's approved, with its limits, and when it's suspended or reinstated.

A lab invites its own people, and resets its own passwords, by email, so you don't need to.

## What you can see

The Labs page shows, for each lab:
- its application
- its owners
- how many members, studies, open studies, and participants it has

It never shows what's in a study or anything a participant did. That's on purpose: you host labs' data, you don't read it.

## Limits

Each lab has these limits, and you can change any of them on the Labs page:
- **New participants a month:** people entering any of its studies in the last 30 days. Once it's reached, a study takes nobody new until the oldest of those are more than 30 days ago. People already in a study can always come back. Test participants don't count.
- **Studies open at once:** launching another is refused until one is stopped.
- **Participants' photos, in GB:** what participants in all its studies have uploaded and that's still stored (ADR 80). Once it's reached, participants can't add photos. Deleting a participant's data, or a study, gives the room back. The Labs page shows how much each lab is using.
- **Starter budget on your key:** see Paying for Claude, below.

Leave a box blank for no limit. Teams made with `pnpm admin setup` have no limits.

## Paying for Claude

Live writing, rehearsing lines, personas, and agents call Claude ([ADR 71](../adr/0071-each-labs-own-claude-key.md)):
- **A lab with its own key pays for its own use.** An owner adds it under **Your lab**. It's stored encrypted with `TRUMAN_SECRET_KEY`, so that has to be set.
- **A lab without one uses your key** (`ANTHROPIC_API_KEY`) up to its **starter budget**: $5 when it's approved, which you can change on the Labs page. After that, its studies use their fixed and fallback lines until it adds a key.
- **A lab waiting for approval** can't use your key at all.

The Labs page shows what each lab has spent on your key and on its own. You never see a lab's key, only whether it has one.

## Participant domains

Studies can run at a domain that doesn't say "research", such as clikbrite.com on production, chosen on the Studies page ([ADR 74](../adr/0074-participant-domains.md)). Every lab can use the domains you offer. Adding one is in `docs/guides/deploying.md`, under Participant domains. A lab bringing its own domain comes later.

## Demos

With `DEMO_STUDIES=true`, the server sets up four of the example studies for anyone to try, at `/join/try-bystander`, `/join/try-eatsnap`, `/join/try-flag-source`, and `/join/try-vaccine-frames` (ADR 78). It does this as it starts, and again whenever an example changes.

- They belong to a team called Demos, which has no researchers. You see it on the Labs page.
- The Demos team has no budget for Claude, so the cast uses its written lines. Raise its starter budget if you want a demo's cast to improvise, knowing anyone can open it.
- The same setting offers all five examples to every lab on the **New study** page, as packs named **Example: ...** (ADR 81). When an example changes, its pack is replaced.
- To close one, stop it like any study. It stays stopped until its example next changes.
- A demo visitor's data is deleted a week after they started, with anything they uploaded. Each demo's first page tells them so.

## Each lab's own key

With `LAB_KEYS=kms`, a lab gets a key of its own in AWS KMS the first time it opens a study to participants (ADR 82). A lab that's only building and testing has none, and neither does Demos. Each key costs about a dollar a month.

From then on that lab's recruitment IDs, IP addresses, and uploaded photos are stored under its key. In the database a recruitment ID is a stand-in, `id:v1:...`, with the ID itself sealed beside it.

- **You can't use a lab's key with your everyday AWS login.** The key's policy refuses it to everyone but the API's role. You can still see that the key exists, and what it costs.
- **Don't delete a lab's key or its `data_key_wrapped`.** Without both, that lab's IDs and photos can't be read by anyone, and there's no way back.
- A backup holds the wrapped data key and the sealed values. Restoring it needs the lab's KMS key to still exist.
- Keys are named `alias/<stage>-lab-<team id>` and tagged `truman-stage` and `truman-team`.

## Emergency access to a lab's data

You can't use a lab's key with your everyday login. For the rare time a lab asks you to recover something, there's a role made for it, `<stage>-emergency` (ADR 83). A deploy prints its ARN as `EmergencyRoleArn`.

**Before you use it, know what happens.** AWS records every call you make with it. Within a few minutes the lab's owners get an email saying their key was used, when, and through which role, and it's listed on their Your lab page for good. So tell the lab first.

To take the role for up to an hour:

```
aws sts assume-role --role-arn <EmergencyRoleArn> --role-session-name <your-name>-<why> --profile <profile>
```

Use the credentials it prints for the one thing you came to do. The role can decrypt with labs' keys and read files under `uploads/` in the media bucket. It can't reach the database, change anything, or use any other part of AWS.

A few more things:

- **A change to a lab's key is reported too,** whoever makes it: a new policy, a grant, disabling it, or scheduling its deletion.
- **A key made before the emergency role existed doesn't let the role use it.** To add it, put the role's ARN beside the API's in that key's policy, under `aws:PrincipalArn`. The lab is told you changed its key.
- **The record itself** is the CloudTrail trail `<stage>-calls`, kept a year in its own bucket.
- Reports reach the API at `/api/hooks/key-events`, with a key held in the secret `<stage>/key-events-hook-key`. Nothing else should call it.

## Reports of security problems

A stage with `mail.securityContact` set takes mail for that address, `security@truman-research.org` on production, and sends each message to the topic `<stage>-security-reports` (ADR 84). A deploy prints the topic as `SecurityReportsTopic`.

Nothing reaches anyone until an address is subscribed to it:

```
aws sns subscribe --topic-arn <SecurityReportsTopic> --protocol email --notification-endpoint <your address> --profile <profile>
```

AWS then emails that address a link to confirm. Subscribe a second person too, so a report isn't waiting on one inbox.

A report arrives as a notification from AWS with the sender's message inside it. To answer, write to the sender from your own address.

### Requests for help

`mail.supportContact`, `support@truman-research.org` on production, works the same way (ADR 87). Its topic is `<stage>-support-requests`, printed as `SupportRequestsTopic`, and it needs its own subscription. It's the address the site gives researchers for anything that isn't a security problem.

`apps/site/public/.well-known/security.txt` has a date it expires on, and a test starts failing a month before it. Move the date on by a year when it does.

## Photo scanning

With `PHOTO_SCANNING=rekognition`, each photo a participant uploads is scanned by Amazon Rekognition (ADR 79). Flagged photos go to the study's researchers, on their Monitor page. An operator doesn't see them.

It needs the photos in S3 and the permission `rekognition:DetectModerationLabels` for the API. The cloud setup in `infra` gives a hosted stage both.

By default Amazon may keep what its AI services are sent, to improve them. To stop that, set an AI services opt-out policy in AWS Organizations, from the organization's management account, and attach it to the Root. Making the policy isn't enough: it does nothing until it's attached. To check it from an account, `aws organizations describe-effective-policy --policy-type AISERVICES_OPT_OUT_POLICY` should show `optOut`. The hosted Truman at truman-research.org has had this since 2026-11-13.

## Suspending a lab

**Suspend** stops a lab's studies at once:
- its participants can't continue
- nobody new can enter
- it can't launch anything

Its researchers can still sign in and export their data. **Reinstate** brings everything back. Use it for abuse or a security problem. Get in touch with the lab first if you can.
