-- =============================================================================
-- QuarryOps · Миграция 0023 — карточка смены рейсов (двухэтапный ввод, как Табель)
-- Перечень вывода на линию (trip_lineups) становится «карточкой смены»:
-- рейсы копятся в ней черновиком, мастер проверяет, подписывает и закрывает.
-- Деньги/АВР считают только рейсы ЗАКРЫТЫХ карточек (legacy без карточки —
-- как подтверждённые, аналогично сменам без журнала).
-- =============================================================================

alter table public.trip_lineups
  add column if not exists status text not null default 'open'
    check (status in ('open', 'closed')),
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id),
  add column if not exists master_signature_url text;
comment on column public.trip_lineups.status is
  'open — карточка смены редактируется (рейсы черновые), closed — подтверждена мастером, рейсы в расчётах.';

alter table public.trip_records
  add column if not exists lineup_id uuid references public.trip_lineups(id);
create index if not exists trip_records_lineup_idx on public.trip_records (lineup_id);
comment on column public.trip_records.lineup_id is
  'Карточка смены. NULL — legacy-записи до двухэтапного ввода (считаются подтверждёнными).';

-- Бэкфилл: привязываем существующие рейсы к карточкам их смен (по окну смены
-- в поясе объекта: день 07–19, ночь 19–07 следующего дня).
update public.trip_records t
   set lineup_id = l.id
  from public.trip_lineups l
 where t.lineup_id is null
   and t.org_id = l.org_id
   and (
     (l.shift_type = 'day'
        and (t.created_at at time zone 'Asia/Aqtobe')::date = l.work_date
        and (t.created_at at time zone 'Asia/Aqtobe')::time >= '07:00'
        and (t.created_at at time zone 'Asia/Aqtobe')::time < '19:00')
     or
     (l.shift_type = 'night'
        and (((t.created_at at time zone 'Asia/Aqtobe')::date = l.work_date
                and (t.created_at at time zone 'Asia/Aqtobe')::time >= '19:00')
             or ((t.created_at at time zone 'Asia/Aqtobe')::date = l.work_date + 1
                and (t.created_at at time zone 'Asia/Aqtobe')::time < '07:00')))
   );

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- Свои рейсы в ОТКРЫТОЙ карточке учётчик удаляет свободно (5-минутное окно
-- старой политики остаётся только для legacy-записей без карточки).
create policy "own trip delete in open lineup"
  on public.trip_records for delete to authenticated
  using (
    org_id = public.current_org_id()
    and recorded_by = auth.uid()
    and lineup_id is not null
    and exists (select 1 from public.trip_lineups l
                where l.id = lineup_id and l.status = 'open')
  );

-- Закрытие карточки: учётчик — пока открыта; офис/админ — всегда (переоткрытие).
create policy "close or reopen trip_lineups"
  on public.trip_lineups for update to authenticated
  using (
    org_id = public.current_org_id()
    and (public.has_any_role(array['office', 'admin'])
         or (public.has_any_role(array['checker']) and status = 'open'))
  )
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['checker', 'office', 'admin']));
