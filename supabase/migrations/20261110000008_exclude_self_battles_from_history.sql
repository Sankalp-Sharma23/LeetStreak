-- Exclude self-battles (test duels against oneself) from the head-to-head scoreboard

-- 1. Clean up legacy self-battles
DELETE FROM public.battles
WHERE challenger_id = challenged_id
   OR LOWER(COALESCE(challenger_username, '')) = LOWER(COALESCE(challenged_username, ''));

-- 2. Update get_battle_history_scoreboard RPC
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

REVOKE ALL ON FUNCTION public.get_battle_history_scoreboard(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_battle_history_scoreboard(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

