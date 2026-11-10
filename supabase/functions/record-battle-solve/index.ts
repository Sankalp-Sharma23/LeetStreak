const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';
import { findAcceptedBattleSubmission, isValidBattleSolveInput } from '../_shared/battle-submission-verifier.js';
const ACCEPTED_SUBMISSIONS_QUERY = `
  query VerifyBattleSubmission($username: String!) {
    matchedUser(username: $username) {
      recentAcSubmissions(limit: 1000) {
        id
        titleSlug
        timestamp
      }
    }
  }
`;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getKey(legacyName: string, keySetName: string): string | undefined {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  try {
    const keySet = JSON.parse(Deno.env.get(keySetName) || '{}');
    return keySet.default || Object.values(keySet)[0] as string | undefined;
  } catch {
    return undefined;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = getKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
  const serviceRoleKey = getKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Battle verification function is missing Supabase environment configuration.');
    return reply(500, { error: 'Battle verification service is not configured.' });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'Authentication required.' });

  // Resolve the caller from Supabase Auth; never accept a user ID from the client.
  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!authResponse.ok) return reply(401, { error: 'Your session is invalid or expired.' });
  const authUser = await authResponse.json();
  const userId = authUser?.id;
  if (!isUuid(userId)) return reply(401, { error: 'Could not identify the signed-in user.' });

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return reply(400, { error: 'Request body must be valid JSON.' });
  }

  const battleId = input.p_battle_id;
  const problemSlug = typeof input.p_problem_slug === 'string' ? input.p_problem_slug.trim().toLowerCase() : '';
  const submissionId = typeof input.p_submission_id === 'string' ? input.p_submission_id.trim() : '';
  if (!isValidBattleSolveInput({ battleId, problemSlug, submissionId })) {
    return reply(400, { error: 'Battle, problem, or LeetCode submission ID is invalid.' });
  }

  const serviceHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  const restUrl = new URL(`${supabaseUrl}/rest/v1/`);
  async function selectOne(table: string, query: Record<string, string>) {
    const url = new URL(table, restUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { ...serviceHeaders, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Database lookup failed for ${table} (${response.status}).`);
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] ?? null : null;
  }

  try {
    const [profile, battle, participant, problem] = await Promise.all([
      selectOne('profiles', { select: 'id,leetcode_username', id: `eq.${userId}`, limit: '1' }),
      selectOne('battles', {
        select: 'id,status,challenger_id,challenged_id,start_at,end_at,match_starts_at,match_deadline',
        id: `eq.${battleId}`,
        limit: '1',
      }),
      selectOne('battle_participants', {
        select: 'username', battle_id: `eq.${battleId}`, user_id: `eq.${userId}`, limit: '1',
      }),
      selectOne('battle_problems', {
        select: 'problem_slug', battle_id: `eq.${battleId}`, problem_slug: `eq.${problemSlug}`, limit: '1',
      }),
    ]);

    if (!profile?.leetcode_username || !battle || !participant || !problem) {
      return reply(404, { error: 'Battle participant or problem was not found.' });
    }
    if (battle.challenger_id !== userId && battle.challenged_id !== userId) {
      return reply(403, { error: 'You are not a participant in this battle.' });
    }
    if (String(profile.leetcode_username).toLowerCase() !== String(participant.username).toLowerCase()) {
      return reply(409, { error: 'Your LeetCode profile does not match this battle participant.' });
    }
    if (!['countdown', 'in_progress'].includes(battle.status)) {
      return reply(409, { error: 'This battle is not accepting solutions.' });
    }

    const leetcodeResponse = await fetch(LEETCODE_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://leetcode.com', Referer: 'https://leetcode.com/' },
      body: JSON.stringify({ query: ACCEPTED_SUBMISSIONS_QUERY, variables: { username: profile.leetcode_username } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!leetcodeResponse.ok) return reply(502, { error: 'LeetCode could not verify the submission right now.' });
    const leetcodeBody = await leetcodeResponse.json();
    const accepted = leetcodeBody?.data?.matchedUser?.recentAcSubmissions;
    if (leetcodeBody?.errors?.length || !Array.isArray(accepted)) {
      return reply(502, { error: 'LeetCode returned an invalid verification response.' });
    }
    const matchStartValue = battle.match_starts_at ?? battle.start_at;
    const matchStart = matchStartValue ? new Date(matchStartValue).getTime() : Number.NaN;
    const deadlineValue = battle.match_deadline ?? battle.end_at;
    const matchDeadline = deadlineValue ? new Date(deadlineValue).getTime() : null;
    const submission = findAcceptedBattleSubmission(accepted, {
      submissionId,
      problemSlug,
      matchStartMs: matchStart,
      matchDeadlineMs: matchDeadline,
    });
    if (!submission) {
      return reply(422, { error: 'LeetCode does not show this submission as accepted for this problem during the battle.' });
    }
    if (!Number.isFinite(matchStart)) {
      return reply(422, { error: 'The accepted submission was made outside this battle window.' });
    }

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/record_battle_solve_verified`, {
      method: 'POST',
      headers: { ...serviceHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_verified_user_id: userId,
        p_battle_id: battleId,
        p_problem_slug: problemSlug,
        p_submission_id: submissionId,
        p_time_taken_ms: input.p_time_taken_ms ?? 0,
        p_runtime_ms: input.p_runtime_ms ?? null,
        p_memory_mb: input.p_memory_mb ?? null,
        p_language: input.p_language ?? null,
      }),
    });
    const result = await rpcResponse.json().catch(() => ({}));
    if (!rpcResponse.ok) {
      console.error('Verified battle solve RPC failed:', rpcResponse.status, result);
      return reply(502, { error: 'The verified solve could not be saved.' });
    }
    return reply(200, result);
  } catch (error) {
    console.error('Battle verification failed:', error);
    return reply(502, { error: 'Battle verification service is temporarily unavailable.' });
  }
});
