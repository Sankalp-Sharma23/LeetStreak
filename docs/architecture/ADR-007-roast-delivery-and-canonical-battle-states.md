# ADR-007: Canonical Battle State Machine & Durable Roast Delivery Architecture

## Status
Accepted

## Context
1. **Contradictory Battle State Vocabularies:** Prior documentation and implementations used conflicting state sets (e.g. `CREATED`, `SELECTING_PROBLEMS`, `ACTIVE`, versus `problem_1_active`, `problem_1_waiting`, `transitioning`, `problem_2_active`). Furthermore, a sequential problem-1-then-problem-2 restriction contradicted the product requirement for participants to concurrently access both problems.
2. **Roast Delivery Flaw:** Roasts were previously implemented by overwriting the recipient's entire `user_settings.pending_roasts` JSON array, causing race conditions and requiring public write access to private user settings.

## Decision
1. **Single Canonical Battle State Model:**
   - Unified status vocabulary across database constraints, RPC functions, client managers, UI, and documentation:
     `pending -> accepted -> selecting -> ready_check -> countdown -> in_progress -> completed` (with terminal states: `completed`, `declined`, `expired`, `cancelled`, `forfeited`).
   - Concurrency: In `in_progress`, both Problem 1 and Problem 2 are independently and concurrently accessible to both participants.
   - Deterministic scoring: 1 point per problem (max 2), tiebreaker on total accepted completion time, draw if equal. Under no circumstances are lines-of-code or hardware-dependent beats% used.
2. **Normalized Durable Roast Messaging:**
   - Replaced JSON arrays with a dedicated `roast_messages` table.
   - Recipient delivery lifecycle: `sent -> delivered -> read`.
   - Offline recovery: unread messages are fetched from durable storage upon reconnect or startup.
   - Clear distinction between peer roasts (durable messages) and local Hardcore Mode motivational roasts (in-tab blocker overlay).

## Consequences
- **Positive:** Elimination of race conditions when multiple users send roasts.
- **Positive:** Unambiguous match lifecycle; players can solve problems in any order during active matches.
- **Positive:** Deterministic battle scoring guarantees consistent, dispute-free results.

