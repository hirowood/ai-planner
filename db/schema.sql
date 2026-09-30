-- 目的別プロジェクトとノート (EXP-008)。何度流しても同じ結果になる (if not exists / if exists)。
-- 流し方: node --env-file=.env.local scripts/db-migrate.mjs

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  name text not null,
  category text not null,
  purpose text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists projects_owner_idx on projects (owner);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null,
  body text not null,
  cycle_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists notes_owner_project_created_idx on notes (owner, project_id, created_at desc);

-- EXP-012: 種類は既定の値か自由入力の名前。EXP-008 で作った「3 つのどれか」の制約を外す (字数は API の検査で守る)
alter table projects drop constraint if exists projects_category_check;
alter table notes drop constraint if exists notes_kind_check;

-- EXP-009: PDCA の cycle (いまは Plan と Do)。Plan の中身は jsonb で持つ
create table if not exists cycles (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  project_id uuid not null references projects (id) on delete cascade,
  phase text not null default 'plan',
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cycles_owner_project_updated_idx on cycles (owner, project_id, updated_at desc);
