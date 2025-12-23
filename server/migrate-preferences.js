// Migration script to add user_preferences table
// Run this once to add the preferences table to existing databases

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const dbPath = isProduction
    ? '/data/database.sqlite'
    : path.join(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        process.exit(1);
    } else {
        console.log(`Connected to SQLite database at ${dbPath}`);
        runMigration();
    }
});

function runMigration() {
    db.serialize(() => {
        // Create user_preferences table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
            user_id INTEGER PRIMARY KEY,
            four_color_mode INTEGER DEFAULT 0,
            auto_pass INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`, (err) => {
            if (err) {
                console.error('Error creating user_preferences table:', err);
                process.exit(1);
            } else {
                console.log('✓ user_preferences table created/verified');
            }
        });

        // Initialize preferences for existing users
        db.run(`INSERT OR IGNORE INTO user_preferences (user_id)
                SELECT id FROM users`, (err) => {
            if (err) {
                console.error('Error initializing preferences:', err);
                process.exit(1);
            } else {
                console.log('✓ Preferences initialized for existing users');
            }
        });

        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
                process.exit(1);
            } else {
                console.log('✓ Migration complete!');
                process.exit(0);
            }
        });
    });
}
