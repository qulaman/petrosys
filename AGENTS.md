# QuarryOps — AGENTS.md

Файл для AI-агентов, работающих с этим репозиторием. Читатель ничего не знает о проекте — начни отсюда.

## Обзор проекта

**QuarryOps** — система учёта работы техники и ГСМ (топлива) на карьере. Первый клиент — ТОО «West Arlan Group» (карьер под Актобе, Казахстан). Продукт задуман как тиражируемый standalone.

Учитываются:
- **Моточасы** — стационарная техника (грейдеры, экскаваторы, бульдозеры, катки): табель смен.
- **Рейсы** — самосвалы, возят грунт: фиксация в точке разгрузки.
- **Выдача топлива** — по топливной карте на АЗС или с бензовоза (бензовоз ведётся как склад с балансом).
- **Взаиморасчёты** с субподрядчиками (водители и техника — сторонние ИП, не штат): закрытие периода, акты, документы DOCX/XLSX.

Рукописная подпись водителя на выдачу топлива и смену — юридически значима (canvas-подпись на телефоне сотрудника). Полное ТЗ: `docs/quarry-fleet-module-spec.md` (главный источник бизнес-логики), бизнес-версия: `docs/ТЗ_учёт_техники_и_ГСМ_бизнес_версия.md`.

Приложение — **PWA** для телефонов полевых сотрудников (`src/app/manifest.ts`, иконки в `public/`), язык интерфейса — русский, часовой пояс объекта — `Asia/Aqtobe` (`src/lib/tz.ts`).

## Технологический стек

- **Next.js 16.2.10** (App Router, TypeScript strict) + **React 19**
- **Supabase** (Postgres 17, Auth, Storage, Realtime) — вся БД и RLS; `@supabase/ssr` для cookie-сессий
- **Tailwind CSS 4** + **shadcn/ui** (`components.json`, стиль `base-nova`, иконки lucide)
- **TanStack Query**, react-hook-form + **zod v4**, sonner (тосты), recharts (дашборд)
- Документы: **docxtemplater + pizzip** (DOCX из шаблонов), **exceljs** (XLSX-акты)
- Полевые фичи: html5-qrcode (скан QR техники), signature_pad (подписи), qrcode (генерация наклеек)
- Деплой: **Vercel**, регион функций `bom1` закреплён в `vercel.json` (рядом с БД в ap-south-1) — не менять

⚠️ **Это НЕ тот Next.js, который ты знаешь.** Версия 16 имеет ломающие изменения — API, соглашения и структура могут отличаться от обучающих данных. Перед написанием кода читай соответствующий гайд в `node_modules/next/dist/docs/`, обращай внимание на deprecation notices. Пример: вместо `middleware.ts` теперь соглашение **`src/proxy.ts`** с экспортом `proxy` (см. `src/proxy.ts`).

## Команды

```bash
npm run dev      # dev-сервер (localhost:3000)
npm run build    # прод-сборка — обязательно прогнать перед деплоем
npm run lint     # eslint (flat config, eslint-config-next core-web-vitals + typescript)
npm start        # прод-сервер после build

node scripts/rls-tests.mjs   # RLS-тесты против живой БД (см. раздел «Тестирование»)
node scripts/seed.mjs        # применить supabase/seed.sql (нужна env SEED_DB_URL)
```

Юнит-тестового фреймворка (vitest/jest) в проекте **нет**. Проверка корректности — `npm run build` (типы strict) + `npm run lint` + RLS-прогон.

## Структура кода

