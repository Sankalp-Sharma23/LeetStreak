# LeetStreak Security Audit & Vulnerability Assessment

**Version:** 1.0.0  
**Status:** Completed  
**Security Engineer / Lead:** Antigravity Engineering

---

## 1. Threat Model & Security Boundaries

LeetStreak operates across three distinct security boundaries:
1. **Third-Party Untrusted DOM (`leetcode.com`):** Content scripts execute in an isolated world with access to page DOM. Page scripts or DOM changes could potentially inject malicious text into extension popups if not properly sanitized.
2. **Local Browser Storage & Extension Sandbox:** The background service worker and React extension pages communicate via Chrome's internal message bus (`chrome.runtime.sendMessage`).
3. **Remote Supabase Backend:** Client communicates over HTTPS using public anonymous keys (`apikey` and `Authorization: Bearer <anon>`).

---

## 2. Vulnerability Findings & Remediation

### VULN-01: Symmetric Key Co-location with Ciphertext (High Severity)
- **Affected File:** `src/shared/secure-token-manager.js`
- **Exploit Scenario:** The module used AES-GCM encryption for GitHub access tokens. However, in `storeEncryptedToken`:
  ```javascript
  dataToStore[`${keyName}_encrypted`] = encrypted;
  dataToStore[`${keyName}_key`] = password; // Raw key stored in same storage!
  await chrome.storage.local.set(dataToStore);
  ```
  Any script with access to `chrome.storage.local` could read both the key and ciphertext simultaneously, rendering encryption ineffective.
- **Remediation:** With the complete removal of the GitHub integration, token storage is fully deprecated. No external third-party access tokens are stored in the extension.

### VULN-02: Content Security Policy Violation via Remote Script Injection (Medium Severity)
- **Affected File:** `src/content/leetcode-integration.js`
- **Exploit Scenario:** The content script attempted to inject a remote CDN script (`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`) into the LeetCode web page DOM. In Manifest V3, loading arbitrary remote scripts violates CSP and introduces supply-chain tampering risks.
- **Remediation:** Replace remote `html2canvas` script injection with a pure native HTML5 `<canvas>` rendering engine bundled directly within the extension.

### VULN-03: DOM-based XSS via LeetCode Profile Attributes (Low / Mitigated)
- **Affected File:** `src/popup/FriendCard.jsx`, `src/popup/AddFriend.jsx`
- **Exploit Scenario:** LeetCode usernames or real names containing HTML markup could lead to XSS if rendered via `innerHTML`.
- **Remediation:** All user-supplied strings are rendered using React JSX text nodes (which natively escape HTML) and validated using regex `^[a-zA-Z0-9_-]{3,30}$` in `src/shared/validation.js`.

### VULN-04: Sender Validation on Runtime Messages (Medium Severity)
- **Affected File:** `src/background/service-worker.js`
- **Exploit Scenario:** Malicious external web pages could attempt to send runtime messages to the extension if `externally_connectable` was configured loosely.
- **Remediation:** LeetStreak does not declare `externally_connectable`. `chrome.runtime.onMessage` only accepts messages from the extension's own origin and declared content scripts.

### VULN-05: Rate Limiting & Certificate Pinning (Low / Informational)
- **Affected File:** `src/background/leetcode-api.js`, `src/shared/security-utils.js`
- **Status:** Rate limiter configured to 30 requests per minute with exponential backoff on HTTP 429 to prevent accidental abuse of LeetCode GraphQL endpoints.

