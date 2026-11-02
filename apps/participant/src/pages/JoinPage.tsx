import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, type EntryInfo, get } from "../api.ts";
import { Message } from "./Message.tsx";

async function enter(slug: string, externalId: string) {
  const response = await fetch(`/api/studies/${encodeURIComponent(slug)}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? "Please check that and try again.");
  }
}

/** Where a recruitment link lands. With the ID in the link, it goes straight in. */
export function JoinPage() {
  const { slug } = useParams({ from: "/join/$slug" });
  const navigate = useNavigate();
  const client = useQueryClient();
  const [externalId, setExternalId] = useState("");
  const tried = useRef(false);

  const entry = useQuery({
    queryKey: ["entry", slug],
    queryFn: () => get<EntryInfo>(`/studies/${encodeURIComponent(slug)}/entry`),
    retry: false,
  });

  const join = useMutation({
    mutationFn: (id: string) => enter(slug, id),
    onSuccess: async () => {
      await client.invalidateQueries();
      await navigate({ to: "/" });
    },
  });
  const { mutate } = join;

  const idParam = entry.data?.idParam;
  useEffect(() => {
    if (!idParam || tried.current) {
      return;
    }
    const fromLink = new URLSearchParams(window.location.search).get(idParam);
    if (fromLink) {
      tried.current = true;
      mutate(fromLink);
    }
  }, [idParam, mutate]);

  useEffect(() => {
    if (entry.data) {
      document.title = entry.data.siteName;
    }
  }, [entry.data]);

  if (entry.isError) {
    return <Message title="This page isn't available." />;
  }
  if (!entry.data) {
    return null;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (externalId.trim()) {
      join.mutate(externalId.trim());
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      {entry.data.logoUrl ? (
        <img src={entry.data.logoUrl} alt={entry.data.siteName} className="mx-auto max-h-24" />
      ) : (
        <h1 className="text-center text-3xl font-semibold">{entry.data.siteName}</h1>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="external-id" className="font-medium">
          {entry.data.idLabel}
        </label>
        <input
          id="external-id"
          value={externalId}
          onChange={(event) => setExternalId(event.target.value)}
          autoComplete="off"
          className="rounded border border-stone-300 bg-white px-3 py-2 text-base"
        />
        {join.error && (
          <p role="alert" className="text-sm text-rose-700">
            {join.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={join.isPending}
          className="rounded bg-stone-900 py-2.5 font-medium text-white disabled:opacity-40"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
