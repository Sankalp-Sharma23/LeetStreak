import { describe, it, expect } from '@jest/globals';
import {
  getStreakAtRiskSlot,
  getLocalDayKey,
  canDeliverStreakAtRisk,
  recordStreakAtRiskDelivery
} from '../../src/shared/streak-at-risk-policy.js';

describe('Streak At Risk Policy (Strict Window Enforcement)', () => {
  it('correctly maps time slots for morning (<12pm) and night (9pm-3am)', () => {
    // Morning (< 12 PM)
    expect(getStreakAtRiskSlot(new Date(2026, 10, 10, 8, 30))).toBe('morning');
    expect(getStreakAtRiskSlot(new Date(2026, 10, 10, 11, 59))).toBe('morning');

    // Night (9 PM to 3 AM)
    expect(getStreakAtRiskSlot(new Date(2026, 10, 10, 21, 0))).toBe('night');
    expect(getStreakAtRiskSlot(new Date(2026, 10, 10, 23, 45))).toBe('night');
    expect(getStreakAtRiskSlot(new Date(2026, 10, 11, 0, 30))).toBe('night');
    expect(getStreakAtRiskSlot(new Date(2026, 10, 11, 2, 59))).toBe('night');

    // Outside allowed windows (12:00 PM to 8:59 PM)
    expect(getStreakAtRiskSlot(new Date(2026, 10, 10, 12, 0))).toBeNull();
    expect(getStreakAtRiskSlot(new Date(2026, 10, 10, 14, 0))).toBeNull();
    expect(getStreakAtRiskSlot(new Date(2026, 10, 10, 20, 59))).toBeNull();
  });

  it('allows delivery at most once in morning window and once in night window', () => {
    const morningTime = new Date(2026, 10, 10, 10, 0);
    const dayKey = getLocalDayKey(morningTime);

    // Initial check (no prior delivery)
    const res1 = canDeliverStreakAtRisk({
      now: morningTime,
      deliveredState: null,
      hasSolvedToday: false,
      streak: 5
    });
    expect(res1.allowed).toBe(true);
    expect(res1.slot).toBe('morning');

    // Record delivery
    let state = recordStreakAtRiskDelivery(null, dayKey, 'morning');
    expect(state.slots).toContain('morning');

    // Subsequent morning check is blocked
    const res2 = canDeliverStreakAtRisk({
      now: new Date(2026, 10, 10, 11, 30),
      deliveredState: state,
      hasSolvedToday: false,
      streak: 5
    });
    expect(res2.allowed).toBe(false);
    expect(res2.reason).toBe('already_delivered_for_slot');

    // Afternoon check is blocked (outside hours)
    const resAfternoon = canDeliverStreakAtRisk({
      now: new Date(2026, 10, 10, 15, 0),
      deliveredState: state,
      hasSolvedToday: false,
      streak: 5
    });
    expect(resAfternoon.allowed).toBe(false);
    expect(resAfternoon.reason).toBe('outside_allowed_hours');

    // Night check is allowed
    const nightTime = new Date(2026, 10, 10, 21, 30);
    const resNight = canDeliverStreakAtRisk({
      now: nightTime,
      deliveredState: state,
      hasSolvedToday: false,
      streak: 5
    });
    expect(resNight.allowed).toBe(true);
    expect(resNight.slot).toBe('night');

    // Record night delivery
    state = recordStreakAtRiskDelivery(state, dayKey, 'night');
    expect(state.slots).toEqual(['morning', 'night']);

    // Later night check (e.g. 1 AM) is blocked because night slot was already delivered
    const lateNightTime = new Date(2026, 10, 10, 23, 50);
    const resLateNight = canDeliverStreakAtRisk({
      now: lateNightTime,
      deliveredState: state,
      hasSolvedToday: false,
      streak: 5
    });
    expect(resLateNight.allowed).toBe(false);
    expect(resLateNight.reason).toBe('already_delivered_for_slot');
  });

  it('does not send notification if user already solved today or streak is zero', () => {
    const morningTime = new Date(2026, 10, 10, 10, 0);

    // Streak is 0
    expect(canDeliverStreakAtRisk({
      now: morningTime,
      hasSolvedToday: false,
      streak: 0
    }).allowed).toBe(false);

    // Already solved today
    expect(canDeliverStreakAtRisk({
      now: morningTime,
      hasSolvedToday: true,
      streak: 10
    }).allowed).toBe(false);
  });
});

