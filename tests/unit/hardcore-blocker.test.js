import { describe, test, expect, jest } from '@jest/globals';
import {
  evaluateUrl,
  generateDNRRules,
  isBlockerActive,
  sanitizeReturnUrl,
  sweepOpenTabs,
  DEFAULT_BLOCKED_DOMAINS,
  PATH_SPECIFIC_BLOCK_RULES,
  EDUCATIONAL_EXCEPTIONS
} from '../../src/background/blocker-manager.js';

describe('Hardcore Mode Blocker - Network & Rule Logic', () => {
  test('does not re-lock after an accepted solve was recorded earlier that local day', async () => {
    const originalChrome = global.chrome;
    jest.useFakeTimers().setSystemTime(new Date('2026-11-09T18:31:00.000Z')); // 12:01 a.m. in India
    const local = {
      get: jest.fn().mockResolvedValue({
        hardcore_mode_enabled: true,
        my_leetcode_username: 'Coder',
        user_timezone: 'Asia/Kolkata',
        last_solve_date: '2026-11-10',
        own_profile: {
          stats: { streak: 5 },
          allAcceptedSubmissions: [],
          submissionCalendar: '{}'
        }
      }),
      set: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue()
    };
    global.chrome = { storage: { local } };

    try {
      const state = await isBlockerActive();
      expect(state.active).toBe(false);
      expect(state.reason).toBe('SOLVED_TODAY_LOCAL_MARKER');
      expect(local.remove).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      if (originalChrome === undefined) delete global.chrome;
      else global.chrome = originalChrome;
    }
  });

  test('does not unlock from submission-calendar activity when accepted history is unavailable', async () => {
    const originalChrome = global.chrome;
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const today = Math.floor(Date.UTC(2026, 10, 10, 0, 0, 0) / 1000);
    const local = {
      get: jest.fn().mockResolvedValue({
        hardcore_mode_enabled: true,
        my_leetcode_username: 'Coder',
        user_timezone: 'UTC',
        own_profile: {
          stats: { streak: 2 },
          acceptedSubmissionsAvailable: false,
          allAcceptedSubmissions: [],
          submissionCalendar: { [today]: 3 }
        }
      }),
      set: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue()
    };
    global.chrome = { storage: { local } };

    try {
      const state = await isBlockerActive();
      expect(state.active).toBe(true);
      expect(state.reason).toBe('UNSOLVED_TODAY');
      expect(local.set).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      if (originalChrome === undefined) delete global.chrome;
      else global.chrome = originalChrome;
    }
  });

  describe('1. URL Evaluation & Distraction Detection', () => {
    test('identifies default blocked domains (Instagram, TikTok, Reddit, Netflix, WhatsApp)', () => {
      expect(evaluateUrl('https://instagram.com/p/123').isDistraction).toBe(true);
      expect(evaluateUrl('https://www.tiktok.com/@creator').isDistraction).toBe(true);
      expect(evaluateUrl('https://reddit.com/r/all').isDistraction).toBe(true);
      expect(evaluateUrl('https://www.netflix.com/browse').isDistraction).toBe(true);
      expect(evaluateUrl('https://twitch.tv/streamer').isDistraction).toBe(true);
      expect(evaluateUrl('https://x.com/home').isDistraction).toBe(true);
      // Chat & messaging platforms must be strictly blocked
      expect(evaluateUrl('https://web.whatsapp.com/').isDistraction).toBe(true);
      expect(evaluateUrl('https://whatsapp.com/').isDistraction).toBe(true);
      expect(evaluateUrl('https://web.telegram.org/a/').isDistraction).toBe(true);
      expect(evaluateUrl('https://discord.com/channels/@me').isDistraction).toBe(true);
      expect(evaluateUrl('https://www.messenger.com/').isDistraction).toBe(true);
    });

    test('strictly permits LeetCode across all paths and subdomains', () => {
      expect(evaluateUrl('https://leetcode.com/problemset/all/').isDistraction).toBe(false);
      expect(evaluateUrl('https://leetcode.com/problems/two-sum/').isDistraction).toBe(false);
      expect(evaluateUrl('https://leetcode.com/contest/').isDistraction).toBe(false);
    });

    test('blocks YouTube Shorts but allows educational YouTube tutorials', () => {
      // YouTube Shorts should be blocked
      const shortsRes = evaluateUrl('https://www.youtube.com/shorts/abcd123');
      expect(shortsRes.isDistraction).toBe(true);
      expect(shortsRes.reason).toBe('PATH_DISTRACTION');

      // YouTube Explore should be blocked
      const exploreRes = evaluateUrl('https://youtube.com/feed/explore');
      expect(exploreRes.isDistraction).toBe(true);

      // Normal YouTube video watching MUST be allowed
      const watchRes = evaluateUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(watchRes.isDistraction).toBe(false);
      expect(watchRes.reason).toBe('EDUCATIONAL_EXCEPTION');

      // Playlists and channels must be allowed
      expect(evaluateUrl('https://www.youtube.com/playlist?list=PL123').isDistraction).toBe(false);
      expect(evaluateUrl('https://www.youtube.com/@FreeCodeCamp').isDistraction).toBe(false);
    });

    test('blocks LinkedIn Feed but allows LinkedIn Jobs and Messaging', () => {
      // Feed is distracting
      const feedRes = evaluateUrl('https://www.linkedin.com/feed/');
      expect(feedRes.isDistraction).toBe(true);
      expect(feedRes.reason).toBe('PATH_DISTRACTION');

      // Jobs and Messaging are permitted
      expect(evaluateUrl('https://www.linkedin.com/jobs/').isDistraction).toBe(false);
      expect(evaluateUrl('https://www.linkedin.com/messaging/').isDistraction).toBe(false);
      expect(evaluateUrl('https://www.linkedin.com/in/recruiter').isDistraction).toBe(false);
    });

    test('honors user-configured custom allowlist', () => {
      const customAllow = ['reddit.com/r/learnprogramming', 'chess.com'];
      const allowedReddit = evaluateUrl('https://reddit.com/r/learnprogramming', { allowlist: customAllow });
      expect(allowedReddit.isDistraction).toBe(false);
      expect(allowedReddit.reason).toBe('USER_ALLOWLIST');

      const allowedChess = evaluateUrl('https://chess.com/play/computer', { allowlist: customAllow });
      expect(allowedChess.isDistraction).toBe(false);
      expect(allowedChess.reason).toBe('USER_ALLOWLIST');
    });

    test('honors user-configured custom blocked domains', () => {
      const customBlocked = ['news.ycombinator.com', 'buzzfeed.com'];
      const blockedHn = evaluateUrl('https://news.ycombinator.com/', { customBlocked });
      expect(blockedHn.isDistraction).toBe(true);
      expect(blockedHn.reason).toBe('CUSTOM_BLOCKED_DOMAIN');
    });

    test('safely ignores non-HTTP protocols and invalid inputs', () => {
      expect(evaluateUrl('chrome-extension://some-id/popup.html').isDistraction).toBe(false);
      expect(evaluateUrl('chrome://settings').isDistraction).toBe(false);
      expect(evaluateUrl(null).isDistraction).toBe(false);
      expect(evaluateUrl('not-a-valid-url').isDistraction).toBe(false);
    });
  });

  describe('2. DeclarativeNetRequest Dynamic Rules Generation', () => {
    test('generates valid DNR rules with correct priorities and resourceTypes', () => {
      const rules = generateDNRRules({
        customBlocked: ['buzzfeed.com'],
        allowlist: ['reddit.com/r/cscareerquestions']
      });

      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(10);

      // Verify rule IDs are strictly unique positive integers
      const ids = rules.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
      expect(ids.every(id => Number.isInteger(id) && id > 0)).toBe(true);

      // Verify every rule restricts to main_frame
      expect(rules.every(r => r.condition.resourceTypes.includes('main_frame'))).toBe(true);

      // 1. Critical System Allow: LeetCode has priority 10
      const leetcodeRule = rules.find(r => r.condition.requestDomains?.includes('leetcode.com'));
      expect(leetcodeRule).toBeDefined();
      expect(leetcodeRule.priority).toBe(10);
      expect(leetcodeRule.action.type).toBe('allow');

      // 2. User allowlist rules have priority 5
      const customAllowRule = rules.find(r => r.priority === 5);
      expect(customAllowRule).toBeDefined();
      expect(customAllowRule.action.type).toBe('allow');

      // 3. Educational Exceptions have priority 3
      const youtubeWatchRule = rules.find(r => r.condition.requestDomains?.includes('youtube.com') && r.condition.urlFilter?.includes('watch'));
      expect(youtubeWatchRule).toBeDefined();
      expect(youtubeWatchRule.priority).toBe(3);
      expect(youtubeWatchRule.action.type).toBe('allow');

      // 4. Path-specific blocks have priority 2
      const youtubeShortsRule = rules.find(r => r.condition.requestDomains?.includes('youtube.com') && r.condition.urlFilter?.includes('shorts'));
      expect(youtubeShortsRule).toBeDefined();
      expect(youtubeShortsRule.priority).toBe(2);
      expect(youtubeShortsRule.action.type).toBe('redirect');
      expect(youtubeShortsRule.action.redirect.extensionPath).toBe('/blocked.html');

      // 5. Whole domain blocks have priority 1 (including WhatsApp)
      const instaRule = rules.find(r => r.condition.requestDomains?.includes('instagram.com'));
      expect(instaRule).toBeDefined();
      expect(instaRule.priority).toBe(1);
      expect(instaRule.action.type).toBe('redirect');
      expect(instaRule.action.redirect.extensionPath).toBe('/blocked.html');

      const whatsappRule = rules.find(r => r.condition.requestDomains?.includes('whatsapp.com'));
      expect(whatsappRule).toBeDefined();
      expect(whatsappRule.priority).toBe(1);
      expect(whatsappRule.action.type).toBe('redirect');
      expect(whatsappRule.action.redirect.extensionPath).toBe('/blocked.html');
    });
  });

  describe('3. Return URL Sanitization & Security', () => {
    test('sanitizes valid HTTP and HTTPS target URLs', () => {
      expect(sanitizeReturnUrl('https://instagram.com/reels')).toBe('https://instagram.com/reels');
      expect(sanitizeReturnUrl('http://reddit.com/r/all')).toBe('http://reddit.com/r/all');
    });

    test('rejects chrome:, chrome-extension:, file:, and javascript: schemes', () => {
      expect(sanitizeReturnUrl('chrome://settings')).toBeNull();
      expect(sanitizeReturnUrl('chrome-extension://abcdef/blocked.html')).toBeNull();
      expect(sanitizeReturnUrl('file:///C:/passwords.txt')).toBeNull();
      expect(sanitizeReturnUrl('javascript:alert(1)')).toBeNull();
    });

    test('prevents redirect loops pointing back to blocked.html', () => {
      expect(sanitizeReturnUrl('https://my-site.com/blocked.html')).toBeNull();
    });

    test('rejects localhost and loopback IP addresses', () => {
      expect(sanitizeReturnUrl('http://localhost:3000')).toBeNull();
      expect(sanitizeReturnUrl('http://127.0.0.1:8080/admin')).toBeNull();
    });
  });

  describe('4. Active Tab Sweep (Pre-Existing Tabs)', () => {
    test('sweeps and redirects all already-open distracting tabs when locked', async () => {
      const updatedTabs = [];
      global.chrome = {
        storage: {
          local: {
            get: jest.fn().mockImplementation((keys) => {
              if (keys.includes('hardcore_mode_enabled')) {
                return Promise.resolve({
                  hardcore_mode_enabled: true,
                  my_leetcode_username: 'Coder',
                  own_profile: {
                    stats: { streak: 5 },
                    allAcceptedSubmissions: [],
                    submissionCalendar: '{}'
                  }
                });
              }
              return Promise.resolve({});
            }),
            set: jest.fn().mockResolvedValue(),
            remove: jest.fn().mockResolvedValue()
          }
        },
        tabs: {
          query: jest.fn().mockResolvedValue([
            { id: 1, url: 'https://web.whatsapp.com/' },
            { id: 2, url: 'https://leetcode.com/problems/two-sum/' },
            { id: 3, url: 'https://instagram.com/explore' },
            { id: 4, url: 'chrome-extension://xyz/blocked.html' }
          ]),
          update: jest.fn().mockImplementation((tabId, updateProps, cb) => {
            updatedTabs.push({ tabId, ...updateProps });
            if (cb) cb();
          })
        },
        runtime: {
          getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`)
        }
      };

      const result = await sweepOpenTabs();

      expect(result.sweptCount).toBe(2);
      expect(updatedTabs.length).toBe(2);
      expect(updatedTabs[0].tabId).toBe(1);
      expect(updatedTabs[0].url).toContain('blocked.html');
      expect(updatedTabs[0].url).toContain('web.whatsapp.com');
      expect(updatedTabs[1].tabId).toBe(3);
      expect(updatedTabs[1].url).toContain('blocked.html');
      expect(updatedTabs[1].url).toContain('instagram.com');
    });
  });
});

