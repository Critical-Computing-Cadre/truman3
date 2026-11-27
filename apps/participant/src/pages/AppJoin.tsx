import { type FormEvent, useState } from "react";
import { joinPathFrom } from "../join-link.ts";

/** True inside Truman's app, which says so before the site loads (ADR 66). */
export function insideApp(): boolean {
  return typeof (window as { trumanApp?: unknown }).trumanApp === "object";
}

/**
 * What the app shows someone who isn't in a study: a place to paste the link they were given. In a
 * browser they'd just open the link, but an app that's been installed and opened has nowhere to
 * type one. A link that's tapped still opens the app at its study without this.
 */
export function AppJoin() {
  const [link, setLink] = useState("");
  const [wrong, setWrong] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const path = joinPathFrom(link);
    if (!path) {
      setWrong(true);
      return;
    }
    window.location.assign(path);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold">Join a study</h1>
        <p className="text-stone-600">
          Paste the link you were given. If you tapped a link and ended up here, tap it again.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="study-link" className="font-medium">
          Your link
        </label>
        <input
          id="study-link"
          value={link}
          onChange={(event) => {
            setLink(event.target.value);
            setWrong(false);
          }}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="rounded border border-stone-300 bg-white px-3 py-2 text-base"
        />
        {wrong && (
          <p role="alert" className="text-sm text-rose-700">
            That doesn't look like a study's link. It has /join/ in it.
          </p>
        )}
        <button
          type="submit"
          disabled={!link.trim()}
          className="rounded bg-accent-fill py-2.5 font-medium text-on-accent disabled:opacity-40"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
