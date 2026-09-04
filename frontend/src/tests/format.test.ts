import { describe, expect, it } from "vitest";
import { powerText } from "../utils/format";

describe("powerText", () => {
  it("distinguishes a missing result from a real zero", () => {
    expect(powerText(null)).toBe("—");
    expect(powerText(0)).toBe("0.000");
  });

  it("does not round a small real model output down to zero", () => {
    expect(powerText(0.0038116)).toBe("0.0038");
    expect(powerText(0.2456)).toBe("0.246");
  });

  it("keeps at least three decimals for normal power values", () => {
    expect(powerText(2.425342)).toBe("2.425");
    expect(powerText(12.6)).toBe("12.600");
    expect(powerText(-0.81368)).toBe("-0.814");
  });
});
