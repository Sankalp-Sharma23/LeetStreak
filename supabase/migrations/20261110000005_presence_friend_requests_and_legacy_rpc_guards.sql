-- Close the public presence RPC, correctly reopen rejected friend requests,
-- and revoke the retired client-trusted battle submission RPC.
-- Paste this complete file into Supabase SQL Editor when applying manually.
-- Safe to run again: function definitions and ACL statements are idempotent.
-- It changes function definitions and grants, but does not rewrite app rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_friends_presence(p_usernames TEXT[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_stale_threshold TIMESTAMPTZ := now() - interval '120 seconds';
  v_result JSONB := '{}'::JSONB;
  v_row RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  FOR v_row IN
    SELECT
      p.leetcode_username,
      up.last_seen,
      CASE
        WHEN up.last_seen IS NULL OR up.last_seen < v_stale_threshold THEN 'offline'
        WHEN EXISTS (
          SELECT 1
          FROM public.battles b
          WHERE (b.challenger_id = p.id OR b.challenged_id = p.id)
            AND b.status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
        ) THEN 'in_battle'
        WHEN up.status = 'in_battle' THEN 'in_battle'
        ELSE 'online'
      END AS effective_status,
      EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE (b.challenger_id = p.id OR b.challenged_id = p.id)
          AND b.status IN ('pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress')
      ) AS is_in_battle
    FROM public.friendships f
    JOIN public.profiles p
      ON p.id = CASE
        WHEN f.requester_id = v_user_id THEN f.addressee_id
        ELSE f.requester_id
      END
    LEFT JOIN public.user_presence up ON up.user_id = p.id
    WHERE f.status = 'accepted'
      AND (f.requester_id = v_user_id OR f.addressee_id = v_user_id)
      AND (
        p_usernames IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(p_usernames) AS requested(username)
          WHERE requested.username IS NOT NULL
            AND lower(requested.username) = lower(p.leetcode_username)
        )
      )
  LOOP
    v_result := jsonb_set(
      v_result,
      ARRAY[lower(v_row.leetcode_username)],
      jsonb_build_object(
        'status', v_row.effective_status,
        'isOnline', v_row.effective_status IN ('online', 'in_battle'),
        'inBattle', v_row.is_in_battle,
        'last_seen', v_row.last_seen
      ),
      TRUE
    );
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_friends_presence(TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_friends_presence(TEXT[])
  TO authenticated;

CREATE OR REPLACE FUNCTION public.request_friendship(p_target_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_target_id UUID;
  v_pair public.friendships%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Authentication required');
  END IF;
  IF NULLIF(btrim(p_target_username), '') IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Target username is required');
  END IF;

  SELECT p.id INTO v_target_id
  FROM public.profiles p
  WHERE lower(p.leetcode_username) = lower(btrim(p_target_username));
  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Target user profile not found');
  END IF;
  IF v_target_id = v_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Cannot befriend yourself');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      least(v_user_id::TEXT, v_target_id::TEXT) || ':' ||
      greatest(v_user_id::TEXT, v_target_id::TEXT),
      0
    )
  );

  SELECT f.* INTO v_pair
  FROM public.friendships f
  WHERE (f.requester_id = v_user_id AND f.addressee_id = v_target_id)
     OR (f.requester_id = v_target_id AND f.addressee_id = v_user_id)
  FOR UPDATE;

  IF FOUND THEN
    IF v_pair.status = 'blocked' THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'This friendship is unavailable');
    END IF;
    IF v_pair.status = 'accepted' THEN
      RETURN jsonb_build_object('success', TRUE, 'status', 'accepted', 'friendship_id', v_pair.id);
    END IF;
    IF v_pair.status = 'pending' AND v_pair.requester_id = v_target_id THEN
      UPDATE public.friendships f
      SET status = 'accepted', updated_at = now()
      WHERE f.id = v_pair.id;
      RETURN jsonb_build_object('success', TRUE, 'status', 'accepted', 'friendship_id', v_pair.id);
    END IF;
    IF v_pair.status = 'rejected' THEN
      -- A rejected relationship may be requested again from either side.
      -- Reorient the one undirected pair so the current caller is the requester.
      UPDATE public.friendships f
      SET requester_id = v_user_id,
          addressee_id = v_target_id,
          status = 'pending',
          created_at = now(),
          updated_at = now()
      WHERE f.id = v_pair.id;
      RETURN jsonb_build_object('success', TRUE, 'status', 'pending', 'friendship_id', v_pair.id);
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'status', 'pending', 'friendship_id', v_pair.id);
  END IF;

  INSERT INTO public.friendships (requester_id, addressee_id, status)
  VALUES (v_user_id, v_target_id, 'pending')
  RETURNING * INTO v_pair;
  RETURN jsonb_build_object('success', TRUE, 'status', 'pending', 'friendship_id', v_pair.id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_friendship(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_friendship(TEXT)
  TO authenticated;

-- Retired RPC accepted a caller-controlled p_accepted flag. Some installed
-- databases do not contain this legacy function, so revoke it only when an
-- overload exists. Do not change newer record_battle_solve grants or behavior.
DO $$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_battle_submission'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_function.signature
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
