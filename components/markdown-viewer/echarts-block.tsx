"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, AlertCircle } from "lucide-react";

interface EChartsBlockProps {
  code: string;
}

/**
 * Parse ECharts configuration code.
 * Only JSON is supported to prevent code execution vulnerabilities.
 */
function parseEChartsConfig(code: string): Record<string, unknown> | null {
  const trimmed = code.trim();

  try {
    // Use JSON.parse only to avoid code execution risks
    const result = JSON.parse(trimmed);
    if (typeof result === 'object' && result !== null) {
      return result;
    }
  } catch {
    // JSON parsing failed
  }

  return null;
}

/**
 * Detect whether code is an ECharts config.
 * Determine this by checking common ECharts config properties.
 */
export function isEChartsConfig(code: string): boolean {
  const config = parseEChartsConfig(code);
  if (!config) return false;

  // Check common ECharts config properties
  const echartsKeys = [
    'title', 'legend', 'grid', 'xAxis', 'yAxis', 'polar',
    'radiusAxis', 'angleAxis', 'radar', 'dataZoom', 'visualMap',
    'tooltip', 'axisPointer', 'toolbox', 'brush', 'geo', 'parallel',
    'parallelAxis', 'singleAxis', 'timeline', 'graphic', 'calendar',
    'dataset', 'aria', 'series', 'color', 'backgroundColor',
    'textStyle', 'animation', 'animationThreshold', 'animationDuration'
  ];

  const configKeys = Object.keys(config);
  return echartsKeys.some(key => configKeys.includes(key));
}

export function EChartsBlock({ code }: EChartsBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<unknown>(null);
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // Clean up the previous resize listener
    if (resizeHandlerRef.current) {
      window.removeEventListener('resize', resizeHandlerRef.current);
      resizeHandlerRef.current = null;
    }

    // Handle empty code
    if (!code.trim()) {
      setLoading(false);
      setError(null);
      return;
    }

    const renderChart = async () => {
      if (!containerRef.current) return;

      setLoading(true);
      setError(null);

      try {
        // Parse config
        const config = parseEChartsConfig(code);
        if (!config) {
          throw new Error("Invalid ECharts configuration");
        }

        // Dynamically load echarts
        // Note: in some bundling environments, echarts' ESM entry can reference internal modules
        // that are not included in the published package, which can break Next/webpack builds.
        // We load the prebuilt ESM bundle directly to work around this.
        //
        // Also, depending on module interop, this prebuilt bundle may be exposed as `default`
        // or `export=` in TS, so we unwrap it for compatibility and then assert the echarts type.
        const echartsModule = await import("echarts/dist/echarts.esm");
        const echarts = (
          (echartsModule as unknown as { default?: unknown }).default ??
          (echartsModule as unknown as { ["export="]?: unknown })["export="] ??
          echartsModule
        ) as typeof import("echarts");

        if (!mounted || !containerRef.current) return;

        // If a chart instance already exists, dispose it first
        if (chartRef.current) {
          (chartRef.current as { dispose: () => void }).dispose();
        }

        // Create a new chart instance
        const chart = echarts.init(containerRef.current, undefined, {
          renderer: 'svg'
        });
        chartRef.current = chart;

        // Apply configuration
        chart.setOption(config);

        // Listen to window resize
        const handleResize = () => {
          chart.resize();
        };
        window.addEventListener('resize', handleResize);
        resizeHandlerRef.current = handleResize;

        setLoading(false);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to render chart");
          setLoading(false);
        }
      }
    };

    renderChart();

    return () => {
      mounted = false;
      if (resizeHandlerRef.current) {
        window.removeEventListener('resize', resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
      if (chartRef.current) {
        (chartRef.current as { dispose: () => void }).dispose();
        chartRef.current = null;
      }
    };
  }, [code]);

  if (error) {
    return (
      <div className="flex items-center justify-center p-4 text-destructive bg-destructive/10 rounded-lg my-4 border border-destructive/20">
        <AlertCircle className="h-4 w-4 mr-2" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="my-4 rounded-lg border border-border bg-background overflow-hidden relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-xs text-muted-foreground">Loading chart...</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full"
        style={{ height: '400px', minHeight: '300px' }}
      />
    </div>
  );
}
