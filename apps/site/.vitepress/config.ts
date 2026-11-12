import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitepress";

const ADDRESS = "https://truman-research.org";
const APP = "https://app.truman-research.org/admin/";
const REPO = "https://github.com/Critical-Computing-Cadre/truman3";

const guide = [
  {
    text: "Start",
    items: [
      { text: "What Truman is", link: "/guide/" },
      { text: "Your first study", link: "/guide/first-study" },
      { text: "Your lab on hosted Truman", link: "/guide/your-lab" },
    ],
  },
  {
    text: "Build",
    items: [
      { text: "Kinds of site", link: "/guide/kinds-of-site" },
      { text: "Posts and the cast", link: "/guide/posts-and-cast" },
      { text: "Conditions", link: "/guide/conditions" },
      { text: "Consent, surveys, and debriefing", link: "/guide/flow" },
      { text: "Moderation", link: "/guide/moderation" },
      { text: "Making things happen", link: "/guide/beats" },
      { text: "A cast that writes for itself", link: "/guide/live-writing" },
      { text: "Several real people together", link: "/guide/shared-worlds" },
      { text: "AI in Truman", link: "/guide/ai" },
    ],
  },
  {
    text: "Test and run",
    items: [
      { text: "Testing a study", link: "/guide/testing" },
      { text: "Running a study", link: "/guide/running" },
      { text: "Your data", link: "/guide/data" },
      { text: "The phone app", link: "/guide/mobile-app" },
      { text: "Ethics", link: "/guide/ethics" },
    ],
  },
];

const developers = [
  {
    text: "For developers",
    items: [
      { text: "Overview", link: "/developers/" },
      { text: "Run your own Truman", link: "/developers/run-your-own" },
      { text: "How it's built", link: "/developers/architecture" },
      { text: "Studies as files", link: "/developers/study-files" },
      { text: "The API and agents", link: "/developers/api-and-agents" },
      { text: "Contributing", link: "/developers/contributing" },
    ],
  },
];

const studies = [
  {
    text: "Example studies",
    items: [
      { text: "All examples", link: "/studies/" },
      { text: "EatSnap", link: "/studies/eatsnap" },
      { text: "Who flagged this?", link: "/studies/flag-source" },
      { text: "Vaccine frames", link: "/studies/vaccine-frames" },
      { text: "Town talk", link: "/studies/town-talk" },
      { text: "Bystander", link: "/studies/bystander" },
    ],
  },
];

/** Every page a reader can reach, in reading order, for the plain-text copies (see buildEnd). */
const PAGES = [
  ...studies.flatMap(({ items }) => items),
  { text: "For IRBs", link: "/irb" },
  ...guide.flatMap(({ items }) => items),
  ...developers.flatMap(({ items }) => items),
  { text: "About", link: "/about" },
];

// The public site at truman-research.org (ADR 75): a home page for researchers deciding whether to
// use Truman, a guide for researchers, and docs for developers.
export default defineConfig({
  title: "Truman",
  description:
    "A social media site built for research. Every post and every other user is made up by the researcher, and the only real thing is the participant.",
  lang: "en-US",
  cleanUrls: true,
  appearance: false,
  head: [
    ["link", { rel: "icon", href: "/truman.svg", type: "image/svg+xml" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cabin:wght@400;600&family=Caveat:wght@600&family=Courier+Prime:wght@400;700&family=Source+Sans+3:wght@400;600&display=swap",
      },
    ],
  ],
  themeConfig: {
    logo: "/truman.svg",
    siteTitle: "truman",
    nav: [
      { text: "Studies", link: "/studies/", activeMatch: "^/studies/" },
      { text: "Guide", link: "/guide/", activeMatch: "^/guide/" },
      { text: "Developers", link: "/developers/", activeMatch: "^/developers/" },
      { text: "For IRBs", link: "/irb" },
      { text: "About", link: "/about" },
      { text: "Sign in", link: APP },
    ],
    sidebar: { "/guide/": guide, "/developers/": developers, "/studies/": studies },
    socialLinks: [{ icon: "github", link: REPO }],
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: {
      message: "Truman was created by Dominic DiFranzo. Open source under the MIT license.",
    },
  },
  // Plain-text copies for AI agents (ADR 75): llms.txt lists every page, and llms-full.txt has
  // them all in one file. Both are made from the pages themselves, so they can't fall behind.
  buildEnd({ srcDir, outDir }) {
    const source = (link: string) =>
      readFileSync(
        path.join(srcDir, `${link.endsWith("/") ? `${link}index` : link}.md`.slice(1)),
        "utf8",
      ).replace(/^---\n[\s\S]*?\n---\n/, "");
    const lines = PAGES.map(({ text, link }) => `- [${text}](${ADDRESS}${link})`);
    writeFileSync(
      path.join(outDir, "llms.txt"),
      `# Truman\n\n> Truman is an open-source platform for social media research. A researcher builds a realistic social media site where every post and every other user is made up, and studies what real participants do there. It can be used hosted at ${APP} or self-hosted from ${REPO}.\n\nEverything below is also in one file: ${ADDRESS}/llms-full.txt\n\n## Pages\n\n${lines.join("\n")}\n`,
    );
    writeFileSync(
      path.join(outDir, "llms-full.txt"),
      PAGES.map(({ link }) => `<!-- ${ADDRESS}${link} -->\n\n${source(link).trim()}\n`).join(
        "\n---\n\n",
      ),
    );
  },
});
