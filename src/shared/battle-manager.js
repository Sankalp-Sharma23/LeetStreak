/**
 * Authoritative Battle Manager — Canonical State Machine & Real-Time Sync
 *
 * Implements deterministic scoring:
 * - 1 point per accepted problem (maximum 2 points per participant).
 * - Player with higher solved count wins.
 * - If equal, tiebreaker is total accepted completion time across completed problems.
 * - If still equal, match is declared a draw.
 * - Under no circumstances are lines of code or hardware-dependent runtime/memory beats% used.
 *
 * Canonical State Machine:
 * PENDING -> ACCEPTED -> SELECTING -> READY_CHECK -> COUNTDOWN -> IN_PROGRESS -> COMPLETED
 * (Terminal: COMPLETED, DECLINED, EXPIRED, CANCELLED, FORFEITED)
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, getAuthHeaders, getAuthSession, callRpc, getOnlineFriends as clientGetOnlineFriends } from './supabase-client.js';

const BASE_URL = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');

// Canonical terminal states — match is permanently concluded
export const TERMINAL_STATES = new Set([
  'completed', 'declined', 'expired', 'cancelled', 'forfeited'
]);

// Canonical active match states
export const ACTIVE_STATES = new Set([
  'pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress'
]);

// Single canonical state vocabulary
export const BATTLE_STATUS = {
  PENDING:     'pending',
  ACCEPTED:    'accepted',
  SELECTING:   'selecting',
  READY_CHECK: 'ready_check',
  COUNTDOWN:   'countdown',
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  DECLINED:    'declined',
  EXPIRED:     'expired',
  CANCELLED:   'cancelled',
  FORFEITED:   'forfeited'
};

export const SELECTION_WINDOW_SECONDS  = 5 * 60;        // 5 minutes
export const BATTLE_TIME_LIMIT_SECONDS = 2 * 60 * 60;   // 2 hours
export const CHALLENGE_EXPIRY_SECONDS  = 24 * 60 * 60;  // 24 hours
export const REVEAL_COUNTDOWN_SECONDS  = 10;

// ─────────────────────────────────────────────────────────────
// CORE REST CLIENT WITH AUTHENTICATED HEADERS
// ─────────────────────────────────────────────────────────────

async function supabaseFetch(path, options = {}) {
  if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return null;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
      headers: { ...headers, ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      console.error(`[Battle] Supabase error ${res.status} on ${path}:`, await res.text());
      return null;
    }
    return res.json();
  } catch (err) {
    console.error('[Battle] Supabase fetch error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BATTLE LIFECYCLE
// ─────────────────────────────────────────────────────────────

/**
 * Create a new battle challenge room with locked programming language
 */
