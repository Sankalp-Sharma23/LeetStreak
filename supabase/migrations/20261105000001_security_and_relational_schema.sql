-- ============================================================================
-- Migration: 20261105000001_security_and_relational_schema.sql
-- Description: Establishes normalized relational schema with strict Row-Level
--              Security (RLS), identity binding, and atomic SECURITY DEFINER
--              RPC functions for LeetStreak.
-- Author: Principal Architect
-- Platform: Supabase PostgreSQL (Postgres 15+)
-- ============================================================================

-- Enable required cryptographic and UUID extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. SCHEMAS AND TABLES
-- ============================================================================

-- 1.1 Public Profiles Table (Public Profile Information linked to auth.users)
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

-- Case-insensitive unique index on leetcode_username
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_lower_username 
ON public.profiles(LOWER(leetcode_username));

CREATE INDEX IF NOT EXISTS idx_profiles_total_solved ON public.profiles(total_solved DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_streak ON public.profiles(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_rating ON public.profiles(contest_rating DESC);

-- 1.2 User Settings Table (Strictly Private to Owner)
CREATE TABLE IF NOT EXISTS public.user_settings (
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

-- 1.3 Friendships Table (Normalized Social Graph)
CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_friendship_pair UNIQUE (requester_id, addressee_id),
    CONSTRAINT chk_friendship_not_self CHECK (requester_id != addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id, status);

-- 1.4 Roast Messages Table (Durable Recipient Delivery)
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

-- 1.5 User Presence Table (Peer Status with Expiry)
CREATE TABLE IF NOT EXISTS public.user_presence (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'in_battle', 'offline'))
);

CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON public.user_presence(last_seen DESC);

-- 1.6 Battles Table (Canonical 1v1 Arena)
-- Canonical status values:
-- 'pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress', 'completed', 'declined', 'expired', 'cancelled', 'forfeited'
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
    winner_username TEXT, -- username or 'draw'
    win_reason TEXT, -- 'points', 'tiebreaker_time', 'forfeit', 'timeout', 'draw'
    CONSTRAINT chk_battle_status CHECK (
        status IN (
            'pending', 'accepted', 'selecting', 'ready_check',
            'countdown', 'in_progress', 'completed',
            'declined', 'expired', 'cancelled', 'forfeited'
        )
    ),
    CONSTRAINT chk_battle_participants_diff CHECK (challenger_id != challenged_id)
);

CREATE INDEX IF NOT EXISTS idx_battles_challenger ON public.battles(challenger_id, status);
CREATE INDEX IF NOT EXISTS idx_battles_challenged ON public.battles(challenged_id, status);
CREATE INDEX IF NOT EXISTS idx_battles_status ON public.battles(status, match_deadline);

-- 1.7 Battle Results Table (Submissions with Idempotency)
CREATE TABLE IF NOT EXISTS public.battle_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    problem_slug TEXT NOT NULL,
    leetcode_submission_id TEXT, -- external idempotency identifier
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

-- Unique index ensuring maximum 1 accepted record per problem per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_battle_accepted_solve 
ON public.battle_results(battle_id, user_id, problem_slug) 
WHERE accepted = TRUE;

CREATE INDEX IF NOT EXISTS idx_battle_results_lookup ON public.battle_results(battle_id, user_id);

-- 1.8 Battle Events Table (Durable Log for Reconnection & Reconciliation)
CREATE TABLE IF NOT EXISTS public.battle_events (
    id BIGSERIAL PRIMARY KEY,
    battle_id UUID NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'challenge_sent', 'challenge_accepted', 'challenge_declined',
            'problem_selected', 'ready_confirmed', 'countdown_started',
            'match_started', 'submission_attempt', 'problem_solved',
            'forfeited', 'match_finalized', 'cancelled'
        )
    ),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_battle_events_replay ON public.battle_events(battle_id, id ASC);

-- ============================================================================
-- 2. ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_events ENABLE ROW LEVEL SECURITY;

