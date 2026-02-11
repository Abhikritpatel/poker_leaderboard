from flask import Flask,jsonify
import json

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


@app.route('/api/leaderboard',methods=['GET'])
def leaderboard():
    data=get_sorted_leaderboard()
    return jsonify(data)

if __name__== '__main__':
    app.run(debug=True,port=5000)

