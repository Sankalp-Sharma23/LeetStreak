# LeetStreak Project Audit & Issue Register

**Version:** 1.0.0  
**Date:** 2026-11-05  
**Auditor:** Principal Software Architect & Engineering Lead  
**Repository Source of Truth:** `L:\LeetStreak`

---

## 1. Executive Summary

A comprehensive repository investigation was conducted across the LeetStreak codebase. The audit inspected the Chrome Extension Manifest V3 configuration, Vite build pipelines, React 19 components, background service worker lifecycles, content script DOM integrations, storage layers (Chrome Storage and Supabase Cloud), and automated test suites.

While the extension demonstrates rich UI foundations and ambition, several critical architectural and functional flaws were identified:
1. **GitHub coupling in Content Script (P0):** The submission watcher in `leetcode-integration.js` was locked entirely inside `initGitHubSync()`. If GitHub sync was disabled or unconfigured, submission detection and battle reporting were completely disabled.
2. **Tab Monitor / Website Blocker Inactive (P0):** `src/background/tab-monitor.js` was untracked and never imported or initialized in `service-worker.js`. Hardcore Mode website blocking and procrastination roasts never ran.
3. **Insecure Token Key Storage (P0):** `secure-token-manager.js` stored the AES-GCM encryption key directly adjacent to the ciphertext in `chrome.storage.local`.
4. **Unprotected Battle State Operations (P0):** `battle-manager.js` performed direct client-side REST mutations against Supabase with no authoritative state validation, allowing arbitrary status changes, unverified scores, and forged timestamps.
5. **Personal Streak Contamination (P1):** Streaks were calculated mutually in `FriendCard.jsx` via `mutual-streak-calculator.js`.
6. **Inaccurate Problem Count Normalization (P1):** Confusion between `submitStats.acSubmissionNum` (unique problems solved) and submission lists caused inconsistent problem statistics across views.
7. **Broken Roast Delivery (P1):** Friend roasts were written to `user_settings.pending_roasts` in Supabase, but the recipient extension never polled, processed, or displayed them.
8. **Broken Options Storage Inspector (P2):** `src/options/App.jsx` attempted to import non-existent `getStorageInfo` from `storage.js`.

---

## 2. Issue Register

### Severity Classifications
- **P0:** Critical security vulnerabilities, data corruption, or catastrophic failures of primary systems.
- **P1:** Broken core product features, incorrect user data, or major logic violations.
- **P2:** Reliability, architecture, maintainability, and performance issues.
- **P3:** Usability enhancements, dead code cleanup, and UI polish.

---

### Issue Register Table

| Issue ID | Priority | Feature Domain | Affected Files | Severity Summary |
|---|---|---|---|---|
| **ISSUE-P0-01** | P0 | Content Script / Battles | `src/content/leetcode-integration.js` | Battle submission listener never executes when GitHub sync is disabled |
| **ISSUE-P0-02** | P0 | Hardcore Mode / Tab Monitor | `src/background/tab-monitor.js`, `src/background/service-worker.js` | Website blocker & tab monitor never initialized in service worker |
| **ISSUE-P0-03** | P0 | Security / Cryptography | `src/shared/secure-token-manager.js` | Encryption key stored in plaintext in same local store as ciphertext |
| **ISSUE-P0-04** | P0 | 1v1 Battle System | `src/shared/battle-manager.js`, `src/popup/BattleView.jsx` | Unprotected direct REST mutations on battles and results tables |
| **ISSUE-P1-01** | P1 | Streaks & Leaderboard | `src/popup/FriendCard.jsx`, `src/shared/mutual-streak-calculator.js` | Mutual streak calculation contaminates personal streak display |
| **ISSUE-P1-02** | P1 | Streak Engine | `src/shared/streak-calculator.js` | Timezone ambiguity, gap detection mismatch, and submissionCalendar incompatibilities |
| **ISSUE-P1-03** | P1 | LeetCode Analytics | `src/background/leetcode-api.js`, `src/popup/StreakView.jsx` | Inaccurate problem counts; conflation of unique problems solved with submissions |
| **ISSUE-P1-04** | P1 | Roast Motivation | `src/popup/FriendCard.jsx`, `src/shared/storage.js`, `src/shared/supabase-client.js` | Roasts stored in database but never polled or displayed to recipient |
| **ISSUE-P1-05** | P1 | 1v1 Battle System | `src/shared/battle-manager.js` | Scoring logic uses lines-of-code and hardware-biased beats% instead of required specification |
| **ISSUE-P1-06** | P1 | 1v1 Battle System | `src/shared/battle-manager.js`, `src/popup/BattleView.jsx` | Missing ready-check phase, desynchronized client timers, and unvalidated problem slugs |
| **ISSUE-P2-01** | P2 | Options Page | `src/options/App.jsx`, `src/shared/storage.js` | Options crashes on startup: `getStorageInfo` is not exported by `storage.js` |
| **ISSUE-P2-02** | P2 | Core / GitHub Removal | `src/background/service-worker.js`, `src/content/leetcode-integration.js` | Over 1,500 lines of obsolete, dead GitHub sync code bloating extension |
| **ISSUE-P2-03** | P2 | Notification System | `src/shared/notification-manager.js`, `src/popup/SettingsPanel.jsx` | Notifications ignore `notifications_enabled` setting; missing quiet hours & clicks |
| **ISSUE-P2-04** | P2 | Content Script / Security | `src/content/leetcode-integration.js` | Remote CDN script injection of `html2canvas` violates MV3 CSP rules |
| **ISSUE-P2-05** | P2 | Test Infrastructure | `jest.config.js`, `tests/unit/streak-logic.test.js` | Test runner broken: missing `sinon` dependency and invalid ESM config in Jest |
| **ISSUE-P3-01** | P3 | Progress Dashboard | `src/popup/StreakView.jsx` | Residual multi-friend reduction logic in single-user progress view |
| **ISSUE-P3-02** | P3 | Friends & Leaderboard | `src/popup/Leaderboard.jsx` | Leaderboard only sorts by total problems; missing streak and rating sort options |
| **ISSUE-P3-03** | P3 | Analytics Export | `src/shared/export-manager.js`, `src/popup/InsightsPanelEnhanced.jsx` | CSV and PDF export functions exist in shared code but have no UI entry point |
| **ISSUE-P3-04** | P3 | Problem Queue | `src/popup/ProblemQueue.jsx` | Problem queue references obsolete `friends_data` key from pre-Supabase schema |

