import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractDiceRequest,
  extractImageRequest,
  extractProtocolBlocks,
} from "./extract.js";
import { DEFAULT_NEGATIVE_PROMPT } from "./types.js";

/** Markdown fence, kept out of the template literals below for readability. */
const FENCE = "```";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Every rejected block logs. Silence it so the suite output stays readable,
  // while still letting individual tests assert the logging happened.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const validDice = `{"type":"DICE_REQUEST","player":"char-abc","diceType":"d20","modifier":3,"modifierSource":"Sleight of Hand (DEX)","reason":"Picking the rusted lock","dc":14}`;

const validImage = `{"type":"IMAGE_REQUEST","subject":"location","subjectId":"the-rusty-flagon-tavern","prompt":"a low-beamed tavern common room lit by a peat fire, rain on the shutters","negativePrompt":"blurry, low quality","caption":"The Rusty Flagon","tone":"dark"}`;

// ───────────────────────────────────────────────────────────── happy path ──

describe("happy path", () => {
  it("extracts a valid DICE_REQUEST and returns clean narrative", () => {
    const text = `You crouch by the door, lifting the cold iron lock to the lamplight.\n\n${validDice}`;

    const { narrative, diceRequest } = extractDiceRequest(text);

    expect(diceRequest).toEqual({
      type: "DICE_REQUEST",
      player: "char-abc",
      diceType: "d20",
      modifier: 3,
      modifierSource: "Sleight of Hand (DEX)",
      reason: "Picking the rusted lock",
      dc: 14,
    });
    expect(narrative).toBe(
      "You crouch by the door, lifting the cold iron lock to the lamplight.",
    );
    expect(narrative).not.toContain("DICE_REQUEST");
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a DICE_REQUEST with no dc (the only optional field)", () => {
    const text = `{"type":"DICE_REQUEST","player":"c1","diceType":"d6","modifier":0,"modifierSource":"none","reason":"Fumbling in the dark"}`;

    const { diceRequest } = extractDiceRequest(text);

    expect(diceRequest?.dc).toBeUndefined();
    expect(diceRequest?.diceType).toBe("d6");
  });

  it("extracts a valid IMAGE_REQUEST and removes its wrapping fence", () => {
    const text = `The road bends, and the tavern comes into view.\n\n${FENCE}\n${validImage}\n${FENCE}\n\nRain drums on the sign above the door.`;

    const { narrative, imageRequest } = extractImageRequest(text);

    expect(imageRequest).toEqual({
      type: "IMAGE_REQUEST",
      subject: "location",
      subjectId: "the-rusty-flagon-tavern",
      prompt:
        "a low-beamed tavern common room lit by a peat fire, rain on the shutters",
      negativePrompt: "blurry, low quality",
      caption: "The Rusty Flagon",
      tone: "dark",
    });
    expect(narrative).toBe(
      "The road bends, and the tavern comes into view.\n\nRain drums on the sign above the door.",
    );
    // The fence must go with the JSON — leaving it behind renders as an
    // empty code box sitting in the middle of the story.
    expect(narrative).not.toContain(FENCE);
    expect(narrative).not.toContain("IMAGE_REQUEST");
  });

  it("normalizes the fields the image validator is lenient about", () => {
    const text = `{"type":"IMAGE_REQUEST","subject":"moment","prompt":"  a shattered sword half-buried in ash  ","caption":"  Aftermath  ","tone":"heroic"}`;

    const { imageRequest } = extractImageRequest(text);

    expect(imageRequest).toEqual({
      type: "IMAGE_REQUEST",
      subject: "moment",
      subjectId: null, // absent → null, not undefined
      prompt: "a shattered sword half-buried in ash", // trimmed
      negativePrompt: DEFAULT_NEGATIVE_PROMPT, // absent → house default
      caption: "Aftermath", // trimmed
      tone: "heroic",
    });
  });

  it("collapses a blank subjectId to null rather than an empty string", () => {
    const text = `{"type":"IMAGE_REQUEST","subject":"npc","subjectId":"   ","prompt":"a grey-bearded innkeeper","caption":"Mira","tone":"comedic"}`;

    expect(extractImageRequest(text).imageRequest?.subjectId).toBeNull();
  });
});

