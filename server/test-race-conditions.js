// Test script for race condition fixes
// Run this with: node test-race-conditions.js

const io = require('socket.io-client');

// Connect to local server
const SERVER_URL = 'http://localhost:3000';

class TestClient {
    constructor(name) {
        this.name = name;
        this.socket = null;
        this.hand = [];
        this.gameState = null;
    }

    connect() {
        return new Promise((resolve) => {
            this.socket = io(SERVER_URL);

            this.socket.on('connect', () => {
                console.log(`[${this.name}] Connected`);
                resolve();
            });

            this.socket.on('hand_update', (hand) => {
                this.hand = hand;
                console.log(`[${this.name}] Hand updated: ${hand.length} cards`);
            });

            this.socket.on('game_update', (state) => {
                this.gameState = state;
                if (state.trickWinPending) {
                    console.log(`[${this.name}] TRICK WIN PENDING - Should block actions`);
                }
            });

            this.socket.on('error', (msg) => {
                console.log(`[${this.name}] ERROR: ${msg}`);
            });
        });
    }

    register() {
        return new Promise((resolve) => {
            const username = `test_${this.name}_${Date.now()}`;
            this.socket.emit('register', { username, password: 'test123' });
            this.socket.once('register_response', (response) => {
                if (response.success) {
                    console.log(`[${this.name}] Registered as ${username}`);
                    this.username = username;
                    resolve();
                }
            });
        });
    }

    login() {
        return new Promise((resolve) => {
            this.socket.emit('login', { username: this.username, password: 'test123' });
            this.socket.once('login_response', (response) => {
                if (response.success) {
                    console.log(`[${this.name}] Logged in`);
                    resolve();
                }
            });
        });
    }

    joinRoom(roomId) {
        return new Promise((resolve) => {
            this.socket.emit('join_room', { roomId, username: this.username });
            this.socket.once('room_update', () => {
                console.log(`[${this.name}] Joined room ${roomId}`);
                resolve();
            });
        });
    }

    startGame() {
        this.socket.emit('start_game', {});
    }

    // Attempt to play during trick win delay
    rapidPlay() {
        console.log(`[${this.name}] Attempting rapid plays to test race conditions...`);

        // Try to play multiple times rapidly
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                if (this.hand.length > 0) {
                    const card = this.hand[0];
                    console.log(`[${this.name}] Attempt ${i + 1}: Playing card during potential delay`);
                    this.socket.emit('play_card', {
                        roomId: this.gameState?.id,
                        cards: [card]
                    });
                }
            }, i * 100); // Stagger attempts by 100ms
        }
    }

    // Attempt to pass during trick win delay
    rapidPass() {
        console.log(`[${this.name}] Attempting rapid passes to test race conditions...`);

        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                console.log(`[${this.name}] Attempt ${i + 1}: Passing during potential delay`);
                this.socket.emit('pass_turn', {
                    roomId: this.gameState?.id
                });
            }, i * 100);
        }
    }

    disconnect() {
        this.socket.disconnect();
        console.log(`[${this.name}] Disconnected`);
    }
}

async function runTest() {
    console.log('=== RACE CONDITION TEST SUITE ===\n');
    console.log('This test will:');
    console.log('1. Create a game room with one human player');
    console.log('2. Start the game (bots will be added)');
    console.log('3. Attempt rapid plays/passes during trick win delays');
    console.log('4. Verify that actions are properly blocked\n');

    const client = new TestClient('Player1');

    try {
        // Setup
        await client.connect();
        await client.register();
        await client.login();

        const roomId = `test_${Date.now()}`;
        await client.joinRoom(roomId);

        console.log('\nStarting game...\n');
        client.startGame();

        // Wait for game to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Monitor for trick wins and test race conditions
        client.socket.on('game_update', (state) => {
            if (state.trickWinPending) {
                console.log('\n!!! TRICK WIN DETECTED - TESTING RACE CONDITIONS !!!\n');

                // Immediately try to play/pass during the delay
                client.rapidPlay();
                client.rapidPass();
            }
        });

        // Let the game run for a while to catch trick wins
        console.log('\nMonitoring game for trick wins (30 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 30000));

        console.log('\n=== TEST COMPLETE ===');
        console.log('Check the logs above for any ERROR messages.');
        console.log('Expected: "Wait for current trick to clear" errors during delays');
        console.log('If no errors occurred during trick wins, the race conditions are fixed!\n');

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        client.disconnect();
        process.exit(0);
    }
}

// Run the test
runTest().catch(console.error);