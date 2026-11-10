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
  callEdgeFunction,
  callRpc,
  getOnlineFriends as clientGetOnlineFriends
} from './supabase-client.js';
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
export function generateBattleProblems({ topics = [], difficulty = 'Medium', count = 5, excludeSlugs = [] }) {
  const excluded = new Set(excludeSlugs.map(slug => slug.toLowerCase()));
  const all = (PROBLEMS || []).filter(problem => !excluded.has(problem.slug.toLowerCase()));
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

  // The JWT identifies the challenger. Profile setup is an explicit auth
  // lifecycle operation; the battle payload must not create or relink it.

  // Battle writes must go through the transactional RPCs; REST fallbacks bypass
  // the participant and active-match checks enforced by the database.
  const rpcRes = await callRpc('create_battle_v2', {
      p_challenged_username: challenged.toLowerCase(),
      p_topics: topics,
      p_difficulty: difficulty,
      p_duration_minutes: durationMinutes,
      p_problem_count: problemCount,
      p_language: language.toLowerCase()
    });
  if (rpcRes?.success && rpcRes.battle) return { success: true, battle: rpcRes.battle };
  return { success: false, error: rpcRes?.error || 'Battle service unavailable.' };
}

/**
 * Accept a battle invitation v2
 */
export async function acceptBattleV2(battleId) {
  if (!battleId) return { success: false, error: 'Battle ID required' };

  // Accepting is an authoritative state transition; never emulate it with REST writes.
  const rpcRes = await callRpc('accept_battle_v2', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success && rpcRes.battle) {
    return { success: true, battle: rpcRes.battle };
  }
  return { success: false, error: rpcRes?.error || 'Battle service unavailable.' };
}

/**
 * Confirm readiness v2:
 * Passes generated problem sequence to backend so both players get identical sequence.
 */
export async function confirmReadyV2(battleId, _username) {
  if (!battleId) return { success: false, error: 'Battle ID required' };

  const battle = await getBattle(battleId);
  if (!battle) return { success: false, error: 'Battle not found' };

  // Generate sequence matching battle configuration
  const selection = {
    topics: battle.topics || ['Arrays', 'Strings'],
    difficulty: battle.difficulty || 'Medium',
    count: battle.problem_count || 5
  };
  const requestedCount = selection.count;
  const problems = [];
  const checkedSlugs = new Set();
  while (problems.length < requestedCount && checkedSlugs.size < PROBLEMS.length) {
    const candidates = generateBattleProblems({
      ...selection,
      count: requestedCount - problems.length,
      excludeSlugs: [...checkedSlugs]
    });
    if (!candidates.length) break;

    for (const candidate of candidates) {
      checkedSlugs.add(candidate.slug);
      const validation = await validateLeetCodeProblem(candidate.slug);
      if (!validation.valid) {
        if (/premium/i.test(validation.error || '')) continue;
        return { success: false, error: `Could not verify ${candidate.title} with LeetCode. Please try again.` };
      }
      problems.push({ ...candidate, title: validation.title, difficulty: validation.difficulty });
      if (problems.length === requestedCount) break;
    }
  }

  if (problems.length < requestedCount) {
    return { success: false, error: 'Not enough verified free problems are available for this battle.' };
  }

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

  return { success: false, error: rpcRes?.error || 'Battle service unavailable.' };
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
    language = 'javascript'
  } = solveData;

  const validSubmissionId = submissionId && String(submissionId).trim()
    ? String(submissionId).trim()
    : `sub_${Date.now()}`;

  const params = {
    p_battle_id: battleId,
    p_problem_slug: problemSlug,
    p_submission_id: validSubmissionId,
    p_time_taken_ms: timeTakenMs,
    p_runtime_ms: runtimeMs,
    p_memory_mb: memoryMb,
    p_language: language
  };

  // 1. Try Edge Function if configured and deployed
  try {
    const edgeRes = await callEdgeFunction('record-battle-solve', params);
    if (edgeRes && edgeRes.success) {
      return edgeRes;
    }
    // If it's a definitive terminal rejection from the server, return it
    if (edgeRes?.error && /already finalized|deadline has passed|not in this battle/i.test(edgeRes.error)) {
      return edgeRes;
    }
  } catch (err) {
    console.warn('[BattleManager] Edge function record-battle-solve unavailable, falling back to direct RPC:', err);
  }

  // 2. Fallback to direct Postgres RPC record_battle_solve
  try {
    const rpcRes = await callRpc('record_battle_solve', params);
    if (rpcRes && rpcRes.success) {
      return rpcRes;
    }
    if (rpcRes?.error) {
      return { success: false, error: rpcRes.error };
    }
  } catch (err) {
    console.warn('[BattleManager] record_battle_solve RPC call failed:', err);
  }

  return { success: false, error: 'Battle service unavailable.' };
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
export async function forfeitBattleV2(battleId, _username) {
  const rpcRes = await callRpc('forfeit_battle_v2', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success) {
    return rpcRes;
  }
  return { success: false, error: rpcRes?.error || 'Battle service unavailable.' };
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
  const response = await callRpc('get_my_active_battle');
  if (!response?.success || !response.battle) return null;
  const b = response.battle;
  const now = Date.now();
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
  const result = await callRpc('respond_battle_v2', {
    p_battle_id: battleId,
    p_accept: Boolean(accept)
  });
  return result?.success ? result : { success: false, error: result?.error || 'Battle service unavailable.' };
}

