-- =============================================================================
-- QuarryOps · Миграция 0012 — правка/удаление операционных записей админом
-- Выдачи топлива, приходы/замеры бензовоза не имели политик update/delete
-- вообще; рейсы — только delete. Правки — инструмент исправления ошибок ввода,
-- доступ ограничен ролью admin (server actions дополнительно проверяют роль).
-- =============================================================================

-- Выдачи топлива
create policy "admin update fuel_issues"
  on public.fuel_issues for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('admin'))
  with check (org_id = public.current_org_id() and public.has_role('admin'));

create policy "admin delete fuel_issues"
  on public.fuel_issues for delete to authenticated
  using (org_id = public.current_org_id() and public.has_role('admin'));

-- Рейсы: правка (delete у office/admin уже есть)
create policy "admin update trip_records"
  on public.trip_records for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('admin'))
  with check (org_id = public.current_org_id() and public.has_role('admin'));

-- Бензовоз: удаление ошибочных приходов и замеров
create policy "admin delete tanker_refills"
  on public.tanker_refills for delete to authenticated
  using (org_id = public.current_org_id() and public.has_role('admin'));

create policy "admin delete tanker_measurements"
  on public.tanker_measurements for delete to authenticated
  using (org_id = public.current_org_id() and public.has_role('admin'));
