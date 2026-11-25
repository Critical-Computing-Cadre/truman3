import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

// Videos on posts (ADR 94): from a study's folder, and uploaded in the builder.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const VIDEOS = path.resolve(import.meta.dirname, "../../../../packages/core/src/video-fixtures");
const video = (name: string) => new Uint8Array(readFileSync(path.join(VIDEOS, name)));
const PAINTING = path.resolve(
  import.meta.dirname,
  "../../../../studies/examples/bystander/media/posts/painting.png",
);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  });
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

/** A study folder whose first post is a video, and a lab signed in to the builder. */
async function studyWithVideo(
  posts: string,
  media: Record<string, string>,
  platform = "",
  extra: Record<string, string> = {},
) {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-video-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: video-${id}
title: Video test
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 1 }
  arms: [{ key: a }]
flow: [{ step: feed }]
${platform}
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": posts,
    ...extra,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  mkdirSync(path.join(dir, "media/posts"), { recursive: true });
  for (const [name, from] of Object.entries(media)) {
    copyFileSync(from, path.join(dir, "media/posts", name));
  }
  const imported = await importStudyFolder(database.db, storage, dir, { teamId, launch: true });
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.edu`, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { imported, slug: `video-${id}`, cookie };
}

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function feedOf(slug: string) {
  const entered = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
  });
  const cookie = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return ((await (await call(cookie, "GET", "/feed")).json()) as FeedResponse).posts;
}
const byBody = (posts: FeedPost[], body: string) => posts.find((post) => post.body === body);

const upload = (cookie: string, draftId: string, bytes: Uint8Array) =>
  app.request(`/admin/drafts/${draftId}/videos`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "content-length": String(bytes.length), cookie },
    body: bytes,
  });

describe("a video from a study's folder", () => {
  it("is stored, described, and in the feed with its poster", async () => {
    const { imported, slug } = await studyWithVideo(
      "id,actor,time,body,video,poster\nclip,ann,-0:10,Watch this,clip.mp4,poster.png\n",
      { "clip.mp4": path.join(VIDEOS, "h264.mp4"), "poster.png": PAINTING },
    );
    expect(imported.status).toBe("imported");
    const post = byBody(await feedOf(slug), "Watch this");
    expect(post?.attachments).toEqual([
      {
        type: "video",
        url: expect.stringMatching(/^http:\/\/media\.test\/media\/[0-9a-f]{64}\.mp4$/),
        posterUrl: expect.stringMatching(/^http:\/\/media\.test\/media\/[0-9a-f]{64}\.png$/),
        seconds: expect.closeTo(2, 1),
        width: 180,
        height: 320,
        hasSound: true,
      },
    ]);
    // Served as a video, so every browser plays it.
    const key = new URL(post?.attachments[0]?.url as string).pathname.slice(1);
    expect(await storage.getRange(key, 4, 4)).toEqual(new TextEncoder().encode("ftyp"));
  });

  it("is refused, saying why, if not every browser can play it", async () => {
    const { imported } = await studyWithVideo(
      "id,actor,time,body,video\nclip,ann,-0:10,Watch this,clip.mp4\n",
      { "clip.mp4": path.join(VIDEOS, "hevc.mp4") },
    );
    expect(imported.status).toBe("failed");
    expect(JSON.stringify(imported)).toContain(
      "The video \\\"clip.mp4\\\" can't be used. It's encoded as HEVC (H.265)",
    );
  });

  it("can't be a picture's name, or sit beside pictures", async () => {
    const { imported } = await studyWithVideo(
      "id,actor,time,body,video,picture\nclip,ann,-0:10,Watch,clip.mov,a.png\n",
      { "clip.mov": path.join(VIDEOS, "qt.mov"), "a.png": path.join(VIDEOS, "h264.mp4") },
    );
    const messages =
      imported.status === "failed" ? imported.issues.map(({ message }) => message) : [];
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("has a video and pictures"),
        expect.stringContaining("isn't an MP4"),
      ]),
    );
  });
});

describe("a video uploaded in the builder", () => {
  it("goes on a post, shows in the preview, and stays a video once saved and opened again", async () => {
    const { imported, cookie, slug } = await studyWithVideo(
      "id,actor,time,body\ntext,ann,-0:10,Just words\n",
      {},
    );
    if (imported.status === "failed") throw new Error("import");
    const opened = await call(cookie, "POST", `/admin/versions/${imported.studyVersionId}/draft`);
    const { draftId } = (await opened.json()) as { draftId: string };

    const uploaded = await upload(cookie, draftId, video("silent.mp4"));
    expect(uploaded.status).toBe(200);
    const { video: stored } = (await uploaded.json()) as {
      video: { key: string; seconds: number; width: number; height: number; hasSound: boolean };
    };
    expect(stored).toMatchObject({ width: 160, height: 90, hasSound: false });
    // The same video twice is stored once.
    const again = (await (await upload(cookie, draftId, video("silent.mp4"))).json()) as {
      video: { key: string };
    };
    expect(again.video.key).toBe(stored.key);

    const before = (await (
      await call(cookie, "GET", `/admin/drafts/${draftId}/preview?condition=a&elapsedMs=0`)
    ).json()) as FeedResponse;
    const post = byBody(before.posts, "Just words") as FeedPost;
    const patched = await call(cookie, "PATCH", `/admin/drafts/${draftId}/items/${post.id}`, {
      changes: { video: stored },
    });
    expect(patched.status).toBe(200);
    const after = (await (
      await call(cookie, "GET", `/admin/drafts/${draftId}/preview?condition=a&elapsedMs=0`)
    ).json()) as FeedResponse;
    expect(byBody(after.posts, "Just words")?.attachments).toEqual([
      expect.objectContaining({ type: "video", width: 160, hasSound: false }),
    ]);

    // Saved, launched, and a participant sees it.
    expect((await call(cookie, "POST", `/admin/drafts/${draftId}/freeze`)).status).toBe(200);
    const saved = (await (await call(cookie, "GET", "/admin/studies")).json()) as {
      studies: { slug: string; versions: { id: string; version: number }[] }[];
    };
    const newest = saved.studies.find((study) => study.slug === slug)?.versions[0];
    expect(newest?.version).toBe(2);
    const reopened = (await (
      await call(cookie, "POST", `/admin/versions/${newest?.id}/draft`)
    ).json()) as { draftId: string };
    const shown = (await (
      await call(cookie, "GET", `/admin/drafts/${reopened.draftId}/preview?condition=a&elapsedMs=0`)
    ).json()) as FeedResponse;
    expect(byBody(shown.posts, "Just words")?.attachments[0]).toMatchObject({
      type: "video",
      url: expect.stringContaining(stored.key),
    });
  });

  it("refuses what isn't a playable MP4, or claims a video it didn't upload", async () => {
    const { imported, cookie } = await studyWithVideo(
      "id,actor,time,body\nt,ann,-0:10,Words\n",
      {},
    );
    if (imported.status === "failed") throw new Error("import");
    const { draftId } = (await (
      await call(cookie, "POST", `/admin/versions/${imported.studyVersionId}/draft`)
    ).json()) as { draftId: string };
    for (const [bytes, says] of [
      [video("hevc.mp4"), "HEVC"],
      [video("qt.mov"), "QuickTime"],
      [PNG, "isn't an MP4"],
    ] as const) {
      const response = await upload(cookie, draftId, bytes);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain(says);
    }
    const preview = (await (
      await call(cookie, "GET", `/admin/drafts/${draftId}/preview?condition=a&elapsedMs=0`)
    ).json()) as FeedResponse;
    const post = byBody(preview.posts, "Words") as FeedPost;
    const made = await call(cookie, "PATCH", `/admin/drafts/${draftId}/items/${post.id}`, {
      changes: { video: { key: `media/${"0".repeat(63)}x.mp4` } },
    });
    expect(made.status).toBe(400);
    // Signed out, nothing is stored.
    expect((await upload("", draftId, video("silent.mp4"))).status).toBe(401);
  });
});

describe("pre-roll ads (ADR 97)", () => {
  const platform = `
