import { SYSTEM_CONFIG } from "../../config/system";
import type { StationSnapshot, TimeRange } from "../../types/domain";

export interface PowerAxisScale {
  min: number;
  max: number;
  interval: number;
}

const rounded = (value: number) => Number(value.toPrecision(12));

const niceInterval = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  const niceFraction = fraction <= 1.5 ? 1 : fraction <= 3 ? 2 : fraction <= 7 ? 5 : 10;
  return rounded(niceFraction * magnitude);
};

/**
 * Keeps zero visible while fitting the current power series to stable, rounded
 * tick boundaries. The rounded interval prevents the axis from jumping on
 * every one-minute update while avoiding a fixed station-capacity scale.
 */
export const powerAxisScale = (values: Array<number | null | undefined>): PowerAxisScale => {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return { min: -1, max: 1, interval: 0.5 };

  let dataMin = Math.min(0, ...finite);
  let dataMax = Math.max(0, ...finite);
  if (dataMin === dataMax) {
    const halfSpan = Math.max(Math.abs(dataMin) * 0.15, 0.5);
    dataMin -= halfSpan;
    dataMax += halfSpan;
  }

  const dataSpan = dataMax - dataMin;
  const padding = dataSpan * 0.1;
  const interval = niceInterval((dataSpan + padding * 2) / 6);
  const min = rounded(Math.floor((dataMin - padding) / interval) * interval);
  const max = rounded(Math.ceil((dataMax + padding) / interval) * interval);
  return min === max ? { min: min - interval, max: max + interval, interval } : { min, max, interval };
};

export const powerAxisTickText = (value: number) => {
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 10 ? 0 : absolute >= 1 ? 1 : absolute >= 0.1 ? 2 : 3;
  return value.toLocaleString(undefined, { maximumFractionDigits });
};

const rangeStart = (snapshot: StationSnapshot, range: TimeRange) =>
  new Date(snapshot.now).getTime() - SYSTEM_CONFIG.timeRanges[range] * 60_000;

export const visibleSeparationResults = (snapshot: StationSnapshot, range: TimeRange) => {
  const start = rangeStart(snapshot, range);
  return snapshot.separation_results.filter((row) => new Date(row.event_time).getTime() >= start);
};

export const visibleMainSwitchPoints = (snapshot: StationSnapshot, range: TimeRange) => {
  const start = rangeStart(snapshot, range);
  return snapshot.minute_points.filter((point) => new Date(point.event_time).getTime() >= start);
};
