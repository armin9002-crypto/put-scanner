import { useMemo } from 'react';

interface SparklineChartProps {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  fillGradient?: boolean;
  referenceValue?: number | null;
}

export default function SparklineChart({ data, color, width = 160, height = 60, fillGradient = false, referenceValue = null }: SparklineChartProps) {
  const { path, areaPath, referenceY } = useMemo(() => {
    if (data.length < 2) return { path: '', areaPath: '', referenceY: null };
    const values = referenceValue != null && Number.isFinite(referenceValue) ? [...data, referenceValue] : data;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = 2;
    const w = width - padding * 2;
    const h = height - padding * 2;

    const points = data.map((v, i) => {
      const x = padding + (i / (data.length - 1)) * w;
      const y = padding + h - ((v - min) / range) * h;
      return { x, y };
    });

    const linePath = `M${points.map(p => `${p.x},${p.y}`).join(' L')}`;
    const areaPath = `${linePath} L${points[points.length - 1].x},${padding + h} L${points[0].x},${padding + h} Z`;
    const referenceY = referenceValue != null && Number.isFinite(referenceValue)
      ? padding + h - ((referenceValue - min) / range) * h
      : null;

    return { path: linePath, areaPath, referenceY };
  }, [data, width, height, referenceValue]);

  if (data.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="opacity-30 max-w-full">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth="1" strokeDasharray="3,3" />
      </svg>
    );
  }

  const gradientId = `sparkline-grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible max-w-full">
      {fillGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fillGradient && <path d={areaPath} fill={`url(#${gradientId})`} />}
      {referenceY != null && (
        <line
          x1="0"
          y1={referenceY}
          x2={width}
          y2={referenceY}
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity="0.22"
          strokeDasharray="3,3"
          className="text-slate-400"
        />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
