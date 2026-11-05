-- ============================================================================
-- Down Migration: 20261105000002_presence_and_social_remediation.down.sql
-- Description: Reverts presence, RPCs, and Realtime publications.
-- ============================================================================

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.user_presence;
    ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.battles;
    ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.battle_events;
    ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.roast_messages;
    ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.friendships;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DROP FUNCTION IF EXISTS public.create_battle_challenge(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.send_roast(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.sync_friendship(TEXT);
DROP FUNCTION IF EXISTS public.get_friends_presence(TEXT[]);
DROP FUNCTION IF EXISTS public.get_online_friends();
DROP FUNCTION IF EXISTS public.set_presence_offline();
DROP FUNCTION IF EXISTS public.heartbeat_presence(TEXT);

ALTER TABLE public.user_presence 
    DROP COLUMN IF EXISTS in_battle,
    DROP COLUMN IF EXISTS active_battle_id;
