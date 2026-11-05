import React, { useState, useEffect, useMemo } from 'react';
import MilestoneCelebration from './MilestoneCelebration';
import GoalsPanel from './GoalsPanel';
import DailyQuestion from './DailyQuestion';
import ProblemQueue from './ProblemQueue';


function StreakView({ friends, currentStreak, onRefresh, refreshing }) {
  const [currentMonthOffset, setCurrentMonthOffset] = useState(0);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [showMilestone, setShowMilestone] = useState(false);
  const [celebratedMilestones, setCelebratedMilestones] = useState(new Set());
  const [dismissedStreakWarning, setDismissedStreakWarning] = useState(false);

  // Check for milestone and show celebration
  useEffect(() => {
    const milestones = [7, 30, 100, 365];
    if (milestones.includes(currentStreak) && !celebratedMilestones.has(currentStreak)) {
      setShowMilestone(true);
      setCelebratedMilestones(prev => new Set([...prev, currentStreak]));
    }
  }, [currentStreak, celebratedMilestones]);

  // Compute streak warning: check allAcceptedSubmissions for a solve today (UTC).
  // We do NOT use submissionCalendar here because it counts all attempts
  // (wrong answers, TLE, etc.) — submitting 5 wrong answers shouldn't satisfy
  // the streak warning check.
  const showStreakWarning = useMemo(() => {
    if (dismissedStreakWarning) return false;
    if (!friends || friends.length === 0) return false;
    if (currentStreak === 0) return false;

    const userData = friends[0];
    const allAccepted = userData?.allAcceptedSubmissions;
    if (!Array.isArray(allAccepted) || allAccepted.length === 0) return false;

    const todayUTCStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC
    const solvedToday = allAccepted.some(sub => {
      const ts = parseInt(sub.timestamp, 10);
      if (isNaN(ts) || ts <= 0) return false;
      return new Date(ts * 1000).toISOString().split('T')[0] === todayUTCStr;
    });

    return !solvedToday;
  }, [friends, currentStreak, dismissedStreakWarning]);

  // Safety check
  if (!friends || friends.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-center">
        <div>
          <div className="text-5xl mb-4">📊</div>
          <p className="text-gray-600 mb-4">No data available</p>
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-orange-500 text-white rounded-full text-sm"
          >
            Load Data
          </button>
        </div>
      </div>
    );
  }

  // Get the friend with highest streak for display
  const topFriend = friends.length > 0 
    ? friends.reduce((max, friend) => 
        (friend.stats?.streak || 0) > (max.stats?.streak || 0) ? friend : max
      )
    : null;

  // Calculate total stats across all friends
  const totalStats = friends.reduce((acc, friend) => ({
    easy: acc.easy + (friend.stats?.easy || 0),
    medium: acc.medium + (friend.stats?.medium || 0),
    hard: acc.hard + (friend.stats?.hard || 0),
    total: acc.total + (friend.stats?.total || 0)
  }), { easy: 0, medium: 0, hard: 0, total: 0 });

  // Get user data
  const userData = friends[0];
  const submissionCalendar = userData?.submissionCalendar;

  // Get intensity level for calendar cell
  const getIntensityLevel = (count) => {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    if (count <= 6) return 3;
    return 4;
  };

  // Get current week days
  const getWeekDays = () => {
    const days = [];
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      
      // Get submission count for this day from calendar
      let count = 0;
      if (submissionCalendar) {
        const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dateStr = Math.floor(utcDate.getTime() / 1000).toString();
        count = parseInt(submissionCalendar[dateStr]) || 0;
      }
      
      days.push({
        label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i],
        date: date.getDate(),
        count: count,
        isToday: date.toDateString() === today.toDateString(),
        isPast: date < today,
        isFuture: date > today
      });
    }
    return days;
  };

  const weekDays = getWeekDays();

  // Generate calendar data for a specific month
  const generateMonthlyCalendarData = (monthOffset = 0) => {
    if (!submissionCalendar) return null;

    try {
      // submissionCalendar is already an object from storage, don't parse it
      const calendar = submissionCalendar;
      
      if (!calendar || typeof calendar !== 'object') return null;
      
      console.log('Calendar data:', calendar);
      console.log('Calendar keys sample:', Object.keys(calendar).slice(0, 10));
      
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
        
        if (isToday || count > 0) {
          console.log('Day ' + day + ':', {
            date: currentDate.toISOString(),
            timestamp: dateStr,
            count: count,
            calendarValue: calendar[dateStr],
            isToday: isToday
          });
        }
        
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
    <div className="h-full overflow-y-auto pb-6 bg-background scrollbar-hide">
      {/* Milestone Celebration */}
      {showMilestone && (
        <MilestoneCelebration 
          streak={currentStreak} 
          onClose={() => setShowMilestone(false)} 
        />
      )}

      {/* Streak Warning */}
      {showStreakWarning && (
        <div className="mx-6 mt-6 mb-4 px-4 py-3 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-2 border-amber-500/40 rounded-xl backdrop-blur-sm animate-fade-in">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-bold text-sm text-amber-400">Streak at Risk!</h4>
                <button
                  onClick={() => setDismissedStreakWarning(true)}
                  className="ml-auto text-text-muted hover:text-text-main text-xs"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                You haven't solved any problems today. Your <strong className="text-amber-400">{currentStreak}-day streak</strong> will break at midnight! 🔥
              </p>
              <a
                href="https://leetcode.com/problemset/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
              >
                <span>Solve a problem now</span>
                <span>→</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Streak Header */}
      <div className="text-center pt-8 pb-6 animate-fade-in">
        {/* Streak Count */}
        <div className="text-8xl font-black bg-gradient-to-r from-primary via-orange-500 to-red-500 bg-clip-text text-transparent mb-2 drop-shadow-2xl">
          {currentStreak}
        </div>
        <div className="text-xl font-bold text-text-main mb-1">
          Day Streak 🎯
        </div>
        <p className="text-sm text-text-muted">
          You are doing really great{topFriend ? `, ${topFriend.profile.username}` : ''}!
        </p>
        
        {/* Global Ranking */}
        {(userData?.profile?.ranking || userData?.contestRanking?.globalRanking) && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="text-sm text-text-muted">🌍</span>
            <span className="text-sm font-bold text-primary">
              Global Rank #{(userData.profile.ranking || userData.contestRanking.globalRanking).toLocaleString()}
            </span>
          </div>
        )}

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="mt-4 px-6 py-2.5 text-sm font-semibold text-inverted bg-primary hover:bg-primaryHover rounded-full transition-all duration-300 disabled:opacity-50 shadow-lg hover:shadow-primary/30 active:scale-95 flex items-center gap-2 mx-auto"
        >
          {refreshing ? (
            <>
              <span className="inline-block animate-spin">⟳</span>
              <span>Refreshing...</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>Refresh Data</span>
            </>
          )}
        </button>
        

        
        <p className="text-xs text-text-muted text-center mt-2">
          Auto-syncs every 30 minutes
        </p>
      </div>

      {/* Week Calendar */}
      <div className="px-6 mb-6 animate-slide-up">
        <div className="bg-surface rounded-3xl p-5 shadow-xl border border-surfaceHover transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4 text-center">This Week</h3>
          <div className="flex justify-between items-center gap-2 relative">
            {weekDays.map((day, index) => {
              const level = getIntensityLevel(day.count);
              
              // Color grades matching activity calendar
              let bgColor, textColor;
              if (level === 0) {
                bgColor = 'bg-surfaceHover';
                textColor = 'text-text-muted';
              } else if (level === 1) {
                bgColor = 'bg-secondary/40';
                textColor = 'text-white';
              } else if (level === 2) {
                bgColor = 'bg-secondary/60';
                textColor = 'text-white';
              } else if (level === 3) {
                bgColor = 'bg-secondary/80';
                textColor = 'text-white';
              } else {
                bgColor = 'bg-secondary';
                textColor = 'text-white';
              }
              
              return (
                <div key={index} className="flex-1 text-center group relative">
                  <div className="text-xs text-text-muted font-medium mb-2 group-hover:text-text-main transition-colors">{day.label}</div>
                  <div 
                    className={`
                      w-full aspect-square rounded-2xl flex items-center justify-center text-sm font-bold shadow-sm transition-all duration-300 cursor-pointer
                      ${bgColor} ${textColor}
                      ${day.isToday ? 'ring-2 ring-primary/80 ring-offset-1 ring-offset-background scale-110' : ''}
                      ${day.isFuture ? 'opacity-40' : ''}
                      hover:scale-110 hover:shadow-lg
                    `}
                    title={`${day.count} submission${day.count !== 1 ? 's' : ''}`}
                  >
                    {day.count > 0 ? day.count : day.date}
                  </div>
                  
                  {/* Tooltip on hover */}
                  <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-surface border border-primary/40 rounded-lg shadow-xl transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap">
                    <div className="text-xs font-semibold text-primary">
                      {day.count === 0 ? 'No submissions' : 
                       `${day.count} submission${day.count !== 1 ? 's' : ''}`}
                    </div>
                    <div className="text-[10px] text-text-muted mt-1">
                      {new Date(new Date().setDate(new Date().getDate() - new Date().getDay() + index)).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </div>
                    {day.isToday && (
                      <div className="text-[10px] text-amber-400 font-semibold mt-1">Today</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stats Card */}
      <div className="mx-6 mb-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <div className="bg-surface rounded-3xl shadow-xl p-6 border border-surfaceHover transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5">
          <h3 className="text-sm font-semibold text-text-muted mb-4 text-center">Your Stats 📊</h3>
          
          {/* Difficulty breakdown */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="text-center py-3 bg-leetcode-easy/10 rounded-2xl shadow-sm border border-leetcode-easy/20 hover:bg-leetcode-easy/20 transition-colors">
              <div className="text-xl font-bold text-leetcode-easy">{totalStats.easy}</div>
              <div className="text-xs text-text-muted mt-1">Easy</div>
            </div>
            <div className="text-center py-3 bg-leetcode-medium/10 rounded-2xl shadow-sm border border-leetcode-medium/20 hover:bg-leetcode-medium/20 transition-colors">
              <div className="text-xl font-bold text-leetcode-medium">{totalStats.medium}</div>
              <div className="text-xs text-text-muted mt-1">Medium</div>
            </div>
            <div className="text-center py-3 bg-leetcode-hard/10 rounded-2xl shadow-sm border border-leetcode-hard/20 hover:bg-leetcode-hard/20 transition-colors">
              <div className="text-xl font-bold text-leetcode-hard">{totalStats.hard}</div>
              <div className="text-xs text-text-muted mt-1">Hard</div>
            </div>
            <div className="text-center py-3 bg-surfaceHover rounded-2xl shadow-sm border border-surfaceHover hover:bg-surfaceHover/80 transition-colors">
              <div className="text-xl font-bold text-text-main">{totalStats.total}</div>
              <div className="text-xs text-text-muted mt-1">Total</div>
            </div>
          </div>

          {/* Streak summary row */}
          {userData && (
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center py-3 bg-primary/10 rounded-2xl shadow-sm border border-primary/20 hover:bg-primary/20 transition-colors">
                <div className="text-xl font-bold text-primary">{currentStreak}</div>
                <div className="text-xs text-text-muted mt-1">🔥 Current Streak</div>
              </div>
              <div className="text-center py-3 bg-orange-500/10 rounded-2xl shadow-sm border border-orange-500/20 hover:bg-orange-500/20 transition-colors">
                <div className="text-xl font-bold text-orange-400">{userData?.stats?.longestStreak || currentStreak}</div>
                <div className="text-xs text-text-muted mt-1">🏆 Best Streak</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Daily Question from LeetCode */}
      <div className="mx-6 mb-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <DailyQuestion />
      </div>

      {/* Goals & Targets Panel */}
      <div className="mx-6 mb-6 animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <h3 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2">
          <span className="text-base">🎯</span>
          <span>My Goals</span>
        </h3>
        <GoalsPanel userData={userData} />
      </div>


      {/* Badge Achievement */}
      {topFriend && topFriend.stats.streak >= 7 && (
        <div className="mx-6 mb-6 animate-slide-up" style={{ animationDelay: '0.25s' }}>
          <div className="bg-gradient-to-br from-primary/10 to-surface rounded-3xl p-6 border border-primary/20 shadow-lg transition-all duration-300 hover:shadow-primary/10">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-primary to-primaryHover rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-3xl animate-bounce-slow">🏅</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-text-muted mb-1">Earned a Badge</div>
                <div className="text-xl font-bold text-text-main">Challenger 🎖️</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {submissionCalendar && (() => {
        const monthData = generateMonthlyCalendarData(currentMonthOffset);
        if (!monthData) return null;
        
        return (
          <div className="mx-6 mb-6 animate-slide-up" style={{ animationDelay: '0.3s' }}>
            <div className="bg-gradient-to-br from-surface to-surfaceHover/30 p-4 rounded-xl border border-surfaceHover shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">📅</span>
                  <div>
                    <h4 className="font-bold text-sm text-text-main">Activity Calendar</h4>
                    <p className="text-[10px] text-text-muted">Browse monthly submissions</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Refresh Button */}
                  <button
                    onClick={onRefresh}
                    disabled={refreshing}
                    className="p-1.5 text-text-muted hover:text-primary rounded-lg transition-all duration-300 disabled:opacity-50 hover:bg-surface"
                    title="Refresh data"
                  >
                    {refreshing ? (
                      <span className="inline-block animate-spin text-sm">⟳</span>
                    ) : (
                      <span className="text-sm">🔄</span>
                    )}
                  </button>
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

              <div className="bg-background/70 backdrop-blur-sm rounded-xl p-3 border border-surfaceHover/60 relative">
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
                    {week.map((day, dayIdx) => {
                      // Determine if tooltip should appear below (for first 2 rows) or above
                      const showBelow = weekIdx < 2;
                      
                      // Determine horizontal position based on column
                      let horizontalPosition = 'left-1/2 transform -translate-x-1/2'; // Center (default)
                      if (dayIdx === 0) {
                        // First column (Sunday) - position to the right
                        horizontalPosition = 'left-0';
                      } else if (dayIdx === 6) {
                        // Last column (Saturday) - position to the left
                        horizontalPosition = 'right-0';
                      }
                      
                      return (
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
                              
                              {/* Tooltip - appears on hover */}
                              {hoveredCell?.dateStr === day.dateStr && (
                                <div className={`absolute ${showBelow ? 'top-full mt-2' : 'bottom-full mb-2'} ${horizontalPosition} bg-gradient-to-br from-surface to-surfaceHover border-2 border-primary/40 rounded-xl px-4 py-3 shadow-2xl z-50 animate-fade-in pointer-events-none backdrop-blur-sm whitespace-nowrap`}>
                                  <div className="flex items-center gap-2 mb-1">
                                    {day.isToday && <span className="text-base">⭐</span>}
                                    <div className="text-sm font-bold text-primary">
                                      {day.count === 0 ? 'No activity' : 
                                       `${day.count} submission${day.count !== 1 ? 's' : ''}`}
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-text-muted">
                                    {day.date.toLocaleDateString('en-US', { 
                                      weekday: 'long',
                                      month: 'long', 
                                      day: 'numeric', 
                                      year: 'numeric' 
                                    })}
                                  </div>
                                  {day.isToday && (
                                    <div className="text-[10px] text-amber-400 font-semibold mt-1">Today</div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Recent Activity Section - moved after calendar */}
      {friends.length > 0 && (
        <div className="mx-6 mb-6">
          <h3 className="text-sm font-semibold text-text-muted mb-3">Recent Activity 🎯</h3>
          <div className="space-y-3">
            {friends.slice(0, 3).filter(f => f && f.profile && f.stats).map((friend, index) => (
              <div key={index} className="bg-surface rounded-3xl p-4 shadow-md border border-surfaceHover transition-all duration-300 hover:shadow-lg">
                <div className="flex items-center gap-3">
                  <img 
                    src={friend.profile?.avatar || 'https://via.placeholder.com/40'} 
                    alt={friend.profile?.username || 'User'}
                    className="w-6 h-6 rounded-full shadow-md"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-text-main">{friend.profile?.username || 'Unknown'}</div>
                    <div className="text-xs text-text-muted">{friend.stats?.total || 0} problems solved</div>
                  </div>
                  <div className="flex items-center gap-1 text-primary font-bold bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
                    <span>🔥</span>
                    <span>{friend.stats?.streak || 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Problem Queue */}
      <div className="mx-6 mb-6 animate-slide-up" style={{ animationDelay: '0.35s' }}>
        <ProblemQueue />
      </div>
    </div>
  );
}

export default StreakView;
