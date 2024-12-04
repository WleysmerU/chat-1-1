const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server); // Asegúrate de que esto esté aquí

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Para servir archivos estáticos

const users = {}; // Almacenamos usuarios en memoria (no persistente)

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
    console.log('Nuevo usuario conectado');

    let username = '';

    socket.on('join room', (data) => {
        username = data.username;
        socket.join(data.room);
        console.log(`${username} se unió a la sala: ${data.room}`);
    });

    socket.on('leave room', (room) => {
        socket.leave(room);
        console.log(`${username} salió de la sala: ${room}`);
    });

    socket.on('chat message', (data) => {
        io.to(data.room).emit('chat message', { user: username, msg: data.msg });
    });

    socket.on('register', (data) => {
        if (users[data.username]) {
            socket.emit('register response', { success: false, message: 'Usuario ya existe' });
        } else {
            users[data.username] = data.password; // Guardar usuario
            socket.emit('register response', { success: true, message: 'Registro exitoso' });
        }
    });

    socket.on('login', (data) => {
        if (users[data.username] && users[data.username] === data.password) {
            socket.emit('login response', { success: true, username: data.username });
        } else {
            socket.emit('login response', { success: false, message: 'Credenciales incorrectas' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`${username} desconectado`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
