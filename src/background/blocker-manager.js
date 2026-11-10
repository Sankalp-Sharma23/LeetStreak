/**
 * Hardcore Motivation Mode - Authoritative Blocker Manager
 *
 * Responsibilities:
 * - Multi-layered distraction blocking:
 *   1. Chrome DeclarativeNetRequest dynamic rules (network layer)
 *   2. chrome.webNavigation.onBeforeNavigate (pre-navigation layer)
 *   3. chrome.webNavigation.onCommitted (navigation commit layer)
 *   4. chrome.webNavigation.onHistoryStateUpdated (SPA route transitions)
 *   5. chrome.tabs.onUpdated (tab update fail-safe)
 * - Canonical solve-to-unlock state resolution using user timezone and accepted LeetCode submissions.
 * - Idempotent rule synchronization across service worker restarts, storage updates, and daily rollover.
 * - Safe return URL validation to prevent redirect loops.
 */

import { getFriend } from '../shared/storage.js';
import { timestampToDateString, getConfirmedAcceptedSolveToday } from '../shared/streak-calculator.js';

// ==========================================
// 1. CONFIGURATION & RULE SETS
// ==========================================

export const DEFAULT_BLOCKED_DOMAINS = [
  // Messaging & Chat Distractions
  'whatsapp.com',
  'web.whatsapp.com',
  'telegram.org',
  'web.telegram.org',
  'discord.com',
  'messenger.com',
  'snapchat.com',
  // Social Feeds & Doomscrolling
  'tiktok.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'threads.net',
  'reddit.com',
  'old.reddit.com',
  '9gag.com',
  'pinterest.com',
  'bsky.app',
  'tumblr.com',
  // Streaming & Live Video
  'netflix.com',
  'twitch.tv',
  'kick.com',
  'hotstar.com',
  'disneyplus.com',
  'primevideo.com',
  'hulu.com',
  'max.com',
  'crunchyroll.com',
  // Casual Gaming & Distractions
  'chess.com',
  'lichess.org',
  'geoguessr.com',
  'store.steampowered.com',
  'roblox.com'
];

export const PATH_SPECIFIC_BLOCK_RULES = [
  {
    domain: 'youtube.com',
    paths: ['/shorts', '/feed/explore'],
    label: 'YouTube Shorts'
  },
  {
    domain: 'm.youtube.com',
    paths: ['/shorts', '/feed/explore'],
    label: 'YouTube Shorts (Mobile)'
  },
  {
    domain: 'facebook.com',
    paths: ['/reel', '/watch'],
    label: 'Facebook Reels'
  },
  {
    domain: 'm.facebook.com',
    paths: ['/reel', '/watch'],
    label: 'Facebook Reels (Mobile)'
  },
  {
    domain: 'linkedin.com',
    paths: ['/feed'],
    label: 'LinkedIn Feed'
  }
];

export const EDUCATIONAL_EXCEPTIONS = [
  {
    domain: 'youtube.com',
    allowedPrefixes: ['/watch', '/playlist', '/@', '/channel', '/c']
  },
  {
    domain: 'm.youtube.com',
    allowedPrefixes: ['/watch', '/playlist', '/@', '/channel', '/c']
  },
  {
    domain: 'linkedin.com',
    allowedPrefixes: ['/jobs', '/messaging', '/in']
  }
];

// ==========================================
// 2. URL EVALUATION & NORMALIZATION
// ==========================================

/**
 * Normalizes hostnames by stripping www. and m. prefixes and lowercasing.
 */
export function normalizeHostname(hostname) {
  if (!hostname) return '';
  return hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
}

/**
 * Evaluates whether a given URL is a distraction under Hardcore Mode rules.
 *
 * @param {string} rawUrl - Full URL string
 * @param {Object} options - { customBlocked: string[], allowlist: string[] }
 * @returns {{ isDistraction: boolean, reason: string, label: string }}
 */
