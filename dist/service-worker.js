function et(e, r = 1, t = 50) {
  return !e || typeof e != "string" ? { valid: !1, error: "Username is required" } : (e = e.trim(), e.length < r || e.length > t ? { valid: !1, error: `Username must be ${r}-${t} characters` } : /^[a-zA-Z0-9_-]+$/.test(e) ? { valid: !0, username: e.toLowerCase() } : { valid: !1, error: "Username contains invalid characters" });
}
class tt {
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
const rt = /* @__PURE__ */ new Set([
  "leetcode.com",
  "assets.leetcode.com"
]);
function st(e, r) {
  try {
    const t = new URL(e);
    return t.protocol !== "https:" ? {
      valid: !1,
      reason: `Insecure transport: ${e} does not use HTTPS`
    } : (!rt.has(t.hostname) && !t.hostname.endsWith(".supabase.co") && console.warn(`[SecurityAuditor] Request to external domain: ${t.hostname}`), !r.headers?.get("strict-transport-security") && t.hostname === "leetcode.com" && console.warn(`[SecurityAuditor] Warning: Missing HSTS header on response from ${t.hostname}`), { valid: !0 });
  } catch (t) {
    return {
      valid: !1,
      reason: `Transport security audit failed: ${t.message}`
    };
  }
}
async function at(e, r = {}) {
  if (!e.startsWith("https://"))
    throw new Error(`Security Violation: Insecure HTTP request blocked for ${e}`);
  const t = await fetch(e, r), s = st(e, t);
  return s.valid || console.error(`[SecurityAuditor] Security policy failed: ${s.reason}`), t;
}
const Q = "https://leetcode.com/graphql", ot = 2, Z = 6e3, we = new tt(30, 6e4);
function ge(e) {
  return new Promise((r) => setTimeout(r, e));
}
async function nt(e, r, t = ot) {
  let s;
  if (!we.isAllowed()) {
    const a = we.getTimeUntilReset();
    throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(a / 1e3)} seconds.`);
  }
  for (let a = 0; a < t; a++)
    try {
      if (typeof navigator < "u" && !navigator.onLine)
        throw new Error("No internet connection. Please check your network.");
      const o = new AbortController(), n = setTimeout(() => o.abort(), Z), c = await at(e, {
        ...r,
        signal: o.signal
      });
      if (clearTimeout(n), c.status === 429) {
        const i = parseInt(c.headers.get("Retry-After")) || Math.pow(2, a);
        console.log(`[API] Rate limited. Retrying after ${i}s`), await ge(i * 1e3);
        continue;
      }
      return c;
    } catch (o) {
      if (s = o, o.name === "AbortError" && (console.error(`[API] Request timeout (${Z}ms)`), s = new Error(`Request timed out after ${Z / 1e3} seconds`)), o.message.includes("No internet connection"))
        throw o;
      if (a < t - 1) {
        const n = Math.pow(2, a) * 1e3;
        console.log(`[API] Retry ${a + 1}/${t} in ${n}ms`), await ge(n);
      }
    }
  throw s || new Error("Network request failed after multiple retries");
}
const ct = `
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
`, it = `
  query getUserBadges($username: String!) {
    matchedUser(username: $username) {
      badges {
        id
        displayName
        icon
      }
    }
  }
`, lt = `
  query getRecentSubmissions($username: String!) {
    recentSubmissionList(username: $username, limit: 15) {
      title
      titleSlug
      timestamp
      statusDisplay
      lang
    }
  }
`, ut = `
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
async function x(e) {
  try {
    console.log(`[API] Fetching data for user: ${e}`);
    const r = await nt(Q, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: ct,
        variables: { username: e }
      })
    });
    if (console.log(`[API] Profile response status: ${r.status}`), !r.ok) {
      const i = await r.text();
      throw console.error("[API] Profile request failed:", r.status, i), new Error(`API request failed: ${r.status}`);
    }
    const t = await r.json();
    if (console.log("[API] Profile data received:", t), t.errors)
      throw console.error("[API] GraphQL errors:", t.errors), new Error(t.errors[0]?.message || "GraphQL error");
    if (!t.data?.matchedUser)
      throw console.error("[API] No matched user in response"), new Error("User not found or profile is private");
    const s = t.data.matchedUser, a = s.submissionCalendar ? JSON.parse(s.submissionCalendar) : {};
    let o = [];
    try {
      const i = await fetch(Q, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: it,
          variables: { username: e }
        })
      });
      i.ok && (o = (await i.json()).data?.matchedUser?.badges || []);
    } catch (i) {
      console.warn("[API] Failed to fetch badges:", i);
    }
    let n = [];
    try {
      const i = await fetch(Q, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: lt,
          variables: { username: e }
        })
      });
      i.ok && (n = (await i.json()).data?.recentSubmissionList || []);
    } catch (i) {
      console.warn("[API] Failed to fetch recent submissions:", i);
    }
    let c = [];
    try {
      const i = await fetch(Q, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: ut,
          variables: { username: e }
        })
      });
      if (i.ok) {
        const l = await i.json();
        l.errors ? console.warn("[API] All submissions query error:", l.errors) : (c = l.data?.matchedUser?.recentAcSubmissions || [], console.log(`[API] Fetched ${c.length} all-time accepted submissions (limit 1000)`), c.length > 0 && console.log("[API] Sample submissions:", c.slice(0, 5).map((u) => u.titleSlug)));
      }
    } catch (i) {
      console.warn("[API] Failed to fetch all submissions:", i);
    }
    return console.log(`[API] Successfully fetched data for ${e}`), {
      profile: {
        ...s,
        badges: o,
        recentSubmissions: n
      },
      allAcceptedSubmissions: c,
      contestRanking: t.data.userContestRanking,
      submissionCalendar: a
    };
  } catch (r) {
    throw console.error("Error fetching LeetCode data:", r), r;
  }
}
const ye = { VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6c2xkY2pncGlvZHp1aXZyYnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NDYwODMsImV4cCI6MjEwMzEyMjA4M30.TuPkW7jnn9rScS2FhH1A8omsSIpABs6MEKfRbX1lzYU", VITE_SUPABASE_URL: "https://pzsldcjgpiodzuivrbwt.supabase.co" }, ve = typeof import.meta < "u" && ye ? ye : typeof process < "u" && process.env ? process.env : {}, _ = ve.VITE_SUPABASE_URL || "YOUR_SUPABASE_PROJECT_URL_HERE", M = ve.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY_HERE", S = _.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), d = {
  SESSION_LOADING: "SESSION_LOADING",
  AUTHENTICATED: "AUTHENTICATED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  AUTH_ERROR: "AUTH_ERROR"
};
let L = null, ee = d.SESSION_LOADING, pe = null, q = 0;
const dt = /* @__PURE__ */ new Set();
function w(e, r = null) {
  ee = e, pe = r;
  for (const t of dt)
    try {
      t(ee, L, pe);
    } catch (s) {
      console.warn("[SupabaseClient] Error in auth listener callback:", s);
    }
}
function F() {
  return ee;
}
function B() {
  return Date.now() < q;
}
function ae() {
  return Math.max(0, Math.ceil((q - Date.now()) / 1e3));
}
function oe(e = 60) {
  q = Date.now() + e * 1e3, typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ supabase_auth_cooldown_until: q }).catch(() => {
  });
}
async function b() {
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
async function H(e) {
  if (L = e, typeof chrome < "u" && chrome.storage?.local)
    try {
      e ? await chrome.storage.local.set({ supabase_auth_session: e }) : await chrome.storage.local.remove(["supabase_auth_session"]);
    } catch {
    }
}
async function ft() {
  w(d.SESSION_LOADING);
  try {
    let e = null;
    if (typeof chrome < "u" && chrome.storage?.local) {
      const r = await chrome.storage.local.get(["supabase_auth_session", "supabase_auth_cooldown_until"]);
      r.supabase_auth_cooldown_until && r.supabase_auth_cooldown_until > Date.now() && (q = r.supabase_auth_cooldown_until), e = r.supabase_auth_session;
    } else
      e = L;
    if (!e)
      return w(d.AUTH_REQUIRED), null;
    if (e.expires_at && e.expires_at > Date.now() + 6e4)
      return L = e, w(d.AUTHENTICATED), L;
    if (e.refresh_token) {
      if (B())
        return w(d.AUTH_ERROR, "Authentication temporarily rate-limited. Please wait."), null;
      const r = await mt(e.refresh_token);
      if (r)
        return r;
    }
    return await H(null), w(d.SESSION_EXPIRED, "Session expired. Please sign in again."), null;
  } catch (e) {
    return console.warn("[SupabaseClient] Error restoring session:", e), w(d.AUTH_ERROR, e.message), null;
  }
}
async function mt(e) {
  if (B())
    return w(d.AUTH_ERROR, "Rate limited"), null;
  try {
    const r = await fetch(`${S}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: M
      },
      body: JSON.stringify({ refresh_token: e })
    });
    if (r.status === 429)
      return oe(60), w(d.AUTH_ERROR, "Supabase authentication rate limit exceeded."), null;
    if (!r.ok)
      return await H(null), w(d.SESSION_EXPIRED, "Session expired or revoked."), null;
    const t = await r.json(), s = {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      user_id: t.user?.id,
      email: t.user?.email,
      expires_at: Date.now() + (t.expires_in ? t.expires_in * 1e3 : 3600 * 1e3)
    };
    return await H(s), w(d.AUTHENTICATED), s;
  } catch (r) {
    return console.warn("[SupabaseClient] Network error during token refresh:", r), w(d.AUTH_ERROR, r.message), null;
  }
}
async function ht(e, r) {
  if (B()) {
    const t = ae();
    throw new Error(`Rate limit cooldown active. Please wait ${t} seconds.`);
  }
  if (!e || !r)
    throw new Error("Email and password are required");
  try {
    const t = await fetch(`${S}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: M
      },
      body: JSON.stringify({ email: e, password: r })
    });
    if (t.status === 429)
      throw oe(60), w(d.AUTH_ERROR, "Rate limit exceeded"), new Error("Email rate limit exceeded. Please wait 1 minute before retrying.");
    if (!t.ok) {
      const o = await t.text();
      let n = "Invalid email or password";
      try {
        const c = JSON.parse(o);
        n = c.error_description || c.msg || n;
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
    return await H(a), w(d.AUTHENTICATED), a;
  } catch (t) {
    throw w(d.AUTH_ERROR, t.message), t;
  }
}
async function _t(e, r) {
  if (B()) {
    const t = ae();
    throw new Error(`Rate limit cooldown active. Please wait ${t} seconds.`);
  }
  if (!e || !r)
    throw new Error("Email and password are required");
  try {
    const t = await fetch(`${S}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: M
      },
      body: JSON.stringify({ email: e, password: r })
    });
    if (t.status === 429)
      throw oe(60), w(d.AUTH_ERROR, "Rate limit exceeded"), new Error("Email signup rate limit exceeded. Please wait before retrying.");
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
      return await H(a), w(d.AUTHENTICATED), { success: !0, session: a };
    }
    return w(d.AUTH_REQUIRED), {
      success: !0,
      confirmationRequired: !0,
      user: s.user,
      message: "Account created. Please check your inbox to confirm your email before signing in."
    };
  } catch (t) {
    throw w(d.AUTH_ERROR, t.message), t;
  }
}
async function wt() {
  try {
    const e = await b();
    e?.access_token && fetch(`${S}/auth/v1/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: M,
        Authorization: `Bearer ${e.access_token}`
      }
    }).catch(() => {
    });
  } catch {
  }
  return await H(null), w(d.AUTH_REQUIRED), { success: !0 };
}
async function k() {
  const r = (await b())?.access_token || M;
  return {
    "Content-Type": "application/json",
    apikey: M,
    Authorization: `Bearer ${r}`,
    Prefer: "return=representation"
  };
}
async function C(e, r = {}) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await k(), s = await fetch(`${S}/rest/v1/rpc/${e}`, {
      method: "POST",
      headers: t,
      body: JSON.stringify(r)
    });
    if (!s.ok) {
      const a = await s.text();
      return console.error(`[SupabaseClient] RPC ${e} error:`, s.status, a), { success: !1, error: a };
    }
    return await s.json();
  } catch (t) {
    return console.error(`[SupabaseClient] RPC ${e} exception:`, t), { success: !1, error: t.message };
  }
}
async function Oe(e) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return null;
  try {
    const r = await k(), t = await fetch(
      `${S}/rest/v1/profiles?leetcode_username=ilike.${encodeURIComponent(e)}&select=*`,
      { method: "GET", headers: r }
    );
    if (!t.ok) return null;
    const s = await t.json();
    return s && s.length > 0 ? s[0] : null;
  } catch (r) {
    return console.error("Supabase getProfile error:", r), null;
  }
}
async function gt(e) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e?.length) return [];
  try {
    const r = await k(), t = e.map((a) => `"${a.toLowerCase()}"`).join(","), s = await fetch(
      `${S}/rest/v1/profiles?leetcode_username=in.(${t})&select=*`,
      { method: "GET", headers: r }
    );
    return s.ok ? await s.json() : [];
  } catch (r) {
    return console.error("Supabase getProfiles error:", r), [];
  }
}
async function Ue(e, r) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return !1;
  try {
    const t = await b();
    if (!t?.user_id)
      return !1;
    const s = await k(), a = r?.stats || {}, o = r?.profile || {}, n = r?.contest || {}, c = {
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
    return (await fetch(`${S}/rest/v1/profiles`, {
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
async function G() {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const e = await b();
    if (!e?.user_id) return null;
    const r = await k(), t = await fetch(
      `${S}/rest/v1/user_settings?user_id=eq.${e.user_id}&select=*`,
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
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE") return !1;
  try {
    const r = await b();
    if (!r?.user_id) return !1;
    const t = await k();
    return (await fetch(`${S}/rest/v1/user_settings`, {
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
async function yt() {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    return (await b())?.user_id ? await C("set_presence_offline") : null;
  } catch {
    return null;
  }
}
async function pt() {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE") return [];
  try {
    const e = await C("get_online_friends");
    return Array.isArray(e) ? e : [];
  } catch (e) {
    return console.warn("[SupabaseClient] getOnlineFriends error:", e), [];
  }
}
async function Se(e) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return { success: !1 };
  try {
    return await C("sync_friendship", { p_target_username: e.toLowerCase() }) || { success: !1 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function Ne(e, r, t) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e || !t) return !1;
  try {
    const s = await b();
    if (!s?.user_id)
      return console.warn("[Roast] Authentication required to send cloud roasts"), !1;
    const a = await C("send_roast", {
      p_recipient_username: e.toLowerCase(),
      p_content: t.substring(0, 500)
    });
    if (a && a.success)
      return !0;
    const o = await Oe(e);
    if (!o?.id)
      return console.warn(`[Roast] Target user ${e} has not registered on Supabase`), !1;
    const n = await k();
    return (await fetch(`${S}/rest/v1/roast_messages`, {
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
async function Pe(e) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE" || !e) return [];
  try {
    if (!await b()) return [];
    const t = await k(), s = await fetch(
      `${S}/rest/v1/roast_messages?recipient_username=eq.${e.toLowerCase()}&status=neq.read&order=created_at.desc&limit=20`,
      { method: "GET", headers: t }
    );
    return s.ok ? await s.json() : [];
  } catch (r) {
    return console.warn("Error fetching unread roasts:", r), [];
  }
}
async function St(e) {
  if (!(!e?.length || _ === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      const r = await k(), t = e.map((s) => `"${s}"`).join(",");
      await fetch(`${S}/rest/v1/roast_messages?id=in.(${t})`, {
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
async function Et(e) {
  if (!(!e?.length || _ === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      const r = await k(), t = e.map((s) => `"${s}"`).join(",");
      await fetch(`${S}/rest/v1/roast_messages?id=in.(${t})`, {
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
async function $e(e) {
  if (!e || _ === "YOUR_SUPABASE_PROJECT_URL_HERE") return !0;
  try {
    const r = await Pe(e);
    if (!r || r.length === 0) return !0;
    const t = r.map((s) => s.id);
    return await Et(t), !0;
  } catch (r) {
    return console.error("Error clearing roasts:", r), !1;
  }
}
async function z() {
  return typeof chrome > "u" || !chrome.storage?.local ? null : (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username || null;
}
async function ne() {
  if (typeof chrome > "u" || !chrome.storage?.local) return null;
  try {
    return (await chrome.storage.local.get(["own_profile"])).own_profile || null;
  } catch (e) {
    return console.error("Error reading own profile from storage:", e), null;
  }
}
async function K(e) {
  if (typeof chrome > "u" || !chrome.storage?.local) return !1;
  try {
    await chrome.storage.local.set({
      own_profile: e,
      last_own_profile_sync: Date.now()
    });
    const r = await z();
    return r && F() === d.AUTHENTICATED && Ue(r, e).catch((t) => {
      console.warn("[Storage] Cloud sync for own profile failed (non-blocking):", t);
    }), !0;
  } catch (r) {
    return console.error("Error saving own profile to storage:", r), !1;
  }
}
async function te() {
  try {
    const e = await z(), r = typeof chrome < "u" && chrome.storage?.local ? await chrome.storage.local.get(["friends_cache", "own_profile", "friends_list"]) : {}, t = r.friends_cache || {}, s = r.own_profile || null, a = r.friends_list || [], o = { ...t };
    if (e && s && (o[e] = s), F() !== d.AUTHENTICATED || !e)
      return o;
    try {
      let n = a;
      const c = await G();
      if (c?.friends_list && Array.isArray(c.friends_list) && (n = [.../* @__PURE__ */ new Set([...a, ...c.friends_list])], typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ friends_list: n }).catch(() => {
      })), n.length > 0) {
        const i = await gt(n);
        i && i.length > 0 && (i.forEach((l) => {
          const u = l.leetcode_username || l.username;
          u && l.leetcode_data && (o[u] = {
            ...l.leetcode_data,
            lastUpdated: l.last_synced_at ? new Date(l.last_synced_at).getTime() : Date.now()
          });
        }), typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ friends_cache: o }).catch(() => {
        }));
      }
    } catch (n) {
      console.warn("[Storage] Cloud friends refresh skipped/failed:", n.message);
    }
    return o;
  } catch (e) {
    return console.error("Error getting friends:", e), {};
  }
}
async function ce(e) {
  if (!e) return null;
  try {
    const r = await z();
    if (r && e.toLowerCase() === r.toLowerCase())
      return await ne();
    if (typeof chrome < "u" && chrome.storage?.local) {
      const a = await chrome.storage.local.get(["friends_cache"]);
      if (a.friends_cache && a.friends_cache[e])
        return a.friends_cache[e];
    }
    const t = await Oe(e);
    if (!t) return null;
    const s = t.leetcode_data || {};
    return s.lastUpdated = t.last_synced_at ? new Date(t.last_synced_at).getTime() : Date.now(), s;
  } catch (r) {
    return console.error("Error getting single friend:", r), null;
  }
}
async function ie(e, r) {
  if (!e || !r) return { success: !1 };
  try {
    const t = await z();
    if (t && e.toLowerCase() === t.toLowerCase())
      return await K(r), { success: !0 };
    if (typeof chrome < "u" && chrome.storage?.local) {
      const a = await chrome.storage.local.get(["friends_cache", "friends_list"]), o = a.friends_cache || {}, n = a.friends_list || [];
      o[e] = r;
      const c = n.includes(e) ? n : [...n, e];
      await chrome.storage.local.set({
        friends_cache: o,
        friends_list: c
      });
    }
    return F() === d.AUTHENTICATED && (Ue(e, r).catch(() => {
    }), t && G().then((a) => {
      const o = a?.friends_list || [];
      o.includes(e) || Ie({ friends_list: [...o, e] }).catch(() => {
      });
    }).catch(() => {
    })), { success: !0 };
  } catch (t) {
    return console.error("Error saving friend:", t), { success: !1, error: t.message };
  }
}
async function bt(e) {
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
    return F() === d.AUTHENTICATED && G().then((r) => {
      if (r?.friends_list) {
        const t = r.friends_list.filter((s) => s.toLowerCase() !== e.toLowerCase());
        Ie({ friends_list: t }).catch(() => {
        });
      }
    }).catch(() => {
    }), !0;
  } catch (r) {
    return console.error("Error removing friend:", r), !1;
  }
}
async function Be() {
  try {
    if (typeof chrome < "u" && chrome.storage?.local) {
      const e = await chrome.storage.local.get(["friends_list"]);
      if (e.friends_list && Array.isArray(e.friends_list))
        return e.friends_list;
    }
    if (F() === d.AUTHENTICATED) {
      const e = await G();
      if (e?.friends_list)
        return typeof chrome < "u" && chrome.storage?.local && chrome.storage.local.set({ friends_list: e.friends_list }).catch(() => {
        }), e.friends_list;
    }
    return [];
  } catch (e) {
    return console.error("Error getting friends list:", e), [];
  }
}
async function Tt(e, r, t) {
  return await Ne(e, r, t);
}
async function Me() {
  const e = await z();
  return e ? await $e(e) : !1;
}
const At = _.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), le = /* @__PURE__ */ new Set([
  "completed",
  "declined",
  "expired",
  "cancelled",
  "forfeited"
]), p = {
  PENDING: "pending",
  SELECTING: "selecting",
  READY_CHECK: "ready_check",
  COUNTDOWN: "countdown",
  COMPLETED: "completed",
  DECLINED: "declined",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  FORFEITED: "forfeited"
}, kt = 7200, Ct = 1440 * 60, Ee = 10;
async function E(e, r = {}) {
  if (_ === "YOUR_SUPABASE_PROJECT_URL_HERE") return null;
  try {
    const t = await k(), s = await fetch(`${At}/rest/v1/${e}`, {
      headers: { ...t, ...r.headers || {} },
      ...r
    });
    return s.ok ? s.json() : (console.error(`[Battle] Supabase error ${s.status} on ${e}:`, await s.text()), null);
  } catch (t) {
    return console.error("[Battle] Supabase fetch error:", t), null;
  }
}
async function Rt(e, r, t = "javascript") {
  if (!e || !r)
    return { success: !1, error: "Challenger and opponent usernames are required" };
  if (e.toLowerCase() === r.toLowerCase())
    return { success: !1, error: "Cannot challenge yourself" };
  try {
    const h = await C("create_battle_challenge", {
      p_challenged_username: r.toLowerCase(),
      p_language: t.toLowerCase()
    });
    if (h && h.success && h.battle)
      return { success: !0, battle: h.battle };
    if (h && h.error)
      return { success: !1, error: h.error };
  } catch (h) {
    console.warn("[BattleManager] create_battle_challenge RPC error, using REST fallback:", h);
  }
  const [s, a] = await Promise.all([
    V(e),
    V(r)
  ]);
  if (s)
    return { success: !1, error: "You already have an active battle in progress" };
  if (a)
    return { success: !1, error: `${r} is currently in an active battle` };
  const o = await b(), n = await E(`profiles?leetcode_username=in.("${e.toLowerCase()}","${r.toLowerCase()}")&select=id,leetcode_username`), c = n?.find((h) => h.leetcode_username.toLowerCase() === e.toLowerCase()), i = n?.find((h) => h.leetcode_username.toLowerCase() === r.toLowerCase()), l = o?.user_id || c?.id, u = i?.id, m = Date.now(), y = new Date(m + Ct * 1e3).toISOString(), g = {
    challenger_username: e,
    challenged_username: r,
    language: t.toLowerCase(),
    status: p.PENDING,
    expires_at: y
  };
  l && (g.challenger_id = l), u && (g.challenged_id = u);
  const T = await E("battles", {
    method: "POST",
    body: JSON.stringify(g)
  });
  return !T || T.length === 0 ? { success: !1, error: "Failed to create battle room" } : { success: !0, battle: T[0] };
}
async function V(e) {
  if (!e) return null;
  const r = Array.from(le).join(","), t = e.toLowerCase(), s = await E(
    `battles?or=(challenger_username.ilike.${t},challenged_username.ilike.${t})&status=not.in.(${r})&order=created_at.desc&limit=1`
  );
  return s && s.length > 0 ? s[0] : null;
}
async function O(e) {
  if (!e) return null;
  const r = await E(`battles?id=eq.${e}&select=*`);
  return r && r.length > 0 ? r[0] : null;
}
async function ue(e) {
  return e ? await E(`battle_results?battle_id=eq.${e}&select=*`) || [] : [];
}
async function Dt(e, r, t) {
  const s = await O(e);
  if (!s) return { success: !1, error: "Battle not found" };
  if ((s.challenged_username || s.challenged).toLowerCase() !== r.toLowerCase())
    return { success: !1, error: "You are not the invited opponent for this battle" };
  if (s.status !== p.PENDING)
    return { success: !1, error: `Battle is no longer pending (current: ${s.status})` };
  if (new Date(s.expires_at) < /* @__PURE__ */ new Date())
    return await W(e, p.EXPIRED), { success: !1, error: "Challenge has expired" };
  if (!t)
    return await W(e, p.DECLINED), { success: !0, battle: { ...s, status: p.DECLINED } };
  const o = /* @__PURE__ */ new Date(), n = await E(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: p.SELECTING,
      accepted_at: o.toISOString()
    })
  });
  return !n || n.length === 0 ? { success: !1, error: "Failed to accept battle" } : { success: !0, battle: n[0] };
}
async function Lt(e, r, t, s) {
  const a = await O(e);
  if (!a) return { success: !1, error: "Battle not found" };
  if (a.status !== p.SELECTING)
    return { success: !1, error: "Battle is not in the problem selection phase" };
  const o = await He(t);
  if (!o.valid)
    return { success: !1, error: o.error || "Invalid LeetCode problem" };
  const c = (a.challenger_username || a.challenger).toLowerCase() === r.toLowerCase(), i = c ? "challenger_pick" : "challenged_pick", l = c ? "challenger_pick_title" : "challenged_pick_title", u = c ? a.challenged_pick : a.challenger_pick, m = c ? a.challenged_pick_title : a.challenger_pick_title, y = {
    [i]: o.slug,
    [l]: o.title || s || o.slug
  };
  u && Object.assign(y, {
    problem_1: o.slug,
    problem_1_title: o.title,
    problem_2: u,
    problem_2_title: m || u,
    status: p.READY_CHECK,
    challenger_ready: !1,
    challenged_ready: !1
  });
  const g = await E(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify(y)
  });
  return !g || g.length === 0 ? { success: !1, error: "Failed to save problem selection" } : {
    success: !0,
    battle: g[0],
    bothPicked: !!u
  };
}
async function vt(e, r) {
  const t = await C("confirm_battle_ready", { p_battle_id: e });
  if (t && t.success)
    return { success: !0, battle: await O(e), bothReady: t.status === p.COUNTDOWN };
  const s = await O(e);
  if (!s) return { success: !1, error: "Battle not found" };
  const o = (s.challenger_username || s.challenger).toLowerCase() === r.toLowerCase(), n = o ? { challenger_ready: !0 } : { challenged_ready: !0 }, c = o ? s.challenged_ready : s.challenger_ready;
  if (c) {
    const l = Date.now(), u = new Date(l).toISOString(), m = new Date(l + Ee * 1e3).toISOString(), y = new Date(l + (Ee + kt) * 1e3).toISOString();
    Object.assign(n, {
      status: p.COUNTDOWN,
      countdown_starts: u,
      match_starts_at: m,
      match_deadline: y
    });
  }
  const i = await E(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify(n)
  });
  return !i || i.length === 0 ? { success: !1, error: "Failed to record readiness" } : { success: !0, battle: i[0], bothReady: !!c };
}
async function Ot(e, r, t) {
  const {
    problemSlug: s,
    submissionId: a,
    accepted: o,
    runtime_ms: n,
    memory_mb: c,
    language: i,
    timeTakenSeconds: l
  } = t, u = await O(e);
  if (!u) return { success: !1, error: "Battle not found" };
  if (le.has(u.status))
    return { success: !1, error: `Battle is already closed (${u.status})` };
  const m = u.match_starts_at ? new Date(u.match_starts_at).getTime() : Date.now(), y = l ?? Math.max(0, Math.floor((Date.now() - m) / 1e3)), g = await C("record_battle_submission", {
    p_battle_id: e,
    p_problem_slug: s,
    p_submission_id: a || `sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    p_accepted: !!o,
    p_time_taken: y,
    p_runtime_ms: n || null,
    p_memory_mb: c || null,
    p_language: i || u.language || "javascript"
  });
  if (g && g.success)
    return { success: !0, result: g };
  const T = await E("battle_results", {
    method: "POST",
    body: JSON.stringify({
      battle_id: e,
      username: r,
      problem_slug: s,
      leetcode_submission_id: a || `sub_${Date.now()}`,
      accepted: !!o,
      submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
      time_taken_seconds: y,
      runtime_ms: n || null,
      memory_mb: c || null,
      language: i || u.language || "javascript",
      attempts: 1,
      points: o ? 1 : 0
    })
  });
  return await Ut(e), { success: !0, result: T?.[0] };
}
async function Ut(e) {
  const r = await C("evaluate_and_finalize_battle", { p_battle_id: e });
  if (r && r.finalized)
    return r;
  const t = await O(e);
  if (!t || le.has(t.status)) return null;
  const s = await ue(e), a = t.challenger_username || t.challenger, o = t.challenged_username || t.challenged;
  let n = 0, c = 0, i = 0, l = 0, u = !1, m = !1, y = !1, g = !1;
  for (const f of s)
    f.accepted && (f.username.toLowerCase() === a.toLowerCase() ? (n += f.points || 1, i += f.time_taken_seconds || 0, f.problem_slug === t.problem_1 && (u = !0), f.problem_slug === t.problem_2 && (m = !0)) : f.username.toLowerCase() === o.toLowerCase() && (c += f.points || 1, l += f.time_taken_seconds || 0, f.problem_slug === t.problem_1 && (y = !0), f.problem_slug === t.problem_2 && (g = !0)));
  const T = u && m && y && g, h = t.match_deadline && Date.now() >= new Date(t.match_deadline).getTime();
  if (T || h) {
    let f = "draw", R = "draw";
    return n > c ? (f = a, R = "points") : c > n ? (f = o, R = "points") : n > 0 ? i < l ? (f = a, R = "tiebreaker_time") : l < i ? (f = o, R = "tiebreaker_time") : (f = "draw", R = "draw") : (f = "draw", R = "draw"), await W(e, p.COMPLETED, {
      winner_username: f,
      win_reason: R,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    }), { finalized: !0, winner: f, winReason: R };
  }
  return null;
}
async function It(e, r) {
  const t = await C("forfeit_battle", { p_battle_id: e });
  if (t && t.success)
    return t;
  const s = await O(e);
  if (!s) return { success: !1, error: "Battle not found" };
  const a = s.challenger_username || s.challenger, o = s.challenged_username || s.challenged, n = a.toLowerCase() === r.toLowerCase() ? o : a;
  return await W(e, p.FORFEITED, {
    winner_username: n,
    win_reason: "forfeit",
    completed_at: (/* @__PURE__ */ new Date()).toISOString()
  }), { success: !0, winner: n };
}
async function Nt(e, r) {
  const t = await O(e);
  return t ? (t.challenger_username || t.challenger).toLowerCase() !== r.toLowerCase() ? { success: !1, error: "Only the challenger can cancel a pending match" } : t.status !== p.PENDING ? { success: !1, error: "Can only cancel pending challenges" } : (await W(e, p.CANCELLED), { success: !0 }) : { success: !1, error: "Battle not found" };
}
async function Pt(e, r = 10) {
  if (!e) return [];
  const t = e.toLowerCase(), s = await E(
    `battles?or=(challenger_username.ilike.${t},challenged_username.ilike.${t})&status=in.(completed,forfeited)&order=created_at.desc&limit=${r}`
  );
  return !s || s.length === 0 ? [] : await Promise.all(s.map(async (o) => {
    const n = await ue(o.id), c = o.challenger_username || o.challenger, i = o.challenged_username || o.challenged, l = c.toLowerCase() === e.toLowerCase() ? i : c, u = o.winner_username || o.winner;
    let m = "draw";
    return u && (u === "draw" ? m = "draw" : u.toLowerCase() === e.toLowerCase() ? m = "win" : m = "loss"), {
      ...o,
      opponent: l,
      outcome: m,
      results: n
    };
  }));
}
async function He(e) {
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
async function de(e, r = "online") {
  if (!(!e || !_ || _ === "YOUR_SUPABASE_PROJECT_URL_HERE"))
    try {
      const t = await C("heartbeat_presence", { p_status: r });
      if (t && t.success) return;
      const s = await b();
      s?.user_id && await E("user_presence", {
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
async function $t(e) {
  const r = /* @__PURE__ */ new Map();
  if (!e?.length || !_ || _ === "YOUR_SUPABASE_PROJECT_URL_HERE") return r;
  try {
    const t = await C("get_friends_presence", { p_usernames: e });
    if (t && typeof t == "object" && !t.error) {
      for (const [n, c] of Object.entries(t))
        r.set(n.toLowerCase(), {
          status: c.status || "offline",
          isOnline: !!c.isOnline,
          inBattle: !!c.inBattle,
          last_seen: c.last_seen
        });
      return r;
    }
    const s = e.map((n) => `"${n.toLowerCase()}"`).join(","), a = await E(`user_presence?username=in.(${s})&select=username,status,last_seen,in_battle`), o = Date.now() - 120 * 1e3;
    for (const n of a || []) {
      const i = n.last_seen && new Date(n.last_seen).getTime() > o ? n.in_battle ? "in_battle" : n.status || "online" : "offline";
      r.set(n.username.toLowerCase(), {
        status: i,
        isOnline: i === "online" || i === "in_battle",
        inBattle: i === "in_battle",
        last_seen: n.last_seen
      });
    }
  } catch (t) {
    console.warn("[BattleManager] getPresence failed:", t);
  }
  return r;
}
async function W(e, r, t = {}) {
  await E(`battles?id=eq.${e}`, {
    method: "PATCH",
    body: JSON.stringify({ status: r, ...t })
  });
}
function Bt(e) {
  const r = et(e);
  if (!r.valid)
    throw new Error(r.error);
  return r.username;
}
function U(e, r) {
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
function Fe(e = [], r = null, t = null) {
  const s = /* @__PURE__ */ new Set();
  if (Array.isArray(e)) {
    for (const a of e)
      if (a && a.timestamp) {
        const o = U(a.timestamp, t);
        o && s.add(o);
      }
  }
  if (r)
    try {
      const a = typeof r == "string" ? JSON.parse(r) : r;
      if (a && typeof a == "object") {
        for (const [o, n] of Object.entries(a))
          if (parseInt(n, 10) > 0) {
            const c = U(o, t);
            c && s.add(c);
          }
      }
    } catch (a) {
      console.warn("[StreakCalculator] Error parsing submissionCalendar:", a);
    }
  return Array.from(s).sort();
}
function Mt(e, r = null, t = null) {
  let s = [], a = null;
  Array.isArray(e) ? (s = e, a = r) : e && typeof e == "object" && (a = e, typeof r == "string" && (t = r));
  const o = Fe(s, a, t);
  if (o.length === 0)
    return {
      currentStreak: 0,
      longestStreak: 0,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: []
    };
  function n(A, N) {
    const Xe = /* @__PURE__ */ new Date(A + "T00:00:00Z"), Ze = /* @__PURE__ */ new Date(N + "T00:00:00Z");
    return Math.round((Ze - Xe) / 864e5);
  }
  let c = 1, i = 1;
  for (let A = 1; A < o.length; A++) {
    const N = n(o[A - 1], o[A]);
    N === 1 ? (i++, i > c && (c = i)) : N > 1 && (i = 1);
  }
  const l = Math.floor(Date.now() / 1e3), u = U(l, t), m = Math.floor((Date.now() - 864e5) / 1e3), y = U(m, t), g = o.includes(u), T = o[o.length - 1];
  if (T !== u && T !== y)
    return {
      currentStreak: 0,
      longestStreak: c,
      isAtRisk: !1,
      solvedToday: !1,
      solveDates: o
    };
  let h = 0, f = /* @__PURE__ */ new Date(T + "T00:00:00Z");
  for (let A = o.length - 1; A >= 0; A--) {
    const N = f.toISOString().split("T")[0];
    if (o[A] === N)
      h++, f.setUTCDate(f.getUTCDate() - 1);
    else if (o[A] < N)
      break;
  }
  h > c && (c = h);
  const R = h > 0 && !g;
  return {
    currentStreak: h,
    longestStreak: c,
    isAtRisk: R,
    solvedToday: g,
    solveDates: o
  };
}
function xe(e, r = null, t = null) {
  const s = Fe(e, r, t), a = Math.floor(Date.now() / 1e3), o = U(a, t);
  return s.includes(o);
}
function Ht(e) {
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
function re(e) {
  return e ? Date.now() - e > 900 * 1e3 : !0;
}
const Y = "leetfriends_notifications", be = {
  QUEUED: "QUEUED",
  DISPLAY_REQUESTED: "DISPLAY_REQUESTED",
  FAILED: "FAILED",
  IN_APP_ONLY: "IN_APP_ONLY",
  DISMISSED: "DISMISSED",
  CLICKED: "CLICKED"
};
async function qe() {
  try {
    return (await chrome.storage.local.get(Y))[Y] || {
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
async function We() {
  try {
    const e = await chrome.storage.local.get([
      "notifications_enabled",
      Y
    ]);
    if (e.notifications_enabled === !1)
      return !0;
    const r = e[Y];
    if (!r) return !1;
    const t = Date.now();
    if (r.snoozedUntil && t < r.snoozedUntil)
      return !0;
    if (r.mutedUntilUTC) {
      const s = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      if (r.mutedUntilUTC >= s) return !0;
    }
    if (r.quietHours && r.quietHours.enabled) {
      const s = (/* @__PURE__ */ new Date()).getHours() * 60 + (/* @__PURE__ */ new Date()).getMinutes(), [a, o] = (r.quietHours.start || "22:00").split(":").map(Number), [n, c] = (r.quietHours.end || "08:00").split(":").map(Number), i = a * 60 + o, l = n * 60 + c;
      if (i > l) {
        if (s >= i || s < l)
          return !0;
      } else if (s >= i && s < l)
        return !0;
    }
    return !1;
  } catch (e) {
    return console.warn("[NotificationManager] isNotificationMuted error:", e), !1;
  }
}
async function Ft(e) {
  const r = await qe();
  r.mutedUntilUTC = e, await chrome.storage.local.set({ [Y]: r });
}
async function Ye(e) {
  if (!(!Array.isArray(e) || e.length === 0))
    try {
      const r = await We(), t = Date.now(), a = (await chrome.storage.local.get("unread_notifications")).unread_notifications || [], o = e.map((i, l) => ({
        ...i,
        id: `${t}-${l}`,
        timestamp: t,
        deliveryState: r ? be.IN_APP_ONLY : be.DISPLAY_REQUESTED
      })), n = t - 1440 * 60 * 1e3, c = [...a, ...o].filter((i) => i.timestamp > n).slice(-30);
      if (await chrome.storage.local.set({ unread_notifications: c }), r) {
        console.log("[NotificationManager] Notifications muted; recorded for in-app display only.");
        return;
      }
      for (const i of e)
        try {
          let l = "LeetStreak";
          i.type === "new_submission" ? l = "🎯 Friend Solved a Problem!" : i.type === "milestone" ? l = "🔥 Streak Milestone Reached!" : i.type === "streak_at_risk" ? l = "⚠️ Streak At Risk!" : i.type === "battle_invite" ? l = "⚔️ 1v1 Battle Challenge!" : i.type === "battle_opponent_solved" ? l = "⚔️ Opponent Solved a Problem!" : i.type === "roast" && (l = "🔥 Motivation Roast Received!");
          const u = `leetstreak-${i.type}-${t}-${Math.floor(Math.random() * 1e3)}`;
          await chrome.notifications.create(u, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon128.png"),
            title: l,
            message: i.message || "",
            priority: i.priority || 2,
            requireInteraction: i.type === "streak_at_risk" || i.type === "battle_invite"
          });
        } catch (l) {
          console.warn("[NotificationManager] chrome.notifications.create failed:", l);
        }
    } catch (r) {
      console.error("[NotificationManager] Error in batchNotify:", r);
    }
}
const xt = () => (/* @__PURE__ */ new Date()).toISOString().split("T")[0], qt = () => {
  const e = /* @__PURE__ */ new Date();
  return e.setUTCDate(e.getUTCDate() - 1), e.toISOString().split("T")[0];
};
function Wt(e) {
  return [7, 30, 100].includes(e);
}
function Yt(e, r) {
  if (r === 0) return !1;
  const t = qt(), s = xt();
  return !(Array.isArray(e) ? e : []).some((n) => {
    const c = parseInt(n.timestamp, 10);
    if (isNaN(c) || c <= 0) return !1;
    const i = new Date(c * 1e3).toISOString().split("T")[0];
    return i === s || i === t;
  });
}
function jt(e, r, t) {
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
const Te = 1.7, Ae = 30, ke = 19, Ce = 4, Re = "schedule_preferences";
async function X() {
  try {
    return (await chrome.storage.local.get(Re))[Re] || {
      activeInterval: Te,
      quietInterval: Ae,
      activeStartHour: ke,
      activeEndHour: Ce
    };
  } catch (e) {
    return console.error("Error loading schedule preferences:", e), {
      activeInterval: Te,
      quietInterval: Ae,
      activeStartHour: ke,
      activeEndHour: Ce
    };
  }
}
async function fe(e = null) {
  e || (e = await X());
  const t = (/* @__PURE__ */ new Date()).getHours(), { activeStartHour: s, activeEndHour: a } = e;
  return s > a ? t >= s || t < a : t >= s && t < a;
}
async function me() {
  const e = await X();
  return await fe(e) ? e.activeInterval : e.quietInterval;
}
async function Jt() {
  const e = await X(), r = /* @__PURE__ */ new Date(), t = r.getHours(), s = r.getMinutes();
  let a;
  await fe(e) ? a = e.activeEndHour : a = e.activeStartHour;
  let o = a - t;
  return o < 0 && (o += 24), o === 0 && s > 0 && (o = 24), o * 60 - s;
}
async function he() {
  const e = await X(), r = await me(), t = await fe(e), s = De(e.activeStartHour), a = De(e.activeEndHour);
  return t ? `Active Mode: Checking every ${r} minutes (${s} - ${a})` : `Quiet Mode: Checking every ${r} minutes`;
}
async function Gt() {
  const e = await me(), r = await Jt(), t = Math.min(e, r);
  return {
    intervalMinutes: t,
    description: await he(),
    isTransitionCheck: t === r && t < e
  };
}
function De(e) {
  return e === 0 ? "12:00 AM" : e < 12 ? `${e}:00 AM` : e === 12 ? "12:00 PM" : `${e - 12}:00 PM`;
}
const je = [
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
], Je = [
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
], Ge = [
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
function v(e, r = {}) {
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
  const o = a.hostname.toLowerCase(), n = P(o);
  if (n.includes("leetcode.com"))
    return { isDistraction: !1, reason: "SYSTEM_ALLOW_LEETCODE", label: "LeetCode" };
  for (const c of s) {
    if (!c) continue;
    const i = c.trim().toLowerCase();
    if (e.toLowerCase().includes(i) || n === P(i))
      return { isDistraction: !1, reason: "USER_ALLOWLIST", label: c };
  }
  for (const c of Ge)
    if (n === P(c.domain)) {
      for (const i of c.allowedPrefixes)
        if (a.pathname.startsWith(i))
          return { isDistraction: !1, reason: "EDUCATIONAL_EXCEPTION", label: `${c.domain}${i}` };
    }
  for (const c of Je)
    if (n === P(c.domain)) {
      for (const i of c.paths)
        if (a.pathname.startsWith(i))
          return { isDistraction: !0, reason: "PATH_DISTRACTION", label: c.label };
    }
  for (const c of t) {
    if (!c) continue;
    const i = P(c.trim().toLowerCase());
    if (n === i || n.endsWith("." + i))
      return { isDistraction: !0, reason: "CUSTOM_BLOCKED_DOMAIN", label: i };
  }
  for (const c of je) {
    const i = P(c);
    if (n === i || n.endsWith("." + i))
      return { isDistraction: !0, reason: "DEFAULT_BLOCKED_DOMAIN", label: i };
  }
  return { isDistraction: !1, reason: "UNRESTRICTED", label: "" };
}
function zt(e = {}) {
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
    const c = n.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    s.push({
      id: a++,
      priority: 5,
      action: { type: "allow" },
      condition: {
        requestDomains: [c],
        resourceTypes: ["main_frame"]
      }
    });
  }
  for (const n of Ge)
    for (const c of n.allowedPrefixes)
      s.push({
        id: a++,
        priority: 3,
        action: { type: "allow" },
        condition: {
          requestDomains: [n.domain],
          urlFilter: `*${c}*`,
          resourceTypes: ["main_frame"]
        }
      });
  for (const n of Je)
    for (const c of n.paths)
      s.push({
        id: a++,
        priority: 2,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html" }
        },
        condition: {
          requestDomains: [n.domain],
          urlFilter: `*${c}*`,
          resourceTypes: ["main_frame"]
        }
      });
  const o = Array.from(/* @__PURE__ */ new Set([...je, ...r]));
  for (const n of o) {
    if (!n || !n.trim()) continue;
    const c = P(n.trim());
    s.push({
      id: a++,
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
    ]), r = e.user_timezone, t = Math.floor(Date.now() / 1e3), s = U(t, r);
    if (!e.hardcore_mode_enabled)
      return { active: !1, reason: "HARDCORE_DISABLED", todayStr: s, streak: 0 };
    const a = e.my_leetcode_username;
    let o = e.own_profile;
    if (!o && a)
      try {
        const n = await chrome.storage.local.get(["friends_cache"]);
        if (n.friends_cache) {
          const c = Object.keys(n.friends_cache).find((i) => i.toLowerCase() === a.toLowerCase());
          c && (o = n.friends_cache[c]);
        }
        o || (o = await ce(a));
      } catch (n) {
        console.warn("[BlockerManager] Error fetching cached friend data:", n);
      }
    if (o) {
      const n = o.stats?.streak || 0;
      return xe(o.allAcceptedSubmissions, o.submissionCalendar, r) ? (await chrome.storage.local.set({ last_solve_date: s }), { active: !1, reason: "SOLVED_TODAY_CANONICAL", todayStr: s, streak: n }) : (e.last_solve_date === s && await chrome.storage.local.remove("last_solve_date"), { active: !0, reason: "UNSOLVED_TODAY", todayStr: s, streak: n });
    }
    return e.last_solve_date === s ? { active: !1, reason: "SOLVED_TODAY_CACHE", todayStr: s, streak: 0 } : { active: !0, reason: "NO_PROFILE_UNSOLVED", todayStr: s, streak: 0 };
  } catch (e) {
    return console.error("[BlockerManager] isBlockerActive check error:", e), { active: !1, reason: `ERROR: ${e.message}`, todayStr: "", streak: 0 };
  }
}
async function I() {
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
    const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = zt({
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
    }), await Qt(), { success: !0, locked: !0, ruleCount: a.length, reason: e.reason };
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
let Le = !1;
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
async function Qt() {
  if (typeof chrome > "u" || !chrome.tabs || !chrome.tabs.query)
    return { sweptCount: 0, redirectedTabs: [] };
  try {
    if (!(await D()).active)
      return { sweptCount: 0, redirectedTabs: [] };
    const r = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), t = r.custom_blocked_domains || [], s = r.allowlist || [], a = await chrome.tabs.query({}), o = [];
    for (const n of a) {
      if (!n.id || !n.url || n.url.includes("blocked.html") || n.url.startsWith("chrome") || n.url.startsWith("about:") || n.url.startsWith("edge:") || n.url.includes("leetcode.com"))
        continue;
      const c = v(n.url, { customBlocked: t, allowlist: s });
      c.isDistraction && (console.log(`[BlockerManager] Sweeping open distracting tab #${n.id}: ${n.url} (${c.label || c.reason})`), $(n.id, n.url, c.label), o.push({ id: n.id, url: n.url }));
    }
    return { sweptCount: o.length, redirectedTabs: o };
  } catch (e) {
    return console.warn("[BlockerManager] sweepOpenTabs error:", e), { sweptCount: 0, redirectedTabs: [], error: e.message };
  }
}
function Vt() {
  Le || typeof chrome > "u" || (Le = !0, I().catch((e) => console.error("[BlockerManager] Startup sync failed:", e)), chrome.webNavigation && chrome.webNavigation.onBeforeNavigate && chrome.webNavigation.onBeforeNavigate.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await D()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = v(e.url, {
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
        if (!(await D()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = v(e.url, {
          customBlocked: t.custom_blocked_domains || [],
          allowlist: t.allowlist || []
        });
        s.isDistraction && $(e.tabId, e.url, s.label);
      } catch {
      }
  }), chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated && chrome.webNavigation.onHistoryStateUpdated.addListener(async (e) => {
    if (e.frameId === 0 && !(!e.url || e.url.includes("blocked.html") || e.url.startsWith("chrome") || e.url.startsWith("about:")))
      try {
        if (!(await D()).active) return;
        const t = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), s = v(e.url, {
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
        if (!(await D()).active) return;
        const o = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), n = v(s, {
          customBlocked: o.custom_blocked_domains || [],
          allowlist: o.allowlist || []
        });
        n.isDistraction && $(e, s, n.label);
      } catch {
      }
  }), chrome.tabs && chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(async (e) => {
    try {
      if (!(await D()).active) return;
      const t = await chrome.tabs.get(e.tabId);
      if (!t || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
      const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = v(t.url, {
        customBlocked: s.custom_blocked_domains || [],
        allowlist: s.allowlist || []
      });
      a.isDistraction && (console.log(`[BlockerManager] onActivated blocking active tab #${e.tabId} (${t.url})`), $(e.tabId, t.url, a.label));
    } catch {
    }
  }), chrome.windows && chrome.windows.onFocusChanged && chrome.windows.onFocusChanged.addListener(async (e) => {
    if (!(typeof chrome.windows.WINDOW_ID_NONE < "u" && e === chrome.windows.WINDOW_ID_NONE))
      try {
        if (!(await D()).active) return;
        const [t] = await chrome.tabs.query({ active: !0, windowId: e });
        if (!t || !t.id || !t.url || t.url.includes("blocked.html") || t.url.startsWith("chrome") || t.url.startsWith("about:") || t.url.startsWith("edge:") || t.url.includes("leetcode.com")) return;
        const s = await chrome.storage.local.get(["custom_blocked_domains", "allowlist"]), a = v(t.url, {
          customBlocked: s.custom_blocked_domains || [],
          allowlist: s.allowlist || []
        });
        a.isDistraction && (console.log(`[BlockerManager] onFocusChanged blocking window tab #${t.id} (${t.url})`), $(t.id, t.url, a.label));
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
    ].some((a) => e[a]) && I().catch((a) => {
      console.error("[BlockerManager] Storage change sync error:", a);
    });
  }), console.log("🛡️ [BlockerManager] Multi-layer network blocker initialized"));
}
function Kt() {
  if (Vt(), typeof chrome > "u" || !chrome.tabs) {
    console.warn("[TabMonitor] chrome.tabs API not available");
    return;
  }
  chrome.tabs.onUpdated.addListener(async (e, r, t) => {
    if (r.status === "complete" && t?.url)
      try {
        if (!(await D()).active) return;
        const a = v(t.url);
        if (a.isDistraction && !t.url.includes("blocked.html")) {
          const o = chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(t.url)}&label=${encodeURIComponent(a.label)}`);
          chrome.tabs.update(e, { url: o });
        }
      } catch {
      }
  }), console.log("✅ [TabMonitor] Hardcore Mode Tab Monitor and Blocker initialized");
}
const se = "leetfriends_sync", Xt = "schedule_transition_check", j = "presence_heartbeat_alarm", ze = 500;
self.addEventListener("error", (e) => {
  console.error("[ServiceWorker] Uncaught error:", e.error);
});
self.addEventListener("unhandledrejection", (e) => {
  console.error("[ServiceWorker] Uncaught promise rejection:", e.reason);
});
Kt();
ft().catch((e) => {
  console.warn("[ServiceWorker] Session restoration (non-blocking):", e.message);
});
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[ServiceWorker] Installed - setting up sync alarm and cleaning legacy keys"), _e(), Zt(), await I();
  try {
    await chrome.alarms.clear(j), chrome.alarms.create(j, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    });
  } catch {
  }
});
chrome.runtime.onStartup.addListener(async () => {
  console.log("[ServiceWorker] Browser startup - reconciling blocker rules & presence"), await I();
  try {
    await chrome.alarms.clear(j), chrome.alarms.create(j, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    }), await Ve();
  } catch {
  }
});
async function Zt() {
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
async function _e() {
  const e = Gt(), r = e?.intervalMinutes || 30;
  try {
    await chrome.alarms.clear(se), await chrome.alarms.clear(Xt), chrome.alarms.create(se, {
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
async function er() {
  try {
    const r = (await chrome.storage.local.get("current_schedule")).current_schedule, t = me();
    (!r || Math.abs(r.interval - t) > 0.1) && (console.log(`[ServiceWorker] Transitioning schedule: ${he()}`), await _e());
  } catch (e) {
    console.warn("[ServiceWorker] checkScheduleTransition error:", e);
  }
}
chrome.alarms.onAlarm.addListener(async (e) => {
  e.name === se ? (console.log(`[ServiceWorker] Background sync triggered - ${he()}`), await er(), await Qe(), await I()) : e.name === j && await Ve();
});
chrome.runtime.onMessage.addListener((e, r, t) => {
  if (e.type === "PING") {
    t({ pong: !0 });
    return;
  }
  switch (e.type) {
    case "FETCH_STATS":
      return tr(e.forceRefresh).then(t), !0;
    case "ADD_FRIEND":
      return sr(e.username).then(t), !0;
    case "REMOVE_FRIEND":
      return ar(e.username).then(t), !0;
    case "GET_FRIENDS":
      return or().then(t), !0;
    case "MUTE_NOTIFICATIONS":
      return Ft(e.untilUTC).then(() => t({ success: !0 })), !0;
    case "GET_NOTIFICATION_STATE":
      return qe().then((s) => t({ success: !0, state: s })), !0;
    case "ADD_TO_QUEUE":
      return nr(e.problemData).then(t), !0;
    case "SUBMISSION_ACCEPTED":
      return cr(e.problemSlug, e.title).then(t), !0;
    case "SYNC_BLOCKER_RULES":
      return I().then(t), !0;
    case "GET_BLOCKER_STATUS":
      return D().then(t), !0;
    case "SHOW_NOTIFICATION":
      return Ye([{
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
      return _e().then(() => t({ success: !0 })), !0;
    // ===== 1v1 Battle System =====
    case "BATTLE_GET_STATUS":
      return ur(e.username).then(t), !0;
    case "BATTLE_CHALLENGE":
      return dr(e.challenger, e.challenged, e.language).then(t), !0;
    case "BATTLE_RESPOND":
      return fr(e.battleId, e.username, e.accept).then(t), !0;
    case "BATTLE_PICK_PROBLEM":
      return mr(e.battleId, e.username, e.slug, e.title).then(t), !0;
    case "BATTLE_READY":
      return hr(e.battleId, e.username).then(t), !0;
    case "BATTLE_SUBMISSION":
      return _r(e).then(t), !0;
    case "BATTLE_FORFEIT":
      return wr(e.battleId, e.username).then(t), !0;
    case "BATTLE_CANCEL":
      return gr(e.battleId, e.username).then(t), !0;
    case "BATTLE_VALIDATE_PROBLEM":
      return He(e.slugOrUrl).then(t), !0;
    case "BATTLE_PING_PRESENCE":
      return yr(e.username).then(t), !0;
    case "BATTLE_GET_PRESENCE":
      return pr(e.usernames).then(t), !0;
    case "BATTLE_GET_ONLINE_FRIENDS":
      return pt().then((s) => t({ success: !0, friends: s })).catch((s) => t({ success: !1, error: s.message, friends: [] })), !0;
    case "SYNC_FRIENDSHIPS":
      return (async () => {
        if (!Array.isArray(e.usernames))
          return t({ success: !0, count: 0 });
        const s = await Promise.all(
          e.usernames.map((a) => Se(a).catch(() => ({ success: !1 })))
        );
        t({ success: !0, count: s.filter((a) => a?.success).length });
      })().catch((s) => t({ success: !1, error: s.message })), !0;
    case "GET_LOGGED_IN_USER":
      return ir().then(t), !0;
    case "FETCH_OWN_PROFILE":
      return rr(e.forceRefresh).then(t), !0;
    // ===== Cloud Authentication & Account =====
    case "GET_AUTH_STATE":
      return (async () => {
        const s = await b();
        t({
          success: !0,
          state: F(),
          session: s ? { user_id: s.user_id, email: s.email, expires_at: s.expires_at } : null,
          isRateLimited: B(),
          cooldownSeconds: ae()
        });
      })().catch((s) => t({ success: !1, error: s.message })), !0;
    case "SIGN_IN_EMAIL":
      return ht(e.email, e.password).then(async (s) => {
        try {
          const a = await chrome.storage.local.get(["my_leetcode_username", "friends_cache"]);
          if (a.my_leetcode_username && await de(a.my_leetcode_username, "online"), a.friends_cache) {
            const o = Object.keys(a.friends_cache);
            await Promise.all(o.map((n) => Se(n).catch(() => {
            })));
          }
        } catch {
        }
        t({ success: !0, session: { user_id: s.user_id, email: s.email } });
      }).catch((s) => t({ success: !1, error: s.message, isRateLimited: B() })), !0;
    case "SIGN_UP_EMAIL":
      return _t(e.email, e.password).then((s) => t(s)).catch((s) => t({ success: !1, error: s.message, isRateLimited: B() })), !0;
    case "SIGN_OUT":
      return wt().then(async (s) => {
        try {
          await yt();
        } catch {
        }
        t(s);
      }).catch((s) => t({ success: !1, error: s.message })), !0;
    // ===== Roasts =====
    case "SEND_ROAST":
      return Sr(e.targetUsername, e.fromUsername, e.message).then(t), !0;
    case "CLEAR_ROASTS":
      return (async () => {
        const s = await chrome.storage.local.get("my_leetcode_username");
        return s.my_leetcode_username && await $e(s.my_leetcode_username), { success: await Me() };
      })().then(t), !0;
    default:
      t({ success: !1, error: `Unknown message type: ${e.type}` });
  }
});
chrome.notifications.onClicked.addListener((e) => {
  (e.includes("streak") || e.includes("roast") || e.includes("solve")) && (chrome.tabs.create({ url: "https://leetcode.com/problemset/" }), chrome.notifications.clear(e));
});
async function tr(e = !1) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured. Please enter your username." };
    let s = await ne(), a = !1;
    if (e || !s || re(s.lastUpdated)) {
      console.log(`[ServiceWorker] Fetching own LeetCode data for: ${t}`);
      try {
        const u = await x(t);
        s = await J(u, r.user_timezone), await K(s), a = !0;
      } catch (u) {
        if (console.error(`[ServiceWorker] Error fetching own LeetCode profile for ${t}:`, u), !s)
          return {
            success: !1,
            error: `Failed to fetch LeetCode data for ${t}: ${u.message}`,
            isLeetCodeError: !0
          };
      }
    }
    let n = await te();
    const c = await Be();
    let i = e;
    if (!i && c.length > 0) {
      for (const u of c)
        if (!n[u] || re(n[u]?.lastUpdated)) {
          i = !0;
          break;
        }
    }
    if (i && c.length > 0) {
      console.log("[ServiceWorker] Syncing friends data...");
      for (const u of c)
        if (u.toLowerCase() !== t.toLowerCase())
          try {
            const m = await x(u), y = await J(m, r.user_timezone);
            await ie(u, y), await Ke(ze);
          } catch (m) {
            console.warn(`[ServiceWorker] Error updating friend ${u}:`, m.message);
          }
      n = await te();
    }
    const l = { ...n };
    return s && (l[t] = s), {
      success: !0,
      ownProfile: s,
      friends: l,
      refreshed: a || i
    };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchStats error:", r), { success: !1, error: r.message };
  }
}
async function rr(e = !1) {
  try {
    const r = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), t = r.my_leetcode_username;
    if (!t)
      return { success: !1, error: "No LeetCode username configured" };
    let s = await ne();
    if (e || !s || re(s.lastUpdated)) {
      const o = await x(t);
      s = await J(o, r.user_timezone), await K(s);
    }
    return { success: !0, ownProfile: s };
  } catch (r) {
    return console.error("[ServiceWorker] handleFetchOwnProfile error:", r), { success: !1, error: r.message };
  }
}
async function sr(e) {
  try {
    const r = e;
    let t;
    try {
      t = Bt(e);
    } catch (n) {
      return { success: !1, error: n.message };
    }
    if (await ce(t))
      return { success: !1, error: `${r} is already in your friends list` };
    const a = await x(r), o = await J(a);
    return await ie(t, o), { success: !0, message: `${r} added successfully`, data: o };
  } catch (r) {
    return console.error("[ServiceWorker] handleAddFriend error:", r), { success: !1, error: r.message || "User not found or profile is private" };
  }
}
async function ar(e) {
  try {
    return await bt(e), { success: !0, message: `${e} removed` };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function or() {
  try {
    return { success: !0, friends: await te() };
  } catch (e) {
    return { success: !1, error: e.message };
  }
}
async function nr(e) {
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
async function cr(e, r) {
  try {
    const t = await chrome.storage.local.get(["my_leetcode_username", "user_timezone", "problem_queue"]), s = U(Math.floor(Date.now() / 1e3), t.user_timezone);
    if (await chrome.storage.local.set({ last_solve_date: s }), console.log(`[ServiceWorker] Solve recorded today (${s}) — Hardcore Mode unlocked!`), await I(), t.problem_queue && Array.isArray(t.problem_queue)) {
      const a = t.problem_queue.map((o) => o.slug === e || o.id === e || r && o.title === r ? { ...o, status: "completed" } : o);
      await chrome.storage.local.set({ problem_queue: a });
    }
    return Qe().catch(console.error), { success: !0 };
  } catch (t) {
    return console.error("[ServiceWorker] handleSubmissionAccepted error:", t), { success: !1, error: t.message };
  }
}
async function ir() {
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
async function Qe() {
  try {
    const e = await chrome.storage.local.get(["my_leetcode_username", "user_timezone"]), r = e.my_leetcode_username, t = e.user_timezone, s = await Be(), a = r ? [.../* @__PURE__ */ new Set([r, ...s])] : s;
    console.log(`[ServiceWorker] Syncing ${a.length} profile(s): ${a.join(", ")}`);
    const o = [];
    if (r)
      try {
        const n = await Pe(r);
        if (n && n.length > 0) {
          const i = [];
          for (const l of n)
            o.push({
              type: "roast",
              username: l.sender_username,
              message: `${l.sender_username} roasted you: "${l.content}" 🔥`,
              priority: 2
            }), l.status === "sent" && i.push(l.id);
          i.length > 0 && await St(i);
        }
        const c = await G(r);
        if (c?.pending_roasts && c.pending_roasts.length > 0) {
          for (const i of c.pending_roasts)
            o.push({
              type: "roast",
              username: i.from,
              message: `${i.from} roasted you: "${i.message}" 🔥`,
              priority: 2
            });
          await Me();
        }
      } catch (n) {
        console.warn("[ServiceWorker] Error checking pending roasts:", n);
      }
    for (const n of a)
      try {
        const c = await ce(n), i = await x(n), l = await J(i, t);
        if (await ie(n, l), r && n.toLowerCase() === r.toLowerCase()) {
          if (await K(l), xe(l.allAcceptedSubmissions, l.submissionCalendar, t)) {
            const u = U(Math.floor(Date.now() / 1e3), t);
            await chrome.storage.local.set({ last_solve_date: u });
          }
          await I();
        }
        if (!await We()) {
          const u = await lr(n, c, l, r);
          o.push(...u), r && n.toLowerCase() === r.toLowerCase() && Yt(l.allAcceptedSubmissions, l.stats.streak) && o.push({
            username: "You",
            type: "streak_at_risk",
            message: jt("You", "streak_at_risk", { streak: l.stats.streak }),
            priority: 3
          });
        }
        await Ke(ze);
      } catch (c) {
        console.warn(`[ServiceWorker] Error syncing ${n}:`, c);
      }
    o.length > 0 && await Ye(o);
  } catch (e) {
    console.error("[ServiceWorker] syncAllFriends error:", e);
  }
}
async function lr(e, r, t, s) {
  const a = [];
  if (s && e.toLowerCase() === s.toLowerCase())
    return a;
  if (r?.stats && t?.stats) {
    const o = r.stats.total || 0, n = t.stats.total || 0;
    if (n > o) {
      const c = n - o;
      let i = "a problem";
      t.recentSubmissions && t.recentSubmissions.length > 0 && (i = t.recentSubmissions[0].title || i), a.push({
        username: e,
        type: "new_submission",
        message: `${e} just solved ${c === 1 ? `"${i}"` : `${c} problems`}! 🎯`,
        priority: 1
      });
    }
  }
  if (t.stats?.streak && Wt(t.stats.streak)) {
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
async function J(e, r = null) {
  const { profile: t, contestRanking: s, submissionCalendar: a, allAcceptedSubmissions: o } = e, { currentStreak: n, longestStreak: c } = Mt(
    o || [],
    a || {},
    r
  ), i = Ht(t.submitStats?.acSubmissionNum);
  return {
    profile: {
      username: t.username,
      realName: t.profile?.realName || "",
      avatar: t.profile?.userAvatar || "",
      ranking: t.profile?.ranking || 0
    },
    stats: {
      ...i,
      streak: n,
      longestStreak: c
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
async function ur(e) {
  try {
    const r = await chrome.storage.local.get("my_leetcode_username"), t = e || r.my_leetcode_username;
    if (!t) return { success: !1, error: "No username configured" };
    const [s, a] = await Promise.all([
      V(t),
      Pt(t, 10)
    ]);
    if (!s) return { success: !0, battle: null, history: a };
    const o = await ue(s.id);
    return { success: !0, battle: s, results: o, history: a };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function dr(e, r, t) {
  try {
    const s = await chrome.storage.local.get("my_leetcode_username"), a = e || s.my_leetcode_username;
    return await Rt(a, r, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function fr(e, r, t) {
  try {
    const s = await chrome.storage.local.get("my_leetcode_username"), a = r || s.my_leetcode_username;
    return await Dt(e, a, t);
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
async function mr(e, r, t, s) {
  try {
    const a = await chrome.storage.local.get("my_leetcode_username"), o = r || a.my_leetcode_username;
    return await Lt(e, o, t, s);
  } catch (a) {
    return { success: !1, error: a.message };
  }
}
async function hr(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await vt(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
  }
}
async function _r(e) {
  try {
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    if (!t) return { success: !1, error: "No username configured" };
    const s = await V(t);
    return s ? await Ot(s.id, t, {
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
async function wr(e, r) {
  try {
    const t = await chrome.storage.local.get("my_leetcode_username"), s = r || t.my_leetcode_username;
    return await It(e, s);
  } catch (t) {
    return { success: !1, error: t.message };
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
async function Ve() {
  try {
    if (!(await b())?.user_id) return;
    const t = (await chrome.storage.local.get("my_leetcode_username")).my_leetcode_username;
    t && await de(t, "online");
  } catch (e) {
    console.warn("[ServiceWorker] handlePresenceHeartbeat error:", e);
  }
}
async function yr(e) {
  try {
    const r = await chrome.storage.local.get("my_leetcode_username"), t = e || r.my_leetcode_username;
    return t && await de(t), { success: !0 };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function pr(e) {
  try {
    if (!e?.length) return { success: !0, presenceMap: {} };
    const r = await $t(e);
    return { success: !0, presenceMap: Object.fromEntries(r) };
  } catch (r) {
    return { success: !1, error: r.message };
  }
}
async function Sr(e, r, t) {
  try {
    return await Ne(e, r, t) ? { success: !0 } : { success: await Tt(e, r, t) };
  } catch (s) {
    return { success: !1, error: s.message };
  }
}
function Ke(e) {
  return new Promise((r) => setTimeout(r, e));
}
