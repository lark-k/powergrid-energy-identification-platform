import { http, HttpResponse } from "msw";
import { snapshotAt } from "./generator";
import { collectionProcessFromSnapshot, trainingProcessFromSnapshot } from "../services/processAdapter";

const mockSnapshot = () => snapshotAt(new Date("2026-07-22T14:32:00+08:00"));

export const handlers = [
  http.get("/api/v1/stations/:stationId/snapshot", () => HttpResponse.json(mockSnapshot())),
  http.get("/api/v1/stations/:stationId/minute-series", () => HttpResponse.json(mockSnapshot().minute_points)),
  http.get("/api/v1/stations/:stationId/recognition/latest", () => HttpResponse.json(mockSnapshot().recognition)),
  http.get("/api/v1/stations/:stationId/feedback-batches", () => HttpResponse.json(mockSnapshot().feedback_batches)),
  http.get("/api/v1/stations/:stationId/corrections", () => HttpResponse.json(mockSnapshot().corrections)),
  http.get("/api/v1/stations/:stationId/results", () => HttpResponse.json(mockSnapshot().separation_results)),
  http.get("/api/v1/stations/:stationId/process/collection", () => HttpResponse.json(collectionProcessFromSnapshot(mockSnapshot()))),
  http.get("/api/v1/stations/:stationId/training-runs", () => HttpResponse.json([trainingProcessFromSnapshot(mockSnapshot())])),
  http.get("/api/v1/stations/:stationId/training-runs/latest", () => HttpResponse.json(trainingProcessFromSnapshot(mockSnapshot()))),
  http.post("/api/v1/imports", () => HttpResponse.json({ import_id: "IMP-MOCK-001", status: "complete" })),
  http.post("/api/v1/exports", () => HttpResponse.json({ export_id: "EXP-MOCK-001", status: "ready" })),
];
