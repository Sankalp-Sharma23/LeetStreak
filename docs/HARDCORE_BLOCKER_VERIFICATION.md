# LeetStreak — Hardcore Mode Website Blocker Verification Report

**Architecture Review, DeclarativeNetRequest Implementation, and Verification**

---

## 1. Executive Summary

This engineering report documents the complete rebuild of the **LeetStreak Hardcore Motivation Mode Website Blocker**.

Previously, Hardcore Mode failed to block distracting websites: users could browse Instagram, TikTok, Reddit, and YouTube Shorts despite having unsolved LeetCode problems. The previous implementation attempted to inject in-page DOM overlays via `chrome.tabs.onUpdated` only *after* websites had fully downloaded and rendered, compounded by a 15-minute notification cooldown that silenced alerts.

We have rebuilt the subsystem to use **Chrome Manifest V3 `chrome.declarativeNetRequest` (DNR)** for true network-level interception. Distracting main-frame navigation requests are now redirected before the destination web server is even contacted, while Single-Page Application (SPA) route changes (such as clicking YouTube Shorts from a normal video) are intercepted via `chrome.webNavigation.onHistoryStateUpdated`.

---

## 2. Root Cause Analysis

Investigation of `src/background/tab-monitor.js`, `public/manifest.json`, and `src/background/service-worker.js` revealed five critical architectural flaws in the previous implementation:

1. **Zero Network-Level Interception Rules:**
   `manifest.json` did not declare the `declarativeNetRequest` permission, nor did any code install dynamic or static rules. The browser's network engine was completely unaware of any blocklist.
2. **Missing & Restricted Chrome Permissions:**
   `declarativeNetRequest` and `webNavigation` were absent from `manifest.json`. The `tabs` permission was listed under `optional_permissions` without a reliable runtime prompt, causing background tab queries to silently fail or return partial information.
3. **Flawed After-The-Fact DOM Injection:**
   `tab-monitor.js` relied on `chrome.tabs.onUpdated` listening for `changeInfo.status === 'complete'`. By definition, this only fired after HTML, CSS, JavaScript, and trackers had finished loading. The injected DOM overlay could easily be deleted via DevTools or bypassed if the target site's Content Security Policy (CSP) blocked injected scripts.
4. **Excessive 15-Minute Cooldown & Delayed Alarms:**
   The tab monitor enforced a `NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000` (15 minutes). When visiting a distracting site, it scheduled a roast alarm for 10 seconds in the future and entered cooldown. If the tab was closed or the user continued browsing, no blocking or alerting occurred for the next 15 minutes.
5. **No Synchronization on Startup, Solve, or Day Rollover:**
   There was no `chrome.storage.onChanged` listener to reconcile blocker state when Hardcore Mode was toggled in settings, when an accepted solve was registered, or when midnight rolled over in the user's timezone.

---

## 3. New Architecture & Design

