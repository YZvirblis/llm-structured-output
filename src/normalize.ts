/**
 * Normalization — turn a validated candidate into the canonical protocol
 * object the rest of the system consumes.
 *
 * Validation answers "is this usable?". Normalization answers "what exactly
 * is it?", filling the gaps validation was lenient about so no downstream
 * consumer has to re-handle a missing field or an untrimmed string.
 */

import {
  DEFAULT_NEGATIVE_PROMPT,
  type ImageRequest,
  type ImageRequestSubject,
  type ImageRequestTone,
} from "./types.js";

/**
 * Build a canonical `ImageRequest` from a candidate that has already passed
 * `isValidImageRequest`. Calling this on an unvalidated object is a bug: the
 * fields the validator guarantees are read here without re-checking.
 *
 * - `subjectId` — absent, blank, or non-string collapses to `null`. It is
 *   null by design for `subject: "moment"` and merely forgotten otherwise;
 *   either way the image is still worth rendering, it just cannot be grouped
 *   with the other images of that entity.
 * - `negativePrompt` — absent or blank falls back to the house default.
 * - `caption` — absent collapses to an empty string rather than `undefined`,
 *   so the renderer has one less case to branch on.
 */
export function normalizeImageRequest(value: unknown): ImageRequest {
  const v = value as Record<string, unknown>;

  const rawSubjectId = typeof v.subjectId === "string" ? v.subjectId.trim() : "";
  const rawNegative = typeof v.negativePrompt === "string" ? v.negativePrompt.trim() : "";

  return {
    type: "IMAGE_REQUEST",
    subject: v.subject as ImageRequestSubject,
    subjectId: rawSubjectId.length > 0 ? rawSubjectId : null,
    prompt: (v.prompt as string).trim(),
    negativePrompt: rawNegative.length > 0 ? rawNegative : DEFAULT_NEGATIVE_PROMPT,
    caption: typeof v.caption === "string" ? v.caption.trim() : "",
    tone: v.tone as ImageRequestTone,
  };
}
