import React, { useState, useMemo } from 'react';
import { Flame, Sparkles, BarChart2, Trophy, Award, AlertCircle } from 'lucide-react';
import { sendRoast } from '../shared/storage';
import { AvatarWithPresence } from './PresenceIndicator';

// Helper function to check if solved today
function isSolvingToday(submissionCalendar) {
  if (!submissionCalendar) {
    console.log('No submission calendar');
    return false;
  }
  
  console.log('Submission calendar keys sample:', Object.keys(submissionCalendar).slice(-10));
  
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const todayTimestamp = Math.floor(todayUTC.getTime() / 1000).toString();
  
  console.log('Today timestamp:', todayTimestamp, 'Today date:', todayUTC);
  console.log('Value for today:', submissionCalendar[todayTimestamp]);
  
  // Check if there's any submission today
  const hasTodaySubmission = submissionCalendar[todayTimestamp] && parseInt(submissionCalendar[todayTimestamp]) > 0;
  console.log('Has today submission:', hasTodaySubmission);
  
  return hasTodaySubmission;
}

// Helper function to get last active date
function getLastActive(submissionCalendar) {
  if (!submissionCalendar) return null;
  
  const timestamps = Object.keys(submissionCalendar)
    .map(ts => parseInt(ts))
    .filter(ts => submissionCalendar[ts.toString()] > 0)
    .sort((a, b) => b - a);
  
  if (timestamps.length === 0) return null;
  
  return new Date(timestamps[0] * 1000);
}

