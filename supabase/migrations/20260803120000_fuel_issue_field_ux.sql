-- =============================================================================
-- QuarryOps · Миграция 0030 — выдача ГСМ: идемпотентность, время события,
-- отмена своей записи заправщиком.
--
-- client_key — ключ операции, созданный на телефоне при постановке в outbox.
-- Досылка после потерянного ответа больше не создаёт вторую выдачу: повтор
-- упирается в уникальный индекс, и экран засчитывает запись как принятую.
-- Выдача несёт юридически значимую подпись и деньги (удержание ГСМ), поэтому
-- дубль здесь дороже, чем где-либо ещё.
--
-- issued_at — момент выдачи на телефоне заправщика. created_at остаётся
-- временем доставки на сервер: при плохой связи они расходятся, а выдача должна
-- попадать в свою смену и свои сутки. Тот же приём, что tapped_at у рейсов.
--
-- Политика отмены: заправщик убирает СВОЮ ошибочную запись в течение 15 минут
-- (кнопка «Отменить» сразу после выдачи). Дальше — только админ, как и было.
-- =============================================================================

alter table public.fuel_issues
  add column if not exists client_key uuid,
  add column if not exists issued_at timestamptz;

comment on column public.fuel_issues.client_key is
  'Ключ операции с телефона (outbox). Повторная досылка не создаёт дубль. NULL — импорт и записи до внедрения.';
comment on column public.fuel_issues.issued_at is
  'Момент выдачи на телефоне заправщика. created_at — время доставки на сервер.';

-- Частичный индекс: импортированные записи без ключа друг другу не мешают.
create unique index if not exists fuel_issues_client_key_uniq
  on public.fuel_issues (org_id, client_key)
  where client_key is not null;

drop policy if exists "fueler delete own recent fuel_issues" on public.fuel_issues;
create policy "fueler delete own recent fuel_issues"
  on public.fuel_issues for delete to authenticated
  using (
    org_id = public.current_org_id()
    and issued_by = auth.uid()
    and created_at > now() - interval '15 minutes'
  );
