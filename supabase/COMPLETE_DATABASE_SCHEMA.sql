-- ============================================================================
-- LEETSTREAK COMPLETE DATABASE SCHEMA (ALL-IN-ONE GENERATOR)
-- Platform: Supabase PostgreSQL (Postgres 15+)
-- Generates all tables, columns, indexes, constraints, RLS policies, Realtime
-- publications, triggers, and SECURITY DEFINER RPC functions.
--
-- Safe for both fresh databases and upgrading existing databases.
-- Can be run directly in the Supabase Dashboard SQL Editor or via CLI:
--   psql "<SUPABASE_DB_CONNECTION_STRING>" -f supabase/COMPLETE_DATABASE_SCHEMA.sql
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 2. TABLES & COLUMNS (CREATE + ALTER FOR IDEMPOTENCY)
-- ─────────────────────────────────────────────────────────────

-- 2.1 Public Profiles Table (Linked 1:1 to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    leetcode_username TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_token TEXT DEFAULT ('ls-verify-' || substr(md5(random()::text), 1, 8)),
    total_solved INT NOT NULL DEFAULT 0,
    easy_solved INT NOT NULL DEFAULT 0,
    medium_solved INT NOT NULL DEFAULT 0,
    hard_solved INT NOT NULL DEFAULT 0,
    current_streak INT NOT NULL DEFAULT 0,
    longest_streak INT NOT NULL DEFAULT 0,
    contest_rating FLOAT DEFAULT 0,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS verification_token TEXT DEFAULT ('ls-verify-' || substr(md5(random()::text), 1, 8)),
    ADD COLUMN IF NOT EXISTS total_solved INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS easy_solved INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS medium_solved INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS hard_solved INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_streak INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS longest_streak INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS contest_rating FLOAT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_lower_username 
    ON public.profiles(LOWER(leetcode_username));
CREATE INDEX IF NOT EXISTS idx_profiles_total_solved ON public.profiles(total_solved DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_streak ON public.profiles(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_rating ON public.profiles(contest_rating DESC);

-- 2.2 User Settings Table (Strictly Private to Owner, with persistent friend backup)
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    hardcore_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    blocked_sites TEXT[] NOT NULL DEFAULT ARRAY['youtube.com', 'instagram.com', 'twitter.com', 'x.com', 'reddit.com']::text[],
    allowlist_urls TEXT[] NOT NULL DEFAULT '{}'::text[],
    path_rules JSONB NOT NULL DEFAULT '{"youtube.com": ["/shorts"], "linkedin.com": ["/feed"]}'::jsonb,
    saved_friends TEXT[] NOT NULL DEFAULT '{}'::text[],
    timezone TEXT NOT NULL DEFAULT 'UTC',
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
    quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
    snooze_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings
    ADD COLUMN IF NOT EXISTS saved_friends TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS allowlist_urls TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS path_rules JSONB NOT NULL DEFAULT '{"youtube.com": ["/shorts"], "linkedin.com": ["/feed"]}'::jsonb;

-- 2.3 Friendships Table (Normalized Consensual Social Graph)
CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_friendship_not_self CHECK (requester_id != addressee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_undirected_pair
    ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id, status);

-- 2.4 Roast Messages Table
CREATE TABLE IF NOT EXISTS public.roast_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender_username TEXT NOT NULL,
    recipient_username TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 500),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_roasts_recipient_status ON public.roast_messages(recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roasts_sender ON public.roast_messages(sender_id, created_at DESC);

-- 2.5 User Presence Table (Heartbeat Peer Status)
CREATE TABLE IF NOT EXISTS public.user_presence (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'in_battle', 'offline')),
    in_battle BOOLEAN NOT NULL DEFAULT FALSE,
    active_battle_id UUID
);

ALTER TABLE public.user_presence
    ADD COLUMN IF NOT EXISTS in_battle BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS active_battle_id UUID;

CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON public.user_presence(last_seen DESC);

-- 2.6 Battles Table (1v1 Live Arena)
CREATE TABLE IF NOT EXISTS public.battles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenger_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    challenged_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    challenger_username TEXT NOT NULL,
    challenged_username TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'javascript',
    status TEXT NOT NULL DEFAULT 'pending',
    challenger_pick TEXT,
    challenger_pick_title TEXT,
    challenged_pick TEXT,
    challenged_pick_title TEXT,
    problem_1 TEXT,
    problem_1_title TEXT,
    problem_2 TEXT,
    problem_2_title TEXT,
    challenger_ready BOOLEAN NOT NULL DEFAULT FALSE,
    challenged_ready BOOLEAN NOT NULL DEFAULT FALSE,
    countdown_starts TIMESTAMPTZ,
    match_starts_at TIMESTAMPTZ,
    match_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
    completed_at TIMESTAMPTZ,
    winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    winner_username TEXT,
    win_reason TEXT,
    topics TEXT[] DEFAULT NULL,
    difficulty TEXT DEFAULT NULL,
    duration_minutes INT DEFAULT 30,
    problem_count INT DEFAULT 5,
    start_at TIMESTAMPTZ DEFAULT NULL,
    end_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT chk_battle_status CHECK (
        status IN (
            'pending', 'accepted', 'selecting', 'ready_check',
            'countdown', 'in_progress', 'completed',
            'declined', 'expired', 'cancelled', 'forfeited'
        )
    ),
    CONSTRAINT chk_battle_participants_diff CHECK (challenger_id != challenged_id)
);

ALTER TABLE public.battles
    ADD COLUMN IF NOT EXISTS topics TEXT[] DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS duration_minutes INT DEFAULT 30,
    ADD COLUMN IF NOT EXISTS problem_count INT DEFAULT 5,
    ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS match_starts_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS match_deadline TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS countdown_starts TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS challenger_ready BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS challenged_ready BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS winner_username TEXT,
    ADD COLUMN IF NOT EXISTS win_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_battles_challenger ON public.battles(challenger_id, status);
CREATE INDEX IF NOT EXISTS idx_battles_challenged ON public.battles(challenged_id, status);
CREATE INDEX IF NOT EXISTS idx_battles_status ON public.battles(status, match_deadline);

-- 2.7 Battle Problems Table (Dynamic Sequences)
CREATE TABLE IF NOT EXISTS public.battle_problems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    sequence_number INT NOT NULL,
    problem_slug TEXT NOT NULL,
    problem_title TEXT NOT NULL,
    problem_url TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    topics TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_battle_problem_sequence UNIQUE (battle_id, sequence_number),
    CONSTRAINT uq_battle_problem_slug UNIQUE (battle_id, problem_slug)
);

CREATE INDEX IF NOT EXISTS idx_battle_problems_battle ON public.battle_problems(battle_id, sequence_number ASC);

