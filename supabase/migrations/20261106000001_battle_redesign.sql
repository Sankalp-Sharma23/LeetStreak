-- ============================================================================
-- LEETSTREAK BATTLE REDESIGN — ADDITIVE MIGRATION
-- Run this AFTER the base RUN_IN_SUPABASE_DASHBOARD.sql, or as a standalone
-- migration on a fresh database that already has the base schema.
--
-- What this migration does:
-- 1. Adds columns to `battles` table for topic/difficulty selection
-- 2. Creates `battle_problems` table for dynamic problem sequences
-- 3. Creates `battle_participants` table for per-player progress tracking
-- 4. Adds new atomic RPCs: create_battle_v2, accept_battle_v2,
--    start_battle_v2, record_battle_solve, get_battle_state_v2
-- 5. Adds actor_id column to battle_events (back-compat shim)
-- 6. Preserves all existing data and functionality
-- ============================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ALTER battles TABLE — add new columns
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.battles
  ADD COLUMN IF NOT EXISTS topics         TEXT[]      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS difficulty     TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duration_minutes INT       DEFAULT 30,
  ADD COLUMN IF NOT EXISTS problem_count  INT         DEFAULT 5,
  ADD COLUMN IF NOT EXISTS start_at       TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS end_at         TIMESTAMPTZ DEFAULT NULL;

-- Back-compat: battle_events may not have actor_id column
ALTER TABLE public.battle_events
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. CREATE battle_problems TABLE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.battle_problems (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id       UUID        NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    sequence_number INT         NOT NULL,
    problem_slug    TEXT        NOT NULL,
    problem_title   TEXT        NOT NULL,
    problem_url     TEXT        NOT NULL,
    difficulty      TEXT        NOT NULL,
    topics          TEXT[]      NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_battle_problem_sequence UNIQUE (battle_id, sequence_number),
    CONSTRAINT uq_battle_problem_slug     UNIQUE (battle_id, problem_slug)
);

CREATE INDEX IF NOT EXISTS idx_battle_problems_battle ON public.battle_problems(battle_id, sequence_number ASC);

