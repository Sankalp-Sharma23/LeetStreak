/**
 * Exclusive Battle Page Authentication Test Suite
 *
 * Validates the product requirement:
 * - Authentication (Sign In & Create Account) exists ONLY on the 1v1 Battle page.
 * - Entire personal progress (dashboard, streaks, heatmap, problem of the day, hardcore mode) is 100% offline-first.
 * - Settings has NO input forms, only status and navigation to Battle.
 * - Cloud operations (like roasts) prompt authentication and navigate to Battle.
 * - No automatic account creation or signup calls during extension startup.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
  AUTH_STATES,
  restoreSession,
  getAuthState,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  resetAuthState
} from '../../src/shared/supabase-client.js';
import {
  getOwnProfile,
  getAllFriends
} from '../../src/shared/storage.js';

class MockChromeStorage {
  constructor() {
    this.data = {};
  }
  async get(keys) {
    if (typeof keys === 'string') return { [keys]: this.data[keys] };
    if (Array.isArray(keys)) {
      const res = {};
      keys.forEach(k => { if (this.data[k] !== undefined) res[k] = this.data[k]; });
      return res;
    }
    return { ...this.data };
  }
  async set(items) {
    Object.assign(this.data, items);
  }
  async remove(keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    arr.forEach(k => delete this.data[k]);
  }
}

describe('Exclusive Battle Page Authentication Architecture', () => {
  let mockStorage;
  let originalFetch;

  beforeEach(() => {
    resetAuthState();
    mockStorage = new MockChromeStorage();
    global.chrome = {
      storage: {
        local: mockStorage
      }
    };
    originalFetch = global.fetch;
  });

  afterEach(() => {
    delete global.chrome;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // 1 & 2: First-time user opening extension without account loads personal dashboard
  it('1 & 2. First-time user without an account loads personal progress offline', async () => {
    await mockStorage.set({
      my_leetcode_username: 'OfflineFirstHero',
      own_profile: {
        profile: { username: 'OfflineFirstHero' },
        stats: { total: 150, easy: 50, medium: 80, hard: 20, streak: 14 },
        lastUpdated: Date.now()
      }
    });

    // Session restoration returns null (AUTH_REQUIRED)
    const session = await restoreSession();
    expect(session).toBeNull();
    expect(getAuthState()).toBe(AUTH_STATES.AUTH_REQUIRED);

    // Personal dashboard data is 100% accessible
    const own = await getOwnProfile();
    expect(own).not.toBeNull();
    expect(own.stats.streak).toBe(14);
    expect(own.stats.total).toBe(150);
  });

  // 3. User with zero friends
  it('3. User with zero friends functions completely offline without error', async () => {
    await mockStorage.set({
      my_leetcode_username: 'ZeroFriendsUser',
      friends_list: []
    });

    const friends = await getAllFriends();
    expect(Object.keys(friends)).toHaveLength(0);
    expect(getAuthState()).toBe(AUTH_STATES.SESSION_LOADING);
  });

  // 4 & 5. Opening Battle without an account presents unauthenticated state
  it('4 & 5. Opening Battle without an account presents AUTH_REQUIRED for sign in / create account', async () => {
    await signOut();
    expect(getAuthState()).toBe(AUTH_STATES.AUTH_REQUIRED);
  });

  // 6 & 7. Successful registration and email verification flow
  it('6 & 7. Registration on Battle page handles email verification requirement properly', async () => {
    // When Supabase project requires email confirmation
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'usr-new-1', email: 'competitor@example.com' }
        // Note: access_token omitted when email confirmation is required
      })
    });

    const res = await signUpWithEmail('competitor@example.com', 'securepass123');
    expect(res.success).toBe(true);
    expect(res.confirmationRequired).toBe(true);
    expect(res.message).toMatch(/confirm your email/i);
    // Unconfirmed user remains in AUTH_REQUIRED until they confirm and sign in
    expect(getAuthState()).toBe(AUTH_STATES.AUTH_REQUIRED);
  });

  // 8. Successful login advances state to AUTHENTICATED
  it('8. Successful sign in advances authentication state to AUTHENTICATED', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'battle-access-jwt',
        refresh_token: 'battle-refresh-jwt',
        user: { id: 'usr-battle-player', email: 'player@example.com' },
        expires_in: 3600
      })
    });

    const session = await signInWithEmail('player@example.com', 'password123');
    expect(session.access_token).toBe('battle-access-jwt');
    expect(getAuthState()).toBe(AUTH_STATES.AUTHENTICATED);
  });

  // 9. Reopening the extension and restoring session
  it('9. Reopening the extension restores valid session without extra login prompt', async () => {
    const persistedSession = {
      access_token: 'existing-jwt',
      refresh_token: 'existing-refresh',
      user_id: 'usr-persisted',
      expires_at: Date.now() + 1800000
    };
    await mockStorage.set({ supabase_auth_session: persistedSession });

    const restored = await restoreSession();
    expect(restored).toEqual(persistedSession);
    expect(getAuthState()).toBe(AUTH_STATES.AUTHENTICATED);
  });

  // 12. Opening Friends while logged out
  it('12. Viewing friends list while logged out does not block or require login', async () => {
    await signOut();
    await mockStorage.set({
      my_leetcode_username: 'LocalUser',
      friends_cache: {
        'FriendAlice': { stats: { streak: 5, total: 200 } }
      }
    });

    const friends = await getAllFriends();
    expect(friends['FriendAlice']).toBeDefined();
    expect(friends['FriendAlice'].stats.streak).toBe(5);
  });

  // 14. Confirming that NO authentication form exists in SettingsPanel.jsx
  it('14. Confirms SettingsPanel has NO input forms for email or password, only navigation to Battle', () => {
    const settingsPath = path.resolve(process.cwd(), 'src/popup/SettingsPanel.jsx');
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');

    // Verify no email/password inputs exist in Settings
    expect(settingsContent).not.toMatch(/<input[^>]*type=['"]email['"]/i);
    expect(settingsContent).not.toMatch(/<input[^>]*type=['"]password['"]/i);
    // Verify navigation to Battle is present
    expect(settingsContent).toMatch(/onNavigateToBattle/);
    expect(settingsContent).toMatch(/Go to 1v1 Battle/);
  });

  // 15. Confirming no automatic signup requests occur during extension startup
  it('15. Startup restoreSession never issues HTTP POST /auth/v1/signup', async () => {
    let attemptedSignup = false;
    global.fetch = async (url) => {
      if (url.includes('/auth/v1/signup')) attemptedSignup = true;
      return { ok: false, status: 400 };
    };

    await restoreSession();
    expect(attemptedSignup).toBe(false);
  });
});

