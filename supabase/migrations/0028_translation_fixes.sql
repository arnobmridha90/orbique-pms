-- 0028: Team chat translation learning (api/_lib/translate-learn.js, api/alerts.js 'team-translate-fix').
-- A person who sees a wrong translation types the right one ("Not right?" under the message). It is kept here, the
-- shared translation is replaced at once, and the learning pass (health fix 'learn-translation') turns the corrections
-- into short style notes that every later translation of that workspace follows. `learned` marks corrections already folded in.
-- Only the server (service role) reads and writes it. Re-runnable; no data is changed.

create table if not exists public.translation_fixes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  message_id uuid references public.team_messages (id) on delete set null,
  lang text not null check (lang ~ '^[a-z]{2}$'),
  src_lang text not null default '' check (src_lang = '' or src_lang ~ '^[a-z]{2}$'),
  original text not null check (char_length(original) <= 4000),
  was text not null default '' check (char_length(was) <= 8000),
  fixed text not null check (char_length(fixed) <= 8000),
  created_by uuid,
  learned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists translation_fixes_org_idx on public.translation_fixes (org_id, learned, created_at desc);

alter table public.translation_fixes enable row level security;

do $$
begin
  revoke all on public.translation_fixes from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.translation_fixes from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on public.translation_fixes from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.translation_fixes to service_role';
  end if;
end $$;
