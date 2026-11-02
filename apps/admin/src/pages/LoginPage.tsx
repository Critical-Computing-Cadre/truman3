import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { post } from "../api.ts";

export function LoginPage() {
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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-3xl font-semibold">Truman 3</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 font-medium">
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border border-stone-300 bg-white px-3 py-2 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border border-stone-300 bg-white px-3 py-2 font-normal"
          />
        </label>
        {login.error && (
          <p role="alert" className="text-sm text-rose-700">
            {login.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="rounded bg-stone-900 py-2.5 font-medium text-white disabled:opacity-40"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
