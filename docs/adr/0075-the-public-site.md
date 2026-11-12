# 75. The public site

## Context

Truman needs a public site: somewhere a researcher can find out what Truman is and decide whether it fits their study. The vault note `Public site and docs design` has the plan and Dominic's answers. He wanted it to read as an invitation and not a manual, to look like a real site and not documentation, and to lean on the idea behind the name: a made-up world with one real person in it.

The first design, a large heading over four screenshots, was "too corp". The one he chose came out of his own talk slides, where every face in a feed is swapped for a robot.

## Decision

- **The site is `apps/site`, built with VitePress,** at truman-research.org. Researcher guides will be Markdown pages in it. The home page is a Vue component, `components/Home.vue`, with a look of its own.
- **The home page puts the visitor in a study.**
  - It opens in a dark "control room", looking at a small world under a glass dome. Inside is a real post from EatSnap.Love, the first Truman study: its picture, the cast's faces, and a real unkind comment from that study.
  - The visitor can like the post, flag the comment, or reply. If they reply, the cast answers.
  - The page puts each visitor in one of two versions at random. In one, someone sticks up for the poster.
  - **"See who's real"** turns every face but the visitor's into a robot, and lets them switch versions.
  - Further down, a monitor shows the visitor their own record: their version, what they did, and how long they took. It says plainly that the page was a small study, that nothing left their browser, and that a real study has to ask first and tell the truth afterwards.
- **Nothing the visitor does is sent anywhere.** The scene runs in the page. There's no analytics.
- **It uses the idea of the film, and nothing from it:** no stills, names, or lines. The dome, the monitor, and the stairs are drawn for the site.
- **The copy is plain and direct,** in the voice Dominic uses in talks: "We built a fake social network to study real people."
- **It's hosted from the production stack** (`site` on a stage):
  - It has its own bucket and its own CloudFront distribution, so the API and the apps can't be reached from the site's address.
  - A small CloudFront function gives pages clean addresses, and sends www to the bare domain.
  - The certificate and records are made through the truman-research.org zone.
- **Fonts come from Google Fonts,** except Gill Sans, the logo's typeface, which is used where a visitor's computer has it, with Cabin as the fallback.

## The other pages

Added after the home page:
- **Studies:** a page for each example study in `studies/examples`, by the question it answers.
- **Guide:** for researchers, who mostly use the admin app in a browser. It covers building, testing, and running a study, the data, and ethics.
- **Developers:** for people who run or extend Truman. It's an overview that links to the fuller docs in this repo, so those stay the one place for detail.
- **For IRBs:** one page a researcher can send to an ethics board. It says what isn't finished, too.
- **About:** history, papers, how to cite Truman, funding, and people.
- **Plain-text copies for AI agents:** each build writes `llms.txt`, which lists every page, and `llms-full.txt`, with all of them in one file. They're made from the pages, so they can't fall behind.

Pages other than the home page use VitePress's default theme, with Truman's colors and type (`.vitepress/theme`).

## Alternatives

- **Screenshots of the four kinds of site.** They're accurate, but hard to tell apart at a glance, and they don't show what's special about Truman.
- **Stills from the film,** as in the talk slides. They carry the idea at once, but they're someone else's copyright, and an actor's face.
- **Recording what visitors do,** to learn from it. A page that says it's studying you, and then really does, without consent, would be the thing Truman's own rules forbid.
- **The site inside the participant or admin app.** It's simpler to host, but it would tie the site's releases to the apps', and put marketing in the apps' bundles.
- **Astro Starlight, Docusaurus, or MkDocs.** VitePress builds with Vite, which the apps already use, and lets one page have its own design while the rest are plain Markdown.
