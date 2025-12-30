import { useEffect, useRef, useState, useCallback } from 'react';
import * as SimplePeerModule from 'simple-peer';

// Handle both default export and named export scenarios
const SimplePeer = SimplePeerModule.default || SimplePeerModule;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

export const useWebRTC = (socket, roomId, username, enabled = false) => {
  const [peers, setPeers] = useState({});
  const [audioLevels, setAudioLevels] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioContextRef = useRef(null);
  const analyzersRef = useRef({});


  // Initialize audio context for level monitoring
  useEffect(() => {
    if (enabled && !audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      // Resume AudioContext if it's suspended (required in many browsers)
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().then(() => {
          console.log('AudioContext resumed');
        });
      }
    }
  }, [enabled]);

  // Get user media and join voice channel
  useEffect(() => {
    if (!enabled || !socket || !roomId || !username) return;

    const initializeVoice = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        localStreamRef.current = stream;

        // Ensure AudioContext is running before monitoring
        const setupAudioMonitoring = async () => {
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          }

          if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
            console.log('AudioContext resumed for monitoring');
          }

          // Monitor local audio levels
          if (audioContextRef.current.state === 'running') {
            try {
              const source = audioContextRef.current.createMediaStreamSource(stream);
              const analyzer = audioContextRef.current.createAnalyser();
              analyzer.fftSize = 256;
              analyzer.smoothingTimeConstant = 0.8;
              source.connect(analyzer);
              // Don't connect to destination - we just want to analyze

              analyzersRef.current[username] = analyzer;
              monitorAudioLevel(username, analyzer);
              console.log('Started monitoring local audio for:', username);
            } catch (err) {
              console.error('Failed to setup audio analyzer:', err);
            }
          }
        };

        await setupAudioMonitoring();

        // Join voice channel
        socket.emit('voice:join', { roomId, username });
        setIsVoiceConnected(true);
      } catch (err) {
        console.error('Failed to get user media:', err);
        setIsVoiceConnected(false);
      }
    };

    initializeVoice();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      Object.values(peersRef.current).forEach(peer => peer.destroy());
      peersRef.current = {};
      setPeers({});
      setIsVoiceConnected(false);
    };
  }, [enabled, socket, roomId, username]);

  // Monitor audio levels
  const monitorAudioLevel = useCallback((userId, analyzer) => {
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
    let animationId = null;

    const checkLevel = () => {
      if (!analyzersRef.current[userId]) return;

      analyzer.getByteFrequencyData(dataArray);

      // Calculate RMS (Root Mean Square) for better voice detection
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const normalizedLevel = Math.min(rms / 128, 1); // Normalize to 0-1 with better sensitivity

      // Remove noisy logging - console.log(`Audio level for ${userId}:`, normalizedLevel);

      setAudioLevels(prev => ({
        ...prev,
        [userId]: normalizedLevel
      }));

      animationId = requestAnimationFrame(checkLevel);
    };

    checkLevel();

    // Store animation ID for cleanup
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);

  // Create peer connection
  const createPeer = useCallback((userId, initiator) => {
    console.log(`[WebRTC] createPeer called for ${userId}, initiator: ${initiator}`);
    console.log('[WebRTC] SimplePeer available?', typeof SimplePeer);

    if (!localStreamRef.current) {
      console.error('[WebRTC] Cannot create peer - no local stream');
      return null;
    }

    console.log(`[WebRTC] Creating SimplePeer for ${userId}, initiator: ${initiator}`);
    console.log('[WebRTC] Local stream tracks:', localStreamRef.current.getTracks());

    let peer;
    try {
      peer = new SimplePeer({
        initiator,
        stream: localStreamRef.current,
        config: {
          iceServers: ICE_SERVERS,
          // Add additional constraints to handle offer collisions
          offerOptions: {
            offerToReceiveAudio: true
          },
          answerOptions: {
            offerToReceiveAudio: true
          }
        },
        trickle: true
      });
      console.log('[WebRTC] SimplePeer instance created successfully');
    } catch (err) {
      console.error(`[WebRTC] Failed to create SimplePeer:`, err);
      console.error('SimplePeer constructor:', SimplePeer);
      return null;
    }

    peer.on('signal', signal => {
      console.log(`[WebRTC] Sending signal to ${userId}, type: ${signal.type}`);
      socket.emit('voice:signal', { to: userId, signal });
    });

    peer.on('connect', () => {
      console.log(`[WebRTC] Peer connected with ${userId}`);
    });

    peer.on('stream', stream => {
      console.log(`[WebRTC] Received stream from ${userId}`);
      console.log(`[WebRTC] Stream has ${stream.getAudioTracks().length} audio tracks`);

      // Create audio element for remote stream
      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.id = `audio-${userId}`;
      audio.volume = 1.0; // Ensure full volume
      document.body.appendChild(audio);

      // Force play the audio
      audio.play().then(() => {
        console.log(`[WebRTC] ✅ Audio playing for ${userId}`);
        // Also add a visual indicator that audio element was created
        console.log(`[WebRTC] Audio element created: document.getElementById('audio-${userId}') exists`);
      }).catch(err => {
        console.error(`[WebRTC] ❌ Failed to play audio for ${userId}:`, err);
        // Try to resume AudioContext and retry
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().then(() => {
            audio.play().catch(e => console.error('[WebRTC] Retry play failed:', e));
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
      console.error(`Peer error with ${userId}:`, err);
    });

    peer.on('close', () => {
      // Clean up audio element
      const audio = document.getElementById(`audio-${userId}`);
      if (audio) {
        audio.remove();
      }
      delete analyzersRef.current[userId];
      setAudioLevels(prev => {
        const newLevels = { ...prev };
        delete newLevels[userId];
        return newLevels;
      });
    });

    return peer;
  }, [socket, monitorAudioLevel]);

  // Handle signaling
  useEffect(() => {
    if (!socket || !enabled) return;

    const handleUserJoined = ({ userId }) => {
      console.log(`[WebRTC] User joined voice: ${userId}, I am: ${username}`);
      if (userId !== username && !peersRef.current[userId]) {
        // Use string comparison to determine who initiates to avoid collision
        // The user with the "smaller" username initiates
        const shouldInitiate = username < userId;
        console.log(`[WebRTC] Creating peer connection for ${userId}, initiator: ${shouldInitiate} (${username} < ${userId})`);

        if (shouldInitiate) {
          const peer = createPeer(userId, true);
          if (peer) {
            peersRef.current[userId] = peer;
            setPeers(prev => ({ ...prev, [userId]: peer }));
          }
        }
        // If we're not initiating, we'll create the peer when we receive their offer
      }
    };

    const handleSignal = ({ from, signal }) => {
      console.log(`[WebRTC] Received signal from ${from}, signal type:`, signal.type);
      if (from === username) return;

      if (!peersRef.current[from]) {
        console.log(`[WebRTC] Creating peer connection as receiver for ${from}`);
        const peer = createPeer(from, false);
        if (peer) {
          peersRef.current[from] = peer;
          setPeers(prev => ({ ...prev, [from]: peer }));
          // Add a small delay to ensure peer is ready
          setTimeout(() => {
            try {
              peer.signal(signal);
            } catch (err) {
              console.error(`[WebRTC] Error signaling new peer for ${from}:`, err);
            }
          }, 100);
        }
      } else {
        console.log(`[WebRTC] Signaling existing peer for ${from}`);
        const peer = peersRef.current[from];

        // Check if peer is destroyed before signaling
        if (peer._pc && peer._pc.connectionState === 'closed') {
          console.log(`[WebRTC] Peer for ${from} is closed, recreating...`);
          peer.destroy();
          delete peersRef.current[from];

          const newPeer = createPeer(from, false);
          if (newPeer) {
            peersRef.current[from] = newPeer;
            setPeers(prev => ({ ...prev, [from]: newPeer }));
            setTimeout(() => {
              try {
                newPeer.signal(signal);
              } catch (e) {
                // Silently ignore signaling errors for ICE candidates
                if (signal.type !== 'candidate') {
                  console.error(`[WebRTC] Failed to signal recreated peer:`, e.message);
                }
              }
            }, 100);
          }
          return;
        }

        try {
          peer.signal(signal);
        } catch (err) {
          // Don't log errors for ICE candidates after peer is destroyed
          if (err.message && err.message.includes('cannot signal after peer is destroyed')) {
            // Silently ignore - this is expected when peer has been cleaned up
            return;
          }

          // For other errors, try to recover
          if (err.message && (err.message.includes('wrong state') || err.message.includes('Failed to set remote'))) {
            console.log(`[WebRTC] Recreating peer connection for ${from} due to state error`);
            if (peersRef.current[from]) {
              peersRef.current[from].destroy();
              delete peersRef.current[from];
            }
            const peer = createPeer(from, false);
            if (peer) {
              peersRef.current[from] = peer;
              setPeers(prev => ({ ...prev, [from]: peer }));
              setTimeout(() => {
                try {
                  peer.signal(signal);
                } catch (e) {
                  if (signal.type !== 'candidate') {
                    console.error(`[WebRTC] Failed to signal recreated peer:`, e.message);
                  }
                }
              }, 100);
            }
          } else {
            console.error(`[WebRTC] Unexpected error signaling peer for ${from}:`, err.message);
          }
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
      console.log(`[WebRTC] Voice room state received, users in voice:`, users);
      console.log(`[WebRTC] I am: ${username}`);
      // Initialize connections with existing users
      users.forEach(userId => {
        if (userId !== username && !peersRef.current[userId]) {
          // Use same tie-breaker logic to avoid collision
          const shouldInitiate = username < userId;
          console.log(`[WebRTC] Need to connect with existing user: ${userId}, initiator: ${shouldInitiate}`);

          if (shouldInitiate) {
            const peer = createPeer(userId, true);
            if (peer) {
              peersRef.current[userId] = peer;
              setPeers(prev => ({ ...prev, [userId]: peer }));
            }
          }
          // If we're not initiating, we'll create the peer when we receive their offer
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
  }, [socket, enabled, username, createPeer]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        socket.emit('voice:mute', { muted: !audioTrack.enabled });
      }
    }
  }, [socket]);

  // Set volume for a specific peer
  const setVolume = useCallback((userId, volume) => {
    const audio = document.getElementById(`audio-${userId}`);
    if (audio) {
      audio.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  return {
    peers: Object.keys(peers),
    audioLevels,
    isMuted,
    isVoiceConnected,
    toggleMute,
    setVolume
  };
};