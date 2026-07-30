import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAllVoiceLevels,
  clearVoiceLevel,
  getVoiceLevel,
  setVoiceLevel,
  subscribeToVoiceLevel
} from '../src/contexts/voiceLevelStore.js';

test.beforeEach(() => {
  clearAllVoiceLevels();
});

test('voice levels notify only the matching user', () => {
  let aliceNotifications = 0;
  let bobNotifications = 0;
  const unsubscribeAlice = subscribeToVoiceLevel('alice', () => {
    aliceNotifications += 1;
  });
  const unsubscribeBob = subscribeToVoiceLevel('bob', () => {
    bobNotifications += 1;
  });

  setVoiceLevel('alice', 0.3);

  assert.equal(aliceNotifications, 1);
  assert.equal(bobNotifications, 0);
  assert.equal(getVoiceLevel('alice'), 0.3);
  assert.equal(getVoiceLevel('bob'), 0);

  unsubscribeAlice();
  unsubscribeBob();
});

test('silent and visually insignificant samples do not notify React', () => {
  let notifications = 0;
  const unsubscribe = subscribeToVoiceLevel('alice', () => {
    notifications += 1;
  });

  setVoiceLevel('alice', 0);
  setVoiceLevel('alice', 0.01);
  assert.equal(notifications, 0);

  setVoiceLevel('alice', 0.3);
  setVoiceLevel('alice', 0.31);
  assert.equal(notifications, 1);
  assert.equal(getVoiceLevel('alice'), 0.3);

  unsubscribe();
});

test('display-threshold crossings always notify and clearing resets the meter', () => {
  let notifications = 0;
  const unsubscribe = subscribeToVoiceLevel('alice', () => {
    notifications += 1;
  });

  setVoiceLevel('alice', 0.04);
  setVoiceLevel('alice', 0.051);
  assert.equal(notifications, 2);
  assert.equal(getVoiceLevel('alice'), 0.051);

  clearVoiceLevel('alice');
  assert.equal(notifications, 3);
  assert.equal(getVoiceLevel('alice'), 0);

  unsubscribe();
});
