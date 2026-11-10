-- ============================================================================
-- LEETSTREAK MIGRATION: Ephemeral Roast Messages (Auto-Delete on Delivery)
-- File: 20261110000010_ephemeral_roast_messages.sql
-- ============================================================================

-- 1. Grant DELETE permission on roast_messages to authenticated users
GRANT DELETE ON TABLE public.roast_messages TO authenticated;

-- 2. Add RLS policy allowing recipients and senders to delete their roasts
DROP POLICY IF EXISTS "roasts_delete_participants" ON public.roast_messages;
CREATE POLICY "roasts_delete_participants" ON public.roast_messages FOR DELETE
    USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

-- 3. Dedicated security definer RPC for bulk deleting delivered/read roasts
CREATE OR REPLACE FUNCTION public.delete_roast_messages(p_message_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_deleted_count INT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    DELETE FROM public.roast_messages
    WHERE id = ANY(p_message_ids)
      AND (recipient_id = v_user_id OR sender_id = v_user_id);
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'deleted', v_deleted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_roast_messages(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_roast_messages(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

