import type {
  FeatureSet,
  FeedResponse,
  Flair,
  LayoutKey,
  Poll,
  StudySettings,
} from "@truman3/core";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as { error?: string }).error ?? "Something went wrong.",
    );
  }
  return body as T;
}

export async function get<T>(path: string): Promise<T> {
  return parse<T>(await fetch(`/api${path}`));
}

export async function send<T>(method: string, path: string, body?: object): Promise<T> {
  return parse<T>(
    await fetch(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

export async function upload<T>(path: string, form: FormData): Promise<T> {
  return parse<T>(await fetch(`/api${path}`, { method: "POST", body: form }));
}

/** Fetches a file, and saves it the way a link to it would. */
export async function download(path: string, body: object): Promise<void> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parse(response);
  }
  const name = response.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1];
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name ?? "download.zip";
  link.click();
  URL.revokeObjectURL(url);
}

export async function post<T>(path: string, body: object = {}): Promise<T> {
  return parse<T>(
    await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export interface Researcher {
  name: string;
  email: string;
  teams: { name: string; role: string }[];
}

export interface StudySummary {
  id: string;
  slug: string;
  team: string;
  participants: number;
  role: string;
  liveVersionId: string | null;
  participantUrl: string;
  openDraftId: string | null;
  draftTitle: string | null;
  versions: {
    id: string;
    version: number;
    title: string;
    frozenAt: string | null;
    participants: number;
    conditions: string[];
  }[];
}

export interface PreviewInfo {
  title: string;
  slug: string;
  version: number;
  siteName: string;
  siteLogoUrl: string | null;
  lengthMs: number;
  conditions: {
    key: string;
    ranker: string;
    windowHours: number | null;
    platformStyle: string;
    commentBox: string;
    layout: LayoutKey;
    features: FeatureSet;
  }[];
  posts: { offsetMs: number; conditions: string[] }[];
  /** The consent page still has the text a new study starts with. */
  placeholderConsent: boolean;
}

export interface PreviewResponse extends FeedResponse {
  /** Which conditions each post or comment is limited to. Absent means all of them. */
  targeting: Record<string, string[]>;
}

export interface DraftInfo {
  title: string;
  slug: string;
  canEdit: boolean;
  closed: boolean;
  lengthMs: number;
  conditions: PreviewInfo["conditions"];
  actors: {
    id: string;
    username: string;
    name: string;
    bio: string;
    location: string;
    pictureUrl: string | null;
    moderator: boolean;
    karma: number;
    followers: number;
    following: number;
    startsFollowed: boolean | string[];
    badge: string;
    suggested: boolean;
    /** The flair they show in each space, by the space's ID. */
    spaceFlair: Record<string, string>;
    /** How many posts, comments, and reactions are theirs. */
    usedBy: number;
  }[];
  spaces: {
    id: string;
    key: string;
    name: string;
    description: string;
    rules: string;
    startsJoined: boolean;
    members: number | null;
    postFlair: Flair[];
    userFlair: Flair[];
    requirePostFlair: boolean;
    pictureUrl: string | null;
    bannerUrl: string | null;
    accent: string | null;
    /** Whether a saved version has it, which means its address can't change. */
    keyLocked: boolean;
    conditions: string[];
    /** How many posts are in it. */
    usedBy: number;
  }[];
  comments: { id: string; offsetMs: number; body: string; authorName: string }[];
  /** A moderator taking down what the study wrote. */
  removals: {
    id: string;
    on: "post" | "comment";
    targetId: string;
    actorId: string;
    timeMs: number;
    reason: string;
    conditions: string[];
  }[];
  /** What a moderator does when someone flags something. No target means any flag. */
  flagAnswers: {
    id: string;
    on: "post" | "comment" | null;
    targetId: string | null;
    action: "remove" | "answer";
    actorId: string;
    afterMs: number;
    message: string;
    conditions: string[];
  }[];
  /** Photos someone in the cast posts as stories. */
  stories: {
    id: string;
    actorId: string;
    pictureUrl: string | null;
    caption: string;
    timeMs: number;
    lastsHours: number | null;
    conditions: string[];
  }[];
  /** A note on a post, as if readers had added context. */
  contextNotes: {
    id: string;
    targetId: string;
    body: string;
    timeMs: number;
    helpful: number;
    notHelpful: number;
    conditions: string[];
  }[];
  /** Words in what a participant writes bringing a moderator's response. */
  autoRules: {
    id: string;
    on: "post" | "comment" | "both";
    match: string;
    action: "confirm" | "remove" | "warn" | "hold";
    actorId: string;
    afterMs: number;
    message: string;
    holdOutcome: "approve" | "remove";
    conditions: string[];
  }[];
  /** What a moderator says to an appeal. */
  appealAnswers: {
    id: string;
    action: "uphold" | "restore";
    actorId: string;
    afterMs: number;
    message: string;
    conditions: string[];
  }[];
  /** A moderator banning someone in the cast. Without a space, it's from everywhere. */
  bans: {
    id: string;
    bannedActorId: string;
    actorId: string;
    timeMs: number;
    reason: string;
    spaceId: string | null;
    conditions: string[];
  }[];
  /** What a moderator does when someone reports a person. Nobody named means any report. */
  reportAnswers: {
    id: string;
    reportedActorId: string | null;
    action: "answer" | "ban";
    actorId: string;
    afterMs: number;
    message: string;
    conditions: string[];
  }[];
  /** A moderator responding to what a participant writes. */
  moderatorReactions: {
    id: string;
    on: "post" | "comment";
    nth: number;
    type: "remove" | "warn";
    actorId: string;
    afterMs: number;
    body: string;
    conditions: string[];
  }[];
  posts: {
    id: string;
    offsetMs: number;
    conditions: string[];
    body: string;
    title: string | null;
    /** Set if it's a crosspost, which can't be crossposted in the builder. */
    crosspostOfId: string | null;
    repostOfId: string | null;
    quoteOfId: string | null;
    authorName: string;
    imageUrl: string | null;
  }[];
  issues: { severity: "error" | "warning"; message: string }[];
}

export interface DraftItemDetails {
  actorId: string;
  timeMs: number;
  conditions: string[];
  likes: number;
  ups: number;
  downs: number;
  pictures: string[];
  spaceId: string | null;
  link: string | null;
  pinnedOn: string[];
  locked: boolean;
  tags: string[];
  poll: Poll | null;
  flair: string | null;
  crosspostOfId: string | null;
  repostOfId: string | null;
  quoteOfId: string | null;
  reposts: number;
  quotes: number;
  ad: string | null;
  views: number;
  likedById: string | null;
  origin: string;
}

export interface DraftPreviewResponse extends PreviewResponse {
  items: Record<string, DraftItemDetails>;
}

export interface Presence {
  latestChange: number;
  others: { name: string; itemId: string | null; section: string | null }[];
}

export interface DraftChange {
  changeId: string;
  who: string;
  mine: boolean;
  action: string;
  summary: string;
  at: string;
  canUndo: boolean;
}

/** The parts of a study's settings that are edited together. */
export interface DraftSections {
  study: Pick<StudySettings, "title" | "site" | "platform">;
  conditions: Pick<StudySettings, "conditions">;
  feed: Pick<StudySettings, "feed" | "likes" | "length">;
  flow: Pick<StudySettings, "flow" | "entry">;
}

export interface DraftSettings {
  title: string;
  slug: string;
  canEdit: boolean;
  sections: { [K in keyof DraftSections]: { revision: number; value: DraftSections[K] } };
  pages: Record<string, { revision: number; text: string }>;
  issues: { severity: "error" | "warning"; message: string }[];
}

export interface ContentPack {
  id: string;
  name: string;
  description: string;
  /** Empty means it's for everyone on this server. */
  team: string | null;
  actors: number;
  posts: number;
  comments: number;
  conditions: string[];
  targeted: number;
  imageUrls: string[];
}
