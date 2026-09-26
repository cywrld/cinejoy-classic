-- Cywrld Supabase schema.
-- Run once in Supabase SQL Editor. Browser code uses only the public anon/publishable key.

create table if not exists public.movies (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  title text not null check (char_length(title) between 1 and 120),
  year integer not null check (year between 1800 and 2100),
  director text not null check (char_length(director) between 1 and 180),
  country text not null check (char_length(country) between 1 and 100),
  runtime text not null check (char_length(runtime) between 1 and 40),
  tagline text not null check (char_length(tagline) between 1 and 200),
  synopsis text not null check (char_length(synopsis) between 10 and 1500),
  genres text[] not null check (cardinality(genres) > 0),
  poster text not null check (char_length(poster) between 1 and 1000),
  video_file text check (video_file is null or video_file ~ '^videos/[A-Za-z0-9._-]+$'),
  featured boolean not null default false,
  public_domain boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_cinejoy_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'cinejoy_admin' = 'true', false);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists movies_set_updated_at on public.movies;
create trigger movies_set_updated_at before update on public.movies
for each row execute function public.set_updated_at();

alter table public.movies enable row level security;
grant select on public.movies to anon, authenticated;
grant insert, update, delete on public.movies to authenticated;

drop policy if exists "Public can read movies" on public.movies;
create policy "Public can read movies" on public.movies for select
to anon, authenticated using (true);
drop policy if exists "Cinejoy admins can insert movies" on public.movies;
create policy "Cinejoy admins can insert movies" on public.movies for insert
to authenticated with check ((select public.is_cinejoy_admin()));
drop policy if exists "Cinejoy admins can update movies" on public.movies;
create policy "Cinejoy admins can update movies" on public.movies for update
to authenticated using ((select public.is_cinejoy_admin()))
with check ((select public.is_cinejoy_admin()));
drop policy if exists "Cinejoy admins can delete movies" on public.movies;
create policy "Cinejoy admins can delete movies" on public.movies for delete
to authenticated using ((select public.is_cinejoy_admin()));

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_email text not null,
  subject text not null check (subject in ('film', 'question', 'other')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_thread_owner_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_threads integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'A thread must belong to the authenticated user.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select count(*) into recent_threads
  from public.message_threads
  where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent_threads >= 3 then
    raise exception 'Thread creation rate limit reached. Try again later.';
  end if;
  new.status := 'open';
  select users.email into new.owner_email
  from auth.users as users
  where users.id = new.user_id;
  if new.owner_email is null then
    raise exception 'The authenticated account has no email address.';
  end if;
  return new;
end;
$$;

drop trigger if exists message_threads_set_owner_email on public.message_threads;
create trigger message_threads_set_owner_email before insert on public.message_threads
for each row execute function public.set_thread_owner_email();
drop trigger if exists message_threads_set_updated_at on public.message_threads;
create trigger message_threads_set_updated_at before update on public.message_threads
for each row execute function public.set_updated_at();

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('client', 'admin')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create or replace function public.set_thread_message_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_messages integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send a message.';
  end if;
  new.body := btrim(coalesce(new.body, ''));
  if char_length(new.body) not between 1 and 2000 then
    raise exception 'Message must contain 1 to 2000 characters.';
  end if;
  new.sender_id = auth.uid();
  new.sender_role = case when public.is_cinejoy_admin() then 'admin' else 'client' end;
  if new.sender_role = 'client' then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
    select count(*) into recent_messages
    from public.thread_messages
    where sender_id = auth.uid() and sender_role = 'client'
      and created_at > now() - interval '1 minute';
    if recent_messages >= 10 then
      raise exception 'Message rate limit reached. Wait before sending more messages.';
    end if;
    select count(*) into recent_messages
    from public.thread_messages
    where sender_id = auth.uid() and sender_role = 'client'
      and created_at > now() - interval '1 hour';
    if recent_messages >= 40 then
      raise exception 'Hourly message limit reached. Try again later.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists thread_messages_set_sender on public.thread_messages;
create trigger thread_messages_set_sender before insert on public.thread_messages
for each row execute function public.set_thread_message_sender();

create or replace function public.bump_thread_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_threads set updated_at = now() where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists thread_messages_bump_thread on public.thread_messages;
create trigger thread_messages_bump_thread after insert on public.thread_messages
for each row execute function public.bump_thread_activity();

alter table public.message_threads enable row level security;
alter table public.thread_messages enable row level security;
grant select, insert, update on public.message_threads to authenticated;
grant select, insert on public.thread_messages to authenticated;

drop policy if exists "Participants and admins can read threads" on public.message_threads;
create policy "Participants and admins can read threads" on public.message_threads for select
to authenticated using (user_id = auth.uid() or (select public.is_cinejoy_admin()));
drop policy if exists "Clients can create own threads" on public.message_threads;
create policy "Clients can create own threads" on public.message_threads for insert
to authenticated with check (user_id = auth.uid() and not (select public.is_cinejoy_admin()));
drop policy if exists "Admins can update threads" on public.message_threads;
create policy "Admins can update threads" on public.message_threads for update
to authenticated using ((select public.is_cinejoy_admin()))
with check ((select public.is_cinejoy_admin()));

drop policy if exists "Participants and admins can read thread messages" on public.thread_messages;
create policy "Participants and admins can read thread messages" on public.thread_messages for select
to authenticated using (
  (select public.is_cinejoy_admin())
  or exists (
    select 1 from public.message_threads as threads
    where threads.id = thread_id and threads.user_id = auth.uid()
  )
);
drop policy if exists "Thread participants can append messages" on public.thread_messages;
create policy "Thread participants can append messages" on public.thread_messages for insert
to authenticated with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.message_threads as threads
    where threads.id = thread_id
      and ((threads.user_id = auth.uid() and threads.status = 'open')
        or (select public.is_cinejoy_admin()))
  )
);

