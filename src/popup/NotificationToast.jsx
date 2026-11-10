import React from 'react';
import NotificationCenter from './NotificationCenter';

function NotificationToast({
  notifications,
  onDismiss,
  onMarkAllRead,
  onClearAll,
  onClose,
  onNavigateView,
  onChallengeFromRoast
}) {
  if (!notifications || notifications.length === 0) {
    return null;
  }

  return (
    <NotificationCenter
      notifications={notifications}
      onDismiss={onDismiss}
      onMarkAllRead={onMarkAllRead}
      onClearAll={onClearAll || onMarkAllRead}
      onClose={onClose || (() => {
        if (onDismiss && notifications[0]) onDismiss(notifications[0].id);
      })}
      onNavigateView={onNavigateView}
      onChallengeFromRoast={onChallengeFromRoast}
    />
  );
}

export default NotificationToast;
