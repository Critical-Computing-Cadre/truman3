/**
 * A load test of a shared world (ADR 68): many made-up participants use a running Truman at once,
 * through its public address, as browsers would. They join one world, listen for live updates, and
 * look at the feed, post, comment, and like for a while. It reports how long pages took, and how
 * long it took for what one person posted to reach the others: first as the "New posts" button,
 * then on their screen once they pressed it, a few seconds later, as a person would (ADR 69).
 *
 *   pnpm load-test <address> <slug> [participants] [minutes]
 *
 * The study should be one made for this, like studies/load-test, launched, with a shared world as
 * big as the number of participants. Everyone this makes has an ID starting with "load-", so they can
 * be told apart and withdrawn afterwards. Never point it at a study with real participants.
 */

const [address, slug, participantsArg = "50", minutesArg = "30"] = process.argv.slice(2);
if (!address || !slug) {
  console.error("Usage: pnpm load-test <address> <slug> [participants] [minutes]");
  process.exit(1);
}
const PARTICIPANTS = Number(participantsArg);
const MINUTES = Number(minutesArg);
const API = `${address.replace(/\/$/, "")}/api`;
const RUN = Date.now().toString(36);
/** The targets set in the shared worlds design note. */
const PAGE_TARGET_MS = 1_000;
const SEEN_TARGET_MS = 5_000;

/** How long each kind of request took, in milliseconds. */
const timings = new Map<string, number[]>();
const failures = new Map<string, number>();
/** When each participant's post was made, and by whom, so others can tell how long it took. */
const posted = new Map<string, { at: number; by: number }>();
/** How long a post took to reach another participant as the "New posts" button, once each. */
const told: number[] = [];
/** How long a post took to appear on another participant's screen, once each. */
const seen: number[] = [];
/** How long someone takes to notice the "New posts" button and press it. */
const PRESS_AFTER_MS = [1_000, 6_000] as const;
let liveEvents = 0;
let liveDrops = 0;

const meta = () => ({ clientEventId: crypto.randomUUID(), occurredAt: new Date().toISOString() });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)] as T;

function record(kind: string, ms: number, ok: boolean) {
  const list = timings.get(kind) ?? [];
  list.push(ms);
  timings.set(kind, list);
  if (!ok) {
    failures.set(kind, (failures.get(kind) ?? 0) + 1);
  }
}

interface FeedPost {
  id: string;
  author: { isViewer: boolean };
  comments: unknown[];
}

class Participant {
  cookie = "";
  /** Posts already on this person's screen, so each new one's time is counted once. */
  onScreen = new Set<string>();
  /** Posts they've been told about. */
  heard = new Set<string>();
  /** Whether the "New posts" button is showing, waiting to be pressed. */
  buttonShowing = false;
  stopped = false;

  readonly n: number;

  constructor(n: number) {
    this.n = n;
  }