```
src/
├── proxy.ts                  # Next 16: замена middleware — освежает Supabase-сессию на каждом запросе
├── app/                      # App Router
│   ├── page.tsx              # корневой диспетчер: не вошёл → /login; вошёл → экран роли
│   ├── login/, no-access/    # вход и заглушка «нет ролей»
│   ├── fleet/                # основное приложение (сотрудники заказчика)
│   │   ├── dashboard/        # дашборд (today/work/fuel/money вкладки) + anomalies/
│   │   ├── fuel/issue/       # фиксация выдачи топлива (заправщик)
│   │   ├── fuel/tanker/      # приход/баланс бензовоза
│   │   ├── shifts/           # табель смен / моточасы (ИТР)
│   │   ├── trips/            # рейсы самосвалов (учётчик)
│   │   ├── journals/         # журналы: fuel / shifts / trips + csv-выгрузка
│   │   ├── office/           # documents (генерация), settlement (закрытие периода)
│   │   └── admin/            # users, contracts, qr, templates, [entity] — универсальный CRUD справочников
│   └── portal/               # read-only портал подрядчика (свои договоры: рейсы, часы, топливо, документы)
├── components/
│   ├── ui/                   # shadcn-компоненты (генерируемые — не править вручную без нужды)
│   ├── admin/, documents/, field/, journals/, brand/
│   └── app-shell.tsx, portal-shell.tsx, nav-bar.tsx  # каркасы экранов
└── lib/
    ├── auth/                 # roles.ts (роли+домашние экраны), current-user.ts (React.cache-обёртка)
    ├── supabase/             # client.ts (браузер), server.ts (RSC/actions, через RLS),
    │                         # admin.ts (service role — ОСТОРОЖНО), middleware.ts,
    │                         # database.types.ts (СГЕНЕРИРОВАННЫЕ типы БД, 1600+ строк)
    ├── data/                 # серверные загрузчики данных по модулям (dashboard, journals, trips…)
    ├── admin/registry.ts     # реестр справочников для универсального admin CRUD (slug = имя таблицы)
    ├── documents/            # генерация DOCX/XLSX: builders, render, docx, act-xlsx, save
    ├── journals/             # period.ts (периоды), csv.ts
    ├── outbox/               # retry-outbox в localStorage — полевые записи не теряются при обрыве сети
    ├── storage/              # upload + signed-url (Supabase Storage)
    ├── i18n/ru.ts            # словарь строк UI; задел под казахский — плоский словарь, без фреймворка
    ├── domain.ts             # доменные типы и русские подписи (VehicleType, AccountingType…)
    ├── validation.ts         # zUuid и пр. (zod v4: z.string().uuid() отвергает сид-UUID — см. комментарий)
    ├── tz.ts, format.ts, utils.ts, dev-log.ts, anomalies.ts
docs/                         # ТЗ, планы импорта, реестр договоров, исходники договоров
scripts/                      # seed.mjs, rls-tests.mjs, import-contracts.mjs, import-july.mjs
supabase/                     # migrations/ (17 миграций), seed.sql, config.toml
```

## Архитектура и соглашения

- **Мультитенантность с первого дня.** Колонка `org_id uuid not null` во ВСЕХ доменных таблицах; каждая RLS-политика проверяет `org_id` по профилю. Организация пока одна, но писать запросы/миграции без `org_id` недопустимо.
- **Парк = только техника с фактами работы** (решение заказчика 20.07.2026): машины попадают в `vehicles` только из фактов (табель/рейсы/ГСМ) или вручную через админку. Договоры и их приложения машин НЕ порождают (`import-contracts.mjs` создаёт машины только с флагом `--create-vehicles`) — договорной контур (контрагенты, договоры, прайсы, цены ГСМ) живёт как справочник для расчёта АВР. Удалённые при пересборке машины и их точечные цены — в `docs/fleet_snapshot_removed_2026-07-20.json`.
- **Роли** (`src/lib/auth/roles.ts`): `admin`, `office`, `fueler`, `itr`, `checker`, `contractor`. У пользователя может быть несколько ролей (`profiles.roles text[]`); домашний экран выбирается по приоритету (офисные важнее полевых, портал последним) — `homePathForRoles()`. После логина каждая роль попадает сразу на СВОЙ рабочий экран, а не в меню.
- **Авторизация двухслойная**: `proxy.ts` только освежает cookie сессии (`getSession()`, без сети); реальную проверку делают серверные страницы (`getCurrentProfile()` с `getUser()`, кешируется на запрос через `React.cache`) и RLS в БД. Не возвращать `getUser()` в middleware — это +~226 мс на каждый переход (см. комментарий в `src/lib/supabase/middleware.ts`).
- **Три Supabase-клиента** — не путать: `lib/supabase/client.ts` (браузер), `lib/supabase/server.ts` (сервер, anon key + cookies, запросы идут через RLS от имени пользователя), `lib/supabase/admin.ts` (service role, в обход RLS — только там, где это осознанно нужно).
- **Server actions** (`"use server"`, файлы `actions.ts` рядом со страницей): вход валидируется **zod-схемой в первую очередь**, результат — размеченное объединение `{ ok: true, ... } | { ok: false; error: string }`, текст ошибки пользователю на русском; детали в проде не утекают (см. паттерн `IS_DEV` в `src/lib/dev-log.ts` и пример `src/app/fleet/fuel/issue/actions.ts`).
- **Типы БД** `src/lib/supabase/database.types.ts` генерируются из удалённой БД (`supabase gen types`) и **не правятся вручную**. `src/lib/domain.ts` — ручные доменные типы/подписи, соответствующие check-ограничениям миграций.
- **Полевая надёжность**: записи (рейс, смена, выдача) при ошибке сети складываются в outbox (localStorage) и переотправляются — полноценный offline-first по ТЗ не делаем, но потеря записи недопустима (`src/lib/outbox/`).
- **i18n**: все строки UI — через словарь `src/lib/i18n/ru.ts` (доступ `ru.section.key`), не хардкодить русский текст в разметке там, где строка уже есть в словаре.
- **Пути**: алиас `@/*` → `src/*` (tsconfig).
- **Стиль кода**: TypeScript strict, комментарии и пользовательские строки — на русском, коммит-сообщения тоже на русском. Серверные компоненты по умолчанию; `"use client"` только где нужна интерактивность.

