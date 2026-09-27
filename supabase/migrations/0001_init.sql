-- Projekt-Assistent: basisschema
-- Uitvoeren in Supabase: SQL Editor → plakken → Run (of `supabase db push`).

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Gebruikers
-- ─────────────────────────────────────────────────────────────
-- is_internal: kernteam (bv. jij en Michael) – ziet kennisbank en alle
--              projecten. Externe deelnemers (bv. Timo) zijn niet intern en
--              zien alleen projecten waar ze lid van zijn.
-- mail_sync_enabled / calendar_sync_enabled: per gebruiker aan/uit.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  language text not null default 'nl' check (language in ('nl', 'de')),
  is_admin boolean not null default false,
  is_internal boolean not null default false,
  mail_sync_enabled boolean not null default false,
  calendar_sync_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- De allereerste gebruiker wordt automatisch admin + intern.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, full_name, is_admin, is_internal)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    first_user,
    coalesce((new.raw_user_meta_data ->> 'is_internal')::boolean, first_user)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Projecten en deelnemers
-- ─────────────────────────────────────────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Rechten en wensen per deelnemer per project:
--   role              owner  = beheert project en leden
--                     member = werkt mee
--                     guest  = extern; ziet alleen wat aan hem is toegewezen
--   see_all_meetings  alle meetingverslagen van dit project zien
--   see_emails        gekoppelde e-mails van dit project zien
--   calendar_tasks    taken uit dit project in de eigen agenda zetten
--                     (werkt alleen als calendar_sync_enabled in profiel aan staat)
create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member', 'guest')),
  see_all_meetings boolean not null default true,
  see_emails boolean not null default true,
  calendar_tasks boolean not null default true,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ─────────────────────────────────────────────────────────────
-- Kennisbank (universeel, te koppelen aan meerdere projecten)
-- ─────────────────────────────────────────────────────────────
create table public.knowledge_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  body text,
  tags text[] not null default '{}',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_topics (
  project_id uuid not null references public.projects (id) on delete cascade,
  topic_id uuid not null references public.knowledge_topics (id) on delete cascade,
  primary key (project_id, topic_id)
);

-- Losse inzichten bij een onderwerp, met bron (meeting, e-mail of handmatig).
create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.knowledge_topics (id) on delete cascade,
  body text not null,
  source_type text not null default 'manual' check (source_type in ('manual', 'meeting', 'email')),
  source_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Contacten (externe partijen zonder login)
-- ─────────────────────────────────────────────────────────────
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  company text,
  notes text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Meetings
-- ─────────────────────────────────────────────────────────────
-- Metadata is zichtbaar voor deelnemers; de inhoud (agenda, transcript,
-- samenvatting) staat apart in meeting_content en is alleen zichtbaar voor
-- wie het volledige verslag mag zien.
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  topic text,
  scheduled_at timestamptz,
  language text not null default 'nl' check (language in ('nl', 'de')),
  status text not null default 'planned'
    check (status in ('planned', 'uploaded', 'transcribing', 'summarizing', 'done', 'error')),
  consent_confirmed boolean not null default false,
  audio_path text,
  transcription_id text,
  error text,
  calendar_event_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.meeting_content (
  meeting_id uuid primary key references public.meetings (id) on delete cascade,
  agenda_md text,
  transcript text,
  summary_md text,
  follow_ups text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  name text not null
);

create table public.meeting_topics (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  topic_id uuid not null references public.knowledge_topics (id) on delete cascade,
  primary key (meeting_id, topic_id)
);

-- Onderdelen van het verslag. visible_to = gebruikers die dit deel mogen zien,
-- ook als ze het volledige verslag niet mogen zien (bv. Timo).
create table public.meeting_sections (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  position int not null default 0,
  heading text not null,
  body_md text not null,
  kind text not null default 'discussion' check (kind in ('discussion', 'decision', 'info')),
  visible_to uuid[] not null default '{}'
);

-- ─────────────────────────────────────────────────────────────
-- Taken
-- ─────────────────────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  meeting_id uuid references public.meetings (id) on delete set null,
  title text not null,
  description text,
  assignee_id uuid references public.profiles (id) on delete set null,
  assignee_name text,
  due_date date,
  status text not null default 'open' check (status in ('proposed', 'open', 'done')),
  calendar_event_id text,
  calendar_synced_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- E-mail (Microsoft 365 / Exchange Online)
-- ─────────────────────────────────────────────────────────────
-- Tokens alleen voor de server (service role). Geen policies = geen toegang
-- vanuit de browser.
create table public.ms_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  account_email text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Welke mailmap hoort bij welk project (per gebruiker).
create table public.mail_folder_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  graph_folder_id text not null,
  folder_name text not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  delta_link text,
  last_synced_at timestamptz,
  unique (user_id, graph_folder_id)
);

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  graph_message_id text not null,
  subject text,
  from_name text,
  from_address text,
  to_addresses text[] not null default '{}',
  received_at timestamptz,
  body_preview text,
  body_text text,
  summary text,
  web_link text,
  created_at timestamptz not null default now(),
  unique (owner_id, graph_message_id)
);

