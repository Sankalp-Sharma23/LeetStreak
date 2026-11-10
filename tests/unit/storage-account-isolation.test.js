import { beforeEach, describe, expect, it, jest } from '@jest/globals';

let authState;
let session;
const getAuthSession = jest.fn();
const getAcceptedFriends = jest.fn();

jest.unstable_mockModule('../../src/shared/supabase-client.js', () => ({
  getProfile: jest.fn(),
  getProfiles: jest.fn(),
  getAcceptedFriends,
  removeFriendship: jest.fn(),
  upsertProfile: jest.fn(),
  getUserSettings: jest.fn(),
  upsertUserSettings: jest.fn(),
  sendRoast: jest.fn(),
  clearRoasts: jest.fn(),
  getAuthState: () => authState,
  getAuthSession,
  AUTH_STATES: { AUTHENTICATED: 'AUTHENTICATED' }
}));

const { getAllFriends, getFriendsList } = await import('../../src/shared/storage.js');

function createChromeStorage(seed) {
  const data = { ...seed };
  return {
    data,
    local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(names.filter(name => name in data).map(name => [name, data[name]]));
      },
      async set(values) {
        Object.assign(data, values);
      },
      async remove(keys) {
        for (const name of Array.isArray(keys) ? keys : [keys]) delete data[name];
      }
    }
  };
}

describe('friend cache account isolation', () => {
  beforeEach(() => {
    authState = 'AUTH_REQUIRED';
    session = null;
    getAuthSession.mockReset().mockImplementation(async () => session);
    getAcceptedFriends.mockReset().mockResolvedValue([]);
    global.chrome = { storage: { local: createChromeStorage({}).local } };
  });

  it('replaces a prior account cache with the authenticated account friend set', async () => {
    authState = 'AUTHENTICATED';
    session = { user_id: 'account-b' };
    const chromeStorage = createChromeStorage({
      my_leetcode_username: 'bob',
      own_profile: { username: 'bob' },
      friends_cache: { alicefriend: { username: 'alicefriend' } },
      friends_list: ['alicefriend'],
      friends_account_id: 'account-a'
    });
    global.chrome.storage.local = chromeStorage.local;
    getAcceptedFriends.mockResolvedValue([
      { leetcode_username: 'charlie', display_name: 'Charlie' }
    ]);

    const friends = await getAllFriends();

    expect(Object.keys(friends).sort()).toEqual(['bob', 'charlie']);
    expect(chromeStorage.data.friends_list).toEqual(['charlie']);
    expect(chromeStorage.data.friends_account_id).toBe('account-b');
  });

  it('does not expose an account-owned cache when there is no authenticated owner', async () => {
    const chromeStorage = createChromeStorage({
      friends_cache: { alicefriend: { username: 'alicefriend' } },
      friends_list: ['alicefriend'],
      friends_account_id: 'account-a'
    });
    global.chrome.storage.local = chromeStorage.local;

    expect(await getAllFriends()).toEqual({});
    expect(await getFriendsList()).toEqual([]);
  });

  it('removes a same-account cached friend after the cloud relationship is no longer accepted', async () => {
    authState = 'AUTHENTICATED';
    session = { user_id: 'account-a' };
    const chromeStorage = createChromeStorage({
      my_leetcode_username: 'alice',
      friends_cache: {
        oldfriend: { username: 'oldfriend' },
        currentfriend: { username: 'currentfriend' }
      },
      friends_list: ['oldfriend', 'currentfriend'],
      friends_account_id: 'account-a'
    });
    global.chrome.storage.local = chromeStorage.local;
    getAcceptedFriends.mockResolvedValue([
      { leetcode_username: 'currentfriend', display_name: 'Current Friend' }
    ]);

    const friends = await getAllFriends();

    expect(Object.keys(friends)).toEqual(['currentfriend']);
    expect(chromeStorage.data.friends_list).toEqual(['currentfriend']);
  });
});
