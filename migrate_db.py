import json
import shutil

def migrate_database():
    print("Starting database migration...")
    
    # 1. Create a safe backup
    try:
        shutil.copy('database.json', 'database_backup.json')
        print("✅ Backup created: database_backup.json")
    except FileNotFoundError:
        print("❌ Error: database.json not found in this folder!")
        return

    with open('database.json', 'r') as f:
        db = json.load(f)

    print(f"Found {len(db.get('games', []))} games to process.")

    # 2. Standardize all game transactions
    for game in db.get('games', []):
        chip_ratio = game.get('chip_ratio', 5)
        merged_tx = {}
        
        for tx in game.get('transactions', []):
            name = tx.get('name', '').lower().strip()
            
            # Standardize buy_ins and end_chips
            buy_ins = tx.get('buy_ins', tx.get('buy_ins_this_game', 0))
            end_chips = tx.get('end_chips', 0)

            # Determine Profits based on the era of the game
            if 'winning_this_game' in tx:
                # OLD ERA: We have chips, need to calculate INR
                profit_chips = float(tx['winning_this_game'])
                profit_inr = profit_chips / chip_ratio
            else:
                # NEW ERA: We have INR, need to calculate chips
                profit_inr = float(tx.get('profit_inr', 0))
                profit_chips = profit_inr * chip_ratio

            # Initialize player in the merged dictionary if not present
            if name not in merged_tx:
                merged_tx[name] = {
                    "name": name,
                    "buy_ins": 0,
                    "end_chips": 0,
                    "profit_chips": 0.0,
                    "profit_inr": 0.0
                }

            # Add the stats (This merges duplicate entries perfectly)
            merged_tx[name]['buy_ins'] += int(buy_ins)
            merged_tx[name]['end_chips'] += float(end_chips)
            merged_tx[name]['profit_chips'] += profit_chips
            merged_tx[name]['profit_inr'] += profit_inr

        # Replace old transactions with the clean, standardized ones
        game['transactions'] = list(merged_tx.values())

    # 3. Recalculate the All-Time 'players' dictionary from scratch
    print("Recalculating all-time player statistics...")
    new_players = {}
    
    for game in db['games']:
        for tx in game['transactions']:
            name = tx['name']
            
            if name not in new_players:
                new_players[name] = {
                    "total_winning": 0.0, 
                    "all_time_total_buy_ins": 0
                }
                
            # We standardize the leaderboard purely on INR
            new_players[name]["total_winning"] += tx["profit_inr"]
            new_players[name]["all_time_total_buy_ins"] += tx["buy_ins"]

    db['players'] = new_players

    # 4. Save the beautifully clean database
    with open('database.json', 'w') as f:
        json.dump(db, f, indent=2)

    print("✅ Migration complete! Your database.json is now perfectly standardized.")

if __name__ == "__main__":
    migrate_database()