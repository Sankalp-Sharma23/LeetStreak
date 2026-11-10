import { useState, useEffect, useMemo, useRef } from 'react';
import { PartyPopper, Sparkles, Star, Zap } from 'lucide-react';
import { getDailyChallenge, getChallengeProgress, updateChallengeProgress } from '../shared/daily-challenge';

// Generate confetti configuration outside component to avoid impure function calls during render
const generateConfettiIcons = () => {
  const icons = [PartyPopper, Sparkles, Star, Zap, Star];
  return [...Array(30)].map((_, i) => ({
    id: i,
    Icon: icons[Math.floor(Math.random() * icons.length)],
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 2 + Math.random() * 2
  }));
};

export default function DailyChallengeCard({ userStats }) {
  const [challenge, setChallenge] = useState(null);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const completedRef = useRef(false);

  // Generate confetti data once to avoid re-rendering issues
  const confettiIcons = useMemo(() => generateConfettiIcons(), []);

  useEffect(() => {
    let active = true;
    const loadChallenge = async () => {
      try {
        const dailyChallenge = await getDailyChallenge(userStats);
        const { progress: currentProgress, completed: isCompleted } = await getChallengeProgress();
        if (!active) return;
        completedRef.current = isCompleted;
        setChallenge(dailyChallenge);
        setProgress(currentProgress);
        setCompleted(isCompleted);
      } catch (error) {
        console.error('Could not load daily challenge:', error);
      }
    };
    if (userStats) loadChallenge();
    return () => { active = false; };
  }, [userStats]);

  useEffect(() => {
    let active = true;
    const updateProgress = async () => {
      try {
        const { progress: newProgress, completed: isCompleted } = await updateChallengeProgress(userStats);
        if (!active) return;
        if (isCompleted && !completedRef.current) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 3000);
        }
        completedRef.current = isCompleted;
        setProgress(newProgress);
        setCompleted(isCompleted);
      } catch (error) {
        console.error('Could not update daily challenge progress:', error);
      }
    };
    if (userStats && challenge) updateProgress();
    return () => { active = false; };
  }, [userStats, challenge]);

  async function resetChallenge() {
    try {
      await chrome.storage.local.set({
        previousStats: userStats,
        challengeProgress: 0,
        challengeCompleted: false
      });
      setProgress(0);
      completedRef.current = false;
      setCompleted(false);
    } catch (error) {
      console.error('Error resetting challenge:', error);
    }
  }

  if (!challenge) return null;

  const progressPercent = Math.min((progress / challenge.target) * 100, 100);

  return (
    <div className="bg-surface border border-primary/30 rounded-xl p-6 shadow-lg relative overflow-hidden">
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none z-10">
          {confettiIcons.map((confetti) => {
            const Icon = confetti.Icon;
            return (
              <div
                key={confetti.id}
                className="absolute animate-confetti"
                style={{
                  left: `${confetti.left}%`,
                  animationDelay: `${confetti.delay}s`,
                  animationDuration: `${confetti.duration}s`
                }}
              >
                <Icon className="w-6 h-6 text-primary" />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-3xl">{challenge.icon}</span>
            <h3 className="text-xl font-bold text-text-primary">{challenge.title}</h3>
          </div>
          <p className="text-text-muted">{challenge.description}</p>
        </div>
        {completed && (
          <div className="flex items-center gap-1 bg-accent/20 text-accent px-3 py-1 rounded-full animate-bounce-in">
            <span className="text-xl">✓</span>
            <span className="font-semibold">Done!</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">Progress</span>
          <span className="font-semibold text-text-primary">
            {progress} / {challenge.target}
          </span>
        </div>
        <div className="h-3 bg-surfaceHover rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              completed ? 'bg-accent' : 'bg-primary'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {completed && (
        <div className="mt-4 text-center">
          <div className="text-sm text-accent font-medium mb-2">
            🎊 Challenge completed! Come back tomorrow for a new one!
          </div>
          <button
            onClick={resetChallenge}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Reset progress
          </button>
        </div>
      )}

      {!completed && progressPercent > 0 && (
        <div className="mt-4 text-center text-sm text-text-muted">
          Keep going! You're {progressPercent.toFixed(0)}% there!
        </div>
      )}

      {!completed && progressPercent === 0 && (
        <div className="mt-4 text-center">
          <div className="text-xs text-text-muted">
            Start solving to make progress!
          </div>
        </div>
      )}
    </div>
  );
}
