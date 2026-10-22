-- 0013: a workspace's own email address in the inbox (e.g. hello@staykozi.com) next to its Orbique address.
--
-- inbound_addresses had one row per workspace (its Orbique address, e.g. kozi-mtez@orbiquepms.com). Now a workspace
-- can also have one address on its own domain (kind 'own'). Email to either lands in the workspace's inbox, and email
-- replies go out from the own address when there is one (api/_lib/email-in.js addressFor).
--
-- Before adding an own address, its domain must be set up in Resend for receiving (MX) and sending (verified), or
-- replies from it fail. Added by Orbique for now:
--   insert into public.inbound_addresses (address, org_id, kind) values ('hello@example.com', '<org id>', 'own');
--
-- Safe to re-run.

alter table public.inbound_addresses add column if not exists kind text not null default 'orbique';
alter table public.inbound_addresses drop constraint if exists inbound_addresses_kind_check;
alter table public.inbound_addresses add constraint inbound_addresses_kind_check check (kind in ('orbique', 'own'));

-- one address of each kind per workspace (was: one address per workspace)
alter table public.inbound_addresses drop constraint if exists inbound_addresses_org_id_key;
create unique index if not exists inbound_addresses_org_kind_idx on public.inbound_addresses (org_id, kind);
