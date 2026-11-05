# Feature Blueprint: SMS Notifications & Friend Activity Alerts

**Date:** December 28, 2025  
**Status:** DEFERRED PROPOSAL (Exploratory Feasibility Only — Not Implemented in Scope)  
**Version:** 1.0

> [!NOTE] ARCHITECTURAL DECISION ON SCOPE
> SMS Streak Alerts are explicitly **DEFERRED**. The project does NOT collect phone numbers, integrate third-party paid SMS providers (e.g. Twilio, AWS SNS), or require paid cloud infrastructure. Friend activity notifications remain implemented via browser notifications and in-app fallback.

---

## Executive Summary

This document analyzes the feasibility of implementing two new notification features:

1. **SMS Streak Alerts** - Send up to 3 SMS per day when user's streak is at risk
2. **Friend Activity Notifications** - Real-time alerts when friends solve problems with gap analysis

### Quick Verdict

| Feature | Feasibility | Complexity | Estimated Time | Recommended |
|---------|-------------|------------|----------------|-------------|
| SMS Streak Alerts | ✅ **POSSIBLE** | 🟡 Medium-High | 3-5 days | ⚠️ WITH CAVEATS |
| Friend Activity Notifications | ✅ **POSSIBLE** | 🟢 Low-Medium | 1-2 days | ✅ YES |

---

## Feature 1: SMS Streak Alerts

### 📋 Concept

Send SMS notifications to user's phone number when their LeetCode streak is at risk of breaking, with a maximum of 3 messages per day.

### 🎯 Use Cases

**Scenario 1: Streak at Risk**
- User has 45-day streak
- It's 10 PM and user hasn't solved today
- SMS: "⚠️ Your 45-day LeetCode streak ends in 2 hours! Solve a problem now to keep it alive."

**Scenario 2: Daily Reminders**
- 9 AM: "Good morning! Keep your streak alive today 🔥"
- 6 PM: "Evening reminder: Haven't solved today yet"
- 10 PM: "⚠️ URGENT: 2 hours left to maintain streak"

**Scenario 3: Time Zone Awareness**
- User traveling across time zones
- System tracks user's local time
- Sends reminders based on local midnight

### 🏗️ Technical Architecture

#### Current System Analysis

**✅ What We Have:**
- Chrome extension with `alarms` permission
- Background service worker running every 30 minutes
- Streak detection logic (`isStreakAtRisk()`)
- Notification state management
- UTC-based date handling
- Storage for user preferences

**❌ What We DON'T Have:**
- Backend server infrastructure
- SMS sending capability
- Phone number storage
- User authentication system
- Payment processing for SMS costs

#### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Chrome Extension (Client)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Service Worker (Every 30 min)                             │ │
│  │  - Check streak status                                     │ │
│  │  - Detect if user hasn't solved today                      │ │
│  │  - Calculate time until midnight                           │ │
│  │  - Decide if SMS should be sent                            │ │
│  └───────────────────────┬────────────────────────────────────┘ │
│                          │ HTTP POST                             │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend Server (NEW)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  API Endpoints                                             │ │
│  │  - POST /api/sms/register-phone                            │ │
│  │  - POST /api/sms/send-alert                                │ │
│  │  - GET /api/sms/status                                     │ │
│  │  - DELETE /api/sms/unregister                              │ │
│  └───────────────────────┬────────────────────────────────────┘ │
│                          │                                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  SMS Queue Manager                                         │ │
│  │  - Rate limiting (3 per user per day)                      │ │
│  │  - Deduplication                                           │ │
│  │  - Priority queue (urgent vs reminder)                     │ │
│  │  - Retry logic for failures                                │ │
│  └───────────────────────┬────────────────────────────────────┘ │
│                          │                                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Database (PostgreSQL/MongoDB)                             │ │
│  │  - User phone numbers (encrypted)                          │ │
│  │  - SMS history & daily counts                              │ │
│  │  - User preferences & time zones                           │ │
│  │  - Opt-in/opt-out status                                   │ │
│  └───────────────────────┬────────────────────────────────────┘ │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 SMS Provider (Choose One)                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Option A: Twilio                                          │ │
│  │  - Most reliable, $0.0079 per SMS (US)                    │ │
│  │  - Easy API, great documentation                           │ │
│  │  - Phone number verification built-in                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Option B: AWS SNS                                         │ │
│  │  - Cheapest, $0.00645 per SMS (US)                        │ │
│  │  - Requires AWS setup                                      │ │
│  │  - Good for existing AWS users                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Option C: Vonage (Nexmo)                                  │ │
│  │  - $0.0076 per SMS (US)                                    │ │
│  │  - Good international rates                                │ │
│  │  - Simple REST API                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 📦 Implementation Components

