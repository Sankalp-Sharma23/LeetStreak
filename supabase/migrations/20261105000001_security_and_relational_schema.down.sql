-- ============================================================================
-- Rollback Migration: 20261105000001_security_and_relational_schema.down.sql
-- Description: Reverts the tables, functions, and RLS policies defined in
--              20261105000001_security_and_relational_schema.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS public.forfeit_battle(UUID);
DROP FUNCTION IF EXISTS public.evaluate_and_finalize_battle(UUID);
DROP FUNCTION IF EXISTS public.record_battle_submission(UUID, TEXT, TEXT, BOOLEAN, INT, INT, FLOAT, TEXT);
DROP FUNCTION IF EXISTS public.confirm_battle_ready(UUID);
DROP FUNCTION IF EXISTS public.clean_stale_presence();

DROP TABLE IF EXISTS public.battle_events CASCADE;
DROP TABLE IF EXISTS public.battle_results CASCADE;
DROP TABLE IF EXISTS public.battles CASCADE;
DROP TABLE IF EXISTS public.user_presence CASCADE;
DROP TABLE IF EXISTS public.roast_messages CASCADE;
DROP TABLE IF EXISTS public.friendships CASCADE;
DROP TABLE IF EXISTS public.user_settings CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

