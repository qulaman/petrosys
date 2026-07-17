-- =============================================================================
-- QuarryOps · Миграция 0007 — Realtime для живой ленты дашборда «Сегодня»
-- Добавляем доменные таблицы событий в публикацию supabase_realtime.
-- RLS продолжает действовать: подписчик получает только доступные ему строки.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.fuel_issues;
    alter publication supabase_realtime add table public.trip_records;
    alter publication supabase_realtime add table public.shift_records;
  end if;
exception
  when duplicate_object then null; -- таблица уже в публикации
end;
$$;
