-- ============================================================================
-- LEETSTREAK FRESH-START COMPLETE DATABASE SETUP
-- Direct URL: https://supabase.com/dashboard/project/pzsldcjgpiodzuivrbwt/sql/new
--
-- This script completely wipes the public schema and builds the full,
-- production-ready LeetStreak database from scratch with zero errors.
-- ============================================================================

-- 1. CLEAN RESET: Drop and recreate public schema
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Restore standard Supabase permissions on public schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;

-- 2. Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- ============================================================================
-- 3. RELATIONAL TABLES
-- ============================================================================

-- 3.1 Profiles Table (Public Profile Data linked to auth.users)
CREATE TABLE public.profiles (
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

CREATE UNIQUE INDEX idx_profiles_lower_username ON public.profiles(LOWER(leetcode_username));
CREATE INDEX idx_profiles_total_solved ON public.profiles(total_solved DESC);
CREATE INDEX idx_profiles_streak ON public.profiles(current_streak DESC);
CREATE INDEX idx_profiles_rating ON public.profiles(contest_rating DESC);

-- 3.2 User Settings Table (Strictly Private to Owner)
CREATE TABLE public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    hardcore_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    blocked_sites TEXT[] NOT NULL DEFAULT ARRAY['youtube.com', 'instagram.com', 'twitter.com', 'x.com', 'reddit.com']::text[],
    allowlist_urls TEXT[] NOT NULL DEFAULT '{}'::text[],
    path_rules JSONB NOT NULL DEFAULT '{"youtube.com": ["/shorts"], "linkedin.com": ["/feed"]}'::jsonb,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
    quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
    snooze_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.3 Friendships Table (Normalized Social Graph)
CREATE TABLE public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_friendship_pair UNIQUE (requester_id, addressee_id),
    CONSTRAINT chk_friendship_not_self CHECK (requester_id != addressee_id)
);

CREATE INDEX idx_friendships_requester ON public.friendships(requester_id, status);
CREATE INDEX idx_friendships_addressee ON public.friendships(addressee_id, status);

-- 3.4 Roast Messages Table (Durable Recipient Delivery)
CREATE TABLE public.roast_messages (
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

CREATE INDEX idx_roasts_recipient_status ON public.roast_messages(recipient_id, status, created_at DESC);
CREATE INDEX idx_roasts_sender ON public.roast_messages(sender_id, created_at DESC);

-- 3.5 Battles Table (Canonical 1v1 Arena)
CREATE TABLE public.battles (
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
    topics TEXT[] DEFAULT ARRAY['Arrays', 'Strings']::text[],
    difficulty TEXT DEFAULT 'Medium',
    duration_minutes INT DEFAULT 30,
    problem_count INT DEFAULT 5,
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
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
    CONSTRAINT chk_battle_status CHECK (
        status IN (
            'pending', 'accepted', 'selecting', 'ready_check',
            'countdown', 'in_progress', 'completed',
            'declined', 'expired', 'cancelled', 'forfeited'
        )
    ),
    CONSTRAINT chk_battle_participants_diff CHECK (challenger_id != challenged_id)
);

CREATE INDEX idx_battles_challenger ON public.battles(challenger_id, status);
CREATE INDEX idx_battles_challenged ON public.battles(challenged_id, status);
CREATE INDEX idx_battles_status ON public.battles(status, match_deadline);

-- 3.6 User Presence Table (Peer Status with Expiry & Active Battle Pointer)
CREATE TABLE public.user_presence (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'in_battle', 'offline')),
    in_battle BOOLEAN DEFAULT false,
    active_battle_id UUID REFERENCES public.battles(id) ON DELETE SET NULL
);

CREATE INDEX idx_presence_last_seen ON public.user_presence(last_seen DESC);

-- 3.7 Battle Results Table (Submissions with Idempotency)
CREATE TABLE public.battle_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    problem_slug TEXT NOT NULL,
    leetcode_submission_id TEXT,
    accepted BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    time_taken_seconds INT NOT NULL DEFAULT 0,
    runtime_ms INT,
    memory_mb FLOAT,
    language TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 1,
    points INT NOT NULL DEFAULT 0 CHECK (points IN (0, 1)),
    CONSTRAINT uq_battle_submission_idempotency UNIQUE(battle_id, user_id, problem_slug, leetcode_submission_id)
);

CREATE UNIQUE INDEX uq_battle_accepted_solve 
ON public.battle_results(battle_id, user_id, problem_slug) 
WHERE accepted = TRUE;

CREATE INDEX idx_battle_results_lookup ON public.battle_results(battle_id, user_id);

