const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*', // Update to your frontend URL after deployment
    methods: ['GET', 'POST'],
  },
});

const userSocketMap = new Map();
const connectedUsers = new Set();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join', ({ room, userId }) => {
    if (!room || !userId) return socket.emit('error', 'Invalid room or userId');
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
    if (targetSocketId) {
      socket.to(targetSocketId).emit('offer', { offer, from, fromSocketId: socket.id });
    } else {
      socket.emit('call-failed', { reason: `User ${to} is not online.` });
    }
  });

  socket.on('answer', (data) => {
    const { answer, to } = data;
    const targetSocketId = userSocketMap.get(to);
    if (targetSocketId) socket.to(targetSocketId).emit('answer', answer);
  });

  socket.on('ice-candidate', (data) => {
    const { candidate, to } = data;
    const targetSocketId = userSocketMap.get(to);
    if (targetSocketId) socket.to(targetSocketId).emit('ice-candidate', candidate);
  });

  socket.on('call-declined', (data) => {
    const targetSocketId = userSocketMap.get(data.to);
    if (targetSocketId) socket.to(targetSocketId).emit('call-declined');
  });

  socket.on('disconnect', () => {
    const userId = [...userSocketMap.entries()].find(([_, sid]) => sid === socket.id)?.[0];
    if (userId) {
      userSocketMap.delete(userId);
      connectedUsers.delete(userId);
      io.emit('user-disconnected', userId);
      socket.rooms.forEach((room) => room !== socket.id && updateRoomUsers(room));
      updateConnectedUsers();
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

function updateRoomUsers(room) {
  const roomUsers = [...(io.sockets.adapter.rooms.get(room) || [])]
    .map((socketId) => {
      const userId = [...userSocketMap.entries()].find(([_, sid]) => sid === socketId)?.[0];
      return userId ? { userId, socketId } : null;
    })
    .filter(Boolean);
  io.to(room).emit('room-users', roomUsers);
}

function updateConnectedUsers() {
  const connectedUsersList = [...connectedUsers].map((userId) => ({
    userId,
    socketId: userSocketMap.get(userId),
  }));
  io.emit('connected-users', connectedUsersList);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));