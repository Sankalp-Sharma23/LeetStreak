/**
 * Local-First Supabase Storage Manager
 *
 * Implements a resilient local-first architecture using chrome.storage.local
 * for instant offline reads, caching, and independent own-profile tracking,
 * with opportunistic synchronization to Supabase when authenticated.
 */

import {
  getProfile,
  getProfiles,
  upsertProfile,
  getUserSettings,
  upsertUserSettings,
  sendRoast as supabaseSendRoast,
  clearRoasts as supabaseClearRoasts,
  getAuthState,
  AUTH_STATES
} from './supabase-client.js';

export { getUserSettings, upsertUserSettings };

/**
 * Get the current user's configured LeetCode username
 */
export async function getMyUsername() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const data = await chrome.storage.local.get('my_leetcode_username');
  return data.my_leetcode_username || null;
}

/**
 * Get the current user's own profile independently of friends
 */
export async function getOwnProfile() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const data = await chrome.storage.local.get(['own_profile']);
    return data.own_profile || null;
  } catch (err) {
    console.error('Error reading own profile from storage:', err);
    return null;
  }
}

/**
 * Save the current user's own profile to local storage and sync to Supabase if authenticated
 */
export async function saveOwnProfile(data) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  try {
    await chrome.storage.local.set({
      own_profile: data,
      last_own_profile_sync: Date.now()
    });

    const myUsername = await getMyUsername();
    // Opportunistically sync to cloud if authenticated
    if (myUsername && getAuthState() === AUTH_STATES.AUTHENTICATED) {
      upsertProfile(myUsername, data).catch(err => {
        console.warn('[Storage] Cloud sync for own profile failed (non-blocking):', err);
      });
    }

    return true;
  } catch (err) {
    console.error('Error saving own profile to storage:', err);
    return false;
  }
}

/**
 * Get all friends data from local cache and opportunistically refresh from Supabase
 * @returns {Promise<Object>} Friends data object mapped by username
 */
export async function getAllFriends() {
  try {
    const myUsername = await getMyUsername();
    const stored = (typeof chrome !== 'undefined' && chrome.storage?.local)
      ? await chrome.storage.local.get(['friends_cache', 'own_profile', 'friends_list'])
      : {};

    const localCache = stored.friends_cache || {};
    const ownData = stored.own_profile || null;
    const localFriendsList = stored.friends_list || [];

    const result = { ...localCache };

    // Always include own profile if available
    if (myUsername && ownData) {
      result[myUsername] = ownData;
    }

    // If unauthenticated or no cloud connection, return local cache immediately
    if (getAuthState() !== AUTH_STATES.AUTHENTICATED || !myUsername) {
      return result;
    }

    // Opportunistically refresh friend profiles from Supabase if authenticated
    try {
      let cloudFriendsList = localFriendsList;
      const settings = await getUserSettings();
      if (settings?.friends_list && Array.isArray(settings.friends_list)) {
        cloudFriendsList = [...new Set([...localFriendsList, ...settings.friends_list])];
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ friends_list: cloudFriendsList }).catch(() => {});
        }
      }

      if (cloudFriendsList.length > 0) {
        const profiles = await getProfiles(cloudFriendsList);
        if (profiles && profiles.length > 0) {
          profiles.forEach(p => {
            const username = p.leetcode_username || p.username;
            if (username && p.leetcode_data) {
              result[username] = {
                ...p.leetcode_data,
                lastUpdated: p.last_synced_at ? new Date(p.last_synced_at).getTime() : Date.now()
              };
            }
          });

          // Update local cache
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ friends_cache: result }).catch(() => {});
          }
        }
      }
    } catch (cloudErr) {
      console.warn('[Storage] Cloud friends refresh skipped/failed:', cloudErr.message);
    }

    return result;
  } catch (error) {
    console.error('Error getting friends:', error);
    return {};
  }
}

/**
 * Get a single friend's data (checks local cache first, then cloud)
 */
export async function getFriend(username) {
  if (!username) return null;
  try {
    const myUsername = await getMyUsername();
    if (myUsername && username.toLowerCase() === myUsername.toLowerCase()) {
      return await getOwnProfile();
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_cache']);
      if (stored.friends_cache && stored.friends_cache[username]) {
        return stored.friends_cache[username];
      }
    }

    const profile = await getProfile(username);
    if (!profile) return null;

    const data = profile.leetcode_data || {};
    data.lastUpdated = profile.last_synced_at ? new Date(profile.last_synced_at).getTime() : Date.now();
    return data;
  } catch (error) {
    console.error('Error getting single friend:', error);
    return null;
  }
}

/**
 * Save or update a friend's data locally and in Supabase
 */
