/**
 * Field-by-field validators for parsed protocol blocks.
 *
 * `JSON.parse` succeeding tells you the bytes were JSON. It tells you nothing
 * about whether the model filled in the fields you asked for, with the types
 * you asked for, from the enums you asked for. Every field is checked
 * explicitly against `unknown` — no casts, no trusting the shape.
 */

import type {
  DiceRequest,
  DiceType,
  ImageRequestSubject,
  ImageRequestTone,
} from "./types.js";

export const VALID_DICE_TYPES: readonly DiceType[] = [
  "d4",
  "d6",
  "d8",
  "d10",
  "d12",
  "d20",
  "d100",
];

export const VALID_IMAGE_SUBJECTS: readonly ImageRequestSubject[] = [
  "npc",
  "location",
  "moment",
];

export const VALID_IMAGE_TONES: readonly ImageRequestTone[] = [
  "dark",
  "heroic",
  "comedic",
  "mystery",
];

/**
 * Validate a DICE_REQUEST candidate.
 *
 * Strict: every field is load-bearing. `modifier` feeds arithmetic, so a
 * string "+3" is rejected rather than coerced — a silently coerced modifier
 * is a wrong roll that nobody notices. `dc` is the one optional field, and
 * when present it must be a number.
 */
export function isValidDiceRequest(value: unknown): value is DiceRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === "DICE_REQUEST" &&
    typeof v.player === "string" &&
    typeof v.diceType === "string" &&
    VALID_DICE_TYPES.includes(v.diceType as DiceType) &&
    typeof v.modifier === "number" &&
    typeof v.modifierSource === "string" &&
    typeof v.reason === "string" &&
    (v.dc === undefined || typeof v.dc === "number")
  );
}

/**
 * Validate an IMAGE_REQUEST candidate.
 *
 * Deliberately lenient where the dice validator is strict, because the
 * consequences differ. A missing `negativePrompt` or a `subjectId` the model
 * forgot should not cost the reader their illustration, so those are filled
 * in by `normalizeImageRequest` rather than rejected here. Only the fields
 * that cannot be invented — a non-empty prompt, a known subject, a known
 * tone — are hard requirements.
 */
export function isValidImageRequest(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === "IMAGE_REQUEST" &&
    typeof v.subject === "string" &&
    VALID_IMAGE_SUBJECTS.includes(v.subject as ImageRequestSubject) &&
    typeof v.prompt === "string" &&
    v.prompt.trim().length > 0 &&
    typeof v.tone === "string" &&
    VALID_IMAGE_TONES.includes(v.tone as ImageRequestTone)
  );
}
