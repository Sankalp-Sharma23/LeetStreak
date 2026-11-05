/**
 * Permanent Friendship Persistence, Account Recovery & Email Privacy Tests
 *
 * Verifies:
 * 1. Friendship persistence across extension uninstallation and reinstallation.
 * 2. Independence of server-side friendships from local Chrome storage deletion.
 * 3. Offline friends remain in friend list (presence/friendship decoupling).
 * 4. Idempotent profile initialization on repeated logins.
 * 5. Strict email privacy: email is isolated in auth.users and never exposed via public APIs.
 * 6. Extension uninstallation does NOT delete server-side social graph.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

class MockSupabaseServer {
  constructor() {
    this.authUsers = new Map(); // id -> { id, email, password }
    this.profiles = new Map();  // id -> { id, leetcode_username, display_name, avatar_url, ... }
    this.friendships = [];      // [{ id, requester_id, addressee_id, status, created_at }]
    this.presence = new Map();  // user_id -> { user_id, username, status, last_seen }
  }

  registerUser(id, email, password, username, displayName = null) {
    this.authUsers.set(id, { id, email, password });
    this.profiles.set(id, {
      id,
      leetcode_username: username.toLowerCase(),
      display_name: displayName || username,
      avatar_url: `https://assets.leetcode.com/${username}.jpg`,
      total_solved: 350,
      easy_solved: 150,
      medium_solved: 150,
      hard_solved: 50,
      current_streak: 21,
      longest_streak: 45,
      contest_rating: 1820.5,
      last_synced_at: new Date().toISOString()
    });
  }

  authenticate(email, password) {
    for (const user of this.authUsers.values()) {
      if (user.email.toLowerCase() === email.toLowerCase() && user.password === password) {
        return {
          user_id: user.id,
          email: user.email,
          access_token: `token_${user.id}`,
          refresh_token: `refresh_${user.id}`,
          expires_at: Date.now() + 3600_000
        };
      }
    }
    return null;
  }

  establishFriendship(userAId, userBId, status = 'accepted') {
    const existing = this.friendships.find(
      f => (f.requester_id === userAId && f.addressee_id === userBId) ||
           (f.requester_id === userBId && f.addressee_id === userAId)
    );
    if (existing) {
      existing.status = status;
      return existing;
    }
    const record = {
      id: `friendship_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      requester_id: userAId,
      addressee_id: userBId,
      status,
      created_at: new Date().toISOString()
    };
    this.friendships.push(record);
    return record;
  }

  removeFriendship(userAId, targetUsername) {
    const targetProfile = Array.from(this.profiles.values()).find(
      p => p.leetcode_username === targetUsername.toLowerCase()
    );
    if (!targetProfile) return { success: false, error: 'User not found' };

    const initialLen = this.friendships.length;
    this.friendships = this.friendships.filter(
      f => !((f.requester_id === userAId && f.addressee_id === targetProfile.id) ||
             (f.requester_id === targetProfile.id && f.addressee_id === userAId))
    );
    return { success: true, removed: initialLen - this.friendships.length };
  }

  // Simulated RPC: get_accepted_friends()
  // CRITICAL: NEVER includes email address
  getAcceptedFriends(authUserId) {
    const friends = [];
    for (const f of this.friendships) {
      if (f.status !== 'accepted') continue;

      let friendId = null;
      let isRequester = false;

      if (f.requester_id === authUserId) {
        friendId = f.addressee_id;
        isRequester = true;
      } else if (f.addressee_id === authUserId) {
        friendId = f.requester_id;
        isRequester = false;
      }

      if (friendId) {
        const prof = this.profiles.get(friendId);
        if (prof) {
          // Public profile fields only — NO EMAIL
          friends.push({
            friend_id: prof.id,
            leetcode_username: prof.leetcode_username,
            display_name: prof.display_name,
            avatar_url: prof.avatar_url,
            total_solved: prof.total_solved,
            easy_solved: prof.easy_solved,
            medium_solved: prof.medium_solved,
            hard_solved: prof.hard_solved,
            current_streak: prof.current_streak,
            longest_streak: prof.longest_streak,
            contest_rating: prof.contest_rating,
            last_synced_at: prof.last_synced_at,
            friendship_id: f.id,
            friendship_created_at: f.created_at,
            is_requester: isRequester
          });
        }
      }
    }
    return friends;
  }

  // Simulated RPC: get_own_profile()
  getOwnProfile(authUserId) {
    const prof = this.profiles.get(authUserId);
    if (!prof) return null;
    return { ...prof }; // Contains public profile attributes
  }

  // Simulated RPC: restore_or_init_profile()
  restoreOrInitProfile(authUserId, username, displayName = null, avatarUrl = null) {
    const existing = this.profiles.get(authUserId);
    if (existing) {
      return { success: true, is_new: false, profile: { ...existing } };
    }
    const newProf = {
      id: authUserId,
      leetcode_username: username.toLowerCase(),
      display_name: displayName || username,
      avatar_url: avatarUrl || '',
      total_solved: 0,
      easy_solved: 0,
      medium_solved: 0,
      hard_solved: 0,
      current_streak: 0,
      longest_streak: 0,
      contest_rating: 0,
      last_synced_at: new Date().toISOString()
    };
    this.profiles.set(authUserId, newProf);
    return { success: true, is_new: true, profile: newProf };
  }

  heartbeat(authUserId, username, status = 'online') {
    const record = {
      user_id: authUserId,
      username: username.toLowerCase(),
      status,
      last_seen: new Date().toISOString()
    };
    this.presence.set(authUserId, record);
    return record;
  }
}

class MockClientExtensionStorage {
  constructor() {
    this.storage = {};
  }

  async get(keys) {
    if (typeof keys === 'string') {
      return { [keys]: this.storage[keys] };
    }
    if (Array.isArray(keys)) {
      const res = {};
      for (const k of keys) {
        if (this.storage[k] !== undefined) res[k] = this.storage[k];
      }
      return res;
    }
    return { ...this.storage };
  }

  async set(items) {
    Object.assign(this.storage, items);
  }

  async remove(keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) {
      delete this.storage[k];
    }
  }

  // Simulates extension uninstallation or cache clear
  uninstallOrWipe() {
    this.storage = {};
  }
}

describe('Permanent Friendship Persistence, Account Recovery & Privacy', () => {
  let server;
  let clientStorage;

  const USER_A_ID = '11111111-aaaa-bbbb-cccc-111111111111';
  const USER_B_ID = '22222222-aaaa-bbbb-cccc-222222222222';
  const USER_C_ID = '33333333-aaaa-bbbb-cccc-333333333333';

  beforeEach(() => {
    server = new MockSupabaseServer();
    clientStorage = new MockClientExtensionStorage();

    // Register User A (Alice)
    server.registerUser(USER_A_ID, 'alice@company.org', 'secret123', 'alice_coder', 'Alice Cooper');
    // Register User B (Bob)
    server.registerUser(USER_B_ID, 'bob@university.edu', 'secret456', 'bob_hacker', 'Bob Dylan');
    // Register User C (Charlie)
    server.registerUser(USER_C_ID, 'charlie@gmail.com', 'secret789', 'charlie_algo', 'Charlie Brown');

    // Establish mutual accepted friendships in Supabase
    server.establishFriendship(USER_A_ID, USER_B_ID, 'accepted');
    server.establishFriendship(USER_A_ID, USER_C_ID, 'accepted');
  });

  describe('1. Friendship Persistence Across Extension Uninstallation & Reinstallation', () => {
    it('restores all accepted friends after complete extension wipe and sign-in', async () => {
      // Step 1: User A is logged in and using the extension
      const session = server.authenticate('alice@company.org', 'secret123');
      expect(session).not.toBeNull();
      expect(session.user_id).toBe(USER_A_ID);

      // Hydrate local storage
      const initialFriends = server.getAcceptedFriends(USER_A_ID);
      expect(initialFriends).toHaveLength(2);

      await clientStorage.set({
        supabase_auth_session: session,
        my_leetcode_username: 'alice_coder',
        friends_cache: {
          bob_hacker: { username: 'bob_hacker', stats: { total: 350 } }
        }
      });

      // Step 2: User A UNINSTALLS the extension (all local storage wiped)
      clientStorage.uninstallOrWipe();
      expect(await clientStorage.get('supabase_auth_session')).toEqual({});
      expect(await clientStorage.get('friends_cache')).toEqual({});
      expect(await clientStorage.get('my_leetcode_username')).toEqual({});

      // Step 3: Server database remains untouched!
      expect(server.friendships).toHaveLength(2);
      expect(server.profiles.get(USER_A_ID)).toBeDefined();

      // Step 4: User A reinstalls extension months later and signs in
      const reinstalledSession = server.authenticate('alice@company.org', 'secret123');
      expect(reinstalledSession.user_id).toBe(USER_A_ID); // Identical UUID recovered

      // Step 5: Execute recovery workflow
      const ownProfile = server.getOwnProfile(reinstalledSession.user_id);
      const restoredFriends = server.getAcceptedFriends(reinstalledSession.user_id);

      // Save restored data back to fresh extension storage
      await clientStorage.set({
        supabase_auth_session: reinstalledSession,
        my_leetcode_username: ownProfile.leetcode_username,
        own_profile: ownProfile,
        friends_cache: restoredFriends.reduce((acc, f) => {
          acc[f.leetcode_username] = {
            username: f.leetcode_username,
            profile: { username: f.leetcode_username, realName: f.display_name, avatar: f.avatar_url },
            stats: { total: f.total_solved, streak: f.current_streak }
          };
          return acc;
        }, {})
      });

      // Verification: Friends restored without re-adding
      const storageState = await clientStorage.get(['my_leetcode_username', 'friends_cache']);
      expect(storageState.my_leetcode_username).toBe('alice_coder');
      expect(Object.keys(storageState.friends_cache)).toEqual(['bob_hacker', 'charlie_algo']);
      expect(storageState.friends_cache['bob_hacker'].profile.realName).toBe('Bob Dylan');
      expect(storageState.friends_cache['charlie_algo'].profile.realName).toBe('Charlie Brown');
    });

    it('recovers same UUID and friends from any new device/browser', () => {
      // Sign in from Chrome on Laptop
      const sessionLaptop = server.authenticate('alice@company.org', 'secret123');
      // Sign in from Edge on Desktop
      const sessionDesktop = server.authenticate('alice@company.org', 'secret123');

      expect(sessionLaptop.user_id).toBe(sessionDesktop.user_id);
      expect(server.getAcceptedFriends(sessionLaptop.user_id))
        .toEqual(server.getAcceptedFriends(sessionDesktop.user_id));
    });
  });

  describe('2. Decoupling of Presence and Friendship Persistence', () => {
    it('friend remains in friend list even when friend uninstalls or goes offline', () => {
      // Bob goes offline / uninstalls (no heartbeat for 10 days)
      const STALE_MS = 10 * 24 * 3600 * 1000;
      server.presence.set(USER_B_ID, {
        user_id: USER_B_ID,
        username: 'bob_hacker',
        status: 'offline',
        last_seen: new Date(Date.now() - STALE_MS).toISOString()
      });

      // Alice queries her accepted friends
      const alicesFriends = server.getAcceptedFriends(USER_A_ID);
      expect(alicesFriends.map(f => f.leetcode_username)).toContain('bob_hacker');

      // The relationship row was NOT modified or deleted
      const bobsFriendship = server.friendships.find(
        f => (f.requester_id === USER_A_ID && f.addressee_id === USER_B_ID) ||
             (f.requester_id === USER_B_ID && f.addressee_id === USER_A_ID)
      );
      expect(bobsFriendship).toBeDefined();
      expect(bobsFriendship.status).toBe('accepted');
    });

    it('new presence session is re-established when friend reinstalls and heartbeats', () => {
      // Bob reinstalls and sends heartbeat
      const heartbeat = server.heartbeat(USER_B_ID, 'bob_hacker', 'online');
      expect(heartbeat.status).toBe('online');
      expect(new Date(heartbeat.last_seen).getTime()).toBeGreaterThan(Date.now() - 5000);

      // Friendship remained uninterrupted
      expect(server.getAcceptedFriends(USER_A_ID)).toHaveLength(2);
    });
  });

  describe('3. Idempotent Profile Initialization & Restoration', () => {
    it('does not overwrite existing profile when user signs in repeatedly', () => {
      // Attempt restore_or_init_profile for existing User A
      const res1 = server.restoreOrInitProfile(USER_A_ID, 'alice_coder');
      expect(res1.is_new).toBe(false);
      expect(res1.profile.total_solved).toBe(350); // Original solved count preserved

      // Attempt restore with different parameters
      const res2 = server.restoreOrInitProfile(USER_A_ID, 'alice_coder', 'New Name Attempt');
      expect(res2.is_new).toBe(false);
      expect(res2.profile.display_name).toBe('Alice Cooper'); // Original name not overwritten
      expect(server.profiles.size).toBe(3); // No duplicate profile records created
    });

    it('creates initial profile only when user profile does not exist yet', () => {
      const NEW_USER_ID = '44444444-aaaa-bbbb-cccc-444444444444';
      const res = server.restoreOrInitProfile(NEW_USER_ID, 'new_dev', 'New Developer');
      expect(res.is_new).toBe(true);
      expect(res.profile.id).toBe(NEW_USER_ID);
      expect(res.profile.leetcode_username).toBe('new_dev');
      expect(server.profiles.size).toBe(4);
    });
  });

  describe('4. Strict Email Privacy & Data Isolation', () => {
    it('getAcceptedFriends NEVER exposes email addresses', () => {
      const friends = server.getAcceptedFriends(USER_A_ID);
      expect(friends.length).toBeGreaterThan(0);

      for (const friend of friends) {
        expect(friend.email).toBeUndefined();
        expect(Object.keys(friend)).not.toContain('email');
        expect(JSON.stringify(friend)).not.toMatch(/@/); // No email anywhere in serialized JSON
      }
    });

    it('getOwnProfile returns public attributes and never exposes email', () => {
      const profile = server.getOwnProfile(USER_A_ID);
      expect(profile).not.toBeNull();
      expect(profile.email).toBeUndefined();
      expect(profile.leetcode_username).toBe('alice_coder');
      expect(Object.keys(profile)).not.toContain('email');
    });

    it('email is stored strictly in authentication provider record', () => {
      const authUser = server.authUsers.get(USER_A_ID);
      expect(authUser.email).toBe('alice@company.org');

      const publicProfile = server.profiles.get(USER_A_ID);
      expect(publicProfile.email).toBeUndefined();
    });
  });

  describe('5. Friendship Removal & Persistence', () => {
    it('permanently removes friendship in database when explicitly requested', () => {
      expect(server.getAcceptedFriends(USER_A_ID)).toHaveLength(2);

      const res = server.removeFriendship(USER_A_ID, 'charlie_algo');
      expect(res.success).toBe(true);
      expect(res.removed).toBe(1);

      // Verified: Charlie is removed from Alice's friends
      const alicesFriends = server.getAcceptedFriends(USER_A_ID);
      expect(alicesFriends).toHaveLength(1);
      expect(alicesFriends[0].leetcode_username).toBe('bob_hacker');

      // Verified: Alice is also removed from Charlie's friends (bidirectional)
      const charliesFriends = server.getAcceptedFriends(USER_C_ID);
      expect(charliesFriends).toHaveLength(0);
    });
  });

  describe('6. Account Deletion vs Extension Uninstallation Distinction', () => {
    it('uninstalling extension preserves cloud data; only explicit deletion removes it', async () => {
      // Simulate uninstallation
      clientStorage.uninstallOrWipe();

      // Database records exist intact
      expect(server.authUsers.has(USER_A_ID)).toBe(true);
      expect(server.profiles.has(USER_A_ID)).toBe(true);
      expect(server.getAcceptedFriends(USER_A_ID).length).toBeGreaterThan(0);

      // Only explicit account deletion can delete user records
      function explicitDeleteAccount(userId) {
        server.authUsers.delete(userId);
        server.profiles.delete(userId);
        server.friendships = server.friendships.filter(
          f => f.requester_id !== userId && f.addressee_id !== userId
        );
        server.presence.delete(userId);
      }

      explicitDeleteAccount(USER_A_ID);

      expect(server.authUsers.has(USER_A_ID)).toBe(false);
      expect(server.profiles.has(USER_A_ID)).toBe(false);
      expect(server.getAcceptedFriends(USER_B_ID)).toHaveLength(0); // Bob no longer has Alice
    });
  });
});
