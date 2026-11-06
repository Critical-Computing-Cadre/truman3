# 44. Choosing a template on one page

## Context

From the vault note `Better builder design`. Dominic wants the New Study page to stay one page, with no wizard. "Read more" should be about look, feel, and affordances, and say nothing about which studies a template suits.

## Decision

- **A card for each template,** with a small live preview of two made-up posts. It's drawn by `FeedPostView` inside a `PlatformProvider` with the template's layout and features, so it changes when a template does. The sample photo is an SVG drawn in the page, so a preview needs nothing from a server. It leaves out what a feature that's off would add, as the server does.
- **"Read more" is the template's `about`,** a new field in `TEMPLATES` describing how it looks and how people get around. It's followed by the names of the features it has on, from the catalog, so that list can't fall out of date.
- **"Help me decide" asks three questions about how the platform works:** communities, photos, and short posts with reposts. The first "yes" suggests a template, and "no" to all suggests Classic. It only picks a card.
- The preview is hidden from screen readers and can't be clicked into. Each radio is named for its template, with its description linked.

## Alternatives

- **Screenshots of each template.** They'd go stale with every look change.
- **A wizard.** Dominic said not to force one on people.
- **Questions about the research,** such as whether it's about what people see or say. That's the researcher's call, as Dominic said.

## Consequences

- A new template needs an `about`, which TypeScript requires.
- Filling a whole feed from a spreadsheet is the second part of this, and isn't here.
