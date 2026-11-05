# LeetStreak Low-Level Design (LLD)

**Version:** 1.0.0  
**Status:** Approved  
**Author:** Principal Software Architect & Full-Stack Specialist  
**Codebase Reference:** `src/shared/`, `src/background/`, `src/content/`, `src/popup/`

---

## 1. Module & Component Architecture

### 1.1 Personal Streak Engine (`src/shared/streak-calculator.js`)
- **Responsibilities:**
  - Receive normalized accepted submissions from LeetCode.
  - Map timestamps to calendar days in the user's persisted IANA timezone.
  - Calculate `currentStreak` (consecutive solve days ending today or yesterday).
  - Calculate `longestStreak` (monotonic maximum streak sequence achieved).
  - Detect streak risk (active streak > 0 but no accepted solve recorded today).
- **Inputs:** `allAcceptedSubmissions` (Array of `{ timestamp, titleSlug, title }`), `userTimezone` (String, default detected).
- **Outputs:** `{ currentStreak: number, longestStreak: number, isStreakAtRisk: boolean, solveDates: string[] }`.
- **Validation Rules:**
  - Failed submissions (Wrong Answer, TLE, etc.) are filtered out.
  - Multiple accepted submissions on the same calendar day count as one day.
  - If the latest solve was before yesterday, `currentStreak = 0`.

### 1.2 Centralized Notification Manager (`src/shared/notification-manager.js`)
- **Responsibilities:**
  - Validate dispatch against user preferences (`notifications_enabled`, quiet hours, snooze).
  - Deduplicate event alerts within rolling 24-hour windows.
  - Persist unread notification records in `chrome.storage.local` for in-app fallback.
  - Dispatch native Chrome desktop notifications (`chrome.notifications.create`).
  - Track delivery states: `QUEUED`, `DISPLAY_REQUESTED`, `FAILED`, `DISMISSED`, `CLICKED`.
- **Interface:**
  - `dispatchNotification(event: NotificationEvent): Promise<DispatchResult>`
  - `getUnreadNotifications(): Promise<NotificationItem[]>`
  - `markNotificationDismissed(id: string): Promise<void>`
  - `setSnooze(hours: number): Promise<void>`

### 1.3 Hardcore Blocker Manager (`src/background/blocker-manager.js` & `tab-monitor.js`)
- **Responsibilities:**
  - Manages Manifest V3 `chrome.declarativeNetRequest` dynamic rules for network-level main-frame blocking.
  - Enforces priority hierarchy: Priority 10 (System Whitelist), Priority 5 (User Allowlist), Priority 3 (Educational Exceptions), Priority 2 (Path-specific blocks), Priority 1 (Domain blocks).
  - Listens to `chrome.webNavigation.onHistoryStateUpdated` to intercept SPA route changes to restricted paths (e.g. YouTube Shorts).
  - Evaluates canonical solve-to-unlock condition via `hasSolvedToday()` and persisted IANA timezone.
  - Removes all dynamic blocking rules from Chrome's network engine upon verified accepted LeetCode solve.
  - Renders extension-owned motivational block page (`blocked.html`) with sanitized return URLs.
  - Manage session state in `chrome.storage.session` to survive service worker restarts.

### 1.4 Authoritative 1v1 Battle Manager (`src/shared/battle-manager.js`)
- **Responsibilities:**
  - Room creation with locked programming language.
  - Two-way invitation management (pending, accepted, declined, expired, cancelled).
  - Problem selection: Player A contributes 1 problem, Player B contributes 1 problem (2 total).
  - Validate problem slugs against LeetCode GraphQL before locking.
  - Ready-check confirmation and synchronized match countdown.
  - Verification of accepted submissions and opponent broadcast.
  - Deterministic scoring: 1 point per problem; tiebreaker by total accepted completion time.

---

## 2. Sequence Diagrams for Critical Flows

### 2.1 Personal Progress Synchronization & Streak Recalculation

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Popup as Extension Popup
    participant SW as Service Worker
    participant API as LeetCode GraphQL
    participant Storage as Chrome Storage
    participant Supabase as Supabase Cloud

    User->>Popup: Opens popup / clicks Refresh
    Popup->>SW: sendMessage({ type: 'FETCH_STATS', forceRefresh: true })
    SW->>API: fetchUserData(username)
    API-->>SW: { submitStats, allAcceptedSubmissions, contestRanking, submissionCalendar }
    SW->>SW: processUserData() -> calculateStreak(allAcceptedSubmissions, timezone)
    SW->>Storage: saveFriend(username, processedData)
    SW->>Supabase: upsertProfile(username, processedData)
    SW-->>Popup: { success: true, friends: updatedFriends }
    Popup->>User: Displays updated streak & stats
