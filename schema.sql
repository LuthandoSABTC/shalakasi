-- ============================================================
-- ShalaKasi — Supabase schema
-- Bitcoin Ekasi adaptive Diploma platform
-- ============================================================
-- Run this in the Supabase SQL editor on a fresh project.
-- Uses gen_random_uuid() (pgcrypto, enabled by default on Supabase).

-- ------------------------------------------------------------
-- CURRICULUM
-- ------------------------------------------------------------

create table chapters (
  id            uuid primary key default gen_random_uuid(),
  number        int not null unique,          -- 1..10
  title         text not null,
  sort_order    int not null,
  created_at    timestamptz not null default now()
);

create table sections (
  id              uuid primary key default gen_random_uuid(),
  chapter_id      uuid not null references chapters(id) on delete cascade,
  number          text not null,               -- e.g. "2.1", "4.2.2" (kept as text — has sub-levels)
  title           text not null,
  sort_order      int not null,
  has_activity    boolean not null default false,
  activity_title  text,
  skill_tag       text,                        -- e.g. "properties_of_money" — used by the adaptive engine
  content_md      text,                        -- lesson content, filled in during content-authoring pass
  created_at      timestamptz not null default now(),
  unique (chapter_id, number)
);

create index idx_sections_chapter on sections(chapter_id);

-- ------------------------------------------------------------
-- STUDENTS
-- ------------------------------------------------------------

create table students (
  id              uuid primary key default gen_random_uuid(),
  username        text not null unique,
  password_hash   text not null,               -- bcrypt, never store plaintext
  full_name       text not null,
  cohort          text,                        -- e.g. "2026-Q3"
  created_by      text,                        -- admin username who provisioned this account
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- FIXED QUIZ BANK (phase 1 — AI-generated questions come later)
-- ------------------------------------------------------------

create table quiz_bank (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references sections(id) on delete cascade,
  question        text not null,
  options         jsonb not null,              -- ["opt A", "opt B", "opt C"]
  correct_index   int not null,
  difficulty      text not null default 'core' check (difficulty in ('core','stretch','review')),
  created_at      timestamptz not null default now()
);

create index idx_quiz_section on quiz_bank(section_id);

-- ------------------------------------------------------------
-- PROGRESS TRACKING
-- ------------------------------------------------------------

create table student_progress (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  section_id      uuid not null references sections(id) on delete cascade,
  status          text not null default 'locked'
                    check (status in ('locked','available','in_progress','mastered','reinforced')),
  mastery_score   numeric(4,3) not null default 0,   -- 0.000 - 1.000
  attempts_count  int not null default 0,
  last_updated    timestamptz not null default now(),
  unique (student_id, section_id)
);

create index idx_progress_student on student_progress(student_id);

create table attempts (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  quiz_id         uuid not null references quiz_bank(id) on delete cascade,
  selected_index  int not null,
  is_correct      boolean not null,
  response_time_ms int,
  attempted_at    timestamptz not null default now()
);

create index idx_attempts_student on attempts(student_id);

-- ------------------------------------------------------------
-- SATOSHI CHAT LOG
-- ------------------------------------------------------------

create table chat_log (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  section_id      uuid references sections(id) on delete set null,
  role            text not null check (role in ('student','satoshi')),
  message         text not null,
  created_at      timestamptz not null default now()
);

create index idx_chat_student on chat_log(student_id, created_at);

-- ------------------------------------------------------------
-- ADAPTIVE ENGINE DECISION LOG (auditability)
-- ------------------------------------------------------------

create table ai_decisions (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  from_section_id   uuid references sections(id) on delete set null,
  to_section_id     uuid references sections(id) on delete set null,
  decision_type     text not null check (decision_type in ('advance','reinforce','branch')),
  reasoning         text not null,             -- human-readable explanation, shown to admin + student dashboard
  created_at        timestamptz not null default now()
);

create index idx_decisions_student on ai_decisions(student_id, created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Following the pattern from the bitcoinekasi Supabase RLS fix:
-- lock every table down by default. The app talks to Supabase
-- using the service_role key from the backend only — students
-- never hold Supabase credentials directly, so RLS here is a
-- defense-in-depth measure, not the primary access control.

alter table chapters          enable row level security;
alter table sections          enable row level security;
alter table students          enable row level security;
alter table quiz_bank         enable row level security;
alter table student_progress  enable row level security;
alter table attempts          enable row level security;
alter table chat_log          enable row level security;
alter table ai_decisions      enable row level security;

-- No public policies are created here on purpose — only the
-- service_role key (used server-side) bypasses RLS by default.
-- If a browser-side Supabase client is ever introduced later,
-- add narrow policies then (e.g. a student can only select their
-- own rows via auth.uid() matching a students.auth_id column).
