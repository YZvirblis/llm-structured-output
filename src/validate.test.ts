import { describe, expect, it } from "vitest";

import { normalizeImageRequest } from "./normalize.js";
import { DEFAULT_NEGATIVE_PROMPT } from "./types.js";
import { isValidDiceRequest, isValidImageRequest } from "./validate.js";

describe("isValidDiceRequest", () => {
  it("accepts a fully-populated request", () => {
    expect(
      isValidDiceRequest({
        type: "DICE_REQUEST",
        player: "c1",
        diceType: "d20",
        modifier: -1,
        modifierSource: "Stealth (DEX)",
        reason: "Crossing the courtyard unseen",
        dc: 15,
      }),
    ).toBe(true);
  });

  it("rejects non-objects outright", () => {
    // `JSON.parse` happily returns these; none of them are a dice request.
    for (const value of [null, undefined, "DICE_REQUEST", 42, true, []]) {
      expect(isValidDiceRequest(value)).toBe(false);
    }
  });

  it("rejects a block whose type tag is for the other protocol", () => {
    expect(
      isValidDiceRequest({
        type: "IMAGE_REQUEST",
        player: "c1",
        diceType: "d20",
        modifier: 0,
        modifierSource: "x",
        reason: "y",
      }),
    ).toBe(false);
  });

  it("rejects every dice type outside the enum", () => {
    for (const diceType of ["d7", "D20", "d20 ", "20", ""]) {
      expect(
        isValidDiceRequest({
          type: "DICE_REQUEST",
          player: "c1",
          diceType,
          modifier: 0,
          modifierSource: "x",
          reason: "y",
        }),
      ).toBe(false);
    }
  });
});

describe("isValidImageRequest", () => {
  it("accepts a request missing only the lenient fields", () => {
    expect(
      isValidImageRequest({
        type: "IMAGE_REQUEST",
        subject: "moment",
        prompt: "a shattered sword half-buried in ash",
        tone: "heroic",
      }),
    ).toBe(true);
  });

  it("rejects non-objects outright", () => {
    for (const value of [null, undefined, "IMAGE_REQUEST", 0, []]) {
      expect(isValidImageRequest(value)).toBe(false);
    }
  });

  it("rejects a whitespace-only prompt", () => {
    expect(
      isValidImageRequest({
        type: "IMAGE_REQUEST",
        subject: "npc",
        prompt: "\n\t  ",
        tone: "dark",
      }),
    ).toBe(false);
  });
});

describe("normalizeImageRequest", () => {
  it("fills the gaps validation deliberately allowed through", () => {
    expect(
      normalizeImageRequest({
        type: "IMAGE_REQUEST",
        subject: "npc",
        prompt: " a grey-bearded innkeeper polishing a tankard ",
        tone: "comedic",
      }),
    ).toEqual({
      type: "IMAGE_REQUEST",
      subject: "npc",
      subjectId: null,
      prompt: "a grey-bearded innkeeper polishing a tankard",
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      caption: "",
      tone: "comedic",
    });
  });

  it("keeps a caller-supplied negativePrompt and trims it", () => {
    const result = normalizeImageRequest({
      type: "IMAGE_REQUEST",
      subject: "location",
      subjectId: "  the-old-mill  ",
      prompt: "a derelict watermill",
      negativePrompt: "  text, watermark  ",
      caption: "The Old Mill",
      tone: "mystery",
    });

    expect(result.negativePrompt).toBe("text, watermark");
    expect(result.subjectId).toBe("the-old-mill");
  });

  it("falls back to the default when negativePrompt is a non-string", () => {
    const result = normalizeImageRequest({
      type: "IMAGE_REQUEST",
      subject: "moment",
      prompt: "a lantern guttering out",
      negativePrompt: 0,
      tone: "dark",
    });

    expect(result.negativePrompt).toBe(DEFAULT_NEGATIVE_PROMPT);
  });
});
