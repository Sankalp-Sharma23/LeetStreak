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

-- ============================================================================
-- 5. REPLICA IDENTITY & REALTIME PUBLICATION
-- ============================================================================

ALTER TABLE public.user_presence REPLICA IDENTITY FULL;
ALTER TABLE public.battles REPLICA IDENTITY FULL;
ALTER TABLE public.battle_events REPLICA IDENTITY FULL;
ALTER TABLE public.roast_messages REPLICA IDENTITY FULL;
ALTER TABLE public.friendships REPLICA IDENTITY FULL;

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
END $$;

-- ============================================================================
-- 6. ATOMIC STORED PROCEDURES (SECURITY DEFINER)
-- ============================================================================

-- 6.1 HEARTBEAT PRESENCE
CREATE OR REPLACE FUNCTION public.heartbeat_presence(p_status TEXT DEFAULT 'online')
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
        RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
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
    p_language TEXT DEFAULT 'javascript'
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

    IF v_challenger_username IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Challenger profile not found');
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

-- 7. NOTIFY POSTGREST TO RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
