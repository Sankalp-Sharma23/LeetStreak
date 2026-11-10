import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

export default function FriendRequests({ onChanged }) {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const refresh = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_FRIEND_REQUESTS' });
      setRequests(response?.success ? response.requests || [] : []);
    } catch (error) {
      console.warn('[FriendRequests] Could not load requests:', error);
      setRequests([]);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, []);

  const respond = async (request, accept) => {
    setBusyId(request.friendship_id);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RESPOND_FRIEND_REQUEST',
        friendshipId: request.friendship_id,
        accept
      });
      if (!response?.success) throw new Error(response?.error || 'Could not update request');
      setRequests(current => current.filter(item => item.friendship_id !== request.friendship_id));
      if (accept) onChanged?.();
    } catch (error) {
      console.error('[FriendRequests] Could not update request:', error);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (!requests.length) return null;

  return (
    <section className="px-4 py-3 border-b border-surfaceHover space-y-2" aria-label="Friend requests">
      <h2 className="text-xs font-bold text-text-main">Friend requests</h2>
      {requests.map(request => (
        <div key={request.friendship_id} className="flex items-center justify-between gap-3 rounded-xl bg-surface/60 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-main">{request.display_name || request.leetcode_username}</p>
            <p className="truncate text-[10px] text-text-muted">@{request.leetcode_username}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" aria-label={`Accept ${request.leetcode_username}`} onClick={() => respond(request, true)} disabled={busyId !== null}
              className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400 disabled:opacity-50">
              {busyId === request.friendship_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
            <button type="button" aria-label={`Decline ${request.leetcode_username}`} onClick={() => respond(request, false)} disabled={busyId !== null}
              className="rounded-lg bg-red-500/10 p-2 text-red-400 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
    </section>
  );
}