create or replace function public.create_message_thread(p_subject text, p_body text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_thread_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before starting a private thread.'; end if;
  if p_subject not in ('film', 'question', 'other') then raise exception 'Choose a valid message topic.'; end if;
  if char_length(trim(p_body)) not between 10 and 2000 then raise exception 'Message must contain 10 to 2000 characters.'; end if;
  insert into public.message_threads (user_id, owner_email, subject)
  values (auth.uid(), '', p_subject)
  returning id into new_thread_id;
  insert into public.thread_messages (thread_id, sender_id, sender_role, body)
  values (new_thread_id, auth.uid(), 'client', trim(p_body));
  return new_thread_id;
end;
$$;
revoke all on function public.create_message_thread(text, text) from public;
grant execute on function public.create_message_thread(text, text) to authenticated;

create table if not exists public.rating_reviews (
  id uuid primary key default gen_random_uuid(),
  film_id text not null references public.movies(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  display_name text not null default 'Guest' check (char_length(display_name) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  review text not null default '' check (char_length(review) <= 800),
  created_at timestamptz not null default now()
);

create or replace function public.set_review_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_reviews integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before submitting a rating.';
  end if;
  new.author_id = auth.uid();
  new.display_name := btrim(coalesce(new.display_name, ''));
  if new.display_name = '' then new.display_name := 'Guest'; end if;
  new.review := btrim(coalesce(new.review, ''));
  if char_length(new.display_name) not between 1 and 60 or char_length(new.review) > 800 then
    raise exception 'Display name or review exceeds the allowed length.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select count(*) into recent_reviews
  from public.rating_reviews
  where author_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent_reviews >= 5 then
    raise exception 'Rating submission limit reached. Try again later.';
  end if;
  return new;
end;
$$;

drop trigger if exists rating_reviews_set_author on public.rating_reviews;
create trigger rating_reviews_set_author before insert on public.rating_reviews
for each row execute function public.set_review_author();
create unique index if not exists rating_reviews_one_per_film_and_author
on public.rating_reviews (film_id, author_id) where author_id is not null;

alter table public.rating_reviews enable row level security;
revoke insert on public.rating_reviews from public, anon, authenticated;
grant select (id, film_id, display_name, rating, review, created_at) on public.rating_reviews to anon, authenticated;
grant insert (film_id, display_name, rating, review) on public.rating_reviews to authenticated;
grant delete on public.rating_reviews to authenticated;
drop policy if exists "Public can read ratings" on public.rating_reviews;
create policy "Public can read ratings" on public.rating_reviews for select to anon, authenticated using (true);
drop policy if exists "Visitors can submit ratings" on public.rating_reviews;
drop policy if exists "Signed-in users can submit ratings" on public.rating_reviews;
create policy "Signed-in users can submit ratings" on public.rating_reviews for insert to authenticated
with check (auth.uid() is not null and author_id = auth.uid());
drop policy if exists "Admins can moderate ratings" on public.rating_reviews;
create policy "Admins can moderate ratings" on public.rating_reviews for delete to authenticated
using ((select public.is_cinejoy_admin()));

create table if not exists public.movie_releases (
  id uuid primary key default gen_random_uuid(),
  movie_id text not null references public.movies(id) on delete cascade,
  release_date date not null,
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'scheduled' check (status in ('scheduled', 'published', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists movie_releases_set_updated_at on public.movie_releases;
create trigger movie_releases_set_updated_at before update on public.movie_releases
for each row execute function public.set_updated_at();
alter table public.movie_releases enable row level security;
grant select, insert, update, delete on public.movie_releases to authenticated;
drop policy if exists "Admins manage release calendar" on public.movie_releases;
create policy "Admins manage release calendar" on public.movie_releases for all to authenticated
using ((select public.is_cinejoy_admin()))
with check ((select public.is_cinejoy_admin()));

create table if not exists public.digital_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  name text not null check (char_length(name) between 3 and 120),
  category text not null check (category in ('software', 'apps', 'games', 'ebooks')),
  description text not null check (char_length(description) between 10 and 2000),
  amount_cents integer not null check (amount_cents between 50 and 2000000),
  currency text not null default 'usd' check (currency = 'usd'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists digital_products_set_updated_at on public.digital_products;
create trigger digital_products_set_updated_at before update on public.digital_products
for each row execute function public.set_updated_at();
alter table public.digital_products enable row level security;
grant select on public.digital_products to anon, authenticated;
grant insert, update, delete on public.digital_products to authenticated;
drop policy if exists "Public can read published digital products" on public.digital_products;
create policy "Public can read published digital products" on public.digital_products for select to anon, authenticated
using (published or (select public.is_cinejoy_admin()));
drop policy if exists "Admins manage digital products" on public.digital_products;
create policy "Admins manage digital products" on public.digital_products for all to authenticated
using ((select public.is_cinejoy_admin()))
with check ((select public.is_cinejoy_admin()));

create table if not exists public.digital_product_private (
  product_id uuid primary key references public.digital_products(id) on delete cascade,
  stripe_price_id text check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  storage_path text check (storage_path is null or storage_path ~ '^products/[a-f0-9-]+/[A-Za-z0-9._-]+$'),
  updated_at timestamptz not null default now()
);
alter table public.digital_product_private enable row level security;
grant select, insert, update, delete on public.digital_product_private to authenticated;
drop policy if exists "Admins manage private product data" on public.digital_product_private;
create policy "Admins manage private product data" on public.digital_product_private for all to authenticated
using ((select public.is_cinejoy_admin()))
with check ((select public.is_cinejoy_admin()));

create or replace function public.save_digital_product(
  p_product_id uuid,
  p_slug text,
  p_name text,
  p_category text,
  p_description text,
  p_amount_cents integer,
  p_stripe_price_id text,
  p_storage_path text,
  p_published boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_cinejoy_admin() then
    raise exception 'Administrator access is required.';
  end if;
  if p_published and (nullif(btrim(p_stripe_price_id), '') is null or nullif(btrim(p_storage_path), '') is null) then
    raise exception 'A published product needs a Stripe price and a private delivery file.';
  end if;
  insert into public.digital_products (id, slug, name, category, description, amount_cents, published)
  values (p_product_id, btrim(p_slug), btrim(p_name), p_category, btrim(p_description), p_amount_cents, p_published)
  on conflict (id) do update set
    slug = excluded.slug,
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    amount_cents = excluded.amount_cents,
    published = excluded.published;
  insert into public.digital_product_private (product_id, stripe_price_id, storage_path)
  values (p_product_id, nullif(btrim(p_stripe_price_id), ''), nullif(btrim(p_storage_path), ''))
  on conflict (product_id) do update set
    stripe_price_id = excluded.stripe_price_id,
    storage_path = excluded.storage_path,
    updated_at = now();
end;
$$;
revoke all on function public.save_digital_product(uuid, text, text, text, text, integer, text, text, boolean) from public;
grant execute on function public.save_digital_product(uuid, text, text, text, text, integer, text, text, boolean) to authenticated;

create table if not exists public.checkout_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.digital_products(id) on delete restrict,
  stripe_session_id text unique,
  amount_cents integer not null check (amount_cents between 50 and 2000000),
  currency text not null check (currency = 'usd'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists checkout_orders_user_created on public.checkout_orders (user_id, created_at desc);
alter table public.checkout_orders enable row level security;
grant select on public.checkout_orders to authenticated;
drop policy if exists "Buyers and admins can read checkout orders" on public.checkout_orders;
create policy "Buyers and admins can read checkout orders" on public.checkout_orders for select to authenticated
using (user_id = auth.uid() or (select public.is_cinejoy_admin()));
revoke insert, update, delete on public.checkout_orders from public, anon, authenticated;
grant all on public.checkout_orders to service_role;

create table if not exists public.product_entitlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.checkout_orders(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.digital_products(id) on delete restrict,
  granted_at timestamptz not null default now()
);
create index if not exists product_entitlements_user on public.product_entitlements (user_id, granted_at desc);
alter table public.product_entitlements enable row level security;
grant select on public.product_entitlements to authenticated;
drop policy if exists "Buyers and admins can read product entitlements" on public.product_entitlements;
create policy "Buyers and admins can read product entitlements" on public.product_entitlements for select to authenticated
using (user_id = auth.uid() or (select public.is_cinejoy_admin()));
revoke insert, update, delete on public.product_entitlements from public, anon, authenticated;
grant all on public.product_entitlements to service_role;
drop policy if exists "Purchasers can read their products" on public.digital_products;
create policy "Purchasers can read their products" on public.digital_products for select to authenticated
using (exists (
  select 1 from public.product_entitlements as entitlements
  where entitlements.product_id = digital_products.id and entitlements.user_id = auth.uid()
));

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;
grant all on public.stripe_webhook_events to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('digital-products', 'digital-products', false, 104857600,
  array['application/zip', 'application/x-zip-compressed', 'application/pdf', 'application/epub+zip'])
on conflict (id) do update
set public = false, file_size_limit = 104857600,
    allowed_mime_types = array['application/zip', 'application/x-zip-compressed', 'application/pdf', 'application/epub+zip'];
drop policy if exists "Admins upload digital products" on storage.objects;
create policy "Admins upload digital products" on storage.objects for insert to authenticated
with check (bucket_id = 'digital-products' and (select public.is_cinejoy_admin()));
drop policy if exists "Admins update digital products" on storage.objects;
create policy "Admins update digital products" on storage.objects for update to authenticated
using (bucket_id = 'digital-products' and (select public.is_cinejoy_admin()))
with check (bucket_id = 'digital-products' and (select public.is_cinejoy_admin()));
drop policy if exists "Admins delete digital products" on storage.objects;
create policy "Admins delete digital products" on storage.objects for delete to authenticated
using (bucket_id = 'digital-products' and (select public.is_cinejoy_admin()));

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
grant select on public.admin_audit_log to authenticated;
drop policy if exists "Admins can read audit log" on public.admin_audit_log;
create policy "Admins can read audit log" on public.admin_audit_log for select to authenticated
using ((select public.is_cinejoy_admin()));
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;

create or replace function public.log_cinejoy_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_data jsonb;
  after_data jsonb;
  row_data jsonb;
  changed_fields text[];
  actor uuid := auth.uid();
  actor_address text;
  row_id text;
  activity text;
  entity text := tg_table_name;
  extra jsonb := '{}'::jsonb;
begin
  if tg_op <> 'INSERT' then before_data := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_data := to_jsonb(new); end if;
  row_data := coalesce(after_data, before_data);
  row_id := coalesce(row_data ->> 'id', row_data ->> 'name', row_data ->> 'product_id', row_data ->> 'event_id');
  activity := lower(tg_op);

  if tg_op = 'UPDATE' then
    select array_agg(entry.key order by entry.key) into changed_fields
    from jsonb_each(after_data) as entry
    where before_data -> entry.key is distinct from after_data -> entry.key;
    extra := jsonb_build_object('changed_fields', coalesce(to_jsonb(changed_fields), '[]'::jsonb));
  elsif tg_op = 'INSERT' then
    extra := jsonb_build_object('changed_fields', coalesce((select jsonb_agg(field_name) from jsonb_object_keys(after_data) as fields(field_name)), '[]'::jsonb));
  end if;

  if entity = 'movies' then
    extra := extra || jsonb_build_object('title', row_data ->> 'title');
  elsif entity = 'thread_messages' then
    extra := extra || jsonb_build_object('thread_id', row_data ->> 'thread_id', 'sender_role', row_data ->> 'sender_role');
  elsif tg_table_schema = 'storage' then
    entity := case when row_data ->> 'bucket_id' = 'movie-posters' then 'movie_poster' else 'digital_product_asset' end;
    extra := extra || jsonb_build_object('bucket', row_data ->> 'bucket_id', 'path', row_data ->> 'name');
    if coalesce(row_data ->> 'bucket_id', '') not in ('movie-posters', 'digital-products') then
      if tg_op = 'DELETE' then return old; else return new; end if;
    end if;
  elsif entity = 'message_threads' then
    extra := extra || jsonb_build_object('subject', row_data ->> 'subject');
  elsif entity = 'movie_releases' then
    extra := extra || jsonb_build_object('movie_id', row_data ->> 'movie_id');
  elsif entity = 'rating_reviews' then
    extra := extra || jsonb_build_object('film_id', row_data ->> 'film_id', 'rating', row_data ->> 'rating');
  end if;

  select users.email into actor_address from auth.users as users where users.id = actor;
  insert into public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  values (actor, actor_address, activity, entity, row_id, extra);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists audit_movies on public.movies;
create trigger audit_movies after insert or update or delete on public.movies
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_threads on public.message_threads;
create trigger audit_threads after insert or update or delete on public.message_threads
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_thread_messages on public.thread_messages;
create trigger audit_thread_messages after insert or update or delete on public.thread_messages
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_releases on public.movie_releases;
create trigger audit_releases after insert or update or delete on public.movie_releases
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_digital_products on public.digital_products;
create trigger audit_digital_products after insert or update or delete on public.digital_products
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_digital_product_private on public.digital_product_private;
create trigger audit_digital_product_private after insert or update or delete on public.digital_product_private
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_checkout_orders on public.checkout_orders;
create trigger audit_checkout_orders after insert or update or delete on public.checkout_orders
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_product_entitlements on public.product_entitlements;
create trigger audit_product_entitlements after insert or update or delete on public.product_entitlements
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_stripe_webhook_events on public.stripe_webhook_events;
create trigger audit_stripe_webhook_events after insert on public.stripe_webhook_events
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_reviews on public.rating_reviews;
create trigger audit_reviews after insert or update or delete on public.rating_reviews
for each row execute function public.log_cinejoy_activity();
drop trigger if exists audit_posters on storage.objects;
create trigger audit_posters after insert or update or delete on storage.objects
for each row execute function public.log_cinejoy_activity();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('movie-posters', 'movie-posters', true, 250000, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = true, file_size_limit = 250000,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
drop policy if exists "Anyone can view Cinejoy posters" on storage.objects;
create policy "Anyone can view Cinejoy posters" on storage.objects for select
to anon, authenticated using (bucket_id = 'movie-posters');
drop policy if exists "Cinejoy admins can upload posters" on storage.objects;
create policy "Cinejoy admins can upload posters" on storage.objects for insert
to authenticated with check (bucket_id = 'movie-posters' and (select public.is_cinejoy_admin()));
drop policy if exists "Cinejoy admins can update posters" on storage.objects;
create policy "Cinejoy admins can update posters" on storage.objects for update
to authenticated using (bucket_id = 'movie-posters' and (select public.is_cinejoy_admin()))
with check (bucket_id = 'movie-posters' and (select public.is_cinejoy_admin()));
drop policy if exists "Cinejoy admins can delete posters" on storage.objects;
create policy "Cinejoy admins can delete posters" on storage.objects for delete
to authenticated using (bucket_id = 'movie-posters' and (select public.is_cinejoy_admin()));

-- Email notification state is service-function-only. Do not expose service-role access to the browser.
create table if not exists public.contact_notification_events (
  message_id uuid primary key references public.thread_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'sent', 'failed')),
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  error_code text
);
create index if not exists contact_notification_events_user_attempted
on public.contact_notification_events (user_id, attempted_at desc);
alter table public.contact_notification_events enable row level security;
revoke all on public.contact_notification_events from anon, authenticated;
