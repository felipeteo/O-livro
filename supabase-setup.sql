create extension if not exists pgcrypto;

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date,
  caption text not null default '',
  text text not null,
  photo_path text,
  created_at timestamptz not null default now()
);

alter table public.memories enable row level security;
grant select on public.memories to anon, authenticated;
grant insert, update, delete on public.memories to authenticated;

create table if not exists public.book_editors (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.book_editors enable row level security;

create or replace function public.is_book_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.book_editors
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_book_editor() from public;
grant execute on function public.is_book_editor() to authenticated;

drop policy if exists "Anyone can read the book" on public.memories;
create policy "Anyone can read the book"
  on public.memories for select
  to anon, authenticated
  using (true);

drop policy if exists "Signed-in editors can add memories" on public.memories;
create policy "Signed-in editors can add memories"
  on public.memories for insert
  to authenticated
  with check (public.is_book_editor());

drop policy if exists "Signed-in editors can update memories" on public.memories;
create policy "Signed-in editors can update memories"
  on public.memories for update
  to authenticated
  using (public.is_book_editor())
  with check (public.is_book_editor());

drop policy if exists "Signed-in editors can delete memories" on public.memories;
create policy "Signed-in editors can delete memories"
  on public.memories for delete
  to authenticated
  using (public.is_book_editor());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-photos', 'book-photos', true, 10485760, array['image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view book photos" on storage.objects;
create policy "Anyone can view book photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'book-photos');

drop policy if exists "Signed-in editors can upload book photos" on storage.objects;
create policy "Signed-in editors can upload book photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'book-photos' and public.is_book_editor());

drop policy if exists "Signed-in editors can update book photos" on storage.objects;
create policy "Signed-in editors can update book photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'book-photos' and public.is_book_editor())
  with check (bucket_id = 'book-photos' and public.is_book_editor());

drop policy if exists "Signed-in editors can delete book photos" on storage.objects;
create policy "Signed-in editors can delete book photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'book-photos' and public.is_book_editor());
