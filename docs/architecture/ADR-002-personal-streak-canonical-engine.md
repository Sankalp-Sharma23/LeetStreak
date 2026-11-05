# ADR-002: Canonical Personal Streak Engine with Timezone Normalization

## Status
Accepted

## Context
In earlier versions, streaks were treated ambiguously:
1. `FriendCard.jsx` calculated a "mutual streak" between friends, requiring both friends to solve on the same calendar day.
2. Streak calculations fluctuated depending on device timezone conversions and whether timestamps were parsed in local time or UTC.
3. Some calculations relied on `submissionCalendar`, which counts all attempts (including failing runs, compile errors, and test submissions), whereas true streaks must require at least one accepted solution.

## Decision
1. **Streaks are Strictly Personal:** Every user's streak is calculated purely from their own verified accepted LeetCode submissions. A friend's activity must never increase, decrease, or break the user's streak.
2. **Canonical Engine:** Centralize all streak calculations in `src/shared/streak-calculator.js`. No component or service is permitted to implement independent streak math.
3. **Timezone Policy:**
   - Persist an explicit IANA timezone string for the user (defaulting to device timezone `Intl.DateTimeFormat().resolvedOptions().timeZone` or UTC).
   - Normalize calendar day boundaries: A calendar day runs from 00:00:00 to 23:59:59 in the user's configured timezone.
   - Multiple accepted submissions on the same calendar day count as exactly one day.
   - If a user solved yesterday but has not yet solved today, their streak remains active throughout today. Only when the calendar day closes without a solve does the streak break to 0.
   - `longestStreak` is tracked monotonically and never decremented when the current streak resets.

## Consequences
- **Positive:** Unambiguous streak counts, reliable streak risk alerts, and clear separation between personal progress and social friend comparisons.
- **Negative:** Requires storing user timezone in settings and mapping LeetCode Unix timestamps into timezone day keys.

