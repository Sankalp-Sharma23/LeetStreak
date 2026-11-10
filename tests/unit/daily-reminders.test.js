import { describe, it, expect } from '@jest/globals';
import {
  DAILY_REMINDER_QUOTES,
  canDeliverDailyReminder,
  getDeliveredReminderSlots,
  getDueReminderSlot,
  getLocalDateKey,
  getNextReminderTime,
  normalizeReminderFrequency,
  recordDailyReminderSlot,
  selectDailyReminderQuote
} from '../../src/shared/daily-reminders.js';

describe('daily problem reminder policy', () => {
  it('schedules two local-time reminders for Normal and one for Reduced', () => {
    const afternoon = new Date(2026, 10, 10, 14, 30);
    expect(getNextReminderTime(afternoon, 'normal').getHours()).toBe(23);
    expect(getNextReminderTime(afternoon, 'reduced').getHours()).toBe(11);
    expect(getNextReminderTime(afternoon, 'reduced').getDate()).toBe(11);
    expect(getNextReminderTime(afternoon, 'off')).toBeNull();
  });

  it('delivers each allowed slot only once and never when disabled or solved', () => {
    const eleven = new Date(2026, 10, 10, 11, 0);
    const twentyThree = new Date(2026, 10, 10, 23, 0);
    expect(canDeliverDailyReminder({ date: eleven, slot: '11am', frequency: 'normal' })).toBe(true);
    expect(canDeliverDailyReminder({ date: eleven, slot: '11am', frequency: 'normal', deliveredSlots: ['11am'] })).toBe(false);
    expect(canDeliverDailyReminder({ date: twentyThree, slot: '11pm', frequency: 'normal' })).toBe(true);
    expect(canDeliverDailyReminder({ date: twentyThree, slot: '11pm', frequency: 'reduced' })).toBe(false);
    expect(canDeliverDailyReminder({ date: eleven, slot: '11am', frequency: 'off' })).toBe(false);
    expect(canDeliverDailyReminder({ date: eleven, slot: '11am', solved: true })).toBe(false);
    expect(canDeliverDailyReminder({ date: eleven, slot: '11am', enabled: false })).toBe(false);
  });

  it('uses the device local calendar and does not send a stale missed reminder', () => {
    const justAfterEleven = new Date(2026, 10, 10, 11, 10);
    const tooLate = new Date(2026, 10, 10, 11, 20);
    expect(getLocalDateKey(justAfterEleven)).toBe('2026-11-10');
    expect(getDueReminderSlot(justAfterEleven)).toBe('11am');
    expect(canDeliverDailyReminder({ date: tooLate, slot: '11am' })).toBe(false);
  });

  it('keeps quote variety, avoids consecutive repeats, and maps older settings safely', () => {
    expect(DAILY_REMINDER_QUOTES).toHaveLength(30);
    expect(selectDailyReminderQuote(DAILY_REMINDER_QUOTES[0].id, () => 0).id).not.toBe(DAILY_REMINDER_QUOTES[0].id);
    expect(normalizeReminderFrequency('all')).toBe('normal');
    expect(normalizeReminderFrequency('important')).toBe('reduced');
    expect(normalizeReminderFrequency('minimal')).toBe('off');
  });

  it('remembers delivered slots across a local timezone rollback', () => {
    const first = recordDailyReminderSlot({}, '2026-11-10', '11am', 'quote-1');
    const changedZone = recordDailyReminderSlot(first, '2026-11-09', '11pm', 'quote-2');
    expect(getDeliveredReminderSlots(changedZone, '2026-11-10')).toContain('11am');
    expect(getDeliveredReminderSlots(changedZone, '2026-11-09')).toContain('11pm');
  });
});
