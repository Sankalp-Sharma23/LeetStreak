import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Swords, Trophy, Clock, ChevronRight, X, Check, AlertCircle,
  ExternalLink, Flag, RefreshCw, Loader2, Sparkles, Zap,
  Target, Timer, Hash
} from 'lucide-react';
import { BATTLE_STATUS, TERMINAL_STATES } from '../shared/battle-manager.js';
import { SUPABASE_URL } from '../shared/supabase-client.js';
import { PresenceIndicator, AvatarWithPresence } from './PresenceIndicator.jsx';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const DSA_TOPICS = [
  'Arrays', 'Strings', 'Hashing', 'Two Pointers', 'Sliding Window',
  'Binary Search', 'Sorting', 'Linked Lists', 'Stacks', 'Queues',
  'Trees', 'Binary Search Trees', 'Heaps', 'Graphs', 'Backtracking',
  'Greedy', 'Dynamic Programming', 'Tries', 'Bit Manipulation',
  'Intervals', 'Math'
];

const DIFFICULTY_OPTIONS = ['Easy', 'Medium', 'Hard', 'Mixed'];

const DURATION_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hr', value: 60 },
  { label: '90 min', value: 90 },
];

const PROBLEM_COUNT_OPTIONS = [3, 5, 7, 10];

const REVEAL_COUNTDOWN_SECONDS = 10;

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

function formatMins(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
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
    if (!startIso) return;
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

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function TopicPill({ topic, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(topic)}
      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all select-none ${
        selected
          ? 'bg-red-600/20 border-red-500/50 text-red-300'
          : 'bg-surface/40 border-surfaceHover/40 text-text-muted hover:border-surfaceHover hover:text-text-main'
      }`}
    >
      {topic}
    </button>
  );
}

function DifficultyBadge({ diff }) {
  const cls = {
    Easy:   'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
    Medium: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
    Hard:   'text-red-400 bg-red-500/10 border-red-500/25',
    Mixed:  'text-violet-400 bg-violet-500/10 border-violet-500/25',
  }[diff] || 'text-text-muted bg-surface border-surfaceHover';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${cls}`}>
      {diff}
    </span>
  );
}

