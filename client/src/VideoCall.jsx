import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const generateNewUserId = () => {
  const userId = 'user-' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('userId', userId);
  return userId;
};

const VideoCall = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [socket, setSocket] = useState(null);
  const [room] = useState('bd-us-room'); // Unique room for Bangladesh-to-US calls
  const [users, setUsers] = useState([]);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [myId] = useState(generateNewUserId());
  const [mySocketId, setMySocketId] = useState('');
  const [callStatus, setCallStatus] = useState('Idle');
  const [inRoom, setInRoom] = useState(true);
  const [incomingCall, setIncomingCall] = useState(null);

  useEffect(() => {
    // Replace with your deployed server URL
    const serverUrl = import.meta.env.VITE_API_URL || 'https://your-app-name.herokuapp.com';
    const newSocket = io(serverUrl, {
      transports: ['websocket'],
      secure: true,
      reconnection: true,
    });
    setSocket(newSocket);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // Free STUN server
        { urls: 'stun:stun1.l.google.com:19302' }, // Additional STUN server
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp', // TURN with TCP for better NAT traversal
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    });
    setPeerConnection(pc);

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localVideoRef.current.srcObject = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      })
      .catch((err) => toast.error('Camera/microphone access failed: ' + err.message));

    pc.ontrack = (event) => {
      remoteVideoRef.current.srcObject = event.streams[0];
      setCallStatus('Connected');
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && remoteVideoRef.current?.peerId) {
        newSocket.emit('ice-candidate', {
          candidate: event.candidate,
          to: remoteVideoRef.current.peerId,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'failed') {
        setCallStatus('Idle');
        toast.error('Call connection failed');
      }
    };

    newSocket.on('connect', () => {
      setMySocketId(newSocket.id);
      if (inRoom) newSocket.emit('join', { room, userId: myId });
    });

    newSocket.on('connect_error', (error) => toast.error('Server connection failed: ' + error.message));
    newSocket.on('new-user-joined', (data) => toast.info(`${data.userId} joined the room`));
    newSocket.on('connected-users', setConnectedUsers);
    newSocket.on('room-users', (userData) => setUsers(userData.filter((u) => u.userId !== myId)));
    newSocket.on('offer', (data) => {
      setIncomingCall(data);
      setCallStatus('Receiving Offer');
    });
    newSocket.on('answer', (answer) => {
      pc.setRemoteDescription(new RTCSessionDescription(answer));
      setCallStatus('Connected');
    });
    newSocket.on('ice-candidate', (candidate) => pc.addIceCandidate(new RTCIceCandidate(candidate)));
    newSocket.on('call-declined', () => {
      setCallStatus('Idle');
      setIncomingCall(null);
      toast.error('Call declined');
    });
    newSocket.on('call-failed', (data) => {
      setCallStatus('Idle');
      toast.error(data.reason);
    });
    newSocket.on('user-disconnected', (userId) => {
      if (remoteVideoRef.current?.peerId === userId) {
        remoteVideoRef.current.srcObject = null;
        setCallStatus('Idle');
      }
    });

    return () => {
      if (localVideoRef.current?.srcObject) {
        localVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
      pc.close();
      newSocket.disconnect();
    };
  }, [room, myId, inRoom]);

  const createOffer = async (targetUserId) => {
    setCallStatus('Offering');
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { offer, to: targetUserId, from: myId });
      remoteVideoRef.current.peerId = targetUserId;
    } catch (err) {
      setCallStatus('Idle');
      toast.error('Failed to create offer: ' + err.message);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', { answer, to: incomingCall.from });
      remoteVideoRef.current.peerId = incomingCall.from;
      setIncomingCall(null);
      setCallStatus('Connected');
    } catch (err) {
      setCallStatus('Idle');
      toast.error('Failed to accept call: ' + err.message);
    }
  };

  const declineCall = () => {
    socket.emit('call-declined', { to: incomingCall.from });
    setIncomingCall(null);
    setCallStatus('Idle');
  };

  const leaveRoom = () => {
    socket.emit('leave', { room, userId: myId });
    setInRoom(false);
    setUsers([]);
    setCallStatus('Idle');
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

  const joinRoom = () => {
    socket.emit('join', { room, userId: myId });
    setInRoom(true);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Bangladesh to US Video Call</h1>
      <div style={{ display: 'flex', gap: '20px' }}>
        <div>
          <h3>Local Video (You)</h3>
          <video ref={localVideoRef} autoPlay muted style={{ width: '300px', border: '1px solid #ccc' }} />
        </div>
        <div>
          <h3>Remote Video (Friend)</h3>
          <video ref={remoteVideoRef} autoPlay style={{ width: '300px', border: '1px solid #ccc' }} />
        </div>
      </div>
      <h2>Call Status: {callStatus}</h2>
      {incomingCall && (
        <div>
          <p>Incoming call from {incomingCall.from}</p>
          <button onClick={acceptCall} style={{ marginRight: '10px' }}>Accept</button>
          <button onClick={declineCall}>Decline</button>
        </div>
      )}
      <h2>Users in Room</h2>
      {inRoom ? (
        <>
          {users.length > 0 ? (
            <ul>
              {users.map((entry) => (
                <li key={entry.userId}>
                  {entry.userId}
                  <button
                    onClick={() => createOffer(entry.userId)}
                    disabled={callStatus !== 'Idle'}
                    style={{ marginLeft: '10px' }}
                  >
                    Call
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Waiting for someone to join...</p>
          )}
          <button onClick={leaveRoom}>Leave Room</button>
        </>
      ) : (
        <button onClick={joinRoom}>Join Room</button>
      )}
      <p>Your ID: {myId} (Socket: {mySocketId || 'Connecting...'})</p>
      <ToastContainer />
    </div>
  );
};

export default VideoCall;