## База данных и миграции

- Миграции — SQL-файлы в `supabase/migrations/` (префикс-дата), применяются к прод-БД **вручную**:
  `npx supabase db push --db-url "postgresql://postgres.<ref>:ПАРОЛЬ@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"` — точная команда в `DEPLOY.md`. После изменений схемы перегенерировать `database.types.ts`.
- `supabase/seed.sql` — идемпотентные сиды реальных данных (фиксированные читаемые UUID вида `10000000-…`, `on conflict do nothing`); применение: `SEED_DB_URL=... node scripts/seed.mjs`.
- RLS включён на всех доменных таблицах; подрядчик (`contractor`) видит только своё по цепочке `profiles.contractor_id → vehicles/contracts.contractor_id`, писать не может никуда.
- Storage: бакеты `signatures`, `documents` — пути привязаны к org, политики в миграциях `*_storage.sql` / `*_documents_bucket.sql`.

## Тестирование

- **`node scripts/rls-tests.mjs`** — главный тестовый прогон, ходит в живую БД: аноним ничего не видит, подрядчик видит только своё и не может писать, storage-пути изолированы по org. Требует `.env.local` (все три ключа) и админ-аккаунт; код выхода 1 при провале. Создаёт и удаляет временного тест-подрядчика/пользователя. **Обязателен перед каждым деплоем** (чек-лист в `DEPLOY.md`).
- Дымовая проверка: `npm run build` + `npm run lint`.
- Автотестов на бизнес-логику нет — изменения логики проверяются вручную по сценариям из ТЗ.

## Скрипты данных (scripts/)

Одноразовые/повторяемые импорты реальных данных заказчика; все работают в dry-run по умолчанию, запись — с флагом `--commit` (service role):

- `import-contracts.mjs` — договоры субподрядчиков из `docs/contracts` (контрагенты, прайсы, цены ГСМ, привязка машин). План: `docs/contracts_import_plan.md`.
- `import-july.mjs` — данные июля 2026 из `docs/Июль_16.07.26_3_для_Алмаса.xlsx` (wipe демо-данных + загрузка фактов). План: `docs/import_july_2026_plan.md`.

## Безопасность

- `.env.local` в `.gitignore`; шаблон без секретов — `.env.example`. Ключи в репозиторий не коммитить; пароли БД/аккаунтов не вписывать в код и доки.
- `SUPABASE_SERVICE_ROLE_KEY` — секрет, обходит RLS. Никогда не префиксить `NEXT_PUBLIC_` и не импортировать `lib/supabase/admin.ts` из клиентского кода.
- Подписи и документы — юридически значимы: не ослаблять RLS/Storage-политики и валидацию подписи (`signature_path` обязателен в выдаче топлива).
- Если ключи публиковались вне команды — ротация: Supabase → Settings → API → Rotate (см. `DEPLOY.md`).

## Деплой

- Vercel: импорт репозитория `qulaman/petrosys`, `git push` в `main` → автодеплой. Полный чек-лист — `DEPLOY.md` (env-переменные, регион bom1, post-deploy настройки Supabase Auth redirect URLs, PWA на телефон).
- Миграции БД в прод — вручную (см. выше), автоматики нет.
