import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, post, type Researcher } from "../api.ts";
import { Field, inputClass, SignInForm } from "./LoginPage.tsx";

/**
 * The pages an emailed link opens (ADR 72). They work whether or not someone is signed in, so the
 * shell shows them before asking anyone to sign in.
 */

const tokenInAddress = () => new URLSearchParams(window.location.search).get("token") ?? "";
const goHome = () => window.location.assign(import.meta.env.BASE_URL);

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-3xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

/** Choosing a new password from a reset link. */
export function ResetPage() {
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => post("/admin/password-reset/complete", { token: tokenInAddress(), password }),
    onSuccess: goHome,
  });
  return (
    <Page title="Choose a new password">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          reset.mutate();
        }}
      >
        <Field label="New password" hint="At least 12 characters.">
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>
        {reset.error && (
          <p role="alert" className="text-sm text-rose-700">
            {reset.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={reset.isPending}
          className="rounded bg-stone-900 py-2.5 font-medium text-white disabled:opacity-40"
        >
          Save and sign in
        </button>
      </form>
    </Page>
  );
}

interface Invitation {
  team: string;
  role: string;
  email: string;
  hasAccount: boolean;
  invitedBy: string | null;
}

/** Joining a team from an invitation link: signing in, or making an account, then accepting. */
export function InvitePage() {
  const client = useQueryClient();
  const token = tokenInAddress();
  const invitation = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => get<Invitation>(`/admin/invites/${token}`),
    retry: false,
  });
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => get<Researcher>("/admin/me"),
    retry: false,
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const accept = useMutation({
    mutationFn: (body: object) => post(`/admin/invites/${token}/accept`, body),
    onSuccess: async () => {
      await client.invalidateQueries();
      goHome();
    },
  });

  if (invitation.error) {
    return (
      <Page title="This link doesn't work">
        <p className="text-center">{invitation.error.message}</p>
      </Page>
    );
  }
  if (!invitation.data) {
    return null;
  }
  const { team, role, email, hasAccount, invitedBy } = invitation.data;
  const signedInAs = me.data?.email;

  return (
    <Page title={`Join ${team}`}>
      <p>
        {invitedBy ?? "Someone"} invited {email} to join <strong>{team}</strong> on Truman, as{" "}
        {role === "owner" ? "an owner" : `an ${role}`}.
      </p>
      {hasAccount ? (
        signedInAs === email ? (
          <button
            type="button"
            disabled={accept.isPending}
            onClick={() => accept.mutate({})}
            className="rounded bg-stone-900 py-2.5 font-medium text-white disabled:opacity-40"
          >
            Join {team}
          </button>
        ) : signedInAs ? (
          <p role="alert">
            You're signed in as {signedInAs}. Sign out, then open this link again and sign in as{" "}
            {email}.
          </p>
        ) : (
          <>
            <p className="text-stone-600">Sign in as {email} to join.</p>
            <SignInForm />
          </>
        )
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            accept.mutate({ name, password });
          }}
        >
          <p className="text-stone-600">Make your account for {email}.</p>
          <Field label="Your name">
            <input
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Choose a password" hint="At least 12 characters.">
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
          <button
            type="submit"
            disabled={accept.isPending}
            className="rounded bg-stone-900 py-2.5 font-medium text-white disabled:opacity-40"
          >
            Join {team}
          </button>
        </form>
      )}
      {accept.error && (
        <p role="alert" className="text-sm text-rose-700">
          {accept.error.message}
        </p>
      )}
    </Page>
  );
}