#### 1. Extension Updates

**New File: `src/popup/PhoneSettings.jsx`**
```jsx
// UI for users to:
// - Add/verify phone number
// - Set SMS preferences (times, frequency)
// - Toggle SMS on/off
// - View SMS history
// - Set time zone
```

**Modified: `src/background/service-worker.js`**
```javascript
// Add SMS notification logic:
// - Check streak status every 30 min
// - Calculate optimal SMS times
// - Send API request to backend
// - Handle failures gracefully
// - Track daily SMS count
```

**New File: `src/shared/sms-manager.js`**
```javascript
// Client-side SMS logic:
// - Validate phone numbers
// - Format international numbers
// - Calculate send times
// - Manage SMS quota (3/day)
// - Handle opt-in/opt-out
```

#### 2. Backend Server (NEW)

**Tech Stack Options:**

**Option A: Node.js + Express (Recommended)**
- Fast development
- Easy integration with Chrome extension
- Large ecosystem

**Option B: Python + Flask**
- Great for SMS logic
- Easy Twilio integration

**Option C: Serverless (AWS Lambda + API Gateway)**
- No server management
- Pay per use
- Auto-scaling

**File Structure:**
```
backend/
├── src/
│   ├── routes/
│   │   └── sms.js          # SMS endpoints
│   ├── services/
│   │   ├── twilioService.js    # Twilio integration
│   │   ├── queueService.js     # SMS queue
│   │   └── rateLimiter.js      # 3/day enforcement
│   ├── models/
│   │   ├── User.js         # User schema
│   │   └── SmsLog.js       # SMS history
│   ├── middleware/
│   │   ├── auth.js         # API key validation
│   │   └── validation.js   # Input validation
│   └── index.js            # Server entry
├── package.json
└── .env                    # API keys (NEVER commit)
```

#### 3. Database Schema

```sql
-- Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    leetcode_username VARCHAR(100) UNIQUE NOT NULL,
    phone_number VARCHAR(20) NOT NULL,  -- Encrypted
    phone_verified BOOLEAN DEFAULT FALSE,
    time_zone VARCHAR(50) DEFAULT 'UTC',
    sms_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- SMS Preferences Table
CREATE TABLE sms_preferences (
    user_id INTEGER REFERENCES users(id),
    send_morning BOOLEAN DEFAULT TRUE,
    send_evening BOOLEAN DEFAULT TRUE,
    send_urgent BOOLEAN DEFAULT TRUE,
    morning_time TIME DEFAULT '09:00',
    evening_time TIME DEFAULT '18:00',
    urgent_hours_before_midnight INTEGER DEFAULT 2,
    PRIMARY KEY (user_id)
);

-- SMS Log Table
CREATE TABLE sms_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    phone_number VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    message_type VARCHAR(50), -- 'morning', 'evening', 'urgent'
    status VARCHAR(20),  -- 'sent', 'failed', 'pending'
    provider_message_id VARCHAR(100),
    cost_usd DECIMAL(10, 4),
    sent_at TIMESTAMP DEFAULT NOW(),
    delivered_at TIMESTAMP
);

-- Daily SMS Count (for rate limiting)
CREATE TABLE daily_sms_counts (
    user_id INTEGER REFERENCES users(id),
    date DATE NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

-- Create indexes
CREATE INDEX idx_sms_logs_user_id ON sms_logs(user_id);
CREATE INDEX idx_sms_logs_sent_at ON sms_logs(sent_at);
CREATE INDEX idx_daily_counts_date ON daily_sms_counts(date);
```

### 🔐 Security & Privacy

#### Critical Considerations

**1. Phone Number Storage**
- ✅ Encrypt phone numbers at rest (AES-256)
- ✅ Never log full phone numbers
- ✅ Use hashed phone numbers for lookups
- ✅ Implement right to deletion (GDPR)

**2. User Consent**
- ✅ Explicit opt-in required
- ✅ Clear disclosure of data usage
- ✅ Easy opt-out mechanism
- ✅ Terms of service agreement

**3. Authentication**
- ✅ API keys for extension → backend
- ✅ Rate limiting on all endpoints
- ✅ Phone number verification (OTP)
- ✅ HTTPS only

**4. Compliance**
- ✅ GDPR (Europe)
- ✅ CCPA (California)
- ✅ TCPA (US - requires explicit consent)
- ✅ CAN-SPAM Act

