# ADR-005: Authoritative 1v1 Battle System Architecture

## Status
Accepted

## Context
The 1v1 Fight System previously suffered from severe architectural issues:
1. Direct client-side mutations against Supabase tables without schema-level integrity or server-side authority.
2. The match scoring system used a non-standard rubric weighting lines of code, attempts, runtime beats%, and memory beats%. Runtime and memory rankings on LeetCode introduce heavy language and hardware biases and were explicitly forbidden by the specification.
3. Problem selection was unvalidated, timers were calculated on disparate client clocks without synchronization, and ready-checks were missing.

## Decision
Design and implement an authoritative 1v1 battle subsystem:
1. **Match Structure:**
   - 2 participants: Challenger and Opponent.
   - 1 programming language locked at room creation (e.g., Python3, Java, C++, JavaScript).
   - Problem Selection: Challenger selects 1 valid LeetCode problem, Opponent selects 1 valid LeetCode problem (Total = 2 problems).
   - Both players solve both problems in the agreed language.
2. **Deterministic Scoring Spec:**
   - 1 point per accepted problem.
   - The player with the highest number of completed problems wins.
   - If tied (e.g., both solved 2 problems, or both solved 1 problem), compare total accepted completion time across solved problems.
   - If total time is identical or neither solved any, result is a draw.
   - No points for lines of code or runtime beats%.
3. **State Machine:**
   `CREATED` → `PENDING_INVITATION` → `ACCEPTED` (or `DECLINED` / `EXPIRED`) → `SELECTING_PROBLEMS` → `READY_CHECK` → `COUNTDOWN` → `ACTIVE` → `COMPLETED` (or `FORFEITED` / `CANCELLED`).
4. **Synchronized Clocks & Backend Authority:**
   - Server sets `match_start_time` and `match_deadline`. Clients compute remaining time relative to server timestamps.
   - Accepted submissions are verified by problem slug, language, and accepted verdict before completion events are recorded.
   - Opponent solve notifications broadcast via Supabase Realtime and cached for reconnection reconciliation.

## Consequences
- **Positive:** Fair, cheat-resilient, deterministic competitive experience with clean recovery on tab refresh or network loss.
- **Negative:** Requires schema migration on Supabase to support ready check timestamps, composite keys, and normalized battle problems.

