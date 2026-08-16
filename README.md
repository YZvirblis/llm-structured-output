# llm-structured-output

> **DRAFT — pending review.** Not final; wording, framing, and scope are still under revision.

**Stripping is decoupled from validation, so a malformed block never reaches the reader.**

That is the whole idea, and it is worth stating before anything else. When a model embeds a JSON
control block inside prose, two things can go wrong, and they are not equally bad:

- The block is broken, so the action it requested doesn't happen. A die goes unrolled; an
  illustration doesn't render. The story continues. Nobody files a bug.
- The block is broken, so it gets left in the text. The reader sees
  `{"type":"DICE_REQUEST","player":"char-abc","modifier":` sitting in the middle of a paragraph.
  The fiction breaks, the product looks unfinished, and *that* is the screenshot that gets shared.

A pipeline that strips only what it successfully validated makes the second failure a direct
consequence of the first: every parse error becomes a visible leak. So this one doesn't. Each
extractor makes two independent passes — one that looks for a block it can *use*, and one that
removes every block it can *find*. The removal pass is unconditional. It runs over the raw text,
not over the validated result, and it takes the wrapping markdown fence with it so no empty code
box is left behind either.

The structured value degrades to `null`. The prose stays clean.

```ts
import { extractProtocolBlocks } from "llm-structured-output";

const { narrative, diceRequest, imageRequest } = extractProtocolBlocks(modelResponse);
// narrative    → prose only, every control block removed, valid or not
// diceRequest  → the first valid block, or null
// imageRequest → the first valid block, normalized, or null
```

## The problem

Some responses have to be two things at once: prose a person reads, and structured data a program
acts on. A game master narrates a scene *and* asks the engine to roll a d20 against a hidden DC. A
support agent writes a reply *and* signals a ticket escalation. A tutor explains a concept *and*
emits a confidence score for the grading pipeline. The prose is the product; the structure is a
side-channel that has to travel alongside it in the same turn. The usual approach is to define a
JSON shape, describe it in the system prompt, and hope. The model mostly complies — and the
interesting engineering is entirely in what happens when it doesn't: the truncated object, the
number that arrived as a string, the enum value it invented, the block it decided to emit
mid-sentence. This library is the parsing, validation, normalization, and stripping layer for that
side-channel, extracted from a production system and reduced to pure functions so the failure modes
can be tested directly.

## Why not provider-native structured output / tool use?

Fair question, and it should be the first one. Anthropic's tool use and OpenAI's structured outputs
/ JSON mode both constrain a response to a schema at the decoding layer, with provider-side
guarantees this library cannot offer. If you need one JSON object out of one call, use them. They
are strictly better than a regex.

The tradeoff is that they constrain **the response**, and this design needs a response that is
*mostly prose* with a structured aside embedded in it:

- **Schema-constrained output kills the prose.** Turn on JSON mode and the narrative becomes a
  string field inside an object — which sounds equivalent and isn't. You lose token-level streaming
  of the narrative as narrative, you pay JSON escaping on every quote and newline in creative text,
  and in practice the prose gets measurably stiffer when it is generated as a field value rather
  than as the response.
- **Tool use is a control-flow decision, not a side-channel.** A tool call is the model choosing to
  stop and call a function. That is exactly right for the dice case (the model *does* stop and wait)
  and exactly wrong for the image case, where the signal must not interrupt the story — the model is
  told to keep narrating straight past it. One mechanism has to cover both.
- **A second call doubles latency and cost per turn.** Generate the prose, then re-read it with a
  structured-output call to extract the intent. It works, it is clean, and it adds a full round trip
  and a second billed request to every single turn of an interactive session. For a real-time
  experience that is the expensive option, not the safe one.

**What this gives up, plainly:** the provider-side guarantee. There is no grammar constraining the
decoder here — the schema lives in the prompt, and the prompt is a suggestion. Everything
downstream is hand-rolled: the pattern that finds candidates, the field-by-field validators, the
normalization of the fields the validator is lenient about. You own the failure modes instead of
renting them. The bet is that owning them is acceptable *if and only if* the worst one is contained
— which is why the strip is unconditional, and why most of this repository is tests.

## What's in here

| Unit | File | Job |
| --- | --- | --- |
| Types | `src/types.ts` | The protocol shapes. Plain data, no dependencies. |
| Patterns | `src/patterns.ts` | Two regexes per block type: one to *find* candidates, a wider one to *remove* them. |
| Validation | `src/validate.ts` | Field-by-field checks against `unknown`. No casts, no trust. |
| Normalization | `src/normalize.ts` | Fill the gaps validation was deliberately lenient about. |
| Extraction | `src/extract.ts` | Two passes over the text; the removal pass is unconditional. |

The two concrete block types (`DICE_REQUEST`, `IMAGE_REQUEST`) are the real implementation, ported
faithfully rather than generalized into a schema framework it never was. They are worth reading as
a worked example of a design decision rather than a library to configure: the dice validator is
**strict** because a `modifier` silently coerced from `"+3"` is a wrong roll nobody notices, while
the image validator is **lenient** about `subjectId` and `negativePrompt` because a missing slug
should not cost the reader their picture. Same pipeline, opposite strictness, both defensible —
because the two failures cost different amounts.

## Tests

```bash
npm install
npm test         # vitest, 39 tests
npm run typecheck
npm run build
```

The tests are the artifact. These are pure functions over strings with no I/O, no network, and no
clock, so every interesting failure mode is directly expressible as an input. Covered:

- **Happy path** — a valid `DICE_REQUEST` and a valid `IMAGE_REQUEST`, including fence removal and
  the normalization defaults.
- **The decoupling guarantee** — a block that *fails* validation is still stripped, and the
  reader-facing narrative is asserted clean. Also the parse-error case, and the case where several
  candidates are all rejected and all removed.
- **Wrong field types** — `modifier` as a string, `modifier` as null, `dc` as a string, a missing
  required field, a dice type outside the enum, an empty prompt, an invented tone.
- **Placement** — a block emitted mid-sentence, at the very start, and between paragraphs (no
  blank-line crater left behind).
- **Two blocks in one response** — first valid one wins and the rest are stripped; an invalid first
  candidate is skipped in favour of a valid second; both block types in the same turn, in either
  order.
- **Known limitations, pinned deliberately** — see below.

### Known limitations

These are pinned by tests so the gaps are documented and any future fix is a visible, intentional
change:

- **A block truncated before its closing brace is not stripped.** The classic `max_tokens` cutoff.
  With no `}` there is nothing for the pattern to delimit, so the fragment survives into the text.
  The structured value is still correctly `null` — no half-parsed roll is ever fabricated — but this
  is the one case the strip cannot cover, and it is the honest boundary of the guarantee above. A
  cheap mitigation outside this library: check `stop_reason` and discard or retry a truncated turn.
- **A block containing a nested object is neither parsed nor stripped.** The pattern refuses nested
  braces on purpose; a greedy alternative would swallow paragraphs of prose between two unrelated
  braces. Flat blocks are a contract with the prompt.
- **The dice strip removes the JSON but not a wrapping fence**, where the image strip removes both.
  This asymmetry is ported as-is from the source system: a dice block ends a beat and the model
  stops there, so a trailing empty code box is far less visible than one mid-paragraph. It is still
  a rough edge.

## License

MIT.
