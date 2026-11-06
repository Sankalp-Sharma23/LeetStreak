function gt(e, r = 1, t = 50) {
  return !e || typeof e != "string" ? { valid: !1, error: "Username is required" } : (e = e.trim(), e.length < r || e.length > t ? { valid: !1, error: `Username must be ${r}-${t} characters` } : /^[a-zA-Z0-9_-]+$/.test(e) ? { valid: !0, username: e.toLowerCase() } : { valid: !1, error: "Username contains invalid characters" });
}
class yt {
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
const ht = /* @__PURE__ */ new Set([
  "leetcode.com",
  "assets.leetcode.com"
]);
function pt(e, r) {
  try {
    const t = new URL(e);
    return t.protocol !== "https:" ? {
      valid: !1,
      reason: `Insecure transport: ${e} does not use HTTPS`
    } : (!ht.has(t.hostname) && !t.hostname.endsWith(".supabase.co") && console.warn(`[SecurityAuditor] Request to external domain: ${t.hostname}`), !r.headers?.get("strict-transport-security") && t.hostname === "leetcode.com" && console.warn(`[SecurityAuditor] Warning: Missing HSTS header on response from ${t.hostname}`), { valid: !0 });
  } catch (t) {
    return {
      valid: !1,
      reason: `Transport security audit failed: ${t.message}`
    };
  }
}
async function _t(e, r = {}) {
  if (!e.startsWith("https://"))
    throw new Error(`Security Violation: Insecure HTTP request blocked for ${e}`);
  const t = await fetch(e, r), s = pt(e, t);
  return s.valid || console.error(`[SecurityAuditor] Security policy failed: ${s.reason}`), t;
}
const Q = "https://leetcode.com/graphql", wt = 2, oe = 6e3, Te = new yt(30, 6e4);
function Ae(e) {
  return new Promise((r) => setTimeout(r, e));
}
async function St(e, r, t = wt) {
  let s;
  if (!Te.isAllowed()) {
    const i = Te.getTimeUntilReset();
    throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(i / 1e3)} seconds.`);
  }
  for (let i = 0; i < t; i++)
    try {
      if (typeof navigator < "u" && !navigator.onLine)
        throw new Error("No internet connection. Please check your network.");
      const a = new AbortController(), o = setTimeout(() => a.abort(), oe), c = await _t(e, {
        ...r,
        signal: a.signal
      });
      if (clearTimeout(o), c.status === 429) {
        const n = parseInt(c.headers.get("Retry-After")) || Math.pow(2, i);
        console.log(`[API] Rate limited. Retrying after ${n}s`), await Ae(n * 1e3);
        continue;
      }
      return c;
    } catch (a) {
      if (s = a, a.name === "AbortError" && (console.error(`[API] Request timeout (${oe}ms)`), s = new Error(`Request timed out after ${oe / 1e3} seconds`)), a.message.includes("No internet connection"))
        throw a;
      if (i < t - 1) {
        const o = Math.pow(2, i) * 1e3;
        console.log(`[API] Retry ${i + 1}/${t} in ${o}ms`), await Ae(o);
      }
    }
  throw s || new Error("Network request failed after multiple retries");
}
const bt = `
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
`, Et = `
  query getUserBadges($username: String!) {
    matchedUser(username: $username) {
      badges {
        id
        displayName
        icon
      }
    }
  }
`, Tt = `
  query getRecentSubmissions($username: String!) {
    recentSubmissionList(username: $username, limit: 15) {
      title
      titleSlug
      timestamp
      statusDisplay
      lang
    }
  }
`, At = `
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
async function G(e) {
  try {
    console.log(`[API] Fetching data for user: ${e}`);
    const r = await St(Q, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: bt,
        variables: { username: e }
      })
    });
    if (console.log(`[API] Profile response status: ${r.status}`), !r.ok) {
      const n = await r.text();
      throw console.error("[API] Profile request failed:", r.status, n), new Error(`API request failed: ${r.status}`);
    }
    const t = await r.json();
    if (console.log("[API] Profile data received:", t), t.errors)
      throw console.error("[API] GraphQL errors:", t.errors), new Error(t.errors[0]?.message || "GraphQL error");
    if (!t.data?.matchedUser)
      throw console.error("[API] No matched user in response"), new Error("User not found or profile is private");
    const s = t.data.matchedUser, i = s.submissionCalendar ? JSON.parse(s.submissionCalendar) : {};
    let a = [];
    try {
      const n = await fetch(Q, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: Et,
          variables: { username: e }
        })
      });
      n.ok && (a = (await n.json()).data?.matchedUser?.badges || []);
    } catch (n) {
      console.warn("[API] Failed to fetch badges:", n);
    }
    let o = [];
    try {
      const n = await fetch(Q, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: Tt,
          variables: { username: e }
        })
      });
      n.ok && (o = (await n.json()).data?.recentSubmissionList || []);
    } catch (n) {
      console.warn("[API] Failed to fetch recent submissions:", n);
    }
    let c = [];
    try {
      const n = await fetch(Q, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: At,
          variables: { username: e }
        })
      });
      if (n.ok) {
        const l = await n.json();
        l.errors ? console.warn("[API] All submissions query error:", l.errors) : (c = l.data?.matchedUser?.recentAcSubmissions || [], console.log(`[API] Fetched ${c.length} all-time accepted submissions (limit 1000)`), c.length > 0 && console.log("[API] Sample submissions:", c.slice(0, 5).map((u) => u.titleSlug)));
      }
    } catch (n) {
      console.warn("[API] Failed to fetch all submissions:", n);
    }
    return console.log(`[API] Successfully fetched data for ${e}`), {
      profile: {
        ...s,
        badges: a,
        recentSubmissions: o
      },
      allAcceptedSubmissions: c,
      contestRanking: t.data.userContestRanking,
      submissionCalendar: i
    };
  } catch (r) {
    throw console.error("Error fetching LeetCode data:", r), r;
  }
}
const ke = { VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6c2xkY2pncGlvZHp1aXZyYnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NDYwODMsImV4cCI6MjEwMzEyMjA4M30.TuPkW7jnn9rScS2FhH1A8omsSIpABs6MEKfRbX1lzYU", VITE_SUPABASE_URL: "https://pzsldcjgpiodzuivrbwt.supabase.co" }, Ue = typeof import.meta < "u" && ke ? ke : typeof process < "u" && process.env ? process.env : {}, h = Ue.VITE_SUPABASE_URL || "YOUR_SUPABASE_PROJECT_URL_HERE", F = Ue.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY_HERE", T = h.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), f = {
  SESSION_LOADING: "SESSION_LOADING",
  AUTHENTICATED: "AUTHENTICATED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  AUTH_ERROR: "AUTH_ERROR"
};
let L = null, ne = f.SESSION_LOADING, Me = null, W = 0;
const kt = /* @__PURE__ */ new Set();
function _(e, r = null) {
  ne = e, Me = r;
  for (const t of kt)
    try {
      t(ne, L, Me);
    } catch (s) {
      console.warn("[SupabaseClient] Error in auth listener callback:", s);
    }
}
function D() {
  return ne;
}
function x() {
  return Date.now() < W;
}
function de() {
  return Math.max(0, Math.ceil((W - Date.now()) / 1e3));
}
function fe(e = 60) {
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
async function q(e) {
  if (L = e, typeof chrome < "u" && chrome.storage?.local)
    try {
      e ? await chrome.storage.local.set({ supabase_auth_session: e }) : await chrome.storage.local.remove(["supabase_auth_session"]);
    } catch {
    }
}
async function Mt() {
  _(f.SESSION_LOADING);
  try {
    let e = null;
    if (typeof chrome < "u" && chrome.storage?.local) {
      const r = await chrome.storage.local.get(["supabase_auth_session", "supabase_auth_cooldown_until"]);
      r.supabase_auth_cooldown_until && r.supabase_auth_cooldown_until > Date.now() && (W = r.supabase_auth_cooldown_until), e = r.supabase_auth_session;
    } else
      e = L;
    if (!e)
      return _(f.AUTH_REQUIRED), null;
    if (e.expires_at && e.expires_at > Date.now() + 6e4)
      return L = e, _(f.AUTHENTICATED), L;
    if (e.refresh_token) {
      if (x())
        return _(f.AUTH_ERROR, "Authentication temporarily rate-limited. Please wait."), null;
      const r = await Ct(e.refresh_token);
      if (r)
        return r;
    }
    return await q(null), _(f.SESSION_EXPIRED, "Session expired. Please sign in again."), null;
  } catch (e) {
    return console.warn("[SupabaseClient] Error restoring session:", e), _(f.AUTH_ERROR, e.message), null;
  }
}
async function Ct(e) {
  if (x())
    return _(f.AUTH_ERROR, "Rate limited"), null;
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
      return fe(60), _(f.AUTH_ERROR, "Supabase authentication rate limit exceeded."), null;
    if (!r.ok)
      return await q(null), _(f.SESSION_EXPIRED, "Session expired or revoked."), null;
    const t = await r.json(), s = {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      user_id: t.user?.id,
      email: t.user?.email,
      expires_at: Date.now() + (t.expires_in ? t.expires_in * 1e3 : 3600 * 1e3)
    };
    return await q(s), _(f.AUTHENTICATED), s;
  } catch (r) {
    return console.warn("[SupabaseClient] Network error during token refresh:", r), _(f.AUTH_ERROR, r.message), null;
  }
}
async function vt(e, r) {
  if (x()) {
    const t = de();
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
      throw fe(60), _(f.AUTH_ERROR, "Rate limit exceeded"), new Error("Email rate limit exceeded. Please wait 1 minute before retrying.");
    if (!t.ok) {
      const a = await t.text();
      let o = "Invalid email or password";
      try {
        const c = JSON.parse(a);
        o = c.error_description || c.msg || o;
      } catch {
      }
      throw new Error(o);
    }
    const s = await t.json(), i = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      user_id: s.user?.id,
      email: s.user?.email || e,
      expires_at: Date.now() + (s.expires_in ? s.expires_in * 1e3 : 3600 * 1e3)
    };
    return await q(i), _(f.AUTHENTICATED), i;
  } catch (t) {
    throw _(f.AUTH_ERROR, t.message), t;
  }
}
async function Rt(e, r) {
  if (x()) {
    const t = de();
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
      throw fe(60), _(f.AUTH_ERROR, "Rate limit exceeded"), new Error("Email signup rate limit exceeded. Please wait before retrying.");
    if (!t.ok) {
      const i = await t.text();
      let a = "Failed to create account";
      try {
        const o = JSON.parse(i);
        a = o.error_description || o.msg || a;
      } catch {
      }
      throw new Error(a);
    }
    const s = await t.json();
    if (s.access_token) {
      const i = {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        user_id: s.user?.id,
        email: s.user?.email || e,
        expires_at: Date.now() + (s.expires_in ? s.expires_in * 1e3 : 36e5)
      };
      return await q(i), _(f.AUTHENTICATED), { success: !0, session: i };
    }
    return _(f.AUTH_REQUIRED), {
      success: !0,
      confirmationRequired: !0,
      user: s.user,
      message: "Account created. Please check your inbox to confirm your email before signing in."
    };
  } catch (t) {
    throw _(f.AUTH_ERROR, t.message), t;
  }
}
async function Lt() {
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
  return await q(null), _(f.AUTH_REQUIRED), { success: !0 };
}
async function v() {
  const r = (await A())?.access_token || F;
  return {
    "Content-Type": "application/json",
    apikey: F,
    Authorization: `Bearer ${r}`,
    Prefer: "return=representation"
  };
}
async function w(e, r = {}) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await v(), s = await fetch(`${T}/rest/v1/rpc/${e}`, {
      method: "POST",
      headers: t,
      body: JSON.stringify(r)
    });
    if (!s.ok) {
      const i = await s.text();
      console.error(`[SupabaseClient] RPC ${e} error:`, s.status, i);
      let a = null;
      try {
        a = JSON.parse(i);
      } catch {
      }
      return {
        success: !1,
        error: a?.message || a?.error_description || i,
        code: a?.code || null,
        raw: i
      };
    }
    return await s.json();
  } catch (t) {
    return console.error(`[SupabaseClient] RPC ${e} exception:`, t), { success: !1, error: t.message };
  }
}
async function Be(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return null;
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
async function P(e, r) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return !1;
  try {
    const t = await A();
    if (!t?.user_id)
      return !1;
    const s = await v(), i = r?.stats || {}, a = r?.profile || {}, o = r?.contest || {}, c = {
      id: t.user_id,
      leetcode_username: e.toLowerCase(),
      display_name: a.realName || e,
      avatar_url: a.avatar || "",
      total_solved: i.total || 0,
      easy_solved: i.easy || 0,
      medium_solved: i.medium || 0,
      hard_solved: i.hard || 0,
      current_streak: i.streak || 0,
      longest_streak: i.longestStreak || 0,
      contest_rating: o.rating || 0,
      last_synced_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    return (await fetch(`${T}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        ...s,
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(c)
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
async function He(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return !1;
  try {
    const r = await A();
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
async function Pt() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    return (await A())?.user_id ? await w("set_presence_offline") : null;
  } catch {
    return null;
  }
}
async function Dt() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  try {
    const e = await w("get_online_friends");
    return Array.isArray(e) ? e : [];
  } catch (e) {
    return console.warn("[SupabaseClient] getOnlineFriends error:", e), [];
  }
}
async function me(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return { success: !1 };
  try {
    return await w("sync_friendship", { p_target_username: e.toLowerCase() }) || { success: !1 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function $e(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return { success: !1 };
  try {
    return await w("remove_friendship", { p_target_username: e.toLowerCase() }) || { success: !1 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function xe() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  try {
    const e = await w("get_accepted_friends");
    return Array.isArray(e) ? e : e && Array.isArray(e.data) ? e.data : [];
  } catch (e) {
    return console.error("[SupabaseClient] getAcceptedFriends error:", e), [];
  }
}
async function It() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const e = await w("get_own_profile");
    if (e && typeof e == "object" && e.id) return e;
    const r = await A();
    if (!r?.user_id) return null;
    const t = await v(), s = await fetch(
      `${T}/rest/v1/profiles?id=eq.${encodeURIComponent(r.user_id)}&select=*`,
      { method: "GET", headers: t }
    );
    if (!s.ok) return null;
    const i = await s.json();
    return i && i.length > 0 ? i[0] : null;
  } catch (e) {
    return console.error("[SupabaseClient] getOwnProfile error:", e), null;
  }
}
async function ce() {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return { success: !1 };
  try {
    if (!(await A())?.user_id)
      return { success: !1, error: "No authenticated session" };
    const r = await It();
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
    const t = await xe();
    if (typeof chrome < "u" && chrome.storage?.local) {
      const s = await chrome.storage.local.get(["friends_cache", "friends_list"]), i = s.friends_cache || {}, a = s.friends_list || [], o = { ...i }, c = new Set(a);
      for (const l of t) {
        const u = (l.leetcode_username || "").toLowerCase();
        u && (c.add(u), o[u] = {
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
        friends_cache: o,
        friends_list: Array.from(c)
      });
      const n = Object.keys(i).filter(
        (l) => !t.some((u) => (u.leetcode_username || "").toLowerCase() === l.toLowerCase())
      );
      if (n.length > 0)
        for (const l of n)
          me(l).catch(() => {
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
async function Fe(e, r, t) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e || !t) return !1;
  try {
    const s = await A();
    if (!s?.user_id)
      return console.warn("[Roast] Authentication required to send cloud roasts"), !1;
    const i = await w("send_roast", {
      p_recipient_username: e.toLowerCase(),
      p_content: t.substring(0, 500)
    });
    if (i && i.success)
      return !0;
    const a = await Be(e);
    if (!a?.id)
      return console.warn(`[Roast] Target user ${e} has not registered on Supabase`), !1;
    const o = await v();
    return (await fetch(`${T}/rest/v1/roast_messages`, {
      method: "POST",
      headers: {
        ...o,
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        sender_id: s.user_id,
        recipient_id: a.id,
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
async function qe(e) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return [];
  try {
    if (!await A()) return [];
    const t = await v(), s = await fetch(
      `${T}/rest/v1/roast_messages?recipient_username=eq.${e.toLowerCase()}&status=neq.read&order=created_at.desc&limit=20`,
      { method: "GET", headers: t }
    );
    return s.ok ? await s.json() : [];
  } catch (r) {
    return console.warn("Error fetching unread roasts:", r), [];
  }
}
async function Nt(e) {
  if (!(!e?.length || h === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      const r = await v(), t = e.map((s) => `"${s}"`).join(",");
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
async function Ot(e) {
  if (!(!e?.length || h === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      const r = await v(), t = e.map((s) => `"${s}"`).join(",");
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
async function Ge(e) {
  if (!e || h === "YOUR_SUPABASE_PROJECT_URL_HERE") return !0;
  try {
    const r = await qe(e);
    if (!r || r.length === 0) return !0;
    const t = r.map((s) => s.id);
    return await Ot(t), !0;
  } catch (r) {
    return console.error("Error clearing roasts:", r), !1;
  }
}
async function V() {
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
    const r = await V();
    return r && D() === f.AUTHENTICATED && P(r, e).catch((t) => {
      console.warn("[Storage] Cloud sync for own profile failed (non-blocking):", t);
    }), !0;
  } catch (r) {
    return console.error("Error saving own profile to storage:", r), !1;
  }
}
async function K() {
  try {
    const e = await V(), r = typeof chrome < "u" && chrome.storage?.local ? await chrome.storage.local.get(["friends_cache", "own_profile", "friends_list"]) : {}, t = r.friends_cache || {}, s = r.own_profile || null, i = r.friends_list || [], a = { ...t };
    if (e && s && (a[e] = s), D() !== f.AUTHENTICATED)
      return a;
    try {
      const o = await xe();
      if (Array.isArray(o) && o.length > 0) {
        let c = !1;
        o.forEach((n) => {
          const l = (n.leetcode_username || "").toLowerCase();
          l && !a[l] && (a[l] = {
            username: l,
            profile: {
              username: l,
              realName: n.display_name || l,
              avatar: n.avatar_url || ""
            },
            stats: {
              total: n.total_solved || 0,
              easy: n.easy_solved || 0,
              medium: n.medium_solved || 0,
              hard: n.hard_solved || 0,
              streak: n.current_streak || 0,
              longestStreak: n.longest_streak || 0
            },
            contest: { rating: n.contest_rating || 0 },
            friend_id: n.friend_id,
            friendship_id: n.friendship_id,
            lastUpdated: n.last_synced_at ? new Date(n.last_synced_at).getTime() : Date.now()
          }, c = !0);
        }), c && typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ friends_cache: a }).catch(() => {
        });
      }
    } catch (o) {
      console.warn("[Storage] Permanent friends refresh skipped/failed:", o.message);
    }
    return a;
  } catch (e) {
    return console.error("Error getting friends:", e), {};
  }
}
async function ge(e) {
  if (!e) return null;
  try {
    const r = await V();
    if (r && e.toLowerCase() === r.toLowerCase())
      return await Y();
    if (typeof chrome < "u" && chrome.storage?.local) {
      const i = await chrome.storage.local.get(["friends_cache"]);
      if (i.friends_cache && i.friends_cache[e])
        return i.friends_cache[e];
    }
    const t = await Be(e);
    if (!t) return null;
    const s = t.leetcode_data || {};
    return s.lastUpdated = t.last_synced_at ? new Date(t.last_synced_at).getTime() : Date.now(), s;
  } catch (r) {
    return console.error("Error getting single friend:", r), null;
  }
}
async function ye(e, r) {
  if (!e || !r) return { success: !1 };
  try {
    const t = await V();
    if (t && e.toLowerCase() === t.toLowerCase())
      return await te(r), { success: !0 };
    if (typeof chrome < "u" && chrome.storage?.local) {
      const i = await chrome.storage.local.get(["friends_cache", "friends_list"]), a = i.friends_cache || {}, o = i.friends_list || [];
      a[e] = r;
      const c = o.includes(e) ? o : [...o, e];
      await chrome.storage.local.set({
        friends_cache: a,
        friends_list: c
      });
    }
    return D() === f.AUTHENTICATED && (P(e, r).catch(() => {
    }), t && ee().then((i) => {
      const a = i?.friends_list || [];
      a.includes(e) || He({ friends_list: [...a, e] }).catch(() => {
      });
    }).catch(() => {
    })), { success: !0 };
  } catch (t) {
    return console.error("Error saving friend:", t), { success: !1, error: t.message };
  }
}
async function Ut(e) {
  if (!e) return !1;
  try {
    if (typeof chrome < "u" && chrome.storage?.local) {
      const r = await chrome.storage.local.get(["friends_cache", "friends_list"]), t = r.friends_cache || {}, s = r.friends_list || [];
      delete t[e];
      const i = s.filter((a) => a.toLowerCase() !== e.toLowerCase());
      await chrome.storage.local.set({
        friends_cache: t,
        friends_list: i
      });
    }
    return D() === f.AUTHENTICATED && ($e(e).catch(() => {
    }), ee().then((r) => {
      if (r?.friends_list) {
        const t = r.friends_list.filter((s) => s.toLowerCase() !== e.toLowerCase());
        He({ friends_list: t }).catch(() => {
        });
      }
    }).catch(() => {
    })), !0;
  } catch (r) {
    return console.error("Error removing friend:", r), !1;
  }
}
async function We() {
  try {
    if (typeof chrome < "u" && chrome.storage?.local) {
      const e = await chrome.storage.local.get(["friends_list"]);
      if (e.friends_list && Array.isArray(e.friends_list))
        return e.friends_list;
    }
    if (D() === f.AUTHENTICATED) {
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
async function Bt(e, r, t) {
  return await Fe(e, r, t);
}
async function Ye() {
  const e = await V();
  return e ? await Ge(e) : !1;
}
const Ht = [
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
], $t = h.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), he = /* @__PURE__ */ new Set([
  "completed",
  "declined",
  "expired",
  "cancelled",
  "forfeited"
]), E = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  READY_CHECK: "ready_check",
  COUNTDOWN: "countdown",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  FORFEITED: "forfeited"
}, xt = 1440 * 60, Ce = 10;
async function b(e, r = {}) {
  if (h === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await v(), { headers: s, ...i } = r, a = await fetch(`${$t}/rest/v1/${e}`, {
      ...i,
      headers: { ...t, ...s || {} }
    });
    return a.ok ? a.json() : (console.error(`[Battle] Supabase error ${a.status} on ${e}:`, await a.text()), null);
  } catch (t) {
    return console.error("[Battle] Supabase fetch error:", t), null;
  }
}
function Ft({ topics: e = [], difficulty: r = "Medium", count: t = 5 }) {
  const s = Ht || [];
  if (!s.length) return [];
  const i = Array.isArray(e) && e.length > 0 ? e.map((l) => l.toLowerCase()) : [];
  let a = s;
  if (i.length > 0) {
    const l = s.filter(
      (u) => Array.isArray(u.topics) && u.topics.some((d) => i.includes(d.toLowerCase()))
    );
    l.length >= t, a = l;
  }
  let o = [];
  const c = (r || "Medium").toLowerCase(), n = (l) => [...l].sort(() => Math.random() - 0.5);
  if (c === "mixed") {
    const l = n(a.filter((g) => g.difficulty?.toLowerCase() === "easy")), u = n(a.filter((g) => g.difficulty?.toLowerCase() === "medium")), d = n(a.filter((g) => g.difficulty?.toLowerCase() === "hard")), m = Math.max(1, Math.floor(t * 0.25)), S = t >= 5 ? 1 : 0, y = t - m - S;
    if (o.push(...l.slice(0, m)), o.push(...u.slice(0, y)), o.push(...d.slice(0, S)), o.length < t) {
      const g = new Set(o.map((B) => B.slug)), U = n(a.filter((B) => !g.has(B.slug)));
      o.push(...U.slice(0, t - o.length));
    }
  } else {
    const l = a.filter((u) => u.difficulty?.toLowerCase() === c);
    if (l.length >= t)
      o = n(l).slice(0, t);
    else {
      const u = new Set(l.map((m) => m.slug)), d = n(a.filter((m) => !u.has(m.slug)));
      o = [...l, ...d].slice(0, t);
    }
  }
  if (o.length < t) {
    const l = new Set(o.map((d) => d.slug)), u = n(s.filter((d) => !l.has(d.slug)));
    o.push(...u.slice(0, t - o.length));
  }
  return o.slice(0, t).map((l, u) => ({
    sequence_number: u + 1,
    slug: l.slug,
    title: l.title,
    url: `https://leetcode.com/problems/${l.slug}/`,
    difficulty: l.difficulty,
    topics: l.topics || []
  }));
}
async function je(e, r, t = {}) {
  const {
    topics: s = ["Arrays", "Strings"],
    difficulty: i = "Medium",
    durationMinutes: a = 30,
    problemCount: o = 5,
    language: c = "javascript"
  } = t;
  if (!e || !r)
    return { success: !1, error: "Challenger and opponent usernames are required" };
  if (e.toLowerCase() === r.toLowerCase())
    return { success: !1, error: "Cannot challenge yourself" };
  try {
    const p = await Y();
    e && p && await P(e, p);
  } catch {
  }
  try {
    const p = await w("create_battle_v2", {
      p_challenged_username: r.toLowerCase(),
      p_topics: s,
      p_difficulty: i,
      p_duration_minutes: a,
      p_problem_count: o,
      p_language: c.toLowerCase(),
      p_challenger_username: e.toLowerCase()
    });
    if (p && p.success && p.battle)
      return { success: !0, battle: p.battle };
    if (!(p?.code === "PGRST202" || typeof p?.error == "string" && p.error.includes("PGRST202")) && p?.error) {
      let ae = p.error;
      try {
        const Ee = JSON.parse(p.error);
        ae = Ee.message || Ee.error || ae;
      } catch {
      }
      return { success: !1, error: ae };
    }
  } catch (p) {
    console.warn("[BattleManager] create_battle_v2 RPC error, falling back to REST:", p);
  }
  const [n, l] = await Promise.all([
    Z(e),
    Z(r)
  ]);
  if (n) return { success: !1, error: "You already have an active battle in progress" };
  if (l) return { success: !1, error: `${r} is currently in an active battle` };
  const u = await A(), d = await b(
    `profiles?leetcode_username=in.("${e.toLowerCase()}","${r.toLowerCase()}")&select=id,leetcode_username`
  );
  let m = d?.find((p) => p.leetcode_username.toLowerCase() === e.toLowerCase()), S = d?.find((p) => p.leetcode_username.toLowerCase() === r.toLowerCase());
  if (!m && u?.user_id) {
    const p = await Y();
    await P(e, p || { profile: { realName: e } }), m = { id: u.user_id, leetcode_username: e.toLowerCase() };
  }
  const y = u?.user_id || m?.id, g = S?.id;
  if (!g) return { success: !1, error: `${r} does not have a LeetStreak account.` };
  const U = Date.now(), B = new Date(U + xt * 1e3).toISOString(), k = {
    challenger_id: y,
    challenged_id: g,
    challenger_username: e,
    challenged_username: r,
    language: c.toLowerCase(),
    status: E.PENDING,
    topics: s,
    difficulty: i,
    duration_minutes: a,
    problem_count: o,
    expires_at: B
  }, M = await b("battles", {
    method: "POST",
    body: JSON.stringify(k)
  });
  return !M || M.length === 0 ? { success: !1, error: "Failed to create battle room" } : { success: !0, battle: M[0] };
}
async function Je(e) {
  if (!e) return { success: !1, error: "Battle ID required" };
  const r = await w("accept_battle_v2", { p_battle_id: e });
  if (r && r.success && r.battle)
    return { success: !0, battle: r.battle };
  const t = await C(e);
  if (!t) return { success: !1, error: "Battle not found" };
  const s = await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: E.ACCEPTED,
      accepted_at: (/* @__PURE__ */ new Date()).toISOString()
    })
  });
  return t.challenger_id && t.challenged_id && await b("battle_participants", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([
      { battle_id: e, user_id: t.challenger_id, username: t.challenger_username, is_ready: !1 },
      { battle_id: e, user_id: t.challenged_id, username: t.challenged_username, is_ready: !1 }
    ])
  }).catch(() => {
  }), { success: !0, battle: s?.[0] || t };
}
async function qt(e, r) {
  if (!e) return { success: !1, error: "Battle ID required" };
  const t = await C(e);
  if (!t) return { success: !1, error: "Battle not found" };
  const s = Ft({
    topics: t.topics || ["Arrays", "Strings"],
    difficulty: t.difficulty || "Medium",
    count: t.problem_count || 5
  }), i = await w("confirm_ready_v2", {
    p_battle_id: e,
    p_problems: s
  });
  return i && i.success ? {
    success: !0,
    battle: await C(e) || i.battle,
    bothReady: i.bothReady,
    status: i.status
  } : await Ve(e, r);
}
async function Gt(e, r, t = {}) {
  const {
    submissionId: s,
    timeTakenMs: i = 0,
    runtimeMs: a = null,
    memoryMb: o = null,
    language: c = "javascript",
    username: n = "user"
  } = t, l = await w("record_battle_solve", {
    p_battle_id: e,
    p_problem_slug: r,
    p_submission_id: s || `sub_${Date.now()}`,
    p_time_taken_ms: i,
    p_runtime_ms: a,
    p_memory_mb: o,
    p_language: c
  });
  return l && l.success ? l : {
    success: (await Qe(e, n, {
      problemSlug: r,
      submissionId: s,
      accepted: !0,
      runtime_ms: a,
      memory_mb: o,
      language: c,
      timeTakenSeconds: Math.floor(i / 1e3)
    }))?.success || !1,
    solved_count: 1,
    next_problem_slug: null,
    battle_complete: !1
  };
}
async function ze(e) {
  if (!e) return null;
  const r = await w("get_battle_state_v2", { p_battle_id: e });
  if (r && r.success)
    return r;
  const [t, s, i, a] = await Promise.all([
    C(e),
    b(`battle_problems?battle_id=eq.${e}&order=sequence_number.asc`),
    b(`battle_participants?battle_id=eq.${e}`),
    re(e)
  ]);
  return t ? {
    success: !0,
    battle: t,
    problems: s || [],
    participants: i || [],
    results: a || []
  } : null;
}
async function Wt(e, r) {
  const t = await w("forfeit_battle_v2", { p_battle_id: e });
  return t && t.success ? t : await Ze(e, r);
}
async function Yt(e, r, t = "javascript") {
  return await je(e, r, { language: t });
}
async function Z(e) {
  if (!e) return null;
  const r = Array.from(he).join(","), t = e.toLowerCase(), s = await b(
    `battles?or=(challenger_username.ilike.${t},challenged_username.ilike.${t})&status=not.in.(${r})&order=created_at.desc&limit=1`
  );
  if (!s || s.length === 0) return null;
  const i = s[0], a = Date.now(), o = i.start_at || i.match_starts_at;
  i.status === E.COUNTDOWN && o && new Date(o).getTime() <= a && (i.status = E.IN_PROGRESS, b(`battles?id=eq.${i.id}&status=eq.countdown`, {
    method: "PATCH",
    body: JSON.stringify({ status: E.IN_PROGRESS })
  }).catch(() => {
  }));
  const c = i.end_at || i.match_deadline;
  return i.status === E.IN_PROGRESS && c && new Date(c).getTime() <= a && Ke(i.id).catch(() => {
  }), i;
}
async function C(e) {
  if (!e) return null;
  const r = await b(`battles?id=eq.${e}&select=*`);
  return r && r.length > 0 ? r[0] : null;
}
async function re(e) {
  return e ? await b(`battle_results?battle_id=eq.${e}&select=*`) || [] : [];
}
async function jt(e, r, t) {
  return t ? await Je(e) : (await se(e, E.DECLINED), { success: !0 });
}
async function Jt(e, r, t, s) {
  const i = await C(e);
  if (!i) return { success: !1, error: "Battle not found" };
  const a = await Xe(t);
  if (!a.valid)
    return { success: !1, error: a.error || "Invalid LeetCode problem" };
  const c = (i.challenger_username || i.challenger).toLowerCase() === r.toLowerCase(), n = c ? "challenger_pick" : "challenged_pick", l = c ? "challenger_pick_title" : "challenged_pick_title", u = c ? i.challenged_pick : i.challenger_pick, d = c ? i.challenged_pick_title : i.challenger_pick_title, m = {
    [n]: a.slug,
    [l]: a.title || s || a.slug
  };
  u && Object.assign(m, {
    problem_1: a.slug,
    problem_1_title: a.title,
    problem_2: u,
    problem_2_title: d || u,
    status: E.READY_CHECK,
    challenger_ready: !1,
    challenged_ready: !1
  });
  const S = await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify(m)
  });
  return !S || S.length === 0 ? { success: !1, error: "Failed to save problem selection" } : {
    success: !0,
    battle: S[0],
    bothPicked: !!u
  };
}
async function Ve(e, r) {
  const t = await w("confirm_battle_ready", { p_battle_id: e });
  if (t && t.success)
    return { success: !0, battle: await C(e), bothReady: t.status === E.COUNTDOWN };
  const s = await C(e);
  if (!s) return { success: !1, error: "Battle not found" };
  const a = (s.challenger_username || s.challenger).toLowerCase() === r.toLowerCase(), o = a ? { challenger_ready: !0 } : { challenged_ready: !0 }, c = a ? s.challenged_ready : s.challenger_ready;
  if (c) {
    const l = Date.now(), u = (s.duration_minutes || 30) * 60, d = new Date(l).toISOString(), m = new Date(l + Ce * 1e3).toISOString(), S = new Date(l + (Ce + u) * 1e3).toISOString();
    Object.assign(o, {
      status: E.COUNTDOWN,
      countdown_starts: d,
      match_starts_at: m,
      match_deadline: S,
      start_at: m,
      end_at: S
    });
  }
  const n = await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify(o)
  });
  return !n || n.length === 0 ? { success: !1, error: "Failed to record readiness" } : { success: !0, battle: n[0], bothReady: !!c };
}
async function Qe(e, r, t) {
  const {
    problemSlug: s,
    submissionId: i,
    accepted: a,
    runtime_ms: o,
    memory_mb: c,
    language: n,
    timeTakenSeconds: l
  } = t, u = await C(e);
  if (!u) return { success: !1, error: "Battle not found" };
  if (he.has(u.status))
    return { success: !1, error: `Battle is already closed (${u.status})` };
  const d = u.start_at || u.match_starts_at ? new Date(u.start_at || u.match_starts_at).getTime() : Date.now(), m = l ?? Math.max(0, Math.floor((Date.now() - d) / 1e3)), S = await b("battle_results", {
    method: "POST",
    body: JSON.stringify({
      battle_id: e,
      username: r,
      problem_slug: s,
      leetcode_submission_id: i || `sub_${Date.now()}`,
      accepted: !!a,
      submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
      time_taken_seconds: m,
      runtime_ms: o || null,
      memory_mb: c || null,
      language: n || u.language || "javascript",
      attempts: 1,
      points: a ? 1 : 0
    })
  });
  return await Ke(e), { success: !0, result: S?.[0] };
}
async function Ke(e) {
  const r = await w("evaluate_and_finalize_battle", { p_battle_id: e });
  if (r && r.finalized)
    return r;
  const t = await C(e);
  if (!t || he.has(t.status)) return null;
  const s = await re(e), i = t.challenger_username, a = t.challenged_username;
  let o = 0, c = 0, n = 0, l = 0;
  for (const y of s)
    y.accepted && (y.username.toLowerCase() === i.toLowerCase() ? (o += y.points || 1, n += y.time_taken_seconds || 0) : y.username.toLowerCase() === a.toLowerCase() && (c += y.points || 1, l += y.time_taken_seconds || 0));
  const u = t.end_at || t.match_deadline, d = u && Date.now() >= new Date(u).getTime(), m = t.problem_count || 2;
  if (o >= m && c >= m || d) {
    let y = "draw", g = "draw";
    return o > c ? (y = i, g = "points") : c > o ? (y = a, g = "points") : o > 0 ? n < l ? (y = i, g = "tiebreaker_time") : l < n ? (y = a, g = "tiebreaker_time") : (y = "draw", g = "draw") : (y = "draw", g = "draw"), await se(e, E.COMPLETED, {
      winner_username: y,
      win_reason: g,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    }), { finalized: !0, winner: y, winReason: g };
  }
  return null;
}
async function Ze(e, r) {
  const t = await w("forfeit_battle", { p_battle_id: e });
  if (t && t.success)
    return t;
  const s = await C(e);
  if (!s) return { success: !1, error: "Battle not found" };
  const i = s.challenger_username, a = s.challenged_username, o = i.toLowerCase() === r.toLowerCase() ? a : i;
  return await se(e, E.FORFEITED, {
    winner_username: o,
    win_reason: "forfeit",
    completed_at: (/* @__PURE__ */ new Date()).toISOString()
  }), { success: !0, winner: o };
}
async function zt(e, r) {
  const t = await C(e);
  return t ? t.challenger_username.toLowerCase() !== r.toLowerCase() ? { success: !1, error: "Only the challenger can cancel a pending match" } : t.status !== E.PENDING ? { success: !1, error: "Can only cancel pending challenges" } : (await se(e, E.CANCELLED), { success: !0 }) : { success: !1, error: "Battle not found" };
}
async function Vt(e, r = 10) {
  if (!e) return [];
  const t = e.toLowerCase(), s = await b(
    `battles?or=(challenger_username.ilike.${t},challenged_username.ilike.${t})&status=in.(completed,forfeited)&order=created_at.desc&limit=${r}`
  );
  return !s || s.length === 0 ? [] : await Promise.all(s.map(async (a) => {
    const o = await re(a.id), c = a.challenger_username, n = a.challenged_username, l = c.toLowerCase() === e.toLowerCase() ? n : c, u = a.winner_username;
    let d = "draw";
    return u && (u === "draw" ? d = "draw" : u.toLowerCase() === e.toLowerCase() ? d = "win" : d = "loss"), {
      ...a,
      opponent: l,
      outcome: d,
      results: o
    };
  }));
}
async function Xe(e) {
  try {
    let r = e.trim();
    if (r.includes("leetcode.com/problems/")) {
      const a = r.match(/problems\/([^/?#]+)/);
      if (!a) return { valid: !1, error: "Invalid LeetCode URL structure" };
      r = a[1].replace(/\/$/, "");
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
    const i = (await t.json())?.data?.question;
    return i ? i.isPaidOnly ? { valid: !1, error: "Premium problem — please select a free problem" } : {
      valid: !0,
      slug: r.toLowerCase(),
      title: i.title,
      difficulty: i.difficulty,
      url: `https://leetcode.com/problems/${r.toLowerCase()}/`
    } : { valid: !1, error: "Problem not found on LeetCode" };
  } catch (r) {
    return console.warn("[Battle] validateLeetCodeProblem error:", r), { valid: !1, error: "Connection error while validating problem" };
  }
}
async function X(e, r = "online") {
  if (!(!e || !h || h === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      let t = await w("heartbeat_presence", {
        p_status: r,
        p_username: e.toLowerCase()
      });
      if (t && t.success) return;
      if (t?.code === "PGRST202" || typeof t?.error == "string" && t.error.includes("PGRST202")) {
        const i = await w("heartbeat_presence", { p_status: r });
        if (i && (i.success || i === !0)) return;
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
async function Qt(e) {
  const r = /* @__PURE__ */ new Map();
  if (!e?.length || !h || h === "YOUR_SUPABASE_PROJECT_URL_HERE") return r;
  try {
    const t = await w("get_friends_presence", { p_usernames: e });
    if (t && typeof t == "object" && !t.error) {
      for (const [o, c] of Object.entries(t))
        r.set(o.toLowerCase(), {
          status: c.status || "offline",
          isOnline: !!c.isOnline,
          inBattle: !!c.inBattle,
          last_seen: c.last_seen
        });
      return r;
    }
    const s = e.map((o) => `"${o.toLowerCase()}"`).join(","), i = await b(`user_presence?username=in.(${s})&select=username,status,last_seen,in_battle`), a = Date.now() - 120 * 1e3;
    for (const o of i || []) {
      const n = o.last_seen && new Date(o.last_seen).getTime() > a ? o.in_battle ? "in_battle" : o.status || "online" : "offline";
      r.set(o.username.toLowerCase(), {
        status: n,
        isOnline: n === "online" || n === "in_battle",
        inBattle: n === "in_battle",
        last_seen: o.last_seen
      });
    }
  } catch (t) {
    console.warn("[BattleManager] getPresence failed:", t);
  }
  return r;
}
async function se(e, r, t = {}) {
  await b(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify({ status: r, ...t })
  });
}
function Kt(e) {
  const r = gt(e);
  if (!r.valid)
    throw new Error(r.error);
  return r.username;
}
function N(e, r) {
  const t = typeof e == "string" ? parseInt(e, 10) : e;
  if (isNaN(t) || t <= 0) return "";
  const s = r || (typeof Intl < "u" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC") || "UTC";
  try {
    const i = new Date(t * 1e3);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: s,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(i);
  } catch {
    return new Date(t * 1e3).toISOString().split("T")[0];
  }
}
function et(e = [], r = null, t = null) {
  const s = /* @__PURE__ */ new Set();
  if (Array.isArray(e)) {
    for (const i of e)
      if (i && i.timestamp) {
        const a = N(i.timestamp, t);
        a && s.add(a);
      }
  }
  if (r)
    try {
      const i = typeof r == "string" ? JSON.parse(r) : r;
      if (i && typeof i == "object") {
        for (const [a, o] of Object.entries(i))
          if (parseInt(o, 10) > 0) {
            const c = N(a, t);
            c && s.add(c);
          }
      }
    } catch (i) {
      console.warn("[StreakCalculator] Error parsing submissionCalendar:", i);
    }
  return Array.from(s).sort();
}
function Zt(e, r = null, t = null) {
  let s = [], i = null;
  Array.isArray(e) ? (s = e, i = r) : e && typeof e == "object" && (i = e, typeof r == "string" && (t = r));
  const a = et(s, i, t);
  if (a.length === 0)
    return {
      currentStreak: 0,
      longestStreak: 0,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: []
    };
  function o(k, M) {
    const p = /* @__PURE__ */ new Date(k + "T00:00:00Z"), be = /* @__PURE__ */ new Date(M + "T00:00:00Z");
    return Math.round((be - p) / 864e5);
  }
  let c = 1, n = 1;
  for (let k = 1; k < a.length; k++) {
    const M = o(a[k - 1], a[k]);
    M === 1 ? (n++, n > c && (c = n)) : M > 1 && (n = 1);
  }
  const l = Math.floor(Date.now() / 1e3), u = N(l, t), d = Math.floor((Date.now() - 864e5) / 1e3), m = N(d, t), S = a.includes(u), y = a[a.length - 1];
  if (y !== u && y !== m)
    return {
      currentStreak: 0,
      longestStreak: c,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: a
    };
  let g = 0, U = /* @__PURE__ */ new Date(y + "T00:00:00Z");
  for (let k = a.length - 1; k >= 0; k--) {
    const M = U.toISOString().split("T")[0];
    if (a[k] === M)
      g++, U.setUTCDate(U.getUTCDate() - 1);
    else if (a[k] < M)
      break;
  }
  g > c && (c = g);
  const B = g > 0 && !S;
  return {
    currentStreak: g,
    longestStreak: c,
    isAtRisk: B,
    solvedToday: S,
    solveDates: a
  };
}
function tt(e, r = null, t = null) {
  const s = et(e, r, t), i = Math.floor(Date.now() / 1e3), a = N(i, t);
  return s.includes(a);
}
function Xt(e) {
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
function le(e) {
  return e ? Date.now() - e > 900 * 1e3 : !0;
}
const j = "leetfriends_notifications", ve = {
  QUEUED: "QUEUED",
  DISPLAY_REQUESTED: "DISPLAY_REQUESTED",
  FAILED: "FAILED",
  IN_APP_ONLY: "IN_APP_ONLY",
  DISMISSED: "DISMISSED",
  CLICKED: "CLICKED"
};
async function rt() {
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
async function st() {
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
      const s = (/* @__PURE__ */ new Date()).getHours() * 60 + (/* @__PURE__ */ new Date()).getMinutes(), [i, a] = (r.quietHours.start || "22:00").split(":").map(Number), [o, c] = (r.quietHours.end || "08:00").split(":").map(Number), n = i * 60 + a, l = o * 60 + c;
      if (n > l) {
        if (s >= n || s < l)
          return !0;
      } else if (s >= n && s < l)
        return !0;
    }
    return !1;
  } catch (e) {
    return console.warn("[NotificationManager] isNotificationMuted error:", e), !1;
  }
}
async function er(e) {
  const r = await rt();
  r.mutedUntilUTC = e, await chrome.storage.local.set({ [j]: r });
}
async function it(e) {
  if (!(!Array.isArray(e) || e.length === 0))
    try {
      const r = await st(), t = Date.now(), i = (await chrome.storage.local.get("unread_notifications")).unread_notifications || [], a = e.map((n, l) => ({
        ...n,
        id: `${t}-${l}`,
        timestamp: t,
        deliveryState: r ? ve.IN_APP_ONLY : ve.DISPLAY_REQUESTED
      })), o = t - 1440 * 60 * 1e3, c = [...i, ...a].filter((n) => n.timestamp > o).slice(-30);
      if (await chrome.storage.local.set({ unread_notifications: c }), r) {
        console.log("[NotificationManager] Notifications muted; recorded for in-app display only.");
        return;
      }
      for (const n of e)
        try {
          let l = "LeetStreak";
          n.type === "new_submission" ? l = "🎯 Friend Solved a Problem!" : n.type === "milestone" ? l = "🔥 Streak Milestone Reached!" : n.type === "streak_at_risk" ? l = "⚠️ Streak At Risk!" : n.type === "battle_invite" ? l = "⚔️ 1v1 Battle Challenge!" : n.type === "battle_opponent_solved" ? l = "⚔️ Opponent Solved a Problem!" : n.type === "roast" && (l = "🔥 Motivation Roast Received!");
          const u = `leetstreak-${n.type}-${t}-${Math.floor(Math.random() * 1e3)}`;
          await chrome.notifications.create(u, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon128.png"),
            title: l,
            message: n.message || "",
            priority: n.priority || 2,
            requireInteraction: n.type === "streak_at_risk" || n.type === "battle_invite"
          });
        } catch (l) {
          console.warn("[NotificationManager] chrome.notifications.create failed:", l);
        }
    } catch (r) {
      console.error("[NotificationManager] Error in batchNotify:", r);
    }
}
const tr = () => (/* @__PURE__ */ new Date()).toISOString().split("T")[0], rr = () => {
  const e = /* @__PURE__ */ new Date();
  return e.setUTCDate(e.getUTCDate() - 1), e.toISOString().split("T")[0];
};
function sr(e) {
  return [7, 30, 100].includes(e);
}
function ir(e, r) {
  if (r === 0) return !1;
  const t = rr(), s = tr();
  return !(Array.isArray(e) ? e : []).some((o) => {
    const c = parseInt(o.timestamp, 10);
    if (isNaN(c) || c <= 0) return !1;
    const n = new Date(c * 1e3).toISOString().split("T")[0];
    return n === s || n === t;
  });
}
function ar(e, r, t) {
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
const Re = 1.7, Le = 30, Pe = 19, De = 4, Ie = "schedule_preferences";
async function ie() {
  try {
    return (await chrome.storage.local.get(Ie))[Ie] || {
      activeInterval: Re,
      quietInterval: Le,
      activeStartHour: Pe,
      activeEndHour: De
    };
  } catch (e) {
    return console.error("Error loading schedule preferences:", e), {
      activeInterval: Re,
      quietInterval: Le,
      activeStartHour: Pe,
      activeEndHour: De
    };
  }
}
async function pe(e = null) {
  e || (e = await ie());
  const t = (/* @__PURE__ */ new Date()).getHours(), { activeStartHour: s, activeEndHour: i } = e;
  return s > i ? t >= s || t < i : t >= s && t < i;
}
async function _e() {
  const e = await ie();
  return await pe(e) ? e.activeInterval : e.quietInterval;
}
async function or() {
  const e = await ie(), r = /* @__PURE__ */ new Date(), t = r.getHours(), s = r.getMinutes();
  let i;
  await pe(e) ? i = e.activeEndHour : i = e.activeStartHour;
  let a = i - t;
  return a < 0 && (a += 24), a === 0 && s > 0 && (a = 24), a * 60 - s;
}
async function we() {
  const e = await ie(), r = await _e(), t = await pe(e), s = Ne(e.activeStartHour), i = Ne(e.activeEndHour);
  return t ? `Active Mode: Checking every ${r} minutes (${s} - ${i})` : `Quiet Mode: Checking every ${r} minutes`;
}
async function nr() {
  const e = await _e(), r = await or(), t = Math.min(e, r);
  return {
    intervalMinutes: t,
    description: await we(),
    isTransitionCheck: t === r && t < e
  };
}
function Ne(e) {
  return e === 0 ? "12:00 AM" : e < 12 ? `${e}:00 AM` : e === 12 ? "12:00 PM" : `${e - 12}:00 PM`;
}
const at = [
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
], ot = [
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
], nt = [
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
function H(e) {
  return e ? e.toLowerCase().replace(/^(www\.|m\.)/, "") : "";
}
function I(e, r = {}) {
  const { customBlocked: t = [], allowlist: s = [] } = r;
  if (!e || typeof e != "string")
    return { isDistraction: !1, reason: "INVALID_URL", label: "" };
  if (e.includes("blocked.html") || e.startsWith("chrome-extension:") || e.startsWith("chrome:"))
    return { isDistraction: !1, reason: "SYSTEM_INTERNAL_PAGE", label: "" };
  let i;
  try {
    i = new URL(e);
  } catch {
    return { isDistraction: !1, reason: "PARSE_ERROR", label: "" };
  }
  if (i.protocol !== "http:" && i.protocol !== "https:")
    return { isDistraction: !1, reason: "NON_HTTP_PROTOCOL", label: "" };
  const a = i.hostname.toLowerCase(), o = H(a);
  if (o.includes("leetcode.com"))
    return { isDistraction: !1, reason: "SYSTEM_ALLOW_LEETCODE", label: "LeetCode" };
  for (const c of s) {
    if (!c) continue;
    const n = c.trim().toLowerCase();
    if (e.toLowerCase().includes(n) || o === H(n))
      return { isDistraction: !1, reason: "USER_ALLOWLIST", label: c };
  }
  for (const c of nt)
    if (o === H(c.domain)) {
      for (const n of c.allowedPrefixes)
        if (i.pathname.startsWith(n))
          return { isDistraction: !1, reason: "EDUCATIONAL_EXCEPTION", label: `${c.domain}${n}` };
    }
  for (const c of ot)
    if (o === H(c.domain)) {
      for (const n of c.paths)
        if (i.pathname.startsWith(n))
          return { isDistraction: !0, reason: "PATH_DISTRACTION", label: c.label };
    }
  for (const c of t) {
    if (!c) continue;
    const n = H(c.trim().toLowerCase());
    if (o === n || o.endsWith("." + n))
      return { isDistraction: !0, reason: "CUSTOM_BLOCKED_DOMAIN", label: n };
  }
  for (const c of at) {
    const n = H(c);
    if (o === n || o.endsWith("." + n))
      return { isDistraction: !0, reason: "DEFAULT_BLOCKED_DOMAIN", label: n };
  }
  return { isDistraction: !1, reason: "UNRESTRICTED", label: "" };
}
function cr(e = {}) {
  const { customBlocked: r = [], allowlist: t = [] } = e, s = [];
  let i = 1e3;
  s.push({
    id: i++,
    priority: 10,
    action: { type: "allow" },
    condition: {
      requestDomains: ["leetcode.com"],
      resourceTypes: ["main_frame"]
    }
  });
  for (const o of t) {
    if (!o || !o.trim()) continue;
    const c = o.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    s.push({
      id: i++,
      priority: 5,
      action: { type: "allow" },
      condition: {
        requestDomains: [c],
        resourceTypes: ["main_frame"]
      }
    });
  }
  for (const o of nt)
    for (const c of o.allowedPrefixes)
      s.push({
        id: i++,
        priority: 3,
        action: { type: "allow" },
        condition: {
          requestDomains: [o.domain],
          urlFilter: `*${c}*`,
          resourceTypes: ["main_frame"]
        }
      });
  for (const o of ot)
    for (const c of o.paths)
      s.push({
        id: i++,
        priority: 2,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html" }
        },
        condition: {
          requestDomains: [o.domain],
          urlFilter: `*${c}*`,
          resourceTypes: ["main_frame"]
        }
      });
  const a = Array.from(/* @__PURE__ */ new Set([...at, ...r]));
  for (const o of a) {
    if (!o || !o.trim()) continue;
    const c = H(o.trim());
    s.push({
      id: i++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: "/blocked.html" }
      },
      condition: {
        requestDomains: [c],
        resourceTypes: ["main_frame"]
      }
    });
  }
  return s;
}
async function R() {
  if (typeof chrome > "u" || !chrome.storage || !chrome.storage.local)
    return { active: !1, reason: "CHROME_STORAGE_UNAVAILABLE", todayStr: "", streak: 0 };
  try {
    const e = await chrome.storage.local.get([
      "hardcore_mode_enabled",
      "my_leetcode_username",
      "last_solve_date",
      "user_timezone",
      "own_profile"
    ]), r = e.user_timezone, t = Math.floor(Date.now() / 1e3), s = N(t, r);
    if (!e.hardcore_mode_enabled)
      return { active: !1, reason: "HARDCORE_DISABLED", todayStr: s, streak: 0 };
    const i = e.my_leetcode_username;
    let a = e.own_profile;
    if (!a && i)
      try {
        const o = await chrome.storage.local.get(["friends_cache"]);
        if (o.friends_cache) {
          const c = Object.keys(o.friends_cache).find((n) => n.toLowerCase() === i.toLowerCase());
          c && (a = o.friends_cache[c]);
        }
        a || (a = await ge(i));
      } catch (o) {
        console.warn("[BlockerManager] Error fetching cached friend data:", o);
      }
    if (a) {
      const o = a.stats?.streak || 0;
      return tt(a.allAcceptedSubmissions, a.submissionCalendar, r) ? (await chrome.storage.local.set({ last_solve_date: s }), { active: !1, reason: "SOLVED_TODAY_CANONICAL", todayStr: s, streak: o }) : (e.last_solve_date === s && await chrome.storage.local.remove("last_solve_date"), { active: !0, reason: "UNSOLVED_TODAY", todayStr: s, streak: o });
    }
    return e.last_solve_date === s ? { active: !1, reason: "SOLVED_TODAY_CACHE", todayStr: s, streak: 0 } : { active: !0, reason: "NO_PROFILE_UNSOLVED", todayStr: s, streak: 0 };
  } catch (e) {
    return console.error("[BlockerManager] isBlockerActive check error:", e), { active: !1, reason: `ERROR: ${e.message}`, todayStr: "", streak: 0 };
  }
}
async function O() {
  if (typeof chrome > "u" || !chrome.declarativeNetRequest)
    return console.warn("[BlockerManager] chrome.declarativeNetRequest API not available"), { success: !1, locked: !1, ruleCount: 0, reason: "DNR_NOT_AVAILABLE" };
  try {
    const e = await R(), t = (await chrome.declarativeNetRequest.getDynamicRules()).map((a) => a.id);
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
    const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), i = cr({
      customBlocked: s.custom_blocked_domains || [],
      allowlist: s.allowlist || []
    });
    return await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: t,
      addRules: i
    }), await chrome.storage.local.set({
      hardcore_blocker_state: {
        locked: !0,
        ruleCount: i.length,
        reason: e.reason,
        todayStr: e.todayStr,
        streak: e.streak,
        lastSynced: Date.now()
      }
    }), await lr(), { success: !0, locked: !0, ruleCount: i.length, reason: e.reason };
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
function $(e, r, t = "") {
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
async function lr() {
  if (typeof chrome > "u" || !chrome.tabs || !chrome.tabs.query)
    return { sweptCount: 0, redirectedTabs: [] };
  try {
    if (!(await R()).active)
      return { sweptCount: 0, redirectedTabs: [] };
    const r = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), t = r.custom_blocked_domains || [], s = r.allowlist || [], i = await chrome.tabs.query({}), a = [];
    for (const o of i) {
      if (!o.id || !o.url || o.url.includes("blocked.html") || o.url.startsWith("chrome") || o.url.startsWith("about:") || o.url.startsWith("edge:") || o.url.includes("leetcode.com"))
        continue;
      const c = I(o.url, { customBlocked: t, allowlist: s });
      c.isDistraction && (console.log(`[BlockerManager] Sweeping open distracting tab #${o.id}: ${o.url} (${c.label || c.reason})`), $(o.id, o.url, c.label), a.push({ id: o.id, url: o.url }));
    }
    return { sweptCount: a.length, redirectedTabs: a };
  } catch (e) {
    return console.warn("[BlockerManager] sweepOpenTabs error:", e), { sweptCount: 0, redirectedTabs: [], error: e.message };
  }
}
function ur() {
  Oe || typeof chrome > "u" || (Oe = !0, O().catch((e) => console.error("[BlockerManager] Startup sync failed:", e)), chrome.webNavigation && chrome.webNavigation.onBeforeNavigate && chrome.webNavigation.onBeforeNavigate.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await R()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = I(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && (chrome.storage.session && await chrome.storage.session.set({
          [`blocked_tab_${e.tabId}`]: {
            url: e.url,
            label: s.label,
            timestamp: Date.now()
          }
        }), $(e.tabId, e.url, s.label));
      } catch (r) {
        console.warn("[BlockerManager] onBeforeNavigate error:", r);
      }
  }), chrome.webNavigation && chrome.webNavigation.onCommitted && chrome.webNavigation.onCommitted.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await R()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = I(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && $(e.tabId, e.url, s.label);
      } catch {
      }
  }), chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated && chrome.webNavigation.onHistoryStateUpdated.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await R()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = I(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && (chrome.storage.session && await chrome.storage.session.set({
          [`blocked_tab_${e.tabId}`]: {
            url: e.url,
            label: s.label,
            timestamp: Date.now()
          }
        }), $(e.tabId, e.url, s.label));
      } catch (r) {
        console.warn("[BlockerManager] onHistoryStateUpdated error:", r);
      }
  }), chrome.tabs && chrome.tabs.onUpdated && chrome.tabs.onUpdated.addListener(async (e, r, t) => {
    const s = r.url || t?.url;
    if (!(!s || s.includes("blocked.html") || s.startsWith("chrome") || s.startsWith("about:") || s.includes("leetcode.com")))
      try {
        if (!(await R()).active) return;
        const a = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), o = I(s, {
          customBlocked: a.custom_blocked_domains || [],
          allowlist: a.allowlist || []
        });
        o.isDistraction && $(e, s, o.label);
      } catch {
      }
  }), chrome.tabs && chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(async (e) => {
    try {
      if (!(await R()).active) return;
      const t = await chrome.tabs.get(e.tabId);
      if (!t || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
      const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), i = I(t.url, {
        customBlocked: s.custom_blocked_domains || [],
        allowlist: s.allowlist || []
      });
      i.isDistraction && (console.log(`[BlockerManager] onActivated blocking active tab #${e.tabId} (${t.url})`), $(e.tabId, t.url, i.label));
    } catch {
    }
  }), chrome.windows && chrome.windows.onFocusChanged && chrome.windows.onFocusChanged.addListener(async (e) => {
    if (!(typeof chrome.windows.WINDOW_ID_NONE < "u" && e === chrome.windows.WINDOW_ID_NONE))
      try {
        if (!(await R()).active) return;
        const [t] = await chrome.tabs.query({ active: !0, windowId: e });
        if (!t || !t.id || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
        const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), i = I(t.url, {
          customBlocked: s.custom_blocked_domains || [],
          allowlist: s.allowlist || []
        });
        i.isDistraction && (console.log(`[BlockerManager] onFocusChanged blocking window tab #${t.id} (${t.url})`), $(t.id, t.url, i.label));
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
    ].some((i) => e[i]) && O().catch((i) => {
      console.error("[BlockerManager] Storage change sync error:", i);
    });
  }), console.log("🛡️ [BlockerManager] Multi-layer network blocker initialized"));
}
function dr() {
  if (ur(), typeof chrome > "u" || !chrome.tabs) {
    console.warn("[TabMonitor] chrome.tabs API not available");
    return;
  }
  chrome.tabs.onUpdated.addListener(async (e, r, t) => {
    if (r.status === "complete" && t?.url)
      try {
        if (!(await R()).active) return;
        const i = I(t.url);
        if (i.isDistraction && !t.url.includes("blocked.html")) {
          const a = chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(t.url)}&label=${encodeURIComponent(i.label)}`);
          chrome.tabs.update(e, { url: a });
        }
      } catch {
      }
  }), console.log("✅ [TabMonitor] Hardcore Mode Tab Monitor and Blocker initialized");
}
const ue = "leetfriends_sync", fr = "schedule_transition_check", J = "presence_heartbeat_alarm", ct = 500;
self.addEventListener("error", (e) => {
  console.error("[ServiceWorker] Uncaught error:", e.error);
});
self.addEventListener("unhandledrejection", (e) => {
  console.error("[ServiceWorker] Uncaught promise rejection:", e.reason);
});
dr();
Mt().catch((e) => {
  console.warn("[ServiceWorker] Session restoration (non-blocking):", e.message);
});
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[ServiceWorker] Installed - setting up sync alarm and cleaning legacy keys"), Se(), mr(), await O();
  try {
    await chrome.alarms.clear(J), chrome.alarms.create(J, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    });
  } catch {
  }
});
chrome.runtime.onStartup.addListener(async () => {
  console.log("[ServiceWorker] Browser startup - reconciling blocker rules & presence"), await O();
  try {
    await chrome.alarms.clear(J), chrome.alarms.create(J, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    }), await ft();
  } catch {
  }
});
async function mr() {
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
async function Se() {
  const e = nr(), r = e?.intervalMinutes || 30;
  try {
    await chrome.alarms.clear(ue), await chrome.alarms.clear(fr), chrome.alarms.create(ue, {
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
async function gr() {
  try {
    const r = (await chrome.storage.local.get("current_schedule")).current_schedule, t = _e();
    (!r || Math.abs(r.interval - t) > 0.1) && (console.log(`[ServiceWorker] Transitioning schedule: ${we()}`), await Se());
  } catch (e) {
    console.warn("[ServiceWorker] checkScheduleTransition error:", e);
  }
}
chrome.alarms.onAlarm.addListener(async (e) => {
  e.name === ue ? (console.log(`[ServiceWorker] Background sync triggered - ${we()}`), await gr(), await lt(), await O()) : e.name === J && await ft();
});
chrome.runtime.onMessage.addListener((e, r, t) => {
  if (e.type === "PING") {
    t({ pong: !0 });
    return;
  }
  switch (e.type) {
    case "FETCH_STATS":
      return yr(e.forceRefresh).then(t), !0;
    case "ADD_FRIEND":
      return pr(e.username).then(t), !0;
    case "REMOVE_FRIEND":
      return _r(e.username).then(t), !0;
    case "GET_FRIENDS":
      return wr().then(t), !0;
    case "MUTE_NOTIFICATIONS":
      return er(e.untilUTC).then(() => t({ success: !0 })), !0;
    case "GET_NOTIFICATION_STATE":
      return rt().then((s) => t({ success: !0, state: s })), !0;
    case "ADD_TO_QUEUE":
      return Sr(e.problemData).then(t), !0;
    case "SUBMISSION_ACCEPTED":
      return br(e.problemSlug, e.title).then(t), !0;
    case "SYNC_BLOCKER_RULES":
      return O().then(t), !0;
    case "GET_BLOCKER_STATUS":
      return R().then(t), !0;
    case "SHOW_NOTIFICATION":
      return it([{
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
      return Se().then(() => t({ success: !0 })), !0;
    // ===== 1v1 Battle System =====
    case "BATTLE_GET_STATUS":
      return Ar(e.username).then(t), !0;
    case "BATTLE_CHALLENGE_V2":
      return kr(e).then(t), !0;
    case "BATTLE_ACCEPT_V2":
    case "BATTLE_ACCEPT":
      return ut(e.battleId).then(t), !0;
    case "BATTLE_READY_V2":
      return dt(e.battleId, e.username).then(t), !0;
    case "BATTLE_SOLVED_V2":
      return Mr(e).then(t), !0;
    case "BATTLE_GET_STATE_V2":
      return Cr(e.battleId).then(t), !0;
    case "BATTLE_FORFEIT_V2":
      return vr(e.battleId, e.username).then(t), !0;
    case "BATTLE_CHALLENGE":
      return Lr(e.challenger, e.challenged, e.language).then(t), !0;
    case "BATTLE_RESPOND":
      return Pr(e.battleId, e.username, e.accept).then(t), !0;
    case "BATTLE_PICK_PROBLEM":
      return Dr(e.battleId, e.username, e.slug, e.title).then(t), !0;
    case "BATTLE_READY":
      return Ir(e.battleId, e.username).then(t), !0;
    case "BATTLE_SUBMISSION":
      return Nr(e).then(t), !0;
    case "BATTLE_FORFEIT":
      return Or(e.battleId, e.username).then(t), !0;
    case "BATTLE_CANCEL":
      return Ur(e.battleId, e.username).then(t), !0;
    case "BATTLE_VALIDATE_PROBLEM":
      return Xe(e.slugOrUrl).then(t), !0;
    case "BATTLE_PING_PRESENCE":
      return Br(e.username).then(t), !0;
    case "BATTLE_GET_PRESENCE":
      return Hr(e.usernames).then(t), !0;
    case "BATTLE_GET_ONLINE_FRIENDS":
      return Dt().then((s) => t({ success: !0, friends: s })).catch((s) => t({ success: !1, error: s.message, friends: [] })), !0;
    case "SYNC_FRIENDSHIPS":
      return (async () => {
        if (!Array.isArray(e.usernames))
          return t({ success: !0, count: 0 });
        const s = await Promise.all(
          e.usernames.map((i) => me(i).catch(() => ({ success: !1 })))
        );
        t({ success: !0, count: s.filter((i) => i?.success).length });
      })().catch((s) => t({ success: !1, error: s.message })), !0;
    case "GET_LOGGED_IN_USER":
      return Er().then(t), !0;
    case "FETCH_OWN_PROFILE":
      return hr(e.forceRefresh).then(t), !0;
    // ===== Cloud Authentication & Account =====
    case "GET_AUTH_STATE":
      return (async () => {
        const s = await A();
        t({
          success: !0,
          state: D(),
          session: s ? { user_id: s.user_id, email: s.email, expires_at: s.expires_at } : null,
          isRateLimited: x(),
          cooldownSeconds: de()
        });
      })().catch((s) => t({ success: !1, error: s.message })), !0;
    case "SIGN_IN_EMAIL":
      return vt(e.email, e.password).then(async (s) => {
        try {
          await ce(), e.username && await chrome.storage.local.set({ my_leetcode_username: e.username });
          const i = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), a = e.username || i.my_leetcode_username;
          a && (await P(a, i.own_profile || { profile: { realName: a } }), await X(a, "online"));
        } catch (i) {
          console.warn("[ServiceWorker] Social account restore error:", i);
        }
        t({ success: !0, session: { user_id: s.user_id, email: s.email } });
      }).catch((s) => t({ success: !1, error: s.message, isRateLimited: x() })), !0;
    case "RESTORE_ACCOUNT_DATA":
      return ce().then((s) => t(s)).catch((s) => t({ success: !1, error: s.message })), !0;
    case "SIGN_UP_EMAIL":
      return Rt(e.email, e.password).then(async (s) => {
        if (e.username && await chrome.storage.local.set({ my_leetcode_username: e.username }), s?.session && s.session.user_id)
          try {
            const i = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), a = e.username || i.my_leetcode_username;
            a && (await P(a, i.own_profile || { profile: { realName: a } }), await X(a, "online"));
          } catch (i) {
            console.warn("[ServiceWorker] Sign up profile sync error:", i);
          }
        t(s);
      }).catch((s) => t({ success: !1, error: s.message, isRateLimited: x() })), !0;
    case "SIGN_OUT":
      return Lt().then(async (s) => {
        try {
          await Pt();
        } catch {
        }
        t(s);
      }).catch((s) => t({ success: !1, error: s.message })), !0;
    // ===== Roasts =====
    case "SEND_ROAST":
      return $r(e.targetUsername, e.fromUsername, e.message).then(t), !0;
    case "CLEAR_ROASTS":
      return (async () => {
        const s = await chrome.storage.local.get("my_leetcode_username");
        return s.my_leetcode_username && await Ge(s.my_leetcode_username), { success: await Ye() };
      })().then(t), !0;
    default:
      t({ success: !1, error: `Unknown message type: ${e.type}` });
  }
});
chrome.notifications.onClicked.addListener((e) => {
  (e.includes("streak") || e.includes("roast") || e.includes("solve")) && (chrome.tabs.create({ url: "https://leetcode.com/problemset/" }), chrome.notifications.clear(e));
});
async function yr(e = !1) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured. Please enter your username." };
    let s = await Y(), i = !1;
    if (e || !s || le(s.lastUpdated)) {
      console.log(`[ServiceWorker] Fetching own LeetCode data for: ${t}`);
      try {
        const u = await G(t);
        s = await z(u, r.user_timezone), await te(s), i = !0;
      } catch (u) {
        if (console.error(`[ServiceWorker] Error fetching own LeetCode profile for ${t}:`, u), !s)
          return {
            success: !1,
            error: `Failed to fetch LeetCode data for ${t}: ${u.message}`,
            isLeetCodeError: !0
          };
      }
    }
    let o = await K();
    const c = await We();
    let n = e;
    if (!n && c.length > 0) {
      for (const u of c)
        if (!o[u] || le(o[u]?.lastUpdated)) {
          n = !0;
          break;
        }
    }
    if (n && c.length > 0) {
      console.log("[ServiceWorker] Syncing friends data...");
      for (const u of c)
        if (u.toLowerCase() !== t.toLowerCase())
          try {
            const d = await G(u), m = await z(d, r.user_timezone);
            await ye(u, m), await mt(ct);
          } catch (d) {
            console.warn(`[ServiceWorker] Error updating friend ${u}:`, d.message);
          }
      o = await K();
    }
    const l = { ...o };
    return s && (l[t] = s), {
      success: !0,
      ownProfile: s,
      friends: l,
      refreshed: i || n
    };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchStats error:", r), { success: !1, error: r.message };
  }
}
async function hr(e = !1) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured" };
    let s = await Y();
    if (e || !s || le(s.lastUpdated)) {
      const a = await G(t);
      s = await z(a, r.user_timezone), await te(s);
    }
    return { success: !0, ownProfile: s };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchOwnProfile error:", r), { success: !1, error: r.message };
  }
}
async function pr(e) {
  try {
    const r = e;
    let t;
    try {
      t = Kt(e);
    } catch (o) {
      return { success: !1, error: o.message };
    }
    if (await ge(t))
      return { success: !1, error: `${r} is already in your friends list` };
    const i = await G(r), a = await z(i);
    return await ye(t, a), D() === f.AUTHENTICATED && me(t).catch((o) => {
      console.warn("[ServiceWorker] Cloud syncFriendship failed:", o);
    }), { success: !0, message: `${r} added successfully`, data: a };
  } catch (r) {
    return console.error("[ServiceWorker] handleAddFriend error:", r), { success: !1, error: r.message || "User not found or profile is private" };
  }
}
async function _r(e) {
  try {
    return await Ut(e), D() === f.AUTHENTICATED && $e(e).catch((r) => {
      console.warn("[ServiceWorker] Cloud removeFriendship failed:", r);
    }), { success: !0, message: `${e} removed` };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function wr() {
  try {
    let e = await K();
    return D() === f.AUTHENTICATED && (!e || Object.keys(e).length === 0) && (await ce(), e = await K()), { success: !0, friends: e };
  } catch (e) {
    return { success: !1, error: e.message };
  }
}
async function Sr(e) {
  try {
    if (!e) return { success: !1, error: "Problem data required" };
    const t = (await chrome.storage.local.get("problem_queue")).problem_queue || [];
    if (t.some((a) => a.slug === e.slug || a.id === e.slug))
      return { success: !1, error: "Problem already in queue", alreadyExists: !0 };
    const i = {
      ...e,
      id: e.slug || `problem-${Date.now()}`,
      addedAt: Date.now(),
      status: e.status || "pending"
    };
    return t.push(i), await chrome.storage.local.set({ problem_queue: t }), { success: !0, message: "Added to problem queue" };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function br(e, r) {
  try {
    const t = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "problem_queue"]), s = N(Math.floor(Date.now() / 1e3), t.user_timezone);
    if (await chrome.storage.local.set({ last_solve_date: s }), console.log(`[ServiceWorker] Solve recorded today (${s}) — Hardcore Mode unlocked!`), await O(), t.problem_queue && Array.isArray(t.problem_queue)) {
      const i = t.problem_queue.map((a) => a.slug === e || a.id === e || r && a.title === r ? { ...a, status: "completed" } : a);
      await chrome.storage.local.set({ problem_queue: i });
    }
    return lt().catch(console.error), { success: !0 };
  } catch (t) {
    return console.error("[ServiceWorker] handleSubmissionAccepted error:", t), { success: !1, error: t.message };
  }
}
async function Er() {
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
async function lt() {
  try {
    const e = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), r = e.my_leetcode_username, t = e.user_timezone, s = await We(), i = r ? [.../* @__PURE__ */ new Set([r, ...s])] : s;
    console.log(`[ServiceWorker] Syncing ${i.length} profile(s): ${i.join(", ")}`);
    const a = [];
    if (r)
      try {
        const o = await qe(r);
        if (o && o.length > 0) {
          const n = [];
          for (const l of o)
            a.push({
              type: "roast",
              username: l.sender_username,
              message: `${l.sender_username} roasted you: "${l.content}" 🔥`,
              priority: 2
            }), l.status === "sent" && n.push(l.id);
          n.length > 0 && await Nt(n);
        }
        const c = await ee(r);
        if (c?.pending_roasts && c.pending_roasts.length > 0) {
          for (const n of c.pending_roasts)
            a.push({
              type: "roast",
              username: n.from,
              message: `${n.from} roasted you: "${n.message}" 🔥`,
              priority: 2
            });
          await Ye();
        }
      } catch (o) {
        console.warn("[ServiceWorker] Error checking pending roasts:", o);
      }
    for (const o of i)
      try {
        const c = await ge(o), n = await G(o), l = await z(n, t);
        if (await ye(o, l), r && o.toLowerCase() === r.toLowerCase()) {
          if (await te(l), tt(l.allAcceptedSubmissions, l.submissionCalendar, t)) {
            const u = N(Math.floor(Date.now() / 1e3), t);
            await chrome.storage.local.set({ last_solve_date: u });
          }
          await O();
        }
        if (!await st()) {
          const u = await Tr(o, c, l, r);
          a.push(...u), r && o.toLowerCase() === r.toLowerCase() && ir(l.allAcceptedSubmissions, l.stats.streak) && a.push({
            username: "You",
            type: "streak_at_risk",
            message: ar("You", "streak_at_risk", { streak: l.stats.streak }),
            priority: 3
          });
        }
        await mt(ct);
      } catch (c) {
        console.warn(`[ServiceWorker] Error syncing ${o}:`, c);
      }
    a.length > 0 && await it(a);
  } catch (e) {
    console.error("[ServiceWorker] syncAllFriends error:", e);
  }
}
async function Tr(e, r, t, s) {
  const i = [];
  if (s && e.toLowerCase() === s.toLowerCase())
    return i;
  if (r?.stats && t?.stats) {
    const a = r.stats.total || 0, o = t.stats.total || 0;
    if (o > a) {
      const c = o - a;
      let n = "a problem";
      t.recentSubmissions && t.recentSubmissions.length > 0 && (n = t.recentSubmissions[0].title || n), i.push({
        username: e,
        type: "new_submission",
        message: `${e} just solved ${c === 1 ? `"${n}"` : `${c} problems`}! 🎯`,
        priority: 1
      });
    }
  }
  if (t.stats?.streak && sr(t.stats.streak)) {
    const a = r?.stats?.streak || 0;
    t.stats.streak > a && i.push({
      username: e,
      type: "milestone",
      message: `${e} reached a ${t.stats.streak}-day streak! 🔥`,
      priority: 2
    });
  }
  return i;
}
async function z(e, r = null) {
  const { profile: t, contestRanking: s, submissionCalendar: i, allAcceptedSubmissions: a } = e, { currentStreak: o, longestStreak: c } = Zt(
    a || [],
    i || {},
    r
  ), n = Xt(t.submitStats?.acSubmissionNum);
  return {
    profile: {
      username: t.username,
      realName: t.profile?.realName || "",
      avatar: t.profile?.userAvatar || "",
      ranking: t.profile?.ranking || 0
    },
    stats: {
      ...n,
      streak: o,
      longestStreak: c
    },
    contest: {
      rating: Math.round(s?.rating || 0),
      attended: s?.attendedContestsCount || 0,
      ranking: s?.globalRanking || 0
    },
    badges: t.badges || [],
    recentSubmissions: t.recentSubmissions || [],
    allAcceptedSubmissions: a || [],
    submissionCalendar: i || {},
    lastUpdated: Date.now()
  };
}
async function Ar(e) {
  try {
    const r = await chrome.storage.local.get("my_leetcode_username"), t = e || r.my_leetcode_username;
    if (!t) return { success: !1, error: "No username configured" };
    const [s, i] = await Promise.all([
      Z(t),
      Vt(t, 10)
    ]);
    if (!s) return { success: !0, battle: null, history: i };
    const a = await re(s.id);
    return { success: !0, battle: s, results: a, history: i };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function kr(e) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), t = e.challenger || r.my_leetcode_username;
    return t && r.own_profile && P(t, r.own_profile).catch(() => {
    }), await je(t, e.challenged, {
      topics: e.topics,
      difficulty: e.difficulty,
      durationMinutes: e.durationMinutes,
      problemCount: e.problemCount,
      language: e.language || "javascript"
    });
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function ut(e) {
  try {
    return await Je(e);
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function dt(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username, i = await qt(e, s);
    return i?.bothReady && Rr(e), i;
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function Mr(e) {
  try {
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    return await Gt(e.battleId, e.problemSlug, {
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
async function Cr(e) {
  try {
    const r = await ze(e);
    return { success: !!r, state: r };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function vr(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await Wt(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
function Rr(e) {
  setTimeout(async () => {
    try {
      const r = await ze(e);
      if (!r?.problems?.length) return;
      const t = r.problems[0], s = t.problem_url || `https://leetcode.com/problems/${t.problem_slug}/`, i = await chrome.tabs.query({ url: "*://leetcode.com/*" });
      i.length > 0 ? (await chrome.tabs.update(i[0].id, { url: s, active: !0 }), i[0].windowId && await chrome.windows.update(i[0].windowId, { focused: !0 })) : await chrome.tabs.create({ url: s, active: !0 }), chrome.notifications && chrome.notifications.create(`battle_start_${e}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "⚔️ Battle Started!",
        message: `Duel is live! First problem: ${t.problem_title}`,
        priority: 2
      });
    } catch (r) {
      console.warn("[ServiceWorker] scheduleBattleStart error:", r);
    }
  }, 1e4);
}
async function Lr(e, r, t) {
  try {
    const s = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), i = e || s.my_leetcode_username;
    return i && s.own_profile && P(i, s.own_profile).catch(() => {
    }), await Yt(i, r, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function Pr(e, r, t) {
  try {
    const s = await chrome.storage.local.get("my_leetcode_username"), i = r || s.my_leetcode_username;
    if (t) {
      const a = await ut(e);
      if (a && a.success !== !1) return a;
    }
    return await jt(e, i, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function Dr(e, r, t, s) {
  try {
    const i = await chrome.storage.local.get("my_leetcode_username"), a = r || i.my_leetcode_username;
    return await Jt(e, a, t, s);
  } catch (i) {
    return { success: !1, error: i.message };
  }
}
async function Ir(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username, i = await dt(e, s);
    return i && i.success !== !1 ? i : await Ve(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function Nr(e) {
  try {
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    if (!t) return { success: !1, error: "No username configured" };
    const s = await Z(t);
    return s ? await Qe(s.id, t, {
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
async function Or(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await Ze(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function Ur(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await zt(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function ft() {
  try {
    if (!(await A())?.user_id) return;
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    t && await X(t, "online");
  } catch (e) {
    console.warn("[ServiceWorker] handlePresenceHeartbeat error:", e);
  }
}
async function Br(e) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "own_profile"]), t = e || r.my_leetcode_username;
    return t && (P(t, r.own_profile || { profile: { realName: t } }).catch(() => {
    }), await X(t)), { success: !0 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function Hr(e) {
  try {
    if (!e?.length) return { success: !0, presenceMap: {} };
    const r = await Qt(e);
    return { success: !0, presenceMap: Object.fromEntries(r) };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function $r(e, r, t) {
  try {
    return await Fe(e, r, t) ? { success: !0 } : { success: await Bt(e, r, t) };
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
function mt(e) {
  return new Promise((r) => setTimeout(r, e));
}
