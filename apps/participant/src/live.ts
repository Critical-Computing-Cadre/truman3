import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Live updates in a shared world (ADR 68). The API says when something new is there, and the page
 * fetches it as usual. A post or comment page, a profile, or a community refreshes at once. The
 * home and following feeds don't, so they don't move under someone's thumb: they show a "New
 * posts" button instead, as real sites do. A moderator's removal is the exception, and refreshes
 * them too.
 */

let newPosts = false;
const watchers = new Set<() => void>();
function setNewPosts(value: boolean) {
  if (newPosts !== value) {
    newPosts = value;
    for (const watcher of watchers) {
      watcher();
    }
  }
}

/** Whether there are new posts the home feed isn't showing, and a way to say it's caught up. */
export function useNewPosts() {
  const value = useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    () => newPosts,
  );
  return [value, caughtUp] as const;
}

/** The home feed has been fetched again, so it has what's new. */
function caughtUp() {
  setNewPosts(false);
}

/** The home and following feeds, which wait to be asked. */
const WAITS = new Set(["home", "following"]);

function refresh(client: QueryClient, kind: string, data: string) {
  if (kind === "feed") {
    const { posts, removed } = JSON.parse(data) as { posts: boolean; removed?: true };
    // What a moderator took down leaves every page at once, the home feed too.
    client.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "feed" && (removed || !WAITS.has(String(queryKey[1]))),
    });
    if (posts) {
      setNewPosts(true);
    }
  } else {
    client.invalidateQueries({ queryKey: ["me"] });
    client.invalidateQueries({ queryKey: [kind] });
  }
}

/** Listens while someone's in a shared world. The browser reconnects by itself if it drops. */
export function useLive(shared: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!shared || typeof EventSource === "undefined") {
      return;
    }
    const source = new EventSource("/api/live");
    const kinds = ["feed", "notifications", "messages"];
    const handlers = kinds.map((kind) => {
      const handler = (event: MessageEvent<string>) => refresh(client, kind, event.data);
      source.addEventListener(kind, handler);
      return [kind, handler] as const;
    });
    return () => {
      for (const [kind, handler] of handlers) {
        source.removeEventListener(kind, handler);
      }
      source.close();
    };
  }, [shared, client]);
}