export async function createBattle(challenger, challenged, language = 'javascript') {
  if (!challenger || !challenged) {
    return { success: false, error: 'Challenger and opponent usernames are required' };
  }
  if (challenger.toLowerCase() === challenged.toLowerCase()) {
    return { success: false, error: 'Cannot challenge yourself' };
  }

  // 1. Attempt atomic server-authoritative RPC
  try {
    const rpcRes = await callRpc('create_battle_challenge', {
      p_challenged_username: challenged.toLowerCase(),
      p_language: language.toLowerCase()
    });
    if (rpcRes && rpcRes.success && rpcRes.battle) {
      return { success: true, battle: rpcRes.battle };
    }
    if (rpcRes && rpcRes.error) {
      return { success: false, error: rpcRes.error };
    }
  } catch (rpcErr) {
    console.warn('[BattleManager] create_battle_challenge RPC error, using REST fallback:', rpcErr);
  }

  // 2. Direct REST fallback
  const [existingChallenger, existingChallenged] = await Promise.all([
    getActiveBattle(challenger),
    getActiveBattle(challenged)
  ]);

  if (existingChallenger) {
    return { success: false, error: 'You already have an active battle in progress' };
  }
  if (existingChallenged) {
    return { success: false, error: `${challenged} is currently in an active battle` };
  }

  const session = await getAuthSession();
  const profiles = await supabaseFetch(`profiles?leetcode_username=in.("${challenger.toLowerCase()}","${challenged.toLowerCase()}")&select=id,leetcode_username`);
  const challengerProfile = profiles?.find(p => p.leetcode_username.toLowerCase() === challenger.toLowerCase());
  const challengedProfile = profiles?.find(p => p.leetcode_username.toLowerCase() === challenged.toLowerCase());

  const challengerId = session?.user_id || challengerProfile?.id;
  const challengedId = challengedProfile?.id;

  const now = Date.now();
  const expiresAt = new Date(now + CHALLENGE_EXPIRY_SECONDS * 1000).toISOString();

  const payload = {
    challenger_username: challenger,
    challenged_username: challenged,
    language: language.toLowerCase(),
    status: BATTLE_STATUS.PENDING,
    expires_at: expiresAt
  };

  if (challengerId) payload.challenger_id = challengerId;
  if (challengedId) payload.challenged_id = challengedId;

  const data = await supabaseFetch('battles', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (!data || data.length === 0) return { success: false, error: 'Failed to create battle room' };
  return { success: true, battle: data[0] };
}

/**
 * Get active battle for a user
 */
export async function getActiveBattle(username) {
  if (!username) return null;
  const terminalList = Array.from(TERMINAL_STATES).join(',');
  const normalized = username.toLowerCase();
  const data = await supabaseFetch(
    `battles?or=(challenger_username.ilike.${normalized},challenged_username.ilike.${normalized})&status=not.in.(${terminalList})&order=created_at.desc&limit=1`
  );
  return data && data.length > 0 ? data[0] : null;
}

/**
 * Get battle by ID
 */
export async function getBattle(battleId) {
  if (!battleId) return null;
  const data = await supabaseFetch(`battles?id=eq.${battleId}&select=*`);
  return data && data.length > 0 ? data[0] : null;
}

/**
 * Get all results associated with a battle
 */
export async function getBattleResults(battleId) {
  if (!battleId) return [];
  const data = await supabaseFetch(`battle_results?battle_id=eq.${battleId}&select=*`);
  return data || [];
}

/**
 * Accept or decline a battle invitation
 */
export async function respondToBattle(battleId, username, accept) {
  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };
  
  const opponentName = battle.challenged_username || battle.challenged;
  if (opponentName.toLowerCase() !== username.toLowerCase()) {
    return { success: false, error: 'You are not the invited opponent for this battle' };
  }
  if (battle.status !== BATTLE_STATUS.PENDING) {
    return { success: false, error: `Battle is no longer pending (current: ${battle.status})` };
  }

  if (new Date(battle.expires_at) < new Date()) {
    await updateBattleStatus(battleId, BATTLE_STATUS.EXPIRED);
    return { success: false, error: 'Challenge has expired' };
  }

  if (!accept) {
    await updateBattleStatus(battleId, BATTLE_STATUS.DECLINED);
    return { success: true, battle: { ...battle, status: BATTLE_STATUS.DECLINED } };
  }

  const now = new Date();
  const data = await supabaseFetch(`battles?id=eq.${battleId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: BATTLE_STATUS.SELECTING,
      accepted_at: now.toISOString()
    })
  });

  if (!data || data.length === 0) return { success: false, error: 'Failed to accept battle' };
  return { success: true, battle: data[0] };
}

/**
 * Submit a problem pick (Challenger contributes 1 problem, Opponent contributes 1 problem)
 */
export async function submitProblemPick(battleId, username, problemSlug, problemTitle) {
  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };
  if (battle.status !== BATTLE_STATUS.SELECTING) {
    return { success: false, error: 'Battle is not in the problem selection phase' };
  }

  // Validate problem on LeetCode first
  const validated = await validateLeetCodeProblem(problemSlug);
  if (!validated.valid) {
    return { success: false, error: validated.error || 'Invalid LeetCode problem' };
  }

  const challengerName = battle.challenger_username || battle.challenger;
  const isChallenger = challengerName.toLowerCase() === username.toLowerCase();
  const pickSlugField = isChallenger ? 'challenger_pick' : 'challenged_pick';
  const pickTitleField = isChallenger ? 'challenger_pick_title' : 'challenged_pick_title';
  const otherPick = isChallenger ? battle.challenged_pick : battle.challenger_pick;
  const otherTitle = isChallenger ? battle.challenged_pick_title : battle.challenger_pick_title;

  const patchData = {
    [pickSlugField]: validated.slug,
    [pickTitleField]: validated.title || problemTitle || validated.slug
  };

  // If both players have now submitted a problem, assign Problem 1 and Problem 2 and advance to READY_CHECK
  if (otherPick) {
    Object.assign(patchData, {
      problem_1: validated.slug,
      problem_1_title: validated.title,
      problem_2: otherPick,
      problem_2_title: otherTitle || otherPick,
      status: BATTLE_STATUS.READY_CHECK,
      challenger_ready: false,
      challenged_ready: false
    });
  }

  const data = await supabaseFetch(`battles?id=eq.${battleId}`, {
    method: 'PATCH',
    body: JSON.stringify(patchData)
  });

  if (!data || data.length === 0) return { success: false, error: 'Failed to save problem selection' };

  return {
    success: true,
    battle: data[0],
    bothPicked: !!otherPick
  };
}

/**
 * Confirm readiness for the ready check.
 * Uses atomic RPC `confirm_battle_ready` when available, with synchronized timestamps.
 */
export async function confirmReady(battleId, username) {
  // First attempt atomic RPC call
  const rpcRes = await callRpc('confirm_battle_ready', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success) {
    const updated = await getBattle(battleId);
    return { success: true, battle: updated, bothReady: rpcRes.status === BATTLE_STATUS.COUNTDOWN };
  }

  // Fallback REST path
  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

  const challengerName = battle.challenger_username || battle.challenger;
  const isChallenger = challengerName.toLowerCase() === username.toLowerCase();
  const patchData = isChallenger ? { challenger_ready: true } : { challenged_ready: true };
  const otherIsReady = isChallenger ? battle.challenged_ready : battle.challenger_ready;

  if (otherIsReady) {
    const now = Date.now();
    const countdownStarts = new Date(now).toISOString();
    const matchStartsAt = new Date(now + REVEAL_COUNTDOWN_SECONDS * 1000).toISOString();
    const matchDeadline = new Date(now + (REVEAL_COUNTDOWN_SECONDS + BATTLE_TIME_LIMIT_SECONDS) * 1000).toISOString();

    Object.assign(patchData, {
      status: BATTLE_STATUS.COUNTDOWN,
      countdown_starts: countdownStarts,
      match_starts_at: matchStartsAt,
      match_deadline: matchDeadline
    });
  }

  const data = await supabaseFetch(`battles?id=eq.${battleId}`, {
    method: 'PATCH',
    body: JSON.stringify(patchData)
  });

  if (!data || data.length === 0) return { success: false, error: 'Failed to record readiness' };
  return { success: true, battle: data[0], bothReady: !!otherIsReady };
}

/**
 * Submit a verified battle submission with idempotency key.
 * Uses atomic RPC `record_battle_submission` to prevent client tampering.
 */
export async function submitBattleResult(battleId, username, resultData) {
  const {
    problemSlug,
    submissionId,
    accepted,
    runtime_ms,
    memory_mb,
    language,
    timeTakenSeconds
  } = resultData;

  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

  if (TERMINAL_STATES.has(battle.status)) {
    return { success: false, error: `Battle is already closed (${battle.status})` };
  }

  // Calculate elapsed time from match_starts_at
  const startTimestamp = battle.match_starts_at ? new Date(battle.match_starts_at).getTime() : Date.now();
  const elapsed = timeTakenSeconds != null 
    ? timeTakenSeconds 
    : Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000));

  // Execute atomic RPC submission
  const rpcRes = await callRpc('record_battle_submission', {
    p_battle_id: battleId,
    p_problem_slug: problemSlug,
    p_submission_id: submissionId || `sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    p_accepted: !!accepted,
    p_time_taken: elapsed,
    p_runtime_ms: runtime_ms || null,
    p_memory_mb: memory_mb || null,
    p_language: language || battle.language || 'javascript'
  });

  if (rpcRes && rpcRes.success) {
    return { success: true, result: rpcRes };
  }

  // Fallback REST insertion if RPC unavailable
  const insertData = await supabaseFetch('battle_results', {
    method: 'POST',
    body: JSON.stringify({
      battle_id: battleId,
      username,
      problem_slug: problemSlug,
      leetcode_submission_id: submissionId || `sub_${Date.now()}`,
      accepted: !!accepted,
      submitted_at: new Date().toISOString(),
      time_taken_seconds: elapsed,
      runtime_ms: runtime_ms || null,
      memory_mb: memory_mb || null,
      language: language || battle.language || 'javascript',
      attempts: 1,
      points: accepted ? 1 : 0
    })
  });

  // Evaluate state transitions
  await checkAndFinalizeBattle(battleId);

  return { success: true, result: insertData?.[0] };
}

