import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Swords, Trophy, Clock, ChevronRight, X, Check, AlertCircle, ExternalLink, Flag, RefreshCw, Loader2, Sparkles, UserCheck } from 'lucide-react';
import { BATTLE_STATUS, REVEAL_COUNTDOWN_SECONDS, SELECTION_WINDOW_SECONDS, calculateScores } from '../shared/battle-manager.js';
import { SUPABASE_URL } from '../shared/supabase-client.js';
import { PresenceIndicator, AvatarWithPresence } from './PresenceIndicator.jsx';

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function formatDuration(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return '--:--:--';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function formatTimeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}


function useCountdown(targetIso) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!targetIso) return;
    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(targetIso) - Date.now()) / 1000));
      setRemaining(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}

function useElapsedTimer(startIso) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startIso) {
      const timeoutId = setTimeout(() => setElapsed(0), 0);
      return () => clearTimeout(timeoutId);
    }
    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
      setElapsed(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startIso]);
  return elapsed;
}


const DIFFICULTY_BADGE = {
  Easy:   'bg-green-500/15 text-green-400 border-green-500/30',
  Medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Hard:   'bg-red-500/15 text-red-400 border-red-500/30'
};

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function HistoryRow({ battle }) {
  const { opponent, outcome, final_problem_title, created_at } = battle;
  const icon = outcome === 'win' ? '🏆' : outcome === 'loss' ? '💀' : '🤝';
  const outcomeColor = outcome === 'win'
    ? 'text-amber-400' : outcome === 'loss'
    ? 'text-red-400' : 'text-text-muted';

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-surface/40 rounded-lg border border-surfaceHover/30 hover:border-surfaceHover/60 transition-all">
      <span className="text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-text-main truncate">vs {opponent}</p>
        <p className="text-[10px] text-text-muted truncate">{final_problem_title || 'Unknown problem'}</p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className={`text-[10px] font-bold uppercase ${outcomeColor}`}>{outcome}</span>
        <span className="text-[9px] text-text-muted">{formatTimeAgo(created_at)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

function BattleView({ myUsername, friends, returnTarget = null, onAuthSuccess = null, presenceMap: externalPresenceMap = null }) {
  const [battle, setBattle] = useState(null);
  const [myResult, setMyResult] = useState(null);
  const [oppResult, setOppResult] = useState(null);
  const [allResults, setAllResults] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [friendsList, setFriendsList] = useState([]);
  const [presenceMap, setPresenceMap] = useState({});
  const [onlineFriendsServer, setOnlineFriendsServer] = useState([]);
  const [presenceRefreshing, setPresenceRefreshing] = useState(false);
  const [authState, setAuthState] = useState('AUTHENTICATED');

  // Exclusive Battle Auth Form State
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');
  const [authCooldown, setAuthCooldown] = useState(0);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (res) => {
        if (res && res.success) {
          setAuthState(res.state);
          if (res.cooldownSeconds > 0) {
            setAuthCooldown(res.cooldownSeconds);
          }
        }
      });
    }
  }, []);

  useEffect(() => {
    if (authCooldown <= 0) return;
    const timer = setInterval(() => {
      setAuthCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [authCooldown]);

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    if (authSubmitting) return;

    setAuthError('');
    setAuthSuccessMsg('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!authEmail.trim() || !emailRegex.test(authEmail.trim())) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    if (!authPassword || authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }

    if (authCooldown > 0) {
      setAuthError(`Rate limit cooldown active. Please wait ${authCooldown} seconds.`);
      return;
    }

    setAuthSubmitting(true);
    try {
      if (authMode === 'signin') {
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'SIGN_IN_EMAIL',
            email: authEmail.trim(),
            password: authPassword
          }, resolve);
        });

        if (res?.success) {
          setAuthState('AUTHENTICATED');
          setAuthPassword('');
          if (onAuthSuccess) onAuthSuccess(returnTarget);
        } else {
          if (res?.isRateLimited) {
            setAuthCooldown(60);
          }
          setAuthError(res?.error || 'Invalid email or password.');
        }
      } else {
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'SIGN_UP_EMAIL',
            email: authEmail.trim(),
            password: authPassword
          }, resolve);
        });

        if (res?.success) {
          if (res.confirmationRequired) {
            setAuthSuccessMsg('Account created! A confirmation link has been sent to your email. Please verify before signing in.');
            setAuthMode('signin');
            setAuthPassword('');
          } else {
            setAuthState('AUTHENTICATED');
            setAuthPassword('');
            if (onAuthSuccess) onAuthSuccess(returnTarget);
          }
        } else {
          if (res?.isRateLimited) {
            setAuthCooldown(60);
          }
          setAuthError(res?.error || 'Failed to create account.');
        }
      }
    } catch (err) {
      setAuthError(err.message || 'Network error occurred. Please try again.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  // UI states
  const [selectedFriend, setSelectedFriend] = useState('');
  const [problemUrl, setProblemUrl] = useState('');
  const [problemValidation, setProblemValidation] = useState(null); // { valid, title, difficulty, slug, url } | { valid: false, error }
  const [validating, setValidating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [revealCountdown, setRevealCountdown] = useState(null);

  // Countdown hooks
  const expiresIn = useCountdown(battle?.expires_at);
  const selectionEndsIn = useCountdown(
    battle?.selection_starts
      ? new Date(new Date(battle.selection_starts).getTime() + SELECTION_WINDOW_SECONDS * 1000).toISOString()
      : null
  );
  const battleTimeLeft = useCountdown(battle?.time_limit_ends);
  const timedOut = battleTimeLeft === 0;

  // Poll interval ref
  const pollRef = useRef(null);

  // Unconditional active problem start time computation for the elapsed timer hook
  const isP1Global = battle ? [BATTLE_STATUS.STARTING, BATTLE_STATUS.PROBLEM_1_ACTIVE, BATTLE_STATUS.PROBLEM_1_WAITING].includes(battle.status) : false;
  const problemStartTime = battle ? (isP1Global ? battle.p1_start_time : battle.p2_start_time) : null;
  const elapsedSeconds = useElapsedTimer(problemStartTime);

  // ─── Derived state ───────────────────────────────────────
  const opponent = battle
    ? (battle.challenger === myUsername ? battle.challenged : battle.challenger)
    : null;

  const amChallenger = battle?.challenger === myUsername;

  const view = (() => {
    if (!battle) return 'home';
    switch (battle.status) {
      case BATTLE_STATUS.PENDING:
        return amChallenger ? 'waiting' : 'incoming';
      case BATTLE_STATUS.ACCEPTED:
      case BATTLE_STATUS.SELECTING:
        return 'selecting';
      case BATTLE_STATUS.READY_CHECK:
        return 'ready_check';
      case BATTLE_STATUS.COUNTDOWN:
        return 'reveal';
      case BATTLE_STATUS.IN_PROGRESS:
        return 'active';
      case BATTLE_STATUS.COMPLETED:
      case BATTLE_STATUS.FORFEITED:
        return 'result';
      default:
        return 'home';
    }
  })();

  // ─── Poll for updates ─────────────────────────────────────
  // Use a ref to hold the latest battle without causing fetchBattleState to
  // re-create on every poll (which would cause overlapping intervals).
  const battleRef = useRef(battle);
  useEffect(() => { battleRef.current = battle; }, [battle]);

  const fetchBattleState = useCallback(async () => {
    if (!myUsername) return;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_STATUS' });
      if (resp?.battle) {
        const prev = battleRef.current;
        setBattle(resp.battle);

        // Fix 5: Use ref to compare status — avoids stale closure
        if (prev?.status === BATTLE_STATUS.READY_CHECK &&
            resp.battle.status === BATTLE_STATUS.COUNTDOWN) {
          setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
        }
      } else {
        setBattle(null);
      }
      if (resp?.results && resp?.battle) {
        setAllResults(resp.results || []);
        const myP1 = resp.results.find(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.problem_slug === resp.battle.problem_1);
        setMyResult(myP1 || null);
        const oppP1 = resp.results.find(r => r.username?.toLowerCase() !== myUsername?.toLowerCase() && r.problem_slug === resp.battle.problem_1);
        setOppResult(oppP1 || null);
      } else if (!resp?.battle) {
        setAllResults([]);
      }
      if (resp?.history) setHistory(resp.history);
    } catch (err) {
      console.error('[BattleView] Poll error:', err);
    } finally {
      setLoading(false);
    }
  }, [myUsername]); // Fix 9: stable deps — battle tracked via ref, not dependency

  useEffect(() => {
    // Fix 4: support both data shapes — top-level username or nested profile.username
    setFriendsList(
      Array.isArray(friends)
        ? friends.filter(f => {
            const name = f?.username || f?.profile?.username;
            return name && name !== myUsername;
          })
        : []
    );
  }, [friends, myUsername]);

  useEffect(() => {
    fetchBattleState();
    pollRef.current = setInterval(fetchBattleState, 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchBattleState]);

  // ─── Presence System ──────────────────────────────────────
  const fetchPresence = useCallback(async (isManual = false) => {
    if (!myUsername) return;
    if (isManual) setPresenceRefreshing(true);
    try {
      // 1. Ping my own presence
      await chrome.runtime.sendMessage({ type: 'BATTLE_PING_PRESENCE', username: myUsername });
      
      // 2. Fetch server-verified online friends
      const onlineResp = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_ONLINE_FRIENDS' });
      if (onlineResp?.success && Array.isArray(onlineResp.friends)) {
        setOnlineFriendsServer(onlineResp.friends);
      }

      // 3. Fetch presence map for all friends
      const usernames = friendsList.map(f => f?.username || f?.profile?.username).filter(Boolean);
      if (usernames.length > 0) {
        const resp = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_PRESENCE', usernames });
        if (resp?.success && resp.presenceMap) {
          setPresenceMap(prev => ({ ...prev, ...resp.presenceMap }));
        }

        // 4. Auto-sync friendships so RLS and relationships are established
        chrome.runtime.sendMessage({ type: 'SYNC_FRIENDSHIPS', usernames }).catch(() => {});
      }
    } catch (err) {
      console.warn('[BattleView] Presence fetch error:', err);
    } finally {
      if (isManual) setPresenceRefreshing(false);
    }
  }, [myUsername, friendsList]);

  useEffect(() => {
    if (externalPresenceMap && Object.keys(externalPresenceMap).length > 0) {
      setPresenceMap(prev => ({ ...prev, ...externalPresenceMap }));
    }
  }, [externalPresenceMap]);

  useEffect(() => {
    fetchPresence();
    const presenceInterval = setInterval(() => fetchPresence(false), 20000); // 20s
    return () => clearInterval(presenceInterval);
  }, [fetchPresence]);

  // ─── Reveal countdown ticker ──────────────────────────────
  useEffect(() => {
    if (revealCountdown === null) return;
    if (revealCountdown <= 0) { setRevealCountdown(null); return; }
    const id = setTimeout(() => setRevealCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [revealCountdown]);

  // ─── Selection timeout: auto-assign daily challenge ───────
  useEffect(() => {
    if (view === 'selecting' && selectionEndsIn === 0) {
      // If I still haven't picked, forfeit pick (handled server-side)
      // Just refresh state
      fetchBattleState();
    }
  }, [selectionEndsIn, view, fetchBattleState]);

  // ─── Validate problem URL ─────────────────────────────────
  const validateProblem = useCallback(async (input) => {
    if (!input.trim()) { setProblemValidation(null); return; }
    setValidating(true);
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_VALIDATE_PROBLEM',
        slugOrUrl: input.trim()
      });
      setProblemValidation(resp);
    } finally {
      setValidating(false);
    }
  }, []);

  // Debounced validation
  const validationTimer = useRef(null);
  const handleProblemInput = (val) => {
    setProblemUrl(val);
    setProblemValidation(null);
    clearTimeout(validationTimer.current);
    if (val.trim().length > 3) {
      validationTimer.current = setTimeout(() => validateProblem(val), 700);
    }
  };

  // ─── Actions ──────────────────────────────────────────────
  const [selectedLanguage, setSelectedLanguage] = useState('javascript');

  const sendChallenge = async () => {
    if (!selectedFriend) return;
    setActionLoading(true); setError('');
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_CHALLENGE',
        challenged: selectedFriend,
        language: selectedLanguage
      });
      if (resp?.success) { setBattle(resp.battle); }
      else setError(resp?.error || 'Failed to send challenge');
    } finally { setActionLoading(false); }
  };

  const respond = async (accept) => {
    if (!battle) return;
    setActionLoading(true); setError('');
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_RESPOND',
        battleId: battle.id,
        accept
      });
      if (resp?.success) setBattle(resp.battle);
      else setError(resp?.error || 'Failed to respond');
    } finally { setActionLoading(false); }
  };

  const lockInPick = async () => {
    if (!problemValidation?.valid) return;
    setActionLoading(true); setError('');
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_PICK_PROBLEM',
        battleId: battle.id,
        slug: problemValidation.slug,
        title: problemValidation.title,
        url: problemValidation.url
      });
      if (resp?.success) {
        setBattle(resp.battle);
        setProblemUrl('');
        setProblemValidation(null);
        if (resp.bothPicked && resp.battle.status === BATTLE_STATUS.STARTING) {
          setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
        }
      } else setError(resp?.error || 'Failed to lock pick');
    } finally { setActionLoading(false); }
  };

  const cancelChallenge = async () => {
    if (!battle) return;
    setActionLoading(true);
    try {
      await chrome.runtime.sendMessage({ type: 'BATTLE_CANCEL', battleId: battle.id });
      setBattle(null);
    } finally { setActionLoading(false); }
  };

  const handleConfirmReady = async () => {
    if (!battle) return;
    setActionLoading(true); setError('');
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_READY',
        battleId: battle.id,
        username: myUsername
      });
      if (resp?.success && resp.battle) {
        setBattle(resp.battle);
      } else if (resp?.error) {
        setError(resp.error);
      }
    } finally { setActionLoading(false); }
  };

  const forfeit = async () => {
    if (!battle) return;
    setActionLoading(true);
    try {
      await chrome.runtime.sendMessage({ type: 'BATTLE_FORFEIT', battleId: battle.id });
      fetchBattleState();
    } finally { setActionLoading(false); }
  };

  const startNewChallenge = () => {
    setBattle(null);
    setSelectedFriend('');
    setProblemUrl('');
    setProblemValidation(null);
    setError('');
    fetchBattleState();
  };

  // ─── My pick status ───────────────────────────────────────
  const myPick = amChallenger ? battle?.challenger_pick : battle?.challenged_pick;
  const oppPick = amChallenger ? battle?.challenged_pick : battle?.challenger_pick;

  // ─────────────────────────────────────────────────────────
  // RENDER VIEWS
  // ─────────────────────────────────────────────────────────

  // ─── Supabase config guard ────────────────────────────────
  if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <Swords className="w-7 h-7 text-red-400/60" />
        </div>
        <h2 className="text-sm font-bold text-text-main mb-2">Battle Mode Not Configured</h2>
        <p className="text-[10px] text-text-muted leading-relaxed mb-4">
          Battle Mode requires a Supabase backend. Set your <code className="text-red-400">SUPABASE_URL</code> and{' '}
          <code className="text-red-400">SUPABASE_ANON_KEY</code> in{' '}
          <code className="text-text-muted">src/shared/supabase-client.js</code> to enable real-time battles.
        </p>
        <a
          href="https://supabase.com"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-xs text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-all"
        >
          Get Supabase →
        </a>
      </div>
    );
  }

  // ─── Cloud Auth State (Authentication Exclusively On Battle Page) ──
  if (authState !== 'AUTHENTICATED') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-4 text-center animate-fade-in overflow-y-auto scrollbar-hide">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-2.5 shadow-sm">
          <Swords className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-base font-bold text-text-main mb-1">1v1 Battle Arena</h2>
        <p className="text-xs text-text-muted leading-relaxed mb-4 max-w-xs text-center">
          Challenge friends, select problems, and race to solve them live with automated verification.
        </p>

        {/* Auth Mode Toggle */}
        <div className="flex w-full max-w-xs bg-surface/80 p-1 rounded-xl border border-surfaceHover/50 mb-3">
          <button
            type="button"
            onClick={() => { setAuthMode('signin'); setAuthError(''); setAuthSuccessMsg(''); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              authMode === 'signin'
                ? 'bg-primary text-inverted shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthSuccessMsg(''); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              authMode === 'signup'
                ? 'bg-primary text-inverted shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Feedback alerts */}
        {authError && (
          <div className="w-full max-w-xs p-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-400 mb-3 text-left animate-shake">
            {authError}
          </div>
        )}

        {authSuccessMsg && (
          <div className="w-full max-w-xs p-2.5 bg-green-500/10 border border-green-500/25 rounded-xl text-xs text-green-400 mb-3 text-left animate-fade-in">
            {authSuccessMsg}
          </div>
        )}

        {authCooldown > 0 && (
          <div className="w-full max-w-xs p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-400 mb-3 text-center">
            Rate limited. Cooldown active: {authCooldown}s remaining
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleAuthSubmit} className="w-full max-w-xs space-y-2.5 text-left">
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1">Email Address</label>
            <input
              type="email"
              placeholder="name@example.com"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              disabled={authSubmitting}
              required
              className="w-full px-3 py-2 bg-surface/80 border border-surfaceHover/60 rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1">Password</label>
            <input
              type="password"
              placeholder={authMode === 'signup' ? 'Minimum 6 characters' : 'Enter your password'}
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              disabled={authSubmitting}
              required
              className="w-full px-3 py-2 bg-surface/80 border border-surfaceHover/60 rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={authSubmitting || authCooldown > 0}
            className="w-full py-2.5 bg-primary hover:bg-primaryHover text-inverted text-xs font-bold rounded-xl transition-all shadow-lg hover:shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95 mt-1"
          >
            {authSubmitting ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</>
            ) : authMode === 'signup' ? (
              'Create Account & Enter Battle'
            ) : (
              'Sign In to Battle'
            )}
          </button>
        </form>

        <p className="mt-3.5 text-[11px] text-text-muted max-w-xs text-center leading-relaxed">
          Personal streaks & progress are <span className="text-text-main font-semibold">100% offline</span>. Cloud authentication is only required for competitive battles and cloud sync.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Swords className="w-10 h-10 text-red-500/40 animate-pulse" />
          <p className="text-xs text-text-muted">Loading battle arena...</p>
        </div>
      </div>
    );
  }

  // ─── HOME ─────────────────────────────────────────────────
  if (view === 'home') {
    return (
      <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
        {/* Hero */}
        <div className="relative px-4 pt-6 pb-4 border-b border-red-500/10">
          <div className="absolute inset-0 bg-gradient-to-b from-red-950/20 to-transparent pointer-events-none" />
          <div className="relative flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Swords className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-text-main">Battle Mode</h2>
                <p className="text-[10px] text-text-muted">Challenge a friend to a coding duel</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchPresence(true)}
              disabled={presenceRefreshing}
              className="text-[10px] text-text-muted hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg bg-surface border border-surfaceHover hover:border-primary/40 transition-all active:scale-95"
              title="Refresh online status"
            >
              <RefreshCw className={`w-3 h-3 ${presenceRefreshing ? 'animate-spin text-primary' : ''}`} />
              <span>{presenceRefreshing ? 'Syncing…' : 'Sync Status'}</span>
            </button>
          </div>

          {/* Online Friends Status Header */}
          {(() => {
            const getFriendStatus = (f) => {
              const name = f?.username || f?.profile?.username;
              if (!name) return 'offline';
              const p = presenceMap[name] || presenceMap[name.toLowerCase()];
              const serverFriend = onlineFriendsServer.find(of => of.leetcode_username?.toLowerCase() === name.toLowerCase());
              if (serverFriend) return serverFriend.status;
              if (p?.inBattle || p?.status === 'in_battle') return 'in_battle';
              if (p?.isOnline || p?.status === 'online') return 'online';
              return 'offline';
            };

            const onlineFriends = friendsList.filter(f => getFriendStatus(f) === 'online');
            const busyFriends = friendsList.filter(f => getFriendStatus(f) === 'in_battle');
            const offlineFriends = friendsList.filter(f => getFriendStatus(f) === 'offline');

            const selectedFriendData = friendsList.find(f => (f?.username || f?.profile?.username)?.toLowerCase() === selectedFriend.toLowerCase());
            const selectedStatus = selectedFriendData ? getFriendStatus(selectedFriendData) : 'offline';

            return (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-text-main">Select an Online Friend:</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                      onlineFriends.length > 0
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-zinc-700/30 text-zinc-400 border-zinc-700/50'
                    }`}>
                      {onlineFriends.length} online
                    </span>
                  </div>
                </div>

                {onlineFriends.length === 0 && (
                  <div className="mb-3 px-3 py-2 bg-surface/60 rounded-xl border border-surfaceHover text-[10px] text-text-muted flex items-center gap-2">
                    <PresenceIndicator status="offline" size="sm" />
                    <span>No friends currently online. As friends open LeetStreak, they will appear automatically.</span>
                  </div>
                )}

                {/* Friend selector */}
                <div className="relative mb-3">
                  <select
                    value={selectedFriend}
                    onChange={e => setSelectedFriend(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs bg-surface border border-surfaceHover rounded-xl focus:outline-none focus:border-red-500/50 text-text-main appearance-none cursor-pointer"
                  >
                    <option value="">-- Choose a friend to challenge --</option>
                    {onlineFriends.length > 0 && (
                      <optgroup label="🟢 Online Now (Ready to Duel)">
                        {onlineFriends.map(f => {
                          const name = f?.username || f?.profile?.username;
                          const streak = f?.stats?.streak || 0;
                          return (
                            <option key={name} value={name}>
                              🟢 {name} — {streak}🔥 streak
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {busyFriends.length > 0 && (
                      <optgroup label="🟡 In Battle (Busy)">
                        {busyFriends.map(f => {
                          const name = f?.username || f?.profile?.username;
                          return (
                            <option key={name} value={name} disabled>
                              🟡 {name} (In a Match)
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {offlineFriends.length > 0 && (
                      <optgroup label="⚪ Offline Friends">
                        {offlineFriends.map(f => {
                          const name = f?.username || f?.profile?.username;
                          return (
                            <option key={name} value={name}>
                              ⚪ {name} (Offline)
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted rotate-90 pointer-events-none" />
                </div>

                {/* Selected Friend Preview Badge */}
                {selectedFriend && selectedFriendData && (
                  <div className="flex items-center gap-2.5 p-2 bg-surface rounded-xl border border-surfaceHover mb-3 animate-fade-in">
                    <AvatarWithPresence
                      src={selectedFriendData?.profile?.avatar}
                      alt={selectedFriend}
                      size="sm"
                      status={selectedStatus}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-text-main truncate">{selectedFriend}</div>
                      <div className="text-[10px] text-text-muted flex items-center gap-1">
                        <PresenceIndicator status={selectedStatus} size="sm" showLabel />
                        <span>•</span>
                        <span>{selectedFriendData?.stats?.streak || 0}🔥 streak</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {/* Language selector */}
          <div className="relative mb-3">
            <select
              value={selectedLanguage}
              onChange={e => setSelectedLanguage(e.target.value)}
              className="w-full px-3 py-2.5 text-xs bg-surface border border-surfaceHover rounded-xl focus:outline-none focus:border-red-500/50 text-text-main appearance-none cursor-pointer"
            >
              <option value="javascript">JavaScript</option>
              <option value="python3">Python 3</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
              <option value="c">C</option>
              <option value="csharp">C#</option>
              <option value="typescript">TypeScript</option>
              <option value="golang">Go</option>
              <option value="rust">Rust</option>
            </select>
            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted rotate-90 pointer-events-none" />
          </div>

          <button
            onClick={sendChallenge}
            disabled={!selectedFriend || actionLoading}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Swords className="w-3.5 h-3.5" />
            {actionLoading ? 'Sending…' : 'Send Battle Challenge'}
          </button>

          {error && (
            <div className="mt-2 flex items-center gap-2 text-red-400 text-[10px] bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* History */}
        <div className="flex-1 px-4 py-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-3">Past Battles</p>
          {history.length === 0 ? (
            <div className="text-center py-8">
              <Swords className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
              <p className="text-xs text-text-muted">No battles yet</p>
              <p className="text-[10px] text-text-muted/60 mt-1">Challenge a friend to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(b => (
                <HistoryRow key={b.id} battle={b} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── WAITING (challenge sent) ─────────────────────────────
  if (view === 'waiting') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
          <Clock className="w-8 h-8 text-amber-400 animate-pulse" />
        </div>
        <h2 className="text-sm font-bold text-text-main mb-1">Challenge Sent!</h2>
        <p className="text-xs text-text-muted mb-1">Waiting for <span className="text-amber-400 font-semibold">{opponent}</span> to respond</p>

        {expiresIn != null && (
          <div className="mt-4 mb-6">
            <p className="text-[10px] text-text-muted mb-1">Expires in</p>
            <span className="font-mono text-lg font-bold text-text-main">{formatDuration(expiresIn)}</span>
          </div>
        )}

        <button
          onClick={cancelChallenge}
          disabled={actionLoading}
          className="px-4 py-2 text-xs text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-all"
        >
          Cancel Challenge
        </button>
      </div>
    );
  }

  // ─── INCOMING (received challenge) ───────────────────────
  if (view === 'incoming') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Swords className="w-8 h-8 text-red-400" />
          </div>
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping" />
        </div>

        <h2 className="text-sm font-bold text-text-main mb-1">You've been challenged!</h2>
        <p className="text-xs text-text-muted mb-1">
          <span className="text-red-400 font-semibold">{opponent}</span> wants to battle
        </p>

        {expiresIn != null && (
          <div className="my-4">
            <p className="text-[10px] text-text-muted mb-1">Expires in</p>
            <span className="font-mono text-lg font-bold text-text-main">{formatDuration(expiresIn)}</span>
          </div>
        )}

        {error && (
          <p className="text-[10px] text-red-400 mb-3">{error}</p>
        )}

        <div className="flex gap-3 w-full">
          <button
            onClick={() => respond(false)}
            disabled={actionLoading}
            className="flex-1 py-3 text-xs font-semibold text-text-muted border border-surfaceHover rounded-xl hover:bg-surfaceHover transition-all disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5 mx-auto mb-1" />
            Decline
          </button>
          <button
            onClick={() => respond(true)}
            disabled={actionLoading}
            className="flex-1 py-3 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all active:scale-95 disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5 mx-auto mb-1" />
            Accept!
          </button>
        </div>
      </div>
    );
  }

  // ─── SELECTING (pick problem) ─────────────────────────────
  if (view === 'selecting') {
    return (
      <div className="flex flex-col h-full px-4 py-4 overflow-y-auto scrollbar-hide">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-text-main">Pick a Problem</h2>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-text-muted" />
            <span className={`font-mono text-xs font-bold ${selectionEndsIn != null && selectionEndsIn < 60 ? 'text-red-400' : 'text-text-main'}`}>
              {selectionEndsIn != null ? formatDuration(selectionEndsIn) : '--:--'}
            </span>
          </div>
        </div>

        <div className="bg-surface/40 border border-surfaceHover/30 rounded-xl p-3 mb-4 text-[10px] text-text-muted">
          Pick a problem <span className="text-amber-400 font-semibold">for {opponent}</span> to solve. They're picking one for you. Both players will solve <span className="font-bold">both problems</span> in order of difficulty.
          {!myPick && (
            <span className="block mt-1 text-text-muted/60">If you don't pick in time, today's Daily Challenge will be assigned.</span>
          )}
        </div>

        {/* Status indicators */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${myPick ? 'border-green-500/30 bg-green-500/5 text-green-400' : 'border-surfaceHover/30 bg-surface/30 text-text-muted'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${myPick ? 'bg-green-400' : 'bg-text-muted/30'}`} />
            You {myPick ? '✓ Picked' : '…picking'}
          </div>
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${oppPick ? 'border-green-500/30 bg-green-500/5 text-green-400' : 'border-surfaceHover/30 bg-surface/30 text-text-muted'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${oppPick ? 'bg-green-400 animate-pulse' : 'bg-text-muted/30'}`} />
            {opponent} {oppPick ? '✓ Ready' : '…picking'}
          </div>
        </div>

        {!myPick ? (
          <>
            <div className="mb-2">
              <p className="text-[10px] text-text-muted mb-1.5">Paste a LeetCode problem URL or slug:</p>
              <input
                type="text"
                value={problemUrl}
                onChange={e => handleProblemInput(e.target.value)}
                placeholder="https://leetcode.com/problems/two-sum/"
                className="w-full px-3 py-2 text-xs bg-surface border border-surfaceHover rounded-xl focus:outline-none focus:border-red-500/50 text-text-main placeholder-text-muted/50"
              />
            </div>

            {/* Validation feedback */}
            {validating && (
              <div className="flex items-center gap-2 text-[10px] text-text-muted py-2">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Validating…
              </div>
            )}
            {problemValidation && (
              <div className={`flex items-start gap-2 p-2.5 rounded-lg border text-[10px] mb-3 ${
                problemValidation.valid
                  ? 'border-green-500/30 bg-green-500/5 text-green-400'
                  : 'border-red-500/30 bg-red-500/5 text-red-400'
              }`}>
                {problemValidation.valid ? (
                  <>
                    <Check className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-semibold">{problemValidation.title}</span>
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[8px] font-bold border ${DIFFICULTY_BADGE[problemValidation.difficulty] || ''}`}>
                        {problemValidation.difficulty}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {problemValidation.error}
                  </>
                )}
              </div>
            )}

            <button
              onClick={lockInPick}
              disabled={!problemValidation?.valid || actionLoading}
              className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all active:scale-95"
            >
              {actionLoading ? 'Locking in…' : '🔒 Lock In My Pick'}
            </button>

            {error && (
              <p className="text-[10px] text-red-400 mt-2 text-center">{error}</p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-3">
              <Check className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-xs font-semibold text-green-400 mb-1">Pick locked in!</p>
            <p className="text-[10px] text-text-muted">Waiting for {opponent} to pick their problem…</p>
            {oppPick && (
              <p className="text-[10px] text-green-400 mt-2 animate-pulse">Both picks in — preparing battle…</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── READY CHECK ──────────────────────────────────────────
  if (view === 'ready_check') {
    const isChallenger = battle.challenger === myUsername;
    const myReady = isChallenger ? battle.challenger_ready : battle.challenged_ready;
    const oppReady = isChallenger ? battle.challenged_ready : battle.challenger_ready;

    return (
      <div className="flex flex-col h-full px-4 py-6 overflow-y-auto scrollbar-hide text-center">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-3">
          <Swords className="w-6 h-6 text-red-400" />
        </div>
        <h2 className="text-sm font-bold text-text-main mb-1">Match Ready Check</h2>
        <p className="text-[11px] text-text-muted mb-4">Both problems selected. Confirm readiness to begin countdown.</p>

        {/* Locked Language Indicator */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface border border-surfaceHover rounded-full mx-auto mb-4 text-[10px] text-text-muted">
          <span>Language:</span>
          <span className="font-semibold text-text-main capitalize">{battle.language || 'Any'}</span>
        </div>

        {/* Problems Preview */}
        <div className="w-full flex flex-col gap-2 mb-6 text-left">
          <div className="bg-surface/50 border border-surfaceHover rounded-xl p-3">
            <span className="text-[9px] text-text-muted uppercase tracking-wider block mb-0.5">Problem 1</span>
            <p className="text-xs font-semibold text-text-main truncate">{battle.problem_1_title || battle.problem_1}</p>
          </div>
          <div className="bg-surface/50 border border-surfaceHover rounded-xl p-3">
            <span className="text-[9px] text-text-muted uppercase tracking-wider block mb-0.5">Problem 2</span>
            <p className="text-xs font-semibold text-text-main truncate">{battle.problem_2_title || battle.problem_2}</p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className={`p-3 rounded-xl border text-xs ${myReady ? 'border-green-500/30 bg-green-500/5 text-green-400' : 'border-surfaceHover bg-surface/30 text-text-muted'}`}>
            <div className="font-semibold mb-1">You</div>
            <div>{myReady ? '✓ Ready' : '⏳ Awaiting...'}</div>
          </div>
          <div className={`p-3 rounded-xl border text-xs ${oppReady ? 'border-green-500/30 bg-green-500/5 text-green-400' : 'border-surfaceHover bg-surface/30 text-text-muted'}`}>
            <div className="font-semibold mb-1">{opponent}</div>
            <div>{oppReady ? '✓ Ready' : '⏳ Awaiting...'}</div>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
            {error}
          </div>
        )}

        {!myReady ? (
          <button
            onClick={handleConfirmReady}
            disabled={actionLoading}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            {actionLoading ? 'Confirming...' : "I'm Ready!"}
          </button>
        ) : (
          <div className="text-xs text-text-muted flex items-center justify-center gap-2 py-3">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Waiting for {opponent} to confirm ready...
          </div>
        )}
      </div>
    );
  }

  // ─── REVEAL ───────────────────────────────────────────────
  if (view === 'reveal') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-[10px] text-text-muted uppercase tracking-widest mb-3">
          Both picks locked in!
        </p>
        <h2 className="text-sm font-bold text-text-main mb-3">The Problems Are…</h2>

        <div className="w-full flex flex-col gap-2 mb-6">
          <div className="bg-surface border border-red-500/20 rounded-xl p-3 shadow-lg shadow-red-500/5">
            <span className="text-[9px] text-text-muted uppercase tracking-wider block mb-1">Problem 1 (Easier)</span>
            <p className="text-xs font-bold text-text-main">{battle.problem_1_title || battle.problem_1}</p>
          </div>
          <div className="bg-surface border border-red-500/20 rounded-xl p-3 shadow-lg shadow-red-500/5 opacity-80">
            <span className="text-[9px] text-text-muted uppercase tracking-wider block mb-1">Problem 2 (Harder)</span>
            <p className="text-xs font-bold text-text-main">{battle.problem_2_title || battle.problem_2}</p>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <p className="text-xs text-text-muted mb-1">Battle starts in</p>
          <span className="font-mono text-4xl font-black text-red-400">{revealCountdown}</span>
        </div>
      </div>
    );
  }

  // ─── ACTIVE ───────────────────────────────────────────────
  if (view === 'active') {
    const problems = [
      { index: 1, slug: battle.problem_1, title: battle.problem_1_title || battle.problem_1 },
      { index: 2, slug: battle.problem_2, title: battle.problem_2_title || battle.problem_2 }
    ];

    const mySolvedCount = problems.filter(p => 
      allResults.some(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.problem_slug === p.slug && r.accepted)
    ).length;

    const oppSolvedCount = problems.filter(p => 
      allResults.some(r => r.username?.toLowerCase() === opponent?.toLowerCase() && r.problem_slug === p.slug && r.accepted)
    ).length;

    return (
      <div className="flex flex-col h-full px-4 py-4 overflow-y-auto scrollbar-hide">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
              Live Battle (Locked: {battle.language || 'Any'})
            </span>
          </div>
          <div className="font-mono text-sm font-black text-text-main">
            {formatDuration(elapsedSeconds)}
          </div>
        </div>

        {/* Score Overview */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-surface border border-surfaceHover rounded-xl p-2.5 text-center">
            <span className="text-[10px] text-text-muted block">You</span>
            <span className="text-lg font-bold font-mono text-text-main">{mySolvedCount} / 2</span>
          </div>
          <div className="bg-surface border border-surfaceHover rounded-xl p-2.5 text-center">
            <span className="text-[10px] text-text-muted block">{opponent}</span>
            <span className="text-lg font-bold font-mono text-text-main">{oppSolvedCount} / 2</span>
          </div>
        </div>

        {/* Problems (Both concurrently available) */}
        <div className="space-y-2 mb-4">
          {problems.map(p => {
            const mySolved = allResults.some(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.problem_slug === p.slug && r.accepted);
            const oppSolved = allResults.some(r => r.username?.toLowerCase() === opponent?.toLowerCase() && r.problem_slug === p.slug && r.accepted);

            return (
              <a
                key={p.index}
                href={`https://leetcode.com/problems/${p.slug}/`}
                target="_blank"
                rel="noopener noreferrer"
                className={`block bg-surface/60 border rounded-xl p-3 hover:border-red-500/40 transition-all cursor-pointer group ${
                  mySolved ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] text-text-muted uppercase tracking-wider">
                        Problem {p.index}
                      </span>
                      {mySolved && (
                        <span className="text-[9px] text-green-400 font-bold bg-green-500/20 px-1.5 py-0.5 rounded">
                          ✓ Solved
                        </span>
                      )}
                      {oppSolved && (
                        <span className="text-[9px] text-amber-400 font-bold bg-amber-500/20 px-1.5 py-0.5 rounded">
                          {opponent} Solved
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-text-main truncate">{p.title}</p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-text-muted group-hover:text-red-400 transition-colors flex-shrink-0" />
                </div>
              </a>
            );
          })}
        </div>

        {/* VS Panel */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[
            { label: 'You', result: myResult, isMe: true },
            { label: opponent, result: oppResult, isMe: false }
          ].map(({ label, result, isMe }) => (
            <div
              key={label}
              className={`p-3 rounded-xl border ${
                result?.accepted
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-surfaceHover/30 bg-surface/30'
              }`}
            >
              <p className={`text-[10px] font-bold mb-2 ${isMe ? 'text-amber-400' : 'text-text-muted'}`}>{label}</p>
              {result?.accepted ? (
                <>
                  <p className="text-[10px] text-green-400 font-semibold">✅ Accepted!</p>
                  <p className="text-[9px] text-text-muted">{result.runtime_ms ? `${result.runtime_ms}ms` : ''} {result.runtime_beats ? `· ${result.runtime_beats}%` : ''}</p>
                </>
              ) : (
                <>
                  <p className="text-[10px] text-text-muted">⏳ Solving…</p>
                  <p className="text-[9px] text-text-muted/60">{result?.attempts ? `${result.attempts} submit${result.attempts > 1 ? 's' : ''}` : 'No submissions yet'}</p>
                </>
              )}
            </div>
          ))}
        </div>

        {timedOut && (
          <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] text-amber-400 text-center">
            ⏰ Time's up! Calculating results…
          </div>
        )}

        <button
          onClick={forfeit}
          disabled={actionLoading || !!myResult?.accepted}
          className="w-full py-2 text-[10px] text-red-400/60 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <Flag className="w-3 h-3" />
          {myResult?.accepted ? 'Submitted' : 'Give Up'}
        </button>
      </div>
    );
  }

  // ─── RESULT ───────────────────────────────────────────────
  if (view === 'result') {
    const myAllResults = allResults.filter(r => r.username?.toLowerCase() === myUsername?.toLowerCase());
    const oppAllResults = allResults.filter(r => r.username?.toLowerCase() === opponent?.toLowerCase());

    const { score1: myScore, score2: oppScore, time1: myTime, time2: oppTime, winner } = calculateScores(
      myResult,
      oppResult,
      myAllResults,
      oppAllResults
    );

    const iWon = battle.winner ? battle.winner.toLowerCase() === myUsername.toLowerCase() : winner === 'p1';
    const draw = battle.winner ? battle.winner === 'draw' : winner === 'draw';

    // Problem 1 results
    const myP1 = allResults.find(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.problem_index === 1);
    const oppP1 = allResults.find(r => r.username?.toLowerCase() === opponent?.toLowerCase() && r.problem_index === 1);

    // Problem 2 results
    const myP2 = allResults.find(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.problem_index === 2);
    const oppP2 = allResults.find(r => r.username?.toLowerCase() === opponent?.toLowerCase() && r.problem_index === 2);

    return (
      <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
        {/* Outcome banner */}
        <div className={`px-4 pt-6 pb-4 border-b border-surfaceHover/20 text-center ${
          draw ? '' : iWon ? 'bg-gradient-to-b from-amber-950/20 to-transparent' : 'bg-gradient-to-b from-red-950/10 to-transparent'
        }`}>
          <div className="text-3xl mb-2">{draw ? '🤝' : iWon ? '🏆' : '💀'}</div>
          <h2 className={`text-base font-black mb-0.5 ${draw ? 'text-text-main' : iWon ? 'text-amber-400' : 'text-red-400'}`}>
            {draw ? "It's a Draw" : iWon ? 'You Won!' : 'You Lost'}
          </h2>
          <p className="text-xs text-text-muted truncate px-4">{battle.problem_1_title || battle.problem_1} & {battle.problem_2_title || battle.problem_2}</p>

          <div className="flex items-center justify-center gap-4 mt-3">
            <div className="text-center">
              <span className="text-2xl font-black text-text-main font-mono">{myScore} pts</span>
              <p className="text-[9px] text-text-muted">You ({formatDuration(myTime)})</p>
            </div>
            <span className="text-text-muted/40 font-mono">—</span>
            <div className="text-center">
              <span className="text-2xl font-black text-text-main font-mono">{oppScore} pts</span>
              <p className="text-[9px] text-text-muted">{opponent} ({formatDuration(oppTime)})</p>
            </div>
          </div>
        </div>

        {/* Deterministic score breakdown */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex justify-between text-[9px] text-text-muted uppercase tracking-wider px-1">
            <span>You</span>
            <span>Deterministic Scoring</span>
            <span>{opponent}</span>
          </div>

          <div className="bg-surface/30 border border-surfaceHover/20 rounded-xl divide-y divide-surfaceHover/10 p-3 text-xs space-y-2">
            {/* Problem 1 row */}
            <div className="py-2 flex items-center justify-between">
              <span className={myP1?.accepted ? 'text-green-400 font-semibold' : 'text-text-muted'}>
                {myP1?.accepted ? `✓ ${formatDuration(myP1.time_taken_seconds)}` : '✗ Unsolved'}
              </span>
              <span className="text-[10px] text-text-muted text-center max-w-[120px] truncate">
                P1: {battle.problem_1_title || battle.problem_1}
              </span>
              <span className={oppP1?.accepted ? 'text-green-400 font-semibold' : 'text-text-muted'}>
                {oppP1?.accepted ? `✓ ${formatDuration(oppP1.time_taken_seconds)}` : '✗ Unsolved'}
              </span>
            </div>

            {/* Problem 2 row */}
            <div className="py-2 flex items-center justify-between">
              <span className={myP2?.accepted ? 'text-green-400 font-semibold' : 'text-text-muted'}>
                {myP2?.accepted ? `✓ ${formatDuration(myP2.time_taken_seconds)}` : '✗ Unsolved'}
              </span>
              <span className="text-[10px] text-text-muted text-center max-w-[120px] truncate">
                P2: {battle.problem_2_title || battle.problem_2}
              </span>
              <span className={oppP2?.accepted ? 'text-green-400 font-semibold' : 'text-text-muted'}>
                {oppP2?.accepted ? `✓ ${formatDuration(oppP2.time_taken_seconds)}` : '✗ Unsolved'}
              </span>
            </div>

            {/* Total time row */}
            <div className="py-2 flex items-center justify-between text-[11px] pt-2 border-t border-surfaceHover/20">
              <span className="font-mono text-text-main font-semibold">{formatDuration(myTime)}</span>
              <span className="text-[10px] text-text-muted font-medium">Total Solved Time</span>
              <span className="font-mono text-text-main font-semibold">{formatDuration(oppTime)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 pb-6 flex gap-2 mt-auto">
          <button
            onClick={startNewChallenge}
            className="flex-1 py-2.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all active:scale-95"
          >
            <Swords className="w-3.5 h-3.5 inline mr-1.5" />
            Rematch
          </button>
          <button
            onClick={startNewChallenge}
            className="px-4 py-2.5 text-xs font-medium text-text-muted border border-surfaceHover/50 rounded-xl hover:bg-surfaceHover/30 transition-all"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default BattleView;