### 💰 Cost Analysis

#### SMS Pricing (per message)

| Region | Twilio | AWS SNS | Vonage | Monthly Cost (3/day) |
|--------|--------|---------|--------|----------------------|
| US | $0.0079 | $0.00645 | $0.0076 | ~$0.71 |
| UK | $0.0395 | $0.0355 | $0.0362 | ~$3.55 |
| India | $0.0141 | $0.0135 | $0.0139 | ~$1.27 |
| Global Avg | $0.015 | $0.013 | $0.014 | ~$1.35 |

**For 100 Users (Active Daily):**
- US: $71/month
- Mixed Global: $135/month

**For 1,000 Users:**
- US: $710/month
- Mixed Global: $1,350/month

**For 10,000 Users:**
- US: $7,100/month
- Mixed Global: $13,500/month

#### Infrastructure Costs

**Option 1: Small VPS (DigitalOcean/AWS)**
- Server: $10-20/month
- Database: $15/month
- Total: $25-35/month (fixed)

**Option 2: Serverless (AWS Lambda)**
- Lambda: $0.20 per 1M requests
- API Gateway: $3.50 per 1M requests
- Database: $15/month
- Total: ~$15-20/month for small scale

#### Business Model Options

**Option A: Free Tier + Premium**
- Free: 1 SMS per day
- Premium ($2.99/month): 3 SMS per day + priority
- Revenue needed: 50-100 paying users to break even

**Option B: Fully Paid**
- $1.99/month: Unlimited SMS
- More predictable costs
- Higher barrier to adoption

**Option C: Ad-Supported**
- Free SMS for all users
- Show ads in extension
- Controversial, may hurt UX

### ⚠️ Challenges & Risks

#### Technical Challenges

**1. Chrome Extension Limitations**
- ❌ No direct SMS sending from extension
- ❌ No persistent background process (service worker sleeps)
- ❌ Limited to 30-minute alarms minimum
- ✅ Solution: Backend server handles all SMS logic

**2. Time Zone Complexity**
- User's local time != Server time != LeetCode time (UTC)
- Users traveling across time zones
- Daylight saving time changes
- Solution: Store user's time zone, calculate locally

**3. Reliability**
- SMS delivery not guaranteed
- Network failures
- Provider outages
- Solution: Retry logic, fallback to push notifications

**4. Rate Limiting**
- LeetCode may rate limit our API calls
- SMS providers have rate limits
- Extension sync only every 30 min
- Solution: Smart queuing, exponential backoff

#### Privacy & Legal Risks

**1. Data Breach**
- Phone numbers are sensitive PII
- Target for hackers
- Legal liability
- Solution: Encryption, security audits, insurance

**2. Spam Complaints**
- Users may mark as spam
- Carrier blocking
- Account suspension
- Solution: Clear opt-in, easy opt-out, quality messages

**3. TCPA Violations (US)**
- Requires "prior express written consent"
- Can result in $500-$1,500 per violation
- Class action lawsuit risk
- Solution: Explicit consent checkbox, audit trail

**4. International Regulations**
- Different laws per country
- Some countries restrict SMS
- Local registration required
- Solution: Start with US only, expand carefully

#### Cost Risks

**1. Scaling Costs**
- Linear cost per user
- No economies of scale for SMS
- Could become expensive quickly
- Solution: Premium tier, usage limits

**2. Abuse**
- Users gaming system for free SMS
- Bots creating accounts
- Multiple accounts per user
- Solution: Phone verification, rate limiting, anomaly detection

### ✅ Recommended Implementation Approach

#### Phase 1: MVP (Minimal Viable Product)

**Scope:**
- Single SMS per day at 9 PM local time
- US phone numbers only
- Manual phone number entry (no verification yet)
- Browser notifications as fallback
- 100 user beta test

**Timeline:** 3-5 days
**Cost:** ~$20/month infrastructure + ~$25/month SMS (100 users)

**Components:**
1. Basic backend API (Node.js + Express)
2. Twilio integration
3. Simple phone settings UI
4. Extension updates for SMS trigger
5. Basic encryption for phone numbers

#### Phase 2: Enhanced Features

**Scope:**
- 3 SMS per day with smart timing
- Phone verification (OTP)
- Time zone detection
- International support
- Premium tier ($1.99/month)
- Usage analytics dashboard

**Timeline:** 5-7 additional days
**Cost:** Variable based on adoption

#### Phase 3: Production Scale

