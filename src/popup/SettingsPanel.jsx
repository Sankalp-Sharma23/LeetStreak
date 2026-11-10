import React, { useState, useEffect } from 'react';
import { ChevronLeft, Moon, Sun, Bell, RotateCcw, LogOut, AlertTriangle, X, Flame, Shield, KeyRound, CheckCircle2, Cloud, Loader2, Swords } from 'lucide-react';
import { normalizeReminderFrequency } from '../shared/daily-reminders';

function ConfirmDialog({ title, message, confirmText, cancelText, onConfirm, onCancel, isDangerous }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-2xl max-w-sm w-full border border-surfaceHover/50 animate-fade-in">
        {/* Header */}
        <div className={`flex items-center gap-3 p-6 border-b ${isDangerous ? 'border-red-500/20 bg-red-500/5' : 'border-surfaceHover/30'}`}>
          <div className={`p-3 rounded-full ${isDangerous ? 'bg-red-500/20' : 'bg-orange-500/20'}`}>
            <AlertTriangle className={`w-5 h-5 ${isDangerous ? 'text-red-400' : 'text-orange-400'}`} />
          </div>
          <h3 className="text-lg font-bold text-text-main flex-1">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-surfaceHover rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-text-muted text-sm leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-surfaceHover/30 bg-surface/50">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 bg-surface hover:bg-surfaceHover border border-surfaceHover/50 text-text-main rounded-lg font-medium transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all text-white shadow-lg ${
              isDangerous
                ? 'bg-red-600 hover:bg-red-700 active:scale-95'
                : 'bg-orange-600 hover:bg-orange-700 active:scale-95'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ onBack, onNavigateToBattle, onCloudSignOut, theme, onThemeChange }) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationFrequency, setNotificationFrequency] = useState('normal');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [autoSyncInterval, setAutoSyncInterval] = useState(30);
  const [hardcoreModeEnabled, setHardcoreModeEnabled] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [username, setUsername] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showClearDataConfirm, setShowClearDataConfirm] = useState(false);

  // Supabase Cloud Account state
  const [authState, setAuthState] = useState('SESSION_LOADING');
  const [authSession, setAuthSession] = useState(null);
  const [, setCooldownSeconds] = useState(0);

  useEffect(() => {
    // Load settings from storage
    chrome.storage.local.get(['my_leetcode_username', 'notifications_enabled', 'notification_frequency', 'auto_sync_enabled', 'auto_sync_interval', 'hardcore_mode_enabled'], (data) => {
      if (data.my_leetcode_username) {
        setUsername(data.my_leetcode_username);
      }
      if (data.notifications_enabled !== undefined) {
        setNotificationsEnabled(data.notifications_enabled);
      }
      if (data.notification_frequency) {
        setNotificationFrequency(normalizeReminderFrequency(data.notification_frequency));
      }
      if (data.auto_sync_enabled !== undefined) {
        setAutoSyncEnabled(data.auto_sync_enabled);
      }
      if (data.auto_sync_interval) {
        setAutoSyncInterval(data.auto_sync_interval);
      }
      if (data.hardcore_mode_enabled !== undefined) {
        setHardcoreModeEnabled(data.hardcore_mode_enabled);
      }
    });

    // Check Cloud auth state
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (res) => {
      if (res && res.success) {
        setAuthState(res.state);
        setAuthSession(res.session);
        setCooldownSeconds(res.cooldownSeconds || 0);
      }
    });
  }, []);

  useEffect(() => {
    const syncSavedPreferences = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.notifications_enabled) setNotificationsEnabled(changes.notifications_enabled.newValue !== false);
      if (changes.notification_frequency) {
        setNotificationFrequency(normalizeReminderFrequency(changes.notification_frequency.newValue));
      }
    };
    chrome.storage.onChanged.addListener(syncSavedPreferences);
    return () => chrome.storage.onChanged.removeListener(syncSavedPreferences);
  }, []);

  const handleThemeToggle = (newTheme) => {
    chrome.storage.local.set({ theme: newTheme });
    onThemeChange(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const handleNotificationsToggle = () => {
    const newValue = !notificationsEnabled;
    setNotificationsEnabled(newValue);
    chrome.storage.local.set({ notifications_enabled: newValue });
  };

  const handleNotificationFrequencyChange = async (frequency) => {
    const normalized = normalizeReminderFrequency(frequency);
    try {
      await chrome.storage.local.set({ notification_frequency: normalized });
      setNotificationFrequency(normalized);
    } catch (error) {
      console.error('Could not save notification frequency:', error);
    }
  };

  const handleAutoSyncToggle = () => {
    const newValue = !autoSyncEnabled;
    setAutoSyncEnabled(newValue);
    chrome.storage.local.set({ auto_sync_enabled: newValue });
  };

  const handleAutoSyncIntervalChange = (minutes) => {
    setAutoSyncInterval(minutes);
    chrome.storage.local.set({ auto_sync_interval: minutes });
  };

  const handleHardcoreModeToggle = async () => {
    const nextState = !hardcoreModeEnabled;
    setHardcoreModeEnabled(nextState);
    await chrome.storage.local.set({ hardcore_mode_enabled: nextState });
    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SYNC_BLOCKER_RULES' }).catch(() => {});
    }
  };

  const requestTabsPermission = async () => {
    setShowPermissionDialog(false);
    setHardcoreModeEnabled(true);
    await chrome.storage.local.set({ hardcore_mode_enabled: true });
    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SYNC_BLOCKER_RULES' }).catch(() => {});
    }
  };

  const handleClearData = async () => {
    setShowClearDataConfirm(false);
    const { clearAllData } = await import('../shared/storage.js');
    await clearAllData();
    // Reset to setup mode
    window.location.reload();
  };

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    await chrome.storage.local.remove(['my_leetcode_username', 'friends']);
    window.location.reload();
  };

  const handleSignOutCloud = async () => {
    try {
      await new Promise(resolve => chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, resolve));
      setAuthState('AUTH_REQUIRED');
      setAuthSession(null);
      onCloudSignOut?.();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-background via-background to-surface/20">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-surfaceHover/50 bg-surface/95 backdrop-blur-md sticky top-0">
        <button
          onClick={onBack}
          className="p-2 hover:bg-surfaceHover rounded-lg transition-colors"
          title="Go back"
        >
          <ChevronLeft className="w-5 h-5 text-primary" />
        </button>
        <h2 className="text-lg font-bold text-text-main flex-1">Settings</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {/* Account Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-text-muted uppercase tracking-wide">Account</h3>
          <div className="bg-surface/50 rounded-lg p-4 border border-surfaceHover/30">
            <p className="text-xs text-text-muted mb-1">Connected Account</p>
            <p className="text-lg font-semibold text-text-main">{username || 'Not set'}</p>
          </div>
        </div>

        {/* Theme Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-text-muted uppercase tracking-wide">Appearance</h3>
          <div className="space-y-2">
            <button
              onClick={() => handleThemeToggle('dark')}
              className={`w-full flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
                theme === 'dark'
                  ? 'bg-surface border-primary shadow-lg shadow-primary/20'
                  : 'bg-surface/50 border-surfaceHover/30 hover:border-surfaceHover/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Moon className={`w-5 h-5 ${theme === 'dark' ? 'text-primary' : 'text-text-muted'}`} />
                <span className={`font-medium ${theme === 'dark' ? 'text-primary' : 'text-text-main'}`}>Dark Mode</span>
              </div>
              {theme === 'dark' && <div className="w-2 h-2 rounded-full bg-primary"></div>}
            </button>

            <button
              onClick={() => handleThemeToggle('light')}
              className={`w-full flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
                theme === 'light'
                  ? 'bg-surface border-primary shadow-lg shadow-primary/20'
                  : 'bg-surface/50 border-surfaceHover/30 hover:border-surfaceHover/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Sun className={`w-5 h-5 ${theme === 'light' ? 'text-primary' : 'text-text-muted'}`} />
                <span className={`font-medium ${theme === 'light' ? 'text-primary' : 'text-text-main'}`}>Light Mode</span>
              </div>
              {theme === 'light' && <div className="w-2 h-2 rounded-full bg-primary"></div>}
            </button>
          </div>
        </div>

        {/* Notification Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-text-muted uppercase tracking-wide">Notifications</h3>
          
          {/* Enable/Disable Notifications */}
          <button
            onClick={handleNotificationsToggle}
            className="w-full flex items-center justify-between p-4 bg-surface/50 hover:bg-surface/70 rounded-xl border border-surfaceHover/30 transition-all duration-200 group"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg transition-all ${notificationsEnabled ? 'bg-primary/20' : 'bg-surfaceHover/50'}`}>
                <Bell className={`w-4 h-4 ${notificationsEnabled ? 'text-primary' : 'text-text-muted'}`} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-text-main">Notifications</p>
                <p className="text-xs text-text-muted">{notificationsEnabled ? 'Enabled' : 'Disabled'}</p>
              </div>
            </div>
            {/* Modern Toggle Switch */}
            <div className={`relative inline-flex items-center w-12 h-7 rounded-full transition-all duration-300 ${notificationsEnabled ? 'bg-primary' : 'bg-surfaceHover'}`}>
              <div className={`absolute w-5 h-5 bg-white rounded-full shadow-md transition-all duration-300 ${notificationsEnabled ? 'right-1' : 'left-1'}`}></div>
            </div>
          </button>

          {/* Notification Frequency Slider */}
          {notificationsEnabled && (
            <div className="bg-surface/30 rounded-2xl p-5 border border-surfaceHover/20 backdrop-blur-sm space-y-4 animate-fade-in">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-text-main">Notification Frequency</label>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      notificationFrequency === 'normal' ? 'bg-primary/20 text-primary' :
                      notificationFrequency === 'reduced' ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400' :
                      'bg-text-muted/20 text-text-muted'
                    }`}
                    >
                      {notificationFrequency === 'normal' ? 'Normal · 2/day' :
                       notificationFrequency === 'reduced' ? 'Reduced · 1/day' :
                       'Off'}
                    </span>
                  </div>
                </div>

                {/* Slider Container */}
                <div className="relative space-y-2">
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="1"
                    value={notificationFrequency === 'normal' ? 0 : notificationFrequency === 'reduced' ? 1 : 2}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      handleNotificationFrequencyChange(val === 0 ? 'normal' : val === 1 ? 'reduced' : 'off');
                    }}
                    className="w-full h-2 bg-gradient-to-r from-primary via-orange-500 to-gray-500 rounded-full appearance-none cursor-pointer transition-all"
                    style={{
                      WebkitAppearance: 'none',
                      outline: 'none'
                    }}
                  />
                  
                  {/* Slider Labels */}
                  <div className="flex justify-between text-xs text-text-muted font-medium px-1">
                    <span>Normal</span>
                    <span>Reduced</span>
                    <span>Off</span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-text-muted leading-relaxed">
                  {notificationFrequency === 'normal' && '🔔 Daily problem reminders at 11 AM and 11 PM until you solve one'}
                  {notificationFrequency === 'reduced' && '⭐ One daily problem reminder at 11 AM until you solve one'}
                  {notificationFrequency === 'off' && '🔕 Daily problem reminders are off. Battle and friend alerts stay available.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sync Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-text-muted uppercase tracking-wide">Sync Settings</h3>
          
          {/* Auto-Sync Toggle */}
          <button
            onClick={handleAutoSyncToggle}
            className="w-full flex items-center justify-between p-4 bg-surface/50 hover:bg-surface/70 rounded-xl border border-surfaceHover/30 transition-all duration-200 group"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg transition-all ${autoSyncEnabled ? 'bg-primary/20' : 'bg-surfaceHover/50'}`}>
                <RotateCcw className={`w-4 h-4 ${autoSyncEnabled ? 'text-primary' : 'text-text-muted'}`} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-text-main">Auto-Sync</p>
                <p className="text-xs text-text-muted">{autoSyncEnabled ? 'Enabled' : 'Disabled'}</p>
              </div>
            </div>
            {/* Modern Toggle Switch */}
            <div className={`relative inline-flex items-center w-12 h-7 rounded-full transition-all duration-300 ${autoSyncEnabled ? 'bg-primary' : 'bg-surfaceHover'}`}>
              <div className={`absolute w-5 h-5 bg-white rounded-full shadow-md transition-all duration-300 ${autoSyncEnabled ? 'right-1' : 'left-1'}`}></div>
            </div>
          </button>

          {/* Sync Frequency Slider */}
          {autoSyncEnabled && (
            <div className="bg-surface/30 rounded-2xl p-5 border border-surfaceHover/20 backdrop-blur-sm space-y-4 animate-fade-in">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-text-main">Sync Frequency</label>
                  <span className="text-sm font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full">
                    Every {autoSyncInterval}m
                  </span>
                </div>

                {/* Slider Container */}
                <div className="relative space-y-3">
                  <input
                    type="range"
                    min="15"
                    max="60"
                    step="5"
                    value={autoSyncInterval}
                    onChange={(e) => handleAutoSyncIntervalChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-gradient-to-r from-primary to-primary/50 rounded-full appearance-none cursor-pointer transition-all"
                    style={{
                      WebkitAppearance: 'none',
                      outline: 'none'
                    }}
                  />
                  
                  {/* Slider Labels */}
                  <div className="flex justify-between text-xs text-text-muted font-medium px-1">
                    <span>15m</span>
                    <span>30m</span>
                    <span>45m</span>
                    <span>60m</span>
                  </div>
                </div>

                {/* Description */}
                <div className="bg-primary/5 rounded-lg p-3 space-y-1.5">
                  <p className="text-xs font-medium text-primary flex items-center gap-2">
                    <span>⚡</span> Smart Sync
                  </p>
                  <p className="text-xs text-text-muted leading-relaxed">
                    Syncs every {autoSyncInterval} minutes to keep your friend's stats up to date while conserving battery
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Hardcore Motivation Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-red-400 uppercase tracking-wide flex items-center gap-2">
            <Flame className="w-4 h-4" /> Productivity
          </h3>
          <button
            onClick={handleHardcoreModeToggle}
            className="w-full flex items-center justify-between p-4 bg-red-500/10 hover:bg-red-500/15 rounded-xl border border-red-500/30 transition-all duration-200 group"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg transition-all ${hardcoreModeEnabled ? 'bg-red-500/20' : 'bg-surfaceHover/50'}`}>
                <Flame className={`w-4 h-4 ${hardcoreModeEnabled ? 'text-red-400' : 'text-text-muted'}`} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-red-400">Hardcore Motivation Mode</p>
                <p className="text-xs text-text-muted mt-1">Guilt-trips you when you open Netflix, YouTube, etc. without solving a problem today.</p>
              </div>
            </div>
            <div className={`relative inline-flex items-center w-12 h-7 rounded-full transition-all duration-300 ml-2 ${hardcoreModeEnabled ? 'bg-red-500' : 'bg-surfaceHover'}`}>
              <div className={`absolute w-5 h-5 bg-white rounded-full shadow-md transition-all duration-300 ${hardcoreModeEnabled ? 'right-1' : 'left-1'}`}></div>
            </div>
          </button>
        </div>

        {/* Supabase Cloud Account Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-muted uppercase tracking-wide flex items-center gap-2">
              <Cloud className="w-4 h-4 text-primary" /> Cloud Features & Battles
            </h3>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              authState === 'AUTHENTICATED'
                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                : 'bg-zinc-700/30 text-zinc-400 border border-zinc-700/50'
            }`}>
              {authState === 'AUTHENTICATED' ? 'Connected' : 'Offline Mode'}
            </span>
          </div>

          <div className="bg-surface/40 rounded-2xl p-4 border border-surfaceHover/30 space-y-3">
            {authState === 'AUTHENTICATED' ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/10 rounded-xl text-green-400">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-main truncate">
                      {authSession?.email || 'Cloud Account Active'}
                    </p>
                    <p className="text-[11px] text-text-muted">1v1 Battles & friend cloud sync enabled</p>
                  </div>
                </div>
                <button
                  onClick={handleSignOutCloud}
                  className="w-full py-2.5 px-4 bg-surface hover:bg-surfaceHover border border-surfaceHover/60 text-xs font-medium text-text-muted hover:text-text-main rounded-xl transition-all"
                >
                  Disconnect Cloud Account
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-text-muted leading-relaxed">
                  Personal streaks and progress work <span className="text-text-main font-semibold">100% offline</span>. Sign in to your account for 1v1 Battles, friends leaderboard, and roasts.
                </p>

                <button
                  onClick={onNavigateToBattle}
                  className="w-full py-3 px-4 bg-primary hover:bg-primaryHover text-inverted text-xs font-semibold rounded-xl transition-all shadow-md hover:shadow-primary/20 flex items-center justify-center gap-2 active:scale-95"
                >
                  <Swords className="w-4 h-4" /> Go to 1v1 Battle to Sign In / Create Account →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Actions Section */}
        <div className="space-y-3 pt-6 border-t border-surfaceHover/30">
          <h3 className="text-sm font-bold text-text-muted uppercase tracking-wide">Danger Zone</h3>
          
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center justify-between p-4 bg-orange-500/10 border-2 border-orange-500/30 rounded-xl hover:bg-orange-500/15 hover:border-orange-500/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg group-hover:scale-110 transition-transform">
                <LogOut className="w-4 h-4 text-orange-400" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-orange-400 text-sm">Logout</p>
                <p className="text-xs text-orange-400/60">Exit your account</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setShowClearDataConfirm(true)}
            className="w-full flex items-center justify-between p-4 bg-red-500/10 border-2 border-red-500/30 rounded-xl hover:bg-red-500/15 hover:border-red-500/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/20 rounded-lg group-hover:scale-110 transition-transform">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-red-400 text-sm">Clear All Data</p>
                <p className="text-xs text-red-400/60">Cannot be undone</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <ConfirmDialog
          title="Logout?"
          message="You'll be logged out and can set up your account again later. Your extension will reset to the welcome screen."
          confirmText="Logout"
          cancelText="Cancel"
          onConfirm={handleLogout}
          onCancel={() => setShowLogoutConfirm(false)}
          isDangerous={false}
        />
      )}

      {/* Clear Data Confirmation Dialog */}
      {showClearDataConfirm && (
        <ConfirmDialog
          title="Clear All Data?"
          message="This will permanently delete all your friends list, settings, cache, and stored data. This action cannot be undone. You'll need to set up your account again."
          confirmText="Clear Data"
          cancelText="Cancel"
          onConfirm={handleClearData}
          onCancel={() => setShowClearDataConfirm(false)}
          isDangerous={true}
        />
      )}

      {/* Tabs Permission Confirmation Dialog */}
      {showPermissionDialog && (
        <ConfirmDialog
          title="Enable Hardcore Mode"
          message="To know when you're procrastinating, LeetStreak needs the 'tabs' permission to see what websites you visit (like Netflix or YouTube). We only check URLs locally against a blacklist and NEVER send your browsing history anywhere. Do you allow this?"
          confirmText="Allow & Enable"
          cancelText="Decline"
          onConfirm={requestTabsPermission}
          onCancel={() => setShowPermissionDialog(false)}
          isDangerous={false}
        />
      )}

      <style>{`
        /* Modern Apple-like Slider Styling */
        input[type='range'] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 999px;
          outline: none;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        /* Thumb/Handle Styling */
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
          border: 2px solid #3b82f6;
          transition: all 0.2s ease;
        }

        input[type='range']::-webkit-slider-thumb:hover {
          width: 22px;
          height: 22px;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }

        input[type='range']::-webkit-slider-thumb:active {
          transform: scale(0.95);
        }

        input[type='range']::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
          border: 2px solid #3b82f6;
          transition: all 0.2s ease;
        }

        input[type='range']::-moz-range-thumb:hover {
          width: 22px;
          height: 22px;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }

        input[type='range']::-moz-range-track {
          background: transparent;
          border: none;
        }

        /* Smooth animation for fade-in */
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

export default SettingsPanel;