/**
 * Authoritative check and finalize match
 */
export async function checkAndFinalizeBattle(battleId) {
  const rpcRes = await callRpc('evaluate_and_finalize_battle', { p_battle_id: battleId });
  if (rpcRes && rpcRes.finalized) {
    return rpcRes;
  }

  const battle = await getBattle(battleId);
  if (!battle || TERMINAL_STATES.has(battle.status)) return null;

  const results = await getBattleResults(battleId);
  const challenger = battle.challenger_username || battle.challenger;
  const challenged = battle.challenged_username || battle.challenged;

  let scoreA = 0, scoreB = 0, timeA = 0, timeB = 0;
  let p1A = false, p2A = false, p1B = false, p2B = false;

  for (const r of results) {
    if (r.accepted) {
      if (r.username.toLowerCase() === challenger.toLowerCase()) {
        scoreA += (r.points || 1);
        timeA += (r.time_taken_seconds || 0);
        if (r.problem_slug === battle.problem_1) p1A = true;
        if (r.problem_slug === battle.problem_2) p2A = true;
      } else if (r.username.toLowerCase() === challenged.toLowerCase()) {
        scoreB += (r.points || 1);
        timeB += (r.time_taken_seconds || 0);
        if (r.problem_slug === battle.problem_1) p1B = true;
        if (r.problem_slug === battle.problem_2) p2B = true;
      }
    }
  }

  const bothCompleted = (p1A && p2A) && (p1B && p2B);
  const timedOut = battle.match_deadline && Date.now() >= new Date(battle.match_deadline).getTime();

  if (bothCompleted || timedOut) {
    let winner = 'draw';
    let winReason = 'draw';

    if (scoreA > scoreB) {
      winner = challenger;
      winReason = 'points';
    } else if (scoreB > scoreA) {
      winner = challenged;
      winReason = 'points';
    } else {
      if (scoreA > 0) {
        if (timeA < timeB) { winner = challenger; winReason = 'tiebreaker_time'; }
        else if (timeB < timeA) { winner = challenged; winReason = 'tiebreaker_time'; }
        else { winner = 'draw'; winReason = 'draw'; }
      } else {
        winner = 'draw';
        winReason = 'draw';
      }
    }

    await updateBattleStatus(battleId, BATTLE_STATUS.COMPLETED, {
      winner_username: winner,
      win_reason: winReason,
      completed_at: new Date().toISOString()
    });

    return { finalized: true, winner, winReason };
  }

  return null;
}

