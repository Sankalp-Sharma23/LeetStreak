/**
 * Supabase REST & Auth API Client (Zero-SDK Native Fetch)
 *
 * Implements strict authenticated identity bindings (auth.uid()),
 * secure RLS compliance, normalized profile and friendship management,
 * and durable roast message delivery with explicit lifecycle states.
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env) ? process.env : {};

export const SUPABASE_URL = env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_PROJECT_URL_HERE';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY_HERE';

export const BASE_URL = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');

// Canonical Authentication States
export const AUTH_STATES = {
  SESSION_LOADING: 'SESSION_LOADING',
  AUTHENTICATED: 'AUTHENTICATED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  AUTH_ERROR: 'AUTH_ERROR'
};

// In-memory state tracking
let cachedSession = null;
let currentAuthState = AUTH_STATES.SESSION_LOADING;
let lastAuthError = null;
let authCooldownUntil = 0;
const authStateListeners = new Set();

/**
 * Register an authentication state change listener
 */
export function onAuthStateChange(listener) {
  if (typeof listener === 'function') {
    authStateListeners.add(listener);
    // Immediately notify with current state
    try {
      listener(currentAuthState, cachedSession, lastAuthError);
    } catch (e) {
      console.warn('[SupabaseClient] Error in auth listener:', e);
    }
  }
  return () => authStateListeners.delete(listener);
}

/**
 * Internal helper to update auth state and broadcast to listeners
 */
function setAuthState(newState, error = null) {
  currentAuthState = newState;
  lastAuthError = error;
  for (const listener of authStateListeners) {
    try {
      listener(currentAuthState, cachedSession, lastAuthError);
    } catch (e) {
      console.warn('[SupabaseClient] Error in auth listener callback:', e);
    }
  }
}

/**
 * Get the current authentication state synchronously
 */
export function getAuthState() {
  return currentAuthState;
}

/**
 * Reset all in-memory auth state and rate limit cooldowns (useful for logout & testing)
 */
export function resetAuthState() {
  cachedSession = null;
  currentAuthState = AUTH_STATES.SESSION_LOADING;
  lastAuthError = null;
  authCooldownUntil = 0;
}

/**
 * Check if authentication attempts are currently rate-limited
 */
export function isAuthRateLimited() {
  return Date.now() < authCooldownUntil;
}

/**
 * Get remaining cooldown seconds
 */
export function getAuthCooldownSeconds() {
  const remaining = Math.max(0, Math.ceil((authCooldownUntil - Date.now()) / 1000));
  return remaining;
}

/**
 * Set an explicit rate limit cooldown (e.g. on 429 response)
 */
export function setAuthCooldown(seconds = 60) {
  authCooldownUntil = Date.now() + (seconds * 1000);
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ supabase_auth_cooldown_until: authCooldownUntil }).catch(() => {});
  }
}

/**
 * Get the current authenticated user session from memory or storage
 */
export async function getAuthSession() {
  if (cachedSession && cachedSession.expires_at > Date.now()) {
    return cachedSession;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const stored = await chrome.storage.local.get(['supabase_auth_session']);
      if (stored.supabase_auth_session && stored.supabase_auth_session.expires_at > Date.now()) {
        cachedSession = stored.supabase_auth_session;
        return cachedSession;
      }
    } catch {}
  }

  return null;
}

/**
 * Save auth session to memory and chrome.storage.local
 */
export async function setAuthSession(session) {
  cachedSession = session;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      if (session) {
        await chrome.storage.local.set({ supabase_auth_session: session });
      } else {
        await chrome.storage.local.remove(['supabase_auth_session']);
      }
    } catch {}
  }
}

/**
 * Restore session from storage on startup.
 * Never creates automatic accounts or sends surprise emails.
 */
export async function restoreSession() {
  setAuthState(AUTH_STATES.SESSION_LOADING);

  try {
    let storedSession = null;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['supabase_auth_session', 'supabase_auth_cooldown_until']);
      if (stored.supabase_auth_cooldown_until && stored.supabase_auth_cooldown_until > Date.now()) {
        authCooldownUntil = stored.supabase_auth_cooldown_until;
      }
      storedSession = stored.supabase_auth_session;
    } else {
      storedSession = cachedSession;
    }

    if (!storedSession) {
      setAuthState(AUTH_STATES.AUTH_REQUIRED);
      return null;
    }

    // Check if session is still valid (give 60-second grace window)
    if (storedSession.expires_at && storedSession.expires_at > Date.now() + 60000) {
      cachedSession = storedSession;
      setAuthState(AUTH_STATES.AUTHENTICATED);
      return cachedSession;
    }

    // Session has expired — try refreshing if refresh_token exists
    if (storedSession.refresh_token) {
      if (isAuthRateLimited()) {
        setAuthState(AUTH_STATES.AUTH_ERROR, 'Authentication temporarily rate-limited. Please wait.');
        return null;
      }

      const refreshed = await refreshSession(storedSession.refresh_token);
      if (refreshed) {
        return refreshed;
      }
    }

    // Refresh failed or no refresh token — session is dead
    await setAuthSession(null);
    setAuthState(AUTH_STATES.SESSION_EXPIRED, 'Session expired. Please sign in again.');
    return null;
  } catch (err) {
    console.warn('[SupabaseClient] Error restoring session:', err);
    setAuthState(AUTH_STATES.AUTH_ERROR, err.message);
    return null;
  }
}

