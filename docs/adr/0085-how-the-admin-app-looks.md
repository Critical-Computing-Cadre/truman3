# 85. How the admin app looks

## Context

The admin app grew a page at a time. Each page styled its own buttons and cards with long lists of utility classes, so the same button was written out about a hundred times. Getting around was a dark bar of underlined links, and inside a study a row of ten buttons above the feed, with a "Back to the feed" link on every page they led to. It worked, and it looked like nobody had designed it.

Researchers already know tools like Qualtrics and the AWS console. Those share a few habits: a quiet bar across the top that says where you are, a menu down the left that changes with what you've opened, one color for the thing to do next, bordered white panels on a pale page, and a small badge for the state something is in.

## Decision

- **One frame around every signed-in page** (`apps/admin/src/components/Shell.tsx`): a white bar with the name, the lab, and who's signed in, and a menu down the left.
- **The menu follows what's open.** Normally it's the lab's pages: Studies, Your lab, Access for agents, and Labs for an operator. With a study open to edit, it's that study's pages in four groups, with its title, whether it's a draft, and a way back to Studies. On a phone the menu is a row that scrolls sideways.
- **The menu replaces the buttons and back links.** The builder's row of page buttons is gone, and so is "Back to the feed". The menu's Feed is how you get back.
- **A few shared classes** in `apps/admin/src/index.css`: `btn` with `btn-primary`, `btn-go`, `btn-danger`, `btn-danger-quiet`, and `btn-sm`; `card`; and `badge` with `badge-good`, `badge-new`, and `badge-wait`. A utility class beside one still wins, as in `btn w-16`.
- **One blue, `primary`,** for the main button on a page, where you are in the menu, a chosen card, and keyboard focus. Green stays for opening a study to participants and red for deleting.
- **Cards have a border and no shadow.**
- **Lists are tables.** A lab's members, an operator's labs, and tokens each get a row with headed columns (`table`). Facts about one thing are a grid of small labels over values (`facts`).
- **Pages share a width** (`page`), so every page's heading starts in the same place. A page that's mostly a form keeps its lines short (`page-narrow`).
- **Settings lists its cards down the side** on a wide screen and marks the one being read. Every card stays on the page, so an unsaved change in one isn't lost by looking at another.

## Alternatives considered

- **A component library**, such as Radix with shadcn, or Cloudscape, which is AWS's own. It would bring a look ready-made. It's also a large dependency to keep up with, its components would need wrapping to keep the names the tests find things by, and the app's forms are plain ones that don't need it.
- **React components for Button and Card.** Tidy, but links, router links, and buttons all need the same look, so each component would need a variant for each. A class works on all three.
- **Tabs across the top for a study's pages**, as Qualtrics has for a survey. A study has up to ten pages, which don't fit across a laptop screen. A menu down the side has room, and can group them.
- **Keeping the dark bar.** It set the app apart from the participant site in a preview. The menu and the pale page do that now.

## Consequences

- **A new page uses the shared classes** and doesn't write its own button.
- **A new page of a study is added to the menu** in `Shell.tsx`, not to the builder.
- **The menu asks for the study's details on every one of its pages,** to know its title and which pages it has. The builder asks for the same thing, so they share one request there.
- **A study's own pages (Cast, Beats, and the rest) still set their own width.**
- **A test checks that the lab's pages are never wider than a phone's screen,** after a hidden table label made one scroll sideways.
- **The guide's pictures were retaken**, and its steps now say "in the menu".
