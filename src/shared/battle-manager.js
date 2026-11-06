/**
 * Authoritative Battle Manager — Canonical State Machine & Real-Time Sync
 *
 * Implements deterministic scoring:
 * - 1 point per accepted problem
 * - Player with higher solved count wins.
 * - If equal, tiebreaker is total accepted completion time across completed problems.
 * - If still equal, match is declared a draw.
 * - Under no circumstances are lines of code or hardware-dependent runtime/memory beats% used.
 *
 * Canonical State Machine:
 * PENDING -> ACCEPTED -> READY_CHECK -> COUNTDOWN -> IN_PROGRESS -> COMPLETED
 * (Terminal: COMPLETED, DECLINED, EXPIRED, CANCELLED, FORFEITED)
 */

import {
  SUPABASE_URL,
  getAuthHeaders,
  getAuthSession,
  callRpc,
  upsertProfile,
  getOnlineFriends as clientGetOnlineFriends
} from './supabase-client.js';
import { getOwnProfile } from './storage.js';
import { PROBLEMS } from '../data/problems.js';

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
    const baseHeaders = await getAuthHeaders();
    const { headers: optHeaders, ...restOptions } = options;
    const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
      ...restOptions,
      headers: { ...baseHeaders, ...(optHeaders || {}) }
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
// RANDOM PROBLEM GENERATION (SHARED SEQUENCE)
// ─────────────────────────────────────────────────────────────

/**
 * Deterministically or randomly select `count` problems matching filters.
 */
export function generateBattleProblems({ topics = [], difficulty = 'Medium', count = 5 }) {
  const all = PROBLEMS || [];
  if (!all.length) return [];

  const normalizedTopics = Array.isArray(topics) && topics.length > 0
    ? topics.map(t => t.toLowerCase())
    : [];

  // 1. Filter by topic
  let pool = all;
  if (normalizedTopics.length > 0) {
    const topicFiltered = all.filter(p =>
      Array.isArray(p.topics) && p.topics.some(t => normalizedTopics.includes(t.toLowerCase()))
    );
    if (topicFiltered.length >= count) {
      pool = topicFiltered;
    } else {
      pool = topicFiltered; // will backfill later if needed
    }
  }

  // 2. Filter by difficulty
  let filtered = [];
  const targetDiff = (difficulty || 'Medium').toLowerCase();
  const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

  if (targetDiff === 'mixed') {
    const easy = shuffle(pool.filter(p => p.difficulty?.toLowerCase() === 'easy'));
    const med = shuffle(pool.filter(p => p.difficulty?.toLowerCase() === 'medium'));
    const hard = shuffle(pool.filter(p => p.difficulty?.toLowerCase() === 'hard'));

    const numEasy = Math.max(1, Math.floor(count * 0.25));
    const numHard = count >= 5 ? 1 : 0;
    const numMed = count - numEasy - numHard;

    filtered.push(...easy.slice(0, numEasy));
    filtered.push(...med.slice(0, numMed));
    filtered.push(...hard.slice(0, numHard));

    if (filtered.length < count) {
      const existingSlugs = new Set(filtered.map(p => p.slug));
      const remaining = shuffle(pool.filter(p => !existingSlugs.has(p.slug)));
      filtered.push(...remaining.slice(0, count - filtered.length));
    }
  } else {
    const exact = pool.filter(p => p.difficulty?.toLowerCase() === targetDiff);
    if (exact.length >= count) {
      filtered = shuffle(exact).slice(0, count);
    } else {
      const existingSlugs = new Set(exact.map(p => p.slug));
      const others = shuffle(pool.filter(p => !existingSlugs.has(p.slug)));
      filtered = [...exact, ...others].slice(0, count);
    }
  }

  // Backfill from entire dataset if pool was too small
  if (filtered.length < count) {
    const existingSlugs = new Set(filtered.map(p => p.slug));
    const backfill = shuffle(all.filter(p => !existingSlugs.has(p.slug)));
    filtered.push(...backfill.slice(0, count - filtered.length));
  }

  return filtered.slice(0, count).map((p, idx) => ({
    sequence_number: idx + 1,
    slug: p.slug,
    title: p.title,
    url: `https://leetcode.com/problems/${p.slug}/`,
    difficulty: p.difficulty,
    topics: p.topics || []
  }));
}

// ─────────────────────────────────────────────────────────────
// BATTLE V2 LIFECYCLE (TOPIC-BASED 1v1 DUEL)
// ─────────────────────────────────────────────────────────────

/**
 * Create battle challenge v2 with selected DSA topics, difficulty, duration, and problem count
 */
