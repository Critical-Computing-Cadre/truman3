# 109. A published, signed image of the API

## Context

Someone who runs their own Truman builds the API's container themselves, from a checkout (`docs/guides/deploying.md`). A release gave them a tag, notes, and a list of dependencies (the SBOM), but nothing built. And nothing let a person holding a built image check where it came from: that it was built from this repository, at that tag, by the project's own workflow, and not by someone else or changed since.

Hosted Truman doesn't have this problem. Its deploy builds the image from `main` and hands it straight to AWS (ADR 88).

## Decision

- **Each release publishes the API's image** to GitHub's registry, as `ghcr.io/critical-computing-cadre/truman3`, under the release's tag, such as `v3.0.0-beta.1`. It's public, like the repository.
- **It's built from the tag,** by a job in `.github/workflows/release.yml`, with the same `Dockerfile` a deploy uses.
- **It's built for both kinds of processor,** x86 and ARM, each on a GitHub machine of that kind. One name serves both, and `docker pull` takes the right one.
- **GitHub signs a statement about it:** a build provenance attestation, which says which repository, workflow, and commit produced the image with this digest. It's signed through Sigstore with a short-lived certificate that names the workflow, so the project holds no signing key to keep safe or lose. The statement is stored in three places: with the repository on GitHub, beside the image in the registry, and attached to the release as `truman3-image-<tag>.intoto.jsonl`.
- **Anyone can check it** with GitHub's command line:

  ```
  gh attestation verify oci://ghcr.io/critical-computing-cadre/truman3:v3.0.0-beta.1 \
    --repo Critical-Computing-Cadre/truman3
  ```

- **Hosted Truman doesn't use this image.** Its deploys still build from `main`.

This is what SLSA calls Build Level 2: the provenance is made and signed by the build service, not by anything the build's own steps control. GitHub describes its attestations that way in [its documentation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds).

## Alternatives considered

- **A second signature made with cosign,** on top of the attestation. The attestation is already a Sigstore signature over the image's digest, and it says more than a bare signature does. Two would mean two things to keep working and two ways to explain checking an image.
- **A signing key of the project's own.** Someone has to hold it, and the project has one maintainer. A certificate that lasts minutes and names the workflow can't be lost or leaked.
- **Building both kinds on one machine, by emulation.** It works, but installing dependencies under emulation is slow, and GitHub has ARM machines. The deploy already builds on one.
- **A `latest` tag.** A person running a study should know which version they're on. Every release so far is a beta.
- **Signed images of the participant and admin apps.** They're folders of files, served by whatever a lab already uses, and aren't published as images.
- **SLSA Build Level 3.** It needs the build to run in a separate, reusable workflow that the release can't alter. Worth doing if someone depends on the image. Nobody does yet.

## Consequences

- The registry also shows `<tag>-amd64` and `<tag>-arm64`, the two halves. They're not signed on their own. The statement is about the joined image, which names both by digest.
- The first time the job publishes, an owner of the GitHub organization has to make the package public in its settings. GitHub creates it private.
- Running the workflow by hand for an old tag builds that tag's code, but the statement names the branch the workflow was run from.
- A base image update after a release doesn't reach a published image. A fix arrives with the next release.
- The image isn't scanned for known vulnerabilities when it's published. Dependabot's alerts cover the same lockfile and base image in the repository.