**Scope:**
- Multiple SMS providers (failover)
- Advanced queue management
- Machine learning for optimal times
- User engagement tracking
- Cost optimization
- GDPR compliance tools

**Timeline:** 10-15 additional days

### 🎯 Alternatives to Consider

#### Option 1: Web Push Notifications (RECOMMENDED)
- ✅ Free
- ✅ No backend needed
- ✅ Works on desktop & mobile
- ✅ No privacy concerns
- ❌ Requires browser open
- ❌ Easy to dismiss/ignore

#### Option 2: Telegram/WhatsApp Bot
- ✅ Free messaging
- ✅ Rich media support
- ✅ Better engagement
- ❌ Requires user to have Telegram/WhatsApp
- ❌ Extra setup steps

#### Option 3: Email Notifications
- ✅ Free
- ✅ No backend needed (can use Gmail API)
- ✅ Rich formatting
- ❌ Less urgent feeling
- ❌ Often ignored

#### Option 4: Desktop Notifications + Badge
- ✅ Free
- ✅ Already supported by Chrome
- ✅ No infrastructure
- ❌ Only works when computer on
- ✅ Good for desktop users

---

## Feature 2: Friend Activity Notifications

### 📋 Concept

Show real-time notifications when friends solve problems, with analysis of how the ranking gap is changing.

### 🎯 Use Cases

**Scenario 1: Friend Just Solved**
- Notification: "🎯 john_doe just solved a Medium problem! You're now only 3 problems behind."

**Scenario 2: Gap Closing**
- Notification: "📈 sarah_123 is catching up! The gap decreased from 15 to 12 problems today."

**Scenario 3: Gap Widening**
- Notification: "⚠️ mike_dev is pulling ahead! Gap increased from 5 to 8 problems."

**Scenario 4: Overtaken**
- Notification: "🚀 emma_codes just passed you in the leaderboard! Time to solve some problems!"

### 🏗️ Technical Architecture

#### Current System Analysis

**✅ What We Have:**
- Friend data sync every 30 minutes
- Problem count tracking (`stats.total`)
- Submission calendar data
- Recent submissions array
- Notification system
- Browser notifications permission

**✅ What We Can Use:**
- Service worker already running
- Storage for friend data
- Diff detection capability
- Existing notification UI

#### Proposed Architecture

```
┌────────────────────────────────────────────────────────────┐
│         Service Worker (Every 30 min sync)                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. Fetch Current Friend Data                        │  │
│  │     - Get all friends' stats                         │  │
│  │     - Get submission calendars                       │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼────────────────────────────────────┐  │
│  │  2. Load Previous Snapshot from Storage             │  │
│  │     - Get last known friend data                     │  │
│  │     - Get last ranking positions                     │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼────────────────────────────────────┐  │
│  │  3. Activity Detector (NEW)                          │  │
│  │     ┌──────────────────────────────────────────────┐ │  │
│  │     │ detectFriendActivity(current, previous)      │ │  │
│  │     │  - Check if friend solved new problem        │ │  │
│  │     │  - Get problem details (title, difficulty)   │ │  │
│  │     │  - Calculate time since last solve           │ │  │
│  │     └──────────────────────────────────────────────┘ │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼────────────────────────────────────┐  │
│  │  4. Gap Analyzer (NEW)                               │  │
│  │     ┌──────────────────────────────────────────────┐ │  │
│  │     │ analyzeGapChanges(current, previous, myData) │ │  │
│  │     │  - Calculate previous gap                    │ │  │
│  │     │  - Calculate current gap                     │ │  │
│  │     │  - Determine trend (closing/widening)        │ │  │
│  │     │  - Check if overtaken                        │ │  │
│  │     └──────────────────────────────────────────────┘ │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼────────────────────────────────────┐  │
│  │  5. Notification Generator (NEW)                     │  │
│  │     - Format rich notification message               │  │
│  │     - Include friend name, problem, gap info         │  │
│  │     - Add action buttons (View, Solve Now)           │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼────────────────────────────────────┐  │
│  │  6. Send Notification                                │  │
│  │     - Browser notification                           │  │
│  │     - Store in unread_notifications                  │  │
│  │     - Update badge count                             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  7. Save Snapshot for Next Comparison                │  │
│  │     - Store current data as previous                 │  │
│  │     - Store timestamp                                │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 📦 Implementation Components

#### 1. New File: `src/shared/friend-activity-detector.js`

```javascript
/**
 * Friend Activity Detector
 * Detects when friends solve problems and calculates gap changes
 */

