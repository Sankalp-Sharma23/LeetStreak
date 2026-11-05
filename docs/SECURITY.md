# LeetStreak Security Architecture & Guidelines

## Overview
LeetStreak implements defense-in-depth security measures to protect user privacy, prevent code injection, enforce transport integrity, and isolate social and competitive match data.

---

## 1. Content Security Policy (CSP) & Manifest V3
**Location:** `public/manifest.json`

The extension strictly enforces Chrome Extension Manifest V3 security boundaries:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests;",
  "sandbox": "sandbox allow-scripts; script-src 'self'"
}
```

**Guarantees:**
- **Zero External Scripts:** Remote code execution via CDN scripts (e.g. `html2canvas`, remote analytics) is completely prohibited. Code screenshot generation is implemented using native HTML5 `<canvas>`.
- **Object Embedding Blocked:** Blocks legacy embed tags (`object-src 'none'`).
- **Clickjacking Prevention:** Extensions pages cannot be framed by external web origins (`frame-ancestors 'none'`).
- **Transport Upgrade:** All insecure HTTP requests are automatically upgraded to HTTPS.

---

## 2. Input Validation & XSS Prevention
**Location:** `src/shared/security-utils.js`, `src/shared/validation.js`, `src/content/leetcode-integration.js`

### Username Validation
```javascript
validateUsername(username, minLength = 1, maxLength = 50)
```
- Restricts characters to alphanumeric, underscores, and hyphens (`/^[a-zA-Z0-9_-]+$/`).
- Enforces strict length boundaries (1–50 characters).
- Normalizes to lowercase before database operations.

### URL Validation
```javascript
isValidUrl(url, allowedProtocols = ['https:'], allowedHosts = null)
```
- Guarantees strict `https:` protocol.
- Enforces host allowlisting for external requests (`leetcode.com`, Supabase endpoint).
- Prevents Server-Side Request Forgery (SSRF) and malicious redirects.

### DOM-Based Element Creation (Anti-XSS)
- Content scripts on `leetcode.com` strictly prohibit `innerHTML` when interpolating external or user-provided data.
- Elements are created using `document.createElement()`, with content assigned via `textContent` or sanitized SVG construction.

---

## 3. Network Transport Security & Header Auditing
**Location:** `src/shared/https-enforcement.js`

### Browser TLS & Header Auditing
> [!NOTE] BROWSER EXTENSION TLS BOUNDARY
> Chrome Extensions in Manifest V3 do not have access to raw TLS/SSL socket details or X.509 certificate chains via standard `fetch` or `chrome.webRequest` APIs. TLS validation is natively enforced by the underlying Chromium network stack.

- **HTTPS Protocol Enforcement:** Pre-flight checks unconditionally reject any non-HTTPS target URL.
- **Strict-Transport-Security (HSTS) Auditing:** Verifies presence of HSTS response headers from `leetcode.com` to prevent downgrade attacks.
- **Host Allowlisting:** Network communications are restricted exclusively to `leetcode.com` and the configured Supabase backend.

---

## 4. API Rate Limiting & DoS Protection
**Location:** `src/shared/security-utils.js`, `src/background/leetcode-api.js`

- **LeetCode GraphQL API:** Governed by a token-bucket rate limiter enforcing a maximum of 30 requests per minute.
- **Backoff & Jitter:** Automatically handles HTTP 429 responses with exponential backoff and randomized jitter.
- **Cache Windows:** Statistics queries are cached locally in `chrome.storage.local` with a 15-minute refresh throttle.

---

## 5. Database Authorization & Row-Level Security (RLS)
**Location:** `supabase/migrations/20261105000001_security_and_relational_schema.sql`

All tables in the Supabase backend enforce Row-Level Security:
1. **User Settings (`user_settings`):** Accessible exclusively by the authenticated owner (`auth.uid() = user_id`). Zero public read or write access.
2. **Friendships (`friendships`):** Only authorized participants can read or modify friendship status (`auth.uid() = requester_id OR auth.uid() = addressee_id`).
3. **Roast Messages (`roast_messages`):** Restricted to sender and recipient. Sending roasts requires an accepted friendship relationship.
4. **Battles (`battles`):** Visible and updateable only by match participants. Raw client SQL updates cannot modify `winner_id` or `winner_username`.
5. **Battle Results (`battle_results`):** Submissions are append-only and validated by atomic `SECURITY DEFINER` RPC functions with idempotency constraints on `leetcode_submission_id`.

---

## 6. Threat Model Summary

| Threat Category | Mitigation Status | Mechanism |
| :--- | :--- | :--- |
| **Cross-Site Scripting (XSS)** | **Mitigated** | Strict CSP, elimination of `innerHTML`, native DOM construction |
| **Credential Plaintext Theft** | **Mitigated** | Deprecation and complete removal of stored third-party OAuth access tokens |
| **Arbitrary Battle Win Forgery** | **Mitigated** | Atomic RPC (`evaluate_and_finalize_battle`), RLS check on `winner_id` |
| **Private Settings Leakage** | **Mitigated** | Strict RLS (`auth.uid() = user_id`), isolation from public profiles |
| **API Denial of Service** | **Mitigated** | Token-bucket client rate limiting, 15-minute storage cache |
| **Man-In-The-Middle (MITM)** | **Mitigated** | Strict HTTPS enforcement, Chromium native certificate verification, HSTS auditing |

---

## 7. Incident Response & Responsible Disclosure

If a security issue or authorization bypass is discovered:
1. Report privately to the repository maintainers.
2. Provide reproduction steps, affected versions, and potential impact.
3. Allow remediation and release of an updated unpacked/webstore build prior to public disclosure.