/**
 * Submit a problem pick (Legacy v1)
 */
export async function submitProblemPick(_battleId, _username, _problemSlug, _problemTitle) {
  return { success: false, error: 'Manual problem picks are not supported by the current battle flow' };
}

/**
 * Confirm readiness (Legacy v1 fallback)
 */
export async function confirmReady(battleId, _username) {
  const rpcRes = await callRpc('confirm_battle_ready', { p_battle_id: battleId });
  if (rpcRes && rpcRes.success) {
    const updated = await getBattle(battleId);
    return { success: true, battle: updated, bothReady: rpcRes.status === BATTLE_STATUS.COUNTDOWN };
  }
  return { success: false, error: rpcRes?.error || 'Battle service unavailable.' };
}

/**
 * Submit battle result (Legacy v1)
 */
export async function submitBattleResult(battleId, _username, resultData) {
  const {
    problemSlug,
    submissionId,
    accepted,
    runtime_ms,
    memory_mb,
    language,
    timeTakenSeconds
  } = resultData;

  if (accepted !== true) return { success: false, error: 'Only a confirmed Accepted result can be recorded' };
  return submitBattleSolveV2(battleId, problemSlug, {
    submissionId,
    timeTakenMs: timeTakenSeconds == null ? 0 : Math.max(0, timeTakenSeconds) * 1000,
    runtimeMs: runtime_ms,
    memoryMb: memory_mb,
    language
  });
}

/**
 * Authoritative check and finalize match
 */
export async function checkAndFinalizeBattle(battleId) {
  const rpcRes = await callRpc('evaluate_and_finalize_battle', { p_battle_id: battleId });
  if (rpcRes && rpcRes.finalized) {
    return rpcRes;
  }

  // Scores and finalization must remain server-owned; never patch a winner from a client.
  return null;
}

/**
 * Forfeit active battle
 */
export async function forfeitBattle(battleId, _username) {
  return forfeitBattleV2(battleId);
}

/**
 * Cancel a pending challenge
 */
export async function cancelBattle(battleId, _username) {
  const result = await callRpc('cancel_battle_v2', { p_battle_id: battleId });
  return result?.success ? result : { success: false, error: result?.error || 'Battle service unavailable.' };
}

/**
 * Get battle history for a user
 */
export async function getBattleHistory(username, limit = 10) {
  if (!username) return [];
  const response = await callRpc('get_my_recent_battles', { p_limit: limit });
  return response?.success && Array.isArray(response.rows) ? response.rows : [];
}

