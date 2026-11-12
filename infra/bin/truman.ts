// What `cdk synth` and `cdk deploy` run. It asks AWS nothing. See docs/guides/deploying.md.
import { existsSync } from "node:fs";
import path from "node:path";
import { App } from "aws-cdk-lib";
import { STAGES } from "../lib/stages.ts";
import { TrumanStack } from "../lib/truman-stack.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const app = new App();

const stageName = (app.node.tryGetContext("stage") as string | undefined) ?? "staging";
const stage = STAGES[stageName];
if (!stage) {
  throw new Error(`There's no stage called "${stageName}". See infra/lib/stages.ts.`);
}

const participantDist = path.join(ROOT, "apps/participant/dist");
const adminDist = path.join(ROOT, "apps/admin/dist");
const siteDist = path.join(ROOT, "apps/site/.vitepress/dist");
for (const dist of [participantDist, adminDist, ...(stage.site ? [siteDist] : [])]) {
  if (!existsSync(path.join(dist, "index.html"))) {
    throw new Error(`${dist} isn't built. Run pnpm build first.`);
  }
}

// `-c apiTasks=0` stops the API, for saving money or before a database update.
const apiTasks = app.node.tryGetContext("apiTasks") as string | undefined;

new TrumanStack(app, `truman3-${stage.name}`, {
  env: { account: stage.account, region: stage.region },
  stage: { ...stage, ...(apiTasks === undefined ? {} : { apiTasks: Number(apiTasks) }) },
  imageDirectory: ROOT,
  participantDist,
  adminDist,
  ...(stage.site ? { siteDist } : {}),
});
