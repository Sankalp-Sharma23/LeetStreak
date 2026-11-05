# LeetStreak Database Architecture & SQL Migrations

**Version:** 2.0.0  
**Target Platform:** Supabase PostgreSQL (Postgres 15+)  
**Security Model:** Strict Row-Level Security (RLS) + Authenticated Identity Binding (`auth.uid()`) + Atomic `SECURITY DEFINER` Functions

---

## 1. Relational Entity Diagram

```mermaid
erDiagram
    AUTH_USERS ||--o| PROFILES : "1:1 identity"
    PROFILES ||--o| USER_SETTINGS : "1:1 private"
    PROFILES ||--o{ FRIENDSHIPS : "participates"
    PROFILES ||--o{ ROAST_MESSAGES : "sends/receives"
    PROFILES ||--o| USER_PRESENCE : "reports"
    PROFILES ||--o{ BATTLES : "competes"
    BATTLES ||--|{ BATTLE_RESULTS : "records"
    BATTLES ||--o{ BATTLE_EVENTS : "logs"

    PROFILES {
        uuid id PK "REFERENCES auth.users(id)"
        text leetcode_username UK "Case-insensitive unique"
        text display_name
        text avatar_url
        boolean is_verified
        text verification_token
        int total_solved
        int easy_solved
        int medium_solved
        int hard_solved
        int current_streak
        int longest_streak
        float contest_rating
        timestamptz last_synced_at
        timestamptz created_at
    }

    USER_SETTINGS {
        uuid user_id PK "REFERENCES profiles(id)"
        boolean hardcore_mode_enabled
        text[] blocked_sites
        text[] allowlist_urls
        jsonb path_rules
        text timezone
        boolean notifications_enabled
        boolean quiet_hours_enabled
        text quiet_hours_start
        text quiet_hours_end
        timestamptz snooze_until
        timestamptz updated_at
    }

    FRIENDSHIPS {
        uuid id PK
        uuid requester_id FK "REFERENCES profiles(id)"
        uuid addressee_id FK "REFERENCES profiles(id)"
        text status "pending | accepted | rejected | blocked"
        timestamptz created_at
        timestamptz updated_at
    }

    ROAST_MESSAGES {
        uuid id PK
        uuid sender_id FK "REFERENCES profiles(id)"
        uuid recipient_id FK "REFERENCES profiles(id)"
        text sender_username
        text recipient_username
        text content "Max 500 chars"
        text status "sent | delivered | read"
        timestamptz created_at
        timestamptz delivered_at
        timestamptz read_at
        timestamptz expires_at
    }

    USER_PRESENCE {
        uuid user_id PK "REFERENCES profiles(id)"
        text username
        timestamptz last_seen
        text status "online | in_battle | offline"
    }

    BATTLES {
        uuid id PK
        uuid challenger_id FK "REFERENCES profiles(id)"
        uuid challenged_id FK "REFERENCES profiles(id)"
        text challenger_username
        text challenged_username
        text language "Locked programming language"
        text status "Canonical status"
        text challenger_pick
        text challenger_pick_title
        text challenged_pick
        text challenged_pick_title
        text problem_1
        text problem_1_title
        text problem_2
        text problem_2_title
        boolean challenger_ready
        boolean challenged_ready
        timestamptz countdown_starts
        timestamptz match_starts_at
        timestamptz match_deadline
        timestamptz created_at
        timestamptz accepted_at
        timestamptz expires_at
        timestamptz completed_at
        uuid winner_id FK "REFERENCES profiles(id)"
        text winner_username
        text win_reason "points | tiebreaker_time | forfeit | timeout | draw"
    }

    BATTLE_RESULTS {
        uuid id PK
        uuid battle_id FK "REFERENCES battles(id)"
        uuid user_id FK "REFERENCES profiles(id)"
        text username
        text problem_slug
        text leetcode_submission_id "Idempotency key"
        boolean accepted
        timestamptz submitted_at
        int time_taken_seconds
        int runtime_ms
        float memory_mb
        text language
        int attempts
        int points "0 or 1 point"
    }

    BATTLE_EVENTS {
        bigserial id PK
        uuid battle_id FK "REFERENCES battles(id)"
        uuid user_id FK "REFERENCES profiles(id)"
        text event_type
        jsonb payload
        timestamptz created_at
    }
```

---

## 2. Canonical Status Vocabulary & State Transitions

The database adheres to a single canonical status vocabulary:
`'pending', 'accepted', 'selecting', 'ready_check', 'countdown', 'in_progress', 'completed', 'declined', 'expired', 'cancelled', 'forfeited'`

```mermaid
stateDiagram-v2
    [*] --> pending: Challenger invites friend
    pending --> declined: Opponent declines
    pending --> cancelled: Challenger cancels
    pending --> expired: Expiry timeout (24h)
    pending --> accepted: Opponent accepts
    accepted --> selecting: Selection window opens (5m)
    selecting --> ready_check: Both players pick 1 problem
    ready_check --> countdown: Both confirm ready
    countdown --> in_progress: Match starts (T + 10s)
    in_progress --> completed: Both solved 2 problems OR time expires (T + 2h)
    in_progress --> forfeited: A participant surrenders
    completed --> [*]
    forfeited --> [*]
```

---

## 3. SQL Migrations & Version Control

Versioned migrations are located under `supabase/migrations/`:
1. **Migration Script:** [`supabase/migrations/20261105000001_security_and_relational_schema.sql`](file:///l:/LeetStreak/supabase/migrations/20261105000001_security_and_relational_schema.sql)
2. **Rollback Script:** [`supabase/migrations/20261105000001_security_and_relational_schema.down.sql`](file:///l:/LeetStreak/supabase/migrations/20261105000001_security_and_relational_schema.down.sql)

### Migration Order & Deployment Instructions
```bash
# Apply migration to remote Supabase project:
npx supabase db push

# Or execute SQL directly via Supabase Dashboard SQL Editor:
# Copy contents of 20261105000001_security_and_relational_schema.sql into SQL Editor and run.
```

---

## 4. Row-Level Security (RLS) Policy Matrix

| Table | Operation | Allowed Identity | RLS Expression |
| :--- | :--- | :--- | :--- |
| `profiles` | `SELECT` | Public / Authenticated | `USING (true)` |
| `profiles` | `INSERT` / `UPDATE` | Owner only | `auth.uid() = id` |
| `user_settings` | `SELECT` / `ALL` | Owner only | `auth.uid() = user_id` |
| `friendships` | `SELECT` / `DELETE` | Mutual participants | `auth.uid() = requester_id OR auth.uid() = addressee_id` |
| `friendships` | `INSERT` | Requester | `auth.uid() = requester_id` |
| `roast_messages` | `SELECT` | Sender or Recipient | `auth.uid() = sender_id OR auth.uid() = recipient_id` |
| `roast_messages` | `INSERT` | Sender (Friend only) | `auth.uid() = sender_id AND EXISTS (accepted friendship)` |
| `roast_messages` | `UPDATE` | Recipient only | `auth.uid() = recipient_id` (mark delivered/read) |
| `battles` | `SELECT` | Match participants | `auth.uid() = challenger_id OR auth.uid() = challenged_id` |
| `battles` | `UPDATE` | Match participants | `auth.uid() IN (challenger, challenged) AND winner_id unchanged` |
| `battle_results` | `SELECT` | Match participants | Verified via parent `battles` relationship |
| `battle_results` | `INSERT` | Participant (Own result)| `auth.uid() = user_id AND active match` |
| `battle_results` | `UPDATE` | Disallowed | Append-only (tamper proof) |