/**
 * Refresh an existing session using its refresh_token
 */
export async function refreshSession(refreshToken) {
  if (isAuthRateLimited()) {
    setAuthState(AUTH_STATES.AUTH_ERROR, 'Rate limited');
    return null;
  }

  try {
    const res = await fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (res.status === 429) {
      setAuthCooldown(60);
      setAuthState(AUTH_STATES.AUTH_ERROR, 'Supabase authentication rate limit exceeded.');
      return null;
    }

    if (!res.ok) {
      await setAuthSession(null);
      setAuthState(AUTH_STATES.SESSION_EXPIRED, 'Session expired or revoked.');
      return null;
    }

    const authData = await res.json();
    const session = {
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
      user_id: authData.user?.id,
      email: authData.user?.email,
      expires_at: Date.now() + (authData.expires_in ? authData.expires_in * 1000 : 3600 * 1000)
    };

    await setAuthSession(session);
    setAuthState(AUTH_STATES.AUTHENTICATED);
    return session;
  } catch (err) {
    console.warn('[SupabaseClient] Network error during token refresh:', err);
    setAuthState(AUTH_STATES.AUTH_ERROR, err.message);
    return null;
  }
}

/**
 * Explicit email/password login
 */
export async function signInWithEmail(email, password) {
  if (isAuthRateLimited()) {
    const cooldown = getAuthCooldownSeconds();
    throw new Error(`Rate limit cooldown active. Please wait ${cooldown} seconds.`);
  }

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  try {
    const res = await fetch(`${BASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email, password })
    });

    if (res.status === 429) {
      setAuthCooldown(60);
      setAuthState(AUTH_STATES.AUTH_ERROR, 'Rate limit exceeded');
      throw new Error('Email rate limit exceeded. Please wait 1 minute before retrying.');
    }

    if (!res.ok) {
      const errText = await res.text();
      let msg = 'Invalid email or password';
      try {
        const parsed = JSON.parse(errText);
        msg = parsed.error_description || parsed.msg || msg;
      } catch {}
      throw new Error(msg);
    }

    const authData = await res.json();
    const session = {
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
      user_id: authData.user?.id,
      email: authData.user?.email || email,
      expires_at: Date.now() + (authData.expires_in ? authData.expires_in * 1000 : 3600 * 1000)
    };

    await setAuthSession(session);
    setAuthState(AUTH_STATES.AUTHENTICATED);
    return session;
  } catch (err) {
    setAuthState(AUTH_STATES.AUTH_ERROR, err.message);
    throw err;
  }
}

/**
 * Explicit email/password sign-up
 */
export async function signUpWithEmail(email, password) {
  if (isAuthRateLimited()) {
    const cooldown = getAuthCooldownSeconds();
    throw new Error(`Rate limit cooldown active. Please wait ${cooldown} seconds.`);
  }

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  try {
    const res = await fetch(`${BASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email, password })
    });

    if (res.status === 429) {
      setAuthCooldown(60);
      setAuthState(AUTH_STATES.AUTH_ERROR, 'Rate limit exceeded');
      throw new Error('Email signup rate limit exceeded. Please wait before retrying.');
    }

    if (!res.ok) {
      const errText = await res.text();
      let msg = 'Failed to create account';
      try {
        const parsed = JSON.parse(errText);
        msg = parsed.error_description || parsed.msg || msg;
      } catch {}
      throw new Error(msg);
    }

    const authData = await res.json();
    
    // If auto-confirm is enabled, access_token will be present
    if (authData.access_token) {
      const session = {
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        user_id: authData.user?.id,
        email: authData.user?.email || email,
        expires_at: Date.now() + (authData.expires_in ? authData.expires_in * 1000 : 3600 * 1000)
      };
      await setAuthSession(session);
      setAuthState(AUTH_STATES.AUTHENTICATED);
      return { success: true, session };
    }

    // Email confirmation required
    setAuthState(AUTH_STATES.AUTH_REQUIRED);
    return {
      success: true,
      confirmationRequired: true,
      user: authData.user,
      message: 'Account created. Please check your inbox to confirm your email before signing in.'
    };
  } catch (err) {
    setAuthState(AUTH_STATES.AUTH_ERROR, err.message);
    throw err;
  }
}

