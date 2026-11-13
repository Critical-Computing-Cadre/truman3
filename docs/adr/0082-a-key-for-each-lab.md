# 82. A key for each lab, for what ties its data to real people

## Context

A hosted Truman holds many labs' data in one database and one bucket. Both are encrypted at rest with one key, which protects against a stolen disk and nothing else. The design for hosting (ADR 70 and the notes behind it) promised labs more: that the host can't read their data in the ordinary course of things, and that each lab's data is encrypted with its own key.

A server that draws feeds has to read what participants wrote, so nothing can keep the server out. What a lab's own key can do is keep out everyone who reaches the data some other way: an administrator's login, a leaked backup, a query that crosses from one lab's rows into another's.

How much to put under the key was Dominic's call, between uploaded photos only, those and identifiers, or everything participants write as well. He chose photos and identifiers now, and to make a lab's key only once it runs real participants.

## Decision

- **A lab gets its key when it first opens a study to participants,** in the admin app. Not when it applies, is approved, or tests: a lab that never launches never costs a key. The Demos team never gets one.
- **The key lives in a key service and never leaves it.** On a hosted Truman that's AWS KMS, one key for each lab. It wraps a data key, which is stored wrapped on the team's row. The API asks KMS to unwrap it, and keeps it in memory.
- **What goes under it:**
  - **Recruitment IDs.** `participants.external_id` holds a stand-in, a keyed hash only the lab's data key can make, so finding someone by ID and the rule that an ID enters once both still work. The ID itself is sealed in `external_id_sealed`.
  - **IP addresses,** where a study keeps them, sealed inside the event that records them.
  - **Uploaded photos,** each encrypted by S3 with the lab's KMS key in place of the bucket's.
- **Sealing is AES-256-GCM** with a new nonce for each value. A sealed value starts `sealed:v1:` and a stand-in `id:v1:`, so later versions can be told apart.
- **The key's policy refuses its use to everyone but the roles the server is told,** which is its own, and later the emergency role's. An administrator's everyday login is refused whatever its own permissions say. The account still manages the key, which AWS needs for it to be manageable at all.
- **The API may make keys, and use only keys tagged for its own stage.** It can't change a key's policy once the key is made. KMS normally refuses to let anyone make a key they couldn't later re-policy, so the API tells it this is meant (`BypassPolicyLockoutSafetyCheck`).
- **Where the real ID is needed, it's opened there:** the link a participant leaves by, a download with recruitment IDs, and matching people to Prolific's list. A download opens IP addresses too.
- **People from before a lab's key stay as they were.** They're test participants, or a study opened from the command line. Entering looks for both forms, and a stand-in only ever matches a row the key made, so nobody gets in as someone else by typing what that person is stored as.
- **It's off unless `LAB_KEYS=kms`.** Hosted stages set it. Tests use a key service that lives in memory.

## Alternatives considered

- **Everything participants write, too.** The most protection, and the most that can go wrong: every place content is read or written changes, and anything the database does with the words moves into the server. Left until the university's review says what it expects.
- **Photos only.** The smallest change, and it leaves the one thing that names a person, their recruitment ID, readable in the database.
- **One KMS key for all labs, with a data key each.** A dollar a month in all. But a KMS key is what a policy and AWS's own record of use attach to. With one for each lab, "who used this lab's key" has an answer.
- **A key for each lab from the day it's approved.** Simpler to reason about. It charges for labs that never run anyone, and Dominic asked for it not to.
- **Encrypting the ID and looking people up by decrypting every row.** No stand-in to explain, and entering would get slower with every participant.
- **Postgres's own encryption functions.** The key would pass through the database on every query, and into its logs if a query failed.

## Consequences

- **Losing a lab's KMS key, or its wrapped data key, loses that lab's IDs and photos for good.** The hosting guide says so. A restore needs the key to still exist.
- A lab's key is about a dollar a month, and a few cents for use, since the data key is unwrapped once each time the server starts.
- The command line can't open sealed values. `pnpm study export --include-recruitment-ids` writes "(sealed)" for them, and `pnpm study withdraw` finds only people stored by the ID itself. On a hosted Truman both are done in the admin app, which can.
- What participants write, their usernames, and their profile text are not under the lab's key.
- The emergency login, and telling a lab when it's used, are not in this change. Until then the key's policy names only the API's role, and the site says the emergency login is still to come.
- A deleted lab's key isn't scheduled for deletion yet.
- Scanning (ADR 79) reads a photo from S3 as the API, so it needs the same permission to the lab's key the API has.
