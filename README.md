# Structured output from a model that also has to write prose

A small, dependency-free TypeScript utility for pulling reliable structured data
out of a language-model response **without** giving up the free-form prose in the
same response.

The model writes to the player normally, and — when it needs to — embeds a
machine-readable instruction inline (a dice roll to request, an image to
generate). This library extracts and validates that instruction, and strips it
from the narrative the player sees — whether or not validation accepted it.

---

## The one guarantee worth reading first

**A matched instruction block is stripped from the player-facing narrative
regardless of whether it passes validation.**

Stripping and validation are decoupled and run independently: validation decides
whether the *program* acts on a block; stripping decides what the *player* sees.
A block the validator rejects is still removed from the narrative — it does not
leak through as visible JSON. After stripping, a final sweep removes any orphaned
debris a rejected or partial block could leave behind (empty code fences, stray
`DICE_REQUEST` / `IMAGE_REQUEST` markers), so the player-facing text stays clean.

The failure mode this design exists to prevent: a model that emits a
slightly-wrong instruction block should degrade to "the feature didn't fire this
turn," never to "the user sees raw JSON in the middle of the story."

The claim is deliberately scoped to blocks the matcher *recognizes*. What the
matcher does and doesn't recognize is stated exactly under
[Known issues](#known-issues) — the guarantee is precise about its own edge
rather than broad and hand-wavy about it.

---

## The problem

Getting structured data out of a model is easy when structured data is *all* you
want. It gets harder when the same single response has to be **two things at
once**: a human-facing narrative *and* a machine-facing instruction the
surrounding program will act on.

Here, an AI game master narrates the scene to the player and, in the middle of
that narration, may decide a dice roll is needed or an illustration should be
generated. Both the prose and the instruction have to arrive in one model
response, because they're semantically one turn — the instruction only makes
sense in the context of the narration that produced it, and fetching it in a
separate round-trip would add latency and cost to every turn.

So the model emits both, and the boundary between them is drawn *after* the
response comes back.

---

## Why not provider-native structured output?

This is the first question worth asking, so here's the answer up front — and the
honest version has to distinguish between the two provider mechanisms, because
they are not the same.

**The load-bearing reason is provider portability.** This protocol was built for
a system that routes across multiple model providers by tier — Claude and OpenAI
for hosted tiers, local models via Ollama for others. Provider-native structured
output is uneven across that set: tool-calling support on local models is
inconsistent or absent, and degrades sharply on smaller ones. A prose-embedded
protocol is provider-agnostic — one extraction path that behaves identically
whether a turn was served by Claude, GPT, or a local Llama. Native structured
output would mean maintaining a separate implementation per provider, each with
its own failure profile, and it would couple the *shape* of a response to the
routing decision — so a tier change could change response structure, not just
quality. Decoupling output format from routing is the point.

Two narrower notes, to be precise about the mechanisms rather than wave at them:

- **OpenAI JSON mode / `response_format` genuinely does exclude prose.** Constrain
  the output to a schema and you lose the narration; recovering it means a second
  call, which doubles latency and cost on every turn.
- **Anthropic tool use does *not* exclude prose** — a response can carry a `text`
  block and a `tool_use` block together, single round-trip. So on Claude
  specifically, the native mechanism *could* do what this library does. It wasn't
  used because it doesn't survive the routing layer above: the moment the same
  turn might be served by a provider without reliable tool use, a Claude-only
  solution stops being one solution.

And the hybrid — tool use where available, prose-embedding where it isn't —
strictly loses: the local tier still needs this library, so you maintain both
paths plus a branch, and response shape varies by provider again. More code for
the same outcome.

**What this approach gives up, stated plainly:** the provider-side
well-formedness guarantees you'd get from schema-constrained output are
hand-rolled here — the extraction, validation, and normalization in this repo do
work the provider would otherwise do for you. That's the cost of portability. It's
paid down by the validators and the test suite, and it's a deliberate trade, not
an oversight about what the platforms offer.

---

## How it works

The pipeline is five small, pure stages, each in its own unit:

1. **Extract** (`patterns.ts`, `extract.ts`) — locate candidate instruction
   blocks in the raw model response by pattern, in a fixed order.
2. **Validate** (`validate.ts`) — check each candidate field by field against its
   expected shape. Invalid candidates are rejected here and never acted on.
3. **Normalize** (`normalize.ts`) — fill defaults and canonicalize fields on
   blocks that passed validation.
4. **Strip** (`patterns.ts`) — remove every matched candidate block from the
   narrative, independently of whether validation accepted it.
5. **Sweep** (`sweep.ts`) — a final conservative pass over the narrative that
   removes orphaned debris (empty code fences, whole-line stray markers) and
   tidies the blank lines they leave behind, so the player-facing prose reads
   cleanly. It is deliberately cautious: it never removes legitimate prose or a
   legitimate non-empty code fence, and on any ambiguous input it removes nothing.

The output is the swept narrative plus any validated, normalized instructions the
program should act on.

Everything is pure functions with no I/O — no network, no environment, no
database. That's what makes the failure modes exhaustively testable.

---

## Tested failure modes

The validators, strip, and sweep are pure functions, so the test suite is the
real specification of behavior. Beyond the happy path, it covers:

- Truncated / unclosed JSON in a candidate block
- Wrong field types (e.g. a numeric field arriving as a string)
- Missing required fields, and values outside an allowed enum
- A block emitted mid-sentence rather than on its own line
- Two blocks in a single response (first-valid-wins; invalid-first-then-valid)
- **The decoupling guarantee directly:** a validation-rejected block is asserted
  absent from the player-facing narrative — no visible JSON, no orphaned fence,
  no stray marker
- **Sweep conservatism:** a legitimate non-empty code fence in normal prose
  survives the full pipeline untouched, and prose with no blocks passes through
  byte-identical
- The known matcher limitations below, pinned as *still present* so they can't be
  silently masked

---

## Known issues

Two limitations, stated as what they are — a matching gap, not a design feature:

- **Stray brace before the closing brace** of a block: the pattern-based matcher
  does not recognize the block, so it isn't extracted or stripped.
- **Nested braces** inside a block: same — not matched, not stripped.

Both are *matching* failures: the guarantee above covers blocks the matcher
recognizes, and these are the inputs it doesn't. Closing them means replacing
pattern-based extraction with a balanced-delimiter parser — a reasonable
extension deliberately left out of scope, because the model in practice produces
flat, well-formed blocks and the added parser complexity buys robustness against
inputs that don't occur here. Both cases are pinned by tests so the gap is
visible and can't regress into a silent surprise.

The two block types' strip paths differ in whether they remove the wrapping
fence. The sweep normalizes the result, so the player-facing output is identical
either way — layered defense rather than a single strip path doing everything.

---

## Install and use

```bash
npm install
npm test
npm run build
```

```ts
import { extractProtocolBlocks } from "./src/index.js";

const { narrative, diceRequest, imageRequest } = extractProtocolBlocks(modelResponseText);

// narrative    — cleaned, player-facing prose (all matched blocks stripped + swept)
// diceRequest  — a validated dice-roll request, or null
// imageRequest — a validated image-generation request, or null
```

The entry point is `src/index.ts`, built to `dist/` — run `npm run build` before
importing.

`extractProtocolBlocks` is the only function whose narrative is reader-safe.
`extractDiceRequest` and `extractImageRequest` are also exported, but they are
stage-level primitives — their output has been stripped, not swept.

No runtime dependencies. Dev dependencies: TypeScript and Vitest.

---

## Origin

Extracted from the real-time session engine of **EverQuill**, an AI-driven
tabletop RPG platform in closed alpha, where it separates the game master's
narration from the mechanical instructions the server acts on. The surrounding
application — prompt construction, model calls, persistence, the game itself — is
not part of this repo; this is only the protocol boundary, standing on its own.

## License

MIT — see [LICENSE](LICENSE).
