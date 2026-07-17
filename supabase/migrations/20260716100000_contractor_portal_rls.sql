-- =============================================================================
-- QuarryOps · Миграция 0009 — RLS портала подрядчика (роль contractor, read-only)
-- Подрядчик видит ТОЛЬКО данные своих договоров по цепочке
-- vehicle.contractor_id / contract.contractor_id = profiles.contractor_id.
-- Никаких insert/update — только select. Это отложенные из Фазы 1 политики.
-- =============================================================================

-- Хелперы (SECURITY DEFINER — читают в обход RLS, безопасны в политиках).
create or replace function public.my_vehicle_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.vehicles where contractor_id = public.current_contractor_id()
$$;

create or replace function public.my_contract_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.contracts where contractor_id = public.current_contractor_id()
$$;

-- Свой контрагент (для реквизитов/НДС в портале).
create policy "contractor reads own contractor"
  on public.contractors for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and id = public.current_contractor_id());

-- Договоры / техника / водители — напрямую по contractor_id.
create policy "contractor reads own contracts"
  on public.contracts for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and contractor_id = public.current_contractor_id());

create policy "contractor reads own vehicles"
  on public.vehicles for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and contractor_id = public.current_contractor_id());

create policy "contractor reads own drivers"
  on public.drivers for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and contractor_id = public.current_contractor_id());

-- Прайсы / цены ГСМ — по своим договорам.
create policy "contractor reads own price_list"
  on public.price_list for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and contract_id in (select public.my_contract_ids()));

create policy "contractor reads own fuel_prices"
  on public.contract_fuel_prices for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and contract_id in (select public.my_contract_ids()));

-- Рейсы / смены / выдачи — по своим машинам.
create policy "contractor reads own trips"
  on public.trip_records for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and vehicle_id in (select public.my_vehicle_ids()));

create policy "contractor reads own shifts"
  on public.shift_records for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and vehicle_id in (select public.my_vehicle_ids()));

create policy "contractor reads own fuel_issues"
  on public.fuel_issues for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and vehicle_id in (select public.my_vehicle_ids()));

-- Штрафы / документы — по своим договорам.
create policy "contractor reads own penalties"
  on public.penalties for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and contract_id in (select public.my_contract_ids()));

create policy "contractor reads own documents"
  on public.generated_documents for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('contractor')
         and contract_id in (select public.my_contract_ids()));
