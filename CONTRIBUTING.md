# Contributing to Truman 3

Thanks for thinking about it. Truman is built to be followed and extended by people who weren't there when it was written, including students who join a lab later. This page is the short version. The longer one, with the code rules and how to add a feature, is the [contributing guide](https://truman-research.org/developers/contributing) on the site.

## Ways to help

- **Tell us what happened when you used it.** A study that didn't fit, a page that confused you, or a number that looked wrong is useful. Open an [issue](https://github.com/Critical-Computing-Cadre/truman3/issues).
- **Report a security problem privately,** as [SECURITY.md](SECURITY.md) says, and not in an issue.
- **Fix or add something.** For anything larger than a small fix, open an issue first, so we can agree on the shape before you write it.

## How a change gets in

1. **Set up** with the steps in the [README](README.md#getting-started).
2. **Make a branch** and keep the change small. One pull request does one thing.
3. **Add tests** for new behavior. Run the real thing as well when a test can't cover it.
4. **Record the decision.** A choice someone might later question gets a short record in [`docs/adr`](docs/adr), with the alternatives you considered.
5. **Run the checks** before you open the pull request:

   ```
   pnpm check
   pnpm typecheck
   pnpm test
   pnpm test:integration   # needs: docker compose up --detach --wait
   pnpm test:e2e           # needs the same
   ```

6. **Open a pull request** with a plain-language summary: what changed, why, and how it was tested, including anything that wasn't.
7. **CI has to pass.** It runs the checks above on every pull request, and builds the API's container.
8. **A maintainer reviews and merges it.** A merge deploys to staging. Production waits for a person's approval.

[docs/development.md](docs/development.md) describes the tests, CI, and releases in full.

## Sign your work

From the first release on, commits need a sign-off, which says you wrote the change or have the right to submit it under the project's license. It's the [Developer Certificate of Origin](https://developercertificate.org/), and you add it with:

```
git commit -s
```

That puts a `Signed-off-by` line with your name and email at the end of the commit message. There's no separate agreement to sign. Commits from before the first release don't have it.

## Using AI tools

Much of Truman 3 was written with an AI coding assistant, under the maintainer's review, and commits say so in a `Co-Authored-By` line. You're welcome to work the same way. You're responsible for what you submit: read it, test it, and say in the pull request how it was tested.

## Credit, and code from elsewhere

- Truman 3 is MIT-licensed, and contributions are accepted under the same license.
- If you bring in code from an older Truman repository, or from anywhere else, keep its copyright notices and say where it came from in the pull request.
- Keep the credit to [Truman Agents](https://github.com/Cornell-Design-AI-Group/TrumanAgents), by Qian Yang and the Cornell Design & AI Group, where its ideas are used.

## How we treat each other

See the [code of conduct](CODE_OF_CONDUCT.md).