-- ─────────────────────────────────────────────────────────────
-- 3. CREATE battle_participants TABLE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.battle_participants (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id               UUID        NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
    user_id                 UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    username                TEXT        NOT NULL,
    current_problem_index   INT         NOT NULL DEFAULT 0,
    solved_count            INT         NOT NULL DEFAULT 0,
    total_time_ms           BIGINT      NOT NULL DEFAULT 0,
    is_ready                BOOLEAN     NOT NULL DEFAULT FALSE,
    ready_at                TIMESTAMPTZ DEFAULT NULL,
    finished_at             TIMESTAMPTZ DEFAULT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_battle_participant UNIQUE (battle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_battle_participants_battle ON public.battle_participants(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_participants_user   ON public.battle_participants(user_id);

-- ─────────────────────────────────────────────────────────────
-- 4. RLS POLICIES for new tables
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.battle_problems     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_participants ENABLE ROW LEVEL SECURITY;

-- battle_problems: readable by both battle participants
DROP POLICY IF EXISTS "battle_problems_select_participants" ON public.battle_problems;
CREATE POLICY "battle_problems_select_participants"
ON public.battle_problems FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id
          AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

-- battle_participants: readable by participants, writable by own row via RPC only
DROP POLICY IF EXISTS "battle_participants_select_participants" ON public.battle_participants;
CREATE POLICY "battle_participants_select_participants"
ON public.battle_participants FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.battles b
        WHERE b.id = battle_id
          AND (b.challenger_id = auth.uid() OR b.challenged_id = auth.uid())
    )
);

DROP POLICY IF EXISTS "battle_participants_insert_own" ON public.battle_participants;
CREATE POLICY "battle_participants_insert_own"
ON public.battle_participants FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "battle_participants_update_own" ON public.battle_participants;
CREATE POLICY "battle_participants_update_own"
ON public.battle_participants FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 5. REALTIME for new tables
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.battle_problems     REPLICA IDENTITY FULL;
ALTER TABLE public.battle_participants REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_problems;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_participants;
    EXCEPTION WHEN duplicate_object THEN END;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 6. RPC: create_battle_v2
--    Creates a battle with topic/difficulty selection (no problem picking by users)
-- ─────────────────────────────────────────────────────────────

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

    -- Get or create challenger profile
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

    -- Get challenged profile
    SELECT id INTO v_challenged_id
    FROM public.profiles
    WHERE LOWER(leetcode_username) = LOWER(p_challenged_username);

    IF v_challenged_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Challenged user not found. They must have a LeetStreak account.');
    END IF;

    IF v_challenged_id = v_challenger_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot challenge yourself');
    END IF;

    -- Ensure friendship exists
    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (v_challenger_id, v_challenged_id, 'accepted')
    ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'accepted', updated_at = now();

    -- Check for existing active battles
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

    -- Create battle
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

-- ─────────────────────────────────────────────────────────────
-- 7. RPC: accept_battle_v2
--    Accepts the challenge and creates participant rows
-- ─────────────────────────────────────────────────────────────

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

    -- Update battle status
    UPDATE public.battles
    SET status = 'accepted', accepted_at = now()
    WHERE id = p_battle_id;

    -- Create participant rows for both players
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

-- ─────────────────────────────────────────────────────────────
-- 8. RPC: confirm_ready_v2
--    Marks a player ready; when both ready → generates problems → starts battle
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_ready_v2(
    p_battle_id UUID,
    p_problems  JSONB  -- array of {slug, title, url, difficulty, topics[]}
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

    -- Mark me as ready
    UPDATE public.battle_participants
    SET is_ready = true, ready_at = now()
    WHERE battle_id = p_battle_id AND user_id = v_user_id;

    -- Update battle status to ready_check if needed
    UPDATE public.battles SET status = 'ready_check' WHERE id = p_battle_id AND status = 'accepted';

    -- Check if both are now ready
    SELECT
        bool_and(bp.is_ready) FILTER (WHERE bp.user_id = v_user_id) AS my_ready,
        bool_and(bp.is_ready) FILTER (WHERE bp.user_id != v_user_id) AS other_ready
    INTO v_my_ready, v_other_ready
    FROM public.battle_participants bp
    WHERE bp.battle_id = p_battle_id;

    -- Force my ready flag in case the UPDATE above happened faster
    v_my_ready := true;

    IF v_my_ready AND COALESCE(v_other_ready, false) THEN
        -- Both ready → insert problems if not already there
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

        -- Set start/end times (10s countdown then battle)
        v_start_at := now() + interval '10 seconds';
        v_end_at   := v_start_at + (v_battle.duration_minutes * interval '1 minute');

        UPDATE public.battles
        SET
            status          = 'countdown',
            match_starts_at = v_start_at,
            match_deadline  = v_end_at,
            start_at        = v_start_at,
            end_at          = v_end_at,
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

-- ─────────────────────────────────────────────────────────────
-- 9. RPC: record_battle_solve
--    Called when a player solves a problem.
--    Idempotent — ignores duplicate solves for same problem.
--    Returns next_problem_slug so extension can redirect.
-- ─────────────────────────────────────────────────────────────

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
    v_winner         TEXT;
    v_win_reason     TEXT;
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

    -- Find the problem in battle_problems
    SELECT * INTO v_problem
    FROM public.battle_problems
    WHERE battle_id = p_battle_id AND problem_slug = p_problem_slug;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Problem not in this battle');
    END IF;

    -- Insert result idempotently (ignore if already solved)
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

    -- Only advance if this is a new solve (not duplicate)
    IF FOUND THEN
        -- Advance participant cursor
        UPDATE public.battle_participants
        SET
            current_problem_index = GREATEST(current_problem_index, v_problem.sequence_number),
            solved_count          = solved_count + 1,
            total_time_ms         = total_time_ms + COALESCE(p_time_taken_ms, 0)
        WHERE battle_id = p_battle_id AND user_id = v_user_id
        RETURNING * INTO v_participant;
    ELSE
        -- Re-fetch participant state
        SELECT * INTO v_participant
        FROM public.battle_participants
        WHERE battle_id = p_battle_id AND user_id = v_user_id;
    END IF;

    -- Get total problems in this battle
    SELECT COUNT(*) INTO v_total_problems FROM public.battle_problems WHERE battle_id = p_battle_id;

    -- Find next unsolved problem for this user
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

    -- Log event
    INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 'problem_solved', jsonb_build_object(
        'problem_slug', p_problem_slug,
        'sequence_number', v_problem.sequence_number,
        'solved_count', v_participant.solved_count
    ));

    -- Check if battle should be finalized
    -- My solved count
    SELECT COUNT(*) INTO v_my_solved
    FROM public.battle_results
    WHERE battle_id = p_battle_id AND user_id = v_user_id AND accepted = true;

    -- Opponent's solved count
    SELECT COUNT(*) INTO v_opp_solved
    FROM public.battle_results br
    JOIN public.battle_participants bp ON (br.battle_id = bp.battle_id AND br.user_id = bp.user_id)
    WHERE br.battle_id = p_battle_id
      AND br.user_id != v_user_id
      AND br.accepted = true;

    -- Both solved all problems → finalize
    IF v_my_solved >= v_total_problems AND v_opp_solved >= v_total_problems THEN
        PERFORM public._finalize_battle(p_battle_id);
    -- Time expired
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

-- ─────────────────────────────────────────────────────────────
-- 10. HELPER: _finalize_battle
-- ─────────────────────────────────────────────────────────────

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

    -- Determine winner
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

-- ─────────────────────────────────────────────────────────────
-- 11. RPC: get_battle_state_v2
--    Full state for reconnection — battle + problems + participants
-- ─────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────
-- 12. RPC: forfeit_battle_v2
-- ─────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────
-- 13. Update confirm_battle_ready (back-compat shim)
-- ─────────────────────────────────────────────────────────────

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

    -- Also upsert participant row
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

-- ─────────────────────────────────────────────────────────────
-- 14. Demo user "joy" — preserve/update with new participant-compatible state
-- ─────────────────────────────────────────────────────────────

-- Joy's presence: permanently online (10 year TTL)
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

-- ─────────────────────────────────────────────────────────────
-- 15. Reload PostgREST schema cache
-- ─────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';

