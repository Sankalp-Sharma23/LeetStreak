function st(e, r = 1, t = 50) {
  return !e || typeof e != "string" ? { valid: !1, error: "Username is required" } : (e = e.trim(), e.length < r || e.length > t ? { valid: !1, error: `Username must be ${r}-${t} characters` } : /^[a-zA-Z0-9_-]+$/.test(e) ? { valid: !0, username: e.toLowerCase() } : { valid: !1, error: "Username contains invalid characters" });
}
class at {
  constructor(r, t) {
    this.maxCalls = r, this.windowMs = t, this.calls = [];
  }
  /**
   * Check if call is allowed
   * @returns {boolean} True if allowed
   */
  isAllowed() {
    const r = Date.now();
    return this.calls = this.calls.filter((t) => r - t < this.windowMs), this.calls.length < this.maxCalls ? (this.calls.push(r), !0) : !1;
  }
  /**
   * Get time until next call is allowed
   * @returns {number} Milliseconds until next call
   */
  getTimeUntilReset() {
    if (this.calls.length === 0) return 0;
    const r = Date.now(), t = this.calls[0], s = this.windowMs - (r - t);
    return Math.max(0, s);
  }
}
const ot = /* @__PURE__ */ new Set([
  "leetcode.com",
  "assets.leetcode.com"
]);
function nt(e, r) {
  try {
    const t = new URL(e);
    return t.protocol !== "https:" ? {
      valid: !1,
      reason: `Insecure transport: ${e} does not use HTTPS`
    } : (!ot.has(t.hostname) && !t.hostname.endsWith(".supabase.co") && console.warn(`[SecurityAuditor] Request to external domain: ${t.hostname}`), !r.headers?.get("strict-transport-security") && t.hostname === "leetcode.com" && console.warn(`[SecurityAuditor] Warning: Missing HSTS header on response from ${t.hostname}`), { valid: !0 });
  } catch (t) {
    return {
      valid: !1,
      reason: `Transport security audit failed: ${t.message}`
    };
  }
}
async function ct(e, r = {}) {
  if (!e.startsWith("https://"))
    throw new Error(`Security Violation: Insecure HTTP request blocked for ${e}`);
  const t = await fetch(e, r), s = nt(e, t);
  return s.valid || console.error(`[SecurityAuditor] Security policy failed: ${s.reason}`), t;
}
const V = "https://leetcode.com/graphql", it = 2, se = 6e3, pe = new at(30, 6e4);
function Se(e) {
  return new Promise((r) => setTimeout(r, e));
}
async function lt(e, r, t = it) {
  let s;
  if (!pe.isAllowed()) {
    const a = pe.getTimeUntilReset();
    throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(a / 1e3)} seconds.`);
  }
  for (let a = 0; a < t; a++)
    try {
      if (typeof navigator < "u" && !navigator.onLine)
        throw new Error("No internet connection. Please check your network.");
      const o = new AbortController(), n = setTimeout(() => o.abort(), se), i = await ct(e, {
        ...r,
        signal: o.signal
      });
      if (clearTimeout(n), i.status === 429) {
        const c = parseInt(i.headers.get("Retry-After")) || Math.pow(2, a);
        console.log(`[API] Rate limited. Retrying after ${c}s`), await Se(c * 1e3);
        continue;
      }
      return i;
    } catch (o) {
      if (s = o, o.name === "AbortError" && (console.error(`[API] Request timeout (${se}ms)`), s = new Error(`Request timed out after ${se / 1e3} seconds`)), o.message.includes("No internet connection"))
        throw o;
      if (a < t - 1) {
        const n = Math.pow(2, a) * 1e3;
        console.log(`[API] Retry ${a + 1}/${t} in ${n}ms`), await Se(n);
      }
    }
  throw s || new Error("Network request failed after multiple retries");
}
const ut = `
  query getUserProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile {
        realName
        userAvatar
        ranking
      }
      submitStats {
        acSubmissionNum {
          difficulty
          count
        }
      }
      submissionCalendar
    }
    userContestRanking(username: $username) {
      attendedContestsCount
      rating
      globalRanking
    }
  }
`, dt = `
  query getUserBadges($username: String!) {
    matchedUser(username: $username) {
      badges {
        id
        displayName
        icon
      }
    }
  }
`, ft = `
  query getRecentSubmissions($username: String!) {
    recentSubmissionList(username: $username, limit: 15) {
      title
      titleSlug
      timestamp
      statusDisplay
      lang
    }
  }
`, mt = `
  query allSubmissions($username: String!) {
    matchedUser(username: $username) {
      recentAcSubmissions(limit: 1000) {
        id
        title
        titleSlug
        timestamp
      }
    }
  }
