# 91. A replication bundle: a study as it ran, in one file

## Context

A paper about a Truman study describes its stimulus in a paragraph: a feed of some posts, a comment that differed by condition. Nobody can rerun that from the paragraph. Open science asks for the materials, and for a study on a simulated platform the materials are the platform as it was set up: the cast, every post, what happened and when, the conditions, the pictures.

Truman has all of that for every saved version, frozen, and couldn't hand it over. A pack (ADR 15) carries a study's content between labs, but leaves out its flow, its assignment, and its pages on purpose, and names its pictures by where this Truman stores them. The data export has the settings in its codebook, and none of the content as something that can be loaded. The study's own folder of files exists only for studies written as files.

## Decision

- **A replication bundle is one saved version, whole, as a zip file.** It's made from the version as it's frozen in the database, so it's what ran, whatever was edited since.
- **What's in it:**
  - `study.json`: the settings, every page, and every item (the cast, spaces, posts, comments, stories, and everything scripted about them), as a draft of that version would hold them. Also its version number, content hash, seed, and when it was open to participants.
  - `media/`: every picture the study names that Truman stores. Each is named by the SHA-256 of its contents, as it already is in storage.
  - `checksums.txt`: the SHA-256 of every file, in the form `shasum -c` reads.
  - `README.md`: what it is, for someone who opens it without Truman, with a sentence for a paper.
- **It has no participants and no data.** It's the stimulus.
- **Downloaded from a version's row on the Studies page,** or written to a folder with `pnpm study bundle`.
- **Loading one starts a new study, as a draft,** from New study. The draft has everything the version had. It gets a link name and title of its own.
- **The consent page is in the bundle, and isn't loaded.** What participants agreed to is part of the record of what ran, so it's there to read. The study loaded from it gets the placeholder, as a study from a pack does, since a lab has to show the wording its own ethics board approved (ADR 15).
- **A bundle is a file from somewhere else, so loading trusts nothing in it.** Every file is checked against the checksums. Each picture has to be what its name says it is, and an image by its contents. The settings and every item have to pass the same rules as ones made here. A picture is stored under its own checksum, so it can't replace anything.
- **What it brings is marked as coming from the bundle,** by its content hash and name, keeping where each thing came from before that, so generated content stays marked.

## Alternatives considered

- **The study's folder of files** (study.yaml and the CSVs). It's readable, and it's what `pnpm study import` takes. But nothing writes it from a saved version, and writing a dozen CSV formats back out exactly is a large piece of work with its own ways to go wrong. A study built in the builder never had those files. JSON of what's stored is exact by construction.
- **Extending packs.** A pack is shaped by what it leaves out, which is the opposite of the point here, and it's stored in one Truman's database, not a file.
- **Loading as a frozen version,** identical down to its content hash. It would be the closest thing to the original. But a version can be launched at once, and it would carry another lab's consent text and recruitment settings straight to participants. A draft has to be read and saved by a person first.
- **Leaving the consent text out of the bundle.** Safer by default, and what a pack does. But the bundle is the record of what ran, and consent wording is one of the things a reviewer or replicator wants to see. It's kept in the file and kept out of the loaded study.
- **A DOI or a deposit made from Truman.** That's the repository's job (OSF, Zenodo). The bundle is a file to give them.

## Consequences

- **A study loaded from a bundle isn't the identical version.** It has the same site and content. Its content hash differs, since its link name does, and so does everything seeded by the hash: which delay in a range a beat draws, and the order of blocked assignment. The bundle records the original hash and seed.
- **Pictures kept somewhere else aren't in the bundle.** A study whose media is at its own address (`media.baseUrl`) names them by URL, and the bundle keeps the URLs. If that address goes away, so do the pictures.
- **A picture over 10 MB, or one that isn't a JPEG, PNG, GIF, or WebP, isn't loaded.** A site's icon may be an ICO. A post's picture that can't be brought means the bundle is refused. A site image that can't be brought is left off.
- **It's built and unzipped in memory,** up to 200 MB, like the sheets upload. A study with more pictures than that needs a streaming version of this.
- **It doesn't say which version of Truman's code ran the study.** Nothing in a running Truman knows that yet. The format has its own version number, and a newer bundle is refused by an older Truman with a message saying so.
- **Saving a draft as a version used to drop the site's own rules, terms, and privacy pages.** The round-trip test for this found it. They're kept now.
- **Anyone who can see a study can take a bundle of it,** including a viewer. It has nothing a viewer can't already read.
- **A public library of studies** (ADR to come) can be built on this: a bundle, published.
