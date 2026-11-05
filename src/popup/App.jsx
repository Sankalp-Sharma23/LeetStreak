import React, { useState, useEffect, useMemo } from 'react';
import { Users, TrendingUp, BarChart3, Rocket, Loader2, Sparkles, Frown, FileBarChart, Flame, Swords } from 'lucide-react';
import AddFriend from './AddFriend';
import LoadingSkeleton from './LoadingSkeleton';
import StreakView from './StreakView';
import NotificationSettings from './NotificationSettings';
import NotificationToast from './NotificationToast';
import Footer from './Footer';
import SplashScreen from './SplashScreen';
import Leaderboard from './Leaderboard';
import InsightsPanelEnhanced from './InsightsPanelEnhanced';
import ProgressChart from './ProgressChart';
import SettingsPanel from './SettingsPanel';
import BattleView from './BattleView';

function App() {
  const [friends, setFriends] = useState({});
  const [ownProfile, setOwnProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [initStatus, setInitStatus] = useState('INITIALIZING'); // 'INITIALIZING' | 'FETCHING_PROFILE' | 'SUCCESS' | 'EMPTY' | 'ERROR'
  const [view, setView] = useState('streak'); // 'streak', 'leaderboard', 'analytics', or 'settings'
  const [previousView, setPreviousView] = useState('streak'); // Track previous view for settings navigation
  const [myUsername, setMyUsername] = useState(null);
  const [setupMode, setSetupMode] = useState(false);
  const [askPermissionMode, setAskPermissionMode] = useState(false);
  const [setupUsername, setSetupUsername] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [notifications, setNotifications] = useState([]);
  const [showSplash, setShowSplash] = useState(true);
  const [dataLoadingTakingLong, setDataLoadingTakingLong] = useState(false);
  const [authRedirectTarget, setAuthRedirectTarget] = useState(null);
  const [presenceMap, setPresenceMap] = useState({});

  // Guard against duplicate execution
  const initStartedRef = React.useRef(false);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    // Check if chrome.runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.error('Chrome runtime not available');
      setError('Extension context not available');
      setLoading(false);
      setInitStatus('ERROR');
      return;
    }
    
    
    const initializeApp = async () => {
      try {
        // Read all initialization data in one batch call
        const storageData = await chrome.storage.local.get([
          'theme',
          'my_leetcode_username',
          'unread_notifications',
          'hardcore_mode_enabled',
          'own_profile',
          'friends_cache'
        ]);
        
        // Log only key facts, not on every render
        if (process.env.NODE_ENV !== 'production') {
          console.log('Storage data retrieved:', {
            hasTheme: !!storageData.theme,
            hasUsername: !!storageData.my_leetcode_username,
            hasCachedProfile: !!storageData.own_profile
          });
        }
        
        // Apply theme immediately
        const savedTheme = storageData.theme || 'dark';
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        // Process notifications
        if (storageData.unread_notifications && Array.isArray(storageData.unread_notifications)) {
          const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
          const recentNotifications = storageData.unread_notifications.filter(n => n.timestamp > oneDayAgo);
          if (recentNotifications.length !== storageData.unread_notifications.length) {
            chrome.storage.local.set({ unread_notifications: recentNotifications }).catch(console.error);
          }
          if (recentNotifications.length > 0) {
            setNotifications(recentNotifications);
          }
        }

        // Hydrate from local cache immediately (zero-wait UI)
        if (storageData.own_profile) {
          setOwnProfile(storageData.own_profile);
          setLoading(false);
          setInitStatus('SUCCESS');
        }
        if (storageData.friends_cache) {
          setFriends(storageData.friends_cache);
        }
        
        // Check setup status
        if (storageData.my_leetcode_username) {
          setMyUsername(storageData.my_leetcode_username);
          
          if (storageData.hardcore_mode_enabled === undefined) {
            chrome.storage.local.set({ hardcore_mode_enabled: false }).catch(console.error);
          }

          // Fetch fresh stats from LeetCode
          await fetchStats(false, storageData.my_leetcode_username, storageData.own_profile);
        } else {
          setSetupMode(true);
          setLoading(false);
          setInitStatus('EMPTY');
        }
        
        setDataLoadingTakingLong(false);
      } catch (err) {
        console.error('Error initializing app:', err);
        setError(`Initialization error: ${err.message}`);
        setSetupMode(false);
        setLoading(false);
        setInitStatus('ERROR');
      }
    };
    
    initializeApp();
    
    // If data takes longer than 4 seconds, show loading message on splash
    const longLoadTimer = setTimeout(() => {
      setDataLoadingTakingLong(true);
    }, 4000);
    
    return () => clearTimeout(longLoadTimer);
  }, []); // Run once on mount!

  // App-wide presence sync for social features
  useEffect(() => {
    let mounted = true;
    const syncPresence = async () => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
      try {
        const stored = await chrome.storage.local.get(['my_leetcode_username', 'friends_cache']);
        const uname = stored.my_leetcode_username;
        if (!uname) return;

        // Ping self presence
        chrome.runtime.sendMessage({ type: 'BATTLE_PING_PRESENCE', username: uname }).catch(() => {});

        // Fetch friends presence
        const friendNames = Object.keys(stored.friends_cache || {});
        if (friendNames.length > 0) {
          const res = await chrome.runtime.sendMessage({ type: 'BATTLE_GET_PRESENCE', usernames: friendNames });
          if (mounted && res?.success && res.presenceMap) {
            setPresenceMap(res.presenceMap);
          }
        }
      } catch (err) {
        console.warn('[App] Presence sync warning:', err);
      }
    };

    syncPresence();
    const interval = setInterval(syncPresence, 25000); // 25s
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [myUsername]);


  const handleDismissNotifications = async (notificationId) => {
    // Remove the dismissed notification
    const updatedNotifications = notifications.filter(n => n.id !== notificationId);
    setNotifications(updatedNotifications);
    
    try {
      await chrome.storage.local.set({ unread_notifications: updatedNotifications });
    } catch (error) {
      console.error('Error clearing notification:', error);
    }
  };

  const handleAutoDetect = async () => {
    setSetupLoading(true);
    setSetupError('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LOGGED_IN_USER'
      });

      if (response.success && response.username) {
        const detectedUsername = response.username;
        
        const addFriendResponse = await chrome.runtime.sendMessage({
          type: 'ADD_FRIEND',
          username: detectedUsername
        });

        const isAlreadyAdded = addFriendResponse.error && addFriendResponse.error.toLowerCase().includes('already in your friends list');

        if (addFriendResponse.success || isAlreadyAdded) {
          await chrome.storage.local.set({ 
            my_leetcode_username: detectedUsername,
            hardcore_mode_enabled: false 
          });
          setMyUsername(detectedUsername);
          setTimeout(() => {
            setSetupMode(false);
            fetchFriends();
          }, 500);
        } else {
          setSetupError(addFriendResponse.error || 'Failed to verify username');
        }
      } else {
        setSetupError('Could not detect your LeetCode account. Please make sure you are logged into leetcode.com in another tab.');
      }
    } catch (err) {
      console.error('Error during auto-detect:', err);
      setSetupError('Failed to verify username. Please try again.');
    } finally {
      setSetupLoading(false);
    }
  };

  const fetchStats = async (forceRefresh = false, usernameOverride = null, cachedProfile = null) => {
    try {
      const activeOwnProfile = cachedProfile || ownProfile;
      if (!activeOwnProfile) {
        setLoading(true);
        setInitStatus('FETCHING_PROFILE');
      } else if (forceRefresh) {
        setRefreshing(true);
      }
      setError(null);

      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_STATS',
        forceRefresh
      });

      if (response && response.success) {
        if (response.ownProfile) {
          setOwnProfile(response.ownProfile);
        }
        if (response.friends) {
          setFriends(response.friends);
        }
        setInitStatus('SUCCESS');
        setError(null);
      } else {
        const errMsg = response?.error || 'Failed to fetch LeetCode data';
        console.warn('[App] fetchStats response error:', errMsg);
        if (!activeOwnProfile) {
          setError(errMsg);
          setInitStatus('ERROR');
        }
      }
    } catch (err) {
      console.error('[App] Error in fetchStats:', err);
      if (!ownProfile && !cachedProfile) {
        setError('Failed to connect to background service');
        setInitStatus('ERROR');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchFriends = fetchStats;

  const handleRefresh = () => {
    fetchStats(true);
  };

  const handleFriendAdded = () => {
    fetchStats(true);
  };

  const toggleTheme = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    try {
      await chrome.storage.local.set({ theme: newTheme });
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  const friendsList = Object.values(friends).filter(f => f && (f.profile?.username || f.username)?.toLowerCase() !== myUsername?.toLowerCase());
  const myData = ownProfile || (myUsername ? (
    friends[myUsername] || 
    friends[myUsername.toLowerCase()] || 
    Object.values(friends).find(f => (f?.profile?.username || f?.username)?.toLowerCase() === myUsername.toLowerCase())
  ) : null);
  
  // Safe calendar parsing to prevent crashes from corrupted JSON strings
  const parsedCalendar = useMemo(() => {
    if (!myData?.submissionCalendar) return null;
    if (typeof myData.submissionCalendar === 'object') return myData.submissionCalendar;
    try {
      return JSON.parse(myData.submissionCalendar);
    } catch {
      return null;
    }
  }, [myData?.submissionCalendar]);
  
  // Calculate my streak
  const myStreak = myData?.stats?.streak || 0;
  
  // Check if data is loaded
  const hasData = myData !== null && myData !== undefined;

  // Setup screen
  if (setupMode) {
    return (
      <div className="w-[400px] h-[600px] bg-background flex items-center justify-center p-8">
        <div className="text-center max-w-sm w-full animate-fade-in mx-auto">
          <div className="w-24 h-24 bg-surface rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg ring-4 ring-surfaceHover">
            <Rocket className="w-12 h-12 text-primary animate-bounce-slow" />
          </div>
          <h1 className="text-2xl font-bold text-text-main mb-2 text-center">Welcome to LeetStreak!</h1>
          <p className="text-sm text-text-muted mb-8 text-center mx-auto">
            We will securely detect your logged-in LeetCode profile to start tracking your progress.
          </p>
          
          <div className="space-y-4 w-full">
            {setupError && (
              <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-sm text-red-400 animate-shake text-center w-full">
                {setupError}
              </div>
            )}
            
            <button
              onClick={handleAutoDetect}
              disabled={setupLoading}
              className="w-full py-4 bg-primary hover:bg-primaryHover text-inverted font-bold rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-primary/20 active:scale-95"
            >
              <span className="flex items-center justify-center gap-2">
                {setupLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Detecting...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Auto-Detect Profile</>
                )}
              </span>
            </button>
          </div>
          
          <p className="mt-6 text-xs text-text-muted text-center mx-auto">
            Make sure you are logged into leetcode.com first!
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Splash Screen with Animation */}
      {showSplash && (
        <SplashScreen 
          onVideoEnd={() => setShowSplash(false)}
          showLoadingMessage={dataLoadingTakingLong}
        />
      )}

      <div className="w-[400px] h-[600px] bg-gradient-to-br from-background via-background to-surface/20 flex flex-col overflow-hidden text-text-main">
        {loading ? (
          <LoadingSkeleton count={3} />
        ) : error ? (
          <div className="flex-1 flex items-center justify-center p-6 animate-fade-in">
            <div className="text-center">
              <Frown className="w-16 h-16 text-text-muted mb-3 animate-bounce-slow mx-auto" />
              <p className="text-red-400 font-semibold mb-2">Oops!</p>
              <p className="text-sm text-text-muted mb-6">{error}</p>
              <button
                onClick={() => fetchFriends()}
                className="px-6 py-2 bg-primary hover:bg-primaryHover text-inverted font-medium rounded-full transition-colors shadow-lg hover:shadow-primary/20"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : !hasData ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-in">
            <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-4 ring-2 ring-surfaceHover">
              <FileBarChart className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-base font-bold text-text-main mb-1">No Profile Data</h3>
            <p className="text-xs text-text-muted mb-6 max-w-xs leading-relaxed">
              Could not retrieve statistics for <span className="text-primary font-semibold">@{myUsername || 'unknown'}</span>. Ensure your LeetCode profile is public and username is correct.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleRefresh}
                className="px-4 py-2 bg-primary hover:bg-primaryHover text-inverted rounded-xl text-xs font-semibold transition-all shadow-lg hover:shadow-primary/20 active:scale-95"
              >
                Retry Sync
              </button>
              <button
                onClick={() => setSetupMode(true)}
                className="px-4 py-2 bg-surface hover:bg-surfaceHover border border-surfaceHover/60 text-text-muted hover:text-text-main rounded-xl text-xs font-semibold transition-all active:scale-95"
              >
                Change Username
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Top Navigation Tabs with Settings Button */}
            <div className="flex border-b border-surfaceHover/50 bg-surface/95 backdrop-blur-md sticky top-0 z-10 shadow-lg">
              <div className="flex flex-1 gap-0 px-2">
                <button
                  onClick={() => {
                    setPreviousView('leaderboard');
                    setView('leaderboard');
                  }}
                  className={`flex-1 py-3.5 px-2 text-sm font-medium transition-all duration-200 relative group ${
                    view === 'leaderboard' ? 'text-primary' : 'text-text-muted hover:text-text-main'
                  }`}
                >
                  <Users className={`w-5 h-5 mx-auto mb-1.5 transition-transform duration-200 ${
                    view === 'leaderboard' ? 'scale-110' : 'group-hover:scale-105'
                  }`} />
                  <span className="text-[11px] font-semibold">Friends</span>
                  {view === 'leaderboard' && (
                    <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"></div>
                  )}
                </button>
                <button
                  onClick={() => {
                    setPreviousView('streak');
                    setView('streak');
                  }}
                  className={`flex-1 py-3.5 px-2 text-sm font-medium transition-all duration-200 relative group ${
                    view === 'streak' ? 'text-primary' : 'text-text-muted hover:text-text-main'
                  }`}
                >
                  <TrendingUp className={`w-5 h-5 mx-auto mb-1.5 transition-transform duration-200 ${
                    view === 'streak' ? 'scale-110' : 'group-hover:scale-105'
                  }`} />
                  <span className="text-[11px] font-semibold">Progress</span>
                  {view === 'streak' && (
                    <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"></div>
                  )}
                </button>
                <button
                  onClick={() => {
                    setPreviousView('analytics');
                    setView('analytics');
                  }}
                  className={`flex-1 py-3.5 px-2 text-sm font-medium transition-all duration-200 relative group ${
                    view === 'analytics' ? 'text-primary' : 'text-text-muted hover:text-text-main'
                  }`}
                >
                  <BarChart3 className={`w-5 h-5 mx-auto mb-1.5 transition-transform duration-200 ${
                    view === 'analytics' ? 'scale-110' : 'group-hover:scale-105'
                  }`} />
                  <span className="text-[11px] font-semibold">Analytics</span>
                  {view === 'analytics' && (
                    <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"></div>
                  )}
                </button>

                {/* Battle Tab */}
                <button
                  onClick={() => {
                    setView('battle');
                  }}
                  className={`flex-1 py-3.5 px-2 text-sm font-medium transition-all duration-200 relative group ${
                    view === 'battle' ? 'text-red-400' : 'text-text-muted hover:text-red-400'
                  }`}
                >
                  <Swords className={`w-5 h-5 mx-auto mb-1.5 transition-transform duration-200 ${
                    view === 'battle' ? 'scale-110' : 'group-hover:scale-105'
                  }`} />
                  <span className="text-[11px] font-semibold">Battle</span>
                  {view === 'battle' && (
                    <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-red-400 to-transparent"></div>
                  )}
                </button>

              </div>
              <div className="flex items-center gap-1 pr-2">
                <button
                  onClick={toggleTheme}
                  className="p-2.5 text-text-muted hover:text-primary transition-all duration-200 hover:bg-surfaceHover/50 rounded-lg"
                  title="Toggle Theme"
                >
                  {theme === 'dark' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => setShowNotificationSettings(true)}
                  className="p-2.5 text-text-muted hover:text-primary transition-all duration-200 hover:bg-surfaceHover/50 rounded-lg"
                  title="Notification Settings"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Notification Settings Modal */}
            <NotificationSettings 
              isOpen={showNotificationSettings}
              onClose={() => setShowNotificationSettings(false)}
            />

            {/* Content */}
            <div className="flex-1 overflow-hidden bg-background flex flex-col pb-10">
              {view === 'settings' ? (
                <SettingsPanel 
                  onBack={() => setView('streak')}
                  onNavigateToBattle={() => setView('battle')}
                  theme={theme}
                  onThemeChange={setTheme}
                />
              ) : view === 'streak' ? (
                hasData ? (
                  <StreakView 
                    friends={myData ? [myData] : []} 
                    currentStreak={myStreak}
                    onRefresh={handleRefresh}
                    refreshing={refreshing}
                    presenceMap={presenceMap}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full p-8 text-center">
                    <div>
                      <FileBarChart className="w-20 h-20 text-primary mb-4 animate-pulse mx-auto" />
                      <p className="text-text-muted mb-4">Loading your progress...</p>
                      <button
                        onClick={handleRefresh}
                        className="px-4 py-2 bg-primary text-inverted rounded-full text-sm font-medium"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )
              ) : view === 'analytics' ? (
                myData ? (
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                    {parsedCalendar && (
                      <ProgressChart submissionCalendar={parsedCalendar} />
                    )}
                    <InsightsPanelEnhanced 
                      userData={myData} 
                      friendsData={friendsList.filter(f => (f?.profile?.username || f?.username)?.toLowerCase() !== myUsername?.toLowerCase())} 
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full p-8 text-center">
                    <div>
                      <BarChart3 className="w-20 h-20 text-primary mb-4 animate-pulse mx-auto" />
                      <p className="text-text-muted mb-4">Loading analytics data...</p>
                      <button
                        onClick={handleRefresh}
                        className="px-4 py-2 bg-primary text-inverted rounded-full text-sm font-medium"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )
              ) : view === 'battle' ? (
                <BattleView
                  myUsername={myUsername}
                  friends={friendsList}
                  returnTarget={authRedirectTarget}
                  presenceMap={presenceMap}
                  onAuthSuccess={(target) => {
                    const next = target || authRedirectTarget;
                    setAuthRedirectTarget(null);
                    if (next) setView(next);
                    fetchStats(true);
                  }}
                />
              ) : (
                <>
                  <AddFriend onFriendAdded={handleFriendAdded} />
                  <div className="flex-1 overflow-y-auto scrollbar-hide">
                    <Leaderboard
                      friends={friendsList}
                      myData={myData}
                      myUsername={myUsername}
                      onRefresh={handleRefresh}
                      presenceMap={presenceMap}
                      onRequireAuth={(target = 'leaderboard') => {
                        setAuthRedirectTarget(target);
                        setView('battle');
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Notification Toast */}
        <NotificationToast 
          notifications={notifications} 
          onDismiss={handleDismissNotifications} 
        />

        {/* Footer */}
        <Footer onSettingsClick={() => {
          if (view === 'settings') {
            // If already in settings, go back to previous view
            setView(previousView);
          } else {
            // If not in settings, open settings and save current view
            setPreviousView(view);
            setView('settings');
          }
        }} />
      </div>
    </>
  );
}

export default App;