// Helper function to format last active
function formatLastActive(lastActiveDate) {
  if (!lastActiveDate) return 'Never';
  
  const now = new Date();
  const diffMs = now - lastActiveDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function FriendCard({ 
  friend, 
  isExpanded, 
  onClick, 
  isCurrentUser, 
  myUsername, 
  rank = 0, 
  sortBy = 'total', 
  onRequireAuth,
  presenceStatus = 'offline'
}) {
  const [allSubmissionsExpanded, setAllSubmissionsExpanded] = useState(false);
  const [showSubmissionsSection, setShowSubmissionsSection] = useState(false);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [currentMonthOffset, setCurrentMonthOffset] = useState(0); // 0 = current month, 1 = last month, etc.

  const [isRoasting, setIsRoasting] = useState(false);
  const [roastMessage, setRoastMessage] = useState('');
  const [isSendingRoast, setIsSendingRoast] = useState(false);
  const [roastSuccess, setRoastSuccess] = useState(false);
  const [roastError, setRoastError] = useState('');

  const quickRoasts = [
    "Bro forgot how to code 💀",
    "Streak at 0? Yikes 😬",
    "Are you even trying?",
    "Need me to invert that binary tree for you? 🌲",
    "Even my O(N^3) solution runs faster than your streak! 🐌"
  ];

  const handleStartRoast = (e) => {
    e.stopPropagation();
    setRoastError('');
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (res) => {
        if (!res || res.state !== 'AUTHENTICATED') {
          if (onRequireAuth) {
            onRequireAuth('leaderboard');
          } else {
            alert('Roasting friends requires signing in. Please open the Battle page to sign in.');
          }
          return;
        }
        setIsRoasting(true);
      });
    } else {
      setIsRoasting(true);
    }
  };

  const handleSendRoast = async (e) => {
    e.stopPropagation();
    if (!myUsername || !roastMessage.trim()) return;
    
    const targetUsername = friend?.profile?.username || friend?.username;
    if (!targetUsername) return;

    setIsSendingRoast(true);
    setRoastError('');
    try {
      const authRes = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, resolve);
      });
      if (!authRes || authRes.state !== 'AUTHENTICATED') {
        if (onRequireAuth) {
          onRequireAuth('leaderboard');
        }
        setIsSendingRoast(false);
        return;
      }

      const success = await sendRoast(targetUsername, myUsername, roastMessage);
      if (success) {
        setRoastSuccess(true);
        setTimeout(() => {
          setIsRoasting(false);
          setRoastSuccess(false);
          setRoastMessage('');
          setRoastError('');
        }, 2000);
      } else {
        setRoastError('Failed to deliver roast. Ensure your friend has signed into LeetStreak.');
      }
    } catch (err) {
      console.error('Error roasting:', err);
      setRoastError(err.message || 'Network error sending roast.');
    } finally {
      setIsSendingRoast(false);
    }
  };

  // Get last submission time - calculate once with useMemo (MUST be before any early returns)
  const lastSubmissionText = useMemo(() => {
    const recentSubmissions = friend?.recentSubmissions;
    if (!recentSubmissions || !Array.isArray(recentSubmissions) || recentSubmissions.length === 0) {
      return null;
    }

    const sorted = [...recentSubmissions].sort((a, b) => b.timestamp - a.timestamp);
    const lastSub = sorted[0];
    
    // Calculate at useMemo time - this runs only when recentSubmissions changes
    const now = new Date().getTime();
    const lastTimestamp = parseInt(lastSub.timestamp) * 1000;
    const diffMs = now - lastTimestamp;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return diffMins < 60 ? `${diffMins} min${diffMins !== 1 ? 's' : ''} ago` : `${diffHours} hour ago`;
      }
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
    } else {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months !== 1 ? 's' : ''} ago`;
    }
  }, [friend?.recentSubmissions]);

  // Safety check with safe fallback normalization
  if (!friend) {
    return null;
  }

  const profile = friend.profile || { username: friend.username || 'Coder', avatar: '', ranking: 0, realName: '' };
  const stats = friend.stats || {
    total: friend.total_solved || 0,
    easy: friend.easy_solved || 0,
    medium: friend.medium_solved || 0,
    hard: friend.hard_solved || 0,
    streak: friend.current_streak || 0,
    longestStreak: friend.longest_streak || 0
  };
  const contest = friend.contest || {
    rating: friend.contest_rating || friend.contestRanking?.rating || 0,
    attended: friend.contestRanking?.attendedContestsCount || 0,
    ranking: friend.contestRanking?.globalRanking || 0
  };
  const { badges, recentSubmissions, submissionCalendar, contestRanking } = friend;

  // Personal LeetCode streak for this user
  const personalStreak = stats.streak || 0;
  const totalSolved = stats.total ?? (stats.easy + stats.medium + stats.hard);
  const contestRating = contest.rating || 0;

  // Get rank badge emoji
  const getRankBadge = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  // Get all accepted solved questions
  // Generate calendar data for a specific month
  const generateMonthlyCalendarData = (monthOffset = 0) => {
    if (!submissionCalendar) return null;

    try {
      // submissionCalendar is already an object from storage, don't parse it
      const calendar = submissionCalendar;
      
      if (!calendar || typeof calendar !== 'object') return null;
      
      const today = new Date();
      const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    // Generate specific month
    const date = new Date(todayUTC.getFullYear(), todayUTC.getMonth() - monthOffset, 1);
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthName = date.toLocaleDateString('en-US', { month: 'long' });
      
      // Get first day of month and number of days
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      
      const weeks = [];
      let week = [];
      
      // Pad start with empty cells
      for (let i = 0; i < firstDay; i++) {
        week.push(null);
      }
      
      // Add all days of the month
      for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, month, day);
        // Use UTC midnight timestamp to match LeetCode's format
        const utcDate = new Date(Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()));
        const dateStr = Math.floor(utcDate.getTime() / 1000).toString();
        const count = parseInt(calendar[dateStr]) || 0;
        const isToday = currentDate.toDateString() === today.toDateString();
        
        week.push({
          date: currentDate,
          day,
          count,
          dateStr,
          isToday
        });
        
        if (week.length === 7) {
          weeks.push(week);
          week = [];
        }
      }
      
      // Pad end with empty cells
      if (week.length > 0) {
        while (week.length < 7) {
          week.push(null);
        }
        weeks.push(week);
      }
      
    return { monthName, year, weeks };
    } catch (error) {
      console.error('Error generating calendar data:', error);
      return null;
    }
  };

  // Get intensity level for calendar cell
  const getIntensityLevel = (count) => {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    if (count <= 6) return 3;
    return 4;
  };

  // Get color for calendar cell with better contrast for both themes
  const getCalendarCellColor = (count, isToday = false) => {
    const level = getIntensityLevel(count);
    const colors = [
      'bg-surfaceHover border-surfaceHover',                        // 0 submissions
      'bg-secondary/40 border-secondary/60 shadow-sm',              // 1-2
      'bg-secondary/60 border-secondary/80 shadow',                 // 3-4
      'bg-secondary/80 border-secondary shadow-md',                 // 5-6
      'bg-secondary border-secondary shadow-lg'                     // 7+
    ];
    
    if (isToday) {
      return colors[level] + ' ring-2 ring-primary/80 ring-offset-1 ring-offset-background';
    }
    
    return colors[level];
  };

  return (
    <div
      onClick={onClick}
      className={`relative bg-surface rounded-3xl shadow-md border-2 transition-all duration-300 cursor-pointer hover:shadow-lg hover:scale-[1.01] ${
        isCurrentUser 
          ? 'border-accent/30 bg-gradient-to-br from-accent/10 to-surface ring-1 ring-accent/20' 
          : 'border-surfaceHover/50'
      } ${isExpanded ? 'ring-2 ring-primary/60 shadow-2xl' : ''}`}
    >
      {/* Active Badge */}
      {friend.submissionCalendar && isSolvingToday(friend.submissionCalendar) && (
        <div className="absolute -top-1 -right-1 z-10 bg-secondary text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg animate-pulse pointer-events-none">
          <span className="flex items-center gap-1"><Flame className="w-3 h-3" /> ACTIVE</span>
        </div>
      )}
      
      {/* Main Card Content */}
      <div className="p-4">
        <div className="flex items-center gap-3">
          {/* Rank Badge */}
          <div className="text-2xl font-bold min-w-[36px] text-center drop-shadow-sm">
            {getRankBadge(rank)}
          </div>

          {/* Avatar with Presence Indicator */}
          <AvatarWithPresence
            src={profile.avatar}
            alt={profile.username}
            size="md"
            status={presenceStatus}
            badge={rank <= 3 ? (
              <div className="w-4 h-4 bg-primary rounded-full border border-surface text-inverted text-[10px] flex items-center justify-center shadow-sm">
                <Sparkles className="w-2.5 h-2.5" />
              </div>
            ) : null}
          />

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-text-main truncate">{profile.username}</h3>
              {isCurrentUser && (
                <span className="px-2 py-0.5 bg-accent text-inverted text-[10px] font-bold rounded-full">YOU</span>
              )}
              {friend.friend_id && !isCurrentUser && (
                <span className="text-[9px] font-mono text-text-muted/70 bg-surfaceHover/50 px-1.5 py-0.5 rounded border border-surfaceHover/40" title={`Friend ID: ${friend.friend_id}`}>
                  ID: {friend.friend_id.slice(0, 8)}
                </span>
              )}
              {/* LeetCode Profile Link */}
              <a
                href={`https://leetcode.com/${profile.username}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-text-muted hover:text-primary transition-colors"
                title="View LeetCode Profile"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.939-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z"/>
                </svg>
              </a>
            </div>
            {profile.realName && (
              <p className="text-xs text-text-muted truncate">{profile.realName}</p>
            )}
            {/* Last Active */}
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-text-muted">🕒</span>
              <span className="text-[10px] text-text-muted">
                {formatLastActive(getLastActive(submissionCalendar))}
              </span>
            </div>
            {/* Global Ranking */}
            {(profile.ranking || contestRanking?.globalRanking) && (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[10px] text-text-muted">🌍</span>
                <span className="text-[10px] font-semibold text-primary">
                  Rank #{profile.ranking?.toLocaleString() || contestRanking?.globalRanking?.toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* Active Ranking Metric Badge */}
          {sortBy === 'total' ? (
            <div className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-[#18181B] px-3 py-1.5 rounded-full shadow-md" title={`Total Solved: ${totalSolved}`}>
              <Trophy className="w-4 h-4 text-[#18181B] fill-current" />
              <span className="text-sm font-black">{totalSolved}</span>
            </div>
          ) : sortBy === 'rating' ? (
            <div className="flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-3 py-1.5 rounded-full shadow-md" title={`Contest Rating: ${contestRating > 0 ? contestRating : 'Unrated'}`}>
              <Award className="w-4 h-4 text-amber-300" />
              <span className="text-sm font-black">{contestRating > 0 ? contestRating : 'Unrated'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 bg-gradient-to-r from-primary to-primaryHover text-inverted px-3 py-1.5 rounded-full shadow-lg shadow-primary/20" title={`Current Personal Streak: ${personalStreak} days`}>
              <Flame className="w-4 h-4 text-orange-500 fill-orange-500" />
              <span className="text-sm font-black">{personalStreak}</span>
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className="text-center py-2 bg-leetcode-easy/10 rounded-2xl border border-leetcode-easy/20">
            <div className="text-base font-bold text-leetcode-easy">{stats.easy || 0}</div>
            <div className="text-[10px] text-text-muted font-medium">Easy</div>
          </div>
          <div className="text-center py-2 bg-leetcode-medium/10 rounded-2xl border border-leetcode-medium/20">
            <div className="text-base font-bold text-leetcode-medium">{stats.medium || 0}</div>
            <div className="text-[10px] text-text-muted font-medium">Medium</div>
          </div>
          <div className="text-center py-2 bg-leetcode-hard/10 rounded-2xl border border-leetcode-hard/20">
            <div className="text-base font-bold text-leetcode-hard">{stats.hard || 0}</div>
            <div className="text-[10px] text-text-muted font-medium">Hard</div>
          </div>
          <div className={`text-center py-2 rounded-2xl border transition-all ${
            sortBy === 'total' 
              ? 'bg-amber-500/15 border-amber-500/40 ring-1 ring-amber-500/30' 
              : 'bg-surfaceHover border-surfaceHover'
          }`}>
            <div className={`text-base font-bold ${sortBy === 'total' ? 'text-amber-400' : 'text-text-main'}`}>
              {totalSolved}
            </div>
            <div className="text-[10px] text-text-muted font-medium">Total</div>
          </div>
        </div>



        {/* Submissions Section Collapse */}
        {(lastSubmissionText || (recentSubmissions && recentSubmissions.length > 0)) && (
          <div className="mt-3">
            <div 
              onClick={(e) => {
                e.stopPropagation();
                setShowSubmissionsSection(!showSubmissionsSection);
              }}
              className="px-2 py-2 bg-primary/10 hover:bg-primary/20 rounded-xl border border-primary/30 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-primary flex items-center gap-1.5">
                  <BarChart2 className="w-4 h-4" />
                  Submissions
                </span>
                <svg 
                  className={`w-5 h-5 text-primary transition-transform duration-200 ${showSubmissionsSection ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {showSubmissionsSection && (
              <div className="mt-2 space-y-2 animate-slide-up">
                {/* Last Submission */}
                {lastSubmissionText && (
                  <div className="px-2 py-1.5 bg-background/50 rounded-xl border border-surfaceHover">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Last submission:</span>
                      <span className="font-semibold text-text-main">{lastSubmissionText}</span>
                    </div>
                  </div>
                )}

                {/* Recent Submissions (All) */}
                {recentSubmissions && recentSubmissions.length > 0 && (
                  <div className="px-2 py-1.5 bg-background/50 rounded-xl border border-surfaceHover">
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        setAllSubmissionsExpanded(!allSubmissionsExpanded);
                      }}
                      className="flex items-center justify-between cursor-pointer hover:bg-surfaceHover/30 -mx-2 px-2 py-1 rounded-lg transition-colors"
                    >
                      <div className="text-xs text-text-muted">
                        Recent Submissions ({recentSubmissions.length})
                      </div>
                      <svg 
                        className={`w-4 h-4 text-text-muted transition-transform duration-200 ${allSubmissionsExpanded ? 'rotate-180' : ''}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    {allSubmissionsExpanded && (
                      <div className="space-y-2 max-h-32 overflow-y-auto mt-2 animate-slide-up scrollbar-hide">
                        {recentSubmissions.slice(0, 5).map((sub, idx) => (
                          <a
                            key={idx}
                            href={`https://leetcode.com/problems/${sub.titleSlug || sub.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="block text-xs border-l-2 border-surfaceHover hover:border-primary pl-2 py-1 hover:bg-surface rounded transition-all"
                          >
                            <div className="font-medium text-text-main hover:text-primary transition-colors">{sub.title}</div>
                            <div className="text-text-muted flex gap-2 mt-1">
                              <span className={`
                                ${sub.statusDisplay === 'Accepted' ? 'text-secondary' : 'text-leetcode-hard'}
                              `}>
                                {sub.statusDisplay}
                              </span>
                              <span>•</span>
                              <span>{sub.lang}</span>
                              {sub.runtime && (
                                <>
                                  <span>•</span>
                                  <span>{sub.runtime}</span>
                                </>
                              )}
                            </div>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* New Roast UI Section (Main Card) */}
        {!isCurrentUser && (
          <div className="mt-3 relative">
            {!isRoasting ? (
              <button
                onClick={handleStartRoast}
                className="w-full py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 font-semibold rounded-xl transition-all duration-300 text-xs border border-orange-500/20 active:scale-95 flex items-center justify-center gap-2"
              >
                <Flame className="w-3.5 h-3.5" /> Roast Friend
              </button>
            ) : (
              <div 
                onClick={(e) => e.stopPropagation()}
                className="bg-surface/80 backdrop-blur-md rounded-xl p-3 border border-orange-500/30 animate-slide-up shadow-lg shadow-orange-500/5 relative overflow-hidden"
              >
                {/* Success Overlay */}
                {roastSuccess && (
                  <div className="absolute inset-0 bg-green-500/90 z-10 flex flex-col items-center justify-center animate-fade-in backdrop-blur-sm">
                    <div className="text-white text-3xl mb-1 animate-bounce">🔥</div>
                    <div className="text-white font-bold text-sm">Roast Sent!</div>
                  </div>
                )}
                
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-orange-400 flex items-center gap-1.5">
                    <Flame className="w-3 h-3" /> Select your weapon
                  </span>
                  <button 
                    onClick={() => setIsRoasting(false)}
                    className="text-text-muted hover:text-text-main p-1 rounded-md hover:bg-surfaceHover transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {quickRoasts.map((roast, idx) => (
                    <button
                      key={idx}
                      onClick={() => setRoastMessage(roast)}
                      className={`text-[10px] px-2 py-1 rounded-lg border transition-all duration-200 ${
                        roastMessage === roast 
                          ? 'bg-orange-500/20 border-orange-500/50 text-orange-400 scale-[0.98]' 
                          : 'bg-surfaceHover border-surfaceHover/50 text-text-muted hover:text-text-main hover:bg-surfaceHover/80'
                      }`}
                    >
                      {roast}
                    </button>
                  ))}
                </div>
                
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Type custom roast..."
                    value={roastMessage}
                    onChange={(e) => {
                      setRoastMessage(e.target.value);
                      if (roastError) setRoastError('');
                    }}
                    className="flex-1 bg-background/50 border border-surfaceHover focus:border-orange-500/50 rounded-lg px-3 py-1.5 text-xs text-text-main placeholder-text-muted/50 outline-none transition-colors"
                  />
                  <button
                    onClick={handleSendRoast}
                    disabled={!roastMessage.trim() || isSendingRoast}
                    className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 disabled:from-surfaceHover disabled:to-surfaceHover disabled:text-text-muted text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-1"
                  >
                    {isSendingRoast ? '...' : 'Send'}
                  </button>
                </div>
                {roastError && (
                  <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 flex items-center gap-1.5 animate-shake">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{roastError}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-surfaceHover p-4 bg-surfaceHover/30 space-y-4 animate-slide-up">
          {/* Contest Stats */}
          {contest && contest.rating > 0 && (
            <div className="bg-surface p-3 rounded-xl border border-surfaceHover shadow-sm">
              <h4 className="font-semibold text-sm mb-2 text-text-main">Contest Stats</h4>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-text-muted">Rating:</span>
                  <span className="ml-1 font-semibold text-primary">{contest.rating}</span>
                </div>
                <div>
                  <span className="text-text-muted">Attended:</span>
                  <span className="ml-1 font-semibold text-text-main">{contest.attended}</span>
                </div>
                <div>
                  <span className="text-text-muted">Rank:</span>
                  <span className="ml-1 font-semibold text-text-main">#{contest.ranking?.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Submission Calendar */}
          {submissionCalendar && (() => {
            const monthData = generateMonthlyCalendarData(currentMonthOffset);
            if (!monthData) return null;
            
            return (
              <div className="bg-gradient-to-br from-surface to-surfaceHover/30 p-4 rounded-xl border border-surfaceHover shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📅</span>
                    <div>
                      <h4 className="font-bold text-sm text-text-main">Activity Calendar</h4>
                      <p className="text-[10px] text-text-muted">Browse monthly submissions</p>
                    </div>
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-1 bg-background/60 px-2 py-1.5 rounded-lg border border-surfaceHover/50">
                    <span className="text-[9px] text-text-muted mr-1">Less</span>
                    {[0, 1, 2, 3, 4].map(level => (
                      <div
                        key={level}
                        className={`w-[10px] h-[10px] rounded-[2px] border ${getCalendarCellColor(level * 2)}`}
                      />
                    ))}
                    <span className="text-[9px] text-text-muted ml-1">More</span>
                  </div>
                </div>
                
                {/* Month Navigation */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (currentMonthOffset < 11) setCurrentMonthOffset(currentMonthOffset + 1);
                    }}
                    disabled={currentMonthOffset >= 11}
                    className="p-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all group"
                  >
                    <svg className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  
                  <div className="text-center">
                    <div className="text-sm font-bold text-primary">{monthData.monthName} {monthData.year}</div>
                    <div className="text-[10px] text-text-muted">
                      {(() => {
                        const total = monthData.weeks.flat().filter(d => d && d.count > 0).reduce((sum, d) => sum + d.count, 0);
                        return `${total} submission${total !== 1 ? 's' : ''}`;
                      })()}
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (currentMonthOffset > 0) setCurrentMonthOffset(currentMonthOffset - 1);
                    }}
                    disabled={currentMonthOffset <= 0}
                    className="p-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all group"
                  >
                    <svg className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                <div className="bg-background/70 backdrop-blur-sm rounded-xl p-3 border border-surfaceHover/60">
                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                        <div key={idx} className="text-[9px] text-text-muted text-center font-semibold">
                          {day}
                        </div>
                      ))}
                    </div>
                    
                  {/* Calendar grid */}
                  {monthData.weeks.map((week, weekIdx) => (
                    <div key={weekIdx} className="grid grid-cols-7 gap-1 mb-1">
                      {week.map((day, dayIdx) => (
                        <div
                          key={dayIdx}
                          className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-bold transition-all duration-300 relative group ${
                            day 
                              ? `${getCalendarCellColor(day.count, day.isToday)} cursor-pointer hover:scale-125 hover:shadow-xl hover:z-20 ${
                                  hoveredCell?.dateStr === day.dateStr ? 'scale-125 shadow-xl z-20' : ''
                                }` 
                              : 'bg-transparent'
                          }`}
                          onMouseEnter={() => day && setHoveredCell(day)}
                          onMouseLeave={() => setHoveredCell(null)}
                        >
                          {day && (
                            <>
                              <span className={`${
                                day.count > 0 
                                  ? 'text-white font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]' 
                                  : 'text-text-muted font-semibold'
                              }`}>
                                {day.day}
                              </span>
                              {day.isToday && (
                                <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Enhanced Tooltip */}
                {hoveredCell && (
                  <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-br from-surface to-surfaceHover border-2 border-primary/40 rounded-xl px-4 py-3 shadow-2xl z-50 animate-fade-in pointer-events-none backdrop-blur-sm">
                    <div className="flex items-center gap-2 mb-1">
                      {hoveredCell.isToday && <span className="text-base">⭐</span>}
                      <div className="text-sm font-bold text-primary">
                        {hoveredCell.count === 0 ? 'No activity' : 
                         `${hoveredCell.count} submission${hoveredCell.count !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {hoveredCell.date.toLocaleDateString('en-US', { 
                        weekday: 'long',
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}
                    </div>
                    {hoveredCell.isToday && (
                      <div className="text-[10px] text-amber-400 font-semibold mt-1">Today</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Badges */}
          {badges && badges.length > 0 && (
            <div className="bg-surface p-3 rounded-xl border border-surfaceHover shadow-sm">
              <h4 className="font-semibold text-sm mb-2 text-text-main">Badges ({badges.length})</h4>
              <div className="flex flex-wrap gap-2">
                {badges.slice(0, 5).map((badge) => (
                  <div
                    key={badge.id}
                    className="flex items-center gap-1.5 px-2 py-1.5 bg-primary/10 border border-primary/20 rounded-lg text-xs text-primary hover:bg-primary/20 transition-colors"
                    title={badge.displayName}
                  >
                    {badge.icon ? (
                      <img 
                        src={badge.icon} 
                        alt={badge.displayName}
                        className="w-5 h-5 object-contain"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.textContent = '🏅 ' + e.target.nextSibling.textContent;
                        }}
                      />
                    ) : (
                      <span>🏅</span>
                    )}
                    <span className="max-w-[100px] truncate font-medium">{badge.displayName}</span>
                  </div>
                ))}
                {badges.length > 5 && (
                  <span className="px-2 py-1 text-xs text-text-muted">
                    +{badges.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Remove Friend Button */}
          {!isCurrentUser && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (window.confirm(`Remove ${profile.username} from friends?`)) {
                  try {
                    console.log('Sending REMOVE_FRIEND message for:', profile.username);
                    const response = await chrome.runtime.sendMessage({
                      type: 'REMOVE_FRIEND',
                      username: profile.username
                    });
                    console.log('Remove friend response:', response);
                    
                    if (response && response.success) {
                      // Force refresh the entire app by reloading
                      setTimeout(() => {
                        window.location.reload();
                      }, 100);
                    } else {
                      alert(`Failed to remove friend: ${response?.error || 'Unknown error'}`);
                    }
                  } catch (err) {
                    console.error('Error removing friend:', err);
                    alert('Failed to remove friend. Please try again.');
                  }
                }
              }}
              className="w-full py-2 bg-leetcode-hard/10 hover:bg-leetcode-hard/20 text-leetcode-hard font-semibold rounded-xl transition-all duration-300 text-sm border border-leetcode-hard/20 active:scale-95"
            >
              🗑️ Remove Friend
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default FriendCard;
