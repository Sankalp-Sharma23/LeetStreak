/**
 * LeetCode Page Content Script
 * Injects "Add to Queue" and "Code Screenshot" buttons
 * Autonomous submission observer and Battle HUD
 */

(function() {
  'use strict';
  
  console.log('LeetStreak: Content script loaded');
  
  let buttonsInjected = false;
  let currentProblemData = null;
  let submissionWatcher = null;
  
  // Battle Mode state
  let activeBattle = null;
  let battleAttemptCount = 0;

  function normalizeLanguage(language) {
    const normalized = String(language).toLowerCase().trim();
    const aliases = {
      python: 'python3', py: 'python3', javascript: 'javascript', js: 'javascript',
      typescript: 'typescript', ts: 'typescript', 'c++': 'cpp', cpp: 'cpp',
      csharp: 'csharp', 'c#': 'csharp', golang: 'go'
    };
    return aliases[normalized] || normalized;
  }
  
  // Check if there is an active battle on load
  async function checkBattleStatus() {
    try {
      const [resp, userData] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'BATTLE_GET_STATUS' }),
        chrome.storage.local.get('my_leetcode_username')
      ]);
      const myUsername = userData.my_leetcode_username;
      if (resp?.battle) {
        const status = resp.battle.status;
        const activeStatuses = [
          'starting', 'problem_1_active', 'problem_1_waiting',
          'transitioning', 'problem_2_active', 'problem_2_waiting'
        ];
        
        if (activeStatuses.includes(status)) {
          activeBattle = resp.battle;
          
          // Determine which problem is currently active
          const isP1 = ['starting', 'problem_1_active', 'problem_1_waiting'].includes(status);
          const activeSlug = isP1 ? activeBattle.problem_1 : activeBattle.problem_2;
          
          console.log('[LeetStreak Battle] Active battle detected. Current problem:', activeSlug);
          
          // Check if opponent solved the current problem
          const opponentResult = (resp.results || []).find(r => 
            r.username !== myUsername && 
            r.problem_index === (isP1 ? 1 : 2) && 
            r.accepted
          );
          const opponentSolvedText = opponentResult ? ` — ⚠️ Opponent Finished!` : '';
          
          // Auto-inject language if required
          if (activeBattle.language) {
            const currentLang = window.localStorage.getItem('global_lang');
            if (currentLang !== activeBattle.language) {
              console.log('[LeetStreak Battle] Forcing language to:', activeBattle.language);
              window.localStorage.setItem('global_lang', activeBattle.language);
              // Force a reload once to ensure Monaco editor picks it up
              if (!window.sessionStorage.getItem('leetstreak_lang_forced')) {
                window.sessionStorage.setItem('leetstreak_lang_forced', '1');
                window.location.reload();
                return;
              }
            }
          }
          
          // Determine the start time for the current problem
          const problemStartTime = isP1 ? activeBattle.p1_start_time : activeBattle.p2_start_time;

          injectBattleIndicator(isP1 ? 1 : 2, activeSlug, problemStartTime, opponentSolvedText);
        } else {
          activeBattle = null;
        }
      }
    } catch (e) {
      // Service worker may not be ready yet, ignore
    }
  }

  // Poll battle status periodically
  setInterval(checkBattleStatus, 5000);
  
  // Show a ⚔️ indicator on the page when in battle mode
  function injectBattleIndicator(problemIndex, activeSlug, startTimeIso, opponentSolvedText = '') {
    if (!activeBattle || !isProblemPage()) return;
    const currentSlug = window.location.pathname.split('/problems/')[1]?.split('/')[0];
    if (currentSlug !== activeSlug) return;
    
    let bar = document.getElementById('leetstreak-battle-indicator');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'leetstreak-battle-indicator';
      bar.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0;
        background: linear-gradient(90deg, #7f1d1d, #dc2626, #7f1d1d);
        color: white; text-align: center; font-size: 13px; font-weight: 700;
        padding: 6px 16px; z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(220,38,38,0.4);
        display: flex; justify-content: space-between; align-items: center;
      `;
      
      const leftText = document.createElement('div');
      leftText.id = 'leetstreak-battle-status-text';
      
      const rightText = document.createElement('div');
      rightText.style.cssText = 'font-family: monospace; font-size: 14px; background: rgba(0,0,0,0.2); padding: 2px 8px; border-radius: 4px;';
      rightText.innerHTML = `⏱️ <span id="leetstreak-battle-timer">00:00</span>`;
      
      bar.appendChild(leftText);
      bar.appendChild(rightText);
      document.body.prepend(bar);
      
      // Start timer interval
      const startMs = startTimeIso ? new Date(startTimeIso).getTime() : Date.now();
      setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        const timerSpan = document.getElementById('leetstreak-battle-timer');
        if (timerSpan) {
          timerSpan.textContent = `${m}:${s}`;
        }
      }, 1000);
    }
    
    const leftText = document.getElementById('leetstreak-battle-status-text');
    if (leftText) {
      leftText.textContent = `⚔️ BATTLE ACTIVE — Problem ${problemIndex} of 2${opponentSolvedText}`;
    }
  }
  
  // Send battle submission result to service worker
  async function triggerBattleSubmission(performanceStats, code, language) {
    if (!activeBattle) return;
    
    const currentSlug = window.location.pathname.split('/problems/')[1]?.split('/')[0];
    if (!currentSlug) return;

    const isProblem1 = activeBattle.problem_1 && currentSlug.toLowerCase() === activeBattle.problem_1.toLowerCase();
    const isProblem2 = activeBattle.problem_2 && currentSlug.toLowerCase() === activeBattle.problem_2.toLowerCase();
    
    if (!isProblem1 && !isProblem2) return;
    
    const lines = code ? code.split('\n').filter(l => l.trim().length > 0).length : null;
    
    try {
      const runtime_ms = performanceStats.runtime ? parseInt(performanceStats.runtime) : null;
      const memory_mb = performanceStats.memory ? parseFloat(performanceStats.memory) : null;
      const runtime_beats = performanceStats.runtimePercentile ? parseFloat(performanceStats.runtimePercentile) : null;
      const memory_beats = performanceStats.memoryPercentile ? parseFloat(performanceStats.memoryPercentile) : null;
      
      let submissionId = null;
      const subLink = document.querySelector('a[href*="/submissions/detail/"]');
      if (subLink) {
        const match = subLink.href.match(/detail\/(\d+)/);
        if (match) submissionId = match[1];
      }
      if (!submissionId) {
        submissionId = `sub_${currentSlug}_${Date.now()}`;
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_SUBMISSION',
        battleId: activeBattle.id,
        problemSlug: currentSlug,
        submissionId,
        accepted: true,
        runtime_ms,
        memory_mb,
        runtime_beats,
        memory_beats,
        language: normalizeLanguage(language),
        lines_of_code: lines,
        attempts: battleAttemptCount || 1,
        problemIndex: isProblem1 ? 1 : 2
      });
      
      if (resp?.success) {
        // Update the battle indicator
        const bar = document.getElementById('leetstreak-battle-indicator');
        if (bar) {
          bar.style.background = 'linear-gradient(90deg, #14532d, #16a34a, #14532d)';
          bar.textContent = `✅ Accepted for ${currentSlug}! Progress recorded.`;
        }
        activeBattle = null; // Clear local state so we stop tracking on this page
      }
    } catch (e) {
      console.error('[LeetStreak Battle] Failed to send battle submission:', e);
    }
  }

  // Check if we're on a problem page
  function isProblemPage() {
    return window.location.pathname.startsWith('/problems/') && 
           window.location.pathname !== '/problems/';
  }
  
  // Extract problem information
  function extractProblemData() {
    try {
      // Get problem title
      const titleElement = document.querySelector('[data-cy="question-title"]') || 
                          document.querySelector('div[class*="text-title"]');
      const title = titleElement ? titleElement.textContent.trim() : 'Unknown Problem';
      
      // Get problem slug from URL
      const slug = window.location.pathname.split('/problems/')[1]?.split('/')[0] || '';
      
      // Get difficulty
      const difficultyElement = document.querySelector('div[diff]') ||
                               document.querySelector('[class*="text-difficulty"]');
      const difficulty = difficultyElement ? difficultyElement.textContent.trim() : 'Medium';
      
      // Get problem description
      const descriptionElement = document.querySelector('[data-track-load="description_content"]') ||
                                document.querySelector('[class*="elfjS"]');
      const description = descriptionElement ? descriptionElement.textContent.trim().substring(0, 500) : '';
      
      // Get problem number
      const numberMatch = title.match(/^(\d+)\./);
      const number = numberMatch ? numberMatch[1] : '';
      
      return {
        title: title,
        slug: slug,
        difficulty: difficulty,
        description: description,
        number: number,
        url: window.location.href
      };
    } catch (error) {
      console.error('Error extracting problem data:', error);
      return null;
    }
  }
  
  // Check if problem is marked as solved/submitted on the page
  function checkIfProblemSolved() {
    try {
      // Look for "Solved" badge or checkmark icon
      // LeetCode shows solved status with checkmark or "Solved" text
      
      // Check 1: Look for SVG checkmark in problem title area
      const titleArea = document.querySelector('[data-cy="question-title"]')?.parentElement;
      if (titleArea) {
        const checkmarks = titleArea.querySelectorAll('svg[class*="check"], svg[class*="done"]');
        if (checkmarks.length > 0) {
          console.log('Found checkmark in title area');
          return true;
        }
      }
      
      // Check 2: Look for "Solved" text badge
      const allElements = document.querySelectorAll('*');
      for (let elem of allElements) {
        if (elem.textContent === 'Solved' && elem.offsetParent !== null) {
          console.log('Found "Solved" badge');
          return true;
        }
      }
      
      // Check 3: Look for checkmark in the problem header area
      const headerArea = document.querySelector('[data-cy="question-header"]') ||
                        document.querySelector('[class*="header"]');
      if (headerArea) {
        const successIcon = headerArea.querySelector('[class*="success"], [class*="accepted"], svg[class*="fill-green"]');
        if (successIcon) {
          console.log('Found success icon in header');
          return true;
        }
      }
      
      // Check 4: Look for green checkmark SVG anywhere in top section
      const topSection = document.querySelector('[class*="top"], [data-cy="problem-statement"]');
      if (topSection) {
        const svgs = topSection.querySelectorAll('svg');
        for (let svg of svgs) {
          const classes = svg.className.baseVal || svg.className;
          const fill = svg.getAttribute('fill') || svg.style.fill;
          // Green fill indicates accepted/solved
          if ((classes.includes('check') || classes.includes('done')) && 
              (fill === '#22c55e' || fill.includes('green') || classes.includes('green'))) {
            console.log('Found green checkmark SVG');
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking if problem solved:', error);
      return false;
    }
  }
  
  // Extract user's code
  function extractCode() {
    try {
      // Try to get code from Monaco editor
      const codeEditors = document.querySelectorAll('.view-lines');
      if (codeEditors.length > 0) {
        const codeLines = Array.from(codeEditors[0].querySelectorAll('.view-line'));
        return codeLines.map(line => line.textContent).join('\n');
      }
      
      // Fallback: try textarea
      const textarea = document.querySelector('textarea[class*="code"]');
      if (textarea) {
        return textarea.value;
      }
      
      return '';
    } catch (error) {
      console.error('Error extracting code:', error);
      return '';
    }
  }
  
  // Get selected language - improved detection
  function getSelectedLanguage() {
    try {
      // Strategy 1: Try Monaco editor language
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const lang = models[0].getLanguageId();
          if (lang && lang !== 'plaintext') {
            return normalizeLanguage(lang);
          }
        }
      }
      
      // Strategy 2: Try language selector dropdown button
      const langButton = document.querySelector('button[title*="language"], button[aria-label*="language"]') ||
                        document.querySelector('[class*="lang-select"] button') ||
                        document.querySelector('button[id*="lang"]');
      if (langButton && langButton.textContent) {
        const text = langButton.textContent.trim();
        if (text && text !== '') {
          return normalizeLanguage(text);
        }
      }
      
      // Strategy 3: Try to find language from dropdown menu
      const langDropdown = document.querySelector('[data-mode-id]');
      if (langDropdown) {
        const modeId = langDropdown.getAttribute('data-mode-id');
        if (modeId) {
          return normalizeLanguage(modeId);
        }
      }
      
      // Strategy 4: Try localStorage for language preference
      try {
        const globalLang = localStorage.getItem('global_lang');
        if (globalLang) {
          const parsed = JSON.parse(globalLang);
          if (parsed.lang) {
            return normalizeLanguage(parsed.lang);
          }
        }
      } catch (e) {}
      
      // Default fallback
      return 'python3';
    } catch (error) {
      console.error('Error detecting language:', error);
      return 'python3';
    }
  }
  
  // Create button element with modern, smooth UI
  function createButton(text, icon, onClick, isFloating = false) {
    const button = document.createElement('button');
    button.className = isFloating ? 'leetstreak-floating-btn' : 'leetstreak-btn';
    
    // Create smooth gradient background - LeetCode Premium style (gold)
    const gradientColors = isFloating 
      ? 'linear-gradient(135deg, #ffa116 0%, #f89f1b 50%, #ffc01e 100%)'
      : 'linear-gradient(135deg, #ffa116 0%, #f89f1b 100%)';
    
    // Safely create button content
    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    iconSpan.style.cssText = 'display: inline-block; transition: transform 0.3s ease;';
    iconSpan.innerHTML = icon; // SVG is safe - comes from static code
    
    const textSpan = document.createElement('span');
    textSpan.className = 'text';
    textSpan.textContent = text; // Use textContent for user text
    
    button.appendChild(iconSpan);
    button.appendChild(textSpan);
    
    if (isFloating) {
      button.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 14px 24px;
        background: ${gradientColors};
        color: #1a1a1a;
        border: none;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(255, 161, 22, 0.35);
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        letter-spacing: 0.3px;
        text-transform: none;
      `;
    } else {
      button.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 16px;
        margin-left: 10px;
        background: ${gradientColors};
        color: #1a1a1a;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(255, 161, 22, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        letter-spacing: 0.2px;
        position: relative;
        overflow: hidden;
        text-transform: none;
      `;
      
      // Add shimmer effect on hover
      const shimmer = document.createElement('span');
      shimmer.style.cssText = `
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
        transition: left 0.5s ease;
      `;
      button.appendChild(shimmer);
      
      button.addEventListener('mouseenter', () => {
        shimmer.style.left = '100%';
      });
    }
    
    // Enhanced hover effects
    button.addEventListener('mouseenter', () => {
      if (isFloating) {
        button.style.transform = 'translateY(-2px)';
        button.style.boxShadow = '0 6px 16px rgba(255, 161, 22, 0.45)';
      } else {
        button.style.transform = 'translateY(-1px)';
        button.style.boxShadow = '0 4px 12px rgba(255, 161, 22, 0.4)';
      }
      button.querySelector('.icon').style.transform = 'scale(1.1)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      if (isFloating) {
        button.style.boxShadow = '0 4px 12px rgba(255, 161, 22, 0.35)';
      } else {
        button.style.boxShadow = '0 2px 8px rgba(255, 161, 22, 0.3)';
      }
      button.querySelector('.icon').style.transform = 'scale(1)';
    });
    
    button.addEventListener('mousedown', () => {
      button.style.transform = 'translateY(0) scale(0.98)';
    });
    
    button.addEventListener('mouseup', () => {
      if (isFloating) {
        button.style.transform = 'translateY(-2px)';
      } else {
        button.style.transform = 'translateY(-1px)';
      }
    });
    
    // Add click animation
    button.addEventListener('click', (e) => {
      // Ripple effect
      const ripple = document.createElement('span');
      const rect = button.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        left: ${x}px;
        top: ${y}px;
        background: rgba(255, 255, 255, 0.5);
        border-radius: 50%;
        transform: scale(0);
        animation: ripple 0.6s ease-out;
        pointer-events: none;
      `;
      
      // Add animation keyframes if not already added
      if (!document.getElementById('leetstreak-ripple-animation')) {
        const style = document.createElement('style');
        style.id = 'leetstreak-ripple-animation';
        style.textContent = `
          @keyframes ripple {
            to {
              transform: scale(4);
              opacity: 0;
            }
          }
        `;
        document.head.appendChild(style);
      }
      
      button.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
      
      onClick(e);
    });
    
    return button;
  }

  function showNotification(message, type = 'info') {
    document.getElementById('leetstreak-notification')?.remove();
    const colors = { success: '#10b981', error: '#ef4444', info: '#667eea' };
    const notification = document.createElement('div');
    notification.id = 'leetstreak-notification';
    notification.textContent = message;
    notification.style.cssText = `position: fixed; top: 20px; right: 20px; background: ${colors[type] || colors.info}; color: white; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; z-index: 10001;`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  function injectButtons() {
    if (buttonsInjected || document.getElementById('leetstreak-buttons')) return;
    const submitButton = [...document.querySelectorAll('button')].find(button =>
      /^(Submit|Run|Test)$/.test(button.textContent.trim())
    );
    const target = submitButton?.parentElement || document.querySelector('[class*="toolbar"]');
    if (!target) return;

    const container = document.createElement('div');
    container.id = 'leetstreak-buttons';
    container.style.cssText = 'display: inline-flex; gap: 8px; align-items: center; margin-left: 12px; z-index: 100;';
    container.append(
      createButton('Add to Queue', '📋', handleAddToQueue),
      createButton('Code Screenshot', '📸', handleCodeScreenshot)
    );
    target.appendChild(container);
    buttonsInjected = true;
  }

  function handleCodeScreenshot() {
    const problem = currentProblemData || extractProblemData() || {};
    const code = extractCode();
    if (!code) {
      showNotification('No code found in editor. Write some code first.', 'error');
      return;
    }

    try {
      const language = getSelectedLanguage() || 'code';
      const lines = code.split('\n');

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const fontSize = 14;
      const lineHeight = 22;
      const padding = 32;
      const headerHeight = 70;

      ctx.font = `${fontSize}px "Fira Code", monospace, "Courier New"`;

      let maxLineWidth = 0;
      lines.forEach(line => {
        const w = ctx.measureText(line).width;
        if (w > maxLineWidth) maxLineWidth = w;
      });

      const lineNumWidth = 45;
      const width = Math.max(640, Math.ceil(maxLineWidth + padding * 2 + lineNumWidth + 40));
      const height = Math.ceil(headerHeight + (lines.length * lineHeight) + padding * 2);

      canvas.width = width;
      canvas.height = height;

      ctx.font = `${fontSize}px "Fira Code", monospace, "Courier New"`;

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, '#18181B');
      bgGrad.addColorStop(1, '#09090B');
      ctx.fillStyle = bgGrad;
      if (ctx.roundRect) {
        ctx.roundRect(0, 0, width, height, 16);
      } else {
        ctx.rect(0, 0, width, height);
      }
      ctx.fill();

      // Window controls
      ctx.fillStyle = '#EF4444';
      ctx.beginPath(); ctx.arc(padding, 28, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath(); ctx.arc(padding + 18, 28, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#10B981';
      ctx.beginPath(); ctx.arc(padding + 36, 28, 6, 0, Math.PI * 2); ctx.fill();

      // Title
      ctx.fillStyle = '#F4F4F5';
      ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(`${problem.title || 'LeetCode Problem'} (${language})`, padding + 60, 33);

      // Badge
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = '#F59E0B';
      const watermark = '⚡ LeetStreak';
      ctx.fillText(watermark, width - padding - ctx.measureText(watermark).width, 33);

      // Separator
      ctx.strokeStyle = '#27272A';
      ctx.beginPath();
      ctx.moveTo(padding, 50);
      ctx.lineTo(width - padding, 50);
      ctx.stroke();

      // Code text
      ctx.font = `${fontSize}px "Fira Code", monospace, "Courier New"`;
      let y = headerHeight + padding;
      lines.forEach((line, index) => {
        ctx.fillStyle = '#52525B';
        ctx.fillText(String(index + 1), padding, y);
        ctx.fillStyle = '#E4E4E7';
        ctx.fillText(line, padding + lineNumWidth, y);
        y += lineHeight;
      });

      canvas.toBlob(blob => {
        if (!blob) {
          showNotification('Failed to generate image', 'error');
          return;
        }
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const slug = problem.slug || 'leetcode-solution';
        link.download = `${slug}-solution.png`;
        link.click();
        URL.revokeObjectURL(link.href);
        showNotification('📸 Code screenshot saved as PNG!', 'success');
      }, 'image/png');
    } catch (err) {
      console.error('[LeetStreak] Code screenshot error:', err);
      showNotification('Screenshot generation failed', 'error');
    }
  }
  
  // Create floating action button as fallback
  function _createFloatingButton() {
    // Remove if already exists
    const existing = document.getElementById('leetstreak-floating-menu');
    if (existing) return;
    
    const container = document.createElement('div');
    container.id = 'leetstreak-floating-menu';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 10000;
    `;
    
    const queueBtn = createButton('Queue', '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="15" y1="10" x2="9" y2="10"/></svg>', handleAddToQueue, true);
    const insightsBtn = createButton('Insights', '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>', handleFriendsInsights, true);
    
    queueBtn.style.bottom = '80px';
    insightsBtn.style.bottom = '20px';
    
    container.appendChild(queueBtn);
    container.appendChild(insightsBtn);
    
    document.body.appendChild(container);
    console.log('LeetStreak: Floating buttons added as fallback');
  }
  
  // Check if extension context is still valid
  function isExtensionContextValid() {
    try {
      // Try to access chrome.runtime - this will throw if context is invalidated
      return typeof chrome !== 'undefined' && 
             typeof chrome.storage !== 'undefined' && 
             typeof chrome.storage.local !== 'undefined';
    } catch (e) {
      return false;
    }
  }
  
  // Safe storage access helper
  async function safeStorageGet(key) {
    // Check context first
    if (!isExtensionContextValid()) {
      showNotification('⚠️ Extension reloaded. Please refresh this page (F5).', 'error');
      throw new Error('Extension context invalidated');
    }
    
    try {
      return await chrome.storage.local.get(key);
    } catch (error) {
      const errorMsg = error.message || error.toString() || '';
      const isInvalidated = errorMsg.includes('Extension context invalidated') || 
                           errorMsg.includes('context invalidated') ||
                           errorMsg.includes('message port closed') ||
                           !isExtensionContextValid();
      
      if (isInvalidated) {
        showNotification('⚠️ Extension reloaded. Please refresh this page (F5) to continue.', 'error');
        throw new Error('Extension context invalidated');
      }
      throw error;
    }
  }
  
  async function safeStorageSet(data) {
    // Check context first
    if (!isExtensionContextValid()) {
      showNotification('⚠️ Extension reloaded. Please refresh this page (F5).', 'error');
      throw new Error('Extension context invalidated');
    }
    
    try {
      return await chrome.storage.local.set(data);
    } catch (error) {
      const errorMsg = error.message || error.toString() || '';
      const isInvalidated = errorMsg.includes('Extension context invalidated') || 
                           errorMsg.includes('context invalidated') ||
                           errorMsg.includes('message port closed') ||
                           !isExtensionContextValid();
      
      if (isInvalidated) {
        showNotification('⚠️ Extension reloaded. Please refresh this page (F5) to continue.', 'error');
        throw new Error('Extension context invalidated');
      }
      throw error;
    }
  }
  
  // Handle Add to Queue - Use message passing to avoid context issues
  async function handleAddToQueue() {
    currentProblemData = extractProblemData();
    
    if (!currentProblemData) {
      showNotification('❌ Could not extract problem data', 'error');
      return;
    }

    // Check if problem is already solved/submitted on the page
    const isSolved = checkIfProblemSolved();
    if (isSolved) {
      currentProblemData.status = 'completed';
      console.log('Problem detected as solved on page');
    }
    
    try {
      // Use chrome.runtime.sendMessage instead of direct storage access
      // This avoids extension context invalidated errors
      const response = await new Promise((resolve, reject) => {
        try {
          if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
            reject(new Error('Extension not available'));
            return;
          }
          
          chrome.runtime.sendMessage(
            {
              type: 'ADD_TO_QUEUE',
              problemData: currentProblemData
            },
            (response) => {
              // Check for errors
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            }
          );
        } catch (error) {
          reject(error);
        }
      });
      
      if (response.success) {
        const msg = response.status === 'completed' 
          ? '✅ Added to queue! (Already Submitted ✓)' 
          : '✅ Added to queue!';
        showNotification(msg, 'success');
      } else {
        if (response.alreadyExists) {
          showNotification('📋 Already in queue!', 'info');
        } else {
          showNotification('❌ ' + (response.error || 'Failed to add to queue'), 'error');
        }
      }
      
    } catch (error) {
      console.error('Error adding to queue:', error);
      const errorMsg = error.message || error.toString() || '';
      
      if (errorMsg.includes('Extension context invalidated') || 
          errorMsg.includes('message port closed') ||
          errorMsg.includes('Extension not available')) {
        showNotification('⚠️ Extension reloaded. Please refresh this page (F5).', 'error');
      } else {
        showNotification('❌ Failed to add to queue: ' + errorMsg.substring(0, 50), 'error');
      }
    }
  }
  
  // Handle Friends Insights
  async function handleFriendsInsights() {
    try {
      currentProblemData = extractProblemData();
      if (!currentProblemData || !currentProblemData.slug) {
        showNotification('❌ Could not identify current problem', 'error');
        return;
      }
      
      const slug = currentProblemData.slug;
      
      // Get friends data from storage
      const data = await safeStorageGet(['leetfriends_data', 'my_leetcode_username']);
      const friendsData = data.leetfriends_data || {};
      
      let solvedFriends = [];
      
      for (const [username, userData] of Object.entries(friendsData)) {
        if (username === 'timestamp') continue;
        
        let hasSolved = false;
        
        // Check allAcceptedSubmissions
        if (userData.allAcceptedSubmissions && userData.allAcceptedSubmissions.length > 0) {
          hasSolved = userData.allAcceptedSubmissions.some(sub => sub.titleSlug === slug);
        }
        
        // Fallback: check recentSubmissions
        if (!hasSolved && userData.profile && userData.profile.recentSubmissions) {
          hasSolved = userData.profile.recentSubmissions.some(sub => sub.titleSlug === slug && sub.statusDisplay === 'Accepted');
        }
        
        if (hasSolved) {
          solvedFriends.push({
            username: username,
            avatar: userData.profile?.avatar || 'https://assets.leetcode.com/users/default_avatar.jpg'
          });
        }
      }
      
      showInsightsModal(solvedFriends, currentProblemData.title);
      
    } catch (error) {
      console.error('Insights error:', error);
      showNotification('❌ Failed to load insights', 'error');
    }
  }

  function showInsightsModal(solvedFriends, problemTitle) {
    const existingModal = document.getElementById('leetstreak-insights-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'leetstreak-insights-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; backdrop-filter: blur(8px);
    `;
    
    // Close when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: linear-gradient(145deg, #161b22, #0d1117);
      border: 1px solid #30363d;
      border-radius: 16px;
      width: 420px;
      padding: 24px;
      color: #c9d1d9;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      font-family: 'Inter', system-ui, sans-serif;
    `;
    
    let friendsHtml = '';
    if (solvedFriends.length === 0) {
      friendsHtml = `<div style="text-align:center; padding: 20px; color: #8b949e; background: rgba(255,255,255,0.05); border-radius: 8px;">
        None of your friends have solved this yet. Be the first! 🏆
      </div>`;
    } else {
      friendsHtml = `<div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
        ${solvedFriends.map(f => `
          <div style="display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
            <img src="${f.avatar}" style="width: 32px; height: 32px; border-radius: 50%;" />
            <span style="font-weight: 600;">${f.username}</span>
            <span style="margin-left:auto; color: #2ea043; font-size: 12px;">Solved ✓</span>
          </div>
        `).join('')}
      </div>`;
    }
    
    content.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e3b341" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Friends Insights
        </h2>
        <button id="close-insights-btn" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 20px;">&times;</button>
      </div>
      
      <div style="font-size: 14px; margin-bottom: 12px; color: #8b949e;">
        Problem: <strong style="color: #c9d1d9;">${problemTitle}</strong>
      </div>
      
      <h3 style="font-size: 14px; margin: 20px 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px; color: #8b949e;">Friends who solved this</h3>
      ${friendsHtml}
      
      <div style="margin-top: 24px; padding: 16px; background: rgba(88, 166, 255, 0.1); border: 1px solid rgba(88, 166, 255, 0.2); border-radius: 8px;">
        <div style="font-weight: 600; color: #58a6ff; margin-bottom: 4px;">📈 Rank Predictor</div>
        <div style="font-size: 13px; color: #c9d1d9; line-height: 1.5;">
          Solving this problem will boost your overall solved count and improve your standing on the LeetStreak leaderboard!
        </div>
      </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    document.getElementById('close-insights-btn').addEventListener('click', () => {
      modal.remove();
    });
  }

  function extractPerformanceStats() {
    let stats = {
      runtime: null,
      runtimePercentile: null,
      memory: null,
      memoryPercentile: null,
      acceptanceRate: null
    };

    try {
      const resultArea = document.querySelector('[class*="result"], [data-e2e-locator="submission-result"]');
      if (resultArea) {
        const text = resultArea.textContent;
        
        // Extract runtime (e.g., "Runtime: 52 ms" or "52 ms")
        const runtimeMatch = text.match(/(?:Runtime[:\s]*)?(\d+)\s*ms/i);
        if (runtimeMatch) {
          stats.runtime = `${runtimeMatch[1]} ms`;
        }
        
        // Extract runtime percentile (e.g., "Beats 89.5%" or "faster than 89.5%")
        const runtimePercentMatch = text.match(/(?:Beats|faster than)\s*([\d.]+)\s*%/i);
        if (runtimePercentMatch) {
          stats.runtimePercentile = parseFloat(runtimePercentMatch[1]).toFixed(1);
        }
        
        // Extract memory (e.g., "Memory: 17.2 MB" or "17.2 MB")
        const memoryMatch = text.match(/(?:Memory[:\s]*)?([\d.]+)\s*MB/i);
        if (memoryMatch) {
          stats.memory = `${memoryMatch[1]} MB`;
        }
        
        // Extract memory percentile (e.g., "Beats 45.3%" after memory)
        // This is tricky because there might be two "Beats X%" - one for runtime, one for memory
        const allBeatsMatches = text.matchAll(/(?:Beats|less than)\s*([\d.]+)\s*%/gi);
        const beatsValues = [...allBeatsMatches].map(m => parseFloat(m[1]));
        if (beatsValues.length >= 2) {
          // First is runtime, second is memory
          stats.runtimePercentile = beatsValues[0].toFixed(1);
          stats.memoryPercentile = beatsValues[1].toFixed(1);
        } else if (beatsValues.length === 1 && !stats.runtimePercentile) {
          stats.runtimePercentile = beatsValues[0].toFixed(1);
        }
      }

      // Strategy 2: Look for specific elements with stats
      const statElements = document.querySelectorAll('[class*="flex"][class*="items-center"]');
      statElements.forEach(elem => {
        const text = elem.textContent;
        
        // Check for runtime info
        if (text.includes('ms') && !stats.runtime) {
          const match = text.match(/(\d+)\s*ms/);
          if (match) stats.runtime = `${match[1]} ms`;
        }
        
        // Check for memory info
        if (text.includes('MB') && !stats.memory) {
          const match = text.match(/([\d.]+)\s*MB/);
          if (match) stats.memory = `${match[1]} MB`;
        }
      });

      // Strategy 3: Look for percentile bars/charts
      const percentileElements = document.querySelectorAll('[class*="percent"], [class*="beats"]');
      percentileElements.forEach(elem => {
        const text = elem.textContent;
        const match = text.match(/([\d.]+)\s*%/);
        if (match) {
          const value = parseFloat(match[1]).toFixed(1);
          // Try to determine if it's runtime or memory based on context
          const parent = elem.closest('[class*="runtime"], [class*="memory"]');
          if (parent) {
            if (parent.className.includes('runtime') && !stats.runtimePercentile) {
              stats.runtimePercentile = value;
            } else if (parent.className.includes('memory') && !stats.memoryPercentile) {
              stats.memoryPercentile = value;
            }
          }
        }
      });

      // Strategy 4: Extract from GraphQL data in page
      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
        const content = script.textContent;
        
        // Look for submission details in JSON
        if (content.includes('statusRuntime') || content.includes('runtimePercentile')) {
          try {
            // Try to extract runtime
            const runtimeMatch = content.match(/"statusRuntime"\s*:\s*"?(\d+)\s*ms"?/);
            if (runtimeMatch && !stats.runtime) {
              stats.runtime = `${runtimeMatch[1]} ms`;
            }
            
            // Try to extract runtime percentile
            const runtimePctMatch = content.match(/"runtimePercentile"\s*:\s*([\d.]+)/);
            if (runtimePctMatch && !stats.runtimePercentile) {
              stats.runtimePercentile = parseFloat(runtimePctMatch[1]).toFixed(1);
            }
            
            // Try to extract memory
            const memoryMatch = content.match(/"statusMemory"\s*:\s*"?([\d.]+)\s*MB"?/);
            if (memoryMatch && !stats.memory) {
              stats.memory = `${memoryMatch[1]} MB`;
            }
            
            // Try to extract memory percentile
            const memoryPctMatch = content.match(/"memoryPercentile"\s*:\s*([\d.]+)/);
            if (memoryPctMatch && !stats.memoryPercentile) {
              stats.memoryPercentile = parseFloat(memoryPctMatch[1]).toFixed(1);
            }
          } catch (e) {
            // Continue
          }
        }
      });

      // Strategy 5: Extract acceptance rate from problem info
      try {
        const acceptanceElement = document.querySelector('[class*="acceptance"], [class*="Acceptance"]');
        if (acceptanceElement) {
          const match = acceptanceElement.textContent.match(/([\d.]+)\s*%/);
          if (match) {
            stats.acceptanceRate = parseFloat(match[1]).toFixed(1);
          }
        }
        
        // Also try from the problem description area
        if (!stats.acceptanceRate) {
          const allText = document.body.textContent;
          const acceptMatch = allText.match(/Acceptance Rate\s*:?\s*([\d.]+)\s*%/i);
          if (acceptMatch) {
            stats.acceptanceRate = parseFloat(acceptMatch[1]).toFixed(1);
          }
        }
      } catch (e) {
        // Continue
      }

      console.log('📊 Extracted performance stats:', stats);
      return stats;

    } catch (error) {
      console.error('Error extracting performance stats:', error);
      return stats;
    }
  }

  /**
   * Check if submission was accepted
   */
  function isSubmissionAccepted() {
    const indicators = [
      // Check for "Accepted" text in various locations
      () => {
        const result = document.querySelector('[data-e2e-locator="submission-result"]');
        if (result && result.textContent.includes('Accepted')) {
          console.log('Found Accepted in submission-result');
          return true;
        }
        return false;
      },
      () => {
        const greenText = document.querySelector('.text-green-500, .text-green-600, [class*="text-green"]');
        if (greenText && greenText.textContent.includes('Accepted')) {
          console.log('Found Accepted in green text');
          return true;
        }
        return false;
      },
      () => {
        const successElements = document.querySelectorAll('[class*="success"]');
        for (const elem of successElements) {
          if (elem.textContent.includes('Accepted')) {
            console.log('Found Accepted in success element');
            return true;
          }
        }
        return false;
      },
      () => {
        // Look for the specific "Accepted" div
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const text = div.textContent.trim();
          if (text === 'Accepted' && div.className.includes('text')) {
            console.log('Found Accepted div with text class');
            return true;
          }
        }
        return false;
      }
    ];

    return indicators.some(check => {
      try {
        return check();
      } catch (e) {
        return false;
      }
    });
  }

  /**
   * Check if submission failed
   */
  function isSubmissionFailed() {
    const failureKeywords = ['Wrong Answer', 'Time Limit Exceeded', 'Runtime Error', 'Compile Error'];
    
    return failureKeywords.some(keyword => {
      const resultElement = document.querySelector('[data-e2e-locator="submission-result"]');
      return resultElement && resultElement.textContent.includes(keyword);
    });
  }

  /**
   * Autonomous LeetCode Submission Observer
   * Unconditionally monitors submission verdict on problem pages without GitHub coupling.
   */
  let isObservingSubmission = false;

  function initSubmissionObserver() {
    if (isObservingSubmission) return;
    isObservingSubmission = true;

    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('button');
      if (!button || !/^Submit$/i.test(button.textContent.trim())) return;

      console.log('[LeetStreak] Submit button clicked. Starting observation...');
      const problem = currentProblemData || extractProblemData() || {};
      const code = extractCode();
      const language = getSelectedLanguage();
      battleAttemptCount++;

      let checkInterval = null;
      let timeoutId = null;

      const stopChecking = () => {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      checkInterval = setInterval(async () => {
        if (isSubmissionAccepted()) {
          stopChecking();
          console.log('✅ [LeetStreak] Accepted submission detected!');
          showNotification('✅ LeetStreak: Accepted submission detected!', 'success');

          const stats = extractPerformanceStats();

          // 1. Notify service worker of accepted solve (lifts Hardcore Mode, updates Problem Queue, syncs stats)
          try {
            await chrome.runtime.sendMessage({
              type: 'SUBMISSION_ACCEPTED',
              problemSlug: problem.slug,
              title: problem.title
            });
          } catch (e) {
            console.warn('[LeetStreak] Could not send SUBMISSION_ACCEPTED:', e);
          }

          // 2. Report battle submission if active
          await triggerBattleSubmission(stats, code, language);

        } else if (isSubmissionFailed()) {
          stopChecking();
          console.log('❌ [LeetStreak] Submission failed or rejected.');
        }
      }, 1000);

      // 5-minute timeout safety
      timeoutId = setTimeout(() => {
        stopChecking();
      }, 5 * 60 * 1000);
    }, true);
  }

  // Initialize
  function init() {
    if (!isProblemPage()) {
      return;
    }

    console.log('[LeetStreak] Initializing content scripts on problem page...');
    initSubmissionObserver();

    setTimeout(() => {
      if (!buttonsInjected) injectButtons();
    }, 1500);

    setTimeout(() => {
      if (!buttonsInjected) injectButtons();
    }, 4000);

    // Watch for SPA URL changes
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
      try {
        const url = location.href;
        if (url !== lastUrl) {
          lastUrl = url;
          buttonsInjected = false;
          if (isProblemPage()) {
            initSubmissionObserver();
            setTimeout(() => injectButtons(), 2000);
          }
        }
      } catch {}
    });

    try {
      urlObserver.observe(document, { subtree: true, childList: true });
    } catch {}
  }

  init();
})();
