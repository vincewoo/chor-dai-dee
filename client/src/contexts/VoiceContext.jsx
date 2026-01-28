import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as SimplePeerModule from 'simple-peer';

// Handle both default export and named export scenarios
const SimplePeer = SimplePeerModule.default || SimplePeerModule;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

const VoiceContext = createContext(null);
const VoiceAudioContext = createContext(null);

export const useVoice = () => {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
};

export const useVoiceAudio = () => {
  const context = useContext(VoiceAudioContext);
  if (!context) {
    throw new Error('useVoiceAudio must be used within a VoiceProvider');
  }
  return context;
};

export const VoiceProvider = ({ socket, children }) => {
  // Voice state
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [peers, setPeers] = useState({});
  const [audioLevels, setAudioLevels] = useState({});
  const [permissionError, setPermissionError] = useState(false);
  const [playerVolumes, setPlayerVolumes] = useState({});

  // Refs
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioContextRef = useRef(null);
  const analyzersRef = useRef({});

  // Initialize audio context
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();

      // Add click handler for iOS to resume AudioContext
      // This is needed because iOS requires user interaction to start audio
      const resumeOnInteraction = () => {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().then(() => {
            console.log('[VoiceContext] AudioContext resumed after user interaction');
          });
        }
      };

      // Add multiple event listeners to ensure we catch user interaction
      document.addEventListener('touchstart', resumeOnInteraction, { once: true });
      document.addEventListener('click', resumeOnInteraction, { once: true });
    }

    // Always try to resume if suspended
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {
        // Silently fail, will be resumed on user interaction
      });
    }
    return audioContextRef.current;
  }, []);

  // Monitor audio levels
  const monitorAudioLevel = useCallback((userId, analyzer) => {
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
    let animationId = null;
    let errorLogged = false; // Only log error once per monitor session
    let lastUpdateTime = 0;
    const THROTTLE_INTERVAL = 100; // Limit updates to ~10fps to reduce re-renders

    const checkLevel = (timestamp) => {
      if (!analyzersRef.current[userId]) return;

      animationId = requestAnimationFrame(checkLevel);

      // Check if AudioContext is suspended and try to resume
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      // Throttle updates using timestamp from requestAnimationFrame
      // timestamp is undefined on first call, so we fallback to performance.now()
      const now = timestamp || performance.now();
      if (now - lastUpdateTime < THROTTLE_INTERVAL) {
        return;
      }

      try {
        analyzer.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const normalizedLevel = Math.min(rms / 128, 1);

        setAudioLevels(prev => ({
          ...prev,
          [userId]: normalizedLevel
        }));

        lastUpdateTime = now;
        // Reset error flag on successful read
        errorLogged = false;
      } catch {
        // Only log once to avoid spamming
        if (!errorLogged) {
          console.debug('[VoiceContext] Audio level monitoring paused (context suspended)');
          errorLogged = true;
        }
      }
    };

    checkLevel();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);

  // Leave voice room
  const leaveVoiceRoom = useCallback(() => {
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Destroy all peer connections
    Object.values(peersRef.current).forEach(peer => {
      try {
        peer.destroy();
      } catch {
        // Ignore errors during cleanup
      }
    });
    peersRef.current = {};
    setPeers({});

    // Clear analyzers
    analyzersRef.current = {};
    setAudioLevels({});

    // Notify server
    if (socket && currentRoomId) {
      socket.emit('voice:leave');
    }

    // Reset state
    setCurrentRoomId(null);
    setCurrentUsername(null);
    setIsVoiceConnected(false);
    setVoiceEnabled(false);
    setIsMuted(false);
    setIsDeafened(false);
  }, [socket, currentRoomId]);

  // Join voice room
  const joinVoiceRoom = useCallback(async (roomId, username) => {
    if (!socket || !roomId || !username) return false;

    // If already in a different room, leave it first
    if (currentRoomId && currentRoomId !== roomId) {
      leaveVoiceRoom();
    }

    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // iOS Safari specific constraints that might help
          sampleRate: 44100,
          channelCount: 1
        }
      });

      localStreamRef.current = stream;
      setPermissionError(false);

      // Initialize audio context and monitor local audio
      const audioCtx = initAudioContext();

      // Setup audio analyzer regardless of context state
      // This is important for iOS where context starts suspended
      try {
        // For iOS Safari, we need to resume the context on user interaction
        if (audioCtx.state === 'suspended') {
          console.log('[VoiceContext] AudioContext suspended, attempting to resume...');
          audioCtx.resume().then(() => {
            console.log('[VoiceContext] AudioContext resumed successfully');
          }).catch(err => {
            console.warn('[VoiceContext] Failed to resume AudioContext:', err);
          });
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 256;
        analyzer.smoothingTimeConstant = 0.8;
        source.connect(analyzer);
        analyzersRef.current[username] = analyzer;
        monitorAudioLevel(username, analyzer);
      } catch (err) {
        console.error('[VoiceContext] Failed to setup audio analyzer:', err);
      }

      // Join the voice channel
      socket.emit('voice:join', { roomId, username });
      setCurrentRoomId(roomId);
      setCurrentUsername(username);
      setIsVoiceConnected(true);
      setVoiceEnabled(true);

      return true;
    } catch (err) {
      console.error('[VoiceContext] Failed to get user media:', err);
      setPermissionError(true);
      setIsVoiceConnected(false);
      return false;
    }
  }, [socket, currentRoomId, initAudioContext, monitorAudioLevel, leaveVoiceRoom]);

  // Create peer connection
  const createPeer = useCallback((userId, initiator) => {
    if (!localStreamRef.current) {
      console.error('[VoiceContext] Cannot create peer - no local stream');
      return null;
    }

    let peer;
    try {
      peer = new SimplePeer({
        initiator,
        stream: localStreamRef.current,
        config: {
          iceServers: ICE_SERVERS,
          offerOptions: { offerToReceiveAudio: true },
          answerOptions: { offerToReceiveAudio: true }
        },
        trickle: true
      });
    } catch (err) {
      console.error(`[VoiceContext] Failed to create SimplePeer:`, err);
      return null;
    }

    peer.on('signal', signal => {
      socket.emit('voice:signal', { to: userId, signal });
    });

    peer.on('connect', () => {
      console.log(`[VoiceContext] Peer connected with ${userId}`);
    });

    peer.on('stream', stream => {
      console.log(`[VoiceContext] Received stream from ${userId}`);

      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.id = `audio-${userId}`;
      audio.volume = playerVolumes[userId] ?? 1.0;
      document.body.appendChild(audio);

      audio.play().catch(err => {
        console.error(`[VoiceContext] Failed to play audio for ${userId}:`, err);
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().then(() => {
            audio.play().catch(() => {});
          });
        }
      });

      // Monitor remote audio levels
      if (audioContextRef.current && stream.getAudioTracks().length > 0) {
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const analyzer = audioContextRef.current.createAnalyser();
        analyzer.fftSize = 256;
        source.connect(analyzer);
        analyzersRef.current[userId] = analyzer;
        monitorAudioLevel(userId, analyzer);
      }
    });

    peer.on('error', err => {
      console.error(`[VoiceContext] Peer error with ${userId}:`, err);
    });

    peer.on('close', () => {
      const audio = document.getElementById(`audio-${userId}`);
      if (audio) audio.remove();
      delete analyzersRef.current[userId];
      setAudioLevels(prev => {
        const newLevels = { ...prev };
        delete newLevels[userId];
        return newLevels;
      });
    });

    return peer;
  }, [socket, monitorAudioLevel, playerVolumes]);

  // Toggle voice on/off
  const toggleVoice = useCallback(async (roomId, username) => {
    if (voiceEnabled) {
      leaveVoiceRoom();
      return false;
    } else {
      return await joinVoiceRoom(roomId, username);
    }
  }, [voiceEnabled, leaveVoiceRoom, joinVoiceRoom]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        socket?.emit('voice:mute', { muted: !audioTrack.enabled });
      }
    }
  }, [socket]);

  // Toggle deafen
  const toggleDeafen = useCallback(() => {
    const newDeafened = !isDeafened;
    setIsDeafened(newDeafened);

    Object.keys(peersRef.current).forEach(userId => {
      const audio = document.getElementById(`audio-${userId}`);
      if (audio) {
        audio.volume = newDeafened ? 0 : (playerVolumes[userId] ?? 1);
      }
    });

    socket?.emit('voice:deafen', { deafened: newDeafened });
  }, [isDeafened, socket, playerVolumes]);

  // Set volume for a specific peer
  const setPlayerVolume = useCallback((userId, volume) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    setPlayerVolumes(prev => ({ ...prev, [userId]: clampedVolume }));

    const audio = document.getElementById(`audio-${userId}`);
    if (audio) {
      audio.volume = isDeafened ? 0 : clampedVolume;
    }
  }, [isDeafened]);

  // Handle socket events for WebRTC signaling
  useEffect(() => {
    if (!socket || !voiceEnabled || !currentUsername) return;

    const handleUserJoined = ({ userId }) => {
      if (userId !== currentUsername && !peersRef.current[userId]) {
        const shouldInitiate = currentUsername < userId;
        if (shouldInitiate) {
          const peer = createPeer(userId, true);
          if (peer) {
            peersRef.current[userId] = peer;
            setPeers(prev => ({ ...prev, [userId]: peer }));
          }
        }
      }
    };

    const handleSignal = ({ from, signal }) => {
      if (from === currentUsername) return;

      if (!peersRef.current[from]) {
        const peer = createPeer(from, false);
        if (peer) {
          peersRef.current[from] = peer;
          setPeers(prev => ({ ...prev, [from]: peer }));
          setTimeout(() => {
            try {
              peer.signal(signal);
            } catch (err) {
              console.error(`[VoiceContext] Error signaling new peer:`, err);
            }
          }, 100);
        }
      } else {
        const peer = peersRef.current[from];
        try {
          peer.signal(signal);
        } catch (err) {
          if (err.message?.includes('cannot signal after peer is destroyed')) return;
          console.error(`[VoiceContext] Error signaling peer:`, err);
        }
      }
    };

    const handleUserLeft = ({ userId }) => {
      if (peersRef.current[userId]) {
        peersRef.current[userId].destroy();
        delete peersRef.current[userId];
        setPeers(prev => {
          const newPeers = { ...prev };
          delete newPeers[userId];
          return newPeers;
        });
      }
    };

    const handleVoiceRoomState = ({ users }) => {
      users.forEach(userId => {
        if (userId !== currentUsername && !peersRef.current[userId]) {
          const shouldInitiate = currentUsername < userId;
          if (shouldInitiate) {
            const peer = createPeer(userId, true);
            if (peer) {
              peersRef.current[userId] = peer;
              setPeers(prev => ({ ...prev, [userId]: peer }));
            }
          }
        }
      });
    };

    socket.on('voice:user-joined', handleUserJoined);
    socket.on('voice:signal', handleSignal);
    socket.on('voice:user-left', handleUserLeft);
    socket.on('voice:room-state', handleVoiceRoomState);

    return () => {
      socket.off('voice:user-joined', handleUserJoined);
      socket.off('voice:signal', handleSignal);
      socket.off('voice:user-left', handleUserLeft);
      socket.off('voice:room-state', handleVoiceRoomState);
    };
  }, [socket, voiceEnabled, currentUsername, createPeer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      Object.values(peersRef.current).forEach(peer => {
        try {
          peer.destroy();
        } catch {
          // Ignore
        }
      });
    };
  }, []);

  // Stable value for general voice state (re-renders only on significant state changes)
  const value = useMemo(() => ({
    // State
    voiceEnabled,
    isVoiceConnected,
    isMuted,
    isDeafened,
    currentRoomId,
    peers: Object.keys(peers),
    permissionError,
    playerVolumes,

    // Actions
    joinVoiceRoom,
    leaveVoiceRoom,
    toggleVoice,
    toggleMute,
    toggleDeafen,
    setPlayerVolume,
    setVoiceEnabled
  }), [
    voiceEnabled,
    isVoiceConnected,
    isMuted,
    isDeafened,
    currentRoomId,
    peers,
    permissionError,
    playerVolumes,
    joinVoiceRoom,
    leaveVoiceRoom,
    toggleVoice,
    toggleMute,
    toggleDeafen,
    setPlayerVolume
  ]);

  // High-frequency value for audio levels
  const audioValue = useMemo(() => ({
    audioLevels
  }), [audioLevels]);

  return (
    <VoiceContext.Provider value={value}>
      <VoiceAudioContext.Provider value={audioValue}>
        {children}
      </VoiceAudioContext.Provider>
    </VoiceContext.Provider>
  );
};

export default VoiceContext;