/**
 * Sign out and clear stored session
 */
export async function signOut() {
  try {
    const session = await getAuthSession();
    if (session?.access_token) {
      fetch(`${BASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`
        }
      }).catch(() => {});
    }
  } catch {}

  await setAuthSession(null);
  setAuthState(AUTH_STATES.AUTH_REQUIRED);
  return { success: true };
}

/**
 * Backwards-compatible session restoration hook.
 * Strictly guarantees NO auto-signups or unsolicited email dispatch.
 */
export async function ensureAuthenticatedSession() {
  const existing = await getAuthSession();
  if (existing) return existing;
  return await restoreSession();
}

/**
 * Get authorization headers incorporating authenticated JWT token when available
 */
export async function getAuthHeaders() {
  const session = await getAuthSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;

  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Prefer': 'return=representation'
  };
}

/**
 * Execute a PostgREST RPC function call
 */
export async function callRpc(functionName, params = {}) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return null;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BASE_URL}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[SupabaseClient] RPC ${functionName} error:`, res.status, errText);
      return { success: false, error: errText };
    }

    return await res.json();
  } catch (err) {
    console.error(`[SupabaseClient] RPC ${functionName} exception:`, err);
    return { success: false, error: err.message };
  }
}

// ============================================================================
// PROFILES API
// ============================================================================

export async function getProfile(username) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE' || !username) return null;

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${BASE_URL}/rest/v1/profiles?leetcode_username=ilike.${encodeURIComponent(username)}&select=*`,
      { method: 'GET', headers }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Supabase getProfile error:', error);
    return null;
  }
}

export async function getProfiles(usernames) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE' || !usernames?.length) return [];

  try {
    const headers = await getAuthHeaders();
    const list = usernames.map(u => `"${u.toLowerCase()}"`).join(',');
    const response = await fetch(
      `${BASE_URL}/rest/v1/profiles?leetcode_username=in.(${list})&select=*`,
      { method: 'GET', headers }
    );
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error('Supabase getProfiles error:', error);
    return [];
  }
}

export async function upsertProfile(username, leetcodeData) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE' || !username) return false;

  try {
    const session = await getAuthSession();
    // Only attempt profile sync if user has an authenticated session
    if (!session?.user_id) {
      return false;
    }

    const headers = await getAuthHeaders();
    const stats = leetcodeData?.stats || {};
    const profile = leetcodeData?.profile || {};
    const contest = leetcodeData?.contest || {};

    const payload = {
      id: session.user_id,
      leetcode_username: username.toLowerCase(),
      display_name: profile.realName || username,
      avatar_url: profile.avatar || '',
      total_solved: stats.total || 0,
      easy_solved: stats.easy || 0,
      medium_solved: stats.medium || 0,
      hard_solved: stats.hard || 0,
      current_streak: stats.streak || 0,
      longest_streak: stats.longestStreak || 0,
      contest_rating: contest.rating || 0,
      last_synced_at: new Date().toISOString()
    };

    const response = await fetch(`${BASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        ...headers,
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(payload)
    });

    return response.ok;
  } catch (error) {
    console.error('Supabase upsertProfile error:', error);
    return false;
  }
}

// ============================================================================
// USER SETTINGS API (Private to auth.uid())
// ============================================================================

export async function getUserSettings() {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return null;

  try {
    const session = await getAuthSession();
    if (!session?.user_id) return null;

    const headers = await getAuthHeaders();
    const response = await fetch(
      `${BASE_URL}/rest/v1/user_settings?user_id=eq.${session.user_id}&select=*`,
      { method: 'GET', headers }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Supabase getUserSettings error:', error);
    return null;
  }
}

export async function upsertUserSettings(settingsObj) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return false;

  try {
    const session = await getAuthSession();
    if (!session?.user_id) return false;

    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/rest/v1/user_settings`, {
      method: 'POST',
      headers: {
        ...headers,
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify({
        user_id: session.user_id,
        ...settingsObj,
        updated_at: new Date().toISOString()
      })
    });

    return response.ok;
  } catch (error) {
    console.error('Supabase upsertUserSettings error:', error);
    return false;
  }
}

// ============================================================================
// SOCIAL GRAPH, PRESENCE & ROASTS API
// ============================================================================

/**
 * Send heartbeat to update user presence atomically
 */
export async function heartbeatPresence(status = 'online') {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return null;
  try {
    const session = await getAuthSession();
    if (!session?.user_id) return null;
    return await callRpc('heartbeat_presence', { p_status: status });
  } catch (err) {
    console.warn('[SupabaseClient] heartbeatPresence error:', err);
    return null;
  }
}

/**
 * Set user presence to offline explicitly on logout
 */
