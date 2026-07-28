import { describe, expect, it } from "vitest";
import { snapshotAt } from "../mocks/generator";
import { collectionProcessFromSnapshot, trainingProcessFromSnapshot } from "../services/processAdapter";

const snapshot = snapshotAt(new Date());

describe("process data adapter contracts", () => {
  it("maps collection telemetry into a backend-replaceable process contract", () => {
    const telemetry = collectionProcessFromSnapshot(snapshot);

    expect(telemetry.source).toBe("mock-api");
    expect(telemetry.steps).toHaveLength(4);
    expect(telemetry.steps.at(-1)?.status).toBe("running");
    expect(telemetry.signal.length).toBeGreaterThan(0);
    expect(telemetry.quality).toEqual(snapshot.quality);
  });

  it("provides epoch history through the adapter instead of reconstructing it in the UI", () => {
    const run = trainingProcessFromSnapshot(snapshot);

    expect(run.source).toBe("mock-api");
    expect(run.steps).toHaveLength(5);
    expect(run.epochs).toHaveLength(12);
    expect(run.epochs.at(-1)?.validation_score).toBe(snapshot.training.validation_score);
    expect(run.release_checks.every((check) => check.status === "passed")).toBe(true);
  });
});
