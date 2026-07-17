-- =============================================================================
-- QuarryOps · Миграция 0004 — Storage-бакеты для подписей и чеков
-- Приватные бакеты; чтение офисом — через signed URLs (генерируются сервером
-- на service_role). Путь объектов: <org_id>/<yyyy>/<mm>/<uuid>.<ext>.
-- =============================================================================

-- Бакеты (private). Лимиты и MIME — защита от мусора.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('signatures', 'signatures', false, 1048576,  array['image/png']),                       -- подписи ≤ 1 МБ, только PNG
  ('receipts',   'receipts',   false, 10485760, array['image/jpeg','image/png','image/webp']) -- чеки ≤ 10 МБ
on conflict (id) do nothing;

-- Загрузка: аутентифицированные полевые/офисные роли пишут в свои бакеты,
-- в префикс своего org_id (первый сегмент пути).
create policy "upload signatures/receipts (staff)"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('signatures', 'receipts')
    and public.has_any_role(array['fueler', 'itr', 'checker', 'office', 'admin'])
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- Прямое чтение — только своих объектов (владелец). Остальным офис отдаёт
-- контент через signed URLs (server-side, service_role — минует RLS).
create policy "read own signatures/receipts"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('signatures', 'receipts')
    and owner = auth.uid()
  );
