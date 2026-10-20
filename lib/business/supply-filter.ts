// Поиск и фильтр заявок на ТМЦ на странице «Снабжение» — на клиенте: заявок
// десятки в год (docs/superpowers/specs/2026-10-20-supply-tracking-design.md §3 п.9).

import type { SupplyRequestView } from "@/lib/types/supply";

import { summarizeRequest } from "./supply-status";

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е");

function searchableText(request: SupplyRequestView): string {
  return normalize(
    [
      request.number,
      request.description ?? "",
      ...request.items.map((i) => i.name),
      ...request.invoices.flatMap((inv) => [inv.number, inv.supplier, ...inv.lines.map((l) => l.name)]),
    ].join("\n"),
  );
}

export function filterSupplyRequests(
  requests: SupplyRequestView[],
  opts: { query: string; onlyActive: boolean },
): SupplyRequestView[] {
  const query = normalize(opts.query.trim());
  return requests.filter(
    (r) =>
      (!opts.onlyActive || summarizeRequest(r).status !== "delivered") &&
      (query === "" || searchableText(r).includes(query)),
  );
}