// ───────────────────────────────────── the decoupling guarantee (the point) ──

describe("strip is decoupled from validation", () => {
  it("strips a DICE_REQUEST that FAILS validation — narrative stays clean", () => {
    // `modifier` is a string. Real failure: a coerced "+3" is a wrong roll
    // nobody notices, so the validator rejects it outright.
    const bad = `{"type":"DICE_REQUEST","player":"char-abc","diceType":"d20","modifier":"+3","modifierSource":"Athletics (STR)","reason":"Hauling the portcullis"}`;
    const text = `The portcullis is heavier than it looks.\n\n${bad}`;

    const { narrative, diceRequest } = extractDiceRequest(text);

    expect(diceRequest).toBeNull(); // rejected...
    expect(narrative).toBe("The portcullis is heavier than it looks."); // ...but gone
    expect(narrative).not.toContain("DICE_REQUEST");
    expect(narrative).not.toContain("{");
    expect(warn).toHaveBeenCalled();
  });

  it("strips an IMAGE_REQUEST that FAILS validation, fence and all", () => {
    // `subject` is not one of npc|location|moment.
    const bad = `{"type":"IMAGE_REQUEST","subject":"creature","subjectId":"grey-wolf","prompt":"a grey wolf on a ridge","caption":"The Wolf","tone":"dark"}`;
    const text = `Something moves on the ridge.\n\n${FENCE}json\n${bad}\n${FENCE}\n\nThe wind shifts.`;

    const { narrative, imageRequest } = extractImageRequest(text);

    expect(imageRequest).toBeNull();
    expect(narrative).toBe("Something moves on the ridge.\n\nThe wind shifts.");
    expect(narrative).not.toContain("IMAGE_REQUEST");
    expect(narrative).not.toContain(FENCE);
    expect(warn).toHaveBeenCalled();
  });

  it("strips a block whose JSON does not even parse", () => {
    // Balanced braces, broken JSON — a trailing comma and a missing value.
    const bad = `{"type":"DICE_REQUEST","player":"char-abc","diceType":"d20","modifier":,}`;
    const text = `You reach for the latch.\n\n${bad}\n\nThe hinge groans.`;

    const { narrative, diceRequest } = extractDiceRequest(text);

    expect(diceRequest).toBeNull();
    expect(narrative).toBe("You reach for the latch.\n\nThe hinge groans.");
    expect(warn).toHaveBeenCalledWith(
      "[protocol] DICE_REQUEST JSON parse failed:",
      bad,
      expect.anything(),
    );
  });

  it("strips every rejected candidate, not just the first", () => {
    const bad1 = `{"type":"IMAGE_REQUEST","subject":"creature","prompt":"a wolf","tone":"dark"}`;
    const bad2 = `{"type":"IMAGE_REQUEST","subject":"npc","prompt":"","tone":"dark"}`;
    const text = `First. ${bad1} Second. ${bad2} Third.`;

    const { narrative, imageRequest } = extractImageRequest(text);

    expect(imageRequest).toBeNull();
    expect(narrative).not.toContain("IMAGE_REQUEST");
    expect(narrative).toContain("First.");
    expect(narrative).toContain("Second.");
    expect(narrative).toContain("Third.");
  });
});

// ─────────────────────────────────────────────────────── malformed fields ──

