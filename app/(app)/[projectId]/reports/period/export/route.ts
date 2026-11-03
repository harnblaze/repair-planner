import type { NextRequest } from "next/server";

import { buildPeriodCsv } from "@/lib/business/materials-period";

import { loadMaterialPeriodReport } from "../data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CSV-выгрузка отчёта «Движение за период». Неавторизованный запрос сюда не
// доходит (proxy.ts), доступ к данным проекта ограничивает RLS внутри RPC.
export async function GET(request: NextRequest, ctx: RouteContext<"/[projectId]/reports/period/export">) {
  const { projectId } = await ctx.params;

  if (!UUID_RE.test(projectId)) {
    return new Response("Not found", { status: 404 });
  }

  const search = request.nextUrl.searchParams;
  const report = await loadMaterialPeriodReport(projectId, search.get("from"), search.get("to"));

  if (!report.ok) {
    return new Response("Не удалось построить отчёт. Попробуйте ещё раз.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(buildPeriodCsv(report.rows, report.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="materials-${report.from}-${report.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