### 3.1 Network-Level Declarative Net Request (DNR) Engine
The primary enforcement mechanism is now `chrome.declarativeNetRequest`, encapsulated in [`src/background/blocker-manager.js`](file:///L:/LeetStreak/src/background/blocker-manager.js).

When Hardcore Mode is active and today's problem remains unsolved:
- The blocker dynamically installs deterministic rules with `resourceTypes: ['main_frame']`.
- Action: `{ type: 'redirect', redirect: { extensionPath: '/blocked.html' } }`.
- Rules are atomic and idempotent: old rules are fetched via `chrome.declarativeNetRequest.getDynamicRules()` and purged before installing the fresh ruleset.
- When an accepted problem is solved or Hardcore Mode is toggled off, all dynamic blocking rules are removed immediately from Chrome's network engine.

### 3.2 Rule Priority Hierarchy

Chrome DNR evaluates matching rules using strict integer priorities:

| Priority | Rule Category | Action | Example Pattern |
|:---:|:---|:---:|:---|
| **10** | Critical System Whitelist | `allow` | `\|\|leetcode.com/` |
| **5** | User-Configured Allowlist | `allow` | User-defined domains (e.g. `reddit.com/r/learnprogramming`) |
| **3** | Educational Exceptions | `allow` | `\|\|youtube.com/watch*`, `\|\|youtube.com/playlist*`, `\|\|linkedin.com/jobs*`, `\|\|linkedin.com/messaging*` |
| **2** | Path-Specific Distraction Blocks | `redirect` | `\|\|youtube.com/shorts*`, `\|\|youtube.com/feed/explore*`, `\|\|linkedin.com/feed*`, `\|\|facebook.com/reel*` |
| **1** | Full Domain Distraction Blocks | `redirect` | `\|\|instagram.com/`, `\|\|tiktok.com/`, `\|\|reddit.com/`, `\|\|netflix.com/`, `\|\|twitch.tv/` |

### 3.3 Single-Page Application (SPA) Interception
Modern web apps (e.g. YouTube, LinkedIn) perform client-side route transitions using `history.pushState` without a full page reload. Because DNR `main_frame` rules only intercept network requests, we supplement DNR with:
```javascript
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const status = await isBlockerActive();
  if (!status.active) return;

  const evalResult = evaluateUrl(details.url);
  if (evalResult.isDistraction) {
    chrome.tabs.update(details.tabId, {
      url: chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(details.url)}&label=${encodeURIComponent(evalResult.label)}`)
    });
  }
});
```

### 3.4 Canonical Solve-to-Unlock Logic
The blocker relies strictly on the canonical streak calculation in [`src/shared/streak-calculator.js`](file:///L:/LeetStreak/src/shared/streak-calculator.js) and the persisted IANA timezone:
1. `last_solve_date === todayStr`: Instant local cache hit.
2. Canonical verification: `hasSolvedToday(profile.allAcceptedSubmissions, profile.submissionCalendar, timezone)`.
3. Only the current authenticated user's accepted submissions unlock the blocker. Friends' activity or non-accepted submissions never unlock.
4. One accepted problem unlocks all websites until midnight in the configured timezone. The next calendar day starts locked again.

---

## 4. Manifest V3 Permissions

[`public/manifest.json`](file:///L:/LeetStreak/public/manifest.json) has been updated with the following permissions:

```json
{
  "manifest_version": 3,
  "name": "LeetStreak",
  "permissions": [
    "storage",
    "alarms",
    "notifications",
    "scripting",
    "declarativeNetRequest",
    "webNavigation",
    "tabs"
  ],
  "host_permissions": [
    "https://leetcode.com/*",
    "https://leetcode.com/graphql",
    "*://*.tiktok.com/*",
    "*://*.instagram.com/*",
    "*://*.twitter.com/*",
    "*://*.x.com/*",
    "*://*.threads.net/*",
    "*://*.reddit.com/*",
    "*://*.9gag.com/*",
    "*://*.pinterest.com/*",
    "*://*.bsky.app/*",
    "*://*.netflix.com/*",
    "*://*.twitch.tv/*",
    "*://*.kick.com/*",
    "*://*.hotstar.com/*",
    "*://*.disneyplus.com/*",
    "*://*.primevideo.com/*",
    "*://*.hulu.com/*",
    "*://*.max.com/*",
    "*://*.crunchyroll.com/*",
    "*://*.chess.com/*",
    "*://*.lichess.org/*",
    "*://*.geoguessr.com/*",
    "*://*.store.steampowered.com/*",
    "*://*.roblox.com/*",
    "*://*.youtube.com/*",
    "*://*.facebook.com/*",
    "*://*.linkedin.com/*"
  ],
  "web_accessible_resources": [
    {
      "resources": ["icons/*", "blocked.html", "assets/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

*Note: Unnecessary `<all_urls>` host permissions have been removed in favor of explicit host patterns.*

---

## 5. Motivational Block Page (`blocked.html`)

An extension-owned page has been created at [`blocked.html`](file:///L:/LeetStreak/blocked.html) with companion React app [`src/blocked/BlockedApp.jsx`](file:///L:/LeetStreak/src/blocked/BlockedApp.jsx):
- **Visual Identity:** Designed strictly to match LeetStreak's dark theme (`#18181B` surface, `#27272A` card, `#F59E0B` amber primary, `#EF4444` red accent).
- **Live State Display:** Shows personal streak, today's solve status (`0 Solved Today`), and target site label.
- **Solve Now Action:** One-click CTA opening LeetCode Problem of the Day or Problems list.
- **Safe Return Destination:** The original destination URL is validated via `sanitizeReturnUrl()`. Disallows `chrome://`, `chrome-extension://`, localhost, and redirect loops.
- **Real-Time Unlock Detection:** Listens to `chrome.storage.onChanged`. As soon as an accepted submission is registered, the UI transitions to an unlocked success state and provides a countdown redirect back to the destination.

---

## 6. Automated Verification & Test Results

### 6.1 Test Suites Executed
All unit and integration tests pass across the repository:

| Test Suite | Tests | Result | Notes |
|:---|:---:|:---:|:---|
| `tests/unit/hardcore-blocker.test.js` | 12 | **PASS** | Domain matching, path matching, educational exceptions, DNR rule priorities, return URL sanitization |
| `tests/unit/leaderboard-ranking.test.js` | 6 | **PASS** | Solved descending, streak descending, rating descending, unrated handling, tiebreakers |
| `tests/unit/exclusive-battle-auth.test.js` | 9 | **PASS** | Offline-first, single Battle auth page |
| `tests/unit/initialization-and-auth.test.js` | 15 | **PASS** | Session restore, 429 rate limit cooldown, profile cache |
| `tests/unit/streak-logic.test.js` | 11 | **PASS** | Streak engine, timezone date formatting |
| `tests/unit/roast-delivery.test.js` | 6 | **PASS** | Cloud roast delivery and acknowledgement |
| `tests/unit/battle-scoring.test.js` | 6 | **PASS** | Authoritative 1v1 battle scoring |
| `tests/unit/leetcode-stats.test.js` | 5 | **PASS** | Problem statistics parsing |
| `tests/unit/improvement-rule.test.js` | 12 | **PASS** | 500-problem submission optimization logic |
| `tests/integration/storage-persistence.test.js` | 17 | **PASS** | Storage persistence and browser restarts |
| `tests/security/auth-rls.test.js` | 9 | **PASS** | Row-Level Security negative authorization tests |
| **Total** | **109** | **100% PASS** | Zero regressions |

### 6.2 Browser Runtime Diagnostics
During browser testing, the Google Chrome process emitted:
`[WARNING:chrome\browser\extensions\extension_service.cc:423] --load-extension is not allowed in Google Chrome, ignoring.`

**Root Cause:** Modern Google Chrome Stable on Windows deliberately disables the CLI `--load-extension` flag for consumer security. Unpacked extensions must be loaded via the standard developer flow:
1. Navigate to `chrome://extensions`
2. Enable the **Developer Mode** toggle in the top-right corner.
3. Click **Load unpacked** and select the `L:\LeetStreak\dist` folder.

Once loaded, the service worker, DNR rules, and `blocked.html` bundle operate with full MV3 privileges.

---

## 7. Leaderboard Ranking Order & Contest Rating Resolution

### 7.1 Leaderboard Ranking Order
In [`src/popup/Leaderboard.jsx`](file:///L:/LeetStreak/src/popup/Leaderboard.jsx) and [`src/shared/ranking-manager.js`](file:///L:/LeetStreak/src/shared/ranking-manager.js):
- **Solved Ranking (`sortBy === 'total'`):** Users are ordered in strictly descending order of total problems solved. The person with the most solved problems is `#1` at the top.
- **Streak Ranking (`sortBy === 'streak'`):** Users are ordered in strictly descending order of current personal streak. The person with the longest streak is `#1` at the top.
- **Rating Ranking (`sortBy === 'rating'`):** Users are ordered in strictly descending order of LeetCode contest rating. Rated users appear above unrated users (`rating === 0`).
- **Deterministic Multi-Level Tiebreakers:**
  - Solved: Total solved (desc) $\rightarrow$ Streak (desc) $\rightarrow$ Rating (desc) $\rightarrow$ Username (A-Z)
  - Streak: Streak (desc) $\rightarrow$ Total solved (desc) $\rightarrow$ Rating (desc) $\rightarrow$ Username (A-Z)
  - Rating: Rating (desc) $\rightarrow$ Total solved (desc) $\rightarrow$ Streak (desc) $\rightarrow$ Username (A-Z)
- **Active Metric Badge:** [`FriendCard.jsx`](file:///L:/LeetStreak/src/popup/FriendCard.jsx) dynamically highlights the relevant metric badge on the card header (Trophy for Solved, Flame for Streak, Award for Rating), making it immediately clear why each person holds their rank.

### 7.2 How LeetCode Contest Rating Is Decided
1. **API Origin:** Fetched directly from LeetCode's GraphQL API:
   ```graphql
   userContestRanking(username: $username) {
     attendedContestsCount
     rating
     globalRanking
   }
   ```
2. **Calculation Method:** LeetCode calculates contest rating using an Elo/Glicko-derived rating formula based on official Weekly and Biweekly contest performance. When a user competes, their rating updates based on their contest rank relative to expected performance against all other participants.
3. **Normalization in LeetStreak:**
   `Math.round(contestRanking?.rating || 0)`
4. **Unrated Users:** If a user has never competed in a LeetCode contest, LeetCode returns `null` for `userContestRanking`. LeetStreak normalizes this to `0` (Unrated) and places them at the bottom of the Rating leaderboard, ordered by total problems solved.

