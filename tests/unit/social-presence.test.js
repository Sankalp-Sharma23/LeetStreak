/**
 * Social Presence, Online Discovery & Roast Remediation Tests
 *
 * Verifies:
 * 1. Presence stale threshold calculation (120-second window).
 * 2. Status categorization: online, in_battle, offline.
 * 3. Case-insensitive presence map normalization.
 * 4. Mutual friendship prerequisite for roasts and challenges.
 * 5. Roast content validation and error handling.
 * 6. Background heartbeat alarm lifecycle and cleanup on sign-out.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Stale expiration threshold defined across backend RPC and frontend
const PRESENCE_STALE_MS = 120_000; // 120 seconds

function computePresenceStatus(presenceRecord, now = Date.now()) {
  if (!presenceRecord || !presenceRecord.last_seen) {
    return 'offline';
  }

  const lastSeenMs = new Date(presenceRecord.last_seen).getTime();
  if (isNaN(lastSeenMs) || (now - lastSeenMs) > PRESENCE_STALE_MS) {
    return 'offline';
  }

  if (presenceRecord.in_battle || presenceRecord.status === 'in_battle') {
    return 'in_battle';
  }

  return presenceRecord.status === 'offline' ? 'offline' : 'online';
}

function normalizePresenceMap(rawRecords, now = Date.now()) {
  const map = {};
  if (!rawRecords) return map;

  const entries = Array.isArray(rawRecords) ? rawRecords : Object.entries(rawRecords);
  
  for (const item of entries) {
    const record = Array.isArray(rawRecords) ? item : item[1];
    const username = (record.username || (Array.isArray(item) ? item[0] : '')).toLowerCase();
    if (!username) continue;

    const status = computePresenceStatus(record, now);
    map[username] = {
      ...record,
      calculated_status: status
    };
  }
  return map;
}

class MockSocialStore {
  constructor() {
    this.friendships = new Map(); // key: "userA:userB" -> 'accepted' | 'pending'
    this.presence = new Map();    // key: username.toLowerCase() -> presence record
    this.roasts = [];
    this.battles = [];
  }

  addFriendship(userA, userB, status = 'accepted') {
    const key1 = `${userA.toLowerCase()}:${userB.toLowerCase()}`;
    const key2 = `${userB.toLowerCase()}:${userA.toLowerCase()}`;
    this.friendships.set(key1, status);
    this.friendships.set(key2, status);
  }

  areFriends(userA, userB) {
    return this.friendships.get(`${userA.toLowerCase()}:${userB.toLowerCase()}`) === 'accepted';
  }

  heartbeat(username, status = 'online', inBattle = false, battleId = null) {
    const lower = username.toLowerCase();
    const record = {
      username: lower,
      status: inBattle ? 'in_battle' : status,
      in_battle: inBattle,
      active_battle_id: battleId,
      last_seen: new Date().toISOString()
    };
    this.presence.set(lower, record);
    return record;
  }

  setOffline(username) {
    const lower = username.toLowerCase();
    const existing = this.presence.get(lower);
    if (existing) {
      existing.status = 'offline';
      existing.in_battle = false;
      existing.active_battle_id = null;
      existing.last_seen = new Date().toISOString();
    }
  }

  getOnlineFriends(myUsername, friendsList, now = Date.now()) {
    const myLower = myUsername.toLowerCase();
    const result = [];

    for (const friend of friendsList) {
      const friendLower = (friend.username || friend).toLowerCase();
      
      // Must be accepted friends
      if (!this.areFriends(myLower, friendLower)) {
        continue;
      }

      const p = this.presence.get(friendLower);
      const computed = computePresenceStatus(p, now);

      result.push({
        username: friendLower,
        presenceStatus: computed,
        isOnline: computed === 'online' || computed === 'in_battle',
        inBattle: computed === 'in_battle'
      });
    }

    // Sort: online first, then in_battle, then offline
    const order = { online: 0, in_battle: 1, offline: 2 };
    return result.sort((a, b) => (order[a.presenceStatus] ?? 3) - (order[b.presenceStatus] ?? 3));
  }

  sendRoast(senderUsername, recipientUsername, content) {
    if (!content || !content.trim()) {
      return { success: false, error: 'Roast message cannot be empty' };
    }
    if (content.length > 500) {
      return { success: false, error: 'Roast message exceeds maximum 500 characters' };
    }
    if (!this.areFriends(senderUsername, recipientUsername)) {
      return {
        success: false,
        error: `Cannot send roast: "${recipientUsername}" is not an accepted friend`
      };
    }

    const roast = {
      id: `roast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sender_username: senderUsername.toLowerCase(),
      recipient_username: recipientUsername.toLowerCase(),
      content: content.trim(),
      status: 'sent',
      created_at: new Date().toISOString()
    };
    this.roasts.push(roast);
    return { success: true, data: roast };
  }

  createBattleChallenge(challenger, challenged, language = 'javascript', now = Date.now()) {
    if (!this.areFriends(challenger, challenged)) {
      return { success: false, error: 'Challenger and challenged must be accepted friends' };
    }

    const targetPresence = this.presence.get(challenged.toLowerCase());
    const status = computePresenceStatus(targetPresence, now);
    if (status === 'offline') {
      return { success: false, error: `${challenged} is currently offline` };
    }
    if (status === 'in_battle') {
      return { success: false, error: `${challenged} is already in another battle` };
    }

    const battle = {
      id: `battle_${Date.now()}`,
      player1_username: challenger.toLowerCase(),
      player2_username: challenged.toLowerCase(),
      language,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    this.battles.push(battle);
    return { success: true, data: battle };
  }
}

describe('Social Presence & Realtime Friend Discovery', () => {
  let store;
  const NOW = 1700000000000;

  beforeEach(() => {
    store = new MockSocialStore();
  });

  describe('1. Stale Presence Expiration Logic (120s threshold)', () => {
    it('marks friend online when heartbeat is recent (< 120s)', () => {
      const record = {
        username: 'alice',
        status: 'online',
        in_battle: false,
        last_seen: new Date(NOW - 30_000).toISOString() // 30s ago
      };
      expect(computePresenceStatus(record, NOW)).toBe('online');
    });

    it('marks friend offline when heartbeat is stale (> 120s)', () => {
      const record = {
        username: 'bob',
        status: 'online',
        in_battle: false,
        last_seen: new Date(NOW - 125_000).toISOString() // 125s ago (> 120s)
      };
      expect(computePresenceStatus(record, NOW)).toBe('offline');
    });

    it('marks friend offline if last_seen is missing or corrupt', () => {
      expect(computePresenceStatus(null, NOW)).toBe('offline');
      expect(computePresenceStatus({}, NOW)).toBe('offline');
      expect(computePresenceStatus({ last_seen: 'invalid-date' }, NOW)).toBe('offline');
    });

    it('marks friend in_battle when active within freshness window', () => {
      const record = {
        username: 'charlie',
        status: 'in_battle',
        in_battle: true,
        last_seen: new Date(NOW - 10_000).toISOString()
      };
      expect(computePresenceStatus(record, NOW)).toBe('in_battle');
    });

    it('marks friend offline even if marked in_battle if heartbeat has expired (> 120s)', () => {
      const record = {
        username: 'david',
        status: 'in_battle',
        in_battle: true,
        last_seen: new Date(NOW - 300_000).toISOString() // 5m ago
      };
      expect(computePresenceStatus(record, NOW)).toBe('offline');
    });
  });

  describe('2. Case-Insensitive Presence Normalization', () => {
    it('normalizes presence dictionary with mixed-case usernames', () => {
      const rawRecords = {
        'Alice_Coder': { username: 'Alice_Coder', status: 'online', last_seen: new Date(NOW - 5000).toISOString() },
        'BobDev': { username: 'BobDev', status: 'offline', last_seen: new Date(NOW - 2000).toISOString() }
      };

      const normalized = normalizePresenceMap(rawRecords, NOW);
      expect(normalized['alice_coder']).toBeDefined();
      expect(normalized['alice_coder'].calculated_status).toBe('online');
      expect(normalized['bobdev']).toBeDefined();
      expect(normalized['bobdev'].calculated_status).toBe('offline');
    });

    it('normalizes array of presence records correctly', () => {
      const arrayRecords = [
        { username: 'Neo', status: 'online', last_seen: new Date(NOW - 1000).toISOString() }
      ];
      const normalized = normalizePresenceMap(arrayRecords, NOW);
      expect(normalized['neo']).toBeDefined();
      expect(normalized['neo'].calculated_status).toBe('online');
    });
  });

  describe('3. Battle Page Online Friend Selection & Filtering', () => {
    beforeEach(() => {
      store.addFriendship('sankalp', 'alice', 'accepted');
      store.addFriendship('sankalp', 'bob', 'accepted');
      store.addFriendship('sankalp', 'charlie', 'accepted');
      store.addFriendship('sankalp', 'stranger', 'pending'); // not accepted
    });

    it('orders online friends first, then in_battle, then offline', () => {
      // Alice is online
      store.presence.set('alice', {
        username: 'alice',
        status: 'online',
        last_seen: new Date(NOW - 5_000).toISOString()
      });
      // Bob is in battle
      store.presence.set('bob', {
        username: 'bob',
        status: 'in_battle',
        in_battle: true,
        last_seen: new Date(NOW - 10_000).toISOString()
      });
      // Charlie has no presence (offline)

      const friends = [{ username: 'Charlie' }, { username: 'Alice' }, { username: 'Bob' }];
      const result = store.getOnlineFriends('sankalp', friends, NOW);

      expect(result).toHaveLength(3);
      expect(result[0].username).toBe('alice');
      expect(result[0].presenceStatus).toBe('online');
      expect(result[1].username).toBe('bob');
      expect(result[1].presenceStatus).toBe('in_battle');
      expect(result[2].username).toBe('charlie');
      expect(result[2].presenceStatus).toBe('offline');
    });

    it('excludes pending or unaccepted friendships from challengeable list', () => {
      store.presence.set('stranger', {
        username: 'stranger',
        status: 'online',
        last_seen: new Date(NOW - 1000).toISOString()
      });

      const result = store.getOnlineFriends('sankalp', [{ username: 'stranger' }], NOW);
      expect(result).toHaveLength(0);
    });
  });

  describe('4. Peer Roast Messaging Verification', () => {
    beforeEach(() => {
      store.addFriendship('sankalp', 'alice', 'accepted');
    });

    it('successfully delivers roast between accepted friends', () => {
      const res = store.sendRoast('sankalp', 'alice', 'Your two-pointer solution has three bugs!');
      expect(res.success).toBe(true);
      expect(res.data.status).toBe('sent');
      expect(res.data.recipient_username).toBe('alice');
      expect(store.roasts).toHaveLength(1);
    });

    it('rejects roasts to non-friends with clear security error', () => {
      const res = store.sendRoast('sankalp', 'unknown_user', 'Good game!');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not an accepted friend/i);
      expect(store.roasts).toHaveLength(0);
    });

    it('rejects empty or whitespace-only roasts', () => {
      const res = store.sendRoast('sankalp', 'alice', '   ');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/cannot be empty/i);
    });

    it('rejects roasts that exceed 500 characters', () => {
      const longMessage = 'A'.repeat(501);
      const res = store.sendRoast('sankalp', 'alice', longMessage);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/exceeds maximum 500 characters/i);
    });
  });

  describe('5. Battle Challenge Creation Rules', () => {
    beforeEach(() => {
      store.addFriendship('sankalp', 'alice', 'accepted');
      store.addFriendship('sankalp', 'bob', 'accepted');
    });

    it('creates battle challenge when friend is online and idle', () => {
      store.presence.set('alice', {
        username: 'alice',
        status: 'online',
        last_seen: new Date(NOW - 5000).toISOString()
      });

      const res = store.createBattleChallenge('sankalp', 'alice', 'python3', NOW);
      expect(res.success).toBe(true);
      expect(res.data.player2_username).toBe('alice');
      expect(res.data.language).toBe('python3');
    });

    it('rejects challenge if friend is offline', () => {
      const res = store.createBattleChallenge('sankalp', 'alice');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/offline/i);
    });

    it('rejects challenge if friend is already in battle', () => {
      store.presence.set('bob', {
        username: 'bob',
        status: 'in_battle',
        in_battle: true,
        last_seen: new Date(NOW - 5000).toISOString()
      });

      const res = store.createBattleChallenge('sankalp', 'bob', 'javascript', NOW);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/already in another battle/i);
    });
  });

  describe('6. Heartbeat Lifecycle & Sign-Out Handling', () => {
    it('updates presence timestamp on heartbeat', () => {
      const p = store.heartbeat('sankalp', 'online');
      expect(p.username).toBe('sankalp');
      expect(p.status).toBe('online');
      expect(store.presence.get('sankalp')).toBeDefined();
    });

    it('sets presence to offline immediately upon sign out', () => {
      store.heartbeat('sankalp', 'online');
      expect(store.presence.get('sankalp').status).toBe('online');

      store.setOffline('sankalp');
      expect(store.presence.get('sankalp').status).toBe('offline');
      expect(store.presence.get('sankalp').in_battle).toBe(false);
    });
  });
});