export async function setPresenceOffline() {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return null;
  try {
    const session = await getAuthSession();
    if (!session?.user_id) return null;
    return await callRpc('set_presence_offline');
  } catch (err) {
    return null;
  }
}

/**
 * Fetch online friends with active presence and battle status in single server query
 */
export async function getOnlineFriends() {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return [];
  try {
    const res = await callRpc('get_online_friends');
    return Array.isArray(res) ? res : [];
  } catch (err) {
    console.warn('[SupabaseClient] getOnlineFriends error:', err);
    return [];
  }
}

/**
 * Get map of presence statuses for specific usernames or all friends
 */
export async function getFriendsPresence(usernames = null) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return {};
  try {
    const res = await callRpc('get_friends_presence', { p_usernames: usernames });
    return res && typeof res === 'object' && !res.error ? res : {};
  } catch (err) {
    return {};
  }
}

/**
 * Synchronize friendship between authenticated user and target friend
 */
export async function syncFriendship(targetUsername) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE' || !targetUsername) return { success: false };
  try {
    const res = await callRpc('sync_friendship', { p_target_username: targetUsername.toLowerCase() });
    return res || { success: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Create battle challenge via server-authoritative RPC
 */
export async function createBattleChallenge(challengedUsername, language = 'javascript') {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE' || !challengedUsername) {
    return { success: false, error: 'Supabase configuration or username missing' };
  }
  try {
    return await callRpc('create_battle_challenge', {
      p_challenged_username: challengedUsername.toLowerCase(),
      p_language: language.toLowerCase()
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================================
// ROAST MESSAGES API (Normalized & Durable)
// ============================================================================

/**
 * Send a roast message to a recipient
 */
export async function sendRoast(targetUsername, fromUsername, message) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE' || !targetUsername || !message) return false;

  try {
    const session = await getAuthSession();
    if (!session?.user_id) {
      console.warn('[Roast] Authentication required to send cloud roasts');
      return false;
    }

    // 1. Try atomic server-side RPC first
    const rpcRes = await callRpc('send_roast', {
      p_recipient_username: targetUsername.toLowerCase(),
      p_content: message.substring(0, 500)
    });

    if (rpcRes && rpcRes.success) {
      return true;
    }

    // 2. Fallback to direct REST insert
    const targetProfile = await getProfile(targetUsername);
    if (!targetProfile?.id) {
      console.warn(`[Roast] Target user ${targetUsername} has not registered on Supabase`);
      return false;
    }

    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/rest/v1/roast_messages`, {
      method: 'POST',
      headers: {
        ...headers,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        sender_id: session.user_id,
        recipient_id: targetProfile.id,
        sender_username: fromUsername,
        recipient_username: targetUsername.toLowerCase(),
        content: message.substring(0, 500),
        status: 'sent',
        created_at: new Date().toISOString()
      })
    });

    return response.ok;
  } catch (error) {
    console.error('Error sending roast:', error);
    return false;
  }
}

/**
 * Fetch outstanding unread or undelivered roasts for a user
 */
export async function fetchUnreadRoasts(myUsername) {
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE' || !myUsername) return [];

  try {
    const session = await getAuthSession();
    if (!session) return [];

    const headers = await getAuthHeaders();
    const response = await fetch(
      `${BASE_URL}/rest/v1/roast_messages?recipient_username=eq.${myUsername.toLowerCase()}&status=neq.read&order=created_at.desc&limit=20`,
      { method: 'GET', headers }
    );

    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.warn('Error fetching unread roasts:', error);
    return [];
  }
}

/**
 * Mark roasts as delivered
 */
export async function markRoastsDelivered(messageIds) {
  if (!messageIds?.length || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return;

  try {
    const headers = await getAuthHeaders();
    const idList = messageIds.map(id => `"${id}"`).join(',');
    await fetch(`${BASE_URL}/rest/v1/roast_messages?id=in.(${idList})`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'delivered',
        delivered_at: new Date().toISOString()
      })
    });
  } catch {}
}

/**
 * Mark roasts as read
 */
export async function markRoastsRead(messageIds) {
  if (!messageIds?.length || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return;

  try {
    const headers = await getAuthHeaders();
    const idList = messageIds.map(id => `"${id}"`).join(',');
    await fetch(`${BASE_URL}/rest/v1/roast_messages?id=in.(${idList})`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'read',
        read_at: new Date().toISOString()
      })
    });
  } catch {}
}

/**
 * Clear all roasts for current user
 */
export async function clearRoasts(myUsername) {
  if (!myUsername || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') return true;

  try {
    const unread = await fetchUnreadRoasts(myUsername);
    if (!unread || unread.length === 0) return true;

    const ids = unread.map(r => r.id);
    await markRoastsRead(ids);
    return true;
  } catch (error) {
    console.error('Error clearing roasts:', error);
    return false;
  }
}
