import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_KINDS,
  activityDay,
  activityHref,
  activityTime,
  describeActivity,
  describeRow,
  describeRowFor,
  groupByDay,
  isActivityKind,
  isOwnMention,
  type ActivityRow,
} from "./activity";

// Главный тест файла: список видов событий в миграции и словарь подписей
// должны совпадать. Новый триггер без подписи отрендерится в ленте сырым
// kind — этот тест падает раньше, чем это заметит человек.
// Виды событий размазаны по миграциям: базовый набор живёт в 0032, новые
// триггеры добавляют свои kind в отдельных файлах (0040 — упоминания в чате).
const MIGRATIONS = [
  path.join(process.cwd(), "supabase/migrations/0032_project_activity.sql"),
  path.join(process.cwd(), "supabase/migrations/0040_chat_mentions_activity.sql"),
];

function kindsFromMigration(): string[] {
  const found: string[] = [];
  for (const file of MIGRATIONS) {
    const sql = readFileSync(file, "utf8");
    // В 0032 виды событий стоят строковыми литералами с точкой (task.created).
    for (const raw of sql.match(/'[a-z]+(?:\.[a-z_]+)+'/g) ?? []) {
      found.push(raw.slice(1, -1));
    }
    // Однословные виды помечаются маркером: угадывать их по кавычкам нельзя —
    // рядом в SQL стоят entity_type и другие строки.
    for (const raw of sql.match(/-- activity-kind: ([a-z_]+)/g) ?? []) {
      found.push(raw.replace("-- activity-kind: ", ""));
    }
  }
  return [...new Set(found)].sort();
}

describe("словарь событий синхронен с миграцией", () => {
  it("каждый kind из 0032 имеет подпись", () => {
    const fromSql = kindsFromMigration();
    expect(fromSql.length).toBeGreaterThan(0);
    const missing = fromSql.filter((kind) => !isActivityKind(kind));
    expect(missing).toEqual([]);
  });

  it("в словаре нет подписей без события в базе", () => {
    const fromSql = new Set(kindsFromMigration());
    const extra = ACTIVITY_KINDS.filter((kind) => !fromSql.has(kind));
    expect(extra).toEqual([]);
  });
});

describe("describeActivity", () => {
  it("создание заявки", () => {
    expect(describeActivity("task.created", { title: "Покрасить стены" })).toBe(
      "создана заявка «Покрасить стены»",
    );
  });

  it("смена статуса переводит значения словарём", () => {
    expect(
      describeActivity("task.status", { title: "Покрасить стены", from: "new", to: "planned" }),
    ).toBe("заявка «Покрасить стены»: Новая → Запланирована");
  });

  it("перенос показывает обе даты", () => {
    expect(
      describeActivity("task.carried_over", {
        task: "Покрасить стены",
        from_date: "2026-11-05",
        to_date: "2026-11-06",
      }),
    ).toBe("заявка «Покрасить стены» перенесена с 05.11 на 06.11");
  });

  it("движение материала: вид движения, количество, единица и заявка", () => {
    expect(
      describeActivity("material.moved", {
        material: "Электроды",
        unit: "кг",
        kind: "consumption",
        quantity: 2.5,
        task: "Покрасить стены",
      }),
    ).toBe("материал «Электроды»: списание 2,5 кг (заявка «Покрасить стены»)");
  });

  it("движение материала без единицы показывает одно число", () => {
    expect(
      describeActivity("material.moved", { material: "Электроды", kind: "receipt", quantity: 10 }),
    ).toBe("материал «Электроды»: приход 10");
  });

  it("роли участников переводятся", () => {
    expect(
      describeActivity("member.role_changed", { full_name: "Иванов Иван", from: "viewer", role: "member" }),
    ).toBe("роль участника Иванов Иван: Только просмотр → Редактор");
  });

  it("календарь различает нерабочий день и рабочую субботу", () => {
    expect(describeActivity("calendar.day_added", { day: "2026-11-04", kind: "holiday" })).toBe(
      "день 04.11 отмечен нерабочим",
    );
    expect(describeActivity("calendar.day_added", { day: "2026-11-07", kind: "working_day" })).toBe(
      "день 07.11 отмечен рабочим",
    );
  });

  it("переименование списка не теряет старое имя", () => {
    expect(describeActivity("list.renamed", { name: "Снабжение", from: "Материалы" })).toBe(
      "список «Материалы» переименован в «Снабжение»",
    );
  });

  it("пустой или урезанный payload не роняет фразу", () => {
    for (const kind of ACTIVITY_KINDS) {
      const phrase = describeActivity(kind, {});
      expect(phrase.length).toBeGreaterThan(0);
      expect(phrase).not.toContain("undefined");
      expect(phrase).not.toContain("null");
    }
  });
});

