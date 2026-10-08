import type { NextRequest } from "next/server";

import { buildWorksCsv } from "@/lib/business/works-report";

import { resolveCategoryFilter } from "../../data";
import { loadWorksReport } from "../../works-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CSV отчёта «Выполненные работы». Неавторизованный запрос сюда не доходит
// (proxy.ts), доступ к данным проекта ограничивает RLS внутри RPC.
export async function GET(request: NextRequest, ctx: RouteContext<"/[projectId]/reports/works/export">) {
  const { projectId } = await ctx.params;

  if (!UUID_RE.test(projectId)) {
    return new Response("Not found", { status: 404 });
  }

  const search = request.nextUrl.searchParams;
  const category = resolveCategoryFilter(search.get("category"));
  const report = await loadWorksReport(projectId, search.get("month"), category);

  if (!report.ok) {
    return new Response("Не удалось построить отчёт. Попробуйте ещё раз.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(buildWorksCsv(report.groups, report.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="completed-works-${report.month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
