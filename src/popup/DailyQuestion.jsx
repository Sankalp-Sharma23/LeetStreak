import React, { useState, useEffect } from 'react';
import { getDailyQuestion } from '../background/leetcode-api';
import { Zap } from 'lucide-react';

function DailyQuestion() {
  const [question, setQuestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let mounted = true;
    getDailyQuestion().then(dailyQuestion => {
      if (mounted) {
        setQuestion(dailyQuestion);
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  const getDifficultyConfig = (difficulty) => {
    switch (difficulty?.toLowerCase()) {
      case 'easy':
        return {
          color: 'text-leetcode-easy',
          bgLight: 'bg-leetcode-easy/10',
          border: 'border-leetcode-easy/30',
          badgeColor: 'text-leetcode-easy bg-leetcode-easy/10 border-leetcode-easy/20',
          icon: '🟢'
        };
      case 'medium':
        return {
          color: 'text-leetcode-medium',
          bgLight: 'bg-leetcode-medium/10',
          border: 'border-leetcode-medium/30',
          badgeColor: 'text-leetcode-medium bg-leetcode-medium/10 border-leetcode-medium/20',
          icon: '🟡'
        };
      case 'hard':
        return {
          color: 'text-leetcode-hard',
          bgLight: 'bg-leetcode-hard/10',
          border: 'border-leetcode-hard/30',
          badgeColor: 'text-leetcode-hard bg-leetcode-hard/10 border-leetcode-hard/20',
          icon: '🔴'
        };
      default:
        return {
          color: 'text-primary',
          bgLight: 'bg-primary/5',
          border: 'border-primary/20',
          badgeColor: 'text-primary bg-primary/10 border-primary/20',
          icon: '❓'
        };
    }
  };

  const openQuestion = () => {
    if (question?.link) {
      chrome.tabs.create({ url: question.link });
    }
  };

  const difficultyConfig = question ? getDifficultyConfig(question.difficulty) : null;

  if (loading) {
    return (
      <div className={`bg-gradient-to-r from-primary/5 to-accent/5 p-5 rounded-2xl border border-primary/20 shadow-lg`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-primary/20 rounded-xl">
            <span className="text-lg">✨</span>
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-sm text-text-primary">Today's Challenge</h3>
            <p className="text-[10px] text-text-muted">Fetching your daily problem...</p>
          </div>
        </div>
        <div className="relative w-full h-2 bg-surfaceHover rounded-full overflow-hidden">
          <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary via-accent to-primary rounded-full" style={{
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            width: '40%'
          }}></div>
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="bg-gradient-to-br from-background to-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-lg">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 bg-orange-500/10 rounded-xl">
            <span className="text-lg">⚠️</span>
          </div>
          <div>
            <h3 className="font-bold text-sm text-text-primary">Unable to Load</h3>
            <p className="text-[10px] text-text-muted">Daily question unavailable</p>
          </div>
        </div>
        <p className="text-xs text-text-muted text-center py-3">
          Check back later or try refreshing the extension
        </p>
        <button
          onClick={() => {
            setLoading(true);
            getDailyQuestion().then(q => {
              setQuestion(q);
              setLoading(false);
            });
          }}
          className="w-full mt-2 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-xs font-semibold transition-colors"
        >
          🔄 Try Again
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-r ${difficultyConfig.bgLight} to-accent/5 rounded-2xl border ${difficultyConfig.border} shadow-lg transition-all duration-300 overflow-hidden`}>
      {/* Header */}
      <div className="p-4 border-b border-current border-opacity-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className={`p-2.5 ${difficultyConfig.bgLight} rounded-xl`}>
              <Zap className={`w-4 h-4 ${difficultyConfig.color}`} />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-sm text-text-primary">Today's Challenge</h3>
              <p className="text-[9px] text-text-muted">
                {new Date(question.date).toLocaleDateString('en-US', { 
                  weekday: 'short',
                  month: 'short', 
                  day: 'numeric'
                })}
              </p>
            </div>
          </div>
          <span className={`px-3 py-1.5 rounded-full text-[10px] font-bold border ${difficultyConfig.badgeColor}`}>
            {difficultyConfig.icon} {question.difficulty}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left group transition-all duration-200"
        >
          <div className="flex items-start gap-2.5 mb-3">
            <span className={`font-bold text-xs mt-0.5 px-2 py-1 rounded-lg ${difficultyConfig.bgLight} ${difficultyConfig.color}`}>
              #{question.questionId}
            </span>
            <div className="flex-1">
              <h4 className="font-bold text-sm text-text-primary group-hover:text-primary transition-colors leading-snug">
                {question.title}
              </h4>
            </div>
            <div className={`text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}>
              ▼
            </div>
          </div>

          {/* Topics - Always Visible */}
          {question.topics && question.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {question.topics.slice(0, 3).map((topic, idx) => (
                <span
                  key={idx}
                  className={`px-2 py-1 text-[9px] font-semibold rounded-lg border transition-colors ${
                    expanded ? difficultyConfig.bgLight : 'bg-primary/10'
                  } border-current border-opacity-20`}
                >
                  {topic}
                </span>
              ))}
              {question.topics.length > 3 && (
                <span className="px-2 py-1 text-[9px] font-medium text-text-muted bg-surfaceHover rounded-lg">
                  +{question.topics.length - 3}
                </span>
              )}
            </div>
          )}
        </button>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-current border-opacity-10 space-y-3 animate-slide-up">
            {/* Stats Card */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-background/40 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-text-primary mb-1">👍</div>
                <p className="text-xs text-text-muted">Helpful</p>
                <p className="text-sm font-bold text-primary mt-1">{(question.likes / 1000).toFixed(1)}K</p>
              </div>
              <div className="bg-background/40 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-text-primary mb-1">👎</div>
                <p className="text-xs text-text-muted">Unhelpful</p>
                <p className="text-sm font-bold text-accent mt-1">{question.dislikes?.toLocaleString() || 0}</p>
              </div>
            </div>

            {/* Difficulty Info */}
            <div className={`${difficultyConfig.bgLight} rounded-lg p-3 border ${difficultyConfig.border}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold">📊 Difficulty Details</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">Level</span>
                  <span className={`font-bold ${difficultyConfig.color}`}>{question.difficulty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Acceptance Rate</span>
                  <span className="font-bold text-text-primary">~{Math.round((question.likes / (question.likes + question.dislikes)) * 100)}%</span>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={openQuestion}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
                difficultyConfig.color === 'text-leetcode-easy' 
                  ? 'bg-leetcode-easy/20 text-leetcode-easy hover:bg-leetcode-easy/30' 
                  : difficultyConfig.color === 'text-leetcode-medium'
                  ? 'bg-leetcode-medium/20 text-leetcode-medium hover:bg-leetcode-medium/30'
                  : difficultyConfig.color === 'text-leetcode-hard'
                  ? 'bg-leetcode-hard/20 text-leetcode-hard hover:bg-leetcode-hard/30'
                  : 'bg-primary/20 text-primary hover:bg-primary/30'
              }`}
            >
              🚀 Solve Now
            </button>
          </div>
        )}

        {/* Collapsed Summary */}
        {!expanded && (
          <div className="flex items-center justify-between text-[10px] text-text-muted pt-1">
            <div className="flex items-center gap-3">
              <span className="font-semibold">👍 {(question.likes / 1000).toFixed(1)}K</span>
              <span className="text-text-muted/50">•</span>
              <span className="font-semibold">{question.topics?.length || 0} topics</span>
            </div>
            <span className="text-primary font-bold group-hover:translate-x-1 transition-transform flex items-center gap-1">
              View → 
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default DailyQuestion;
