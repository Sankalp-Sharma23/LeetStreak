# ADR-006: Supabase Authentication, Identity Binding & Row-Level Security Architecture

## Status
Accepted

## Context
The legacy database schema relied on open access (`USING (true)` / `WITH CHECK (true)`), lacked real identity binding, and treated user-entered LeetCode usernames as authorization identities. In a multi-user competitive Chrome Extension, a public anon key does not authenticate a user, and a LeetCode handle is public information, not a secret credential.

Without authenticated identity binding:
- Any client could read or overwrite any user's private settings.
- Malicious actors could forge battle results, tamper with match winners, and manipulate social relationships.

## Decision
1. **Tripartite Identity Separation:**
   - **Internal Application ID (`auth.uid()`, UUID):** Cryptographic identity managed by Supabase Auth (GoTrue). All authorization decisions and RLS policies evaluate `auth.uid()`.
   - **LeetCode Username (`leetcode_username`, TEXT):** Case-insensitive unique handle linked to `public.profiles(id)`. Used for peer lookup and public stats.
   - **Public Profile vs. Private Settings:** Public statistics (`total_solved`, `current_streak`, `contest_rating`) live in `public.profiles`. Private settings (`blocked_sites`, `allowlists`, `path_rules`, `quiet_hours`) live in `public.user_settings` and are strictly private (`auth.uid() = user_id`).
2. **PostgreSQL Row-Level Security (RLS):**
   - Enabled and enforced across all tables.
   - Private settings: Owner-only (`auth.uid() = user_id`).
   - Friendships: Mutual participant-only (`auth.uid() = requester_id OR auth.uid() = addressee_id`).
   - Battles: Participant-only.
   - Battle Results: Participant-only, append-only, with idempotency constraints on `leetcode_submission_id`.
3. **Atomic Trusted RPC Functions (`SECURITY DEFINER`):**
   - Winner finalization and scoring are encapsulated in database functions (`confirm_battle_ready`, `record_battle_submission`, `forfeit_battle`, `evaluate_and_finalize_battle`), preventing client-side winner forgery.

## Consequences
- **Positive:** True zero-trust data isolation. Negative authorization tests guarantee that anonymous and unauthorized users cannot access or tamper with private data.
- **Positive:** Third-party git tokens are eliminated; user authentication is managed natively via Supabase JWTs.
- **Negative:** Schema migrations require running versioned SQL scripts (`20261105000001_security_and_relational_schema.sql`).