-- 2.8 Battle Participants Table (Player Cursor & Progress)
CREATE TABLE IF NOT EXISTS public.battle_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    current_problem_index INT NOT NULL DEFAULT 0,
    solved_count INT NOT NULL DEFAULT 0,
    total_time_ms BIGINT NOT NULL DEFAULT 0,
    is_ready BOOLEAN NOT NULL DEFAULT FALSE,
    ready_at TIMESTAMPTZ DEFAULT NULL,
    finished_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_battle_participant UNIQUE (battle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_battle_participants_battle ON public.battle_participants(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_participants_user ON public.battle_participants(user_id);

-- 2.9 Battle Results Table (Submissions & Solves)
CREATE TABLE IF NOT EXISTS public.battle_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    problem_slug TEXT NOT NULL,
    leetcode_submission_id TEXT,
    accepted BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    time_taken_seconds INT NOT NULL DEFAULT 0,
    time_taken_ms BIGINT NOT NULL DEFAULT 0,
    runtime_ms INT,
    memory_mb FLOAT,
    language TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 1,
    points INT NOT NULL DEFAULT 0 CHECK (points IN (0, 1)),
    CONSTRAINT uq_battle_submission_idempotency UNIQUE(battle_id, user_id, problem_slug, leetcode_submission_id)
);

ALTER TABLE public.battle_results
    ADD COLUMN IF NOT EXISTS time_taken_ms BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS runtime_ms INT,
    ADD COLUMN IF NOT EXISTS memory_mb FLOAT,
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'javascript',
    ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_battle_accepted_solve 
    ON public.battle_results(battle_id, user_id, problem_slug) 
    WHERE accepted = TRUE;
CREATE INDEX IF NOT EXISTS idx_battle_results_lookup ON public.battle_results(battle_id, user_id);

-- 2.10 Battle Events Table (Durable Event Log)
CREATE TABLE IF NOT EXISTS public.battle_events (
    id BIGSERIAL PRIMARY KEY,
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.battle_events
    ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.battle_events DROP CONSTRAINT IF EXISTS battle_events_event_type_check;
ALTER TABLE public.battle_events ADD CONSTRAINT battle_events_event_type_check CHECK (
    event_type IN (
        'challenge_sent', 'challenge_created', 'challenge_accepted', 'challenge_declined',
        'problem_selected', 'ready_confirmed', 'countdown_started',
        'match_started', 'submission_attempt', 'problem_solved',
        'forfeited', 'match_finalized', 'cancelled'
    )
);

CREATE INDEX IF NOT EXISTS idx_battle_events_replay ON public.battle_events(battle_id, id ASC);

-- ─────────────────────────────────────────────────────────────
-- 3. TRIGGERS & CONSTRAINTS
-- ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS canonicalize_battle_problem_url ON public.battle_problems;
DROP FUNCTION IF EXISTS public.canonicalize_battle_problem() CASCADE;

CREATE OR REPLACE FUNCTION public.canonicalize_battle_problem()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.problem_slug := LOWER(TRIM(NEW.problem_slug));
  IF NEW.problem_slug IS NULL OR length(NEW.problem_slug) > 100
     OR NEW.problem_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid LeetCode problem slug';
  END IF;
  NEW.problem_url := 'https://leetcode.com/problems/' || NEW.problem_slug || '/';
  IF NEW.problem_title IS NULL OR length(TRIM(NEW.problem_title)) = 0 OR length(NEW.problem_title) > 200 THEN
    RAISE EXCEPTION 'Invalid LeetCode problem title';
  END IF;
  IF NEW.difficulty NOT IN ('Easy', 'Medium', 'Hard') THEN
    RAISE EXCEPTION 'Invalid problem difficulty';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER canonicalize_battle_problem_url
BEFORE INSERT OR UPDATE OF problem_slug, problem_url, problem_title, difficulty
ON public.battle_problems
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_battle_problem();

-- ─────────────────────────────────────────────────────────────
-- 4. REPLICA IDENTITY & REALTIME PUBLICATIONS
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.user_presence REPLICA IDENTITY FULL;
ALTER TABLE public.battles REPLICA IDENTITY FULL;
ALTER TABLE public.battle_events REPLICA IDENTITY FULL;
ALTER TABLE public.roast_messages REPLICA IDENTITY FULL;
ALTER TABLE public.friendships REPLICA IDENTITY FULL;
ALTER TABLE public.battle_participants REPLICA IDENTITY FULL;
ALTER TABLE public.battle_problems REPLICA IDENTITY FULL;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roast_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_participants;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_problems;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_events ENABLE ROW LEVEL SECURITY;

-- 5.1 Profiles RLS
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
CREATE POLICY "profiles_select_public" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 5.2 User Settings RLS (Strictly Owner Only)
DROP POLICY IF EXISTS "settings_select_own" ON public.user_settings;
CREATE POLICY "settings_select_own" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "settings_insert_own" ON public.user_settings;
CREATE POLICY "settings_insert_own" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "settings_update_own" ON public.user_settings;
CREATE POLICY "settings_update_own" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "settings_delete_own" ON public.user_settings;
CREATE POLICY "settings_delete_own" ON public.user_settings FOR DELETE USING (auth.uid() = user_id);

-- 5.3 Friendships RLS (Direct writes blocked; managed via RPCs)
DROP POLICY IF EXISTS "friendships_select_participants" ON public.friendships;
CREATE POLICY "friendships_select_participants" ON public.friendships FOR SELECT TO authenticated
    USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- 5.4 Roast Messages RLS
DROP POLICY IF EXISTS "roasts_select_parties" ON public.roast_messages;
CREATE POLICY "roasts_select_parties" ON public.roast_messages FOR SELECT
    USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "roasts_insert_sender" ON public.roast_messages;
CREATE POLICY "roasts_insert_sender" ON public.roast_messages FOR INSERT
    WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "roasts_update_recipient" ON public.roast_messages;
CREATE POLICY "roasts_update_recipient" ON public.roast_messages FOR UPDATE
    USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "roasts_delete_participants" ON public.roast_messages;
CREATE POLICY "roasts_delete_participants" ON public.roast_messages FOR DELETE
    USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

-- 5.5 User Presence RLS
DROP POLICY IF EXISTS "presence_select_authenticated" ON public.user_presence;
CREATE POLICY "presence_select_authenticated" ON public.user_presence FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "presence_upsert_own" ON public.user_presence;
CREATE POLICY "presence_upsert_own" ON public.user_presence FOR ALL
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5.6 Battle Tables RLS (SELECT for participants, Mutations strictly via RPCs)
DROP POLICY IF EXISTS "battles_select_participants" ON public.battles;
CREATE POLICY "battles_select_participants" ON public.battles FOR SELECT
    USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

DROP POLICY IF EXISTS "battle_problems_select_participants" ON public.battle_problems;
CREATE POLICY "battle_problems_select_participants" ON public.battle_problems FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    ));

DROP POLICY IF EXISTS "battle_participants_select_participants" ON public.battle_participants;
CREATE POLICY "battle_participants_select_participants" ON public.battle_participants FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    ));

DROP POLICY IF EXISTS "battle_results_select_participants" ON public.battle_results;
CREATE POLICY "battle_results_select_participants" ON public.battle_results FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    ));

DROP POLICY IF EXISTS "battle_events_select_participants" ON public.battle_events;
CREATE POLICY "battle_events_select_participants" ON public.battle_events FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    ));

