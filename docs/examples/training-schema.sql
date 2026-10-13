-- Training platform data model, written as DDL so jdraw's paste importer draws it as
-- table shapes with foreign-key arrows between rows. Paste onto a canvas, or use
-- "Import diagram from code" with the SQL schema format.
--
-- Conceptual (dotted) links from the original flowchart are modelled as nullable
-- foreign keys where there is a real reference; derived aggregates (daily_load from
-- set_logs / workout_items) are left as plain columns.

-- ===== Identity & Roster =====

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE user_roles (
  id      uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  role    text NOT NULL  -- athlete | coach | trainer | admin
);

CREATE TABLE athletes (
  id        uuid PRIMARY KEY,
  user_id   uuid UNIQUE NOT NULL REFERENCES users(id),
  division  text,
  grad_year int,
  tfrrs_id  text
);

CREATE TABLE seasons (
  id         uuid PRIMARY KEY,
  kind       text NOT NULL,  -- xc | indoor | outdoor
  start_date date NOT NULL,
  end_date   date NOT NULL
);

CREATE TABLE season_rosters (
  id         uuid PRIMARY KEY,
  season_id  uuid NOT NULL REFERENCES seasons(id),
  athlete_id uuid NOT NULL REFERENCES athletes(id),
  class_year text,
  redshirt   bool NOT NULL
);

CREATE TABLE groups (
  id   uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL  -- event group | training | custom
);

CREATE TABLE group_members (
  group_id   uuid NOT NULL REFERENCES groups(id),
  athlete_id uuid NOT NULL REFERENCES athletes(id),
  PRIMARY KEY (group_id, athlete_id)
);

