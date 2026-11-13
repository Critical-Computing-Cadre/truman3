import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiError } from "../api.ts";

interface SheetIssue {
  severity: "error" | "warning";
  message: string;
  file?: string;
  row?: number;
}

interface Added {
  /** How many of each kind of item, by kind, such as `post`. */
  added: Record<string, number>;
  warnings: SheetIssue[];
}

/** What each kind of item is called, one and many, in the order the builder lists them. */
const KIND_NAMES: [string, string, string][] = [
  ["actor", "person", "people"],
  ["space", "community", "communities"],
  ["post", "post", "posts"],
  ["comment", "comment", "comments"],
  ["reaction", "response", "responses"],
  ["story", "story", "stories"],
  ["contextNote", "context note", "context notes"],
  ["removal", "removal", "removals"],
  ["label", "label", "labels"],
  ["flagAnswer", "answer to flags", "answers to flags"],
  ["reportAnswer", "answer to reports", "answers to reports"],
  ["ban", "ban", "bans"],
  ["autoRule", "rule", "rules"],
  ["appealAnswer", "answer to appeals", "answers to appeals"],
];

/** "2 people, 1 post, and 3 comments", for what was added. */
function describeAdded(added: Record<string, number>) {
  const parts = KIND_NAMES.flatMap(([kind, one, many]) => {
    const n = added[kind] ?? 0;
    return n > 0 ? [`${n} ${n === 1 ? one : many}`] : [];
  });
  if (parts.length === 0) {
    return "nothing";
  }
  return parts.length === 1
    ? (parts[0] as string)
    : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** An upload that was refused, with what to fix. */
class SheetProblems extends ApiError {
  readonly issues: SheetIssue[];

  constructor(status: number, message: string, issues: SheetIssue[]) {
    super(status, message);
    this.issues = issues;
  }
}

async function uploadSheets(draftId: string, file: File): Promise<Added> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/admin/drafts/${draftId}/sheets`, {
    method: "POST",
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const { error, issues } = body as { error?: string; issues?: SheetIssue[] };
    throw new SheetProblems(response.status, error ?? "Something went wrong.", issues ?? []);
  }
  return body as Added;
}

const where = ({ file, row }: SheetIssue) => (file ? `${file}${row ? `, row ${row}` : ""}: ` : "");

function IssueList({ issues }: { issues: SheetIssue[] }) {
  return (
    <ul className="max-h-60 list-disc overflow-y-auto pl-5">
      {issues.map((issue, index) => (
        // The same message can come up on different rows, so the position keeps them apart.
        // biome-ignore lint/suspicious/noArrayIndexKey: the list never changes once shown
        <li key={index}>
          {where(issue)}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Adds to a draft from sheets: people, posts, comments, and anything else a study folder has. It
 * starts with sheets made for this kind of platform, filled in anywhere, and zipped up with their
 * pictures. An upload adds to the draft, all at once or not at all, so a mistake in row 40 doesn't
 * leave half of it in.
 */
export function SheetUpload({ draftId }: { draftId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const client = useQueryClient();

  const add = useMutation({
    mutationFn: (chosen: File) => uploadSheets(draftId, chosen),
    onSuccess: () => client.invalidateQueries({ queryKey: ["draft", draftId] }),
  });

  const close = () => dialog.current?.close();
  const problems = add.error instanceof SheetProblems ? add.error.issues : [];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          add.reset();
          setFile(null);
          dialog.current?.showModal();
        }}
        className="btn"
      >
        Add from sheets
      </button>
      <dialog
        ref={dialog}
        aria-label="Add from sheets"
        className="m-auto w-[min(92vw,34rem)] rounded-lg p-4 backdrop:bg-black/50"
      >
        <h2 className="mb-2 text-lg font-semibold">Add from sheets</h2>
        {add.data ? (
          <div className="space-y-3 text-sm">
            <p role="status">
              Added {describeAdded(add.data.added)}. You can undo it from Recent changes.
            </p>
            {add.data.warnings.length > 0 && (
              <div className="rounded bg-amber-50 p-3 text-amber-900">
                <p className="font-medium">Worth checking:</p>
                <IssueList issues={add.data.warnings} />
              </div>
            )}
            <button type="button" onClick={close} className="btn btn-primary">
              Done
            </button>
          </div>
        ) : (
          <form
            className="space-y-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              if (file) {
                add.mutate(file);
              }
            }}
          >
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <a
                  href={`/api/admin/drafts/${draftId}/sheets`}
                  download
                  className="font-medium underline"
                >
                  Download the sheets
                </a>{" "}
                for this platform: the cast, posts, comments, and whatever else it has on, such as
                communities, stories, or moderation. Each has a column for what this platform shows,
                and example rows.
              </li>
              <li>
                Fill them in, in a spreadsheet such as Excel or Google Sheets, and save as CSV.
              </li>
              <li>Zip them up with their pictures, as the sheets explain, and upload the zip.</li>
            </ol>
            <p className="text-stone-600">
              This adds to what's in the draft, and doesn't change anything already here. If
              anything in it has a problem, nothing is added, and you'll see what to fix.
            </p>
            <label className="flex flex-col gap-1 font-medium">
              The zip
              <input
                type="file"
                accept=".zip,application/zip"
                required
                onChange={(event) => {
                  add.reset();
                  setFile(event.target.files?.[0] ?? null);
                }}
                className="text-sm font-normal"
              />
            </label>
            {add.error && (
              <div role="alert" className="rounded bg-rose-50 p-3 text-rose-900">
                <p className="font-medium">{add.error.message}</p>
                {problems.length > 0 && <IssueList issues={problems} />}
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={add.isPending || !file} className="btn btn-primary">
                {add.isPending ? "Adding…" : "Add to the draft"}
              </button>
              <button type="button" onClick={close} className="btn">
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
