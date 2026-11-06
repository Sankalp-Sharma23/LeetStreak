/**
 * LeetCode Page Content Script — LeetStreak Battle HUD
 *
 * Responsibilities:
 * 1. Detect "Accepted" submission verdicts
 * 2. Auto-redirect to next battle problem after solving
 * 3. Render a battle HUD bar (countdown, scores, opponent progress)
 * 4. Show opponent-solved toast notifications
 * 5. Report accepted solves to service worker
 *
 * Removed: "Add to Queue", "Code Screenshot" button injection
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
  let battleAttemptCount = 0;
  let hudInjected       = false;
  let hudTimer          = null;
  let submissionObserving = false;
  let redirectPending   = false; // prevent double-redirect

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
    const stats = { runtime: null, runtimePercentile: null, memory: null, memoryPercentile: null };
    try {
      const resultArea = document.querySelector('[data-e2e-locator="submission-result"], [class*="result"]');
      if (resultArea) {
        const text = resultArea.textContent;
        const runtimeMatch = text.match(/(?:Runtime[:\s]*)?(\\d+)\\s*ms/i);
        if (runtimeMatch) stats.runtime = parseInt(runtimeMatch[1]);
        const allBeats = [...text.matchAll(/(?:Beats|less than)[\\s]+([\d.]+)[\\s]*%/gi)].map(m => parseFloat(m[1]));
        if (allBeats.length >= 2) {
          stats.runtimePercentile = allBeats[0];
          stats.memoryPercentile = allBeats[1];
        } else if (allBeats.length === 1) {
          stats.runtimePercentile = allBeats[0];
        }
        const memMatch = text.match(/(?:Memory[:\s]*)?([\d.]+)\s*MB/i);
        if (memMatch) stats.memory = parseFloat(memMatch[1]);
      }
    } catch {}
    return stats;
  }

  // ─────────────────────────────────────────────────────────
  // SUBMISSION DETECTION
  // ─────────────────────────────────────────────────────────

  function isSubmissionAccepted() {
    const checks = [
      () => {
        const r = document.querySelector('[data-e2e-locator="submission-result"]');
        return r && r.textContent.includes('Accepted');
      },
      () => {
        const g = document.querySelector('.text-green-500, .text-green-600, [class*="text-green"]');
        return g && g.textContent.includes('Accepted');
      },
      () => {
        for (const el of document.querySelectorAll('[class*="success"]')) {
          if (el.textContent.includes('Accepted')) return true;
        }
        return false;
      },
      () => {
        for (const div of document.querySelectorAll('div')) {
          if (div.textContent.trim() === 'Accepted' && div.className?.includes?.('text')) return true;
        }
        return false;
      }
    ];
    return checks.some(fn => { try { return fn(); } catch { return false; } });
  }

  function isSubmissionFailed() {
    const failKeywords = ['Wrong Answer', 'Time Limit Exceeded', 'Runtime Error', 'Compile Error', 'Memory Limit'];
    const result = document.querySelector('[data-e2e-locator="submission-result"]');
    if (!result) return false;
    return failKeywords.some(k => result.textContent.includes(k));
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

  function oppSolvedThisProblem(slug) {
    return oppResults.some(r => r.problem_slug === slug);
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

  async function handleAcceptedSolve(stats, code, language) {
    if (!activeBattle?.id || redirectPending) return;
    const slug = getCurrentSlug();
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
    const startMs = activeBattle.start_at || activeBattle.match_starts_at
      ? new Date(activeBattle.start_at || activeBattle.match_starts_at).getTime()
      : Date.now();
    const timeTakenMs = Math.max(0, Date.now() - startMs);

    let submissionId = null;
    const subLink = document.querySelector('a[href*="/submissions/detail/"]');
    if (subLink) {
      const m = subLink.href.match(/detail\/(\d+)/);
      if (m) submissionId = m[1];
    }

    const resp = await safeMessage({
      type: 'BATTLE_SOLVED_V2',
      battleId: activeBattle.id,
      problemSlug: slug,
      submissionId,
      timeTakenMs,
      runtimeMs: stats?.runtime || null,
      memoryMb: stats?.memory || null,
      language: normalizeLanguage(language)
    });

    // Also send legacy SUBMISSION_ACCEPTED for streak tracking
    safeMessage({ type: 'SUBMISSION_ACCEPTED', problemSlug: slug, title: slug }).catch(() => {});

    if (resp?.success) {
      // Update local state
      myResults = [...myResults, { problem_slug: slug }];
      updateHudScores();

      if (resp.next_problem_slug) {
        const nextUrl = resp.next_problem_url || `https://leetcode.com/problems/${resp.next_problem_slug}/`;
        showBattleToast(`⏭ Next problem: ${resp.next_problem_slug}`, 'info');
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

  function initSubmissionObserver() {
    if (submissionObserving) return;
    submissionObserving = true;

    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('button');
      if (!button || !/^Submit$/i.test(button.textContent.trim())) return;

      battleAttemptCount++;
      const language = getSelectedLanguage();
      const code = extractCode();

      let checkInterval = null;
      let timeoutId = null;

      const stop = () => {
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
        checkInterval = null;
        timeoutId = null;
      };

      checkInterval = setInterval(async () => {
        if (isSubmissionAccepted()) {
          stop();
          const stats = extractPerformanceStats();

          // If we have an active battle, handle battle solve (which also sends SUBMISSION_ACCEPTED)
          if (activeBattle && activeBattle.status === 'in_progress') {
            await handleAcceptedSolve(stats, code, language);
          } else {
            // No battle: just notify service worker for streak tracking
            safeMessage({ type: 'SUBMISSION_ACCEPTED', problemSlug: getCurrentSlug(), title: document.title }).catch(() => {});
            showBattleToast('✅ Submission accepted!', 'success');
          }
        } else if (isSubmissionFailed()) {
          stop();
        }
      }, 1000);

      // 5 minute safety timeout
      timeoutId = setTimeout(stop, 5 * 60 * 1000);
    }, true);
  }

  // ─────────────────────────────────────────────────────────
  // BATTLE STATUS POLLING
  // ─────────────────────────────────────────────────────────

  async function checkBattleStatus() {
    if (!isExtensionContextValid()) return;
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
          const stateResp = await safeMessage({
            type: 'BATTLE_GET_STATE_V2',
            battleId: battle.id
          });

          if (stateResp?.success && stateResp.state) {
            battleProblems = stateResp.state.problems || [];
            const allResults = stateResp.state.results || [];
            const newMyResults = allResults.filter(r => r.username?.toLowerCase() === myUsername?.toLowerCase());
            const newOppResults = allResults.filter(r => r.username?.toLowerCase() !== myUsername?.toLowerCase());

            checkForOpponentSolves(newOppResults);
            myResults = newMyResults;
            oppResults = newOppResults;

            // Check if we should redirect to first problem (battle just started / page navigated away)
            if (battle.status === 'in_progress' && !isProblemPage() && battleProblems.length > 0) {
              const nextUnsolved = battleProblems.find(p =>
                !myResults.some(r => r.problem_slug === p.problem_slug)
              );
              if (nextUnsolved && !redirectPending) {
                redirectPending = true;
                window.location.href = nextUnsolved.problem_url;
                return;
              }
            }

            // Inject or update HUD on problem pages
            if (isProblemPage()) {
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

      // Auto-redirect from non-battle page when battle is in_progress
      if (activeBattle?.status === 'in_progress' && !isProblemPage() && battleProblems.length > 0) {
        const nextUnsolved = battleProblems.find(p => !myResults.some(r => r.problem_slug === p.problem_slug));
        if (nextUnsolved && !redirectPending) {
          redirectPending = true;
          window.location.href = nextUnsolved.problem_url;
        }
      }
    } catch (e) {
      // Service worker may not be ready
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

    // Reset per-page state (but keep activeBattle)
    submissionObserving = false;
    redirectPending = false;
    hudInjected = false;
    document.body.style.marginTop = '';

    if (isProblemPage()) {
      initSubmissionObserver();
      // Re-check battle status after navigation settles
      setTimeout(checkBattleStatus, 2000);
    } else {
      removeHUD();
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

  function init() {
    initSubmissionObserver();
    checkBattleStatus();
    // Poll every 5s while on any LeetCode page
    setInterval(checkBattleStatus, 5000);
  }

  init();

})();
