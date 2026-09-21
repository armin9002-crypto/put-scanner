import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSparklineGeometry } from '../lib/sparklineGeometry';

interface SparklineChartProps {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  fillGradient?: boolean;
  referenceValue?: number | null;
  preserveAspectRatio?: 'xMidYMid meet' | 'none';
  responsive?: boolean;
}

export default function SparklineChart({ data, color, width = 160, height = 60, fillGradient = false, referenceValue = null, preserveAspectRatio = 'xMidYMid meet', responsive = false }: SparklineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [responsiveSize, setResponsiveSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!responsive) {
      setResponsiveSize(null);
      return;
    }

    const plot = svgRef.current?.parentElement;
    if (!plot || typeof ResizeObserver === 'undefined') return;

    const updateSize = (nextWidth: number, nextHeight: number) => {
      if (nextWidth <= 0 || nextHeight <= 0) return;
      setResponsiveSize(previous => (
        previous && Math.abs(previous.width - nextWidth) < 0.1 && Math.abs(previous.height - nextHeight) < 0.1
          ? previous
          : { width: nextWidth, height: nextHeight }
      ));
    };

    const initialRect = plot.getBoundingClientRect();
    updateSize(initialRect.width, initialRect.height);

    const observer = new ResizeObserver(([entry]) => {
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(plot);
    return () => observer.disconnect();
  }, [responsive]);

  const chartWidth = responsive ? responsiveSize?.width ?? width : width;
  const chartHeight = responsive ? responsiveSize?.height ?? height : height;
  const { path, areaPath, referenceY } = useMemo(
    () => buildSparklineGeometry(data, chartWidth, chartHeight, referenceValue),
    [data, chartHeight, chartWidth, referenceValue],
  );
  const svgWidth = responsive ? '100%' : width;
  const svgHeight = responsive ? '100%' : height;
  const renderedPreserveAspectRatio = responsive ? 'xMidYMid meet' : preserveAspectRatio;

  if (data.length < 2) {
    return (
      <svg ref={svgRef} width={svgWidth} height={svgHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio={renderedPreserveAspectRatio} className="opacity-30 max-w-full">
        <line x1="0" y1={chartHeight / 2} x2={chartWidth} y2={chartHeight / 2} stroke={color} strokeWidth="1" strokeDasharray="3,3" />
      </svg>
    );
  }

  const gradientId = `sparkline-grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg ref={svgRef} width={svgWidth} height={svgHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio={renderedPreserveAspectRatio} className="overflow-visible max-w-full">
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
          x2={chartWidth}
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
