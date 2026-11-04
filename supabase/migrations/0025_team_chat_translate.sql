-- 0025: Team chat translation (api/alerts.js 'team-translate', app/pages/team.js). A message someone else wrote is shown
-- in the reader's app language, with "See original" under it. Each translation is made once per message and language
-- (Claude, api/_lib/translate.js) and kept here, so everyone reading in that language shares it.
--
--   team_message_translations: message id, language (ISO 639-1), the language it was written in, the text in `lang`,
--   and `same` (it was already in `lang`). Removed with its message. Only the server (service role) reads and writes it;
--   /api/alerts checks that the reader is in the message's chat (team__in) before returning a translation.
-- Re-runnable; no data is changed.

create table if not exists public.team_message_translations (
  message_id uuid not null references public.team_messages (id) on delete cascade,
  lang text not null check (lang ~ '^[a-z]{2}$'),
  src_lang text not null default '' check (src_lang = '' or src_lang ~ '^[a-z]{2}$'),
  body text not null default '' check (char_length(body) <= 8000),
  same boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (message_id, lang)
);

alter table public.team_message_translations enable row level security;

do $$
begin
  revoke all on public.team_message_translations from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.team_message_translations from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on public.team_message_translations from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.team_message_translations to service_role';
  end if;
end $$;
