"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { matchesFilters } from "@pv/domain";
import { useWorkspace } from "../workspace/provider";
import { useScope } from "../workspace/scope";
import type { PortfolioController } from "./controller";
import { baseDef, parseBase } from "./grid-view";
import { useStatus } from "./status-strip";
import type { GridItem } from "./types";

/**
 * The initiatives a page other than the grid shows: those in the active portfolio scope (`?scope=`) that match the
 * filters of the saved view in the address (`?view=`). Recomputed when the controller reports a change.
 */
export function useViewRows(controller: PortfolioController, me: string | null) {
  const status = useStatus(controller);
  const params = useSearchParams();
  const { views, defaults } = useWorkspace();
  const scope = useScope();
  const today = controller.todayDate();
  const viewParam = params.get("view");
  const base = useMemo(() => baseDef(parseBase(viewParam, { kind: "builtin", name: "Prioritisation" }), views, defaults), [viewParam, views, defaults]);
  const filters = base?.filters ?? [];
  const rows = useMemo<GridItem[]>(
    () => controller.rows.filter((r) => (scope.projectIds === null || scope.projectIds.includes(r.home_project)) && matchesFilters(r, filters, { me, today })),
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, status.version, scope.projectIds, filters, me],
  );
  const saved = viewParam ? views.find((v) => v.id === viewParam) : undefined;
  return { rows, scope, views, viewParam, filterName: saved?.name, /** Columns of the chosen saved view (null when none is chosen). */ savedColumns: saved?.columns ?? null, status };
}