platform:
  style: mixed
  template: videoPlatform
  prerolls:
    every: 2
    skipAfter: 5
    ads:
      - { id: coffee, video: ad.mp4, advertiser: Hollowbean Coffee, link: "https://example.com/c" }
      - { id: phone, video: ad.mp4, advertiser: Zephyr Talk, label: Sponsored }
`;

  it("are stored, described, and given to each participant for their condition", async () => {
    const { imported, slug } = await studyWithVideo(
      "id,actor,time,title,body,video,preroll\nclip,ann,-0:10,A clip,Watch this,clip.mp4,always\n",
      { "clip.mp4": path.join(VIDEOS, "silent.mp4"), "ad.mp4": path.join(VIDEOS, "h264.mp4") },
      platform,
    );
    expect(imported.status).toBe("imported");
    const entered = await app.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: randomUUID() }),
    });
    const cookie = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const flow = (await (await call(cookie, "GET", "/me/flow")).json()) as {
      prerolls: {
        every: number;
        skipAfter: number;
        ads: { id: string; url: string; seconds: number }[];
      };
    };
    expect(flow.prerolls).toEqual({
      every: 2,
      skipAfter: 5,
      ads: [
        {
          id: "coffee",
          url: expect.stringMatching(/^http:\/\/media\.test\/media\/[0-9a-f]{64}\.mp4$/),
          posterUrl: null,
          advertiser: "Hollowbean Coffee",
          label: "Ad",
          link: "https://example.com/c",
          seconds: expect.closeTo(2, 1),
        },
        expect.objectContaining({ id: "phone", label: "Sponsored", link: null }),
      ],
    });
    // The video says it always has one.
    const posts = ((await (await call(cookie, "GET", "/feed")).json()) as FeedResponse).posts;
    const clip = byBody(posts, "Watch this") as FeedPost;
    expect(clip.preroll).toBe("always");

    // What happened with it is recorded, against the video.
    const reported = await call(cookie, "POST", "/events", {
      events: [
        {
          clientEventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: "preroll.watched",
          targetContentId: clip.id,
          payload: {
            ad: "coffee",
            playedMs: 5200,
            seconds: 2,
            skippedAt: 5.1,
            completed: false,
            visited: true,
            soundOn: true,
          },
        },
      ],
    });
    expect(((await reported.json()) as { recorded: number }).recorded).toBe(1);
  });

  it("refuse an ad whose video isn't a playable MP4", async () => {
    const { imported } = await studyWithVideo(
      "id,actor,time,body\nt,ann,-0:10,Words\n",
      { "ad.mp4": path.join(VIDEOS, "hevc.mp4") },
      platform,
    );
    expect(JSON.stringify(imported)).toContain(
      'The video \\"ad.mp4\\" for the ad \\"coffee\\" can\'t be used',
    );
  });
});

describe("a beat that waits for watching (ADR 100)", () => {
  const beats = `
