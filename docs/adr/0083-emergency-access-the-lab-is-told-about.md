# 83. Emergency access to a lab's data, which the lab is told about

## Context

ADR 82 gave each lab a key that only the API's role may use. That leaves the host with no way to a lab's sealed data at all, including when a lab asks for help: recovering a photo, or reading an ID out of a restored backup. The design for hosting promised a way in for emergencies that can't be used quietly. Every use is recorded, and the lab is told without anyone having to remember to tell it.

It also promised to be honest about a limit. Whoever owns the AWS account can change a key's policy. Nothing stops that. It can be made visible.

## Decision

- **An emergency role,** `<stage>-emergency`. It may decrypt with keys tagged for its stage and read what participants uploaded, and nothing else. A session lasts an hour at most. An administrator has to take it on purpose, and AWS records that.
- **New keys name it.** A lab's key policy lets two roles use the key: the API's and this one.
- **AWS's record of calls is kept.** A hosted stage has a CloudTrail trail for its region, with signed log files, kept a year. It's what reports the events below, and it's the record to go to if there's ever a dispute.
- **Two rules send events to the API:**
  - any call to the key service made through the emergency role;
  - any change to a key or to who may use it, by anyone: a new policy, a grant, disabling it, scheduling its deletion.
- **The API records each one and emails the lab's owners,** and the operators. It works out which lab from the key. Events about keys that aren't a lab's are dropped. One email covers the next hour, so a restore that reads a hundred photos is one email and a hundred records.
- **The lab sees the record** on its Your lab page: every time anyone but the server used or changed its key. Empty is what a lab should expect.
- **The route the events arrive at is public,** since AWS calls it from outside. It takes nothing without a key that only the API and the rule's connection hold, and a server with no such key has no such route.
- **The API ignores its own use.** That's the site running.

## Alternatives considered

- **Tell the lab by hand.** The promise was that it happens automatically.
- **A function in AWS that emails the lab.** It would need its own way to find a lab's owners, which only the database knows. The API already has that and a mailer.
- **Have the API read AWS's record on a timer.** No public route, and a delay of however long the timer is. It would also need permission to read the whole record, which holds every call in the account.
- **A second factor on the role itself.** The account is signed in to through IAM Identity Center, which is where a second factor belongs. A condition on the role for one doesn't see it.
- **Reporting when the role is taken, too.** Taking it does nothing by itself. What matters to a lab is its own key being used, and that's what's reported, with the lab's name on it.

## Consequences

- **Keys made before this don't name the emergency role.** Staging has one. An administrator can add the role to its policy, and that change is itself reported to the lab.
- **The database isn't covered.** It has no route from outside, and reaching it takes a task run inside the network, which AWS records but nothing reports to a lab. What's sealed in it can't be read without the lab's key, and using that is reported.
- **A change to a key's policy is reported after it happens.** A lab learns its key was opened to someone. It can't prevent it.
- An event takes a few minutes to arrive, since AWS delivers its record in batches.
- If the API is down when an event arrives, AWS retries for up to a day. The trail has it either way.
- The trail costs little: the first copy of management events is free, and a year of them for one small account is a few gigabytes.
