import { describe, expect, it } from "vitest";
import { shouldShowBusinessAlert } from "../features/executive/ExecutiveCommandCenter";

describe("executive business alert", () => {
  it("does not report the expected reconnect transition as a business failure", () => {
    expect(shouldShowBusinessAlert("connecting", null)).toBe(false);
    expect(shouldShowBusinessAlert("online", null)).toBe(false);
  });

  it("still reports genuine degraded, offline, and request-error states", () => {
    expect(shouldShowBusinessAlert("degraded", null)).toBe(true);
    expect(shouldShowBusinessAlert("offline", null)).toBe(true);
    expect(shouldShowBusinessAlert("connecting", new Error("snapshot failed"))).toBe(true);
  });
});
