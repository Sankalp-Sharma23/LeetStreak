-- Remove inherited non-read privileges from authenticated users on friendship
-- and battle tables.
-- The prior migration revoked row-write privileges but left table-wide privileges
-- such as TRUNCATE/MAINTAIN/REFERENCES/TRIGGER granted by earlier setup.

REVOKE ALL ON TABLE
  public.friendships,
  public.battles,
  public.battle_results,
  public.battle_events,
  public.battle_participants,
  public.battle_problems
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.friendships,
  public.battles,
  public.battle_results,
  public.battle_events,
  public.battle_participants,
  public.battle_problems
TO authenticated;

-- record_battle_solve is an authenticated-user RPC; it must not be callable by
-- unauthenticated clients through the implicit PUBLIC EXECUTE privilege.
REVOKE ALL ON FUNCTION public.record_battle_solve(UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_battle_solve(UUID, TEXT, TEXT, BIGINT, INT, FLOAT, TEXT)
TO authenticated;

NOTIFY pgrst, 'reload schema';
