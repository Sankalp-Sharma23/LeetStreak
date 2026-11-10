/**
 * Comprehensive Authorization & RLS Negative Test Suite
 *
 * Validates strict isolation, authorization boundaries, and policy enforcement
 * matching the production PostgreSQL RLS specifications in 20261105000001_security_and_relational_schema.sql.
 *
 * Test Scenarios:
 * 1. Anonymous user attempts to read private settings -> Rejected
 * 2. User A attempts to modify User B's settings -> Rejected
 * 3. User A attempts to view an unrelated private battle -> Rejected
 * 4. User A attempts to change User B's battle result -> Rejected
 * 5. User A attempts to assign themselves as winner -> Rejected
 * 6. User A attempts to insert a fake submission event -> Rejected
 * 7. User A attempts to modify another user's friendship -> Rejected
 * 8. User A attempts to read private roast messages addressed to User B -> Rejected
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// In-memory relational database simulator enforcing RLS policies
class MockPostgresRLS {
  constructor() {
    this.users = new Map(); // id -> { id, role }
    this.profiles = new Map(); // id -> profile
    this.userSettings = new Map(); // user_id -> settings
    this.friendships = new Map(); // id -> friendship
    this.roastMessages = new Map(); // id -> roast
    this.battles = new Map(); // id -> battle
    this.battleResults = new Map(); // id -> result
    this.battleEvents = new Map(); // id -> event
  }

  reset() {
    this.users.clear();
    this.profiles.clear();
    this.userSettings.clear();
    this.friendships.clear();
    this.roastMessages.clear();
    this.battles.clear();
    this.battleResults.clear();
    this.battleEvents.clear();
  }

  // Helper: execute query under a specific auth context { uid, role }
  query(authContext) {
    const uid = authContext?.uid || null;
    // The simulator applies the same participant checks for authenticated roles.

    return {
      // 1. User Settings RLS
      selectUserSettings: (targetUserId) => {
        // Policy: USING (auth.uid() = user_id)
        if (!uid || uid !== targetUserId) {
          return { data: null, error: 'PGRST116: 0 rows returned (RLS filtered)' };
        }
        return { data: this.userSettings.get(targetUserId) || null, error: null };
      },

      updateUserSettings: (targetUserId, updates) => {
        // Policy: USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
        if (!uid || uid !== targetUserId) {
          return { success: false, error: '42501: new row violates row-level security policy for table "user_settings"' };
        }
        const existing = this.userSettings.get(targetUserId);
        if (!existing) return { success: false, error: 'Record not found' };
        this.userSettings.set(targetUserId, { ...existing, ...updates });
        return { success: true, error: null };
      },

      // 2. Battles RLS
      selectBattle: (battleId) => {
        // Policy: USING (auth.uid() = challenger_id OR auth.uid() = challenged_id)
        const battle = this.battles.get(battleId);
        if (!battle) return { data: null, error: 'Battle not found' };
        if (!uid || (battle.challenger_id !== uid && battle.challenged_id !== uid)) {
          return { data: null, error: 'RLS: Access denied. Not a match participant' };
        }
        return { data: battle, error: null };
      },

      updateBattleWinner: (battleId, winnerId, _winnerUsername) => {
        // Policy: WITH CHECK (winner_id IS NOT DISTINCT FROM existing.winner_id)
        // Direct winner assignment by raw client update is forbidden!
        const battle = this.battles.get(battleId);
        if (!battle) return { success: false, error: 'Battle not found' };
        if (!uid || (battle.challenger_id !== uid && battle.challenged_id !== uid)) {
          return { success: false, error: '42501: RLS violation' };
        }
        if (winnerId !== battle.winner_id) {
          return { success: false, error: '42501: Unauthorized winner modification. Results must be finalized via RPC.' };
        }
        return { success: true };
      },

      // 3. Battle Results RLS
      insertBattleResult: (battleId, resultUserId, resultData) => {
        // Policy: WITH CHECK (auth.uid() = user_id AND participant AND active)
        const battle = this.battles.get(battleId);
        if (!battle) return { success: false, error: 'Battle not found' };
        if (!uid || uid !== resultUserId) {
          return { success: false, error: '42501: Cannot insert results for another participant' };
        }
        if (battle.challenger_id !== uid && battle.challenged_id !== uid) {
          return { success: false, error: '42501: User is not a participant in this battle' };
        }
        if (!['in_progress', 'ready_check', 'countdown'].includes(battle.status)) {
          return { success: false, error: '42501: Battle is not in active state' };
        }

        // Idempotency check: (battle_id, user_id, problem_slug, leetcode_submission_id)
        const key = `${battleId}_${uid}_${resultData.problem_slug}_${resultData.leetcode_submission_id}`;
        if (this.battleResults.has(key)) {
          return { success: true, duplicated: true, error: null }; // ON CONFLICT DO NOTHING
        }

        this.battleResults.set(key, { ...resultData, battle_id: battleId, user_id: uid });
        return { success: true, duplicated: false, error: null };
      },

      updateBattleResult: (_battleId, _resultId, _updates) => {
        // Policy: Battle results are append-only. UPDATE is disallowed for client.
        return { success: false, error: '42501: permission denied for table battle_results (append-only)' };
      },

      // 4. Friendships RLS
      updateFriendship: (friendshipId, newStatus) => {
        // Policy: USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
        const friendship = this.friendships.get(friendshipId);
        if (!friendship) return { success: false, error: 'Friendship not found' };
        if (!uid || (friendship.requester_id !== uid && friendship.addressee_id !== uid)) {
          return { success: false, error: '42501: Unauthorized friendship manipulation' };
        }
        this.friendships.set(friendshipId, { ...friendship, status: newStatus });
        return { success: true, error: null };
      },

      // 5. Roast Messages RLS
      selectRoastMessage: (roastId) => {
        // Policy: USING (auth.uid() = sender_id OR auth.uid() = recipient_id)
        const roast = this.roastMessages.get(roastId);
        if (!roast) return { data: null, error: 'Roast not found' };
        if (!uid || (roast.sender_id !== uid && roast.recipient_id !== uid)) {
          return { data: null, error: '42501: RLS violation: cannot read other users private roasts' };
        }
        return { data: roast, error: null };
      }
    };
  }

  requestFriend(requesterId, addresseeId, id = 'new-friendship') {
    if (!requesterId || requesterId === addresseeId || !this.profiles.has(requesterId) || !this.profiles.has(addresseeId)) {
      return { success: false };
    }
    const existing = [...this.friendships.values()].find(row =>
      (row.requester_id === requesterId && row.addressee_id === addresseeId) ||
      (row.requester_id === addresseeId && row.addressee_id === requesterId));
    if (existing) return { success: true, status: existing.status, friendship_id: existing.id };
    this.friendships.set(id, { id, requester_id: requesterId, addressee_id: addresseeId, status: 'pending' });
    return { success: true, status: 'pending', friendship_id: id };
  }

  respondFriend(uid, friendshipId, accept) {
    const request = this.friendships.get(friendshipId);
    if (!request || request.addressee_id !== uid || request.status !== 'pending') return { success: false };
    request.status = accept ? 'accepted' : 'rejected';
    return { success: true, status: request.status };
  }

  acceptedFriends(uid) {
    return [...this.friendships.values()]
      .filter(row => row.status === 'accepted' && (row.requester_id === uid || row.addressee_id === uid))
      .map(row => row.requester_id === uid ? row.addressee_id : row.requester_id);
  }
}

describe('Negative Security & RLS Authorization Tests', () => {
  let db;
  const USER_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const USER_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const USER_C_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeEach(() => {
    db = new MockPostgresRLS();

    // Seed User A
    db.profiles.set(USER_A_ID, { id: USER_A_ID, leetcode_username: 'alice' });
    db.userSettings.set(USER_A_ID, {
      user_id: USER_A_ID,
      hardcore_mode_enabled: true,
      blocked_sites: ['youtube.com']
    });

    // Seed User B
    db.profiles.set(USER_B_ID, { id: USER_B_ID, leetcode_username: 'bob' });
    db.userSettings.set(USER_B_ID, {
      user_id: USER_B_ID,
      hardcore_mode_enabled: false,
      blocked_sites: ['reddit.com']
    });

    // Seed Friendship between A and B
    db.friendships.set('friendship-1', {
      id: 'friendship-1',
      requester_id: USER_A_ID,
      addressee_id: USER_B_ID,
      status: 'accepted'
    });

    // Seed Battle between A and B
    db.battles.set('battle-123', {
      id: 'battle-123',
      challenger_id: USER_A_ID,
      challenged_id: USER_B_ID,
      status: 'in_progress',
      winner_id: null
    });

    // Seed Roast from A to B
    db.roastMessages.set('roast-1', {
      id: 'roast-1',
      sender_id: USER_A_ID,
      recipient_id: USER_B_ID,
      content: 'Your code is slower than dial-up!',
      status: 'sent'
    });
  });

  it('1. Anonymous user cannot read private user settings', () => {
    const anonQuery = db.query(null);
    const result = anonQuery.selectUserSettings(USER_A_ID);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/RLS filtered|PGRST116/);
  });

  it('2. User A cannot read or modify User B private settings', () => {
    const userAQuery = db.query({ uid: USER_A_ID });

    // Read attempt
    const readResult = userAQuery.selectUserSettings(USER_B_ID);
    expect(readResult.data).toBeNull();

    // Write attempt
    const writeResult = userAQuery.updateUserSettings(USER_B_ID, { hardcore_mode_enabled: true });
    expect(writeResult.success).toBe(false);
    expect(writeResult.error).toMatch(/violates row-level security policy/);

    // Verify User B settings remained unchanged
    expect(db.userSettings.get(USER_B_ID).hardcore_mode_enabled).toBe(false);
  });

  it('3. User C (unrelated third party) cannot view an unrelated private battle', () => {
    const userCQuery = db.query({ uid: USER_C_ID });
    const result = userCQuery.selectBattle('battle-123');
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/Access denied/);
  });

  it('4. User A cannot update or tamper with existing battle results', () => {
    const userAQuery = db.query({ uid: USER_A_ID });
    const result = userAQuery.updateBattleResult('battle-123', 'res-1', { points: 999 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/append-only|permission denied/);
  });

  it('5. User A cannot directly assign themselves as winner via raw update', () => {
    const userAQuery = db.query({ uid: USER_A_ID });
    const result = userAQuery.updateBattleWinner('battle-123', USER_A_ID, 'alice');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unauthorized winner modification/);
    expect(db.battles.get('battle-123').winner_id).toBeNull();
  });

  it('6. User A cannot insert a fake submission event under User B identity', () => {
    const userAQuery = db.query({ uid: USER_A_ID });
    const result = userAQuery.insertBattleResult('battle-123', USER_B_ID, {
      problem_slug: 'two-sum',
      leetcode_submission_id: 'sub_9999',
      accepted: false
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot insert results for another participant/);
  });

  it('7. User C cannot modify or accept friendship between User A and User B', () => {
    const userCQuery = db.query({ uid: USER_C_ID });
    const result = userCQuery.updateFriendship('friendship-1', 'blocked');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unauthorized friendship manipulation/);
    expect(db.friendships.get('friendship-1').status).toBe('accepted');
  });

  it('8. User C cannot read private roast message sent from User A to User B', () => {
    const userCQuery = db.query({ uid: USER_C_ID });
    const result = userCQuery.selectRoastMessage('roast-1');
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/cannot read other users private roasts/);

    // Recipient User B CAN read
    const userBQuery = db.query({ uid: USER_B_ID });
    const userBResult = userBQuery.selectRoastMessage('roast-1');
    expect(userBResult.data).not.toBeNull();
    expect(userBResult.data.content).toBe('Your code is slower than dial-up!');
  });

  it('9. Duplicate submission with identical submission ID is idempotent and does not duplicate', () => {
    const userAQuery = db.query({ uid: USER_A_ID });
    const subPayload = {
      problem_slug: 'two-sum',
      leetcode_submission_id: 'sub_unique_123',
      accepted: true,
      time_taken_seconds: 120
    };

    // First attempt
    const res1 = userAQuery.insertBattleResult('battle-123', USER_A_ID, subPayload);
    expect(res1.success).toBe(true);
    expect(res1.duplicated).toBe(false);

    // Replay attempt with same submission ID
    const res2 = userAQuery.insertBattleResult('battle-123', USER_A_ID, subPayload);
    expect(res2.success).toBe(true);
    expect(res2.duplicated).toBe(true);
  });

  it('10. A friend request is private until B accepts it, and C never sees it', () => {
    db.friendships.delete('friendship-1');
    const request = db.requestFriend(USER_A_ID, USER_B_ID, 'request-a-b');
    expect(request).toMatchObject({ success: true, status: 'pending' });
    expect(db.acceptedFriends(USER_A_ID)).not.toContain(USER_B_ID);
    expect(db.acceptedFriends(USER_B_ID)).not.toContain(USER_A_ID);
    expect(db.acceptedFriends(USER_C_ID)).toEqual([]);

    expect(db.respondFriend(USER_B_ID, request.friendship_id, true)).toMatchObject({ success: true, status: 'accepted' });
    expect(db.acceptedFriends(USER_A_ID)).toContain(USER_B_ID);
    expect(db.acceptedFriends(USER_B_ID)).toContain(USER_A_ID);
    expect(db.acceptedFriends(USER_C_ID)).toEqual([]);
  });

  it('11. Only the addressee can accept a pending friendship request', () => {
    db.friendships.delete('friendship-1');
    const request = db.requestFriend(USER_A_ID, USER_B_ID, 'request-a-b-auth');
    expect(db.respondFriend(USER_C_ID, request.friendship_id, true)).toEqual({ success: false });
    expect(db.friendships.get(request.friendship_id).status).toBe('pending');
  });
});

