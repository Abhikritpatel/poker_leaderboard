from flask import Flask,jsonify,request,render_template
import json
from datetime import datetime,timedelta
import uuid

app=Flask(__name__)
app.json.sort_keys=False

def get_sorted_leaderboard(start=None,end=None,timeframe='all'):
    try:
        with open("database.json", 'r') as f:
                db = json.load(f)

        if(timeframe=='all'):
                leaderboard_list=[]
                players=db.get('players')

                for name,stats in players.items():
                    print(f"DEBUG: Player {name} has {stats.get('total_winning')} (Type: {type(stats.get('total_winning'))})")

                for name,stats in players.items():
                    leaderboard_list.append({
                        'name':name,
                        'total_winning':stats.get('total_winning')
                    })
                
                sorted_items=sorted(
                    leaderboard_list,
                    key=lambda item: int(item['total_winning']),
                    reverse=True
                )
            
                return sorted_items

        else:
                games=db.get('games',[])
                totals={}

                for game in games:
                    game_date=game.get('date')
                    if(start<=game_date<=end):
                        transactions=game.get('transactions')
                        for ts in transactions:
                            name=ts.get('name')
                            profit=int(ts.get('profit_inr',0))

                            if name not in totals:
                                totals[name]=0

                            totals[name]+=profit


                leaderboard_list=[]
                for name,total in totals.items():
                    leaderboard_list.append({
                        'name':name,
                        'total_winning':total
                    })

                
                sorted_items=sorted(leaderboard_list,key=lambda item:int(item['total_winning']),reverse=True)

                return sorted_items

    except Exception as e:
        print(f"Error during sort: {e}")
        return []
                    

            

            



# @app.route('/api/add_win',methods=['POST'])
# def add_win():
#     data=request.get_json()

#     name=data.get('name','').lower()
#     today=datetime.now().strftime('%Y-%m-%d')
#     submitted_date=data.get('date')
#     if(submitted_date==""): date=today
#     else: date=submitted_date

#     amount=(data.get('winning',0))
    
#     if not name:
#         return jsonify({"status": "error", "message": "Name is required"}), 400
    
#     if not isinstance(amount,(int,float)):
#         return jsonify({"status":"error","message":"Winning must be a number"}),400

#     try:
#         with open('data.json','r') as f:
#             players=json.load(f)

#         if name not in players:
#             players[name]={
#                 "total_winning":0,
#                 "history":[]
#             }
        
#         if name in players:
#             players[name]['total_winning']+=amount
#             players[name]['history'].append(
#                 {
#                     'date':date,
#                     'winning':amount
                    
#                 }
#             )
#             with open('data.json','w') as f:
#                 json.dump(players,f,indent=2)

#             return jsonify({"status":"success", "message": f'{amount} added to {name}'}),200
    
#         return jsonify({"status":"error","message":"player not found"}),404
    
#     except Exception as e:
#         return jsonify({"status":"error","message":str(e)}),500
    



@app.route('/api/add_game',methods=['POST'])
def add_game():

    #get data
    data=request.get_json()
    today=datetime.now().strftime('%Y-%m-%d')
    submitted_date=data.get('date')

    if(submitted_date==""): date=today
    else: date=submitted_date

    chip_ratio=data.get('chip_ratio',0)
    transactions=data.get('transactions',[])
    buy_in_amt=data.get('buy_in_amt',0)

    #verify the datatypes
    if chip_ratio==0:
        return jsonify({"status": "error", "message": "Chip ratio is required"}), 400
    
    if transactions==[]:
        return jsonify({"status": "error", "message": "Transaction cant be empty"}), 400
    
    if buy_in_amt==0 or isinstance(buy_in_amt,(float)):
        return jsonify({"status":"error","message":"buy in amount cant be zero or fractional"}),400


    #audit game 
    total_balance=0
    total_buy_ins=0
    for player in transactions:
        player['name'] = player.get('name', '').lower().strip()
        endchips=player.get('end_chips',0)
        buy_ins=player.get('buy_ins',0)
        profit_loss=(endchips/chip_ratio)-(buy_in_amt*buy_ins)
        total_balance+=profit_loss
        player['profit_inr']=round(profit_loss,2)
        total_buy_ins+=buy_ins

    if round(total_balance,2)!=0:
        return jsonify({"error":f"Discrepancy of {total_balance*chip_ratio} chips "}),400
    #update player cache
    try:
        with open('database.json','r') as f:
            db=json.load(f)
        
        
        for player in transactions:
            name=player['name'].lower().strip()
            buy_ins=player['buy_ins']
            profit=player['profit_inr']
            

            if name not in db['players']:
                db['players'][name]={
                        "total_winning":0,
                        "all_time_total_buy_ins":0
                }
            
            db['players'][name]['total_winning']+=profit
            db['players'][name]['all_time_total_buy_ins']+=buy_ins

    
        #append the game
        new_game={
            "game_id": str(uuid.uuid4()),
            "date":date,
            "chip_ratio":chip_ratio,
            "total_buy_ins":total_buy_ins,
            "transactions":transactions
        }

        db['games'].append(new_game)

        #save file
        with open("database.json",'w') as f:
            json.dump(db,f,indent=2)

        return jsonify({"status":"Success!","message":"Game mathematically verified and logged"}),200
    
    
    except Exception as e:
        print(f"database write error: {e}")
        return jsonify({"status": "error", "message": "Failed to save to database."}), 500




@app.route('/api/leaderboard',methods=['GET'])
def leaderboard():
    timeframe=request.args.get('timeframe','all')
    start=request.args.get('start')
    end=request.args.get('end')

    todaydate=datetime.now()
    today_str = todaydate.strftime('%Y-%m-%d')
    if(timeframe=='week'):
        prevdate_str=(todaydate-timedelta(days=7)).strftime('%Y-%m-%d')
        data=get_sorted_leaderboard(prevdate_str,today_str,timeframe='week')
    elif(timeframe=='month'):
        prevdate_str=(todaydate-timedelta(days=30)).strftime('%Y-%m-%d')
        data=get_sorted_leaderboard(prevdate_str,today_str,timeframe='month')
    elif(timeframe=='custom') and start and end:
        start_date=datetime.strptime(start,'%Y-%m-%d')
        end_date=datetime.strptime(end,'%Y-%m-%d')
        data=get_sorted_leaderboard(start,end,timeframe='custom')
    else:
        data=get_sorted_leaderboard()
        
    return jsonify(data)

@app.route('/')
def home():
    return render_template('index.html')


if __name__== '__main__':
    app.run(debug=True,port=5000)

