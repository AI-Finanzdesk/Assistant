-- Exchange op eigen server (EWS) naast Microsoft 365 (Graph).
-- Kolommen krijgen provider-neutrale namen.

alter table public.emails rename column graph_message_id to external_id;
alter table public.mail_folder_links rename column graph_folder_id to folder_id;
alter table public.mail_folder_links rename column delta_link to sync_state;

-- Koppeling met Exchange Web Services per gebruiker.
-- Het wachtwoord staat versleuteld (AES-256-GCM, sleutel CREDENTIALS_KEY in de
-- serveromgeving). Geen policies: alleen de server (service role) kan erbij.
create table public.exchange_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ews_url text not null,
  username text not null,
  account_email text not null,
  auth_type text not null default 'ntlm' check (auth_type in ('ntlm', 'basic')),
  password_enc text not null,
  updated_at timestamptz not null default now()
);

alter table public.exchange_connections enable row level security;