export function evaluateUrl(rawUrl, options = {}) {
  const { customBlocked = [], allowlist = [] } = options;

  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isDistraction: false, reason: 'INVALID_URL', label: '' };
  }

  // Never block extension internal pages or Chrome settings
  if (rawUrl.includes('blocked.html') || rawUrl.startsWith('chrome-extension:') || rawUrl.startsWith('chrome:')) {
    return { isDistraction: false, reason: 'SYSTEM_INTERNAL_PAGE', label: '' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { isDistraction: false, reason: 'PARSE_ERROR', label: '' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isDistraction: false, reason: 'NON_HTTP_PROTOCOL', label: '' };
  }

  const rawHost = parsed.hostname.toLowerCase();
  const normalizedHost = normalizeHostname(rawHost);

  // 1. Critical System Whitelist: LeetCode is NEVER blocked
  if (normalizedHost.includes('leetcode.com')) {
    return { isDistraction: false, reason: 'SYSTEM_ALLOW_LEETCODE', label: 'LeetCode' };
  }

  // 2. User-configured allowlist (exact or domain matching)
  for (const allowed of allowlist) {
    if (!allowed) continue;
    const cleanAllowed = allowed.trim().toLowerCase();
    if (rawUrl.toLowerCase().includes(cleanAllowed) || normalizedHost === normalizeHostname(cleanAllowed)) {
      return { isDistraction: false, reason: 'USER_ALLOWLIST', label: allowed };
    }
  }

  // 3. Educational Exceptions (e.g. YouTube tutorial watch pages, LinkedIn jobs)
  for (const exp of EDUCATIONAL_EXCEPTIONS) {
    if (normalizedHost === normalizeHostname(exp.domain)) {
      for (const prefix of exp.allowedPrefixes) {
        if (parsed.pathname.startsWith(prefix)) {
          return { isDistraction: false, reason: 'EDUCATIONAL_EXCEPTION', label: `${exp.domain}${prefix}` };
        }
      }
    }
  }

  // 4. Path-specific distraction blocks (e.g. YouTube Shorts, LinkedIn Feed)
  for (const rule of PATH_SPECIFIC_BLOCK_RULES) {
    if (normalizedHost === normalizeHostname(rule.domain)) {
      for (const blockPath of rule.paths) {
        if (parsed.pathname.startsWith(blockPath)) {
          return { isDistraction: true, reason: 'PATH_DISTRACTION', label: rule.label };
        }
      }
    }
  }

  // 5. User-configured custom blocked domains
  for (const custom of customBlocked) {
    if (!custom) continue;
    const cleanCustom = normalizeHostname(custom.trim().toLowerCase());
    if (normalizedHost === cleanCustom || normalizedHost.endsWith('.' + cleanCustom)) {
      return { isDistraction: true, reason: 'CUSTOM_BLOCKED_DOMAIN', label: cleanCustom };
    }
  }

  // 6. Default blocked domains list
  for (const domain of DEFAULT_BLOCKED_DOMAINS) {
    const cleanDomain = normalizeHostname(domain);
    if (normalizedHost === cleanDomain || normalizedHost.endsWith('.' + cleanDomain)) {
      return { isDistraction: true, reason: 'DEFAULT_BLOCKED_DOMAIN', label: cleanDomain };
    }
  }

  return { isDistraction: false, reason: 'UNRESTRICTED', label: '' };
}

// ==========================================
// 3. DECLARATIVE NET REQUEST RULE BUILDER
// ==========================================

/**
 * Generates declarativeNetRequest dynamic rules using native requestDomains and priority hierarchy.
 *
 * Priorities:
 * 10: Critical System Allow (LeetCode)
 *  5: User configured allowlist
 *  3: Educational exceptions (e.g. YouTube /watch)
 *  2: Path-specific blocks (e.g. YouTube /shorts)
 *  1: Whole domain blocks (e.g. instagram.com)
 *
 * @param {Object} options - { customBlocked: string[], allowlist: string[] }
 * @returns {Array<chrome.declarativeNetRequest.Rule>}
 */
