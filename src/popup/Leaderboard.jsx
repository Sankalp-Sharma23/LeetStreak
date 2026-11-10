import React, { useState } from 'react';
import FriendCard from './FriendCard';
import { Trophy, Flame, Award, Users } from 'lucide-react';
import { sortFriends } from '../shared/ranking-manager.js';

function Leaderboard({ friends, myData, myUsername, onRequireAuth, presenceMap = {} }) {
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [sortBy, setSortBy] = useState('total'); // 'total', 'streak', 'rating'

  // Remove current user from friends list if they exist there, then add myData
  const myUsernameLower = myUsername ? myUsername.toLowerCase() : '';
  const friendsWithoutMe = (friends || []).filter(f => (f?.profile?.username || f?.username || '').toLowerCase() !== myUsernameLower);
  const allFriends = myData ? [...friendsWithoutMe, myData] : friendsWithoutMe;

  // Calculate count of online friends
  const onlineCount = friendsWithoutMe.filter(f => {
    const uname = f?.profile?.username || f?.username;
    const p = presenceMap[uname] || presenceMap[uname?.toLowerCase()];
    return p?.isOnline || p?.status === 'online' || p?.status === 'in_battle';
  }).length;

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
      {/* User's Distinct Friends Section Header */}
      <div className="px-4 py-3 bg-surface/50 border-b border-surfaceHover/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-text-main">
              {myUsername ? `@${myUsername}'s Friends` : 'Your Friends'}
            </h2>
            <p className="text-[10px] text-text-muted">
              {friendsWithoutMe.length} {friendsWithoutMe.length === 1 ? 'friend' : 'friends'}
              {onlineCount > 0 && <span className="text-emerald-400 font-semibold ml-1.5">• {onlineCount} online</span>}
            </p>
          </div>
        </div>

        {/* Sort Criteria Selector Bar */}
        <div className="flex bg-surface rounded-xl p-0.5 border border-surfaceHover/50">
          <button
            onClick={() => setSortBy('total')}
            className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
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
            className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
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
            className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
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

      {friendsWithoutMe.length === 0 ? (
        <div className="p-8 text-center text-text-muted animate-fade-in flex flex-col items-center justify-center">
          <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center mb-3 border border-surfaceHover/40">
            <Users className="w-7 h-7 text-primary/70" />
          </div>
          <h3 className="text-sm font-bold text-text-main mb-1">No Friends Added Yet</h3>
          <p className="text-xs text-text-muted max-w-xs leading-relaxed mb-1">
            Add friends using their LeetCode handle above to see their progress, compare solved problems, and challenge them to 1v1 coding battles.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-2.5 animate-slide-up">
          {sortedFriends.filter(f => f && (f.profile?.username || f.username)).map((friend, index) => {
            const friendUser = friend.profile?.username || friend.username;
            const isSelected = (selectedFriend?.profile?.username || selectedFriend?.username) === friendUser;
            const pInfo = presenceMap[friendUser] || presenceMap[friendUser?.toLowerCase()];
            const friendPresenceStatus = pInfo?.status || (pInfo?.isOnline ? 'online' : 'offline');

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
                  onRequireAuth={onRequireAuth}
                  presenceStatus={friendPresenceStatus}
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
