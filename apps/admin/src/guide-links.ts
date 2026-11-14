/**
 * Which page of the guide explains each page of this app. The bar across the top links to it, so
 * help is one press away from wherever someone is stuck.
 *
 * The keys are this app's routes, as `main.tsx` has them. The values are pages of the site in
 * `apps/site`. A test checks every route has one and every one exists.
 */
export const GUIDE_SITE = "https://truman-research.org";

export const GUIDE_PAGES: Record<string, { page: string; about: string }> = {
  "/": { page: "/guide/first-study", about: "Your first study" },
  "/studies/new": { page: "/guide/kinds-of-site", about: "Kinds of site" },
  "/preview/$versionId": { page: "/guide/posts-and-cast", about: "Posts and the cast" },
  "/versions/$versionId/simulate": { page: "/guide/testing", about: "Testing a study" },
  "/studies/$studyId/monitor": { page: "/guide/running", about: "Running a study" },
  "/studies/$studyId/prolific": { page: "/guide/running", about: "Running a study" },
  "/drafts/$draftId": { page: "/guide/posts-and-cast", about: "Posts and the cast" },
  "/drafts/$draftId/cast": { page: "/guide/posts-and-cast", about: "Posts and the cast" },
  "/drafts/$draftId/stories": { page: "/guide/kinds-of-site", about: "Kinds of site" },
  "/drafts/$draftId/spaces": { page: "/guide/kinds-of-site", about: "Kinds of site" },
  "/drafts/$draftId/beats": { page: "/guide/beats", about: "Making things happen" },
  "/drafts/$draftId/moderation": { page: "/guide/moderation", about: "Moderation" },
  "/drafts/$draftId/scenarios": { page: "/guide/testing", about: "Testing a study" },
  "/drafts/$draftId/personas": { page: "/guide/testing", about: "Testing a study" },
  "/drafts/$draftId/settings": { page: "/guide/conditions", about: "Conditions" },
  "/drafts/$draftId/agent": { page: "/guide/ai", about: "AI in Truman" },
  "/lab": { page: "/guide/your-lab", about: "Your lab on hosted Truman" },
  "/tokens": { page: "/guide/ai", about: "AI in Truman" },
  "/operator": { page: "/developers/run-your-own", about: "Run your own Truman" },
};

/** The guide page for a route, or the guide's first page for one nobody has listed. */
export function guideFor(route: string) {
  const { page, about } = GUIDE_PAGES[route] ?? { page: "/guide/", about: "What Truman is" };
  return { href: `${GUIDE_SITE}${page}`, about };
}
