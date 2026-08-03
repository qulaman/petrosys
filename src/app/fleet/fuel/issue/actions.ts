"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { devError, devLog, IS_DEV } from "@/lib/dev-log";
import { zUuid } from "@/lib/validation";
import { dbError } from "@/lib/db-error";
import type { Database } from "@/lib/supabase/database.types";

/** Сколько минут заправщик может отменить собственную выдачу (совпадает с RLS). */
const UNDO_WINDOW_MIN = 15;

/** Нарушение уникальности в Postgres — повторная доставка той же выдачи. */
const UNIQUE_VIOLATION = "23505";

type FuelIssueInsert = Database["public"]["Tables"]["fuel_issues"]["Insert"];

/**
 * Колонки миграции 0030 (client_key, issued_at) есть в БД, но ещё не попали в
 * сгенерированный `database.types.ts`: `supabase gen types` требует либо Docker,
 * либо SUPABASE_ACCESS_TOKEN, и ни того, ни другого на машине сейчас нет.
 *
 * Тип объявлен здесь, а не правкой генерируемого файла (запрещена) и не через
 * `as never` — так все остальные поля вставки остаются проверяемыми.
 * После ближайшей перегенерации типов этот тип и приведение ниже убрать.
 */
type FuelIssueInsertPending = FuelIssueInsert & {
  client_key: string | null;
  issued_at: string | null;
};

const schema = z.object({
  source_type: z.enum(["card", "tanker"]),
  fuel_card_id: zUuid.nullable(),
  tanker_id: zUuid.nullable(),
  vehicle_id: zUuid,
  driver_id: zUuid,
  liters: z.number().positive().max(100000),
  odometer: z.number().nonnegative().nullable(),
  receipt_path: z.string().nullable(),
  signature_path: z.string().min(1),
  /** Ключ операции с телефона: досылка из outbox не должна создавать дубль. */
  client_key: zUuid.nullable().optional(),
  /** Момент выдачи на телефоне; created_at — время доставки на сервер. */
  issued_at: z.string().min(1).nullable().optional(),
  // геолокация больше не собирается; поля оставлены для совместимости outbox
  geo_lat: z.number().nullable().optional(),
  geo_lng: z.number().nullable().optional(),
});

export type CreateFuelIssueInput = z.infer<typeof schema>;

/** id отсутствует, когда запись уже была создана предыдущей попыткой доставки. */
export type CreateFuelIssueResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export async function createFuelIssue(
  input: CreateFuelIssueInput,
): Promise<CreateFuelIssueResult> {
  devLog("createFuelIssue", "input:", input);

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    devError("createFuelIssue", "валидация не прошла:", issues, parsed.error.flatten());
    return {
      ok: false,
      error: IS_DEV ? `Проверьте поля — ${issues}` : "Проверьте заполнение полей",
    };
  }
  const d = parsed.data;

  if (d.source_type === "card" && !d.fuel_card_id)
    return { ok: false, error: "Не выбрана топливная карта" };
  if (d.source_type === "tanker" && !d.tanker_id)
    return { ok: false, error: "Не выбран бензовоз" };

  const supabase = await createClient();
  const row: FuelIssueInsertPending = {
    source_type: d.source_type,
    fuel_card_id: d.source_type === "card" ? d.fuel_card_id : null,
    tanker_id: d.source_type === "tanker" ? d.tanker_id : null,
    vehicle_id: d.vehicle_id,
    driver_id: d.driver_id,
    liters: d.liters,
    odometer: d.odometer,
    receipt_photo_url: d.receipt_path,
    driver_signature_url: d.signature_path,
    client_key: d.client_key ?? null,
    issued_at: d.issued_at ?? null,
    geo_lat: d.geo_lat ?? null,
    geo_lng: d.geo_lng ?? null,
  };
  const { data, error } = await supabase
    .from("fuel_issues")
    .insert(row as FuelIssueInsert)
    .select("id")
    .single();

  if (error) {
    // Повторная доставка той же выдачи: первая попытка дошла, а ответ потерялся.
    // Это успех, а не ошибка — иначе очередь досылала бы её вечно, и заправщик
    // видел бы «не отправлено» под уже записанной выдачей.
    if (error.code === UNIQUE_VIOLATION && d.client_key) {
      devLog("createFuelIssue", "повтор доставки, запись уже есть:", d.client_key);
      return { ok: true };
    }
    devError("createFuelIssue", "ошибка вставки:", error);
    return { ok: false, error: dbError("fleet/fuel/issue/actions", error) };
  }
  devLog("createFuelIssue", "успех, id:", data.id);
  return { ok: true, id: data.id };
}

export type UndoResult = { ok: true } | { ok: false; error: string };

/**
 * Отмена последней СВОЕЙ выдачи в течение 15 минут — кнопка сразу после записи.
 *
 * Промах по кнопке на смене иначе стоит звонка администратору: у заправщика нет
 * ни журнала, ни права правки. Право ограничено политикой RLS (своя запись +
 * 15 минут), здесь оно не выдаётся, а только используется.
 *
 * Файлы стираются следом за строкой — тем же порядком, что при админском
 * удалении: сначала запись, потом объекты. Упадёт удаление файла — останется
 * сирота в бакете, а не выдача без юридически значимой подписи.
 */
export async function undoLastFuelIssue(): Promise<UndoResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Нужно войти в систему" };

  const cutoff = new Date(Date.now() - UNDO_WINDOW_MIN * 60_000).toISOString();
  const { data: row, error: readError } = await supabase
    .from("fuel_issues")
    .select("id, driver_signature_url, receipt_photo_url")
    .eq("issued_by", auth.user.id)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) {
    devError("undoLastFuelIssue", "чтение:", readError);
    return { ok: false, error: dbError("fleet/fuel/issue/actions", readError) };
  }
  if (!row) return { ok: false, error: `Отменять нечего: прошло больше ${UNDO_WINDOW_MIN} минут` };

  // .select() обязателен: без права на удаление PostgREST вернёт успех и ноль
  // строк, и заправщик увидел бы «отменено» при оставшейся в базе выдаче.
  const { data: removed, error } = await supabase
    .from("fuel_issues")
    .delete()
    .eq("id", row.id)
    .select("id");
  if (error) {
    devError("undoLastFuelIssue", "удаление:", error);
    return { ok: false, error: dbError("fleet/fuel/issue/actions", error) };
  }
  if (!removed?.length) {
    return { ok: false, error: "Отмена недоступна — обратитесь к администратору" };
  }

  // Через admin: политик DELETE на бакетах нет, а право уже проверено выше.
  const admin = createAdminClient();
  const drop = async (bucket: string, path: string | null | undefined) => {
    if (!path) return;
    const { error: e } = await admin.storage.from(bucket).remove([path]);
    if (e) devError("undoLastFuelIssue", `${bucket}/${path}`, e);
  };
  await Promise.all([
    drop("signatures", row.driver_signature_url),
    drop("receipts", row.receipt_photo_url),
  ]);
  devLog("undoLastFuelIssue", "отменена выдача", row.id);
  return { ok: true };
}