---

## 3. Deep Root-Cause Analysis for Key Issues

### ISSUE-P0-01: Submission Watcher Locked in GitHub Sync
- **Root Cause:** In `src/content/leetcode-integration.js`, lines 1242-1275, the click listener on the LeetCode "Submit" button was registered exclusively inside `initGitHubSync()`. `initGitHubSync()` performed an early return if `github_sync_enabled` was falsy:
  ```javascript
  if (!githubSyncEnabled || submissionWatcher) return;
  ```
- **User Impact:** Any user attempting a 1v1 battle without having enabled GitHub sync could never register an accepted solution. Furthermore, upon removing GitHub integration, battle submission detection would be completely disabled.
- **Fix:** Decouple LeetCode submission observation into an autonomous submission detector that runs independently of any integration.

### ISSUE-P0-02: Hardcore Mode Tab Monitor Inactive
- **Root Cause:** `src/background/tab-monitor.js` was implemented in isolation. Neither `src/background/service-worker.js` nor the manifest registered it or invoked `initializeTabMonitor()`.
- **User Impact:** Users enabling Hardcore Mode experienced zero website restrictions, no procrastination alarms, and no solve-to-unlock behavior.
- **Fix:** Integrate `initializeTabMonitor()` directly into service worker startup and `onInstalled` events, ensuring alarms and tab update listeners are registered in Manifest V3.

### ISSUE-P0-03: Encryption Key Stored in Plaintext
- **Root Cause:** `src/shared/secure-token-manager.js` generated a random password and stored both `${keyName}_encrypted` and `${keyName}_key` in the same `chrome.storage.local` store.
- **User Impact:** Any malicious script or unauthorized context capable of reading extension storage could trivially read the key and decrypt ciphertext.
- **Fix:** Completely remove obsolete GitHub token storage as part of the GitHub deprecation mandate. For sensitive client configurations, leverage genuine key management practices.

### ISSUE-P0-04: Unprotected Client-Side Battle State Mutations
- **Root Cause:** The battle system used direct REST `PATCH` and `POST` queries to Supabase tables using the public anonymous key (`SUPABASE_ANON_KEY`). There was no backend state machine enforcement, no ready-check validation, and no transactional locking.
- **User Impact:** A client could arbitrarily mark themselves the winner, update scores, modify opponent picks, or forge match start times.
- **Fix:** Architect a secure battle state machine with strict database schema, RPC functions, and validation checks.

### ISSUE-P1-01: Personal Streak Contaminated by Mutual Streak
- **Root Cause:** `FriendCard.jsx` imported `calculateMutualStreak` and computed mutual streaks based on intersection of both users' submission dates since friendship started.
- **User Impact:** User saw their friendship streak instead of the friend's personal streak.
- **Fix:** Remove mutual streak calculations from the primary streak system. Display strictly personal streaks for the current user and for every friend.

### ISSUE-P1-03: Inaccurate Problem Count Normalization
- **Root Cause:** LeetCode GraphQL exposes `submitStats.acSubmissionNum` which counts unique problems solved by difficulty (`All`, `Easy`, `Medium`, `Hard`). In contrast, `recentAcSubmissions` has a limit (up to 1,000) and contains repeat submissions of the same problem. When components mixed these two sources or attempted manual deduplication on incomplete lists, totals became corrupted.
- **Fix:** Establish a canonical data contract where unique solved problem counts are authoritative from `matchedUser.submitStats.acSubmissionNum`, while submission histories are used solely for chronological activity.

---

## 4. Verification & Testing Strategy

Each fix will be verified via:
1. Automated unit test suite execution (`npm run test:unit`).
2. Chrome storage persistence integration tests (`npm run test:integration`).
3. Complete production build verification (`npm run build`).
4. End-to-end workflow simulation and schema migration checks.