beats:
  - id: after-three
    when: { participant: watch, post: clip, seconds: 3 }
    do: { action: comment, actor: bob, on: trigger, text: Three seconds in }
  - id: at-the-end
    when: { participant: watch, finished: true }
    do: { action: comment, actor: bob, on: trigger, text: You made it to the end }
`;

  it("happens once the mark is passed, over several spells, and only once", async () => {
    const { imported, slug } = await studyWithVideo(
      "id,actor,time,body,video\nclip,ann,-0:10,Watch this,clip.mp4\nother,ann,-0:20,Another,other.mp4\n",
      { "clip.mp4": path.join(VIDEOS, "h264.mp4"), "other.mp4": path.join(VIDEOS, "silent.mp4") },
      "",
      { "beats.yaml": beats, "actors.csv": "username,name\nann,Ann\nbob,Bob\n" },
    );
    expect(imported.status).toBe("imported");
    const entered = await app.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: randomUUID() }),
    });
    const cookie = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const feed = async () =>
      ((await (await call(cookie, "GET", "/feed")).json()) as FeedResponse).posts;
    const said = async (body: string) =>
      (byBody(await feed(), body)?.comments ?? []).map((comment) => comment.body);
    const clip = byBody(await feed(), "Watch this") as FeedPost;
    const other = byBody(await feed(), "Another") as FeedPost;
    const watch = (contentId: string, playedMs: number, ended = 0) =>
      call(cookie, "POST", "/events", {
        events: [
          {
            clientEventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            type: "video.watched",
            targetContentId: contentId,
            payload: {
              playedMs,
              seconds: 2,
              furthestSeconds: 2,
              ended,
              plays: 1,
              pauses: 0,
              seeks: 0,
              soundOn: false,
              surface: "feed",
            },
          },
        ],
      });

    // Two seconds isn't three, and the other video doesn't count toward this one.
    await watch(clip.id, 2000);
    await watch(other.id, 5000);
    expect(await said("Watch this")).toEqual([]);
    // Another spell takes them past three seconds.
    await watch(clip.id, 1500);
    expect(await said("Watch this")).toEqual(["Three seconds in"]);
    // More watching doesn't say it again. Reaching the end sets off the other beat, on any video.
    await watch(clip.id, 4000, 1);
    expect(await said("Watch this")).toEqual(["Three seconds in", "You made it to the end"]);
  });

  it("is checked when the study is read", async () => {
    const { imported } = await studyWithVideo(
      "id,actor,time,body\nwords,ann,-0:10,Only words\n",
      {},
      "",
      {
        "beats.yaml": `
