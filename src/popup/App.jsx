import React, { useState, useEffect, useMemo } from 'react';
import { Users, TrendingUp, BarChart3, Rocket, Loader2, Sparkles, Frown, FileBarChart, Flame, Swords, ArrowLeft, Bell } from 'lucide-react';
import AddFriend from './AddFriend';
import FriendRequests from './FriendRequests';
import LoadingSkeleton from './LoadingSkeleton';
import StreakView from './StreakView';
import NotificationSettings from './NotificationSettings';
import NotificationCenter from './NotificationCenter';
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
  const [view, setView] = useState('streak'); // 'streak', 'leaderboard', 'analytics', or 'settings'
  const [previousView, setPreviousView] = useState('streak'); // Track previous view for settings navigation
  const [myUsername, setMyUsername] = useState(null);
  const [setupMode, setSetupMode] = useState(false);
  const [setupStep, setSetupStep] = useState('detect'); // 'detect' | 'auth'
  const [detectedUsername, setDetectedUsername] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState('');

  // Cloud account state
  const [authMode, setAuthMode] = useState('signup'); // 'signup' | 'signin'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');
  const [authCooldown, setAuthCooldown] = useState(0);

  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [notifications, setNotifications] = useState([]);
  const [showSplash, setShowSplash] = useState(true);
  const [dataLoadingTakingLong, setDataLoadingTakingLong] = useState(false);
  const [authRedirectTarget, setAuthRedirectTarget] = useState(null);
  const [presenceMap, setPresenceMap] = useState({});
  const [battleInitialOpponent, setBattleInitialOpponent] = useState(null);

  const roastNotifications = useMemo(() => {
    return notifications.filter(n => n.type === 'roast');
  }, [notifications]);

  const handleChallengeFromRoast = (opponentUsername) => {
    setBattleInitialOpponent(opponentUsername);
    setView('battle');
  };
  const fetchStatsRef = React.useRef(null);

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
          'friends_cache',
          'friends_account_id'
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
        }
        // All friend data is loaded through the background so its ownership
        // can be checked before it reaches the UI.
        chrome.runtime.sendMessage({ type: 'GET_FRIENDS' })
          .then(response => {
            if (response?.success) setFriends(response.friends || {});
          })
          .catch(error => console.warn('[App] Could not restore friends:', error));
        
        // Check setup and cloud authentication status
        let isAuthenticated = false;
        try {
          const authRes = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, resolve);
          });
          if (authRes?.success && authRes.state === 'AUTHENTICATED') {
            isAuthenticated = true;
          }
          if (authRes?.cooldownSeconds > 0) {
            setAuthCooldown(authRes.cooldownSeconds);
          }
        } catch {
          isAuthenticated = false;
        }

        const hasUsername = !!storageData.my_leetcode_username;

        if (hasUsername && isAuthenticated) {
          setMyUsername(storageData.my_leetcode_username);
          chrome.runtime.sendMessage({ type: 'POLL_ROASTS' }).catch(() => {});
          
          if (storageData.hardcore_mode_enabled === undefined) {
            chrome.storage.local.set({ hardcore_mode_enabled: false }).catch(console.error);
          }

          // Fetch fresh stats from LeetCode
          await fetchStatsRef.current?.(false, storageData.my_leetcode_username, storageData.own_profile);
        } else if (hasUsername && !isAuthenticated) {
          setDetectedUsername(storageData.my_leetcode_username);
          setSetupStep('auth');
          setSetupMode(true);
          setLoading(false);
        } else {
          setSetupStep('detect');
          setSetupMode(true);
          setLoading(false);
        }
        
        setDataLoadingTakingLong(false);
      } catch (err) {
        console.error('Error initializing app:', err);
        setError(`Initialization error: ${err.message}`);
        setSetupMode(false);
        setLoading(false);
      }
    };
    
    initializeApp();
    
    // If data takes longer than 4 seconds, show loading message on splash
    const longLoadTimer = setTimeout(() => {
      setDataLoadingTakingLong(true);
    }, 4000);
    
    return () => clearTimeout(longLoadTimer);
  }, []); // Run once on mount!

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return undefined;
    const onStorageChanged = (changes, areaName) => {
      if (areaName === 'local' && changes.unread_notifications) {
        setNotifications(changes.unread_notifications.newValue || []);
      }
    };
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    return () => chrome.storage?.onChanged?.removeListener(onStorageChanged);
  }, []);

  // App-wide presence sync for social features
  useEffect(() => {
    let mounted = true;
    const syncPresence = async () => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
      try {
        const stored = await chrome.storage.local.get(['my_leetcode_username', 'friends_cache', 'friends_account_id']);
        const uname = stored.my_leetcode_username;
        if (!uname) return;

        const auth = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' });
        if (stored.friends_account_id && auth?.session?.user_id !== stored.friends_account_id) return;
        if (!stored.friends_account_id && auth?.session?.user_id) return;

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

  useEffect(() => {
    if (authCooldown <= 0) return;
    const timer = setInterval(() => setAuthCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [authCooldown]);

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

  const handleMarkAllRead = async () => {
    setNotifications([]);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ unread_notifications: [] });
      }
    } catch (error) {
      console.error('Error clearing all notifications:', error);
    }
  };

  const handleAutoDetect = async () => {
    setSetupLoading(true);
    setSetupError('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LOGGED_IN_USER'
      });

      if (response && response.success && response.username) {
        const username = response.username.trim();
        setDetectedUsername(username);
        setSetupStep('auth');
        setSetupError('');
      } else {
        setSetupError('Could not detect your LeetCode account. Make sure you are logged into leetcode.com in another tab, or enter your username below.');
        setShowManualInput(true);
      }
    } catch (err) {
      console.error('Error during auto-detect:', err);
      setSetupError('Failed to detect username. Make sure you are logged into leetcode.com or enter it manually below.');
      setShowManualInput(true);
    } finally {
      setSetupLoading(false);
    }
  };

  const handleManualUsernameSubmit = (e) => {
    e?.preventDefault();
    const trimmed = manualUsername.trim();
    if (!trimmed) {
      setSetupError('Please enter your LeetCode username.');
      return;
    }
    setDetectedUsername(trimmed);
    setSetupStep('auth');
    setSetupError('');
  };

  const handleCloudAuthSubmit = async (e) => {
    e?.preventDefault();
    if (authSubmitting) return;
    setAuthError('');
    setAuthSuccessMsg('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = authEmail.trim();
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    if (!authPassword || authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }
    if (authCooldown > 0) {
      setAuthError(`Rate limit active. Please wait ${authCooldown}s.`);
      return;
    }

    const username = (detectedUsername || myUsername || '').trim();
    if (!username) {
      setAuthError('Missing LeetCode username. Please go back to step 1.');
      return;
    }

    setAuthSubmitting(true);

    try {
      if (authMode === 'signin') {
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'SIGN_IN_EMAIL',
            email: cleanEmail,
            password: authPassword,
            username
          }, resolve);
        });

        if (res?.success) {
          await chrome.runtime.sendMessage({
            type: 'SET_OWN_USERNAME',
            username
          });
          setMyUsername(username);
          setAuthPassword('');
          setSetupMode(false);
          const nextView = authRedirectTarget || 'streak';
          setAuthRedirectTarget(null);
          setView(nextView);
          await fetchStatsRef.current?.(false, username);
        } else {
          if (res?.isRateLimited) setAuthCooldown(60);
          setAuthError(res?.error || 'Invalid email or password.');
        }
      } else {
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'SIGN_UP_EMAIL',
            email: cleanEmail,
            password: authPassword,
            username
          }, resolve);
        });

        if (res?.success) {
          if (res.confirmationRequired) {
            setAuthSuccessMsg('Account created! Please check your email to verify your address, then sign in.');
            setAuthMode('signin');
            setAuthPassword('');
          } else {
            await chrome.runtime.sendMessage({
              type: 'SET_OWN_USERNAME',
              username
            });
            setMyUsername(username);
            setAuthPassword('');
            setSetupMode(false);
            const nextView = authRedirectTarget || 'streak';
            setAuthRedirectTarget(null);
            setView(nextView);
            await fetchStatsRef.current?.(false, username);
          }
        } else {
          if (res?.isRateLimited) setAuthCooldown(60);
          setAuthError(res?.error || 'Failed to create account.');
        }
      }
    } catch (err) {
      console.error('Error during cloud auth:', err);
      setAuthError(err.message || 'Network error during authentication.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRequireAuth = (target = 'streak') => {
    setAuthRedirectTarget(target);
    if (myUsername) {
      setDetectedUsername(myUsername);
      setSetupStep('auth');
    } else {
      setSetupStep('detect');
    }
    setSetupMode(true);
  };

  const fetchStats = async (forceRefresh = false, _usernameOverride = null, cachedProfile = null) => {
    try {
      const activeOwnProfile = cachedProfile || ownProfile;
      if (!activeOwnProfile) {
        setLoading(true);
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
        setError(null);
      } else {
        const errMsg = response?.error || 'Failed to fetch LeetCode data';
        console.warn('[App] fetchStats response error:', errMsg);
        if (!activeOwnProfile) {
          setError(errMsg);
        }
      }
    } catch (err) {
      console.error('[App] Error in fetchStats:', err);
      if (!ownProfile && !cachedProfile) {
        setError('Failed to connect to background service');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  fetchStatsRef.current = fetchStats;

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

  // Setup screen (Step 1: LeetCode Auto-Detect, Step 2: Cloud Account)
  if (setupMode) {
    return (
      <div className="w-[400px] h-[600px] bg-background flex flex-col justify-between p-6 text-text-main overflow-y-auto scrollbar-hide">
        {setupStep === 'detect' ? (
          <div className="flex flex-col items-center justify-center my-auto w-full max-w-sm mx-auto text-center animate-fade-in">
            <div className="w-20 h-20 bg-surface rounded-2xl flex items-center justify-center mx-auto mb-4 border border-surfaceHover/50 shadow-sm">
              <Rocket className="w-10 h-10 text-primary animate-bounce-slow" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 rounded-full text-primary font-bold text-[11px] mb-3">
              Step 1 of 2: Connect LeetCode
            </div>

            <h1 className="text-xl font-bold text-text-main mb-1.5">Welcome to LeetStreak</h1>
            <p className="text-xs text-text-muted mb-6 leading-relaxed max-w-xs">
              Detect your active LeetCode session to start tracking streaks, problem analytics, and daily challenges.
            </p>

            <div className="space-y-3.5 w-full">
              {setupError && (
                <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-xs text-red-400 text-left leading-relaxed">
                  {setupError}
                </div>
              )}

              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={setupLoading}
                className="w-full min-h-[48px] py-3 bg-primary hover:bg-primaryHover text-inverted font-bold text-xs rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-primary/20 active:scale-95 flex items-center justify-center gap-2"
              >
                {setupLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Detecting LeetCode Session...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Auto-Detect Profile</>
                )}
              </button>

              {showManualInput ? (
                <form onSubmit={handleManualUsernameSubmit} className="space-y-2.5 pt-2 animate-fade-in">
                  <div className="text-left">
                    <label className="block text-[11px] font-semibold text-text-muted mb-1">
                      Enter LeetCode Username
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. neetcode, tour_de_code"
                      value={manualUsername}
                      onChange={(e) => setManualUsername(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 bg-surface border border-surfaceHover rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full min-h-[44px] py-2.5 bg-surface hover:bg-surfaceHover border border-surfaceHover text-text-main font-semibold text-xs rounded-xl transition-all"
                  >
                    Continue with @{manualUsername.trim() || 'username'}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowManualInput(true)}
                  className="text-[11px] text-text-muted hover:text-text-main transition-colors py-1 underline-offset-2 hover:underline"
                >
                  Cannot auto-detect? Enter username manually
                </button>
              )}
            </div>

            <p className="mt-6 text-[11px] text-text-muted">
              Make sure you are logged into <a href="https://leetcode.com" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">leetcode.com</a> in another tab.
            </p>
          </div>
        ) : (
          <div className="flex flex-col justify-center my-auto w-full max-w-sm mx-auto animate-fade-in text-center">
            <button
              type="button"
              onClick={() => {
                setSetupStep('detect');
                setAuthError('');
                setAuthSuccessMsg('');
              }}
              className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main mb-3 transition-colors self-start"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to LeetCode Detection
            </button>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 rounded-full text-primary font-bold text-[11px] mb-2.5 self-center">
              Step 2 of 2: Cloud Account
            </div>

            <h1 className="text-xl font-bold text-text-main mb-1">
              {authMode === 'signup' ? 'Create Your Cloud Account' : 'Sign In to Cloud Account'}
            </h1>
            <p className="text-xs text-text-muted mb-3.5 leading-relaxed">
              Link your LeetCode handle to an email & password to enable 1v1 coding battles and friends sync.
            </p>

            {/* Detected LeetCode Identity Badge */}
            <div className="flex items-center justify-between p-3 bg-surface/80 border border-surfaceHover/60 rounded-xl mb-3 text-left">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                  LC
                </div>
                <div>
                  <p className="text-[10px] text-text-muted font-medium uppercase tracking-wider">LeetCode Identity</p>
                  <p className="text-xs font-bold text-text-main font-mono">@{detectedUsername}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSetupStep('detect');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className="text-[11px] text-primary hover:underline font-semibold min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                Change
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="flex w-full bg-surface p-1 rounded-xl border border-surfaceHover/50 mb-3">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className={`flex-1 min-h-[40px] py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  authMode === 'signup' ? 'bg-primary text-inverted shadow-sm' : 'text-text-muted hover:text-text-main'
                }`}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signin');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className={`flex-1 min-h-[40px] py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  authMode === 'signin' ? 'bg-primary text-inverted shadow-sm' : 'text-text-muted hover:text-text-main'
                }`}
              >
                Sign In
              </button>
            </div>

            {authError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-400 mb-3 text-left">
                {authError}
              </div>
            )}
            {authSuccessMsg && (
              <div className="p-2.5 bg-green-500/10 border border-green-500/25 rounded-xl text-xs text-green-400 mb-3 text-left">
                {authSuccessMsg}
              </div>
            )}
            {authCooldown > 0 && (
              <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-400 mb-3 text-center">
                Rate limit active. Please wait {authCooldown}s
              </div>
            )}

            <form onSubmit={handleCloudAuthSubmit} className="space-y-2.5 text-left">
              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Email</label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  disabled={authSubmitting}
                  required
                  className="w-full min-h-[44px] px-3 py-2 bg-surface/80 border border-surfaceHover/60 rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Password</label>
                <input
                  type="password"
                  placeholder={authMode === 'signup' ? 'Min 6 characters' : 'Your password'}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  disabled={authSubmitting}
                  required
                  className="w-full min-h-[44px] px-3 py-2 bg-surface/80 border border-surfaceHover/60 rounded-xl text-xs text-text-main placeholder-text-muted/40 focus:outline-none focus:border-primary transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={authSubmitting || authCooldown > 0}
                className="w-full min-h-[44px] py-2.5 bg-primary hover:bg-primaryHover text-inverted text-xs font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95 shadow-sm mt-1"
              >
                {authSubmitting ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                ) : (
                  authMode === 'signup' ? 'Create Account & Enter' : 'Sign In & Enter'
                )}
              </button>
            </form>

            <p className="mt-3 text-[11px] text-text-muted text-center leading-relaxed">
              Your profile will be verified and linked to @{detectedUsername}.
            </p>
          </div>
        )}
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
                  onClick={() => setShowNotificationCenter(prev => !prev)}
                  className="p-2.5 text-text-muted hover:text-primary transition-all duration-200 hover:bg-surfaceHover/50 rounded-lg relative"
                  title={notifications.length > 0 ? `${notifications.length} notifications` : 'Notifications'}
                  aria-label={notifications.length > 0 ? `${notifications.length} notifications` : 'Notifications'}
                >
                  <Bell className="w-5 h-5" />
                  {notifications.length > 0 && (
                    <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-md border-2 border-surface animate-pulse">
                      {notifications.length > 99 ? '99+' : notifications.length}
                    </span>
                  )}
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
                  onCloudSignOut={() => {
                    setFriends({});
                    setPresenceMap({});
                  }}
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
                    roastNotifications={roastNotifications}
                    myUsername={myUsername}
                    onDismissRoast={handleDismissNotifications}
                    onChallengeBattle={handleChallengeFromRoast}
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
                  onRequireAuth={handleRequireAuth}
                  initialOpponent={battleInitialOpponent}
                  onClearInitialOpponent={() => setBattleInitialOpponent(null)}
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
                  <FriendRequests onChanged={handleFriendAdded} />
                  <div className="flex-1 overflow-y-auto scrollbar-hide">
                    <Leaderboard
                      friends={friendsList}
                      myData={myData}
                      myUsername={myUsername}
                      presenceMap={presenceMap}
                      onRequireAuth={handleRequireAuth}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Notification Center Modal */}
        {showNotificationCenter && (
          <NotificationCenter 
            notifications={notifications} 
            onDismiss={handleDismissNotifications}
            onMarkAllRead={handleMarkAllRead}
            onClearAll={handleMarkAllRead}
            onClose={() => setShowNotificationCenter(false)}
            onNavigateView={(targetView) => setView(targetView)}
            myUsername={myUsername}
            onChallengeFromRoast={handleChallengeFromRoast}
          />
        )}

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
