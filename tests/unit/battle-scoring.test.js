import { describe, it, expect } from '@jest/globals';
import { calculateScores, compareBattlePerformance, BATTLE_STATUS } from '../../src/shared/battle-manager.js';

const accepted = (slug, atMs, runtimeMs = 100, memoryMb = 50, extra = {}) => ({
  problem_slug: slug,
  accepted: true,
  submitted_at: new Date(atMs).toISOString(),
  time_taken_ms: atMs,
  time_taken_seconds: Math.floor(atMs / 1000),
  runtime_ms: runtimeMs,
  memory_mb: memoryMb,
  ...extra
});

describe('Battle winner selection and accepted solve scoring', () => {
  it('awards the solve point to the only player with an Accepted result', () => {
    expect(calculateScores(null, null, [accepted('two-sum', 1000)], []).winner).toBe('p1');
    expect(calculateScores(null, null, [], [accepted('two-sum', 1000)]).winner).toBe('p2');
  });

  it('uses space 70% and runtime 30% for same-problem Accepted results within two seconds', () => {
    const p1 = accepted('two-sum', 10000, 100, 50);
    const p2 = accepted('two-sum', 11500, 1, 100);
    const compared = compareBattlePerformance(p1, p2);
    expect(compared.spaceScore1).toBe(100);
    expect(compared.timeScore1).toBe(0);
    expect(compared.finalScore1).toBe(70);
    expect(compared.finalScore2).toBe(30);
    expect(calculateScores(null, null, [p1], [p2])).toMatchObject({ winner: 'p1', reason: 'performance' });
  });

  it('uses server-recorded elapsed time when Accepted results are more than two seconds apart', () => {
    const result = calculateScores(null, null, [accepted('two-sum', 5000)], [accepted('two-sum', 8001)]);
    expect(result).toMatchObject({ winner: 'p1', reason: 'tiebreaker_time' });
  });

  it.each(['Wrong Answer', 'Time Limit Exceeded'])('does not count a peer %s as solved', verdict => {
    const failed = { ...accepted('two-sum', 2000), accepted: false, verdict };
    const result = calculateScores(null, null, [accepted('two-sum', 1000)], [failed]);
    expect(result).toMatchObject({ score1: 1, score2: 0, winner: 'p1', reason: 'points' });
  });

  it('counts duplicate Accepted events only once per player and problem', () => {
    const first = accepted('two-sum', 1000);
    const duplicate = accepted('two-sum', 1200, 1, 100);
    const result = calculateScores(null, null, [first, duplicate], [accepted('two-sum', 3000)]);
    expect(result.score1).toBe(1);
    expect(result.time1).toBe(1);
  });

  it('reconnection produces the same score from the persisted result records', () => {
    const p1 = [accepted('two-sum', 10000, 10, 40)];
    const p2 = [accepted('two-sum', 11000, 15, 60)];
    expect(calculateScores(null, null, p1, p2)).toEqual(calculateScores(null, null, p1, p2));
  });

  it('falls back to server Accepted order when close-pair performance data is unavailable', () => {
    const result = calculateScores(null, null, [accepted('two-sum', 10000, null, null)], [accepted('two-sum', 11000, null, null)]);
    expect(result).toMatchObject({ winner: 'p1', reason: 'performance_unavailable' });
    expect(result.performanceComparisons).toHaveLength(0);
  });

  it('declares a draw when both simultaneous submissions have identical metrics', () => {
    const result = calculateScores(null, null, [accepted('two-sum', 10000, 20, 60)], [accepted('two-sum', 11500, 20, 60)]);
    expect(result).toMatchObject({ winner: 'draw', reason: 'draw' });
  });

  it('reports incomplete metrics instead of inventing a performance score', () => {
    expect(compareBattlePerformance(accepted('two-sum', 10000, 12, null), accepted('two-sum', 11000, 14, 40)))
      .toMatchObject({ eligible: false, reason: 'performance_unavailable' });
    expect(compareBattlePerformance(accepted('two-sum', 10000, null, 40), accepted('two-sum', 11000, 14, 40)))
      .toMatchObject({ eligible: false, reason: 'performance_unavailable' });
  });

  it('keeps the canonical battle state vocabulary', () => {
    expect(BATTLE_STATUS.PENDING).toBe('pending');
    expect(BATTLE_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(BATTLE_STATUS.COMPLETED).toBe('completed');
  });
});