export function generateDNRRules(options = {}) {
  const { customBlocked = [], allowlist = [] } = options;
  const rules = [];
  let nextId = 1000;

  // 1. Critical System Allow: LeetCode (Priority 10)
  rules.push({
    id: nextId++,
    priority: 10,
    action: { type: 'allow' },
    condition: {
      requestDomains: ['leetcode.com'],
      resourceTypes: ['main_frame']
    }
  });

  // 2. User allowlist rules (Priority 5)
  for (const allowed of allowlist) {
    if (!allowed || !allowed.trim()) continue;
    const clean = allowed.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    rules.push({
      id: nextId++,
      priority: 5,
      action: { type: 'allow' },
      condition: {
        requestDomains: [clean],
        resourceTypes: ['main_frame']
      }
    });
  }

  // 3. Educational Exceptions (Priority 3)
  for (const exp of EDUCATIONAL_EXCEPTIONS) {
    for (const prefix of exp.allowedPrefixes) {
      rules.push({
        id: nextId++,
        priority: 3,
        action: { type: 'allow' },
        condition: {
          requestDomains: [exp.domain],
          urlFilter: `*${prefix}*`,
          resourceTypes: ['main_frame']
        }
      });
    }
  }

  // 4. Path-specific blocks (Priority 2)
  for (const rule of PATH_SPECIFIC_BLOCK_RULES) {
    for (const path of rule.paths) {
      rules.push({
        id: nextId++,
        priority: 2,
        action: {
          type: 'redirect',
          redirect: { extensionPath: '/blocked.html' }
        },
        condition: {
          requestDomains: [rule.domain],
          urlFilter: `*${path}*`,
          resourceTypes: ['main_frame']
        }
      });
    }
  }

  // 5. Whole domain blocks (Priority 1)
  const allDomains = Array.from(new Set([...DEFAULT_BLOCKED_DOMAINS, ...customBlocked]));
  for (const domain of allDomains) {
    if (!domain || !domain.trim()) continue;
    const clean = normalizeHostname(domain.trim());
    rules.push({
      id: nextId++,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { extensionPath: '/blocked.html' }
      },
      condition: {
        requestDomains: [clean],
        resourceTypes: ['main_frame']
      }
    });
  }

  return rules;
}

// ==========================================
// 4. CANONICAL SOLVE-TO-UNLOCK LOGIC
// ==========================================

/**
 * Authoritatively determines whether the blocker should be active right now.
 *
 * Rules:
 * - If hardcore_mode_enabled is false => UNLOCKED (Blocker inactive)
 * - If current user solved at least 1 accepted problem today in user_timezone => UNLOCKED (Blocker inactive)
 * - Otherwise => LOCKED (Blocker active)
 *
 * @returns {Promise<{ active: boolean, reason: string, todayStr: string, streak: number }>}
 */
export async function isBlockerActive() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return { active: false, reason: 'CHROME_STORAGE_UNAVAILABLE', todayStr: '', streak: 0 };
  }

  try {
    const settings = await chrome.storage.local.get([
      'hardcore_mode_enabled',
      'my_leetcode_username',
      'last_solve_date',
      'user_timezone',
      'own_profile'
    ]);

    const timezone = settings.user_timezone;
    const nowTs = Math.floor(Date.now() / 1000);
    const todayStr = timestampToDateString(nowTs, timezone);

    // If Hardcore Mode is disabled, blocker is never active
    if (!settings.hardcore_mode_enabled) {
      return { active: false, reason: 'HARDCORE_DISABLED', todayStr, streak: 0 };
    }

    // The accepted-submission listener records this date immediately. Trust
    // that same-day marker before consulting a possibly stale profile cache.
    if (settings.last_solve_date === todayStr) {
      return {
        active: false,
        reason: 'SOLVED_TODAY_LOCAL_MARKER',
        todayStr,
        streak: settings.own_profile?.stats?.streak || 0
      };
    }

    // Check actual profile data from LeetCode
    const username = settings.my_leetcode_username;
    let profile = settings.own_profile;
    if (!profile && username) {
      try {
        const stored = await chrome.storage.local.get(['friends_cache']);
        if (stored.friends_cache) {
          const key = Object.keys(stored.friends_cache).find(k => k.toLowerCase() === username.toLowerCase());
          if (key) {
            profile = stored.friends_cache[key];
          }
        }
        if (!profile) {
          profile = await getFriend(username);
        }
      } catch (err) {
        console.warn('[BlockerManager] Error fetching cached friend data:', err);
      }
    }

    if (profile) {
      const streak = profile.stats?.streak || 0;
      const solved = getConfirmedAcceptedSolveToday(profile, timezone);
      if (solved === true) {
        // Legitimate accepted solve today: cache it and unlock!
        await chrome.storage.local.set({ last_solve_date: todayStr });
        return { active: false, reason: 'SOLVED_TODAY_CANONICAL', todayStr, streak };
      } else {
        return { active: true, reason: 'UNSOLVED_TODAY', todayStr, streak };
      }
    }

    // Default to active (locked) if hardcore mode is on and no solved records exist for today
    return { active: true, reason: 'NO_PROFILE_UNSOLVED', todayStr, streak: 0 };
  } catch (err) {
    console.error('[BlockerManager] isBlockerActive check error:', err);
    return { active: false, reason: `ERROR: ${err.message}`, todayStr: '', streak: 0 };
  }
}

