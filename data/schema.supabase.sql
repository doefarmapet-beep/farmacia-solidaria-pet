create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  phone text not null,
  birth_date date not null,
  postal_code text not null,
  street text not null,
  district text not null,
  city text not null,
  state char(2) not null,
  number text not null,
  complement text not null default '',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id, name, phone, birth_date, postal_code, street, district,
    city, state, number, complement
  )
  values (
    new.id,
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'phone',
    (new.raw_user_meta_data ->> 'birth_date')::date,
    new.raw_user_meta_data ->> 'postal_code',
    new.raw_user_meta_data ->> 'street',
    new.raw_user_meta_data ->> 'district',
    new.raw_user_meta_data ->> 'city',
    new.raw_user_meta_data ->> 'state',
    new.raw_user_meta_data ->> 'number',
    coalesce(new.raw_user_meta_data ->> 'complement', '')
  );
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('ong', 'clinic')),
  name text not null check (char_length(name) between 2 and 160),
  email text not null check (char_length(email) <= 320 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null check (char_length(phone) between 8 and 40),
  city text not null check (char_length(city) between 1 and 120),
  state char(2) not null check (state ~ '^[A-Z]{2}$'),
  website text not null default '' check (char_length(website) <= 500 and (website = '' or website ~* '^https?://')),
  description text not null check (char_length(description) between 1 and 1200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.partners enable row level security;
revoke all on public.partners from anon, authenticated;
grant select (id, partner_type, name, city, state, website, description, created_at)
  on public.partners to anon, authenticated;
grant insert (partner_type, name, email, phone, city, state, website, description)
  on public.partners to anon, authenticated;

drop policy if exists partners_read_approved on public.partners;
create policy partners_read_approved
  on public.partners for select
  to anon, authenticated
  using (status = 'approved');

drop policy if exists partners_submit_pending on public.partners;
create policy partners_submit_pending
  on public.partners for insert
  to anon, authenticated
  with check (status = 'pending');

create index if not exists partners_approved_type_location_idx
  on public.partners (partner_type, city, state)
  where status = 'approved';
