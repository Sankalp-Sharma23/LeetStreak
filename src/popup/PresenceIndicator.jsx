import React from 'react';

/**
 * Reusable presence indicator dot and badge.
 *
 * Statuses:
 * - 'online': Green circular dot (verified active within 120 seconds)
 * - 'in_battle': Amber/yellow circular dot (currently in an active 1v1 match)
 * - 'offline': Grey circular dot (inactive or presence expired)
 */
export function PresenceIndicator({ 
  status = 'offline', 
  size = 'md', 
  showLabel = false,
  className = '' 
}) {
  const normalizedStatus = status === 'in_battle' ? 'in_battle' : (status === 'online' ? 'online' : 'offline');

  const configs = {
    online: {
      color: 'bg-emerald-500',
      label: 'Online',
      ringColor: 'ring-surface'
    },
    in_battle: {
      color: 'bg-amber-400',
      label: 'In Battle',
      ringColor: 'ring-surface'
    },
    offline: {
      color: 'bg-zinc-500',
      label: 'Offline',
      ringColor: 'ring-surface'
    }
  };

  const config = configs[normalizedStatus];

  const sizeClasses = {
    sm: 'w-2 h-2 ring-1.5',
    md: 'w-2.5 h-2.5 ring-2',
    lg: 'w-3 h-3 ring-2'
  };

  return (
    <span 
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={config.label}
      aria-label={`Status: ${config.label}`}
      role="status"
    >
      <span 
        className={`rounded-full shrink-0 transition-colors duration-200 ${config.color} ${sizeClasses[size] || sizeClasses.md} ${config.ringColor}`} 
      />
      {showLabel && (
        <span className="text-[10px] font-medium text-text-muted">
          {config.label}
        </span>
      )}
    </span>
  );
}

/**
 * Reusable Avatar with overlaid bottom-right presence indicator.
 */
export function AvatarWithPresence({
  src,
  alt = 'User',
  size = 'md', // 'sm' (24px), 'md' (40px), 'lg' (48px)
  status = 'offline',
  className = '',
  imageClassName = '',
  badge = null
}) {
  const sizeMap = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-12 h-12'
  };

  const indicatorSizeMap = {
    sm: 'sm',
    md: 'md',
    lg: 'lg'
  };

  const fallbackAvatar = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2371717a"%3E%3Cpath d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/%3E%3C/svg%3E';

  return (
    <div className={`relative inline-block shrink-0 ${sizeMap[size] || sizeMap.md} ${className}`}>
      <img
        src={src || fallbackAvatar}
        alt={alt}
        className={`w-full h-full rounded-full object-cover border border-surfaceHover shadow-sm ${imageClassName}`}
        onError={(e) => {
          e.target.onerror = null;
          e.target.src = fallbackAvatar;
        }}
      />
      {badge && (
        <div className="absolute -top-1 -left-1 z-10">
          {badge}
        </div>
      )}
      <div className="absolute -bottom-0.5 -right-0.5 z-10">
        <PresenceIndicator status={status} size={indicatorSizeMap[size] || 'md'} />
      </div>
    </div>
  );
}

export default PresenceIndicator;

