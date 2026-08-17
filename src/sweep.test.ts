import { describe, expect, it } from "vitest";

import { sweepNarrative } from "./sweep.js";

/** Markdown fence, kept out of the template literals below for readability. */
const FENCE = "```";

describe("sweepNarrative — empty fences", () => {
  it("removes an empty fence pair left behind by a stripped block", () => {
    const text = `You test the lock.\n\n${FENCE}\n\n${FENCE}`;

    expect(sweepNarrative(text)).toBe("You test the lock.");
  });

  it("removes an empty fence that carried a language tag", () => {
    // ```json ... ``` is what the model writes most often, and the info string
    // must not make the empty box look "non-empty".
    const text = `Prose before.\n\n${FENCE}json\n\n${FENCE}\n\nProse after.`;

    expect(sweepNarrative(text)).toBe("Prose before.\n\nProse after.");
  });

  it("removes an empty fence written inline on a single line", () => {
    expect(sweepNarrative(`You reach the gate. ${FENCE}  ${FENCE} The gate is shut.`)).toBe(
      "You reach the gate.  The gate is shut.",
    );
  });

  it("collapses the blank-line crater the removal leaves", () => {
    const text = `Paragraph one.\n\n${FENCE}\n\n${FENCE}\n\nParagraph two.`;

    const swept = sweepNarrative(text);

    expect(swept).toBe("Paragraph one.\n\nParagraph two.");
    expect(swept).not.toMatch(/\n{3,}/);
  });

  it("removes several empty fence pairs in one pass", () => {
    const text = `A.\n\n${FENCE}\n\n${FENCE}\n\nB.\n\n${FENCE}\n${FENCE}\n\nC.`;

    expect(sweepNarrative(text)).toBe("A.\n\nB.\n\nC.");
  });
});

describe("sweepNarrative — conservatism", () => {
  it("preserves a legitimate non-empty code fence", () => {
    const text = `The runes on the door read:\n\n${FENCE}\nELDER SIGN\nOPEN BY BLOOD\n${FENCE}\n\nYou step back.`;

    expect(sweepNarrative(text)).toBe(text);
  });

  it("preserves a non-empty fence with a language tag", () => {
    const text = `Here is the incantation:\n\n${FENCE}js\nconst x = 1;\n${FENCE}`;

    expect(sweepNarrative(text)).toBe(text);
  });

  it("does not weld two adjacent code fences together", () => {
    // A naive ```...``` pair match would treat the seam between these two
    // blocks as an "empty fence" and delete both inner fences.
    const text = `${FENCE}\ncode A\n${FENCE}\n${FENCE}\ncode B\n${FENCE}`;

    expect(sweepNarrative(text)).toBe(text);
  });

  it("leaves everything alone when the fences do not balance", () => {
    // Odd token count: the pairing is guesswork, so the sweep fails closed.
    const text = `Type ${FENCE} to open a block.\n\n${FENCE}\ncode\n${FENCE}`;

    expect(sweepNarrative(text)).toBe(text);
  });

  it("passes normal prose through byte-identical", () => {
    const text =
      "The tavern is tense. Every patron seems to be minding their own business a " +
      "little too carefully.\n\nWhat do you do?";

    expect(sweepNarrative(text)).toBe(text);
  });

  it("leaves a marker embedded in a sentence alone", () => {
    // Deleting the token mid-sentence produces mangled prose, which is worse
    // than the token. Only a whole line that is nothing but a marker goes.
    const text = "The scribe mutters something about a DICE_REQUEST and shrugs.";

    expect(sweepNarrative(text)).toBe(text);
  });

  it("leaves a truncated JSON fragment alone (matcher's problem, not the sweep's)", () => {
    // No closing delimiter, so where it ends is a guess. The sweep does not
    // guess. This stays pinned as a matcher limitation.
    const text = `You scan the treeline.\n\n{"type":"DICE_REQUEST","player":"char-abc","modifierSource":"Perc`;

    expect(sweepNarrative(text)).toBe(text);
  });

  it("is idempotent", () => {
    const text = `A.\n\n${FENCE}json\n\n${FENCE}\n\nDICE_REQUEST\n\nB.`;
    const once = sweepNarrative(text);

    expect(sweepNarrative(once)).toBe(once);
  });
});

describe("sweepNarrative — orphaned markers", () => {
  it("removes a bare marker sitting on its own line", () => {
    expect(sweepNarrative("Prose above.\n\nDICE_REQUEST\n\nProse below.")).toBe(
      "Prose above.\n\nProse below.",
    );
  });

  it("removes a decorated marker line", () => {
    for (const marker of ["[IMAGE_REQUEST]", '"DICE_REQUEST":', "<IMAGE_REQUEST>", "IMAGE_REQUEST,"]) {
      expect(sweepNarrative(`Above.\n${marker}\nBelow.`)).toBe("Above.\nBelow.");
    }
  });

  it("removes a fence left empty by the marker removal", () => {
    // Marker lines are cleared before fences are measured, so this collapses
    // in a single pass.
    const text = `Prose.\n\n${FENCE}\nDICE_REQUEST\n${FENCE}\n\nMore prose.`;

    expect(sweepNarrative(text)).toBe("Prose.\n\nMore prose.");
  });
});
