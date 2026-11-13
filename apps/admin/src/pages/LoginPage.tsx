import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { get, post } from "../api.ts";
import { Logo } from "../components/Logo.tsx";

const inputClass = "rounded border border-stone-300 bg-white px-3 py-2 font-normal";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the input comes in as children, inside the label.
    <label className="flex flex-col gap-1 font-medium">
      {label}
      {children}
      {hint && <span className="text-sm font-normal text-stone-500">{hint}</span>}
    </label>
  );
}

export { Field, inputClass };

export function LoginPage() {
  const [mode, setMode] = useState<"sign-in" | "apply" | "forgot">("sign-in");
  const applying = mode === "apply";
  const setApplying = (on: boolean) => setMode(on ? "apply" : "sign-in");
  const hosting = useQuery({
    queryKey: ["hosting"],
    queryFn: () => get<{ hosted: boolean }>("/admin/hosting"),
  });
  const hosted = hosting.data?.hosted ?? false;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3">
        <Logo className="h-14 w-14" />
        <h1 className="text-center text-3xl font-semibold">Truman 3</h1>
      </div>
      <div className="card flex flex-col gap-6 p-6">
        {mode === "apply" ? (
          <ApplyForm />
        ) : mode === "forgot" ? (
          <ForgotForm onBack={() => setMode("sign-in")} />
        ) : (
          <>
            <SignInForm />
            <p className="-mt-3 text-center text-sm">
              <button type="button" className="underline" onClick={() => setMode("forgot")}>
                Forgot your password?
              </button>
            </p>
          </>
        )}
        {hosted && (
          <p className="text-center text-sm">
            {applying ? (
              <>
                Already have an account?{" "}
                <button type="button" className="underline" onClick={() => setApplying(false)}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to Truman?{" "}
                <button type="button" className="underline" onClick={() => setApplying(true)}>
                  Apply for your lab
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </main>
  );
}

export function SignInForm() {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => post("/admin/login", { email, password }),
    onSuccess: () => client.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Email">
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </Field>
      {login.error && (
        <p role="alert" className="text-sm text-rose-700">
          {login.error.message}
        </p>
      )}
      <button type="submit" disabled={login.isPending} className="btn btn-primary py-2.5">
        Sign in
      </button>
    </form>
  );
}

/** A lab applies for a hosted Truman, and can start building while it waits (ADR 70). */
function ApplyForm() {
  const client = useQueryClient();
  const [form, setForm] = useState({
    lab: "",
    institution: "",
    website: "",
    purpose: "",
    name: "",
    email: "",
    password: "",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: event.target.value });

  const apply = useMutation({
    mutationFn: () => {
      const { website, ...rest } = form;
      return post("/admin/apply", website.trim() ? { ...rest, website } : rest);
    },
    onSuccess: () => client.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    apply.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-stone-600">
        Tell us about your lab. You can start building studies straight away, and open them to
        participants once we've approved your lab.
      </p>
      <Field label="Lab or group">
        <input required value={form.lab} onChange={set("lab")} className={inputClass} />
      </Field>
      <Field label="University or institution">
        <input
          required
          value={form.institution}
          onChange={set("institution")}
          className={inputClass}
        />
      </Field>
      <Field label="Lab or faculty web page" hint="Optional. It helps us see who you are.">
        <input type="url" value={form.website} onChange={set("website")} className={inputClass} />
      </Field>
      <Field label="What you'd like to study with Truman" hint="A few sentences is plenty.">
        <textarea
          required
          rows={4}
          value={form.purpose}
          onChange={set("purpose")}
          className={inputClass}
        />
      </Field>
      <Field label="Your name">
        <input
          required
          autoComplete="name"
          value={form.name}
          onChange={set("name")}
          className={inputClass}
        />
      </Field>
      <Field label="Your email" hint="Your university address helps us approve you sooner.">
        <input
          type="email"
          required
          autoComplete="username"
          value={form.email}
          onChange={set("email")}
          className={inputClass}
        />
      </Field>
      <Field label="Choose a password" hint="At least 12 characters.">
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
          className={inputClass}
        />
      </Field>
      {apply.error && (
        <p role="alert" className="text-sm text-rose-700">
          {apply.error.message}
        </p>
      )}
      <button type="submit" disabled={apply.isPending} className="btn btn-primary py-2.5">
        Apply
      </button>
    </form>
  );
}

/** Asks for an email with a link to choose a new password (ADR 72). */
function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const reset = useMutation({
    mutationFn: () => post("/admin/password-reset", { email }),
  });
  if (reset.isSuccess) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status">
          If there's an account for {email}, we've sent it a link to choose a new password. It works
          for an hour.
        </p>
        <button type="button" className="underline" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        reset.mutate();
      }}
    >
      <p className="text-stone-600">We'll email you a link to choose a new password.</p>
      <Field label="Email">
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </Field>
      {reset.error && (
        <p role="alert" className="text-sm text-rose-700">
          {reset.error.message}
        </p>
      )}
      <button type="submit" disabled={reset.isPending} className="btn btn-primary py-2.5">
        Send the link
      </button>
      <button type="button" className="text-sm underline" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}
