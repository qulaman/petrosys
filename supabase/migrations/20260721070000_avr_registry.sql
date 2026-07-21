-- =============================================================================
-- QuarryOps · Миграция 0021 — справочник АВР
-- Водители машины (день/ночь) + тип документа у версий тарифов.
-- Расчётный движок не меняется: valid_from и так effective-dated.
-- =============================================================================

alter table public.vehicles
  add column if not exists day_driver_id   uuid references public.drivers(id),
  add column if not exists night_driver_id uuid references public.drivers(id);
comment on column public.vehicles.day_driver_id is
  'Штатный водитель дневной смены (справочник АВР); подставляется по умолчанию в полевые формы.';
comment on column public.vehicles.night_driver_id is
  'Штатный водитель ночной смены (справочник АВР).';

alter table public.price_list
  add column if not exists doc_type text
  check (doc_type in ('contract', 'addendum', 'manual'));
alter table public.contract_fuel_prices
  add column if not exists doc_type text
  check (doc_type in ('contract', 'addendum', 'manual'));
comment on column public.price_list.doc_type is
  'Источник версии условий: договор / доп.соглашение / ручной ввод (справочник АВР).';

-- Существующие версии загружены из договоров и допников: помечаем по note,
-- остальное — договором.
update public.price_list set doc_type = 'addendum'
 where doc_type is null and note ilike '%доп%';
update public.price_list set doc_type = 'contract' where doc_type is null;
update public.contract_fuel_prices set doc_type = 'addendum'
 where doc_type is null and note ilike '%доп%';
update public.contract_fuel_prices set doc_type = 'contract' where doc_type is null;
