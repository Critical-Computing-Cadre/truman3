# 92. A library of studies that labs publish for each other

## Context

A replication bundle (ADR 91) lets a lab hand its study to anyone, as a file. Finding one still means knowing the paper, finding where its materials were deposited, downloading a zip, and loading it. Most studies that could be rerun or built on won't be, because nobody knew they were there.

Truman already had the start of a shared shelf: packs available to every team on a server, and the five example studies offered on New study (ADR 81). Those are put there by whoever runs the server. A lab couldn't add its own.

## Decision

- **A lab publishes a saved version to the library.** From the version's row on the Studies page, with a few sentences on what the study tests, the paper it's from, a license, and their word that they may share everything in it, pictures included.
- **What's published is a replication bundle,** made then and kept as its own file. It stays as published whatever later happens to the study, or to the lab's other versions.
- **Every signed-in researcher on this Truman can see the library,** on its own page: what each study tests, its kind of site, conditions, size, license, paper, and a few of its pictures.
- **Copy into my lab** loads the bundle as a draft, exactly as loading the file would: everything in it, a title and link name of the copier's choosing, and placeholder text for consent.
- **Anyone who can see a study can download its bundle.**
- **On a hosted Truman, a published study waits for an operator** before other labs see it, as a lab itself waits to be approved (ADR 70). The operator can read its bundle first. On a Truman someone runs for themselves, it's listed at once.
- **A lab can take its own study down. An operator can take down any.** Taken down means gone, the entry and its file. Copies already made are their labs' own, and stay.
- **A version can be in the library once per lab.**
- **Four licenses to choose from:** CC BY 4.0, CC BY-NC 4.0, CC0 1.0, and "Ask the authors first".
- **Agents can read the library and copy from it, and can't publish or list.** Putting a lab's work in front of other labs is a person's decision.

## Alternatives considered

- **A public page on the web,** where anyone can browse and download without an account. It's what open science means in the end, and the bundle format is ready for it. But it makes everything published readable by the world, pictures and consent wording included, and it needs a decision about who's responsible for what's there. This is the same library with a smaller door. Opening it wider is a later choice, and the table and files don't change when it's made.
- **Linking to the study, not copying a file.** Less stored. But a library entry would change, or vanish, when its lab edited or archived the study. The point is that it's a record.
- **Publishing a pack.** Packs leave out the flow, the conditions' assignment, and the pages (ADR 15). A published study should be the whole thing.
- **No approval on a hosted Truman.** Faster for labs. But the operator answers for what's on the service, and a published study carries pictures and text to every other lab.
- **Free-text licenses.** More exact for an unusual case. A short list is readable at a glance, and "Ask the authors first" covers the rest.
- **Keeping a taken-down entry, marked as removed.** It would keep a history. A lab that takes something down usually wants it gone, and often because it shouldn't have been shared.

## Consequences

- **A lab can make its study public too,** readable without an account (ADR 93).
- **The library is per Truman.** A study published on hosted Truman isn't seen by someone running their own, except as a bundle file they're given.
- **Publishing is a claim about rights that Truman can't check.** The tick box records that the lab said so. The operator's look before listing is the only other check.
- **A lab's consent wording is visible to other labs,** inside the bundle. The publish window says so. It's still never loaded into a copy.
- **Each published study stores a second copy of its pictures,** inside its bundle's zip. It counts toward nothing yet. If the library grows, it should count toward a lab's storage.
- **Copying relies on the pictures still being in storage** under the keys they had when published, which they are for as long as nothing deletes study media. The bundle has them too, as a fallback that isn't used yet.
- **There's no search, and no way to say a study was copied or cited.** A list is enough for a handful. Both come when there are more.
- **An operator isn't told when something is waiting.** They see it on the Library page. An email, like the one for a new lab, is a small addition.
