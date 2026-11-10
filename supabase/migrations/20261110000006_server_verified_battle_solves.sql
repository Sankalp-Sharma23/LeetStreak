-- LeetStreak migration: require server verification for battle solves.
-- Only the Edge Function's service_role may execute the verified transition.
BEGIN;
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
REVOKE ALL ON FUNCTION public.record_battle_solve(UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_battle_solve_verified(UUID, UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_battle_solve_verified(UUID, UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;