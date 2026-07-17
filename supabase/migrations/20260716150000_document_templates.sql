-- =============================================================================
-- QuarryOps · Миграция 0014 — шаблоны документов (docx с плейсхолдерами)
-- Загружаются офисом/админом, версионируются заменой файла (version+1),
-- применяются при генерации документов (docxtemplater). Файлы — в приватном
-- бакете templates, IO только через service_role (объектные политики не нужны).
-- =============================================================================

create table public.document_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.current_org_id()
                references public.organizations(id),
  name          text not null,
  doc_type      text not null check (doc_type in (
                  'contract', 'appendix1', 'appendix2', 'amendment', 'avr',
                  'reconciliation_act', 'trip_register', 'fuel_statement',
                  'claim_overconsumption', 'downtime_act')),
  contract_type text check (contract_type in ('transportation', 'equipment')),
                -- null = подходит для любого типа договора
  file_url      text not null,
  version       integer not null default 1,
  is_active     boolean not null default true,
  created_by    uuid not null default auth.uid() references auth.users(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.document_templates is
  'docx-шаблоны документов с плейсхолдерами {name}; правка = замена файла новой версией.';

alter table public.document_templates enable row level security;

create policy "office manage document_templates"
  on public.document_templates for all to authenticated
  using (org_id = public.current_org_id()
         and public.has_any_role(array['office', 'admin']))
  with check (org_id = public.current_org_id()
              and public.has_any_role(array['office', 'admin']));

-- Бакет шаблонов (private, ≤ 5 МБ, только docx).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('templates', 'templates', false, 5242880,
        array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
