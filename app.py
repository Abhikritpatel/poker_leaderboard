from flask import Flask,jsonify,request,render_template
import json
from datetime import datetime

app=Flask(__name__)
app.json.sort_keys=False

def get_sorted_leaderboard():
    try:
        with open("data.json", 'r') as f:
            players = json.load(f)

        
        for name,stats in players.items():
            print(f"DEBUG: Player {name} has {stats['total_winning']} (Type: {type(stats['total_winning'])})")

        leaderboard_list=[]
        for name,stats in players.items():
            leaderboard_list.append({
                'name':name,
                'total_winning':stats['total_winning']
            })
        
        sorted_items=sorted(
            leaderboard_list,
            key=lambda item: int(item['total_winning']),
            reverse=True
        )
     
        return sorted_items
    

    except Exception as e:
        print(f"Error during sort: {e}")
        return {}



@app.route('/api/add_win',methods=['POST'])
def add_win():
    data=request.get_json()

    name=data.get('name','').lower()
    today=datetime.now().strftime('%Y-%m-%d')
    date=data.get('date',today)
    amount=(data.get('winning',0))
    

    if not isinstance(amount,(int,float)):
        return jsonify({"status":"error","message":"Winning must be a number"}),400

    try:
        with open('data.json','r') as f:
            players=json.load(f)

        if name not in players:
            players[name]={
                "total_winning":0,
                "history":[]
            }
        
        if name in players:
            players[name]['total_winning']+=amount
            players[name]['history'].append(
                {
                    'date':date,
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

@app.route('/')
def home():
    return render_template('index.html')


if __name__== '__main__':
    app.run(debug=True,port=5000)

