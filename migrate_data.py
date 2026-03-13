import json
import uuid

def migrate_database():
    print("starting database migration")

    try:
        with open('data.json','r') as f:
            old_data=json.load(f)

    except FileNotFoundError:
        print("Database not found")
        return
    
    new_db={"players":{},"games":[]}

    games_by_date={}

    for player_name,stats in old_data.items():
        new_db["players"][player_name]={
            "total_winning":stats.get('total_winning',0),
            "all_time_total_buy_ins":0
        }

        for match in stats.get("history",[]):
            date=match.get("date")
            winning=match.get("winning")

            if date not in games_by_date:
                games_by_date[date]=[]

            games_by_date[date].append({
                "name": player_name,
                "buy_ins_this_game": 0, 
                "winning_this_game": winning
            }) 

    

    
    for date,transactions in games_by_date.items():
        new_game={
            "game_id":str(uuid.uuid4()),
            "date":date,
            "chip_ratio":5,
            "total_game_buy_ins": 0,
            "transactions": transactions
        }
        new_db["games"].append(new_game)

    
    with open("database.json",'w') as f:
        json.dump(new_db,f,indent=2)

    print("migration complete")

if __name__=="__main__":
    migrate_database()


