import React, { useEffect, useState } from 'react';

function SplashScreen({ onVideoEnd }) {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    // Set a maximum timeout for the splash screen (in case video fails or is short)
    const maxSplashTime = 5000; // 5 seconds max
    const maxTimer = setTimeout(() => {
      onVideoEnd();
    }, maxSplashTime);

    return () => clearTimeout(maxTimer);
  }, [onVideoEnd]);

  const handleVideoEnd = () => {
    onVideoEnd();
  };

  const handleVideoError = () => {
    console.warn('Failed to load splash video, ending splash screen early');
    setVideoError(true);
    onVideoEnd();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center overflow-hidden">
      {/* Video Background */}
      {!videoError ? (
        <video
          autoPlay
          muted
          playsInline
          onCanPlay={() => setVideoLoaded(true)}
          onEnded={handleVideoEnd}
          onError={handleVideoError}
          className="w-full h-full object-cover"
          style={{
            opacity: videoLoaded ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out',
          }}
        >
          {/* Video file served from public folder */}
          <source src="User_Dislikes_Generated_Video.mp4" type="video/mp4" />
        </video>
      ) : null}
    </div>
  );
}

export default SplashScreen;
