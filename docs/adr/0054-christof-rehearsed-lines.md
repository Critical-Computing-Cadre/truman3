# 54. Christof part 3b: rehearsed lines

## Context

Live writing (ADR 52) means a researcher can't read a line before a participant does, and every line costs money and a model call. Some studies need every line seen before launch, for an ethics board or for consistency between participants, and still want lines that vary and fit what the participant did. The vault note `Agent runtime design` planned "rehearsals" for this. This is the second half of Christof part 3, after approval (ADR 53).

## Decision

- **A beat that improvises can have `lines`,** written ahead, as many as 50. They're part of `beats.yaml`, so they're frozen with the version like everything else.
- **Rehearse drafts them.** A button on the Beats page has the actor's model write five lines for a beat, from the persona card and the beat's `improvise` instruction. They're added to the beat's `lines` in the draft's `beats.yaml`, keeping its comments and layout, for the researcher to edit before saving a version. It's saved like any edit to the page, so it can be undone, and it's refused if someone saved the beats meanwhile.
- **With live writing off, a line is drawn for each world,** from the world's seed and the beat. The same world gets the same line, and no model is called.
- **With live writing on, the model chooses** the rehearsed line that fits, in one structured call that returns the line's number.
- **`stray` decides what happens when none fits:** `choose` (the default) lets the model write its own, which is checked like any live line; `never` keeps it to the rehearsed lines; `always` ignores them.
- **When live writing can't be used,** a rehearsed line is used instead of the fallback line.
- **Rehearsed lines aren't checked by the model.** A researcher read them, and saving the version is their approval, the same as a researcher's own line in ADR 53.
- **What a rehearsal costs isn't counted in the study's budget.** The budget is for what happens while participants take part, and a rehearsal happens before there's a version for it to count against. The Beats page shows what each rehearsal cost.

## Alternatives

- **Rehearsing into a separate store,** outside `beats.yaml`. Lines would be one more thing to find, export, and freeze. In the file, they're read and edited where the beat is.
- **Rehearsing by simulating participants.** That's Christof part 5, for testing a whole scenario. Lines for one beat don't need it.
- **Choosing a line by keywords or embeddings,** without a model. It's cheaper but often wrong about what a short post is about, and the model call to choose is small.
- **Only drawing at random,** even with live writing on. Researchers asked for lines that fit what the participant did.

## Consequences

- A study can run with every line read before launch, with no model at all while participants take part.
- Rehearse edits the YAML with the `yaml` package's document model. Comments stay, but some spacing in the file may be tidied when lines are added.
- The record for a beat says `rehearsed`, with the line's number, so analysis can tell which participants saw which line.