create table public.email_topics (
  email_id uuid not null references public.emails (id) on delete cascade,
  topic_id uuid not null references public.knowledge_topics (id) on delete cascade,
  primary key (email_id, topic_id)
);

-- ─────────────────────────────────────────────────────────────
-- Assistent: voorstellen en wensen
-- ─────────────────────────────────────────────────────────────
-- user_id null = voor het hele kernteam.
-- kind: followup (opvolgen), task (voorgestelde taak), insight (verband/risico),
--       improvement (verbetering van de tool zelf), wish (wens van gebruiker)
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind text not null check (kind in ('followup', 'task', 'insight', 'improvement', 'wish')),
  title text not null,
  body_md text,
  status text not null default 'new' check (status in ('new', 'accepted', 'dismissed', 'done')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index on public.tasks (assignee_id, status);
create index on public.tasks (project_id, status);
create index on public.emails (project_id, received_at desc);
create index on public.meetings (project_id, created_at desc);
create index on public.meeting_sections (meeting_id, position);
create index on public.knowledge_entries (topic_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- Hulpfuncties voor toegangsregels (security definer = geen RLS-recursie)
-- ─────────────────────────────────────────────────────────────
create function public.is_internal() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_internal from profiles where id = auth.uid()), false)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create function public.project_role(pid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from project_members where project_id = pid and user_id = auth.uid()
$$;

create function public.can_view_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_internal() or public.project_role(pid) is not null
$$;

-- Mag de gebruiker het volledige verslag van deze meeting zien?
create function public.can_view_meeting_full(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meetings m
    left join project_members pm on pm.project_id = m.project_id and pm.user_id = auth.uid()
    where m.id = mid and (
      m.created_by = auth.uid()
      or public.is_admin()
      or (m.project_id is null and public.is_internal())
      or (m.project_id is not null and public.is_internal() and pm.user_id is null)
      or pm.role = 'owner'
      or (pm.role = 'member' and pm.see_all_meetings)
    )
  )
$$;

-- Mag de gebruiker (minstens) de metadata van deze meeting zien?
create function public.can_view_meeting_meta(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_view_meeting_full(mid)
    or exists (select 1 from meeting_participants where meeting_id = mid and user_id = auth.uid())
    or exists (select 1 from meeting_sections where meeting_id = mid and auth.uid() = any (visible_to))
    or exists (select 1 from tasks where meeting_id = mid and assignee_id = auth.uid())
$$;

create function public.can_edit_meeting(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meetings m
    where m.id = mid and (
      m.created_by = auth.uid()
      or public.is_admin()
      or (m.project_id is null and public.is_internal())
      or (m.project_id is not null and public.project_role(m.project_id) in ('owner', 'member'))
      or (m.project_id is not null and public.is_internal())
    )
  )
$$;

create function public.can_view_topic(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_internal() or exists (
    select 1 from project_topics pt
    join project_members pm on pm.project_id = pt.project_id
    where pt.topic_id = tid and pm.user_id = auth.uid() and pm.role <> 'guest'
  )
$$;

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.knowledge_topics enable row level security;
alter table public.project_topics enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.contacts enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_content enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_topics enable row level security;
alter table public.meeting_sections enable row level security;
alter table public.tasks enable row level security;
alter table public.ms_connections enable row level security;
alter table public.mail_folder_links enable row level security;
alter table public.emails enable row level security;
alter table public.email_topics enable row level security;
alter table public.suggestions enable row level security;

-- profiles: iedereen met login ziet namen (nodig voor toewijzen);
-- eigen profiel aanpassen, admin alles.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- Voorkom dat een gewone gebruiker zichzelf admin/intern maakt.
create function public.protect_profile_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and auth.uid() is not null then
    new.is_admin := old.is_admin;
    new.is_internal := old.is_internal;
  end if;
  return new;
end;
$$;
create trigger protect_profile_flags before update on public.profiles
  for each row execute function public.protect_profile_flags();

-- projects
create policy projects_select on public.projects for select to authenticated
  using (public.can_view_project(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_internal());
create policy projects_update on public.projects for update to authenticated
  using (public.is_admin() or public.project_role(id) = 'owner' or public.is_internal());
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_admin() or public.project_role(id) = 'owner');

-- project_members
create policy members_select on public.project_members for select to authenticated
  using (public.can_view_project(project_id));
create policy members_write on public.project_members for all to authenticated
  using (public.is_admin() or public.project_role(project_id) = 'owner' or public.is_internal())
  with check (public.is_admin() or public.project_role(project_id) = 'owner' or public.is_internal());

-- kennisbank
create policy topics_select on public.knowledge_topics for select to authenticated
  using (public.can_view_topic(id));
create policy topics_insert on public.knowledge_topics for insert to authenticated
  with check (public.is_internal() or exists (
    select 1 from project_members where user_id = auth.uid() and role <> 'guest'));
create policy topics_update on public.knowledge_topics for update to authenticated
  using (public.can_view_topic(id));
create policy topics_delete on public.knowledge_topics for delete to authenticated
  using (public.is_internal());

create policy project_topics_select on public.project_topics for select to authenticated
  using (public.can_view_project(project_id));
create policy project_topics_write on public.project_topics for all to authenticated
  using (public.is_internal() or public.project_role(project_id) in ('owner', 'member'))
  with check (public.is_internal() or public.project_role(project_id) in ('owner', 'member'));

create policy entries_select on public.knowledge_entries for select to authenticated
  using (public.can_view_topic(topic_id));
create policy entries_write on public.knowledge_entries for all to authenticated
  using (public.can_view_topic(topic_id)) with check (public.can_view_topic(topic_id));

-- contacten: kernteam
create policy contacts_all on public.contacts for all to authenticated
  using (public.is_internal()) with check (public.is_internal());

-- meetings
create policy meetings_select on public.meetings for select to authenticated
  using (public.can_view_meeting_meta(id));
create policy meetings_insert on public.meetings for insert to authenticated
  with check (
    created_by = auth.uid() and (
      (project_id is null and public.is_internal())
      or (project_id is not null and (public.is_internal() or public.project_role(project_id) in ('owner', 'member')))
    )
  );
create policy meetings_update on public.meetings for update to authenticated
  using (public.can_edit_meeting(id));
create policy meetings_delete on public.meetings for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

create policy content_select on public.meeting_content for select to authenticated
  using (public.can_view_meeting_full(meeting_id));
create policy content_write on public.meeting_content for all to authenticated
  using (public.can_edit_meeting(meeting_id)) with check (public.can_edit_meeting(meeting_id));

create policy participants_select on public.meeting_participants for select to authenticated
  using (public.can_view_meeting_meta(meeting_id));
create policy participants_write on public.meeting_participants for all to authenticated
  using (public.can_edit_meeting(meeting_id)) with check (public.can_edit_meeting(meeting_id));

create policy meeting_topics_select on public.meeting_topics for select to authenticated
  using (public.can_view_meeting_full(meeting_id));
create policy meeting_topics_write on public.meeting_topics for all to authenticated
  using (public.can_edit_meeting(meeting_id)) with check (public.can_edit_meeting(meeting_id));

create policy sections_select on public.meeting_sections for select to authenticated
  using (public.can_view_meeting_full(meeting_id) or auth.uid() = any (visible_to));
create policy sections_write on public.meeting_sections for all to authenticated
  using (public.can_edit_meeting(meeting_id)) with check (public.can_edit_meeting(meeting_id));

-- taken
create policy tasks_select on public.tasks for select to authenticated
  using (
    assignee_id = auth.uid()
    or created_by = auth.uid()
    or (project_id is null and public.is_internal())
    or (project_id is not null and (public.is_internal() or public.project_role(project_id) in ('owner', 'member')))
  );
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    (project_id is null and public.is_internal())
    or (project_id is not null and (public.is_internal() or public.project_role(project_id) in ('owner', 'member')))
  );
create policy tasks_update on public.tasks for update to authenticated
  using (
    assignee_id = auth.uid()
    or created_by = auth.uid()
    or (project_id is null and public.is_internal())
    or (project_id is not null and (public.is_internal() or public.project_role(project_id) in ('owner', 'member')))
  );
create policy tasks_delete on public.tasks for delete to authenticated
  using (created_by = auth.uid() or public.is_internal());

-- e-mail
create policy folder_links_own on public.mail_folder_links for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy emails_select on public.emails for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_admin()
    or (project_id is not null and exists (
      select 1 from project_members pm
      where pm.project_id = emails.project_id and pm.user_id = auth.uid()
        and pm.role <> 'guest' and pm.see_emails))
    or (project_id is not null and public.is_internal() and public.project_role(project_id) is null)
  );
create policy emails_update_own on public.emails for update to authenticated
  using (owner_id = auth.uid());
create policy emails_delete_own on public.emails for delete to authenticated
  using (owner_id = auth.uid());

create policy email_topics_select on public.email_topics for select to authenticated
  using (exists (select 1 from emails e where e.id = email_id));

-- voorstellen
create policy suggestions_select on public.suggestions for select to authenticated
  using (user_id = auth.uid() or (user_id is null and public.is_internal()) or created_by = auth.uid());
create policy suggestions_insert on public.suggestions for insert to authenticated
  with check (created_by = auth.uid());
create policy suggestions_update on public.suggestions for update to authenticated
  using (user_id = auth.uid() or (user_id is null and public.is_internal()));

-- ─────────────────────────────────────────────────────────────
-- Opslag voor opnames
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- Pad: <meeting_id>/<bestandsnaam>
create policy recordings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings'
    and public.can_edit_meeting(((storage.foldername(name))[1])::uuid));
create policy recordings_select on storage.objects for select to authenticated
  using (bucket_id = 'recordings'
    and public.can_view_meeting_full(((storage.foldername(name))[1])::uuid));
