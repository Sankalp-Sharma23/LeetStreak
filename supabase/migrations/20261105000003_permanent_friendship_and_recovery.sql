-- ============================================================================
-- Migration: 20261105000003_permanent_friendship_and_recovery.sql
-- Description: Permanent friendship persistence, account recovery and email privacy.
-- Ensures friendships survive uninstallation, local storage deletion, and reinstalls.
-- Keeps Supabase as authoritative source of truth keyed by authenticated UUIDs.
-- ============================================================================

-- 1. RETRIEVE ALL ACCEPTED FRIENDSHIPS RPC (Authoritative Server-Side Friend List)
-- Retrieves all accepted friends of the authenticated user (auth.uid())
-- Returns public profile fields only. NEVER exposes email addresses.
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

-- 2. GET OWN PROFILE RPC (By Authenticated UUID)
-- Restores the authenticated user's own profile without exposing private email.
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

-- 3. REMOVE FRIENDSHIP RPC
-- Explicitly removes a friendship relationship between auth.uid() and target user.
-- Ensures local removal synchronizes permanently to Supabase.
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

-- 4. IDEMPOTENT PROFILE INITIALIZATION / RECOVERY RPC
-- Safely initializes or recovers a user profile on login or reinstallation.
-- Never overwrites existing user data or generates duplicate identities.
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
        -- Profile already exists; return existing data without destructive overwrite
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
        -- First time profile creation using authenticated UUID
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

        -- Also initialize default user_settings row for the new user
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
