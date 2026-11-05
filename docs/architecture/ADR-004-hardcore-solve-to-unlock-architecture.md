# ADR-004: Hardcore Motivation Mode & Network-Level Solve-To-Unlock Architecture

## Status
Updated & Accepted (Phase 3 Rebuild)

## Context
The previous Hardcore Mode relied exclusively on `chrome.tabs.onUpdated` listening for `changeInfo.status === 'complete'`, scheduling 10-second alarms, and attempting to inject DOM overlays after sites had already loaded. This failed to block distracting websites:
1. Injected DOM overlays were easily dismissed or bypassed via browser inspector.
2. Web sites with strict Content Security Policies (CSP) rejected injected scripts.
3. A 15-minute cooldown left users unmonitored after a single visit.
4. Single-Page Application (SPA) client-side route changes (such as clicking YouTube Shorts from a normal video) were not reliably caught.

## Decision
1. **Network-Level declarativeNetRequest (DNR):** Migrate the primary blocking mechanism to Chrome Manifest V3 `chrome.declarativeNetRequest` dynamic rules. Distracting `main_frame` navigation requests are intercepted at the network level and redirected to the extension-owned `blocked.html` before any server connection is established.
2. **Deterministic Priority Hierarchy:**
   - Priority 10: Critical System Whitelist (`leetcode.com/*`)
   - Priority 5: User-Configured Custom Allowlist
   - Priority 3: Path-Specific Educational Exceptions (`youtube.com/watch*`, `linkedin.com/jobs*`)
   - Priority 2: Path-Specific Distraction Blocks (`youtube.com/shorts*`, `linkedin.com/feed*`)
   - Priority 1: Whole Domain Blocks (`instagram.com`, `tiktok.com`, `reddit.com`, `netflix.com`, etc.)
3. **SPA Navigation Monitoring:** Supplement DNR with `chrome.webNavigation.onHistoryStateUpdated` to intercept in-tab client-side route changes to restricted paths and redirect them to `blocked.html`.
4. **Authoritative Blocker Manager (`src/background/blocker-manager.js`):** Unified, idempotent rule synchronization reacting to service worker initialization, `storage.onChanged`, accepted LeetCode submissions, and midnight/timezone rollover.
5. **Motivational Block Page (`blocked.html`):** Extension-owned, high-performance UI displaying personal streak, unsolved status, LeetCode solve CTA, safe return destination URL validation, and real-time solve detection.
6. **Solve-to-Unlock Rule:** Only the current user's accepted LeetCode submissions unlock the blocker. One accepted solution clears all dynamic rules from Chrome's network engine until the next calendar day in the user's configured IANA timezone.

## Consequences
- **Positive:** True zero-load blocking before pages download; immune to in-page script tampering or site CSPs; educational exceptions preserved; immediate responsive unlock upon solve.
- **Negative:** Requires `declarativeNetRequest`, `webNavigation`, and `tabs` permissions in `manifest.json`.