-- 2.1 Profiles RLS:
CREATE POLICY "profiles_select_public" 
ON public.profiles FOR SELECT 
USING (true);

CREATE POLICY "profiles_insert_own" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id) 
WITH CHECK (auth.uid() = id);

-- 2.2 User Settings RLS (STRICTLY OWNER ONLY):
CREATE POLICY "settings_select_own" 
ON public.user_settings FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "settings_insert_own" 
ON public.user_settings FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_update_own" 
ON public.user_settings FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_delete_own" 
ON public.user_settings FOR DELETE 
USING (auth.uid() = user_id);

-- 2.3 Friendships RLS:
CREATE POLICY "friendships_select_participants" 
ON public.friendships FOR SELECT 
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "friendships_insert_requester" 
ON public.friendships FOR INSERT 
WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "friendships_update_participants" 
ON public.friendships FOR UPDATE 
USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
WITH CHECK (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "friendships_delete_participants" 
ON public.friendships FOR DELETE 
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- 2.4 Roast Messages RLS:
CREATE POLICY "roasts_select_participants" 
ON public.roast_messages FOR SELECT 
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "roasts_insert_sender" 
ON public.roast_messages FOR INSERT 
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

CREATE POLICY "roasts_update_recipient" 
ON public.roast_messages FOR UPDATE 
USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);

CREATE POLICY "roasts_delete_participants" 
ON public.roast_messages FOR DELETE 
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- 2.5 User Presence RLS:
CREATE POLICY "presence_select_authenticated" 
ON public.user_presence FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "presence_insert_own" 
ON public.user_presence FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "presence_update_own" 
ON public.user_presence FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2.6 Battles RLS:
CREATE POLICY "battles_select_participants" 
ON public.battles FOR SELECT 
USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

CREATE POLICY "battles_insert_challenger" 
ON public.battles FOR INSERT 
WITH CHECK (auth.uid() = challenger_id AND challenger_id != challenged_id);

CREATE POLICY "battles_update_participants" 
ON public.battles FOR UPDATE 
USING (auth.uid() = challenger_id OR auth.uid() = challenged_id)
WITH CHECK (
    (auth.uid() = challenger_id OR auth.uid() = challenged_id)
    -- Disallow raw client updates from declaring themselves winner
    AND (winner_id IS NOT DISTINCT FROM (SELECT b.winner_id FROM public.battles b WHERE b.id = battles.id))
);

-- 2.7 Battle Results RLS:
CREATE POLICY "battle_results_select_participants" 
ON public.battle_results FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

CREATE POLICY "battle_results_insert_own" 
ON public.battle_results FOR INSERT 
WITH CHECK (
    auth.uid() = user_id 
    AND EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
        AND b.status IN ('in_progress', 'ready_check', 'countdown')
    )
);

-- 2.8 Battle Events RLS:
CREATE POLICY "battle_events_select_participants" 
ON public.battle_events FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

CREATE POLICY "battle_events_insert_participants" 
ON public.battle_events FOR INSERT 
WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.battles b 
        WHERE b.id = battle_id 
        AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

-- ============================================================================
-- 3. ATOMIC SECURITY DEFINER RPC FUNCTIONS
-- ============================================================================

