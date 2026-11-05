import React, { useState, useEffect } from 'react';

function ProblemQueue() {
  const [problems, setProblems] = useState([]);
  const [newProblem, setNewProblem] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success'); // 'success' or 'error'

  // Check if problems are already submitted and mark as completed
  const checkAndUpdateCompletedProblems = async (problemsList) => {
    try {
      console.log('checkAndUpdateCompletedProblems called with:', problemsList?.length, 'problems');
      
      // Get user's LeetCode username and friends_data directly
      const storageResult = await chrome.storage.local.get(['my_leetcode_username', 'friends_data']);
      const { my_leetcode_username } = storageResult;
      const friendsData = storageResult.friends_data || {};
      
      console.log('Username:', my_leetcode_username, 'Problems count:', problemsList?.length);
      
      if (!my_leetcode_username || !problemsList || problemsList.length === 0) {
        console.log('Missing username or problems list, skipping check');
        return;
      }

      // Try both the exact username and lowercase version
      let myData = friendsData[my_leetcode_username] || friendsData[my_leetcode_username.toLowerCase()];
      
      if (!myData) {
        // Try fetching stats if local data isn't available
        console.log('No user data in friends_data, fetching stats...');
        const response = await chrome.runtime.sendMessage({
          type: 'FETCH_STATS',
          forceRefresh: true
        });

        if (!response.success || !response.friends) {
          console.log('Failed to fetch stats or no friends data');
          return;
        }

        // Try both exact and lowercase
        myData = response.friends[my_leetcode_username] || response.friends[my_leetcode_username.toLowerCase()];
        console.log('After fetch, found data:', !!myData, 'Looking for:', my_leetcode_username, 'Available keys:', Object.keys(response.friends || {}));
        
        if (!myData) {
          console.log('User data not found even after fetch');
          return;
        }
      }
      
      console.log('Got user data, checking submissions...');
      
      // Create a set of accepted problem slugs from multiple sources
      const acceptedSlugs = new Set();
      
      // Check recentSubmissions (at root level)
      const recentSubmissions = myData?.recentSubmissions || [];
      console.log(`Found ${recentSubmissions.length} recent submissions`);
      recentSubmissions.forEach(sub => {
        if (sub.statusDisplay === 'Accepted') {
          if (sub.titleSlug) acceptedSlugs.add(sub.titleSlug);
          if (sub.slug) acceptedSlugs.add(sub.slug);
        }
      });

      // Also check ALL accepted submissions (covers old submissions from >15 problems ago)
      const allAccepted = myData?.allAcceptedSubmissions || [];
      console.log(`Found ${allAccepted.length} all-time accepted submissions`);
      allAccepted.forEach(sub => {
        if (sub.titleSlug) acceptedSlugs.add(sub.titleSlug);
        if (sub.slug) acceptedSlugs.add(sub.slug);
      });

      console.log('All accepted slugs:', Array.from(acceptedSlugs));

      // Update problems that are already completed
      const updatedProblems = problemsList.map(problem => {
        // Try multiple slug variations
        const slugVariations = [
          problem.slug,
          problem.url ? extractSlug(problem.url) : null,
          extractSlug(problem.title),
          String(problem.id)
        ].filter(Boolean);
        
        console.log(`Problem "${problem.title}" - variations:`, slugVariations);
        
        // Check if any slug variation matches an accepted slug
        const isCompleted = slugVariations.some(slug => acceptedSlugs.has(slug));
        
        if (isCompleted && problem.status !== 'completed') {
          console.log(`✅ Marking "${problem.title}" as completed`);
          return { ...problem, status: 'completed' };
        }
        return problem;
      });

      // Save if any changes
      const hasChanges = updatedProblems.some((p, idx) => p.status !== problemsList[idx]?.status);
      if (hasChanges) {
        console.log('Saving updated queue with completed statuses');
        await chrome.storage.local.set({ problem_queue: updatedProblems });
        setProblems(updatedProblems);
      } else {
        console.log('No changes to queue needed');
      }
    } catch (error) {
      console.error('Error checking completed problems:', error);
    }
  };

  const loadProblems = async () => {
    try {
      const result = await chrome.storage.local.get('problem_queue');
      const rawProblems = result.problem_queue || [];
      
      // Normalize problems: ensure all have an id field (generate ID once, not in render)
      const normalizedProblems = rawProblems.map((problem, index) => {
        // If no id, use slug as id, or generate one
        if (!problem.id) {
          problem.id = problem.slug || `problem-${Date.now()}-${index}`;
        }
        return problem;
      });
      
      // Save normalized problems back if any were normalized
      if (rawProblems.some(p => !p.id)) {
        await chrome.storage.local.set({ problem_queue: normalizedProblems });
      }
      
      setProblems(normalizedProblems);
      
      // Check and update completed problems after loading
      checkAndUpdateCompletedProblems(normalizedProblems);
    } catch (error) {
      console.error('Error loading problems:', error);
    }
  };

  useEffect(() => {
    loadProblems();
    
    // Listen for changes to problem_queue (e.g., when added from LeetCode site)
    const handleStorageChange = (changes, areaName) => {
      if (areaName === 'local' && changes.problem_queue) {
        loadProblems();
      }
    };
    
    chrome.storage.onChanged.addListener(handleStorageChange);
    
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProblems = async (updatedProblems) => {
    try {
      await chrome.storage.local.set({ problem_queue: updatedProblems });
      setProblems(updatedProblems);
    } catch (error) {
      console.error('Error saving problems:', error);
    }
  };

  const addProblem = async () => {
    if (!newProblem.trim()) return;

    const slug = extractSlug(newProblem.trim());
    const url = extractLeetCodeUrl(newProblem.trim());
    
    // Check for duplicates by slug
    const exists = problems.some(p => {
      const existingSlug = p.slug || extractSlug(p.url || '');
      return existingSlug === slug;
    });
    
    if (exists) {
      setToastType('error');
      setToastMessage('⚠️ Already in queue!');
      setTimeout(() => setToastMessage(''), 3000);
      return;
    }

    // Check if already submitted
    let status = 'pending';
    try {
      const { my_leetcode_username } = await chrome.storage.local.get('my_leetcode_username');
      if (my_leetcode_username) {
        const response = await chrome.runtime.sendMessage({
          type: 'FETCH_STATS',
          forceRefresh: false
        });
        if (response.success && response.friends && response.friends[my_leetcode_username]) {
          const myData = response.friends[my_leetcode_username];
          const recentSubmissions = myData?.profile?.recentSubmissions || [];
          const isCompleted = recentSubmissions.some(
            sub => sub.titleSlug === slug && sub.statusDisplay === 'Accepted'
          );
          if (isCompleted) {
            status = 'completed';
          }
        }
      }
    } catch (error) {
      console.error('Error checking submission status:', error);
    }

    const problem = {
      id: slug || Date.now(), // Use slug as id for consistency
      title: newProblem.trim(),
      slug: slug,
      url: url,
      addedAt: Date.now(),
      status: status, // pending, in-progress, completed
      difficulty: 'Medium'
    };
    saveProblems([...problems, problem]);
    setNewProblem('');
    setShowInput(false);
    
    setToastType('success');
    setToastMessage(status === 'completed' ? 'Added! (Already Completed ✓)' : 'Added to Queue! ✅');
    setTimeout(() => setToastMessage(''), 3000);
  };

  const updateStatus = (identifier, newStatus) => {
    const updated = problems.map(p => {
      // Match by id or slug
      const matches = p.id === identifier || p.slug === identifier;
      return matches ? { ...p, status: newStatus } : p;
    });
    saveProblems(updated);
  };

  const extractSlug = (text) => {
    // Extract slug from URL if it's a URL
    if (text.includes('leetcode.com/problems/')) {
      const match = text.match(/problems\/([^/]+)/);
      return match ? match[1] : text;
    }
    // Convert text to slug - remove problem number prefix (e.g., "1. Two Sum" -> "two-sum")
    const slug = text.toLowerCase()
      .replace(/^\d+\.\s+/, '') // Remove leading number and dot
      .replace(/[^\w\s-]/g, '')  // Remove special characters
      .replace(/\s+/g, '-');     // Replace spaces with hyphens
    return slug;
  };

  const removeProblem = (identifier) => {
    // Remove by id or slug
    saveProblems(problems.filter(p => p.id !== identifier && p.slug !== identifier));
  };

  const extractLeetCodeUrl = (text) => {
    // Check if input is already a URL
    if (text.startsWith('http')) {
      return text;
    }
    
    // Try to extract problem slug from text
    const slug = text.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    
    return `https://leetcode.com/problems/${slug}/`;
  };

  const openProblem = (url) => {
    chrome.tabs.create({ url });
  };

  return (
    <div className="bg-surface rounded-3xl shadow-xl p-6 border border-surfaceHover transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">📝</span>
          <div>
            <h3 className="font-bold text-xs text-text-main">Problem Queue</h3>
            <p className="text-[9px] text-text-muted">Save problems to solve later</p>
          </div>
        </div>
        <button
          onClick={() => setShowInput(!showInput)}
          className="px-2.5 py-1 text-[10px] font-semibold bg-primary text-white rounded-md hover:bg-primaryHover transition-all active:scale-95"
        >
          {showInput ? '✕' : '+ Add'}
        </button>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className={`mb-3 p-2 border rounded-lg animate-fade-in flex items-center justify-center ${
          toastType === 'success' 
            ? 'bg-green-500/10 border-green-500/30 text-green-400' 
            : 'bg-orange-500/10 border-orange-500/30 text-orange-400'
        }`}>
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Add Problem Input */}
      {showInput && (
        <div className="mb-3 p-2.5 bg-background/50 rounded-lg border border-surfaceHover">
          <input
            type="text"
            value={newProblem}
            onChange={(e) => setNewProblem(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addProblem()}
            placeholder="Problem name or URL..."
            className="w-full px-2.5 py-1.5 text-[10px] bg-surface border border-surfaceHover rounded-md focus:outline-none focus:border-primary text-text-main placeholder-text-muted mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={addProblem}
              className="flex-1 py-1.5 text-[10px] font-semibold bg-primary text-white rounded-md hover:bg-primaryHover transition-all"
            >
              Add to Queue
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowInput(false);
                setNewProblem('');
              }}
              className="px-3 py-1.5 text-[10px] font-semibold text-text-muted hover:text-text-main bg-surface hover:bg-surfaceHover rounded-md transition-all active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Problem List */}
      {problems.length === 0 ? (
        <div className="text-center py-4 text-text-muted">
          <span className="text-2xl mb-1 block">📋</span>
          <p className="text-[10px]">No problems saved yet</p>
          <p className="text-[9px] mt-0.5">Visit LeetCode problems and click "Add to Queue"</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-hide">
          {problems.map((problem) => {
            const difficultyColors = {
              Easy: 'text-leetcode-easy',
              Medium: 'text-leetcode-medium',
              Hard: 'text-leetcode-hard'
            };
            const statusIcons = {
              pending: '⏳',
              'in-progress': '🚀',
              completed: '✅'
            };
            
            const isCompleted = problem.status === 'completed';
            
            return (
              <div
                key={problem.id}
                className={`flex items-center gap-2 p-2 rounded-lg border transition-all group ${
                  isCompleted 
                    ? 'bg-green-500/5 border-green-500/20 hover:border-green-500/40' 
                    : 'bg-background/50 border-surfaceHover hover:border-primary/40'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px]">{statusIcons[problem.status] || '📋'}</span>
                    <div className={`text-[10px] font-semibold truncate group-hover:text-primary transition-colors ${
                      isCompleted ? 'text-green-400' : 'text-text-main'
                    }`}>
                      {problem.title}
                    </div>
                    {isCompleted && (
                      <span className="ml-auto flex-shrink-0 px-1.5 py-0.5 text-[8px] font-bold bg-green-500/20 text-green-400 rounded-full border border-green-500/30 whitespace-nowrap">
                        ✓ Submitted
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[8px] text-text-muted">
                    <span className={`font-semibold ${difficultyColors[problem.difficulty] || 'text-text-muted'}`}>
                      {problem.difficulty}
                    </span>
                    {problem.number && <span>#{problem.number}</span>}
                    <span>•</span>
                    <span>Added {new Date(problem.addedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {problem.status !== 'completed' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateStatus(problem.id, 
                          problem.status === 'pending' ? 'in-progress' : 'completed');
                      }}
                      className="px-2 py-1 text-[9px] font-semibold text-accent hover:text-accent bg-accent/10 hover:bg-accent/20 rounded transition-all active:scale-95"
                      title={problem.status === 'pending' ? 'Start' : 'Complete'}
                    >
                      {problem.status === 'pending' ? '▶' : '✓'}
                    </button>
                  )}
                  <button
                    onClick={() => openProblem(problem.url)}
                    className="px-2 py-1 text-[9px] font-semibold text-primary hover:text-primaryHover bg-primary/10 hover:bg-primary/20 rounded transition-all whitespace-nowrap"
                    title="Open problem"
                  >
                    Open
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProblem(problem.id);
                    }}
                    className="px-1.5 py-1 text-[9px] font-semibold text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 rounded transition-all active:scale-95"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {problems.length > 0 && (
        <div className="mt-2 pt-2 border-t border-surfaceHover">
          <div className="flex justify-between items-center text-[9px] text-text-muted">
            <span>{problems.length} problem{problems.length !== 1 ? 's' : ''} in queue</span>
            <div className="flex gap-2">
              <span>⏳ {problems.filter(p => p.status === 'pending').length}</span>
              <span>🚀 {problems.filter(p => p.status === 'in-progress').length}</span>
              <span>✅ {problems.filter(p => p.status === 'completed').length}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProblemQueue;
