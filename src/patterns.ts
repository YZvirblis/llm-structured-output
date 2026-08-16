/**
 * The regexes that find protocol blocks in prose.
 *
 * Two distinct jobs, deliberately kept as two distinct patterns per block
 * type:
 *
 *   *_REQUEST_REGEX       — find CANDIDATES to parse and validate.
 *   *_REQUEST_STRIP_REGEX — find everything to REMOVE from the narrative.
 *
 * The strip pattern is a superset of the match pattern, and stripping runs
 * unconditionally over every candidate — including the ones validation
 * rejected. See `extract.ts` for why that decoupling is the whole point.
 *
 * `[^{}]*` deliberately refuses to match nested braces. A protocol block is
 * flat by contract, and a greedy `.*` would happily swallow half a paragraph
 * of prose between two unrelated braces.
 */

/** Candidate DICE_REQUEST objects. Flat JSON only. */
export const DICE_REQUEST_REGEX = /\{[^{}]*"type"\s*:\s*"DICE_REQUEST"[^{}]*\}/g;

/**
 * What to remove from the narrative for a dice request.
 *
 * NOTE — asymmetry with the image pattern below, ported as-is from the
 * original implementation: the dice strip removes the JSON only, not a
 * markdown fence wrapped around it. In practice the dice block ends a beat
 * and the model stops there, so a trailing orphan fence is far less visible
 * than one sitting mid-paragraph. It is still a rough edge, and
 * `extract.test.ts` pins the current behaviour so any future tightening is a
 * deliberate change rather than an accident.
 */
export const DICE_REQUEST_STRIP_REGEX = DICE_REQUEST_REGEX;

/** Candidate IMAGE_REQUEST objects. Flat JSON only. */
export const IMAGE_REQUEST_REGEX = /\{[^{}]*"type"\s*:\s*"IMAGE_REQUEST"[^{}]*\}/g;

/**
 * What to remove from the narrative for an image request — the JSON plus any
 * fence the model wrapped it in.
 *
 * The prompt's example shows the block inside a fenced code block, so the
 * model frequently emits one. Removing only the JSON would leave a bare
 * ``` ``` pair in the text, which a markdown renderer turns into an empty
 * code box sitting in the middle of the story. That empty box is exactly the
 * visible artifact the "the reader never sees the protocol" requirement is
 * about, so the fence goes with it.
 *
 * Both fence halves are optional and independent, so an unbalanced fence
 * (opened, never closed) still strips whatever is there.
 */
export const IMAGE_REQUEST_STRIP_REGEX =
  /(?:```[a-zA-Z]*[ \t]*\r?\n?)?\{[^{}]*"type"\s*:\s*"IMAGE_REQUEST"[^{}]*\}(?:[ \t]*\r?\n?```)?/g;

/**
 * Collapse the blank-line craters left behind by a removed block, then trim.
 *
 * Applied after every strip: cutting a block that sat on its own line between
 * two paragraphs leaves three or more consecutive newlines, which renders as
 * a conspicuous gap.
 */
export function tidyNarrative(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
