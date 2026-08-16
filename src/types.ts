/**
 * Protocol types.
 *
 * These describe the structured side-channel the model embeds inside an
 * otherwise prose response. They are plain data — no runtime dependencies,
 * no provider SDK types.
 */

export type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d100";

/**
 * The model's request for the platform to roll a die.
 *
 * Emitted as a single-line JSON object inside the narrative. The model is
 * instructed to stop narrating after emitting one and wait for the result.
 */
export interface DiceRequest {
  type: "DICE_REQUEST";
  /** Identifier of the character being asked to roll. */
  player: string;
  diceType: DiceType;
  modifier: number;
  /** Human-readable origin of the modifier, e.g. "Perception (WIS)". */
  modifierSource: string;
  reason: string;
  /**
   * Difficulty Class. Server-side ONLY.
   *
   * The DC must never reach the client: knowing the target number in advance
   * drains the tension out of the roll. The transport layer strips this field
   * before the request is broadcast, and the model is separately instructed
   * never to state the number in prose.
   */
  dc?: number;
}

/** The dice request shape the client is allowed to see — `dc` removed. */
export type PublicDiceRequest = Omit<DiceRequest, "dc">;

/** What a model-signalled illustration depicts. */
export type ImageRequestSubject = "npc" | "location" | "moment";

/** Art-direction bucket the model picks to match the scene. */
export type ImageRequestTone = "dark" | "heroic" | "comedic" | "mystery";

/**
 * The model's signal that a beat deserves an illustration. Embedded as a JSON
 * block in the response and stripped before the narrative reaches the reader,
 * exactly like `DiceRequest`.
 *
 * Unlike a dice request, an image request does not interrupt the story — the
 * model keeps narrating straight past it, so the block can appear anywhere in
 * the text rather than only at the end of a beat.
 */
export interface ImageRequest {
  type: "IMAGE_REQUEST";
  subject: ImageRequestSubject;
  /**
   * Stable slug for the depicted entity — `"mira-the-innkeeper"`,
   * `"the-rusty-flagon-tavern"` — reused every time the model revisits it,
   * and null for `subject: "moment"` (a dramatic beat is not a persistent
   * thing). Carried so downstream persistence can group images by entity.
   */
  subjectId: string | null;
  prompt: string;
  /**
   * Terms to steer the image model away from. Part of the protocol even when
   * the image provider in use exposes no negative-prompt parameter, so that
   * swapping providers needs no protocol change.
   */
  negativePrompt: string;
  /** Reader-facing caption rendered beneath the image. */
  caption: string;
  tone: ImageRequestTone;
}

/** Fallback applied when the model omits `negativePrompt` or leaves it blank. */
export const DEFAULT_NEGATIVE_PROMPT = "blurry, low quality, text, watermark, nsfw";
