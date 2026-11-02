import type { FeedResponse, StudySettings } from "@truman3/core";

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
  openDraftId: string | null;
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
  }[];
  posts: { offsetMs: number; conditions: string[] }[];
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
  actors: { id: string; username: string; name: string }[];
  posts: {
    id: string;
    offsetMs: number;
    conditions: string[];
    body: string;
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
