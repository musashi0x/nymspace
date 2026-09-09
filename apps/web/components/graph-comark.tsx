"use client"

import type { ComponentType } from "react"

import {
  GRAPH_ADAPTERS,
  type GraphTag,
} from "@/lib/adapters"
import { fromMarkdown } from "@/components/ui/from-markdown"
import { GraphRow } from "@/components/ui/layout"
import { GraphActivity } from "@/components/graph-activity"
import { GraphBars } from "@/components/graph-bars"
import { GraphBullet } from "@/components/graph-bullet"
import { GraphCalendar } from "@/components/graph-calendar"
import { GraphCells } from "@/components/graph-cells"
import { GraphCheck } from "@/components/graph-check"
import { GraphCompare } from "@/components/graph-compare"
import { GraphCountdown } from "@/components/graph-countdown"
import { GraphDiff } from "@/components/graph-diff"
import { GraphFlow } from "@/components/graph-flow"
import { GraphFunnel } from "@/components/graph-funnel"
import { GraphGantt } from "@/components/graph-gantt"
import { GraphHeatmap } from "@/components/graph-heatmap"
import { GraphInvoice } from "@/components/graph-invoice"
import { GraphKpi } from "@/components/graph-kpi"
import { GraphMatrix } from "@/components/graph-matrix"
import { GraphMeter } from "@/components/graph-meter"
import { GraphPlot } from "@/components/graph-plot"
import { GraphRank } from "@/components/graph-rank"
import { GraphSheet } from "@/components/graph-sheet"
import { GraphSlope } from "@/components/graph-slope"
import { GraphSpark } from "@/components/graph-spark"
import { GraphSpec } from "@/components/graph-spec"
import { GraphStack } from "@/components/graph-stack"
import { GraphStat } from "@/components/graph-stat"
import { GraphTable } from "@/components/graph-table"
import { GraphTimeline } from "@/components/graph-timeline"
import { GraphTimer } from "@/components/graph-timer"
import { GraphTree } from "@/components/graph-tree"
import { GraphUptime } from "@/components/graph-uptime"
import { GraphWaffle } from "@/components/graph-waffle"
import { GraphWaterfall } from "@/components/graph-waterfall"

type AnyGraph = ComponentType<Record<string, unknown>>

export type GraphComponentMap = {
  [K in GraphTag]?: AnyGraph
}

/** Wrap the graphs you installed. Pass the result to Comark's `components` prop. */
export function createGraphComponents(installed: GraphComponentMap) {
  const out: Record<string, AnyGraph> = {
    row: fromMarkdown(GraphRow, GRAPH_ADAPTERS.row),
  }

  for (const [tag, Component] of Object.entries(installed)) {
    if (!Component) continue
    const adapter = GRAPH_ADAPTERS[tag as GraphTag]
    out[tag] = fromMarkdown(Component as AnyGraph, adapter)
  }

  return out
}

/** Full tag map after `shadcn add …/r/all.json`. Same shape as the demo repo. */
export const graphComponents = createGraphComponents({
  "graph-table": GraphTable,
  "graph-sheet": GraphSheet,
  "graph-invoice": GraphInvoice,
  "graph-spec": GraphSpec,
  "graph-matrix": GraphMatrix,
  "graph-compare": GraphCompare,
  "graph-diff": GraphDiff,
  "graph-stat": GraphStat,
  "graph-kpi": GraphKpi,
  "graph-spark": GraphSpark,
  "graph-plot": GraphPlot,
  "graph-bars": GraphBars,
  "graph-slope": GraphSlope,
  "graph-cells": GraphCells,
  "graph-meter": GraphMeter,
  "graph-waffle": GraphWaffle,
  "graph-stack": GraphStack,
  "graph-funnel": GraphFunnel,
  "graph-waterfall": GraphWaterfall,
  "graph-rank": GraphRank,
  "graph-bullet": GraphBullet,
  "graph-heatmap": GraphHeatmap,
  "graph-activity": GraphActivity,
  "graph-calendar": GraphCalendar,
  "graph-uptime": GraphUptime,
  "graph-flow": GraphFlow,
  "graph-tree": GraphTree,
  "graph-timeline": GraphTimeline,
  "graph-gantt": GraphGantt,
  "graph-check": GraphCheck,
  "graph-timer": GraphTimer,
  "graph-countdown": GraphCountdown,
} as GraphComponentMap)

export const graphTags = Object.keys(graphComponents)
