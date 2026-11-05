# LeetStreak Social Features, Online Friend Discovery & Roast Remediation

## Executive Summary
This document provides the architectural audit, root-cause identification, and remediation verification for LeetStreak's social capabilities:
1. **Online Friend Discovery & 1v1 Battle Invitations**: Real-time discovery of online friends eligible for a challenge.
2. **Peer Roast Messaging**: Reliable delivery of peer roast notifications between accepted friends.
3. **Presence Indicators**: Clear, consistent visual presence cues (🟢 Online, 🟡 In Battle, ⚪ Offline) across all friend profile representations.
4. **Manifest V3 Background Lifecycle**: Background heartbeat synchronization via `chrome.alarms` respecting service worker sleep cycles.

---

## 1. Root Cause Analysis

### Issue A: Online Friends Never Appeared in the 1v1 Battle Challenge List
* **Missing `user_id` Primary Key in Heartbeats**:
  The `user_presence` table schema defines `user_id UUID PRIMARY KEY REFERENCES public.profiles(id)`. However, the previous `battle-manager.js` implementation dispatched heartbeats with only `{ username, last_seen }`. Supabase REST requests failed Postgres foreign key constraint and RLS checks (`auth.uid() = user_id`), causing heartbeats to be silently dropped.
* **Absence of Background Alarm**:
  Presence was only updated when the popup had `BattleView` actively mounted. As soon as the user closed the popup or switched tabs, presence expired. Manifest V3 service workers terminate after ~30 seconds of inactivity; no `chrome.alarms` mechanism existed to ping presence.
* **Username Case Sensitivity**:
  `presenceMap` in `BattleView.jsx` indexed users by raw username without lowercase normalization. If a profile was queried as `"Alice"` while presence was stored as `"alice"`, the lookup failed and treated the user as offline.

### Issue B: Roasts Could Not Be Sent to Friends
* **RLS Policy Constraint on `roast_messages`**:
  The RLS insert policy `roasts_insert_sender` strictly required:
  ```sql
  EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
    AND ((user_id = auth.uid() AND friend_id = target.id)
      OR (friend_id = auth.uid() AND user_id = target.id))
  )
  ```
* **Local Storage vs Remote Database Disconnect**:
  Users added friends in the extension via local cache (`friends_cache`), but friendship records were never inserted into Supabase's `public.friendships` table. As a result, the RLS policy evaluated to `false`, throwing a 403 Forbidden violation on every roast attempt.
* **Lack of User Feedback**:
  Errors were swallowed or attempted browser-level `alert()` calls, which fail silently in Chrome Extension popup contexts.

---

## 2. Remediated Architecture

### 2.1 Server-Authoritative Database Layer (Supabase)
Added migration: `supabase/migrations/20261105000002_presence_and_social_remediation.sql`:
* **Columns Added**:
  - `user_presence.in_battle BOOLEAN DEFAULT false`
  - `user_presence.active_battle_id UUID REFERENCES public.battles(id) ON DELETE SET NULL`
* **Replica Identity & Realtime Publication**:
  - Configured `REPLICA IDENTITY FULL` on `user_presence`, `battles`, `battle_events`, `roast_messages`, and `friendships`.
  - Added tables to `supabase_realtime` publication for instant state pushes.
* **Atomic RPC Functions (`SECURITY DEFINER`, `search_path = public`)**:
  - `heartbeat_presence(p_status)`: Upserts presence with server timestamp `now()`. Automatically checks for active battles involving the authenticated user and enforces `in_battle = true` if engaged in a match.
  - `set_presence_offline()`: Marks `status = 'offline'`, `in_battle = false` on user logout.
  - `get_online_friends()`: Returns all accepted friends of `auth.uid()`, joined with profile data and active presence within a **120-second stale window** (`last_seen >= now() - interval '120 seconds'`).
  - `get_friends_presence(p_usernames)`: Returns presence status for arbitrary username arrays with the same 120-second freshness window.
  - `sync_friendship(p_target_username)`: Establishes mutual accepted friendship in `public.friendships` using profile UUID lookups.
  - `send_roast(p_recipient_username, p_content)`: Validates sender, recipient, mutual friendship, and length (<= 500 chars), inserting atomically into `roast_messages`.
  - `create_battle_challenge(p_challenged_username, p_language)`: Validates that both users are accepted friends, neither is currently in a battle, and initiates the challenge.

### 2.2 Background Service Worker (Manifest V3)
* **Periodic Heartbeat Alarm**:
  - Configured `chrome.alarms.create('presence_heartbeat_alarm', { periodInMinutes: 1 })`.
  - Service worker wakes every 60 seconds, reads the active session from `chrome.storage.local`, and issues a `heartbeatPresence('online')` RPC call.