/**
 * Forfeit active battle
 */
export async function forfeitBattle(battleId, username) {
  const rpcRes = await callRpc('forfeit_battle', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success) {
    return rpcRes;
  }

  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

  const challengerName = battle.challenger_username || battle.challenger;
  const challengedName = battle.challenged_username || battle.challenged;

  const winner = challengerName.toLowerCase() === username.toLowerCase()
    ? challengedName
    : challengerName;

  await updateBattleStatus(battleId, BATTLE_STATUS.FORFEITED, {
    winner_username: winner,
    win_reason: 'forfeit',
    completed_at: new Date().toISOString()
  });

  return { success: true, winner };
}

/**
 * Cancel a pending challenge
 */
export async function cancelBattle(battleId, username) {
  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };
  
  const challengerName = battle.challenger_username || battle.challenger;
  if (challengerName.toLowerCase() !== username.toLowerCase()) {
    return { success: false, error: 'Only the challenger can cancel a pending match' };
  }
  if (battle.status !== BATTLE_STATUS.PENDING) {
    return { success: false, error: 'Can only cancel pending challenges' };
  }

  await updateBattleStatus(battleId, BATTLE_STATUS.CANCELLED);
  return { success: true };
}

/**
 * Get battle history for a user
 */
export async function getBattleHistory(username, limit = 10) {
  if (!username) return [];
  const normalized = username.toLowerCase();
  const data = await supabaseFetch(
    `battles?or=(challenger_username.ilike.${normalized},challenged_username.ilike.${normalized})&status=in.(completed,forfeited)&order=created_at.desc&limit=${limit}`
  );
  if (!data || data.length === 0) return [];

  const enriched = await Promise.all(data.map(async (battle) => {
    const results = await getBattleResults(battle.id);
    const challengerName = battle.challenger_username || battle.challenger;
    const challengedName = battle.challenged_username || battle.challenged;
    const opponent = challengerName.toLowerCase() === username.toLowerCase()
      ? challengedName
      : challengerName;

    const winnerName = battle.winner_username || battle.winner;
    let outcome = 'draw';
    if (winnerName) {
      if (winnerName === 'draw') outcome = 'draw';
      else if (winnerName.toLowerCase() === username.toLowerCase()) outcome = 'win';
      else outcome = 'loss';
    }

    return {
      ...battle,
      opponent,
      outcome,
      results
    };
  }));

  return enriched;
}

