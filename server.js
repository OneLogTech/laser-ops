const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: '*' }
});

const players = {};
const enemies = [];

io.on('connection', (socket) => {
    console.log('Nouveau joueur connecté:', socket.id);

    players[socket.id] = { position: { x: 0, y: 1.6, z: 0 }, score: 0 };

    socket.emit('init', { id: socket.id, players, enemies });

    socket.on('player-update', (data) => {
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            socket.broadcast.emit('player-update', { id: socket.id, position: data.position });
        }
    });

    socket.on('shoot', (data) => {
        socket.broadcast.emit('shoot', data);
    });

    socket.on('enemy-spawn', (data) => {
        enemies.push(data);
        socket.broadcast.emit('enemy-spawn', data);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        socket.broadcast.emit('player-disconnect', socket.id);
        console.log('Joueur déconnecté:', socket.id);
    });
});

http.listen(3000, () => {
    console.log('Serveur sur http://localhost:3000');
});
