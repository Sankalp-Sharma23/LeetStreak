-- Make authenticated UUIDs the sole source of battle identity and funnel all
-- battle mutations through participant-checked, transactional RPC functions.

DROP POLICY IF EXISTS "battles_insert_challenger" ON public.battles;
DROP POLICY IF EXISTS "battles_update_participants" ON public.battles;
DROP POLICY IF EXISTS "battle_results_insert_own" ON public.battle_results;
DROP POLICY IF EXISTS "battle_events_insert_participants" ON public.battle_events;
DROP POLICY IF EXISTS "battle_participants_insert_own" ON public.battle_participants;
DROP POLICY IF EXISTS "battle_participants_update_own" ON public.battle_participants;

REVOKE ALL ON public.battles, public.battle_results, public.battle_events,
  public.battle_participants, public.battle_problems FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.battles, public.battle_results, public.battle_events,
  public.battle_participants, public.battle_problems FROM authenticated;
GRANT SELECT ON public.battles, public.battle_results, public.battle_events,
  public.battle_participants, public.battle_problems TO authenticated;

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

REVOKE ALL ON FUNCTION public.respond_battle_v2(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_battle_v2(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_active_battle() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_recent_battles(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_battle_v2(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_battle_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_active_battle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_recent_battles(INT) TO authenticated;

ALTER FUNCTION public.create_battle_v2(TEXT, TEXT[], TEXT, INT, INT, TEXT, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.accept_battle_v2(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_ready_v2(UUID, JSONB) SET search_path = public, pg_temp;
ALTER FUNCTION public.record_battle_solve(UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_battle_state_v2(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.forfeit_battle_v2(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.evaluate_and_finalize_battle(UUID) SET search_path = public, pg_temp;

-- Keep the event log compatible with both the original and v2 state machines.
ALTER TABLE public.battle_events DROP CONSTRAINT IF EXISTS battle_events_event_type_check;
ALTER TABLE public.battle_events ADD CONSTRAINT battle_events_event_type_check CHECK (
  event_type IN (
    'challenge_sent', 'challenge_created', 'challenge_accepted', 'challenge_declined',
    'problem_selected', 'ready_confirmed', 'countdown_started', 'match_started',
    'submission_attempt', 'problem_solved', 'forfeited', 'match_finalized', 'cancelled'
  )
);

-- A battle challenge is permitted only between already accepted friends.
-- The caller and challenger identity always come from auth.uid().
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

  -- Serialize active-match checks for both participants to prevent two
  -- simultaneous challenges from creating overlapping active battles.
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

REVOKE ALL ON FUNCTION public.create_battle_v2(TEXT, TEXT[], TEXT, INT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_battle_v2(TEXT, TEXT[], TEXT, INT, INT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_battle_history_details_v2(
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

REVOKE ALL ON FUNCTION public.get_battle_history_details_v2(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_battle_history_details_v2(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO authenticated;

-- Never persist a client-controlled destination URL for a battle problem.
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

DROP TRIGGER IF EXISTS canonicalize_battle_problem_url ON public.battle_problems;
CREATE TRIGGER canonicalize_battle_problem_url
BEFORE INSERT OR UPDATE OF problem_slug, problem_url, problem_title, difficulty
ON public.battle_problems
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_battle_problem();

UPDATE public.battle_problems
SET problem_url = 'https://leetcode.com/problems/' || LOWER(TRIM(problem_slug)) || '/'
WHERE LOWER(TRIM(problem_slug)) ~ '^[a-z0-9]+(-[a-z0-9]+)*$';

NOTIFY pgrst, 'reload schema';