describe("field-level malformation", () => {
  const rejectedDice: [string, string][] = [
    [
      "missing modifierSource",
      `{"type":"DICE_REQUEST","player":"c1","diceType":"d20","modifier":2,"reason":"A check"}`,
    ],
    [
      "missing player",
      `{"type":"DICE_REQUEST","diceType":"d20","modifier":2,"modifierSource":"WIS","reason":"A check"}`,
    ],
    [
      "diceType outside the enum",
      `{"type":"DICE_REQUEST","player":"c1","diceType":"d7","modifier":2,"modifierSource":"WIS","reason":"A check"}`,
    ],
    [
      "dc sent as a string",
      `{"type":"DICE_REQUEST","player":"c1","diceType":"d20","modifier":2,"modifierSource":"WIS","reason":"A check","dc":"14"}`,
    ],
    [
      "modifier sent as null",
      `{"type":"DICE_REQUEST","player":"c1","diceType":"d20","modifier":null,"modifierSource":"WIS","reason":"A check"}`,
    ],
  ];

  it.each(rejectedDice)("rejects and strips a dice block with %s", (_label, block) => {
    const { narrative, diceRequest } = extractDiceRequest(`Prose. ${block} More prose.`);

    expect(diceRequest).toBeNull();
    expect(narrative).not.toContain("DICE_REQUEST");
  });

  const rejectedImage: [string, string][] = [
    [
      "an empty prompt",
      `{"type":"IMAGE_REQUEST","subject":"npc","prompt":"   ","caption":"x","tone":"dark"}`,
    ],
    [
      "a missing prompt",
      `{"type":"IMAGE_REQUEST","subject":"npc","caption":"x","tone":"dark"}`,
    ],
    [
      "a tone outside the enum",
      `{"type":"IMAGE_REQUEST","subject":"npc","prompt":"an innkeeper","caption":"x","tone":"whimsical"}`,
    ],
    [
      "a numeric subject",
      `{"type":"IMAGE_REQUEST","subject":2,"prompt":"an innkeeper","caption":"x","tone":"dark"}`,
    ],
  ];

  it.each(rejectedImage)("rejects and strips an image block with %s", (_label, block) => {
    const { narrative, imageRequest } = extractImageRequest(`Prose. ${block} More prose.`);

    expect(imageRequest).toBeNull();
    expect(narrative).not.toContain("IMAGE_REQUEST");
  });
});

// ─────────────────────────────────────────────────────── placement in text ──

