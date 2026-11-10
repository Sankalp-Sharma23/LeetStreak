# Supabase Database Architecture & Handoff Guide

## 1. Quick Deployment Paths

### Option A: Complete Database Setup (Fresh or Existing Database)
To set up or completely sync your database in one go, open [`supabase/COMPLETE_DATABASE_SCHEMA.sql`](../supabase/COMPLETE_DATABASE_SCHEMA.sql), copy the entire contents into the **Supabase Dashboard SQL Editor**, and click **Run**.
- **Idempotent**: Uses `IF NOT EXISTS` / `CREATE OR REPLACE` for all tables, columns, indexes, RLS policies, triggers, and RPC functions.
- **Safe**: Does not drop existing user accounts, progress records, or friendships.

### Option B: Applying the Latest Incremental Patch
If your database is already running the previous migrations, run [`supabase/RUN_THIS_IN_SUPABASE.sql`](../supabase/RUN_THIS_IN_SUPABASE.sql):
- Cleans up legacy test self-battles (`challenger_id = challenged_id` or matching handles).
- Updates `get_battle_history_scoreboard` to permanently exclude self-battles from head-to-head aggregation.
- Reloads the PostgREST schema cache.

---

## 2. Chronological Migrations Inventory

All 15 versioned migrations are organized in `supabase/migrations/`:

| Migration | Purpose |
| :--- | :--- |
| `20261105000001_security_and_relational_schema.sql` | Base schema: profiles, user_settings, friendships, roasts, presence, battles, results. |
| `20261105000002_presence_and_social_remediation.sql` | RLS hardening, heartbeats, presence cleanup. |
| `20261105000003_permanent_friendship_and_recovery.sql` | Cross-device account recovery and permanent friendship persistence. |
| `20261106000001_battle_redesign.sql` | V2 battle arena: synchronized topic/difficulty/duration configs and state machines. |
| `20261106000002_battle_submission_scoring.sql` | Solve recording with runtime and memory tiebreakers. |
| `20261107000001_battle_history_scoreboard.sql` | Head-to-head scoreboard aggregation RPC. |
| `20261107000002_remove_demo_joy_presence.sql` | Purged test seed data. |
| `20261110000001_friend_request_isolation.sql` | Bidirectional mutual consent for friend requests. |
| `20261110000002_battle_identity_and_write_guards.sql` | Cryptographic `auth.uid()` binding and guarded battle mutations. |
| `20261110000003_revoke_inherited_battle_grants.sql` | Revoked broad public grants on battle tables. |
| `20261110000004_legacy_battle_history_labels.sql` | Legacy battle display label reconciliation. |
| `20261110000005_presence_friend_requests_and_legacy_rpc_guards.sql` | Narrowed presence visibility to accepted friends. |
| `20261110000006_server_verified_battle_solves.sql` | Service-role battle solve verification. |
| `20261110000007_restore_record_battle_solve_rpc.sql` | Dual-mode verification: direct authenticated solve fallback. |
| `20261110000008_exclude_self_battles_from_history.sql` | Excluded self-test duels from head-to-head scorecards. |

---

## 3. Server-Verified Battle Solves (Edge Function)

The extension supports server-side submission verification via [`supabase/functions/record-battle-solve/index.ts`](../supabase/functions/record-battle-solve/index.ts).
The Edge Function verifies:
1. Caller's active Supabase session.
2. Active battle membership.
3. Registered LeetCode username match.
4. Problem slug and submission ID authenticity against LeetCode's public submission log.
5. Timing within match window before recording the accepted solve.

To deploy the Edge Function:
```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy record-battle-solve
```

---

## 4. Key Extension Capabilities & Policies

- **Streak At Risk Alerts**: Strictly restricted to two allowed windows per day:
  - Once before 12:00 PM (noon).
  - Once during evening hours between 9:00 PM and 3:00 AM (only if the user is active on their machine).
  - Never triggers if the user has already solved a problem today or current streak is 0.
- **Interactive Friend Roasts**:
  - Home tab alert banner with **[⚔️ Challenge in 1v1]** and **[🔥 Roast Back]** comeback drawer.
  - Actionable cards in the Notification Center.
  - Integrated into Hardcore Blocker screen (`blocked.html`) when users visit blocked websites.
- **Head-to-Head Scoreboard**:
  - Clean per-friend scorecards: `sankalp (you) v/s friend_username` `score X : Y`.
  - Self-battles strictly filtered out.
- **Cross-Browser Synchronized Battles**:
  - Chrome, Brave, and Edge support.
  - Alarm-based background wake-up and auto-focus for problem tabs at match start.
  - Synchronized in-page problem sidebar.

---

## 5. Verification Status

- **Unit, Integration, Security Tests**: 187 passing across 20 test suites.
- **ESLint**: 0 errors, 0 warnings.
- **Build**: Successfully compiled into `dist/`.