```

### 2.2 Hardcore Mode Solve-to-Unlock & Network-Level Website Restriction

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser as Chrome Network Engine
    participant DNR as DeclarativeNetRequest
    participant BM as Blocker Manager
    participant BlockedPage as Extension Blocked Page (blocked.html)
    participant LeetCode as LeetCode.com

    Note over User, BM: Scenario A: User Visits Distracting Site Unsolved
    User->>Browser: Navigates to instagram.com or youtube.com/shorts/...
    Browser->>DNR: Evaluate dynamic rules before network request
    alt Hardcore Mode Locked (Unsolved Today)
        DNR-->>Browser: Redirect main_frame (Priority 1/2) -> /blocked.html
        Browser->>BlockedPage: Load extension-owned blocked page
        BlockedPage-->>User: Display Challenge Waiting, Streak, & "Solve on LeetCode" CTA
    else Educational Exception (e.g. youtube.com/watch?v=...)
        DNR-->>Browser: Priority 3 Allow rule matches
        Browser-->>User: Load video tutorial unimpeded
    end

    Note over User, BM: Scenario B: User Solves Challenge
    User->>LeetCode: Submits accepted solution
    LeetCode-->>BM: Content script notifies SUBMISSION_ACCEPTED
    BM->>BM: syncBlockerRules() -> removes all DNR dynamic rules
    BM->>BlockedPage: storage.onChanged (last_solve_date = today)
    BlockedPage-->>User: Celebratory unlock banner & auto-redirects to original destination!
```

### 2.3 1v1 Battle: Creation to Match Completion

```mermaid
sequenceDiagram
    autonumber
    actor Challenger
    actor Opponent
    participant ExtA as Challenger Popup
    participant ExtB as Opponent Popup
    participant Server as Supabase (RPC + RLS)
    participant HUD as LeetCode Content Script

    Challenger->>ExtA: Selects Language & Invites Opponent
    ExtA->>Server: createBattle(challenger, opponent, language) [status: pending]
    Server-->>ExtB: Realtime Event: BATTLE_INVITE
    Opponent->>ExtB: Clicks "Accept Battle"
    ExtB->>Server: respondToBattle(battleId, accept: true) [status: selecting]

    par Problem Selection
        Challenger->>ExtA: Submits Problem 1 (valid slug)
        ExtA->>Server: submitProblemPick(battleId, slugA)
    and
        Opponent->>ExtB: Submits Problem 2 (valid slug)
        ExtB->>Server: submitProblemPick(battleId, slugB)
    end

    Server-->>Server: Both picked -> Transition -> status: ready_check
    Challenger->>ExtA: Clicks "I Am Ready!"
    ExtA->>Server: RPC confirm_battle_ready(battleId)
    Opponent->>ExtB: Clicks "I Am Ready!"
    ExtB->>Server: RPC confirm_battle_ready(battleId)
    Server-->>Server: Both Ready -> Sets synchronized timestamps -> status: countdown (10s) -> in_progress

    par Active Problem Solving (Both problems concurrently open)
        Challenger->>HUD: Opens problem on LeetCode
        HUD->>HUD: Injects Battle HUD (Timer & Opponent Status)
        Challenger->>HUD: Submits Solution -> Accepted!
        HUD->>Server: RPC record_battle_submission(battleId, slug, submissionId, accepted: true, elapsed)
        Server-->>ExtB: Realtime Notification: "Opponent solved Problem!"
    end

    Server-->>Server: Both completed 2 problems OR match deadline reached (2h)
    Server->>Server: RPC evaluate_and_finalize_battle() [1 pt/problem, tiebreak by total time, draw if equal]
    Server-->>ExtA: Displays Final Match Outcome (status: completed)
    Server-->>ExtB: Displays Final Match Outcome (status: completed)
```

---

## 3. State Machines