/**
 * Deterministic battle scoring calculation:
 * - 1 point per accepted problem
 * - Higher points wins
 * - If equal, tiebreaker is total accepted completion time across completed problems
 * - If still equal, draw
 * - NO points for lines-of-code, runtime beats%, or memory beats%.
 */
export function calculateScores(r1, r2, allResults1 = [], allResults2 = []) {
  let score1 = 0;
  let score2 = 0;
  let time1 = 0;
  let time2 = 0;

  if (Array.isArray(allResults1) && allResults1.length > 0) {
    for (const r of allResults1) {
      if (r?.accepted) {
        score1 += (r.points || 1);
        time1 += (r.time_taken_seconds || 0);
      }
    }
  } else if (r1?.accepted) {
    score1 = 1;
    time1 = r1.time_taken_seconds || 0;
  }

  if (Array.isArray(allResults2) && allResults2.length > 0) {
    for (const r of allResults2) {
      if (r?.accepted) {
        score2 += (r.points || 1);
        time2 += (r.time_taken_seconds || 0);
      }
    }
  } else if (r2?.accepted) {
    score2 = 1;
    time2 = r2.time_taken_seconds || 0;
  }

  let winner = 'draw';
  if (score1 > score2) winner = 'p1';
  else if (score2 > score1) winner = 'p2';
  else {
    if (score1 > 0) {
      if (time1 < time2) winner = 'p1';
      else if (time2 < time1) winner = 'p2';
      else winner = 'draw';
    } else {
      winner = 'draw';
    }
  }

  const breakdown = {
    solved: score1 > score2 ? 'r1' : score2 > score1 ? 'r2' : 'tie',
    speed: (time1 > 0 && time2 > 0) 
      ? (time1 < time2 ? 'r1' : time2 < time1 ? 'r2' : 'tie')
      : (score1 > 0 ? 'r1' : score2 > 0 ? 'r2' : 'tie')
  };

  return {
    score1,
    score2,
    time1,
    time2,
    winner,
    breakdown
  };
}

