import type { FeatureSet, LayoutKey } from "@truman3/core";
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every action carries these, so retries count once and timing can be analyzed. */
export function actionMeta() {
  return { clientEventId: crypto.randomUUID(), occurredAt: new Date().toISOString() };
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

export async function post<T>(path: string, body: object = {}): Promise<T> {
  return parse<T>(
    await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...actionMeta(), ...body }),
    }),
  );
}

/** For anything that includes a file. */
export async function postForm<T>(path: string, fields: Record<string, string | File>): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...actionMeta(), ...fields })) {
    form.append(key, value);
  }
  return parse<T>(await fetch(`/api${path}`, { method: "POST", body: form }));
}

export interface FlowState {
  step: "consent" | "account" | "page" | "feed" | "exit" | "done";
  position: number;
  pageText: string | null;
  canFinish: boolean;
  platformStyle: "photo" | "text" | "mixed";
  commentBox: "open" | "onReply";
  layout: LayoutKey;
  features: FeatureSet;
  site: { name: string; logoUrl: string | null; faviconUrl: string | null };
}

export interface Me {
  username: string;
  name: string;
  bio: string;
  location: string;
  pictureUrl: string | null;
  siteName: string;
  unreadNotifications: number;
}

/** How much of the study's platform choices the feed needs, shared like the viewer's details. */
export const flowQuery = { queryKey: ["flow"], queryFn: () => get<FlowState>("/me/flow") };

/** Shared, so everything showing the viewer's details uses one copy and one request. */
export const meQuery = { queryKey: ["me"], queryFn: () => get<Me>("/me") };

export interface EntryInfo {
  siteName: string;
  logoUrl: string | null;
  idLabel: string;
  idParam: string;
}

export interface NotificationItem {
  key: string;
  type: "read" | "like" | "reply";
  actors: { username: string; name: string; pictureUrl: string | null }[];
  targetKind: "post" | "comment";
  targetBody: string;
  targetImageUrl: string | null;
  replyBody: string | null;
  at: string;
  unread: boolean;
}
