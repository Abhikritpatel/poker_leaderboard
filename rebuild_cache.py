import json

def rebuild_leaderboard():
    print("Loading database...")
    try:
        with open('database.json', 'r') as f:
            db = json.load(f)
    except Exception as e:
        print(f"Error loading database: {e}")
        return

    # 1. Nuke the corrupted cache
    print("Clearing current leaderboard cache...")
    db['players'] = {}

    # 2. Recalculate everything from the Source of Truth
    print("Recalculating scores from game history...")
    for game in db.get('games', []):
        for player in game.get('transactions', []):
            name = player.get('name', '').lower().strip()
            profit = player.get('profit_inr', 0.0)
            buy_ins = player.get('buy_ins', 0)

            # Initialize player if they don't exist yet
            if name not in db['players']:
                db['players'][name] = {
                    "total_winning": 0.0,
                    "all_time_total_buy_ins": 0
                }
            
            # Add the stats
            db['players'][name]['total_winning'] += profit
            db['players'][name]['all_time_total_buy_ins'] += buy_ins

    # Round all the floats to prevent trailing decimals (e.g. 10.0000000001)
    for name, stats in db['players'].items():
        stats['total_winning'] = round(stats['total_winning'], 2)

    # 3. Save the repaired database
    with open('database.json', 'w') as f:
        json.dump(db, f, indent=2)
    
    print("Success! Leaderboard cache has been perfectly rebuilt.")

if __name__ == "__main__":
    rebuild_leaderboard()