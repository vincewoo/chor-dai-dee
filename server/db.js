// server/db.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// Use /data directory in production (Fly.io volume mount), local directory otherwise
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = isProduction
    ? '/data/database.sqlite'
    : path.join(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log(`Connected to SQLite database at ${dbPath}`);
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT
        )`);

        // Stats Table
        db.run(`CREATE TABLE IF NOT EXISTS stats (
            user_id INTEGER PRIMARY KEY,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            points INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            elo INTEGER DEFAULT 1200,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
    });
}

const createUser = async (username, password) => {
    const hash = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, [username, hash], function(err) {
            if (err) return reject(err);
            const userId = this.lastID;
            // Initialize stats
            db.run(`INSERT INTO stats (user_id) VALUES (?)`, [userId], (err) => {
                if (err) return reject(err);
                resolve({ id: userId, username });
            });
        });
    });
};

const verifyUser = async (username, password) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            const match = await bcrypt.compare(password, row.password_hash);
            if (match) resolve({ id: row.id, username: row.username });
            else resolve(null);
        });
    });
};

const getUserStats = (username) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT s.*, u.username FROM stats s JOIN users u ON u.id = s.user_id WHERE u.username = ?`, [username], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
};

const updateUserStats = (userId, isWin, pointsDelta) => {
    return new Promise((resolve, reject) => {
        const winInc = isWin ? 1 : 0;
        const lossInc = isWin ? 0 : 1;
        db.run(`UPDATE stats SET
            wins = wins + ?,
            losses = losses + ?,
            points = points + ?,
            games_played = games_played + 1
            WHERE user_id = ?`,
            [winInc, lossInc, pointsDelta, userId],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

const updateUserStatsByName = (username, isWin, pointsDelta) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject('User not found');
            updateUserStats(row.id, isWin, pointsDelta).then(resolve).catch(reject);
        });
    });
};

module.exports = { db, createUser, verifyUser, getUserStats, updateUserStats, updateUserStatsByName };
