// Se importan los módulos necesarios para el servidor
const express = require('express'); // Framework para crear aplicaciones web
const http = require('http'); // Para crear un servidor HTTP
const socketIo = require('socket.io'); // Para manejar las conexiones WebSocket
const mysql = require('mysql'); // Para interactuar con la base de datos MySQL

// Inicialización de las aplicaciones
const app = express(); // Crea la aplicación Express
const server = http.createServer(app); // Crea un servidor HTTP con la app Express
const io = socketIo(server); // Asocia Socket.IO al servidor para manejar conexiones en tiempo real

// Middlewares para procesar las solicitudes
app.use(express.json()); // Permite leer datos en formato JSON en las solicitudes
app.use(express.urlencoded({ extended: true })); // Permite procesar datos enviados en formularios HTML
app.use(express.static('public')); // Sirve archivos estáticos desde la carpeta 'public'

// Configuración de la base de datos MySQL
const db = mysql.createConnection({
    host: 'localhost', // Servidor de la base de datos
    user: 'root', // Usuario para acceder a la base de datos
    password: '', // Contraseña del usuario
    database: 'chat_app', // Nombre de la base de datos
});

// Datos de las credenciales de administrador para el login
const adminCredentials = { username: 'admin', password: 'admin123' };

// Conexión a la base de datos MySQL
db.connect((err) => {
    if (err) {
        console.error('Error al conectar a la base de datos:', err); // Si hay error al conectar
        return;
    }
    console.log('Conectado a la base de datos MySQL'); // Si la conexión es exitosa
});

// Definición de estructuras para manejar las salas y usuarios
const rooms = {}; // Objeto para manejar las salas de chat
const onlineUsers = {}; // Objeto para manejar los usuarios conectados

// Ruta principal que sirve la página de inicio (HTML)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html'); // Sirve el archivo index.html desde la carpeta 'public'
});

// Ruta para la página de administración
app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/public/admin.html'); // Sirve la página admin.html
});

