import React, { useState, useEffect, useCallback } from 'react';
import {
  Flame,
  ShieldAlert,
  ExternalLink,
  Code2,
  Lock,
  Sparkles,
  RefreshCw,
  Dices,
  Globe
} from 'lucide-react';
import { sanitizeReturnUrl } from '../background/blocker-manager.js';
import { timestampToDateString } from '../shared/streak-calculator.js';

const MOTIVATIONAL_ROASTS = [
  {
    quote: "You have time for {site}, but binary trees are still kicking your ass?",
    subtext: "Priorities are completely cooked. Reverse a linked list first."
  },
  {
    quote: "Brainrot on {site} won't help you pass the technical interview.",
    subtext: "Recruiters don't evaluate your scroll speed. 1 accepted solve unlocks everything."
  },
  {
    quote: "Attention span shorter than a single recursion stack frame.",
    subtext: "Close the tab, open the editor, and earn your screen time."
  },
  {
    quote: "Browsing {site} like you've already signed an L6 offer with stock grants.",
    subtext: "Back to the terminal. Today's problem is still waiting."
  },
  {
    quote: "Your algorithm efficiency is currently O(n!). Humble yourself.",
    subtext: "Even a brute-force solution is better than scrolling here."
  },
  {
    quote: "Infinite scrolling won't fix an unhandled null pointer exception.",
    subtext: "Solve today's challenge. It takes 15 minutes."
  },
  {
    quote: "Your streak is on the line and you're checking {site}?",
    subtext: "A broken streak hurts worse than any rejection email. Go solve it."
  },
  {
    quote: "Dopamine on {site} lasts 10 seconds. A 100-day streak is forever.",
    subtext: "Don't let today be the day you broke the chain."
  },
  {
    quote: "Recursion was too hard, so you escaped to {site} instead?",
    subtext: "Identify the base case and face the problem head on."
  },
  {
    quote: "Even your garbage collector has higher standards than this distraction.",
    subtext: "Clear the memory leak in your focus. 1 accepted solve unlocks your web."
  },
  {
    quote: "You're checking {site} while your competitors are submitting in O(1).",
    subtext: "The leaderboard doesn't lie. Close this tab and earn your streak."
  },
  {
    quote: "Willpower weaker than an untyped JavaScript variable.",
    subtext: "Build discipline. Solve one problem today."
  }
];