  async call(kind: string, method: string, path: string, body?: object | FormData) {
    const started = performance.now();
    let response: Response | null = null;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          cookie: this.cookie,
          ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      });
      const cookie = response.headers.get("set-cookie");
      if (cookie) {
        this.cookie = cookie.split(";")[0] ?? "";
      }
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      record(kind, performance.now() - started, response.ok);
      return { ok: response.ok, json };
    } catch {
      record(kind, performance.now() - started, false);
      return { ok: false, json: {} as Record<string, unknown> };
    }
  }

  async enter() {
    const entered = await this.call("enter", "POST", `/studies/${slug}/enter`, {
      externalId: `load-${RUN}-${this.n}`,
    });
    return entered.ok;
  }

  /**
   * Goes through the steps before the feed as a browser would: agreeing to consent, reading pages,
   * and making a profile. Then waits in the waiting room until the world starts.
   */
  async waitForStart() {
    for (;;) {
      const flow = await this.call("flow", "GET", "/me/flow");
      const { step, position, waiting } = flow.json as {
        step?: string;
        position?: number;
        waiting?: unknown;
      };
      if (step === "account") {
        const form = new FormData();
        for (const [key, value] of Object.entries(meta())) {
          form.set(key, value);
        }
        form.set("username", `load-${RUN}-${this.n}`);
        form.set("name", `Load ${this.n}`);
        await this.call("profile", "POST", "/me/profile", form);
      }
      if (step === "consent" || step === "page" || step === "account") {
        await this.call("advance", "POST", "/me/flow/advance", { ...meta(), position });
        continue;
      }
      if (flow.ok && step === "feed" && !waiting) {
        return;
      }
      if (!flow.ok || (step !== "feed" && step !== undefined)) {
        throw new Error(`Participant ${this.n} is on "${step}", and can't reach the feed.`);
      }
      await sleep(3_000);
    }
  }

  /** Fetches the feed, and counts how long new posts by others took to get here. */
  async look(kind = "feed") {
    const feed = await this.call(kind, "GET", "/feed");
    const posts = ((feed.json.posts ?? []) as FeedPost[]).filter(({ author }) => !author.isViewer);
    const now = Date.now();
    for (const { id } of posts) {
      if (!this.onScreen.has(id)) {
        this.onScreen.add(id);
        const at = posted.get(id)?.at;
        if (at !== undefined) {
          seen.push(now - at);
        }
      }
    }
    return posts;
  }

  /** Shows the "New posts" button, and presses it a few seconds later, as a person would. */
  showButton() {
    const now = Date.now();
    for (const [id, { at, by }] of posted) {
      if (by !== this.n && !this.heard.has(id)) {
        this.heard.add(id);
        told.push(now - at);
      }
    }
    if (this.buttonShowing) {
      return;
    }
    this.buttonShowing = true;
    const [least, most] = PRESS_AFTER_MS;
    void sleep(least + Math.random() * (most - least)).then(async () => {
      this.buttonShowing = false;
      if (!this.stopped) {
        await this.look("feed (new posts)");
      }
    });
  }

  /** Listens for live updates, and shows the "New posts" button when there's a new post. */
  async listen() {
    while (!this.stopped) {
      try {
        const response = await fetch(`${API}/live`, { headers: { cookie: this.cookie } });
        if (!response.body || response.status !== 200) {
          liveDrops++;
          await sleep(5_000);
          continue;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!this.stopped) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let end = buffer.indexOf("\n\n");
          while (end >= 0) {
            const message = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            end = buffer.indexOf("\n\n");
            if (message.startsWith("event: feed")) {
              liveEvents++;
              if (message.includes('"posts":true')) {
                this.showButton();
              }
            } else if (message.startsWith("event:")) {
              liveEvents++;
            }
          }
        }
        await reader.cancel().catch(() => {});
        if (!this.stopped) {
          liveDrops++;
        }
      } catch {
        if (!this.stopped) {
          liveDrops++;
          await sleep(2_000);
        }
      }
    }
  }

  /** Visits every 10 to 40 seconds until time is up, doing something now and then. */
  async use(until: number) {
    while (Date.now() < until) {
      await this.call("me", "GET", "/me");
      const posts = await this.look();
      const roll = Math.random();
      if (roll < 0.08) {
        const form = new FormData();
        for (const [key, value] of Object.entries({
          ...meta(),
          body: `Load test post ${this.n} at ${new Date().toISOString()}`,
        })) {
          form.set(key, value);
        }
        const made = await this.call("post", "POST", "/posts", form);
        if (made.ok && typeof made.json.id === "string") {
          posted.set(made.json.id, { at: Date.now(), by: this.n });
        }
      } else if (roll < 0.2 && posts.length > 0) {
        await this.call("comment", "POST", `/content/${pick(posts).id}/comments`, {
          ...meta(),
          body: "Load test comment",
        });
      } else if (roll < 0.45 && posts.length > 0) {
        await this.call("like", "POST", `/content/${pick(posts).id}/like`, {
          ...meta(),
          active: true,
        });
      }
      await sleep(10_000 + Math.random() * 30_000);
    }
  }
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function report() {
  const ms = (value: number) => `${Math.round(value)} ms`;
  console.log(`\nRequests (target: under ${PAGE_TARGET_MS} ms):`);
  for (const [kind, list] of [...timings].sort()) {
    const slow = list.filter((value) => value > PAGE_TARGET_MS).length;
    console.log(
      `  ${kind.padEnd(17)} ${String(list.length).padStart(6)}  median ${ms(percentile(list, 50))}, 95% ${ms(percentile(list, 95))}, 99% ${ms(percentile(list, 99))}, slowest ${ms(Math.max(...list))}, over target ${slow}, failed ${failures.get(kind) ?? 0}`,
    );
  }
  const summary = (list: number[]) => {
    const within = list.filter((value) => value <= SEEN_TARGET_MS).length;
    return list.length === 0
      ? "None."
      : `${list.length} times: median ${ms(percentile(list, 50))}, 95% ${ms(percentile(list, 95))}, slowest ${ms(Math.max(...list))}, within ${SEEN_TARGET_MS / 1000} s ${((within / list.length) * 100).toFixed(1)}%`;
  };
  console.log(`\nNew posts reaching others (target: within ${SEEN_TARGET_MS / 1000} s):`);
  console.log(`  As the "New posts" button: ${summary(told)}`);
  console.log(
    `  On screen, after pressing it ${PRESS_AFTER_MS[0] / 1000}–${PRESS_AFTER_MS[1] / 1000} s later: ${summary(seen)}`,
  );
  console.log(
    `\nLive updates: ${liveEvents} received, ${liveDrops} connections dropped and reopened.`,
  );
}

async function main() {
  console.log(
    `${PARTICIPANTS} participants in "${slug}" at ${address}, for ${MINUTES} minutes. Their IDs start with load-${RUN}-.`,
  );
  const people = Array.from({ length: PARTICIPANTS }, (_, n) => new Participant(n));
  // They arrive over a minute, as people from a recruitment site would.
  await Promise.all(
    people.map(async (person) => {
      await sleep(Math.random() * 60_000);
      if (!(await person.enter())) {
        person.stopped = true;
      }
    }),
  );
  const inside = people.filter(({ stopped }) => !stopped);
  console.log(`${inside.length} entered. Waiting for their world to start...`);
  await Promise.all(inside.map((person) => person.waitForStart()));
  console.log("It started.");
  const until = Date.now() + MINUTES * 60_000;
  const listening = inside.map((person) => person.listen());
  const progress = setInterval(() => {
    const left = Math.max(0, Math.round((until - Date.now()) / 60_000));
    console.log(`${left} minutes left. ${posted.size} posts, told ${told.length} times so far.`);
  }, 60_000);
  await Promise.all(inside.map((person) => person.use(until)));
  clearInterval(progress);
  for (const person of inside) {
    person.stopped = true;
  }
  // Each listener stops at its next live update or reminder, at most 15 seconds.
  await Promise.race([Promise.all(listening), sleep(20_000)]);
  report();
  console.log(`\nTo remove them afterwards, withdraw each load-${RUN}- ID, or archive the study.`);
  process.exit(0);
}

await main();
