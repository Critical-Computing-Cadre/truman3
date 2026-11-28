# Truman 3

[![DOI](https://zenodo.org/badge/1441943190.svg)](https://doi.org/10.5281/zenodo.24551519)

Truman is a social media simulation platform for research. A research team builds a realistic social media site, with its own posts, people, and rules, and brings participants into it. Everything a participant sees is under the team's control, everything they do is recorded, and what they see can differ by experimental condition. So questions about social media can be studied with experiments, without needing a company's cooperation or its data.

Truman 3 is the current release of Truman. It's for researchers who study online behavior: in communication, psychology, human-computer interaction, information science, and related fields.

- **Use it:** hosted Truman is in beta at [truman-research.org](https://truman-research.org), with a [guide for researchers](https://truman-research.org/guide/) and demos to try without an account.
- **Run your own:** everything here runs on your own servers. See [Getting started](#getting-started) and [Run your own](https://truman-research.org/developers/run-your-own).
- **See what it does:** [FEATURES.md](FEATURES.md) is the full, dated list.

Truman 3 is in beta. Studies run from start to finish, and it's tested on every change, but it hasn't yet run a study with real participants.

## What it does

- **Six kinds of site:** a classic feed, a forum, short posts, a photo app, short video, and a video platform. Each is built from about 60 features a study can turn on or off, for everyone or for one condition.
- **A study builder in the browser,** where a team writes posts in the feed they'll appear in, sets conditions, and previews as a participant. A study can also be a folder of spreadsheets and settings.
- **A cast that acts:** the made-up people on a site can react to what a participant does, at moments the study scripts. With a study's say-so, a language model can write their lines, within limits the team sets, with every line checked and recorded.
- **Moderation as study material:** removals, warnings, labels, bans, and appeals are things a study scripts and varies.
- **Several participants in one world,** who see each other, for studies of groups.
- **Recruiting** through Prolific, CloudResearch Connect, SONA, or any panel that uses links.
- **Data:** an append-only log of what each participant was shown and what they did, exported as CSV files with a codebook.
- **Testing before running:** checks, scenario tests, and simulated participants.
- **Replication:** a saved study can be bundled, shared in a library, and run by another lab.

The full list, with where each part runs and the decision behind it, is in [FEATURES.md](FEATURES.md).

## Hosted or your own

|                    | Hosted Truman                                                                     | Your own                                         |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Where it runs      | [truman-research.org](https://truman-research.org)                                | Your servers, with Docker or on AWS from `infra` |
| Who can use it     | Labs that apply and are approved, while it's in beta                              | Anyone                                           |
| Who holds the data | The host, with a key for each lab ([ADR 82](docs/adr/0082-a-key-for-each-lab.md)) | You                                              |
| The code           | This repository                                                                   | This repository                                  |

## Getting started

You'll need Node 24 and something that runs Docker containers, such as Docker Desktop or OrbStack.

```
corepack enable
pnpm install
cp .env.example .env
docker compose up --detach --wait
pnpm db:migrate
pnpm study import studies/examples/eatsnap
pnpm study add-pack studies/examples/eatsnap "EatSnap" "A food photo community"
pnpm study launch eatsnap
pnpm dev
```

If `corepack enable` fails with a permission error (`EACCES`), your Node install keeps its commands in a folder you can't write to. Install `pnpm` in your home folder instead, and check that `~/.local/bin` is on your `PATH`:

```
mkdir -p ~/.local/bin
corepack enable pnpm --install-directory ~/.local/bin
```

- Try the example study: http://localhost:5180/join/eatsnap
- Admin app: http://localhost:5181/admin. Create your account first with `pnpm admin setup "Your Lab" your-lab you@example.edu "Your Name"`, which prints your password
- API: http://localhost:3000/health/ready

To connect a study to Prolific and a survey, see [docs/guides/connecting-prolific-and-surveys.md](docs/guides/connecting-prolific-and-surveys.md).

## How it's developed

- **Every change is a pull request,** with a plain-language summary and how it was tested.
- **Every pull request is tested** in CI: formatting and lint, type checks, unit tests, integration tests against a real database, and browser tests through whole studies. The API's container is built and checked too.
- **Choices are recorded.** Each one someone might later question has a short decision record in [docs/adr](docs/adr), with the alternatives considered.
- **A merge deploys to staging.** Production waits for a person's approval.

[docs/architecture.md](docs/architecture.md) is the map of the code, [docs/cloud.md](docs/cloud.md) is how it runs on AWS, and [the contributing guide](https://truman-research.org/developers/contributing) says how to add to it.

## Where Truman comes from

Truman has been in use since 2017, and Truman 3 is its third generation.

- **Truman** ([cornellsml/truman](https://github.com/cornellsml/truman), 2017) was created by Dominic DiFranzo at the Cornell Social Media Lab, with Natalie Bazarova, and support from NSF IIS-1405634. It was built on [Hackathon Starter](https://github.com/sahat/hackathon-starter) by Sahat Yalkabov.
- **Truman 2.0** ([cornellsocialmedialab/truman_2023](https://github.com/cornellsocialmedialab/truman_2023)) is the Cornell Social Media Lab's maintained version, which labs have copied for their own studies. [Coming from Truman 2.0](docs/guides/coming-from-truman-2.md) says how to bring a study over.
- **[Truman Agents](https://github.com/Cornell-Design-AI-Group/TrumanAgents)**, by Qian Yang and the Cornell Design & AI Group, added language-model agents to Truman. Truman 3's cast that acts builds on its ideas.

Truman 3 is a new codebase, written at Lehigh University. It carries over what those versions learned, and none of their code. The people and studies behind Truman are on the [About page](https://truman-research.org/about).

## How to cite

If you use Truman 3, please cite the software, using [CITATION.cff](CITATION.cff) (GitHub's "Cite this repository" button reads it), and the paper that introduced Truman:

> DiFranzo, D. (2026). Truman 3 [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.24551519

That DOI always points to the newest release. Each release has a DOI of its own on [Zenodo](https://doi.org/10.5281/zenodo.24551519), for citing the exact version a study ran on. Version 3.0.0-beta.1 is [10.5281/zenodo.24551520](https://doi.org/10.5281/zenodo.24551520).

> DiFranzo, D., & Bazarova, N. N. (2018). The Truman Platform: Social media simulation for experimental research. Workshop paper, ICWSM '18.

Truman 3 is the next version of Truman, not a separate platform, so `CITATION.cff` also lists the versions it follows: Truman, Truman 2.0, and Truman Agents. If your work builds on one of those, please cite it too.

## Security

Please report security problems privately, to security@truman-research.org. See [SECURITY.md](SECURITY.md).

## License

Truman 3 is released under the [MIT License](LICENSE).

Copyright (c) 2026 Dominic DiFranzo.

If you copy or adapt Truman 3, keep the LICENSE file and this notice with your copy, as the MIT License requires. Earlier versions of Truman are also MIT-licensed, and include code from Hackathon Starter, copyright (c) 2014-2016 Sahat Yalkabov. None of that code is in Truman 3.
