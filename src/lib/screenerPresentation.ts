export function formatScreenerDelta(delta: number | null | undefined): string {
  return delta == null || !Number.isFinite(delta) ? '\u2014' : delta.toFixed(3);
}
