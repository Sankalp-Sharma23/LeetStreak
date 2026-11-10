-- ============================================================================
-- LEETSTREAK MIGRATION: Restore get_online_friends RPC
-- File: 20261110000009_restore_get_online_friends.sql
-- ============================================================================

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

GRANT EXECUTE ON FUNCTION public.get_online_friends() TO authenticated;
NOTIFY pgrst, 'reload schema';

