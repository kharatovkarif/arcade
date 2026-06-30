create table if not exists users (
    id bigserial primary key,
    tg_id bigint unique not null,
    username text,
    first_name text,
    language text default 'ru',
    balance_arc numeric(20,4) default 0,
    balance_ton numeric(20,9) default 0,
    wallet text,
    referrer_id bigint references users(tg_id),
    is_banned boolean default false,
    is_admin boolean default false,
    checkin_day int default 0,
    checkin_last date,
    pro_until timestamptz,
    last_seen timestamptz default now(),
    burn_warned boolean default false,
    created_at timestamptz default now()
);

create table if not exists games (
    id bigserial primary key,
    round_no bigint not null,
    status text default 'waiting',
    pot_arc numeric(20,4) default 0,
    winner_tg_id bigint,
    winner_chance numeric(6,3),
    commission_arc numeric(20,4) default 0,
    server_seed text,
    server_seed_hash text,
    result_roll numeric(12,10),
    created_at timestamptz default now(),
    finished_at timestamptz
);

create table if not exists game_bets (
    id bigserial primary key,
    game_id bigint references games(id),
    tg_id bigint not null,
    amount_arc numeric(20,4) not null,
    created_at timestamptz default now()
);

create table if not exists transactions (
    id bigserial primary key,
    tg_id bigint not null,
    type text not null,
    currency text not null,
    amount numeric(20,9) not null,
    status text default 'done',
    note text,
    tx_hash text,
    created_at timestamptz default now()
);

-- Hard guard against double-crediting the same on-chain deposit: tx_hash must be
-- unique. ARC/internal transactions leave tx_hash null and are exempt.
create unique index if not exists uniq_transactions_tx_hash
    on transactions (tx_hash) where tx_hash is not null;

create table if not exists tasks (
    id bigserial primary key,
    title_ru text not null,
    title_en text not null,
    type text not null,
    target text,
    reward_arc numeric(20,4) not null,
    limit_mode text default 'global',
    limit_count int,
    used_count int default 0,
    expires_at timestamptz,
    is_active boolean default true,
    created_at timestamptz default now()
);

create table if not exists task_completions (
    id bigserial primary key,
    task_id bigint references tasks(id),
    tg_id bigint not null,
    created_at timestamptz default now(),
    unique(task_id, tg_id)
);

create table if not exists promocodes (
    id bigserial primary key,
    code text unique not null,
    reward_arc numeric(20,4) not null,
    limit_mode text default 'global',
    limit_count int,
    used_count int default 0,
    expires_at timestamptz,
    is_active boolean default true,
    created_at timestamptz default now()
);

create table if not exists promo_uses (
    id bigserial primary key,
    promo_id bigint references promocodes(id),
    tg_id bigint not null,
    created_at timestamptz default now(),
    unique(promo_id, tg_id)
);

create table if not exists settings (
    key text primary key,
    value text
);

insert into settings(key, value) values
    ('round_counter', '1'),
    ('ton_usd', '5.0'),
    ('arc_usd', '0.0001'),
    ('pvp_commission', '0.10'),
    ('exchange_daily_limit_ton', '5')
on conflict (key) do nothing;

create table if not exists exchange_daily (
    tg_id bigint not null,
    day date not null,
    ton_used numeric(20,9) default 0,
    primary key (tg_id, day)
);

create table if not exists lottery_rounds (
    id bigserial primary key,
    round_no bigint not null,
    status text default 'open',
    server_seed text,
    server_seed_hash text,
    result_index int,
    result_roll numeric(12,10),
    winner_tg_id bigint,
    created_at timestamptz default now(),
    finished_at timestamptz
);

create table if not exists lottery_tickets (
    id bigserial primary key,
    round_id bigint references lottery_rounds(id),
    tg_id bigint not null,
    username text,
    first_name text,
    created_at timestamptz default now(),
    unique(round_id, tg_id)
);