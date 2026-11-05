-- ============================================================================
-- Rollback Migration: 20261105000003_permanent_friendship_and_recovery.down.sql
-- ============================================================================

DROP FUNCTION IF EXISTS public.restore_or_init_profile(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.remove_friendship(TEXT);
DROP FUNCTION IF EXISTS public.get_own_profile();
DROP FUNCTION IF EXISTS public.get_accepted_friends();