export async function createBattleV2(challenger, challenged, options = {}) {
  const {
    topics = ['Arrays', 'Strings'],
    difficulty = 'Medium',
    durationMinutes = 30,
    problemCount = 5,
    language = 'javascript'
  } = options;

  if (!challenger || !challenged) {
    return { success: false, error: 'Challenger and opponent usernames are required' };
  }
  if (challenger.toLowerCase() === challenged.toLowerCase()) {
    return { success: false, error: 'Cannot challenge yourself' };
  }

  // Proactively ensure challenger's profile is in Supabase profiles
  try {
    const ownData = await getOwnProfile();
    if (challenger && ownData) {
      await upsertProfile(challenger, ownData);
    }
  } catch {}

  // 1. Attempt atomic create_battle_v2 RPC
  try {
    const rpcRes = await callRpc('create_battle_v2', {
      p_challenged_username: challenged.toLowerCase(),
      p_topics: topics,
      p_difficulty: difficulty,
      p_duration_minutes: durationMinutes,
      p_problem_count: problemCount,
      p_language: language.toLowerCase(),
      p_challenger_username: challenger.toLowerCase()
    });

    if (rpcRes && rpcRes.success && rpcRes.battle) {
      return { success: true, battle: rpcRes.battle };
    }

    const isMissingFunction = rpcRes?.code === 'PGRST202' || (
      typeof rpcRes?.error === 'string' && rpcRes.error.includes('PGRST202')
    );

    if (!isMissingFunction && rpcRes?.error) {
      let cleanMsg = rpcRes.error;
      try {
        const parsed = JSON.parse(rpcRes.error);
        cleanMsg = parsed.message || parsed.error || cleanMsg;
      } catch {}
      return { success: false, error: cleanMsg };
    }
  } catch (rpcErr) {
    console.warn('[BattleManager] create_battle_v2 RPC error, falling back to REST:', rpcErr);
  }

  // 2. Direct REST fallback
  const [existingChallenger, existingChallenged] = await Promise.all([
    getActiveBattle(challenger),
    getActiveBattle(challenged)
  ]);

  if (existingChallenger) return { success: false, error: 'You already have an active battle in progress' };
  if (existingChallenged) return { success: false, error: `${challenged} is currently in an active battle` };

  const session = await getAuthSession();
  const profiles = await supabaseFetch(
    `profiles?leetcode_username=in.("${challenger.toLowerCase()}","${challenged.toLowerCase()}")&select=id,leetcode_username`
  );
  let challengerProfile = profiles?.find(p => p.leetcode_username.toLowerCase() === challenger.toLowerCase());
  let challengedProfile = profiles?.find(p => p.leetcode_username.toLowerCase() === challenged.toLowerCase());

  if (!challengerProfile && session?.user_id) {
    const ownData = await getOwnProfile();
    await upsertProfile(challenger, ownData || { profile: { realName: challenger } });
    challengerProfile = { id: session.user_id, leetcode_username: challenger.toLowerCase() };
  }

  const challengerId = session?.user_id || challengerProfile?.id;
  const challengedId = challengedProfile?.id;
  if (!challengedId) return { success: false, error: `${challenged} does not have a LeetStreak account.` };

  const now = Date.now();
  const expiresAt = new Date(now + CHALLENGE_EXPIRY_SECONDS * 1000).toISOString();

  const payload = {
    challenger_id: challengerId,
    challenged_id: challengedId,
    challenger_username: challenger,
    challenged_username: challenged,
    language: language.toLowerCase(),
    status: BATTLE_STATUS.PENDING,
    topics,
    difficulty,
    duration_minutes: durationMinutes,
    problem_count: problemCount,
    expires_at: expiresAt
  };

  const data = await supabaseFetch('battles', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (!data || data.length === 0) return { success: false, error: 'Failed to create battle room' };
  return { success: true, battle: data[0] };
}

/**
 * Accept a battle invitation v2
 */
export async function acceptBattleV2(battleId) {
  if (!battleId) return { success: false, error: 'Battle ID required' };

  // 1. Try atomic accept_battle_v2 RPC
  const rpcRes = await callRpc('accept_battle_v2', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success && rpcRes.battle) {
    return { success: true, battle: rpcRes.battle };
  }

  // 2. Direct REST fallback
  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

  const updated = await supabaseFetch(`battles?id=eq.${battleId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: BATTLE_STATUS.ACCEPTED,
      accepted_at: new Date().toISOString()
    })
  });

  // Create participant rows
  if (battle.challenger_id && battle.challenged_id) {
    await supabaseFetch('battle_participants', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([
        { battle_id: battleId, user_id: battle.challenger_id, username: battle.challenger_username, is_ready: false },
        { battle_id: battleId, user_id: battle.challenged_id, username: battle.challenged_username, is_ready: false }
      ])
    }).catch(() => {});
  }

  return { success: true, battle: updated?.[0] || battle };
}

/**
 * Confirm readiness v2:
 * Passes generated problem sequence to backend so both players get identical sequence.
 */
export async function confirmReadyV2(battleId, username) {
  if (!battleId) return { success: false, error: 'Battle ID required' };

  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

  // Generate sequence matching battle configuration
  const problems = generateBattleProblems({
    topics: battle.topics || ['Arrays', 'Strings'],
    difficulty: battle.difficulty || 'Medium',
    count: battle.problem_count || 5
  });

  // 1. Try atomic confirm_ready_v2 RPC
  const rpcRes = await callRpc('confirm_ready_v2', {
    p_battle_id: battleId,
    p_problems: problems
  });

  if (rpcRes && rpcRes.success) {
    const updated = await getBattle(battleId);
    return {
      success: true,
      battle: updated || rpcRes.battle,
      bothReady: rpcRes.bothReady,
      status: rpcRes.status
    };
  }

  // 2. Fallback to confirmReady
  return await confirmReady(battleId, username);
}

/**
 * Submit an accepted problem solve v2
 */
export async function submitBattleSolveV2(battleId, problemSlug, solveData = {}) {
  const {
    submissionId,
    timeTakenMs = 0,
    runtimeMs = null,
    memoryMb = null,
    language = 'javascript',
    username = 'user'
  } = solveData;

  // 1. Try atomic record_battle_solve RPC
  const rpcRes = await callRpc('record_battle_solve', {
    p_battle_id: battleId,
    p_problem_slug: problemSlug,
    p_submission_id: submissionId || `sub_${Date.now()}`,
    p_time_taken_ms: timeTakenMs,
    p_runtime_ms: runtimeMs,
    p_memory_mb: memoryMb,
    p_language: language
  });

  if (rpcRes && rpcRes.success) {
    return rpcRes;
  }

  // 2. Fallback to submitBattleResult
  const res = await submitBattleResult(battleId, username, {
    problemSlug,
    submissionId,
    accepted: true,
    runtime_ms: runtimeMs,
    memory_mb: memoryMb,
    language,
    timeTakenSeconds: Math.floor(timeTakenMs / 1000)
  });

  return {
    success: res?.success || false,
    solved_count: 1,
    next_problem_slug: null,
    battle_complete: false
  };
}

/**
 * Get full battle state for active battle & reconnection (problems + participants + results)
 */
export async function getBattleStateV2(battleId) {
  if (!battleId) return null;

  // 1. Try atomic get_battle_state_v2 RPC
  const rpcRes = await callRpc('get_battle_state_v2', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success) {
    return rpcRes;
  }

  // 2. Fallback: query tables directly
  const [battle, problems, participants, results] = await Promise.all([
    getBattle(battleId),
    supabaseFetch(`battle_problems?battle_id=eq.${battleId}&order=sequence_number.asc`),
    supabaseFetch(`battle_participants?battle_id=eq.${battleId}`),
    getBattleResults(battleId)
  ]);

  if (!battle) return null;

  return {
    success: true,
    battle,
    problems: problems || [],
    participants: participants || [],
    results: results || []
  };
}

/**
 * Forfeit active battle v2
 */
export async function forfeitBattleV2(battleId, username) {
  const rpcRes = await callRpc('forfeit_battle_v2', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success) {
    return rpcRes;
  }
  return await forfeitBattle(battleId, username);
}

// ─────────────────────────────────────────────────────────────
// LEGACY BATTLE LIFECYCLE (V1 BACK-COMPAT)
// ─────────────────────────────────────────────────────────────

/**
 * Create a new battle challenge room (legacy v1)
 */
export async function createBattle(challenger, challenged, language = 'javascript') {
  return await createBattleV2(challenger, challenged, { language });
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
  if (!data || data.length === 0) return null;
  const b = data[0];

  const now = Date.now();

  // Auto-advance COUNTDOWN -> IN_PROGRESS when countdown completes
  const startsAt = b.start_at || b.match_starts_at;
  if (b.status === BATTLE_STATUS.COUNTDOWN && startsAt && new Date(startsAt).getTime() <= now) {
    b.status = BATTLE_STATUS.IN_PROGRESS;
    supabaseFetch(`battles?id=eq.${b.id}&status=eq.countdown`, {
      method: 'PATCH',
      body: JSON.stringify({ status: BATTLE_STATUS.IN_PROGRESS })
    }).catch(() => {});
  }

  // Auto-finalize if match deadline has passed
  const endsAt = b.end_at || b.match_deadline;
  if (b.status === BATTLE_STATUS.IN_PROGRESS && endsAt && new Date(endsAt).getTime() <= now) {
    checkAndFinalizeBattle(b.id).catch(() => {});
  }

  return b;
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
  if (!accept) {
    await updateBattleStatus(battleId, BATTLE_STATUS.DECLINED);
    return { success: true };
  }
  return await acceptBattleV2(battleId);
}

/**
 * Submit a problem pick (Legacy v1)
 */
export async function submitProblemPick(battleId, username, problemSlug, problemTitle) {
  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

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
 * Confirm readiness (Legacy v1 fallback)
 */
export async function confirmReady(battleId, username) {
  const rpcRes = await callRpc('confirm_battle_ready', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success) {
    const updated = await getBattle(battleId);
    return { success: true, battle: updated, bothReady: rpcRes.status === BATTLE_STATUS.COUNTDOWN };
  }

  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

  const challengerName = battle.challenger_username || battle.challenger;
  const isChallenger = challengerName.toLowerCase() === username.toLowerCase();
  const patchData = isChallenger ? { challenger_ready: true } : { challenged_ready: true };
  const otherIsReady = isChallenger ? battle.challenged_ready : battle.challenger_ready;

  if (otherIsReady) {
    const now = Date.now();
    const duration = (battle.duration_minutes || 30) * 60;
    const countdownStarts = new Date(now).toISOString();
    const matchStartsAt = new Date(now + REVEAL_COUNTDOWN_SECONDS * 1000).toISOString();
    const matchDeadline = new Date(now + (REVEAL_COUNTDOWN_SECONDS + duration) * 1000).toISOString();

    Object.assign(patchData, {
      status: BATTLE_STATUS.COUNTDOWN,
      countdown_starts: countdownStarts,
      match_starts_at: matchStartsAt,
      match_deadline: matchDeadline,
      start_at: matchStartsAt,
      end_at: matchDeadline
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
 * Submit battle result (Legacy v1)
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

  const startTimestamp = (battle.start_at || battle.match_starts_at)
    ? new Date(battle.start_at || battle.match_starts_at).getTime()
    : Date.now();
  const elapsed = timeTakenSeconds != null
    ? timeTakenSeconds
    : Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000));

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
  const challenger = battle.challenger_username;
  const challenged = battle.challenged_username;

  let scoreA = 0, scoreB = 0, timeA = 0, timeB = 0;

  for (const r of results) {
    if (r.accepted) {
      if (r.username.toLowerCase() === challenger.toLowerCase()) {
        scoreA += (r.points || 1);
        timeA += (r.time_taken_seconds || 0);
      } else if (r.username.toLowerCase() === challenged.toLowerCase()) {
        scoreB += (r.points || 1);
        timeB += (r.time_taken_seconds || 0);
      }
    }
  }

  const deadline = battle.end_at || battle.match_deadline;
  const timedOut = deadline && Date.now() >= new Date(deadline).getTime();
  const problemCount = battle.problem_count || 2;
  const bothFinished = (scoreA >= problemCount && scoreB >= problemCount);

  if (bothFinished || timedOut) {
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

  const challengerName = battle.challenger_username;
  const challengedName = battle.challenged_username;

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

  const challengerName = battle.challenger_username;
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
    const challengerName = battle.challenger_username;
    const challengedName = battle.challenged_username;
    const opponent = challengerName.toLowerCase() === username.toLowerCase()
      ? challengedName
      : challengerName;

    const winnerName = battle.winner_username;
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
 * Deterministic battle scoring calculation (used by unit tests)
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
    let rpcRes = await callRpc('heartbeat_presence', {
      p_status: status,
      p_username: username.toLowerCase()
    });
    if (rpcRes && rpcRes.success) return;

    if (rpcRes?.code === 'PGRST202' || (typeof rpcRes?.error === 'string' && rpcRes.error.includes('PGRST202'))) {
      const fallbackRpc = await callRpc('heartbeat_presence', { p_status: status });
      if (fallbackRpc && (fallbackRpc.success || fallbackRpc === true)) return;
    }

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

    const list = usernames.map(u => `"${u.toLowerCase()}"`).join(',');
    const data = await supabaseFetch(`user_presence?username=in.(${list})&select=username,status,last_seen,in_battle`);
    const threshold = Date.now() - 120 * 1000;
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