// Manejo de las conexiones WebSocket
io.on('connection', (socket) => {
    console.log('Nuevo usuario conectado'); // Cuando un nuevo usuario se conecta
    let username = ''; // Variable para almacenar el nombre de usuario
    let currentRoom = ''; // Variable para almacenar la sala actual

    // Evento cuando un usuario se une a una sala
    socket.on('join room', (data) => {
        username = data.username; // Se asigna el nombre de usuario
        const room = data.room; // Se asigna la sala a la que se unirá

        onlineUsers[socket.id] = username; // Se agrega el usuario a la lista de usuarios online

        const roomName = [username, room].sort().join('-'); // Se crea un nombre único para la sala (combina usuario y sala)

        if (!rooms[roomName]) {
            rooms[roomName] = []; // Si la sala no existe, se crea
        }

        // Verifica si la sala está llena (solo permite 2 usuarios por sala)
        if (rooms[roomName].length >= 2) {
            socket.emit('room full', { msg: 'La sala está llena. Solo pueden unirse 2 usuarios.' });
            return;
        }

        rooms[roomName].push(username); // Agrega el usuario a la sala
        currentRoom = roomName; // Asigna la sala actual al usuario
        socket.join(roomName); // Hace que el usuario se una a la sala

        console.log(`${username} se unió a la sala: ${roomName}`);

        // Envia un mensaje a la sala notificando que un nuevo usuario se unió
        socket.to(roomName).emit('chat message', { user: 'Usuario: ', msg: `${username} se ha unido a la sala.` });

        // Carga los mensajes previos de la sala desde la base de datos
        db.query('SELECT username, message FROM messages WHERE room = ?', [roomName], (err, results) => {
            if (err) {
                console.error('Error al cargar mensajes:', err);
                return;
            }
            socket.emit('previous messages', results); // Envía los mensajes anteriores al usuario
        });

        // Actualiza la lista de usuarios online en todas las conexiones
        io.emit('user list', Object.values(onlineUsers));
    });

    // Evento cuando un usuario abandona la sala
    socket.on('leave room', () => {
        if (currentRoom) {
            socket.leave(currentRoom); // El usuario deja la sala
            console.log(`${username} salió de la sala: ${currentRoom}`);
            rooms[currentRoom] = rooms[currentRoom].filter(user => user !== username); // Elimina al usuario de la sala
            socket.to(currentRoom).emit('chat message', { user: 'Sistema', msg: `${username} ha salido de la sala.` });
            currentRoom = ''; // Resetea la sala actual
        }
    });

    // Evento para recibir mensajes del chat
    socket.on('chat message', (data) => {
        if (rooms[currentRoom] && rooms[currentRoom].includes(username)) { // Verifica si el usuario está en la sala
            io.to(currentRoom).emit('chat message', { user: username, msg: data.msg }); // Envía el mensaje a la sala

            // Guarda el mensaje en la base de datos
            const messageData = { room: currentRoom, username: username, message: data.msg };
            db.query('INSERT INTO messages SET ?', messageData, (err) => {
                if (err) {
                    console.error('Error al guardar el mensaje:', err);
                }
            });
        } else {
            socket.emit('message denied', { msg: 'No tienes permiso para enviar mensajes en esta sala.' });
        }
    });

    // Evento para cargar los mensajes de la sala actual
    socket.on('load messages', () => {
        if (currentRoom) {
            db.query('SELECT * FROM messages WHERE room = ? ORDER BY timestamp ASC', [currentRoom], (err, results) => {
                if (err) {
                    console.error('Error al cargar los mensajes:', err);
                    return;
                }
                socket.emit('previous messages', results); // Envía los mensajes previos al usuario
            });
        }
    });

    // Evento para obtener la lista de usuarios desde la base de datos
    socket.on('get user list', () => {
        db.query('SELECT username FROM users', (err, results) => {
            if (err) {
                console.error(err);
                return;
            }
            const usernames = results.map(user => user.username); // Extrae los nombres de usuario
            socket.emit('user list', usernames); // Envía la lista de usuarios
        });
    });

    // Evento para agregar un nuevo usuario (solo disponible para el admin)
    socket.on('add user', (data) => {
        const { username, password } = data;
        db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], (err) => {
            if (err) {
                socket.emit('admin response', { success: false, message: 'Usuario ya existe' });
            } else {
                socket.emit('admin response', { success: true, message: 'Usuario agregado' });
                io.emit('user list', [username]); // Actualiza la lista de usuarios online
            }
        });
    });

    // Evento para registrar un nuevo usuario
    socket.on('register', (data) => {
        const { username, password } = data;
        db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], (err) => {
            if (err) {
                socket.emit('register response', { success: false, message: 'Usuario ya existe' });
            } else {
                socket.emit('register response', { success: true, message: 'Registro exitoso' });
            }
        });
    });

    // Evento para el inicio de sesión de los usuarios
    socket.on('login', (data) => {
        const { username, password } = data;
        db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
            if (results.length > 0) {
                socket.emit('login response', { success: true, message: 'Inicio de sesión exitoso', username: data.username });
            } else {
                socket.emit('login response', { success: false, message: 'Credenciales incorrectas' });
            }
        });
    });

    // Evento para el inicio de sesión del administrador
    socket.on('admin login', (data) => {
        if (data.username === adminCredentials.username && data.password === adminCredentials.password) {
            socket.emit('admin login response', { success: true, message: 'Inicio de sesión de administrador exitoso' });
        } else {
            socket.emit('admin login response', { success: false, message: 'Credenciales de administrador incorrectas' });
        }
    });

    // Evento para eliminar un usuario (solo para el admin)
    socket.on('delete user', (username) => {
        db.query('DELETE FROM users WHERE username = ?', [username], (err) => {
            if (err) {
                socket.emit('admin response', { success: false, message: 'Error al eliminar usuario' });
            } else {
                socket.emit('admin response', { success: true, message: 'Usuario eliminado' });
                io.emit('user list', [username]); // Actualiza la lista de usuarios online
            }
        });
    });

    // Evento para desconectar un usuario
    socket.on('disconnect', () => {
        console.log('Usuario desconectado');
        delete onlineUsers[socket.id]; // Elimina al usuario de la lista de usuarios online
        io.emit('user list', Object.values(onlineUsers)); // Actualiza la lista de usuarios
    });
});

// Arranca el servidor en el puerto 3000
server.listen(3000, () => {
    console.log('Servidor escuchando en http://localhost:3000');
});