`;
async function q(e) {
  try {
    console.log(`[API] Fetching data for user: ${e}`);
    const r = await lt(V, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: ut,
        variables: { username: e }
      })
    });
    if (console.log(`[API] Profile response status: ${r.status}`), !r.ok) {
      const c = await r.text();
      throw console.error("[API] Profile request failed:", r.status, c), new Error(`API request failed: ${r.status}`);
    }
    const t = await r.json();
    if (console.log("[API] Profile data received:", t), t.errors)
      throw console.error("[API] GraphQL errors:", t.errors), new Error(t.errors[0]?.message || "GraphQL error");
    if (!t.data?.matchedUser)
      throw console.error("[API] No matched user in response"), new Error("User not found or profile is private");
    const s = t.data.matchedUser, a = s.submissionCalendar ? JSON.parse(s.submissionCalendar) : {};
    let o = [];
    try {
      const c = await fetch(V, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: dt,
          variables: { username: e }
        })
      });
      c.ok && (o = (await c.json()).data?.matchedUser?.badges || []);
    } catch (c) {
      console.warn("[API] Failed to fetch badges:", c);
    }
    let n = [];
    try {
      const c = await fetch(V, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: ft,
          variables: { username: e }
        })
      });
      c.ok && (n = (await c.json()).data?.recentSubmissionList || []);
    } catch (c) {
      console.warn("[API] Failed to fetch recent submissions:", c);
    }
    let i = [];
    try {
      const c = await fetch(V, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: mt,
          variables: { username: e }
        })
      });
      if (c.ok) {
        const l = await c.json();
        l.errors ? console.warn("[API] All submissions query error:", l.errors) : (i = l.data?.matchedUser?.recentAcSubmissions || [], console.log(`[API] Fetched ${i.length} all-time accepted submissions (limit 1000)`), i.length > 0 && console.log("[API] Sample submissions:", i.slice(0, 5).map((u) => u.titleSlug)));
      }
    } catch (c) {
      console.warn("[API] Failed to fetch all submissions:", c);
    }
    return console.log(`[API] Successfully fetched data for ${e}`), {
      profile: {
        ...s,
        badges: o,
        recentSubmissions: n
      },
      allAcceptedSubmissions: i,
      contestRanking: t.data.userContestRanking,
      submissionCalendar: a
    };
  } catch (r) {
    throw console.error("Error fetching LeetCode data:", r), r;
  }
}
const Ee = { VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6c2xkY2pncGlvZHp1aXZyYnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NDYwODMsImV4cCI6MjEwMzEyMjA4M30.TuPkW7jnn9rScS2FhH1A8omsSIpABs6MEKfRbX1lzYU", VITE_SUPABASE_URL: "https://pzsldcjgpiodzuivrbwt.supabase.co" }, Ue = typeof import.meta < "u" && Ee ? Ee : typeof process < "u" && process.env ? process.env : {}, h = Ue.VITE_SUPABASE_URL || "YOUR_SUPABASE_PROJECT_URL_HERE", F = Ue.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY_HERE", T = h.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), f = {
  SESSION_LOADING: "SESSION_LOADING",
  AUTHENTICATED: "AUTHENTICATED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  AUTH_ERROR: "AUTH_ERROR"
};
let L = null, ae = f.SESSION_LOADING, be = null, W = 0;
const ht = /* @__PURE__ */ new Set();
function w(e, r = null) {
  ae = e, be = r;
  for (const t of ht)
    try {
      t(ae, L, be);
    } catch (s) {
      console.warn("[SupabaseClient] Error in auth listener callback:", s);
    }
}
function O() {
  return ae;
}
function H() {
  return Date.now() < W;
}
function ie() {
  return Math.max(0, Math.ceil((W - Date.now()) / 1e3));
}
function le(e = 60) {
  W = Date.now() + e * 1e3, typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ supabase_auth_cooldown_until: W }).catch(() => {
  });
}
async function A() {
  if (L && L.expires_at > Date.now())
    return L;
  if (typeof chrome < "u" && chrome.storage?.local)
    try {
      const e = await chrome.storage.local.get(["supabase_auth_session"]);
      if (e.supabase_auth_session && e.supabase_auth_session.expires_at > Date.now())
        return L = e.supabase_auth_session, L;
    } catch {
    }
  return null;
}
async function x(e) {
  if (L = e, typeof chrome < "u" && chrome.storage?.local)
    try {
      e ? await chrome.storage.local.set({ supabase_auth_session: e }) : await chrome.storage.local.remove(["supabase_auth_session"]);
    } catch {
    }
}
async function _t() {
  w(f.SESSION_LOADING);
  try {
    let e = null;
    if (typeof chrome < "u" && chrome.storage?.local) {
      const r = await chrome.storage.local.get(["supabase_auth_session", "supabase_auth_cooldown_until"]);
      r.supabase_auth_cooldown_until && r.supabase_auth_cooldown_until > Date.now() && (W = r.supabase_auth_cooldown_until), e = r.supabase_auth_session;
    } else
      e = L;
    if (!e)
      return w(f.AUTH_REQUIRED), null;
    if (e.expires_at && e.expires_at > Date.now() + 6e4)
      return L = e, w(f.AUTHENTICATED), L;
    if (e.refresh_token) {
      if (H())
        return w(f.AUTH_ERROR, "Authentication temporarily rate-limited. Please wait."), null;
      const r = await wt(e.refresh_token);
      if (r)
        return r;
    }
    return await x(null), w(f.SESSION_EXPIRED, "Session expired. Please sign in again."), null;
  } catch (e) {
    return console.warn("[SupabaseClient] Error restoring session:", e), w(f.AUTH_ERROR, e.message), null;
  }
}
async function wt(e) {
  if (H())
    return w(f.AUTH_ERROR, "Rate limited"), null;
  try {
    const r = await fetch(`${T}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: F
      },
      body: JSON.stringify({ refresh_token: e })
    });
    if (r.status === 429)
      return le(60), w(f.AUTH_ERROR, "Supabase authentication rate limit exceeded."), null;
    if (!r.ok)
      return await x(null), w(f.SESSION_EXPIRED, "Session expired or revoked."), null;
    const t = await r.json(), s = {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      user_id: t.user?.id,
      email: t.user?.email,
      expires_at: Date.now() + (t.expires_in ? t.expires_in * 1e3 : 3600 * 1e3)
    };
    return await x(s), w(f.AUTHENTICATED), s;
  } catch (r) {
    return console.warn("[SupabaseClient] Network error during token refresh:", r), w(f.AUTH_ERROR, r.message), null;
  }
}
async function gt(e, r) {
  if (H()) {
    const t = ie();
    throw new Error(`Rate limit cooldown active. Please wait ${t} seconds.`);
  }
  if (!e || !r)
    throw new Error("Email and password are required");
  try {
    const t = await fetch(`${T}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: F
      },
      body: JSON.stringify({ email: e, password: r })
    });
    if (t.status === 429)
      throw le(60), w(f.AUTH_ERROR, "Rate limit exceeded"), new Error("Email rate limit exceeded. Please wait 1 minute before retrying.");
    if (!t.ok) {
      const o = await t.text();
      let n = "Invalid email or password";
      try {
        const i = JSON.parse(o);
        n = i.error_description || i.msg || n;
      } catch {
      }
      throw new Error(n);
    }
    const s = await t.json(), a = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      user_id: s.user?.id,
      email: s.user?.email || e,
      expires_at: Date.now() + (s.expires_in ? s.expires_in * 1e3 : 3600 * 1e3)
    };
    return await x(a), w(f.AUTHENTICATED), a;
  } catch (t) {
    throw w(f.AUTH_ERROR, t.message), t;
  }
}
async function yt(e, r) {
  if (H()) {
    const t = ie();
    throw new Error(`Rate limit cooldown active. Please wait ${t} seconds.`);
  }
  if (!e || !r)
    throw new Error("Email and password are required");
  try {
    const t = await fetch(`${T}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: F
      },
      body: JSON.stringify({ email: e, password: r })
    });
    if (t.status === 429)
      throw le(60), w(f.AUTH_ERROR, "Rate limit exceeded"), new Error("Email signup rate limit exceeded. Please wait before retrying.");
    if (!t.ok) {
      const a = await t.text();
      let o = "Failed to create account";
      try {
        const n = JSON.parse(a);
        o = n.error_description || n.msg || o;
      } catch {
      }
      throw new Error(o);
    }
    const s = await t.json();
    if (s.access_token) {
      const a = {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        user_id: s.user?.id,
        email: s.user?.email || e,
        expires_at: Date.now() + (s.expires_in ? s.expires_in * 1e3 : 36e5)
      };
      return await x(a), w(f.AUTHENTICATED), { success: !0, session: a };
    }
    return w(f.AUTH_REQUIRED), {
      success: !0,
      confirmationRequired: !0,
      user: s.user,
      message: "Account created. Please check your inbox to confirm your email before signing in."
    };
  } catch (t) {
    throw w(f.AUTH_ERROR, t.message), t;
  }
}
async function pt() {
  try {
    const e = await A();
    e?.access_token && fetch(`${T}/auth/v1/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: F,
        Authorization: `Bearer ${e.access_token}`
      }
    }).catch(() => {
    });
  } catch {
  }
  return await x(null), w(f.AUTH_REQUIRED), { success: !0 };
}
async function R() {
  const r = (await A())?.access_token || F;
  return {
    "Content-Type": "application/json",
    apikey: F,
    Authorization: `Bearer ${r}`,
    Prefer: "return=representation"
  };
}
async function E(e, r = {}) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await R(), s = await fetch(`${T}/rest/v1/rpc/${e}`, {
      method: "POST",
      headers: t,
      body: JSON.stringify(r)
    });
    if (!s.ok) {
      const a = await s.text();
      console.error(`[SupabaseClient] RPC ${e} error:`, s.status, a);
      let o = null;
      try {
        o = JSON.parse(a);
      } catch {
      }
      return {
        success: !1,
        error: o?.message || o?.error_description || a,
        code: o?.code || null,
        raw: a
      };
    }
    return await s.json();
  } catch (t) {
    return console.error(`[SupabaseClient] RPC ${e} exception:`, t), { success: !1, error: t.message };
  }
}
async function Ne(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return null;
  try {
    const r = await R(), t = await fetch(
      `${T}/rest/v1/profiles?leetcode_username=ilike.${encodeURIComponent(e)}&select=*`,
      { method: "GET", headers: r }
    );
    if (!t.ok) return null;
    const s = await t.json();
    return s && s.length > 0 ? s[0] : null;
  } catch (r) {
    return console.error("Supabase getProfile error:", r), null;
  }
}
async function N(e, r) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return !1;
  try {
    const t = await A();
    if (!t?.user_id)
      return !1;
    const s = await R(), a = r?.stats || {}, o = r?.profile || {}, n = r?.contest || {}, i = {
      id: t.user_id,
      leetcode_username: e.toLowerCase(),
      display_name: o.realName || e,
      avatar_url: o.avatar || "",
      total_solved: a.total || 0,
      easy_solved: a.easy || 0,
      medium_solved: a.medium || 0,
      hard_solved: a.hard || 0,
      current_streak: a.streak || 0,
      longest_streak: a.longestStreak || 0,
      contest_rating: n.rating || 0,
      last_synced_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    return (await fetch(`${T}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        ...s,
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(i)
    })).ok;
  } catch (t) {
    return console.error("Supabase upsertProfile error:", t), !1;
  }
}
async function ee() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const e = await A();
    if (!e?.user_id) return null;
    const r = await R(), t = await fetch(
      `${T}/rest/v1/user_settings?user_id=eq.${e.user_id}&select=*`,
      { method: "GET", headers: r }
    );
    if (!t.ok) return null;
    const s = await t.json();
    return s && s.length > 0 ? s[0] : null;
  } catch (e) {
    return console.error("Supabase getUserSettings error:", e), null;
  }
}
async function Ie(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return !1;
  try {
    const r = await A();
    if (!r?.user_id) return !1;
    const t = await R();
    return (await fetch(`${T}/rest/v1/user_settings`, {
      method: "POST",
      headers: {
        ...t,
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({
        user_id: r.user_id,
        ...e,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      })
    })).ok;
  } catch (r) {
    return console.error("Supabase upsertUserSettings error:", r), !1;
  }
}
async function St() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    return (await A())?.user_id ? await E("set_presence_offline") : null;
  } catch {
    return null;
  }
}
async function Et() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  try {
    const e = await E("get_online_friends");
    return Array.isArray(e) ? e : [];
  } catch (e) {
    return console.warn("[SupabaseClient] getOnlineFriends error:", e), [];
  }
}
async function ue(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return { success: !1 };
  try {
    return await E("sync_friendship", { p_target_username: e.toLowerCase() }) || { success: !1 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function Pe(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return { success: !1 };
  try {
    return await E("remove_friendship", { p_target_username: e.toLowerCase() }) || { success: !1 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function $e() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  try {
    const e = await E("get_accepted_friends");
    return Array.isArray(e) ? e : e && Array.isArray(e.data) ? e.data : [];
  } catch (e) {
    return console.error("[SupabaseClient] getAcceptedFriends error:", e), [];
  }
}
async function bt() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const e = await E("get_own_profile");
    if (e && typeof e == "object" && e.id) return e;
    const r = await A();
    if (!r?.user_id) return null;
    const t = await R(), s = await fetch(
      `${T}/rest/v1/profiles?id=eq.${encodeURIComponent(r.user_id)}&select=*`,
      { method: "GET", headers: t }
    );
    if (!s.ok) return null;
    const a = await s.json();
    return a && a.length > 0 ? a[0] : null;
  } catch (e) {
    return console.error("[SupabaseClient] getOwnProfile error:", e), null;
  }
}
async function oe() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return { success: !1 };
  try {
    if (!(await A())?.user_id)
      return { success: !1, error: "No authenticated session" };
    const r = await bt();
    r?.leetcode_username && typeof chrome < "u" && chrome.storage?.local && await chrome.storage.local.set({
      my_leetcode_username: r.leetcode_username,
      own_profile: {
        username: r.leetcode_username,
        profile: {
          username: r.leetcode_username,
          realName: r.display_name || r.leetcode_username,
          avatar: r.avatar_url || ""
        },
        stats: {
          total: r.total_solved || 0,
          easy: r.easy_solved || 0,
          medium: r.medium_solved || 0,
          hard: r.hard_solved || 0,
          streak: r.current_streak || 0,
          longestStreak: r.longest_streak || 0
        },
        contest: {
          rating: r.contest_rating || 0
        },
        lastUpdated: r.last_synced_at ? new Date(r.last_synced_at).getTime() : Date.now()
      }
    });
    const t = await $e();
    if (typeof chrome < "u" && chrome.storage?.local) {
      const s = await chrome.storage.local.get(["friends_cache", "friends_list"]), a = s.friends_cache || {}, o = s.friends_list || [], n = { ...a }, i = new Set(o);
      for (const l of t) {
        const u = (l.leetcode_username || "").toLowerCase();
        u && (i.add(u), n[u] = {
          username: u,
          profile: {
            username: u,
            realName: l.display_name || u,
            avatar: l.avatar_url || ""
          },
          stats: {
            total: l.total_solved || 0,
            easy: l.easy_solved || 0,
            medium: l.medium_solved || 0,
            hard: l.hard_solved || 0,
            streak: l.current_streak || 0,
            longestStreak: l.longest_streak || 0
          },
          contest: {
            rating: l.contest_rating || 0
          },
          friend_id: l.friend_id,
          friendship_id: l.friendship_id,
          lastUpdated: l.last_synced_at ? new Date(l.last_synced_at).getTime() : Date.now()
        });
      }
      await chrome.storage.local.set({
        friends_cache: n,
        friends_list: Array.from(i)
      });
      const c = Object.keys(a).filter(
        (l) => !t.some((u) => (u.leetcode_username || "").toLowerCase() === l.toLowerCase())
      );
      if (c.length > 0)
        for (const l of c)
          ue(l).catch(() => {
          });
    }
    return {
      success: !0,
      restoredCount: t.length,
      ownProfile: r
    };
  } catch (e) {
    return console.error("[SupabaseClient] restoreAccountSocialData error:", e), { success: !1, error: e.message };
  }
}
async function Be(e, r, t) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e || !t) return !1;
  try {
    const s = await A();
    if (!s?.user_id)
      return console.warn("[Roast] Authentication required to send cloud roasts"), !1;
    const a = await E("send_roast", {
      p_recipient_username: e.toLowerCase(),
      p_content: t.substring(0, 500)
    });
    if (a && a.success)
      return !0;
    const o = await Ne(e);
    if (!o?.id)
      return console.warn(`[Roast] Target user ${e} has not registered on Supabase`), !1;
    const n = await R();
    return (await fetch(`${T}/rest/v1/roast_messages`, {
      method: "POST",
      headers: {
        ...n,
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        sender_id: s.user_id,
        recipient_id: o.id,
        sender_username: r,
        recipient_username: e.toLowerCase(),
        content: t.substring(0, 500),
        status: "sent",
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      })
    })).ok;
  } catch (s) {
    return console.error("Error sending roast:", s), !1;
  }
}
async function Me(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return [];
  try {
    if (!await A()) return [];
    const t = await R(), s = await fetch(
      `${T}/rest/v1/roast_messages?recipient_username=eq.${e.toLowerCase()}&status=neq.read&order=created_at.desc&limit=20`,
      { method: "GET", headers: t }
    );
    return s.ok ? await s.json() : [];
  } catch (r) {
    return console.warn("Error fetching unread roasts:", r), [];
  }
}
async function Tt(e) {
  if (!(!e?.length || h === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      const r = await R(), t = e.map((s) => `"${s}"`).join(",");
      await fetch(`${T}/rest/v1/roast_messages?id=in.(${t})`, {
        method: "PATCH",
        headers: r,
        body: JSON.stringify({
          status: "delivered",
          delivered_at: (/* @__PURE__ */ new Date()).toISOString()
        })
      });
    } catch {
    }
}
async function At(e) {
  if (!(!e?.length || h === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      const r = await R(), t = e.map((s) => `"${s}"`).join(",");
      await fetch(`${T}/rest/v1/roast_messages?id=in.(${t})`, {
        method: "PATCH",
        headers: r,
        body: JSON.stringify({
          status: "read",
          read_at: (/* @__PURE__ */ new Date()).toISOString()
        })
      });
    } catch {
    }
}
async function He(e) {
  if (!e || h === "YOUR_SUPABASE_PROJECT_URL_HERE") return !0;
  try {
    const r = await Me(e);
    if (!r || r.length === 0) return !0;
    const t = r.map((s) => s.id);
    return await At(t), !0;
  } catch (r) {
    return console.error("Error clearing roasts:", r), !1;
  }
}
async function Q() {
  return typeof chrome > "u" || !chrome.storage?.local ? null : (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username || null;
}
async function Y() {
  if (typeof chrome > "u" || !chrome.storage?.local) return null;
  try {
    return (await chrome.storage.local.get(["own_profile"])).own_profile || null;
  } catch (e) {
    return console.error("Error reading own profile from storage:", e), null;
  }
}
async function te(e) {
  if (typeof chrome > "u" || !chrome.storage?.local) return !1;
  try {
    await chrome.storage.local.set({
      own_profile: e,
      last_own_profile_sync: Date.now()
    });
    const r = await Q();
    return r && O() === f.AUTHENTICATED && N(r, e).catch((t) => {
      console.warn("[Storage] Cloud sync for own profile failed (non-blocking):", t);
    }), !0;
  } catch (r) {
    return console.error("Error saving own profile to storage:", r), !1;
  }
}
async function K() {
  try {
    const e = await Q(), r = typeof chrome < "u" && chrome.storage?.local ? await chrome.storage.local.get(["friends_cache", "own_profile", "friends_list"]) : {}, t = r.friends_cache || {}, s = r.own_profile || null, a = r.friends_list || [], o = { ...t };
    if (e && s && (o[e] = s), O() !== f.AUTHENTICATED)
      return o;
    try {
      const n = await $e();
      if (Array.isArray(n) && n.length > 0) {
        let i = !1;
        n.forEach((c) => {
          const l = (c.leetcode_username || "").toLowerCase();
          l && !o[l] && (o[l] = {
            username: l,
            profile: {
              username: l,
              realName: c.display_name || l,
              avatar: c.avatar_url || ""
            },
            stats: {
              total: c.total_solved || 0,
              easy: c.easy_solved || 0,
              medium: c.medium_solved || 0,
              hard: c.hard_solved || 0,
              streak: c.current_streak || 0,
              longestStreak: c.longest_streak || 0
            },
            contest: { rating: c.contest_rating || 0 },
            friend_id: c.friend_id,
            friendship_id: c.friendship_id,
            lastUpdated: c.last_synced_at ? new Date(c.last_synced_at).getTime() : Date.now()
          }, i = !0);
        }), i && typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ friends_cache: o }).catch(() => {
        });
      }
    } catch (n) {
      console.warn("[Storage] Permanent friends refresh skipped/failed:", n.message);
    }
    return o;
  } catch (e) {
    return console.error("Error getting friends:", e), {};
  }
}
async function de(e) {
  if (!e) return null;
  try {
    const r = await Q();
    if (r && e.toLowerCase() === r.toLowerCase())
      return await Y();
    if (typeof chrome < "u" && chrome.storage?.local) {
      const a = await chrome.storage.local.get(["friends_cache"]);
      if (a.friends_cache && a.friends_cache[e])
        return a.friends_cache[e];
    }
    const t = await Ne(e);
    if (!t) return null;
    const s = t.leetcode_data || {};
    return s.lastUpdated = t.last_synced_at ? new Date(t.last_synced_at).getTime() : Date.now(), s;
  } catch (r) {
    return console.error("Error getting single friend:", r), null;
  }
}
async function fe(e, r) {
  if (!e || !r) return { success: !1 };
  try {
    const t = await Q();
    if (t && e.toLowerCase() === t.toLowerCase())
      return await te(r), { success: !0 };
    if (typeof chrome < "u" && chrome.storage?.local) {
      const a = await chrome.storage.local.get(["friends_cache", "friends_list"]), o = a.friends_cache || {}, n = a.friends_list || [];
      o[e] = r;
      const i = n.includes(e) ? n : [...n, e];
      await chrome.storage.local.set({
        friends_cache: o,
        friends_list: i
      });
    }
    return O() === f.AUTHENTICATED && (N(e, r).catch(() => {
    }), t && ee().then((a) => {
      const o = a?.friends_list || [];
      o.includes(e) || Ie({ friends_list: [...o, e] }).catch(() => {
      });
    }).catch(() => {
    })), { success: !0 };
  } catch (t) {
    return console.error("Error saving friend:", t), { success: !1, error: t.message };
  }
}
async function kt(e) {
  if (!e) return !1;
  try {
    if (typeof chrome < "u" && chrome.storage?.local) {
      const r = await chrome.storage.local.get(["friends_cache", "friends_list"]), t = r.friends_cache || {}, s = r.friends_list || [];
      delete t[e];
      const a = s.filter((o) => o.toLowerCase() !== e.toLowerCase());
      await chrome.storage.local.set({
        friends_cache: t,
        friends_list: a
      });
    }
    return O() === f.AUTHENTICATED && (Pe(e).catch(() => {
    }), ee().then((r) => {
      if (r?.friends_list) {
        const t = r.friends_list.filter((s) => s.toLowerCase() !== e.toLowerCase());
        Ie({ friends_list: t }).catch(() => {
        });
      }
    }).catch(() => {
    })), !0;
  } catch (r) {
    return console.error("Error removing friend:", r), !1;
  }
}
async function Fe() {
  try {
    if (typeof chrome < "u" && chrome.storage?.local) {
      const e = await chrome.storage.local.get(["friends_list"]);
      if (e.friends_list && Array.isArray(e.friends_list))
        return e.friends_list;
    }
    if (O() === f.AUTHENTICATED) {
      const e = await ee();
      if (e?.friends_list)
        return typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ friends_list: e.friends_list }).catch(() => {
        }), e.friends_list;
    }
    return [];
  } catch (e) {
    return console.error("Error getting friends list:", e), [];
  }
}
async function Ct(e, r, t) {
  return await Be(e, r, t);
}
async function xe() {
  const e = await Q();
  return e ? await He(e) : !1;
}
const Rt = h.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), me = /* @__PURE__ */ new Set([
  "completed",
  "declined",
  "expired",
  "cancelled",
  "forfeited"
]), y = {
  PENDING: "pending",
  SELECTING: "selecting",
  READY_CHECK: "ready_check",
  COUNTDOWN: "countdown",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  DECLINED: "declined",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  FORFEITED: "forfeited"
}, vt = 7200, Dt = 1440 * 60, Te = 10;
async function b(e, r = {}) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await R(), { headers: s, ...a } = r, o = await fetch(`${Rt}/rest/v1/${e}`, {
      ...a,
      headers: { ...t, ...s || {} }
    });
    return o.ok ? o.json() : (console.error(`[Battle] Supabase error ${o.status} on ${e}:`, await o.text()), null);
  } catch (t) {
    return console.error("[Battle] Supabase fetch error:", t), null;
  }
}
async function Lt(e, r, t = "javascript") {
  if (!e || !r)
    return { success: !1, error: "Challenger and opponent usernames are required" };
  if (e.toLowerCase() === r.toLowerCase())
    return { success: !1, error: "Cannot challenge yourself" };
  try {
    const d = await Y();
    e && d && await N(e, d);
  } catch {
  }
  try {
    const d = await E("create_battle_challenge", {
      p_challenged_username: r.toLowerCase(),
      p_language: t.toLowerCase(),
      p_challenger_username: e.toLowerCase()
    });
    if (d && d.success && d.battle)
      return { success: !0, battle: d.battle };
    const m = d?.code === "PGRST202" || d?.error && typeof d.error == "string" && (d.error.includes("PGRST202") || d.error.includes("schema cache") || d.error.includes("Could not find the function")) || d?.raw && typeof d.raw == "string" && (d.raw.includes("PGRST202") || d.raw.includes("schema cache")), k = d?.error && typeof d.error == "string" && d.error.toLowerCase().includes("challenger profile not found");
    if (m || k)
      console.warn("[BattleManager] RPC fallback triggered (missing RPC or profile). Executing REST fallback.");
    else if (d && d.error) {
      let S = d.error;
      try {
        const v = JSON.parse(d.error);
        S = v.message || v.error || S;
      } catch {
      }
      return { success: !1, error: S };
    }
  } catch (d) {
    console.warn("[BattleManager] create_battle_challenge RPC error, using REST fallback:", d);
  }
  const [s, a] = await Promise.all([
    X(e),
    X(r)
  ]);
  if (s)
    return { success: !1, error: "You already have an active battle in progress" };
  if (a)
    return { success: !1, error: `${r} is currently in an active battle` };
  const o = await A(), n = await b(`profiles?leetcode_username=in.("${e.toLowerCase()}","${r.toLowerCase()}")&select=id,leetcode_username`);
  let i = n?.find((d) => d.leetcode_username.toLowerCase() === e.toLowerCase()), c = n?.find((d) => d.leetcode_username.toLowerCase() === r.toLowerCase());
  if (!i && o?.user_id) {
    const d = await Y();
    await N(e, d || { profile: { realName: e } }), i = { id: o.user_id, leetcode_username: e.toLowerCase() };
  }
  const l = o?.user_id || i?.id, u = c?.id, _ = Date.now(), p = new Date(_ + Dt * 1e3).toISOString(), g = {
    challenger_username: e,
    challenged_username: r,
    language: t.toLowerCase(),
    status: y.PENDING,
    expires_at: p
  };
  l && (g.challenger_id = l), u && (g.challenged_id = u);
  const C = await b("battles", {
    method: "POST",
    body: JSON.stringify(g)
  });
  return !C || C.length === 0 ? { success: !1, error: "Failed to create battle room" } : { success: !0, battle: C[0] };
}
async function X(e) {
  if (!e) return null;
  const r = Array.from(me).join(","), t = e.toLowerCase(), s = await b(
    `battles?or=(challenger_username.ilike.${t},challenged_username.ilike.${t})&status=not.in.(${r})&order=created_at.desc&limit=1`
  );
  if (!s || s.length === 0) return null;
  const a = s[0];
  return a.status === y.COUNTDOWN && a.match_starts_at && new Date(a.match_starts_at) <= /* @__PURE__ */ new Date() && (a.status = y.IN_PROGRESS, b(`battles?id=eq.${a.id}&status=eq.countdown`, {
    method: "PATCH",
    body: JSON.stringify({ status: y.IN_PROGRESS })
  }).catch(() => {
  })), a;
}
async function I(e) {
  if (!e) return null;
  const r = await b(`battles?id=eq.${e}&select=*`);
  return r && r.length > 0 ? r[0] : null;
}
async function he(e) {
  return e ? await b(`battle_results?battle_id=eq.${e}&select=*`) || [] : [];
}
async function Ot(e, r, t) {
  const s = await I(e);
  if (!s) return { success: !1, error: "Battle not found" };
  if ((s.challenged_username || s.challenged).toLowerCase() !== r.toLowerCase())
    return { success: !1, error: "You are not the invited opponent for this battle" };
  if (s.status !== y.PENDING)
    return { success: !1, error: `Battle is no longer pending (current: ${s.status})` };
  if (new Date(s.expires_at) < /* @__PURE__ */ new Date())
    return await J(e, y.EXPIRED), { success: !1, error: "Challenge has expired" };
  if (!t)
    return await J(e, y.DECLINED), { success: !0, battle: { ...s, status: y.DECLINED } };
  const o = /* @__PURE__ */ new Date(), n = await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: y.SELECTING,
      accepted_at: o.toISOString()
    })
  });
  return !n || n.length === 0 ? { success: !1, error: "Failed to accept battle" } : { success: !0, battle: n[0] };
}
async function Ut(e, r, t, s) {
  const a = await I(e);
  if (!a) return { success: !1, error: "Battle not found" };
  if (a.status !== y.SELECTING)
    return { success: !1, error: "Battle is not in the problem selection phase" };
  const o = await qe(t);
  if (!o.valid)
    return { success: !1, error: o.error || "Invalid LeetCode problem" };
  const i = (a.challenger_username || a.challenger).toLowerCase() === r.toLowerCase(), c = i ? "challenger_pick" : "challenged_pick", l = i ? "challenger_pick_title" : "challenged_pick_title", u = i ? a.challenged_pick : a.challenger_pick, _ = i ? a.challenged_pick_title : a.challenger_pick_title, p = {
    [c]: o.slug,
    [l]: o.title || s || o.slug
  };
  u && Object.assign(p, {
    problem_1: o.slug,
    problem_1_title: o.title,
    problem_2: u,
    problem_2_title: _ || u,
    status: y.READY_CHECK,
    challenger_ready: !1,
    challenged_ready: !1
  });
  const g = await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify(p)
  });
  return !g || g.length === 0 ? { success: !1, error: "Failed to save problem selection" } : {
    success: !0,
    battle: g[0],
    bothPicked: !!u
  };
}
async function Nt(e, r) {
  const t = await E("confirm_battle_ready", { p_battle_id: e });
  if (t && t.success)
    return { success: !0, battle: await I(e), bothReady: t.status === y.COUNTDOWN };
  const s = await I(e);
  if (!s) return { success: !1, error: "Battle not found" };
  const o = (s.challenger_username || s.challenger).toLowerCase() === r.toLowerCase(), n = o ? { challenger_ready: !0 } : { challenged_ready: !0 }, i = o ? s.challenged_ready : s.challenger_ready;
  if (i) {
    const l = Date.now(), u = new Date(l).toISOString(), _ = new Date(l + Te * 1e3).toISOString(), p = new Date(l + (Te + vt) * 1e3).toISOString();
    Object.assign(n, {
      status: y.COUNTDOWN,
      countdown_starts: u,
      match_starts_at: _,
      match_deadline: p
    });
  }
  const c = await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify(n)
  });
  return !c || c.length === 0 ? { success: !1, error: "Failed to record readiness" } : { success: !0, battle: c[0], bothReady: !!i };
}
async function It(e, r, t) {
  const {
    problemSlug: s,
    submissionId: a,
    accepted: o,
    runtime_ms: n,
    memory_mb: i,
    language: c,
    timeTakenSeconds: l
  } = t, u = await I(e);
  if (!u) return { success: !1, error: "Battle not found" };
  if (me.has(u.status))
    return { success: !1, error: `Battle is already closed (${u.status})` };
  const _ = u.match_starts_at ? new Date(u.match_starts_at).getTime() : Date.now(), p = l ?? Math.max(0, Math.floor((Date.now() - _) / 1e3)), g = await E("record_battle_submission", {
    p_battle_id: e,
    p_problem_slug: s,
    p_submission_id: a || `sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    p_accepted: !!o,
    p_time_taken: p,
    p_runtime_ms: n || null,
    p_memory_mb: i || null,
    p_language: c || u.language || "javascript"
  });
  if (g && g.success)
    return { success: !0, result: g };
  const C = await b("battle_results", {
    method: "POST",
    body: JSON.stringify({
      battle_id: e,
      username: r,
      problem_slug: s,
      leetcode_submission_id: a || `sub_${Date.now()}`,
      accepted: !!o,
      submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
      time_taken_seconds: p,
      runtime_ms: n || null,
      memory_mb: i || null,
      language: c || u.language || "javascript",
      attempts: 1,
      points: o ? 1 : 0
    })
  });
  return await Pt(e), { success: !0, result: C?.[0] };
}
async function Pt(e) {
  const r = await E("evaluate_and_finalize_battle", { p_battle_id: e });
  if (r && r.finalized)
    return r;
  const t = await I(e);
  if (!t || me.has(t.status)) return null;
  const s = await he(e), a = t.challenger_username || t.challenger, o = t.challenged_username || t.challenged;
  let n = 0, i = 0, c = 0, l = 0, u = !1, _ = !1, p = !1, g = !1;
  for (const m of s)
    m.accepted && (m.username.toLowerCase() === a.toLowerCase() ? (n += m.points || 1, c += m.time_taken_seconds || 0, m.problem_slug === t.problem_1 && (u = !0), m.problem_slug === t.problem_2 && (_ = !0)) : m.username.toLowerCase() === o.toLowerCase() && (i += m.points || 1, l += m.time_taken_seconds || 0, m.problem_slug === t.problem_1 && (p = !0), m.problem_slug === t.problem_2 && (g = !0)));
  const C = u && _ && p && g, d = t.match_deadline && Date.now() >= new Date(t.match_deadline).getTime();
  if (C || d) {
    let m = "draw", k = "draw";
    return n > i ? (m = a, k = "points") : i > n ? (m = o, k = "points") : n > 0 ? c < l ? (m = a, k = "tiebreaker_time") : l < c ? (m = o, k = "tiebreaker_time") : (m = "draw", k = "draw") : (m = "draw", k = "draw"), await J(e, y.COMPLETED, {
      winner_username: m,
      win_reason: k,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    }), { finalized: !0, winner: m, winReason: k };
  }
  return null;
}
async function $t(e, r) {
  const t = await E("forfeit_battle", { p_battle_id: e });
  if (t && t.success)
    return t;
  const s = await I(e);
  if (!s) return { success: !1, error: "Battle not found" };
  const a = s.challenger_username || s.challenger, o = s.challenged_username || s.challenged, n = a.toLowerCase() === r.toLowerCase() ? o : a;
  return await J(e, y.FORFEITED, {
    winner_username: n,
    win_reason: "forfeit",
    completed_at: (/* @__PURE__ */ new Date()).toISOString()
  }), { success: !0, winner: n };
}
async function Bt(e, r) {
  const t = await I(e);
  return t ? (t.challenger_username || t.challenger).toLowerCase() !== r.toLowerCase() ? { success: !1, error: "Only the challenger can cancel a pending match" } : t.status !== y.PENDING ? { success: !1, error: "Can only cancel pending challenges" } : (await J(e, y.CANCELLED), { success: !0 }) : { success: !1, error: "Battle not found" };
}
async function Mt(e, r = 10) {
  if (!e) return [];
  const t = e.toLowerCase(), s = await b(
    `battles?or=(challenger_username.ilike.${t},challenged_username.ilike.${t})&status=in.(completed,forfeited)&order=created_at.desc&limit=${r}`
  );
  return !s || s.length === 0 ? [] : await Promise.all(s.map(async (o) => {
    const n = await he(o.id), i = o.challenger_username || o.challenger, c = o.challenged_username || o.challenged, l = i.toLowerCase() === e.toLowerCase() ? c : i, u = o.winner_username || o.winner;
    let _ = "draw";
    return u && (u === "draw" ? _ = "draw" : u.toLowerCase() === e.toLowerCase() ? _ = "win" : _ = "loss"), {
      ...o,
      opponent: l,
      outcome: _,
      results: n
    };
  }));
}
async function qe(e) {
  try {
    let r = e.trim();
    if (r.includes("leetcode.com/problems/")) {
      const o = r.match(/problems\/([^/?#]+)/);
      if (!o) return { valid: !1, error: "Invalid LeetCode URL structure" };
      r = o[1].replace(/\/$/, "");
    }
    if (!/^[a-z0-9-]+$/i.test(r))
      return { valid: !1, error: "Invalid problem slug format" };
    const t = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query getProblem($slug: String!) {
          question(titleSlug: $slug) {
            title
            difficulty
            isPaidOnly
          }
        }`,
        variables: { slug: r.toLowerCase() }
      })
    });
    if (!t.ok) return { valid: !1, error: "Failed to contact LeetCode API" };
    const a = (await t.json())?.data?.question;
    return a ? a.isPaidOnly ? { valid: !1, error: "Premium problem — please select a free problem" } : {
      valid: !0,
      slug: r.toLowerCase(),
      title: a.title,
      difficulty: a.difficulty,
      url: `https://leetcode.com/problems/${r.toLowerCase()}/`
    } : { valid: !1, error: "Problem not found on LeetCode" };
  } catch (r) {
    return console.warn("[Battle] validateLeetCodeProblem error:", r), { valid: !1, error: "Connection error while validating problem" };
  }
}
async function Z(e, r = "online") {
  if (!(!e || !h || h === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      let t = await E("heartbeat_presence", {
        p_status: r,
        p_username: e.toLowerCase()
      });
      if (t && t.success) return;
      if (t?.code === "PGRST202" || typeof t?.error == "string" && t.error.includes("PGRST202")) {
        const a = await E("heartbeat_presence", { p_status: r });
        if (a && (a.success || a === !0)) return;
      }
      const s = await A();
      s?.user_id && await b("user_presence", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          user_id: s.user_id,
          username: e.toLowerCase(),
          last_seen: (/* @__PURE__ */ new Date()).toISOString(),
          status: r
        })
      });
    } catch (t) {
      console.warn("[BattleManager] updatePresence failed:", t);
    }
}
async function Ht(e) {
  const r = /* @__PURE__ */ new Map();
  if (!e?.length || !h || h === "YOUR_SUPABASE_PROJECT_URL_HERE") return r;
  try {
    const t = await E("get_friends_presence", { p_usernames: e });
    if (t && typeof t == "object" && !t.error) {
      for (const [n, i] of Object.entries(t))
        r.set(n.toLowerCase(), {
          status: i.status || "offline",
          isOnline: !!i.isOnline,
          inBattle: !!i.inBattle,
          last_seen: i.last_seen
        });
      return r;
    }
    const s = e.map((n) => `"${n.toLowerCase()}"`).join(","), a = await b(`user_presence?username=in.(${s})&select=username,status,last_seen,in_battle`), o = Date.now() - 120 * 1e3;
    for (const n of a || []) {
      const c = n.last_seen && new Date(n.last_seen).getTime() > o ? n.in_battle ? "in_battle" : n.status || "online" : "offline";
      r.set(n.username.toLowerCase(), {
        status: c,
        isOnline: c === "online" || c === "in_battle",
        inBattle: c === "in_battle",
        last_seen: n.last_seen
      });
    }
  } catch (t) {
    console.warn("[BattleManager] getPresence failed:", t);
  }
  return r;
}
async function J(e, r, t = {}) {
  await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify({ status: r, ...t })
  });
}
function Ft(e) {
  const r = st(e);
  if (!r.valid)
    throw new Error(r.error);
  return r.username;
}
function P(e, r) {
  const t = typeof e == "string" ? parseInt(e, 10) : e;
  if (isNaN(t) || t <= 0) return "";
  const s = r || (typeof Intl < "u" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC") || "UTC";
  try {
    const a = new Date(t * 1e3);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: s,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(a);
  } catch {
    return new Date(t * 1e3).toISOString().split("T")[0];
  }
}
function We(e = [], r = null, t = null) {
  const s = /* @__PURE__ */ new Set();
  if (Array.isArray(e)) {
    for (const a of e)
      if (a && a.timestamp) {
        const o = P(a.timestamp, t);
        o && s.add(o);
      }
  }
  if (r)
    try {
      const a = typeof r == "string" ? JSON.parse(r) : r;
      if (a && typeof a == "object") {
        for (const [o, n] of Object.entries(a))
          if (parseInt(n, 10) > 0) {
            const i = P(o, t);
            i && s.add(i);
          }
      }
    } catch (a) {
      console.warn("[StreakCalculator] Error parsing submissionCalendar:", a);
    }
  return Array.from(s).sort();
}
function xt(e, r = null, t = null) {
  let s = [], a = null;
  Array.isArray(e) ? (s = e, a = r) : e && typeof e == "object" && (a = e, typeof r == "string" && (t = r));
  const o = We(s, a, t);
  if (o.length === 0)
    return {
      currentStreak: 0,
      longestStreak: 0,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: []
    };
  function n(S, v) {
    const tt = /* @__PURE__ */ new Date(S + "T00:00:00Z"), rt = /* @__PURE__ */ new Date(v + "T00:00:00Z");
    return Math.round((rt - tt) / 864e5);
  }
  let i = 1, c = 1;
  for (let S = 1; S < o.length; S++) {
    const v = n(o[S - 1], o[S]);
    v === 1 ? (c++, c > i && (i = c)) : v > 1 && (c = 1);
  }
  const l = Math.floor(Date.now() / 1e3), u = P(l, t), _ = Math.floor((Date.now() - 864e5) / 1e3), p = P(_, t), g = o.includes(u), C = o[o.length - 1];
  if (C !== u && C !== p)
    return {
      currentStreak: 0,
      longestStreak: i,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: o
    };
  let d = 0, m = /* @__PURE__ */ new Date(C + "T00:00:00Z");
  for (let S = o.length - 1; S >= 0; S--) {
    const v = m.toISOString().split("T")[0];
    if (o[S] === v)
      d++, m.setUTCDate(m.getUTCDate() - 1);
    else if (o[S] < v)
      break;
  }
  d > i && (i = d);
  const k = d > 0 && !g;
  return {
    currentStreak: d,
    longestStreak: i,
    isAtRisk: k,
    solvedToday: g,
    solveDates: o
  };
}
function Ye(e, r = null, t = null) {
  const s = We(e, r, t), a = Math.floor(Date.now() / 1e3), o = P(a, t);
  return s.includes(o);
}
function qt(e) {
  const r = { easy: 0, medium: 0, hard: 0, total: 0 };
  if (!Array.isArray(e)) return r;
  for (const t of e) {
    const s = typeof t.count == "number" ? t.count : parseInt(t.count, 10) || 0;
    switch (t.difficulty) {
      case "Easy":
        r.easy = s;
        break;
      case "Medium":
        r.medium = s;
        break;
      case "Hard":
        r.hard = s;
        break;
      case "All":
        r.total = s;
        break;
    }
  }
  return r.total === 0 && (r.easy > 0 || r.medium > 0 || r.hard > 0) && (r.total = r.easy + r.medium + r.hard), r;
}
function ne(e) {
  return e ? Date.now() - e > 900 * 1e3 : !0;
}
const j = "leetfriends_notifications", Ae = {
  QUEUED: "QUEUED",
  DISPLAY_REQUESTED: "DISPLAY_REQUESTED",
  FAILED: "FAILED",
  IN_APP_ONLY: "IN_APP_ONLY",
  DISMISSED: "DISMISSED",
  CLICKED: "CLICKED"
};
async function Je() {
  try {
    return (await chrome.storage.local.get(j))[j] || {
      mutedUntilUTC: null,
      snoozedUntil: null,
      quietHours: { enabled: !1, start: "22:00", end: "08:00" },
      lastNotified: {},
      recentHashes: {}
    };
  } catch (e) {
    return console.error("[NotificationManager] Error getting notification state:", e), {
      mutedUntilUTC: null,
      snoozedUntil: null,
      quietHours: { enabled: !1, start: "22:00", end: "08:00" },
      lastNotified: {},
      recentHashes: {}
    };
  }
}
async function je() {
  try {
    const e = await chrome.storage.local.get([
      "notifications_enabled",
      j
    ]);
    if (e.notifications_enabled === !1)
      return !0;
    const r = e[j];
    if (!r) return !1;
    const t = Date.now();
    if (r.snoozedUntil && t < r.snoozedUntil)
      return !0;
    if (r.mutedUntilUTC) {
      const s = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      if (r.mutedUntilUTC >= s) return !0;
    }
    if (r.quietHours && r.quietHours.enabled) {
      const s = (/* @__PURE__ */ new Date()).getHours() * 60 + (/* @__PURE__ */ new Date()).getMinutes(), [a, o] = (r.quietHours.start || "22:00").split(":").map(Number), [n, i] = (r.quietHours.end || "08:00").split(":").map(Number), c = a * 60 + o, l = n * 60 + i;
      if (c > l) {
        if (s >= c || s < l)
          return !0;
      } else if (s >= c && s < l)
        return !0;
    }
    return !1;
  } catch (e) {
    return console.warn("[NotificationManager] isNotificationMuted error:", e), !1;
  }
}
async function Wt(e) {
  const r = await Je();
  r.mutedUntilUTC = e, await chrome.storage.local.set({ [j]: r });
}
async function Ge(e) {
  if (!(!Array.isArray(e) || e.length === 0))
    try {
      const r = await je(), t = Date.now(), a = (await chrome.storage.local.get("unread_notifications")).unread_notifications || [], o = e.map((c, l) => ({
        ...c,
        id: `${t}-${l}`,
        timestamp: t,
        deliveryState: r ? Ae.IN_APP_ONLY : Ae.DISPLAY_REQUESTED
      })), n = t - 1440 * 60 * 1e3, i = [...a, ...o].filter((c) => c.timestamp > n).slice(-30);
      if (await chrome.storage.local.set({ unread_notifications: i }), r) {
        console.log("[NotificationManager] Notifications muted; recorded for in-app display only.");
        return;
      }
      for (const c of e)
        try {
          let l = "LeetStreak";
          c.type === "new_submission" ? l = "🎯 Friend Solved a Problem!" : c.type === "milestone" ? l = "🔥 Streak Milestone Reached!" : c.type === "streak_at_risk" ? l = "⚠️ Streak At Risk!" : c.type === "battle_invite" ? l = "⚔️ 1v1 Battle Challenge!" : c.type === "battle_opponent_solved" ? l = "⚔️ Opponent Solved a Problem!" : c.type === "roast" && (l = "🔥 Motivation Roast Received!");
          const u = `leetstreak-${c.type}-${t}-${Math.floor(Math.random() * 1e3)}`;
          await chrome.notifications.create(u, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon128.png"),
            title: l,
            message: c.message || "",
            priority: c.priority || 2,
            requireInteraction: c.type === "streak_at_risk" || c.type === "battle_invite"
          });
        } catch (l) {
          console.warn("[NotificationManager] chrome.notifications.create failed:", l);
        }
    } catch (r) {
      console.error("[NotificationManager] Error in batchNotify:", r);
    }
}
const Yt = () => (/* @__PURE__ */ new Date()).toISOString().split("T")[0], Jt = () => {
  const e = /* @__PURE__ */ new Date();
  return e.setUTCDate(e.getUTCDate() - 1), e.toISOString().split("T")[0];
};
function jt(e) {
  return [7, 30, 100].includes(e);
}
function Gt(e, r) {
  if (r === 0) return !1;
  const t = Jt(), s = Yt();
  return !(Array.isArray(e) ? e : []).some((n) => {
    const i = parseInt(n.timestamp, 10);
    if (isNaN(i) || i <= 0) return !1;
    const c = new Date(i * 1e3).toISOString().split("T")[0];
    return c === s || c === t;
  });
}
function zt(e, r, t) {
  switch (r) {
    case "solved_today":
      return `${e} solved today! 🎯`;
    case "milestone":
      return `${e} hit ${t.streak} day streak! 🔥`;
    case "streak_at_risk":
      return `Your ${t.streak} day streak needs attention! ⚠️`;
    default:
      return `${e} updated their progress`;
  }
}
const ke = 1.7, Ce = 30, Re = 19, ve = 4, De = "schedule_preferences";
async function re() {
  try {
    return (await chrome.storage.local.get(De))[De] || {
      activeInterval: ke,
      quietInterval: Ce,
      activeStartHour: Re,
      activeEndHour: ve
    };
  } catch (e) {
    return console.error("Error loading schedule preferences:", e), {
      activeInterval: ke,
      quietInterval: Ce,
      activeStartHour: Re,
      activeEndHour: ve
    };
  }
}
async function _e(e = null) {
  e || (e = await re());
  const t = (/* @__PURE__ */ new Date()).getHours(), { activeStartHour: s, activeEndHour: a } = e;
  return s > a ? t >= s || t < a : t >= s && t < a;
}
async function we() {
  const e = await re();
  return await _e(e) ? e.activeInterval : e.quietInterval;
}
async function Qt() {
  const e = await re(), r = /* @__PURE__ */ new Date(), t = r.getHours(), s = r.getMinutes();
  let a;
  await _e(e) ? a = e.activeEndHour : a = e.activeStartHour;
  let o = a - t;
  return o < 0 && (o += 24), o === 0 && s > 0 && (o = 24), o * 60 - s;
}
async function ge() {
  const e = await re(), r = await we(), t = await _e(e), s = Le(e.activeStartHour), a = Le(e.activeEndHour);
  return t ? `Active Mode: Checking every ${r} minutes (${s} - ${a})` : `Quiet Mode: Checking every ${r} minutes`;
}
async function Vt() {
  const e = await we(), r = await Qt(), t = Math.min(e, r);
  return {
    intervalMinutes: t,
    description: await ge(),
    isTransitionCheck: t === r && t < e
  };
}
function Le(e) {
  return e === 0 ? "12:00 AM" : e < 12 ? `${e}:00 AM` : e === 12 ? "12:00 PM" : `${e - 12}:00 PM`;
}
const ze = [
  // Messaging & Chat Distractions
  "whatsapp.com",
  "web.whatsapp.com",
  "telegram.org",
  "web.telegram.org",
  "discord.com",
  "messenger.com",
  "snapchat.com",
  // Social Feeds & Doomscrolling
  "tiktok.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "threads.net",
  "reddit.com",
  "old.reddit.com",
  "9gag.com",
  "pinterest.com",
  "bsky.app",
  "tumblr.com",
  // Streaming & Live Video
  "netflix.com",
  "twitch.tv",
  "kick.com",
  "hotstar.com",
  "disneyplus.com",
  "primevideo.com",
  "hulu.com",
  "max.com",
  "crunchyroll.com",
  // Casual Gaming & Distractions
  "chess.com",
  "lichess.org",
  "geoguessr.com",
  "store.steampowered.com",
  "roblox.com"
], Qe = [
  {
    domain: "youtube.com",
    paths: ["/shorts", "/feed/explore"],
    label: "YouTube Shorts"
  },
  {
    domain: "m.youtube.com",
    paths: ["/shorts", "/feed/explore"],
    label: "YouTube Shorts (Mobile)"
  },
  {
    domain: "facebook.com",
    paths: ["/reel", "/watch"],
    label: "Facebook Reels"
  },
  {
    domain: "m.facebook.com",
    paths: ["/reel", "/watch"],
    label: "Facebook Reels (Mobile)"
  },
  {
    domain: "linkedin.com",
    paths: ["/feed"],
    label: "LinkedIn Feed"
  }
], Ve = [
  {
    domain: "youtube.com",
    allowedPrefixes: ["/watch", "/playlist", "/@", "/channel", "/c"]
  },
  {
    domain: "m.youtube.com",
    allowedPrefixes: ["/watch", "/playlist", "/@", "/channel", "/c"]
  },
  {
    domain: "linkedin.com",
    allowedPrefixes: ["/jobs", "/messaging", "/in"]
  }
];
function B(e) {
  return e ? e.toLowerCase().replace(/^(www\.|m\.)/, "") : "";
}
function U(e, r = {}) {
  const { customBlocked: t = [], allowlist: s = [] } = r;
  if (!e || typeof e != "string")
    return { isDistraction: !1, reason: "INVALID_URL", label: "" };
  if (e.includes("blocked.html") || e.startsWith("chrome-extension:") || e.startsWith("chrome:"))
    return { isDistraction: !1, reason: "SYSTEM_INTERNAL_PAGE", label: "" };
  let a;
  try {
    a = new URL(e);
  } catch {
    return { isDistraction: !1, reason: "PARSE_ERROR", label: "" };
  }
  if (a.protocol !== "http:" && a.protocol !== "https:")
    return { isDistraction: !1, reason: "NON_HTTP_PROTOCOL", label: "" };
  const o = a.hostname.toLowerCase(), n = B(o);
  if (n.includes("leetcode.com"))
    return { isDistraction: !1, reason: "SYSTEM_ALLOW_LEETCODE", label: "LeetCode" };
  for (const i of s) {
    if (!i) continue;
    const c = i.trim().toLowerCase();
    if (e.toLowerCase().includes(c) || n === B(c))
      return { isDistraction: !1, reason: "USER_ALLOWLIST", label: i };
  }
  for (const i of Ve)
    if (n === B(i.domain)) {
      for (const c of i.allowedPrefixes)
        if (a.pathname.startsWith(c))
          return { isDistraction: !1, reason: "EDUCATIONAL_EXCEPTION", label: `${i.domain}${c}` };
    }
  for (const i of Qe)
    if (n === B(i.domain)) {
      for (const c of i.paths)
        if (a.pathname.startsWith(c))
          return { isDistraction: !0, reason: "PATH_DISTRACTION", label: i.label };
    }
  for (const i of t) {
    if (!i) continue;
    const c = B(i.trim().toLowerCase());
    if (n === c || n.endsWith("." + c))
      return { isDistraction: !0, reason: "CUSTOM_BLOCKED_DOMAIN", label: c };
  }
  for (const i of ze) {
    const c = B(i);
    if (n === c || n.endsWith("." + c))
      return { isDistraction: !0, reason: "DEFAULT_BLOCKED_DOMAIN", label: c };
  }
  return { isDistraction: !1, reason: "UNRESTRICTED", label: "" };
}
function Kt(e = {}) {
  const { customBlocked: r = [], allowlist: t = [] } = e, s = [];
  let a = 1e3;
  s.push({
    id: a++,
    priority: 10,
    action: { type: "allow" },
    condition: {
      requestDomains: ["leetcode.com"],
      resourceTypes: ["main_frame"]
    }
  });
  for (const n of t) {
    if (!n || !n.trim()) continue;
    const i = n.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    s.push({
      id: a++,
      priority: 5,
      action: { type: "allow" },
      condition: {
        requestDomains: [i],
        resourceTypes: ["main_frame"]
      }
    });
  }
  for (const n of Ve)
    for (const i of n.allowedPrefixes)
      s.push({
        id: a++,
        priority: 3,
        action: { type: "allow" },
        condition: {
          requestDomains: [n.domain],
          urlFilter: `*${i}*`,
          resourceTypes: ["main_frame"]
        }
      });
  for (const n of Qe)
    for (const i of n.paths)
      s.push({
        id: a++,
        priority: 2,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html" }
        },
        condition: {
          requestDomains: [n.domain],
          urlFilter: `*${i}*`,
          resourceTypes: ["main_frame"]
        }
      });
  const o = Array.from(/* @__PURE__ */ new Set([...ze, ...r]));
  for (const n of o) {
    if (!n || !n.trim()) continue;
    const i = B(n.trim());
    s.push({
      id: a++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: "/blocked.html" }
      },
      condition: {
        requestDomains: [i],
        resourceTypes: ["main_frame"]
      }
    });
  }
  return s;
}
async function D() {
  if (typeof chrome > "u" || !chrome.storage || !chrome.storage.local)
    return { active: !1, reason: "CHROME_STORAGE_UNAVAILABLE", todayStr: "", streak: 0 };
  try {
    const e = await chrome.storage.local.get([
      "hardcore_mode_enabled",
      "my_leetcode_username",
      "last_solve_date",
      "user_timezone",
      "own_profile"
    ]), r = e.user_timezone, t = Math.floor(Date.now() / 1e3), s = P(t, r);
    if (!e.hardcore_mode_enabled)
      return { active: !1, reason: "HARDCORE_DISABLED", todayStr: s, streak: 0 };
    const a = e.my_leetcode_username;
    let o = e.own_profile;
    if (!o && a)
      try {
        const n = await chrome.storage.local.get(["friends_cache"]);
        if (n.friends_cache) {
          const i = Object.keys(n.friends_cache).find((c) => c.toLowerCase() === a.toLowerCase());
          i && (o = n.friends_cache[i]);
        }
        o || (o = await de(a));
      } catch (n) {
        console.warn("[BlockerManager] Error fetching cached friend data:", n);
      }
    if (o) {
      const n = o.stats?.streak || 0;
      return Ye(o.allAcceptedSubmissions, o.submissionCalendar, r) ? (await chrome.storage.local.set({ last_solve_date: s }), { active: !1, reason: "SOLVED_TODAY_CANONICAL", todayStr: s, streak: n }) : (e.last_solve_date === s && await chrome.storage.local.remove("last_solve_date"), { active: !0, reason: "UNSOLVED_TODAY", todayStr: s, streak: n });
    }
    return e.last_solve_date === s ? { active: !1, reason: "SOLVED_TODAY_CACHE", todayStr: s, streak: 0 } : { active: !0, reason: "NO_PROFILE_UNSOLVED", todayStr: s, streak: 0 };
  } catch (e) {
    return console.error("[BlockerManager] isBlockerActive check error:", e), { active: !1, reason: `ERROR: ${e.message}`, todayStr: "", streak: 0 };
  }
}
async function $() {
  if (typeof chrome > "u" || !chrome.declarativeNetRequest)
    return console.warn("[BlockerManager] chrome.declarativeNetRequest API not available"), { success: !1, locked: !1, ruleCount: 0, reason: "DNR_NOT_AVAILABLE" };
  try {
    const e = await D(), t = (await chrome.declarativeNetRequest.getDynamicRules()).map((o) => o.id);
    if (!e.active)
      return t.length > 0 && await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: t,
        addRules: []
      }), await chrome.storage.local.set({
        hardcore_blocker_state: {
          locked: !1,
          ruleCount: 0,
          reason: e.reason,
          todayStr: e.todayStr,
          streak: e.streak,
          lastSynced: Date.now()
        }
      }), { success: !0, locked: !1, ruleCount: 0, reason: e.reason };
    const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = Kt({
      customBlocked: s.custom_blocked_domains || [],
      allowlist: s.allowlist || []
    });
    return await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: t,
      addRules: a
    }), await chrome.storage.local.set({
      hardcore_blocker_state: {
        locked: !0,
        ruleCount: a.length,
        reason: e.reason,
        todayStr: e.todayStr,
        streak: e.streak,
        lastSynced: Date.now()
      }
    }), await Xt(), { success: !0, locked: !0, ruleCount: a.length, reason: e.reason };
  } catch (e) {
    console.error("[BlockerManager] syncBlockerRules error:", e);
    try {
      await chrome.storage.local.set({
        hardcore_blocker_state: {
          locked: !1,
          error: e.message,
          lastSynced: Date.now()
        }
      });
    } catch {
    }
    return { success: !1, locked: !1, ruleCount: 0, error: e.message };
  }
}
let Oe = !1;
function M(e, r, t = "") {
  if (!(typeof chrome > "u" || !chrome.tabs || !chrome.tabs.update))
    try {
      const s = chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(r)}&label=${encodeURIComponent(t)}`);
      chrome.tabs.update(e, { url: s }, () => {
        chrome.runtime?.lastError;
      });
    } catch (s) {
      console.warn("[BlockerManager] redirectTabToBlocked error:", s);
    }
}
async function Xt() {
  if (typeof chrome > "u" || !chrome.tabs || !chrome.tabs.query)
    return { sweptCount: 0, redirectedTabs: [] };
  try {
    if (!(await D()).active)
      return { sweptCount: 0, redirectedTabs: [] };
    const r = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), t = r.custom_blocked_domains || [], s = r.allowlist || [], a = await chrome.tabs.query({}), o = [];
    for (const n of a) {
      if (!n.id || !n.url || n.url.includes("blocked.html") || n.url.startsWith("chrome") || n.url.startsWith("about:") || n.url.startsWith("edge:") || n.url.includes("leetcode.com"))
        continue;
      const i = U(n.url, { customBlocked: t, allowlist: s });
      i.isDistraction && (console.log(`[BlockerManager] Sweeping open distracting tab #${n.id}: ${n.url} (${i.label || i.reason})`), M(n.id, n.url, i.label), o.push({ id: n.id, url: n.url }));
    }
    return { sweptCount: o.length, redirectedTabs: o };
  } catch (e) {
    return console.warn("[BlockerManager] sweepOpenTabs error:", e), { sweptCount: 0, redirectedTabs: [], error: e.message };
  }
}
function Zt() {
  Oe || typeof chrome > "u" || (Oe = !0, $().catch((e) => console.error("[BlockerManager] Startup sync failed:", e)), chrome.webNavigation && chrome.webNavigation.onBeforeNavigate && chrome.webNavigation.onBeforeNavigate.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await D()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = U(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && (chrome.storage.session && await chrome.storage.session.set({
          [`blocked_tab_${e.tabId}`]: {
            url: e.url,
            label: s.label,
            timestamp: Date.now()
          }
        }), M(e.tabId, e.url, s.label));
      } catch (r) {
        console.warn("[BlockerManager] onBeforeNavigate error:", r);
      }
  }), chrome.webNavigation && chrome.webNavigation.onCommitted && chrome.webNavigation.onCommitted.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await D()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = U(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && M(e.tabId, e.url, s.label);
      } catch {
      }
  }), chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated && chrome.webNavigation.onHistoryStateUpdated.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await D()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = U(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && (chrome.storage.session && await chrome.storage.session.set({
          [`blocked_tab_${e.tabId}`]: {
            url: e.url,
            label: s.label,
            timestamp: Date.now()
          }
        }), M(e.tabId, e.url, s.label));
      } catch (r) {
        console.warn("[BlockerManager] onHistoryStateUpdated error:", r);
      }
  }), chrome.tabs && chrome.tabs.onUpdated && chrome.tabs.onUpdated.addListener(async (e, r, t) => {
    const s = r.url || t?.url;
    if (!(!s || s.includes("blocked.html") || s.startsWith("chrome") || s.startsWith("about:") || s.includes("leetcode.com")))
      try {
        if (!(await D()).active) return;
        const o = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), n = U(s, {
          customBlocked: o.custom_blocked_domains || [],
          allowlist: o.allowlist || []
        });
        n.isDistraction && M(e, s, n.label);
      } catch {
      }
  }), chrome.tabs && chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(async (e) => {
    try {
      if (!(await D()).active) return;
      const t = await chrome.tabs.get(e.tabId);
      if (!t || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
      const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = U(t.url, {
        customBlocked: s.custom_blocked_domains || [],
        allowlist: s.allowlist || []
      });
      a.isDistraction && (console.log(`[BlockerManager] onActivated blocking active tab #${e.tabId} (${t.url})`), M(e.tabId, t.url, a.label));
    } catch {
    }
  }), chrome.windows && chrome.windows.onFocusChanged && chrome.windows.onFocusChanged.addListener(async (e) => {
    if (!(typeof chrome.windows.WINDOW_ID_NONE < "u" && e === chrome.windows.WINDOW_ID_NONE))
      try {
        if (!(await D()).active) return;
        const [t] = await chrome.tabs.query({ active: !0, windowId: e });
        if (!t || !t.id || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
        const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = U(t.url, {
          customBlocked: s.custom_blocked_domains || [],
          allowlist: s.allowlist || []
        });
        a.isDistraction && (console.log(`[BlockerManager] onFocusChanged blocking window tab #${t.id} (${t.url})`), M(t.id, t.url, a.label));
      } catch {
      }
  }), chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener((e, r) => {
    if (r !== "local") return;
    [
      "hardcore_mode_enabled",
      "last_solve_date",
      "my_leetcode_username",
      "user_timezone",
      "own_profile",
      "custom_blocked_domains",
      "allowlist"
    ].some((a) => e[a]) && $().catch((a) => {
      console.error("[BlockerManager] Storage change sync error:", a);
    });
  }), console.log("🛡️ [BlockerManager] Multi-layer network blocker initialized"));
}
function er() {
  if (Zt(), typeof chrome > "u" || !chrome.tabs) {
    console.warn("[TabMonitor] chrome.tabs API not available");
    return;
  }
  chrome.tabs.onUpdated.addListener(async (e, r, t) => {
    if (r.status === "complete" && t?.url)
      try {
        if (!(await D()).active) return;
        const a = U(t.url);
        if (a.isDistraction && !t.url.includes("blocked.html")) {
          const o = chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(t.url)}&label=${encodeURIComponent(a.label)}`);
          chrome.tabs.update(e, { url: o });
        }
      } catch {
      }
  }), console.log("✅ [TabMonitor] Hardcore Mode Tab Monitor and Blocker initialized");
}
const ce = "leetfriends_sync", tr = "schedule_transition_check", G = "presence_heartbeat_alarm", Ke = 500;
self.addEventListener("error", (e) => {
  console.error("[ServiceWorker] Uncaught error:", e.error);
});
self.addEventListener("unhandledrejection", (e) => {
  console.error("[ServiceWorker] Uncaught promise rejection:", e.reason);
});
er();
_t().catch((e) => {
  console.warn("[ServiceWorker] Session restoration (non-blocking):", e.message);
});
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[ServiceWorker] Installed - setting up sync alarm and cleaning legacy keys"), ye(), rr(), await $();
  try {
    await chrome.alarms.clear(G), chrome.alarms.create(G, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    });
  } catch {
  }
});
chrome.runtime.onStartup.addListener(async () => {
  console.log("[ServiceWorker] Browser startup - reconciling blocker rules & presence"), await $();
  try {
    await chrome.alarms.clear(G), chrome.alarms.create(G, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    }), await Ze();
  } catch {
  }
});
async function rr() {
  try {
    const e = [
      "github_token",
      "github_token_encrypted",
      "github_token_key",
      "github_username",
      "github_repo",
      "github_sync_enabled",
      "synced_problems"
    ];
    await chrome.storage.local.remove(e), console.log("[ServiceWorker] Legacy keys cleaned successfully");
  } catch (e) {
    console.warn("[ServiceWorker] Error cleaning legacy storage:", e);
  }
}
async function ye() {
  const e = Vt(), r = e?.intervalMinutes || 30;
  try {
    await chrome.alarms.clear(ce), await chrome.alarms.clear(tr), chrome.alarms.create(ce, {
      delayInMinutes: r,
      periodInMinutes: r
    }), await chrome.storage.local.set({
      current_schedule: {
        interval: r,
        description: e?.description || "Standard sync",
        updatedAt: Date.now()
      }
    });
  } catch (t) {
    console.warn("[ServiceWorker] setupDynamicAlarm error:", t);
  }
}
async function sr() {
  try {
    const r = (await chrome.storage.local.get("current_schedule")).current_schedule, t = we();
    (!r || Math.abs(r.interval - t) > 0.1) && (console.log(`[ServiceWorker] Transitioning schedule: ${ge()}`), await ye());
  } catch (e) {
    console.warn("[ServiceWorker] checkScheduleTransition error:", e);
  }
}
chrome.alarms.onAlarm.addListener(async (e) => {
  e.name === ce ? (console.log(`[ServiceWorker] Background sync triggered - ${ge()}`), await sr(), await Xe(), await $()) : e.name === G && await Ze();
});
chrome.runtime.onMessage.addListener((e, r, t) => {
  if (e.type === "PING") {
    t({ pong: !0 });
    return;
  }
  switch (e.type) {
    case "FETCH_STATS":
      return ar(e.forceRefresh).then(t), !0;
    case "ADD_FRIEND":
      return nr(e.username).then(t), !0;
    case "REMOVE_FRIEND":
      return cr(e.username).then(t), !0;
    case "GET_FRIENDS":
      return ir().then(t), !0;
    case "MUTE_NOTIFICATIONS":
      return Wt(e.untilUTC).then(() => t({ success: !0 })), !0;
    case "GET_NOTIFICATION_STATE":
      return Je().then((s) => t({ success: !0, state: s })), !0;
    case "ADD_TO_QUEUE":
      return lr(e.problemData).then(t), !0;
    case "SUBMISSION_ACCEPTED":
      return ur(e.problemSlug, e.title).then(t), !0;
    case "SYNC_BLOCKER_RULES":
      return $().then(t), !0;
    case "GET_BLOCKER_STATUS":
      return D().then(t), !0;
    case "SHOW_NOTIFICATION":
      return Ge([{
        type: "custom",
        message: e.message || "",
        title: e.title || "LeetStreak",
        priority: 2
      }]).then(() => t({ success: !0 })), !0;
    case "GET_STORAGE_STATUS":
      return chrome.storage.local.getBytesInUse(null, (s) => {
        t({ bytesInUse: s || 0, quota: 5242880 });
      }), !0;
    case "RESCHEDULE_ALARMS":
      return ye().then(() => t({ success: !0 })), !0;
    // ===== 1v1 Battle System =====
    case "BATTLE_GET_STATUS":
      return mr(e.username).then(t), !0;
    case "BATTLE_CHALLENGE":
      return hr(e.challenger, e.challenged, e.language).then(t), !0;
    case "BATTLE_RESPOND":
      return _r(e.battleId, e.username, e.accept).then(t), !0;
    case "BATTLE_PICK_PROBLEM":
      return wr(e.battleId, e.username, e.slug, e.title).then(t), !0;
    case "BATTLE_READY":
      return gr(e.battleId, e.username).then(t), !0;
    case "BATTLE_SUBMISSION":
      return yr(e).then(t), !0;
    case "BATTLE_FORFEIT":
      return pr(e.battleId, e.username).then(t), !0;
    case "BATTLE_CANCEL":
      return Sr(e.battleId, e.username).then(t), !0;
    case "BATTLE_VALIDATE_PROBLEM":
      return qe(e.slugOrUrl).then(t), !0;
    case "BATTLE_PING_PRESENCE":
      return Er(e.username).then(t), !0;
    case "BATTLE_GET_PRESENCE":
      return br(e.usernames).then(t), !0;
    case "BATTLE_GET_ONLINE_FRIENDS":
      return Et().then((s) => t({ success: !0, friends: s })).catch((s) => t({ success: !1, error: s.message, friends: [] })), !0;
    case "SYNC_FRIENDSHIPS":
      return (async () => {
        if (!Array.isArray(e.usernames))
          return t({ success: !0, count: 0 });
        const s = await Promise.all(
          e.usernames.map((a) => ue(a).catch(() => ({ success: !1 })))
        );
        t({ success: !0, count: s.filter((a) => a?.success).length });
      })().catch((s) => t({ success: !1, error: s.message })), !0;
    case "GET_LOGGED_IN_USER":
      return dr().then(t), !0;
    case "FETCH_OWN_PROFILE":
      return or(e.forceRefresh).then(t), !0;
    // ===== Cloud Authentication & Account =====
    case "GET_AUTH_STATE":
      return (async () => {
        const s = await A();
        t({
          success: !0,
          state: O(),
          session: s ? { user_id: s.user_id, email: s.email, expires_at: s.expires_at } : null,
          isRateLimited: H(),
          cooldownSeconds: ie()
        });
      })().catch((s) => t({ success: !1, error: s.message })), !0;
    case "SIGN_IN_EMAIL":
      return gt(e.email, e.password).then(async (s) => {
        try {
          await oe(), e.username && await chrome.storage.local.set({ my_leetcode_username: e.username });
          const a = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), o = e.username || a.my_leetcode_username;
          o && (await N(o, a.own_profile || { profile: { realName: o } }), await Z(o, "online"));
        } catch (a) {
          console.warn("[ServiceWorker] Social account restore error:", a);
        }
        t({ success: !0, session: { user_id: s.user_id, email: s.email } });
      }).catch((s) => t({ success: !1, error: s.message, isRateLimited: H() })), !0;
    case "RESTORE_ACCOUNT_DATA":
      return oe().then((s) => t(s)).catch((s) => t({ success: !1, error: s.message })), !0;
    case "SIGN_UP_EMAIL":
      return yt(e.email, e.password).then(async (s) => {
        if (e.username && await chrome.storage.local.set({ my_leetcode_username: e.username }), s?.session && s.session.user_id)
          try {
            const a = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), o = e.username || a.my_leetcode_username;
            o && (await N(o, a.own_profile || { profile: { realName: o } }), await Z(o, "online"));
          } catch (a) {
            console.warn("[ServiceWorker] Sign up profile sync error:", a);
          }
        t(s);
      }).catch((s) => t({ success: !1, error: s.message, isRateLimited: H() })), !0;
    case "SIGN_OUT":
      return pt().then(async (s) => {
        try {
          await St();
        } catch {
        }
        t(s);
      }).catch((s) => t({ success: !1, error: s.message })), !0;
    // ===== Roasts =====
    case "SEND_ROAST":
      return Tr(e.targetUsername, e.fromUsername, e.message).then(t), !0;
    case "CLEAR_ROASTS":
      return (async () => {
        const s = await chrome.storage.local.get("my_leetcode_username");
        return s.my_leetcode_username && await He(s.my_leetcode_username), { success: await xe() };
      })().then(t), !0;
    default:
      t({ success: !1, error: `Unknown message type: ${e.type}` });
  }
});
chrome.notifications.onClicked.addListener((e) => {
  (e.includes("streak") || e.includes("roast") || e.includes("solve")) && (chrome.tabs.create({ url: "https://leetcode.com/problemset/" }), chrome.notifications.clear(e));
});
async function ar(e = !1) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured. Please enter your username." };
    let s = await Y(), a = !1;
    if (e || !s || ne(s.lastUpdated)) {
      console.log(`[ServiceWorker] Fetching own LeetCode data for: ${t}`);
      try {
        const u = await q(t);
        s = await z(u, r.user_timezone), await te(s), a = !0;
      } catch (u) {
        if (console.error(`[ServiceWorker] Error fetching own LeetCode profile for ${t}:`, u), !s)
          return {
            success: !1,
            error: `Failed to fetch LeetCode data for ${t}: ${u.message}`,
            isLeetCodeError: !0
          };
      }
    }
    let n = await K();
    const i = await Fe();
    let c = e;
    if (!c && i.length > 0) {
      for (const u of i)
        if (!n[u] || ne(n[u]?.lastUpdated)) {
          c = !0;
          break;
        }
    }
    if (c && i.length > 0) {
      console.log("[ServiceWorker] Syncing friends data...");
      for (const u of i)
        if (u.toLowerCase() !== t.toLowerCase())
          try {
            const _ = await q(u), p = await z(_, r.user_timezone);
            await fe(u, p), await et(Ke);
          } catch (_) {
            console.warn(`[ServiceWorker] Error updating friend ${u}:`, _.message);
          }
      n = await K();
    }
    const l = { ...n };
    return s && (l[t] = s), {
      success: !0,
      ownProfile: s,
      friends: l,
      refreshed: a || c
    };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchStats error:", r), { success: !1, error: r.message };
  }
}
async function or(e = !1) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured" };
    let s = await Y();
    if (e || !s || ne(s.lastUpdated)) {
      const o = await q(t);
      s = await z(o, r.user_timezone), await te(s);
    }
    return { success: !0, ownProfile: s };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchOwnProfile error:", r), { success: !1, error: r.message };
  }
}
async function nr(e) {
  try {
    const r = e;
    let t;
    try {
      t = Ft(e);
    } catch (n) {
      return { success: !1, error: n.message };
    }
    if (await de(t))
      return { success: !1, error: `${r} is already in your friends list` };
    const a = await q(r), o = await z(a);
    return await fe(t, o), O() === f.AUTHENTICATED && ue(t).catch((n) => {
      console.warn("[ServiceWorker] Cloud syncFriendship failed:", n);
    }), { success: !0, message: `${r} added successfully`, data: o };
  } catch (r) {
    return console.error("[ServiceWorker] handleAddFriend error:", r), { success: !1, error: r.message || "User not found or profile is private" };
  }
}
async function cr(e) {
  try {
    return await kt(e), O() === f.AUTHENTICATED && Pe(e).catch((r) => {
      console.warn("[ServiceWorker] Cloud removeFriendship failed:", r);
    }), { success: !0, message: `${e} removed` };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function ir() {
  try {
    let e = await K();
    return O() === f.AUTHENTICATED && (!e || Object.keys(e).length === 0) && (await oe(), e = await K()), { success: !0, friends: e };
  } catch (e) {
    return { success: !1, error: e.message };
  }
}
async function lr(e) {
  try {
    if (!e) return { success: !1, error: "Problem data required" };
    const t = (await chrome.storage.local.get("problem_queue")).problem_queue || [];
    if (t.some((o) => o.slug === e.slug || o.id === e.slug))
      return { success: !1, error: "Problem already in queue", alreadyExists: !0 };
    const a = {
      ...e,
      id: e.slug || `problem-${Date.now()}`,
      addedAt: Date.now(),
      status: e.status || "pending"
    };
    return t.push(a), await chrome.storage.local.set({ problem_queue: t }), { success: !0, message: "Added to problem queue" };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function ur(e, r) {
  try {
    const t = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "problem_queue"]), s = P(Math.floor(Date.now() / 1e3), t.user_timezone);
    if (await chrome.storage.local.set({ last_solve_date: s }), console.log(`[ServiceWorker] Solve recorded today (${s}) — Hardcore Mode unlocked!`), await $(), t.problem_queue && Array.isArray(t.problem_queue)) {
      const a = t.problem_queue.map((o) => o.slug === e || o.id === e || r && o.title === r ? { ...o, status: "completed" } : o);
      await chrome.storage.local.set({ problem_queue: a });
    }
    return Xe().catch(console.error), { success: !0 };
  } catch (t) {
    return console.error("[ServiceWorker] handleSubmissionAccepted error:", t), { success: !1, error: t.message };
  }
}
async function dr() {
  try {
    const e = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query globalData { userStatus { isSignedIn username } }" })
    });
    if (!e.ok) throw new Error(`HTTP error ${e.status}`);
    const r = await e.json();
    return r.data?.userStatus?.isSignedIn && r.data?.userStatus?.username ? { success: !0, username: r.data.userStatus.username } : { success: !1, error: "Not logged in to LeetCode" };
  } catch (e) {
    return { success: !1, error: e.message };
  }
}
async function Xe() {
  try {
    const e = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), r = e.my_leetcode_username, t = e.user_timezone, s = await Fe(), a = r ? [.../* @__PURE__ */ new Set([r, ...s])] : s;
    console.log(`[ServiceWorker] Syncing ${a.length} profile(s): ${a.join(", ")}`);
    const o = [];
    if (r)
      try {
        const n = await Me(r);
        if (n && n.length > 0) {
          const c = [];
          for (const l of n)
            o.push({
              type: "roast",
              username: l.sender_username,
              message: `${l.sender_username} roasted you: "${l.content}" 🔥`,
              priority: 2
            }), l.status === "sent" && c.push(l.id);
          c.length > 0 && await Tt(c);
        }
        const i = await ee(r);
        if (i?.pending_roasts && i.pending_roasts.length > 0) {
          for (const c of i.pending_roasts)
            o.push({
              type: "roast",
              username: c.from,
              message: `${c.from} roasted you: "${c.message}" 🔥`,
              priority: 2
            });
          await xe();
        }
      } catch (n) {
        console.warn("[ServiceWorker] Error checking pending roasts:", n);
      }
    for (const n of a)
      try {
        const i = await de(n), c = await q(n), l = await z(c, t);
        if (await fe(n, l), r && n.toLowerCase() === r.toLowerCase()) {
          if (await te(l), Ye(l.allAcceptedSubmissions, l.submissionCalendar, t)) {
            const u = P(Math.floor(Date.now() / 1e3), t);
            await chrome.storage.local.set({ last_solve_date: u });
          }
          await $();
        }
        if (!await je()) {
          const u = await fr(n, i, l, r);
          o.push(...u), r && n.toLowerCase() === r.toLowerCase() && Gt(l.allAcceptedSubmissions, l.stats.streak) && o.push({
            username: "You",
            type: "streak_at_risk",
            message: zt("You", "streak_at_risk", { streak: l.stats.streak }),
            priority: 3
          });
        }
        await et(Ke);
      } catch (i) {
        console.warn(`[ServiceWorker] Error syncing ${n}:`, i);
      }
    o.length > 0 && await Ge(o);
  } catch (e) {
    console.error("[ServiceWorker] syncAllFriends error:", e);
  }
}
async function fr(e, r, t, s) {
  const a = [];
  if (s && e.toLowerCase() === s.toLowerCase())
    return a;
  if (r?.stats && t?.stats) {
    const o = r.stats.total || 0, n = t.stats.total || 0;
    if (n > o) {
      const i = n - o;
      let c = "a problem";
      t.recentSubmissions && t.recentSubmissions.length > 0 && (c = t.recentSubmissions[0].title || c), a.push({
        username: e,
        type: "new_submission",
        message: `${e} just solved ${i === 1 ? `"${c}"` : `${i} problems`}! 🎯`,
        priority: 1
      });
    }
  }
  if (t.stats?.streak && jt(t.stats.streak)) {
    const o = r?.stats?.streak || 0;
    t.stats.streak > o && a.push({
      username: e,
      type: "milestone",
      message: `${e} reached a ${t.stats.streak}-day streak! 🔥`,
      priority: 2
    });
  }
  return a;
}
async function z(e, r = null) {
  const { profile: t, contestRanking: s, submissionCalendar: a, allAcceptedSubmissions: o } = e, { currentStreak: n, longestStreak: i } = xt(
    o || [],
    a || {},
    r
  ), c = qt(t.submitStats?.acSubmissionNum);
  return {
    profile: {
      username: t.username,
      realName: t.profile?.realName || "",
      avatar: t.profile?.userAvatar || "",
      ranking: t.profile?.ranking || 0
    },
    stats: {
      ...c,
      streak: n,
      longestStreak: i
    },
    contest: {
      rating: Math.round(s?.rating || 0),
      attended: s?.attendedContestsCount || 0,
      ranking: s?.globalRanking || 0
    },
    badges: t.badges || [],
    recentSubmissions: t.recentSubmissions || [],
    allAcceptedSubmissions: o || [],
    submissionCalendar: a || {},
    lastUpdated: Date.now()
  };
}
async function mr(e) {
  try {
    const r = await chrome.storage.local.get("my_leetcode_username"), t = e || r.my_leetcode_username;
    if (!t) return { success: !1, error: "No username configured" };
    const [s, a] = await Promise.all([
      X(t),
      Mt(t, 10)
    ]);
    if (!s) return { success: !0, battle: null, history: a };
    const o = await he(s.id);
    return { success: !0, battle: s, results: o, history: a };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function hr(e, r, t) {
  try {
    const s = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), a = e || s.my_leetcode_username;
    return a && s.own_profile && N(a, s.own_profile).catch(() => {
    }), await Lt(a, r, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function _r(e, r, t) {
  try {
    const s = await chrome.storage.local.get("my_leetcode_username"), a = r || s.my_leetcode_username;
    return await Ot(e, a, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function wr(e, r, t, s) {
  try {
    const a = await chrome.storage.local.get("my_leetcode_username"), o = r || a.my_leetcode_username;
    return await Ut(e, o, t, s);
  } catch (a) {
    return { success: !1, error: a.message };
  }
}
async function gr(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await Nt(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function yr(e) {
  try {
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    if (!t) return { success: !1, error: "No username configured" };
    const s = await X(t);
    return s ? await It(s.id, t, {
      submissionId: e.submissionId,
      accepted: e.accepted,
      runtime_ms: e.runtime_ms,
      memory_mb: e.memory_mb,
      language: e.language,
      attempts: e.attempts,
      problemSlug: e.problemSlug
    }) : { success: !1, error: "No active battle in progress" };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function pr(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await $t(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function Sr(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await Bt(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function Ze() {
  try {
    if (!(await A())?.user_id) return;
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    t && await Z(t, "online");
  } catch (e) {
    console.warn("[ServiceWorker] handlePresenceHeartbeat error:", e);
  }
}
async function Er(e) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), t = e || r.my_leetcode_username;
    return t && (N(t, r.own_profile || { profile: { realName: t } }).catch(() => {
    }), await Z(t)), { success: !0 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function br(e) {
  try {
    if (!e?.length) return { success: !0, presenceMap: {} };
    const r = await Ht(e);
    return { success: !0, presenceMap: Object.fromEntries(r) };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function Tr(e, r, t) {
  try {
    return await Be(e, r, t) ? { success: !0 } : { success: await Ct(e, r, t) };
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
function et(e) {
  return new Promise((r) => setTimeout(r, e));
}