export async function getBattleHistoryScoreboard(filters = {}, limit = 12, offset = 0) {
  const rpcRes = await callRpc('get_battle_history_scoreboard', {
    p_result_filter: filters.result || 'all',
    p_topic_filter: filters.topic && filters.topic !== 'all' ? filters.topic : null,
    p_difficulty_filter: filters.difficulty || 'all',
    p_opponent_id: filters.opponentId && filters.opponentId !== 'all' ? filters.opponentId : null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_limit: limit,
    p_offset: offset
  });

  if (rpcRes && rpcRes.success) {
    return rpcRes;
  }

  // Fallback: Group completed battles per opponent in JS
  try {
    const session = await getAuthSession();
    const myId = session?.user_id || null;
    let storedUsername = '';
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get('my_leetcode_username');
      storedUsername = (stored?.my_leetcode_username || '').toLowerCase();
    }

    const battles = await getBattleHistory(storedUsername, 50);
    if (!Array.isArray(battles) || battles.length === 0) {
      return { success: true, rows: [], opponents: [], total_opponents: 0, total_matches: 0, has_more: false };
    }

    const groupedMap = new Map();
    for (const b of battles) {
      if (!['completed', 'forfeited'].includes(b.status)) continue;
      const challenger = (b.challenger_username || '').toLowerCase();
      const challenged = (b.challenged_username || '').toLowerCase();
      // Exclude test self-battles
      if (challenger && challenged && challenger === challenged) continue;
      if (myId && b.challenger_id && b.challenged_id && b.challenger_id === b.challenged_id) continue;

      const isChallenger = storedUsername ? challenger === storedUsername : (myId && b.challenger_id === myId);
      const oppUsername = isChallenger ? (b.challenged_username || challenged) : (b.challenger_username || challenger);
      const oppId = isChallenger ? (b.challenged_id || oppUsername) : (b.challenger_id || oppUsername);
      if (!oppUsername) continue;
      if (storedUsername && oppUsername.toLowerCase() === storedUsername) continue;
      if (myId && oppId === myId) continue;

      const winner = (b.winner_username || '').toLowerCase();
      const iWon = winner && winner !== 'draw' && (winner === storedUsername || b.winner_id === myId);
      const oppWon = winner && winner !== 'draw' && !iWon;
      const isDraw = winner === 'draw' || !winner;

      const key = oppUsername.toLowerCase();
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          opponent_id: oppId,
          opponent_username: oppUsername,
          my_username: storedUsername || 'you',
          my_wins: 0,
          opponent_wins: 0,
          draws: 0,
          completed_battles: 0,
          last_battle_at: b.completed_at || b.created_at
        });
      }

      const rec = groupedMap.get(key);
      if (iWon) rec.my_wins++;
      else if (oppWon) rec.opponent_wins++;
      else if (isDraw) rec.draws++;
      rec.completed_battles++;
    }

    const allRows = Array.from(groupedMap.values());
    const rows = allRows.slice(offset, offset + limit);
    return {
      success: true,
      rows,
      opponents: allRows.map(r => ({ opponent_id: r.opponent_id, opponent_username: r.opponent_username })),
      total_opponents: allRows.length,
      total_matches: battles.length,
      has_more: offset + limit < allRows.length
    };
  } catch {
    return rpcRes || { success: false, error: 'Could not load battle history.' };
  }
}

export async function getBattleHistoryDetails(opponentId, filters = {}, limit = 10, offset = 0) {
  return await callRpc('get_battle_history_details_v2', {
    p_opponent_id: opponentId,
    p_result_filter: filters.result || 'all',
    p_topic_filter: filters.topic && filters.topic !== 'all' ? filters.topic : null,
    p_difficulty_filter: filters.difficulty || 'all',
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_limit: limit,
    p_offset: offset
  });
}

const PERFORMANCE_WINDOW_MS = 2000;

function metricEfficiencyScore(value1, value2) {
  if (value1 === value2) return [50, 50];
  return value1 < value2 ? [100, 0] : [0, 100];
}