export default function BlockedApp() {
  const [blockedUrl, setBlockedUrl] = useState('');
  const [siteLabel, setSiteLabel] = useState('');
  const [streak, setStreak] = useState(0);
  const [isSolvedToday, setIsSolvedToday] = useState(false);
  const [roastIndex, setRoastIndex] = useState(() => Math.floor(Math.random() * MOTIVATIONAL_ROASTS.length));
  const [friendRoast, setFriendRoast] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  const triggerUnlockedFlow = useCallback((targetUrl) => {
    setIsSolvedToday(true);
    const safeUrl = sanitizeReturnUrl(targetUrl || blockedUrl);
    if (safeUrl) {
      window.location.replace(safeUrl);
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.tabs?.getCurrent && chrome.tabs?.remove) {
      chrome.tabs.getCurrent(tab => {
        if (tab?.id != null) chrome.tabs.remove(tab.id);
      });
    } else {
      window.close();
    }
  }, [blockedUrl]);

  useEffect(() => {
    // 1. Parse target URL from query parameters
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('blocked') || params.get('url') || params.get('source');
    const labelParam = params.get('label');

    if (urlParam) {
      setBlockedUrl(urlParam);
    }
    if (labelParam) {
      setSiteLabel(labelParam);
    }

    // 2. Fetch session and local storage data
    const loadState = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          let targetUrl = urlParam || '';
          // If URL wasn't in query params, inspect session storage for this tab
          if (!urlParam && chrome.storage.session && chrome.tabs && chrome.tabs.getCurrent) {
            const currentTab = await new Promise(r => chrome.tabs.getCurrent(r));
            if (currentTab?.id) {
              const sessionData = await chrome.storage.session.get(`blocked_tab_${currentTab.id}`);
              const entry = sessionData?.[`blocked_tab_${currentTab.id}`];
              if (entry?.url) {
                targetUrl = entry.url;
                setBlockedUrl(entry.url);
                if (entry.label && !labelParam) setSiteLabel(entry.label);
              }
            }
          }

          // Read local settings
          const data = await chrome.storage.local.get([
            'last_solve_date',
            'user_timezone',
            'own_profile',
            'hardcore_mode_enabled',
            'unread_notifications'
          ]);

          const unreadRoasts = (data.unread_notifications || []).filter(n => n.type === 'roast');
          if (unreadRoasts.length > 0) {
            const r = unreadRoasts[0];
            let sender = r.senderUsername || r.username;
            let text = r.roastContent;
            if (!sender || !text) {
              const m = (r.message || '').match(/^(.*?)\s+roasted you:\s*"(.*?)"/i);
              sender = sender || m?.[1] || 'Your friend';
              text = text || m?.[2] || r.message;
            }
            setFriendRoast({ sender, text });
          }

          const currentStreak = data.own_profile?.stats?.streak || 0;
          setStreak(currentStreak);

          const todayStr = timestampToDateString(Math.floor(Date.now() / 1000), data.user_timezone);
          const solved = data.last_solve_date === todayStr;
          setIsSolvedToday(solved);

          if (!data.hardcore_mode_enabled || solved) {
            triggerUnlockedFlow(targetUrl);
          }
        }
      } catch (err) {
        console.warn('[BlockedApp] Error loading state:', err);
      }
    };

    loadState();

    // 3. Listen for solve updates in real-time
    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes.last_solve_date || changes.hardcore_mode_enabled) {
        chrome.storage.local.get(['last_solve_date', 'user_timezone', 'hardcore_mode_enabled'], (data) => {
          const todayStr = timestampToDateString(Math.floor(Date.now() / 1000), data.user_timezone);
          const solved = data.last_solve_date === todayStr;
          const disabled = data.hardcore_mode_enabled === false;

          if (solved || disabled) {
            setIsSolvedToday(true);
            triggerUnlockedFlow(blockedUrl);
          }
        });
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  }, [blockedUrl, triggerUnlockedFlow]);

  const cycleRoast = () => {
    setRoastIndex((prev) => (prev + 1) % MOTIVATIONAL_ROASTS.length);
  };

  const handleSolveClick = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: 'https://leetcode.com/problemset/all/' });
    } else {
      window.open('https://leetcode.com/problemset/all/', '_blank');
    }
  };

  const handleRefreshSolveStatus = async () => {
    setIsChecking(true);
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'FETCH_STATS', forceRefresh: true }, resolve);
        });
        if (res && res.success) {
          const data = await chrome.storage.local.get(['last_solve_date', 'user_timezone']);
          const todayStr = timestampToDateString(Math.floor(Date.now() / 1000), data.user_timezone);
          if (data.last_solve_date === todayStr) {
            setIsSolvedToday(true);
            triggerUnlockedFlow(blockedUrl);
          }
        }
      }
    } catch (err) {
      console.warn('[BlockedApp] Manual refresh failed:', err);
    } finally {
      setIsChecking(false);
    }
  };

  // Extract human-friendly domain name for display
  let displaySite = siteLabel;
  if (!displaySite && blockedUrl) {
    try {
      displaySite = new URL(blockedUrl).hostname.replace(/^(www\.|m\.)/, '');
    } catch {
      displaySite = 'this distracting website';
    }
  }

  const currentRoast = MOTIVATIONAL_ROASTS[roastIndex];
  const targetSiteName = displaySite || 'distracting websites';
  const formattedQuote = currentRoast.quote.replace(/{site}/g, targetSiteName);
  const formattedSubtext = currentRoast.subtext ? currentRoast.subtext.replace(/{site}/g, targetSiteName) : '';

  if (isSolvedToday) return null;

  return (
    <div className="w-full bg-[#1F1F23] border border-[#3F3F46] rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden transition-all duration-300">
      {/* Decorative ambient top glow */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-500 via-amber-500 to-red-500"
      />

      {/* Top Header Badge & Meta Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 border border-red-500/25 text-red-400 rounded-full text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Hardcore Lockdown</span>
          </div>

          {displaySite && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-[#27272A] border border-[#3F3F46] text-[#A1A1AA] rounded-full text-xs font-mono">
              <Globe className="w-3 h-3 text-red-400" />
              <span className="line-through text-red-400/80">{displaySite}</span>
            </div>
          )}
        </div>

        {streak > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 border border-amber-500/25 text-amber-400 rounded-full text-xs font-bold">
            <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>{streak}-Day Streak At Risk</span>
          </div>
        )}
      </div>


        <div className="space-y-6">
          {/* THE HERO ROAST SPOTLIGHT - THE MAIN HIGHLIGHT */}
          <div className="relative p-6 sm:p-8 bg-gradient-to-b from-[#18181B] to-[#141416] border-2 border-amber-500/40 rounded-2xl overflow-hidden shadow-2xl shadow-amber-500/10">
            {/* Giant decorative quotation watermark */}
            <div className="absolute -top-5 -left-1 text-8xl font-serif text-amber-500/10 select-none pointer-events-none leading-none">
              “
            </div>

            {/* Header inside the roast card */}
            <div className="relative z-10 flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-amber-400">
                  {friendRoast ? `DIRECT ROAST FROM @${friendRoast.sender.toUpperCase()}` : `REALITY CHECK #${roastIndex + 1}`}
                </span>
              </div>

              {/* Roast Cycler / Next Burn */}
              <button
                onClick={cycleRoast}
                title="Cycle to another motivational roast"
                className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs text-zinc-300 hover:text-white bg-[#27272A] hover:bg-[#3F3F46] border border-[#3F3F46] rounded-xl transition-all cursor-pointer active:scale-95"
              >
                <Dices className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-[11px]">Hit Me Again</span>
              </button>
            </div>

            {/* THE MASSIVE ROAST QUOTE - BOLD AND UNMISSABLE */}
            <blockquote className="relative z-10 my-3">
              <p className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight leading-snug">
                "{friendRoast ? friendRoast.text : formattedQuote}"
              </p>
            </blockquote>

            {/* Subtext punchline */}
            {(friendRoast || formattedSubtext) && (
              <p className="relative z-10 text-xs sm:text-sm text-amber-300/80 font-medium leading-relaxed mt-3">
                {friendRoast ? `Don't let @${friendRoast.sender} laugh at your streak. Solve 1 problem now and prove them wrong.` : formattedSubtext}
              </p>
            )}
          </div>

          {/* Context Explainer */}
          <p className="text-xs sm:text-sm text-[#A1A1AA] leading-relaxed">
            Access to <span className="text-amber-400 font-semibold">{displaySite || 'this site'}</span> is intercepted by LeetStreak Hardcore Mode. Submit at least <span className="text-white font-semibold">1 accepted problem</span> on LeetCode today to unlock your browser until midnight.
          </p>

          {/* Live Challenge Status Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-[#18181B] border border-[#3F3F46]/80 rounded-xl">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA] block mb-1">
                Status Today
              </span>
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-400">
                <Lock className="w-3.5 h-3.5" />
                <span>0 Solved Today</span>
              </div>
            </div>

            <div className="p-3.5 bg-[#18181B] border border-[#3F3F46]/80 rounded-xl">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA] block mb-1">
                Requirement
              </span>
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>1 Solve Unlocks All</span>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSolveClick}
              className="min-h-[48px] flex-1 px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-[#18181B] font-bold text-sm sm:text-base rounded-xl transition-all shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              <Code2 className="w-4 h-4" />
              <span>Solve Challenge on LeetCode</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </button>

            <button
              onClick={handleRefreshSolveStatus}
              disabled={isChecking}
              title="Already submitted? Click to sync with LeetCode"
              className="min-h-[48px] px-5 py-3.5 bg-[#27272A] hover:bg-[#3F3F46] text-white font-medium text-xs sm:text-sm rounded-xl border border-[#3F3F46] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-amber-400' : ''}`} />
              <span>{isChecking ? 'Verifying...' : 'I Solved It'}</span>
            </button>
          </div>

          {/* Safe Return Destination Indicator */}
          {sanitizeReturnUrl(blockedUrl) && (
            <p className="text-[11px] text-[#A1A1AA] text-center truncate pt-1">
              Destination preserved: <span className="text-white/90 font-mono text-[10px]">{displaySite}</span>
            </p>
          )}
        </div>
    </div>
  );
}
