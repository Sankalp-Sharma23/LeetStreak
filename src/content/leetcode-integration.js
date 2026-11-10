import {
  isAcceptedVerdict,
  isFailedVerdict,
  isFreshAcceptedResult,
  parseLeetCodePerformance
} from '../shared/battle-submission.js';
import { maybeShowEnoReminder } from './eno-reminder.js';

/**
 * LeetCode Page Content Script — LeetStreak Battle HUD
 *
 * Responsibilities:
 * 1. Detect "Accepted" submission verdicts
 * 2. Auto-redirect to next battle problem after solving
 * 3. Render a battle HUD bar (countdown, scores, opponent progress)
 * 4. Show opponent-solved toast notifications
 * 5. Report accepted solves to service worker
 * 6. "Add to Queue" button injection right of the Submit button
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────

  let activeBattle      = null;  // battle row from service worker
  let battleProblems    = [];    // [{sequence_number, problem_slug, problem_title, problem_url, difficulty}]
  let myResults         = [];    // my accepted solves
  let oppResults        = [];    // opponent's accepted solves
  let myUsername        = null;
  let hudInjected       = false;
  let hudTimer          = null;
  let submissionObserving = false;
  let redirectPending   = false; // prevent double-redirect
  let sidebarCollapsed  = null;
  let sidebarTimer      = null;
  let pendingSubmission = null;
  let pendingSubmissionObserver = null;
  let pendingSubmissionTimeout = null;
  let pendingSubmissionPoll = null;
  const reportedSubmissionIds = new Set();
  let pendingBattleSolves = [];
  let pendingBattleSolvesLoaded = false;
  let flushingBattleSolves = false;
  let battleStatusCheckInFlight = false;
  let battleStatusPollTimeout = null;

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  function isProblemPage() {
    return window.location.pathname.startsWith('/problems/') &&
           window.location.pathname !== '/problems/';
  }

  function getCurrentSlug() {
    return window.location.pathname.split('/problems/')[1]?.split('/')[0] || null;
  }

  function redirectToNextUnsolvedBattleProblem() {
    if (activeBattle?.status !== 'in_progress' || !battleProblems.length) return false;
    // Never interrupt an active in-flight submission attempt
    if (pendingSubmission) return false;

    const currentSlug = getCurrentSlug();
    const currentIsUnsolvedBattleProblem = battleProblems.some(problem =>
      problem.problem_slug === currentSlug && !myResults.some(result => result.problem_slug === currentSlug)
    );
    if (currentIsUnsolvedBattleProblem) return false;

    const nextProblem = battleProblems.find(problem =>
      !myResults.some(result => result.problem_slug === problem.problem_slug)
    );
    if (!nextProblem || redirectPending) return false;
    redirectPending = true;
    window.location.href = nextProblem.problem_url || `https://leetcode.com/problems/${nextProblem.problem_slug}/`;
    return true;
  }

  function normalizeLanguage(language) {
    const normalized = String(language).toLowerCase().trim();
    const aliases = {
      python: 'python3', py: 'python3',
      javascript: 'javascript', js: 'javascript',
      typescript: 'typescript', ts: 'typescript',
      'c++': 'cpp', cpp: 'cpp',
      csharp: 'csharp', 'c#': 'csharp',
      golang: 'go'
    };
    return aliases[normalized] || normalized;
  }

  function isExtensionContextValid() {
    try {
      return typeof chrome !== 'undefined' &&
             typeof chrome.runtime !== 'undefined' &&
             !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  async function safeMessage(msg) {
    if (!isExtensionContextValid()) return null;
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (e?.message?.includes('context invalidated') ||
          e?.message?.includes('Extension context')) {
        showBattleToast('⚠️ Extension reloaded — refresh this page (F5)', 'warn');
      }
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // LANGUAGE DETECTION
  // ─────────────────────────────────────────────────────────

  function getSelectedLanguage() {
    try {
      if (window.monaco?.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const lang = models[0].getLanguageId();
          if (lang && lang !== 'plaintext') return normalizeLanguage(lang);
        }
      }
      const langButton = document.querySelector(
        'button[title*="language"], button[aria-label*="language"], [class*="lang-select"] button, button[id*="lang"]'
      );
      if (langButton?.textContent?.trim()) return normalizeLanguage(langButton.textContent.trim());
      const langDropdown = document.querySelector('[data-mode-id]');
      if (langDropdown) return normalizeLanguage(langDropdown.getAttribute('data-mode-id') || '');
      try {
        const globalLang = localStorage.getItem('global_lang');
        if (globalLang) {
          const parsed = JSON.parse(globalLang);
          if (parsed.lang) return normalizeLanguage(parsed.lang);
        }
      } catch {}
    } catch {}
    return 'python3';
  }

  function extractCode() {
    try {
      const codeEditors = document.querySelectorAll('.view-lines');
      if (codeEditors.length > 0) {
        return Array.from(codeEditors[0].querySelectorAll('.view-line'))
                    .map(l => l.textContent).join('\n');
      }
      const textarea = document.querySelector('textarea[class*="code"]');
      if (textarea) return textarea.value;
    } catch {}
    return '';
  }

  function extractPerformanceStats() {
    const { runtimeMs, memoryMb } = parseLeetCodePerformance(getSubmissionResultText());
    return { runtime: runtimeMs, memory: memoryMb };
  }

  // ─────────────────────────────────────────────────────────
  // SUBMISSION DETECTION
  // ─────────────────────────────────────────────────────────

  function isSubmissionAccepted() {
    return isAcceptedVerdict(getSubmissionResultText());
  }

  function isSubmissionFailed() {
    return isFailedVerdict(getSubmissionResultText());
  }

  function getLatestSubmissionId() {
    // 1. Check detail links: /submissions/detail/123456/
    const subLink = document.querySelector('a[href*="/submissions/detail/"]');
    const fromDetail = subLink?.href?.match(/detail\/(?:[^/]+\/)?(\d+)/)?.[1];
    if (fromDetail) return fromDetail;

    // 2. Check problem submission links: /problems/<slug>/submissions/123456/
    const probSubLinks = document.querySelectorAll('a[href*="/submissions/"]');
    for (const a of probSubLinks) {
      const match = a.href?.match(/\/submissions\/(?:detail\/)?(\d+)/);
      if (match?.[1]) return match[1];
    }

    // 3. Check window.location pathname: /problems/<slug>/submissions/123456/
    const fromLocation = window.location.pathname.match(/\/submissions\/(\d+)/)?.[1];
    if (fromLocation) return fromLocation;

    // 4. Check data-submission-id attributes
    const dataEl = document.querySelector('[data-submission-id]');
    if (dataEl?.getAttribute('data-submission-id')) {
      return dataEl.getAttribute('data-submission-id');
    }

    return null;
  }

  function isExcludedFromVerdict(element) {
    if (!element || !(element instanceof Element)) return true;
    return !!element.closest('#ls-battle-sidebar, #ls-battle-hud, #ls-battle-toast, [data-track-load="description_content"], [class*="description"], [class*="question-content"], nav, aside, header');
  }

  function getSubmissionResultText() {
    // Collect elements specifically from console and submission result regions
    const selectors = [
      '[data-e2e-locator="submission-result"]',
      '[data-e2e-locator="console-result"]',
      'div[class*="submission-result"]',
      'div[class*="result-state"]',
      'div[class*="result-container"]',
      'div[data-layout-path] [class*="result"]',
      '[role="tabpanel"] [class*="text-green"], [role="tabpanel"] [class*="text-red"], [role="tabpanel"] [class*="text-yellow"]',
      '[role="status"], [aria-live="polite"], [aria-live="assertive"]'
    ];

    const candidates = [];
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (!isExcludedFromVerdict(el)) candidates.push(el);
        }
      } catch {}
    }

    // Fallback if no specific container found: scoped colored text nodes that are NOT in the description/sidebar
    if (!candidates.length) {
      const allColored = document.querySelectorAll('[class*="text-green"], [class*="text-red"], [class*="text-yellow"]');
      for (const el of allColored) {
        if (!isExcludedFromVerdict(el)) candidates.push(el);
      }
    }

    // 1. Check for FAILED verdicts FIRST to prevent Wrong Answer being treated as Accepted
    for (const element of candidates) {
      const text = element.textContent?.trim().replace(/\s+/g, ' ');
      if (text && isFailedVerdict(text)) return text;
    }

    // 2. Only if no failure verdict found, check for ACCEPTED verdict
    for (const element of candidates) {
      const text = element.textContent?.trim().replace(/\s+/g, ' ');
      if (text && isAcceptedVerdict(text)) return text;
    }

    return '';
  }

  function getVisitedProblems() {
    // ponytail: visit markers stay per browser; use participant state if cross-device progress must sync.
    try {
      const value = JSON.parse(localStorage.getItem(`ls_battle_visited_${activeBattle?.id}`) || '[]');
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  }

  function rememberCurrentProblem() {
    const slug = getCurrentSlug();
    if (!slug || !battleProblems.some(problem => problem.problem_slug === slug)) return;
    try {
      const visited = getVisitedProblems();
      visited.add(slug);
      localStorage.setItem(`ls_battle_visited_${activeBattle.id}`, JSON.stringify([...visited]));
    } catch {}
  }

  function formatBattleTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(value => String(value).padStart(2, '0')).join(':');
  }

  function updateBattleSidebarTimer() {
    const timer = document.getElementById('ls-battle-sidebar-timer');
    if (!timer) return;

    if (activeBattle?.status === 'countdown') {
      const startsAt = activeBattle?.start_at || activeBattle?.match_starts_at;
      const remaining = startsAt ? Math.max(0, Math.floor((new Date(startsAt).getTime() - Date.now()) / 1000)) : 0;
      timer.textContent = `STARTS ${remaining}s`;
      timer.style.color = '#f59e0b';
      if (remaining <= 0) {
        activeBattle.status = 'in_progress';
        renderBattleSidebar();
      }
      return;
    }

    const endAt = getHudEndAt();
    if (!endAt) {
      timer.textContent = '--:--:--';
      return;
    }
    const remaining = Math.max(0, Math.floor((new Date(endAt).getTime() - Date.now()) / 1000));
    timer.textContent = formatBattleTime(remaining);
    timer.style.color = remaining < 300 ? '#f87171' : '#a1a1aa';
  }

  function renderBattleSidebar() {
    if (!activeBattle || !['in_progress', 'countdown'].includes(activeBattle.status) || !isProblemPage() || !battleProblems.length) {
      removeBattleSidebar();
      return;
    }

    rememberCurrentProblem();
    let sidebar = document.getElementById('ls-battle-sidebar');
    // LeetCode uses client-side navigation and periodically replaces page
    // containers. Reattach the existing sidebar when its host node disappears.
    if (sidebar && !sidebar.isConnected) sidebar = null;
    if (!sidebar) {
      if (sidebarCollapsed == null) {
        try {
          const saved = localStorage.getItem('ls_battle_sidebar_collapsed');
          sidebarCollapsed = saved !== null ? saved === 'true' : false;
        } catch {
          sidebarCollapsed = false;
        }
        try {
          if (window.innerWidth < 900 && localStorage.getItem('ls_battle_sidebar_collapsed') == null) {
            sidebarCollapsed = true;
          }
        } catch {}
      }

      if (!document.getElementById('ls-battle-sidebar-style')) {
        const style = document.createElement('style');
        style.id = 'ls-battle-sidebar-style';
        style.textContent = `
          #ls-battle-sidebar{position:fixed!important;z-index:2147483640!important;top:56px!important;right:12px!important;bottom:16px!important;width:286px;display:flex;flex-direction:column;overflow:hidden;background:#111318!important;border:1px solid #30343d!important;border-radius:14px!important;color:#e5e7eb!important;box-shadow:0 12px 36px rgba(0,0,0,0.7)!important;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important;transition:width .18s ease;pointer-events:auto!important}
          #ls-battle-sidebar *{box-sizing:border-box}
          #ls-battle-sidebar .ls-bs-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-bottom:1px solid #292d35;background:#15181e}
          #ls-battle-sidebar .ls-bs-title{font-weight:750;letter-spacing:.04em;color:#f3f4f6;font-size:11px}
          #ls-battle-sidebar .ls-bs-timer{font:700 12px ui-monospace,SFMono-Regular,monospace;color:#a1a1aa}
          #ls-battle-sidebar .ls-bs-toggle{flex:none;border:1px solid #3b414c;border-radius:7px;background:#1b1f27;color:#d1d5db;padding:5px 8px;cursor:pointer;font-size:11px}
          #ls-battle-sidebar .ls-bs-list{overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px;flex:1}
          #ls-battle-sidebar .ls-bs-item{display:block;padding:10px;border:1px solid #2b3039;border-radius:10px;background:#171a20;color:inherit;text-decoration:none;transition:border-color .12s,background .12s}
          #ls-battle-sidebar .ls-bs-item:hover{border-color:#636b79;background:#1d222b}
          #ls-battle-sidebar .ls-bs-item.current{border-color:#ef4444!important;background:#291719!important;box-shadow:inset 3px 0 #ef4444!important}
          #ls-battle-sidebar .ls-bs-top{display:flex;align-items:center;gap:7px;min-width:0}
          #ls-battle-sidebar .ls-bs-number{color:#9ca3af;font:700 10px ui-monospace,monospace;white-space:nowrap}
          #ls-battle-sidebar .ls-bs-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
          #ls-battle-sidebar .ls-bs-meta{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:7px;color:#9ca3af;font-size:10px}
          #ls-battle-sidebar .ls-bs-state{font-weight:700;color:#d1d5db}
          #ls-battle-sidebar .ls-bs-state.solved{color:#4ade80}
          #ls-battle-sidebar .ls-bs-state.progress{color:#fbbf24}
          #ls-battle-sidebar .ls-bs-current{color:#f87171;font-size:9px;font-weight:800;letter-spacing:.06em}
          #ls-battle-sidebar .ls-bs-opp{display:block;margin-top:4px;color:#fbbf24;font-size:9px}
          #ls-battle-sidebar.collapsed{width:auto!important;bottom:auto!important;background:#18181b!important;border:1.5px solid #ef4444!important;border-radius:20px!important;padding:4px 8px!important;box-shadow:0 6px 20px rgba(239,68,68,0.3)!important}
          #ls-battle-sidebar.collapsed .ls-bs-title,#ls-battle-sidebar.collapsed .ls-bs-timer,#ls-battle-sidebar.collapsed .ls-bs-list{display:none!important}
          #ls-battle-sidebar.collapsed .ls-bs-head{justify-content:center;padding:0!important;border:0!important;background:transparent!important}
          #ls-battle-sidebar.collapsed .ls-bs-toggle{width:auto!important;border:none!important;background:transparent!important;color:#f87171!important;font-weight:bold!important;font-size:11px!important;padding:4px 6px!important}
          @media(min-width:1150px){html.ls-battle-sidebar-open body{margin-right:310px!important}}
          @media(max-width:700px){#ls-battle-sidebar{right:6px!important;bottom:6px!important;top:56px!important;width:min(286px,84vw)!important}}
        `;
        (document.head || document.documentElement).appendChild(style);
      }

      sidebar = document.createElement('aside');
      sidebar.id = 'ls-battle-sidebar';
      (document.body || document.documentElement).appendChild(sidebar);
      if (sidebarTimer) clearInterval(sidebarTimer);
      sidebarTimer = setInterval(updateBattleSidebarTimer, 1000);
    }

    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    document.documentElement.classList.toggle('ls-battle-sidebar-open', !sidebarCollapsed);
    sidebar.replaceChildren();

    const head = document.createElement('div');
    head.className = 'ls-bs-head';
    const title = document.createElement('span');
    title.className = 'ls-bs-title';
    title.textContent = activeBattle.status === 'countdown' ? '⚔ STARTING SOON' : '⚔ BATTLE PROBLEMS';
    const timer = document.createElement('span');
    timer.className = 'ls-bs-timer';
    timer.id = 'ls-battle-sidebar-timer';
    const toggle = document.createElement('button');
    toggle.className = 'ls-bs-toggle';
    toggle.type = 'button';
    toggle.textContent = sidebarCollapsed ? '⚔️ Battle Problems ‹' : '›';
    toggle.setAttribute('aria-label', sidebarCollapsed ? 'Expand battle problem list' : 'Collapse battle problem list');
    toggle.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed;
      try { localStorage.setItem('ls_battle_sidebar_collapsed', String(sidebarCollapsed)); } catch {}
      renderBattleSidebar();
    });
    head.append(title, timer, toggle);
    sidebar.appendChild(head);

    const list = document.createElement('nav');
    list.className = 'ls-bs-list';
    list.setAttribute('aria-label', 'Battle problems');
    const currentSlug = getCurrentSlug();
    const visited = getVisitedProblems();
    const opponentName = activeBattle.challenger_username?.toLowerCase() === myUsername?.toLowerCase()
      ? activeBattle.challenged_username : activeBattle.challenger_username;

    for (const problem of battleProblems) {
      const slug = problem.problem_slug;
      const mySolve = myResults.find(result => result.problem_slug === slug);
      const opponentSolve = oppResults.find(result => result.problem_slug === slug);
      const mine = !!mySolve;
      const opponentSolved = !!opponentSolve;
      const isCurrent = slug === currentSlug;
      const status = mine || opponentSolved ? 'Solved' : visited.has(slug) ? 'In Progress' : 'Not Started';
      const item = document.createElement('a');
      item.className = `ls-bs-item${isCurrent ? ' current' : ''}`;
      item.href = `https://leetcode.com/problems/${encodeURIComponent(slug)}/`;
      item.setAttribute('aria-current', isCurrent ? 'page' : 'false');

      const top = document.createElement('div');
      top.className = 'ls-bs-top';
      const number = document.createElement('span');
      number.className = 'ls-bs-number';
      number.textContent = `#${problem.sequence_number}`;
      const name = document.createElement('span');
      name.className = 'ls-bs-name';
      name.textContent = problem.problem_title || slug;
      top.append(number, name);

      const meta = document.createElement('div');
      meta.className = 'ls-bs-meta';
      const difficulty = document.createElement('span');
      difficulty.textContent = problem.difficulty || 'Medium';
      const state = document.createElement('span');
      state.className = `ls-bs-state${mine || opponentSolved ? ' solved' : visited.has(slug) ? ' progress' : ''}`;
      state.textContent = status;
      meta.append(difficulty, state);
      if (isCurrent) {
        const current = document.createElement('span');
        current.className = 'ls-bs-current';
        current.textContent = 'CURRENT';
        meta.appendChild(current);
      }
      item.append(top, meta);

      if (mine || opponentSolved) {
        const solvedBy = document.createElement('span');
        solvedBy.className = 'ls-bs-opp';
        solvedBy.textContent = mine && opponentSolved ? 'You and opponent solved' : mine ? 'Solved by you' : `Solved by ${opponentName || 'opponent'}`;
        item.appendChild(solvedBy);
        for (const [label, solve] of [['You', mySolve], [opponentName || 'Opponent', opponentSolve]]) {
          if (!solve || (solve.runtime_ms == null && solve.memory_mb == null)) continue;
          const metrics = document.createElement('span');
          metrics.className = 'ls-bs-opp';
          metrics.textContent = `${label}: ${solve.runtime_ms == null ? 'Runtime unavailable' : `${solve.runtime_ms} ms`} · ${solve.memory_mb == null ? 'Memory unavailable' : `${solve.memory_mb} MB`}`;
          item.appendChild(metrics);
        }
      }
      list.appendChild(item);
    }
    sidebar.appendChild(list);
    updateBattleSidebarTimer();
  }

  function removeBattleSidebar() {
    document.getElementById('ls-battle-sidebar')?.remove();
    document.documentElement.classList.remove('ls-battle-sidebar-open');
    if (sidebarTimer) { clearInterval(sidebarTimer); sidebarTimer = null; }
  }

  // ─────────────────────────────────────────────────────────
  // BATTLE HUD
  // ─────────────────────────────────────────────────────────

  function getHudEndAt() {
    return activeBattle?.end_at || activeBattle?.match_deadline || null;
  }

  function iAmSolvedThisProblem(slug) {
    return myResults.some(r => r.problem_slug === slug);
  }

  function getCurrentProblemInfo() {
    const slug = getCurrentSlug();
    if (!slug || !battleProblems.length) return null;
    return battleProblems.find(p => p.problem_slug === slug) || null;
  }

  function injectBattleHUD() {
    if (!activeBattle || !isProblemPage()) return;
    const currentProblem = getCurrentProblemInfo();
    if (!currentProblem && battleProblems.length > 0) return; // Not on a battle problem page

    // Remove old HUD if present
    document.getElementById('ls-battle-hud')?.remove();
    hudInjected = false;

    const opp = activeBattle.challenger_username?.toLowerCase() === myUsername?.toLowerCase()
      ? activeBattle.challenged_username
      : activeBattle.challenger_username;

    const mySolved = myResults.length;
    const oppSolved = oppResults.length;
    const totalProblems = battleProblems.length || activeBattle.problem_count || '?';

    const bar = document.createElement('div');
    bar.id = 'ls-battle-hud';
    bar.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'z-index:2147483647',
      'height:38px',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:0 16px',
      'gap:12px',
      'background:#0f0f0f',
      'border-bottom:1px solid #2a2a2a',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:11px',
      'color:#e4e4e7',
      'box-shadow:0 1px 8px rgba(0,0,0,0.5)',
      'box-sizing:border-box',
      'pointer-events:none', // allow clicks through except on forfeit button
    ].join(';');

    // Left: battle badge + current problem
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0;';

    const badge = document.createElement('span');
    badge.style.cssText = 'color:#ef4444;font-weight:700;letter-spacing:0.5px;white-space:nowrap;';
    badge.textContent = '⚔ BATTLE';
    left.appendChild(badge);

    if (currentProblem) {
      const probLabel = document.createElement('span');
      probLabel.style.cssText = 'color:#a1a1aa;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;';
      probLabel.textContent = `#${currentProblem.sequence_number} ${currentProblem.problem_title}`;
      left.appendChild(probLabel);

      if (iAmSolvedThisProblem(currentProblem.problem_slug)) {
        const solvedBadge = document.createElement('span');
        solvedBadge.style.cssText = 'color:#22c55e;font-weight:700;font-size:10px;white-space:nowrap;';
        solvedBadge.textContent = '✓ Solved';
        left.appendChild(solvedBadge);
      }
    }

    bar.appendChild(left);

    // Center: score
    const center = document.createElement('div');
    center.style.cssText = 'display:flex;align-items:center;gap:8px;white-space:nowrap;flex-shrink:0;';

    const myScoreEl = document.createElement('span');
    myScoreEl.style.cssText = 'color:#fbbf24;font-weight:700;';
    myScoreEl.id = 'ls-hud-my-score';
    myScoreEl.textContent = `You ${mySolved}`;

    const sep = document.createElement('span');
    sep.style.cssText = 'color:#3f3f46;';
    sep.textContent = '—';

    const oppScoreEl = document.createElement('span');
    oppScoreEl.style.cssText = 'color:#a1a1aa;font-weight:600;';
    oppScoreEl.id = 'ls-hud-opp-score';
    oppScoreEl.textContent = `${opp || 'Opp'} ${oppSolved}`;

    const totalEl = document.createElement('span');
    totalEl.style.cssText = 'color:#52525b;font-size:10px;';
    totalEl.textContent = `/${totalProblems}`;

    center.append(myScoreEl, sep, oppScoreEl, totalEl);
    bar.appendChild(center);

    // Right: countdown timer
    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;white-space:nowrap;';

    const timerEl = document.createElement('span');
    timerEl.id = 'ls-hud-timer';
    timerEl.style.cssText = 'font-family:monospace;font-weight:700;font-size:12px;';
    right.appendChild(timerEl);

    // Forfeit button (needs pointer-events)
    const forfeitBtn = document.createElement('button');
    forfeitBtn.textContent = 'Forfeit';
    forfeitBtn.style.cssText = [
      'pointer-events:all',
      'cursor:pointer',
      'background:transparent',
      'border:1px solid #3f3f46',
      'color:#71717a',
      'border-radius:6px',
      'padding:2px 8px',
      'font-size:10px',
      'font-family:inherit',
      'transition:all 0.15s',
    ].join(';');
    forfeitBtn.addEventListener('mouseover', () => { forfeitBtn.style.borderColor = '#ef4444'; forfeitBtn.style.color = '#ef4444'; });
    forfeitBtn.addEventListener('mouseout', () => { forfeitBtn.style.borderColor = '#3f3f46'; forfeitBtn.style.color = '#71717a'; });
    forfeitBtn.addEventListener('click', async () => {
      if (!activeBattle?.id) return;
      if (!confirm('Forfeit this battle? Your opponent wins.')) return;
      await safeMessage({ type: 'BATTLE_FORFEIT_V2', battleId: activeBattle.id });
    });
    right.appendChild(forfeitBtn);

    bar.appendChild(right);
    document.body.prepend(bar);
    hudInjected = true;

    // Push page content down
    document.body.style.marginTop = '38px';

    // Start timer
    if (hudTimer) clearInterval(hudTimer);
    hudTimer = setInterval(updateHudTimer, 1000);
    updateHudTimer();
  }

  function updateHudTimer() {
    const timerEl = document.getElementById('ls-hud-timer');
    if (!timerEl) return;

    const endAt = getHudEndAt();
    if (!endAt) {
      timerEl.textContent = '--:--:--';
      return;
    }

    const remaining = Math.max(0, Math.floor((new Date(endAt).getTime() - Date.now()) / 1000));
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    const formatted = [h, m, s].map(v => String(v).padStart(2, '0')).join(':');

    timerEl.textContent = formatted;
    timerEl.style.color = remaining < 300 ? '#ef4444' : remaining < 600 ? '#f59e0b' : '#a1a1aa';

    if (remaining === 0) {
      clearInterval(hudTimer);
      hudTimer = null;
      timerEl.textContent = '00:00:00';
    }
  }

  function updateHudScores() {
    const myScoreEl = document.getElementById('ls-hud-my-score');
    const oppScoreEl = document.getElementById('ls-hud-opp-score');
    if (myScoreEl) myScoreEl.textContent = `You ${myResults.length}`;
    if (oppScoreEl) {
      const opp = activeBattle?.challenger_username?.toLowerCase() === myUsername?.toLowerCase()
        ? activeBattle?.challenged_username
        : activeBattle?.challenger_username;
      oppScoreEl.textContent = `${opp || 'Opp'} ${oppResults.length}`;
    }
  }

  function removeHUD() {
    document.getElementById('ls-battle-hud')?.remove();
    document.body.style.marginTop = '';
    if (hudTimer) { clearInterval(hudTimer); hudTimer = null; }
    hudInjected = false;
  }

  // ─────────────────────────────────────────────────────────
  // TOAST NOTIFICATIONS
  // ─────────────────────────────────────────────────────────

  function showBattleToast(message, type = 'info') {
    document.getElementById('ls-battle-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'ls-battle-toast';

    const bgColors = { success: '#16a34a', warn: '#d97706', info: '#3b82f6', error: '#ef4444' };
    toast.style.cssText = [
      'position:fixed',
      'top:50px', // below HUD
      'right:16px',
      'z-index:2147483646',
      `background:${bgColors[type] || bgColors.info}`,
      'color:#fff',
      'padding:10px 16px',
      'border-radius:10px',
      'font-size:13px',
      'font-weight:600',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
      'max-width:320px',
      'line-height:1.4',
      'animation:ls-slide-in 0.25s ease',
      'pointer-events:none',
    ].join(';');
    toast.textContent = message;

    // Inject animation keyframes if not present
    if (!document.getElementById('ls-anim')) {
      const s = document.createElement('style');
      s.id = 'ls-anim';
      s.textContent = `
        @keyframes ls-slide-in {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ─────────────────────────────────────────────────────────
  // OPPONENT NOTIFICATION
  // ─────────────────────────────────────────────────────────

  let _prevOppResults = [];

  function checkForOpponentSolves(newOppResults) {
    if (!Array.isArray(newOppResults)) return;
    for (const r of newOppResults) {
      const already = _prevOppResults.some(pr => pr.problem_slug === r.problem_slug);
      if (!already) {
        const prob = battleProblems.find(p => p.problem_slug === r.problem_slug);
        const title = prob?.problem_title || r.problem_slug;
        showBattleToast(`⚡ ${activeBattle?.challenger_username?.toLowerCase() === myUsername?.toLowerCase()
          ? activeBattle?.challenged_username
          : activeBattle?.challenger_username
        } solved "${title}"!`, 'warn');
      }
    }
    _prevOppResults = [...newOppResults];
  }

  // ─────────────────────────────────────────────────────────
  // AUTO-REDIRECT TO NEXT PROBLEM
  // ─────────────────────────────────────────────────────────

  function pendingSolveKey(solve) {
    return `ls_battle_pending_solve_${solve.battleId}_${solve.problemSlug}`;
  }

  async function loadPendingBattleSolves() {
    if (pendingBattleSolvesLoaded) return;
    pendingBattleSolvesLoaded = true;
    try {
      const values = await chrome.storage.local.get(null);
      pendingBattleSolves = Object.entries(values)
        .filter(([key]) => key.startsWith('ls_battle_pending_solve_'))
        .map(([, solve]) => solve)
        .filter(solve => solve?.battleId && solve?.problemSlug && Date.now() - solve.queuedAt < 24 * 60 * 60 * 1000);
    } catch {}
  }

  async function submitQueuedBattleSolve(solve) {
    const response = await safeMessage({
      type: 'BATTLE_SOLVED_V2',
      battleId: solve.battleId,
      problemSlug: solve.problemSlug,
      submissionId: solve.submissionId,
      timeTakenMs: 0,
      runtimeMs: solve.runtimeMs,
      memoryMb: solve.memoryMb,
      language: solve.language
    });
    if (response?.success) {
      pendingBattleSolves = pendingBattleSolves.filter(item => pendingSolveKey(item) !== pendingSolveKey(solve));
      try { await chrome.storage.local.remove(pendingSolveKey(solve)); } catch {}
    } else if (/already finalized|deadline has passed|problem not in this battle/i.test(response?.error || '')) {
      pendingBattleSolves = pendingBattleSolves.filter(item => pendingSolveKey(item) !== pendingSolveKey(solve));
      try { await chrome.storage.local.remove(pendingSolveKey(solve)); } catch {}
    }
    return response;
  }

  async function flushPendingBattleSolves() {
    if (flushingBattleSolves) return;
    flushingBattleSolves = true;
    try {
    await loadPendingBattleSolves();
    for (const solve of pendingBattleSolves) {
      if (solve.battleId !== activeBattle?.id) continue;
      const response = await submitQueuedBattleSolve(solve);
      if (!response?.success && !/already finalized|deadline has passed|problem not in this battle/i.test(response?.error || '')) break;
    }
    } finally {
      flushingBattleSolves = false;
    }
  }

  async function handleAcceptedSolve(stats, code, language, acceptedSlug = getCurrentSlug(), submissionId = getLatestSubmissionId()) {
    if (!activeBattle?.id || redirectPending) return;
    const slug = acceptedSlug;
    if (!slug) return;

    // Check if this slug is in our battle problems
    const isInBattle = battleProblems.some(p => p.problem_slug === slug) ||
                       slug === activeBattle.problem_1 ||
                       slug === activeBattle.problem_2;
    if (!isInBattle) return;

    // Check if already solved
    if (iAmSolvedThisProblem(slug)) {
      console.log('[LeetStreak] Already recorded solve for', slug);
      return;
    }

    redirectPending = true;

    // Show accepted toast
    showBattleToast('✅ Accepted! Reporting solve…', 'success');

    // Report to service worker
    const pendingSolve = {
      battleId: activeBattle.id,
      problemSlug: slug,
      submissionId,
      runtimeMs: stats?.runtime ?? null,
      memoryMb: stats?.memory ?? null,
      language: normalizeLanguage(language),
      queuedAt: Date.now()
    };
    await loadPendingBattleSolves();
    pendingBattleSolves = [...pendingBattleSolves.filter(item => pendingSolveKey(item) !== pendingSolveKey(pendingSolve)), pendingSolve];
    try { await chrome.storage.local.set({ [pendingSolveKey(pendingSolve)]: pendingSolve }); } catch {}
    const resp = await submitQueuedBattleSolve(pendingSolve);

    // Also send legacy SUBMISSION_ACCEPTED for streak tracking
    safeMessage({ type: 'SUBMISSION_ACCEPTED', problemSlug: slug, title: slug }).catch(() => {});

    if (resp?.success) {
      // Update local state
      myResults = [...myResults, { problem_slug: slug }];
      updateHudScores();
      renderBattleSidebar();

      const nextProblem = resp.next_problem_slug
        ? battleProblems.find(problem => problem.problem_slug === resp.next_problem_slug)
        : battleProblems.find(problem => problem.problem_slug !== slug && !myResults.some(result => result.problem_slug === problem.problem_slug));
      if (!resp.battle_complete && nextProblem) {
        const nextSlug = resp.next_problem_slug || nextProblem.problem_slug;
        const nextUrl = resp.next_problem_url || nextProblem.problem_url || `https://leetcode.com/problems/${nextSlug}/`;
        showBattleToast(`⏭ Next problem: ${nextProblem.problem_title || nextSlug}`, 'info');
        setTimeout(() => {
          redirectPending = false;
          window.location.href = nextUrl;
        }, 2000);
      } else if (resp.battle_complete) {
        showBattleToast('🏁 All problems solved! Waiting for battle to end…', 'success');
        redirectPending = false;
      } else {
        redirectPending = false;
      }
    } else {
      redirectPending = false;
      console.error('[LeetStreak] Failed to record solve:', resp?.error);
    }
  }

  // ─────────────────────────────────────────────────────────
  // SUBMISSION OBSERVER
  // ─────────────────────────────────────────────────────────

  function stopPendingSubmission() {
    pendingSubmissionObserver?.disconnect();
    pendingSubmissionObserver = null;
    clearTimeout(pendingSubmissionTimeout);
    pendingSubmissionTimeout = null;
    clearInterval(pendingSubmissionPoll);
    pendingSubmissionPoll = null;
    pendingSubmission = null;
  }

  async function checkPendingSubmission() {
    if (!pendingSubmission) return;
    const currentText = getSubmissionResultText();
    const submissionId = getLatestSubmissionId();
    const resultChanged = currentText !== pendingSubmission.previousResultText;
    const isNewSubmission = submissionId && submissionId !== pendingSubmission.previousSubmissionId;
    if (resultChanged || isNewSubmission) pendingSubmission.sawResultChange = true;

    // Track intermediate transitions (e.g. "Judging" or "Pending")
    if (/\b(?:Judging|Pending)\b/i.test(currentText) || currentText === '') {
      pendingSubmission.previousResultText = currentText;
      pendingSubmission.sawResultChange = true;
      return;
    }

    // Explicitly reject and stop on ANY failed verdict (Wrong Answer, TLE, etc.)
    if (isSubmissionFailed()) {
      const firstLine = currentText.split('\n')[0] || 'Wrong Answer';
      showBattleToast(`❌ ${firstLine} — try again`, 'warn');
      stopPendingSubmission();
      return;
    }

    if (!isSubmissionAccepted() || !isFreshAcceptedResult({
      accepted: true,
      submissionId,
      previousSubmissionId: pendingSubmission.previousSubmissionId,
      resultText: currentText,
      previousResultText: pendingSubmission.previousResultText,
      // Submission links can update before the verdict panel. A changed ID
      // alone must never authorize a solve based on stale visible text.
      sawResultChange: pendingSubmission.sawResultChange
    })) return;

    const acceptedSubmission = pendingSubmission;
    if (submissionId && reportedSubmissionIds.has(submissionId)) {
      stopPendingSubmission();
      return;
    }
    if (submissionId) reportedSubmissionIds.add(submissionId);
    stopPendingSubmission();

    const stats = extractPerformanceStats();
    const effectiveSubId = submissionId || `sub_${Date.now()}`;
    if (activeBattle?.status === 'in_progress' && battleProblems.some(p => p.problem_slug === acceptedSubmission.problemSlug)) {
      await handleAcceptedSolve(stats, acceptedSubmission.code, acceptedSubmission.language, acceptedSubmission.problemSlug, effectiveSubId);
    } else {
      safeMessage({ type: 'SUBMISSION_ACCEPTED', problemSlug: acceptedSubmission.problemSlug, title: document.title }).catch(() => {});
      showBattleToast('✅ Submission accepted!', 'success');
    }
  }

  function startSubmissionAttempt() {
    if (!isProblemPage() || pendingSubmission) return;
    pendingSubmission = {
      problemSlug: getCurrentSlug(),
      previousSubmissionId: getLatestSubmissionId(),
      previousResultText: getSubmissionResultText(),
      sawResultChange: false,
      language: getSelectedLanguage(),
      code: extractCode()
    };
    pendingSubmissionObserver = new MutationObserver(checkPendingSubmission);
    pendingSubmissionObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    // LeetCode replaces parts of the result panel during SPA renders. Polling
    // alongside the observer catches verdict updates that don't change text nodes.
    pendingSubmissionPoll = setInterval(checkPendingSubmission, 750);
    pendingSubmissionTimeout = setTimeout(stopPendingSubmission, 5 * 60 * 1000);
  }

  function isSubmitControl(element) {
    const control = element.closest?.('button, [role="button"], [data-e2e-locator]');
    if (!control) return false;
    const label = [control.textContent, control.getAttribute('aria-label'), control.getAttribute('data-e2e-locator')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    // NEVER match Run Code buttons!
    if (/\b(?:run|run\s*code|testcase)\b/i.test(label) && !/\bsubmit\b/i.test(label)) return false;
    return /\bsubmit\b/i.test(label);
  }

  function initSubmissionObserver() {
    if (submissionObserving) return;
    submissionObserving = true;

    document.addEventListener('click', event => {
      if (isSubmitControl(event.target)) startSubmissionAttempt();
    }, true);

    document.addEventListener('submit', event => {
      const submitter = event.submitter || event.target.querySelector?.('button[type="submit"]');
      if (submitter && /^Submit$/i.test(submitter.textContent.trim())) startSubmissionAttempt();
    }, true);

    // Support LeetCode keyboard shortcut for submit (Ctrl/Cmd + ')
    // DO NOT hook Ctrl+Enter or Cmd+Enter — on LeetCode that runs sample test cases!
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && (event.key === '\'' || event.code === 'Quote')) {
        startSubmissionAttempt();
      }
    }, true);
  }

  // ─────────────────────────────────────────────────────────
  // PROBLEM QUEUE BUTTON INJECTION
  // ─────────────────────────────────────────────────────────

  function findSubmitButton() {
    const direct = document.querySelector('button[data-e2e-locator="console-submit-button"]');
    if (direct) return direct;

    const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
    return allButtons.find(btn => {
      const text = (btn.textContent || '').trim();
      const aria = btn.getAttribute('aria-label') || '';
      const locator = btn.getAttribute('data-e2e-locator') || '';
      if (/\b(?:run|run\s*code|testcase|test)\b/i.test(text) && !/\bsubmit\b/i.test(text)) return false;
      return /\bsubmit\b/i.test(text) || /\bsubmit\b/i.test(aria) || /\bsubmit\b/i.test(locator);
    });
  }

  function extractProblemDetails() {
    const slug = getCurrentSlug() || '';
    
    // 1. Title
    const titleEl = document.querySelector('[data-cy="question-title"]') ||
                    document.querySelector('div[class*="text-title"]') ||
                    document.querySelector('.text-title-large');
    let rawTitle = titleEl ? titleEl.textContent.trim() : '';
    if (!rawTitle) {
      rawTitle = document.title.replace(/- LeetCode.*/i, '').trim();
    }
    if (!rawTitle && slug) {
      rawTitle = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    // 2. Number
    const numMatch = rawTitle.match(/^(\d+)\.\s*(.*)$/);
    const number = numMatch ? numMatch[1] : '';
    const title = numMatch ? numMatch[2] : rawTitle;

    // 3. Difficulty
    let difficulty = 'Medium';
    const diffEl = document.querySelector('div[diff]') ||
                   document.querySelector('[class*="text-difficulty"]') ||
                   document.querySelector('span[class*="text-olive"], span[class*="text-yellow"], span[class*="text-pink"], span[class*="text-red"]');
    if (diffEl) {
      const text = diffEl.textContent.trim();
      if (/easy/i.test(text)) difficulty = 'Easy';
      else if (/hard/i.test(text)) difficulty = 'Hard';
      else if (/medium/i.test(text)) difficulty = 'Medium';
    }

    return {
      id: slug,
      title: title || slug,
      slug,
      difficulty,
      number,
      url: window.location.href,
      status: 'pending',
      addedAt: Date.now()
    };
  }

  async function checkIsProblemInQueue(slug) {
    if (!slug || typeof chrome === 'undefined' || !chrome.storage?.local) return false;
    try {
      const res = await chrome.storage.local.get('problem_queue');
      const queue = res.problem_queue || [];
      return queue.some(p => p.slug === slug || p.id === slug);
    } catch {
      return false;
    }
  }

  function updateQueueButtonUI(button, inQueue) {
    if (inQueue) {
      button.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>In Queue</span>
      `;
      button.title = 'This problem is in your LeetStreak queue';
      button.style.background = 'rgba(16, 185, 129, 0.15)';
      button.style.color = '#10b981';
      button.style.borderColor = 'rgba(16, 185, 129, 0.35)';
    } else {
      button.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Add to Queue</span>
      `;
      button.title = 'Add this problem to your LeetStreak queue';
      button.style.background = 'rgba(255, 161, 22, 0.12)';
      button.style.color = '#ffa116';
      button.style.borderColor = 'rgba(255, 161, 22, 0.35)';
    }
  }

  function ensureQueueButtonAttached() {
    if (!isProblemPage()) {
      document.getElementById('leetstreak-queue-btn')?.remove();
      return;
    }
    const slug = getCurrentSlug();
    if (!slug) return;

    const existing = document.getElementById('leetstreak-queue-btn');
    if (existing && existing.isConnected) {
      if (existing.dataset.slug !== slug) {
        existing.dataset.slug = slug;
        checkIsProblemInQueue(slug).then(inQ => updateQueueButtonUI(existing, inQ));
      }
      return;
    }

    const submitBtn = findSubmitButton();
    if (!submitBtn) return;

    const queueBtn = document.createElement('button');
    queueBtn.id = 'leetstreak-queue-btn';
    queueBtn.type = 'button';
    queueBtn.dataset.slug = slug;
    queueBtn.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'gap: 5px',
      'height: 32px',
      'padding: 0 10px',
      'margin-left: 8px',
      'border-radius: 6px',
      'font-size: 12px',
      'font-weight: 600',
      'font-family: inherit',
      'cursor: pointer',
      'transition: all 0.2s ease',
      'background: rgba(255, 161, 22, 0.12)',
      'color: #ffa116',
      'border: 1px solid rgba(255, 161, 22, 0.35)',
      'vertical-align: middle',
      'white-space: nowrap',
      'user-select: none',
      'z-index: 10'
    ].join(';');

    queueBtn.addEventListener('mouseenter', () => {
      queueBtn.style.filter = 'brightness(1.15)';
      queueBtn.style.transform = 'translateY(-1px)';
    });
    queueBtn.addEventListener('mouseleave', () => {
      queueBtn.style.filter = 'none';
      queueBtn.style.transform = 'none';
    });

    queueBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const inQueue = await checkIsProblemInQueue(slug);
      if (inQueue) {
        showBattleToast('ℹ️ This problem is already in your queue', 'info');
        return;
      }

      const prob = extractProblemDetails();
      const resp = await safeMessage({
        type: 'ADD_TO_QUEUE',
        problemData: prob
      });

      if (resp?.success) {
        showBattleToast('📋 Added to your Problem Queue!', 'success');
        updateQueueButtonUI(queueBtn, true);
      } else if (resp?.alreadyExists) {
        showBattleToast('ℹ️ Already in your Problem Queue', 'info');
        updateQueueButtonUI(queueBtn, true);
      } else {
        showBattleToast(`❌ ${resp?.error || 'Could not add to queue'}`, 'error');
      }
    });

    updateQueueButtonUI(queueBtn, false);
    checkIsProblemInQueue(slug).then(inQ => updateQueueButtonUI(queueBtn, inQ));

    submitBtn.insertAdjacentElement('afterend', queueBtn);
  }

  // ─────────────────────────────────────────────────────────
  // BATTLE STATUS POLLING
  // ─────────────────────────────────────────────────────────

  async function checkBattleStatus() {
    if (!isExtensionContextValid() || battleStatusCheckInFlight) return;
    battleStatusCheckInFlight = true;
    try {
      const stored = await chrome.storage.local.get('my_leetcode_username');
      myUsername = stored.my_leetcode_username || myUsername;

      const resp = await safeMessage({ type: 'BATTLE_GET_STATUS', username: myUsername });
      if (!resp) return;

      const battle = resp?.battle;

      if (battle && ['in_progress', 'countdown'].includes(battle.status)) {
        activeBattle = battle;

        // Fetch full v2 state if we have a battle ID
        if (battle.id) {
          const stateResp = resp?.state ? { success: true, state: resp.state } : await safeMessage({
            type: 'BATTLE_GET_STATE_V2',
            battleId: battle.id
          });

          if (stateResp?.success && stateResp.state) {
            if (stateResp.state.battle) {
              const stateBattle = stateResp.state.battle;
              const startsAt = stateBattle.start_at || stateBattle.match_starts_at;
              // Preserve the countdown transition derived by getActiveBattle.
              activeBattle = {
                ...stateBattle,
                status: battle.status === 'in_progress' || (
                  stateBattle.status === 'countdown' && startsAt && Date.parse(startsAt) <= Date.now()
                ) ? 'in_progress' : stateBattle.status
              };
            }
            battleProblems = stateResp.state.problems || [];
            const allResults = stateResp.state.results || [];
            const newMyResults = allResults.filter(r => r.username?.toLowerCase() === myUsername?.toLowerCase());
            const newOppResults = allResults.filter(r => r.username?.toLowerCase() !== myUsername?.toLowerCase());

            checkForOpponentSolves(newOppResults);
            myResults = newMyResults;
            oppResults = newOppResults;

            // Route from any other LeetCode page to this battle's next unsolved problem.
            if (redirectToNextUnsolvedBattleProblem()) return;

            // Inject or update HUD on problem pages
            if (isProblemPage() && activeBattle.status === 'in_progress') {
              if (!hudInjected) {
                injectBattleHUD();
              } else {
                updateHudScores();
              }
            }
          } else {
            // Fallback for old-schema battles
            battleProblems = [
              battle.problem_1 ? { sequence_number: 1, problem_slug: battle.problem_1, problem_title: battle.problem_1_title || battle.problem_1, problem_url: `https://leetcode.com/problems/${battle.problem_1}/` } : null,
              battle.problem_2 ? { sequence_number: 2, problem_slug: battle.problem_2, problem_title: battle.problem_2_title || battle.problem_2, problem_url: `https://leetcode.com/problems/${battle.problem_2}/` } : null,
            ].filter(Boolean);

            if (resp.results) {
              myResults = resp.results.filter(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.accepted);
              const newOpp = resp.results.filter(r => r.username?.toLowerCase() !== myUsername?.toLowerCase() && r.accepted);
              checkForOpponentSolves(newOpp);
              oppResults = newOpp;
            }

            if (isProblemPage()) {
              if (!hudInjected) injectBattleHUD();
              else updateHudScores();
            }
          }
        }
      } else if (battle?.status === 'countdown' && isProblemPage()) {
        // Battle is in countdown but we're on LeetCode — show minimal info
        activeBattle = battle;
        removeHUD();
    } else {
        // No active battle
        activeBattle = null;
        battleProblems = [];
        myResults = [];
        oppResults = [];
        if (hudInjected) removeHUD();
      }

      if (activeBattle && !['countdown', 'in_progress'].includes(activeBattle.status) && hudInjected) removeHUD();

      // Also cover legacy state responses and navigation back to an already-solved page.
      redirectToNextUnsolvedBattleProblem();

      if (activeBattle?.status === 'in_progress') flushPendingBattleSolves().catch(() => {});
      renderBattleSidebar();
    } catch (e) {
      // Service worker may not be ready
    } finally {
      battleStatusCheckInFlight = false;
      if (isExtensionContextValid()) {
        const delay = activeBattle ? 5000 : 15000;
        clearTimeout(battleStatusPollTimeout);
        battleStatusPollTimeout = setTimeout(checkBattleStatus, delay);
      }
    }
  }

  function applyBattleData(data) {
    if (data && ['in_progress', 'countdown'].includes(data.status)) {
      const startsAt = data.match_starts_at || data.start_at;
      activeBattle = {
        id: data.battleId,
        status: data.status === 'in_progress' || (
          data.status === 'countdown' && startsAt && Date.parse(startsAt) <= Date.now()
        ) ? 'in_progress' : data.status,
        match_starts_at: startsAt,
        match_deadline: data.match_deadline || data.end_at,
        start_at: startsAt,
        end_at: data.match_deadline || data.end_at,
        duration_minutes: data.duration_minutes || 30
      };
      battleProblems = data.problems || [];
      const allResults = data.results || [];
      myResults = allResults.filter(r => r.username?.toLowerCase() === myUsername?.toLowerCase());
      oppResults = allResults.filter(r => r.username?.toLowerCase() !== myUsername?.toLowerCase());

      if (isProblemPage()) {
        renderBattleSidebar();
        if (activeBattle.status === 'in_progress') {
          redirectToNextUnsolvedBattleProblem();
          if (!hudInjected) injectBattleHUD();
          else updateHudScores();
        }
      } else if (activeBattle.status === 'in_progress') {
        redirectToNextUnsolvedBattleProblem();
      }
    } else if (!data || ['completed', 'forfeited', 'cancelled', 'expired'].includes(data?.status)) {
      activeBattle = null;
      battleProblems = [];
      myResults = [];
      oppResults = [];
      removeBattleSidebar();
      removeHUD();
    }
  }

  function ensureSidebarAttached() {
    if (!activeBattle || !['in_progress', 'countdown'].includes(activeBattle.status) || !isProblemPage() || !battleProblems.length) {
      return;
    }
    const sidebar = document.getElementById('ls-battle-sidebar');
    if (!sidebar || !sidebar.isConnected) {
      renderBattleSidebar();
    }
  }

  // ─────────────────────────────────────────────────────────
  // SPA URL CHANGE OBSERVER
  // ─────────────────────────────────────────────────────────

  let lastUrl = location.href;

  function handleUrlChange() {
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;

    // Reset per-page state (keep activeBattle)
    redirectPending = false;
    hudInjected = false;
    document.body.style.marginTop = '';

    if (isProblemPage()) {
      initSubmissionObserver();
      ensureQueueButtonAttached();
      if (activeBattle && ['in_progress', 'countdown'].includes(activeBattle.status)) {
        renderBattleSidebar();
        if (activeBattle.status === 'in_progress') {
          redirectToNextUnsolvedBattleProblem();
          injectBattleHUD();
        }
      }
      setTimeout(checkBattleStatus, 500);
    } else {
      removeHUD();
      removeBattleSidebar();
      document.getElementById('leetstreak-queue-btn')?.remove();
    }
  }

  const urlObserver = new MutationObserver(() => {
    try { handleUrlChange(); } catch {}
  });

  try {
    urlObserver.observe(document, { subtree: true, childList: true });
  } catch {}

  // ─────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────

  async function init() {
    initSubmissionObserver();
    ensureQueueButtonAttached();

    // 1. Storage listener for real-time, zero-latency sync across all LeetCode tabs
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.active_battle_data) {
            applyBattleData(changes.active_battle_data.newValue);
          }
          if (area === 'local' && changes.my_leetcode_username?.newValue) {
            myUsername = changes.my_leetcode_username.newValue;
          }
        });
      } catch {}
    }

    // 2. Fast local hydration from storage (instant render on Brave, Chrome, Edge)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const stored = await chrome.storage.local.get(['active_battle_data', 'my_leetcode_username']);
        if (stored.my_leetcode_username) myUsername = stored.my_leetcode_username;
        if (stored.active_battle_data) {
          applyBattleData(stored.active_battle_data);
        }
      } catch {}
    }

    // 3. Full server check & poll loop
    checkBattleStatus();

    // 4. SPA resilience: ensure sidebar & queue button stay attached if LeetCode React unmounts them
    setInterval(ensureSidebarAttached, 1500);
    setInterval(ensureQueueButtonAttached, 1500);

    maybeShowEnoReminder(safeMessage).catch(error => {
      console.warn('[LeetStreak] Could not start Eno reminder:', error);
    });
  }

  init();

})();
