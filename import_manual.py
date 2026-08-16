import json
import uuid

def add_pure_profit_game(date, chip_data, chip_ratio=5):
    with open('database.json', 'r') as f:
        db = json.load(f)

    transactions = []
    
    for name, chips in chip_data.items():
        name = name.lower().strip()
        # Convert the chips you provided directly to INR
        profit_inr = float(chips) / chip_ratio
        
        transactions.append({
            "name": name,
            "buy_ins": 0,       # Data not available
            "end_chips": 0,     # Data not available
            "profit_chips": float(chips),
            "profit_inr": profit_inr
        })

    new_game = {
        "game_id": str(uuid.uuid4()),
        "date": date,
        "chip_ratio": chip_ratio,
        "transactions": transactions
    }

    # 1. Add to Games list
    db['games'].append(new_game)
    
    # 2. Update the Player Cache so the Leaderboard reflects this immediately
    for tx in transactions:
        p_name = tx['name']
        if p_name not in db['players']:
            db['players'][p_name] = {"total_winning": 0.0, "all_time_total_buy_ins": 0}
        
        db['players'][p_name]["total_winning"] += tx["profit_inr"]
        # all_time_total_buy_ins remains unchanged since we added 0

    with open('database.json', 'w') as f:
        json.dump(db, f, indent=2)
    
    print(f"✅ Successfully imported game for {date}!")

def add_detailed_game(date, player_data, chip_ratio=5):
    with open('database.json', 'r') as f:
        db = json.load(f)

    transactions = []
    total_buy_ins = 0
    
    for name, info in player_data.items():
        name = name.lower().strip()
        buy_ins = info['buy_ins']
        chips = info['chips']
        profit_inr = float(chips) / chip_ratio
        total_buy_ins += buy_ins
        
        transactions.append({
            "name": name,
            "buy_ins": buy_ins,
            "end_chips": 0,     # Data not available
            "profit_chips": float(chips),
            "profit_inr": profit_inr
        })

    new_game = {
        "game_id": str(uuid.uuid4()),
        "date": date,
        "chip_ratio": chip_ratio,
        "total_buy_ins": total_buy_ins,
        "transactions": transactions
    }

    # 1. Add to Games list
    db['games'].append(new_game)
    
    # 2. Update the Player Cache so the Leaderboard reflects this immediately
    for tx in transactions:
        p_name = tx['name']
        if p_name not in db['players']:
            db['players'][p_name] = {"total_winning": 0.0, "all_time_total_buy_ins": 0}
        
        db['players'][p_name]["total_winning"] += tx["profit_inr"]
        db['players'][p_name]["all_time_total_buy_ins"] += tx["buy_ins"]

    with open('database.json', 'w') as f:
        json.dump(db, f, indent=2)
    
    print(f"✅ Successfully imported game for {date}!")

# --- THE DATA YOU PROVIDED ---
data_to_add = {
    "Abhi": -75,
    "Agrim": -1550,
    "Sagnik": 2825,
    "Herrick": 300,
    "Vaibhav": 300,
    "Sura": -200,
    "Sammy": -1600,
}

add_pure_profit_game("2026-08-02", data_to_add)