const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Database Setup
const db = new sqlite3.Database('./game.db');

db.serialize(() => {
  // Users Table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT UNIQUE,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    balance REAL DEFAULT 0.0
  )`);

  // Transactions Table
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    amount REAL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Game History Table
  db.run(`CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Admin Account (Initial Setup)
  db.get("SELECT * FROM users WHERE username = 'admin'", async (err, row) => {
    if (!row) {
      const hash = await bcrypt.hash('admin123', 10);
      db.run("INSERT INTO users (player_id, username, password, role, balance) VALUES (?, ?, ?, ?, ?)",
        ['PID-ADMIN', 'admin', hash, 'admin', 1000000]);
    }
  });
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: 'demo_secret_key_12345',
  resave: false,
  saveUninitialized: false
});
app.use(sessionMiddleware);

// Socket.io Middleware for Session Access
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Function to Generate Unique 6-Digit Player ID
function generatePlayerID() {
  return 'PID-' + Math.floor(100000 + Math.random() * 900000);
}

// REST APIs

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and Password required' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const playerId = generatePlayerID();

    db.run("INSERT INTO users (player_id, username, password) VALUES (?, ?, ?)",
      [playerId, username, hash], function(err) {
        if (err) return res.status(400).json({ error: 'Username already exists' });
        res.json({ success: true, message: 'Account registered successfully!' });
      });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    req.session.role = user.role;
    res.json({ success: true, user: { id: user.id, player_id: user.player_id, username: user.username, role: user.role, balance: user.balance } });
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get Current User Profile
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

  db.get("SELECT id, player_id, username, role, balance FROM users WHERE id = ?", [req.session.userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });
});

// Request Deposit / Withdraw
app.post('/api/request-transaction', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

  const { type, amount } = req.body;
  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  if (type === 'withdraw') {
    db.get("SELECT balance FROM users WHERE id = ?", [req.session.userId], (err, user) => {
      if (user.balance < parsedAmount) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }
      createTx();
    });
  } else {
    createTx();
  }

  function createTx() {
    db.run("INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)",
      [req.session.userId, type, parsedAmount], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to place request' });
        res.json({ success: true, message: 'Request submitted for Admin review.' });
      });
  }
});

// User History
app.get('/api/my-history', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

  db.all("SELECT type, amount, status, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC", [req.session.userId], (err, rows) => {
    res.json(rows || []);
  });
});

// --- ADMIN ENDPOINTS ---

function isAdmin(req, res, next) {
  if (req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// Get Pending Transactions
app.get('/api/admin/pending-transactions', isAdmin, (req, res) => {
  db.all(`SELECT t.id, u.username, u.player_id, t.type, t.amount, t.created_at 
          FROM transactions t JOIN users u ON t.user_id = u.id 
          WHERE t.status = 'pending'`, (err, rows) => {
    res.json(rows || []);
  });
});

// Approve Transaction
app.post('/api/admin/approve-transaction', isAdmin, (req, res) => {
  const { txId } = req.body;

  db.get("SELECT * FROM transactions WHERE id = ? AND status = 'pending'", [txId], (err, tx) => {
    if (!tx) return res.status(404).json({ error: 'Transaction not found or already processed' });

    db.get("SELECT balance FROM users WHERE id = ?", [tx.user_id], (err, user) => {
      let newBalance = user.balance;

      if (tx.type === 'deposit') {
        newBalance += tx.amount;
      } else if (tx.type === 'withdraw') {
        if (user.balance < tx.amount) {
          return res.status(400).json({ error: 'User has insufficient balance now' });
        }
        newBalance -= tx.amount;
      }

      db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, tx.user_id], () => {
        db.run("UPDATE transactions SET status = 'approved' WHERE id = ?", [txId], () => {
          res.json({ success: true, message: 'Transaction Approved' });
        });
      });
    });
  });
});

// Direct Unit Transfer by Admin
app.post('/api/admin/direct-transfer', isAdmin, (req, res) => {
  const { playerId, amount } = req.body;
  const parsedAmount = parseFloat(amount);

  db.get("SELECT id, balance FROM users WHERE player_id = ?", [playerId], (err, targetUser) => {
    if (!targetUser) return res.status(404).json({ error: 'Player ID not found' });

    const newBalance = targetUser.balance + parsedAmount;
    if (newBalance < 0) return res.status(400).json({ error: 'Balance cannot go below zero' });

    db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, targetUser.id], () => {
      db.run("INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, 'approved')",
        [targetUser.id, parsedAmount >= 0 ? 'admin_credit' : 'admin_debit', Math.abs(parsedAmount)]);
      res.json({ success: true, message: 'Units updated successfully' });
    });
  });
});

// --- SERVER-SIDE GAME ENGINE ---

let gameRound = 1;
let timer = 15; // 15 seconds per round
let currentBets = []; // { userId, choice ('RED'|'BLUE'), amount }

setInterval(() => {
  timer--;

  if (timer <= 0) {
    // Resolve Game Round
    const result = Math.random() < 0.5 ? 'RED' : 'BLUE';
    
    // Process Bets
    currentBets.forEach(bet => {
      const isWin = bet.choice === result;
      const winAmount = isWin ? bet.amount * 2 : 0;

      if (isWin) {
        db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [winAmount, bet.userId]);
      }

      // Send result popup to individual users
      io.to(`user_${bet.userId}`).emit('roundResult', {
        win: isWin,
        amount: isWin ? winAmount : bet.amount,
        resultChoice: result
      });
    });

    db.run("INSERT INTO game_history (round_id, result) VALUES (?, ?)", [gameRound, result]);

    io.emit('gameFinished', { round: gameRound, result });

    // Reset for next round
    gameRound++;
    timer = 15;
    currentBets = [];
  }

  io.emit('timerUpdate', { round: gameRound, timer });
}, 1000);

// --- SOCKET.IO CONNECTIONS ---

io.on('connection', (socket) => {
  const sessionData = socket.request.session;
  if (sessionData && sessionData.userId) {
    socket.join(`user_${sessionData.userId}`);
  }

  socket.on('placeBet', (data) => {
    const userId = sessionData ? sessionData.userId : null;
    if (!userId) return socket.emit('errorMsg', 'Please log in first.');

    if (timer <= 3) return socket.emit('errorMsg', 'Betting closed for this round!');

    const { choice, amount } = data;
    const betAmount = parseFloat(amount);

    if (!['RED', 'BLUE'].includes(choice) || isNaN(betAmount) || betAmount <= 0) {
      return socket.emit('errorMsg', 'Invalid bet parameters.');
    }

    db.get("SELECT balance FROM users WHERE id = ?", [userId], (err, user) => {
      if (err || !user || user.balance < betAmount) {
        return socket.emit('errorMsg', 'Insufficient Unit Balance!');
      }

      // Deduct balance immediately upon placing bet
      db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [betAmount, userId], () => {
        currentBets.push({ userId, choice, amount: betAmount });
        socket.emit('betConfirmed', { choice, amount: betAmount });
      });
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

