create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'user');
  end if;

  if not exists (select 1 from pg_type where typname = 'auth_challenge_type') then
    create type auth_challenge_type as enum ('signup_verification', 'password_reset');
  end if;

  if not exists (select 1 from pg_type where typname = 'chat_role') then
    create type chat_role as enum ('user', 'assistant', 'system', 'tool');
  end if;

  if not exists (select 1 from pg_type where typname = 'file_entry_type') then
    create type file_entry_type as enum ('file', 'folder');
  end if;

  if not exists (select 1 from pg_type where typname = 'deployment_status') then
    create type deployment_status as enum ('pending', 'building', 'deployed', 'failed', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'deployment_provider') then
    create type deployment_provider as enum ('fly', 'docker', 'netlify', 'vercel', 'github_pages', 'other');
  end if;
end $$;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email citext unique,
  display_name text,
  role user_role not null default 'user',
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_password_credentials (
  user_id uuid primary key references app_users(id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  email citext not null,
  type auth_challenge_type not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_challenges_email_type_idx
  on auth_challenges(email, type, expires_at desc);

create index if not exists auth_challenges_user_id_idx
  on auth_challenges(user_id);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  session_token_hash text not null unique,
  user_agent text,
  ip_address inet,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists user_sessions_user_id_idx
  on user_sessions(user_id);

create index if not exists user_sessions_expires_at_idx
  on user_sessions(expires_at);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  title text not null default 'Untitled project',
  description text,
  current_chat_id uuid,
  current_snapshot_id uuid,
  template_name text,
  framework text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create index if not exists projects_user_id_updated_at_idx
  on projects(user_id, updated_at desc);

create index if not exists projects_user_id_archived_at_idx
  on projects(user_id, archived_at);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  title text,
  description text,
  url_id text not null,
  forked_from_chat_id uuid references chats(id) on delete set null,
  forked_from_message_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  unique(user_id, url_id)
);

create index if not exists chats_project_id_updated_at_idx
  on chats(project_id, updated_at desc);

create index if not exists chats_user_id_updated_at_idx
  on chats(user_id, updated_at desc);

create index if not exists chats_forked_from_chat_id_idx
  on chats(forked_from_chat_id);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  client_message_id text,
  role chat_role not null,
  sequence integer not null,
  content text,
  raw_message jsonb not null default '{}'::jsonb,
  model_provider text,
  model_name text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  created_at timestamptz not null default now(),
  unique(chat_id, sequence),
  unique(chat_id, client_message_id)
);

create index if not exists chat_messages_chat_id_sequence_idx
  on chat_messages(chat_id, sequence);

create index if not exists chat_messages_project_id_created_at_idx
  on chat_messages(project_id, created_at);

create index if not exists chat_messages_user_id_created_at_idx
  on chat_messages(user_id, created_at desc);

create index if not exists chat_messages_content_search_idx
  on chat_messages
  using gin (to_tsvector('english', coalesce(content, '')));

create table if not exists project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  chat_id uuid references chats(id) on delete set null,
  message_id uuid references chat_messages(id) on delete set null,
  client_chat_message_id text,
  summary text,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_snapshots_project_id_created_at_idx
  on project_snapshots(project_id, created_at desc);

create index if not exists project_snapshots_chat_id_created_at_idx
  on project_snapshots(chat_id, created_at desc);

create table if not exists file_blobs (
  content_hash text primary key,
  content text,
  storage_provider text,
  storage_key text,
  mime_type text,
  size_bytes integer not null,
  is_binary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint file_blobs_has_content_or_storage
    check (content is not null or storage_key is not null)
);

create table if not exists snapshot_files (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references project_snapshots(id) on delete cascade,
  path text not null,
  entry_type file_entry_type not null,
  content_hash text references file_blobs(content_hash) on delete restrict,
  is_binary boolean not null default false,
  size_bytes integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(snapshot_id, path)
);

create index if not exists snapshot_files_snapshot_id_idx
  on snapshot_files(snapshot_id);

create index if not exists snapshot_files_content_hash_idx
  on snapshot_files(content_hash);

create table if not exists project_deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  provider deployment_provider not null default 'fly',
  status deployment_status not null default 'pending',
  app_name text,
  deployed_url text,
  source_snapshot_id uuid references project_snapshots(id) on delete set null,
  git_url text,
  git_branch text,
  provider_deployment_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deployed_at timestamptz
);

create index if not exists project_deployments_project_id_created_at_idx
  on project_deployments(project_id, created_at desc);

create index if not exists project_deployments_user_id_created_at_idx
  on project_deployments(user_id, created_at desc);

create index if not exists project_deployments_status_idx
  on project_deployments(status);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_users_set_updated_at on app_users;
create trigger app_users_set_updated_at
before update on app_users
for each row execute function set_updated_at();

drop trigger if exists user_password_credentials_set_updated_at on user_password_credentials;
create trigger user_password_credentials_set_updated_at
before update on user_password_credentials
for each row execute function set_updated_at();

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
before update on projects
for each row execute function set_updated_at();

drop trigger if exists chats_set_updated_at on chats;
create trigger chats_set_updated_at
before update on chats
for each row execute function set_updated_at();

drop trigger if exists project_deployments_set_updated_at on project_deployments;
create trigger project_deployments_set_updated_at
before update on project_deployments
for each row execute function set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_current_chat_id_fkey'
  ) then
    alter table projects
      add constraint projects_current_chat_id_fkey
      foreign key (current_chat_id)
      references chats(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_current_snapshot_id_fkey'
  ) then
    alter table projects
      add constraint projects_current_snapshot_id_fkey
      foreign key (current_snapshot_id)
      references project_snapshots(id)
      on delete set null;
  end if;
end $$;