/**
 * Detect if friend has new activity
 * @param {Object} currentFriend - Current friend data
 * @param {Object} previousFriend - Previous snapshot (may be null)
 * @returns {Object|null} Activity details or null
 */
export function detectFriendActivity(currentFriend, previousFriend) {
  if (!previousFriend) return null;
  
  const currentTotal = currentFriend.stats?.total || 0;
  const previousTotal = previousFriend.stats?.total || 0;
  
  if (currentTotal <= previousTotal) return null;
  
  const problemsSolved = currentTotal - previousTotal;
  
  // Get most recent submission
  const recentSub = currentFriend.recentSubmissions?.[0];
  
  return {
    type: 'new_submission',
    username: currentFriend.profile.username,
    problemsSolved,
    totalNow: currentTotal,
    recentProblem: recentSub ? {
      title: recentSub.title,
      difficulty: recentSub.difficulty,
      timestamp: recentSub.timestamp
    } : null
  };
}

/**
 * Analyze gap changes between user and friend
 * @param {Object} myData - Current user's data
 * @param {Object} currentFriend - Current friend data
 * @param {Object} previousSnapshot - Previous gap snapshot
 * @returns {Object} Gap analysis
 */
export function analyzeGapChange(myData, currentFriend, previousSnapshot) {
  const myTotal = myData.stats?.total || 0;
  const friendTotal = currentFriend.stats?.total || 0;
  
  const currentGap = friendTotal - myTotal;
  const previousGap = previousSnapshot?.gap ?? currentGap;
  
  const gapChange = currentGap - previousGap;
  
  let trend = 'unchanged';
  if (gapChange < 0) trend = 'closing'; // Gap got smaller
  if (gapChange > 0) trend = 'widening'; // Gap got bigger
  
  const overtaken = previousGap >= 0 && currentGap < 0; // Friend was ahead, now behind
  const gotOvertaken = previousGap < 0 && currentGap >= 0; // We were ahead, now behind
  
  return {
    currentGap: Math.abs(currentGap),
    previousGap: Math.abs(previousGap),
    gapChange: Math.abs(gapChange),
    trend,
    ahead: currentGap < 0, // We're ahead
    overtaken,
    gotOvertaken
  };
}

/**
 * Build notification message for friend activity
 */
export function buildFriendActivityMessage(activity, gapAnalysis) {
  const { username, problemsSolved, recentProblem } = activity;
  const { currentGap, trend, ahead, gotOvertaken } = gapAnalysis;
  
  let message = `🎯 ${username} solved ${problemsSolved} problem${problemsSolved > 1 ? 's' : ''}!`;
  
  if (recentProblem) {
    message += ` Latest: "${recentProblem.title}" (${recentProblem.difficulty})`;
  }
  
  // Add gap context
  if (gotOvertaken) {
    message += ` 🚀 They just passed you in the leaderboard!`;
  } else if (currentGap === 0) {
    message += ` 🤝 You're now tied!`;
  } else if (ahead) {
    message += ` You're ${currentGap} ahead.`;
  } else {
    if (trend === 'closing') {
      message += ` Gap closing! Now only ${currentGap} behind.`;
    } else if (trend === 'widening') {
      message += ` Gap widening to ${currentGap}. Time to catch up!`;
    } else {
      message += ` You're ${currentGap} behind.`;
    }
  }
  
  return message;
}

/**
 * Determine if notification should be sent
 */
export function shouldNotifyFriendActivity(activity, gapAnalysis, preferences) {
  // Don't notify if disabled
  if (!preferences.friendActivityEnabled) return false;
  
  // Always notify if overtaken
  if (gapAnalysis.gotOvertaken) return true;
  
  // Notify if gap changed significantly
  if (gapAnalysis.gapChange >= 3) return true;
  
  // Notify if friend solved multiple problems
  if (activity.problemsSolved >= 2) return true;
  
  // Notify if gap is very close
  if (gapAnalysis.currentGap <= 5) return true;
  
  // Default: notify for any activity (can be toggled by user)
  return preferences.notifyAllFriendActivity || false;
}
```

#### 2. Modified: `src/background/service-worker.js`

```javascript
// Add at top
import { 
  detectFriendActivity, 
  analyzeGapChange, 
  buildFriendActivityMessage,
  shouldNotifyFriendActivity 
} from '../shared/friend-activity-detector.js';

