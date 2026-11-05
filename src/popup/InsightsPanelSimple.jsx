import { useState, useMemo } from 'react';
import { 
  generateInsights, 
  calculateSuccessMetrics
} from '../shared/insights-generator';

export default function InsightsPanelSimple({ userData, _friendsData = [] }) {
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailInsight, setDetailInsight] = useState(null);
  const [activeTab, setActiveTab] = useState('insights');

  // Compute insights directly instead of storing in state
  const insights = useMemo(() => {
    if (!userData) return [];
    return generateInsights(userData);
  }, [userData]);
  
  if (!userData) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="text-5xl mb-3">📊</div>
          <p className="text-text-muted text-sm">No data available</p>
          <p className="text-text-muted text-xs mt-1">Add your LeetCode username to see analytics</p>
        </div>
      </div>
    );
  }
  
  const successMetrics = calculateSuccessMetrics(userData.recentSubmissions || []);
  const friendComparison = null; // friendsData.length > 0 ? compareWithFriends(userData, friendsData) : null;

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

  return (
    <div className="space-y-3">
      {/* Tab Navigation */}
      <div className="flex gap-1 bg-surface border border-surfaceHover rounded-xl p-1">
        <button
          onClick={() => setActiveTab('insights')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'insights'
              ? 'bg-primary text-white shadow-md'
              : 'text-text-muted hover:text-text-primary hover:bg-surfaceHover'
          }`}
        >
          💡 Insights
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'analytics'
              ? 'bg-primary text-white shadow-md'
              : 'text-text-muted hover:text-text-primary hover:bg-surfaceHover'
          }`}
        >
          📊 Analytics
        </button>
        <button
          onClick={() => setActiveTab('comparison')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'comparison'
              ? 'bg-primary text-white shadow-md'
              : 'text-text-muted hover:text-text-primary hover:bg-surfaceHover'
          }`}
        >
          👥 vs Friends
        </button>
      </div>
      
      {/* Insights Tab */}
      {activeTab === 'insights' && (
        <>
          {insights && insights.length > 0 ? (
            <>
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
              
              <div className="bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/20 rounded-xl p-4 text-center">
                <p className="text-xs text-text-muted mb-2">
                  💡 Insights update daily based on your solving patterns
                </p>
              </div>
            </>
          ) : (
            <div className="bg-surface border border-primary/30 rounded-xl p-8 text-center">
              <div className="text-4xl mb-4">📊</div>
              <p className="text-text-muted">No insights available yet. Keep solving!</p>
            </div>
          )}
        </>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-3">
          {successMetrics && (
            <div className="bg-surface border border-primary/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🎯</span>
                <h3 className="font-bold text-sm text-text-main">Success Rate</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-surfaceHover rounded-lg p-3">
                  <div className="text-2xl font-bold text-accent">{successMetrics.successRate}%</div>
                  <div className="text-xs text-text-muted">Overall</div>
                </div>
                <div className="bg-surfaceHover rounded-lg p-3">
                  <div className="text-2xl font-bold text-primary">{successMetrics.accepted}</div>
                  <div className="text-xs text-text-muted">Accepted</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Easy</span>
                  <span className="font-semibold text-leetcode-easy">
                    {successMetrics.byDifficulty.easy.total > 0 
                      ? `${((successMetrics.byDifficulty.easy.accepted / successMetrics.byDifficulty.easy.total) * 100).toFixed(0)}%` 
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Medium</span>
                  <span className="font-semibold text-leetcode-medium">
                    {successMetrics.byDifficulty.medium.total > 0 
                      ? `${((successMetrics.byDifficulty.medium.accepted / successMetrics.byDifficulty.medium.total) * 100).toFixed(0)}%` 
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Hard</span>
                  <span className="font-semibold text-leetcode-hard">
                    {successMetrics.byDifficulty.hard.total > 0 
                      ? `${((successMetrics.byDifficulty.hard.accepted / successMetrics.byDifficulty.hard.total) * 100).toFixed(0)}%` 
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comparison Tab */}
      {activeTab === 'comparison' && (
        <div className="space-y-3">
          {friendComparison ? (
            <div className="bg-surface border border-primary/30 rounded-xl p-4">
              <h3 className="font-bold text-sm mb-4">Comparison with Friends</h3>
              <p className="text-xs text-text-muted">{friendComparison.message}</p>
            </div>
          ) : (
            <div className="bg-surface border border-primary/30 rounded-xl p-8 text-center">
              <div className="text-4xl mb-4">👥</div>
              <p className="text-text-muted text-sm">Add friends to see comparisons</p>
            </div>
          )}
        </div>
      )}
      
      {/* Detail Modal */}
      {showDetailModal && detailInsight && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowDetailModal(false)}
        >
          <div 
            className="bg-surface border border-primary/30 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-bounce-in"
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

            {detailInsight.type === 'suggestion' && (
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-primary mb-2">💡 Tips</h4>
                <ul className="text-xs text-text-muted space-y-1">
                  <li>• Set a daily practice goal</li>
                  <li>• Use the problem queue</li>
                  <li>• Review your solutions</li>
                </ul>
              </div>
            )}

            {detailInsight.type === 'achievement' && (
              <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-semibold text-accent mb-2">🎉 Great Work!</h4>
                <p className="text-xs text-text-muted">
                  Keep this momentum! Consistency is key.
                </p>
              </div>
            )}
            
            <button
              onClick={() => setShowDetailModal(false)}
              className="w-full py-3 bg-primary hover:bg-primaryHover text-inverted rounded-xl font-semibold transition-colors"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
