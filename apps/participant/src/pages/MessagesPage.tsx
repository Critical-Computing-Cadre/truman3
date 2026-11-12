import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { ConversationsResponse, ThreadResponse } from "@truman3/core";
import { Avatar, shortTime } from "@truman3/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { get, post } from "../api.ts";

/** How often an open conversation checks for a reply. */
const CHECK_EVERY_MS = 10_000;

/** Every conversation with the cast, newest first. See ADR 61. */
export function MessagesPage() {
  const list = useQuery({
    queryKey: ["messages"],
    queryFn: () => get<ConversationsResponse>("/messages"),
    refetchInterval: CHECK_EVERY_MS,
  });
  const conversations = list.data?.conversations ?? [];

  return (
    <div className="mx-auto max-w-xl bg-white shadow-sm sm:rounded-lg">
      <h1 className="p-4 text-xl font-semibold">Messages</h1>
      {list.data && conversations.length === 0 && (
        <p className="p-6 text-center text-stone-500">
          No messages yet. You can message someone from their profile.
        </p>
      )}
      <ul className="divide-y divide-stone-200" data-testid="conversations">
        {conversations.map((conversation) => (
          <li key={conversation.with.username}>
            <Link
              to="/messages/$username"
              params={{ username: conversation.with.username }}
              className={`flex gap-3 p-3 hover:bg-stone-50 ${conversation.unread > 0 ? "bg-amber-50" : ""}`}
            >
              <Avatar seed={conversation.with.username} url={conversation.with.pictureUrl} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className={conversation.unread > 0 ? "font-semibold" : "font-medium"}>
                    {conversation.with.name}
                  </span>
                  <span className="shrink-0 text-xs text-stone-500">
                    {shortTime(conversation.last.at)}
                  </span>
                </p>
                <p className="truncate text-sm text-stone-600">
                  {conversation.last.mine ? "You: " : ""}
                  {conversation.last.body}
                </p>
              </div>
              {conversation.unread > 0 && (
                <span className="self-center rounded-full bg-rose-600 px-1.5 text-xs leading-5 text-white">
                  {conversation.unread}
                  <span className="sr-only"> new</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One conversation, with a box to write in. Opening it marks its messages read. */
export function ConversationPage() {
  const { username } = useParams({ from: "/gate/messages/$username" });
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const thread = useQuery({
    queryKey: ["messages", username],
    queryFn: () => get<ThreadResponse>(`/messages/${username}`),
    refetchInterval: CHECK_EVERY_MS,
  });
  const messages = thread.data?.messages ?? [];

  // What's new has just been read, so the counts change.
  useEffect(() => {
    if (thread.dataUpdatedAt) {
      client.invalidateQueries({ queryKey: ["me"] });
    }
  }, [thread.dataUpdatedAt, client]);

  // The newest message is at the bottom, so that's where it opens.
  useEffect(() => {
    if (messages.length > 0) {
      bottom.current?.scrollIntoView?.({ block: "end" });
    }
  }, [messages.length]);

  const send = useMutation({
    mutationFn: (body: string) => post<{ id: string }>(`/messages/${username}`, { body }),
    onSuccess: () => {
      setDraft("");
      client.invalidateQueries({ queryKey: ["messages"] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) {
      send.mutate(draft.trim());
    }
  };

  if (thread.isError) {
    return <p className="p-6 text-center text-stone-500">You can't message this person.</p>;
  }
  const them = thread.data?.with;

  return (
    <div className="mx-auto flex max-w-xl flex-col bg-white shadow-sm sm:rounded-lg">
      <header className="flex items-center gap-3 border-b border-stone-200 p-3">
        <Link to="/messages" className="text-sm text-stone-600" aria-label="Back to messages">
          ←
        </Link>
        {them && (
          <Link to="/u/$username" params={{ username }} className="flex items-center gap-2">
            <Avatar seed={username} url={them.pictureUrl} size="h-8 w-8" />
            <span className="font-semibold">{them.name}</span>
          </Link>
        )}
      </header>
      <ol className="flex min-h-64 flex-col gap-2 p-3" data-testid="messages">
        {messages.map((message) => (
          <li
            key={message.id}
            className={`max-w-[80%] rounded-2xl px-3 py-2 break-words ${
              message.mine ? "self-end bg-accent-fill text-on-accent" : "self-start bg-stone-100"
            }`}
          >
            <p className="whitespace-pre-wrap">{message.body}</p>
            <p className={`text-[0.7rem] ${message.mine ? "text-on-accent/80" : "text-stone-500"}`}>
              {shortTime(message.at)}
            </p>
          </li>
        ))}
      </ol>
      <div ref={bottom} />
      <form onSubmit={submit} className="flex gap-2 border-t border-stone-200 p-3">
        <label className="sr-only" htmlFor="message">
          Message {them?.name ?? username}
        </label>
        <textarea
          id="message"
          rows={1}
          value={draft}
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              submit(event);
            }
          }}
          placeholder="Write a message"
          className="min-w-0 flex-1 resize-none rounded-full border border-stone-300 px-4 py-2"
        />
        <button
          type="submit"
          disabled={!draft.trim() || send.isPending}
          className="rounded-full bg-accent-fill px-4 py-2 text-on-accent disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