### 3.1 1v1 Battle Canonical State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: Challenger sends challenge
    pending --> declined: Opponent declines
    pending --> expired: 24h challenge timeout
    pending --> cancelled: Challenger cancels
    pending --> accepted: Opponent accepts
    
    accepted --> selecting: Selection window opens (5m)
    selecting --> ready_check: Both participants submit valid problem
    selecting --> expired: Selection window expires
    
    ready_check --> countdown: Both participants confirm readiness
    countdown --> in_progress: 10s countdown completes (official match start)
    
    in_progress --> in_progress: Problem solved / Opponent progress
    in_progress --> forfeited: Participant forfeits via RPC
    in_progress --> completed: Both solve 2 problems OR time limit (2h) expires
    
    completed --> [*]
    declined --> [*]
    cancelled --> [*]
    expired --> [*]
    forfeited --> [*]
```

### 3.2 Notification Delivery Lifecycle

```mermaid
stateDiagram-v2
    [*] --> QUEUED: Event generated (milestone, battle, streak risk)
    QUEUED --> DISMISSED: User settings disable notification / quiet hours / snoozed
    QUEUED --> DISPLAY_REQUESTED: Validated against preferences
    DISPLAY_REQUESTED --> SHOWN: Browser native notification displayed
    DISPLAY_REQUESTED --> FAILED: Browser notification permission denied / error
    SHOWN --> IN_APP_STORED: Persisted unconditionally to unread_notifications
    FAILED --> IN_APP_STORED: Fallback persistence in unread_notifications
    IN_APP_STORED --> DISMISSED: User clears in-app badge / dismisses toast
    SHOWN --> CLICKED: User clicks notification banner
    CLICKED --> [*]
    DISMISSED --> [*]
```

---

## 4. Interface & Runtime Messaging Contracts

Messages between content scripts, popup, options, and service worker follow a strict contract:

```typescript
type MessageType =
  | 'PING'
  | 'FETCH_STATS'
  | 'ADD_FRIEND'
  | 'REMOVE_FRIEND'
  | 'GET_FRIENDS'
  | 'ADD_TO_QUEUE'
  | 'SHOW_NOTIFICATION'
  | 'BATTLE_GET_STATUS'
  | 'BATTLE_CHALLENGE'
  | 'BATTLE_RESPOND'
  | 'BATTLE_PICK_PROBLEM'
  | 'BATTLE_READY'
  | 'BATTLE_SUBMISSION'
  | 'BATTLE_FORFEIT'
  | 'BATTLE_CANCEL'
  | 'BATTLE_VALIDATE_PROBLEM'
  | 'GET_LOGGED_IN_USER'
  | 'SEND_ROAST'
  | 'FETCH_PENDING_ROASTS'
  | 'CLEAR_ROASTS';

interface RuntimeMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}

interface RuntimeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
```

---

## 5. Algorithm Design & Complexity

### 5.1 Personal Streak Calculation Algorithm
- **Time Complexity:** $O(N \log N)$ where $N$ is the number of accepted submissions (due to initial timestamp sorting), followed by $O(D)$ where $D \le N$ is unique calendar days.
- **Space Complexity:** $O(D)$ for unique sorted date strings.
- **Algorithm:**
  1. Extract Unix timestamp from each item in `allAcceptedSubmissions`.
  2. Convert timestamp to calendar date `YYYY-MM-DD` using the user's configured IANA timezone via `Intl.DateTimeFormat`.
  3. Deduplicate dates into a sorted ascending array `sortedDates`.
  4. Iterate backwards starting from current date or yesterday:
     - Check for consecutive day gaps: `expectedDate - 1 day == actualDate`.
     - Continue incrementing `currentStreak` until a gap is encountered.
  5. Scan forward from beginning to compute `longestStreak = max(runLengths)`.

### 5.2 Deterministic 1v1 Battle Scoring Algorithm
- **Inputs:** `challengerResults`, `opponentResults` (submissions for problem 1 and problem 2).
- **Rules:**
  1. Each accepted problem grants **1 point**.
  2. Player with greater points wins:
     - If `pointsA > pointsB` $\implies$ Winner: Player A.
     - If `pointsB > pointsA` $\implies$ Winner: Player B.
  3. If points are equal (e.g., both 2 points or both 1 point):
     - Compute total accepted completion time: $T = \sum t_i$ for all accepted problems.
     - If $T_A < T_B \implies$ Winner: Player A.
     - If $T_B < T_A \implies$ Winner: Player B.
     - If $T_A == T_B \implies$ Draw.
  4. If neither solved any problem $\implies$ Draw.

