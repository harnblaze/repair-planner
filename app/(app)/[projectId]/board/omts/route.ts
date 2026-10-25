import type { NextRequest } from "next/server";

import { parseOrderItem } from "@/lib/business/omts-request";
import { buildOmtsWorkbook } from "@/lib/business/omts-workbook";
import { createClient } from "@/lib/supabase/server";
import { omtsExportSchema } from "@/lib/validation/omts-request";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function text(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Заявка в ОМТС из невыполненных пунктов списка «Материалы к заказу».
// Неавторизованный запрос сюда не доходит (proxy.ts), доступ к списку и
// пунктам ограничивает RLS; project_id в фильтрах — защита от чужого listId.
export async function POST(request: NextRequest, ctx: RouteContext<"/[projectId]/board/omts">) {
  const { projectId } = await ctx.params;

  if (!UUID_RE.test(projectId)) {
    return new Response("Not found", { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return text("Проверьте поля заявки.", 400);
  }
  const parsed = omtsExportSchema.safeParse(body);
  if (!parsed.success) {
    return text("Проверьте поля заявки.", 400);
  }
  const { listId, ...header } = parsed.data;

  const supabase = await createClient();

  const list = await supabase
    .from("board_lists")
    .select("id")
    .eq("id", listId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (list.error) {
    console.error("omts export: list", list.error);
    return text("Не удалось собрать заявку. Попробуйте ещё раз.", 500);
  }
  if (!list.data) {
    return text("Список не найден.", 404);
  }

  const items = await supabase
    .from("board_items")
    .select("title, note")
    .eq("list_id", listId)
    .eq("project_id", projectId)
    .eq("is_done", false)
    .order("position")
    .order("created_at");
  if (items.error) {
    console.error("omts export:", items.error);
    return text("Не удалось собрать заявку. Попробуйте ещё раз.", 500);
  }
  if (items.data.length === 0) {
    return text("В списке нет невыполненных пунктов.", 400);
  }

  let file: Buffer;
  try {
    file = await buildOmtsWorkbook(
      header,
      items.data.map((item) => parseOrderItem(item.title, item.note)),
    );
  } catch (error) {
    console.error("omts export: workbook", error);
    return text("Не удалось собрать заявку. Попробуйте ещё раз.", 500);
  }

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="omts-request-${header.month}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