// Modify syncAllFriends() function
async function syncAllFriends() {
  // ... existing code ...
  
  // NEW: Load previous snapshot for comparison
  const snapshot = await chrome.storage.local.get('friends_snapshot');
  const previousFriends = snapshot.friends_snapshot || {};
  
  // NEW: Load my username for gap analysis
  const myUsernameResult = await chrome.storage.local.get('my_leetcode_username');
  const myUsername = myUsernameResult.my_leetcode_username;
  
  // NEW: Load notification preferences
  const prefs = await chrome.storage.local.get('friend_activity_preferences');
  const preferences = prefs.friend_activity_preferences || {
    friendActivityEnabled: true,
    notifyAllFriendActivity: false
  };
  
  // ... existing sync code ...
  
  // NEW: After syncing each friend
  for (const username of friendUsernames) {
    // ... existing fetch code ...
    
    if (success) {
      const currentFriend = friends[username];
      const previousFriend = previousFriends[username];
      
      // Detect activity
      const activity = detectFriendActivity(currentFriend, previousFriend);
      
      if (activity && myUsername) {
        const myData = friends[myUsername.toLowerCase()];
        
        if (myData) {
          // Analyze gap
          const previousGapSnapshot = previousFriend ? {
            gap: (previousFriend.stats?.total || 0) - (myData.stats?.total || 0)
          } : null;
          
          const gapAnalysis = analyzeGapChange(myData, currentFriend, previousGapSnapshot);
          
          // Check if should notify
          if (shouldNotifyFriendActivity(activity, gapAnalysis, preferences)) {
            const message = buildFriendActivityMessage(activity, gapAnalysis);
            
            // Send notification
            await chrome.notifications.create({
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: 'LeetStreak - Friend Activity',
              message: message,
              priority: 2,
              buttons: [
                { title: 'View Leaderboard' },
                { title: 'Solve Now' }
              ]
            });
            
            // Store in unread notifications
            await addUnreadNotification({
              type: 'friend_activity',
              username: activity.username,
              message: message,
              timestamp: Date.now()
            });
          }
        }
      }
    }
  }
  
  // NEW: Save snapshot for next comparison
  await chrome.storage.local.set({ 
    friends_snapshot: friends,
    snapshot_timestamp: Date.now()
  });
}
```

#### 3. New File: `src/popup/FriendActivitySettings.jsx`

```jsx
import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Activity } from 'lucide-react';

