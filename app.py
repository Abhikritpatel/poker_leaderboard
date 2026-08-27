import os
import re
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

def get_sorted_leaderboard(start=None, end=None, timeframe='all', group_id='main'):
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        if timeframe == 'all':
            query = """
                SELECT 
                    t.player_name AS name,
                    ROUND(SUM(t.profit_inr)::numeric, 2) AS total_winning
                FROM transactions t
                JOIN games g ON t.game_id = g.game_id
                WHERE g.group_id = %s
                GROUP BY t.player_name
                ORDER BY total_winning DESC;
            """
            cur.execute(query, (group_id,))
        else:
            query = """
                SELECT 
                    t.player_name AS name,
                    ROUND(SUM(t.profit_inr)::numeric, 2) AS total_winning
                FROM transactions t
                JOIN games g ON t.game_id = g.game_id
                WHERE g.group_id = %s AND g.date BETWEEN %s AND %s
                GROUP BY t.player_name
                ORDER BY total_winning DESC;
            """
            cur.execute(query, (group_id, start, end))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return [{'name': r['name'], 'total_winning': float(r['total_winning'])} for r in rows]
    except Exception as e:
        print(f"Leaderboard error: {e}")
        return []

@app.route('/api/groups', methods=['GET'])
def get_groups():
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT group_id, group_name AS name FROM groups ORDER BY created_at ASC;")
        groups = cur.fetchall()
        cur.close()
        conn.close()
        return jsonify(groups)
    except Exception as e:
        print(f"Error fetching groups: {e}")
        return jsonify([]), 500

@app.route('/api/groups', methods=['POST'])
def create_group():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"status": "error", "message": "Group name is required"}), 400

    # Generate URL-friendly slug (e.g. "Hostel Gang" -> "hostel-gang")
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower()
    if not slug:
        slug = f"group-{uuid.uuid4().hex[:6]}"

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO groups (group_id, group_name) VALUES (%s, %s);", (slug, name))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"status": "success", "group_id": slug, "name": name}), 201
    except psycopg2.IntegrityError:
        return jsonify({"status": "error", "message": "A group with this name already exists"}), 400
    except Exception as e:
        print(f"Error creating group: {e}")
        return jsonify({"status": "error", "message": "Failed to create group"}), 500

@app.route('/api/add_game', methods=['POST'])
def add_game():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "No data provided"}), 400

    today = datetime.now().strftime('%Y-%m-%d')
    submitted_date = data.get('date')
    date = submitted_date if submitted_date else today

    group_id = data.get('group_id', 'main')
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

        # 1. Insert Game with group_id
        cur.execute("""
            INSERT INTO games (game_id, group_id, date, chip_ratio, buy_in_amt, total_buy_ins)
            VALUES (%s, %s, %s, %s, %s, %s);
        """, (game_uuid, group_id, date, chip_ratio, buy_in_amt, total_buy_ins))

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
    group_id = request.args.get('group_id', 'main')

    today_date = datetime.now()
    today_str = today_date.strftime('%Y-%m-%d')

    if timeframe == 'week':
        prev_date_str = (today_date - timedelta(days=7)).strftime('%Y-%m-%d')
        data = get_sorted_leaderboard(prev_date_str, today_str, timeframe='week', group_id=group_id)
    elif timeframe == 'month':
        prev_date_str = (today_date - timedelta(days=30)).strftime('%Y-%m-%d')
        data = get_sorted_leaderboard(prev_date_str, today_str, timeframe='month', group_id=group_id)
    elif timeframe == 'custom' and start and end:
        data = get_sorted_leaderboard(start, end, timeframe='custom', group_id=group_id)
    else:
        data = get_sorted_leaderboard(timeframe='all', group_id=group_id)

    return jsonify(data)

@app.route('/')
def home():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5001)