// ==========================================
// 5. RULE SYNCHRONIZATION
// ==========================================

/**
 * Idempotently reconciles Chrome declarativeNetRequest dynamic rules.
 *
 * @returns {Promise<{ success: boolean, locked: boolean, ruleCount: number, reason: string }>}
 */
export async function syncBlockerRules() {
  if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) {
    console.warn('[BlockerManager] chrome.declarativeNetRequest API not available');
    return { success: false, locked: false, ruleCount: 0, reason: 'DNR_NOT_AVAILABLE' };
  }

  try {
    const status = await isBlockerActive();
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(r => r.id);

    if (!status.active) {
      // Blocker is UNLOCKED: remove all installed rules
      if (existingRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existingRuleIds,
          addRules: []
        });
      }
      await chrome.storage.local.set({
        hardcore_blocker_state: {
          locked: false,
          ruleCount: 0,
          reason: status.reason,
          todayStr: status.todayStr,
          streak: status.streak,
          lastSynced: Date.now()
        }
      });
      return { success: true, locked: false, ruleCount: 0, reason: status.reason };
    }

    // Blocker is LOCKED: install full dynamic ruleset
    const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
    const newRules = generateDNRRules({
      customBlocked: settings.custom_blocked_domains || [],
      allowlist: settings.allowlist || []
    });

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: newRules
    });

    await chrome.storage.local.set({
      hardcore_blocker_state: {
        locked: true,
        ruleCount: newRules.length,
        reason: status.reason,
        todayStr: status.todayStr,
        streak: status.streak,
        lastSynced: Date.now()
      }
    });

    // Actively sweep any tabs already open before rules were installed
    await sweepOpenTabs();

    return { success: true, locked: true, ruleCount: newRules.length, reason: status.reason };
  } catch (err) {
    console.error('[BlockerManager] syncBlockerRules error:', err);
    try {
      await chrome.storage.local.set({
        hardcore_blocker_state: {
          locked: false,
          error: err.message,
          lastSynced: Date.now()
        }
      });
    } catch {
      // Storage set fallback
    }
    return { success: false, locked: false, ruleCount: 0, error: err.message };
  }
}

// ==========================================
// 6. RETURN URL VALIDATION
// ==========================================

/**
 * Validates a return URL to prevent open-redirect vulnerabilities and infinite loops.
 *
 * @param {string} rawUrl
 * @returns {string|null} Safe sanitized URL or null if invalid
 */
