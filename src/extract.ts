/**
 * Extraction — pull protocol blocks out of a prose response and hand back
 * the cleaned narrative alongside them.
 *
 * THE LOAD-BEARING DESIGN POINT: stripping is decoupled from validation.
 *
 * Each extractor makes two independent passes over the text. The first pass
 * looks for a block it can actually use, and gives up quietly if it does not
 * find one. The second pass removes EVERY candidate the strip pattern
 * matches, whether or not any of them validated, whether or not any of them
 * even parsed as JSON.
 *
 * That means a truncated, mistyped, or otherwise broken block produces
 * `null` for the structured value — the roll is skipped, the illustration is
 * skipped — but never leaks raw JSON into the text a reader sees. A missing
 * die roll is a small degradation. `{"type":"DICE_REQUEST","player":...`
 * appearing mid-paragraph breaks the fiction outright, and it is the failure
 * that would actually get reported. So the strip is unconditional and runs
 * over the raw text, not over the validated result.
 */

import {
  DICE_REQUEST_REGEX,
  DICE_REQUEST_STRIP_REGEX,
  IMAGE_REQUEST_REGEX,
  IMAGE_REQUEST_STRIP_REGEX,
  tidyNarrative,
} from "./patterns.js";
import { normalizeImageRequest } from "./normalize.js";
import { sweepNarrative } from "./sweep.js";
import type { DiceRequest, ImageRequest } from "./types.js";
import { isValidDiceRequest, isValidImageRequest } from "./validate.js";

/**
 * Pull the first valid DICE_REQUEST block out of the response and return it
 * alongside the cleaned narrative.
 *
 * Multiple dice requests in one response are not supported: the first valid
 * one wins and the rest are stripped. The model is instructed to stop
 * narrating after emitting a request and wait for the result, so a second
 * one in the same turn means it kept going anyway — resolving only the first
 * is the conservative reading, and the extra blocks still leave the text.
 */
export function extractDiceRequest(text: string): {
  narrative: string;
  diceRequest: DiceRequest | null;
} {
  const matches = text.match(DICE_REQUEST_REGEX) ?? [];
  let diceRequest: DiceRequest | null = null;
  for (const raw of matches) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValidDiceRequest(parsed)) {
        diceRequest = parsed;
        break;
      }
      console.warn("[protocol] DICE_REQUEST candidate failed validation:", raw);
    } catch (err) {
      console.warn("[protocol] DICE_REQUEST JSON parse failed:", raw, err);
    }
  }

  // Unconditional — runs over the original text, not over what validated.
  const narrative = tidyNarrative(text.replace(DICE_REQUEST_STRIP_REGEX, ""));
  return { narrative, diceRequest };
}

/**
 * Pull the first valid IMAGE_REQUEST block out of the response and return it
 * alongside the narrative with EVERY candidate block stripped.
 *
 * Blocks are stripped wherever they appear — start, middle, or end — since
 * the model is told to keep narrating past an image signal rather than
 * stopping at it the way a dice request requires. A block landing mid-
 * sentence is therefore normal traffic, not an anomaly.
 */
export function extractImageRequest(text: string): {
  narrative: string;
  imageRequest: ImageRequest | null;
} {
  const matches = text.match(IMAGE_REQUEST_REGEX) ?? [];
  let imageRequest: ImageRequest | null = null;
  for (const raw of matches) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValidImageRequest(parsed)) {
        imageRequest = normalizeImageRequest(parsed);
        break;
      }
      console.warn("[protocol] IMAGE_REQUEST candidate failed validation:", raw);
    } catch (err) {
      console.warn("[protocol] IMAGE_REQUEST JSON parse failed:", raw, err);
    }
  }

  // Unconditional, and wider than the match pattern: takes the wrapping
  // markdown fence with it so no empty code box is left behind.
  const narrative = tidyNarrative(text.replace(IMAGE_REQUEST_STRIP_REGEX, ""));
  return { narrative, imageRequest };
}

/**
 * THE PUBLIC ENTRY POINT. Run both extractors over one response, then sweep
 * the result.
 *
 * Dice first, then image over the already-dice-stripped narrative. The two
 * patterns never overlap, so the order does not affect what is found — it
 * only guarantees each pass sees text the other has already cleaned,
 * regardless of the order the model emitted the blocks in.
 *
 * `sweepNarrative` runs last, over whatever the strip passes left behind. The
 * strips remove blocks; the sweep removes the debris a removed block leaves —
 * chiefly the empty markdown fence the model wrapped it in. Only the narrative
 * this function returns is reader-safe.
 *
 * `extractDiceRequest` and `extractImageRequest` are stage-level primitives:
 * they are exported for testing and for callers assembling their own pipeline,
 * and their output is NOT swept. Anything rendered to a reader should come
 * from here, or be passed through `sweepNarrative` explicitly.
 */
export function extractProtocolBlocks(text: string): {
  narrative: string;
  diceRequest: DiceRequest | null;
  imageRequest: ImageRequest | null;
} {
  const { narrative: afterDice, diceRequest } = extractDiceRequest(text);
  const { narrative: afterImage, imageRequest } = extractImageRequest(afterDice);
  return { narrative: sweepNarrative(afterImage), diceRequest, imageRequest };
}
