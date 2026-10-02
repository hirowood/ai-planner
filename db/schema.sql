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

-- EXP-010: 会話の保存 (thread は plan か chat)。続きから読み込むため
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  project_id uuid not null references projects (id) on delete cascade,
  thread text not null,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_owner_project_thread_created_idx on messages (owner, project_id, thread, created_at);

-- EXP-017: プロジェクトの中の階層 (kgi → kpi → kdi → todo) とタスクの状態。親を消すと子も消える
create table if not exists plan_items (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  project_id uuid not null references projects (id) on delete cascade,
  parent_id uuid references plan_items (id) on delete cascade,
  level text not null,
  title text not null,
  target text not null default '',
  due_date date,
  status text not null default 'todo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plan_items_owner_project_idx on plan_items (owner, project_id);

-- EXP-020: 1 日の記録 (〇△×・良かったこと 3 つ・明日はこうする)。プロジェクトごとに 1 日 1 件
create table if not exists daily_logs (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  project_id uuid not null references projects (id) on delete cascade,
  day date not null,
  mark text not null,
  goods jsonb not null default '[]'::jsonb,
  tomorrow text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, project_id, day)
);

-- EXP-030: ToDo を予定 (Google カレンダー) に入れた記録。1 つの ToDo に予定は 1 つ。event_id は作る間 'pending'
create table if not exists item_events (
  item_id uuid primary key references plan_items (id) on delete cascade,
  owner text not null,
  event_id text not null,
  start_time text not null default '',
  end_time text not null default '',
  created_at timestamptz not null default now()
);