export function compareBattlePerformance(result1, result2) {
  if (!result1?.accepted || !result2?.accepted || result1.problem_slug !== result2.problem_slug) {
    return { eligible: false, reason: 'different_problem_or_not_accepted' };
  }

  const submitted1 = Date.parse(result1.submitted_at);
  const submitted2 = Date.parse(result2.submitted_at);
  if (!Number.isFinite(submitted1) || !Number.isFinite(submitted2) || Math.abs(submitted1 - submitted2) > PERFORMANCE_WINDOW_MS) {
    return { eligible: false, reason: 'not_simultaneous' };
  }

  const memory1 = Number(result1.memory_mb);
  const memory2 = Number(result2.memory_mb);
  const runtime1 = Number(result1.runtime_ms);
  const runtime2 = Number(result2.runtime_ms);
  if (result1.memory_mb == null || result2.memory_mb == null || result1.runtime_ms == null || result2.runtime_ms == null ||
      ![memory1, memory2, runtime1, runtime2].every(Number.isFinite) || memory1 <= 0 || memory2 <= 0 || runtime1 < 0 || runtime2 < 0) {
    return { eligible: false, reason: 'performance_unavailable' };
  }

  const [spaceScore1, spaceScore2] = metricEfficiencyScore(memory1, memory2);
  const [timeScore1, timeScore2] = metricEfficiencyScore(runtime1, runtime2);
  const finalScore1 = Number((spaceScore1 * 0.7 + timeScore1 * 0.3).toFixed(6));
  const finalScore2 = Number((spaceScore2 * 0.7 + timeScore2 * 0.3).toFixed(6));

  return {
    eligible: true,
    reason: 'performance',
    memory1,
    memory2,
    runtime1,
    runtime2,
    spaceScore1,
    spaceScore2,
    timeScore1,
    timeScore2,
    finalScore1,
    finalScore2,
    winner: finalScore1 > finalScore2 ? 'p1' : finalScore2 > finalScore1 ? 'p2' : 'draw'
  };
}

/** Points decide first; server elapsed time breaks ordinary ties, with a
 * normalized 70/30 efficiency comparison for same-problem accepts within 2s. */
export function calculateScores(r1, r2, allResults1 = [], allResults2 = []) {
  const uniqueAccepted = (rows, single) => {
    const accepted = rows.length ? rows.filter(r => r?.accepted) : single?.accepted ? [single] : [];
    const unique = new Map();
    accepted.forEach((row, index) => {
      const key = row.problem_slug || row.leetcode_submission_id || `row-${index}`;
      const previous = unique.get(key);
      if (!previous || Date.parse(row.submitted_at) < Date.parse(previous.submitted_at)) unique.set(key, row);
    });
    return [...unique.values()];
  };
  const results1 = uniqueAccepted(allResults1, r1);
  const results2 = uniqueAccepted(allResults2, r2);
  const score1 = results1.length;
  const score2 = results2.length;
  const totalMs = rows => rows.reduce((sum, row) => sum + (row.time_taken_ms != null && Number.isFinite(Number(row.time_taken_ms))
    ? Number(row.time_taken_ms)
    : Math.max(0, Number(row.time_taken_seconds) || 0) * 1000), 0);
  const time1 = totalMs(results1);
  const time2 = totalMs(results2);
  const byProblem2 = new Map(results2.map(row => [row.problem_slug, row]));
  const performanceComparisons = results1
    .map(row => byProblem2.has(row.problem_slug) ? compareBattlePerformance(row, byProblem2.get(row.problem_slug)) : null)
    .filter(result => result?.eligible);
  const hasUnavailableSimultaneousPair = results1.some(row => {
    const other = byProblem2.get(row.problem_slug);
    return other && compareBattlePerformance(row, other).reason === 'performance_unavailable';
  });

  let winner = 'draw';
  let reason = 'draw';
  if (score1 > score2) { winner = 'p1'; reason = 'points'; }
  else if (score2 > score1) { winner = 'p2'; reason = 'points'; }
  else if (score1 > 0 && performanceComparisons.length) {
    const finalScore1 = performanceComparisons.reduce((sum, result) => sum + result.finalScore1, 0);
    const finalScore2 = performanceComparisons.reduce((sum, result) => sum + result.finalScore2, 0);
    winner = finalScore1 > finalScore2 ? 'p1' : finalScore2 > finalScore1 ? 'p2' : 'draw';
    reason = winner === 'draw' ? 'draw' : 'performance';
  } else if (score1 > 0 && time1 !== time2) {
    winner = time1 < time2 ? 'p1' : 'p2';
    reason = hasUnavailableSimultaneousPair ? 'performance_unavailable' : 'tiebreaker_time';
  } else if (score1 > 0 && hasUnavailableSimultaneousPair) {
    reason = 'performance_unavailable';
  }

  return {
    score1,
    score2,
    time1: time1 / 1000,
    time2: time2 / 1000,
    winner,
    reason,
    performanceComparisons,
    breakdown: {
      solved: score1 > score2 ? 'r1' : score2 > score1 ? 'r2' : 'tie',
      speed: time1 < time2 ? 'r1' : time2 < time1 ? 'r2' : 'tie'
    }
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
