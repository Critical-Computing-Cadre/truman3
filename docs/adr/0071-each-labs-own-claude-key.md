# 71. Each lab's own Claude key, and a starter budget

## Context

Live writing, rehearsing lines, personas, and agents all call Claude. Until now, one key on the server, `ANTHROPIC_API_KEY`, paid for everything. On a hosted Truman (ADR 70), that would mean the host pays for every lab's use. Dominic chose:
- each lab brings its own key
- each approved lab also gets $5 on his key to get started
- he can change the $5 for any lab

## Decision

- **One place picks the key.**
  - `createAi` in `apps/api/src/ai.ts` wraps the host's writer. Code that's about to call a model asks `writerFor(writer, scope)` for the writer to use, with the study, version, or draft it's for.
  - That happens in the four places that call a model: live writing (`director/wording.ts`), rehearsing (`admin/rehearse.ts`), agents (`admin/agent.ts`), and personas (`scenarios/simulate.ts`). Everything else passes the writer along as before.
- **Whose key pays, for a study:**
  1. **Its lab's own key**, if the lab stored one, and only on a hosted Truman.
  2. **Otherwise the host's key**:
     - **A lab waiting for approval** gets none of it.
     - **An approved lab** gets up to its `starterBudgetUsd`, which is $5 when it's approved. The budget is for all time, not each month.
     - **Teams made on the server** have no starter budget, so their use of the host's key isn't limited.
  3. **Otherwise nothing:** the call is refused with a reason, such as "your lab's starter budget of $5 is used up, so add your lab's own Claude key". Each caller already treats a refused call like any failed one: a beat uses its fallback or rehearsed line, and records the reason.
- **Every call is recorded** in `ai_spending`, with:
  - its team and study
  - what it was for (write, check, choose, rehearse, act, or agent)
  - the model and its cost
  - whether the lab or the host paid

  A lab's Your lab page and the operator's Labs page add these up.
- **The budget is checked before each call.** Several calls at once can overshoot it by a call or two, a few cents. An agent on the starter budget is given what's left of it as its own budget, so it stops there.
- **A lab's key is stored encrypted** with `TRUMAN_SECRET_KEY`, the same way as Prolific tokens (ADR 17). Only its last four characters are shown afterwards.
  - Only a lab's owners can add, replace, or remove it.
  - Tokens can't reach it.
  - A key must start with `sk-ant-`. It isn't tried against Anthropic when it's saved, so a mistyped key shows up as live writing falling back, with the reason in the beat's history.
- **A Truman that isn't hosted** works as before: everything uses `ANTHROPIC_API_KEY`. Its use is still recorded against each team.

## Alternatives

- **A model gateway between Truman and Anthropic,** keeping keys and budgets outside Truman. It's more to run, and labs would still need their keys stored somewhere.
- **Passing each lab's writer through every route.** That's more explicit, but it would touch every place that passes the writer along, though only four call a model.
- **A monthly starter budget.** It suits a paid service, but it would keep paying for a lab's use forever. A one-time amount gets a lab started, and Dominic can add more for a lab.
- **Checking a key with Anthropic when it's saved.** That catches typing mistakes early, but it costs a call and needs the network in tests. It can be added if mistyped keys turn out to be common.
