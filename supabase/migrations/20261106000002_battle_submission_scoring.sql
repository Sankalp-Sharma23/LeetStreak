-- Fix V2 solve persistence and add a server-ordered performance tiebreak.

ALTER TABLE public.battle_results
  ADD COLUMN IF NOT EXISTS time_taken_ms BIGINT;

UPDATE public.battle_results
SET time_taken_ms = GREATEST(0, time_taken_seconds)::BIGINT * 1000
WHERE time_taken_ms IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_battle_accepted_solve
  ON public.battle_results(battle_id, user_id, problem_slug)
  WHERE accepted = TRUE;

CREATE OR REPLACE FUNCTION public.battle_performance_scores(
  p_memory_1 DOUBLE PRECISION,
  p_runtime_1 INT,
  p_memory_2 DOUBLE PRECISION,
  p_runtime_2 INT
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_space_1 NUMERIC;
  v_space_2 NUMERIC;
  v_time_1 NUMERIC;
  v_time_2 NUMERIC;
  v_final_1 NUMERIC;
  v_final_2 NUMERIC;
BEGIN
  IF p_memory_1 IS NULL OR p_memory_2 IS NULL OR p_memory_1 <= 0
     OR p_memory_2 <= 0 OR p_runtime_1 IS NULL OR p_runtime_2 IS NULL
     OR p_runtime_1 < 0 OR p_runtime_2 < 0 THEN
    RETURN jsonb_build_object('available', FALSE);
  END IF;

  IF p_memory_1 = p_memory_2 THEN
    v_space_1 := 50; v_space_2 := 50;
  ELSIF p_memory_1 < p_memory_2 THEN
    v_space_1 := 100; v_space_2 := 0;
  ELSE
    v_space_1 := 0; v_space_2 := 100;
  END IF;

  IF p_runtime_1 = p_runtime_2 THEN
    v_time_1 := 50; v_time_2 := 50;
  ELSIF p_runtime_1 < p_runtime_2 THEN
    v_time_1 := 100; v_time_2 := 0;
  ELSE
    v_time_1 := 0; v_time_2 := 100;
  END IF;

  v_final_1 := round(v_space_1 * 0.70 + v_time_1 * 0.30, 6);
  v_final_2 := round(v_space_2 * 0.70 + v_time_2 * 0.30, 6);
  RETURN jsonb_build_object(
    'available', TRUE,
    'space_score_1', v_space_1,
    'space_score_2', v_space_2,
    'time_score_1', v_time_1,
    'time_score_2', v_time_2,
    'final_score_1', v_final_1,
    'final_score_2', v_final_2
  );
END;
$$;

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
  v_user_id UUID := auth.uid();
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
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Authentication required');
  END IF;

  -- Serialize solves and finalization against the battle row.
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
        total_time_ms = total_time_ms + v_elapsed_ms
    WHERE battle_id = p_battle_id AND user_id = v_user_id
    RETURNING * INTO v_participant;

    INSERT INTO public.battle_events (battle_id, actor_id, event_type, payload)
    VALUES (p_battle_id, v_user_id, 'problem_solved', jsonb_build_object(
      'problem_slug', v_problem.problem_slug,
      'sequence_number', v_problem.sequence_number,
      'solved_count', v_participant.solved_count,
      'submitted_at', v_submitted_at,
      'runtime_ms', CASE WHEN p_runtime_ms >= 0 THEN p_runtime_ms ELSE NULL END,
      'memory_mb', CASE WHEN p_memory_mb > 0 AND p_memory_mb < 'Infinity'::FLOAT AND p_memory_mb <> 'NaN'::FLOAT THEN p_memory_mb ELSE NULL END
    ));
  END IF;

  SELECT COUNT(*) INTO v_total_problems FROM public.battle_problems WHERE battle_id = p_battle_id;
  SELECT COUNT(*) INTO v_my_solved FROM public.battle_results
  WHERE battle_id = p_battle_id AND user_id = v_battle.challenger_id AND accepted;
  SELECT COUNT(*) INTO v_opp_solved FROM public.battle_results
  WHERE battle_id = p_battle_id AND user_id = v_battle.challenged_id AND accepted;

  IF v_total_problems > 0 AND v_my_solved >= v_total_problems AND v_opp_solved >= v_total_problems THEN
    PERFORM public._finalize_battle(p_battle_id);
  END IF;

  SELECT * INTO v_next_problem FROM public.battle_problems bp
  WHERE bp.battle_id = p_battle_id AND NOT EXISTS (
    SELECT 1 FROM public.battle_results br
    WHERE br.battle_id = p_battle_id AND br.user_id = v_user_id
      AND br.problem_slug = bp.problem_slug AND br.accepted
  )
  ORDER BY bp.sequence_number LIMIT 1;

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

CREATE OR REPLACE FUNCTION public._finalize_battle(p_battle_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  WHERE id = p_battle_id AND status NOT IN ('completed', 'forfeited', 'cancelled', 'expired', 'declined');

  IF FOUND THEN
    INSERT INTO public.battle_events (battle_id, event_type, payload)
    VALUES (p_battle_id, 'match_finalized', jsonb_build_object(
      'winner', v_winner,
      'win_reason', v_reason,
      'score_challenger', v_score_1,
      'score_challenged', v_score_2,
      'time_challenger_ms', v_time_1,
      'time_challenged_ms', v_time_2,
      'performance_score_challenger', v_perf_1,
      'performance_score_challenged', v_perf_2,
      'performance_pairs', v_perf_pairs,
      'performance_window_seconds', 2
    ));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_and_finalize_battle(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_battle RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('finalized', FALSE, 'error', 'Authentication required');
  END IF;
  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
  IF NOT FOUND OR (v_battle.challenger_id <> v_user_id AND v_battle.challenged_id <> v_user_id) THEN
    RETURN jsonb_build_object('finalized', FALSE, 'error', 'Battle not found or access denied');
  END IF;

  PERFORM public._finalize_battle(p_battle_id);
  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
  RETURN jsonb_build_object(
    'finalized', v_battle.status = 'completed',
    'winner', v_battle.winner_username,
    'reason', v_battle.win_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_battle_state_v2(p_battle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_battle RECORD;
  v_problems JSONB;
  v_participants JSONB;
  v_results JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Authentication required');
  END IF;
  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
  IF NOT FOUND OR (v_battle.challenger_id <> v_user_id AND v_battle.challenged_id <> v_user_id) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Battle not found or access denied');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'sequence_number', sequence_number, 'problem_slug', problem_slug,
    'problem_title', problem_title, 'problem_url', problem_url,
    'difficulty', difficulty, 'topics', topics
  ) ORDER BY sequence_number) INTO v_problems
  FROM public.battle_problems WHERE battle_id = p_battle_id;

  SELECT jsonb_agg(jsonb_build_object(
    'user_id', user_id, 'username', username,
    'current_problem_index', current_problem_index, 'solved_count', solved_count,
    'is_ready', is_ready, 'ready_at', ready_at
  )) INTO v_participants
  FROM public.battle_participants WHERE battle_id = p_battle_id;

  SELECT jsonb_agg(jsonb_build_object(
    'user_id', user_id, 'username', username, 'problem_slug', problem_slug,
    'accepted', accepted, 'time_taken_seconds', time_taken_seconds,
    'time_taken_ms', COALESCE(time_taken_ms, time_taken_seconds::BIGINT * 1000),
    'runtime_ms', runtime_ms, 'memory_mb', memory_mb, 'submitted_at', submitted_at
  ) ORDER BY submitted_at) INTO v_results
  FROM public.battle_results WHERE battle_id = p_battle_id AND accepted;

  RETURN jsonb_build_object(
    'success', TRUE, 'battle', row_to_json(v_battle),
    'problems', COALESCE(v_problems, '[]'::JSONB),
    'participants', COALESCE(v_participants, '[]'::JSONB),
    'results', COALESCE(v_results, '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.battle_performance_scores(DOUBLE PRECISION, INT, DOUBLE PRECISION, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finalize_battle(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_battle_solve(UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_and_finalize_battle(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_battle_state_v2(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