-- Function: Clean stale presence records (> 15 minutes inactive)
CREATE OR REPLACE FUNCTION public.clean_stale_presence()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM public.user_presence
    WHERE last_seen < (now() - interval '15 minutes');
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Function: Atomic Battle Readiness Confirmation
CREATE OR REPLACE FUNCTION public.confirm_battle_ready(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_battle RECORD;
    v_is_challenger BOOLEAN;
    v_other_ready BOOLEAN;
    v_now TIMESTAMPTZ := now();
    v_countdown_starts TIMESTAMPTZ;
    v_match_starts_at TIMESTAMPTZ;
    v_match_deadline TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not authenticated';
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Battle not found';
    END IF;

    IF v_battle.status != 'ready_check' AND v_battle.status != 'selecting' THEN
        RAISE EXCEPTION 'Battle is not awaiting readiness confirmation (current status: %)', v_battle.status;
    END IF;

    IF v_battle.challenger_id = v_user_id THEN
        v_is_challenger := TRUE;
        v_other_ready := v_battle.challenged_ready;
    ELSIF v_battle.challenged_id = v_user_id THEN
        v_is_challenger := FALSE;
        v_other_ready := v_battle.challenger_ready;
    ELSE
        RAISE EXCEPTION 'Forbidden: User is not a participant in this battle';
    END IF;

    -- Update readiness flag
    IF v_is_challenger THEN
        UPDATE public.battles SET challenger_ready = TRUE WHERE id = p_battle_id;
    ELSE
        UPDATE public.battles SET challenged_ready = TRUE WHERE id = p_battle_id;
    END IF;

    -- If both are now ready, advance to countdown and establish official timestamps
    IF v_other_ready THEN
        v_countdown_starts := v_now;
        v_match_starts_at := v_now + interval '10 seconds';
        v_match_deadline := v_now + interval '10 seconds' + interval '2 hours';

        UPDATE public.battles
        SET status = 'countdown',
            countdown_starts = v_countdown_starts,
            match_starts_at = v_match_starts_at,
            match_deadline = v_match_deadline
        WHERE id = p_battle_id;

        INSERT INTO public.battle_events (battle_id, user_id, event_type, payload)
        VALUES (p_battle_id, v_user_id, 'countdown_started', jsonb_build_object(
            'countdown_starts', v_countdown_starts,
            'match_starts_at', v_match_starts_at,
            'match_deadline', v_match_deadline
        ));

        RETURN jsonb_build_object(
            'success', true,
            'status', 'countdown',
            'countdown_starts', v_countdown_starts,
            'match_starts_at', v_match_starts_at,
            'match_deadline', v_match_deadline
        );
    ELSE
        INSERT INTO public.battle_events (battle_id, user_id, event_type, payload)
        VALUES (p_battle_id, v_user_id, 'ready_confirmed', jsonb_build_object('user_id', v_user_id));

        RETURN jsonb_build_object(
            'success', true,
            'status', 'ready_check',
            'waiting_for_peer', true
        );
    END IF;
END;
$$;

-- Function: Atomic Battle Submission & Verification
CREATE OR REPLACE FUNCTION public.record_battle_submission(
    p_battle_id UUID,
    p_problem_slug TEXT,
    p_submission_id TEXT,
    p_accepted BOOLEAN,
    p_time_taken INT,
    p_runtime_ms INT,
    p_memory_mb FLOAT,
    p_language TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_username TEXT;
    v_battle RECORD;
    v_now TIMESTAMPTZ := now();
    v_points INT := 0;
    v_already_solved BOOLEAN;
    v_result_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not authenticated';
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Battle not found';
    END IF;

    IF v_battle.challenger_id = v_user_id THEN
        v_username := v_battle.challenger_username;
    ELSIF v_battle.challenged_id = v_user_id THEN
        v_username := v_battle.challenged_username;
    ELSE
        RAISE EXCEPTION 'Forbidden: User is not a participant';
    END IF;

    -- Validate match is in active state
    IF v_battle.status = 'countdown' AND v_now >= v_battle.match_starts_at THEN
        UPDATE public.battles SET status = 'in_progress' WHERE id = p_battle_id;
        v_battle.status := 'in_progress';
    END IF;

    IF v_battle.status != 'in_progress' THEN
        RAISE EXCEPTION 'Submissions rejected: battle is not in progress (status: %)', v_battle.status;
    END IF;

    IF v_battle.match_deadline IS NOT NULL AND v_now > v_battle.match_deadline THEN
        RAISE EXCEPTION 'Submissions rejected: match deadline has passed';
    END IF;

    -- Check if problem belongs to this battle
    IF LOWER(p_problem_slug) != LOWER(v_battle.problem_1) AND LOWER(p_problem_slug) != LOWER(v_battle.problem_2) THEN
        RAISE EXCEPTION 'Invalid problem: % is not part of this battle', p_problem_slug;
    END IF;

    -- Check if already solved previously by this user in this battle
    SELECT EXISTS (
        SELECT 1 FROM public.battle_results 
        WHERE battle_id = p_battle_id 
        AND user_id = v_user_id 
        AND LOWER(problem_slug) = LOWER(p_problem_slug) 
        AND accepted = TRUE
    ) INTO v_already_solved;

    IF p_accepted AND NOT v_already_solved THEN
        v_points := 1;
    ELSE
        v_points := 0;
    END IF;

    -- Insert record with idempotency
    INSERT INTO public.battle_results (
        battle_id, user_id, username, problem_slug, leetcode_submission_id,
        accepted, submitted_at, time_taken_seconds, runtime_ms, memory_mb,
        language, attempts, points
    ) VALUES (
        p_battle_id, v_user_id, v_username, LOWER(p_problem_slug), p_submission_id,
        p_accepted, v_now, COALESCE(p_time_taken, 0), p_runtime_ms, p_memory_mb,
        COALESCE(p_language, v_battle.language), 1, v_points
    )
    ON CONFLICT (battle_id, user_id, problem_slug, leetcode_submission_id)
    DO NOTHING
    RETURNING id INTO v_result_id;

    -- Record durable event
    INSERT INTO public.battle_events (battle_id, user_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 
            CASE WHEN p_accepted THEN 'problem_solved' ELSE 'submission_attempt' END, 
            jsonb_build_object(
                'problem_slug', p_problem_slug,
                'accepted', p_accepted,
                'points_awarded', v_points,
                'time_taken', p_time_taken
            )
    );

    -- Check if match should be finalized
    PERFORM public.evaluate_and_finalize_battle(p_battle_id);

    RETURN jsonb_build_object(
        'success', true,
        'points_awarded', v_points,
        'already_solved', v_already_solved,
        'accepted', p_accepted
    );
END;
$$;

-- Function: Authoritative Match Finalization & Winner Determination
CREATE OR REPLACE FUNCTION public.evaluate_and_finalize_battle(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_battle RECORD;
    v_p1_solved_a BOOLEAN := FALSE;
    v_p2_solved_a BOOLEAN := FALSE;
    v_p1_solved_b BOOLEAN := FALSE;
    v_p2_solved_b BOOLEAN := FALSE;
    v_score_a INT := 0;
    v_score_b INT := 0;
    v_time_a INT := 0;
    v_time_b INT := 0;
    v_now TIMESTAMPTZ := now();
    v_winner_id UUID := NULL;
    v_winner_username TEXT := 'draw';
    v_reason TEXT := 'draw';
    v_both_finished BOOLEAN;
    v_timed_out BOOLEAN;
BEGIN
    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND OR v_battle.status IN ('completed', 'cancelled', 'forfeited', 'declined', 'expired') THEN
        RETURN jsonb_build_object('finalized', false, 'reason', 'Already concluded');
    END IF;

    -- Calculate scores & completion times
    SELECT 
        COALESCE(SUM(points), 0),
        COALESCE(SUM(time_taken_seconds), 0),
        BOOL_OR(LOWER(problem_slug) = LOWER(v_battle.problem_1) AND accepted),
        BOOL_OR(LOWER(problem_slug) = LOWER(v_battle.problem_2) AND accepted)
    INTO v_score_a, v_time_a, v_p1_solved_a, v_p2_solved_a
    FROM public.battle_results
    WHERE battle_id = p_battle_id AND user_id = v_battle.challenger_id AND accepted = TRUE;

    SELECT 
        COALESCE(SUM(points), 0),
        COALESCE(SUM(time_taken_seconds), 0),
        BOOL_OR(LOWER(problem_slug) = LOWER(v_battle.problem_1) AND accepted),
        BOOL_OR(LOWER(problem_slug) = LOWER(v_battle.problem_2) AND accepted)
    INTO v_score_b, v_time_b, v_p1_solved_b, v_p2_solved_b
    FROM public.battle_results
    WHERE battle_id = p_battle_id AND user_id = v_battle.challenged_id AND accepted = TRUE;

    v_both_finished := (COALESCE(v_p1_solved_a, false) AND COALESCE(v_p2_solved_a, false)) 
                   AND (COALESCE(v_p1_solved_b, false) AND COALESCE(v_p2_solved_b, false));
    v_timed_out := v_battle.match_deadline IS NOT NULL AND v_now >= v_battle.match_deadline;

    -- Finalize if both completed or match deadline expired
    IF v_both_finished OR v_timed_out THEN
        IF v_score_a > v_score_b THEN
            v_winner_id := v_battle.challenger_id;
            v_winner_username := v_battle.challenger_username;
            v_reason := 'points';
        ELSIF v_score_b > v_score_a THEN
            v_winner_id := v_battle.challenged_id;
            v_winner_username := v_battle.challenged_username;
            v_reason := 'points';
        ELSE
            -- Points tie: compare total accepted time
            IF v_score_a > 0 THEN
                IF v_time_a < v_time_b THEN
                    v_winner_id := v_battle.challenger_id;
                    v_winner_username := v_battle.challenger_username;
                    v_reason := 'tiebreaker_time';
                ELSIF v_time_b < v_time_a THEN
                    v_winner_id := v_battle.challenged_id;
                    v_winner_username := v_battle.challenged_username;
                    v_reason := 'tiebreaker_time';
                ELSE
                    v_winner_id := NULL;
                    v_winner_username := 'draw';
                    v_reason := 'draw';
                END IF;
            ELSE
                v_winner_id := NULL;
                v_winner_username := 'draw';
                v_reason := 'draw';
            END IF;
        END IF;

        UPDATE public.battles
        SET status = 'completed',
            completed_at = v_now,
            winner_id = v_winner_id,
            winner_username = v_winner_username,
            win_reason = v_reason
        WHERE id = p_battle_id;

        INSERT INTO public.battle_events (battle_id, event_type, payload)
        VALUES (p_battle_id, 'match_finalized', jsonb_build_object(
            'winner_id', v_winner_id,
            'winner_username', v_winner_username,
            'win_reason', v_reason,
            'score_a', v_score_a,
            'score_b', v_score_b,
            'time_a', v_time_a,
            'time_b', v_time_b
        ));

        RETURN jsonb_build_object(
            'finalized', true,
            'winner', v_winner_username,
            'reason', v_reason
        );
    END IF;

    RETURN jsonb_build_object('finalized', false, 'status', v_battle.status);
END;
$$;

-- Function: Forfeit Active Battle
CREATE OR REPLACE FUNCTION public.forfeit_battle(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_battle RECORD;
    v_winner_id UUID;
    v_winner_username TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not authenticated';
    END IF;

    SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Battle not found';
    END IF;

    IF v_battle.status IN ('completed', 'cancelled', 'forfeited', 'declined', 'expired') THEN
        RAISE EXCEPTION 'Cannot forfeit: battle is already concluded (%)', v_battle.status;
    END IF;

    IF v_battle.challenger_id = v_user_id THEN
        v_winner_id := v_battle.challenged_id;
        v_winner_username := v_battle.challenged_username;
    ELSIF v_battle.challenged_id = v_user_id THEN
        v_winner_id := v_battle.challenger_id;
        v_winner_username := v_battle.challenger_username;
    ELSE
        RAISE EXCEPTION 'Forbidden: User is not a participant';
    END IF;

    UPDATE public.battles
    SET status = 'forfeited',
        completed_at = now(),
        winner_id = v_winner_id,
        winner_username = v_winner_username,
        win_reason = 'forfeit'
    WHERE id = p_battle_id;

    INSERT INTO public.battle_events (battle_id, user_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 'forfeited', jsonb_build_object(
        'forfeited_by', v_user_id,
        'winner_id', v_winner_id,
        'winner_username', v_winner_username
    ));

    RETURN jsonb_build_object('success', true, 'winner', v_winner_username);
END;
$$;

