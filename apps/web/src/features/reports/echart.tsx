"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, CustomChart, ScatterChart } from "echarts/charts";
import { AriaComponent, DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption, ECharts } from "echarts/core";

echarts.use([BarChart, ScatterChart, CustomChart, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, AriaComponent, SVGRenderer]);

/** One palette for every chart (the same as the bar charts of the Reports tab); the brand blue first. */
export const PALETTE = ["#3347d9", "#0f8a6a", "#c27a00", "#a23b8f", "#2b7fb8", "#b4472f", "#5b6577", "#6a8f1f", "#8f5bd6", "#1f7a8c"];
export const CHART_FONT = '"IBM Plex Sans", system-ui, sans-serif';

type Props = {
  option: EChartsCoreOption;
  height: number;
  /** A plain description for screen readers (the data table under the chart has the numbers). */
  label: string;
  /** A name the test page uses to find the chart. */
  name: string;
  onClick?: (params: { componentType?: string; seriesIndex?: number; dataIndex?: number; name?: string; data?: unknown; value?: unknown }) => void;
};

/**
 * A thin wrapper around Apache ECharts (SVG renderer, only the chart types we use). It draws in the browser, follows the width of its box,
 * and gives the instance back to the test page. Keyboard users get the same numbers from the table under each chart.
 */
export function EChart({ option, height, label, name, onClick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const click = useRef(onClick);
  useEffect(() => { click.current = onClick; }, [onClick]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const c = echarts.init(el, undefined, { renderer: "svg" });
    chart.current = c;
    c.on("click", (p) => click.current?.(p as Parameters<NonNullable<Props["onClick"]>>[0]));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    if (process.env.NEXT_PUBLIC_E2E_HARNESS === "1") { const w = window as unknown as { __charts?: Record<string, ECharts> }; (w.__charts ??= {})[name] = c; }
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, [name]);

  useEffect(() => {
    chart.current?.setOption({ textStyle: { fontFamily: CHART_FONT, fontSize: 12 }, animationDuration: 250, ...option }, true);
  }, [option]);

  return <div ref={box} role="img" aria-label={label} data-chart={name} style={{ width: "100%", height }} />;
}
