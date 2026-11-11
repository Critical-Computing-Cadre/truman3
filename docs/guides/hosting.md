# Running a hosted Truman

A hosted Truman lets other labs run studies on your server, instead of deploying their own. This guide is for whoever runs it, the **operator**. Why it works this way is in [ADR 70](../adr/0070-hosted-truman-applying-and-approving.md).

A hosted Truman is still being built. This guide covers what's there now: labs applying, approving them, and their limits. Each lab's own Claude key, email, and the production stage come next.

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
4. **You approve it.** It gets the starting limits: 1,000 new participants in any 30 days, and 10 studies open at once.

Nobody's told by email yet. That's coming. For now, write to the applicant yourself.

## What you can see

The Labs page shows, for each lab:
- its application
- its owners
- how many members, studies, open studies, and participants it has

It never shows what's in a study or anything a participant did. That's on purpose: you host labs' data, you don't read it.

## Limits

Each lab has two limits, and you can change either on the Labs page:
- **New participants a month:** people entering any of its studies in the last 30 days. Once it's reached, a study takes nobody new until the oldest of those are more than 30 days ago. People already in a study can always come back. Test participants don't count.
- **Studies open at once:** launching another is refused until one is stopped.

Leave a box blank for no limit. Teams made with `pnpm admin setup` have no limits.

## Suspending a lab

**Suspend** stops a lab's studies at once:
- its participants can't continue
- nobody new can enter
- it can't launch anything

Its researchers can still sign in and export their data. **Reinstate** brings everything back. Use it for abuse or a security problem. Get in touch with the lab first if you can.
