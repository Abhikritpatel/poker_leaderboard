import os
import uuid
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, render_template
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

app = Flask(__name__)
app.json.sort_keys = False

def get_db_connection():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is not set in environment or .env file.")
    return psycopg2.connect(DATABASE_URL)

def get_sorted_leaderboard(start=None, end=None, timeframe='all'):
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        if timeframe == 'all':
            query = """
                SELECT 
                    player_name AS name,
                    ROUND(SUM(profit_inr)::numeric, 2) AS total_winning
                FROM transactions
                GROUP BY player_name
                ORDER BY total_winning DESC;
            """
            cur.execute(query)
        else:
            query = """
                SELECT 
                    t.player_name AS name,
                    ROUND(SUM(t.profit_inr)::numeric, 2) AS total_winning
                FROM transactions t
                JOIN games g ON t.game_id = g.game_id
                WHERE g.date BETWEEN %s AND %s
                GROUP BY t.player_name
                ORDER BY total_winning DESC;
            """
            cur.execute(query, (start, end))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        # Convert Decimal values to float for clean JSON response
        leaderboard = []
        for row in rows:
            leaderboard.append({
                'name': row['name'],
                'total_winning': float(row['total_winning']) if row['total_winning'] is not None else 0.0
            })

        return leaderboard

    except Exception as e:
        print(f"Error during leaderboard query: {e}")
        return []

@app.route('/api/add_game', methods=['POST'])
def add_game():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "No data provided"}), 400

    today = datetime.now().strftime('%Y-%m-%d')
    submitted_date = data.get('date')
    date = submitted_date if submitted_date else today

    chip_ratio = data.get('chip_ratio', 0)
    transactions = data.get('transactions', [])
    buy_in_amt = data.get('buy_in_amt', 0)

    # Verify datatypes
    if chip_ratio == 0:
        return jsonify({"status": "error", "message": "Chip ratio is required"}), 400
    
    if not transactions:
        return jsonify({"status": "error", "message": "Transactions cannot be empty"}), 400
    
    if buy_in_amt == 0:
        return jsonify({"status": "error", "message": "Buy-in amount cannot be zero"}), 400

    # Audit game math
    total_balance = 0
    total_buy_ins = 0
    tx_rows = []
    game_uuid = str(uuid.uuid4())

    for player in transactions:
        name = player.get('name', '').lower().strip()
        endchips = float(player.get('end_chips', 0))
        buy_ins = int(player.get('buy_ins', 0))
        
        profit_loss = (endchips / chip_ratio) - (buy_in_amt * buy_ins)
        total_balance += profit_loss
        profit_inr = round(profit_loss, 2)
        profit_chips = round(profit_loss * chip_ratio, 2)
        total_buy_ins += buy_ins

        tx_rows.append((game_uuid, name, buy_ins, endchips, profit_chips, profit_inr))

    if round(total_balance, 2) != 0:
        return jsonify({"status": "error", "message": f"Discrepancy of {round(total_balance * chip_ratio, 2)} chips"}), 400

    # Insert into PostgreSQL
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Insert Game
        cur.execute("""
            INSERT INTO games (game_id, date, chip_ratio, buy_in_amt, total_buy_ins)
            VALUES (%s, %s, %s, %s, %s);
        """, (game_uuid, date, chip_ratio, buy_in_amt, total_buy_ins))

        # 2. Batch Insert Transactions
        execute_values(
            cur,
            """
            INSERT INTO transactions (game_id, player_name, buy_ins, end_chips, profit_chips, profit_inr)
            VALUES %s;
            """,
            tx_rows
        )

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"status": "success", "message": "Game mathematically verified and saved to database!"}), 200

    except Exception as e:
        print(f"Database write error: {e}")
        return jsonify({"status": "error", "message": "Failed to save game to PostgreSQL."}), 500

@app.route('/api/leaderboard', methods=['GET'])
def leaderboard():
    timeframe = request.args.get('timeframe', 'all')
    start = request.args.get('start')
    end = request.args.get('end')

    today_date = datetime.now()
    today_str = today_date.strftime('%Y-%m-%d')

    if timeframe == 'week':
        prev_date_str = (today_date - timedelta(days=7)).strftime('%Y-%m-%d')
        data = get_sorted_leaderboard(prev_date_str, today_str, timeframe='week')
    elif timeframe == 'month':
        prev_date_str = (today_date - timedelta(days=30)).strftime('%Y-%m-%d')
        data = get_sorted_leaderboard(prev_date_str, today_str, timeframe='month')
    elif timeframe == 'custom' and start and end:
        data = get_sorted_leaderboard(start, end, timeframe='custom')
    else:
        data = get_sorted_leaderboard()

    return jsonify(data)

@app.route('/')
def home():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5001)
