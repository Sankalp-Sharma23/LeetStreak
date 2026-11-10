import React, { useState, useMemo } from 'react';
import {
  X,
  Flame,
  Swords,
  Users,
  CheckCheck,
  TrendingUp,
  ExternalLink,
  Check,
  Bell,
  Trash2
} from 'lucide-react';

function formatTimestamp(ts) {
  if (!ts) return 'just now';
  const diffMs = Date.now() - ts;
  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffM / 60);

  if (diffM < 1) return 'just now';
  if (diffM < 60) return `${diffM}m ago`;
  if (diffH < 24) return `${diffH}h ago`;

  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function NotificationCenter({
  notifications = [],
  onDismiss,
  onMarkAllRead,
  onClearAll,
  onClose,
  onNavigateView,
  onChallengeFromRoast = null
}) {
  const [filter, setFilter] = useState('all'); // 'all' | 'battles' | 'friends' | 'system'

  const battleCount = useMemo(() => {
    return notifications.filter(n => n.type === 'battle_invite' || n.type === 'battle_opponent_solved' || n.type === 'rating_update').length;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (filter === 'battles') {
      return notifications.filter(n => n.type === 'battle_invite' || n.type === 'battle_opponent_solved' || n.type === 'rating_update');
    }
    if (filter === 'friends') {
      return notifications.filter(n => n.type === 'new_submission' || n.type === 'solved_today' || n.type === 'roast');
    }
    if (filter === 'system') {
      return notifications.filter(n => n.type === 'streak_at_risk' || n.type === 'daily_problem_reminder' || n.type === 'custom');
    }
    return notifications;
  }, [notifications, filter]);

  // Group into sections
  const attentionItems = useMemo(() => {
    return filteredNotifications.filter(n => n.type === 'streak_at_risk');
  }, [filteredNotifications]);

  const battleItems = useMemo(() => {
    return filteredNotifications.filter(n => n.type === 'battle_invite');
  }, [filteredNotifications]);

  const recentItems = useMemo(() => {
    return filteredNotifications.filter(n => n.type !== 'streak_at_risk' && n.type !== 'battle_invite');
  }, [filteredNotifications]);

  const handleSolveDaily = (notificationId) => {
    window.open('https://leetcode.com/problemset/', '_blank');
    if (onDismiss && notificationId) onDismiss(notificationId);
  };

  const handleAcceptBattle = async (battleId, notificationId) => {
    if (!battleId) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({ type: 'BATTLE_ACCEPT_V2', battleId });
      }
    } catch (err) {
      console.warn('[NotificationCenter] Battle accept error:', err);
    }
    if (onDismiss && notificationId) onDismiss(notificationId);
    if (onNavigateView) onNavigateView('battle');
    if (onClose) onClose();
  };

  const handleDeclineBattle = async (battleId, notificationId) => {
    if (!battleId) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({ type: 'BATTLE_RESPOND', battleId, accept: false });
      }
    } catch (err) {
      console.warn('[NotificationCenter] Battle decline error:', err);
    }
    if (onDismiss && notificationId) onDismiss(notificationId);
  };

  const handleOpenProblem = (notification) => {
    const slug = notification.problemSlug || notification.data?.slug;
    const url = slug ? `https://leetcode.com/problems/${slug}/` : 'https://leetcode.com/problemset/';
    window.open(url, '_blank');
    if (onDismiss && notification.id) onDismiss(notification.id);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-fade-in"
        onClick={onClose}
      />

      {/* Centered Modal Container */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-3 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[390px] bg-[#121316] border border-[#272a30] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-[#e4e4e7] animate-scale-in-center">
          
          {/* Header */}
          <div className="p-4 border-b border-[#22252b] flex items-center justify-between bg-[#16181d]">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-bold tracking-tight text-white">Notifications</h2>
              {notifications.length > 0 && (
                <span className="px-1.5 py-0.5 text-[11px] font-bold bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/30 rounded-md">
                  {notifications.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <button
                  onClick={onMarkAllRead}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9ca3af] hover:text-white px-2 py-1 rounded-md hover:bg-[#20232a] transition-colors"
                  title="Mark all notifications as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1 text-[#9ca3af] hover:text-white hover:bg-[#20232a] rounded-lg transition-colors"
                aria-label="Close notifications"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="px-3 py-2 border-b border-[#22252b] bg-[#14161a] flex gap-1.5 overflow-x-auto">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                filter === 'all'
                  ? 'bg-[#2b303b] text-white shadow-sm'
                  : 'text-[#9ca3af] hover:text-white hover:bg-[#1f2229]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('battles')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1.5 ${
                filter === 'battles'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'text-[#9ca3af] hover:text-white hover:bg-[#1f2229]'
              }`}
            >
              Battles
              {battleCount > 0 && (
                <span className="w-4 h-4 text-[10px] bg-red-500 text-white font-bold rounded-full flex items-center justify-center">
                  {battleCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setFilter('friends')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                filter === 'friends'
                  ? 'bg-[#2b303b] text-white shadow-sm'
                  : 'text-[#9ca3af] hover:text-white hover:bg-[#1f2229]'
              }`}
            >
              Friends
            </button>
            <button
              onClick={() => setFilter('system')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                filter === 'system'
                  ? 'bg-[#2b303b] text-white shadow-sm'
                  : 'text-[#9ca3af] hover:text-white hover:bg-[#1f2229]'
              }`}
            >
              System
            </button>
          </div>

          {/* Body: Scrollable Content */}
          <div className="p-3.5 overflow-y-auto space-y-4 flex-1">
            {filteredNotifications.length === 0 ? (
              <div className="py-12 text-center text-[#71717a]">
                <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium text-[#a1a1aa]">All caught up!</p>
                <p className="text-xs text-[#71717a] mt-1">No unread notifications in this category.</p>
              </div>
            ) : (
              <>
                {/* 1. ATTENTION NEEDED */}
                {attentionItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold tracking-wider uppercase text-[#f59e0b] flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5" />
                      Attention Needed
                    </div>
                    {attentionItems.map(item => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl bg-[#1c1815] border border-amber-500/30 text-left relative overflow-hidden"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-bold text-xs text-amber-300 flex items-center gap-1.5">
                            🔥 Streak at Risk!
                          </span>
                          <span className="text-[10px] text-amber-500/80 font-mono">
                            {formatTimestamp(item.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-[#d4d4d8] mb-3 leading-relaxed">
                          {item.message || `Your ${item.streak || ''}-day streak will reset at midnight.`}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSolveDaily(item.id)}
                            className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Solve 1 Daily Problem
                          </button>
                          <button
                            onClick={() => onDismiss?.(item.id)}
                            className="py-1.5 px-3 text-xs font-medium text-[#a1a1aa] hover:text-white border border-[#30333d] hover:bg-[#222630] rounded-lg transition-colors"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. BATTLES & INVITATIONS */}
                {battleItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold tracking-wider uppercase text-red-400 flex items-center gap-1.5">
                      <Swords className="w-3.5 h-3.5" />
                      Battles & Invitations
                    </div>
                    {battleItems.map(item => {
                      const challenger = item.challenger || item.username || 'Friend';
                      const duration = item.data?.durationMinutes || 15;
                      const topics = item.data?.topics?.length ? item.data.topics.join(', ') : item.data?.difficulty || 'Medium';
                      return (
                        <div
                          key={item.id}
                          className="p-3 rounded-xl bg-[#1c1417] border border-red-500/30 text-left relative overflow-hidden"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="font-bold text-xs text-red-300 flex items-center gap-1.5">
                              ⚔️ Battle Request from @{challenger}
                            </span>
                            <span className="text-[10px] text-red-400/80 font-mono">
                              {formatTimestamp(item.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-[#d4d4d8] mb-3 leading-relaxed">
                            Ranked 1v1 • {duration} min • {topics}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleAcceptBattle(item.battleId || item.data?.battleId, item.id)}
                              className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Accept
                            </button>
                            <button
                              onClick={() => handleDeclineBattle(item.battleId || item.data?.battleId, item.id)}
                              className="py-1.5 px-3 text-xs font-medium text-[#a1a1aa] hover:text-red-400 border border-[#30333d] hover:bg-[#222630] rounded-lg transition-colors"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 3. RECENT ACTIVITY */}
                {recentItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold tracking-wider uppercase text-[#9ca3af] flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      Recent Activity
                    </div>
                    <div className="space-y-2">
                      {recentItems.map(item => {
                        const isSolve = item.type === 'new_submission' || item.type === 'solved_today';
                        const isRating = item.type === 'rating_update';
                        const isRoast = item.type === 'roast';

                        return (
                          <div
                            key={item.id}
                            className="p-3 rounded-xl bg-[#17191f] border border-[#262a33] text-left hover:border-[#383d49] transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="font-semibold text-xs text-white flex items-center gap-1.5">
                                {isSolve && <span className="text-emerald-400">👥 Friend Solved</span>}
                                {isRating && <span className="text-indigo-400 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Rating Updated</span>}
                                {isRoast && <span className="text-orange-400">🔥 Motivation Roast</span>}
                                {!isSolve && !isRating && !isRoast && <span>📢 Notice</span>}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-[#71717a] font-mono">
                                  {formatTimestamp(item.timestamp)}
                                </span>
                                <button
                                  onClick={() => onDismiss?.(item.id)}
                                  className="text-[#71717a] hover:text-white p-0.5"
                                  title="Dismiss notification"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-[#a1a1aa] mb-2 leading-relaxed">
                              {item.message}
                            </p>
                            {isSolve && (
                              <button
                                onClick={() => handleOpenProblem(item)}
                                className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                              >
                                View Solutions / Problem <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                            {isRating && (
                              <button
                                onClick={() => {
                                  if (onNavigateView) onNavigateView('battle');
                                  if (onClose) onClose();
                                }}
                                className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                              >
                                Match Breakdown →
                              </button>
                            )}
                            {isRoast && (
                              <div className="flex items-center gap-2 pt-1 border-t border-[#232730]">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const sender = item.senderUsername || item.username || (item.message.match(/^(.*?)\s+roasted/i)?.[1]);
                                    if (onDismiss && item.id) onDismiss(item.id);
                                    if (item.roastId) {
                                      chrome.runtime.sendMessage({ type: 'MARK_ROAST_READ', roastId: item.roastId }).catch(() => {});
                                    }
                                    if (onChallengeFromRoast && sender) {
                                      onChallengeFromRoast(sender);
                                    } else if (onNavigateView) {
                                      onNavigateView('battle');
                                    }
                                    if (onClose) onClose();
                                  }}
                                  className="text-[10px] font-bold text-red-400 hover:text-red-300 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all"
                                >
                                  <Swords className="w-3 h-3" /> Challenge 1v1
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onNavigateView) onNavigateView('leaderboard');
                                    if (onClose) onClose();
                                  }}
                                  className="text-[10px] font-semibold text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 transition-all"
                                >
                                  <Flame className="w-3 h-3" /> Roast Back
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer with Clear All button at the bottom right */}
          <div className="p-3 border-t border-[#22252b] bg-[#16181d] flex items-center justify-between">
            <span className="text-[11px] text-[#71717a] font-medium">
              {notifications.length > 0
                ? `${notifications.length} unread ${notifications.length === 1 ? 'notification' : 'notifications'}`
                : 'No unread notifications'}
            </span>
            <button
              onClick={onClearAll || onMarkAllRead}
              disabled={notifications.length === 0}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ml-auto ${
                notifications.length > 0
                  ? 'text-[#f87171] hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 active:scale-95 shadow-sm cursor-pointer'
                  : 'text-[#52525b] bg-[#1a1c22] border border-[#272a32] cursor-not-allowed opacity-50'
              }`}
              title="Clear all notifications"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear all
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default NotificationCenter;

