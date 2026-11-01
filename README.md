# Truman 3

The next generation of the Truman social media simulation platform. Work in progress: not yet ready for running studies.

## Getting started

You'll need Node 24 and something that runs Docker containers, such as Docker Desktop or OrbStack.

```
corepack enable
pnpm install
cp .env.example .env
docker compose up --detach --wait
pnpm dev
```

If `corepack enable` fails with a permission error (`EACCES`), your Node install keeps its commands in a folder you can't write to. Install `pnpm` in your home folder instead, and check that `~/.local/bin` is on your `PATH`:

```
mkdir -p ~/.local/bin
corepack enable pnpm --install-directory ~/.local/bin
```

- Participant app: http://localhost:5180
- Admin app: http://localhost:5181
- API: http://localhost:3000/health/ready

See [docs/architecture.md](docs/architecture.md) for how it fits together and [docs/adr](docs/adr) for why.

## Acknowledgments

Truman was created by Dominic DiFranzo and developed with the [Cornell Social Media Lab](https://socialmedialab.cornell.edu/), with support from NSF IIS-1405634. Truman 3 is a new codebase that builds on that work and on ideas from [Truman Agents](https://github.com/Cornell-Design-AI-Group/TrumanAgents) by Qian Yang and the Cornell DesignAI Group.

## License

[MIT](LICENSE)
