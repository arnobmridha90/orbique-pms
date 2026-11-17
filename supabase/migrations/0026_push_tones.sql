-- Alert tunes per phone (api/_lib/shared/tones.cjs): which tune each alert type rings on this phone, as picked on the
-- Booking alerts card ({type: tune id}, only the ones that differ from the defaults). The phone app sends it with
-- register-device (api/alerts.js); booking and Team chat notifications use it for their sound and Android channel.
-- null or {}: the default tunes. Safe to run again.
alter table public.push_devices add column if not exists tones jsonb;
