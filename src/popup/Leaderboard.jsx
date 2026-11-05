import React, { useState } from 'react';
import FriendCard from './FriendCard';
import { Trophy, Flame, Award } from 'lucide-react';
import { sortFriends } from '../shared/ranking-manager.js';

export { getTotalSolved, getStreak, getRating, getUsername, sortFriends } from '../shared/ranking-manager.js';

function Leaderboard({ friends, myData, myUsername, onRefresh, onRequireAuth }) {
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [sortBy, setSortBy] = useState('total'); // 'total', 'streak', 'rating'

  // Remove current user from friends list if they exist there, then add myData
  const myUsernameLower = myUsername ? myUsername.toLowerCase() : '';
  const friendsWithoutMe = (friends || []).filter(f => (f?.profile?.username || f?.username || '').toLowerCase() !== myUsernameLower);
  const allFriends = myData ? [...friendsWithoutMe, myData] : friendsWithoutMe;

  // Sort friends based on selected criteria with deterministic tiebreakers
  const sortedFriends = sortFriends(allFriends, sortBy);

  const handleCardClick = (friend) => {
    const friendUsername = friend?.profile?.username || friend?.username;
    const selectedUsername = selectedFriend?.profile?.username || selectedFriend?.username;
    if (!friendUsername) return;
    setSelectedFriend(selectedUsername === friendUsername ? null : friend);
  };

  return (
    <div className="bg-background">
      {/* Sort Selector Bar */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Rank by:</span>
        <div className="flex bg-surface rounded-xl p-0.5 border border-surfaceHover/50">
          <button
            onClick={() => setSortBy('total')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              sortBy === 'total'
                ? 'bg-primary text-inverted shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Trophy className="w-3 h-3" />
            <span>Solved</span>
          </button>
          <button
            onClick={() => setSortBy('streak')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              sortBy === 'streak'
                ? 'bg-primary text-inverted shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Flame className="w-3 h-3 text-orange-400" />
            <span>Streak</span>
          </button>
          <button
            onClick={() => setSortBy('rating')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              sortBy === 'rating'
                ? 'bg-primary text-inverted shadow-sm'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Award className="w-3 h-3" />
            <span>Rating</span>
          </button>
        </div>
      </div>

      {sortedFriends.length === 0 ? (
        <div className="p-8 text-center text-text-muted animate-fade-in">
          <p>No friends to display</p>
        </div>
      ) : (
        <div className="p-4 space-y-2.5 animate-slide-up">
          {sortedFriends.filter(f => f && (f.profile?.username || f.username)).map((friend, index) => {
            const friendUser = friend.profile?.username || friend.username;
            const isSelected = (selectedFriend?.profile?.username || selectedFriend?.username) === friendUser;
            return (
              <div key={friendUser}>
                <FriendCard
                  friend={friend}
                  rank={index + 1}
                  sortBy={sortBy}
                  isExpanded={isSelected}
                  onClick={() => handleCardClick(friend)}
                  isCurrentUser={myUsername && friendUser.toLowerCase() === myUsername.toLowerCase()}
                  myUsername={myUsername}
                  mySubmissionCalendar={myData?.submissionCalendar}
                  onRequireAuth={onRequireAuth}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Leaderboard;
