// Подсказка: к какой позиции заявки относится строка счёта
// (docs/superpowers/specs/2026-10-20-supply-tracking-design.md §6.4).
// Только предложение — мастер подтверждает или меняет его в предпросмотре.
//
// Счёт — доля слов позиции, найденных в строке счёта. Поставщик дописывает
// своё («3,8х35 (1000шт) в ведре»), поэтому лишние слова строки не штрафуются.

import type { SupplyItemView } from "@/lib/types/supply";

export const SUPPLY_MATCH_THRESHOLD = 0.35;

// Кириллические буквы, неотличимые от латинских: в документах их путают
// («Т93» и «T93», «Alprofі»). Сначала нижний регистр, потом строчные двойники
// в латиницу — иначе «К» и «к» разошлись бы и подбор зависел бы от регистра.
const LOOKALIKES: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i",
};

/** Слова ≥ 2 букв, обрезанные до 5 символов (грубая основа), и числа любой длины. */
export function matchTokens(name: string): Set<string> {
  const normalized = name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[авекмнорстухі]/g, (ch) => LOOKALIKES[ch])
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2");

  const tokens = new Set<string>();
  for (const word of normalized.split(" ")) {
    if (/^\p{N}+$/u.test(word)) tokens.add(word);
    else if (word.length >= 2) tokens.add(word.slice(0, 5));
  }
  return tokens;
}

export function matchScore(itemName: string, lineName: string): number {
  const itemTokens = matchTokens(itemName);
  if (itemTokens.size === 0) return 0;
  const lineTokens = matchTokens(lineName);
  let found = 0;
  for (const token of itemTokens) if (lineTokens.has(token)) found += 1;
  return found / itemTokens.size;
}

export function suggestItemId(
  lineName: string,
  items: Pick<SupplyItemView, "id" | "name" | "cancelled" | "lineNo">[],
): string | null {
  let best: { id: string; score: number; lineNo: number } | null = null;
  for (const item of items) {
    if (item.cancelled) continue;
    const score = matchScore(item.name, lineName);
    if (score < SUPPLY_MATCH_THRESHOLD) continue;
    if (!best || score > best.score || (score === best.score && item.lineNo < best.lineNo)) {
      best = { id: item.id, score, lineNo: item.lineNo };
    }
  }
  return best?.id ?? null;
}

/**
 * Одна ли единица в строке счёта и у материала справочника («Шт.» = «шт»,
 * «м²» = «м2»): тогда кол-во оприходования по умолчанию — привезённое.
 */
export function unitsMatch(a: string, b: string): boolean {
  const normalize = (unit: string) => unit.toLowerCase().replace(/²/g, "2").replace(/[\s.]/g, "");
  return normalize(a) === normalize(b);
}

/** Совпадают ли названия материалов так же, как их сравнивает уникальный индекс (lower(name)). */
export function sameMaterialName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Поиск в списке материалов окна оприходования: каждое слово запроса есть в
 * названии (регистр и «ё» не важны). Выбранный материал остаётся в списке,
 * иначе <select> молча покажет другой.
 */
export function filterMaterialOptions<T extends { id: string; name: string }>(
  options: T[],
  query: string,
  selectedId: string | null,
): T[] {
  const normalize = (text: string) => text.toLowerCase().replace(/ё/g, "е");
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((m) => m.id === selectedId || words.every((w) => normalize(m.name).includes(w)));
}