// ─────────────────────────────────────────────────────────────
// PROBLEM VALIDATION & PRESENCE
// ─────────────────────────────────────────────────────────────

export async function validateLeetCodeProblem(slugOrUrl) {
  try {
    let slug = slugOrUrl.trim();
    if (slug.includes('leetcode.com/problems/')) {
      const match = slug.match(/problems\/([^/?#]+)/);
      if (!match) return { valid: false, error: 'Invalid LeetCode URL structure' };
      slug = match[1].replace(/\/$/, '');
    }

    if (!/^[a-z0-9-]+$/i.test(slug)) {
      return { valid: false, error: 'Invalid problem slug format' };
    }

    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query getProblem($slug: String!) {
          question(titleSlug: $slug) {
            title
            difficulty
            isPaidOnly
          }
        }`,
        variables: { slug: slug.toLowerCase() }
      })
    });

    if (!res.ok) return { valid: false, error: 'Failed to contact LeetCode API' };
    const data = await res.json();
    const q = data?.data?.question;

    if (!q) return { valid: false, error: 'Problem not found on LeetCode' };
    if (q.isPaidOnly) return { valid: false, error: 'Premium problem — please select a free problem' };

    return {
      valid: true,
      slug: slug.toLowerCase(),
      title: q.title,
      difficulty: q.difficulty,
      url: `https://leetcode.com/problems/${slug.toLowerCase()}/`
    };
  } catch (err) {
    console.warn('[Battle] validateLeetCodeProblem error:', err);
    return { valid: false, error: 'Connection error while validating problem' };
  }
}

export async function updatePresence(username, status = 'online') {
  if (!username || !SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return;
  try {
    // 1. Try atomic server-side heartbeat RPC
    const rpcRes = await callRpc('heartbeat_presence', { p_status: status });
    if (rpcRes && rpcRes.success) return;

    // 2. Direct upsert fallback with session user_id
    const session = await getAuthSession();
    if (session?.user_id) {
      await supabaseFetch('user_presence', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: session.user_id,
          username: username.toLowerCase(),
          last_seen: new Date().toISOString(),
          status: status
        })
      });
    }
  } catch (err) {
    console.warn('[BattleManager] updatePresence failed:', err);
  }
}

export async function getPresence(usernames) {
  const result = new Map();
  if (!usernames?.length || !SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return result;
  try {
    // 1. Try atomic RPC get_friends_presence
    const rpcRes = await callRpc('get_friends_presence', { p_usernames: usernames });
    if (rpcRes && typeof rpcRes === 'object' && !rpcRes.error) {
      for (const [uname, info] of Object.entries(rpcRes)) {
        result.set(uname.toLowerCase(), {
          status: info.status || 'offline',
          isOnline: !!info.isOnline,
          inBattle: !!info.inBattle,
          last_seen: info.last_seen
        });
      }
      return result;
    }

    // 2. Direct table query fallback with 120s threshold
    const list = usernames.map(u => `"${u.toLowerCase()}"`).join(',');
    const data = await supabaseFetch(`user_presence?username=in.(${list})&select=username,status,last_seen,in_battle`);
    const threshold = Date.now() - 120 * 1000; // 120 seconds
    for (const row of (data || [])) {
      const isRecent = row.last_seen && new Date(row.last_seen).getTime() > threshold;
      const status = !isRecent ? 'offline' : (row.in_battle ? 'in_battle' : (row.status || 'online'));
      result.set(row.username.toLowerCase(), {
        status,
        isOnline: status === 'online' || status === 'in_battle',
        inBattle: status === 'in_battle',
        last_seen: row.last_seen
      });
    }
  } catch (err) {
    console.warn('[BattleManager] getPresence failed:', err);
  }
  return result;
}

export { clientGetOnlineFriends as getOnlineFriends };

async function updateBattleStatus(battleId, status, extra = {}) {
  await supabaseFetch(`battles?id=eq.${battleId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...extra })
  });
}
