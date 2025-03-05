const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const userSocketMap = new Map();
const connectedUsers = new Set();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join', ({ room, userId }) => {
    if (!room || !userId) {
      socket.emit('error', { message: 'Invalid room or userId' });
      return;
    }

    socket.join(room);
    userSocketMap.set(userId, socket.id);
    connectedUsers.add(userId);

    socket.to(room).emit('new-user-joined', { userId, socketId: socket.id });
    updateRoomUsers(room);
    updateConnectedUsers();
  });

  socket.on('leave', ({ room, userId }) => {
    if (!room || !userId) return;

    socket.leave(room);
    userSocketMap.delete(userId);
    connectedUsers.delete(userId);

    updateRoomUsers(room);
    updateConnectedUsers();
  });

  socket.on('offer', (data) => {
    const { offer, to, from } = data;
    const targetSocketId = userSocketMap.get(to);
    console.log(`Offer from ${from} (Socket: ${socket.id}) to ${to} (Target Socket: ${targetSocketId})`);
    if (targetSocketId) {
      socket.to(targetSocketId).emit('offer', {
        offer,
        from,
        fromSocketId: socket.id,
        timestamp: new Date().toLocaleString(),
      });
      console.log(`Offer sent to ${to}`);
    } else {
      console.error(`Target user ${to} not found`);
      socket.emit('call-failed', { reason: `User ${to} is not online.` });
    }
  });

  socket.on('answer', (data) => {
    const { answer, to } = data;
    const targetSocketId = userSocketMap.get(to);
    if (targetSocketId) {
      console.log(`Sending answer to ${to} (Socket: ${targetSocketId})`);
      socket.to(targetSocketId).emit('answer', answer);
    } else {
      console.error(`Target user ${to} not found for answer`);
    }
  });

  socket.on('ice-candidate', (data) => {
    const { candidate, to } = data;
    const targetSocketId = userSocketMap.get(to);
    if (targetSocketId) {
      console.log(`Sending ICE candidate to ${to} (Socket: ${targetSocketId})`);
      socket.to(targetSocketId).emit('ice-candidate', candidate);
    } else {
      console.error(`Target user ${to} not found for ICE candidate`);
    }
  });

  socket.on('call-declined', (data) => {
    const targetSocketId = userSocketMap.get(data.to);
    if (targetSocketId) {
      socket.to(targetSocketId).emit('call-declined');
    }
  });

  socket.on('disconnect', () => {
    const userId = Array.from(userSocketMap.entries())
      .find(([_, sid]) => sid === socket.id)?.[0];
    if (userId) {
      userSocketMap.delete(userId);
      connectedUsers.delete(userId);
      io.emit('user-disconnected', userId);

      socket.rooms.forEach((room) => {
        if (room !== socket.id) {
          updateRoomUsers(room);
        }
      });
      updateConnectedUsers();
    }
  });

  socket.on('error', (error) => {
    console.error(`Socket error: ${error}`);
  });
});

function updateRoomUsers(room) {
  const roomUsers = Array.from(io.sockets.adapter.rooms.get(room) || [])
    .map((socketId) => {
      const userId = Array.from(userSocketMap.entries())
        .find(([_, sid]) => sid === socketId)?.[0];
      return userId ? { userId, socketId } : null;
    })
    .filter(Boolean);
  io.to(room).emit('room-users', roomUsers);
}

function updateConnectedUsers() {
  const connectedUsersList = Array.from(connectedUsers).map((userId) => ({
    userId,
    socketId: userSocketMap.get(userId),
  }));
  io.emit('connected-users', connectedUsersList);
}

server.listen(5000, () => console.log('Server running on port 5000'));
