<div align="center">

# 🔥 LeetStreak

**The Ultimate Social & Competitive LeetCode Companion for Chrome**

*Track personal streaks offline, block distracting websites with Hardcore Mode, challenge friends to real-time 1v1 coding battles, and climb competitive leaderboards.*

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension%20MV3-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%26%20RLS-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Tests](https://img.shields.io/badge/Tests-110%20Passing-brightgreen?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)
[![License](https://img.shields.io/badge/License-MIT-amber.svg?style=for-the-badge)](LICENSE)

**Crafted with precision by [Sankalp Sharma](https://github.com/Sankalp-Sharma23)**

[Quick Start](#-quick-start) • [Key Features](#-key-features) • [Architecture](#-architecture--design) • [Hardcore Mode Blocker](#-hardcore-productivity-blocker) • [1v1 Battles & Auth](#-1v1-battle-system--auth) • [Testing](#-test-suite--quality-assurance)

</div>

---

## ⚡ Quick Start

You can run LeetStreak in **under 60 seconds** — pre-bundled and ready to load without mandatory build steps.

### 📥 Load Unpacked Extension in Chrome

1. **Clone the Repository**
   ```bash
   git clone https://github.com/Sankalp-Sharma23/LeetStreak.git
   cd LeetStreak
   ```

2. **Open Extensions Management**
   - In Google Chrome, navigate to `chrome://extensions/`
   - Enable **Developer mode** via the toggle switch in the top-right corner

3. **Load the Unpacked Directory**
   - Click **Load unpacked**
   - Select the `dist/` folder inside the cloned `LeetStreak` repository

4. **Start Tracking**
   - Click the **LeetStreak** icon in your Chrome toolbar
   - Click **Auto-Detect Profile** (or enter your LeetCode username)
   - Your streaks, problem heatmap, and stats will hydrate immediately!

---

## ✨ Key Features

### 1. 🛡️ 100% Offline-First Personal Progress
- **Zero Mandatory Login**: All personal stats, streaks, heatmaps, daily challenges, and analytics function 100% locally without cloud account requirements.
- **Accurate Streak Engine**: Canonical personal streak calculation matching official LeetCode UTC midnight rollover, with timezone-aware grace periods.
- **Problem of the Day**: Native integration fetching the official daily challenge problem with topics, difficulty tags, and direct solve links.
- **Local Problem Queue**: Bookmark problems to solve later; automatically syncs and marks problems complete when accepted on LeetCode.
- **Yearly Activity Heatmap**: Interactive GitHub-style submission contribution grid with multi-level intensity shading.

### 2. 🚫 Hardcore Motivation Mode (Network-Level Website Blocker)
- **Manifest V3 Network Enforcement**: Uses Chrome's `declarativeNetRequest` engine to intercept and block distracting websites at the network frame level before DNS and HTML parsing.
- **Solve-to-Unlock Rule**: Distracting websites remain strictly locked until your first accepted LeetCode submission of the calendar day.
- **Default Distraction List**: Blocks Instagram, TikTok, Reddit, Netflix, YouTube Shorts, Twitter/X, Twitch, and web messaging platforms (WhatsApp Web, Telegram Web, Discord).
- **Smart Allowlisting**: Permits educational paths (e.g. YouTube problem walkthroughs, documentation, LeetCode contest pages).
- **Sweep on Lock**: Automatically detects and redirects already-open distracting tabs when locked.
- **Dynamic Roast Hero Page**: Distraction attempts are redirected to an interactive block screen displaying savage coding roasts and motivating quotes with shuffle controls.

### 3. ⚔️ Real-Time 1v1 Battle System
- **Competitive Head-to-Head**: Challenge friends or match with random rivals in 45-minute 2-problem coding face-offs.
- **Authoritative Scoring**:
  - `+1 point` awarded per unique accepted problem (max 2 points per competitor).
  - Deterministic tiebreaker: Total elapsed submission time in seconds.
  - Draws cleanly adjudicated when points and timings are identical.
- **Live Problem State Tracking**: Background tab monitor detects submissions in real-time, verifying acceptance without relying on client-spoofed claims.
- **Canonical State Machine**: Enforces valid match progressions: `WAITING_OPPONENT` → `MATCHED` → `ACTIVE` → `EVALUATING` → `COMPLETED` / `EXPIRED`.

### 4. 🔐 Isolated Battle Authentication & Supabase RLS
- **No Global Auth Wall**: Authentication is quarantined strictly to the **1v1 Battle** view. Non-battle views (Streak, Friends Leaderboard, Analytics, Settings) never prompt or block for credentials.
- **Cryptographic User Identities**: User authorization is backed by immutable Supabase Auth UUIDs, never raw user-provided strings.
- **Hardened PostgreSQL Row-Level Security (RLS)**:
  - Private settings readable and writable only by the authenticated owner (`auth.uid() = user_id`).
  - Battles readable only by participating players or pending challengers.
  - Battle results append-only, validated against participant memberships with zero client-side winner overrides.
  - Roast messages accessible strictly by sender and recipient.
- **Anti-Spam Rate Limit Handling**: Automatic cooldown protection on HTTP 429 errors prevents authentication request flooding.

### 5. 🏆 Social Leaderboard & Dynamic Ranking
- **Multi-Metric Sorting**:
  - **Solved**: Highest total problem solves at top with difficulty-weighted tiebreakers.
  - **Streak**: Longest continuous active streak with historical bests as tiebreakers.
  - **Rating**: Official LeetCode contest rating with unrated users placed deterministically at the base.
- **In-App Peer Roasts**: Send fun, motivational roasts to friends with 0-day streaks. Features durable local delivery queues and read acknowledgement lifecycles.

---

## 🏗️ Architecture & Design

LeetStreak follows an asynchronous, event-driven Chrome Extension architecture built for speed, security, and low memory overhead:

```
┌─────────────────────────────────────────────────────────────────┐
│                      LeetStreak Extension                       │
└─────────────────────────────────────────────────────────────────┘
         │                                              │
 ┌───────▼────────┐                            ┌────────▼────────┐
 │  Popup UI      │                            │ Hardcore Mode   │
 │  (React 19)    │                            │ Block Screen    │
 └───────┬────────┘                            └────────┬────────┘
         │ Chrome Message Passing                       │
         ▼                                              ▼
 ┌────────────────────────────────────────────────────────────────┐
 │                 Background Service Worker                      │
 │  • Blocker Manager (declarativeNetRequest Rules)               │
 │  • LeetCode GraphQL Client (with 429 exponential backoff)      │
 │  • Tab Activity Monitor & Submission Event Detector            │
 │  • Alarms & Periodic Sync Engine                               │
 └───────┬──────────────────────────────┬─────────────────────────┘
         │                              │
         ▼                              ▼
 ┌───────────────┐              ┌────────────────┐
 │ Chrome Storage│              │ Supabase Cloud │
 │ (Cache/State) │              │ (Auth, Battles)│
 └───────────────┘              └────────────────┘
```

### Architectural Decision Records (ADRs)
Detailed engineering specifications and rationale are documented in [`docs/architecture/`](docs/architecture/):
- **ADR-001**: Removal of legacy GitHub OAuth device sync to eliminate speculative surface area.
- **ADR-002**: Canonical personal streak calculation engine matching LeetCode UTC midnight standard.
- **ADR-003**: Centralized Notification Manager and storage persistence model.
- **ADR-004**: Manifest V3 `declarativeNetRequest` Hardcore Solve-to-Unlock architecture.
- **ADR-005**: Authoritative 1v1 Battle System with server-side validation.
- **ADR-006**: Supabase Auth isolation and Row-Level Security (RLS) policies.
- **ADR-007**: Roast message delivery state machines and canonical battle states.

---

## 🚫 Hardcore Productivity Blocker

Hardcore Mode prevents digital procrastination during coding sessions.

### How It Operates
1. **Rule Engine Generation**: The extension dynamically compiles a rule set for `chrome.declarativeNetRequest`:
   - `block` rules intercept all `main_frame` navigation requests matching restricted domain patterns.
   - Redirect rules divert blocked requests to `chrome-extension://<id>/blocked.html`.
2. **Instant Open Tab Sweep**: When Hardcore Mode locks or unlocks, the background service worker evaluates currently open tabs across all browser windows and immediately redirects distracting pages.
3. **Automatic Unlock**: When you submit an accepted solution on `leetcode.com`, the content script captures the accepted submission token and notifies the background worker. All blocker rules are dynamically removed, instantly unlocking your browser.

---

## ⚔️ 1v1 Battle System & Auth

| Feature | Unauthenticated User | Authenticated User |
| :--- | :--- | :--- |
| **Personal Streak & Heatmap** | ✅ Full access (Offline) | ✅ Full access |
| **Problem of the Day** | ✅ Full access (Offline) | ✅ Full access |
| **Problem Queue** | ✅ Full access (Offline) | ✅ Full access |
| **Hardcore Website Blocker** | ✅ Full access (Offline) | ✅ Full access |
| **Friends Leaderboard** | ✅ Full access (Cached) | ✅ Full access |
| **1v1 Coding Battles** | 🔒 Auth Screen on Battle Tab | ✅ Matchmaking & Live Battles |
| **Cloud Roast Delivery** | 🔒 Requires Battle Auth | ✅ Send & Receive Roasts |

---

## 🧪 Test Suite & Quality Assurance

LeetStreak includes a comprehensive automated test suite powered by Jest covering unit, integration, and security specifications.

### Running Tests

```bash
# Run all unit, integration, and security tests
npm test

# Run tests in watch mode
npm run test:watch

# Run test coverage report
npm test -- --coverage
```

### Verified Test Suites (11 Suites / 110 Tests Passing)
- **`tests/unit/hardcore-blocker.test.js`**: Validates URL pattern detection, educational path exceptions, DNR rule schema generation, and open-tab sweeps.
- **`tests/security/auth-rls.test.js`**: Negative authorization tests validating that anonymous users, rival players, and third parties cannot tamper with private settings, submissions, or battle results.
- **`tests/unit/battle-scoring.test.js`**: Validates authoritative point tallies, time-based tiebreakers, draw adjudication, and canonical state machines.
- **`tests/unit/exclusive-battle-auth.test.js`**: Confirms that non-battle views never trigger login forms and that startup sequence never spams auth endpoints.
- **`tests/unit/initialization-and-auth.test.js`**: Verifies graceful degradation on Supabase 429 rate limits, token expirations, and offline handling.
- **`tests/unit/leaderboard-ranking.test.js`**: Tests deterministic sorting for Solved, Streak, and Contest Rating.
- **`tests/unit/leetcode-stats.test.js`**: Tests resilient parsing of LeetCode GraphQL statistics.
- **`tests/unit/roast-delivery.test.js`**: Tests peer roast message persistence, status progression, and length restrictions.
- **`tests/unit/streak-logic.test.js`**: Tests UTC consecutive day calculations and data freshness checks.
- **`tests/integration/storage-persistence.test.js`**: Tests persistent storage integrity across browser restarts.
- **`tests/unit/improvement-rule.test.js`**: Tests submission performance comparison rules.

---

## 🛠️ Development & Building from Source

### Prerequisites
- **Node.js** (v18.0.0 or higher)
- **npm** (v9.0.0 or higher)
- **Google Chrome** (v120 or higher)

### Build Pipeline

```bash
# 1. Install dependencies
npm install

# 2. Compile client, background service worker, and content scripts
npm run build

# 3. Development watch mode
npm run build:watch
```

Output files are compiled directly into the [`dist/`](dist/) folder, packaged with the Manifest V3 manifest, icons, and HTML entry points.

---

## 📂 Repository Structure

```
LeetStreak/
├── dist/                      # Pre-compiled, loadable Chrome Extension bundle
├── docs/                      # Engineering documentation, LLD, HLD, and ADRs
│   ├── architecture/          # Architectural Decision Records (ADR-001 to ADR-007)
│   ├── DATABASE_DESIGN.md     # Relational schema and Supabase RLS policies
│   ├── HLD.md                 # High-Level Architecture Document
│   └── LLD.md                 # Low-Level Component Specification
├── public/                    # Static assets, icons, and manifest.json
├── src/
│   ├── background/            # Service worker, blocker manager, leetcode API
│   ├── blocked/               # Hardcore Mode distraction blocked screen (React)
│   ├── content/               # Content scripts injecting LeetCode observers
│   ├── popup/                 # Extension popup interface (Streak, Leaderboard, Battles)
│   └── shared/                # Core calculation utilities, Supabase client, storage
├── supabase/
│   └── migrations/            # Idempotent PostgreSQL security migrations
├── tests/                     # Unit, integration, and security test suites
├── vite.config.js             # Multi-target Vite bundling configuration
└── package.json               # Scripts, dependencies, and metadata
```

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <b>Built for developers who want to stay focused, build consistent habits, and master data structures & algorithms.</b><br>
  Made with ❤️ by <a href="https://github.com/Sankalp-Sharma23">Sankalp Sharma</a>
</div>
