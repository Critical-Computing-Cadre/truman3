import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface Ecs {
  runTask: (input: unknown) => Promise<unknown>;
  describeTasks: (input: unknown) => Promise<unknown>;
}
const { update } = createRequire(import.meta.url)("./run-database-update.cjs") as {
  update: (
    event: unknown,
    ecs: Ecs,
    options?: { wait?: (ms: number) => Promise<void>; clock?: () => number },
  ) => Promise<unknown>;
};

const event = {
  RequestType: "Update",
  ResourceProperties: {
    cluster: "truman3-staging",
    taskDefinition: "arn:task-definition/update:7",
    subnets: ["subnet-a", "subnet-b"],
    securityGroups: ["sg-1"],
    logGroup: "/truman3-staging/tasks",
  },
};
const noWait = { wait: async () => {} };
const started = { tasks: [{ taskArn: "arn:task/1" }] };
const stopped = (exitCode: number | undefined, stoppedReason?: string) => ({
  tasks: [{ lastStatus: "STOPPED", stoppedReason, containers: [{ exitCode }] }],
});

/** A stand-in for ECS that answers each "how's it going?" with the next thing in the list. */
function ecsThat(answers: unknown[], start: unknown = started) {
  const asked: unknown[] = [];
  const ecs: Ecs = {
    runTask: async (input) => {
      asked.push(input);
      return start;
    },
    describeTasks: async () => answers.shift() ?? { tasks: [{ lastStatus: "RUNNING" }] },
  };
  return { ecs, asked };
}

describe("running the database update during a deploy (ADR 86)", () => {
  it("starts the update's task in the API's network, and finishes when it does", async () => {
    const { ecs, asked } = ecsThat([
      { tasks: [{ lastStatus: "PENDING" }] },
      { tasks: [{ lastStatus: "RUNNING" }] },
      stopped(0),
    ]);
    await expect(update(event, ecs, noWait)).resolves.toEqual({
      PhysicalResourceId: "database-update",
    });
    expect(asked).toEqual([
      {
        cluster: "truman3-staging",
        taskDefinition: "arn:task-definition/update:7",
        launchType: "FARGATE",
        startedBy: "deploy",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: ["subnet-a", "subnet-b"],
            securityGroups: ["sg-1"],
            assignPublicIp: "ENABLED",
          },
        },
      },
    ]);
  });

  it("fails the deploy when the update fails, and says where its log is", async () => {
    const { ecs } = ecsThat([stopped(1, "Essential container in task exited")]);
    await expect(update(event, ecs, noWait)).rejects.toThrow(
      "The database update failed (exit code 1: Essential container in task exited). Its log is in /truman3-staging/tasks.",
    );
  });

  it("fails when the task stopped without ever running, as when its image can't be fetched", async () => {
    const { ecs } = ecsThat([stopped(undefined, "CannotPullContainerError")]);
    await expect(update(event, ecs, noWait)).rejects.toThrow(
      "exit code none: CannotPullContainerError",
    );
  });

  it("fails when the task couldn't be started at all", async () => {
    const { ecs } = ecsThat([], { tasks: [], failures: [{ reason: "RESOURCE:MEMORY" }] });
    await expect(update(event, ecs, noWait)).rejects.toThrow(
      'The database update couldn\'t start: [{"reason":"RESOURCE:MEMORY"}]',
    );
  });

  it("gives up after 13 minutes, naming the task still running", async () => {
    const { ecs } = ecsThat([]);
    let time = 0;
    const clock = () => {
      time += 60_000;
      return time;
    };
    await expect(update(event, ecs, { ...noWait, clock })).rejects.toThrow(
      "still running after 13 minutes. It's task arn:task/1",
    );
  });

  it("does nothing when the stack is being deleted", async () => {
    const { ecs, asked } = ecsThat([]);
    await expect(update({ ...event, RequestType: "Delete" }, ecs, noWait)).resolves.toEqual({});
    expect(asked).toEqual([]);
  });
});
