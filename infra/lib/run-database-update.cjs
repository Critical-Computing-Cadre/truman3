// Runs inside AWS Lambda, during a deploy: starts the database update's task and waits for it to
// finish, so the deploy only goes on to start the new API once the tables are ready for it. If the
// update fails, this fails, and the deploy puts everything back. See ADR 86.
//
// It's a .cjs file handed to Lambda as it is, so it uses only what Lambda's Node already has.

const WAIT_MS = 5000;
// Lambda stops this at 15 minutes. Giving up before then leaves time to say why.
const GIVE_UP_AFTER_MS = 13 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The work itself, apart from AWS's own library so a test can run it. `ecs` has `runTask` and
 * `describeTasks`, each taking what the AWS command of that name takes.
 */
exports.update = async (event, ecs, { wait = sleep, clock = Date.now } = {}) => {
  // Nothing to undo when the stack is deleted.
  if (event.RequestType === "Delete") {
    return {};
  }
  const { cluster, taskDefinition, subnets, securityGroups, logGroup } = event.ResourceProperties;
  const started = await ecs.runTask({
    cluster,
    taskDefinition,
    launchType: "FARGATE",
    startedBy: "deploy",
    networkConfiguration: {
      awsvpcConfiguration: { subnets, securityGroups, assignPublicIp: "ENABLED" },
    },
  });
  const task = started.tasks?.[0]?.taskArn;
  if (!task) {
    throw new Error(
      `The database update couldn't start: ${JSON.stringify(started.failures ?? [])}`,
    );
  }

  const until = clock() + GIVE_UP_AFTER_MS;
  while (clock() < until) {
    await wait(WAIT_MS);
    const found = await ecs.describeTasks({ cluster, tasks: [task] });
    const now = found.tasks?.[0];
    if (now?.lastStatus !== "STOPPED") {
      continue;
    }
    const code = now.containers?.[0]?.exitCode;
    if (code === 0) {
      return { PhysicalResourceId: "database-update" };
    }
    throw new Error(
      `The database update failed (exit code ${code ?? "none"}: ${now.stoppedReason ?? "no reason given"}). Its log is in ${logGroup}.`,
    );
  }
  throw new Error(
    `The database update was still running after 13 minutes. It's task ${task}, and its log is in ${logGroup}.`,
  );
};

exports.handler = (event) => {
  const { ECSClient, RunTaskCommand, DescribeTasksCommand } = require("@aws-sdk/client-ecs");
  const client = new ECSClient({});
  return exports.update(event, {
    runTask: (input) => client.send(new RunTaskCommand(input)),
    describeTasks: (input) => client.send(new DescribeTasksCommand(input)),
  });
};
