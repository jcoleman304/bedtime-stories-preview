-- 1-Minute Bedtime Stories: initial schema
-- Parent is the only user of record. Children are rows owned by a parent.

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  plan        text not null default 'free' check (plan in ('free', 'premium', 'family')),
  created_at  timestamptz not null default now()
);

create table public.children (
  id                 uuid primary key default gen_random_uuid(),
  parent_id          uuid not null references auth.users (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 40),
  age_range          text check (age_range in ('3-4', '5-6', '7-8', '9-10')),
  favorite_color     text,
  favorite_food      text,
  favorite_animal    text,
  favorite_place     text,
  favorite_activity  text,
  created_at         timestamptz not null default now()
);
create index children_parent_id_idx on public.children (parent_id);

create table public.stories (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid not null references auth.users (id) on delete cascade,
  child_id        uuid not null references public.children (id) on delete cascade,
  title           text not null,
  body            text not null,
  lesson          text not null,
  continues_from  uuid references public.stories (id) on delete set null,
  is_favorite     boolean not null default false,
  created_at      timestamptz not null default now()
);
create index stories_parent_created_idx on public.stories (parent_id, created_at desc);
create index stories_child_created_idx on public.stories (child_id, created_at desc);

-- Create a profile row when a parent signs up.
create schema if not exists private;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.children enable row level security;
alter table public.stories  enable row level security;

create policy "profiles: own read" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
-- Preview only: parents may set their own plan from the upgrade screen.
-- Before launch this policy is removed and a Stripe webhook owns `plan`.
create policy "profiles: own update (preview)" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "children: own read" on public.children
  for select to authenticated using ((select auth.uid()) = parent_id);
create policy "children: own insert" on public.children
  for insert to authenticated with check ((select auth.uid()) = parent_id);
create policy "children: own update" on public.children
  for update to authenticated
  using ((select auth.uid()) = parent_id)
  with check ((select auth.uid()) = parent_id);
create policy "children: own delete" on public.children
  for delete to authenticated using ((select auth.uid()) = parent_id);

create policy "stories: own read" on public.stories
  for select to authenticated using ((select auth.uid()) = parent_id);
-- Stories are inserted by the generate-story edge function (service role),
-- never directly by the client. Parents may favorite or delete their own.
create policy "stories: own update" on public.stories
  for update to authenticated
  using ((select auth.uid()) = parent_id)
  with check ((select auth.uid()) = parent_id);
create policy "stories: own delete" on public.stories
  for delete to authenticated using ((select auth.uid()) = parent_id);

grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.children to authenticated;
grant select, update, delete on public.stories to authenticated;
