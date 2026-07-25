-- =============================================================================
-- QuarryOps · Миграция 0026 — аудит сводок объёма и простоев
-- В журнале объёма появились правка и удаление записей, влияющих на прогноз,
-- поэтому production_facts должна попадать в «Журнал изменений» наравне с
-- остальными фактами. Заодно закрываем пропущенные downtime_records.
-- =============================================================================

do $mig$
declare t text;
begin
  foreach t in array array['production_facts', 'downtime_records'] loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', t)::regclass
        and tgname = format('audit_%s', t)
    ) then
      execute format(
        'create trigger audit_%s after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
        t, t
      );
    end if;
  end loop;
end;
$mig$;
