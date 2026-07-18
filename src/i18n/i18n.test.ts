import { describe, it, expect } from "vitest";
import { fr } from "./fr";
import { en } from "./en";

// fr.ts is the source of truth for I18nKey; en.ts must mirror it exactly, or a
// missing key renders as `undefined` in the UI for one language.
describe("i18n dictionaries", () => {
  it("fr and en expose exactly the same keys", () => {
    const frKeys = Object.keys(fr).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys.filter((k) => !(k in fr))).toEqual([]); // extra keys in en
    expect(frKeys.filter((k) => !(k in en))).toEqual([]); // keys missing from en
  });

  it("has no empty translations", () => {
    for (const [k, v] of Object.entries(fr)) expect(v, `fr.${k}`).not.toBe("");
    for (const [k, v] of Object.entries(en)) expect(v, `en.${k}`).not.toBe("");
  });
});