beats:
  - id: b
    when: { participant: watch, post: words, seconds: 3 }
    do: { action: like, actor: ann, on: trigger }
`,
      },
    );
    expect(JSON.stringify(imported)).toContain("but it has no video");
  });
});

describe("a lab's room for videos (ADR 100)", () => {
  it("counts each video once, and refuses one that wouldn't fit", async () => {
    const { imported, cookie } = await studyWithVideo(
      "id,actor,time,body\nt,ann,-0:10,Words\n",
      {},
    );
    if (imported.status === "failed") throw new Error("import");
    const { draftId } = (await (
      await call(cookie, "POST", `/admin/versions/${imported.studyVersionId}/draft`)
    ).json()) as { draftId: string };
    const [draft] = await database.db
      .select({ studyId: schema.studyDrafts.studyId })
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId));
    const [study] = await database.db
      .select({ teamId: schema.studies.teamId })
      .from(schema.studies)
      .where(eq(schema.studies.id, draft?.studyId as string));
    const teamId = study?.teamId as string;
    const used = async () =>
      (
        await database.db
          .select({ bytes: schema.teamVideos.bytes })
          .from(schema.teamVideos)
          .where(eq(schema.teamVideos.teamId, teamId))
      ).reduce((total, { bytes }) => total + bytes, 0);

    // No limit: it's counted, and the same video again isn't counted twice.
    const silent = video("silent.mp4");
    expect((await upload(cookie, draftId, silent)).status).toBe(200);
    expect((await upload(cookie, draftId, silent)).status).toBe(200);
    expect(await used()).toBe(silent.length);

    // With room for only what's there, another is refused, saying why, and isn't counted.
    await database.db
      .update(schema.teams)
      .set({ limits: { videosGb: (silent.length + 100) / 1024 ** 3 } })
      .where(eq(schema.teams.id, teamId));
    const refused = await upload(cookie, draftId, video("h264.mp4"));
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain(
      "isn't room for this one",
    );
    expect(await used()).toBe(silent.length);
  });
});
