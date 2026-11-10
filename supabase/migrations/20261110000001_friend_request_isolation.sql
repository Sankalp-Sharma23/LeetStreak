-- Replace implicit friendship creation with authenticated, recipient-approved requests.
-- Existing relationships are kept for review but must be reaccepted by the recipient.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id)
           ORDER BY created_at, id
         ) AS pair_rank
  FROM public.friendships
)
DELETE FROM public.friendships f USING ranked r
WHERE f.id = r.id AND r.pair_rank > 1;

UPDATE public.friendships
SET status = 'pending', updated_at = now()
WHERE status = 'accepted';

CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_undirected_pair
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

DROP POLICY IF EXISTS "friendships_insert_requester" ON public.friendships;
DROP POLICY IF EXISTS "friendships_update_participants" ON public.friendships;
DROP POLICY IF EXISTS "friendships_delete_participants" ON public.friendships;
DROP POLICY IF EXISTS "friendships_select_participants" ON public.friendships;
CREATE POLICY "friendships_select_participants"
  ON public.friendships FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

REVOKE ALL ON public.friendships FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.friendships FROM authenticated;
GRANT SELECT ON public.friendships TO authenticated;

CREATE OR REPLACE FUNCTION public.request_friendship(p_target_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_target_id UUID;
  v_pair public.friendships%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  IF NULLIF(TRIM(p_target_username), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target username is required');
  END IF;

  SELECT id INTO v_target_id FROM public.profiles
  WHERE LOWER(leetcode_username) = LOWER(TRIM(p_target_username));
  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target user profile not found');
  END IF;
  IF v_target_id = v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot befriend yourself');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(v_user_id::TEXT, v_target_id::TEXT) || ':' || GREATEST(v_user_id::TEXT, v_target_id::TEXT), 0));
  SELECT * INTO v_pair FROM public.friendships
  WHERE (requester_id = v_user_id AND addressee_id = v_target_id)
     OR (requester_id = v_target_id AND addressee_id = v_user_id)
  FOR UPDATE;

  IF FOUND THEN
    IF v_pair.status = 'blocked' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This friendship is unavailable');
    END IF;
    IF v_pair.status = 'accepted' THEN
      RETURN jsonb_build_object('success', true, 'status', 'accepted', 'friendship_id', v_pair.id);
    END IF;
    IF v_pair.requester_id = v_target_id AND v_pair.status = 'pending' THEN
      UPDATE public.friendships SET status = 'accepted', updated_at = now() WHERE id = v_pair.id;
      RETURN jsonb_build_object('success', true, 'status', 'accepted', 'friendship_id', v_pair.id);
    END IF;
    IF v_pair.status = 'rejected' AND v_pair.requester_id = v_user_id THEN
      UPDATE public.friendships SET status = 'pending', updated_at = now() WHERE id = v_pair.id;
      RETURN jsonb_build_object('success', true, 'status', 'pending', 'friendship_id', v_pair.id);
    END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending', 'friendship_id', v_pair.id);
  END IF;

  INSERT INTO public.friendships (requester_id, addressee_id, status)
  VALUES (v_user_id, v_target_id, 'pending')
  RETURNING * INTO v_pair;
  RETURN jsonb_build_object('success', true, 'status', 'pending', 'friendship_id', v_pair.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_friend_requests()
RETURNS TABLE (friendship_id UUID, requester_id UUID, leetcode_username TEXT, display_name TEXT, avatar_url TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.id, p.id, p.leetcode_username, p.display_name, p.avatar_url, f.created_at
  FROM public.friendships f
  JOIN public.profiles p ON p.id = f.requester_id
  WHERE auth.uid() IS NOT NULL AND f.addressee_id = auth.uid() AND f.status = 'pending'
  ORDER BY f.created_at;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_friend_request(p_friendship_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  UPDATE public.friendships
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
      updated_at = now()
  WHERE id = p_friendship_id AND addressee_id = v_user_id AND status = 'pending'
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Friend request not found or already handled');
  END IF;
  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.request_friendship(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_friend_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_friend_request(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_friendship(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_friend_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_friend_request(UUID, BOOLEAN) TO authenticated;

ALTER FUNCTION public.get_accepted_friends() SET search_path = public, pg_temp;
ALTER FUNCTION public.remove_friendship(TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.restore_or_init_profile(TEXT, TEXT, TEXT) SET search_path = public, pg_temp;

-- Legacy function silently accepted a relationship based only on the caller's action.
REVOKE ALL ON FUNCTION public.sync_friendship(TEXT) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