-- 3.8 Battle Events Table (Durable Match Log)
CREATE TABLE public.battle_events (
    id BIGSERIAL PRIMARY KEY,
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'challenge_created', 'challenge_sent', 'challenge_accepted', 'challenge_declined',
            'problem_selected', 'ready_confirmed', 'countdown_started',
            'match_started', 'submission_attempt', 'problem_solved',
            'forfeited', 'match_finalized', 'cancelled'
        )
    ),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_battle_events_replay ON public.battle_events(battle_id, id ASC);

-- 3.9 Battle Problems Table (Dynamic & Synchronized Problem Sequence)
CREATE TABLE public.battle_problems (
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

CREATE INDEX idx_battle_problems_battle ON public.battle_problems(battle_id, sequence_number ASC);

-- 3.10 Battle Participants Table (Live Cursor & State)
CREATE TABLE public.battle_participants (
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

CREATE INDEX idx_battle_participants_battle ON public.battle_participants(battle_id);
CREATE INDEX idx_battle_participants_user ON public.battle_participants(user_id);

-- ============================================================================
-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_participants ENABLE ROW LEVEL SECURITY;

-- 4.1 Profiles
CREATE POLICY "profiles_select_public" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 4.2 User Settings (Private to Owner)
CREATE POLICY "settings_select_own" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "settings_insert_own" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "settings_update_own" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "settings_delete_own" ON public.user_settings FOR DELETE USING (auth.uid() = user_id);

-- 4.3 Friendships
CREATE POLICY "friendships_select_participants" ON public.friendships FOR SELECT 
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "friendships_insert_requester" ON public.friendships FOR INSERT 
WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "friendships_update_participants" ON public.friendships FOR UPDATE 
USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
WITH CHECK (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "friendships_delete_participants" ON public.friendships FOR DELETE 
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- 4.4 Roast Messages
CREATE POLICY "roasts_select_participants" ON public.roast_messages FOR SELECT 
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "roasts_insert_sender" ON public.roast_messages FOR INSERT 
WITH CHECK (
    auth.uid() = sender_id 
    AND sender_id != recipient_id
    AND EXISTS (
        SELECT 1 FROM public.friendships 
        WHERE status = 'accepted' 
        AND ((requester_id = auth.uid() AND addressee_id = recipient_id)
          OR (addressee_id = auth.uid() AND requester_id = recipient_id))
    )
);

CREATE POLICY "roasts_update_recipient" ON public.roast_messages FOR UPDATE 
USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

CREATE POLICY "roasts_delete_participants" ON public.roast_messages FOR DELETE 
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- 4.5 User Presence
CREATE POLICY "presence_select_authenticated" ON public.user_presence FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "presence_insert_own" ON public.user_presence FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "presence_update_own" ON public.user_presence FOR UPDATE 
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4.6 Battles
CREATE POLICY "battles_select_participants" ON public.battles FOR SELECT 
USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

CREATE POLICY "battles_insert_challenger" ON public.battles FOR INSERT 
WITH CHECK (auth.uid() = challenger_id AND challenger_id != challenged_id);

CREATE POLICY "battles_update_participants" ON public.battles FOR UPDATE 
USING (auth.uid() = challenger_id OR auth.uid() = challenged_id)
WITH CHECK (auth.uid() = challenger_id OR auth.uid() = challenged_id);

-- 4.7 Battle Results
CREATE POLICY "battle_results_select_participants" ON public.battle_results FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

CREATE POLICY "battle_results_insert_own" ON public.battle_results FOR INSERT 
WITH CHECK (
    auth.uid() = user_id 
    AND EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
        AND b.status IN ('in_progress', 'ready_check', 'countdown')
    )
);

-- 4.8 Battle Events
CREATE POLICY "battle_events_select_participants" ON public.battle_events FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

CREATE POLICY "battle_events_insert_participants" ON public.battle_events FOR INSERT 
WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

-- 4.9 Battle Problems
CREATE POLICY "battle_problems_select_participants" ON public.battle_problems FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

-- 4.10 Battle Participants
CREATE POLICY "battle_participants_select_participants" ON public.battle_participants FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

CREATE POLICY "battle_participants_insert_own" ON public.battle_participants FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "battle_participants_update_own" ON public.battle_participants FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 5. REPLICA IDENTITY & REALTIME PUBLICATION
-- ============================================================================

ALTER TABLE public.user_presence REPLICA IDENTITY FULL;
ALTER TABLE public.battles REPLICA IDENTITY FULL;
ALTER TABLE public.battle_events REPLICA IDENTITY FULL;
ALTER TABLE public.roast_messages REPLICA IDENTITY FULL;
ALTER TABLE public.friendships REPLICA IDENTITY FULL;
ALTER TABLE public.battle_problems REPLICA IDENTITY FULL;
ALTER TABLE public.battle_participants REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.battles;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_events;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.roast_messages;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_problems;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_participants;
    EXCEPTION WHEN duplicate_object THEN END;
END $$;

-- ============================================================================
-- 6. ATOMIC STORED PROCEDURES (SECURITY DEFINER)
-- ============================================================================

-- 6.1 HEARTBEAT PRESENCE
CREATE OR REPLACE FUNCTION public.heartbeat_presence(
    p_status TEXT DEFAULT 'online',
    p_username TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_username TEXT;
    v_now TIMESTAMPTZ := now();
    v_in_battle BOOLEAN := FALSE;
    v_active_battle_id UUID := NULL;
    v_effective_status TEXT := COALESCE(p_status, 'online');
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT leetcode_username INTO v_username
    FROM public.profiles
    WHERE id = v_user_id;

    IF v_username IS NULL THEN
        IF p_username IS NOT NULL AND length(trim(p_username)) > 0 THEN
            INSERT INTO public.profiles (
                id, leetcode_username, display_name, created_at, last_synced_at
            ) VALUES (
                v_user_id, LOWER(trim(p_username)), p_username, now(), now()
            )
            ON CONFLICT (id) DO UPDATE SET leetcode_username = EXCLUDED.leetcode_username, last_synced_at = now();
            v_username := LOWER(trim(p_username));
        ELSE
            RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
        END IF;
    END IF;

    SELECT id INTO v_active_battle_id
    FROM public.battles
    WHERE (challenger_id = v_user_id OR challenged_id = v_user_id)
      AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_active_battle_id IS NOT NULL THEN
        v_in_battle := TRUE;
        v_effective_status := 'in_battle';
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

-- 6.2 SET PRESENCE OFFLINE
CREATE OR REPLACE FUNCTION public.set_presence_offline()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    UPDATE public.user_presence
    SET status = 'offline',
        in_battle = FALSE,
        active_battle_id = NULL,
        last_seen = now() - interval '1 day'
    WHERE user_id = v_user_id;

    RETURN jsonb_build_object('success', true, 'status', 'offline');
END;
$$;

-- 6.3 ONLINE FRIEND DISCOVERY
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
    ORDER BY 
        CASE 
            WHEN up.last_seen >= v_stale_threshold AND fb.battle_id IS NULL THEN 1
            WHEN up.last_seen >= v_stale_threshold AND fb.battle_id IS NOT NULL THEN 2
            ELSE 3
        END,
        p.current_streak DESC;
END;
$$;

-- 6.4 GET FRIENDS PRESENCE MAP
CREATE OR REPLACE FUNCTION public.get_friends_presence(p_usernames TEXT[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_stale_threshold TIMESTAMPTZ := now() - interval '120 seconds';
    v_result JSONB := '{}'::jsonb;
    v_row RECORD;
BEGIN
    FOR v_row IN
        SELECT 
            p.leetcode_username,
            p.id AS user_id,
            up.last_seen,
            CASE
                WHEN up.last_seen IS NULL OR up.last_seen < v_stale_threshold THEN 'offline'
                WHEN b.id IS NOT NULL THEN 'in_battle'
                WHEN up.status = 'in_battle' THEN 'in_battle'
                ELSE 'online'
            END AS effective_status,
            (b.id IS NOT NULL) AS is_in_battle
        FROM public.profiles p
        LEFT JOIN public.user_presence up ON up.user_id = p.id
        LEFT JOIN public.battles b ON (
            (b.challenger_id = p.id OR b.challenged_id = p.id)
            AND b.status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
        )
        WHERE (p_usernames IS NULL OR LOWER(p.leetcode_username) = ANY(
            SELECT LOWER(u) FROM unnest(p_usernames) AS u
        ))
    LOOP
        v_result := v_result || jsonb_build_object(
            LOWER(v_row.leetcode_username),
            jsonb_build_object(
                'status', v_row.effective_status,
                'isOnline', (v_row.effective_status IN ('online', 'in_battle')),
                'inBattle', v_row.is_in_battle,
                'last_seen', v_row.last_seen
            )
        );
    END LOOP;

    RETURN v_result;
END;
$$;

-- 6.5 SYNC FRIENDSHIP
CREATE OR REPLACE FUNCTION public.sync_friendship(p_target_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_target_id UUID;
    v_existing RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT id INTO v_target_id
    FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(p_target_username);

    IF v_target_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target user profile not found on Supabase');
    END IF;

    IF v_target_id = v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot befriend yourself');
    END IF;

    SELECT * INTO v_existing
    FROM public.friendships
    WHERE (requester_id = v_user_id AND addressee_id = v_target_id)
       OR (requester_id = v_target_id AND addressee_id = v_user_id);

    IF FOUND THEN
        IF v_existing.status != 'accepted' THEN
            UPDATE public.friendships
            SET status = 'accepted', updated_at = now()
            WHERE id = v_existing.id;
        END IF;
        RETURN jsonb_build_object('success', true, 'status', 'accepted', 'friend_id', v_target_id);
    ELSE
        INSERT INTO public.friendships (requester_id, addressee_id, status)
        VALUES (v_user_id, v_target_id, 'accepted');
        RETURN jsonb_build_object('success', true, 'status', 'accepted', 'friend_id', v_target_id);
    END IF;
END;
$$;

-- 6.6 ATOMIC ROAST MESSAGING
CREATE OR REPLACE FUNCTION public.send_roast(p_recipient_username TEXT, p_content TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sender_id UUID := auth.uid();
    v_recipient_id UUID;
    v_sender_username TEXT;
    v_clean_content TEXT := trim(p_content);
    v_message_id UUID;
BEGIN
    IF v_sender_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required to send roasts');
    END IF;

    IF v_clean_content IS NULL OR length(v_clean_content) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Roast content cannot be empty');
    END IF;

    IF length(v_clean_content) > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Roast content exceeds 500 character limit');
    END IF;

    SELECT leetcode_username INTO v_sender_username
    FROM public.profiles
    WHERE id = v_sender_id;

    IF v_sender_username IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender profile not found');
    END IF;

    SELECT id INTO v_recipient_id
    FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(p_recipient_username);

    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient user profile not found');
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
        INSERT INTO public.friendships (requester_id, addressee_id, status)
        VALUES (v_sender_id, v_recipient_id, 'accepted')
        ON CONFLICT (requester_id, addressee_id)
        DO UPDATE SET status = 'accepted', updated_at = now();
    END IF;

    INSERT INTO public.roast_messages (
        sender_id,
        recipient_id,
        sender_username,
        recipient_username,
        content,
        status,
        created_at
    ) VALUES (
        v_sender_id,
        v_recipient_id,
        v_sender_username,
        LOWER(p_recipient_username),
        v_clean_content,
        'sent',
        now()
    )
    RETURNING id INTO v_message_id;

    RETURN jsonb_build_object(
        'success', true,
        'message_id', v_message_id,
        'sender_username', v_sender_username,
        'recipient_username', LOWER(p_recipient_username)
    );
END;
$$;

-- 6.7 ATOMIC BATTLE CHALLENGE
CREATE OR REPLACE FUNCTION public.create_battle_challenge(
    p_challenged_username TEXT, 
    p_language TEXT DEFAULT 'javascript',
    p_challenger_username TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_challenger_id UUID := auth.uid();
    v_challenged_id UUID;
    v_challenger_username TEXT;
    v_now TIMESTAMPTZ := now();
    v_expires_at TIMESTAMPTZ := now() + interval '24 hours';
    v_existing_battle RECORD;
    v_battle RECORD;
    v_language TEXT := LOWER(COALESCE(p_language, 'javascript'));
BEGIN
    IF v_challenger_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required to create a battle');
    END IF;

    SELECT leetcode_username INTO v_challenger_username
    FROM public.profiles
    WHERE id = v_challenger_id;

    -- If challenger profile is not yet in public.profiles, auto-provision it
    IF v_challenger_username IS NULL THEN
        IF p_challenger_username IS NOT NULL AND length(trim(p_challenger_username)) > 0 THEN
            INSERT INTO public.profiles (
                id, leetcode_username, display_name, created_at, last_synced_at
            ) VALUES (
                v_challenger_id, LOWER(trim(p_challenger_username)), p_challenger_username, now(), now()
            )
            ON CONFLICT (id) DO UPDATE SET leetcode_username = EXCLUDED.leetcode_username, last_synced_at = now();
            v_challenger_username := LOWER(trim(p_challenger_username));
        ELSE
            RETURN jsonb_build_object('success', false, 'error', 'Challenger profile not found');
        END IF;
    END IF;

    SELECT id INTO v_challenged_id
    FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(p_challenged_username);

    IF v_challenged_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Challenged user profile not found on Supabase');
    END IF;

    IF v_challenged_id = v_challenger_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot challenge yourself');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.friendships
        WHERE status = 'accepted'
          AND ((requester_id = v_challenger_id AND addressee_id = v_challenged_id)
            OR (requester_id = v_challenged_id AND addressee_id = v_challenger_id))
    ) THEN
        INSERT INTO public.friendships (requester_id, addressee_id, status)
        VALUES (v_challenger_id, v_challenged_id, 'accepted')
        ON CONFLICT (requester_id, addressee_id) 
        DO UPDATE SET status = 'accepted', updated_at = now();
    END IF;

    SELECT id, status INTO v_existing_battle
    FROM public.battles
    WHERE (challenger_id = v_challenger_id OR challenged_id = v_challenger_id)
      AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active battle in progress');
    END IF;

    SELECT id, status INTO v_existing_battle
    FROM public.battles
    WHERE (challenger_id = v_challenged_id OR challenged_id = v_challenged_id)
      AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', p_challenged_username || ' is already in another battle');
    END IF;

    INSERT INTO public.battles (
        challenger_id,
        challenged_id,
        challenger_username,
        challenged_username,
        language,
        status,
        expires_at,
        created_at
    ) VALUES (
        v_challenger_id,
        v_challenged_id,
        v_challenger_username,
        LOWER(p_challenged_username),
        v_language,
        'pending',
        v_expires_at,
        v_now
    )
    RETURNING * INTO v_battle;

    INSERT INTO public.battle_events (battle_id, event_type, actor_id, payload)
    VALUES (
        v_battle.id,
        'challenge_created',
        v_challenger_id,
        jsonb_build_object('language', v_language, 'challenged', p_challenged_username)
    );

    RETURN jsonb_build_object(
        'success', true,
        'battle', row_to_json(v_battle)
    );
END;
$$;

-- 6.8 GET ACCEPTED FRIENDS (Survives uninstall / reinstall)
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
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

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
        CASE 
            WHEN f.requester_id = v_user_id THEN f.addressee_id 
            ELSE f.requester_id 
        END
    )
    WHERE f.status = 'accepted'
      AND (f.requester_id = v_user_id OR f.addressee_id = v_user_id)
    ORDER BY p.leetcode_username ASC;
END;
$$;

-- 6.9 REMOVE FRIENDSHIP
CREATE OR REPLACE FUNCTION public.remove_friendship(p_target_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_target_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT id INTO v_target_id
    FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(p_target_username);

    IF v_target_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target user profile not found');
    END IF;

    DELETE FROM public.friendships
    WHERE (requester_id = v_user_id AND addressee_id = v_target_id)
       OR (requester_id = v_target_id AND addressee_id = v_user_id);

    RETURN jsonb_build_object('success', true, 'target_username', p_target_username);
END;
$$;

-- 6.10 GET OWN PROFILE
CREATE OR REPLACE FUNCTION public.get_own_profile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_profile RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

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

-- 6.11 RESTORE OR INIT PROFILE
CREATE OR REPLACE FUNCTION public.restore_or_init_profile(
    p_leetcode_username TEXT DEFAULT NULL,
    p_display_name TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_existing RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_existing
    FROM public.profiles
    WHERE id = v_user_id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'is_new', false,
            'profile', jsonb_build_object(
                'id', v_existing.id,
                'leetcode_username', v_existing.leetcode_username,
                'display_name', v_existing.display_name,
                'avatar_url', v_existing.avatar_url,
                'total_solved', v_existing.total_solved,
                'easy_solved', v_existing.easy_solved,
                'medium_solved', v_existing.medium_solved,
                'hard_solved', v_existing.hard_solved,
                'current_streak', v_existing.current_streak,
                'longest_streak', v_existing.longest_streak,
                'contest_rating', v_existing.contest_rating,
                'last_synced_at', v_existing.last_synced_at
            )
        );
    ELSE
        IF p_leetcode_username IS NULL OR trim(p_leetcode_username) = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'LeetCode username required for initial profile');
        END IF;

        INSERT INTO public.profiles (
            id,
            leetcode_username,
            display_name,
            avatar_url,
            created_at,
            last_synced_at
        ) VALUES (
            v_user_id,
            LOWER(trim(p_leetcode_username)),
            COALESCE(p_display_name, p_leetcode_username),
            COALESCE(p_avatar_url, ''),
            now(),
            now()
        );

        INSERT INTO public.user_settings (user_id)
        VALUES (v_user_id)
        ON CONFLICT (user_id) DO NOTHING;

        RETURN jsonb_build_object(
            'success', true,
            'is_new', true,
            'profile', jsonb_build_object(
                'id', v_user_id,
                'leetcode_username', LOWER(trim(p_leetcode_username)),
                'display_name', COALESCE(p_display_name, p_leetcode_username),
                'avatar_url', COALESCE(p_avatar_url, '')
            )
        );
    END IF;
END;
$$;

-- 6.12 CREATE BATTLE V2 (Topic & Difficulty Selection)
CREATE OR REPLACE FUNCTION public.create_battle_v2(
    p_challenged_username  TEXT,
    p_topics               TEXT[]      DEFAULT NULL,
    p_difficulty           TEXT        DEFAULT 'Medium',
    p_duration_minutes     INT         DEFAULT 30,
    p_problem_count        INT         DEFAULT 5,
    p_language             TEXT        DEFAULT 'javascript',
    p_challenger_username  TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_challenger_id    UUID := auth.uid();
    v_challenged_id    UUID;
    v_challenger_username TEXT;
    v_now              TIMESTAMPTZ := now();
    v_expires_at       TIMESTAMPTZ := now() + interval '24 hours';
    v_existing_battle  RECORD;
    v_battle           RECORD;
    v_language         TEXT := LOWER(COALESCE(p_language, 'javascript'));
BEGIN
    IF v_challenger_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT leetcode_username INTO v_challenger_username
    FROM public.profiles WHERE id = v_challenger_id;

    IF v_challenger_username IS NULL THEN
        IF p_challenger_username IS NOT NULL AND length(trim(p_challenger_username)) > 0 THEN
            INSERT INTO public.profiles (id, leetcode_username, display_name, created_at, last_synced_at)
            VALUES (v_challenger_id, LOWER(trim(p_challenger_username)), p_challenger_username, now(), now())
            ON CONFLICT (id) DO UPDATE SET leetcode_username = EXCLUDED.leetcode_username, last_synced_at = now();
            v_challenger_username := LOWER(trim(p_challenger_username));
        ELSE
            RETURN jsonb_build_object('success', false, 'error', 'Challenger profile not found');
        END IF;
    END IF;

    SELECT id INTO v_challenged_id
    FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(p_challenged_username);

    IF v_challenged_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Challenged user not found. They must have a LeetStreak account.');
    END IF;

    IF v_challenged_id = v_challenger_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot challenge yourself');
    END IF;

    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (v_challenger_id, v_challenged_id, 'accepted')
    ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted', updated_at = now();

    SELECT id INTO v_existing_battle
    FROM public.battles
    WHERE (challenger_id = v_challenger_id OR challenged_id = v_challenger_id)
      AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active battle in progress');
    END IF;

    SELECT id INTO v_existing_battle
    FROM public.battles
    WHERE (challenger_id = v_challenged_id OR challenged_id = v_challenged_id)
      AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', p_challenged_username || ' is already in another battle');
    END IF;

    INSERT INTO public.battles (
        challenger_id, challenged_id, challenger_username, challenged_username,
        language, status, topics, difficulty, duration_minutes, problem_count,
        expires_at, created_at
    ) VALUES (
        v_challenger_id, v_challenged_id, v_challenger_username, LOWER(p_challenged_username),
        v_language, 'pending',
        COALESCE(p_topics, ARRAY['Arrays', 'Strings']),
        COALESCE(p_difficulty, 'Medium'),
        COALESCE(p_duration_minutes, 30),
        COALESCE(p_problem_count, 5),
        v_expires_at, v_now
    )
    RETURNING * INTO v_battle;

    INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
    VALUES (
        v_battle.id, v_challenger_id, 'challenge_created',
        jsonb_build_object(
            'language', v_language,
            'challenged', LOWER(p_challenged_username),
            'topics', COALESCE(p_topics, ARRAY['Arrays', 'Strings']),
            'difficulty', COALESCE(p_difficulty, 'Medium')
        )
    );

    RETURN jsonb_build_object('success', true, 'battle', row_to_json(v_battle));
END;
$$;

-- 6.13 ACCEPT BATTLE V2
CREATE OR REPLACE FUNCTION public.accept_battle_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id  UUID := auth.uid();
    v_battle   RECORD;
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

-- 6.14 CONFIRM READY V2 (Atomic Shared Problem Generation & Start)
CREATE OR REPLACE FUNCTION public.confirm_ready_v2(
    p_battle_id UUID,
    p_problems  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id      UUID := auth.uid();
    v_battle       RECORD;
    v_my_ready     BOOLEAN;
    v_other_ready  BOOLEAN;
    v_problem      JSONB;
    v_seq          INT := 1;
    v_start_at     TIMESTAMPTZ;
    v_end_at       TIMESTAMPTZ;
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
        v_end_at   := v_start_at + (v_battle.duration_minutes * interval '1 minute');

        UPDATE public.battles
        SET
            status           = 'countdown',
            match_starts_at  = v_start_at,
            match_deadline   = v_end_at,
            start_at         = v_start_at,
            end_at           = v_end_at,
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

-- 6.15 RECORD BATTLE SOLVE (Idempotent Solve & Cursor Progression)
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
SET search_path = public
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
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
    END IF;

    IF v_battle.status NOT IN ('in_progress', 'countdown') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle is not active');
    END IF;

    SELECT * INTO v_participant
    FROM public.battle_participants
    WHERE battle_id = p_battle_id AND user_id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not a participant');
    END IF;

    SELECT leetcode_username INTO v_username FROM public.profiles WHERE id = v_user_id;

    SELECT * INTO v_problem
    FROM public.battle_problems
    WHERE battle_id = p_battle_id AND problem_slug = p_problem_slug;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Problem not in this battle');
    END IF;

    INSERT INTO public.battle_results (
        battle_id, user_id, username, problem_slug,
        leetcode_submission_id, accepted, submitted_at,
        time_taken_seconds, runtime_ms, memory_mb, language,
        attempts, points
    ) VALUES (
        p_battle_id, v_user_id, v_username, p_problem_slug,
        COALESCE(p_submission_id, 'sub_' || extract(epoch from now())::TEXT),
        true, now(),
        COALESCE(p_time_taken_ms / 1000, 0)::INT,
        p_runtime_ms, p_memory_mb,
        COALESCE(p_language, v_battle.language, 'javascript'),
        1, 1
    )
    ON CONFLICT ON CONSTRAINT uq_battle_accepted_solve DO NOTHING;

    IF FOUND THEN
        UPDATE public.battle_participants
        SET
            current_problem_index = GREATEST(current_problem_index, v_problem.sequence_number),
            solved_count          = solved_count + 1,
            total_time_ms         = total_time_ms + COALESCE(p_time_taken_ms, 0)
        WHERE battle_id = p_battle_id AND user_id = v_user_id
        RETURNING * INTO v_participant;
    ELSE
        SELECT * INTO v_participant
        FROM public.battle_participants
        WHERE battle_id = p_battle_id AND user_id = v_user_id;
    END IF;

    SELECT COUNT(*) INTO v_total_problems FROM public.battle_problems WHERE battle_id = p_battle_id;

    SELECT bp.* INTO v_next_problem
    FROM public.battle_problems bp
    WHERE bp.battle_id = p_battle_id
      AND bp.sequence_number > v_problem.sequence_number
      AND NOT EXISTS (
          SELECT 1 FROM public.battle_results br
          WHERE br.battle_id = p_battle_id
            AND br.user_id = v_user_id
            AND br.problem_slug = bp.problem_slug
            AND br.accepted = true
      )
    ORDER BY bp.sequence_number ASC
    LIMIT 1;

    INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 'problem_solved', jsonb_build_object(
        'problem_slug', p_problem_slug,
        'sequence_number', v_problem.sequence_number,
        'solved_count', v_participant.solved_count
    ));

    SELECT COUNT(*) INTO v_my_solved
    FROM public.battle_results
    WHERE battle_id = p_battle_id AND user_id = v_user_id AND accepted = true;

    SELECT COUNT(*) INTO v_opp_solved
    FROM public.battle_results br
    JOIN public.battle_participants bp ON (br.battle_id = bp.battle_id AND br.user_id = bp.user_id)
    WHERE br.battle_id = p_battle_id
      AND br.user_id != v_user_id
      AND br.accepted = true;

    IF v_my_solved >= v_total_problems AND v_opp_solved >= v_total_problems THEN
        PERFORM public._finalize_battle(p_battle_id);
    ELSIF v_battle.end_at IS NOT NULL AND now() >= v_battle.end_at THEN
        PERFORM public._finalize_battle(p_battle_id);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'solved_count', v_participant.solved_count,
        'total_problems', v_total_problems,
        'next_problem_slug', v_next_problem.problem_slug,
        'next_problem_title', v_next_problem.problem_title,
        'next_problem_url', v_next_problem.problem_url,
        'battle_complete', (v_next_problem.problem_slug IS NULL)
    );
END;
$$;

-- 6.16 FINALIZE BATTLE HELPER
CREATE OR REPLACE FUNCTION public._finalize_battle(p_battle_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_battle       RECORD;
    v_challenger   RECORD;
    v_challenged   RECORD;
    v_winner       TEXT;
    v_win_reason   TEXT;
BEGIN
    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
    IF NOT FOUND OR v_battle.status IN ('completed', 'forfeited', 'cancelled', 'expired', 'declined') THEN
        RETURN;
    END IF;

    SELECT solved_count, total_time_ms INTO v_challenger
    FROM public.battle_participants
    WHERE battle_id = p_battle_id AND user_id = v_battle.challenger_id;

    SELECT solved_count, total_time_ms INTO v_challenged
    FROM public.battle_participants
    WHERE battle_id = p_battle_id AND user_id = v_battle.challenged_id;

    IF v_challenger.solved_count > v_challenged.solved_count THEN
        v_winner := v_battle.challenger_username;
        v_win_reason := 'points';
    ELSIF v_challenged.solved_count > v_challenger.solved_count THEN
        v_winner := v_battle.challenged_username;
        v_win_reason := 'points';
    ELSIF v_challenger.solved_count > 0 THEN
        IF v_challenger.total_time_ms < v_challenged.total_time_ms THEN
            v_winner := v_battle.challenger_username;
            v_win_reason := 'tiebreaker_time';
        ELSIF v_challenged.total_time_ms < v_challenger.total_time_ms THEN
            v_winner := v_battle.challenged_username;
            v_win_reason := 'tiebreaker_time';
        ELSE
            v_winner := 'draw';
            v_win_reason := 'draw';
        END IF;
    ELSE
        v_winner := 'draw';
        v_win_reason := 'draw';
    END IF;

    UPDATE public.battles
    SET
        status           = 'completed',
        winner_username  = v_winner,
        win_reason       = v_win_reason,
        completed_at     = now()
    WHERE id = p_battle_id;

    INSERT INTO public.battle_events (battle_id, event_type, payload)
    VALUES (p_battle_id, 'match_finalized', jsonb_build_object(
        'winner', v_winner,
        'win_reason', v_win_reason
    ));
END;
$$;

-- 6.17 GET BATTLE STATE V2 (Reconnection & Active View)
CREATE OR REPLACE FUNCTION public.get_battle_state_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id      UUID := auth.uid();
    v_battle       RECORD;
    v_problems     JSONB;
    v_participants JSONB;
    v_results      JSONB;
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

-- 6.18 FORFEIT BATTLE V2
CREATE OR REPLACE FUNCTION public.forfeit_battle_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id  UUID := auth.uid();
    v_battle   RECORD;
    v_winner   TEXT;
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

-- 6.19 CONFIRM BATTLE READY (Back-Compat Shim)
CREATE OR REPLACE FUNCTION public.confirm_battle_ready(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_battle     RECORD;
    v_is_challenger BOOLEAN;
    v_my_ready   BOOLEAN;
    v_opp_ready  BOOLEAN;
    v_start_at   TIMESTAMPTZ;
    v_end_at     TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle not found');
    END IF;

    IF v_battle.status NOT IN ('ready_check', 'accepted', 'selecting') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Battle is not in ready_check state');
    END IF;

    v_is_challenger := (v_battle.challenger_id = v_user_id);

    IF v_is_challenger THEN
        UPDATE public.battles SET challenger_ready = true WHERE id = p_battle_id;
        v_my_ready  := true;
        v_opp_ready := v_battle.challenged_ready;
    ELSE
        UPDATE public.battles SET challenged_ready = true WHERE id = p_battle_id;
        v_my_ready  := true;
        v_opp_ready := v_battle.challenger_ready;
    END IF;

    INSERT INTO public.battle_participants (battle_id, user_id, username, is_ready, ready_at)
    VALUES (p_battle_id, v_user_id,
        CASE WHEN v_is_challenger THEN v_battle.challenger_username ELSE v_battle.challenged_username END,
        true, now())
    ON CONFLICT (battle_id, user_id) DO UPDATE SET is_ready = true, ready_at = now();

    IF v_my_ready AND v_opp_ready THEN
        v_start_at := now() + interval '10 seconds';
        v_end_at   := v_start_at + (COALESCE(v_battle.duration_minutes, 30) * interval '1 minute');

        UPDATE public.battles
        SET status = 'countdown',
            match_starts_at  = v_start_at,
            match_deadline   = v_end_at,
            start_at         = v_start_at,
            end_at           = v_end_at,
            countdown_starts = now()
        WHERE id = p_battle_id;

        SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
        RETURN jsonb_build_object('success', true, 'status', 'countdown', 'battle', row_to_json(v_battle));
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
    RETURN jsonb_build_object('success', true, 'status', v_battle.status, 'battle', row_to_json(v_battle));
END;
$$;

-- Demo user "joy" presence guarantee
INSERT INTO public.user_presence (user_id, username, last_seen, status, in_battle)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'joy',
    now() + interval '10 years',
    'online',
    false
)
ON CONFLICT (user_id) DO UPDATE SET
    last_seen = now() + interval '10 years',
    status    = 'online',
    in_battle = false;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;

-- 7. NOTIFY POSTGREST TO RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