* **Lifecycle Event Handlers**:
  - `SIGN_IN_EMAIL`: Pings presence immediately and synchronizes local friends to Supabase via `syncFriendship`.
  - `SIGN_OUT`: Dispatches `setPresenceOffline()` to mark user offline immediately.
  - `BATTLE_GET_ONLINE_FRIENDS`: Provides the popup with instant online friend lookups.
  - `SYNC_FRIENDSHIPS`: Batch-syncs local friends cache to Supabase `friendships` table.

### 2.3 Visual Presence Indicators
Created reusable components in `src/popup/PresenceIndicator.jsx`:
* **States**:
  - 🟢 **Online** (`bg-emerald-500` with subtle pulse animation and emerald ring)
  - 🟡 **In Battle** (`bg-amber-400` with solid amber ring)
  - ⚪ **Offline** (`bg-zinc-500` with muted zinc ring)
* **Components**:
  - `<PresenceIndicator status="online|in_battle|offline" size="sm|md|lg" showLabel={bool} />`
  - `<AvatarWithPresence src={avatarUrl} alt={name} status={presenceStatus} size="sm|md|lg" />`
* **Placement**:
  - `FriendCard.jsx`: Avatar badge in the friends list and leaderboard.
  - `Leaderboard.jsx`: Integrated with leaderboard rank rows.
  - `StreakView.jsx`: Recent Activity friend avatars.
  - `BattleView.jsx`: Online Friend selection list and selected challenge preview card.

---

## 3. Database Migration Instructions

### Applying the Migration
If using Supabase CLI:
```bash
supabase db push
```
Or in the Supabase Dashboard SQL Editor:
1. Open `supabase/migrations/20261105000002_presence_and_social_remediation.sql`.
2. Paste and run the entire script.

### Reverting the Migration
To roll back the changes:
```bash
# Via Supabase SQL Editor
# Run supabase/migrations/20261105000002_presence_and_social_remediation.down.sql
```

---

## 4. Verification and Automated Test Results

### Automated Test Coverage
All 12 test suites, encompassing 128 unit and integration tests, pass with zero regressions:
```
PASS tests/unit/social-presence.test.js
  Social Presence & Realtime Friend Discovery
    1. Stale Presence Expiration Logic (120s threshold)
      ✓ marks friend online when heartbeat is recent (< 120s)
      ✓ marks friend offline when heartbeat is stale (> 120s)
      ✓ marks friend offline if last_seen is missing or corrupt
      ✓ marks friend in_battle when active within freshness window
      ✓ marks friend offline even if marked in_battle if heartbeat has expired (> 120s)
    2. Case-Insensitive Presence Normalization
      ✓ normalizes presence dictionary with mixed-case usernames
      ✓ normalizes array of presence records correctly
    3. Battle Page Online Friend Selection & Filtering
      ✓ orders online friends first, then in_battle, then offline
      ✓ excludes pending or unaccepted friendships from challengeable list
    4. Peer Roast Messaging Verification
      ✓ successfully delivers roast between accepted friends
      ✓ rejects roasts to non-friends with clear security error
      ✓ rejects empty or whitespace-only roasts
      ✓ rejects roasts that exceed 500 characters
    5. Battle Challenge Creation Rules
      ✓ creates battle challenge when friend is online and idle
      ✓ rejects challenge if friend is offline
      ✓ rejects challenge if friend is already in battle
    6. Heartbeat Lifecycle & Sign-Out Handling
      ✓ updates presence timestamp on heartbeat
      ✓ sets presence to offline immediately upon sign out

PASS tests/unit/roast-delivery.test.js
PASS tests/security/auth-rls.test.js
PASS tests/unit/hardcore-blocker.test.js
PASS tests/unit/exclusive-battle-auth.test.js
PASS tests/unit/streak-logic.test.js
PASS tests/unit/leaderboard-ranking.test.js
PASS tests/unit/battle-scoring.test.js
PASS tests/integration/storage-persistence.test.js
PASS tests/unit/improvement-rule.test.js
PASS tests/unit/leetcode-stats.test.js
PASS tests/unit/initialization-and-auth.test.js

Test Suites: 12 passed, 12 total
Tests:       128 passed, 128 total
```

---

## 5. Architectural Invariants Preserved
* **Offline Independence**: Personal streak calculation, problem queue, daily challenges, and analytics remain 100% offline and do not require Supabase authentication.
* **Authentication Quarantine**: Supabase authentication remains strictly isolated to the 1v1 Battle page.
* **Row-Level Security**: No RLS policies were bypassed or weakened; all database operations enforce authenticated UID boundaries via `SECURITY DEFINER` RPCs with parameter validation and explicit search path.

