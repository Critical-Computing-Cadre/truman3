import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// scripts/deploy-from-ci.sh is what GitHub Actions runs to deploy (ADR 88). Here it runs in a
// made-up repository, with stand-ins for `pnpm` and `curl` that record what they were asked, so
// what it refuses and what it lets through can be checked without AWS.

const SCRIPT = path.resolve(import.meta.dirname, "../../scripts/deploy-from-ci.sh");
const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

const PNPM = `#!/bin/sh
echo "$*" >> "$CALLS"
case "$*" in
  *--security-only*)
    echo "IAM Statement Changes"
    exit "\${ADDS_PERMISSIONS:-0}"
    ;;
  *" deploy "*)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--outputs-file" ]; then
        echo '{"truman3-staging":{"Address":"https://d111abc.cloudfront.net"}}' > "$2"
      fi
      shift
    done
    echo "truman3-staging.Address = https://d111abc.cloudfront.net"
    echo "truman3-staging.AdminCommand = aws ecs run-task --subnets subnet-0123"
    echo "Deployed."
    exit "\${DEPLOY_FAILS:-0}"
    ;;
  *" diff "*)
    echo "[~] AWS::ECS::Service Api, behind d111abc.cloudfront.net"
    ;;
esac
`;
const CURL = `#!/bin/sh
echo "curl $*" >> "$CALLS"
exit "\${API_DOWN:-0}"
`;

/** A repository with two commits, the second adding a migration with this in it. */
function repository(migration: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-deploy-"));
  folders.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", ...args], {
      cwd: dir,
    })
      .toString()
      .trim();
  git("init", "--quiet");
  writeFileSync(path.join(dir, "README"), "A study platform.\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "start");
  const before = git("rev-parse", "HEAD");
  mkdirSync(path.join(dir, "packages/db/migrations"), { recursive: true });
  writeFileSync(path.join(dir, "packages/db/migrations/0064_more.sql"), migration);
  git("add", ".");
  git("commit", "--quiet", "-m", "a migration");
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  for (const [name, text] of [
    ["pnpm", PNPM],
    ["curl", CURL],
    // Waiting between tries isn't what's being tested.
    ["sleep", "#!/bin/sh\nexit 0\n"],
  ] as const) {
    writeFileSync(path.join(bin, name), text);
    chmodSync(path.join(bin, name), 0o755);
  }
  return { dir, bin, before, after: git("rev-parse", "HEAD") };
}

function deploy(migration: string, env: Record<string, string> = {}) {
  const { dir, bin, before, after } = repository(migration);
  const calls = path.join(dir, "calls.txt");
  writeFileSync(calls, "");
  const run = spawnSync("bash", [SCRIPT, "staging", before, after], {
    cwd: dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls, ...env },
  });
  return {
    code: run.status,
    said: `${run.stdout}${run.stderr}`,
    asked: readFileSync(calls, "utf8").trim().split("\n"),
  };
}

const ADDS_A_TABLE = `CREATE TABLE "more" ("id" uuid PRIMARY KEY);\n`;

describe("deploying from GitHub Actions (ADR 88)", () => {
  it("deploys a change that adds no permissions, and checks the API answers", () => {
    const { code, said, asked } = deploy(ADDS_A_TABLE);
    expect(said).toContain("The API on staging answers.");
    expect(code).toBe(0);
    const deployed = asked.filter((line) => line.includes(" deploy "));
    expect(deployed).toHaveLength(1);
    expect(deployed[0]).toContain("-c stage=staging");
    expect(asked.at(-1)).toContain("https://d111abc.cloudfront.net/api/health");
  });

  it("never turns off the question about new permissions", () => {
    const { asked } = deploy(ADDS_A_TABLE);
    const deployed = asked.find((line) => line.includes(" deploy "));
    expect(deployed).toContain("--require-approval broadening");
    expect(asked.join("\n")).not.toContain("never");
  });

  it("refuses a change that adds permissions, before deploying anything", () => {
    const { code, said, asked } = deploy(ADDS_A_TABLE, { ADDS_PERMISSIONS: "1" });
    expect(code).toBe(1);
    expect(said).toContain("::error title=A person has to deploy this::");
    expect(said).toContain("adds permissions or opens a firewall");
    // What it would have added is shown, so whoever deploys it by hand knows what to expect.
    expect(said).toContain("IAM Statement Changes");
    expect(asked.some((line) => line.includes(" deploy "))).toBe(false);
  });

  it("refuses a migration that needs the API stopped, before asking AWS anything", () => {
    const { code, said, asked } = deploy(
      `-- stop-the-api: renames a column the API reads\nALTER TABLE "teams" RENAME COLUMN "name" TO "title";\n`,
    );
    expect(code).toBe(1);
    expect(said).toContain("packages/db/migrations/0064_more.sql is marked stop-the-api");
    expect(asked).toEqual([""]);
  });

  it("keeps the stage's address and its outputs out of the log, which is public", () => {
    const { said } = deploy(ADDS_A_TABLE);
    expect(said).toContain("Deployed.");
    expect(said).toContain("behind (address)");
    expect(said).not.toContain("d111abc");
    expect(said).not.toContain("subnet-0123");
    expect(said).not.toContain("AdminCommand");
  });

  it("fails when the deploy fails, though its output goes through a filter", () => {
    const { code, said, asked } = deploy(ADDS_A_TABLE, { DEPLOY_FAILS: "1" });
    expect(code).toBe(1);
    expect(said).not.toContain("The API on staging answers.");
    expect(asked.some((line) => line.startsWith("curl"))).toBe(false);
  });

  it("fails when the API doesn't answer afterwards", () => {
    const { code, said } = deploy(ADDS_A_TABLE, { API_DOWN: "22" });
    expect(code).toBe(1);
    expect(said).toContain("::error title=The API isn't answering::");
    expect(said).not.toContain("d111abc");
  });
});
