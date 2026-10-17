-- Run in Supabase SQL editor. Replace ADMIN_EMAIL in setup instructions using dashboard user id.
create extension if not exists pgcrypto;
create table if not exists public.families (
 id uuid primary key default gen_random_uuid(), family text not null check(length(trim(family)) between 2 and 60),
 family_id text not null unique check(length(trim(family_id)) between 1 and 30),
 coordinator text not null, coordinator_id text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.events (
 id uuid primary key default gen_random_uuid(), name text not null,
 event_date date not null, created_at timestamptz not null default now()
);
create table if not exists public.assignments (
 event_id uuid not null references public.events(id) on delete cascade,
 family_id uuid not null references public.families(id) on delete cascade,
 primary key(event_id,family_id)
);
create table if not exists public.results (
 event_id uuid primary key references public.events(id) on delete cascade,
 first_family_id uuid not null references public.families(id),
 second_family_id uuid not null references public.families(id),
 check(first_family_id <> second_family_id)
);
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
create or replace function public.is_zone_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admins where user_id=auth.uid())
$$;
revoke all on function public.is_zone_admin() from public;
grant execute on function public.is_zone_admin() to authenticated, anon;
alter table public.families enable row level security;
alter table public.events enable row level security;
alter table public.assignments enable row level security;
alter table public.results enable row level security;
alter table public.admins enable row level security;
create policy "public submit registration" on public.families for insert to anon, authenticated with check(true);
create policy "admins read registrations" on public.families for select to authenticated using(public.is_zone_admin());
create policy "admins update registrations" on public.families for update to authenticated using(public.is_zone_admin()) with check(public.is_zone_admin());
create policy "public see events" on public.events for select to anon, authenticated using(true);
create policy "admins manage events" on public.events for all to authenticated using(public.is_zone_admin()) with check(public.is_zone_admin());
create policy "admins see assignments" on public.assignments for select to authenticated using(public.is_zone_admin());
create policy "admins manage assignments" on public.assignments for all to authenticated using(public.is_zone_admin()) with check(public.is_zone_admin());
create policy "admins see results" on public.results for select to authenticated using(public.is_zone_admin());
create policy "admins manage results" on public.results for all to authenticated using(public.is_zone_admin()) with check(public.is_zone_admin());
-- Safe public scoreboard: names only, never coordinators or IDs
create or replace view public.public_scoreboard with (security_invoker=false) as
 select e.id as event_id,e.name,e.event_date,
 f1.family as first_family, f2.family as second_family
 from public.events e left join public.results r on r.event_id=e.id
 left join public.families f1 on f1.id=r.first_family_id
 left join public.families f2 on f2.id=r.second_family_id;
grant select on public.public_scoreboard to anon,authenticated;
-- Make public view only through view, no public family select.

-- Server-side validation of the participation rules (not just browser checks).
create or replace function public.validate_zone_assignment() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.event_id::text));
  perform pg_advisory_xact_lock(hashtext(new.family_id::text));
  if (select count(*) from public.assignments where event_id=new.event_id)>=8 then
    raise exception 'الفعالية مكتملة (8 عوائل)';
  end if;
  if (select count(*) from public.assignments where family_id=new.family_id)>=2 then
    raise exception 'العائلة استنفدت فرصتي المشاركة';
  end if;
  if exists(select 1 from public.results where first_family_id=new.family_id or second_family_id=new.family_id) then
    raise exception 'العائلة متأهلة بالفعل';
  end if;
  return new;
end; $$;
drop trigger if exists zone_assignment_guard on public.assignments;
create trigger zone_assignment_guard before insert on public.assignments
for each row execute function public.validate_zone_assignment();

create or replace function public.validate_zone_result() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.assignments where event_id=new.event_id and family_id=new.first_family_id)
    or not exists(select 1 from public.assignments where event_id=new.event_id and family_id=new.second_family_id) then
    raise exception 'الفائزان يجب أن يكونا مشاركين في الفعالية';
  end if;
  if exists(select 1 from public.results where event_id<>new.event_id
    and (first_family_id in (new.first_family_id,new.second_family_id)
    or second_family_id in (new.first_family_id,new.second_family_id))) then
    raise exception 'لا يمكن تأهيل عائلة مرتين';
  end if;
  return new;
end; $$;
drop trigger if exists zone_result_guard on public.results;
create trigger zone_result_guard before insert or update on public.results
for each row execute function public.validate_zone_result();
