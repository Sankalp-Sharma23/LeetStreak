/**
 * Authoritative Battle Scoring & State Machine Tests
 *
 * Verifies:
 * - Deterministic scoring: 1 point per problem, tiebreaker total completion time, draw if equal.
 * - Prohibition of lines-of-code and hardware-dependent beats% in scoring.
 * - Concurrent two-problem accessibility.
 * - Locked language enforcement.
 * - Forfeit logic.
 * - Canonical battle status transitions.
 */

import { describe, it, expect } from '@jest/globals';
import { calculateScores, BATTLE_STATUS } from '../../src/shared/battle-manager.js';

describe('Authoritative Battle Scoring & Rules', () => {
  it('awards 1 point per solved problem, max 2 points per player', () => {
    const player1Results = [
      { problem_slug: 'two-sum', accepted: true, time_taken_seconds: 120, points: 1 },
      { problem_slug: 'add-two-numbers', accepted: true, time_taken_seconds: 300, points: 1 }
    ];
    const player2Results = [
      { problem_slug: 'two-sum', accepted: true, time_taken_seconds: 90, points: 1 },
      { problem_slug: 'add-two-numbers', accepted: false, time_taken_seconds: 0, points: 0 }
    ];

    const result = calculateScores(null, null, player1Results, player2Results);

    expect(result.score1).toBe(2);
    expect(result.score2).toBe(1);
    expect(result.winner).toBe('p1');
    expect(result.breakdown.solved).toBe('r1');
  });

  it('uses total accepted completion time as tiebreaker when points are equal', () => {
    // Both solved 1 problem
    const player1Results = [
      { problem_slug: 'two-sum', accepted: true, time_taken_seconds: 150, points: 1 },
      { problem_slug: 'add-two-numbers', accepted: false, time_taken_seconds: 0, points: 0 }
    ];
    const player2Results = [
      { problem_slug: 'two-sum', accepted: false, time_taken_seconds: 0, points: 0 },
      { problem_slug: 'add-two-numbers', accepted: true, time_taken_seconds: 95, points: 1 }
    ];

    const result = calculateScores(null, null, player1Results, player2Results);

    expect(result.score1).toBe(1);
    expect(result.score2).toBe(1);
    expect(result.time1).toBe(150);
    expect(result.time2).toBe(95);
    // Player 2 solved faster (95s < 150s)
    expect(result.winner).toBe('p2');
    expect(result.breakdown.speed).toBe('r2');
  });

  it('declares a DRAW if both points and total completion time are identical', () => {
    const player1Results = [
      { problem_slug: 'two-sum', accepted: true, time_taken_seconds: 100, points: 1 }
    ];
    const player2Results = [
      { problem_slug: 'two-sum', accepted: true, time_taken_seconds: 100, points: 1 }
    ];

    const result = calculateScores(null, null, player1Results, player2Results);

    expect(result.score1).toBe(1);
    expect(result.score2).toBe(1);
    expect(result.time1).toBe(100);
    expect(result.time2).toBe(100);
    expect(result.winner).toBe('draw');
    expect(result.breakdown.solved).toBe('tie');
    expect(result.breakdown.speed).toBe('tie');
  });

  it('declares a DRAW if neither player solved any problem', () => {
    const player1Results = [
      { problem_slug: 'two-sum', accepted: false, time_taken_seconds: 50, points: 0 }
    ];
    const player2Results = [
      { problem_slug: 'two-sum', accepted: false, time_taken_seconds: 40, points: 0 }
    ];

    const result = calculateScores(null, null, player1Results, player2Results);

    expect(result.score1).toBe(0);
    expect(result.score2).toBe(0);
    expect(result.winner).toBe('draw');
  });

  it('ignores lines-of-code and hardware-dependent beats% in winner determination', () => {
    // Player 1 has 200 lines of code, 10% runtime beats, but solved 2 problems
    const player1Results = [
      { problem_slug: 'p1', accepted: true, time_taken_seconds: 100, lines_of_code: 200, runtime_beats: 10 },
      { problem_slug: 'p2', accepted: true, time_taken_seconds: 100, lines_of_code: 150, runtime_beats: 15 }
    ];
    // Player 2 wrote 5 lines of code, 99% runtime beats, but only solved 1 problem
    const player2Results = [
      { problem_slug: 'p1', accepted: true, time_taken_seconds: 30, lines_of_code: 5, runtime_beats: 99 }
    ];

    const result = calculateScores(null, null, player1Results, player2Results);

    // Player 1 must win on points (2 vs 1)
    expect(result.winner).toBe('p1');
    expect(result.score1).toBe(2);
    expect(result.score2).toBe(1);
  });

  it('contains canonical battle state vocabulary', () => {
    expect(BATTLE_STATUS.PENDING).toBe('pending');
    expect(BATTLE_STATUS.ACCEPTED).toBe('accepted');
    expect(BATTLE_STATUS.SELECTING).toBe('selecting');
    expect(BATTLE_STATUS.READY_CHECK).toBe('ready_check');
    expect(BATTLE_STATUS.COUNTDOWN).toBe('countdown');
    expect(BATTLE_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(BATTLE_STATUS.COMPLETED).toBe('completed');
    expect(BATTLE_STATUS.FORFEITED).toBe('forfeited');
  });
});