export async function saveFriend(username, data) {
  if (!username || !data) return { success: false };
  try {
    const myUsername = await getMyUsername();
    const isSelf = myUsername && username.toLowerCase() === myUsername.toLowerCase();

    if (isSelf) {
      await saveOwnProfile(data);
      return { success: true };
    }

    // Save to local storage
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_cache', 'friends_list']);
      const cache = stored.friends_cache || {};
      const list = stored.friends_list || [];

      cache[username] = data;
      const updatedList = list.includes(username) ? list : [...list, username];

      await chrome.storage.local.set({
        friends_cache: cache,
        friends_list: updatedList
      });
    }

    // Sync to Supabase if authenticated
    if (getAuthState() === AUTH_STATES.AUTHENTICATED) {
      upsertProfile(username, data).catch(() => {});
      if (myUsername) {
        getUserSettings().then(settings => {
          const currentList = settings?.friends_list || [];
          if (!currentList.includes(username)) {
            upsertUserSettings({ friends_list: [...currentList, username] }).catch(() => {});
          }
        }).catch(() => {});
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving friend:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a friend from the local friends list and Supabase
 */
export async function removeFriend(username) {
  if (!username) return false;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_cache', 'friends_list']);
      const cache = stored.friends_cache || {};
      const list = stored.friends_list || [];

      delete cache[username];
      const updatedList = list.filter(u => u.toLowerCase() !== username.toLowerCase());

      await chrome.storage.local.set({
        friends_cache: cache,
        friends_list: updatedList
      });
    }

    if (getAuthState() === AUTH_STATES.AUTHENTICATED) {
      getUserSettings().then(settings => {
        if (settings?.friends_list) {
          const updated = settings.friends_list.filter(u => u.toLowerCase() !== username.toLowerCase());
          upsertUserSettings({ friends_list: updated }).catch(() => {});
        }
      }).catch(() => {});
    }

    return true;
  } catch (error) {
    console.error('Error removing friend:', error);
    return false;
  }
}

/**
 * Get list of friend usernames
 */
export async function getFriendsList() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_list']);
      if (stored.friends_list && Array.isArray(stored.friends_list)) {
        return stored.friends_list;
      }
    }

    if (getAuthState() === AUTH_STATES.AUTHENTICATED) {
      const settings = await getUserSettings();
      if (settings?.friends_list) {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ friends_list: settings.friends_list }).catch(() => {});
        }
        return settings.friends_list;
      }
    }

    return [];
  } catch (error) {
    console.error('Error getting friends list:', error);
    return [];
  }
}

/**
 * Check if a username is already added
 */
export async function friendExists(username) {
  if (!username) return false;
  const friends = await getFriendsList();
  return friends.some(f => f.toLowerCase() === username.toLowerCase());
}

/**
 * Get last update timestamp for a friend
 */
export async function getLastUpdated(username) {
  const friend = await getFriend(username);
  return friend?.lastUpdated || null;
}

/**
 * Check storage health & quota usage
 */
export async function checkStorageHealth() {
  const info = await getStorageInfo();
  const atLimit = info.bytesUsed >= info.quota * 0.95;
  const nearLimit = info.bytesUsed >= info.quota * 0.8;
  return {
    bytes: info.bytesUsed,
    megabytes: (info.bytesUsed / (1024 * 1024)).toFixed(2),
    percent: info.percentUsed,
    nearLimit,
    atLimit
  };
}

/**
 * Get detailed storage usage information
 */
export async function getStorageInfo() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const bytesInUse = await new Promise(resolve => {
        chrome.storage.local.getBytesInUse(null, bytes => resolve(bytes || 0));
      });
      const quota = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB default quota
      const percentUsed = ((bytesInUse / quota) * 100).toFixed(1);
      return {
        bytesUsed: bytesInUse,
        quota,
        percentUsed
      };
    }
  } catch (err) {
    console.warn('Error reading storage usage:', err);
  }
  return { bytesUsed: 0, quota: 5242880, percentUsed: '0.0' };
}

/**
 * Update a friend's specific field
 */
export async function updateFriendField(username, field, value) {
  try {
    const friend = await getFriend(username);
    if (!friend) return false;

    friend[field] = value;
    await saveFriend(username, friend);
    return true;
  } catch (error) {
    console.error('Error updating friend field:', error);
    return false;
  }
}

/**
 * Clear all local data (Reset)
 */
export async function clearAllData() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.clear();
  }
  return true;
}

/**
 * Send a roast to a friend
 */
export async function sendRoast(targetUsername, fromUsername, message) {
  return await supabaseSendRoast(targetUsername, fromUsername, message);
}

/**
 * Clear pending roasts for current user
 */
export async function clearRoasts() {
  const myUsername = await getMyUsername();
  if (myUsername) {
    return await supabaseClearRoasts(myUsername);
  }
  return false;
}
