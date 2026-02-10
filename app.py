from flask import Flask,jsonify
import json

app=Flask(__name__)

def get_sorted_leaderboard():
    try:
        with open("data.json",'r') as f:
            players=json.load(f)

        sorted_players=dict(sorted(players.items(),key=lambda item: item[1]['total_winning'],reverse=True))
        return sorted_players
    except (FileNotFoundError,json.JSONDecodeError):
        return {}


@app.route('/api/leaderboard',methods=['GET'])
def leaderboard():
    data=get_sorted_leaderboard()
    return jsonify(data)

if __name__== '__main__':
    app.run(debug=True,port=5000)

