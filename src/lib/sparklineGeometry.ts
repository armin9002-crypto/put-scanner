export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  path: string;
  areaPath: string;
  points: SparklinePoint[];
  referenceY: number | null;
}

export function buildSparklineGeometry(
  data: readonly number[],
  width: number,
  height: number,
  referenceValue: number | null = null,
): SparklineGeometry {
  if (data.length < 2) return { path: '', areaPath: '', points: [], referenceY: null };

  const values = referenceValue != null && Number.isFinite(referenceValue) ? [...data, referenceValue] : data;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * w;
    const y = padding + h - ((value - min) / range) * h;
    return { x, y };
  });

  const path = `M${points.map(point => `${point.x},${point.y}`).join(' L')}`;
  const areaPath = `${path} L${points[points.length - 1].x},${padding + h} L${points[0].x},${padding + h} Z`;
  const referenceY = referenceValue != null && Number.isFinite(referenceValue)
    ? padding + h - ((referenceValue - min) / range) * h
    : null;

  return { path, areaPath, points, referenceY };
}
