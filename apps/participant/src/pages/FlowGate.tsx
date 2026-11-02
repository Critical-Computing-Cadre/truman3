import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import Markdown from "react-markdown";
import { ApiError, type FlowState, get, type Me, post, postForm } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { startTracking } from "../tracking.ts";
import { Message } from "./Message.tsx";

function ConsentStep({
  flow,
  onDone,
  onDeclined,
}: {
  flow: FlowState;
  onDone: () => void;
  onDeclined: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const decline = useMutation({
    mutationFn: () =>
      post<{ message: string; redirectUrl: string | null }>("/me/flow/decline", {
        position: flow.position,
      }),
    onSuccess: ({ message, redirectUrl }) => {
      if (redirectUrl) {
        window.location.assign(redirectUrl);
      } else {
        onDeclined(message);
      }
    },
  });

  return (
    <PageStep flow={flow} label="I agree" onDone={onDone}>
      {confirming ? (
        <div className="mt-4 rounded border border-stone-300 p-4">
          <p className="mb-3">
            If you don't agree, you won't be able to take part, and you can't come back later.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => decline.mutate()}
              disabled={decline.isPending}
              className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-40"
            >
              I don't want to take part
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-stone-300 px-4 py-2"
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 w-full rounded border border-stone-300 py-2.5 font-medium"
        >
          I do not agree
        </button>
      )}
    </PageStep>
  );
}

function PageStep({
  flow,
  label,
  onDone,
  children,
}: {
  flow: FlowState;
  label: string;
  onDone: () => void;
  children?: ReactNode;
}) {
  const advance = useMutation({
    mutationFn: () => post("/me/flow/advance", { position: flow.position }),
    onSuccess: onDone,
  });

  return (
    <main className="mx-auto max-w-xl bg-white p-6 sm:mt-6 sm:rounded-lg sm:shadow-sm">
      <div className="prose-page">
        <Markdown>{flow.pageText ?? ""}</Markdown>
      </div>
      <button
        type="button"
        onClick={() => advance.mutate()}
        disabled={advance.isPending}
        className="mt-4 w-full rounded bg-stone-900 py-2.5 font-medium text-white disabled:opacity-40"
      >
        {label}
      </button>
      {children}
    </main>
  );
}

function AccountStep({ flow, onDone }: { flow: FlowState; onDone: () => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/me") });
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [picture, setPicture] = useState<File | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      await postForm("/me/profile", {
        username,
        name,
        location,
        bio,
        ...(picture ? { picture } : {}),
      });
      await post("/me/flow/advance", { position: flow.position });
    },
    onSuccess: onDone,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const field = "rounded border border-stone-300 px-3 py-2 text-base";
  const labelClass = "flex flex-col gap-1 font-medium";

  if (!me.data) {
    return null;
  }

  return (
    <main className="mx-auto max-w-xl bg-white p-6 sm:mt-6 sm:rounded-lg sm:shadow-sm">
      <h1 className="mb-4 text-2xl font-semibold">Tell us a little about yourself</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={labelClass}>
          Username
          <input
            required
            pattern="[A-Za-z0-9_.\-]{1,30}"
            title="Letters, numbers, dots, dashes, and underscores"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={field}
          />
        </label>
        <label className={labelClass}>
          Name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={field}
          />
        </label>
        <label className={labelClass}>
          Location
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className={field}
          />
        </label>
        <label className={labelClass}>
          Bio
          <textarea
            rows={3}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            className={field}
          />
        </label>
        <label className={labelClass}>
          Profile picture
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setPicture(event.target.files?.[0] ?? null)}
          />
        </label>
        {save.error && (
          <p role="alert" className="text-sm text-rose-700">
            {save.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded bg-stone-900 py-2.5 font-medium text-white disabled:opacity-40"
        >
          Save and continue
        </button>
      </form>
    </main>
  );
}

function ExitStep({
  flow,
  onFinished,
}: {
  flow: FlowState;
  onFinished: (redirectUrl: string | null) => void;
}) {
  const finish = useMutation({
    mutationFn: () =>
      post<{ redirectUrl: string | null }>("/me/flow/advance", { position: flow.position }),
    onSuccess: ({ redirectUrl }) => onFinished(redirectUrl),
  });
  const { mutate } = finish;
  const isDone = flow.step === "done";

  // With no exit step, there's nothing to read or click.
  useEffect(() => {
    if (isDone) {
      mutate();
    }
  }, [isDone, mutate]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Thanks for being part of {flow.site.name}!</h1>
      {!isDone && (
        <button
          type="button"
          onClick={() => mutate()}
          disabled={finish.isPending}
          className="rounded bg-stone-900 px-6 py-2.5 font-medium text-white disabled:opacity-40"
        >
          Continue
        </button>
      )}
    </main>
  );
}

/** Shows whichever step of the study this participant is on. */
export function FlowGate() {
  const client = useQueryClient();
  const [finished, setFinished] = useState(false);
  const [declined, setDeclined] = useState<string | null>(null);

  const flow = useQuery({
    queryKey: ["flow"],
    queryFn: () => get<FlowState>("/me/flow"),
    retry: false,
    enabled: !finished && declined === null,
  });

  const site = flow.data?.site;
  useEffect(() => {
    if (!site) {
      return;
    }
    document.title = site.name;
    if (site.faviconUrl) {
      const icon = document.createElement("link");
      icon.rel = "icon";
      icon.href = site.faviconUrl;
      document.head.append(icon);
    }
  }, [site]);

  useEffect(() => {
    if (flow.data?.step === "feed") {
      startTracking();
    }
  }, [flow.data?.step]);

  const refresh = () => client.invalidateQueries({ queryKey: ["flow"] });

  if (declined !== null) {
    return <Message title={declined} />;
  }
  if (finished) {
    return <Message title="Thank you!" body="You're all done. You can close this page." />;
  }
  if (flow.error instanceof ApiError && flow.error.status === 401) {
    return (
      <Message
        title="You're not signed in."
        body="Please use the link you were given to come back."
      />
    );
  }
  if (flow.error) {
    return <Message title="Something went wrong." body="Please reload this page." />;
  }
  if (!flow.data) {
    return null;
  }

  switch (flow.data.step) {
    case "consent":
      return <ConsentStep flow={flow.data} onDone={refresh} onDeclined={setDeclined} />;
    case "page":
      return <PageStep flow={flow.data} label="Continue" onDone={refresh} />;
    case "account":
      return <AccountStep flow={flow.data} onDone={refresh} />;
    case "feed":
      return <Shell flow={flow.data} onAdvanced={refresh} />;
    case "exit":
    case "done":
      return (
        <ExitStep
          flow={flow.data}
          onFinished={(redirectUrl) => {
            if (redirectUrl) {
              window.location.assign(redirectUrl);
            } else {
              setFinished(true);
            }
          }}
        />
      );
  }
}
