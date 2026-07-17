-- =============================================================================
-- QuarryOps · Миграция 0001 — каркас мультитенантности и авторизации
-- organizations, profiles(roles[]), RLS-хелперы, авто-создание профиля.
-- Все доменные таблицы последующих фаз обязаны иметь org_id и RLS по org.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Организации (тенанты). Сейчас одна, но мультитенантность заложена с первого дня.
-- -----------------------------------------------------------------------------
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

comment on table public.organizations is 'Тенанты системы (организации-заказчики).';

-- Дефолтная организация с фиксированным id — первый заказчик.
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'ТОО «West Arlan Group»')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Профили пользователей (1:1 с auth.users). Роль(-и) и принадлежность тенанту.
-- Роли: fueler, itr, checker, office, contractor, admin (один юзер — несколько ролей).
-- contractor_id заполняется только для роли contractor; FK добавим в миграции Фазы 1,
-- когда появится таблица contractors.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  full_name     text,
  roles         text[] not null default '{}',
  contractor_id uuid,
  created_at    timestamptz not null default now()
);

comment on table public.profiles is 'Профиль пользователя: тенант, ФИО, роли, привязка к подрядчику для роли contractor.';

create index profiles_org_id_idx on public.profiles (org_id);

-- -----------------------------------------------------------------------------
-- RLS-хелперы. SECURITY DEFINER — читают profiles в обход RLS, поэтому
-- их безопасно использовать внутри самих RLS-политик (нет рекурсии).
-- -----------------------------------------------------------------------------

-- org_id текущего пользователя.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid()
$$;

-- contractor_id текущего пользователя (для RLS портала подрядчика).
create or replace function public.current_contractor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select contractor_id from public.profiles where id = auth.uid()
$$;

-- Есть ли у текущего пользователя указанная роль.
create or replace function public.has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role_name = any(roles)
  )
$$;

-- Есть ли у текущего пользователя хотя бы одна из перечисленных ролей.
create or replace function public.has_any_role(role_names text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and roles && role_names
  )
$$;

-- -----------------------------------------------------------------------------
-- Авто-создание профиля при регистрации пользователя.
-- org_id / full_name / roles берутся из user_metadata (задаются админом при
-- создании пользователя). Если org_id не передан — привязка к единственной
-- организации (bootstrap однотенантного режима).
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_roles  text[];
begin
  v_org_id := coalesce(
    nullif(new.raw_user_meta_data->>'org_id', '')::uuid,
    (select id from public.organizations order by created_at limit 1)
  );

  if jsonb_typeof(new.raw_user_meta_data->'roles') = 'array' then
    select array_agg(value) into v_roles
    from jsonb_array_elements_text(new.raw_user_meta_data->'roles');
  end if;

  insert into public.profiles (id, org_id, full_name, roles, contractor_id)
  values (
    new.id,
    v_org_id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    coalesce(v_roles, '{}'),
    nullif(new.raw_user_meta_data->>'contractor_id', '')::uuid
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;

-- organizations: участник видит только свой тенант.
create policy "org members can read their organization"
  on public.organizations for select
  to authenticated
  using (id = public.current_org_id());

-- profiles: свой профиль читают все; чужие профили внутри тенанта — admin/office.
create policy "read own or org profiles (admin/office)"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or (
      org_id = public.current_org_id()
      and public.has_any_role(array['admin', 'office'])
    )
  );

-- profiles: пользователь может менять своё ФИО (роли/тенант — только admin, отдельным флоу).
create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
