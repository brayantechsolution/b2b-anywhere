-- =====================================================================
--  CABINE ONLINE — estrutura do banco no Supabase
--  Cole tudo no "SQL Editor" do seu projeto Supabase e clique em RUN.
--  Pode rodar de novo sem problema (os comandos são idempotentes).
-- =====================================================================

-- ---------- PERFIS (nome de DJ de cada usuário) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "perfis visiveis" on public.profiles;
create policy "perfis visiveis" on public.profiles
  for select to authenticated using (true);

drop policy if exists "usuario edita o proprio perfil" on public.profiles;
create policy "usuario edita o proprio perfil" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- cria o perfil automaticamente quando alguém se cadastra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1)), 24))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- SALAS ----------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  owner       uuid not null references auth.users(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'dj' check (role in ('dj', 'spectator')),
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

create or replace function public.is_member(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = r and user_id = auth.uid());
$$;

create or replace function public.is_dj(r uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = r and user_id = auth.uid() and role = 'dj');
$$;

drop policy if exists "membros veem a sala" on public.rooms;
create policy "membros veem a sala" on public.rooms
  for select to authenticated using (public.is_member(id));

drop policy if exists "dono apaga a sala" on public.rooms;
create policy "dono apaga a sala" on public.rooms
  for delete to authenticated using (owner = auth.uid());

drop policy if exists "membros veem membros" on public.room_members;
create policy "membros veem membros" on public.room_members
  for select to authenticated using (public.is_member(room_id));

drop policy if exists "membro sai da sala" on public.room_members;
create policy "membro sai da sala" on public.room_members
  for delete to authenticated using (user_id = auth.uid());

-- criar sala (gera um código de 6 letras e já entra como DJ)
create or replace function public.create_room(p_name text)
returns table (r_id uuid, r_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_id   uuid;
  i      int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (code, name, owner)
  values (v_code, left(coalesce(nullif(trim(p_name), ''), 'Minha sala'), 40), auth.uid())
  returning id into v_id;
  insert into public.room_members (room_id, user_id, role) values (v_id, auth.uid(), 'dj');
  return query select v_id, v_code;
end $$;

-- entrar numa sala pelo código (como DJ ou espectador)
create or replace function public.join_room(p_code text, p_role text)
returns table (r_id uuid, r_name text, r_role text)
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_name  text;
  v_owner uuid;
  v_role  text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id, name, owner into v_id, v_name, v_owner from public.rooms where code = upper(trim(p_code));
  if v_id is null then raise exception 'Sala não encontrada'; end if;
  v_role := case when p_role = 'spectator' and v_owner <> auth.uid() then 'spectator' else 'dj' end;
  insert into public.room_members (room_id, user_id, role) values (v_id, auth.uid(), v_role)
  on conflict (room_id, user_id) do update set role = excluded.role;
  return query select v_id, v_name, v_role;
end $$;

-- salvar o estado da mesa (só DJs da sala)
create or replace function public.save_state(p_room uuid, p_state jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_dj(p_room) then raise exception 'Somente DJs da sala podem alterar a mesa'; end if;
  update public.rooms set state = p_state, updated_at = now() where id = p_room;
end $$;

-- relógio do servidor (usado para sincronizar todo mundo)
create or replace function public.server_time()
returns double precision language sql volatile as $$
  select extract(epoch from clock_timestamp()) * 1000;
$$;

grant execute on function public.create_room(text)        to authenticated;
grant execute on function public.join_room(text, text)    to authenticated;
grant execute on function public.save_state(uuid, jsonb)  to authenticated;
grant execute on function public.server_time()            to authenticated;
grant execute on function public.is_member(uuid)          to authenticated;
grant execute on function public.is_dj(uuid)              to authenticated;

-- ---------- ARMAZENAMENTO DAS MÚSICAS ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tracks', 'tracks', false, 52428800, array['audio/*'])
on conflict (id) do nothing;

drop policy if exists "membros baixam musicas da sala" on storage.objects;
create policy "membros baixam musicas da sala" on storage.objects
  for select to authenticated
  using (bucket_id = 'tracks' and public.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "djs enviam musicas" on storage.objects;
create policy "djs enviam musicas" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tracks' and public.is_dj(((storage.foldername(name))[1])::uuid));

-- ---------- TEMPO REAL (canais privados por sala) ----------
drop policy if exists "membros recebem eventos da sala" on realtime.messages;
create policy "membros recebem eventos da sala" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'room:%'
    and public.is_member(substring(realtime.topic() from 6)::uuid)
  );

drop policy if exists "membros enviam presenca e djs enviam comandos" on realtime.messages;
create policy "membros enviam presenca e djs enviam comandos" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'room:%'
    and (
      (realtime.messages.extension = 'presence'  and public.is_member(substring(realtime.topic() from 6)::uuid))
      or
      (realtime.messages.extension = 'broadcast' and public.is_member(substring(realtime.topic() from 6)::uuid))
    )
  );