function FriendActivitySettings() {
  const [enabled, setEnabled] = useState(true);
  const [notifyAll, setNotifyAll] = useState(false);
  
  useEffect(() => {
    loadSettings();
  }, []);
  
  const loadSettings = async () => {
    const result = await chrome.storage.local.get('friend_activity_preferences');
    const prefs = result.friend_activity_preferences || {
      friendActivityEnabled: true,
      notifyAllFriendActivity: false
    };
    setEnabled(prefs.friendActivityEnabled);
    setNotifyAll(prefs.notifyAllFriendActivity);
  };
  
  const saveSettings = async (newEnabled, newNotifyAll) => {
    await chrome.storage.local.set({
      friend_activity_preferences: {
        friendActivityEnabled: newEnabled,
        notifyAllFriendActivity: newNotifyAll
      }
    });
  };
  
  const handleToggleEnabled = async () => {
    const newValue = !enabled;
    setEnabled(newValue);
    await saveSettings(newValue, notifyAll);
  };
  
  const handleToggleNotifyAll = async () => {
    const newValue = !notifyAll;
    setNotifyAll(newValue);
    await saveSettings(enabled, newValue);
  };
  
  return (
    <div className="p-4 bg-surface rounded-xl">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-lg">Friend Activity Notifications</h3>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-background rounded-lg">
          <div>
            <p className="font-medium">Enable Notifications</p>
            <p className="text-xs text-text-muted">Get notified when friends solve problems</p>
          </div>
          <button
            onClick={handleToggleEnabled}
            className={`p-2 rounded-full transition-colors ${
              enabled ? 'bg-primary text-white' : 'bg-gray-300 text-gray-600'
            }`}
          >
            {enabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          </button>
        </div>
        
        {enabled && (
          <div className="flex items-center justify-between p-3 bg-background rounded-lg">
            <div>
              <p className="font-medium">Notify on All Activity</p>
              <p className="text-xs text-text-muted">
                Off: Only important changes (overtaken, big gaps)
                <br />
                On: Every time a friend solves a problem
              </p>
            </div>
            <input
              type="checkbox"
              checked={notifyAll}
              onChange={handleToggleNotifyAll}
              className="w-5 h-5"
            />
          </div>
        )}
      </div>
      
      <div className="mt-4 p-3 bg-primary/10 rounded-lg border border-primary/20">
        <p className="text-xs text-text-muted">
          📊 <strong>Smart Notifications:</strong> We'll always notify you when:
          <br />• A friend passes you in the leaderboard
          <br />• The gap changes by 3+ problems
          <br />• You're within 5 problems of each other
          <br />• A friend solves 2+ problems at once
        </p>
      </div>
    </div>
  );
}

export default FriendActivitySettings;
```

### ✅ Advantages

1. **✅ No Backend Required**
   - Entirely client-side
   - No infrastructure costs
   - No additional development

2. **✅ Privacy Friendly**
   - No data leaves user's device
   - No phone numbers to store
   - No compliance concerns

3. **✅ Fast Implementation**
   - 1-2 days development
   - Uses existing systems
   - Low risk

4. **✅ Rich Notifications**
   - Can include buttons
   - Can show avatars
   - Can link to leaderboard

5. **✅ Free**
   - No SMS costs
   - No server costs
   - No scaling concerns

### ⚠️ Limitations

1. **❌ Requires Extension Open**
   - Service worker must be active
   - May miss activity if computer off

2. **❌ 30-Minute Delay**
   - Only checks every 30 minutes
   - Not truly "real-time"
   - Can reduce to 1 minute (but battery drain)

3. **❌ Browser Only**
   - No notifications on phone
   - Must be at computer
   - Mobile Chrome extension limited

4. **❌ Can Be Dismissed**
   - Easy to ignore
   - Less urgent than SMS
   - No guarantee of delivery

### 🎯 Implementation Timeline

**Day 1: Core Logic**
- ✅ Create friend-activity-detector.js
- ✅ Implement detectFriendActivity()
- ✅ Implement analyzeGapChange()
- ✅ Write unit tests

**Day 2: Integration**
- ✅ Modify service-worker.js
- ✅ Add snapshot storage
- ✅ Implement notification sending
- ✅ Add notification buttons

**Day 3: UI & Polish**
- ✅ Create FriendActivitySettings.jsx
- ✅ Add settings to options page
- ✅ Test notification display
- ✅ Handle edge cases

**Total: 2-3 days**

### 🧪 Test Cases

#### Test Case 1: Friend Solves One Problem
```javascript
Previous: { stats: { total: 50 } }
Current: { stats: { total: 51 } }
MyData: { stats: { total: 48 } }

Expected:
- Activity detected: Yes
- Gap: 3 (friend ahead)
- Trend: widening (was 2, now 3)
- Notification: "🎯 john_doe solved 1 problem! Gap widening to 3."
```

#### Test Case 2: I Get Overtaken
```javascript
Previous: { stats: { total: 50 } }
Current: { stats: { total: 53 } }
MyData: { stats: { total: 51 } }

Expected:
- Activity detected: Yes
- Gap: 2 (friend ahead)
- Trend: got_overtaken
- Notification: "🚀 john_doe just passed you in the leaderboard!"
- Priority: HIGH
```

#### Test Case 3: Friend Solves Many at Once
```javascript
Previous: { stats: { total: 50 } }
Current: { stats: { total: 55 } }
MyData: { stats: { total: 60 } }

Expected:
- Activity detected: Yes
- Problems solved: 5
- Gap: 5 (I'm ahead)
- Notification: "🎯 john_doe solved 5 problems! You're 5 ahead."
```

#### Test Case 4: No Activity
```javascript
Previous: { stats: { total: 50 } }
Current: { stats: { total: 50 } }

Expected:
- Activity detected: No
- No notification sent
```

#### Test Case 5: Gap Closing
```javascript
Previous Friend: { total: 60 }
Current Friend: { total: 61 }
Previous Me: { total: 50 }
Current Me: { total: 52 }

Expected:
- Previous gap: 10
- Current gap: 9
- Trend: closing
- Notification: "🎯 john_doe solved 1 problem! Gap closing! Now only 9 behind."
```

### 📊 Performance Considerations

**Storage Usage:**
- Snapshot: ~50KB per friend
- 10 friends = 500KB
- Negligible impact

**CPU Usage:**
- Comparison logic: <10ms
- Runs every 30 minutes
- Negligible impact

**Battery Impact:**
- Minimal (piggybacks on existing sync)
- No additional alarms needed
- No continuous polling

---

## Final Recommendations

### ✅ Feature 2 (Friend Activity): IMPLEMENT IMMEDIATELY

**Verdict: HIGHLY RECOMMENDED**

**Pros:**
- ✅ No backend needed
- ✅ No costs
- ✅ Fast implementation (2-3 days)
- ✅ Low risk
- ✅ Privacy-friendly
- ✅ Valuable feature

**Cons:**
- ⚠️ Not truly real-time (30-min delay acceptable)
- ⚠️ Requires browser open (most users have Chrome open all day)

**Implementation Plan:**
1. Day 1: Core detection logic + tests
2. Day 2: Service worker integration
3. Day 3: UI settings + polish

**Risk Level:** 🟢 LOW

---

### ⚠️ Feature 1 (SMS Alerts): CONSIDER ALTERNATIVES FIRST

**Verdict: POSSIBLE BUT NOT RECOMMENDED FOR MVP**

**Pros:**
- ✅ Very urgent/effective
- ✅ Works when computer off
- ✅ High engagement

**Cons:**
- ❌ Requires backend infrastructure
- ❌ Ongoing SMS costs ($1-13/user/month)
- ❌ Complex privacy/legal compliance
- ❌ Security risks
- ❌ 3-5 days minimum development
- ❌ Higher maintenance burden

**Alternative Recommendation:**

**Use Web Push Notifications Instead:**

1. **Browser Push API**
   - Free
   - No backend needed
   - Works even when popup closed
   - Supported on mobile Chrome
   - Can show on lock screen (mobile)

2. **Enhanced Browser Notifications**
   - Rich content (images, buttons)
   - Action buttons ("Solve Now")
   - Persistent until dismissed
   - Can play sound

3. **Progressive Web App (PWA)**
   - Install extension as PWA
   - Get mobile app-like notifications
   - Background sync capability
   - Offline support

**If SMS is ABSOLUTELY Required:**

**Phased Approach:**
1. **Phase 1:** Implement Friend Activity Notifications (Feature 2)
2. **Phase 2:** Implement Web Push Notifications
3. **Phase 3:** Collect user feedback
4. **Phase 4:** If users REALLY want SMS, implement as premium feature ($1.99/month)

**Start with:**
- Free web push for everyone
- SMS as premium add-on
- Test demand before investing heavily

---

## Summary Matrix

| Feature | Feasibility | Cost | Time | Risk | User Value | Recommendation |
|---------|-------------|------|------|------|------------|----------------|
| **Friend Activity Notifications** | 🟢 Easy | $0 | 2-3 days | Low | High | ✅ **DO IT** |
| **SMS Streak Alerts** | 🟡 Medium | $$$$ | 5-7 days | Medium-High | Medium | ⚠️ **WAIT** |
| **Web Push Notifications** | 🟢 Easy | $0 | 1-2 days | Low | High | ✅ **DO FIRST** |
| **Telegram Bot** | 🟢 Easy | $0 | 2-3 days | Low | Medium | 🟡 **ALTERNATIVE** |

---

## Next Steps

### Immediate Actions (This Week)

1. ✅ **Implement Friend Activity Notifications**
   - Use existing infrastructure
   - No costs or risks
   - High user value
   - Can ship in 2-3 days

2. ✅ **Implement Web Push Notifications**
   - Better than SMS for most use cases
   - Free and low-risk
   - Works on mobile
   - 1-2 days implementation

3. 📊 **Collect User Feedback**
   - Add survey in extension
   - Ask: "Would you pay $1.99/month for SMS alerts?"
   - Gauge demand before building

### Future Considerations (Next Month)

4. 🔍 **Research SMS Demand**
   - Analyze survey results
   - Calculate break-even point
   - Design premium tier

5. 💰 **If Demand Exists**
   - Build SMS backend (Phase 1 MVP)
   - Start with 100 beta users
   - US only initially
   - Premium tier pricing

---

## Conclusion

**Friend Activity Notifications (Feature 2):** ✅ **IMPLEMENT NOW**
- Perfect fit for current architecture
- Zero cost, low risk, high value
- Can ship in 2-3 days

**SMS Streak Alerts (Feature 1):** ⚠️ **DEFER TO FUTURE**
- Use Web Push Notifications instead
- Only add SMS if users demand it
- Implement as premium feature
- Validate demand first

**Recommended MVP Order:**
1. Friend Activity Notifications (2-3 days)
2. Web Push Notifications (1-2 days)
3. User feedback collection (ongoing)
4. SMS (only if validated)

This approach maximizes value while minimizing cost and risk. Start with free features that work well, then consider premium SMS only if there's proven demand.

---

**Document Status:** ✅ COMPLETE  
**Ready for Review:** Yes  
**Next Action:** Approve implementation of Feature 2