function HistoryRow({ battle }) {
  const { opponent, outcome, created_at, topics, difficulty } = battle;
  const icon = outcome === 'win' ? '🏆' : outcome === 'loss' ? '💀' : '🤝';
  const outcomeColor = {
    win: 'text-amber-400',
    loss: 'text-red-400',
    draw: 'text-text-muted'
  }[outcome] || 'text-text-muted';

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-surface/40 rounded-lg border border-surfaceHover/30 hover:border-surfaceHover/60 transition-all">
      <span className="text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-text-main truncate">vs {opponent}</p>
        <p className="text-[10px] text-text-muted truncate">
          {topics?.slice(0, 2).join(', ') || 'DSA Battle'}{difficulty ? ` · ${difficulty}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className={`text-[10px] font-bold uppercase ${outcomeColor}`}>{outcome}</span>
        <span className="text-[9px] text-text-muted">{formatTimeAgo(created_at)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BATTLE CONFIG BUILDER (home screen)
// ─────────────────────────────────────────────────────────────

function BattleConfigBuilder({ friendsList, presenceMap, onlineFriendsServer, myUsername, onSendChallenge, loading, error }) {
  const [selectedTopics, setSelectedTopics] = useState(['Arrays', 'Strings']);
  const [difficulty, setDifficulty] = useState('Medium');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [problemCount, setProblemCount] = useState(5);
  const [selectedFriend, setSelectedFriend] = useState('');
  const [step, setStep] = useState('topics'); // 'topics' | 'config' | 'confirm'

  const toggleTopic = (t) => {
    setSelectedTopics(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  };

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

  const canSend = selectedFriend && selectedTopics.length > 0 && !loading;

  const handleSend = () => {
    if (!canSend) return;
    onSendChallenge({
      challenged: selectedFriend,
      topics: selectedTopics,
      difficulty,
      durationMinutes,
      problemCount
    });
  };

  if (step === 'topics') {
    return (
      <div className="flex flex-col h-full px-4 pt-5 pb-4 overflow-y-auto scrollbar-hide">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <Swords className="w-4.5 h-4.5 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-main leading-none">Create Battle</h2>
            <p className="text-[10px] text-text-muted mt-0.5">Step 1 of 3 — Select DSA Topics</p>
          </div>
        </div>

        <p className="text-[11px] text-text-muted mb-3 leading-relaxed">
          Choose the topics you both will be tested on. At least one required.
        </p>

        <div className="flex flex-wrap gap-1.5 mb-5">
          {DSA_TOPICS.map(t => (
            <TopicPill key={t} topic={t} selected={selectedTopics.includes(t)} onClick={toggleTopic} />
          ))}
        </div>

        {selectedTopics.length === 0 && (
          <p className="text-[10px] text-red-400 mb-3">Select at least one topic</p>
        )}

        <div className="bg-surface/40 border border-surfaceHover/30 rounded-xl p-3 mb-4 text-[10px] text-text-muted">
          <span className="font-semibold text-text-main">{selectedTopics.length} topic{selectedTopics.length !== 1 ? 's' : ''} selected:</span>{' '}
          {selectedTopics.length > 0 ? selectedTopics.join(', ') : 'None'}
        </div>

        <button
          type="button"
          onClick={() => setStep('config')}
          disabled={selectedTopics.length === 0}
          className="mt-auto w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          Next: Set Difficulty & Duration <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (step === 'config') {
    return (
      <div className="flex flex-col h-full px-4 pt-5 pb-4 overflow-y-auto scrollbar-hide">
        <div className="flex items-center gap-2 mb-5">
          <button
            type="button"
            onClick={() => setStep('topics')}
            className="text-text-muted hover:text-text-main transition-colors"
          >
            ← Back
          </button>
          <div>
            <h2 className="text-sm font-bold text-text-main leading-none">Battle Settings</h2>
            <p className="text-[10px] text-text-muted mt-0.5">Step 2 of 3 — Difficulty & Duration</p>
          </div>
        </div>

        {/* Difficulty */}
        <div className="mb-4">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-2">Difficulty</label>
          <div className="grid grid-cols-4 gap-1.5">
            {DIFFICULTY_OPTIONS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${
                  difficulty === d
                    ? d === 'Easy' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : d === 'Medium' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : d === 'Hard' ? 'bg-red-500/20 border-red-500/50 text-red-300'
                    : 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                    : 'bg-surface/40 border-surfaceHover/40 text-text-muted hover:border-surfaceHover'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div className="mb-4">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-2">
            <Timer className="inline w-3 h-3 mr-1" />Duration
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {DURATION_OPTIONS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDurationMinutes(d.value)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${
                  durationMinutes === d.value
                    ? 'bg-red-600/20 border-red-500/50 text-red-300'
                    : 'bg-surface/40 border-surfaceHover/40 text-text-muted hover:border-surfaceHover'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Problem count */}
        <div className="mb-5">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-2">
            <Hash className="inline w-3 h-3 mr-1" />Number of Problems
          </label>
          <div className="flex gap-1.5">
            {PROBLEM_COUNT_OPTIONS.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setProblemCount(n)}
                className={`w-10 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                  problemCount === n
                    ? 'bg-red-600/20 border-red-500/50 text-red-300'
                    : 'bg-surface/40 border-surfaceHover/40 text-text-muted hover:border-surfaceHover'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Summary card */}
        <div className="bg-surface/50 border border-surfaceHover/50 rounded-xl p-3 mb-4 space-y-1.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Topics</span>
            <span className="text-text-main font-semibold truncate max-w-[180px] text-right">{selectedTopics.slice(0,3).join(', ')}{selectedTopics.length > 3 ? ` +${selectedTopics.length - 3}` : ''}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Difficulty</span>
            <DifficultyBadge diff={difficulty} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Duration</span>
            <span className="text-text-main font-semibold">{formatMins(durationMinutes)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Problems</span>
            <span className="text-text-main font-semibold">{problemCount}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="mt-auto w-full py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          Next: Choose Opponent <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // step === 'confirm'
  return (
    <div className="flex flex-col h-full px-4 pt-5 pb-4 overflow-y-auto scrollbar-hide">
      <div className="flex items-center gap-2 mb-5">
        <button
          type="button"
          onClick={() => setStep('config')}
          className="text-text-muted hover:text-text-main transition-colors"
        >
          ← Back
        </button>
        <div>
          <h2 className="text-sm font-bold text-text-main leading-none">Choose Opponent</h2>
          <p className="text-[10px] text-text-muted mt-0.5">Step 3 of 3 — Select a friend to challenge</p>
        </div>
      </div>

      {/* Battle summary */}
      <div className="bg-surface/50 border border-red-500/15 rounded-xl p-3 mb-4 space-y-1 text-[10px]">
        <p className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">Battle Config</p>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedTopics.slice(0,4).map(t => (
            <span key={t} className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-red-300 text-[9px]">{t}</span>
          ))}
          {selectedTopics.length > 4 && <span className="text-text-muted text-[9px]">+{selectedTopics.length-4} more</span>}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <DifficultyBadge diff={difficulty} />
          <span className="text-text-muted">{formatMins(durationMinutes)} · {problemCount} problems</span>
        </div>
      </div>

      {/* Friend selector */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-text-main">Select Friend</span>
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
            onlineFriends.length > 0
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-zinc-700/30 text-zinc-400 border-zinc-700/50'
          }`}>
            {onlineFriends.length} online
          </span>
        </div>

        {onlineFriends.length === 0 && (
          <div className="mb-2 px-3 py-2 bg-surface/60 rounded-xl border border-surfaceHover text-[10px] text-text-muted flex items-center gap-2">
            <PresenceIndicator status="offline" size="sm" />
            <span>No friends online. They'll appear as they open LeetStreak.</span>
          </div>
        )}

        <div className="relative">
          <select
            value={selectedFriend}
            onChange={e => setSelectedFriend(e.target.value)}
            className="w-full px-3 py-2.5 text-xs bg-surface border border-surfaceHover rounded-xl focus:outline-none focus:border-red-500/50 text-text-main appearance-none cursor-pointer"
          >
            <option value="">— Choose opponent —</option>
            {onlineFriends.length > 0 && (
              <optgroup label="🟢 Online (Ready to Duel)">
                {onlineFriends.map(f => {
                  const name = f?.username || f?.profile?.username;
                  const streak = f?.stats?.streak || 0;
                  return <option key={name} value={name}>🟢 {name}{streak ? ` — ${streak}🔥` : ''}</option>;
                })}
              </optgroup>
            )}
            {busyFriends.length > 0 && (
              <optgroup label="🟡 In Battle">
                {busyFriends.map(f => {
                  const name = f?.username || f?.profile?.username;
                  return <option key={name} value={name} disabled>🟡 {name} (Busy)</option>;
                })}
              </optgroup>
            )}
            {offlineFriends.length > 0 && (
              <optgroup label="⚪ Offline">
                {offlineFriends.map(f => {
                  const name = f?.username || f?.profile?.username;
                  return <option key={name} value={name}>⚪ {name}</option>;
                })}
              </optgroup>
            )}
          </select>
          <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted rotate-90 pointer-events-none" />
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-red-400 text-[10px] bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className="mt-auto w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <Swords className="w-3.5 h-3.5" />
        {loading ? 'Sending Challenge…' : `Challenge ${selectedFriend || 'Friend'}`}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export default function BattleView({ myUsername, friends, returnTarget = null, onAuthSuccess = null, presenceMap: externalPresenceMap = null }) {
  const [battle, setBattle] = useState(null);
  const [battleState, setBattleState] = useState(null); // full v2 state: {problems, participants, results}
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [friendsList, setFriendsList] = useState([]);
  const [presenceMap, setPresenceMap] = useState({});
  const [onlineFriendsServer, setOnlineFriendsServer] = useState([]);
  const [presenceRefreshing, setPresenceRefreshing] = useState(false);
  const [authState, setAuthState] = useState('AUTHENTICATED');
  const [actionLoading, setActionLoading] = useState(false);
  const [revealCountdown, setRevealCountdown] = useState(null);

  // Auth form
  const [authMode, setAuthMode] = useState('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState(myUsername || '');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');
  const [authCooldown, setAuthCooldown] = useState(0);

  useEffect(() => {
    if (!authUsername && myUsername) setAuthUsername(myUsername);
  }, [myUsername]);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (res) => {
        if (res?.success) {
          setAuthState(res.state);
          if (res.cooldownSeconds > 0) setAuthCooldown(res.cooldownSeconds);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (authCooldown <= 0) return;
    const timer = setInterval(() => setAuthCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [authCooldown]);

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    if (authSubmitting) return;
    setAuthError(''); setAuthSuccessMsg('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!authEmail.trim() || !emailRegex.test(authEmail.trim())) {
      setAuthError('Please enter a valid email address.'); return;
    }
    if (!authPassword || authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters.'); return;
    }
    if (authCooldown > 0) {
      setAuthError(`Rate limit active. Wait ${authCooldown}s.`); return;
    }
    if (authMode === 'signup' && !(authUsername || myUsername || '').trim()) {
      setAuthError('Please enter your LeetCode username.'); return;
    }

    setAuthSubmitting(true);
    const effectiveUsername = (authUsername || myUsername || '').trim();

    try {
      if (authMode === 'signin') {
        const res = await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: 'SIGN_IN_EMAIL', email: authEmail.trim(), password: authPassword, username: effectiveUsername }, resolve)
        );
        if (res?.success) {
          setAuthState('AUTHENTICATED');
          setAuthPassword('');
          if (onAuthSuccess) onAuthSuccess(returnTarget);
        } else {
          if (res?.isRateLimited) setAuthCooldown(60);
          setAuthError(res?.error || 'Invalid email or password.');
        }
      } else {
        const res = await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: 'SIGN_UP_EMAIL', email: authEmail.trim(), password: authPassword, username: effectiveUsername }, resolve)
        );
        if (res?.success) {
          if (res.confirmationRequired) {
            setAuthSuccessMsg('Account created! Check email to verify.');
            setAuthMode('signin'); setAuthPassword('');
          } else {
            setAuthState('AUTHENTICATED'); setAuthPassword('');
            if (onAuthSuccess) onAuthSuccess(returnTarget);
          }
        } else {
          if (res?.isRateLimited) setAuthCooldown(60);
          setAuthError(res?.error || 'Failed to create account.');
        }
      }
    } catch (err) {
      setAuthError(err.message || 'Network error.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  // ─── Countdown hooks ─────────────────────────────────────
  const expiresIn = useCountdown(battle?.expires_at);
  const battleTimeLeft = useCountdown(battle?.end_at || battle?.match_deadline);
  const timedOut = battleTimeLeft === 0 && battle?.status === 'in_progress';
  const elapsedSeconds = useElapsedTimer(battle?.start_at || battle?.match_starts_at);

  // ─── Poll ref ────────────────────────────────────────────
  const pollRef = useRef(null);
  const battleRef = useRef(battle);
  useEffect(() => { battleRef.current = battle; }, [battle]);

  // ─── Derived state ───────────────────────────────────────
  const challengerName = battle?.challenger_username;
  const challengedName = battle?.challenged_username;
  const amChallenger = challengerName && myUsername
    ? challengerName.toLowerCase() === myUsername.toLowerCase()
    : false;
  const opponent = battle ? (amChallenger ? challengedName : challengerName) : null;

  // Problems from v2 state or fall back to old schema
  const problems = battleState?.problems || (battle ? [
    battle.problem_1 ? { sequence_number: 1, problem_slug: battle.problem_1, problem_title: battle.problem_1_title || battle.problem_1, problem_url: `https://leetcode.com/problems/${battle.problem_1}/` } : null,
    battle.problem_2 ? { sequence_number: 2, problem_slug: battle.problem_2, problem_title: battle.problem_2_title || battle.problem_2, problem_url: `https://leetcode.com/problems/${battle.problem_2}/` } : null,
  ].filter(Boolean) : []);

  const participants = battleState?.participants || [];
  const solveResults = battleState?.results || [];

  const myParticipant = participants.find(p => p.username?.toLowerCase() === myUsername?.toLowerCase());
  const oppParticipant = participants.find(p => p.username?.toLowerCase() === opponent?.toLowerCase());

  const mySolvedCount = solveResults.filter(r => r.username?.toLowerCase() === myUsername?.toLowerCase()).length;
  const oppSolvedCount = solveResults.filter(r => r.username?.toLowerCase() === opponent?.toLowerCase()).length;

  const view = (() => {
    if (!battle) return 'home';
    switch (battle.status) {
      case 'pending': return amChallenger ? 'waiting' : 'incoming';
      case 'accepted': return 'ready_check';
      case 'selecting': return 'ready_check';
      case 'ready_check': return 'ready_check';
      case 'countdown': return 'reveal';
      case 'in_progress': return 'active';
      case 'completed':
      case 'forfeited': return 'result';
      default: return 'home';
    }
  })();

  // ─── Fetch battle state ───────────────────────────────────
  const fetchBattleState = useCallback(async () => {
    if (!myUsername) return;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_STATUS', username: myUsername });
      if (resp?.battle) {
        setBattle(resp.battle);

        // Set reveal countdown from server timestamp
        if (resp.battle.status === 'countdown' && resp.battle.match_starts_at) {
          const rem = Math.max(0, Math.round((new Date(resp.battle.match_starts_at).getTime() - Date.now()) / 1000));
          setRevealCountdown(rem > 0 ? rem : null);
        }

        // Fetch full v2 state if we have a battle
        if (resp.battle.id) {
          const stateResp = await chrome.runtime.sendMessage({
            type: 'BATTLE_GET_STATE_V2',
            battleId: resp.battle.id
          });
          if (stateResp?.success && stateResp.state) {
            setBattleState(stateResp.state);
          }
        }
      } else {
        setBattle(null);
        setBattleState(null);
      }
      if (resp?.history) setHistory(resp.history);
    } catch (err) {
      console.error('[BattleView] Poll error:', err);
    } finally {
      setLoading(false);
    }
  }, [myUsername]);

  useEffect(() => {
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

  // ─── Presence ────────────────────────────────────────────
  const fetchPresence = useCallback(async (isManual = false) => {
    if (!myUsername) return;
    if (isManual) setPresenceRefreshing(true);
    try {
      await chrome.runtime.sendMessage({ type: 'BATTLE_PING_PRESENCE', username: myUsername });
      const onlineResp = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_ONLINE_FRIENDS' });
      if (onlineResp?.success && Array.isArray(onlineResp.friends)) {
        setOnlineFriendsServer(onlineResp.friends);
      }
      const usernames = friendsList.map(f => f?.username || f?.profile?.username).filter(Boolean);
      if (usernames.length > 0) {
        const resp = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_PRESENCE', usernames });
        if (resp?.success && resp.presenceMap) {
          setPresenceMap(prev => ({ ...prev, ...resp.presenceMap }));
        }
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
    const id = setInterval(() => fetchPresence(false), 20000);
    return () => clearInterval(id);
  }, [fetchPresence]);

  // ─── Reveal countdown ticker ──────────────────────────────
  useEffect(() => {
    if (revealCountdown === null) return;
    if (revealCountdown <= 0) { setRevealCountdown(null); return; }
    const id = setTimeout(() => setRevealCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [revealCountdown]);

  // ─── Auto-transition: countdown → in_progress ────────────
  useEffect(() => {
    if (view === 'reveal' && revealCountdown === 0) {
      // Transition will be detected by poll, but optimistically update
      setTimeout(fetchBattleState, 500);
    }
  }, [revealCountdown, view, fetchBattleState]);

  // ─── Actions ──────────────────────────────────────────────
  const sendChallenge = async ({ challenged, topics, difficulty, durationMinutes, problemCount }) => {
    setActionLoading(true); setError('');
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_CHALLENGE_V2',
        challenger: myUsername,
        challenged,
        topics,
        difficulty,
        durationMinutes,
        problemCount
      });
      if (resp?.success) setBattle(resp.battle);
      else setError(resp?.error || 'Failed to send challenge');
    } finally { setActionLoading(false); }
  };

  const respond = async (accept) => {
    if (!battle) return;
    setActionLoading(true); setError('');
    try {
      const resp = await chrome.runtime.sendMessage({
        type: accept ? 'BATTLE_ACCEPT_V2' : 'BATTLE_RESPOND',
        battleId: battle.id,
        accept
      });
      if (resp?.success) setBattle(resp.battle);
      else setError(resp?.error || 'Failed to respond');
    } finally { setActionLoading(false); }
  };

  const confirmReady = async () => {
    if (!battle) return;
    setActionLoading(true); setError('');
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'BATTLE_READY_V2',
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

  const cancelChallenge = async () => {
    if (!battle) return;
    setActionLoading(true);
    try {
      await chrome.runtime.sendMessage({ type: 'BATTLE_CANCEL', battleId: battle.id });
      setBattle(null); setBattleState(null);
    } finally { setActionLoading(false); }
  };

  const forfeit = async () => {
    if (!battle) return;
    setActionLoading(true);
    try {
      await chrome.runtime.sendMessage({ type: 'BATTLE_FORFEIT_V2', battleId: battle.id });
      fetchBattleState();
    } finally { setActionLoading(false); }
  };

  const startNewChallenge = () => {
    setBattle(null); setBattleState(null); setError('');
    fetchBattleState();
  };

  // ─────────────────────────────────────────────────────────
  // RENDER GUARDS
  // ─────────────────────────────────────────────────────────

  if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <Swords className="w-7 h-7 text-red-400/60" />
        </div>
        <h2 className="text-sm font-bold text-text-main mb-2">Battle Mode Not Configured</h2>
        <p className="text-[10px] text-text-muted leading-relaxed">
          Set <code className="text-red-400">SUPABASE_URL</code> and <code className="text-red-400">SUPABASE_ANON_KEY</code> in <code className="text-text-muted">src/shared/supabase-client.js</code>.
        </p>
      </div>
    );
  }

  // ─── Auth gate ────────────────────────────────────────────
  if (authState !== 'AUTHENTICATED') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-4 text-center animate-fade-in overflow-y-auto scrollbar-hide">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-2.5">
          <Swords className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-base font-bold text-text-main mb-1">1v1 Battle Arena</h2>
        <p className="text-xs text-text-muted leading-relaxed mb-4 max-w-xs">
          Challenge friends, compete on shared problems, win glory.
        </p>

        <div className="flex w-full max-w-xs bg-surface/80 p-1 rounded-xl border border-surfaceHover/50 mb-3">
          <button type="button" onClick={() => { setAuthMode('signin'); setAuthError(''); setAuthSuccessMsg(''); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${authMode === 'signin' ? 'bg-primary text-inverted shadow-sm' : 'text-text-muted hover:text-text-main'}`}>
            Sign In
          </button>
          <button type="button" onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthSuccessMsg(''); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${authMode === 'signup' ? 'bg-primary text-inverted shadow-sm' : 'text-text-muted hover:text-text-main'}`}>
            Create Account
          </button>
        </div>

        {authError && <div className="w-full max-w-xs p-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-400 mb-3 text-left">{authError}</div>}
        {authSuccessMsg && <div className="w-full max-w-xs p-2.5 bg-green-500/10 border border-green-500/25 rounded-xl text-xs text-green-400 mb-3 text-left">{authSuccessMsg}</div>}
        {authCooldown > 0 && <div className="w-full max-w-xs p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-400 mb-3 text-center">Rate limited. Wait {authCooldown}s</div>}

        <form onSubmit={handleAuthSubmit} className="w-full max-w-xs space-y-2.5 text-left">
          {authMode === 'signup' && (
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1">LeetCode Username</label>
              <input type="text" placeholder="e.g. tour_de_code" value={authUsername}
                onChange={e => setAuthUsername(e.target.value)} disabled={authSubmitting} required
                className="w-full px-3 py-2 bg-surface/80 border border-surfaceHover/60 rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all" />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1">Email</label>
            <input type="email" placeholder="name@example.com" value={authEmail}
              onChange={e => setAuthEmail(e.target.value)} disabled={authSubmitting} required
              className="w-full px-3 py-2 bg-surface/80 border border-surfaceHover/60 rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1">Password</label>
            <input type="password" placeholder={authMode === 'signup' ? 'Min 6 characters' : 'Your password'} value={authPassword}
              onChange={e => setAuthPassword(e.target.value)} disabled={authSubmitting} required
              className="w-full px-3 py-2 bg-surface/80 border border-surfaceHover/60 rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all" />
          </div>
          <button type="submit" disabled={authSubmitting || authCooldown > 0}
            className="w-full py-2.5 bg-primary hover:bg-primaryHover text-inverted text-xs font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95 mt-1">
            {authSubmitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</> : authMode === 'signup' ? 'Create Account' : 'Sign In to Battle'}
          </button>
        </form>

        <p className="mt-3.5 text-[11px] text-text-muted max-w-xs text-center leading-relaxed">
          Streaks & progress are <span className="text-text-main font-semibold">100% offline</span>. Auth only needed for battles.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Swords className="w-10 h-10 text-red-500/40 animate-pulse" />
          <p className="text-xs text-text-muted">Loading arena…</p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // HOME
  // ─────────────────────────────────────────────────────────
  if (view === 'home') {
    return (
      <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
        {/* Presence refresh strip */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-surfaceHover/20">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-text-main">Battle Arena</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${
              onlineFriendsServer.length > 0
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-zinc-700/30 text-zinc-400 border-zinc-700/50'
            }`}>
              {onlineFriendsServer.length} online
            </span>
          </div>
          <button
            type="button"
            onClick={() => fetchPresence(true)}
            disabled={presenceRefreshing}
            className="text-[10px] text-text-muted hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg bg-surface border border-surfaceHover hover:border-primary/40 transition-all active:scale-95"
          >
            <RefreshCw className={`w-3 h-3 ${presenceRefreshing ? 'animate-spin text-primary' : ''}`} />
            {presenceRefreshing ? 'Syncing…' : 'Sync'}
          </button>
        </div>

        {/* Config builder (multi-step) */}
        <div className="flex-1 overflow-hidden">
          <BattleConfigBuilder
            friendsList={friendsList}
            presenceMap={presenceMap}
            onlineFriendsServer={onlineFriendsServer}
            myUsername={myUsername}
            onSendChallenge={sendChallenge}
            loading={actionLoading}
            error={error}
          />
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="border-t border-surfaceHover/20 px-4 py-3">
            <p className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-2">Recent Battles</p>
            <div className="space-y-1.5">
              {history.slice(0, 5).map(b => <HistoryRow key={b.id} battle={b} />)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── WAITING ──────────────────────────────────────────────
  if (view === 'waiting') {
    const topicsLabel = battle?.topics?.slice(0, 3).join(', ') || 'DSA';
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
          <Clock className="w-8 h-8 text-amber-400 animate-pulse" />
        </div>
        <h2 className="text-sm font-bold text-text-main mb-1">Challenge Sent!</h2>
        <p className="text-xs text-text-muted mb-1">Waiting for <span className="text-amber-400 font-semibold">{opponent}</span></p>

        {/* Battle config recap */}
        <div className="mt-3 mb-4 bg-surface/50 border border-surfaceHover/40 rounded-xl p-3 text-[10px] w-full max-w-xs space-y-1 text-left">
          <div className="flex justify-between">
            <span className="text-text-muted">Topics</span>
            <span className="text-text-main font-medium truncate max-w-[160px] text-right">{topicsLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Difficulty</span>
            <DifficultyBadge diff={battle?.difficulty || 'Medium'} />
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Duration</span>
            <span className="text-text-main font-medium">{formatMins(battle?.duration_minutes || 30)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Problems</span>
            <span className="text-text-main font-medium">{battle?.problem_count || 5}</span>
          </div>
        </div>

        {expiresIn != null && (
          <div className="mb-6">
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

  // ─── INCOMING ─────────────────────────────────────────────
  if (view === 'incoming') {
    const topicsLabel = battle?.topics?.slice(0, 3).join(', ') || 'DSA';
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Swords className="w-8 h-8 text-red-400" />
          </div>
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping" />
        </div>

        <h2 className="text-sm font-bold text-text-main mb-1">Challenge Incoming!</h2>
        <p className="text-xs text-text-muted mb-3">
          <span className="text-red-400 font-semibold">{opponent}</span> wants to battle
        </p>

        {/* Challenge details */}
        <div className="bg-surface/50 border border-red-500/15 rounded-xl p-3 text-[10px] w-full max-w-xs space-y-1 text-left mb-4">
          <div className="flex justify-between">
            <span className="text-text-muted">Topics</span>
            <span className="text-text-main font-medium truncate max-w-[160px] text-right">{topicsLabel}{(battle?.topics?.length || 0) > 3 ? ` +${battle.topics.length - 3}` : ''}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Difficulty</span>
            <DifficultyBadge diff={battle?.difficulty || 'Medium'} />
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Duration</span>
            <span className="text-text-main font-medium">{formatMins(battle?.duration_minutes || 30)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Problems</span>
            <span className="text-text-main font-medium">{battle?.problem_count || 5}</span>
          </div>
        </div>

        {expiresIn != null && (
          <div className="mb-4">
            <p className="text-[10px] text-text-muted mb-1">Expires in</p>
            <span className="font-mono text-lg font-bold text-text-main">{formatDuration(expiresIn)}</span>
          </div>
        )}

        {error && <p className="text-[10px] text-red-400 mb-3">{error}</p>}

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

  // ─── READY CHECK ──────────────────────────────────────────
  if (view === 'ready_check') {
    const myReady = myParticipant?.is_ready ||
      (amChallenger ? battle?.challenger_ready : battle?.challenged_ready);
    const oppReady = oppParticipant?.is_ready ||
      (amChallenger ? battle?.challenged_ready : battle?.challenger_ready);

    return (
      <div className="flex flex-col h-full px-4 py-6 overflow-y-auto scrollbar-hide text-center">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-3">
          <Swords className="w-6 h-6 text-red-400" />
        </div>
        <h2 className="text-sm font-bold text-text-main mb-1">Ready to Battle?</h2>
        <p className="text-[11px] text-text-muted mb-4">
          Problems will be chosen automatically from your selected topics.
        </p>

        {/* Battle config recap */}
        <div className="bg-surface/40 border border-surfaceHover/30 rounded-xl p-3 mb-4 text-[10px] text-left space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {(battle?.topics || ['Arrays']).slice(0,5).map(t => (
              <span key={t} className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-red-300 text-[9px]">{t}</span>
            ))}
            {(battle?.topics?.length || 0) > 5 && (
              <span className="text-text-muted text-[9px]">+{battle.topics.length - 5} more</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <DifficultyBadge diff={battle?.difficulty || 'Medium'} />
            <span className="text-text-muted">{formatMins(battle?.duration_minutes || 30)} · {battle?.problem_count || 5} problems</span>
          </div>
        </div>

        {/* Player status */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className={`p-3 rounded-xl border text-xs ${myReady ? 'border-green-500/30 bg-green-500/5 text-green-400' : 'border-surfaceHover bg-surface/30 text-text-muted'}`}>
            <div className="font-semibold mb-1">You</div>
            <div>{myReady ? '✓ Ready' : '⏳ Awaiting…'}</div>
          </div>
          <div className={`p-3 rounded-xl border text-xs ${oppReady ? 'border-green-500/30 bg-green-500/5 text-green-400' : 'border-surfaceHover bg-surface/30 text-text-muted'}`}>
            <div className="font-semibold mb-1 truncate">{opponent}</div>
            <div>{oppReady ? '✓ Ready' : '⏳ Awaiting…'}</div>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{error}</div>
        )}

        {!myReady ? (
          <button
            onClick={confirmReady}
            disabled={actionLoading}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Zap className="w-4 h-4" />
            {actionLoading ? 'Confirming…' : "I'm Ready!"}
          </button>
        ) : (
          <div className="text-xs text-text-muted flex items-center justify-center gap-2 py-3">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Waiting for {opponent} to confirm…
          </div>
        )}

        {/* Forfeit option */}
        <button onClick={forfeit} className="mt-4 text-[10px] text-text-muted/50 hover:text-red-400 transition-colors">
          Forfeit Battle
        </button>
      </div>
    );
  }

  // ─── REVEAL ───────────────────────────────────────────────
  if (view === 'reveal') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-[10px] text-text-muted uppercase tracking-widest mb-3">
          Battle begins in
        </p>
        <span className="font-mono text-6xl font-black text-red-400 mb-4">
          {revealCountdown ?? 0}
        </span>
        <p className="text-xs text-text-muted mb-4">
          Problems are being selected… your browser will redirect to LeetCode when it starts.
        </p>

        {/* Config reminder */}
        <div className="bg-surface/50 border border-red-500/15 rounded-xl p-3 text-[10px] w-full max-w-xs space-y-1 text-left">
          <div className="flex flex-wrap gap-1 mb-1">
            {(battle?.topics || []).slice(0,4).map(t => (
              <span key={t} className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-red-300 text-[9px]">{t}</span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <DifficultyBadge diff={battle?.difficulty || 'Medium'} />
            <span className="text-text-muted">{formatMins(battle?.duration_minutes || 30)} · {battle?.problem_count || 5} problems</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── ACTIVE ───────────────────────────────────────────────
  if (view === 'active') {
    const timeLeftSecs = battleTimeLeft;

    return (
      <div className="flex flex-col h-full px-4 py-4 overflow-y-auto scrollbar-hide">
        {/* Header: live indicator + time remaining */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse block" />
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Live Battle</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-text-muted" />
            <span className={`font-mono text-sm font-black ${timeLeftSecs != null && timeLeftSecs < 300 ? 'text-red-400' : 'text-text-main'}`}>
              {timeLeftSecs != null ? formatDuration(timeLeftSecs) : '--:--:--'}
            </span>
          </div>
        </div>

        {/* Score bar */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-surface border border-surfaceHover rounded-xl p-2.5 text-center">
            <span className="text-[9px] text-text-muted uppercase tracking-wider block mb-0.5">You</span>
            <span className="text-xl font-bold font-mono text-text-main">{mySolvedCount}<span className="text-[10px] text-text-muted font-normal">/{problems.length}</span></span>
          </div>
          <div className="bg-surface border border-surfaceHover rounded-xl p-2.5 text-center">
            <span className="text-[9px] text-text-muted uppercase tracking-wider block mb-0.5 truncate">{opponent}</span>
            <span className="text-xl font-bold font-mono text-text-main">{oppSolvedCount}<span className="text-[10px] text-text-muted font-normal">/{problems.length}</span></span>
          </div>
        </div>

        {/* Redirect notice */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-2.5 mb-3 text-[10px] text-amber-300 flex items-center gap-2">
          <Zap className="w-3 h-3 flex-shrink-0" />
          Your browser auto-redirects between problems. Keep LeetCode open.
        </div>

        {/* Problems list */}
        <div className="space-y-2 mb-4">
          {problems.map(p => {
            const iSolved = solveResults.some(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.problem_slug === p.problem_slug);
            const oSolved = solveResults.some(r => r.username?.toLowerCase() === opponent?.toLowerCase() && r.problem_slug === p.problem_slug);
            return (
              <a
                key={p.sequence_number}
                href={p.problem_url}
                target="_blank"
                rel="noopener noreferrer"
                className={`block bg-surface/60 border rounded-xl p-3 hover:border-red-500/40 transition-all group ${iSolved ? 'border-green-500/30 bg-green-500/5' : 'border-surfaceHover/50'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-[9px] text-text-muted uppercase tracking-wider">#{p.sequence_number}</span>
                      {iSolved && <span className="text-[9px] text-green-400 font-bold bg-green-500/15 px-1.5 py-0.5 rounded">✓ Solved</span>}
                      {oSolved && <span className="text-[9px] text-amber-400 font-bold bg-amber-500/15 px-1.5 py-0.5 rounded">{opponent} solved</span>}
                      {p.difficulty && <DifficultyBadge diff={p.difficulty} />}
                    </div>
                    <p className="text-xs font-bold text-text-main truncate">{p.problem_title}</p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-text-muted group-hover:text-red-400 transition-colors flex-shrink-0 ml-2" />
                </div>
              </a>
            );
          })}
        </div>

        {/* Forfeit */}
        <button
          onClick={forfeit}
          className="w-full py-2 text-xs text-text-muted border border-surfaceHover/40 rounded-xl hover:border-red-500/30 hover:text-red-400 transition-all"
        >
          <Flag className="w-3 h-3 inline mr-1.5" />
          Forfeit Battle
        </button>
      </div>
    );
  }

  // ─── RESULT ───────────────────────────────────────────────
  if (view === 'result') {
    const winner = battle?.winner_username;
    const iWon = winner && winner !== 'draw' && winner.toLowerCase() === myUsername?.toLowerCase();
    const isDraw = winner === 'draw' || !winner;
    const winReason = battle?.win_reason;

    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center overflow-y-auto scrollbar-hide py-6">
        <div className="text-5xl mb-3">
          {iWon ? '🏆' : isDraw ? '🤝' : '💀'}
        </div>
        <h2 className={`text-base font-bold mb-1 ${iWon ? 'text-amber-400' : isDraw ? 'text-text-main' : 'text-red-400'}`}>
          {iWon ? 'Victory!' : isDraw ? 'Draw!' : 'Defeated'}
        </h2>
        <p className="text-xs text-text-muted mb-4">
          {iWon ? `You beat ${opponent}` : isDraw ? `Even match against ${opponent}` : `${winner} won this one`}
          {winReason === 'tiebreaker_time' ? ' (by time)' : ''}
          {winReason === 'forfeit' ? ' (forfeit)' : ''}
        </p>

        {/* Score */}
        <div className="grid grid-cols-2 gap-3 w-full max-w-xs mb-5">
          <div className={`p-3 rounded-xl border text-center ${iWon ? 'border-amber-500/30 bg-amber-500/5' : 'border-surfaceHover'}`}>
            <span className="text-[10px] text-text-muted block mb-1">You</span>
            <span className="text-2xl font-bold font-mono text-text-main">{mySolvedCount}</span>
            <span className="text-[9px] text-text-muted block">problems solved</span>
          </div>
          <div className={`p-3 rounded-xl border text-center ${!iWon && !isDraw ? 'border-amber-500/30 bg-amber-500/5' : 'border-surfaceHover'}`}>
            <span className="text-[10px] text-text-muted block mb-1 truncate">{opponent}</span>
            <span className="text-2xl font-bold font-mono text-text-main">{oppSolvedCount}</span>
            <span className="text-[9px] text-text-muted block">problems solved</span>
          </div>
        </div>

        {/* Topics fought over */}
        <div className="flex flex-wrap gap-1 justify-center mb-5">
          {(battle?.topics || []).slice(0,5).map(t => (
            <span key={t} className="px-1.5 py-0.5 bg-surface border border-surfaceHover rounded text-text-muted text-[9px]">{t}</span>
          ))}
        </div>

        <button
          onClick={startNewChallenge}
          className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <Swords className="w-3.5 h-3.5" />
          New Battle
        </button>
      </div>
    );
  }

  return null;
}
