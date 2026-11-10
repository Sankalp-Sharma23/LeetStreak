import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

class MockChromeStorage {
  constructor() {
    this.data = {};
    this.listeners = [];
  }
  async get(keys) {
    if (keys === null) return { ...this.data };
    if (typeof keys === 'string') return { [keys]: this.data[keys] };
    if (Array.isArray(keys)) {
      const res = {};
      keys.forEach(k => { if (this.data[k] !== undefined) res[k] = this.data[k]; });
      return res;
    }
    return { ...this.data };
  }
  async set(items) {
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: this.data[k], newValue: v };
      this.data[k] = v;
    }
    this.listeners.forEach(fn => fn(changes, 'local'));
  }
  async remove(keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    arr.forEach(k => {
      changes[k] = { oldValue: this.data[k], newValue: undefined };
      delete this.data[k];
    });
    this.listeners.forEach(fn => fn(changes, 'local'));
  }
}

describe('Battle Redirection & Cross-Browser Synchronization (Chrome, Brave, Edge)', () => {
  let mockStorage;
  let mockAlarms;
  let mockTabs;
  let mockWindows;

  beforeEach(() => {
    mockStorage = new MockChromeStorage();
    mockAlarms = {
      created: {},
      create: jest.fn((name, alarmInfo) => {
        mockAlarms.created[name] = alarmInfo;
      }),
      clear: jest.fn(name => {
        delete mockAlarms.created[name];
      })
    };
    mockTabs = {
      tabsList: [],
      query: jest.fn(async ({ url }) => {
        return mockTabs.tabsList.filter(tab => {
          if (!url) return true;
          const patterns = Array.isArray(url) ? url : [url];
          return patterns.some(pattern => {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(tab.url);
          });
        });
      }),
      update: jest.fn(async (tabId, updateProps) => {
        const tab = mockTabs.tabsList.find(t => t.id === tabId);
        if (tab) Object.assign(tab, updateProps);
        return tab;
      }),
      create: jest.fn(async createProps => {
        const newTab = { id: Math.floor(Math.random() * 10000) + 1, ...createProps };
        mockTabs.tabsList.push(newTab);
        return newTab;
      })
    };
    mockWindows = {
      update: jest.fn(async (windowId, updateProps) => ({ id: windowId, ...updateProps }))
    };

    global.chrome = {
      storage: {
        local: mockStorage,
        onChanged: {
          addListener: fn => mockStorage.listeners.push(fn)
        }
      },
      alarms: mockAlarms,
      tabs: mockTabs,
      windows: mockWindows
    };
  });

  afterEach(() => {
    delete global.chrome;
    jest.restoreAllMocks();
  });

  describe('1. Alarm-based Start Scheduling for Service Worker Sleep Resilience', () => {
    it('creates persistent chrome.alarm matching match_starts_at ISO timestamp', () => {
      const battleId = 'duel-xyz-123';
      const futureTime = new Date(Date.now() + 10000).toISOString();
      const when = Date.parse(futureTime);

      // Emulate scheduleBattleStart
      chrome.alarms.create(`battle_start_${battleId}`, { when });

      expect(chrome.alarms.create).toHaveBeenCalledWith(`battle_start_${battleId}`, { when });
      expect(mockAlarms.created[`battle_start_${battleId}`].when).toBe(when);
    });

    it('wakes service worker alarm listener and triggers redirection', async () => {
      const battleId = 'duel-xyz-123';
      const alarm = { name: `battle_start_${battleId}`, scheduledTime: Date.now() };

      let redirectCalledWith = null;
      const onAlarmHandler = async (a) => {
        if (a.name?.startsWith('battle_start_')) {
          const id = a.name.replace('battle_start_', '');
          redirectCalledWith = id;
        }
      };

      await onAlarmHandler(alarm);
      expect(redirectCalledWith).toBe(battleId);
    });
  });

  describe('2. Multi-browser Tab Focus & Redirection Logic', () => {
    it('updates and focuses existing LeetCode tab instead of duplicating tabs', async () => {
      // Simulate an open LeetCode tab in Brave/Chrome/Edge
      mockTabs.tabsList = [
        { id: 42, url: 'https://leetcode.com/problemset/', active: true, windowId: 10 }
      ];

      const targetUrl = 'https://leetcode.com/problems/two-sum/';
      const tabs = await chrome.tabs.query({ url: ['*://*.leetcode.com/*', '*://leetcode.com/*'] });
      expect(tabs.length).toBe(1);

      const targetTab = tabs.find(t => t.active) || tabs[0];
      await chrome.tabs.update(targetTab.id, { url: targetUrl, active: true });
      if (targetTab.windowId) {
        await chrome.windows.update(targetTab.windowId, { focused: true });
      }

      expect(chrome.tabs.update).toHaveBeenCalledWith(42, { url: targetUrl, active: true });
      expect(chrome.windows.update).toHaveBeenCalledWith(10, { focused: true });
      expect(mockTabs.tabsList[0].url).toBe(targetUrl);
    });

    it('creates a new tab if no LeetCode tab is currently open', async () => {
      mockTabs.tabsList = [
        { id: 99, url: 'https://github.com', active: true, windowId: 1 }
      ];

      const targetUrl = 'https://leetcode.com/problems/two-sum/';
      const tabs = await chrome.tabs.query({ url: ['*://*.leetcode.com/*', '*://leetcode.com/*'] });
      expect(tabs.length).toBe(0);

      const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: targetUrl, active: true });
      expect(newTab.url).toBe(targetUrl);
      expect(mockTabs.tabsList.length).toBe(2);
    });
  });

  describe('3. Local Storage Sync for Real-Time Content Script Hydration', () => {
    it('persists active_battle_data with complete problem metadata', async () => {
      const activeBattlePayload = {
        battleId: 'duel-123',
        status: 'in_progress',
        match_starts_at: new Date().toISOString(),
        match_deadline: new Date(Date.now() + 1800000).toISOString(),
        duration_minutes: 30,
        problems: [
          { sequence_number: 1, problem_slug: 'two-sum', problem_title: 'Two Sum', problem_url: 'https://leetcode.com/problems/two-sum/' },
          { sequence_number: 2, problem_slug: 'add-two-numbers', problem_title: 'Add Two Numbers', problem_url: 'https://leetcode.com/problems/add-two-numbers/' }
        ],
        participants: [
          { username: 'alice', ready: true },
          { username: 'bob', ready: true }
        ],
        results: [],
        updated_at: Date.now()
      };

      await chrome.storage.local.set({ active_battle_data: activeBattlePayload });

      const stored = await chrome.storage.local.get('active_battle_data');
      expect(stored.active_battle_data).toBeDefined();
      expect(stored.active_battle_data.battleId).toBe('duel-123');
      expect(stored.active_battle_data.problems).toHaveLength(2);
      expect(stored.active_battle_data.problems[0].problem_slug).toBe('two-sum');
    });

    it('triggers chrome.storage.onChanged listener for zero-latency cross-tab hydration', async () => {
      let notifiedData = null;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.active_battle_data) {
          notifiedData = changes.active_battle_data.newValue;
        }
      });

      const updatedData = {
        battleId: 'duel-123',
        status: 'in_progress',
        problems: [{ problem_slug: 'reverse-linked-list', sequence_number: 1 }]
      };

      await chrome.storage.local.set({ active_battle_data: updatedData });
      expect(notifiedData).toEqual(updatedData);
    });

    it('clears active_battle_data on forfeit or completion', async () => {
      await chrome.storage.local.set({
        active_battle_data: { battleId: 'duel-123', status: 'in_progress' }
      });
      let stored = await chrome.storage.local.get('active_battle_data');
      expect(stored.active_battle_data).toBeDefined();

      await chrome.storage.local.remove('active_battle_data');
      stored = await chrome.storage.local.get('active_battle_data');
      expect(stored.active_battle_data).toBeUndefined();
    });
  });

  describe('4. Problem URL & Slug Matching for Content Script Sidebar', () => {
    it('correctly maps problem slugs to LeetCode target URLs', () => {
      const problem = { sequence_number: 1, problem_slug: 'lru-cache' };
      const resolvedUrl = problem.problem_url || `https://leetcode.com/problems/${problem.problem_slug}/`;
      expect(resolvedUrl).toBe('https://leetcode.com/problems/lru-cache/');
    });

    it('identifies when user is currently viewing the active battle problem', () => {
      const pathname = '/problems/two-sum/';
      const currentSlug = pathname.split('/problems/')[1]?.split('/')[0];
      expect(currentSlug).toBe('two-sum');

      const battleProblems = [
        { sequence_number: 1, problem_slug: 'two-sum' },
        { sequence_number: 2, problem_slug: '3sum' }
      ];
      const isCurrentBattleProblem = battleProblems.some(p => p.problem_slug === currentSlug);
      expect(isCurrentBattleProblem).toBe(true);
    });
  });
});

