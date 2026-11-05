import { useState, useEffect } from 'react';
import { 
  generateInsights
} from '../shared/insights-generator';

export default function InsightsPanel({ userData, _friendsData = [] }) {
  const [insights, setInsights] = useState([]);
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailInsight, setDetailInsight] = useState(null);
  const [weekAgo] = useState(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)); // Lazy initial state

  useEffect(() => {
    if (userData) {
      const generatedInsights = generateInsights(userData);
      setInsights(generatedInsights); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [userData]);

  const handleViewDetails = (insight, e) => {
    e.stopPropagation();
    setDetailInsight(insight);
    setShowDetailModal(true);
  };

  const handleShare = async (insight, e) => {
    e.stopPropagation();
    const shareText = `🎯 My LeetCode Insight:\n\n${insight.icon} ${insight.category}\n${insight.message}\n\n#LeetCode #CodingJourney`;
    
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareText);
        alert('✓ Insight copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  };

  if (!insights || insights.length === 0) {
    return (
      <div className="bg-surface border border-primary/30 rounded-xl p-8 text-center">
        <div className="text-4xl mb-4">📊</div>
        <p className="text-text-muted">No insights available yet. Keep solving!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {insights.map((insight, index) => (
        <div
          key={index}
          className={`
            bg-surface border rounded-xl p-4 transition-all duration-300 cursor-pointer
            ${insight.type === 'achievement' ? 'border-accent/40 hover:border-accent/60' : ''}
            ${insight.type === 'neutral' ? 'border-primary/30 hover:border-primary/50' : ''}
            ${insight.type === 'suggestion' ? 'border-leetcode-medium/30 hover:border-leetcode-medium/50' : ''}
            ${selectedInsight === index ? 'ring-2 ring-primary/50 scale-[1.02]' : 'hover:scale-[1.01]'}
          `}
          onClick={() => setSelectedInsight(selectedInsight === index ? null : index)}
        >
          <div className="flex items-start gap-3">
            <div className="text-3xl">{insight.icon}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  {insight.category}
                </span>
                {insight.type === 'achievement' && (
                  <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                    Achievement
                  </span>
                )}
                {insight.type === 'suggestion' && (
                  <span className="text-xs bg-leetcode-medium/20 text-leetcode-medium px-2 py-0.5 rounded-full">
                    Tip
                  </span>
                )}
              </div>
              <p className="text-sm text-text-primary leading-relaxed">
                {insight.message}
              </p>
            </div>
            <div className={`
              text-text-muted transition-transform
              ${selectedInsight === index ? 'rotate-180' : ''}
            `}>
              ▼
            </div>
          </div>
          
          {selectedInsight === index && (
            <div className="mt-4 pt-4 border-t border-surfaceHover animate-slide-up">
              <div className="flex gap-2">
                <button 
                  onClick={(e) => handleViewDetails(insight, e)}
                  className="flex-1 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-semibold transition-colors"
                >
                  View Details
                </button>
                <button 
                  onClick={(e) => handleShare(insight, e)}
                  className="flex-1 py-2 bg-accent/10 hover:bg-accent/20 text-accent rounded-lg text-xs font-semibold transition-colors"
                >
                  Share
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      
      {/* Detail Modal */}
      {showDetailModal && detailInsight && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto scrollbar-hide"
          onClick={() => setShowDetailModal(false)}
        >
          <div 
            className="bg-surface border border-primary/30 rounded-2xl p-6 max-w-2xl w-full shadow-2xl animate-bounce-in my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="text-4xl">{detailInsight.icon}</div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-text-primary mb-1">
                  {detailInsight.category}
                </h3>
                {detailInsight.type === 'achievement' && (
                  <span className="text-xs bg-accent/20 text-accent px-2 py-1 rounded-full">
                    🏆 Achievement
                  </span>
                )}
                {detailInsight.type === 'suggestion' && (
                  <span className="text-xs bg-leetcode-medium/20 text-leetcode-medium px-2 py-1 rounded-full">
                    💡 Tip
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-text-muted hover:text-text-primary transition-colors text-xl"
              >
                ✕
              </button>
            </div>
            
            <div className="bg-surfaceHover rounded-xl p-4 mb-4">
              <p className="text-sm text-text-primary leading-relaxed">
                {detailInsight.message}
              </p>
            </div>

            {/* Performance Metrics Based on Insight Type */}
            {detailInsight.category === 'Difficulty Preference' && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-leetcode-easy/10 border border-leetcode-easy/20 rounded-lg p-3">
                  <div className="text-xs text-text-muted mb-1">Easy</div>
                  <div className="text-xl font-bold text-leetcode-easy">{userData?.stats?.easy || 0}</div>
                  <div className="text-[10px] text-text-muted mt-1">{((userData?.stats?.easy || 0) / (userData?.stats?.total || 1) * 100).toFixed(0)}% of total</div>
                </div>
                <div className="bg-leetcode-medium/10 border border-leetcode-medium/20 rounded-lg p-3">
                  <div className="text-xs text-text-muted mb-1">Medium</div>
                  <div className="text-xl font-bold text-leetcode-medium">{userData?.stats?.medium || 0}</div>
                  <div className="text-[10px] text-text-muted mt-1">{((userData?.stats?.medium || 0) / (userData?.stats?.total || 1) * 100).toFixed(0)}% of total</div>
                </div>
                <div className="bg-leetcode-hard/10 border border-leetcode-hard/20 rounded-lg p-3">
                  <div className="text-xs text-text-muted mb-1">Hard</div>
                  <div className="text-xl font-bold text-leetcode-hard">{userData?.stats?.hard || 0}</div>
                  <div className="text-[10px] text-text-muted mt-1">{((userData?.stats?.hard || 0) / (userData?.stats?.total || 1) * 100).toFixed(0)}% of total</div>
                </div>
              </div>
            )}

            {detailInsight.category === 'Weekly Consistency' && (
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-primary mb-3">📊 Weekly Breakdown</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Target: 5+ days/week</span>
                    <span className="text-xs font-bold text-primary">Current: Check your calendar</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Streak: {userData?.stats?.streak || 0} days</span>
                    <span className="text-xs font-bold text-accent">🔥 Keep it going!</span>
                  </div>
                </div>
              </div>
            )}

            {detailInsight.category === 'Best Solving Days' && (
              <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-accent mb-3">📅 Optimize Your Schedule</h4>
                <p className="text-xs text-text-muted mb-3">
                  You're most productive at a certain time. Block this time for deep work and problem-solving practice.
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].slice(0, 7).map((day, idx) => (
                    <div key={idx} className="bg-surface rounded p-2 text-center border border-surfaceHover">
                      <div className="text-[10px] font-semibold text-text-muted">{day}</div>
                      <div className="text-xs mt-1 h-6 flex items-center justify-center">
                        {idx === new Date().getDay() ? '●' : '○'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailInsight.category === 'Recent Activity' && (
              <div className="bg-leetcode-medium/10 border border-leetcode-medium/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-leetcode-medium mb-3">🎯 Recent Submissions</h4>
                {userData?.recentSubmissions && userData.recentSubmissions.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Last 7 days:</span>
                      <span className="font-bold">{userData.recentSubmissions.filter(sub => {
                        const subDate = new Date(sub.timestamp * 1000);
                        return subDate > weekAgo;
                      }).length} submissions</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">Acceptance rate:</span>
                      <span className="font-bold">{((userData.recentSubmissions.filter(s => s.statusDisplay === 'Accepted').length / userData.recentSubmissions.length) * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">No recent activity yet</p>
                )}
              </div>
            )}

            {detailInsight.category === 'Achievement Level' && (
              <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-accent mb-3">🎖️ Progress Metrics</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Total Solved:</span>
                    <span className="text-sm font-bold text-accent">{userData?.stats?.total || 0}</span>
                  </div>
                  <div className="w-full bg-surfaceHover rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-accent to-primary h-full transition-all"
                      style={{width: `${Math.min(((userData?.stats?.total || 0) / 1000) * 100, 100)}%`}}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-text-muted">
                    <span>0</span>
                    <span>1000 (Master)</span>
                  </div>
                </div>
              </div>
            )}

            {/* General Tips */}
            {detailInsight.type === 'suggestion' && (
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-primary mb-2">💡 Actionable Tips</h4>
                <ul className="text-xs text-text-muted space-y-1.5">
                  <li className="flex gap-2">
                    <span>✓</span>
                    <span>Set a daily goal: Complete at least 1 problem every day</span>
                  </li>
                  <li className="flex gap-2">
                    <span>✓</span>
                    <span>Use the problem queue to track what to solve next</span>
                  </li>
                  <li className="flex gap-2">
                    <span>✓</span>
                    <span>Review solutions before moving to the next problem</span>
                  </li>
                </ul>
              </div>
            )}

            {detailInsight.type === 'achievement' && (
              <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-accent mb-2">🎉 Next Steps</h4>
                <ul className="text-xs text-text-muted space-y-1.5">
                  <li className="flex gap-2">
                    <span>→</span>
                    <span>Maintain this momentum and consistency</span>
                  </li>
                  <li className="flex gap-2">
                    <span>→</span>
                    <span>Challenge yourself with harder problems</span>
                  </li>
                  <li className="flex gap-2">
                    <span>→</span>
                    <span>Share your progress with friends for motivation</span>
                  </li>
                </ul>
              </div>
            )}
            
            <button
              onClick={() => setShowDetailModal(false)}
              className="w-full py-3 bg-primary hover:bg-primaryHover text-inverted rounded-xl font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
      
      <div className="bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/20 rounded-xl p-4 text-center">
        <p className="text-xs text-text-muted mb-2">
          💡 Insights update daily based on your solving patterns
        </p>
        <button className="text-xs text-primary hover:text-primaryHover font-semibold transition-colors">
          Learn how insights work →
        </button>
      </div>
    </div>
  );
}