export function sanitizeReturnUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.pathname.includes('blocked.html')) {
      return null;
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

// ==========================================
// 7. ACTIVE TAB SWEEPER & REDIRECTION
// ==========================================

let listenersInitialized = false;

/**
 * Redirects a tab to blocked.html with destination metadata.
 *
 * @param {number} tabId
 * @param {string} url
 * @param {string} [label]
 */
export function redirectTabToBlocked(tabId, url, label = '') {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.update) return;
  try {
    const redirectUrl = chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(url)}&label=${encodeURIComponent(label)}`);
    chrome.tabs.update(tabId, { url: redirectUrl }, () => {
      if (chrome.runtime?.lastError) {
        // Tab closed or not accessible, ignored
      }
    });
  } catch (err) {
    console.warn('[BlockerManager] redirectTabToBlocked error:', err);
  }
}

/**
 * Scans all open browser tabs across all windows and redirects any currently open
 * distracting websites to blocked.html.
 *
 * This ensures that tabs that were already loaded BEFORE Hardcore Mode was enabled
 * or before service worker startup are immediately locked down.
 *
 * @returns {Promise<{ sweptCount: number, redirectedTabs: Array<{ id: number, url: string }> }>}
 */
export async function sweepOpenTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
    return { sweptCount: 0, redirectedTabs: [] };
  }

  try {
    const status = await isBlockerActive();
    if (!status.active) {
      return { sweptCount: 0, redirectedTabs: [] };
    }

    const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
    const customBlocked = settings.custom_blocked_domains || [];
    const allowlist = settings.allowlist || [];

    const tabs = await chrome.tabs.query({});
    const redirectedTabs = [];

    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;

      // Never touch internal extension pages, browser settings, or LeetCode
      if (
        tab.url.includes('blocked.html') ||
        tab.url.startsWith('chrome') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('edge:') ||
        tab.url.includes('leetcode.com')
      ) {
        continue;
      }

      const evalResult = evaluateUrl(tab.url, { customBlocked, allowlist });
      if (evalResult.isDistraction) {
        console.log(`[BlockerManager] Sweeping open distracting tab #${tab.id}: ${tab.url} (${evalResult.label || evalResult.reason})`);
        redirectTabToBlocked(tab.id, tab.url, evalResult.label);
        redirectedTabs.push({ id: tab.id, url: tab.url });
      }
    }

    return { sweptCount: redirectedTabs.length, redirectedTabs };
  } catch (err) {
    console.warn('[BlockerManager] sweepOpenTabs error:', err);
    return { sweptCount: 0, redirectedTabs: [], error: err.message };
  }
}

// ==========================================
// 8. MULTI-LAYER NAVIGATION LISTENERS
// ==========================================

/**
 * Initializes listeners for DNR, web navigation, SPA route changes, tab switching, and storage updates.
 */
