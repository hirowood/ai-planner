-- 目的別プロジェクトとノート (EXP-008)。何度流しても同じ結果になる (if not exists)。
-- 流し方: node --env-file=.env.local scripts/db-migrate.mjs

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  name text not null,
  category text not null check (category in ('habit', 'learning', 'work')),
  purpose text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists projects_owner_idx on projects (owner);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null check (kind in ('fact', 'data', 'thought')),
  body text not null,
  cycle_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists notes_owner_project_created_idx on notes (owner, project_id, created_at desc);