describe("block placement", () => {
  it("strips a block the model emitted mid-sentence", () => {
    const text = `The innkeeper looks up as you enter. ${validImage} She sets down the glass she was drying.`;

    const { narrative, imageRequest } = extractImageRequest(text);

    expect(imageRequest?.subjectId).toBe("the-rusty-flagon-tavern");
    expect(narrative).not.toContain("IMAGE_REQUEST");
    // Only newline runs are tidied, so the removal leaves the two spaces that
    // used to bracket the block. Cosmetic, and invisible once rendered.
    expect(narrative).toBe(
      "The innkeeper looks up as you enter.  She sets down the glass she was drying.",
    );
  });

  it("strips a block at the very start of the response", () => {
    const { narrative, imageRequest } = extractImageRequest(
      `${validImage}\n\nThe door swings shut behind you.`,
    );

    expect(imageRequest).not.toBeNull();
    expect(narrative).toBe("The door swings shut behind you.");
  });

  it("does not leave a blank-line crater where a block used to be", () => {
    const text = `Paragraph one.\n\n${validDice}\n\nParagraph two.`;

    const { narrative } = extractDiceRequest(text);

    expect(narrative).toBe("Paragraph one.\n\nParagraph two.");
    expect(narrative).not.toMatch(/\n{3,}/);
  });

  it("returns the text untouched when there is no protocol block at all", () => {
    const text = "The tavern is tense. Every patron is minding their own business.";

    expect(extractProtocolBlocks(text)).toEqual({
      narrative: text,
      diceRequest: null,
      imageRequest: null,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────── two blocks in a turn ──

describe("multiple blocks in one response", () => {
  it("takes the first valid dice request and strips the rest", () => {
    const second = `{"type":"DICE_REQUEST","player":"char-xyz","diceType":"d8","modifier":1,"modifierSource":"Stealth (DEX)","reason":"Slipping past the guard"}`;
    const text = `Setup.\n\n${validDice}\n\nMore prose.\n\n${second}`;

    const { narrative, diceRequest } = extractDiceRequest(text);

    expect(diceRequest?.player).toBe("char-abc"); // first wins
    expect(narrative).not.toContain("DICE_REQUEST");
    expect(narrative).toBe("Setup.\n\nMore prose.");
  });

  it("skips an invalid first candidate and uses the valid second one", () => {
    const bad = `{"type":"IMAGE_REQUEST","subject":"creature","prompt":"a wolf","tone":"dark"}`;
    const text = `Prose. ${bad} More prose. ${validImage} End.`;

    const { narrative, imageRequest } = extractImageRequest(text);

    expect(imageRequest?.subject).toBe("location");
    expect(narrative).not.toContain("IMAGE_REQUEST");
    expect(warn).toHaveBeenCalledTimes(1); // only the rejected one logged
  });

  it("extracts a dice request and an image request from the same response", () => {
    const text = `The hall is vast and cold.\n\n${FENCE}\n${validImage}\n${FENCE}\n\nYou steady yourself before the door.\n\n${validDice}`;

    const { narrative, diceRequest, imageRequest } = extractProtocolBlocks(text);

    expect(diceRequest?.diceType).toBe("d20");
    expect(imageRequest?.subject).toBe("location");
    expect(narrative).toBe(
      "The hall is vast and cold.\n\nYou steady yourself before the door.",
    );
    expect(narrative).not.toMatch(/DICE_REQUEST|IMAGE_REQUEST/);
  });

  it("handles the two block types emitted in either order", () => {
    const diceFirst = extractProtocolBlocks(`A. ${validDice} B. ${validImage} C.`);
    const imageFirst = extractProtocolBlocks(`A. ${validImage} B. ${validDice} C.`);

    for (const result of [diceFirst, imageFirst]) {
      expect(result.diceRequest).not.toBeNull();
      expect(result.imageRequest).not.toBeNull();
      expect(result.narrative).not.toMatch(/DICE_REQUEST|IMAGE_REQUEST/);
      expect(result.narrative).not.toContain("{");
    }
  });
});

// ───────────────────────────────────────────────────────── known limitations ──
//
// These tests pin behaviour the current design does NOT handle, so the gaps
// are documented and any future fix is a deliberate, visible change rather
// than an accident. They are honest failure modes of a regex over prose.

describe("known limitations (pinned, not endorsed)", () => {
  it("cannot strip a block truncated before its closing brace", () => {
    // The classic max_tokens cutoff. With no `}` there is nothing for the
    // pattern to delimit, so the fragment survives into the narrative. The
    // structured value is still correctly null — no half-parsed roll is ever
    // fabricated — but this is the one case the strip cannot cover.
    const truncated = `{"type":"DICE_REQUEST","player":"char-abc","diceType":"d20","modifier":3,"modifierSource":"Perc`;
    const text = `You scan the treeline.\n\n${truncated}`;

    const { narrative, diceRequest } = extractDiceRequest(text);

    expect(diceRequest).toBeNull();
    expect(narrative).toContain("DICE_REQUEST"); // <- the leak, documented
    expect(warn).not.toHaveBeenCalled(); // never matched, so never logged
  });

  it("cannot match a block containing nested objects", () => {
    // `[^{}]*` refuses nested braces on purpose: a greedy `.*` would swallow
    // paragraphs of prose between two unrelated braces. The cost is that a
    // block with a nested object is neither parsed nor stripped.
    const nested = `{"type":"IMAGE_REQUEST","subject":"npc","prompt":"an innkeeper","meta":{"seed":7},"tone":"dark"}`;

    const { narrative, imageRequest } = extractImageRequest(`Prose. ${nested}`);

    expect(imageRequest).toBeNull();
    expect(narrative).toContain("IMAGE_REQUEST"); // <- the leak, documented
  });

  it("leaves an orphan fence behind at the DICE STAGE (asymmetric with images)", () => {
    // The dice strip pattern removes the JSON only, where the image strip
    // takes the fence with it. Ported as-is, and still visible here because
    // the stage-level extractors are not swept.
    //
    // This asymmetry no longer reaches a reader: `sweepNarrative` clears the
    // empty fence at the entry point. See the entry-point suite below.
    const text = `You test the lock.\n\n${FENCE}\n${validDice}\n${FENCE}`;

    const { narrative, diceRequest } = extractDiceRequest(text);

    expect(diceRequest).not.toBeNull();
    expect(narrative).not.toContain("DICE_REQUEST"); // the JSON does go
    expect(narrative).toContain(FENCE); // the fence does not
  });
});

// ───────────────────────────────────────── entry point: the final sweep ──
//
// `extractProtocolBlocks` is the only function whose narrative is
// reader-safe. It runs the strip pipeline and then sweeps the debris the
// strips leave behind.

describe("extractProtocolBlocks — final sweep", () => {
  it("clears the empty fence the dice strip used to leave behind", () => {
    // The case pinned as a limitation at the stage level above.
    const text = `You test the lock.\n\n${FENCE}\n${validDice}\n${FENCE}`;

    const { narrative, diceRequest } = extractProtocolBlocks(text);

    expect(diceRequest).not.toBeNull();
    expect(narrative).toBe("You test the lock.");
    expect(narrative).not.toContain(FENCE);
  });

  it("leaves clean prose after a REJECTED dice block inside a fence", () => {
    const bad = `{"type":"DICE_REQUEST","player":"char-abc","diceType":"d20","modifier":"+3","modifierSource":"Athletics (STR)","reason":"Hauling the portcullis"}`;
    const text = `The portcullis is heavier than it looks.\n\n${FENCE}\n${bad}\n${FENCE}\n\nIt does not budge.`;

    const { narrative, diceRequest } = extractProtocolBlocks(text);

    expect(diceRequest).toBeNull(); // rejected...
    expect(narrative).toBe(
      "The portcullis is heavier than it looks.\n\nIt does not budge.",
    ); // ...and no trace of it survives
    expect(narrative).not.toContain("DICE_REQUEST");
    expect(narrative).not.toContain(FENCE);
    expect(narrative).not.toMatch(/\n{3,}/);
    expect(warn).toHaveBeenCalled();
  });

  it("leaves clean prose after a REJECTED image block inside a fence", () => {
    const bad = `{"type":"IMAGE_REQUEST","subject":"creature","subjectId":"grey-wolf","prompt":"a grey wolf on a ridge","caption":"The Wolf","tone":"dark"}`;
    const text = `Something moves on the ridge.\n\n${FENCE}json\n${bad}\n${FENCE}\n\nThe wind shifts.`;

    const { narrative, imageRequest } = extractProtocolBlocks(text);

    expect(imageRequest).toBeNull();
    expect(narrative).toBe("Something moves on the ridge.\n\nThe wind shifts.");
    expect(narrative).not.toContain("IMAGE_REQUEST");
    expect(narrative).not.toContain(FENCE);
    expect(narrative).not.toMatch(/\n{3,}/);
    expect(warn).toHaveBeenCalled();
  });

  it("preserves a legitimate non-empty code fence in the narrative", () => {
    const text = `The runes on the door read:\n\n${FENCE}\nELDER SIGN\nOPEN BY BLOOD\n${FENCE}\n\nYou step back.\n\n${validDice}`;

    const { narrative, diceRequest } = extractProtocolBlocks(text);

    expect(diceRequest).not.toBeNull();
    expect(narrative).toBe(
      `The runes on the door read:\n\n${FENCE}\nELDER SIGN\nOPEN BY BLOOD\n${FENCE}\n\nYou step back.`,
    );
  });

  it("passes prose with no protocol blocks through byte-identical", () => {
    const text =
      "The tavern is tense. Every patron seems to be minding their own business a " +
      "little too carefully.\n\nWhat do you do?";

    expect(extractProtocolBlocks(text)).toEqual({
      narrative: text,
      diceRequest: null,
      imageRequest: null,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not silently fix the matcher's truncated-block limitation", () => {
    // The sweep removes debris, not JSON fragments. Deciding where an
    // unterminated block ends is the balanced-delimiter problem the matcher
    // deliberately does not solve, so this still leaks — by design.
    const truncated = `{"type":"DICE_REQUEST","player":"char-abc","diceType":"d20","modifier":3,"modifierSource":"Perc`;

    const { narrative } = extractProtocolBlocks(`You scan the treeline.\n\n${truncated}`);

    expect(narrative).toContain("DICE_REQUEST");
  });

  it("does not silently fix the matcher's nested-brace limitation", () => {
    const nested = `{"type":"IMAGE_REQUEST","subject":"npc","prompt":"an innkeeper","meta":{"seed":7},"tone":"dark"}`;

    const { narrative } = extractProtocolBlocks(`Prose. ${nested}`);

    expect(narrative).toContain("IMAGE_REQUEST");
  });
});
