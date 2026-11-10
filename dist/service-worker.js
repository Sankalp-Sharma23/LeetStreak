function Tt(e, r = 1, t = 50) {
  return !e || typeof e != "string" ? { valid: !1, error: "Username is required" } : (e = e.trim(), e.length < r || e.length > t ? { valid: !1, error: `Username must be ${r}-${t} characters` } : /^[a-zA-Z0-9_-]+$/.test(e) ? { valid: !0, username: e.toLowerCase() } : { valid: !1, error: "Username contains invalid characters" });
}
class At {
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
const vt = /* @__PURE__ */ new Set([
  "leetcode.com",
  "assets.leetcode.com"
]);
function Mt(e, r) {
  try {
    const t = new URL(e);
    return t.protocol !== "https:" ? {
      valid: !1,
      reason: `Insecure transport: ${e} does not use HTTPS`
    } : (!vt.has(t.hostname) && !t.hostname.endsWith(".supabase.co") && console.warn(`[SecurityAuditor] Request to external domain: ${t.hostname}`), !r.headers?.get("strict-transport-security") && t.hostname === "leetcode.com" && console.warn(`[SecurityAuditor] Warning: Missing HSTS header on response from ${t.hostname}`), { valid: !0 });
  } catch (t) {
    return {
      valid: !1,
      reason: `Transport security audit failed: ${t.message}`
    };
  }
}
async function Rt(e, r = {}) {
  if (!e.startsWith("https://"))
    throw new Error(`Security Violation: Insecure HTTP request blocked for ${e}`);
  const t = await fetch(e, r), s = Mt(e, t);
  return s.valid || console.error(`[SecurityAuditor] Security policy failed: ${s.reason}`), t;
}
const se = "https://leetcode.com/graphql", Ct = 2, le = 6e3, Pe = new At(30, 6e4);
function Ie(e) {
  return new Promise((r) => setTimeout(r, e));
}
async function Lt(e, r, t = Ct) {
  let s;
  if (!Pe.isAllowed()) {
    const a = Pe.getTimeUntilReset();
    throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(a / 1e3)} seconds.`);
  }
  for (let a = 0; a < t; a++)
    try {
      if (typeof navigator < "u" && !navigator.onLine)
        throw new Error("No internet connection. Please check your network.");
      const i = new AbortController(), n = setTimeout(() => i.abort(), le), o = await Rt(e, {
        ...r,
        signal: i.signal
      });
      if (clearTimeout(n), o.status === 429) {
        const l = parseInt(o.headers.get("Retry-After")) || Math.pow(2, a);
        console.log(`[API] Rate limited. Retrying after ${l}s`), await Ie(l * 1e3);
        continue;
      }
      return o;
    } catch (i) {
      if (s = i, i.name === "AbortError" && (console.error(`[API] Request timeout (${le}ms)`), s = new Error(`Request timed out after ${le / 1e3} seconds`)), i.message.includes("No internet connection"))
        throw i;
      if (a < t - 1) {
        const n = Math.pow(2, a) * 1e3;
        console.log(`[API] Retry ${a + 1}/${t} in ${n}ms`), await Ie(n);
      }
    }
  throw s || new Error("Network request failed after multiple retries");
}
const Dt = `
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
`, Pt = `
  query getUserBadges($username: String!) {
    matchedUser(username: $username) {
      badges {
        id
        displayName
        icon
      }
    }
  }
`, It = `
  query getRecentSubmissions($username: String!) {
    recentSubmissionList(username: $username, limit: 15) {
      title
      titleSlug
      timestamp
      statusDisplay
      lang
    }
  }
`, Bt = `
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
async function U(e) {
  try {
    console.log(`[API] Fetching data for user: ${e}`);
    const r = await Lt(se, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: Dt,
        variables: { username: e }
      })
    });
    if (console.log(`[API] Profile response status: ${r.status}`), !r.ok) {
      const d = await r.text();
      throw console.error("[API] Profile request failed:", r.status, d), new Error(`API request failed: ${r.status}`);
    }
    const t = await r.json();
    if (console.log("[API] Profile data received:", t), t.errors)
      throw console.error("[API] GraphQL errors:", t.errors), new Error(t.errors[0]?.message || "GraphQL error");
    if (!t.data?.matchedUser)
      throw console.error("[API] No matched user in response"), new Error("User not found or profile is private");
    const s = t.data.matchedUser, a = s.submissionCalendar ? JSON.parse(s.submissionCalendar) : {};
    let i = [];
    try {
      const d = await fetch(se, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: Pt,
          variables: { username: e }
        })
      });
      d.ok && (i = (await d.json()).data?.matchedUser?.badges || []);
    } catch (d) {
      console.warn("[API] Failed to fetch badges:", d);
    }
    let n = [];
    try {
      const d = await fetch(se, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: It,
          variables: { username: e }
        })
      });
      d.ok && (n = (await d.json()).data?.recentSubmissionList || []);
    } catch (d) {
      console.warn("[API] Failed to fetch recent submissions:", d);
    }
    let o = [], l = !1;
    try {
      const d = await fetch(se, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: Bt,
          variables: { username: e }
        })
      });
      if (d.ok) {
        const u = await d.json();
        if (u.errors)
          console.warn("[API] All submissions query error:", u.errors);
        else {
          const c = u.data?.matchedUser?.recentAcSubmissions;
          Array.isArray(c) && (o = c, l = !0), console.log(`[API] Fetched ${o.length} all-time accepted submissions (limit 1000)`), o.length > 0 && console.log("[API] Sample submissions:", o.slice(0, 5).map((f) => f.titleSlug));
        }
      }
    } catch (d) {
      console.warn("[API] Failed to fetch all submissions:", d);
    }
    return console.log(`[API] Successfully fetched data for ${e}`), {
      profile: {
        ...s,
        badges: i,
        recentSubmissions: n
      },
      allAcceptedSubmissions: o,
      acceptedSubmissionsAvailable: l,
      contestRanking: t.data.userContestRanking,
      submissionCalendar: a
    };
  } catch (r) {
    throw console.error("Error fetching LeetCode data:", r), r;
  }
}
const Be = { VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6c2xkY2pncGlvZHp1aXZyYnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NDYwODMsImV4cCI6MjEwMzEyMjA4M30.TuPkW7jnn9rScS2FhH1A8omsSIpABs6MEKfRbX1lzYU", VITE_SUPABASE_URL: "https://pzsldcjgpiodzuivrbwt.supabase.co" }, Ye = typeof import.meta < "u" && Be ? Be : typeof process < "u" && process.env ? process.env : {}, w = Ye.VITE_SUPABASE_URL || "YOUR_SUPABASE_PROJECT_URL_HERE", O = Ye.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY_HERE", T = w.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), y = {
  SESSION_LOADING: "SESSION_LOADING",
  AUTHENTICATED: "AUTHENTICATED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  AUTH_ERROR: "AUTH_ERROR"
};
let J = null, ae = null, me = y.SESSION_LOADING, Ue = null, V = 0;
const Ut = /* @__PURE__ */ new Set();
function k(e, r = null) {
  me = e, Ue = r;
  for (const t of Ut)
    try {
      t(me, J, Ue);
    } catch (s) {
      console.warn("[SupabaseClient] Error in auth listener callback:", s);
    }
}
function R() {
  return me;
}
function F() {
  return Date.now() < V;
}
function we() {
  return Math.max(0, Math.ceil((V - Date.now()) / 1e3));
}
function Se(e = 60) {
  V = Date.now() + e * 1e3, typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ supabase_auth_cooldown_until: V }).catch(() => {
  });
}
async function _() {
  let e = J;
  if (!e && typeof chrome < "u" && chrome.storage?.local)
    try {
      e = (await chrome.storage.local.get(["supabase_auth_session"])).supabase_auth_session || null;
    } catch (r) {
      return console.warn("[SupabaseClient] Could not read stored session:", r), null;
    }
  return e ? e.expires_at > Date.now() + 6e4 ? (J = e, e) : e.refresh_token ? (ae || (ae = Nt(e.refresh_token).finally(() => {
    ae = null;
  })), await ae) : null : null;
}
async function W(e) {
  if (J = e, typeof chrome < "u" && chrome.storage?.local)
    try {
      e ? await chrome.storage.local.set({ supabase_auth_session: e }) : await chrome.storage.local.remove(["supabase_auth_session"]);
    } catch {
    }
}
async function Ot() {
  k(y.SESSION_LOADING);
  try {
    let e = null;
    if (typeof chrome < "u" && chrome.storage?.local) {
      const t = await chrome.storage.local.get(["supabase_auth_session", "supabase_auth_cooldown_until"]);
      t.supabase_auth_cooldown_until && t.supabase_auth_cooldown_until > Date.now() && (V = t.supabase_auth_cooldown_until), e = t.supabase_auth_session;
    } else
      e = J;
    if (!e)
      return k(y.AUTH_REQUIRED), null;
    const r = await _();
    return r ? (k(y.AUTHENTICATED), r) : (R() === y.AUTH_ERROR || (await W(null), k(y.SESSION_EXPIRED, "Session expired. Please sign in again.")), null);
  } catch (e) {
    return console.warn("[SupabaseClient] Error restoring session:", e), k(y.AUTH_ERROR, e.message), null;
  }
}
async function Nt(e) {
  if (F())
    return k(y.AUTH_ERROR, "Rate limited"), null;
  try {
    const r = await fetch(`${T}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: O
      },
      body: JSON.stringify({ refresh_token: e })
    });
    if (r.status === 429)
      return Se(60), k(y.AUTH_ERROR, "Supabase authentication rate limit exceeded."), null;
    if (!r.ok)
      return await W(null), k(y.SESSION_EXPIRED, "Session expired or revoked."), null;
    const t = await r.json(), s = {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      user_id: t.user?.id,
      email: t.user?.email,
      expires_at: Date.now() + (t.expires_in ? t.expires_in * 1e3 : 3600 * 1e3)
    };
    return await W(s), k(y.AUTHENTICATED), s;
  } catch (r) {
    return console.warn("[SupabaseClient] Network error during token refresh:", r), k(y.AUTH_ERROR, r.message), null;
  }
}
async function Ht(e, r) {
  if (F()) {
    const t = we();
    throw new Error(`Rate limit cooldown active. Please wait ${t} seconds.`);
  }
  if (!e || !r)
    throw new Error("Email and password are required");
  try {
    const t = await fetch(`${T}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: O
      },
      body: JSON.stringify({ email: e, password: r })
    });
    if (t.status === 429)
      throw Se(60), k(y.AUTH_ERROR, "Rate limit exceeded"), new Error("Email rate limit exceeded. Please wait 1 minute before retrying.");
    if (!t.ok) {
      const i = await t.text();
      let n = "Invalid email or password";
      try {
        const o = JSON.parse(i);
        n = o.error_description || o.msg || n;
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
    return await W(a), k(y.AUTHENTICATED), a;
  } catch (t) {
    throw k(y.AUTH_ERROR, t.message), t;
  }
}
async function $t(e, r) {
  if (F()) {
    const t = we();
    throw new Error(`Rate limit cooldown active. Please wait ${t} seconds.`);
  }
  if (!e || !r)
    throw new Error("Email and password are required");
  try {
    const t = await fetch(`${T}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: O
      },
      body: JSON.stringify({ email: e, password: r })
    });
    if (t.status === 429)
      throw Se(60), k(y.AUTH_ERROR, "Rate limit exceeded"), new Error("Email signup rate limit exceeded. Please wait before retrying.");
    if (!t.ok) {
      const a = await t.text();
      let i = "Failed to create account";
      try {
        const n = JSON.parse(a);
        i = n.error_description || n.msg || i;
      } catch {
      }
      throw new Error(i);
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
      return await W(a), k(y.AUTHENTICATED), { success: !0, session: a };
    }
    return k(y.AUTH_REQUIRED), {
      success: !0,
      confirmationRequired: !0,
      user: s.user,
      message: "Account created. Please check your inbox to confirm your email before signing in."
    };
  } catch (t) {
    throw k(y.AUTH_ERROR, t.message), t;
  }
}
async function xt() {
  try {
    const e = await _();
    e?.access_token && fetch(`${T}/auth/v1/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: O,
        Authorization: `Bearer ${e.access_token}`
      }
    }).catch(() => {
    });
  } catch {
  }
  return await W(null), k(y.AUTH_REQUIRED), { success: !0 };
}
async function v() {
  const r = (await _())?.access_token || O;
  return {
    "Content-Type": "application/json",
    apikey: O,
    Authorization: `Bearer ${r}`,
    Prefer: "return=representation"
  };
}
async function p(e, r = {}) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await v(), s = await fetch(`${T}/rest/v1/rpc/${e}`, {
      method: "POST",
      headers: t,
      body: JSON.stringify(r)
    });
    if (!s.ok) {
      const a = await s.text();
      console.error(`[SupabaseClient] RPC ${e} error:`, s.status, a);
      let i = null;
      try {
        i = JSON.parse(a);
      } catch {
      }
      return {
        success: !1,
        error: i?.message || i?.error_description || a,
        code: i?.code || null,
        raw: a
      };
    }
    return await s.json();
  } catch (t) {
    return console.error(`[SupabaseClient] RPC ${e} exception:`, t), { success: !1, error: t.message };
  }
}
async function qt(e, r = {}) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE")
    return { success: !1, error: "Supabase is not configured." };
  const t = await _();
  if (!t?.access_token)
    return { success: !1, error: "Sign in to submit battle progress." };
  try {
    const s = await fetch(`${T}/functions/v1/${encodeURIComponent(e)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: O,
        Authorization: `Bearer ${t.access_token}`
      },
      body: JSON.stringify(r)
    }), a = await s.json().catch(() => ({}));
    return s.ok ? a : {
      success: !1,
      error: a.error || a.message || `Battle verification failed (${s.status}).`
    };
  } catch (s) {
    return console.error("[SupabaseClient] Edge Function request failed:", s), { success: !1, error: "Battle verification service is unavailable." };
  }
}
async function ze(e) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return null;
  try {
    const r = await v(), t = await fetch(
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
async function Q(e, r) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return !1;
  try {
    const t = await _();
    if (!t?.user_id)
      return !1;
    const s = await v(), a = r?.stats || {}, i = r?.profile || {}, n = r?.contest || {}, o = {
      id: t.user_id,
      leetcode_username: e.toLowerCase(),
      display_name: i.realName || e,
      avatar_url: i.avatar || "",
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
      body: JSON.stringify(o)
    })).ok;
  } catch (t) {
    return console.error("Supabase upsertProfile error:", t), !1;
  }
}
async function $() {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const e = await _();
    if (!e?.user_id) return null;
    const r = await v(), t = await fetch(
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
async function oe(e) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return !1;
  try {
    const r = await _();
    if (!r?.user_id) return !1;
    const t = await v();
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
async function Ft() {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    return (await _())?.user_id ? await p("set_presence_offline") : null;
  } catch {
    return null;
  }
}
async function Wt() {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  try {
    const e = await p("get_online_friends");
    return Array.isArray(e) ? e : e && e.error ? [] : [];
  } catch (e) {
    return console.warn("[SupabaseClient] getOnlineFriends error:", e), [];
  }
}
async function Gt(e) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return { success: !1 };
  try {
    return await p("request_friendship", { p_target_username: e.toLowerCase() }) || { success: !1 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function jt() {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  const e = await p("get_friend_requests");
  return Array.isArray(e) ? e : [];
}
async function Yt(e, r) {
  return e ? await p("respond_to_friend_request", {
    p_friendship_id: e,
    p_accept: !!r
  }) || { success: !1, error: "Could not update friend request" } : { success: !1, error: "Friend request id is required" };
}
async function Je(e) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return { success: !1 };
  try {
    return await p("remove_friendship", { p_target_username: e.toLowerCase() }) || { success: !1 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function Ve({ throwOnError: e = !1 } = {}) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  try {
    const r = await p("get_accepted_friends");
    return Array.isArray(r) ? r : r && Array.isArray(r.data) ? r.data : [];
  } catch (r) {
    if (console.error("[SupabaseClient] getAcceptedFriends error:", r), e) throw r;
    return [];
  }
}
async function zt() {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const e = await p("get_own_profile");
    if (e && typeof e == "object" && e.id) return e;
    const r = await _();
    if (!r?.user_id) return null;
    const t = await v(), s = await fetch(
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
async function B() {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return { success: !1 };
  try {
    const e = await _();
    if (!e?.user_id)
      return { success: !1, error: "No authenticated session" };
    const r = await zt();
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
    const t = await Ve();
    if (typeof chrome < "u" && chrome.storage?.local) {
      const s = await chrome.storage.local.get(["friends_cache", "friends_account_id"]), i = s?.friends_account_id === e.user_id && s?.friends_cache ? s.friends_cache : {}, n = {}, o = /* @__PURE__ */ new Set();
      for (const d of t) {
        const u = (d.leetcode_username || "").toLowerCase();
        if (!u) continue;
        o.add(u);
        const c = i[u] || {}, f = c.profile || {}, m = !!(c.submissionCalendar && (f.ranking || f.ranking === 0));
        n[u] = {
          ...c,
          username: u,
          profile: {
            ...f,
            username: u,
            realName: f.realName || d.display_name || u,
            avatar: f.avatar || d.avatar_url || "",
            ranking: f.ranking || 0
          },
          stats: {
            ...c.stats || {},
            total: c.stats?.total ?? d.total_solved ?? 0,
            easy: c.stats?.easy ?? d.easy_solved ?? 0,
            medium: c.stats?.medium ?? d.medium_solved ?? 0,
            hard: c.stats?.hard ?? d.hard_solved ?? 0,
            streak: c.stats?.streak ?? d.current_streak ?? 0,
            longestStreak: c.stats?.longestStreak ?? d.longest_streak ?? 0
          },
          contest: {
            rating: c.contest?.rating ?? d.contest_rating ?? 0
          },
          friend_id: d.friend_id,
          friendship_id: d.friendship_id,
          submissionCalendar: c.submissionCalendar || null,
          lastUpdated: m ? c.lastUpdated || (d.last_synced_at ? new Date(d.last_synced_at).getTime() : Date.now()) : 0
        };
      }
      try {
        const d = await $(), u = Array.isArray(d?.saved_friends) ? d.saved_friends : [];
        for (const c of u) {
          const f = (c || "").toLowerCase().trim();
          if (f && !n[f]) {
            const m = i[f] || {}, g = m.profile || {}, h = !!(m.submissionCalendar && (g.ranking || g.ranking === 0));
            o.add(f), n[f] = {
              ...m,
              username: f,
              profile: {
                ...g,
                username: f,
                realName: g.realName || f,
                avatar: g.avatar || ""
              },
              stats: m.stats || { total: 0, easy: 0, medium: 0, hard: 0, streak: 0, longestStreak: 0 },
              contest: m.contest || { rating: 0 },
              friend_id: m.friend_id || null,
              submissionCalendar: m.submissionCalendar || null,
              lastUpdated: h ? m.lastUpdated || Date.now() : 0
            };
          }
        }
      } catch (d) {
        console.warn("[SupabaseClient] Could not restore saved_friends from user_settings:", d);
      }
      const l = {
        accountId: e.user_id,
        friendIds: t.map((d) => d.friend_id || d.leetcode_username).filter(Boolean),
        friendUsernames: Array.from(o),
        friends: n,
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({
        friends_cache: n,
        friends_list: Array.from(o),
        friends_account_id: e.user_id,
        [`user_friends_${e.user_id}`]: l
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
async function Qe(e, r, t) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e || !t) return !1;
  try {
    const s = await _();
    if (!s?.user_id)
      return console.warn("[Roast] Authentication required to send cloud roasts"), !1;
    const a = await p("send_roast", {
      p_recipient_username: e.toLowerCase(),
      p_content: t.substring(0, 500)
    });
    if (a && a.success)
      return !0;
    const i = await ze(e);
    if (!i?.id)
      return console.warn(`[Roast] Target user ${e} has not registered on Supabase`), !1;
    const n = await v();
    return (await fetch(`${T}/rest/v1/roast_messages`, {
      method: "POST",
      headers: {
        ...n,
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        sender_id: s.user_id,
        recipient_id: i.id,
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
async function Jt(e) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return [];
  try {
    if (!await _()) return [];
    const t = await v(), s = await fetch(
      `${T}/rest/v1/roast_messages?recipient_username=eq.${e.toLowerCase()}&status=neq.read&order=created_at.desc&limit=20`,
      { method: "GET", headers: t }
    );
    return s.ok ? await s.json() : [];
  } catch (r) {
    return console.warn("Error fetching unread roasts:", r), [];
  }
}
async function Vt(e) {
  if (!(!e?.length || w === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      if ((await p("delete_roast_messages", { p_message_ids: e }))?.success) return;
      const t = await v(), s = e.map((a) => `"${a}"`).join(",");
      await fetch(`${T}/rest/v1/roast_messages?id=in.(${s})`, {
        method: "DELETE",
        headers: t
      });
    } catch (r) {
      console.warn("[SupabaseClient] markRoastsDelivered ephemeral delete error:", r);
    }
}
async function Qt(e) {
  if (!(!e?.length || w === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      if ((await p("delete_roast_messages", { p_message_ids: e }))?.success) return;
      const t = await v(), s = e.map((a) => `"${a}"`).join(",");
      await fetch(`${T}/rest/v1/roast_messages?id=in.(${s})`, {
        method: "DELETE",
        headers: t
      });
    } catch (r) {
      console.warn("[SupabaseClient] markRoastsRead ephemeral delete error:", r);
    }
}
async function Ke(e) {
  if (!e || w === "YOUR_SUPABASE_PROJECT_URL_HERE") return !0;
  try {
    const r = await v();
    return await fetch(`${T}/rest/v1/roast_messages?recipient_username=eq.${encodeURIComponent(e.toLowerCase())}`, {
      method: "DELETE",
      headers: r
    }), !0;
  } catch (r) {
    return console.warn("Error clearing roasts:", r), !1;
  }
}
async function N() {
  return typeof chrome > "u" || !chrome.storage?.local ? null : (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username || null;
}
async function be() {
  if (typeof chrome > "u" || !chrome.storage?.local) return null;
  try {
    return (await chrome.storage.local.get(["own_profile"])).own_profile || null;
  } catch (e) {
    return console.error("Error reading own profile from storage:", e), null;
  }
}
async function ee(e) {
  if (typeof chrome > "u" || !chrome.storage?.local) return !1;
  try {
    await chrome.storage.local.set({
      own_profile: e,
      last_own_profile_sync: Date.now()
    });
    const r = await N();
    return r && R() === y.AUTHENTICATED && Q(r, e).catch((t) => {
      console.warn("[Storage] Cloud sync for own profile failed (non-blocking):", t);
    }), !0;
  } catch (r) {
    return console.error("Error saving own profile to storage:", r), !1;
  }
}
async function H() {
  try {
    const e = await N(), r = typeof chrome < "u" && chrome.storage?.local ? await chrome.storage.local.get(["friends_cache", "own_profile", "friends_account_id"]) : {}, t = R() === y.AUTHENTICATED, a = (t ? await _() : null)?.user_id || null, n = (a ? r.friends_account_id === a : !r.friends_account_id) ? r.friends_cache || {} : {}, o = r.own_profile || null, l = { ...n };
    if (e && o && (l[e] = o), !t || !a)
      return l;
    try {
      const d = await Ve({ throwOnError: !0 });
      if (Array.isArray(d)) {
        const u = new Set(
          d.map((c) => (c.leetcode_username || "").toLowerCase()).filter(Boolean)
        );
        try {
          const c = await $();
          Array.isArray(c?.saved_friends) && c.saved_friends.forEach((f) => {
            const m = (f || "").toLowerCase().trim();
            m && u.add(m);
          });
        } catch {
        }
        for (const c of Object.keys(l))
          c.toLowerCase() !== e?.toLowerCase() && !u.has(c.toLowerCase()) && delete l[c];
        if (d.forEach((c) => {
          const f = (c.leetcode_username || "").toLowerCase();
          if (!f) return;
          const m = l[f] || {}, g = m.profile || {}, h = !!(m.submissionCalendar && (g.ranking || g.ranking === 0));
          l[f] = {
            ...m,
            username: f,
            profile: {
              ...g,
              username: f,
              realName: g.realName || c.display_name || f,
              avatar: g.avatar || c.avatar_url || "",
              ranking: g.ranking || 0
            },
            stats: {
              ...m.stats || {},
              total: m.stats?.total ?? c.total_solved ?? 0,
              easy: m.stats?.easy ?? c.easy_solved ?? 0,
              medium: m.stats?.medium ?? c.medium_solved ?? 0,
              hard: m.stats?.hard ?? c.hard_solved ?? 0,
              streak: m.stats?.streak ?? c.current_streak ?? 0,
              longestStreak: m.stats?.longestStreak ?? c.longest_streak ?? 0
            },
            contest: { rating: m.contest?.rating ?? c.contest_rating ?? 0 },
            friend_id: c.friend_id,
            friendship_id: c.friendship_id,
            submissionCalendar: m.submissionCalendar || null,
            lastUpdated: h ? m.lastUpdated || (c.last_synced_at ? new Date(c.last_synced_at).getTime() : Date.now()) : 0
          };
        }), typeof chrome < "u" && chrome.storage?.local) {
          const c = Object.keys(l).filter((m) => m.toLowerCase() !== e?.toLowerCase()), f = {
            accountId: a,
            friendIds: c,
            friendUsernames: c,
            friends: l,
            updatedAt: Date.now()
          };
          await chrome.storage.local.set({
            friends_cache: l,
            friends_list: c,
            friends_account_id: a,
            [`user_friends_${a}`]: f
          });
        }
      }
    } catch (d) {
      console.warn("[Storage] Permanent friends refresh skipped/failed:", d.message);
    }
    return l;
  } catch (e) {
    return console.error("Error getting friends:", e), {};
  }
}
async function Ze(e) {
  if (!e) return null;
  try {
    const r = await N();
    if (r && e.toLowerCase() === r.toLowerCase())
      return await be();
    if (typeof chrome < "u" && chrome.storage?.local) {
      const a = await chrome.storage.local.get(["friends_cache", "friends_account_id"]), o = (R() === y.AUTHENTICATED ? await _() : null)?.user_id || null, d = (o ? a.friends_account_id === o : !a.friends_account_id) ? Object.entries(a.friends_cache || {}).find(([u]) => u.toLowerCase() === e.toLowerCase())?.[1] : null;
      if (d)
        return d;
    }
    const t = await ze(e);
    if (!t) return null;
    const s = t.leetcode_data || {};
    return s.lastUpdated = t.last_synced_at ? new Date(t.last_synced_at).getTime() : Date.now(), s;
  } catch (r) {
    return console.error("Error getting single friend:", r), null;
  }
}
async function ke(e, r) {
  if (!e || !r) return { success: !1 };
  try {
    const t = await N();
    if (t && e.toLowerCase() === t.toLowerCase())
      return await ee(r), { success: !0 };
    const i = (await _())?.user_id || null;
    if (typeof chrome < "u" && chrome.storage?.local) {
      const n = await chrome.storage.local.get(["friends_cache", "friends_list"]), o = n.friends_cache || {}, l = n.friends_list || [], d = o[e] || {};
      o[e] = {
        ...r,
        friend_id: r.friend_id || d.friend_id || null,
        friendship_id: r.friendship_id || d.friendship_id || null
      };
      const u = l.some((f) => f.toLowerCase() === e.toLowerCase()) ? l : [...l, e], c = {
        friends_cache: o,
        friends_list: u
      };
      i && (c.friends_account_id = i, c[`user_friends_${i}`] = {
        accountId: i,
        friendIds: u,
        friendUsernames: u,
        friends: o,
        updatedAt: Date.now()
      }), await chrome.storage.local.set(c);
    }
    return R() === y.AUTHENTICATED && i && (Q(e, r).catch(() => {
    }), $().then((n) => {
      const o = Array.isArray(n?.saved_friends) ? n.saved_friends : [];
      o.map((l) => (l || "").toLowerCase()).includes(e.toLowerCase()) || oe({ saved_friends: [...o, e] }).catch(() => {
      });
    }).catch(() => {
    })), { success: !0 };
  } catch (t) {
    return console.error("Error saving friend:", t), { success: !1, error: t.message };
  }
}
async function Kt(e) {
  if (!e) return !1;
  try {
    const t = (await _())?.user_id || null;
    if (typeof chrome < "u" && chrome.storage?.local) {
      const s = await chrome.storage.local.get(["friends_cache", "friends_list"]), a = s.friends_cache || {}, i = s.friends_list || [];
      delete a[e];
      const n = i.filter((l) => l.toLowerCase() !== e.toLowerCase()), o = {
        friends_cache: a,
        friends_list: n
      };
      t && (o.friends_account_id = t, o[`user_friends_${t}`] = {
        accountId: t,
        friendIds: n,
        friendUsernames: n,
        friends: a,
        updatedAt: Date.now()
      }), await chrome.storage.local.set(o);
    }
    return R() === y.AUTHENTICATED && t && (Je(e).catch(() => {
    }), $().then((s) => {
      if (Array.isArray(s?.saved_friends)) {
        const a = s.saved_friends.filter((i) => (i || "").toLowerCase() !== e.toLowerCase());
        oe({ saved_friends: a }).catch(() => {
        });
      }
    }).catch(() => {
    })), !0;
  } catch (r) {
    return console.error("Error removing friend:", r), !1;
  }
}
async function Xe() {
  try {
    if (typeof chrome < "u" && chrome.storage?.local) {
      const e = await chrome.storage.local.get(["friends_list", "friends_account_id"]), r = R() === y.AUTHENTICATED, s = (r ? await _() : null)?.user_id || null;
      if ((s ? e.friends_account_id === s : !e.friends_account_id) && Array.isArray(e.friends_list)) return e.friends_list;
      if (e.friends_account_id && !s) return [];
      if (r && s) {
        const i = await H(), n = await N();
        return Object.keys(i).filter((o) => o.toLowerCase() !== n?.toLowerCase());
      }
    }
    if (R() === y.AUTHENTICATED) {
      const e = await H(), r = await N();
      return Object.keys(e).filter((t) => t.toLowerCase() !== r?.toLowerCase());
    }
    return [];
  } catch (e) {
    return console.error("Error getting friends list:", e), [];
  }
}
async function Zt(e, r, t) {
  return await Qe(e, r, t);
}
async function et() {
  const e = await N();
  return e ? await Ke(e) : !1;
}
const tt = [
  {
    slug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    topics: [
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "best-time-to-buy-and-sell-stock",
    title: "Best Time to Buy and Sell Stock",
    difficulty: "Easy",
    topics: [
      "Arrays"
    ]
  },
  {
    slug: "contains-duplicate",
    title: "Contains Duplicate",
    difficulty: "Easy",
    topics: [
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "product-of-array-except-self",
    title: "Product of Array Except Self",
    difficulty: "Medium",
    topics: [
      "Arrays"
    ]
  },
  {
    slug: "maximum-subarray",
    title: "Maximum Subarray",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Dynamic Programming"
    ]
  },
  {
    slug: "maximum-product-subarray",
    title: "Maximum Product Subarray",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Dynamic Programming"
    ]
  },
  {
    slug: "find-minimum-in-rotated-sorted-array",
    title: "Find Minimum in Rotated Sorted Array",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Binary Search"
    ]
  },
  {
    slug: "search-in-rotated-sorted-array",
    title: "Search in Rotated Sorted Array",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Binary Search"
    ]
  },
  {
    slug: "3sum",
    title: "3Sum",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Two Pointers"
    ]
  },
  {
    slug: "container-with-most-water",
    title: "Container With Most Water",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Two Pointers"
    ]
  },
  {
    slug: "trapping-rain-water",
    title: "Trapping Rain Water",
    difficulty: "Hard",
    topics: [
      "Arrays",
      "Two Pointers"
    ]
  },
  {
    slug: "move-zeroes",
    title: "Move Zeroes",
    difficulty: "Easy",
    topics: [
      "Arrays",
      "Two Pointers"
    ]
  },
  {
    slug: "squares-of-a-sorted-array",
    title: "Squares of a Sorted Array",
    difficulty: "Easy",
    topics: [
      "Arrays",
      "Two Pointers",
      "Sorting"
    ]
  },
  {
    slug: "rotate-array",
    title: "Rotate Array",
    difficulty: "Medium",
    topics: [
      "Arrays"
    ]
  },
  {
    slug: "merge-intervals",
    title: "Merge Intervals",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Sorting",
      "Intervals"
    ]
  },
  {
    slug: "insert-interval",
    title: "Insert Interval",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Intervals"
    ]
  },
  {
    slug: "non-overlapping-intervals",
    title: "Non-overlapping Intervals",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Intervals",
      "Greedy"
    ]
  },
  {
    slug: "meeting-rooms",
    title: "Meeting Rooms",
    difficulty: "Easy",
    topics: [
      "Arrays",
      "Intervals",
      "Sorting"
    ]
  },
  {
    slug: "meeting-rooms-ii",
    title: "Meeting Rooms II",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Intervals",
      "Heaps"
    ]
  },
  {
    slug: "spiral-matrix",
    title: "Spiral Matrix",
    difficulty: "Medium",
    topics: [
      "Arrays"
    ]
  },
  {
    slug: "set-matrix-zeroes",
    title: "Set Matrix Zeroes",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "rotate-image",
    title: "Rotate Image",
    difficulty: "Medium",
    topics: [
      "Arrays"
    ]
  },
  {
    slug: "word-search",
    title: "Word Search",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Backtracking"
    ]
  },
  {
    slug: "jump-game",
    title: "Jump Game",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Greedy"
    ]
  },
  {
    slug: "jump-game-ii",
    title: "Jump Game II",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Greedy"
    ]
  },
  {
    slug: "gas-station",
    title: "Gas Station",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Greedy"
    ]
  },
  {
    slug: "candy",
    title: "Candy",
    difficulty: "Hard",
    topics: [
      "Arrays",
      "Greedy"
    ]
  },
  {
    slug: "valid-anagram",
    title: "Valid Anagram",
    difficulty: "Easy",
    topics: [
      "Strings",
      "Hashing",
      "Sorting"
    ]
  },
  {
    slug: "group-anagrams",
    title: "Group Anagrams",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Hashing",
      "Sorting"
    ]
  },
  {
    slug: "longest-substring-without-repeating-characters",
    title: "Longest Substring Without Repeating Characters",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Hashing",
      "Sliding Window"
    ]
  },
  {
    slug: "longest-repeating-character-replacement",
    title: "Longest Repeating Character Replacement",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Sliding Window"
    ]
  },
  {
    slug: "minimum-window-substring",
    title: "Minimum Window Substring",
    difficulty: "Hard",
    topics: [
      "Strings",
      "Sliding Window",
      "Hashing"
    ]
  },
  {
    slug: "valid-palindrome",
    title: "Valid Palindrome",
    difficulty: "Easy",
    topics: [
      "Strings",
      "Two Pointers"
    ]
  },
  {
    slug: "palindromic-substrings",
    title: "Palindromic Substrings",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Dynamic Programming"
    ]
  },
  {
    slug: "longest-palindromic-substring",
    title: "Longest Palindromic Substring",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Dynamic Programming"
    ]
  },
  {
    slug: "encode-and-decode-strings",
    title: "Encode and Decode Strings",
    difficulty: "Medium",
    topics: [
      "Strings"
    ]
  },
  {
    slug: "count-and-say",
    title: "Count and Say",
    difficulty: "Medium",
    topics: [
      "Strings"
    ]
  },
  {
    slug: "string-to-integer-atoi",
    title: "String to Integer (atoi)",
    difficulty: "Medium",
    topics: [
      "Strings"
    ]
  },
  {
    slug: "reverse-string",
    title: "Reverse String",
    difficulty: "Easy",
    topics: [
      "Strings",
      "Two Pointers"
    ]
  },
  {
    slug: "reverse-words-in-a-string",
    title: "Reverse Words in a String",
    difficulty: "Medium",
    topics: [
      "Strings"
    ]
  },
  {
    slug: "find-all-anagrams-in-a-string",
    title: "Find All Anagrams in a String",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Hashing",
      "Sliding Window"
    ]
  },
  {
    slug: "permutation-in-string",
    title: "Permutation in String",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Hashing",
      "Sliding Window"
    ]
  },
  {
    slug: "sliding-window-maximum",
    title: "Sliding Window Maximum",
    difficulty: "Hard",
    topics: [
      "Sliding Window",
      "Queues",
      "Heaps"
    ]
  },
  {
    slug: "binary-search",
    title: "Binary Search",
    difficulty: "Easy",
    topics: [
      "Binary Search"
    ]
  },
  {
    slug: "search-a-2d-matrix",
    title: "Search a 2D Matrix",
    difficulty: "Medium",
    topics: [
      "Binary Search",
      "Arrays"
    ]
  },
  {
    slug: "koko-eating-bananas",
    title: "Koko Eating Bananas",
    difficulty: "Medium",
    topics: [
      "Binary Search"
    ]
  },
  {
    slug: "time-based-key-value-store",
    title: "Time Based Key-Value Store",
    difficulty: "Medium",
    topics: [
      "Binary Search",
      "Hashing"
    ]
  },
  {
    slug: "median-of-two-sorted-arrays",
    title: "Median of Two Sorted Arrays",
    difficulty: "Hard",
    topics: [
      "Binary Search",
      "Arrays"
    ]
  },
  {
    slug: "reverse-linked-list",
    title: "Reverse Linked List",
    difficulty: "Easy",
    topics: [
      "Linked Lists"
    ]
  },
  {
    slug: "merge-two-sorted-lists",
    title: "Merge Two Sorted Lists",
    difficulty: "Easy",
    topics: [
      "Linked Lists"
    ]
  },
  {
    slug: "linked-list-cycle",
    title: "Linked List Cycle",
    difficulty: "Easy",
    topics: [
      "Linked Lists",
      "Two Pointers"
    ]
  },
  {
    slug: "reorder-list",
    title: "Reorder List",
    difficulty: "Medium",
    topics: [
      "Linked Lists"
    ]
  },
  {
    slug: "remove-nth-node-from-end-of-list",
    title: "Remove Nth Node From End of List",
    difficulty: "Medium",
    topics: [
      "Linked Lists",
      "Two Pointers"
    ]
  },
  {
    slug: "copy-list-with-random-pointer",
    title: "Copy List with Random Pointer",
    difficulty: "Medium",
    topics: [
      "Linked Lists",
      "Hashing"
    ]
  },
  {
    slug: "add-two-numbers",
    title: "Add Two Numbers",
    difficulty: "Medium",
    topics: [
      "Linked Lists",
      "Math"
    ]
  },
  {
    slug: "lru-cache",
    title: "LRU Cache",
    difficulty: "Medium",
    topics: [
      "Linked Lists",
      "Hashing"
    ]
  },
  {
    slug: "merge-k-sorted-lists",
    title: "Merge K Sorted Lists",
    difficulty: "Hard",
    topics: [
      "Linked Lists",
      "Heaps"
    ]
  },
  {
    slug: "reverse-nodes-in-k-group",
    title: "Reverse Nodes in k-Group",
    difficulty: "Hard",
    topics: [
      "Linked Lists"
    ]
  },
  {
    slug: "valid-parentheses",
    title: "Valid Parentheses",
    difficulty: "Easy",
    topics: [
      "Stacks"
    ]
  },
  {
    slug: "min-stack",
    title: "Min Stack",
    difficulty: "Medium",
    topics: [
      "Stacks"
    ]
  },
  {
    slug: "evaluate-reverse-polish-notation",
    title: "Evaluate Reverse Polish Notation",
    difficulty: "Medium",
    topics: [
      "Stacks"
    ]
  },
  {
    slug: "generate-parentheses",
    title: "Generate Parentheses",
    difficulty: "Medium",
    topics: [
      "Stacks",
      "Backtracking"
    ]
  },
  {
    slug: "daily-temperatures",
    title: "Daily Temperatures",
    difficulty: "Medium",
    topics: [
      "Stacks",
      "Arrays"
    ]
  },
  {
    slug: "car-fleet",
    title: "Car Fleet",
    difficulty: "Medium",
    topics: [
      "Stacks",
      "Arrays",
      "Sorting"
    ]
  },
  {
    slug: "largest-rectangle-in-histogram",
    title: "Largest Rectangle in Histogram",
    difficulty: "Hard",
    topics: [
      "Stacks",
      "Arrays"
    ]
  },
  {
    slug: "number-of-recent-calls",
    title: "Number of Recent Calls",
    difficulty: "Easy",
    topics: [
      "Queues"
    ]
  },
  {
    slug: "implement-queue-using-stacks",
    title: "Implement Queue using Stacks",
    difficulty: "Easy",
    topics: [
      "Queues",
      "Stacks"
    ]
  },
  {
    slug: "design-circular-queue",
    title: "Design Circular Queue",
    difficulty: "Medium",
    topics: [
      "Queues"
    ]
  },
  {
    slug: "invert-binary-tree",
    title: "Invert Binary Tree",
    difficulty: "Easy",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "maximum-depth-of-binary-tree",
    title: "Maximum Depth of Binary Tree",
    difficulty: "Easy",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "diameter-of-binary-tree",
    title: "Diameter of Binary Tree",
    difficulty: "Easy",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "balanced-binary-tree",
    title: "Balanced Binary Tree",
    difficulty: "Easy",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "same-tree",
    title: "Same Tree",
    difficulty: "Easy",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "subtree-of-another-tree",
    title: "Subtree of Another Tree",
    difficulty: "Easy",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "lowest-common-ancestor-of-a-binary-search-tree",
    title: "Lowest Common Ancestor of a BST",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "binary-tree-level-order-traversal",
    title: "Binary Tree Level Order Traversal",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "binary-tree-right-side-view",
    title: "Binary Tree Right Side View",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "count-good-nodes-in-binary-tree",
    title: "Count Good Nodes in Binary Tree",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "validate-binary-search-tree",
    title: "Validate Binary Search Tree",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "kth-smallest-element-in-a-bst",
    title: "Kth Smallest Element in a BST",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "construct-binary-tree-from-preorder-and-inorder-traversal",
    title: "Construct Binary Tree from Preorder and Inorder",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "binary-tree-maximum-path-sum",
    title: "Binary Tree Maximum Path Sum",
    difficulty: "Hard",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "serialize-and-deserialize-binary-tree",
    title: "Serialize and Deserialize Binary Tree",
    difficulty: "Hard",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "kth-largest-element-in-an-array",
    title: "Kth Largest Element in an Array",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Sorting"
    ]
  },
  {
    slug: "last-stone-weight",
    title: "Last Stone Weight",
    difficulty: "Easy",
    topics: [
      "Heaps"
    ]
  },
  {
    slug: "k-closest-points-to-origin",
    title: "K Closest Points to Origin",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Sorting"
    ]
  },
  {
    slug: "task-scheduler",
    title: "Task Scheduler",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Greedy"
    ]
  },
  {
    slug: "design-twitter",
    title: "Design Twitter",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Hashing"
    ]
  },
  {
    slug: "find-median-from-data-stream",
    title: "Find Median from Data Stream",
    difficulty: "Hard",
    topics: [
      "Heaps"
    ]
  },
  {
    slug: "number-of-islands",
    title: "Number of Islands",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "max-area-of-island",
    title: "Max Area of Island",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "clone-graph",
    title: "Clone Graph",
    difficulty: "Medium",
    topics: [
      "Graphs",
      "Hashing"
    ]
  },
  {
    slug: "walls-and-gates",
    title: "Walls and Gates",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "rotting-oranges",
    title: "Rotting Oranges",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "pacific-atlantic-water-flow",
    title: "Pacific Atlantic Water Flow",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "course-schedule",
    title: "Course Schedule",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "course-schedule-ii",
    title: "Course Schedule II",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "number-of-connected-components-in-an-undirected-graph",
    title: "Number of Connected Components",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "graph-valid-tree",
    title: "Graph Valid Tree",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "word-ladder",
    title: "Word Ladder",
    difficulty: "Hard",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "alien-dictionary",
    title: "Alien Dictionary",
    difficulty: "Hard",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "climbing-stairs",
    title: "Climbing Stairs",
    difficulty: "Easy",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "min-cost-climbing-stairs",
    title: "Min Cost Climbing Stairs",
    difficulty: "Easy",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "house-robber",
    title: "House Robber",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "house-robber-ii",
    title: "House Robber II",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "longest-palindromic-subsequence",
    title: "Longest Palindromic Subsequence",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "decode-ways",
    title: "Decode Ways",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "coin-change",
    title: "Coin Change",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "maximum-product-subarray",
    title: "Maximum Product Subarray",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Arrays"
    ]
  },
  {
    slug: "word-break",
    title: "Word Break",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Hashing"
    ]
  },
  {
    slug: "longest-increasing-subsequence",
    title: "Longest Increasing Subsequence",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Binary Search"
    ]
  },
  {
    slug: "partition-equal-subset-sum",
    title: "Partition Equal Subset Sum",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "unique-paths",
    title: "Unique Paths",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Math"
    ]
  },
  {
    slug: "unique-paths-ii",
    title: "Unique Paths II",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Arrays"
    ]
  },
  {
    slug: "longest-common-subsequence",
    title: "Longest Common Subsequence",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Strings"
    ]
  },
  {
    slug: "edit-distance",
    title: "Edit Distance",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Strings"
    ]
  },
  {
    slug: "triangle",
    title: "Triangle",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Arrays"
    ]
  },
  {
    slug: "burst-balloons",
    title: "Burst Balloons",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "regular-expression-matching",
    title: "Regular Expression Matching",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming",
      "Strings"
    ]
  },
  {
    slug: "wildcard-matching",
    title: "Wildcard Matching",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming",
      "Strings"
    ]
  },
  {
    slug: "interleaving-string",
    title: "Interleaving String",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Strings"
    ]
  },
  {
    slug: "subsets",
    title: "Subsets",
    difficulty: "Medium",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "combination-sum",
    title: "Combination Sum",
    difficulty: "Medium",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "combination-sum-ii",
    title: "Combination Sum II",
    difficulty: "Medium",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "permutations",
    title: "Permutations",
    difficulty: "Medium",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "permutations-ii",
    title: "Permutations II",
    difficulty: "Medium",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "word-search-ii",
    title: "Word Search II",
    difficulty: "Hard",
    topics: [
      "Backtracking",
      "Tries"
    ]
  },
  {
    slug: "palindrome-partitioning",
    title: "Palindrome Partitioning",
    difficulty: "Medium",
    topics: [
      "Backtracking",
      "Dynamic Programming"
    ]
  },
  {
    slug: "letter-combinations-of-a-phone-number",
    title: "Letter Combinations of a Phone Number",
    difficulty: "Medium",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "n-queens",
    title: "N-Queens",
    difficulty: "Hard",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "sudoku-solver",
    title: "Sudoku Solver",
    difficulty: "Hard",
    topics: [
      "Backtracking"
    ]
  },
  {
    slug: "implement-trie-prefix-tree",
    title: "Implement Trie (Prefix Tree)",
    difficulty: "Medium",
    topics: [
      "Tries"
    ]
  },
  {
    slug: "design-add-and-search-words-data-structure",
    title: "Design Add and Search Words Data Structure",
    difficulty: "Medium",
    topics: [
      "Tries",
      "Backtracking"
    ]
  },
  {
    slug: "number-of-1-bits",
    title: "Number of 1 Bits",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation"
    ]
  },
  {
    slug: "counting-bits",
    title: "Counting Bits",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation",
      "Dynamic Programming"
    ]
  },
  {
    slug: "reverse-bits",
    title: "Reverse Bits",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation"
    ]
  },
  {
    slug: "missing-number",
    title: "Missing Number",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation",
      "Arrays",
      "Hashing",
      "Math"
    ]
  },
  {
    slug: "single-number",
    title: "Single Number",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation",
      "Arrays"
    ]
  },
  {
    slug: "sum-of-two-integers",
    title: "Sum of Two Integers",
    difficulty: "Medium",
    topics: [
      "Bit Manipulation",
      "Math"
    ]
  },
  {
    slug: "reverse-integer",
    title: "Reverse Integer",
    difficulty: "Medium",
    topics: [
      "Math"
    ]
  },
  {
    slug: "palindrome-number",
    title: "Palindrome Number",
    difficulty: "Easy",
    topics: [
      "Math"
    ]
  },
  {
    slug: "excel-sheet-column-number",
    title: "Excel Sheet Column Number",
    difficulty: "Easy",
    topics: [
      "Math",
      "Strings"
    ]
  },
  {
    slug: "happy-number",
    title: "Happy Number",
    difficulty: "Easy",
    topics: [
      "Math",
      "Hashing",
      "Two Pointers"
    ]
  },
  {
    slug: "plus-one",
    title: "Plus One",
    difficulty: "Easy",
    topics: [
      "Math",
      "Arrays"
    ]
  },
  {
    slug: "sqrt-x",
    title: "Sqrt(x)",
    difficulty: "Easy",
    topics: [
      "Math",
      "Binary Search"
    ]
  },
  {
    slug: "power-x-n",
    title: "Pow(x, n)",
    difficulty: "Medium",
    topics: [
      "Math"
    ]
  },
  {
    slug: "multiply-strings",
    title: "Multiply Strings",
    difficulty: "Medium",
    topics: [
      "Math",
      "Strings"
    ]
  },
  {
    slug: "count-primes",
    title: "Count Primes",
    difficulty: "Medium",
    topics: [
      "Math"
    ]
  },
  {
    slug: "excel-sheet-column-title",
    title: "Excel Sheet Column Title",
    difficulty: "Easy",
    topics: [
      "Math",
      "Strings"
    ]
  },
  {
    slug: "sort-an-array",
    title: "Sort an Array",
    difficulty: "Medium",
    topics: [
      "Sorting"
    ]
  },
  {
    slug: "merge-sorted-array",
    title: "Merge Sorted Array",
    difficulty: "Easy",
    topics: [
      "Sorting",
      "Arrays",
      "Two Pointers"
    ]
  },
  {
    slug: "sort-colors",
    title: "Sort Colors",
    difficulty: "Medium",
    topics: [
      "Sorting",
      "Arrays",
      "Two Pointers"
    ]
  },
  {
    slug: "insertion-sort-list",
    title: "Insertion Sort List",
    difficulty: "Medium",
    topics: [
      "Sorting",
      "Linked Lists"
    ]
  },
  {
    slug: "sort-list",
    title: "Sort List",
    difficulty: "Medium",
    topics: [
      "Sorting",
      "Linked Lists"
    ]
  },
  {
    slug: "maximum-gap",
    title: "Maximum Gap",
    difficulty: "Hard",
    topics: [
      "Sorting",
      "Arrays"
    ]
  },
  {
    slug: "top-k-frequent-elements",
    title: "Top K Frequent Elements",
    difficulty: "Medium",
    topics: [
      "Hashing",
      "Heaps",
      "Sorting"
    ]
  },
  {
    slug: "two-sum-ii-input-array-is-sorted",
    title: "Two Sum II - Input Array Is Sorted",
    difficulty: "Medium",
    topics: [
      "Two Pointers",
      "Binary Search",
      "Arrays"
    ]
  },
  {
    slug: "4sum",
    title: "4Sum",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Two Pointers",
      "Sorting"
    ]
  },
  {
    slug: "longest-consecutive-sequence",
    title: "Longest Consecutive Sequence",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "encode-and-decode-tinyurl",
    title: "Encode and Decode TinyURL",
    difficulty: "Medium",
    topics: [
      "Hashing"
    ]
  },
  {
    slug: "design-hashmap",
    title: "Design HashMap",
    difficulty: "Easy",
    topics: [
      "Hashing"
    ]
  },
  {
    slug: "design-hashset",
    title: "Design HashSet",
    difficulty: "Easy",
    topics: [
      "Hashing"
    ]
  },
  {
    slug: "number-of-provinces",
    title: "Number of Provinces",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "keys-and-rooms",
    title: "Keys and Rooms",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "01-matrix",
    title: "01 Matrix",
    difficulty: "Medium",
    topics: [
      "Graphs",
      "Dynamic Programming"
    ]
  },
  {
    slug: "surrounded-regions",
    title: "Surrounded Regions",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "find-the-town-judge",
    title: "Find the Town Judge",
    difficulty: "Easy",
    topics: [
      "Graphs",
      "Arrays"
    ]
  },
  {
    slug: "redundant-connection",
    title: "Redundant Connection",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "minimum-height-trees",
    title: "Minimum Height Trees",
    difficulty: "Medium",
    topics: [
      "Graphs",
      "Trees"
    ]
  },
  {
    slug: "longest-zigzag-path-in-a-binary-tree",
    title: "Longest ZigZag Path in a Binary Tree",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "path-sum-iii",
    title: "Path Sum III",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Hashing"
    ]
  },
  {
    slug: "flatten-binary-tree-to-linked-list",
    title: "Flatten Binary Tree to Linked List",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Linked Lists"
    ]
  },
  {
    slug: "convert-sorted-array-to-binary-search-tree",
    title: "Convert Sorted Array to BST",
    difficulty: "Easy",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "delete-node-in-a-bst",
    title: "Delete Node in a BST",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "insert-into-a-binary-search-tree",
    title: "Insert into a Binary Search Tree",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "number-of-ways-to-stay-in-the-same-place-after-some-steps",
    title: "Number of Ways to Stay in Same Place",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "target-sum",
    title: "Target Sum",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Backtracking",
      "Arrays"
    ]
  },
  {
    slug: "ones-and-zeroes",
    title: "Ones and Zeroes",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "last-stone-weight-ii",
    title: "Last Stone Weight II",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "count-square-submatrices-with-all-ones",
    title: "Count Square Submatrices with All Ones",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Arrays"
    ]
  },
  {
    slug: "number-of-submatrices-that-sum-to-target",
    title: "Number of Submatrices That Sum to Target",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming",
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "rotate-list",
    title: "Rotate List",
    difficulty: "Medium",
    topics: [
      "Linked Lists",
      "Two Pointers"
    ]
  },
  {
    slug: "odd-even-linked-list",
    title: "Odd Even Linked List",
    difficulty: "Medium",
    topics: [
      "Linked Lists"
    ]
  },
  {
    slug: "remove-duplicates-from-sorted-list",
    title: "Remove Duplicates from Sorted List",
    difficulty: "Easy",
    topics: [
      "Linked Lists"
    ]
  },
  {
    slug: "remove-duplicates-from-sorted-list-ii",
    title: "Remove Duplicates from Sorted List II",
    difficulty: "Medium",
    topics: [
      "Linked Lists",
      "Two Pointers"
    ]
  },
  {
    slug: "palindrome-linked-list",
    title: "Palindrome Linked List",
    difficulty: "Easy",
    topics: [
      "Linked Lists",
      "Two Pointers"
    ]
  },
  {
    slug: "intersection-of-two-linked-lists",
    title: "Intersection of Two Linked Lists",
    difficulty: "Easy",
    topics: [
      "Linked Lists",
      "Two Pointers",
      "Hashing"
    ]
  },
  {
    slug: "flatten-a-multilevel-doubly-linked-list",
    title: "Flatten a Multilevel Doubly Linked List",
    difficulty: "Medium",
    topics: [
      "Linked Lists"
    ]
  },
  {
    slug: "find-peak-element",
    title: "Find Peak Element",
    difficulty: "Medium",
    topics: [
      "Binary Search",
      "Arrays"
    ]
  },
  {
    slug: "search-in-a-sorted-array-of-unknown-size",
    title: "Search in a Sorted Array of Unknown Size",
    difficulty: "Medium",
    topics: [
      "Binary Search"
    ]
  },
  {
    slug: "count-of-range-sum",
    title: "Count of Range Sum",
    difficulty: "Hard",
    topics: [
      "Binary Search",
      "Sorting"
    ]
  },
  {
    slug: "russian-doll-envelopes",
    title: "Russian Doll Envelopes",
    difficulty: "Hard",
    topics: [
      "Binary Search",
      "Dynamic Programming",
      "Sorting"
    ]
  },
  {
    slug: "count-of-smaller-numbers-after-self",
    title: "Count of Smaller Numbers After Self",
    difficulty: "Hard",
    topics: [
      "Binary Search",
      "Sorting"
    ]
  },
  {
    slug: "next-permutation",
    title: "Next Permutation",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Two Pointers"
    ]
  },
  {
    slug: "first-missing-positive",
    title: "First Missing Positive",
    difficulty: "Hard",
    topics: [
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "game-of-life",
    title: "Game of Life",
    difficulty: "Medium",
    topics: [
      "Arrays"
    ]
  },
  {
    slug: "finding-the-users-active-minutes",
    title: "Finding the Users Active Minutes",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "longest-common-prefix",
    title: "Longest Common Prefix",
    difficulty: "Easy",
    topics: [
      "Strings",
      "Tries"
    ]
  },
  {
    slug: "add-binary",
    title: "Add Binary",
    difficulty: "Easy",
    topics: [
      "Strings",
      "Math",
      "Bit Manipulation"
    ]
  },
  {
    slug: "roman-to-integer",
    title: "Roman to Integer",
    difficulty: "Easy",
    topics: [
      "Strings",
      "Math",
      "Hashing"
    ]
  },
  {
    slug: "integer-to-roman",
    title: "Integer to Roman",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Math"
    ]
  },
  {
    slug: "zigzag-conversion",
    title: "ZigZag Conversion",
    difficulty: "Medium",
    topics: [
      "Strings"
    ]
  },
  {
    slug: "multiply-strings",
    title: "Multiply Strings",
    difficulty: "Medium",
    topics: [
      "Strings",
      "Math"
    ]
  },
  {
    slug: "basic-calculator",
    title: "Basic Calculator",
    difficulty: "Hard",
    topics: [
      "Stacks",
      "Math",
      "Strings"
    ]
  },
  {
    slug: "basic-calculator-ii",
    title: "Basic Calculator II",
    difficulty: "Medium",
    topics: [
      "Stacks",
      "Math",
      "Strings"
    ]
  },
  {
    slug: "score-of-parentheses",
    title: "Score of Parentheses",
    difficulty: "Medium",
    topics: [
      "Stacks",
      "Strings"
    ]
  },
  {
    slug: "number-of-atoms",
    title: "Number of Atoms",
    difficulty: "Hard",
    topics: [
      "Stacks",
      "Strings",
      "Hashing",
      "Sorting"
    ]
  },
  {
    slug: "decode-string",
    title: "Decode String",
    difficulty: "Medium",
    topics: [
      "Stacks",
      "Strings"
    ]
  },
  {
    slug: "flatten-nested-list-iterator",
    title: "Flatten Nested List Iterator",
    difficulty: "Medium",
    topics: [
      "Stacks",
      "Queues"
    ]
  },
  {
    slug: "design-snake-game",
    title: "Design Snake Game",
    difficulty: "Medium",
    topics: [
      "Queues",
      "Hashing"
    ]
  },
  {
    slug: "task-scheduler",
    title: "Task Scheduler",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Greedy",
      "Hashing"
    ]
  },
  {
    slug: "reorganize-string",
    title: "Reorganize String",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Hashing",
      "Greedy",
      "Strings"
    ]
  },
  {
    slug: "furthest-building-you-can-reach",
    title: "Furthest Building You Can Reach",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Greedy"
    ]
  },
  {
    slug: "single-threaded-cpu",
    title: "Single-Threaded CPU",
    difficulty: "Medium",
    topics: [
      "Heaps",
      "Sorting"
    ]
  },
  {
    slug: "process-tasks-using-servers",
    title: "Process Tasks Using Servers",
    difficulty: "Medium",
    topics: [
      "Heaps"
    ]
  },
  {
    slug: "minimum-cost-to-hire-k-workers",
    title: "Minimum Cost to Hire K Workers",
    difficulty: "Hard",
    topics: [
      "Heaps",
      "Sorting",
      "Greedy"
    ]
  },
  {
    slug: "swim-in-rising-water",
    title: "Swim in Rising Water",
    difficulty: "Hard",
    topics: [
      "Heaps",
      "Graphs",
      "Binary Search"
    ]
  },
  {
    slug: "number-of-ways-to-reorder-array-to-get-same-bst",
    title: "Number of Ways to Reorder Array to Get Same BST",
    difficulty: "Hard",
    topics: [
      "Trees",
      "Binary Search Trees",
      "Dynamic Programming",
      "Math"
    ]
  },
  {
    slug: "flatten-binary-tree-to-linked-list",
    title: "Flatten Binary Tree to Linked List",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Linked Lists"
    ]
  },
  {
    slug: "path-sum",
    title: "Path Sum",
    difficulty: "Easy",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "path-sum-ii",
    title: "Path Sum II",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Backtracking"
    ]
  },
  {
    slug: "sum-root-to-leaf-numbers",
    title: "Sum Root to Leaf Numbers",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "binary-tree-zigzag-level-order-traversal",
    title: "Binary Tree Zigzag Level Order Traversal",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "populating-next-right-pointers-in-each-node",
    title: "Populating Next Right Pointers in Each Node",
    difficulty: "Medium",
    topics: [
      "Trees"
    ]
  },
  {
    slug: "recover-binary-search-tree",
    title: "Recover Binary Search Tree",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "count-of-nodes-in-complete-tree",
    title: "Count Complete Tree Nodes",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search"
    ]
  },
  {
    slug: "find-duplicate-subtrees",
    title: "Find Duplicate Subtrees",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Hashing"
    ]
  },
  {
    slug: "convert-bst-to-greater-tree",
    title: "Convert BST to Greater Tree",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "trim-a-binary-search-tree",
    title: "Trim a Binary Search Tree",
    difficulty: "Medium",
    topics: [
      "Trees",
      "Binary Search Trees"
    ]
  },
  {
    slug: "range-sum-query-immutable",
    title: "Range Sum Query - Immutable",
    difficulty: "Easy",
    topics: [
      "Arrays",
      "Dynamic Programming"
    ]
  },
  {
    slug: "range-sum-query-2d-immutable",
    title: "Range Sum Query 2D - Immutable",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Dynamic Programming",
      "Math"
    ]
  },
  {
    slug: "number-of-longest-increasing-subsequence",
    title: "Number of Longest Increasing Subsequence",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Binary Search"
    ]
  },
  {
    slug: "russian-doll-envelopes",
    title: "Russian Doll Envelopes",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming",
      "Binary Search",
      "Sorting"
    ]
  },
  {
    slug: "frog-jump",
    title: "Frog Jump",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming"
    ]
  },
  {
    slug: "dungeon-game",
    title: "Dungeon Game",
    difficulty: "Hard",
    topics: [
      "Dynamic Programming",
      "Arrays"
    ]
  },
  {
    slug: "minimum-path-sum",
    title: "Minimum Path Sum",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Arrays"
    ]
  },
  {
    slug: "maximal-square",
    title: "Maximal Square",
    difficulty: "Medium",
    topics: [
      "Dynamic Programming",
      "Arrays"
    ]
  },
  {
    slug: "number-of-substrings-containing-all-three-characters",
    title: "Number of Substrings Containing All Three Characters",
    difficulty: "Medium",
    topics: [
      "Sliding Window",
      "Strings",
      "Hashing"
    ]
  },
  {
    slug: "count-number-of-nice-subarrays",
    title: "Count Number of Nice Subarrays",
    difficulty: "Medium",
    topics: [
      "Sliding Window",
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "replace-the-substring-for-balanced-string",
    title: "Replace the Substring for Balanced String",
    difficulty: "Medium",
    topics: [
      "Sliding Window",
      "Strings"
    ]
  },
  {
    slug: "max-consecutive-ones-iii",
    title: "Max Consecutive Ones III",
    difficulty: "Medium",
    topics: [
      "Sliding Window",
      "Arrays"
    ]
  },
  {
    slug: "subarrays-with-k-different-integers",
    title: "Subarrays with K Different Integers",
    difficulty: "Hard",
    topics: [
      "Sliding Window",
      "Arrays",
      "Hashing"
    ]
  },
  {
    slug: "number-of-substrings-with-only-1s",
    title: "Number of Substrings With Only 1s",
    difficulty: "Medium",
    topics: [
      "Sliding Window",
      "Strings",
      "Math"
    ]
  },
  {
    slug: "bitwise-and-of-numbers-range",
    title: "Bitwise AND of Numbers Range",
    difficulty: "Medium",
    topics: [
      "Bit Manipulation",
      "Math"
    ]
  },
  {
    slug: "number-of-1-bits",
    title: "Number of 1 Bits",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation"
    ]
  },
  {
    slug: "power-of-two",
    title: "Power of Two",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation",
      "Math"
    ]
  },
  {
    slug: "power-of-three",
    title: "Power of Three",
    difficulty: "Easy",
    topics: [
      "Math"
    ]
  },
  {
    slug: "power-of-four",
    title: "Power of Four",
    difficulty: "Easy",
    topics: [
      "Bit Manipulation",
      "Math"
    ]
  },
  {
    slug: "find-the-duplicate-number",
    title: "Find the Duplicate Number",
    difficulty: "Medium",
    topics: [
      "Arrays",
      "Two Pointers",
      "Bit Manipulation",
      "Binary Search"
    ]
  },
  {
    slug: "single-number-ii",
    title: "Single Number II",
    difficulty: "Medium",
    topics: [
      "Bit Manipulation"
    ]
  },
  {
    slug: "single-number-iii",
    title: "Single Number III",
    difficulty: "Medium",
    topics: [
      "Bit Manipulation",
      "Arrays"
    ]
  },
  {
    slug: "maximum-xor-of-two-numbers-in-an-array",
    title: "Maximum XOR of Two Numbers in an Array",
    difficulty: "Medium",
    topics: [
      "Bit Manipulation",
      "Tries"
    ]
  },
  {
    slug: "total-hamming-distance",
    title: "Total Hamming Distance",
    difficulty: "Medium",
    topics: [
      "Bit Manipulation",
      "Arrays"
    ]
  },
  {
    slug: "erect-the-fence",
    title: "Erect the Fence",
    difficulty: "Hard",
    topics: [
      "Greedy",
      "Math",
      "Sorting"
    ]
  },
  {
    slug: "minimum-number-of-arrows-to-burst-balloons",
    title: "Minimum Number of Arrows to Burst Balloons",
    difficulty: "Medium",
    topics: [
      "Greedy",
      "Intervals",
      "Sorting"
    ]
  },
  {
    slug: "partition-labels",
    title: "Partition Labels",
    difficulty: "Medium",
    topics: [
      "Greedy",
      "Strings",
      "Two Pointers"
    ]
  },
  {
    slug: "bag-of-tokens",
    title: "Bag of Tokens",
    difficulty: "Medium",
    topics: [
      "Greedy",
      "Two Pointers",
      "Sorting"
    ]
  },
  {
    slug: "lemonade-change",
    title: "Lemonade Change",
    difficulty: "Easy",
    topics: [
      "Greedy"
    ]
  },
  {
    slug: "assign-cookies",
    title: "Assign Cookies",
    difficulty: "Easy",
    topics: [
      "Greedy",
      "Sorting"
    ]
  },
  {
    slug: "is-graph-bipartite",
    title: "Is Graph Bipartite?",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "find-eventual-safe-states",
    title: "Find Eventual Safe States",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "all-paths-from-source-to-target",
    title: "All Paths From Source to Target",
    difficulty: "Medium",
    topics: [
      "Graphs",
      "Backtracking"
    ]
  },
  {
    slug: "time-needed-to-inform-all-employees",
    title: "Time Needed to Inform All Employees",
    difficulty: "Medium",
    topics: [
      "Graphs",
      "Trees"
    ]
  },
  {
    slug: "count-unreachable-pairs-of-nodes-in-an-undirected-graph",
    title: "Count Unreachable Pairs of Nodes",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  },
  {
    slug: "minimum-score-of-a-path-between-two-cities",
    title: "Minimum Score of a Path Between Two Cities",
    difficulty: "Medium",
    topics: [
      "Graphs"
    ]
  }
], Xt = w.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), er = {
  IN_PROGRESS: "in_progress"
};
async function G(e, r = {}) {
  if (w === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await v(), { headers: s, ...a } = r, i = await fetch(`${Xt}/rest/v1/${e}`, {
      ...a,
      headers: { ...t, ...s || {} }
    });
    return i.ok ? i.json() : (console.error(`[Battle] Supabase error ${i.status} on ${e}:`, await i.text()), null);
  } catch (t) {
    return console.error("[Battle] Supabase fetch error:", t), null;
  }
}
function tr({ topics: e = [], difficulty: r = "Medium", count: t = 5, excludeSlugs: s = [] }) {
  const a = new Set(s.map((c) => c.toLowerCase())), i = (tt || []).filter((c) => !a.has(c.slug.toLowerCase()));
  if (!i.length) return [];
  const n = Array.isArray(e) && e.length > 0 ? e.map((c) => c.toLowerCase()) : [];
  let o = i;
  if (n.length > 0) {
    const c = i.filter(
      (f) => Array.isArray(f.topics) && f.topics.some((m) => n.includes(m.toLowerCase()))
    );
    c.length >= t, o = c;
  }
  let l = [];
  const d = (r || "Medium").toLowerCase(), u = (c) => [...c].sort(() => Math.random() - 0.5);
  if (d === "mixed") {
    const c = u(o.filter((S) => S.difficulty?.toLowerCase() === "easy")), f = u(o.filter((S) => S.difficulty?.toLowerCase() === "medium")), m = u(o.filter((S) => S.difficulty?.toLowerCase() === "hard")), g = Math.max(1, Math.floor(t * 0.25)), h = t >= 5 ? 1 : 0, A = t - g - h;
    if (l.push(...c.slice(0, g)), l.push(...f.slice(0, A)), l.push(...m.slice(0, h)), l.length < t) {
      const S = new Set(l.map((E) => E.slug)), b = u(o.filter((E) => !S.has(E.slug)));
      l.push(...b.slice(0, t - l.length));
    }
  } else {
    const c = o.filter((f) => f.difficulty?.toLowerCase() === d);
    if (c.length >= t)
      l = u(c).slice(0, t);
    else {
      const f = new Set(c.map((g) => g.slug)), m = u(o.filter((g) => !f.has(g.slug)));
      l = [...c, ...m].slice(0, t);
    }
  }
  if (l.length < t) {
    const c = new Set(l.map((m) => m.slug)), f = u(i.filter((m) => !c.has(m.slug)));
    l.push(...f.slice(0, t - l.length));
  }
  return l.slice(0, t).map((c, f) => ({
    sequence_number: f + 1,
    slug: c.slug,
    title: c.title,
    url: `https://leetcode.com/problems/${c.slug}/`,
    difficulty: c.difficulty,
    topics: c.topics || []
  }));
}
async function rt(e, r, t = {}) {
  const {
    topics: s = ["Arrays", "Strings"],
    difficulty: a = "Medium",
    durationMinutes: i = 30,
    problemCount: n = 5,
    language: o = "javascript"
  } = t;
  if (!e || !r)
    return { success: !1, error: "Challenger and opponent usernames are required" };
  if (e.toLowerCase() === r.toLowerCase())
    return { success: !1, error: "Cannot challenge yourself" };
  const l = await p("create_battle_v2", {
    p_challenged_username: r.toLowerCase(),
    p_topics: s,
    p_difficulty: a,
    p_duration_minutes: i,
    p_problem_count: n,
    p_language: o.toLowerCase()
  });
  return l?.success && l.battle ? { success: !0, battle: l.battle } : { success: !1, error: l?.error || "Battle service unavailable." };
}
async function rr(e) {
  if (!e) return { success: !1, error: "Battle ID required" };
  const r = await p("accept_battle_v2", { p_battle_id: e });
  return r && r.success && r.battle ? { success: !0, battle: r.battle } : { success: !1, error: r?.error || "Battle service unavailable." };
}
async function sr(e, r) {
  if (!e) return { success: !1, error: "Battle ID required" };
  const t = await ge(e);
  if (!t) return { success: !1, error: "Battle not found" };
  const s = {
    topics: t.topics || ["Arrays", "Strings"],
    difficulty: t.difficulty || "Medium",
    count: t.problem_count || 5
  }, a = s.count, i = [], n = /* @__PURE__ */ new Set();
  for (; i.length < a && n.size < tt.length; ) {
    const l = tr({
      ...s,
      count: a - i.length,
      excludeSlugs: [...n]
    });
    if (!l.length) break;
    for (const d of l) {
      n.add(d.slug);
      const u = await nt(d.slug);
      if (!u.valid) {
        if (/premium/i.test(u.error || "")) continue;
        return { success: !1, error: `Could not verify ${d.title} with LeetCode. Please try again.` };
      }
      if (i.push({ ...d, title: u.title, difficulty: u.difficulty }), i.length === a) break;
    }
  }
  if (i.length < a)
    return { success: !1, error: "Not enough verified free problems are available for this battle." };
  const o = await p("confirm_ready_v2", {
    p_battle_id: e,
    p_problems: i
  });
  return o && o.success ? {
    success: !0,
    battle: await ge(e) || o.battle,
    bothReady: o.bothReady,
    status: o.status
  } : { success: !1, error: o?.error || "Battle service unavailable." };
}
async function st(e, r, t = {}) {
  const {
    submissionId: s,
    timeTakenMs: a = 0,
    runtimeMs: i = null,
    memoryMb: n = null,
    language: o = "javascript"
  } = t, l = s && String(s).trim() ? String(s).trim() : `sub_${Date.now()}`, d = {
    p_battle_id: e,
    p_problem_slug: r,
    p_submission_id: l,
    p_time_taken_ms: a,
    p_runtime_ms: i,
    p_memory_mb: n,
    p_language: o
  };
  try {
    const u = await qt("record-battle-solve", d);
    if (u && u.success || u?.error && /already finalized|deadline has passed|not in this battle/i.test(u.error))
      return u;
  } catch (u) {
    console.warn("[BattleManager] Edge function record-battle-solve unavailable, falling back to direct RPC:", u);
  }
  try {
    const u = await p("record_battle_solve", d);
    if (u && u.success)
      return u;
    if (u?.error)
      return { success: !1, error: u.error };
  } catch (u) {
    console.warn("[BattleManager] record_battle_solve RPC call failed:", u);
  }
  return { success: !1, error: "Battle service unavailable." };
}
async function Ee(e) {
  if (!e) return null;
  const r = await p("get_battle_state_v2", { p_battle_id: e });
  if (r && r.success)
    return r;
  const [t, s, a, i] = await Promise.all([
    ge(e),
    G(`battle_problems?battle_id=eq.${e}&order=sequence_number.asc`),
    G(`battle_participants?battle_id=eq.${e}`),
    ir(e)
  ]);
  return t ? {
    success: !0,
    battle: t,
    problems: s || [],
    participants: a || [],
    results: i || []
  } : null;
}
async function at(e, r) {
  const t = await p("forfeit_battle_v2", { p_battle_id: e });
  return t && t.success ? t : { success: !1, error: t?.error || "Battle service unavailable." };
}
async function ar(e, r, t = "javascript") {
  return await rt(e, r, { language: t });
}
async function Te(e) {
  if (!e) return null;
  const r = await p("get_my_active_battle");
  if (!r?.success || !r.battle) return null;
  const t = r.battle, s = Date.now(), a = t.end_at || t.match_deadline;
  return t.status === er.IN_PROGRESS && a && new Date(a).getTime() <= s && cr(t.id).catch(() => {
  }), t;
}
async function ge(e) {
  if (!e) return null;
  const r = await G(`battles?id=eq.${e}&select=*`);
  return r && r.length > 0 ? r[0] : null;
}
async function ir(e) {
  return e ? await G(`battle_results?battle_id=eq.${e}&select=*`) || [] : [];
}
async function nr(e, r, t) {
  const s = await p("respond_battle_v2", {
    p_battle_id: e,
    p_accept: !!t
  });
  return s?.success ? s : { success: !1, error: s?.error || "Battle service unavailable." };
}
async function or(e, r, t, s) {
  return { success: !1, error: "Manual problem picks are not supported by the current battle flow" };
}
async function cr(e) {
  const r = await p("evaluate_and_finalize_battle", { p_battle_id: e });
  return r && r.finalized ? r : null;
}
async function lr(e, r) {
  const t = await p("cancel_battle_v2", { p_battle_id: e });
  return t?.success ? t : { success: !1, error: t?.error || "Battle service unavailable." };
}
async function it(e, r = 10) {
  if (!e) return [];
  const t = await p("get_my_recent_battles", { p_limit: r });
  return t?.success && Array.isArray(t.rows) ? t.rows : [];
}
async function ur(e = {}, r = 12, t = 0) {
  const s = await p("get_battle_history_scoreboard", {
    p_result_filter: e.result || "all",
    p_topic_filter: e.topic && e.topic !== "all" ? e.topic : null,
    p_difficulty_filter: e.difficulty || "all",
    p_opponent_id: e.opponentId && e.opponentId !== "all" ? e.opponentId : null,
    p_from: e.from || null,
    p_to: e.to || null,
    p_limit: r,
    p_offset: t
  });
  if (s && s.success)
    return s;
  try {
    const i = (await _())?.user_id || null;
    let n = "";
    typeof chrome < "u" && chrome.storage?.local && (n = ((await chrome.storage.local.get("my_leetcode_username"))?.my_leetcode_username || "").toLowerCase());
    const o = await it(n, 50);
    if (!Array.isArray(o) || o.length === 0)
      return { success: !0, rows: [], opponents: [], total_opponents: 0, total_matches: 0, has_more: !1 };
    const l = /* @__PURE__ */ new Map();
    for (const c of o) {
      if (!["completed", "forfeited"].includes(c.status)) continue;
      const f = (c.challenger_username || "").toLowerCase(), m = (c.challenged_username || "").toLowerCase();
      if (f && m && f === m || i && c.challenger_id && c.challenged_id && c.challenger_id === c.challenged_id) continue;
      const g = n ? f === n : i && c.challenger_id === i, h = g ? c.challenged_username || m : c.challenger_username || f, A = g ? c.challenged_id || h : c.challenger_id || h;
      if (!h || n && h.toLowerCase() === n || i && A === i) continue;
      const S = (c.winner_username || "").toLowerCase(), b = S && S !== "draw" && (S === n || c.winner_id === i), E = S && S !== "draw" && !b, x = S === "draw" || !S, q = h.toLowerCase();
      l.has(q) || l.set(q, {
        opponent_id: A,
        opponent_username: h,
        my_username: n || "you",
        my_wins: 0,
        opponent_wins: 0,
        draws: 0,
        completed_battles: 0,
        last_battle_at: c.completed_at || c.created_at
      });
      const re = l.get(q);
      b ? re.my_wins++ : E ? re.opponent_wins++ : x && re.draws++, re.completed_battles++;
    }
    const d = Array.from(l.values());
    return {
      success: !0,
      rows: d.slice(t, t + r),
      opponents: d.map((c) => ({ opponent_id: c.opponent_id, opponent_username: c.opponent_username })),
      total_opponents: d.length,
      total_matches: o.length,
      has_more: t + r < d.length
    };
  } catch {
    return s || { success: !1, error: "Could not load battle history." };
  }
}
async function dr(e, r = {}, t = 10, s = 0) {
  return await p("get_battle_history_details_v2", {
    p_opponent_id: e,
    p_result_filter: r.result || "all",
    p_topic_filter: r.topic && r.topic !== "all" ? r.topic : null,
    p_difficulty_filter: r.difficulty || "all",
    p_from: r.from || null,
    p_to: r.to || null,
    p_limit: t,
    p_offset: s
  });
}
async function nt(e) {
  try {
    let r = e.trim();
    if (r.includes("leetcode.com/problems/")) {
      const i = r.match(/problems\/([^/?#]+)/);
      if (!i) return { valid: !1, error: "Invalid LeetCode URL structure" };
      r = i[1].replace(/\/$/, "");
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
async function ne(e, r = "online") {
  if (!(!e || !w || w === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      let t = await p("heartbeat_presence", {
        p_status: r,
        p_username: e.toLowerCase()
      });
      if (t && t.success) return;
      if (t?.code === "PGRST202" || typeof t?.error == "string" && t.error.includes("PGRST202")) {
        const a = await p("heartbeat_presence", { p_status: r });
        if (a && (a.success || a === !0)) return;
      }
      const s = await _();
      s?.user_id && await G("user_presence", {
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
async function fr(e) {
  const r = /* @__PURE__ */ new Map();
  if (!e?.length || !w || w === "YOUR_SUPABASE_PROJECT_URL_HERE") return r;
  try {
    const t = await p("get_friends_presence", { p_usernames: e });
    if (t && typeof t == "object" && !t.error) {
      for (const [n, o] of Object.entries(t))
        r.set(n.toLowerCase(), {
          status: o.status || "offline",
          isOnline: !!o.isOnline,
          inBattle: !!o.inBattle,
          last_seen: o.last_seen
        });
      return r;
    }
    const s = e.map((n) => `"${n.toLowerCase()}"`).join(","), a = await G(`user_presence?username=in.(${s})&select=username,status,last_seen,in_battle`), i = Date.now() - 120 * 1e3;
    for (const n of a || []) {
      const l = n.last_seen && new Date(n.last_seen).getTime() > i ? n.in_battle ? "in_battle" : n.status || "online" : "offline";
      r.set(n.username.toLowerCase(), {
        status: l,
        isOnline: l === "online" || l === "in_battle",
        inBattle: l === "in_battle",
        last_seen: n.last_seen
      });
    }
  } catch (t) {
    console.warn("[BattleManager] getPresence failed:", t);
  }
  return r;
}
function ot(e) {
  const r = Tt(e);
  if (!r.valid)
    throw new Error(r.error);
  return r.username;
}
function L(e, r) {
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
function ct(e = [], r = null, t = null) {
  const s = /* @__PURE__ */ new Set();
  if (Array.isArray(e)) {
    for (const a of e)
      if (a && a.timestamp) {
        const i = L(a.timestamp, t);
        i && s.add(i);
      }
  }
  if (r)
    try {
      const a = typeof r == "string" ? JSON.parse(r) : r;
      if (a && typeof a == "object") {
        for (const [i, n] of Object.entries(a))
          if (parseInt(n, 10) > 0) {
            const o = L(i, t);
            o && s.add(o);
          }
      }
    } catch (a) {
      console.warn("[StreakCalculator] Error parsing submissionCalendar:", a);
    }
  return Array.from(s).sort();
}
function mr(e, r = null, t = null) {
  let s = [], a = null;
  Array.isArray(e) ? (s = e, a = r) : e && typeof e == "object" && (a = e, typeof r == "string" && (t = r));
  const i = ct(s, a, t);
  if (i.length === 0)
    return {
      currentStreak: 0,
      longestStreak: 0,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: []
    };
  function n(b, E) {
    const x = /* @__PURE__ */ new Date(b + "T00:00:00Z"), q = /* @__PURE__ */ new Date(E + "T00:00:00Z");
    return Math.round((q - x) / 864e5);
  }
  let o = 1, l = 1;
  for (let b = 1; b < i.length; b++) {
    const E = n(i[b - 1], i[b]);
    E === 1 ? (l++, l > o && (o = l)) : E > 1 && (l = 1);
  }
  const d = Math.floor(Date.now() / 1e3), u = L(d, t), c = Math.floor((Date.now() - 864e5) / 1e3), f = L(c, t), m = i.includes(u), g = i[i.length - 1];
  if (g !== u && g !== f)
    return {
      currentStreak: 0,
      longestStreak: o,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: i
    };
  let h = 0, A = /* @__PURE__ */ new Date(g + "T00:00:00Z");
  for (let b = i.length - 1; b >= 0; b--) {
    const E = A.toISOString().split("T")[0];
    if (i[b] === E)
      h++, A.setUTCDate(A.getUTCDate() - 1);
    else if (i[b] < E)
      break;
  }
  h > o && (o = h);
  const S = h > 0 && !m;
  return {
    currentStreak: h,
    longestStreak: o,
    isAtRisk: S,
    solvedToday: m,
    solveDates: i
  };
}
function gr(e, r = null, t = null) {
  const s = ct(e, r, t), a = Math.floor(Date.now() / 1e3), i = L(a, t);
  return s.includes(i);
}
function Ae(e, r = null) {
  return e?.acceptedSubmissionsAvailable !== !0 ? null : gr(e.allAcceptedSubmissions || [], null, r);
}
function hr(e) {
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
function ie(e) {
  return e ? Date.now() - e > 900 * 1e3 : !0;
}
const K = "leetfriends_notifications";
let Oe = Promise.resolve();
const Ne = {
  QUEUED: "QUEUED",
  DISPLAY_REQUESTED: "DISPLAY_REQUESTED",
  FAILED: "FAILED",
  IN_APP_ONLY: "IN_APP_ONLY",
  DISMISSED: "DISMISSED",
  CLICKED: "CLICKED"
};
async function lt() {
  try {
    return (await chrome.storage.local.get(K))[K] || {
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
async function ut() {
  try {
    const e = await chrome.storage.local.get([
      "notifications_enabled",
      K
    ]);
    if (e.notifications_enabled === !1)
      return !0;
    const r = e[K];
    if (!r) return !1;
    const t = Date.now();
    if (r.snoozedUntil && t < r.snoozedUntil)
      return !0;
    if (r.mutedUntilUTC) {
      const s = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      if (r.mutedUntilUTC >= s) return !0;
    }
    if (r.quietHours && r.quietHours.enabled) {
      const s = (/* @__PURE__ */ new Date()).getHours() * 60 + (/* @__PURE__ */ new Date()).getMinutes(), [a, i] = (r.quietHours.start || "22:00").split(":").map(Number), [n, o] = (r.quietHours.end || "08:00").split(":").map(Number), l = a * 60 + i, d = n * 60 + o;
      if (l > d) {
        if (s >= l || s < d)
          return !0;
      } else if (s >= l && s < d)
        return !0;
    }
    return !1;
  } catch (e) {
    return console.warn("[NotificationManager] isNotificationMuted error:", e), !1;
  }
}
async function yr(e) {
  const r = await lt();
  r.mutedUntilUTC = e, await chrome.storage.local.set({ [K]: r });
}
function te(e) {
  const r = Oe.then(() => pr(e));
  return Oe = r.catch(() => !1), r;
}
async function pr(e) {
  if (!Array.isArray(e) || e.length === 0) return !1;
  try {
    const r = await ut(), t = Date.now(), a = (await chrome.storage.local.get("unread_notifications")).unread_notifications || [], i = new Set(a.map((u) => u.id)), n = [];
    if (e.forEach((u, c) => {
      const f = u.id || `${t}-${c}`;
      i.has(f) || (i.add(f), n.push({ ...u, id: f }));
    }), n.length === 0) return !0;
    const o = n.map((u) => ({
      ...u,
      timestamp: t,
      deliveryState: r ? Ne.IN_APP_ONLY : Ne.DISPLAY_REQUESTED
    })), l = t - 1440 * 60 * 1e3, d = [...a, ...o].filter((u) => u.timestamp > l).slice(-30);
    if (await chrome.storage.local.set({ unread_notifications: d }), r)
      return console.log("[NotificationManager] Notifications muted; recorded for in-app display only."), !0;
    for (const u of n)
      try {
        let c = "LeetStreak";
        u.type === "new_submission" ? c = "🎯 Friend Solved a Problem!" : u.type === "milestone" ? c = "🔥 Streak Milestone Reached!" : u.type === "streak_at_risk" ? c = "⚠️ Streak At Risk!" : u.type === "battle_invite" ? c = "⚔️ 1v1 Battle Challenge!" : u.type === "battle_opponent_solved" ? c = "⚔️ Opponent Solved a Problem!" : u.type === "roast" ? c = "🔥 Motivation Roast Received!" : u.type === "daily_problem_reminder" && (c = "ENO: DSA Check-in ☕");
        const f = u.nativeNotificationId || `leetstreak-${u.type}-${t}-${Math.floor(Math.random() * 1e3)}`;
        await chrome.notifications.create(f, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: c,
          message: u.message || "",
          priority: u.priority || 2,
          requireInteraction: u.type === "streak_at_risk" || u.type === "battle_invite"
        });
      } catch (c) {
        console.warn("[NotificationManager] chrome.notifications.create failed:", c);
      }
    return !0;
  } catch (r) {
    return console.error("[NotificationManager] Error in batchNotify:", r), !1;
  }
}
const _r = () => (/* @__PURE__ */ new Date()).toISOString().split("T")[0], wr = () => {
  const e = /* @__PURE__ */ new Date();
  return e.setUTCDate(e.getUTCDate() - 1), e.toISOString().split("T")[0];
};
function Sr(e, r) {
  if (r === 0) return !1;
  const t = wr(), s = _r();
  return !(Array.isArray(e) ? e : []).some((n) => {
    const o = parseInt(n.timestamp, 10);
    if (isNaN(o) || o <= 0) return !1;
    const l = new Date(o * 1e3).toISOString().split("T")[0];
    return l === s || l === t;
  });
}
function br(e = /* @__PURE__ */ new Date()) {
  const r = e.getHours();
  return r >= 21 || r < 3 ? "night" : r < 12 ? "morning" : null;
}
function kr(e = /* @__PURE__ */ new Date()) {
  const r = (t) => String(t).padStart(2, "0");
  return `${e.getFullYear()}-${r(e.getMonth() + 1)}-${r(e.getDate())}`;
}
function Er({
  now: e = /* @__PURE__ */ new Date(),
  deliveredState: r = null,
  hasSolvedToday: t = !1,
  streak: s = 0
}) {
  if (s <= 0 || t)
    return { allowed: !1, reason: "no_risk" };
  const a = br(e);
  if (!a)
    return { allowed: !1, reason: "outside_allowed_hours" };
  const i = kr(e);
  return (r?.date === i && Array.isArray(r.slots) ? r.slots : []).includes(a) ? { allowed: !1, reason: "already_delivered_for_slot", slot: a } : { allowed: !0, slot: a, dayKey: i };
}
function Tr(e, r, t) {
  const s = e?.date === r && Array.isArray(e.slots) ? e.slots : [];
  return {
    date: r,
    slots: Array.from(/* @__PURE__ */ new Set([...s, t]))
  };
}
const He = 1.7, $e = 30, xe = 19, qe = 4, Fe = "schedule_preferences";
async function ce() {
  try {
    return (await chrome.storage.local.get(Fe))[Fe] || {
      activeInterval: He,
      quietInterval: $e,
      activeStartHour: xe,
      activeEndHour: qe
    };
  } catch (e) {
    return console.error("Error loading schedule preferences:", e), {
      activeInterval: He,
      quietInterval: $e,
      activeStartHour: xe,
      activeEndHour: qe
    };
  }
}
async function ve(e = null) {
  e || (e = await ce());
  const t = (/* @__PURE__ */ new Date()).getHours(), { activeStartHour: s, activeEndHour: a } = e;
  return s > a ? t >= s || t < a : t >= s && t < a;
}
async function Me() {
  const e = await ce();
  return await ve(e) ? e.activeInterval : e.quietInterval;
}
async function Ar() {
  const e = await ce(), r = /* @__PURE__ */ new Date(), t = r.getHours(), s = r.getMinutes();
  let a;
  await ve(e) ? a = e.activeEndHour : a = e.activeStartHour;
  let i = a - t;
  return i < 0 && (i += 24), i === 0 && s > 0 && (i = 24), i * 60 - s;
}
async function Re() {
  const e = await ce(), r = await Me(), t = await ve(e), s = We(e.activeStartHour), a = We(e.activeEndHour);
  return t ? `Active Mode: Checking every ${r} minutes (${s} - ${a})` : `Quiet Mode: Checking every ${r} minutes`;
}
async function vr() {
  const e = await Me(), r = await Ar(), t = Math.min(e, r);
  return {
    intervalMinutes: t,
    description: await Re(),
    isTransitionCheck: t === r && t < e
  };
}
function We(e) {
  return e === 0 ? "12:00 AM" : e < 12 ? `${e}:00 AM` : e === 12 ? "12:00 PM" : `${e - 12}:00 PM`;
}
const dt = [
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
], ft = [
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
], mt = [
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
function P(e) {
  return e ? e.toLowerCase().replace(/^(www\.|m\.)/, "") : "";
}
function C(e, r = {}) {
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
  const i = a.hostname.toLowerCase(), n = P(i);
  if (n.includes("leetcode.com"))
    return { isDistraction: !1, reason: "SYSTEM_ALLOW_LEETCODE", label: "LeetCode" };
  for (const o of s) {
    if (!o) continue;
    const l = o.trim().toLowerCase();
    if (e.toLowerCase().includes(l) || n === P(l))
      return { isDistraction: !1, reason: "USER_ALLOWLIST", label: o };
  }
  for (const o of mt)
    if (n === P(o.domain)) {
      for (const l of o.allowedPrefixes)
        if (a.pathname.startsWith(l))
          return { isDistraction: !1, reason: "EDUCATIONAL_EXCEPTION", label: `${o.domain}${l}` };
    }
  for (const o of ft)
    if (n === P(o.domain)) {
      for (const l of o.paths)
        if (a.pathname.startsWith(l))
          return { isDistraction: !0, reason: "PATH_DISTRACTION", label: o.label };
    }
  for (const o of t) {
    if (!o) continue;
    const l = P(o.trim().toLowerCase());
    if (n === l || n.endsWith("." + l))
      return { isDistraction: !0, reason: "CUSTOM_BLOCKED_DOMAIN", label: l };
  }
  for (const o of dt) {
    const l = P(o);
    if (n === l || n.endsWith("." + l))
      return { isDistraction: !0, reason: "DEFAULT_BLOCKED_DOMAIN", label: l };
  }
  return { isDistraction: !1, reason: "UNRESTRICTED", label: "" };
}
function Mr(e = {}) {
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
    const o = n.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    s.push({
      id: a++,
      priority: 5,
      action: { type: "allow" },
      condition: {
        requestDomains: [o],
        resourceTypes: ["main_frame"]
      }
    });
  }
  for (const n of mt)
    for (const o of n.allowedPrefixes)
      s.push({
        id: a++,
        priority: 3,
        action: { type: "allow" },
        condition: {
          requestDomains: [n.domain],
          urlFilter: `*${o}*`,
          resourceTypes: ["main_frame"]
        }
      });
  for (const n of ft)
    for (const o of n.paths)
      s.push({
        id: a++,
        priority: 2,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html" }
        },
        condition: {
          requestDomains: [n.domain],
          urlFilter: `*${o}*`,
          resourceTypes: ["main_frame"]
        }
      });
  const i = Array.from(/* @__PURE__ */ new Set([...dt, ...r]));
  for (const n of i) {
    if (!n || !n.trim()) continue;
    const o = P(n.trim());
    s.push({
      id: a++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: "/blocked.html" }
      },
      condition: {
        requestDomains: [o],
        resourceTypes: ["main_frame"]
      }
    });
  }
  return s;
}
async function M() {
  if (typeof chrome > "u" || !chrome.storage || !chrome.storage.local)
    return { active: !1, reason: "CHROME_STORAGE_UNAVAILABLE", todayStr: "", streak: 0 };
  try {
    const e = await chrome.storage.local.get([
      "hardcore_mode_enabled",
      "my_leetcode_username",
      "last_solve_date",
      "user_timezone",
      "own_profile"
    ]), r = e.user_timezone, t = Math.floor(Date.now() / 1e3), s = L(t, r);
    if (!e.hardcore_mode_enabled)
      return { active: !1, reason: "HARDCORE_DISABLED", todayStr: s, streak: 0 };
    if (e.last_solve_date === s)
      return {
        active: !1,
        reason: "SOLVED_TODAY_LOCAL_MARKER",
        todayStr: s,
        streak: e.own_profile?.stats?.streak || 0
      };
    const a = e.my_leetcode_username;
    let i = e.own_profile;
    if (!i && a)
      try {
        const n = await chrome.storage.local.get(["friends_cache"]);
        if (n.friends_cache) {
          const o = Object.keys(n.friends_cache).find((l) => l.toLowerCase() === a.toLowerCase());
          o && (i = n.friends_cache[o]);
        }
        i || (i = await Ze(a));
      } catch (n) {
        console.warn("[BlockerManager] Error fetching cached friend data:", n);
      }
    if (i) {
      const n = i.stats?.streak || 0;
      return Ae(i, r) === !0 ? (await chrome.storage.local.set({ last_solve_date: s }), { active: !1, reason: "SOLVED_TODAY_CANONICAL", todayStr: s, streak: n }) : { active: !0, reason: "UNSOLVED_TODAY", todayStr: s, streak: n };
    }
    return { active: !0, reason: "NO_PROFILE_UNSOLVED", todayStr: s, streak: 0 };
  } catch (e) {
    return console.error("[BlockerManager] isBlockerActive check error:", e), { active: !1, reason: `ERROR: ${e.message}`, todayStr: "", streak: 0 };
  }
}
async function D() {
  if (typeof chrome > "u" || !chrome.declarativeNetRequest)
    return console.warn("[BlockerManager] chrome.declarativeNetRequest API not available"), { success: !1, locked: !1, ruleCount: 0, reason: "DNR_NOT_AVAILABLE" };
  try {
    const e = await M(), t = (await chrome.declarativeNetRequest.getDynamicRules()).map((i) => i.id);
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
    const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = Mr({
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
    }), await Rr(), { success: !0, locked: !0, ruleCount: a.length, reason: e.reason };
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
let Ge = !1;
function I(e, r, t = "") {
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
async function Rr() {
  if (typeof chrome > "u" || !chrome.tabs || !chrome.tabs.query)
    return { sweptCount: 0, redirectedTabs: [] };
  try {
    if (!(await M()).active)
      return { sweptCount: 0, redirectedTabs: [] };
    const r = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), t = r.custom_blocked_domains || [], s = r.allowlist || [], a = await chrome.tabs.query({}), i = [];
    for (const n of a) {
      if (!n.id || !n.url || n.url.includes("blocked.html") || n.url.startsWith("chrome") || n.url.startsWith("about:") || n.url.startsWith("edge:") || n.url.includes("leetcode.com"))
        continue;
      const o = C(n.url, { customBlocked: t, allowlist: s });
      o.isDistraction && (console.log(`[BlockerManager] Sweeping open distracting tab #${n.id}: ${n.url} (${o.label || o.reason})`), I(n.id, n.url, o.label), i.push({ id: n.id, url: n.url }));
    }
    return { sweptCount: i.length, redirectedTabs: i };
  } catch (e) {
    return console.warn("[BlockerManager] sweepOpenTabs error:", e), { sweptCount: 0, redirectedTabs: [], error: e.message };
  }
}
function Cr() {
  Ge || typeof chrome > "u" || (Ge = !0, D().catch((e) => console.error("[BlockerManager] Startup sync failed:", e)), chrome.webNavigation && chrome.webNavigation.onBeforeNavigate && chrome.webNavigation.onBeforeNavigate.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await M()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = C(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && (chrome.storage.session && await chrome.storage.session.set({
          [`blocked_tab_${e.tabId}`]: {
            url: e.url,
            label: s.label,
            timestamp: Date.now()
          }
        }), I(e.tabId, e.url, s.label));
      } catch (r) {
        console.warn("[BlockerManager] onBeforeNavigate error:", r);
      }
  }), chrome.webNavigation && chrome.webNavigation.onCommitted && chrome.webNavigation.onCommitted.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await M()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = C(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && I(e.tabId, e.url, s.label);
      } catch {
      }
  }), chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated && chrome.webNavigation.onHistoryStateUpdated.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await M()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = C(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && (chrome.storage.session && await chrome.storage.session.set({
          [`blocked_tab_${e.tabId}`]: {
            url: e.url,
            label: s.label,
            timestamp: Date.now()
          }
        }), I(e.tabId, e.url, s.label));
      } catch (r) {
        console.warn("[BlockerManager] onHistoryStateUpdated error:", r);
      }
  }), chrome.tabs && chrome.tabs.onUpdated && chrome.tabs.onUpdated.addListener(async (e, r, t) => {
    const s = r.url || t?.url;
    if (!(!s || s.includes("blocked.html") || s.startsWith("chrome") || s.startsWith("about:") || s.includes("leetcode.com")))
      try {
        if (!(await M()).active) return;
        const i = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), n = C(s, {
          customBlocked: i.custom_blocked_domains || [],
          allowlist: i.allowlist || []
        });
        n.isDistraction && I(e, s, n.label);
      } catch {
      }
  }), chrome.tabs && chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(async (e) => {
    try {
      if (!(await M()).active) return;
      const t = await chrome.tabs.get(e.tabId);
      if (!t || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
      const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = C(t.url, {
        customBlocked: s.custom_blocked_domains || [],
        allowlist: s.allowlist || []
      });
      a.isDistraction && (console.log(`[BlockerManager] onActivated blocking active tab #${e.tabId} (${t.url})`), I(e.tabId, t.url, a.label));
    } catch {
    }
  }), chrome.windows && chrome.windows.onFocusChanged && chrome.windows.onFocusChanged.addListener(async (e) => {
    if (!(typeof chrome.windows.WINDOW_ID_NONE < "u" && e === chrome.windows.WINDOW_ID_NONE))
      try {
        if (!(await M()).active) return;
        const [t] = await chrome.tabs.query({ active: !0, windowId: e });
        if (!t || !t.id || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
        const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = C(t.url, {
          customBlocked: s.custom_blocked_domains || [],
          allowlist: s.allowlist || []
        });
        a.isDistraction && (console.log(`[BlockerManager] onFocusChanged blocking window tab #${t.id} (${t.url})`), I(t.id, t.url, a.label));
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
    ].some((a) => e[a]) && D().catch((a) => {
      console.error("[BlockerManager] Storage change sync error:", a);
    });
  }), console.log("🛡️ [BlockerManager] Multi-layer network blocker initialized"));
}
function Lr() {
  if (Cr(), typeof chrome > "u" || !chrome.tabs) {
    console.warn("[TabMonitor] chrome.tabs API not available");
    return;
  }
  chrome.tabs.onUpdated.addListener(async (e, r, t) => {
    if (r.status === "complete" && t?.url)
      try {
        if (!(await M()).active) return;
        const a = C(t.url);
        if (a.isDistraction && !t.url.includes("blocked.html")) {
          const i = chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(t.url)}&label=${encodeURIComponent(a.label)}`);
          chrome.tabs.update(e, { url: i });
        }
      } catch {
      }
  }), console.log("✅ [TabMonitor] Hardcore Mode Tab Monitor and Blocker initialized");
}
const Dr = [
  ["desi-01", "desi roasting", "Chi chi chi! Ek problem bhi nahi hua aaj? 😭"],
  ["desi-02", "desi roasting", "Bhai, LeetCode kholne se placement nahi lagti, solve bhi karna padta hai! 💀"],
  ["desi-03", "desi roasting", "Kya kar raha hai mere bhai? Arrays bhi ab tera wait karte karte thak gaye! 😭"],
  ["desi-04", "desi roasting", "Itni der toh Maggi bhi nahi leti jitna tu ek problem start karne mein laga raha hai! 🍜"],
  ["desi-05", "desi roasting", "Bhai ne aaj bhi DSA ko seen karke chhod diya! 👀"],
  ["desi-06", "desi roasting", "Problem solve kar le, warna tera future debugger mein hi atka rahega! 💀"],
  ["desi-07", "desi roasting", "Aaj ka target: ek problem. Excuses ka toh unlimited subscription hai tera! 😭"],
  ["desi-08", "desi roasting", "Kuch toh sharam kar, even your compiler is waiting for you! 😂"],
  ["parents-01", "parents and relatives", "Sharma ji ka beta nahi banna? Toh kam se kam ek problem solve kar le! 💀"],
  ["parents-02", "parents and relatives", "Mummy ko bol de padh raha hoon... bas iss baar sach mein padh le! 😭"],
  ["parents-03", "parents and relatives", "Relatives shaadi ki age pooch rahe hain, recruiter placement ki. Tu pehle LeetCode kar! 💀"],
  ["parents-04", "parents and relatives", "Beta, package kitne ka lagega? Pehle ek problem toh solve kar le! 😂"],
  ["parents-05", "parents and relatives", "Ghar wale soch rahe hain engineer ban raha hai, ENO ko sach pata hai! 👀"],
  ["placement-01", "placement and engineering", "Google ka interview crack karna hai ya sirf Chrome tabs kholne hain? 👀"],
  ["placement-02", "placement and engineering", "Future Netflix and chill se nahi, LeetCode par problems solve karke banao! 💀"],
  ["placement-03", "placement and engineering", "Bhai, HR ko tera potential nahi, Accepted submissions chahiye! 😭"],
  ["placement-04", "placement and engineering", "Placement season aa jayega, teri lazy season kab khatam hogi? 💀"],
  ["placement-05", "placement and engineering", "DSA nahi karega toh interview mein sirf “Good morning sir” se kaam nahi chalega! 😂"],
  ["placement-06", "placement and engineering", "Ek problem solve kar le, warna Big Tech bhi tujhe Big Excuse samjhegi! 😭"],
  ["placement-07", "placement and engineering", "Tera future SDE banna chahta hai, par tu uska pull request hi merge nahi kar raha! 💀"],
  ["hostel-01", "hostel and student life", "Chai thandi ho sakti hai, par tera DSA motivation itna bhi thanda nahi hona chahiye! ☕"],
  ["hostel-02", "hostel and student life", "Hostel mein attendance kam aur LeetCode streak bhi? Bhai, kuch toh sambhaal! 😭"],
  ["hostel-03", "hostel and student life", "Maggi ke 2 minutes mil gaye, ek LeetCode problem ke 20 minutes nahi? 💀"],
  ["hostel-04", "hostel and student life", "Mess ka khana roz kha raha hai, ek problem roz solve nahi ho rahi? 😭"],
  ["hostel-05", "hostel and student life", "Bhai, assignment deadline pe kar leta hai, LeetCode ko bhi thoda respect de! 😂"],
  ["cricket-01", "cricket and extra savage", "Teri DSA performance dekh ke selector bhi tujhe bench pe bitha de! 🏏"],
  ["cricket-02", "cricket and extra savage", "Ek problem maar de bhai, aaj tera LeetCode ka century opening karte hain! 💀"],
  ["cricket-03", "cricket and extra savage", "Tu problem se darr raha hai ya problem tujhe dekh ke darr rahi hai? 👀"],
  ["cricket-04", "cricket and extra savage", "IPL mein har ball pe action hota hai, aur tere LeetCode mein har din silence! 😭"],
  ["cricket-05", "cricket and extra savage", "ENO reminder de deke thak gaya, ab toh compiler bhi tere liye dua kar raha hai! 🥺"]
].map(([e, r, t]) => ({ id: e, category: r, language: "hinglish", text: t }));
function Z(e = /* @__PURE__ */ new Date()) {
  const r = (t) => String(t).padStart(2, "0");
  return `${e.getFullYear()}-${r(e.getMonth() + 1)}-${r(e.getDate())}`;
}
function j(e) {
  return e === "off" || e === "minimal" ? "off" : e === "reduced" || e === "important" ? "reduced" : "normal";
}
function Pr(e = /* @__PURE__ */ new Date(), r = "normal") {
  const t = j(r);
  if (t === "off") return null;
  const s = t === "reduced" ? [11] : [11, 23];
  for (const i of s) {
    const n = new Date(e);
    if (n.setHours(i, 0, 0, 0), n > e) return n;
  }
  const a = new Date(e);
  return a.setDate(a.getDate() + 1), a.setHours(s[0], 0, 0, 0), a;
}
function Ir(e = /* @__PURE__ */ new Date()) {
  const r = e.getHours() * 60 + e.getMinutes();
  return r >= 1380 ? "11pm" : r >= 660 ? "11am" : null;
}
function je({ date: e = /* @__PURE__ */ new Date(), slot: r, frequency: t = "normal", enabled: s = !0, solved: a = !1, deliveredSlots: i = [] }) {
  if (!s || a || !r || j(t) === "off") return !1;
  const n = r === "11am" ? 11 : r === "11pm" ? 23 : null;
  return n === null || j(t) === "reduced" && r !== "11am" || e.getHours() !== n || e.getMinutes() > 15 ? !1 : !i.includes(r);
}
function Br(e, r = Math.random) {
  const t = Dr.filter((s) => s.id !== e);
  return t[Math.min(t.length - 1, Math.floor(r() * t.length))];
}
function he(e = {}, r) {
  return Array.isArray(e.deliveredByDay?.[r]) ? e.deliveredByDay[r] : e.day === r && Array.isArray(e.deliveredSlots) ? e.deliveredSlots : [];
}
function Ur(e = {}, r, t, s) {
  const a = { ...e.deliveredByDay || {} }, i = he(e, r);
  a[r] = [.../* @__PURE__ */ new Set([...i, t])];
  const n = Object.keys(a).sort().slice(-14), o = Object.fromEntries(n.map((l) => [l, a[l]]));
  return {
    day: r,
    deliveredSlots: o[r],
    deliveredByDay: o,
    lastQuoteId: s || e.lastQuoteId || null
  };
}
function z(e = [], r) {
  const t = Array.isArray(e) ? e : [];
  return [...new Set([...t, ...r ? [r] : []].filter((s) => typeof s == "string"))].slice(-14);
}
const ye = "leetfriends_sync", gt = "leetstreak_roast_delivery", pe = "leetstreak_daily_problem_reminder";
let ue = !1, de = !1, fe = !1;
const Or = "schedule_transition_check", X = "presence_heartbeat_alarm", ht = 500;
self.addEventListener("error", (e) => {
  console.error("[ServiceWorker] Uncaught error:", e.error);
});
self.addEventListener("unhandledrejection", (e) => {
  console.error("[ServiceWorker] Uncaught promise rejection:", e.reason);
});
Lr();
Ot().catch((e) => {
  console.warn("[ServiceWorker] Session restoration (non-blocking):", e.message);
});
De();
chrome.storage.onChanged.addListener((e, r) => {
  r === "local" && ["notification_frequency", "notifications_enabled", "my_leetcode_username", "daily_problem_completed_date"].some((t) => t in e) && De();
});
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[ServiceWorker] Installed - setting up sync alarm and cleaning legacy keys"), Ce(), yt(), Nr(), await D();
  try {
    await chrome.alarms.clear(X), chrome.alarms.create(X, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    });
  } catch {
  }
});
chrome.runtime.onStartup.addListener(async () => {
  console.log("[ServiceWorker] Browser startup - reconciling blocker rules & presence"), await D();
  try {
    yt(), await chrome.alarms.clear(X), chrome.alarms.create(X, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    }), await kt();
  } catch {
  }
});
async function Nr() {
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
async function Ce() {
  const e = vr(), r = e?.intervalMinutes || 30;
  try {
    await chrome.alarms.clear(ye), await chrome.alarms.clear(Or), chrome.alarms.create(ye, {
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
function yt() {
  chrome.alarms.create(gt, { delayInMinutes: 1, periodInMinutes: 1 });
}
async function Le() {
  if (ue) return { success: !0, delivered: 0 };
  ue = !0;
  try {
    const e = await chrome.storage.local.get(["my_leetcode_username", "delivered_roast_ids"]), r = e.my_leetcode_username;
    if (!r) return { success: !1, error: "No LeetCode username configured" };
    const t = await Jt(r), s = new Set(e.delivered_roast_ids || []), a = t.filter((o) => !s.has(o.id));
    if (!a.length) return { success: !0, delivered: 0 };
    const i = a.map((o) => ({
      id: `roast-${o.id}`,
      type: "roast",
      roastId: o.id,
      username: o.sender_username,
      senderUsername: o.sender_username,
      roastContent: o.content,
      message: `${o.sender_username} roasted you: "${o.content}" 🔥`,
      timestamp: o.created_at ? new Date(o.created_at).getTime() : Date.now(),
      priority: 2
    }));
    if (!await te(i)) return { success: !1, error: "Could not save roast notifications" };
    const n = a.map((o) => o.id);
    return await chrome.storage.local.set({
      delivered_roast_ids: [...s, ...n].slice(-200)
    }), await Vt(n), { success: !0, delivered: n.length };
  } catch (e) {
    return console.warn("[ServiceWorker] Roast delivery check failed:", e), { success: !1, error: e.message };
  } finally {
    ue = !1;
  }
}
async function Hr() {
  try {
    const r = (await chrome.storage.local.get("current_schedule")).current_schedule, t = Me();
    (!r || Math.abs(r.interval - t) > 0.1) && (console.log(`[ServiceWorker] Transitioning schedule: ${Re()}`), await Ce());
  } catch (e) {
    console.warn("[ServiceWorker] checkScheduleTransition error:", e);
  }
}
chrome.alarms.onAlarm.addListener(async (e) => {
  if (e.name === ye)
    console.log(`[ServiceWorker] Background sync triggered - ${Re()}`), await Hr(), await pt(), await D();
  else if (e.name === X)
    await kt();
  else if (e.name === gt)
    await Le();
  else if (e.name === pe)
    await $r(e.scheduledTime);
  else if (e.name && e.name.startsWith("battle_start_")) {
    const r = e.name.replace("battle_start_", "");
    await _e(r);
  }
});
async function De() {
  try {
    const e = await chrome.storage.local.get(["notification_frequency", "notifications_enabled", "my_leetcode_username", "daily_problem_completed_date", "daily_problem_completed_dates"]);
    if (await chrome.alarms.clear(pe), e.notifications_enabled === !1 || !e.my_leetcode_username) return;
    let r = /* @__PURE__ */ new Date();
    z(e.daily_problem_completed_dates, e.daily_problem_completed_date).includes(Z(r)) && (r = new Date(r), r.setDate(r.getDate() + 1), r.setHours(0, 0, 0, 0));
    const t = Pr(r, j(e.notification_frequency));
    t && chrome.alarms.create(pe, { when: t.getTime() });
  } catch (e) {
    console.error("[ServiceWorker] Could not schedule daily reminder:", e);
  }
}
async function $r(e) {
  if (!de) {
    de = !0;
    try {
      const r = /* @__PURE__ */ new Date(), t = new Date(e || r), s = Z(t), a = Z(r), i = Ir(t), n = await chrome.storage.local.get([
        "my_leetcode_username",
        "notification_frequency",
        "notifications_enabled",
        "daily_problem_completed_date",
        "daily_problem_completed_dates",
        "daily_problem_reminder_state"
      ]), o = n.daily_problem_reminder_state || {}, l = he(o, s), d = z(n.daily_problem_completed_dates, n.daily_problem_completed_date), u = j(n.notification_frequency);
      if (s !== a || !je({
        date: r,
        slot: i,
        frequency: u,
        enabled: n.notifications_enabled !== !1,
        solved: d.includes(a),
        deliveredSlots: l
      })) return;
      const c = n.my_leetcode_username;
      if (!c) return;
      const f = Intl.DateTimeFormat().resolvedOptions().timeZone, m = await U(c), g = Ae(m, f);
      if (g === null) return;
      if (g) {
        await chrome.storage.local.set({ daily_problem_completed_dates: z([...d, a]) });
        return;
      }
      const h = await chrome.storage.local.get([
        "notification_frequency",
        "notifications_enabled",
        "daily_problem_completed_date",
        "daily_problem_completed_dates",
        "daily_problem_reminder_state"
      ]), A = h.daily_problem_reminder_state || {}, S = he(A, s), b = z(h.daily_problem_completed_dates, h.daily_problem_completed_date);
      if (!je({
        date: /* @__PURE__ */ new Date(),
        slot: i,
        frequency: j(h.notification_frequency),
        enabled: h.notifications_enabled !== !1,
        solved: b.includes(a),
        deliveredSlots: S
      })) return;
      const E = Br(A.lastQuoteId || o.lastQuoteId), x = `daily-problem-${s}-${i}`;
      await te([{
        id: x,
        nativeNotificationId: `leetstreak-${x}`,
        type: "daily_problem_reminder",
        quoteId: E.id,
        message: E.text,
        priority: 1
      }]) && await chrome.storage.local.set({
        daily_problem_reminder_state: Ur(A, s, i, E.id)
      });
    } catch (r) {
      console.error("[ServiceWorker] Daily reminder delivery failed:", r);
    } finally {
      de = !1, await De();
    }
  }
}
chrome.runtime.onMessage.addListener((e, r, t) => {
  if (e.type === "PING") {
    t({ pong: !0 });
    return;
  }
  switch (e.type) {
    case "FETCH_STATS":
      return xr(e.forceRefresh).then(t), !0;
    case "ADD_FRIEND":
      return Fr(e.username).then(t), !0;
    case "SET_OWN_USERNAME":
      return Wr(e.username).then(t), !0;
    case "REMOVE_FRIEND":
      return Gr(e.username).then(t), !0;
    case "GET_FRIENDS":
      return jr().then(t), !0;
    case "MUTE_NOTIFICATIONS":
      return yr(e.untilUTC).then(() => t({ success: !0 })), !0;
    case "GET_NOTIFICATION_STATE":
      return lt().then((s) => t({ success: !0, state: s })), !0;
    case "ADD_TO_QUEUE":
      return Yr(e.problemData).then(t), !0;
    case "SUBMISSION_ACCEPTED":
      return zr(e.problemSlug, e.title).then(t), !0;
    case "SYNC_BLOCKER_RULES":
      return D().then(t), !0;
    case "GET_BLOCKER_STATUS":
      return M().then(t), !0;
    case "SHOW_NOTIFICATION":
      return te([{
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
      return Ce().then(() => t({ success: !0 })), !0;
    // ===== 1v1 Battle System =====
    case "BATTLE_GET_STATUS":
      return Qr(e.username, e.includeHistory).then(t), !0;
    case "BATTLE_GET_HISTORY_SCOREBOARD":
      return ur(e.filters || {}, e.limit || 12, e.offset || 0).then(t), !0;
    case "BATTLE_GET_HISTORY_DETAILS":
      return dr(e.opponentId, e.filters || {}, e.limit || 10, e.offset || 0).then(t), !0;
    case "BATTLE_CHALLENGE_V2":
      return Kr(e).then(t), !0;
    case "BATTLE_ACCEPT_V2":
    case "BATTLE_ACCEPT":
      return _t(e.battleId).then(t), !0;
    case "BATTLE_READY_V2":
      return wt(e.battleId, e.username).then(t), !0;
    case "BATTLE_SOLVED_V2":
      return Zr(e).then(t), !0;
    case "BATTLE_GET_STATE_V2":
      return Xr(e.battleId).then(t), !0;
    case "BATTLE_FORFEIT_V2":
      return es(e.battleId, e.username).then(t), !0;
    case "BATTLE_OPEN_PROBLEM":
      return St(e.url).then(t), !0;
    case "BATTLE_CHALLENGE":
      return ts(e.challenger, e.challenged, e.language).then(t), !0;
    case "BATTLE_RESPOND":
      return rs(e.battleId, e.username, e.accept).then(t), !0;
    case "BATTLE_PICK_PROBLEM":
      return ss(e.battleId, e.username, e.slug, e.title).then(t), !0;
    case "BATTLE_READY":
      return as(e.battleId, e.username).then(t), !0;
    case "BATTLE_SUBMISSION":
      return is(e).then(t), !0;
    case "BATTLE_FORFEIT":
      return ns(e.battleId, e.username).then(t), !0;
    case "BATTLE_CANCEL":
      return os(e.battleId, e.username).then(t), !0;
    case "BATTLE_VALIDATE_PROBLEM":
      return nt(e.slugOrUrl).then(t), !0;
    case "BATTLE_PING_PRESENCE":
      return cs(e.username).then(t), !0;
    case "BATTLE_GET_PRESENCE":
      return ls(e.usernames).then(t), !0;
    case "BATTLE_GET_ONLINE_FRIENDS":
      return Wt().then((s) => t({ success: !0, friends: s })).catch((s) => t({ success: !1, error: s.message, friends: [] })), !0;
    case "GET_FRIEND_REQUESTS":
      return jt().then((s) => t({ success: !0, requests: s })).catch((s) => t({ success: !1, error: s.message, requests: [] })), !0;
    case "RESPOND_FRIEND_REQUEST":
      return Yt(e.friendshipId, e.accept).then(async (s) => {
        s?.success && await B(), t(s);
      }).catch((s) => t({ success: !1, error: s.message })), !0;
    case "GET_LOGGED_IN_USER":
      return Jr().then(t), !0;
    case "FETCH_OWN_PROFILE":
      return qr(e.forceRefresh).then(t), !0;
    // ===== Cloud Authentication & Account =====
    case "GET_AUTH_STATE":
      return (async () => {
        const s = await _();
        t({
          success: !0,
          state: R(),
          session: s ? { user_id: s.user_id, email: s.email, expires_at: s.expires_at } : null,
          isRateLimited: F(),
          cooldownSeconds: we()
        });
      })().catch((s) => t({ success: !1, error: s.message })), !0;
    case "SIGN_IN_EMAIL":
      return Ht(e.email, e.password).then(async (s) => {
        try {
          await B(), e.username && await chrome.storage.local.set({ my_leetcode_username: e.username });
          const a = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), i = e.username || a.my_leetcode_username;
          i && (await Q(i, a.own_profile || { profile: { realName: i } }), await ne(i, "online"));
        } catch (a) {
          console.warn("[ServiceWorker] Social account restore error:", a);
        }
        t({ success: !0, session: { user_id: s.user_id, email: s.email } });
      }).catch((s) => t({ success: !1, error: s.message, isRateLimited: F() })), !0;
    case "RESTORE_ACCOUNT_DATA":
      return B().then((s) => t(s)).catch((s) => t({ success: !1, error: s.message })), !0;
    case "SIGN_UP_EMAIL":
      return $t(e.email, e.password).then(async (s) => {
        if (e.username && await chrome.storage.local.set({ my_leetcode_username: e.username }), s?.session && s.session.user_id)
          try {
            const a = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), i = e.username || a.my_leetcode_username;
            i && (await Q(i, a.own_profile || { profile: { realName: i } }), await ne(i, "online"));
          } catch (a) {
            console.warn("[ServiceWorker] Sign up profile sync error:", a);
          }
        t(s);
      }).catch((s) => t({ success: !1, error: s.message, isRateLimited: F() })), !0;
    case "SIGN_OUT":
      return xt().then(async (s) => {
        try {
          await Ft();
        } catch {
        }
        await chrome.storage.local.remove(["friends_cache", "friends_list", "friends_account_id"]), t(s);
      }).catch((s) => t({ success: !1, error: s.message })), !0;
    // ===== Roasts =====
    case "SEND_ROAST":
      return us(e.targetUsername, e.fromUsername, e.message).then(t), !0;
    case "CLEAR_ROASTS":
      return (async () => {
        const s = await chrome.storage.local.get("my_leetcode_username");
        return s.my_leetcode_username && await Ke(s.my_leetcode_username), { success: await et() };
      })().then(t), !0;
    case "MARK_ROAST_READ":
      return (async () => (e.roastId && await Qt([e.roastId]), { success: !0 }))().then(t), !0;
    case "POLL_ROASTS":
      return Le().then(t), !0;
    default:
      t({ success: !1, error: `Unknown message type: ${e.type}` });
  }
});
chrome.notifications.onClicked.addListener((e) => {
  if (e.includes("battle")) {
    try {
      chrome.action?.openPopup?.().catch(() => {
      });
    } catch {
    }
    chrome.notifications.clear(e);
  } else (e.includes("streak") || e.includes("roast") || e.includes("solve")) && (chrome.tabs.create({ url: "https://leetcode.com/problemset/" }), chrome.notifications.clear(e));
});
async function xr(e = !1) {
  try {
    let r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "friends_account_id"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured. Please enter your username." };
    const s = await _();
    s?.user_id && r.friends_account_id !== s.user_id && ((await B())?.success ? (r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "friends_account_id"]), t = r.my_leetcode_username || t) : await chrome.storage.local.remove(["friends_cache", "friends_list", "friends_account_id"]));
    let a = await be(), i = !1;
    if (e || !a || ie(a.lastUpdated)) {
      console.log(`[ServiceWorker] Fetching own LeetCode data for: ${t}`);
      try {
        const c = await U(t);
        a = await Y(c, r.user_timezone), await ee(a), i = !0;
      } catch (c) {
        if (console.error(`[ServiceWorker] Error fetching own LeetCode profile for ${t}:`, c), !a)
          return {
            success: !1,
            error: `Failed to fetch LeetCode data for ${t}: ${c.message}`,
            isLeetCodeError: !0
          };
      }
    }
    let o = await H();
    const l = await Xe();
    let d = e;
    if (!d && l.length > 0)
      for (const c of l) {
        const f = o[c];
        if (!f || ie(f?.lastUpdated) || !f.submissionCalendar || !f.profile?.ranking) {
          d = !0;
          break;
        }
      }
    if (d && l.length > 0) {
      console.log("[ServiceWorker] Syncing friends data...");
      for (const c of l) {
        if (c.toLowerCase() === t.toLowerCase()) continue;
        const f = o[c];
        if (e || !f || ie(f?.lastUpdated) || !f.submissionCalendar || !f.profile?.ranking)
          try {
            const g = await U(c), h = await Y(g, r.user_timezone);
            await ke(c, h), await Et(ht);
          } catch (g) {
            console.warn(`[ServiceWorker] Error updating friend ${c}:`, g.message);
          }
      }
      o = await H();
    }
    const u = { ...o };
    return a && (u[t] = a), {
      success: !0,
      ownProfile: a,
      friends: u,
      refreshed: i || d
    };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchStats error:", r), { success: !1, error: r.message };
  }
}
async function qr(e = !1) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured" };
    let s = await be();
    if (e || !s || ie(s.lastUpdated)) {
      const i = await U(t);
      s = await Y(i, r.user_timezone), await ee(s);
    }
    return { success: !0, ownProfile: s };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchOwnProfile error:", r), { success: !1, error: r.message };
  }
}
async function Fr(e) {
  try {
    const r = e;
    let t;
    try {
      t = ot(e);
    } catch (n) {
      return { success: !1, error: n.message };
    }
    const s = await U(r), a = await Y(s);
    if (await ke(t, a), (await _())?.user_id) {
      try {
        const n = await $(), o = Array.isArray(n?.saved_friends) ? n.saved_friends : [];
        o.map((l) => l.toLowerCase()).includes(t.toLowerCase()) || await oe({
          saved_friends: [...o, t]
        });
      } catch (n) {
        console.warn("[ServiceWorker] Cloud settings save friend warning:", n);
      }
      try {
        (await Gt(t))?.status === "accepted" && await B();
      } catch (n) {
        console.warn("[ServiceWorker] Cloud friendship sync warning:", n);
      }
      await H();
    }
    return { success: !0, message: `${r} added successfully`, data: a };
  } catch (r) {
    return console.error("[ServiceWorker] handleAddFriend error:", r), { success: !1, error: r.message || "User not found or profile is private" };
  }
}
async function Wr(e) {
  try {
    const r = ot(e), t = await U(r), s = await Y(t);
    return (await _())?.user_id && !await Q(r, s) ? { success: !1, error: "Could not link this LeetCode profile to your signed-in account" } : (await ee(s), await chrome.storage.local.set({ my_leetcode_username: r, hardcore_mode_enabled: !1 }), { success: !0, username: r, data: s });
  } catch (r) {
    return console.error("[ServiceWorker] handleSetOwnUsername error:", r), { success: !1, error: r.message || "Could not verify LeetCode username" };
  }
}
async function Gr(e) {
  try {
    const r = e.toLowerCase();
    if ((await _())?.user_id) {
      try {
        const s = await $();
        if (Array.isArray(s?.saved_friends) && s.saved_friends.length > 0) {
          const a = s.saved_friends.filter((i) => i.toLowerCase() !== r);
          await oe({ saved_friends: a });
        }
      } catch (s) {
        console.warn("[ServiceWorker] Could not remove friend from cloud settings:", s);
      }
      try {
        await Je(e);
      } catch (s) {
        console.warn("[ServiceWorker] Cloud friendship remove warning:", s);
      }
    }
    return await Kt(e), { success: !0, message: `${e} removed` };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function jr() {
  try {
    const r = (await _())?.user_id || null;
    let t = await H();
    if (r && typeof chrome < "u" && chrome.storage?.local) {
      const i = (await chrome.storage.local.get(`user_friends_${r}`))[`user_friends_${r}`];
      i?.friends && Object.keys(i.friends).length > 0 ? t = { ...t, ...i.friends } : ((await chrome.storage.local.get("friends_account_id")).friends_account_id !== r || !t || Object.keys(t).length === 0) && ((await B())?.success || await chrome.storage.local.remove(["friends_cache", "friends_list", "friends_account_id"]), t = await H());
    }
    const s = Object.values(t || {}).map((a) => a.friend_id || a.username).filter(Boolean);
    return {
      success: !0,
      accountId: r,
      friendIds: s,
      friends: t || {},
      count: Object.keys(t || {}).length
    };
  } catch (e) {
    return { success: !1, error: e.message };
  }
}
async function Yr(e) {
  try {
    if (!e) return { success: !1, error: "Problem data required" };
    const t = (await chrome.storage.local.get("problem_queue")).problem_queue || [];
    if (t.some((i) => i.slug === e.slug || i.id === e.slug))
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
async function zr(e, r) {
  try {
    const t = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "problem_queue"]), s = L(Math.floor(Date.now() / 1e3), t.user_timezone);
    if (await chrome.storage.local.set({
      last_solve_date: s,
      daily_problem_completed_date: Z(/* @__PURE__ */ new Date()),
      daily_problem_completed_dates: z([
        ...t.daily_problem_completed_dates || [],
        t.daily_problem_completed_date,
        Z(/* @__PURE__ */ new Date())
      ])
    }), console.log(`[ServiceWorker] Solve recorded today (${s}) — Hardcore Mode unlocked!`), await D(), t.problem_queue && Array.isArray(t.problem_queue)) {
      const a = t.problem_queue.map((i) => i.slug === e || i.id === e || r && i.title === r ? { ...i, status: "completed" } : i);
      await chrome.storage.local.set({ problem_queue: a });
    }
    return pt().catch(console.error), { success: !0 };
  } catch (t) {
    return console.error("[ServiceWorker] handleSubmissionAccepted error:", t), { success: !1, error: t.message };
  }
}
async function Jr() {
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
async function pt() {
  if (!fe) {
    fe = !0;
    try {
      let e = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "friends_account_id"]);
      const r = await _();
      r?.user_id && e.friends_account_id !== r.user_id && ((await B())?.success || await chrome.storage.local.remove(["friends_cache", "friends_list", "friends_account_id"]), e = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "friends_account_id"]));
      const t = e.my_leetcode_username, s = e.user_timezone, a = await Xe(), i = t ? [.../* @__PURE__ */ new Set([t, ...a])] : a;
      console.log(`[ServiceWorker] Syncing ${i.length} profile(s): ${i.join(", ")}`);
      const n = [];
      if (await Le(), t)
        try {
          const o = await $(t);
          if (o?.pending_roasts && o.pending_roasts.length > 0) {
            for (const l of o.pending_roasts)
              n.push({
                type: "roast",
                username: l.from,
                message: `${l.from} roasted you: "${l.message}" 🔥`,
                priority: 2
              });
            await et();
          }
        } catch (o) {
          console.warn("[ServiceWorker] Error checking pending roasts:", o);
        }
      for (const o of i)
        try {
          const l = await Ze(o), d = await U(o), u = await Y(d, s);
          if (await ke(o, u), t && o.toLowerCase() === t.toLowerCase()) {
            if (await ee(u), Ae(u, s) === !0) {
              const c = L(Math.floor(Date.now() / 1e3), s);
              await chrome.storage.local.set({ last_solve_date: c });
            }
            await D();
          }
          if (!await ut()) {
            const c = await Vr(o, l, u, t);
            if (n.push(...c), t && o.toLowerCase() === t.toLowerCase() && Sr(u.allAcceptedSubmissions, u.stats.streak) && u.stats.streak > 0) {
              const m = await chrome.storage.local.get("streak_at_risk_delivered_state"), g = Er({
                now: /* @__PURE__ */ new Date(),
                deliveredState: m.streak_at_risk_delivered_state,
                hasSolvedToday: !1,
                streak: u.stats.streak
              });
              if (g.allowed) {
                const h = Tr(
                  m.streak_at_risk_delivered_state,
                  g.dayKey,
                  g.slot
                );
                await chrome.storage.local.set({ streak_at_risk_delivered_state: h }), n.push({
                  id: `streak-at-risk-${t.toLowerCase()}-${g.dayKey}-${g.slot}`,
                  username: "You",
                  type: "streak_at_risk",
                  title: "🔥 Streak at Risk!",
                  message: `Your ${u.stats.streak}-day streak will reset at midnight.`,
                  streak: u.stats.streak,
                  priority: 3
                });
              }
            }
          }
          await Et(ht);
        } catch (l) {
          console.warn(`[ServiceWorker] Error syncing ${o}:`, l);
        }
      n.length > 0 && await te(n);
    } catch (e) {
      console.error("[ServiceWorker] syncAllFriends error:", e);
    } finally {
      fe = !1;
    }
  }
}
async function Vr(e, r, t, s) {
  const a = [];
  if (s && e.toLowerCase() === s.toLowerCase())
    return a;
  if (r?.stats && t?.stats) {
    const i = r.stats.total || 0, n = t.stats.total || 0;
    if (n > i) {
      const o = n - i;
      let l = "a problem", d = null;
      t.recentSubmissions && t.recentSubmissions.length > 0 && (l = t.recentSubmissions[0].title || l, d = t.recentSubmissions[0].titleSlug || null), a.push({
        id: `friend-solved-${e.toLowerCase()}-${n}`,
        username: e,
        type: "new_submission",
        problemSlug: d,
        message: `${e} just solved ${o === 1 ? `"${l}"` : `${o} problems`}! 🎯`,
        priority: 1
      });
    }
  }
  return a;
}
async function Y(e, r = null) {
  const { profile: t, contestRanking: s, submissionCalendar: a, allAcceptedSubmissions: i } = e, { currentStreak: n, longestStreak: o } = mr(
    i || [],
    a || {},
    r
  ), l = hr(t.submitStats?.acSubmissionNum);
  return {
    profile: {
      username: t.username,
      realName: t.profile?.realName || "",
      avatar: t.profile?.userAvatar || "",
      ranking: t.profile?.ranking || 0
    },
    stats: {
      ...l,
      streak: n,
      longestStreak: o
    },
    contest: {
      rating: Math.round(s?.rating || 0),
      attended: s?.attendedContestsCount || 0,
      ranking: s?.globalRanking || 0
    },
    badges: t.badges || [],
    recentSubmissions: t.recentSubmissions || [],
    allAcceptedSubmissions: i || [],
    acceptedSubmissionsAvailable: e.acceptedSubmissionsAvailable === !0,
    submissionCalendar: a || {},
    lastUpdated: Date.now()
  };
}
async function Qr(e, r = !1) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = e || t.my_leetcode_username;
    if (!s) return { success: !1, error: "No username configured" };
    const a = await Te(s);
    if (!a)
      return await chrome.storage.local.remove("active_battle_data"), { success: !0, battle: null, history: r ? await it(s, 1) : [] };
    const i = await Ee(a.id);
    return ["countdown", "ready_check", "in_progress"].includes(a.status) ? (await chrome.storage.local.set({
      active_battle_data: {
        battleId: a.id,
        status: a.status,
        match_starts_at: a.match_starts_at || a.start_at,
        match_deadline: a.match_deadline || a.end_at,
        duration_minutes: a.duration_minutes || 30,
        problems: i?.problems || [],
        participants: i?.participants || [],
        results: i?.results || [],
        updated_at: Date.now()
      }
    }), a.status === "countdown" && bt(a.id, a.match_starts_at || a.start_at)) : await chrome.storage.local.remove("active_battle_data"), { success: !0, battle: a, results: i?.results || [], state: i, history: [] };
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function Kr(e) {
  try {
    const t = (await chrome.storage.local.get(["my_leetcode_username"])).my_leetcode_username;
    return t ? await rt(t, e.challenged, {
      topics: e.topics,
      difficulty: e.difficulty,
      durationMinutes: e.durationMinutes,
      problemCount: e.problemCount,
      language: e.language || "javascript"
    }) : { success: !1, error: "Set up your LeetCode username before creating a battle" };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function _t(e) {
  try {
    return await rr(e);
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function wt(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username, a = await sr(e, s);
    if (a?.bothReady || a?.status === "countdown") {
      const i = a.battle?.match_starts_at || a.battle?.start_at;
      bt(e, i);
    }
    return a;
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function Zr(e) {
  try {
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    return await st(e.battleId, e.problemSlug, {
      submissionId: e.submissionId,
      timeTakenMs: e.timeTakenMs,
      runtimeMs: e.runtimeMs,
      memoryMb: e.memoryMb,
      language: e.language,
      username: t
    });
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function Xr(e) {
  try {
    const r = await Ee(e);
    return { success: !!r, state: r };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function es(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await chrome.storage.local.remove("active_battle_data"), await at(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function St(e) {
  try {
    const r = e || "https://leetcode.com/problemset/", t = await chrome.tabs.query({ url: ["*://*.leetcode.com/*", "*://leetcode.com/*"] });
    if (t && t.length > 0) {
      const s = t.find((a) => a.active) || t[0];
      if (await chrome.tabs.update(s.id, { url: r, active: !0 }), s.windowId)
        try {
          await chrome.windows.update(s.windowId, { focused: !0 });
        } catch {
        }
      return { success: !0, updated: !0, tabId: s.id };
    } else
      return { success: !0, created: !0, tabId: (await chrome.tabs.create({ url: r, active: !0 })).id };
  } catch (r) {
    return console.warn("[ServiceWorker] redirectToBattleProblem error:", r), { success: !1, error: r.message };
  }
}
async function _e(e) {
  try {
    const r = await Ee(e);
    if (!r?.problems?.length) return { success: !1, error: "No problems in battle" };
    const t = r.problems[0], s = t.problem_url || `https://leetcode.com/problems/${t.problem_slug}/`;
    await chrome.storage.local.set({
      active_battle_data: {
        battleId: e,
        status: "in_progress",
        match_starts_at: r.battle?.match_starts_at || r.battle?.start_at,
        match_deadline: r.battle?.match_deadline || r.battle?.end_at,
        duration_minutes: r.battle?.duration_minutes || 30,
        problems: r.problems,
        participants: r.participants || [],
        results: r.results || [],
        updated_at: Date.now()
      }
    });
    const a = await St(s);
    return chrome.notifications && chrome.notifications.create(`battle_start_${e}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "⚔️ Battle Started!",
      message: `Duel is live! First problem: ${t.problem_title}`,
      priority: 2
    }), { success: !0, targetUrl: s, redirectResult: a };
  } catch (r) {
    return console.warn("[ServiceWorker] startBattleAndRedirect error:", r), { success: !1, error: r.message };
  }
}
function bt(e, r) {
  if (!e) return;
  const t = r ? Date.parse(r) : Date.now() + 1e4, s = Date.now(), a = Math.max(0, t - s);
  if (a <= 500) {
    _e(e).catch(console.warn);
    return;
  }
  try {
    chrome.alarms.create(`battle_start_${e}`, { when: t });
  } catch (i) {
    console.warn("[ServiceWorker] Could not create battle_start alarm:", i);
  }
  setTimeout(() => {
    _e(e).catch(console.warn);
  }, a);
}
async function ts(e, r, t) {
  try {
    const a = (await chrome.storage.local.get(["my_leetcode_username"])).my_leetcode_username;
    return await ar(a, r, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function rs(e, r, t) {
  try {
    const s = await chrome.storage.local.get("my_leetcode_username"), a = r || s.my_leetcode_username;
    return t ? await _t(e) : await nr(e, a, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function ss(e, r, t, s) {
  try {
    const a = await chrome.storage.local.get("my_leetcode_username"), i = r || a.my_leetcode_username;
    return await or(e, i, t, s);
  } catch (a) {
    return { success: !1, error: a.message };
  }
}
async function as(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await wt(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function is(e) {
  try {
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    if (!t) return { success: !1, error: "No username configured" };
    if (e.accepted !== !0 || typeof e.problemSlug != "string")
      return { success: !1, error: "Only a confirmed Accepted result can be recorded" };
    const s = await Te(t);
    return s ? await st(s.id, e.problemSlug, {
      submissionId: e.submissionId,
      runtimeMs: e.runtime_ms,
      memoryMb: e.memory_mb,
      language: e.language
    }) : { success: !1, error: "No active battle in progress" };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function ns(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await at(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function os(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await lr(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function kt() {
  try {
    if (!(await _())?.user_id) return;
    const r = await chrome.storage.local.get(["my_leetcode_username", "notified_battle_invites"]), t = r.my_leetcode_username;
    if (t) {
      await ne(t, "online");
      const s = await Te(t);
      if (s && s.status === "pending" && s.challenged_username?.toLowerCase() === t.toLowerCase()) {
        const a = new Set(r.notified_battle_invites || []);
        a.has(s.id) || (a.add(s.id), await chrome.storage.local.set({ notified_battle_invites: [...a].slice(-50) }), await te([{
          id: `battle_invite_${s.id}`,
          type: "battle_invite",
          battleId: s.id,
          challenger: s.challenger_username,
          title: `⚔️ Battle Request from @${s.challenger_username}`,
          message: `Ranked 1v1 • ${s.duration_minutes || 15} min • ${s.difficulty || "Medium"}${s.topics?.length ? ` • ${s.topics.join(", ")}` : ""}`,
          priority: 3,
          data: {
            battleId: s.id,
            challenger: s.challenger_username,
            difficulty: s.difficulty || "Medium",
            durationMinutes: s.duration_minutes || 15,
            topics: s.topics || []
          }
        }]));
      }
    }
  } catch (e) {
    console.warn("[ServiceWorker] handlePresenceHeartbeat error:", e);
  }
}
async function cs(e) {
  try {
    const t = (await chrome.storage.local.get(["my_leetcode_username"])).my_leetcode_username;
    return t && await ne(t), { success: !0 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function ls(e) {
  try {
    if (!e?.length) return { success: !0, presenceMap: {} };
    const r = await fr(e);
    return { success: !0, presenceMap: Object.fromEntries(r) };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function us(e, r, t) {
  try {
    return await Qe(e, r, t) ? { success: !0 } : { success: await Zt(e, r, t) };
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
function Et(e) {
  return new Promise((r) => setTimeout(r, e));
}
