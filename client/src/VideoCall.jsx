import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const generateNewUserId = () => {
  localStorage.removeItem('userId');
  const userId = 'user-' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('userId', userId);
  return userId;
};

const VideoCall = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [socket, setSocket] = useState(null);
  const [room] = useState('test-room');
  const [users, setUsers] = useState([]);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [myId] = useState(generateNewUserId());
  const [mySocketId, setMySocketId] = useState('');
  const [callStatus, setCallStatus] = useState('Idle');
  const [inRoom, setInRoom] = useState(true);
  const [incomingCall, setIncomingCall] = useState(null);

  useEffect(() => {
    const newSocket = io(import.meta.env.VITE_API_URL, {
      reconnection: false,
      transports: ['websocket'],
    });
    setSocket(newSocket);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    });
    setPeerConnection(pc);

    let localStream;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStream = stream;
        localVideoRef.current.srcObject = stream;
        stream.getTracks().forEach((track) => {
          console.log(`Adding track: ${track.kind}`);
          pc.addTrack(track, stream);
        });
      })
      .catch((err) => {
        console.error('Error accessing media devices:', err);
        toast.error('Failed to access camera/microphone');
      });

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        console.log('WebRTC connection established');
      } else if (pc.connectionState === 'failed') {
        console.error('WebRTC connection failed');
        setCallStatus('Idle');
        toast.error('Failed to establish connection');
      }
    };

    newSocket.on('connect', () => {
      setMySocketId(newSocket.id);
      if (inRoom) newSocket.emit('join', { room, userId: myId });
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connect error:', error);
      toast.error('Failed to connect to server');
    });

    newSocket.on('new-user-joined', (data) => {
      toast.info(`New user joined: ${data.userId}`);
    });

    newSocket.on('connected-users', setConnectedUsers);
    newSocket.on('room-users', (userData) => {
      console.log('Room users:', userData);
      setUsers(userData.filter((entry) => entry.userId !== myId));
    });

    newSocket.on('offer', (data) => {
      console.log(`Offer received from ${data.from}`, data);
      setCallStatus('Receiving Offer');
      setIncomingCall(data);
    });

    newSocket.on('answer', (answer) => {
      console.log('Answer received:', answer);
      pc.setRemoteDescription(new RTCSessionDescription(answer))
        .then(() => {
          console.log('Remote description set, call connected');
          setCallStatus('Connected');
        })
        .catch((err) => {
          console.error('Error setting remote description:', err);
          setCallStatus('Idle');
          toast.error('Failed to set remote description');
        });
    });

    newSocket.on('ice-candidate', (candidate) => {
      console.log('ICE candidate received:', candidate);
      pc.addIceCandidate(new RTCIceCandidate(candidate))
        .catch((err) => console.error('Error adding ICE candidate:', err));
    });

    newSocket.on('call-declined', () => {
      setCallStatus('Idle');
      setIncomingCall(null);
      toast.error('Call declined by other user');
    });

    newSocket.on('call-failed', (data) => {
      setCallStatus('Idle');
      setIncomingCall(null);
      toast.error(data.reason);
    });

    newSocket.on('user-disconnected', (userId) => {
      if (remoteVideoRef.current?.peerId === userId) {
        remoteVideoRef.current.srcObject = null;
        setCallStatus('Idle');
      }
      if (inRoom) newSocket.emit('join', { room, userId: myId });
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && remoteVideoRef.current?.peerId) {
        console.log('Sending ICE candidate to:', remoteVideoRef.current.peerId);
        newSocket.emit('ice-candidate', {
          candidate: event.candidate,
          to: remoteVideoRef.current.peerId,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('Remote track received:', event);
      remoteVideoRef.current.srcObject = event.streams[0];
      setCallStatus('Connected');
    };

    return () => {
      if (localStream) localStream.getTracks().forEach((track) => track.stop());
      if (pc) pc.close();
      if (newSocket) newSocket.disconnect();
    };
  }, [room, myId, inRoom]);

  const createOffer = async (targetUserId) => {
    if (!peerConnection || !socket) return;
    setCallStatus('Offering');
    console.log(`Creating offer for ${targetUserId}`);
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { offer, to: targetUserId, from: myId });
      remoteVideoRef.current.peerId = targetUserId;
    } catch (err) {
      console.error('Error creating offer:', err);
      setCallStatus('Idle');
      toast.error('Failed to create offer');
    }
  };

  const handleOffer = async (pc, offer, from, socket) => {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { answer, from: myId, to: from });
      console.log(`Answer sent to ${from}`);
      remoteVideoRef.current.peerId = from;
      setCallStatus('Connected');
    } catch (err) {
      console.error('Error handling offer:', err);
      setCallStatus('Idle');
      toast.error('Failed to handle offer');
    }
  };

  const acceptCall = () => {
    if (incomingCall && peerConnection && socket) {
      handleOffer(peerConnection, incomingCall.offer, incomingCall.from, socket);
      setIncomingCall(null);
      setCallStatus('Answering');
    }
  };

  const declineCall = () => {
    if (incomingCall && socket) {
      setCallStatus('Idle');
      socket.emit('call-declined', { to: incomingCall.from });
      setIncomingCall(null);
    }
  };

  const leaveRoom = () => {
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }
    if (socket) socket.emit('leave', { room, userId: myId });
    setInRoom(false);
    setUsers([]);
    setCallStatus('Idle');
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
      remoteVideoRef.current.peerId = null;
    }
  };

  const joinRoom = () => {
    if (socket) socket.emit('join', { room, userId: myId });
    setInRoom(true);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center' }}>WebRTC Video Call</h1>
      <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
        <div>
          <h3>Local Video</h3>
          <video ref={localVideoRef} autoPlay muted style={{ width: '300px', border: '1px solid #ccc' }} />
        </div>
        <div>
          <h3>Remote Video</h3>
          <video ref={remoteVideoRef} autoPlay style={{ width: '300px', border: '1px solid #ccc' }} />
        </div>
      </div>
      <h2>Call Status: {callStatus}</h2>
      {incomingCall && (
        <div style={{ marginTop: '20px' }}>
          <p>Incoming call from {incomingCall.from}</p>
          <button onClick={acceptCall} style={{ marginRight: '10px' }}>
            Accept
          </button>
          <button onClick={declineCall}>
            Decline
          </button>
        </div>
      )}
      {!incomingCall && callStatus === 'Receiving Offer' && (
        <p>DEBUG: Expected incoming call, but none found. Check state.</p>
      )}
      <h2>Currently Connected Users</h2>
      {connectedUsers.length > 0 ? (
        <ul>
          {connectedUsers.map((entry) => (
            <li key={entry.userId}>
              {entry.userId} (Socket ID: {entry.socketId || 'Unknown'})
            </li>
          ))}
        </ul>
      ) : (
        <p>No users currently connected.</p>
      )}
      <h2>Users in Room</h2>
      {inRoom ? (
        <>
          {users.length > 0 ? (
            <ul>
              {users.map((entry) => (
                <li key={entry.userId}>
                  {entry.userId} (Socket ID: {entry.socketId || 'Unknown'})
                  <button
                    onClick={() => createOffer(entry.userId)}
                    disabled={callStatus !== 'Idle' || !socket}
                    style={{ marginLeft: '10px', padding: '5px 10px' }}
                  >
                    Call
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No other users in the room.</p>
          )}
          <button onClick={leaveRoom} style={{ padding: '5px 10px' }}>
            Leave Room
          </button>
        </>
      ) : (
        <button onClick={joinRoom} disabled={!socket} style={{ padding: '5px 10px' }}>
          Join Room
        </button>
      )}
      <p>Your ID: {myId} (Socket ID: {mySocketId || 'Connecting...'})</p>
      <ToastContainer />
    </div>
  );
};

export default VideoCall;