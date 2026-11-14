# 88. Deploys run from GitHub, and production waits for a person

## Context

Every deploy was run by hand, from one computer, by whoever had an AWS login open (ADR 23 named deploying from CI as the eventual aim). That worked while one person was building. It also meant a merged change wasn't live until someone remembered to deploy it, that the someone had to have the right checkout built, and that a second operator would need the same setup on their own machine.

Two things had to be true before CI could take it over. A deploy had to be one step, with no pause to run a database update by hand: ADR 86 did that. And the repository is public, so letting it act in the AWS accounts had to be narrow enough to be safe in the open.

## Decision

- **A merge into main deploys staging.** `.github/workflows/deploy.yml` runs the quick checks again on the merged code, builds, and deploys.
- **Production waits for a person.** Its job runs in a GitHub environment, `production`, with required reviewers. It sits on the run's page until one of them approves. Staging has deployed the same commit by then.
- **GitHub holds no AWS keys.** Each job gets a short-lived token from GitHub that says which repository and which environment it's running in. Each stage's stack has a role, `<stage>-deploy`, that AWS lets a job take only when the token says exactly this repository and that stage's environment. Both environments only run from main. So a pull request, a fork, and another branch all get nothing.
- **The role can do one thing:** take on the four roles `cdk bootstrap` made for deploying, which is how a person's deploy works too.
- **CI refuses a change that adds permissions or opens a firewall.** `scripts/deploy-from-ci.sh` asks CDK for only the security-widening part of the diff, and stops if there is any. A person deploys those from a terminal, reads the list, and types `y`, as before. The deploy itself still runs with the question on, so if that check ever missed something, the deploy would stop for want of anyone to answer.
- **CI refuses a migration marked `-- stop-the-api:`** (ADR 86), which needs the API stopped first.
- **After deploying, it asks the stage's API whether it's answering,** and fails if it isn't.
- **The stage's address and the stack's outputs are kept out of the log.** Actions logs on a public repository are public.

## Alternatives considered

- **AWS keys stored as GitHub secrets.** Simple, and what most guides show. A stored key works from anywhere, for as long as it exists, for whoever gets hold of it. The token GitHub issues lasts an hour and only exists inside the run.
- **Production deploys on merge too.** One less click. But a merge is a decision about code, and whether participants get it now, partway through someone's study, is a separate decision.
- **CI deploys permission changes as well.** It would mean turning off CDK's question. That question is the one check that a change widening access was read by a person, so it stays on, and those changes stay with a person.
- **Showing production's diff before the approval.** The approver would see exactly what's about to change. Working it out needs AWS access before the approval, which means a second role any run on main could take, with read access to the account. Staging's diff is in the log by then, and the two differ only in what `stages.ts` says. The production job prints its own diff before it deploys.
- **AWS CodePipeline.** It keeps everything inside AWS. It's another system to learn and pay for, and the code, the reviews, and the checks are already in GitHub.

## Consequences

- **Merging is deploying, for staging.** A merged change is on staging in about ten minutes with nobody doing anything.
- **Someone has to press approve for production,** on the run's page. Only the people listed as the environment's reviewers can.
- **Whoever can merge to main can change what the workflow does.** The role trusts the repository's main branch, so the protection is who can merge. Today that's reviewed pull requests.
- **The environments are GitHub settings, not code.** `staging` and `production` each allow only main, and `production` has its reviewers. If someone deleted and re-made `production` without reviewers, production would deploy on merge. `docs/cloud.md` says how to check.
- **A refused deploy leaves main ahead of what's live** until a person deploys it. The run fails with a message that says so.
- **A stop-the-api migration has to be deployed by hand before anything else is merged.** The check looks at the commits in one push. If a later merge arrived first, its run wouldn't see the earlier migration's mark.
- **Deploys by hand still work,** and are how the first deploy of this, which adds the roles, has to go.
- **The log is public.** Diffs appear in it. Nothing secret is in a diff, since secrets are held in Secrets Manager and named, not written out. Account numbers and resource names are visible, as they already are in this repository.
