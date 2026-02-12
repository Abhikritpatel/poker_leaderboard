from flask import Flask,jsonify,request
import json
from datetime import datetime

app=Flask(__name__)
app.json.sort_keys=False

def get_sorted_leaderboard():
    try:
        with open("data.json", 'r') as f:
            players = json.load(f)

        # DEBUG PRINT: Look at your terminal after you refresh the page
        for name, stats in players.items():
            print(f"DEBUG: Player {name} has {stats['total_winning']} (Type: {type(stats['total_winning'])})")

        # The Fix: Explicitly cast to int just for the sorting calculation
        sorted_items = sorted(
            players.items(), 
            key=lambda item: int(item[1]['total_winning']), 
            reverse=True
        )
        return dict(sorted_items)
    except Exception as e:
        print(f"Error during sort: {e}")
        return {}

@app.route('/api/add_win',methods=['POST'])
def add_win():
    data=request.get_json()

    name=data.get('name','').lower()
    amount=int(data.get('winning',0))
    today=datetime.now().strftime('%Y-%m-%d')

    if not isinstance(amount,(int,float)):
        return jsonify({"status":"error","message":"Winning must be a number"}),400

    try:
        with open('data.json','r') as f:
            players=json.load(f)
        
        if name in players:
            players[name]['total_winning']+=amount
            players[name]['history'].append(
                {
                    'date':today,
                    'winning':amount
                    
                }
            )
            with open('data.json','w') as f:
                json.dump(players,f,indent=2)

            return jsonify({"status":"success", "message": f'{amount} added to {name}'}),200
    
        return jsonify({"status":"error","message":"player not found"}),404
    
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),500
    





@app.route('/api/leaderboard',methods=['GET'])
def leaderboard():
    data=get_sorted_leaderboard()
    return jsonify(data)

if __name__== '__main__':
    app.run(debug=True,port=5000)

