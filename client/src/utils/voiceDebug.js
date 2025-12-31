// Voice Chat Debug Utilities
// Run these in the browser console to debug voice chat

// Check if audio elements exist and their status
window.checkVoiceStatus = () => {
  console.log('=== Voice Chat Status ===');

  // Check for audio elements
  const audioElements = document.querySelectorAll('audio');
  console.log(`Found ${audioElements.length} audio element(s)`);

  audioElements.forEach((audio, index) => {
    console.log(`Audio ${index + 1}:`, {
      id: audio.id,
      paused: audio.paused,
      muted: audio.muted,
      volume: audio.volume,
      readyState: audio.readyState,
      networkState: audio.networkState,
      currentTime: audio.currentTime,
      duration: audio.duration,
      hasSource: !!audio.srcObject,
      tracks: audio.srcObject ? audio.srcObject.getAudioTracks().length : 0
    });

    if (audio.srcObject) {
      const tracks = audio.srcObject.getAudioTracks();
      tracks.forEach((track, i) => {
        console.log(`  Track ${i + 1}:`, {
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          label: track.label
        });
      });
    }
  });

  // Check SimplePeer status
  if (window.SimplePeer) {
    console.log('SimplePeer is loaded ✅');
  } else {
    console.log('SimplePeer is NOT loaded ❌');
  }

  // Check AudioContext
  const audioContext = window.AudioContext || window.webkitAudioContext;
  if (audioContext) {
    console.log('AudioContext available ✅');
  } else {
    console.log('AudioContext NOT available ❌');
  }

  console.log('=== End Voice Status ===');
};

// Test playing a specific audio element
window.testPlayAudio = (userId) => {
  const audio = document.getElementById(`audio-${userId}`);
  if (audio) {
    console.log(`Testing audio for ${userId}...`);
    audio.play().then(() => {
      console.log(`✅ Audio playing for ${userId}`);
    }).catch(err => {
      console.error(`❌ Failed to play audio for ${userId}:`, err);
    });
  } else {
    console.log(`No audio element found for ${userId}`);
  }
};

// List all peer connections
window.listPeers = () => {
  console.log('Looking for peer connections...');
  // This would need to be exported from the React component
  // For now, check if any RTCPeerConnections exist
  if (window.RTCPeerConnection) {
    console.log('RTCPeerConnection API available ✅');
  }
};

// Export for use in components
export const voiceDebug = {
  checkStatus: window.checkVoiceStatus,
  testPlay: window.testPlayAudio,
  listPeers: window.listPeers
};