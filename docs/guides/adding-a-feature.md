# Adding a feature

A feature is one building block of a platform, like likes or comments (ADR 18). Adding one touches these places. `flagging` is a small one to copy.

| Part                | Where                                     | What to do                                                       |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| **The definition**  | `packages/core/src/features/catalog.ts`   | Add its name, description, version, and events                   |
| **Events**          | `packages/core/src/events.ts`             | Add any new event type and its details                           |
| **What people see** | `packages/ui/src/features/`               | A component that returns nothing when `useFeature` says it's off |
| **Where it goes**   | `packages/ui/src/layouts/`                | Put the component in every layout, so any mix of features works  |
| **The server**      | `apps/api/src/actions/routes.ts`          | Add a route that starts by refusing when `isOff` says it's off   |
| **Templates**       | `packages/core/src/features/templates.ts` | Say which templates include it                                   |

Settings show every feature in the catalog automatically, and the codebook lists them by condition.

Then add tests:
- A component test that it disappears when off (`packages/ui/src/FeedPostView.test.tsx`).
- A server test that its route refuses when off (`apps/api/src/features.itest.ts`).

A layout is also the page around posts: its header and what goes beside a feed, a space, and a post, in `packages/ui/src/layouts/*-page.tsx`. Pages hand over the pieces, and each layout decides where they go.

## Rules

- **A layout only arranges.** If a layout has an `if` about what a feature does, that belongs in the feature.
- **Changing what a feature does means raising its version.** Studies report the version they used.
- **Never change how a launched layout looks.** Add a new one, such as `classic-2`, and leave the old one in place.
- **Add a validation warning** if content can be written that this feature being off would hide (`packages/core/src/study/validate.ts`).