CREATE TABLE group_staff (
  group_id uuid NOT NULL REFERENCES groups(id),
  user_id  uuid NOT NULL REFERENCES users(id),  -- coach
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE athlete_events (
  athlete_id uuid NOT NULL REFERENCES athletes(id),
  event_id   uuid NOT NULL REFERENCES events(id),
  is_primary bool NOT NULL,
  PRIMARY KEY (athlete_id, event_id)
);

-- ===== Training Content =====

CREATE TABLE events (
  id              uuid PRIMARY KEY,
  code            text UNIQUE NOT NULL,
  unit            text NOT NULL,
  lower_is_better bool NOT NULL,
  kind            text NOT NULL  -- competition | test | lift
);

CREATE TABLE exercises (
  id               uuid PRIMARY KEY,
  name             text NOT NULL,
  category         text NOT NULL,  -- run | lift | plyo | drill
  contacts_per_rep int,
  cns_weight       numeric,
  equipment        text
);

CREATE TABLE training_phases (
  id         uuid PRIMARY KEY,
  season_id  uuid NOT NULL REFERENCES seasons(id),
  parent_id  uuid REFERENCES training_phases(id),
  kind       text NOT NULL,  -- GPP | SPP | comp | taper
  start_date date NOT NULL,
  end_date   date NOT NULL
);

CREATE TABLE workouts (
  id                 uuid PRIMARY KEY,
  phase_id           uuid REFERENCES training_phases(id),
  ai_generation_id   uuid REFERENCES ai_generations(id),
  source_workout_id  uuid REFERENCES workouts(id),  -- copied / forked from
  title              text NOT NULL,
  is_template        bool NOT NULL,
  origin             text NOT NULL
);

CREATE TABLE workout_items (
  id              uuid PRIMARY KEY,
  workout_id      uuid NOT NULL REFERENCES workouts(id),
  exercise_id     uuid NOT NULL REFERENCES exercises(id),
  target_event_id uuid REFERENCES events(id),  -- % target basis
  position        int NOT NULL,
  block_label     text,
  sets            int,
  reps            int,
  distance_m      numeric,
  target_time_s   numeric,
  target_pct      numeric,
  target_load     numeric,
  target_rpe      numeric,
  rest_reps_s     int,
  rest_sets_s     int
);

-- ===== Scheduling & Execution =====

CREATE TABLE workout_assignments (
  id         uuid PRIMARY KEY,
  workout_id uuid NOT NULL REFERENCES workouts(id),
  date       date NOT NULL,
  group_id   uuid REFERENCES groups(id),    -- group OR athlete
  athlete_id uuid REFERENCES athletes(id)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY,
  assignment_id uuid REFERENCES workout_assignments(id),  -- fan out per athlete
  athlete_id    uuid NOT NULL REFERENCES athletes(id),
  workout_id    uuid NOT NULL REFERENCES workouts(id),
  date          date NOT NULL,
  status        text NOT NULL,
  srpe          numeric,
  duration_min  int,
  mod_note      text
);

CREATE TABLE set_logs (
  id              uuid PRIMARY KEY,
  session_id      uuid NOT NULL REFERENCES sessions(id),
  workout_item_id uuid NOT NULL REFERENCES workout_items(id),
  device_event_id uuid REFERENCES device_events(id),  -- processed from
  set_no          int NOT NULL,
  rep_no          int,
  time_s          numeric,
  distance_m      numeric,
  load_kg         numeric,
  contacts        int,
  steps           int,
  cadence         numeric,
  velocity        numeric,
  source          text NOT NULL,
  voided_at       timestamptz
);

CREATE TABLE meets (
  id               uuid PRIMARY KEY,
  season_id        uuid NOT NULL REFERENCES seasons(id),
  tfrrs_import_id  uuid REFERENCES tfrrs_imports(id),
  name             text NOT NULL,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  location         text,
  championship     bool NOT NULL,
  tfrrs_meet_id    text
);

CREATE TABLE meet_entries (
  id         uuid PRIMARY KEY,
  meet_id    uuid NOT NULL REFERENCES meets(id),
  athlete_id uuid NOT NULL REFERENCES athletes(id),
  event_id   uuid NOT NULL REFERENCES events(id)
);

CREATE TABLE calendar_events (
  id         uuid PRIMARY KEY,
  group_id   uuid REFERENCES groups(id),
  kind       text NOT NULL,  -- off | travel | testing
  start_date date NOT NULL,
  end_date   date NOT NULL
);

-- ===== Performance =====

CREATE TABLE performances (
  id              uuid PRIMARY KEY,
  athlete_id      uuid NOT NULL REFERENCES athletes(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  meet_id         uuid REFERENCES meets(id),
  session_id      uuid REFERENCES sessions(id),
  tfrrs_import_id uuid REFERENCES tfrrs_imports(id),
  mark            numeric NOT NULL,
  wind            numeric,
  fat             bool NOT NULL,
  indoor          bool NOT NULL,
  context         text NOT NULL  -- meet | practice | test
);

-- A view: best legal mark per athlete and event
CREATE TABLE personal_records (
  athlete_id     uuid NOT NULL REFERENCES athletes(id),
  event_id       uuid NOT NULL REFERENCES events(id),
  performance_id uuid NOT NULL REFERENCES performances(id),
  PRIMARY KEY (athlete_id, event_id)
);

-- ===== Health (restricted access) =====

CREATE TABLE wellness_checkins (
  id         uuid PRIMARY KEY,
  athlete_id uuid NOT NULL REFERENCES athletes(id),
  date       date NOT NULL,  -- one per athlete per day
  sleep      int,
  soreness   int,
  fatigue    int,
  stress     int,
  mood       int,
  UNIQUE (athlete_id, date)
);

CREATE TABLE body_regions (
  id   uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,  -- body-diagram code
  name text NOT NULL
);

CREATE TABLE soreness_sites (
  id             uuid PRIMARY KEY,
  checkin_id     uuid NOT NULL REFERENCES wellness_checkins(id),
  body_region_id uuid NOT NULL REFERENCES body_regions(id),
  side           text,
  severity       int NOT NULL
);

CREATE TABLE injuries (
  id             uuid PRIMARY KEY,
  athlete_id     uuid NOT NULL REFERENCES athletes(id),
  body_region_id uuid NOT NULL REFERENCES body_regions(id),
  side           text,
  severity       int NOT NULL,
  status         text NOT NULL,
  onset_date     date NOT NULL
);

CREATE TABLE injury_updates (
  id         uuid PRIMARY KEY,
  injury_id  uuid NOT NULL REFERENCES injuries(id),
  status     text NOT NULL,
  note       text,
  created_at timestamptz NOT NULL
);

CREATE TABLE restrictions (
  id            uuid PRIMARY KEY,
  athlete_id    uuid NOT NULL REFERENCES athletes(id),
  injury_id     uuid REFERENCES injuries(id),
  kind          text NOT NULL,
  category      text,           -- or a specific exercise
  exercise_id   uuid REFERENCES exercises(id),
  limit_value   text,
  start_date    date NOT NULL,
  end_date      date,
  coach_visible bool NOT NULL
);

-- ===== Load & Analytics =====

CREATE TABLE daily_load (
  id               uuid PRIMARY KEY,
  athlete_id       uuid NOT NULL REFERENCES athletes(id),
  session_id       uuid REFERENCES sessions(id),  -- sRPE source
  date             date NOT NULL,
  planned_run_m    numeric,  -- from workout_items
  actual_run_m     numeric,  -- from set_logs
  planned_hsr_m    numeric,
  actual_hsr_m     numeric,
  planned_tonnage  numeric,
  actual_tonnage   numeric,
  planned_contacts int,
  actual_contacts  int,
  srpe_load        numeric,
  cns_load         numeric
);

CREATE TABLE flags (
  id                  uuid PRIMARY KEY,
  athlete_id          uuid NOT NULL REFERENCES athletes(id),
  kind                text NOT NULL,  -- ACWR | spike | low readiness | cadence drop | new PR
  daily_load_id       uuid REFERENCES daily_load(id),
  wellness_checkin_id uuid REFERENCES wellness_checkins(id),
  set_log_id          uuid REFERENCES set_logs(id),      -- cadence vs baseline
  performance_id      uuid REFERENCES performances(id),  -- new PR
  acknowledged_by     uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL
);

-- ===== Hardware =====

CREATE TABLE devices (
  id        uuid PRIMARY KEY,
  kind      text NOT NULL,  -- waist_sensor | gate | radar
  ble_addr  text UNIQUE,
  firmware  text,
  last_seen timestamptz
);

CREATE TABLE device_assignments (
  id         uuid PRIMARY KEY,
  device_id  uuid NOT NULL REFERENCES devices(id),
  athlete_id uuid NOT NULL REFERENCES athletes(id),
  from_at    timestamptz NOT NULL,
  to_at      timestamptz
);

CREATE TABLE timing_runs (
  id              uuid PRIMARY KEY,
  workout_item_id uuid NOT NULL REFERENCES workout_items(id),
  group_id        uuid REFERENCES groups(id),
  started_by      uuid NOT NULL REFERENCES users(id),  -- coach Start
  started_at      timestamptz NOT NULL
);

CREATE TABLE device_events (
  id            uuid PRIMARY KEY,
  device_id     uuid NOT NULL REFERENCES devices(id),
  timing_run_id uuid REFERENCES timing_runs(id),
  payload       json NOT NULL,  -- raw, append-only
  received_at   timestamptz NOT NULL
);

-- ===== Import & AI =====

CREATE TABLE tfrrs_imports (
  id          uuid PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  status      text NOT NULL
);

CREATE TABLE ai_generations (
  id               uuid PRIMARY KEY,
  requested_by     uuid NOT NULL REFERENCES users(id),
  athlete_id       uuid REFERENCES athletes(id),
  phase_id         uuid REFERENCES training_phases(id),  -- context
  meet_id          uuid REFERENCES meets(id),            -- context
  context_snapshot json NOT NULL,  -- wellness, restrictions, phase, meets at request time
  output           json NOT NULL,
  status           text NOT NULL   -- proposed | accepted | rejected
);
