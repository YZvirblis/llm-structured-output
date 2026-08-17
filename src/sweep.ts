/**
 * Final narrative sweep — the last thing that runs before text reaches a
 * reader.
 *
 * The extract/validate/strip pipeline removes protocol *blocks*. This removes
 * the *debris* those blocks leave behind. The two are separate jobs: the strip
 * knows what a block looks like, the sweep knows what the hole looks like
 * afterwards.
 *
 * Two kinds of debris:
 *
 *   1. An empty markdown code fence. The model is shown fenced examples in the
 *      prompt, so it often wraps a block in one. Strip the JSON and the fence
 *      pair survives, which a markdown renderer turns into an empty code box
 *      sitting in the middle of the prose. Just as visible as the raw JSON
 *      would have been, and just as wrong.
 *
 *   2. A bare orphaned protocol marker on a line of its own — a stray
 *      `DICE_REQUEST` or `[IMAGE_REQUEST]` label with no JSON attached.
 *
 * ─── What this sweep deliberately does NOT do ───────────────────────────────
 *
 * It does not try to remove JSON *fragments*. A truncated block
 * (`{"type":"DICE_REQUEST","player":"ch`) has no closing delimiter, and
 * deciding where it ends is the balanced-delimiter problem the matcher
 * deliberately does not solve. Guessing "it ends at the newline" is still a
 * guess, and a wrong guess eats prose. Those fragments stay, and they stay
 * pinned by tests as a known limitation of the matcher.
 *
 * Likewise, a marker embedded in prose (`"...emit a DICE_REQUEST now..."`) is
 * left alone: deleting the token mid-sentence produces mangled prose, which is
 * worse than the token. Only a whole line that is nothing but a marker goes.
 *
 * Every rule here fails closed. When the structure is ambiguous, the text is
 * returned untouched.
 */

import { tidyNarrative } from "./patterns.js";

/**
 * A line whose entire content is a protocol marker plus light decoration —
 * quotes, brackets, angle brackets, a trailing colon or comma.
 *
 * Anchored to the whole line on purpose. A line that merely *contains* the
 * token (prose, or a truncated JSON fragment starting with `{`) does not
 * match, so this can never bite into a sentence or half-delete a fragment.
 */
const ORPHAN_MARKER_LINE_REGEX =
  /^[ \t]*["'`[<(]*[ \t]*(?:DICE_REQUEST|IMAGE_REQUEST)[ \t]*["'`\]>)]*[ \t]*[:,]?[ \t]*(?:\r?\n|$)/gm;

/** A run of three or more backticks. Nothing else — see `isEmptyBlock`. */
const FENCE_TOKEN_REGEX = /`{3,}/g;

/**
 * An info string occupying the remainder of the opening fence's line
 * (` ```json `, ` ```ts `) — the word plus the newline that ends the line.
 */
const INFO_STRING_PREFIX_REGEX = /^[ \t]*[A-Za-z0-9_+-]*[ \t]*(?:\r?\n|$)/;

/**
 * Is the text between a fence pair nothing but whitespace?
 *
 * An info string does not count as content: ` ```json ` wrapped around a
 * stripped block still renders as an empty box, and the word `json` must not
 * be what keeps it alive. But the info string is only discounted when the
 * block actually spans lines. Inline ` ```hello``` ` is an inline code span
 * whose "info string" is the content, and deleting it would eat prose.
 */
function isEmptyBlock(content: string): boolean {
  if (!content.includes("\n")) return content.trim() === "";
  return content.replace(INFO_STRING_PREFIX_REGEX, "").trim() === "";
}

/**
 * Remove fenced code blocks whose contents are whitespace-only.
 *
 * Works on fence *parity* rather than pattern-matching a ``` ``` pair
 * directly, because a naive pair match cannot tell an empty block from the
 * seam between two adjacent non-empty ones — it would happily delete the
 * closing fence of one code block and the opening fence of the next, welding
 * them together. Tokens are paired in order (1st opens, 2nd closes, 3rd
 * opens, …) and only a pair with nothing but whitespace between it is
 * removed.
 *
 * Fails closed on an odd number of fence tokens: an unbalanced document means
 * the pairing is guesswork (a stray ``` in prose shifts every pair after it),
 * so nothing is removed at all.
 */
function removeEmptyFences(text: string): string {
  const tokens: { start: number; end: number }[] = [];
  FENCE_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_TOKEN_REGEX.exec(text)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length });
  }

  // Nothing to pair, or the fences do not balance — leave the text alone.
  if (tokens.length < 2 || tokens.length % 2 !== 0) return text;

  const empty: { start: number; end: number }[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const open = tokens[i]!;
    const close = tokens[i + 1]!;
    if (isEmptyBlock(text.slice(open.end, close.start))) {
      empty.push({ start: open.start, end: close.end });
    }
  }
  if (empty.length === 0) return text;

  // Back to front, so earlier offsets stay valid.
  let out = text;
  for (let i = empty.length - 1; i >= 0; i--) {
    const span = empty[i]!;
    out = out.slice(0, span.start) + out.slice(span.end);
  }
  return out;
}

/**
 * Sweep protocol debris out of a narrative and tidy what the removal left.
 *
 * Pure, idempotent, and safe to run on text that contains no debris at all —
 * prose with nothing to remove comes back unchanged.
 *
 * Marker lines go first: clearing one can empty a fence that then becomes
 * removable in the same pass.
 */
export function sweepNarrative(text: string): string {
  const withoutMarkers = text.replace(ORPHAN_MARKER_LINE_REGEX, "");
  const withoutEmptyFences = removeEmptyFences(withoutMarkers);
  return tidyNarrative(withoutEmptyFences);
}
