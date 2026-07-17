# Деплой QuarryOps на Vercel — чек-лист

## Перед деплоем
1. `node scripts/rls-tests.mjs` — все проверки зелёные.
2. `npm run build` — локальная сборка проходит.

## Vercel (первый раз)
1. vercel.com → **Add New Project** → импорт репозитория `qulaman/petrosys`.
2. Framework: Next.js (определится сам). Регион функций уже закреплён в `vercel.json` → **bom1** (Мумбаи, рядом с БД ap-south-1) — не менять.
3. **Environment Variables** (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL` = https://zrnchnamijfztdzqkzoz.supabase.co
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (anon key из Supabase → Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` = (service_role key — секрет!)
4. Deploy.

## После деплоя
1. Открыть прод-URL → войти админом → прогнать: выдача топлива, журнал смены, дашборд, закрытие периода.
2. Supabase → Authentication → URL Configuration: добавить прод-домен в **Site URL / Redirect URLs**.
3. Телефон полевого сотрудника: открыть сайт → «Добавить на главный экран» (PWA).
4. (Рекомендация) Ротация ключей, если публиковались вне команды: Supabase → Settings → API → Rotate.

## Обновления
- `git push` в `main` → Vercel деплоит автоматически.
- Миграции БД применяются вручную: `npx supabase db push --db-url "postgresql://postgres.zrnchnamijfztdzqkzoz:ПАРОЛЬ@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"`, затем перегенерировать типы (см. memory/README).
