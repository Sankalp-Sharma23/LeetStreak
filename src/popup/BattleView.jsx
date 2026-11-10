import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Swords, Trophy, Clock, ChevronRight, ChevronDown, Filter, X, Check, AlertCircle,
  ExternalLink, Flag, RefreshCw, Loader2, Sparkles, Zap,
  Target, Timer, Hash
} from 'lucide-react';
import {
  BATTLE_STATUS,
  TERMINAL_STATES,
  createBattleV2,
  acceptBattleV2,
  confirmReadyV2,
  forfeitBattleV2,
  getBattleStateV2,
  getActiveBattle,
  getBattle,
  respondToBattle,
  cancelBattle
} from '../shared/battle-manager.js';
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
const HISTORY_PAGE_SIZE = 12;
const HISTORY_FILTER_CLASS = 'min-w-0 rounded-md border border-surfaceHover/50 bg-surface px-2 py-1.5 text-[9px] text-text-main outline-none focus:border-primary/50';

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

function historyDateBounds(filters) {
  const now = new Date();
  if (filters.date === 'today') {
    const from = new Date(now); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (filters.date === '7d' || filters.date === '30d') {
    const from = new Date(now);
    from.setDate(from.getDate() - (filters.date === '7d' ? 7 : 30));
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (filters.date === 'custom') {
    const from = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00`) : null;
    const to = filters.toDate ? new Date(`${filters.toDate}T00:00:00`) : null;
    if (to) to.setDate(to.getDate() + 1);
    return { from: from?.toISOString() || null, to: to?.toISOString() || null };
  }
  return { from: null, to: null };
}

function getHistoryApiFilters(filters) {
  return {
    result: filters.result,
    topic: filters.topic,
    difficulty: filters.difficulty,
    opponentId: filters.opponentId,
    ...historyDateBounds(filters)
  };
}

function HistoryScoreboardCard({ row, myUsername }) {
  const myName = row.my_username || myUsername || 'You';
  const oppName = row.opponent_username || 'Opponent';

  // Do not display invalid self-battles
  if (oppName.trim().toLowerCase() === myName.trim().toLowerCase()) {
    return null;
  }
  const myWins = Number(row.my_wins) || 0;
  const oppWins = Number(row.opponent_wins) || 0;
  const draws = Number(row.draws) || 0;
  const total = Number(row.completed_battles) || (myWins + oppWins + draws);

  const isLeading = myWins > oppWins;
  const isTrailing = myWins < oppWins;

  const initials = (value) => (value || '?').slice(0, 1).toUpperCase();

  return (
    <div className="w-full rounded-2xl border border-surfaceHover/70 bg-[#16181d] p-3.5 shadow-sm">
      {/* Row 1: sankalp (you )    v/s     user1 */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        {/* Left: sankalp (you) */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-full bg-primary/20 text-primary border border-primary/30 flex items-center justify-center text-xs font-bold shrink-0">
            {initials(myName)}
          </div>
          <span className="truncate text-xs font-bold text-text-main">
            {myName} <span className="text-[10px] font-semibold text-primary">(you)</span>
          </span>
        </div>

        {/* Center: v/s */}
        <div className="shrink-0 px-2.5 py-0.5 rounded-full bg-[#1e2128] border border-[#2d313a] text-[10px] font-extrabold uppercase tracking-wider text-text-muted">
          v/s
        </div>

        {/* Right: user1 */}
        <div className="flex items-center justify-end gap-2 min-w-0 flex-1 text-right">
          <span className="truncate text-xs font-bold text-text-main">
            {oppName}
          </span>
          <div className="w-7 h-7 rounded-full bg-[#272b34] text-text-muted border border-[#333844] flex items-center justify-center text-xs font-bold shrink-0">
            {initials(oppName)}
          </div>
        </div>
      </div>

      {/* Row 2: score      5    :    3 */}
      <div className="flex items-center justify-between pt-2.5 border-t border-[#22252b]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            score
          </span>
          <div className="flex items-center gap-1.5 font-mono">
            <span className={`text-sm font-black ${isLeading ? 'text-emerald-400' : isTrailing ? 'text-text-muted' : 'text-text-main'}`}>
              {myWins}
            </span>
            <span className="text-xs font-bold text-text-muted">:</span>
            <span className={`text-sm font-black ${isTrailing ? 'text-red-400' : isLeading ? 'text-text-muted' : 'text-text-main'}`}>
              {oppWins}
            </span>
          </div>
          {draws > 0 && (
            <span className="text-[9px] text-text-muted font-normal">
              ({draws} {draws === 1 ? 'tie' : 'ties'})
            </span>
          )}
        </div>

        <div className="text-[10px] text-text-muted">
          <span>{total} {total === 1 ? 'match' : 'matches'}</span>
        </div>
      </div>
    </div>
  );
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

// ─────────────────────────────────────────────────────────────
// BATTLE CONFIG BUILDER (home screen)
// ─────────────────────────────────────────────────────────────

function BattleConfigBuilder({ friendsList, presenceMap, onlineFriendsServer, onSendChallenge, onClose, loading, error, initialOpponent = '' }) {
  const [selectedTopics, setSelectedTopics] = useState(['Arrays', 'Strings']);
  const [difficulty, setDifficulty] = useState('Medium');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [problemCount, setProblemCount] = useState(5);
  const [selectedFriend, setSelectedFriend] = useState(initialOpponent || '');
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
        <button type="button" onClick={onClose} className="mb-3 self-start text-[10px] font-semibold text-text-muted hover:text-text-main">← Back to scoreboard</button>
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

export default function BattleView({
  myUsername,
  friends,
  _returnTarget = null,
  _onAuthSuccess = null,
  onRequireAuth = null,
  presenceMap: externalPresenceMap = null,
  initialOpponent = null,
  onClearInitialOpponent = null
}) {
  const [battle, setBattle] = useState(null);
  const [battleState, setBattleState] = useState(null); // full v2 state: {problems, participants, results}
  const [historyFilters, setHistoryFilters] = useState({ result: 'all', topic: 'all', difficulty: 'all', opponentId: 'all', date: 'all', fromDate: '', toDate: '' });
  const [historyScoreboards, setHistoryScoreboards] = useState([]);
  const [historyOpponentOptions, setHistoryOpponentOptions] = useState([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyTotalMatches, setHistoryTotalMatches] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const [showCreateBattle, setShowCreateBattle] = useState(false);
  const historyOffsetRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [friendsList, setFriendsList] = useState([]);
  const [presenceMap, setPresenceMap] = useState({});
  const [onlineFriendsServer, setOnlineFriendsServer] = useState([]);
  const [presenceRefreshing, setPresenceRefreshing] = useState(false);
  const [authState, setAuthState] = useState('AUTHENTICATED');
  const [actionLoading, setActionLoading] = useState(false);
  const [revealCountdown, setRevealCountdown] = useState(null);

  useEffect(() => {
    if (initialOpponent) {
      setShowCreateBattle(true);
    }
  }, [initialOpponent]);

  useEffect(() => {
    let mounted = true;
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (res) => {
        if (mounted && res?.state) {
          setAuthState(res.state);
        }
      });
    }
    return () => { mounted = false; };
  }, []);

  // ─── Countdown hooks ─────────────────────────────────────
  const expiresIn = useCountdown(battle?.expires_at);
  const battleTimeLeft = useCountdown(battle?.end_at || battle?.match_deadline);

  const loadHistoryScoreboard = useCallback(async (reset = false) => {
    if (reset) historyOffsetRef.current = 0;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'BATTLE_GET_HISTORY_SCOREBOARD',
        filters: getHistoryApiFilters(historyFilters),
        limit: HISTORY_PAGE_SIZE,
        offset: historyOffsetRef.current
      });
      if (!response?.success) throw new Error(response?.error || 'Could not load battle history.');
      const allRows = response.rows || [];
      const myLower = (myUsername || '').trim().toLowerCase();
      const rows = allRows.filter(r => {
        const oppLower = (r.opponent_username || '').trim().toLowerCase();
        const rowMyLower = (r.my_username || myLower).trim().toLowerCase();
        return oppLower && oppLower !== rowMyLower && (!r.opponent_id || !r.my_id || r.opponent_id !== r.my_id);
      });
      setHistoryScoreboards(current => reset ? rows : [...current, ...rows]);
      if (response.opponents) {
        setHistoryOpponentOptions(response.opponents.filter(o => (o.opponent_username || '').trim().toLowerCase() !== myLower));
      }
      historyOffsetRef.current = reset ? allRows.length : historyOffsetRef.current + allRows.length;
      setHistoryHasMore(!!response.has_more);
      const filteredMatches = rows.reduce((sum, r) => sum + (Number(r.completed_battles) || 0), 0);
      setHistoryTotalMatches(reset ? filteredMatches : (response.total_matches || filteredMatches));
    } catch (err) {
      setHistoryError(err.message || 'Could not load battle history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFilters, myUsername]);

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
  const problems = useMemo(() => {
    return battleState?.problems || (battle ? [
      battle.problem_1 ? { sequence_number: 1, problem_slug: battle.problem_1, problem_title: battle.problem_1_title || battle.problem_1, problem_url: `https://leetcode.com/problems/${battle.problem_1}/` } : null,
      battle.problem_2 ? { sequence_number: 2, problem_slug: battle.problem_2, problem_title: battle.problem_2_title || battle.problem_2, problem_url: `https://leetcode.com/problems/${battle.problem_2}/` } : null,
    ].filter(Boolean) : []);
  }, [battleState?.problems, battle]);

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
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_STATUS', username: myUsername, includeHistory: false });
      } catch (e) {
        console.warn('[BattleView] BATTLE_GET_STATUS error:', e);
      }

      let currentBattle = resp?.battle;
      if (!currentBattle && (!resp || resp?.error?.includes('Unknown message type'))) {
        try {
          currentBattle = await getActiveBattle(myUsername);
        } catch (e) {}
      }

      // If user was actively in a match that just finished, retrieve the finalized battle
      const prevBattle = battleRef.current;
      if (!currentBattle && prevBattle && ['in_progress', 'countdown', 'ready_check'].includes(prevBattle.status)) {
        try {
          const finished = await getBattle(prevBattle.id);
          if (finished && ['completed', 'forfeited'].includes(finished.status)) {
            currentBattle = finished;
          }
        } catch (e) {}
      }

      if (currentBattle) {
        setBattle(currentBattle);

        // Set reveal countdown from server timestamp
        if (currentBattle.status === 'countdown' && currentBattle.match_starts_at) {
          const rem = Math.max(0, Math.round((new Date(currentBattle.match_starts_at).getTime() - Date.now()) / 1000));
          setRevealCountdown(rem > 0 ? rem : null);
        }

        // Fetch full v2 state if we have a battle
        if (currentBattle.id) {
          let stateResp = resp?.state ? { success: true, state: resp.state } : null;
          if (!stateResp) {
            try {
              stateResp = await chrome.runtime.sendMessage({
                type: 'BATTLE_GET_STATE_V2',
                battleId: currentBattle.id
              });
            } catch (e) {}
          }

          if (stateResp?.success && stateResp.state) {
            setBattleState(stateResp.state);
            if (stateResp.state.battle) {
              currentBattle = stateResp.state.battle;
              setBattle(currentBattle);
            }
          } else {
            try {
              const directState = await getBattleStateV2(currentBattle.id);
              if (directState) setBattleState(directState);
            } catch (e) {}
          }
        }
      } else {
        setBattle(null);
        setBattleState(null);
      }
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

  useEffect(() => {
    loadHistoryScoreboard(true);
  }, [loadHistoryScoreboard]);

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
  const hasRedirectedRef = useRef(false);

  const redirectToProblem = useCallback(async (problemUrl) => {
    const targetUrl = problemUrl || problems[0]?.problem_url || (problems[0]?.problem_slug ? `https://leetcode.com/problems/${problems[0].problem_slug}/` : null);
    if (!targetUrl) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: 'BATTLE_OPEN_PROBLEM',
          url: targetUrl,
          battleId: battle?.id
        });
      } else {
        window.open(targetUrl, '_blank');
      }
    } catch {
      window.open(targetUrl, '_blank');
    }
  }, [problems, battle?.id]);

  useEffect(() => {
    if (view === 'reveal' && revealCountdown === 0) {
      if (!hasRedirectedRef.current) {
        hasRedirectedRef.current = true;
        redirectToProblem();
      }
      setTimeout(fetchBattleState, 500);
    }
    if (view !== 'reveal' && view !== 'active') {
      hasRedirectedRef.current = false;
    }
  }, [revealCountdown, view, fetchBattleState, redirectToProblem]);

  // ─── Actions ──────────────────────────────────────────────
  const sendChallenge = async ({ challenged, topics, difficulty, durationMinutes, problemCount }) => {
    setActionLoading(true); setError('');
    try {
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({
          type: 'BATTLE_CHALLENGE_V2',
          challenger: myUsername,
          challenged,
          topics,
          difficulty,
          durationMinutes,
          problemCount
        });
      } catch (sendErr) {
        console.warn('[BattleView] sendChallenge sendMessage error:', sendErr);
      }

      if (!resp?.success && (resp?.error?.includes('Unknown message type') || !resp)) {
        try {
          resp = await createBattleV2(myUsername, challenged, {
            topics,
            difficulty,
            durationMinutes,
            problemCount
          });
        } catch (fallbackErr) {
          resp = { success: false, error: fallbackErr.message };
        }
      }

      if (resp?.success) {
        setShowCreateBattle(false);
        setBattle(resp.battle);
        await fetchBattleState();
      } else {
        setError(resp?.error || 'Failed to send challenge');
      }
    } catch (err) {
      setError(err?.message || 'Failed to send challenge');
    } finally {
      setActionLoading(false);
    }
  };

  const respond = async (accept) => {
    if (!battle) return;
    setActionLoading(true); setError('');
    try {
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({
          type: accept ? 'BATTLE_ACCEPT_V2' : 'BATTLE_RESPOND',
          battleId: battle.id,
          accept
        });
      } catch (sendErr) {
        console.warn('[BattleView] respond sendMessage error:', sendErr);
      }

      if (!resp?.success && (resp?.error?.includes('Unknown message type') || !resp)) {
        try {
          if (accept) {
            resp = await acceptBattleV2(battle.id);
          } else {
            resp = await respondToBattle(battle.id, myUsername, false);
          }
        } catch (fallbackErr) {
          resp = { success: false, error: fallbackErr.message };
        }
      }

      if (resp?.success) {
        if (resp.battle) setBattle(resp.battle);
        await fetchBattleState();
      } else {
        setError(resp?.error || 'Failed to respond');
      }
    } catch (err) {
      setError(err?.message || 'Failed to respond');
    } finally {
      setActionLoading(false);
    }
  };

  const confirmReady = async () => {
    if (!battle) return;
    setActionLoading(true); setError('');
    try {
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({
          type: 'BATTLE_READY_V2',
          battleId: battle.id,
          username: myUsername
        });
      } catch (sendErr) {
        console.warn('[BattleView] confirmReady sendMessage error:', sendErr);
      }

      if (!resp?.success && (resp?.error?.includes('Unknown message type') || !resp)) {
        try {
          resp = await confirmReadyV2(battle.id, myUsername);
        } catch (fallbackErr) {
          resp = { success: false, error: fallbackErr.message };
        }
      }

      if (resp?.success) {
        if (resp.battle) setBattle(resp.battle);
        await fetchBattleState();
      } else if (resp?.error) {
        setError(resp.error);
      }
    } catch (err) {
      setError(err?.message || 'Failed to confirm ready');
    } finally {
      setActionLoading(false);
    }
  };

  const cancelChallenge = async () => {
    if (!battle) return;
    setActionLoading(true);
    try {
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({ type: 'BATTLE_CANCEL', battleId: battle.id });
      } catch (e) {}
      if (!resp?.success && (resp?.error?.includes('Unknown message type') || !resp)) {
        try {
          await cancelBattle(battle.id, myUsername);
        } catch (e) {}
      }
      setBattle(null);
      setBattleState(null);
    } finally {
      setActionLoading(false);
    }
  };

  const forfeit = async () => {
    if (!battle) return;
    setActionLoading(true);
    try {
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({ type: 'BATTLE_FORFEIT_V2', battleId: battle.id, username: myUsername });
      } catch (e) {}
      if (!resp?.success && (resp?.error?.includes('Unknown message type') || !resp)) {
        try {
          resp = await forfeitBattleV2(battle.id, myUsername);
        } catch (e) {}
      }
      await fetchBattleState();
    } finally {
      setActionLoading(false);
    }
  };

  const startNewChallenge = () => {
    setBattle(null);
    setBattleState(null);
    setError('');
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
      <div className="flex flex-col items-center justify-center h-full px-6 py-4 text-center animate-fade-in">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
          <Swords className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-base font-bold text-text-main mb-1">Authentication Required</h2>
        <p className="text-xs text-text-muted leading-relaxed mb-4 max-w-xs">
          Sign in to your cloud account to challenge friends, compete in real-time, and view battle scoreboards.
        </p>
        <button
          type="button"
          onClick={() => onRequireAuth?.('battle')}
          className="px-5 py-2.5 bg-primary hover:bg-primaryHover text-inverted text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95"
        >
          Sign In / Connect Account
        </button>
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
    if (showCreateBattle) {
      return (
        <div className="h-full overflow-hidden">
          <BattleConfigBuilder
            friendsList={friendsList}
            presenceMap={presenceMap}
            onlineFriendsServer={onlineFriendsServer}
            onSendChallenge={sendChallenge}
            onClose={() => {
              setShowCreateBattle(false);
              onClearInitialOpponent?.();
            }}
            loading={actionLoading}
            error={error}
            initialOpponent={initialOpponent}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-2">
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
          <button type="button" onClick={() => { setError(''); setShowCreateBattle(true); }}
            className="w-full rounded-xl bg-red-600 hover:bg-red-700 px-3 py-2.5 text-xs font-bold text-white transition-colors flex items-center justify-center gap-2">
            <Swords className="w-4 h-4" /> Create Battle
          </button>
          <button type="button" onClick={() => setHistoryFiltersOpen(open => !open)} aria-expanded={historyFiltersOpen}
            className="mt-2 flex w-full items-center justify-between rounded-lg border border-surfaceHover/50 bg-surface/40 px-3 py-2 text-[10px] font-semibold text-text-muted hover:text-text-main">
            <span className="flex items-center gap-2"><Filter className="w-3.5 h-3.5" /> Filters</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${historyFiltersOpen ? 'rotate-180' : ''}`} />
          </button>
          {historyFiltersOpen && (
            <div className="mt-2">
              <div className="grid grid-cols-2 gap-1.5">
                <select aria-label="Filter by result" value={historyFilters.result} onChange={e => setHistoryFilters(f => ({ ...f, result: e.target.value }))} className={HISTORY_FILTER_CLASS}>
                  <option value="all">All results</option><option value="win">Wins</option><option value="loss">Losses</option><option value="draw">Draws</option>
                </select>
                <select aria-label="Filter by topic" value={historyFilters.topic} onChange={e => setHistoryFilters(f => ({ ...f, topic: e.target.value }))} className={HISTORY_FILTER_CLASS}>
                  <option value="all">All topics</option>{DSA_TOPICS.map(topic => <option key={topic} value={topic}>{topic}</option>)}<option value="__other__">Other topics</option>
                </select>
                <select aria-label="Filter by difficulty" value={historyFilters.difficulty} onChange={e => setHistoryFilters(f => ({ ...f, difficulty: e.target.value }))} className={HISTORY_FILTER_CLASS}>
                  <option value="all">All difficulties</option><option value="Easy">Easy</option><option value="Medium">Medium</option><option value="Hard">Hard</option>
                </select>
                <select aria-label="Filter by opponent" value={historyFilters.opponentId} onChange={e => setHistoryFilters(f => ({ ...f, opponentId: e.target.value }))} className={HISTORY_FILTER_CLASS}>
                  <option value="all">All opponents</option>{historyOpponentOptions.map(row => <option key={row.opponent_id} value={row.opponent_id}>{row.opponent_username}</option>)}
                </select>
                <select aria-label="Filter by date" value={historyFilters.date} onChange={e => setHistoryFilters(f => ({ ...f, date: e.target.value }))} className={`${HISTORY_FILTER_CLASS} col-span-2`}>
                  <option value="all">All time</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom range</option>
                </select>
                {historyFilters.date === 'custom' && <>
                  <input aria-label="Start date" type="date" value={historyFilters.fromDate} onChange={e => setHistoryFilters(f => ({ ...f, fromDate: e.target.value }))} className={HISTORY_FILTER_CLASS} />
                  <input aria-label="End date" type="date" value={historyFilters.toDate} onChange={e => setHistoryFilters(f => ({ ...f, toDate: e.target.value }))} className={HISTORY_FILTER_CLASS} />
                </>}
              </div>
              {Object.entries(historyFilters).some(([key, value]) => value && value !== 'all' && key !== 'fromDate' && key !== 'toDate') || historyFilters.fromDate || historyFilters.toDate ? (
                <button type="button" onClick={() => setHistoryFilters({ result: 'all', topic: 'all', difficulty: 'all', opponentId: 'all', date: 'all', fromDate: '', toDate: '' })}
                  className="mt-2 text-[9px] font-semibold text-primary hover:text-text-main">Clear filters</button>
              ) : null}
            </div>
          )}
        </div>

        <section className="px-4 pb-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[11px] font-bold text-text-main">Head-to-head scoreboard</h3>
              <p className="text-[9px] text-text-muted">{historyTotalMatches} matching completed battles</p>
            </div>
            <button type="button" onClick={() => loadHistoryScoreboard(true)} disabled={historyLoading}
              className="rounded-md border border-surfaceHover px-2 py-1 text-[9px] text-text-muted hover:text-text-main disabled:opacity-50">Refresh</button>
          </div>

          {historyError && <p className="rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-[9px] text-red-300">{historyError}</p>}
          {!historyError && !historyLoading && historyScoreboards.length === 0 && (
            <p className="rounded-lg border border-surfaceHover/40 bg-surface/30 p-4 text-center text-[10px] text-text-muted">No battles match these filters.</p>
          )}
          <div className="space-y-2">
            {historyScoreboards.map(row => (
              <HistoryScoreboardCard key={row.opponent_id} row={row} myUsername={myUsername} />
            ))}
          </div>
          {historyHasMore && <button type="button" onClick={() => loadHistoryScoreboard(false)} disabled={historyLoading}
            className="mt-3 w-full rounded-lg border border-surfaceHover/50 py-2 text-[10px] font-semibold text-text-muted hover:border-primary/40 hover:text-text-main disabled:opacity-50">{historyLoading ? 'Loading…' : 'Load more opponents'}</button>}
          {historyLoading && historyScoreboards.length === 0 && <p className="py-3 text-center text-[10px] text-text-muted">Loading scoreboard…</p>}
        </section>
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

        {/* Quick jump to current active problem */}
        <button
          onClick={() => {
            const unsolved = problems.find(p => !solveResults.some(r => r.username?.toLowerCase() === myUsername?.toLowerCase() && r.problem_slug === p.problem_slug)) || problems[0];
            if (unsolved) redirectToProblem(unsolved.problem_url);
          }}
          className="w-full py-2.5 px-3 mb-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Solve Current Problem on LeetCode
        </button>

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
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center overflow-y-auto scrollbar-hide py-6">
        <div className="text-4xl mb-3">{iWon ? '🏆' : isDraw ? '🤝' : '⚔️'}</div>
        <h2 className={`text-sm font-bold uppercase tracking-wider mb-5 ${iWon ? 'text-amber-400' : isDraw ? 'text-text-main' : 'text-red-400'}`}>
          {iWon ? 'Victory' : isDraw ? 'Draw' : 'Battle complete'}
        </h2>
        <div className="w-full max-w-xs flex items-center justify-center gap-4 rounded-xl border border-surfaceHover bg-surface/60 px-4 py-5 mb-6">
          <span className="text-[10px] font-bold tracking-wider text-text-main">YOU</span>
          <span className="text-2xl font-bold font-mono text-text-main">{mySolvedCount}:{oppSolvedCount}</span>
          <span className="max-w-24 truncate text-[10px] font-bold tracking-wider text-text-main">{opponent?.toUpperCase()}</span>
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
