# LeetStreak Security Improvements & Hardening Log

## Overview
This document logs the comprehensive security enhancements implemented across the LeetStreak codebase, resolving legacy vulnerabilities, eliminating unsafe third-party token handling, and establishing database isolation.

---

## 1. Eliminated Plaintext Token Storage Vulnerability
- **Previous Risk:** The legacy GitHub integration stored personal access tokens and OAuth credentials in `chrome.storage.local`. The encryption implementation in `secure-token-manager.js` co-located the static AES-GCM password in plaintext alongside the ciphertext.
- **Remediation:** Completely removed GitHub integration and all associated token storage mechanisms. Stored user credentials for third-party git services no longer exist within the extension.

---

## 2. Manifest V3 CSP Compliance & Remote Script Removal
- **Previous Risk:** The Code Screenshot utility previously attempted to inject external script tags from `cdnjs.cloudflare.com` (`html2canvas.min.js`), causing Chrome Manifest V3 Content Security Policy violations and introducing remote supply-chain risk.
- **Remediation:** Replaced external library injection with an autonomous, native HTML5 `<canvas>` rendering engine located directly in `src/content/leetcode-integration.js`. Screenshots are rendered entirely offline and locally within the browser.

---

## 3. Row-Level Security & Database Isolation
- **Previous Risk:** `DATABASE_DESIGN.md` formerly defined global open policies (`USING (true)` / `WITH CHECK (true)`), allowing unauthenticated and unauthorized parties to read private user settings, overwrite another user's friends list, tamper with match winners, and modify competition scores.
- **Remediation:** Implemented PostgreSQL Row-Level Security across all 8 relational tables (`supabase/migrations/20261105000001_security_and_relational_schema.sql`):
  - `user_settings`: Restricted exclusively to `auth.uid() = user_id`.
  - `friendships`: Restricted to mutual participants.
  - `roast_messages`: Restricted to sender and recipient with friendship relationship validation.
  - `battles` & `battle_results`: Restricted to verified participants.
  - Winner assignment and scoring transitions are encapsulated in atomic `SECURITY DEFINER` database functions (`confirm_battle_ready`, `record_battle_submission`, `forfeit_battle`, `evaluate_and_finalize_battle`).

---

## 4. Idempotent Submission Verification
- **Previous Risk:** Re-submitting an already-solved problem in 1v1 battle mode could trigger race conditions or duplicate point awards.
- **Remediation:** Enforced composite uniqueness constraints on `(battle_id, user_id, problem_slug, leetcode_submission_id)` and a unique partial index for accepted solves. Replay attempts are handled idempotently (`ON CONFLICT DO NOTHING`), preventing duplicate points.

---

## 5. Network Protocol Enforcement & HSTS Auditing
- **Previous Risk:** Advisory documentation claimed custom certificate pinning, whereas the code only logged warnings and used placeholder fingerprints.
- **Remediation:** Reconciled documentation and code into `src/shared/https-enforcement.js`. Pre-flight network checks enforce strict HTTPS transport, and response auditing verifies `Strict-Transport-Security` headers on communication with `leetcode.com`.

---

## 6. DOM XSS Remediation
- **Previous Risk:** Content script HUD and button injectors previously used string concatenation with `innerHTML`.
- **Remediation:** Replaced all `innerHTML` usage with programmatic DOM node creation (`document.createElement`) and `textContent` assignment, neutralizing HTML injection vectors.
