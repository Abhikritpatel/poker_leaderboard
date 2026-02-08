import json
from datetime import date



def sort_players(players):
    return dict(sorted(players.items(),key=lambda item: item[1]["total_winning"],reverse=True))



filename="data.json"

try:
    with open(filename,'r') as file:
        players=json.load(file)

except FileNotFoundError:
    players={}

current_date=str(date.today())

print("please enter number of players: ")
num_players=int(input())

for i in range(num_players):
    player=input("enter player name:: ")
    player=player.strip().lower()
    print(f"please enter todays winning of {player}")
    winning=int(input())
    game_entry={"date": current_date, "winning": winning}

    if player in players:
        players[player]["history"].append(game_entry)
        players[player]["total_winning"]+=winning
    else:
        players[player]={
            "total_winning":winning,
            "history":[game_entry]
        }



# players=sort_players(players)


print(f"-----LEADERBOARD-----")
count=1
for player in players:
    print(f"{count}. {player} : {players[player]['total_winning']}")
    count+=1


with open(filename,'w') as file:
    json.dump(players,file,indent=4)



