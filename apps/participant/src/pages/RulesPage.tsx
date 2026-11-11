import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import Markdown from "react-markdown";
import { get } from "../api.ts";

/** The study's community rules, from its rules page. Opening them is recorded, and from where. */
export function RulesPage() {
  const { from } = useSearch({ from: "/gate/rules" });
  const rules = useQuery({
    queryKey: ["rules", from],
    queryFn: () => get<{ text: string }>(`/rules?from=${from}`),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <article
      className="mx-auto max-w-xl bg-white p-6 sm:rounded-lg sm:shadow-sm"
      data-testid="rules"
    >
      <div className="prose-page">
        {rules.isError ? (
          <p>This site has no community rules.</p>
        ) : (
          <Markdown>{rules.data?.text ?? ""}</Markdown>
        )}
      </div>
    </article>
  );
}

/** The site's own terms of service or privacy policy, from the study's pages. ADR 67. */
export function SitePage({ page }: { page: "terms" | "privacy" }) {
  const text = useQuery({
    queryKey: ["site-page", page],
    queryFn: () => get<{ text: string }>(`/site/${page}`),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <article
      className="mx-auto max-w-xl bg-white p-6 sm:rounded-lg sm:shadow-sm"
      data-testid={`site-${page}`}
    >
      <div className="prose-page">
        <Markdown>{text.data?.text ?? ""}</Markdown>
      </div>
    </article>
  );
}
