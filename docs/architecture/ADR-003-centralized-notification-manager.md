# ADR-003: Centralized Notification Pipeline with In-App Fallback

## Status
Accepted

## Context
Browser notifications were failing to display reliably across different operating systems and Manifest V3 lifecycles:
1. `SettingsPanel.jsx` stored `notifications_enabled`, but background dispatches ignored the toggle.
2. In Manifest V3, background service workers suspend frequently, leading to missed in-memory events.
3. System notification settings or do-not-disturb modes on macOS/Windows frequently suppress native Chrome notifications without returning errors.
4. Notifications lacked proper click actions, deduplication, quiet hours enforcement, and delivery state tracking.

## Decision
Implement a single authoritative `NotificationManager` in `src/shared/notification-manager.js`:
1. **Pipeline Architecture:**
   - Pre-dispatch validation: check user settings (`notifications_enabled`, quiet hours, active snooze).
   - Deduplication: calculate deterministic event hashes to prevent duplicate notifications on background polling retries.
   - Dual delivery: always persist unread notification records to `chrome.storage.local` (in-app toast fallback), and conditionally request `chrome.notifications.create`.
   - Lifecycle tracking: track states (`QUEUED`, `DISPLAY_REQUESTED`, `FAILED`, `DISMISSED`, `CLICKED`).
   - Notification click handlers: route users directly to the relevant resource (e.g., LeetCode problem, battle view).

## Consequences
- **Positive:** Guaranteed delivery of alerts via in-app fallback even if OS blocks notifications; centralized settings compliance.
- **Negative:** Requires storing notification event logs in Chrome storage with bounded history cleanup.

