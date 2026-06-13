create table card_set
(
    id       INTEGER
        primary key autoincrement,
    name     TEXT not null,
    forward  TEXT not null,
    backward TEXT not null,
    filter   TEXT not null
);

create table settings
(
    id    text
        primary key,
    value text
);

create table word_group
(
    id   INTEGER
        primary key autoincrement,
    name TEXT not null
);

create table words
(
    id       INTEGER
        primary key autoincrement,
    key      TEXT              not null,
    value    TEXT              not null,
    tags     TEXT              not null,
    more     TEXT,
    group_id integer default 1 not null
        constraint words_word_group_id_fk
            references word_group
            on update cascade on delete cascade
);

create table card_stats
(
    id          INTEGER
        primary key autoincrement,
    word_id     INTEGER           not null
        references words
            on delete cascade,
    set_id      TEXT              not null
        references card_set
            on delete cascade,
    score       INTEGER default 1 not null,
    last_opened integer           not null
);

