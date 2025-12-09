
import sys
import json
import numpy as np
import tensorflow.compat.v1 as tf
tf.disable_v2_behavior()
import joblib
import os

# Set working directory to script location BEFORE importing game logic
# This is required because enumerateOptions.py loads a pickle file on import
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

# Import the game logic modules
import big2Game
import gameLogic
import enumerateOptions
from PPONetwork import PPONetwork

def convert_card_to_int(rank, suit):
    """
    Convert rank/suit to the integer format used by big2Game.
    """

    # Rank map
    rank_map = {
        '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8,
        'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13
    }

    # Suit map
    suit_map = {'D': 1, 'C': 2, 'H': 3, 'S': 0}

    if suit == 'S':
        suit_val = 4
    else:
        suit_val = suit_map[suit]

    base = rank_map[rank]
    return int((base - 1) * 4 + suit_val)

def int_to_card(val):
    """Convert integer back to rank/suit"""
    # Inverse of (base-1)*4 + suit
    # suit = val % 4. If 0, it is Spades (4).
    suit_val = val % 4
    if suit_val == 0:
        suit_val = 4

    base = int(np.ceil(val / 4.0))

    ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']
    suits = {1: 'D', 2: 'C', 3: 'H', 4: 'S'}

    return {'rank': ranks[base-1], 'suit': suits[suit_val]}

def reconstruct_game_state(game_data, game_instance):
    """
    Reconstructs the neural network inputs based on the provided game data.
    """

    # 1. Setup Hand
    my_hand_ints = []
    for c in game_data['hand']:
        my_hand_ints.append(convert_card_to_int(c['rank'], c['suit']))

    game_instance.currentHands[1] = np.array(my_hand_ints)

    # Mock other players hands with dummy cards matching counts
    counts = game_data.get('opponentCardCounts', [13, 13, 13])
    game_instance.currentHands[2] = np.arange(1, counts[0] + 1)
    game_instance.currentHands[3] = np.arange(1, counts[1] + 1)
    game_instance.currentHands[4] = np.arange(1, counts[2] + 1)

    # 2. Setup Played Cards (Global History)
    game_instance.neuralNetworkInputs[1].fill(0)
    game_instance.fillNeuralNetworkHand(1)

    # 3. Setup Previous Hand (Context)
    last_hand = game_data.get('lastPlayedHand')

    if last_hand:
        rel_player = game_data.get('lastPlayedByRelative', 3)

        abs_player = 0
        if rel_player == 1: abs_player = 2
        elif rel_player == 2: abs_player = 3
        elif rel_player == 3: abs_player = 4

        prev_hand_ints = []
        for c in last_hand['cards']:
            prev_hand_ints.append(convert_card_to_int(c['rank'], c['suit']))

        prev_hand_np = np.array(prev_hand_ints)

        game_instance.control = 0
        game_instance.passCount = game_data.get('passCount', 0)

        game_instance.updateNeuralNetworkInputs(prev_hand_np, abs_player)

    else:
        # Free play / Control
        game_instance.control = 1
        game_instance.passCount = 0

        inp = game_instance.neuralNetworkInputs[1]

        # Opponent counts manually set for free play scenario
        inp[286 + len(game_instance.currentHands[2]) - 1] = 1
        inp[313 + len(game_instance.currentHands[3]) - 1] = 1
        inp[340 + len(game_instance.currentHands[4]) - 1] = 1

        played_cards_all = game_data.get('playedCards', [])
        for pc in played_cards_all:
            val = convert_card_to_int(pc['rank'], pc['suit'])
            if val >= 37 and val <= 52:
                idx = 367 + (val - 37)
                if idx < 412:
                    inp[idx] = 1

    # Ensure "Players Go" is set to 1 (Us)
    game_instance.playersGo = 1

def main():
    # Load Model
    sess = tf.Session()
    # Initialize game to get dimensions
    game = big2Game.big2Game()

    # Load network
    # inpDim = 412, actDim = 1695
    network = PPONetwork(sess, 412, 1695, "trainNet")

    # Initialize variables
    sess.run(tf.global_variables_initializer())

    # Load weights
    params = joblib.load('modelParameters136500')
    network.loadParams(params)

    # Read input from stdin
    try:
        input_str = sys.stdin.read()
        if not input_str:
            return

        data = json.loads(input_str)

        # Setup game state
        reconstruct_game_state(data, game)

        if game.control == 0:
            last_hand_data = data.get('lastPlayedHand')
            if last_hand_data:
                cards = []
                for c in last_hand_data['cards']:
                    cards.append(convert_card_to_int(c['rank'], c['suit']))

                # Mock a handPlayed object
                game.goIndex = 2
                game.handsPlayed[1] = big2Game.handPlayed(np.array(cards), 2)

        pGo, cState, availAcs = game.getCurrentState()

        # Run Inference
        action, value, neglogp = network.step(np.squeeze(cState).reshape(1, -1), np.squeeze(availAcs).reshape(1, -1))

        selected_action_idx = action[0]

        # Decode Action
        opt, nCards = enumerateOptions.getOptionNC(selected_action_idx)

        if opt == -1:
            print(json.dumps({"action": "pass"}))
        else:
            curr_hand = game.currentHands[1]
            final_cards = []

            if nCards == 1:
                card_int = curr_hand[opt]
                final_cards.append(int_to_card(card_int))
            elif nCards == 2:
                indices = enumerateOptions.inverseTwoCardIndices[opt]
                vals = curr_hand[list(indices)]
                for v in vals: final_cards.append(int_to_card(v))
            elif nCards == 3:
                indices = enumerateOptions.inverseThreeCardIndices[opt]
                vals = curr_hand[list(indices)]
                for v in vals: final_cards.append(int_to_card(v))
            elif nCards == 4:
                indices = enumerateOptions.inverseFourCardIndices[opt]
                vals = curr_hand[list(indices)]
                for v in vals: final_cards.append(int_to_card(v))
            elif nCards == 5:
                indices = enumerateOptions.inverseFiveCardIndices[opt]
                vals = curr_hand[list(indices)]
                for v in vals: final_cards.append(int_to_card(v))

            print(json.dumps({"action": "play", "cards": final_cards}))

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
