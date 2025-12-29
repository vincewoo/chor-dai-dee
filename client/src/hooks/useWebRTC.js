import { useEffect, useRef, useState, useCallback } from 'react';
import SimplePeer from 'simple-peer';

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

        // Monitor local audio levels
        if (audioContextRef.current) {
          const source = audioContextRef.current.createMediaStreamSource(stream);
          const analyzer = audioContextRef.current.createAnalyser();
          analyzer.fftSize = 256;
          source.connect(analyzer);

          analyzersRef.current[username] = analyzer;
          monitorAudioLevel(username, analyzer);
        }

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

    const checkLevel = () => {
      if (!analyzersRef.current[userId]) return;

      analyzer.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

      setAudioLevels(prev => ({
        ...prev,
        [userId]: average / 255 // Normalize to 0-1
      }));

      requestAnimationFrame(checkLevel);
    };

    checkLevel();
  }, []);

  // Create peer connection
  const createPeer = useCallback((userId, initiator) => {
    if (!localStreamRef.current) return null;

    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current,
      config: {
        iceServers: ICE_SERVERS
      }
    });

    peer.on('signal', signal => {
      socket.emit('voice:signal', { to: userId, signal });
    });

    peer.on('stream', stream => {
      // Create audio element for remote stream
      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.id = `audio-${userId}`;
      document.body.appendChild(audio);

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
      if (userId !== username && !peersRef.current[userId]) {
        const peer = createPeer(userId, true);
        if (peer) {
          peersRef.current[userId] = peer;
          setPeers(prev => ({ ...prev, [userId]: peer }));
        }
      }
    };

    const handleSignal = ({ from, signal }) => {
      if (from === username) return;

      if (!peersRef.current[from]) {
        const peer = createPeer(from, false);
        if (peer) {
          peersRef.current[from] = peer;
          setPeers(prev => ({ ...prev, [from]: peer }));
          peer.signal(signal);
        }
      } else {
        peersRef.current[from].signal(signal);
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
      // Initialize connections with existing users
      users.forEach(userId => {
        if (userId !== username && !peersRef.current[userId]) {
          const peer = createPeer(userId, true);
          if (peer) {
            peersRef.current[userId] = peer;
            setPeers(prev => ({ ...prev, [userId]: peer }));
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