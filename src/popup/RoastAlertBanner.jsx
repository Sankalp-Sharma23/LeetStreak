import React, { useState } from 'react';
import { Flame, Swords, X, Send, ChevronRight, Check } from 'lucide-react';

const QUICK_WEAPONS = [
  'Bro my code runs faster than your streak! 🐌',
  'Need me to invert that binary tree for you? 🌲',
  'Are you even trying? 💀',
  'Talk code, not trash 🤫',
  'Even my O(N³) solution is faster! ⚡'
];

export default function RoastAlertBanner({
  roasts = [],
  myUsername,
  onDismiss,
  onChallengeBattle
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [error, setError] = useState('');

  if (!roasts || roasts.length === 0) return null;

  const currentRoast = roasts[currentIndex] || roasts[0];
  if (!currentRoast) return null;

  // Extract sender and content
  let sender = currentRoast.senderUsername || currentRoast.username;
  let quote = currentRoast.roastContent;

  if (!sender || !quote) {
    const match = (currentRoast.message || '').match(/^(.*?)\s+roasted you:\s*"(.*?)"/i);
    if (match) {
      sender = sender || match[1];
      quote = quote || match[2];
    } else {
      sender = sender || 'A friend';
      quote = quote || currentRoast.message;
    }
  }

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!text || !sender || sending) return;

    setSending(true);
    setError('');

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'SEND_ROAST',
          targetUsername: sender,
          fromUsername: myUsername,
          message: text
        }, resolve);
      });

      if (resp?.success) {
        setSentSuccess(true);
        setTimeout(() => {
          onDismiss?.(currentRoast.id);
          setIsReplying(false);
          setSentSuccess(false);
          setReplyText('');
        }, 1600);
      } else {
        setError(resp?.error || 'Failed to send roast');
        setSending(false);
      }
    } catch (err) {
      setError(err?.message || 'Could not send roast');
      setSending(false);
    }
  };

  const handleDismissCurrent = () => {
    if (currentRoast.roastId) {
      chrome.runtime.sendMessage({
        type: 'MARK_ROAST_READ',
        roastId: currentRoast.roastId
      }).catch(() => {});
    }
    onDismiss?.(currentRoast.id);
    if (currentIndex >= roasts.length - 1) {
      setCurrentIndex(Math.max(0, roasts.length - 2));
    }
  };

  return (
    <div className="mx-4 mt-3 mb-2 rounded-2xl border border-orange-500/35 bg-gradient-to-b from-[#1c1614] to-[#14161a] p-3.5 shadow-lg shadow-orange-950/20 text-left transition-all animate-fade-in">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 shrink-0">
            <Flame className="w-3 h-3 animate-pulse" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-orange-400">
            Friend Roast
          </span>
          {roasts.length > 1 && (
            <span className="text-[9px] font-mono text-text-muted px-1.5 py-0.2 rounded-full bg-surface">
              {currentIndex + 1}/{roasts.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {roasts.length > 1 && (
            <div className="flex items-center gap-0.5 mr-1">
              <button
                type="button"
                onClick={() => setCurrentIndex(prev => (prev > 0 ? prev - 1 : roasts.length - 1))}
                className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-main rounded bg-surface/50 hover:bg-surface"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setCurrentIndex(prev => (prev < roasts.length - 1 ? prev + 1 : 0))}
                className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-main rounded bg-surface/50 hover:bg-surface"
              >
                →
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleDismissCurrent}
            className="text-text-muted hover:text-text-main p-1 rounded-md hover:bg-surface/60 transition-colors"
            title="Dismiss roast"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Roast Quote */}
      <div className="mb-3 px-3 py-2.5 rounded-xl bg-[#0f1115] border border-surfaceHover/60">
        <p className="text-[11px] font-semibold text-text-main leading-snug">
          <span className="text-orange-400 font-bold">@{sender}</span>:{' '}
          <span className="italic text-text-main">"{quote}"</span>
        </p>
      </div>

      {/* Reply drawer or Actions */}
      {sentSuccess ? (
        <div className="flex items-center justify-center gap-2 py-2 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl animate-fade-in">
          <Check className="w-4 h-4" /> Roast delivered to @{sender}!
        </div>
      ) : isReplying ? (
        <div className="space-y-2 animate-fade-in pt-1 border-t border-surfaceHover/40">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
              <Flame className="w-2.5 h-2.5 text-orange-400" /> Choose quick comeback:
            </span>
            <button
              type="button"
              onClick={() => setIsReplying(false)}
              className="text-[10px] text-text-muted hover:text-text-main"
            >
              Cancel
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {QUICK_WEAPONS.map((weapon, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setReplyText(weapon)}
                className={`text-[9px] px-2 py-1 rounded-lg border transition-all text-left ${
                  replyText === weapon
                    ? 'bg-orange-500/25 border-orange-500/60 text-orange-300 font-semibold'
                    : 'bg-surface/50 border-surfaceHover/50 text-text-muted hover:text-text-main hover:bg-surface'
                }`}
              >
                {weapon}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <input
              type="text"
              placeholder={`Roast @${sender} back...`}
              value={replyText}
              onChange={(e) => {
                setReplyText(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendReply();
              }}
              className="flex-1 min-w-0 bg-[#0d0e12] border border-surfaceHover focus:border-orange-500/60 rounded-xl px-2.5 py-2 text-xs text-text-main placeholder-text-muted/50 outline-none"
            />
            <button
              type="button"
              onClick={handleSendReply}
              disabled={!replyText.trim() || sending}
              className="px-3 py-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center gap-1 shrink-0"
            >
              {sending ? '...' : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => {
              if (currentRoast.roastId) {
                chrome.runtime.sendMessage({
                  type: 'MARK_ROAST_READ',
                  roastId: currentRoast.roastId
                }).catch(() => {});
              }
              onChallengeBattle?.(sender);
            }}
            className="flex-1 py-2 px-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm"
          >
            <Swords className="w-3.5 h-3.5" />
            <span>Challenge in 1v1</span>
          </button>

          <button
            type="button"
            onClick={() => setIsReplying(true)}
            className="py-2 px-3 bg-surface hover:bg-surfaceHover border border-orange-500/30 text-orange-400 hover:text-orange-300 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95"
          >
            <Flame className="w-3 h-3" />
            <span>Roast Back</span>
          </button>
        </div>
      )}
    </div>
  );
}

