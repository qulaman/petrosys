-- =============================================================================
-- QuarryOps · Миграция 0018 — один «Счёт АЗС» вместо отдельных топливных карт
-- Правка данных, схема не меняется: в каждой организации остаётся одна
-- активная карта с именем «Счёт АЗС», все выдачи/приходы перепривязываются
-- к ней, остальные карты деактивируются. Справочник карт в админке остаётся —
-- при необходимости можно завести новые.
-- =============================================================================

do $$
declare
  o    record;
  keep uuid;
begin
  for o in select distinct org_id from public.fuel_cards loop
    -- Оставляем самую раннюю активную карту (или самую раннюю вообще).
    select id into keep from public.fuel_cards
      where org_id = o.org_id
      order by is_active desc, created_at
      limit 1;
    if keep is null then continue; end if;

    update public.fuel_issues set fuel_card_id = keep
      where org_id = o.org_id and fuel_card_id is not null and fuel_card_id <> keep;

    update public.tanker_refills set fuel_card_id = keep
      where org_id = o.org_id and fuel_card_id is not null and fuel_card_id <> keep;

    update public.card_transactions set fuel_card_id = keep
      where org_id = o.org_id and fuel_card_id <> keep;

    update public.fuel_cards
      set card_number = 'Счёт АЗС', is_active = true
      where id = keep;

    update public.fuel_cards
      set is_active = false
      where org_id = o.org_id and id <> keep;
  end loop;
end $$;
