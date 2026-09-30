export interface HistoricalChartPoint {
  date: string;
  value: number | null;
  fullWindow?: boolean;
}

export interface HistoricalCalendarTick {
  date: string;
  label: string;
}

export interface HistoricalValueLabel {
  index: number;
  roles: Array<'Current' | 'High' | 'Low'>;
}

export interface HistoricalPointSegment {
  kind: 'solid' | 'partial';
  indexes: number[];
}

const DAY_MS = 86_400_000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseIsoDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function tickLabel(timestamp: number, unit: 'year' | 'month' | 'week' | 'day'): string {
  const date = new Date(timestamp);
  if (unit === 'year') return String(date.getUTCFullYear());
  if (unit === 'month') return `${MONTH_NAMES[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(-2)}`;
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function tickUnit(spanDays: number): 'year' | 'month' | 'week' | 'day' {
  if (spanDays >= 730) return 'year';
  if (spanDays >= 180) return 'month';
  if (spanDays >= 42) return 'week';
  return 'day';
}

function intervalChoices(unit: 'year' | 'month' | 'week' | 'day'): number[] {
  if (unit === 'year') return [1, 2, 5];
  if (unit === 'month') return [1, 3, 6];
  if (unit === 'week') return [1, 2];
  return [1, 2, 7];
}

function calendarCandidates(start: number, end: number, unit: 'year' | 'month' | 'week' | 'day', interval: number): number[] {
  const startCalendar = new Date(start);
  const candidates: number[] = [];
  if (unit === 'year') {
    const firstYear = startCalendar.getUTCFullYear() + (startCalendar.getUTCMonth() === 0 && startCalendar.getUTCDate() === 1 ? 0 : 1);
    for (let year = firstYear; Date.UTC(year, 0, 1) <= end; year += interval) candidates.push(Date.UTC(year, 0, 1));
  } else if (unit === 'month') {
    const firstMonth = startCalendar.getUTCFullYear() * 12 + startCalendar.getUTCMonth()
      + (startCalendar.getUTCDate() === 1 ? 0 : 1);
    for (let month = firstMonth; Date.UTC(Math.floor(month / 12), month % 12, 1) <= end; month += 1) {
      if (month % interval === 0) candidates.push(Date.UTC(Math.floor(month / 12), month % 12, 1));
    }
  } else if (unit === 'week') {
    const daysToMonday = (8 - startCalendar.getUTCDay()) % 7;
    for (let cursor = start + daysToMonday * DAY_MS; cursor <= end; cursor += 7 * DAY_MS) {
      if (Math.floor(cursor / (7 * DAY_MS)) % interval === 0) candidates.push(cursor);
    }
  } else {
    for (let cursor = start; cursor <= end; cursor += DAY_MS) {
      if (Math.floor(cursor / DAY_MS) % interval === 0) candidates.push(cursor);
    }
  }
  return candidates;
}

/**
 * Produces labels at real UTC calendar boundaries.  The caller can increase
 * minSpacing for larger text, so labels remain collision-free at that scale.
 */
export function buildHistoricalCalendarTicks(
  startDate: string,
  endDate: string,
  width: number,
  minSpacing = 90,
): HistoricalCalendarTick[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start == null || end == null || start > end || !Number.isFinite(width) || width <= 0) return [];

  const unit = tickUnit(Math.round((end - start) / DAY_MS));
  const spacing = Number.isFinite(minSpacing) && minSpacing > 0 ? minSpacing : 90;
  const capacity = Math.max(1, Math.floor(width / spacing));
  const candidatesByInterval = intervalChoices(unit).map(interval => calendarCandidates(start, end, unit, interval));
  const candidates = candidatesByInterval.find(candidate => candidate.length <= capacity)
    ?? candidatesByInterval[candidatesByInterval.length - 1]
    ?? [];
  const stride = Math.max(1, Math.ceil(candidates.length / capacity));
  return candidates.filter((_, index) => index % stride === 0).map(timestamp => ({ date: isoDate(timestamp), label: tickLabel(timestamp, unit) }));
}

/** Returns current, maximum, and minimum finite observations without duplicate labels. */
export function selectHistoricalValueLabels<T extends HistoricalChartPoint>(points: readonly T[]): HistoricalValueLabel[] {
  const finite = points.flatMap((point, index) => Number.isFinite(point.value) ? [{ index, value: point.value as number }] : []);
  if (finite.length === 0) return [];

  const current = finite[finite.length - 1];
  const high = finite.reduce((best, candidate) => candidate.value >= best.value ? candidate : best);
  const low = finite.reduce((best, candidate) => candidate.value <= best.value ? candidate : best);
  const selected: Array<[typeof current, HistoricalValueLabel['roles'][number]]> = [
    [current, 'Current'],
    [high, 'High'],
    [low, 'Low'],
  ];
  const byIndex = new Map<number, HistoricalValueLabel>();
  selected.forEach(([point, role]) => {
    const label = byIndex.get(point.index);
    if (label) label.roles.push(role);
    else byIndex.set(point.index, { index: point.index, roles: [role] });
  });
  return [...byIndex.values()];
}

/** Splits paths at unavailable values, retaining valid singleton islands for chart markers. */
export function segmentHistoricalPoints<T extends HistoricalChartPoint>(points: readonly T[]): HistoricalPointSegment[] {
  const segments: HistoricalPointSegment[] = [];
  let run: number[] = [];
  const finishRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      segments.push({ kind: points[run[0]].fullWindow === false ? 'partial' : 'solid', indexes: run });
      run = [];
      return;
    }
    let indexes = [run[0]];
    let kind: HistoricalPointSegment['kind'] = points[run[0]].fullWindow === false || points[run[1]].fullWindow === false ? 'partial' : 'solid';
    for (let position = 1; position < run.length; position += 1) {
      const previous = run[position - 1];
      const current = run[position];
      const edgeKind: HistoricalPointSegment['kind'] = points[previous].fullWindow === false || points[current].fullWindow === false ? 'partial' : 'solid';
      if (edgeKind !== kind) {
        segments.push({ kind, indexes });
        indexes = [previous, current];
        kind = edgeKind;
      } else indexes.push(current);
    }
    segments.push({ kind, indexes });
    run = [];
  };

  points.forEach((point, index) => {
    if (Number.isFinite(point.value)) run.push(index);
    else finishRun();
  });
  finishRun();
  return segments;
}
