-- ============================================================================
-- Migration: 20261105000002_presence_and_social_remediation.sql
-- Description: Comprehensive social remediation establishing reliable heartbeat
--              presence, online friend discovery, friendship auto-sync,
--              durable roast delivery lifecycle, and Realtime publications.
-- Author: Principal Architect
-- Platform: Supabase PostgreSQL (Postgres 15+)
-- ============================================================================

-- 1. PRESENCE TABLE REFINEMENTS & REPLICA IDENTITY
ALTER TABLE public.user_presence 
    ADD COLUMN IF NOT EXISTS in_battle BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS active_battle_id UUID;

ALTER TABLE public.user_presence REPLICA IDENTITY FULL;
ALTER TABLE public.battles REPLICA IDENTITY FULL;
ALTER TABLE public.battle_events REPLICA IDENTITY FULL;
ALTER TABLE public.roast_messages REPLICA IDENTITY FULL;
ALTER TABLE public.friendships REPLICA IDENTITY FULL;

-- Ensure presence RLS allows authenticated users to read presence
DROP POLICY IF EXISTS "presence_select_authenticated" ON public.user_presence;
CREATE POLICY "presence_select_authenticated" 
ON public.user_presence FOR SELECT 
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "presence_upsert_own" ON public.user_presence;
CREATE POLICY "presence_upsert_own" 
ON public.user_presence FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2. ATOMIC HEARTBEAT PRESENCE RPC
CREATE OR REPLACE FUNCTION public.heartbeat_presence(p_status TEXT DEFAULT 'online')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    -- Lookup username from profiles
    SELECT leetcode_username INTO v_username
    FROM public.profiles
    WHERE id = v_user_id;

    IF v_username IS NULL THEN
        v_username := 'unknown';
    END IF;

    -- Authoritative check for active battle participation
    SELECT id INTO v_active_battle_id
    FROM public.battles
    WHERE (challenger_id = v_user_id OR challenged_id = v_user_id)
    AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_active_battle_id IS NOT NULL THEN
        v_in_battle := TRUE;
        v_effective_status := 'in_battle';
    ELSIF p_status IN ('online', 'in_battle', 'offline') THEN
        v_effective_status := p_status;
    ELSE
        v_effective_status := 'online';
    END IF;

    -- Upsert user presence record
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

-- 3. SET PRESENCE OFFLINE RPC
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

-- 4. ONLINE FRIEND DISCOVERY RPC
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

-- 5. GET FRIENDS PRESENCE MAP RPC
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

-- 6. SYNC FRIENDSHIPS RPC (Bi-directional link of accepted LeetStreak buddies)
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

-- 7. ATOMIC ROAST MESSAGING RPC
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
    v_roast_id UUID;
    v_now TIMESTAMPTZ := now();
    v_friendship_exists BOOLEAN;
BEGIN
    IF v_sender_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required to send roasts');
    END IF;

    IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Roast message cannot be empty');
    END IF;

    IF length(p_content) > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Roast exceeds 500 character limit');
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
        RETURN jsonb_build_object('success', false, 'error', 'Recipient is not registered on Supabase');
    END IF;

    IF v_sender_id = v_recipient_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot roast yourself');
    END IF;

    -- Verify or establish mutual friendship
    SELECT EXISTS (
        SELECT 1 FROM public.friendships
        WHERE status = 'accepted'
        AND ((requester_id = v_sender_id AND addressee_id = v_recipient_id)
          OR (addressee_id = v_sender_id AND requester_id = v_recipient_id))
    ) INTO v_friendship_exists;

    IF NOT v_friendship_exists THEN
        INSERT INTO public.friendships (requester_id, addressee_id, status)
        VALUES (v_sender_id, v_recipient_id, 'accepted')
        ON CONFLICT (requester_id, addressee_id)
        DO UPDATE SET status = 'accepted', updated_at = now();
    END IF;

    INSERT INTO public.roast_messages (
        sender_id, recipient_id, sender_username, recipient_username,
        content, status, created_at
    ) VALUES (
        v_sender_id, v_recipient_id, v_sender_username, LOWER(p_recipient_username),
        p_content, 'sent', v_now
    )
    RETURNING id INTO v_roast_id;

    RETURN jsonb_build_object(
        'success', true,
        'roast_id', v_roast_id,
        'sender', v_sender_username,
        'recipient', LOWER(p_recipient_username),
        'content', p_content,
        'status', 'sent',
        'created_at', v_now
    );
END;
$$;

-- 8. ATOMIC BATTLE CHALLENGE RPC (Validates sender, recipient, active states & creates match)
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
        RETURN jsonb_build_object('success', false, 'error', 'Opponent has not registered on Supabase');
    END IF;

    IF v_challenger_id = v_challenged_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot challenge yourself');
    END IF;

    -- Check if challenger has an active battle
    SELECT * INTO v_existing_battle
    FROM public.battles
    WHERE (challenger_id = v_challenger_id OR challenged_id = v_challenger_id)
    AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active battle in progress');
    END IF;

    -- Check if opponent has an active battle
    SELECT * INTO v_existing_battle
    FROM public.battles
    WHERE (challenger_id = v_challenged_id OR challenged_id = v_challenged_id)
    AND status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', p_challenged_username || ' is already in an active battle');
    END IF;

    -- Ensure friendship exists
    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (v_challenger_id, v_challenged_id, 'accepted')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING;

    -- Insert battle record
    INSERT INTO public.battles (
        challenger_id, challenged_id,
        challenger_username, challenged_username,
        language, status, expires_at, created_at
    ) VALUES (
        v_challenger_id, v_challenged_id,
        v_challenger_username, LOWER(p_challenged_username),
        v_language, 'pending', v_expires_at, v_now
    )
    RETURNING * INTO v_battle;

    -- Record battle event
    INSERT INTO public.battle_events (battle_id, user_id, event_type, payload)
    VALUES (v_battle.id, v_challenger_id, 'battle_created', jsonb_build_object(
        'challenger', v_challenger_username,
        'challenged', LOWER(p_challenged_username),
        'language', v_language
    ));

    RETURN jsonb_build_object(
        'success', true,
        'battle', row_to_json(v_battle)
    );
END;
$$;

-- 9. REALTIME PUBLICATION CONFIGURATION
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battles;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_events;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roast_messages;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