-- ─────────────────────────────────────────────────────────────
-- 6. DROP EXISTING FUNCTIONS (Prevents ERROR 42P13: cannot remove parameter defaults)
-- ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_own_profile() CASCADE;
DROP FUNCTION IF EXISTS public.restore_or_init_profile(TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.restore_or_init_profile(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.restore_or_init_profile(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.request_friendship(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_friend_requests() CASCADE;
DROP FUNCTION IF EXISTS public.respond_to_friend_request(UUID, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.get_accepted_friends() CASCADE;
DROP FUNCTION IF EXISTS public.remove_friendship(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.heartbeat_presence(TEXT, TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS public.heartbeat_presence(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.heartbeat_presence() CASCADE;
DROP FUNCTION IF EXISTS public.get_friends_presence(TEXT[]) CASCADE;
DROP FUNCTION IF EXISTS public.get_friends_presence() CASCADE;
DROP FUNCTION IF EXISTS public.get_online_friends() CASCADE;
DROP FUNCTION IF EXISTS public.set_presence_offline() CASCADE;
DROP FUNCTION IF EXISTS public.clean_stale_presence() CASCADE;
DROP FUNCTION IF EXISTS public.send_roast(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.battle_performance_scores(FLOAT, INT, FLOAT, INT) CASCADE;
DROP FUNCTION IF EXISTS public._finalize_battle(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.evaluate_and_finalize_battle(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.create_battle_v2(TEXT, TEXT[], TEXT, INT, INT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_battle_v2(TEXT, TEXT[], TEXT, INT, INT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_battle_v2(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.accept_battle_v2(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.respond_battle_v2(UUID, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_battle_v2(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.confirm_ready_v2(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.confirm_ready_v2(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.confirm_battle_ready(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_battle_state_v2(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_active_battle() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_recent_battles(INT) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_recent_battles() CASCADE;
DROP FUNCTION IF EXISTS public.forfeit_battle_v2(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.forfeit_battle(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.record_battle_solve(UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.record_battle_solve_verified(UUID, UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_battle_history_scoreboard(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) CASCADE;
DROP FUNCTION IF EXISTS public.get_battle_history_details(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) CASCADE;
DROP FUNCTION IF EXISTS public.get_battle_history_details_v2(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 7. RE-CREATE RPC FUNCTIONS (SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────

-- 7.1 Get Own Profile
CREATE OR REPLACE FUNCTION public.get_own_profile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_profile RECORD;
BEGIN
    IF v_user_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object(
        'id', v_profile.id,
        'leetcode_username', v_profile.leetcode_username,
        'display_name', v_profile.display_name,
        'avatar_url', v_profile.avatar_url,
        'total_solved', v_profile.total_solved,
        'easy_solved', v_profile.easy_solved,
        'medium_solved', v_profile.medium_solved,
        'hard_solved', v_profile.hard_solved,
        'current_streak', v_profile.current_streak,
        'longest_streak', v_profile.longest_streak,
        'contest_rating', v_profile.contest_rating,
        'last_synced_at', v_profile.last_synced_at,
        'created_at', v_profile.created_at
    );
END;
$$;

-- 7.2 Restore or Initialize Profile
CREATE OR REPLACE FUNCTION public.restore_or_init_profile(
    p_leetcode_username TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_clean_username TEXT;
    v_profile RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
    v_clean_username := LOWER(TRIM(p_leetcode_username));
    IF v_clean_username IS NULL OR length(v_clean_username) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username');
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
    IF FOUND THEN
        IF LOWER(v_profile.leetcode_username) != v_clean_username THEN
            UPDATE public.profiles
            SET leetcode_username = v_clean_username,
                display_name = COALESCE(p_display_name, v_profile.display_name, v_clean_username),
                avatar_url = COALESCE(p_avatar_url, v_profile.avatar_url),
                updated_at = now()
            WHERE id = v_user_id
            RETURNING * INTO v_profile;
        END IF;
    ELSE
        INSERT INTO public.profiles (id, leetcode_username, display_name, avatar_url)
        VALUES (v_user_id, v_clean_username, COALESCE(p_display_name, v_clean_username), p_avatar_url)
        RETURNING * INTO v_profile;

        INSERT INTO public.user_settings (user_id)
        VALUES (v_user_id)
        ON CONFLICT (user_id) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'profile', jsonb_build_object(
            'id', v_profile.id,
            'leetcode_username', v_profile.leetcode_username,
            'display_name', v_profile.display_name,
            'avatar_url', v_profile.avatar_url,
            'current_streak', v_profile.current_streak,
            'longest_streak', v_profile.longest_streak,
            'total_solved', v_profile.total_solved,
            'easy_solved', v_profile.easy_solved,
            'medium_solved', v_profile.medium_solved,
            'hard_solved', v_profile.hard_solved,
            'contest_rating', v_profile.contest_rating
        )
    );
END;
$$;

-- 7.3 Friend Request Lifecycle (Request, View, Respond, List, Remove)
CREATE OR REPLACE FUNCTION public.request_friendship(p_target_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_target_id UUID;
  v_pair public.friendships%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Authentication required');
  END IF;
  IF NULLIF(TRIM(p_target_username), '') IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Target username is required');
  END IF;

  SELECT id INTO v_target_id FROM public.profiles
  WHERE LOWER(leetcode_username) = LOWER(TRIM(p_target_username));
  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Target user profile not found');
  END IF;
  IF v_target_id = v_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Cannot befriend yourself');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(v_user_id::TEXT, v_target_id::TEXT) || ':' || GREATEST(v_user_id::TEXT, v_target_id::TEXT), 0));
  SELECT * INTO v_pair FROM public.friendships
  WHERE (requester_id = v_user_id AND addressee_id = v_target_id)
     OR (requester_id = v_target_id AND addressee_id = v_user_id)
  FOR UPDATE;

  IF FOUND THEN
    IF v_pair.status = 'blocked' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This friendship is unavailable');
    END IF;
    IF v_pair.status = 'accepted' THEN
      RETURN jsonb_build_object('success', TRUE, 'status', 'accepted', 'friendship_id', v_pair.id);
    END IF;
    IF v_pair.requester_id = v_target_id AND v_pair.status = 'pending' THEN
      UPDATE public.friendships SET status = 'accepted', updated_at = now() WHERE id = v_pair.id;
      RETURN jsonb_build_object('success', TRUE, 'status', 'accepted', 'friendship_id', v_pair.id);
    END IF;
    IF v_pair.status = 'rejected' THEN
      UPDATE public.friendships
      SET requester_id = v_user_id,
          addressee_id = v_target_id,
          status = 'pending',
          updated_at = now()
      WHERE id = v_pair.id;
      RETURN jsonb_build_object('success', TRUE, 'status', 'pending', 'friendship_id', v_pair.id);
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'status', 'pending', 'friendship_id', v_pair.id);
  END IF;

  INSERT INTO public.friendships (requester_id, addressee_id, status)
  VALUES (v_user_id, v_target_id, 'pending')
  RETURNING * INTO v_pair;
  RETURN jsonb_build_object('success', TRUE, 'status', 'pending', 'friendship_id', v_pair.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_friend_requests()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'friendship_id', f.id,
    'sender_id', p.id,
    'sender_username', p.leetcode_username,
    'sender_display_name', p.display_name,
    'sender_avatar_url', p.avatar_url,
    'created_at', f.created_at
  ) ORDER BY f.created_at DESC), '[]'::JSONB)
  INTO v_result
  FROM public.friendships f
  JOIN public.profiles p ON p.id = f.requester_id
  WHERE f.addressee_id = v_user_id AND f.status = 'pending';

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_friend_request(p_friendship_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_friendship public.friendships%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  SELECT * INTO v_friendship FROM public.friendships WHERE id = p_friendship_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Friend request not found');
  END IF;
  IF v_friendship.addressee_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the request recipient may accept or reject');
  END IF;
  IF v_friendship.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Friend request is not pending');
  END IF;

  IF p_accept THEN
    UPDATE public.friendships SET status = 'accepted', updated_at = now() WHERE id = p_friendship_id;
    RETURN jsonb_build_object('success', true, 'status', 'accepted');
  ELSE
    UPDATE public.friendships SET status = 'rejected', updated_at = now() WHERE id = p_friendship_id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_accepted_friends()
RETURNS TABLE (
    friend_id UUID,
    leetcode_username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    current_streak INT,
    longest_streak INT,
    total_solved INT,
    easy_solved INT,
    medium_solved INT,
    hard_solved INT,
    contest_rating FLOAT,
    last_synced_at TIMESTAMPTZ,
    friendship_id UUID,
    friendship_created_at TIMESTAMPTZ,
    is_requester BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN RETURN; END IF;

    RETURN QUERY
    SELECT 
        p.id AS friend_id,
        p.leetcode_username,
        p.display_name,
        p.avatar_url,
        p.current_streak,
        p.longest_streak,
        p.total_solved,
        p.easy_solved,
        p.medium_solved,
        p.hard_solved,
        p.contest_rating,
        p.last_synced_at,
        f.id AS friendship_id,
        f.created_at AS friendship_created_at,
        (f.requester_id = v_user_id) AS is_requester
    FROM public.friendships f
    JOIN public.profiles p ON p.id = (
        CASE WHEN f.requester_id = v_user_id THEN f.addressee_id ELSE f.requester_id END
    )
    WHERE f.status = 'accepted'
      AND (f.requester_id = v_user_id OR f.addressee_id = v_user_id)
    ORDER BY p.leetcode_username ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friendship(p_target_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_target_id UUID;
    v_deleted_count INT := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;

    SELECT id INTO v_target_id FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(TRIM(p_target_username));

    IF v_target_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    DELETE FROM public.friendships
    WHERE ((requester_id = v_user_id AND addressee_id = v_target_id)
        OR (requester_id = v_target_id AND addressee_id = v_user_id));
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'removed', v_deleted_count > 0);
END;
$$;

-- 7.4 Presence Management (Heartbeat, List Friends Presence, Offline, Cleanup)
CREATE OR REPLACE FUNCTION public.heartbeat_presence(
    p_status TEXT DEFAULT 'online',
    p_client_time TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_username TEXT;
    v_in_battle BOOLEAN := FALSE;
    v_active_battle_id UUID := NULL;
    v_effective_status TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required for heartbeat';
    END IF;

    SELECT leetcode_username INTO v_username FROM public.profiles WHERE id = v_user_id;
    IF v_username IS NULL THEN v_username := 'unknown'; END IF;

    SELECT id INTO v_active_battle_id
    FROM public.battles
    WHERE (challenger_id = v_user_id OR challenged_id = v_user_id)
      AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    ORDER BY created_at DESC LIMIT 1;

    IF v_active_battle_id IS NOT NULL THEN
        v_in_battle := TRUE;
        v_effective_status := 'in_battle';
    ELSIF p_status IN ('online', 'in_battle', 'offline') THEN
        v_effective_status := p_status;
    ELSE
        v_effective_status := 'online';
    END IF;

    INSERT INTO public.user_presence (
        user_id, username, last_seen, status, in_battle, active_battle_id
    ) VALUES (
        v_user_id, LOWER(v_username), v_now, v_effective_status, v_in_battle, v_active_battle_id
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
        username = EXCLUDED.username,
        last_seen = v_now,
        status = EXCLUDED.status,
        in_battle = EXCLUDED.in_battle,
        active_battle_id = EXCLUDED.active_battle_id;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'username', LOWER(v_username),
        'status', v_effective_status,
        'in_battle', v_in_battle,
        'active_battle_id', v_active_battle_id,
        'last_seen', v_now
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_friends_presence(p_usernames TEXT[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_stale_threshold TIMESTAMPTZ := now() - interval '120 seconds';
  v_result JSONB := '{}'::JSONB;
  v_row RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  FOR v_row IN
    SELECT
      p.leetcode_username,
      up.last_seen,
      CASE
        WHEN up.last_seen IS NULL OR up.last_seen < v_stale_threshold THEN 'offline'
        WHEN EXISTS (
          SELECT 1 FROM public.battles b
          WHERE (b.challenger_id = p.id OR b.challenged_id = p.id)
            AND b.status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
        ) THEN 'in_battle'
        WHEN up.status = 'in_battle' THEN 'in_battle'
        ELSE 'online'
      END AS effective_status,
      EXISTS (
        SELECT 1 FROM public.battles b
        WHERE (b.challenger_id = p.id OR b.challenged_id = p.id)
          AND b.status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
      ) AS is_in_battle
    FROM public.friendships f
    JOIN public.profiles p ON p.id = CASE
        WHEN f.requester_id = v_user_id THEN f.addressee_id ELSE f.requester_id END
    LEFT JOIN public.user_presence up ON up.user_id = p.id
    WHERE f.status = 'accepted'
      AND (f.requester_id = v_user_id OR f.addressee_id = v_user_id)
      AND (
        p_usernames IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(p_usernames) AS requested(username)
          WHERE requested.username IS NOT NULL AND lower(requested.username) = lower(p.leetcode_username)
        )
      )
  LOOP
    v_result := jsonb_set(
      v_result,
      ARRAY[lower(v_row.leetcode_username)],
      jsonb_build_object(
        'status', v_row.effective_status,
        'isOnline', v_row.effective_status IN ('online', 'in_battle'),
        'inBattle', v_row.is_in_battle,
        'last_seen', v_row.last_seen
      ),
      TRUE
    );
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_online_friends()
RETURNS TABLE (
    friend_id UUID,
    leetcode_username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    current_streak INT,
    total_solved INT,
    status TEXT,
    last_seen TIMESTAMPTZ,
    in_active_battle BOOLEAN,
    active_battle_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_stale_threshold TIMESTAMPTZ := now() - interval '120 seconds';
BEGIN
    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH user_friends AS (
        SELECT 
            CASE 
                WHEN f.requester_id = v_user_id THEN f.addressee_id 
                ELSE f.requester_id 
            END AS f_id
        FROM public.friendships f
        WHERE f.status = 'accepted'
        AND (f.requester_id = v_user_id OR f.addressee_id = v_user_id)
    ),
    friend_battles AS (
        SELECT 
            b.id AS battle_id,
            CASE 
                WHEN b.challenger_id = uf.f_id THEN b.challenger_id
                ELSE b.challenged_id
            END AS player_id
        FROM public.battles b
        INNER JOIN user_friends uf ON (b.challenger_id = uf.f_id OR b.challenged_id = uf.f_id)
        WHERE b.status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    )
    SELECT
        p.id AS friend_id,
        p.leetcode_username,
        p.display_name,
        p.avatar_url,
        p.current_streak,
        p.total_solved,
        CASE
            WHEN up.last_seen IS NULL OR up.last_seen < v_stale_threshold THEN 'offline'
            WHEN fb.battle_id IS NOT NULL THEN 'in_battle'
            WHEN up.status = 'in_battle' THEN 'in_battle'
            ELSE 'online'
        END AS status,
        up.last_seen,
        (fb.battle_id IS NOT NULL) AS in_active_battle,
        fb.battle_id AS active_battle_id
    FROM user_friends uf
    JOIN public.profiles p ON p.id = uf.f_id
    LEFT JOIN public.user_presence up ON up.user_id = uf.f_id
    LEFT JOIN friend_battles fb ON fb.player_id = uf.f_id
    WHERE up.last_seen >= v_stale_threshold
    ORDER BY 
        CASE 
            WHEN fb.battle_id IS NULL THEN 1
            ELSE 2
        END,
        p.current_streak DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_presence_offline()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;

    UPDATE public.user_presence
    SET status = 'offline',
        in_battle = FALSE,
        active_battle_id = NULL,
        last_seen = now()
    WHERE user_id = v_user_id;

    RETURN jsonb_build_object('success', true, 'status', 'offline');
END;
$$;

CREATE OR REPLACE FUNCTION public.clean_stale_presence()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_updated INT := 0;
BEGIN
    UPDATE public.user_presence
    SET status = 'offline',
        in_battle = FALSE,
        active_battle_id = NULL
    WHERE status != 'offline'
      AND last_seen < (now() - interval '2 minutes');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$;

-- 7.5 Roast Delivery
CREATE OR REPLACE FUNCTION public.send_roast(p_recipient_username TEXT, p_content TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sender_id UUID := auth.uid();
    v_recipient_id UUID;
    v_sender_username TEXT;
    v_clean_content TEXT;
    v_roast RECORD;
BEGIN
    IF v_sender_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;

    v_clean_content := TRIM(p_content);
    IF v_clean_content IS NULL OR length(v_clean_content) = 0 OR length(v_clean_content) > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid roast content');
    END IF;

    SELECT leetcode_username INTO v_sender_username FROM public.profiles WHERE id = v_sender_id;
    IF v_sender_username IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender profile missing');
    END IF;

    SELECT id INTO v_recipient_id FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(TRIM(p_recipient_username));
    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient not found');
    END IF;

    IF v_recipient_id = v_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot roast yourself');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.friendships
        WHERE status = 'accepted'
          AND ((requester_id = v_sender_id AND addressee_id = v_recipient_id)
            OR (requester_id = v_recipient_id AND addressee_id = v_sender_id))
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Must be accepted friends to roast');
    END IF;

    INSERT INTO public.roast_messages (
        sender_id, recipient_id, sender_username, recipient_username, content
    ) VALUES (
        v_sender_id, v_recipient_id, v_sender_username, LOWER(TRIM(p_recipient_username)), v_clean_content
    ) RETURNING * INTO v_roast;

    RETURN jsonb_build_object('success', true, 'roast', row_to_json(v_roast));
END;
$$;

-- 7.5.1 Ephemeral Roast Bulk Deletion
CREATE OR REPLACE FUNCTION public.delete_roast_messages(p_message_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_deleted_count INT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    DELETE FROM public.roast_messages
    WHERE id = ANY(p_message_ids)
      AND (recipient_id = v_user_id OR sender_id = v_user_id);
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'deleted', v_deleted_count);
END;
$$;

-- 7.6 Battle Performance Scoring Helper
CREATE OR REPLACE FUNCTION public.battle_performance_scores(
  p_mem1 FLOAT,
  p_run1 INT,
  p_mem2 FLOAT,
  p_run2 INT
)
RETURNS TABLE (
  available BOOLEAN,
  final_score_1 NUMERIC,
  final_score_2 NUMERIC
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_avail BOOLEAN;
  v_mem_score_1 NUMERIC := 0.5;
  v_run_score_1 NUMERIC := 0.5;
  v_final_1 NUMERIC := 0.5;
BEGIN
  v_avail := (p_mem1 IS NOT NULL AND p_mem2 IS NOT NULL
              AND p_mem1 > 0 AND p_mem2 > 0
              AND p_run1 IS NOT NULL AND p_run2 IS NOT NULL
              AND p_run1 >= 0 AND p_run2 >= 0);

  IF NOT v_avail THEN
    RETURN QUERY SELECT FALSE, 0.5::NUMERIC, 0.5::NUMERIC;
    RETURN;
  END IF;

  IF (p_mem1 + p_mem2) = 0 THEN
    v_mem_score_1 := 0.5;
  ELSE
    v_mem_score_1 := ROUND((p_mem2::NUMERIC / (p_mem1 + p_mem2)::NUMERIC), 6);
  END IF;

  IF (p_run1 + p_run2) = 0 THEN
    v_run_score_1 := 0.5;
  ELSE
    v_run_score_1 := ROUND((p_run2::NUMERIC / (p_run1 + p_run2)::NUMERIC), 6);
  END IF;

  v_final_1 := ROUND((0.4 * v_mem_score_1 + 0.6 * v_run_score_1), 6);
  RETURN QUERY SELECT TRUE, v_final_1, ROUND((1.0 - v_final_1), 6);
END;
$$;

-- 7.7 Battle Finalization Engine
CREATE OR REPLACE FUNCTION public._finalize_battle(p_battle_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_battle RECORD;
  v_score_1 INT;
  v_score_2 INT;
  v_time_1 BIGINT;
  v_time_2 BIGINT;
  v_problem_count INT;
  v_near_pairs INT := 0;
  v_perf_pairs INT := 0;
  v_perf_1 NUMERIC := 0;
  v_perf_2 NUMERIC := 0;
  v_winner TEXT := 'draw';
  v_reason TEXT := 'draw';
  v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
  IF NOT FOUND OR v_battle.status IN ('completed', 'forfeited', 'cancelled', 'expired', 'declined') THEN
    RETURN;
  END IF;
  v_now := clock_timestamp();

  SELECT COUNT(*) INTO v_problem_count FROM public.battle_problems WHERE battle_id = p_battle_id;
  SELECT COUNT(*) FILTER (WHERE user_id = v_battle.challenger_id),
         COUNT(*) FILTER (WHERE user_id = v_battle.challenged_id),
         COALESCE(SUM(COALESCE(time_taken_ms, time_taken_seconds::BIGINT * 1000)) FILTER (WHERE user_id = v_battle.challenger_id), 0),
         COALESCE(SUM(COALESCE(time_taken_ms, time_taken_seconds::BIGINT * 1000)) FILTER (WHERE user_id = v_battle.challenged_id), 0)
  INTO v_score_1, v_score_2, v_time_1, v_time_2
  FROM public.battle_results
  WHERE battle_id = p_battle_id AND accepted;

  IF NOT ((v_problem_count > 0 AND v_score_1 >= v_problem_count AND v_score_2 >= v_problem_count)
      OR (COALESCE(v_battle.match_deadline, v_battle.end_at) IS NOT NULL
          AND v_now >= COALESCE(v_battle.match_deadline, v_battle.end_at))) THEN
    RETURN;
  END IF;

  IF v_score_1 > v_score_2 THEN
    v_winner := v_battle.challenger_username; v_reason := 'points';
  ELSIF v_score_2 > v_score_1 THEN
    v_winner := v_battle.challenged_username; v_reason := 'points';
  ELSIF v_score_1 > 0 THEN
    SELECT COUNT(*) FILTER (WHERE ABS(EXTRACT(EPOCH FROM (r1.submitted_at - r2.submitted_at))) <= 2),
           COUNT(*) FILTER (WHERE ABS(EXTRACT(EPOCH FROM (r1.submitted_at - r2.submitted_at))) <= 2
                            AND (perf.score->>'available')::BOOLEAN),
           COALESCE(SUM((perf.score->>'final_score_1')::NUMERIC) FILTER (
             WHERE ABS(EXTRACT(EPOCH FROM (r1.submitted_at - r2.submitted_at))) <= 2
               AND (perf.score->>'available')::BOOLEAN), 0),
           COALESCE(SUM((perf.score->>'final_score_2')::NUMERIC) FILTER (
             WHERE ABS(EXTRACT(EPOCH FROM (r1.submitted_at - r2.submitted_at))) <= 2
               AND (perf.score->>'available')::BOOLEAN), 0)
    INTO v_near_pairs, v_perf_pairs, v_perf_1, v_perf_2
    FROM public.battle_results r1
    JOIN public.battle_results r2 ON r2.battle_id = r1.battle_id
      AND LOWER(r2.problem_slug) = LOWER(r1.problem_slug)
      AND r2.user_id = v_battle.challenged_id AND r2.accepted
    CROSS JOIN LATERAL public.battle_performance_scores(
      r1.memory_mb, r1.runtime_ms, r2.memory_mb, r2.runtime_ms
    ) AS perf(score)
    WHERE r1.battle_id = p_battle_id AND r1.user_id = v_battle.challenger_id AND r1.accepted;

    IF v_perf_pairs > 0 THEN
      IF v_perf_1 > v_perf_2 THEN v_winner := v_battle.challenger_username; v_reason := 'performance';
      ELSIF v_perf_2 > v_perf_1 THEN v_winner := v_battle.challenged_username; v_reason := 'performance';
      ELSE v_reason := 'draw';
      END IF;
    ELSIF v_time_1 <> v_time_2 THEN
      v_winner := CASE WHEN v_time_1 < v_time_2 THEN v_battle.challenger_username ELSE v_battle.challenged_username END;
      v_reason := CASE WHEN v_near_pairs > 0 THEN 'performance_unavailable' ELSE 'tiebreaker_time' END;
    ELSIF v_near_pairs > 0 THEN
      v_reason := 'performance_unavailable';
    END IF;
  END IF;

  UPDATE public.battles
  SET status = 'completed',
      winner_id = CASE
        WHEN v_winner = v_battle.challenger_username THEN v_battle.challenger_id
        WHEN v_winner = v_battle.challenged_username THEN v_battle.challenged_id
        ELSE NULL
      END,
      winner_username = v_winner,
      win_reason = v_reason,
      completed_at = v_now
  WHERE id = p_battle_id;

  INSERT INTO public.battle_events (battle_id, event_type, payload)
  VALUES (p_battle_id, 'match_finalized', jsonb_build_object(
      'winner', v_winner,
      'win_reason', v_reason,
      'score_1', v_score_1,
      'score_2', v_score_2
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_and_finalize_battle(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._finalize_battle(p_battle_id);
  RETURN jsonb_build_object('success', TRUE, 'battle_id', p_battle_id);
END;
$$;

-- 7.8 Battle Match Lifecycle (Create, Accept, Respond, Cancel, Confirm Ready, State, Forfeit)
CREATE OR REPLACE FUNCTION public.create_battle_v2(
  p_challenged_username TEXT,
  p_topics TEXT[] DEFAULT NULL,
  p_difficulty TEXT DEFAULT 'Medium',
  p_duration_minutes INT DEFAULT 30,
  p_problem_count INT DEFAULT 5,
  p_language TEXT DEFAULT 'javascript',
  p_challenger_username TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_challenger_id UUID := auth.uid();
  v_challenged_id UUID;
  v_challenger_username TEXT;
  v_challenged_canonical_username TEXT;
  v_now TIMESTAMPTZ := now();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF v_challenger_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  IF NULLIF(TRIM(p_challenged_username), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Opponent username is required');
  END IF;
  IF p_problem_count IS NOT NULL AND p_problem_count NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Problem count must be between 1 and 10');
  END IF;
  IF p_duration_minutes IS NOT NULL AND p_duration_minutes NOT BETWEEN 5 AND 120 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Battle duration must be between 5 and 120 minutes');
  END IF;

  SELECT leetcode_username INTO v_challenger_username
  FROM public.profiles WHERE id = v_challenger_id;
  IF v_challenger_username IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account profile is not set up. Reopen Battle and complete profile setup.');
  END IF;
  SELECT id, leetcode_username INTO v_challenged_id, v_challenged_canonical_username
  FROM public.profiles WHERE LOWER(leetcode_username) = LOWER(TRIM(p_challenged_username));
  IF v_challenged_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Opponent profile not found. They must sign in to LeetStreak first.');
  END IF;
  IF v_challenged_id = v_challenger_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot challenge yourself');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(v_challenger_id::TEXT, v_challenged_id::TEXT), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(v_challenger_id::TEXT, v_challenged_id::TEXT), 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = v_challenger_id AND f.addressee_id = v_challenged_id)
        OR (f.requester_id = v_challenged_id AND f.addressee_id = v_challenger_id))
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must accept each other as friends before starting a battle');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.battles b
    WHERE (b.challenger_id IN (v_challenger_id, v_challenged_id)
      OR b.challenged_id IN (v_challenger_id, v_challenged_id))
      AND b.status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'One of these users already has an active battle');
  END IF;

  INSERT INTO public.battles (
    challenger_id, challenged_id, challenger_username, challenged_username,
    language, status, topics, difficulty, duration_minutes, problem_count,
    expires_at, created_at
  ) VALUES (
    v_challenger_id, v_challenged_id, v_challenger_username, v_challenged_canonical_username,
    LOWER(COALESCE(NULLIF(TRIM(p_language), ''), 'javascript')), 'pending',
    COALESCE(p_topics, ARRAY['Arrays', 'Strings']),
    COALESCE(p_difficulty, 'Medium'),
    COALESCE(p_duration_minutes, 30),
    COALESCE(p_problem_count, 5),
    v_now + interval '24 hours', v_now
  ) RETURNING * INTO v_battle;

  INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
  VALUES (v_battle.id, v_challenger_id, 'challenge_created', jsonb_build_object(
    'challenged_id', v_challenged_id,
    'topics', COALESCE(p_topics, ARRAY['Arrays', 'Strings']),
    'difficulty', COALESCE(p_difficulty, 'Medium')
  ));
  RETURN jsonb_build_object('success', true, 'battle', to_jsonb(v_battle));
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_battle_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_battle RECORD;
    v_username TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
    END IF;

    IF v_battle.challenged_id != v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not the invited opponent');
    END IF;

    IF v_battle.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle is no longer pending');
    END IF;

    IF v_battle.expires_at < now() THEN
        UPDATE public.battles SET status = 'expired' WHERE id = p_battle_id;
        RETURN jsonb_build_object('success', false, 'error', 'Challenge has expired');
    END IF;

    SELECT leetcode_username INTO v_username FROM public.profiles WHERE id = v_user_id;

    UPDATE public.battles
    SET status = 'accepted', accepted_at = now()
    WHERE id = p_battle_id;

    INSERT INTO public.battle_participants (battle_id, user_id, username, is_ready)
    VALUES
        (p_battle_id, v_battle.challenger_id, v_battle.challenger_username, false),
        (p_battle_id, v_battle.challenged_id, v_battle.challenged_username, false)
    ON CONFLICT (battle_id, user_id) DO NOTHING;

    INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 'challenge_accepted', jsonb_build_object('accepted_by', v_username));

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
    RETURN jsonb_build_object('success', true, 'battle', row_to_json(v_battle));
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_battle_v2(p_battle_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
  END IF;
  IF v_battle.challenged_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the invited participant can respond');
  END IF;
  IF v_battle.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Battle is no longer pending');
  END IF;
  IF NOT p_accept THEN
    UPDATE public.battles SET status = 'declined' WHERE id = p_battle_id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');
  END IF;
  RETURN public.accept_battle_v2(p_battle_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_battle_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  UPDATE public.battles SET status = 'cancelled'
  WHERE id = p_battle_id AND challenger_id = v_user_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the challenger can cancel a pending battle');
  END IF;
  RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_ready_v2(
    p_battle_id UUID,
    p_problems JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_battle RECORD;
    v_my_ready BOOLEAN;
    v_other_ready BOOLEAN;
    v_problem JSONB;
    v_seq INT := 1;
    v_start_at TIMESTAMPTZ;
    v_end_at TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
    END IF;

    IF v_battle.status NOT IN ('accepted', 'ready_check') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle is not in an acceptable state for ready confirmation');
    END IF;

    IF v_battle.challenger_id != v_user_id AND v_battle.challenged_id != v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not a participant in this battle');
    END IF;

    UPDATE public.battle_participants
    SET is_ready = true, ready_at = now()
    WHERE battle_id = p_battle_id AND user_id = v_user_id;

    UPDATE public.battles SET status = 'ready_check' WHERE id = p_battle_id AND status = 'accepted';

    SELECT
        bool_and(bp.is_ready) FILTER (WHERE bp.user_id = v_user_id) AS my_ready,
        bool_and(bp.is_ready) FILTER (WHERE bp.user_id != v_user_id) AS other_ready
    INTO v_my_ready, v_other_ready
    FROM public.battle_participants bp
    WHERE bp.battle_id = p_battle_id;

    v_my_ready := true;

    IF v_my_ready AND COALESCE(v_other_ready, false) THEN
        IF NOT EXISTS (SELECT 1 FROM public.battle_problems WHERE battle_id = p_battle_id) THEN
            IF p_problems IS NOT NULL AND jsonb_array_length(p_problems) > 0 THEN
                FOR v_problem IN SELECT * FROM jsonb_array_elements(p_problems)
                LOOP
                    INSERT INTO public.battle_problems (
                        battle_id, sequence_number, problem_slug, problem_title,
                        problem_url, difficulty, topics
                    ) VALUES (
                        p_battle_id,
                        v_seq,
                        v_problem->>'slug',
                        v_problem->>'title',
                        COALESCE(v_problem->>'url', 'https://leetcode.com/problems/' || (v_problem->>'slug') || '/'),
                        COALESCE(v_problem->>'difficulty', 'Medium'),
                        COALESCE(
                            ARRAY(SELECT jsonb_array_elements_text(v_problem->'topics')),
                            '{}'::TEXT[]
                        )
                    )
                    ON CONFLICT (battle_id, sequence_number) DO NOTHING;
                    v_seq := v_seq + 1;
                END LOOP;
            END IF;
        END IF;

        v_start_at := now() + interval '10 seconds';
        v_end_at := v_start_at + (v_battle.duration_minutes * interval '1 minute');

        UPDATE public.battles
        SET
            status = 'countdown',
            match_starts_at = v_start_at,
            match_deadline = v_end_at,
            start_at = v_start_at,
            end_at = v_end_at,
            countdown_starts = now(),
            challenger_ready = true,
            challenged_ready = true
        WHERE id = p_battle_id;

        INSERT INTO public.battle_events (battle_id, event_type, payload)
        VALUES (p_battle_id, 'countdown_started', jsonb_build_object(
            'start_at', v_start_at,
            'end_at', v_end_at
        ));

        SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
        RETURN jsonb_build_object(
            'success', true,
            'bothReady', true,
            'status', 'countdown',
            'battle', row_to_json(v_battle)
        );
    ELSE
        SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
        RETURN jsonb_build_object(
            'success', true,
            'bothReady', false,
            'status', v_battle.status,
            'battle', row_to_json(v_battle)
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_battle_state_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_battle RECORD;
    v_problems JSONB;
    v_participants JSONB;
    v_results JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
    END IF;

    IF v_battle.challenger_id != v_user_id AND v_battle.challenged_id != v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a participant');
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'sequence_number', bp.sequence_number,
            'problem_slug', bp.problem_slug,
            'problem_title', bp.problem_title,
            'problem_url', bp.problem_url,
            'difficulty', bp.difficulty,
            'topics', bp.topics
        ) ORDER BY bp.sequence_number
    ) INTO v_problems
    FROM public.battle_problems bp
    WHERE bp.battle_id = p_battle_id;

    SELECT jsonb_agg(
        jsonb_build_object(
            'user_id', bpa.user_id,
            'username', bpa.username,
            'current_problem_index', bpa.current_problem_index,
            'solved_count', bpa.solved_count,
            'is_ready', bpa.is_ready,
            'ready_at', bpa.ready_at
        )
    ) INTO v_participants
    FROM public.battle_participants bpa
    WHERE bpa.battle_id = p_battle_id;

    SELECT jsonb_agg(
        jsonb_build_object(
            'user_id', br.user_id,
            'username', br.username,
            'problem_slug', br.problem_slug,
            'accepted', br.accepted,
            'time_taken_seconds', br.time_taken_seconds,
            'submitted_at', br.submitted_at
        )
    ) INTO v_results
    FROM public.battle_results br
    WHERE br.battle_id = p_battle_id AND br.accepted = true;

    RETURN jsonb_build_object(
        'success', true,
        'battle', row_to_json(v_battle),
        'problems', COALESCE(v_problems, '[]'::JSONB),
        'participants', COALESCE(v_participants, '[]'::JSONB),
        'results', COALESCE(v_results, '[]'::JSONB)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_active_battle()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_battle JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  SELECT to_jsonb(b) INTO v_battle
  FROM public.battles b
  WHERE (b.challenger_id = v_user_id OR b.challenged_id = v_user_id)
    AND b.status NOT IN ('completed', 'declined', 'expired', 'cancelled', 'forfeited')
  ORDER BY b.created_at DESC LIMIT 1;
  RETURN jsonb_build_object('success', true, 'battle', v_battle);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_recent_battles(p_limit INT DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rows JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  SELECT COALESCE(jsonb_agg(row_data ORDER BY battle_at DESC), '[]'::JSONB) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', b.id,
      'challenger_id', b.challenger_id,
      'challenged_id', b.challenged_id,
      'challenger_username', challenger.leetcode_username,
      'challenged_username', challenged.leetcode_username,
      'status', b.status,
      'winner_id', b.winner_id,
      'winner_username', CASE WHEN b.winner_id IS NULL THEN b.winner_username ELSE winner.leetcode_username END,
      'win_reason', b.win_reason,
      'created_at', b.created_at,
      'completed_at', b.completed_at,
      'opponent_id', CASE WHEN b.challenger_id = v_user_id THEN b.challenged_id ELSE b.challenger_id END,
      'opponent', CASE WHEN b.challenger_id = v_user_id THEN challenged.leetcode_username ELSE challenger.leetcode_username END,
      'outcome', CASE
        WHEN b.winner_id = v_user_id OR (b.winner_id IS NULL AND LOWER(b.winner_username) = LOWER(me.leetcode_username)) THEN 'win'
        WHEN b.winner_id IS NOT NULL AND b.winner_id <> v_user_id THEN 'loss'
        WHEN b.winner_id IS NULL AND COALESCE(LOWER(b.winner_username), 'draw') NOT IN ('draw', LOWER(me.leetcode_username)) THEN 'loss'
        ELSE 'draw'
      END,
      'results', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'username', participant.leetcode_username,
        'problem_slug', r.problem_slug, 'accepted', r.accepted,
        'submitted_at', r.submitted_at, 'time_taken_seconds', r.time_taken_seconds,
        'time_taken_ms', r.time_taken_ms, 'runtime_ms', r.runtime_ms,
        'memory_mb', r.memory_mb, 'language', r.language
      ) ORDER BY r.submitted_at) FROM public.battle_results r
        JOIN public.profiles participant ON participant.id = r.user_id
        WHERE r.battle_id = b.id AND r.accepted), '[]'::JSONB)
    ) AS row_data,
    COALESCE(b.completed_at, b.created_at) AS battle_at
    FROM public.battles b
    JOIN public.profiles me ON me.id = v_user_id
    JOIN public.profiles challenger ON challenger.id = b.challenger_id
    JOIN public.profiles challenged ON challenged.id = b.challenged_id
    LEFT JOIN public.profiles winner ON winner.id = b.winner_id
    WHERE (b.challenger_id = v_user_id OR b.challenged_id = v_user_id)
      AND b.status IN ('completed', 'forfeited')
    ORDER BY COALESCE(b.completed_at, b.created_at) DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
  ) history;
  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_battle_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_battle RECORD;
    v_winner TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
    END IF;

    IF v_battle.challenger_id != v_user_id AND v_battle.challenged_id != v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a participant');
    END IF;

    v_winner := CASE
        WHEN v_battle.challenger_id = v_user_id THEN v_battle.challenged_username
        ELSE v_battle.challenger_username
    END;

    UPDATE public.battles
    SET status = 'forfeited', winner_username = v_winner, win_reason = 'forfeit', completed_at = now()
    WHERE id = p_battle_id;

    INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 'forfeited', jsonb_build_object('winner', v_winner));

    RETURN jsonb_build_object('success', true, 'winner', v_winner);
END;
$$;

-- 7.9 Server-Verified Battle Solve (Restricted to service_role / Edge Function)
CREATE OR REPLACE FUNCTION public.record_battle_solve_verified(
  p_verified_user_id UUID,
  p_battle_id UUID,
  p_problem_slug TEXT,
  p_submission_id TEXT,
  p_time_taken_ms BIGINT,
  p_runtime_ms INT,
  p_memory_mb FLOAT,
  p_language TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := p_verified_user_id;
  v_battle RECORD;
  v_participant RECORD;
  v_problem RECORD;
  v_next_problem RECORD;
  v_username TEXT;
  v_submitted_at TIMESTAMPTZ;
  v_start_at TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_elapsed_ms BIGINT;
  v_total_problems INT;
  v_my_solved INT;
  v_opp_solved INT;
  v_inserted INT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Unauthorized verifier');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Battle not found');
  END IF;
  v_submitted_at := clock_timestamp();

  IF v_battle.challenger_id <> v_user_id AND v_battle.challenged_id <> v_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You are not a participant');
  END IF;
  IF v_battle.status IN ('completed', 'forfeited', 'cancelled', 'expired', 'declined') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Battle is already finalized');
  END IF;

  v_start_at := COALESCE(v_battle.match_starts_at, v_battle.start_at);
  v_deadline := COALESCE(v_battle.match_deadline, v_battle.end_at);
  IF v_battle.status = 'countdown' AND v_start_at IS NOT NULL AND v_submitted_at >= v_start_at THEN
    UPDATE public.battles SET status = 'in_progress' WHERE id = p_battle_id;
    v_battle.status := 'in_progress';
  END IF;
  IF v_battle.status <> 'in_progress' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Battle is not in progress');
  END IF;
  IF v_deadline IS NOT NULL AND v_submitted_at >= v_deadline THEN
    PERFORM public._finalize_battle(p_battle_id);
    RETURN jsonb_build_object('success', FALSE, 'error', 'Battle deadline has passed');
  END IF;

  SELECT * INTO v_participant FROM public.battle_participants
  WHERE battle_id = p_battle_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You are not a participant');
  END IF;
  SELECT * INTO v_problem FROM public.battle_problems
  WHERE battle_id = p_battle_id AND LOWER(problem_slug) = LOWER(TRIM(p_problem_slug));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Problem not in this battle');
  END IF;

  v_username := v_participant.username;
  v_elapsed_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_submitted_at - COALESCE(v_start_at, v_submitted_at))) * 1000)::BIGINT);

  INSERT INTO public.battle_results (
    battle_id, user_id, username, problem_slug, leetcode_submission_id,
    accepted, submitted_at, time_taken_seconds, time_taken_ms,
    runtime_ms, memory_mb, language, attempts, points
  ) VALUES (
    p_battle_id, v_user_id, v_username, LOWER(TRIM(p_problem_slug)),
    COALESCE(NULLIF(TRIM(p_submission_id), ''), 'client_' || gen_random_uuid()::TEXT),
    TRUE, v_submitted_at, (v_elapsed_ms / 1000)::INT, v_elapsed_ms,
    CASE WHEN p_runtime_ms >= 0 THEN p_runtime_ms ELSE NULL END,
    CASE WHEN p_memory_mb > 0 AND p_memory_mb < 'Infinity'::FLOAT AND p_memory_mb <> 'NaN'::FLOAT THEN p_memory_mb ELSE NULL END,
    COALESCE(p_language, v_battle.language, 'javascript'), 1, 1
  )
  ON CONFLICT (battle_id, user_id, problem_slug) WHERE accepted = TRUE DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    UPDATE public.battle_participants
    SET current_problem_index = GREATEST(current_problem_index, v_problem.sequence_number),
        solved_count = solved_count + 1,
        total_time_ms = total_time_ms + v_elapsed_ms,
        finished_at = CASE WHEN solved_count + 1 >= (SELECT COUNT(*) FROM public.battle_problems WHERE battle_id = p_battle_id) THEN v_submitted_at ELSE finished_at END
    WHERE battle_id = p_battle_id AND user_id = v_user_id
    RETURNING * INTO v_participant;
  ELSE
    SELECT * INTO v_participant FROM public.battle_participants
    WHERE battle_id = p_battle_id AND user_id = v_user_id;
  END IF;

  SELECT COUNT(*) INTO v_total_problems FROM public.battle_problems WHERE battle_id = p_battle_id;

  SELECT bp.* INTO v_next_problem
  FROM public.battle_problems bp
  WHERE bp.battle_id = p_battle_id
    AND bp.sequence_number > v_problem.sequence_number
    AND NOT EXISTS (
      SELECT 1 FROM public.battle_results br
      WHERE br.battle_id = p_battle_id AND br.user_id = v_user_id
        AND br.problem_slug = bp.problem_slug AND br.accepted
    )
  ORDER BY bp.sequence_number ASC LIMIT 1;

  IF v_inserted > 0 THEN
    INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 'problem_solved', jsonb_build_object(
      'problem_slug', LOWER(TRIM(p_problem_slug)),
      'sequence_number', v_problem.sequence_number,
      'solved_count', v_participant.solved_count,
      'submission_id', p_submission_id,
      'verified', TRUE
    ));
  END IF;

  SELECT COUNT(*) INTO v_my_solved FROM public.battle_results
  WHERE battle_id = p_battle_id AND user_id = v_user_id AND accepted;

  SELECT COUNT(*) INTO v_opp_solved FROM public.battle_results
  WHERE battle_id = p_battle_id AND user_id <> v_user_id AND accepted;

  IF (v_total_problems > 0 AND v_my_solved >= v_total_problems AND v_opp_solved >= v_total_problems)
     OR (v_deadline IS NOT NULL AND v_submitted_at >= v_deadline) THEN
    PERFORM public._finalize_battle(p_battle_id);
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'duplicate', v_inserted = 0,
    'solved_count', v_participant.solved_count,
    'total_problems', v_total_problems,
    'next_problem_slug', v_next_problem.problem_slug,
    'next_problem_title', v_next_problem.problem_title,
    'next_problem_url', v_next_problem.problem_url,
    'battle_complete', v_my_solved >= v_total_problems,
    'submitted_at', CASE WHEN v_inserted > 0 THEN v_submitted_at ELSE NULL END,
    'time_taken_ms', CASE WHEN v_inserted > 0 THEN v_elapsed_ms ELSE NULL END
  );
END;
$$;

-- 7.9b Direct Client Battle Solve (Authenticated User RPC)
CREATE OR REPLACE FUNCTION public.record_battle_solve(
    p_battle_id       UUID,
    p_problem_slug    TEXT,
    p_submission_id   TEXT   DEFAULT NULL,
    p_time_taken_ms   BIGINT DEFAULT 0,
    p_runtime_ms      INT    DEFAULT NULL,
    p_memory_mb       FLOAT  DEFAULT NULL,
    p_language        TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_user_id        UUID := auth.uid();
    v_battle         RECORD;
    v_participant    RECORD;
    v_problem        RECORD;
    v_next_problem   RECORD;
    v_my_solved      INT;
    v_opp_solved     INT;
    v_username       TEXT;
    v_total_problems INT;
    v_now            TIMESTAMPTZ := clock_timestamp();
    v_start_at       TIMESTAMPTZ;
    v_deadline       TIMESTAMPTZ;
    v_elapsed_ms     BIGINT;
    v_inserted       INT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
    END IF;

    IF v_battle.challenger_id <> v_user_id AND v_battle.challenged_id <> v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not a participant in this battle');
    END IF;

    IF v_battle.status IN ('completed', 'forfeited', 'cancelled', 'expired', 'declined') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle is already finalized');
    END IF;

    v_start_at := COALESCE(v_battle.match_starts_at, v_battle.start_at);
    v_deadline := COALESCE(v_battle.match_deadline, v_battle.end_at);

    IF v_battle.status = 'countdown' AND v_start_at IS NOT NULL AND v_now >= v_start_at THEN
        UPDATE public.battles SET status = 'in_progress' WHERE id = p_battle_id;
        v_battle.status := 'in_progress';
    END IF;

    IF v_battle.status <> 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle is not in progress');
    END IF;

    IF v_deadline IS NOT NULL AND v_now >= v_deadline THEN
        PERFORM public._finalize_battle(p_battle_id);
        RETURN jsonb_build_object('success', false, 'error', 'Battle deadline has passed');
    END IF;

    SELECT * INTO v_participant
    FROM public.battle_participants
    WHERE battle_id = p_battle_id AND user_id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Participant record not found');
    END IF;

    SELECT * INTO v_problem
    FROM public.battle_problems
    WHERE battle_id = p_battle_id AND LOWER(problem_slug) = LOWER(TRIM(p_problem_slug));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Problem not in this battle');
    END IF;

    v_username := v_participant.username;
    v_elapsed_ms := GREATEST(0, COALESCE(p_time_taken_ms, FLOOR(EXTRACT(EPOCH FROM (v_now - COALESCE(v_start_at, v_now))) * 1000)::BIGINT));

    -- Insert solve into battle_results (idempotent: ignore duplicate solve)
    INSERT INTO public.battle_results (
        battle_id, user_id, username, problem_slug,
        leetcode_submission_id, accepted, submitted_at,
        time_taken_seconds, time_taken_ms, runtime_ms, memory_mb, language,
        attempts, points
    ) VALUES (
        p_battle_id, v_user_id, v_username, LOWER(TRIM(p_problem_slug)),
        COALESCE(NULLIF(TRIM(p_submission_id), ''), 'sub_' || gen_random_uuid()::TEXT),
        TRUE, v_now,
        (v_elapsed_ms / 1000)::INT, v_elapsed_ms,
        CASE WHEN p_runtime_ms >= 0 THEN p_runtime_ms ELSE NULL END,
        CASE WHEN p_memory_mb > 0 AND p_memory_mb < 'Infinity'::FLOAT AND p_memory_mb <> 'NaN'::FLOAT THEN p_memory_mb ELSE NULL END,
        COALESCE(p_language, v_battle.language, 'javascript'),
        1, 1
    )
    ON CONFLICT (battle_id, user_id, problem_slug) WHERE accepted = TRUE DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted > 0 THEN
        UPDATE public.battle_participants
        SET current_problem_index = GREATEST(current_problem_index, v_problem.sequence_number),
            solved_count = solved_count + 1,
            total_time_ms = total_time_ms + v_elapsed_ms,
            finished_at = CASE WHEN solved_count + 1 >= (SELECT COUNT(*) FROM public.battle_problems WHERE battle_id = p_battle_id) THEN v_now ELSE finished_at END
        WHERE battle_id = p_battle_id AND user_id = v_user_id
        RETURNING * INTO v_participant;
    ELSE
        SELECT * INTO v_participant
        FROM public.battle_participants
        WHERE battle_id = p_battle_id AND user_id = v_user_id;
    END IF;

    -- Count total battle problems
    SELECT COUNT(*) INTO v_total_problems FROM public.battle_problems WHERE battle_id = p_battle_id;

    -- Find next unsolved problem for this participant
    SELECT bp.* INTO v_next_problem
    FROM public.battle_problems bp
    WHERE bp.battle_id = p_battle_id
      AND bp.sequence_number > v_problem.sequence_number
      AND NOT EXISTS (
          SELECT 1 FROM public.battle_results br
          WHERE br.battle_id = p_battle_id
            AND br.user_id = v_user_id
            AND LOWER(br.problem_slug) = LOWER(bp.problem_slug)
            AND br.accepted = TRUE
      )
    ORDER BY bp.sequence_number ASC
    LIMIT 1;

    -- Also check any earlier skipped problems
    IF v_next_problem.problem_slug IS NULL THEN
        SELECT bp.* INTO v_next_problem
        FROM public.battle_problems bp
        WHERE bp.battle_id = p_battle_id
          AND NOT EXISTS (
              SELECT 1 FROM public.battle_results br
              WHERE br.battle_id = p_battle_id
                AND br.user_id = v_user_id
                AND LOWER(br.problem_slug) = LOWER(bp.problem_slug)
                AND br.accepted = TRUE
          )
        ORDER BY bp.sequence_number ASC
        LIMIT 1;
    END IF;

    -- Check if both finished and finalize
    SELECT COUNT(*) INTO v_my_solved
    FROM public.battle_results
    WHERE battle_id = p_battle_id AND user_id = v_user_id AND accepted = TRUE;

    SELECT COUNT(*) INTO v_opp_solved
    FROM public.battle_results
    WHERE battle_id = p_battle_id AND user_id <> v_user_id AND accepted = TRUE;

    IF v_my_solved >= v_total_problems AND v_opp_solved >= v_total_problems THEN
        PERFORM public._finalize_battle(p_battle_id);
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'solved_count', v_participant.solved_count,
        'total_problems', v_total_problems,
        'next_problem_slug', v_next_problem.problem_slug,
        'next_problem_title', v_next_problem.problem_title,
        'next_problem_url', v_next_problem.problem_url,
        'battle_complete', (v_next_problem.problem_slug IS NULL)
    );
END;
$$;

-- 7.10 Battle Scoreboard & Analytics
CREATE OR REPLACE FUNCTION public.get_battle_history_scoreboard(
  p_result_filter TEXT DEFAULT 'all',
  p_topic_filter TEXT DEFAULT NULL,
  p_difficulty_filter TEXT DEFAULT 'all',
  p_opponent_id UUID DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 12,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Authentication required');
  END IF;

  WITH base AS (
    SELECT b.id, b.created_at, COALESCE(b.completed_at, b.created_at) AS battle_at,
      b.topics, b.difficulty, b.win_reason, b.winner_id, b.winner_username,
      me.id AS my_id, me.leetcode_username AS my_username,
      me.display_name AS my_display_name, me.avatar_url AS my_avatar_url,
      opp.id AS opponent_id,
      CASE WHEN b.challenger_id = v_user_id
        THEN COALESCE(NULLIF(BTRIM(b.challenged_username), ''), opp.leetcode_username)
        ELSE COALESCE(NULLIF(BTRIM(b.challenger_username), ''), opp.leetcode_username)
      END AS opponent_username,
      opp.display_name AS opponent_display_name, opp.avatar_url AS opponent_avatar_url,
      CASE
        WHEN b.winner_id = me.id OR (b.winner_id IS NULL AND LOWER(b.winner_username) = LOWER(me.leetcode_username)) THEN 'win'
        WHEN b.winner_id IS NOT NULL AND b.winner_id <> me.id THEN 'loss'
        WHEN b.winner_id IS NULL AND COALESCE(LOWER(b.winner_username), 'draw') NOT IN ('draw', LOWER(me.leetcode_username)) THEN 'loss'
        ELSE 'draw'
      END AS outcome
    FROM public.battles b
    JOIN public.profiles me ON me.id = v_user_id
    JOIN public.profiles opp ON opp.id = CASE WHEN b.challenger_id = v_user_id THEN b.challenged_id ELSE b.challenger_id END
    WHERE b.status IN ('completed', 'forfeited')
      AND (b.challenger_id = v_user_id OR b.challenged_id = v_user_id)
      AND b.challenger_id <> b.challenged_id
      AND LOWER(COALESCE(b.challenger_username, '')) <> LOWER(COALESCE(b.challenged_username, ''))
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_result_filter = 'all' OR outcome = p_result_filter)
      AND (p_topic_filter IS NULL OR (
        p_topic_filter <> '__other__' AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(topics, '{}'::TEXT[])) AS t(topic)
          WHERE LOWER(t.topic) = LOWER(p_topic_filter)
        )
      ) OR (
        p_topic_filter = '__other__' AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(topics, '{}'::TEXT[])) AS t(topic)
          WHERE LOWER(t.topic) NOT IN ('arrays','strings','hashing','two pointers','sliding window','binary search','sorting','linked lists','stacks','queues','trees','binary search trees','heaps','graphs','backtracking','greedy','dynamic programming','tries','bit manipulation','intervals','math')
        )
      ))
      AND (p_difficulty_filter = 'all' OR LOWER(difficulty) = LOWER(p_difficulty_filter))
      AND (p_opponent_id IS NULL OR opponent_id = p_opponent_id)
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
  ), grouped AS (
    SELECT opponent_id, MAX(opponent_username) AS opponent_username,
      MAX(opponent_display_name) AS opponent_display_name,
      MAX(opponent_avatar_url) AS opponent_avatar_url,
      MAX(my_username) AS my_username, MAX(my_display_name) AS my_display_name,
      MAX(my_avatar_url) AS my_avatar_url,
      COUNT(*) FILTER (WHERE outcome = 'win')::INT AS my_wins,
      COUNT(*) FILTER (WHERE outcome = 'loss')::INT AS opponent_wins,
      COUNT(*) FILTER (WHERE outcome = 'draw')::INT AS draws,
      COUNT(*)::INT AS completed_battles, MAX(battle_at) AS last_battle_at
    FROM filtered
    GROUP BY opponent_id
  ), opponents AS (
    SELECT DISTINCT opponent_id, opponent_username, opponent_display_name
    FROM base
  )
  SELECT jsonb_build_object(
    'success', TRUE,
    'opponents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'opponent_id', opponent_id, 'opponent_username', opponent_username,
      'opponent_display_name', opponent_display_name
    ) ORDER BY opponent_display_name, opponent_username) FROM opponents), '[]'::JSONB),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY page.last_battle_at DESC)
      FROM (SELECT * FROM grouped ORDER BY last_battle_at DESC, opponent_username LIMIT v_limit OFFSET v_offset) page), '[]'::JSONB),
    'total_opponents', (SELECT COUNT(*) FROM grouped),
    'total_matches', (SELECT COUNT(*) FROM filtered),
    'has_more', v_offset + v_limit < (SELECT COUNT(*) FROM grouped)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_battle_history_details(
  p_opponent_id UUID,
  p_result_filter TEXT DEFAULT 'all',
  p_topic_filter TEXT DEFAULT NULL,
  p_difficulty_filter TEXT DEFAULT 'all',
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 10,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows JSONB;
  v_total INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  WITH base AS (
    SELECT b.id, b.created_at, b.completed_at, b.topics, b.difficulty, b.win_reason,
      b.winner_id, b.winner_username, b.challenger_id, b.challenged_id,
      challenger.leetcode_username AS challenger_username,
      challenged.leetcode_username AS challenged_username,
      CASE WHEN b.winner_id = v_user_id OR
        (b.winner_id IS NULL AND LOWER(b.winner_username) = LOWER(me.leetcode_username)) THEN 'win'
        WHEN b.winner_id IS NOT NULL AND b.winner_id <> v_user_id THEN 'loss'
        WHEN b.winner_id IS NULL AND COALESCE(LOWER(b.winner_username), 'draw') NOT IN ('draw', LOWER(me.leetcode_username)) THEN 'loss'
        ELSE 'draw' END AS outcome,
      CASE WHEN b.winner_id IS NULL THEN b.winner_username ELSE winner.leetcode_username END AS verified_winner_username
    FROM public.battles b
    JOIN public.profiles me ON me.id = v_user_id
    JOIN public.profiles challenger ON challenger.id = b.challenger_id
    JOIN public.profiles challenged ON challenged.id = b.challenged_id
    LEFT JOIN public.profiles winner ON winner.id = b.winner_id
    WHERE b.status IN ('completed', 'forfeited')
      AND ((b.challenger_id = v_user_id AND b.challenged_id = p_opponent_id)
        OR (b.challenged_id = v_user_id AND b.challenger_id = p_opponent_id))
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_result_filter = 'all' OR outcome = p_result_filter)
      AND (p_difficulty_filter = 'all' OR LOWER(difficulty) = LOWER(p_difficulty_filter))
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
      AND (p_topic_filter IS NULL OR (
        p_topic_filter <> '__other__' AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(topics, '{}'::TEXT[])) AS t(topic)
          WHERE LOWER(t.topic) = LOWER(p_topic_filter)
        )
      ) OR (
        p_topic_filter = '__other__' AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(topics, '{}'::TEXT[])) AS t(topic)
          WHERE LOWER(t.topic) NOT IN ('arrays','strings','hashing','two pointers','sliding window','binary search','sorting','linked lists','stacks','queues','trees','binary search trees','heaps','graphs','backtracking','greedy','dynamic programming','tries','bit manipulation','intervals','math')
        )
      ))
  ), page AS (
    SELECT * FROM filtered
    ORDER BY COALESCE(completed_at, created_at) DESC, id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', page.id,
      'created_at', page.created_at,
      'completed_at', page.completed_at,
      'topics', page.topics,
      'difficulty', page.difficulty,
      'win_reason', page.win_reason,
      'winner_id', page.winner_id,
      'winner_username', page.verified_winner_username,
      'challenger_id', page.challenger_id,
      'challenged_id', page.challenged_id,
      'challenger_username', page.challenger_username,
      'challenged_username', page.challenged_username,
      'outcome', page.outcome,
      'results', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', br.user_id,
          'username', participant.leetcode_username,
          'problem_slug', br.problem_slug,
          'accepted', br.accepted,
          'submitted_at', br.submitted_at,
          'time_taken_ms', br.time_taken_ms,
          'runtime_ms', br.runtime_ms,
          'memory_mb', br.memory_mb,
          'language', br.language
        ) ORDER BY br.submitted_at)
        FROM public.battle_results br
        JOIN public.profiles participant ON participant.id = br.user_id
        WHERE br.battle_id = page.id AND br.accepted
      ), '[]'::JSONB)
    ) ORDER BY COALESCE(page.completed_at, page.created_at) DESC
  ), '[]'::JSONB), (SELECT COUNT(*) FROM filtered)
  INTO v_rows, v_total FROM page;
  RETURN jsonb_build_object('success', true, 'rows', v_rows,
    'total_matches', v_total, 'has_more', v_offset + v_limit < v_total);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. SECURITY & ACCESS PERMISSIONS (GRANTS)
-- ─────────────────────────────────────────────────────────────

-- 8.1 Revoke dangerous defaults
REVOKE ALL ON TABLE
  public.friendships,
  public.battles,
  public.battle_results,
  public.battle_events,
  public.battle_participants,
  public.battle_problems
FROM PUBLIC, anon, authenticated;

-- 8.2 Grant SELECT on tables to authenticated
GRANT SELECT ON TABLE
  public.profiles,
  public.user_settings,
  public.friendships,
  public.roast_messages,
  public.user_presence,
  public.battles,
  public.battle_results,
  public.battle_events,
  public.battle_participants,
  public.battle_problems
TO authenticated;

-- 8.3 Grant owner writes on profiles, user_settings, user_presence, roast_messages
GRANT INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.user_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.user_presence TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.roast_messages TO authenticated;

-- 8.4 Function execution grants
REVOKE ALL ON FUNCTION public.record_battle_solve_verified(UUID, UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_battle_solve_verified(UUID, UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
TO service_role;

GRANT EXECUTE ON FUNCTION public.record_battle_solve(UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.get_own_profile(),
  public.restore_or_init_profile(TEXT, TEXT, TEXT),
  public.request_friendship(TEXT),
  public.get_friend_requests(),
  public.respond_to_friend_request(UUID, BOOLEAN),
  public.get_accepted_friends(),
  public.remove_friendship(TEXT),
  public.heartbeat_presence(TEXT, TIMESTAMPTZ),
  public.get_friends_presence(TEXT[]),
  public.get_online_friends(),
  public.set_presence_offline(),
  public.send_roast(TEXT, TEXT),
  public.delete_roast_messages(UUID[]),
  public.create_battle_v2(TEXT, TEXT[], TEXT, INT, INT, TEXT, TEXT),
  public.accept_battle_v2(UUID),
  public.respond_battle_v2(UUID, BOOLEAN),
  public.cancel_battle_v2(UUID),
  public.confirm_ready_v2(UUID, JSONB),
  public.get_battle_state_v2(UUID),
  public.get_my_active_battle(),
  public.get_my_recent_battles(INT),
  public.forfeit_battle_v2(UUID),
  public.get_battle_history_scoreboard(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT),
  public.get_battle_history_details(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT)
TO authenticated;

-- Grant sequence usage
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Notify PostgREST to refresh its schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