export function initializeBlockerManager() {
  if (listenersInitialized || typeof chrome === 'undefined') return;
  listenersInitialized = true;

  // 1. Initial rule sync and tab sweep on startup
  syncBlockerRules().catch(err => console.error('[BlockerManager] Startup sync failed:', err));

  // 2. Pre-Navigation Interceptor (Fires before network lookup begins)
  if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
      if (details.frameId !== 0) return;
      if (!details.url || details.url.includes('blocked.html') || details.url.startsWith('chrome') || details.url.startsWith('about:')) return;

      try {
        const status = await isBlockerActive();
        if (!status.active) return;

        const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
        const evalResult = evaluateUrl(details.url, {
          customBlocked: settings.custom_blocked_domains || [],
          allowlist: settings.allowlist || []
        });

        if (evalResult.isDistraction) {
          if (chrome.storage.session) {
            await chrome.storage.session.set({
              [`blocked_tab_${details.tabId}`]: {
                url: details.url,
                label: evalResult.label,
                timestamp: Date.now()
              }
            });
          }
          redirectTabToBlocked(details.tabId, details.url, evalResult.label);
        }
      } catch (err) {
        console.warn('[BlockerManager] onBeforeNavigate error:', err);
      }
    });
  }

  // 3. Navigation Commit Interceptor (Fires when URL commits before DOM parses)
  if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
    chrome.webNavigation.onCommitted.addListener(async (details) => {
      if (details.frameId !== 0) return;
      if (!details.url || details.url.includes('blocked.html') || details.url.startsWith('chrome') || details.url.startsWith('about:')) return;

      try {
        const status = await isBlockerActive();
        if (!status.active) return;

        const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
        const evalResult = evaluateUrl(details.url, {
          customBlocked: settings.custom_blocked_domains || [],
          allowlist: settings.allowlist || []
        });

        if (evalResult.isDistraction) {
          redirectTabToBlocked(details.tabId, details.url, evalResult.label);
        }
      } catch (err) {}
    });
  }

  // 4. SPA Route Transition Listener (e.g. YouTube -> YouTube Shorts via pushState)
  if (chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated) {
    chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
      if (details.frameId !== 0) return;
      if (!details.url || details.url.includes('blocked.html') || details.url.startsWith('chrome') || details.url.startsWith('about:')) return;

      try {
        const status = await isBlockerActive();
        if (!status.active) return;

        const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
        const evalResult = evaluateUrl(details.url, {
          customBlocked: settings.custom_blocked_domains || [],
          allowlist: settings.allowlist || []
        });

        if (evalResult.isDistraction) {
          if (chrome.storage.session) {
            await chrome.storage.session.set({
              [`blocked_tab_${details.tabId}`]: {
                url: details.url,
                label: evalResult.label,
                timestamp: Date.now()
              }
            });
          }
          redirectTabToBlocked(details.tabId, details.url, evalResult.label);
        }
      } catch (err) {
        console.warn('[BlockerManager] onHistoryStateUpdated error:', err);
      }
    });
  }

  // 5. Tab Update Fail-Safe
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      const url = changeInfo.url || tab?.url;
      if (!url || url.includes('blocked.html') || url.startsWith('chrome') || url.startsWith('about:') || url.includes('leetcode.com')) return;

      try {
        const status = await isBlockerActive();
        if (!status.active) return;

        const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
        const evalResult = evaluateUrl(url, {
          customBlocked: settings.custom_blocked_domains || [],
          allowlist: settings.allowlist || []
        });

        if (evalResult.isDistraction) {
          redirectTabToBlocked(tabId, url, evalResult.label);
        }
      } catch (err) {}
    });
  }

  // 6. Tab Switch / Activation Interceptor
  // Immediately blocks when user switches focus to an already open distracting tab
  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const status = await isBlockerActive();
        if (!status.active) return;

        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!tab || !tab.url) return;
        if (
          tab.url.includes('blocked.html') ||
          tab.url.startsWith('chrome') ||
          tab.url.startsWith('about:') ||
          tab.url.startsWith('edge:') ||
          tab.url.includes('leetcode.com')
        ) return;

        const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
        const evalResult = evaluateUrl(tab.url, {
          customBlocked: settings.custom_blocked_domains || [],
          allowlist: settings.allowlist || []
        });

        if (evalResult.isDistraction) {
          console.log(`[BlockerManager] onActivated blocking active tab #${activeInfo.tabId} (${tab.url})`);
          redirectTabToBlocked(activeInfo.tabId, tab.url, evalResult.label);
        }
      } catch (err) {
        // Tab may have closed before get() returned
      }
    });
  }

  // 7. Window Focus Change Interceptor
  // Immediately blocks when user focuses a different browser window with an active distracting tab
  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (typeof chrome.windows.WINDOW_ID_NONE !== 'undefined' && windowId === chrome.windows.WINDOW_ID_NONE) return;
      try {
        const status = await isBlockerActive();
        if (!status.active) return;

        const [activeTab] = await chrome.tabs.query({ active: true, windowId });
        if (!activeTab || !activeTab.id || !activeTab.url) return;
        if (
          activeTab.url.includes('blocked.html') ||
          activeTab.url.startsWith('chrome') ||
          activeTab.url.startsWith('about:') ||
          activeTab.url.startsWith('edge:') ||
          activeTab.url.includes('leetcode.com')
        ) return;

        const settings = await chrome.storage.local.get(['custom_blocked_domains', 'allowlist']);
        const evalResult = evaluateUrl(activeTab.url, {
          customBlocked: settings.custom_blocked_domains || [],
          allowlist: settings.allowlist || []
        });

        if (evalResult.isDistraction) {
          console.log(`[BlockerManager] onFocusChanged blocking window tab #${activeTab.id} (${activeTab.url})`);
          redirectTabToBlocked(activeTab.id, activeTab.url, evalResult.label);
        }
      } catch (err) {
        // Window may have closed
      }
    });
  }

  // 8. Storage change listener for immediate rule reconciliation
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      const keysToSync = [
        'hardcore_mode_enabled',
        'last_solve_date',
        'my_leetcode_username',
        'user_timezone',
        'own_profile',
        'custom_blocked_domains',
        'allowlist'
      ];

      const hasRelevantChange = keysToSync.some(k => changes[k]);
      if (hasRelevantChange) {
        syncBlockerRules().catch(err => {
          console.error('[BlockerManager] Storage change sync error:', err);
        });
      }
    });
  }

  console.log('🛡️ [BlockerManager] Multi-layer network blocker initialized');
}