describe("describeRow", () => {
  const row: ActivityRow = {
    id: 1,
    actor_id: null,
    kind: "task.created",
    entity_type: "task",
    entity_id: "t-1",
    payload: { title: "Заявка" },
    created_at: "2026-11-05T10:00:00Z",
  };

  it("неизвестный вид не роняет ленту", () => {
    expect(describeRow({ ...row, kind: "unknown.thing" })).toBe("изменение (unknown.thing)");
  });

  it("упоминание в чате читается после имени автора", () => {
    const mention: ActivityRow = {
      ...row,
      kind: "chat_mention",
      entity_type: "chat_message",
      entity_id: "c-1",
      payload: { message_id: "c-1", mentioned_user_id: "u-1", mentioned: "Дмитрий", excerpt: "@Дмитрий привет" },
    };
    expect(describeRow(mention)).toBe("упоминание в чате: «@Дмитрий привет»");
  });

  it("своё упоминание читается как «вас» и подсвечивается", () => {
    const mention: ActivityRow = {
      ...row,
      kind: "chat_mention",
      entity_type: "chat_message",
      entity_id: "c-1",
      payload: { message_id: "c-1", mentioned_user_id: "u-1", mentioned: "Дмитрий", excerpt: "@Дмитрий привет" },
    };
    expect(describeRowFor(mention, "u-1")).toBe("вас упомянули в чате: «@Дмитрий привет»");
    expect(describeRowFor(mention, "u-2")).toBe("упоминание в чате: «@Дмитрий привет»");
    expect(describeRowFor(mention, null)).toBe("упоминание в чате: «@Дмитрий привет»");
    expect(isOwnMention(mention, "u-1")).toBe(true);
    expect(isOwnMention(mention, "u-2")).toBe(false);
    expect(isOwnMention(row, "u-1")).toBe(false);
  });

  it("у сообщения чата нет маршрута — ссылки в ленте нет", () => {
    const mention: ActivityRow = {
      ...row,
      kind: "chat_mention",
      entity_type: "chat_message",
      entity_id: "c-1",
      payload: { excerpt: "текст" },
    };
    expect(activityHref("p-1", mention)).toBeNull();
  });

  it("единица материала берётся из payload — снимок переживает удаление материала", () => {
    const materialRow: ActivityRow = {
      ...row,
      kind: "material.moved",
      entity_type: "material",
      entity_id: "m-1",
      payload: { material: "Краска", unit: "л", kind: "receipt", quantity: 1 },
    };
    expect(describeRow(materialRow)).toBe("материал «Краска»: приход 1 л");
  });
});

describe("даты и группировка", () => {
  it("день и время считаются в timezone проекта, а не браузера", () => {
    const iso = "2026-11-05T22:30:00Z";
    expect(activityDay(iso, "Europe/Moscow")).toBe("2026-11-06");
    expect(activityTime(iso, "Europe/Moscow")).toBe("01:30");
  });

  it("группы: Сегодня, Вчера, затем дата", () => {
    const make = (id: number, createdAt: string): ActivityRow => ({
      id,
      actor_id: null,
      kind: "task.created",
      entity_type: "task",
      entity_id: null,
      payload: {},
      created_at: createdAt,
    });

    const rows = [
      make(3, "2026-11-05T09:00:00Z"),
      make(2, "2026-11-04T09:00:00Z"),
      make(1, "2026-11-01T09:00:00Z"),
    ];

    const groups = groupByDay(rows, "Europe/Moscow", "2026-11-05", "2026-11-04");
    expect(groups.map((group) => group.label)).toEqual(["Сегодня", "Вчера", "01.11"]);
    expect(groups.map((group) => group.rows.length)).toEqual([1, 1, 1]);
  });

  it("пустая выборка не даёт групп", () => {
    expect(groupByDay([], "Europe/Moscow", "2026-11-05", "2026-11-04")).toEqual([]);
  });

  it("строки одного дня попадают в одну группу и сохраняют порядок", () => {
    const make = (id: number, createdAt: string): ActivityRow => ({
      id,
      actor_id: null,
      kind: "task.created",
      entity_type: "task",
      entity_id: null,
      payload: {},
      created_at: createdAt,
    });

    const groups = groupByDay(
      [make(2, "2026-11-05T12:00:00Z"), make(1, "2026-11-05T08:00:00Z")],
      "Europe/Moscow",
      "2026-11-05",
      "2026-11-04",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.id)).toEqual([2, 1]);
  });
});
