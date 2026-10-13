import os
import re
import uuid
from datetime import datetime, timedelta
import secrets
from flask import Flask, jsonify, request, render_template, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
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

        # Per-game results in date order, used for nights played and trend lines
        if timeframe == 'all':
            date_filter, params = "", (group_id,)
        else:
            date_filter, params = "AND g.date BETWEEN %s AND %s", (group_id, start, end)
        cur.execute(f"""
            SELECT t.player_name AS name, t.profit_inr AS profit
            FROM transactions t
            JOIN games g ON t.game_id = g.game_id
            WHERE g.group_id = %s {date_filter}
            ORDER BY g.date, g.created_at;
        """, params)
        history = {}
        for h in cur.fetchall():
            history.setdefault(h['name'], []).append(float(h['profit']))

        cur.close()
        conn.close()

        leaderboard = []
        for r in rows:
            running, series = 0.0, []
            for profit in history.get(r['name'], []):
                running += profit
                series.append(round(running, 2))
            leaderboard.append({
                'name': r['name'],
                'total_winning': float(r['total_winning']),
                'nights': len(series),
                'series': series,
            })
        return leaderboard
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

def verify_table_admin(group_id, pin):
    if not pin or not group_id:
        return False
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT admin_pin_hash FROM groups WHERE group_id = %s;", (group_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row['admin_pin_hash']:
            return check_password_hash(row['admin_pin_hash'], str(pin).strip())
        return False
    except Exception as e:
        print(f"Admin verification error: {e}")
        return False

@app.route('/api/groups', methods=['POST'])
def create_group():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    pin = data.get('pin', '').strip()
    if not name:
        return jsonify({"status": "error", "message": "Group name is required"}), 400

    # If pin is not provided, generate a secure 6-digit pin
    if not pin:
        pin = f"{secrets.randbelow(900000) + 100000}"

    pin_hash = generate_password_hash(pin)

    # Generate URL-friendly slug (e.g. "Hostel Gang" -> "hostel-gang")
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower()
    if not slug:
        slug = f"group-{uuid.uuid4().hex[:6]}"

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO groups (group_id, group_name, admin_pin_hash) VALUES (%s, %s, %s);", (slug, name, pin_hash))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"status": "success", "group_id": slug, "name": name, "admin_pin": pin}), 201
    except psycopg2.IntegrityError:
        return jsonify({"status": "error", "message": "A group with this name already exists"}), 400
    except Exception as e:
        print(f"Error creating group: {e}")
        return jsonify({"status": "error", "message": "Failed to create group"}), 500

@app.route('/api/groups/verify_admin', methods=['POST'])
def verify_admin_route():
    data = request.get_json() or {}
    group_id = data.get('group_id', '').strip()
    pin = data.get('pin', '').strip()
    if not group_id or not pin:
        return jsonify({"status": "error", "is_admin": False, "message": "Table ID and PIN are required"}), 400

    is_valid = verify_table_admin(group_id, pin)
    if is_valid:
        return jsonify({"status": "success", "is_admin": True}), 200
    return jsonify({"status": "error", "is_admin": False, "message": "Invalid Admin PIN"}), 401

@app.route('/api/add_game', methods=['POST'])
def add_game():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "No data provided"}), 400

    group_id = data.get('group_id', 'main')

    # Enforce Table Admin Authorization
    admin_pin = request.headers.get('X-Admin-Key') or data.get('admin_pin')
    if not verify_table_admin(group_id, admin_pin):
        return jsonify({"status": "error", "message": "Admin authorization required to log games for this table."}), 403

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

@app.route('/api/table_summary', methods=['GET'])
def table_summary():
    group_id = request.args.get('group_id', 'main')
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT COUNT(*) AS nights,
                   COALESCE(MAX(total_buy_ins * buy_in_amt), 0) AS biggest_pot
            FROM games WHERE group_id = %s;
        """, (group_id,))
        totals = cur.fetchone()

        cur.execute("""
            SELECT COUNT(DISTINCT t.player_name) AS players
            FROM transactions t JOIN games g ON t.game_id = g.game_id
            WHERE g.group_id = %s;
        """, (group_id,))
        players = cur.fetchone()['players']

        cur.execute("""
            SELECT g.date,
                   g.total_buy_ins * g.buy_in_amt AS pot,
                   (SELECT COUNT(*) FROM transactions WHERE game_id = g.game_id) AS players,
                   top.player_name AS top_name,
                   top.profit_inr AS top_profit
            FROM (
                SELECT game_id, date, total_buy_ins, buy_in_amt, created_at
                FROM games WHERE group_id = %s
                ORDER BY date DESC, created_at DESC LIMIT 5
            ) g
            LEFT JOIN LATERAL (
                SELECT player_name, profit_inr FROM transactions
                WHERE game_id = g.game_id ORDER BY profit_inr DESC LIMIT 1
            ) top ON TRUE
            ORDER BY g.date DESC, g.created_at DESC;
        """, (group_id,))
        recent = [{
            'date': r['date'].isoformat(),
            'pot': float(r['pot']),
            'players': r['players'],
            'top_name': r['top_name'],
            'top_profit': float(r['top_profit']) if r['top_profit'] is not None else 0.0,
        } for r in cur.fetchall()]

        cur.close()
        conn.close()
        return jsonify({
            'nights': totals['nights'],
            'biggest_pot': float(totals['biggest_pot']),
            'players': players,
            'recent': recent,
        })
    except Exception as e:
        print(f"Table summary error: {e}")
        return jsonify({'nights': 0, 'biggest_pot': 0, 'players': 0, 'recent': []}), 500

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/style.css')
def serve_css():
    return send_from_directory('static', 'style.css')

@app.route('/script.js')
def serve_js():
    return send_from_directory('static', 'script.js')

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5001)
