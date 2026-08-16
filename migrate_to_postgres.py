import os
import json
import uuid
from datetime import datetime
import psycopg2
from dotenv import load_dotenv

# Load DATABASE_URL from .env file
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

def get_connection():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is not set. Please create a .env file with DATABASE_URL=...")
    return psycopg2.connect(DATABASE_URL)

def init_schema(cursor):
    print("Creating tables if they don't exist...")
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS games (
        game_id UUID PRIMARY KEY,
        date DATE NOT NULL,
        chip_ratio NUMERIC(10, 2) NOT NULL DEFAULT 5,
        buy_in_amt NUMERIC(10, 2) NOT NULL DEFAULT 100,
        total_buy_ins INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        game_id UUID REFERENCES games(game_id) ON DELETE CASCADE,
        player_name VARCHAR(100) NOT NULL,
        buy_ins INT NOT NULL DEFAULT 0,
        end_chips NUMERIC(12, 2) NOT NULL DEFAULT 0,
        profit_chips NUMERIC(12, 2) NOT NULL DEFAULT 0,
        profit_inr NUMERIC(12, 2) NOT NULL DEFAULT 0
    );
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_player_name ON transactions(player_name);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);")
    print("✅ Schema created successfully.")

def migrate_data():
    if not os.path.exists("database.json"):
        print("❌ database.json not found!")
        return

    with open("database.json", "r") as f:
        db = json.load(f)

    games = db.get("games", [])
    print(f"Found {len(games)} games in database.json to migrate.")

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            init_schema(cur)

            # Check if games already exist
            cur.execute("SELECT COUNT(*) FROM games;")
            existing_games_count = cur.fetchone()[0]
            
            if existing_games_count > 0:
                print(f"⚠️  PostgreSQL already contains {existing_games_count} games. Overwriting with clean import from database.json...", flush=True)
                cur.execute("TRUNCATE TABLE transactions, games CASCADE;")
                print("🧹 Cleared existing data in PostgreSQL.", flush=True)

            total_tx_count = 0
            for g in games:
                raw_id = g.get("game_id")
                try:
                    game_uuid = str(uuid.UUID(raw_id)) if raw_id else str(uuid.uuid4())
                except ValueError:
                    game_uuid = str(uuid.uuid4())

                date_str = g.get("date")
                chip_ratio = float(g.get("chip_ratio", 5))
                buy_in_amt = float(g.get("buy_in_amt", 100))
                total_buy_ins = int(g.get("total_buy_ins", 0))

                cur.execute("""
                    INSERT INTO games (game_id, date, chip_ratio, buy_in_amt, total_buy_ins)
                    VALUES (%s, %s, %s, %s, %s);
                """, (game_uuid, date_str, chip_ratio, buy_in_amt, total_buy_ins))

                for tx in g.get("transactions", []):
                    name = tx.get("name", "").lower().strip()
                    buy_ins = int(tx.get("buy_ins", 0))
                    end_chips = float(tx.get("end_chips", 0))
                    profit_chips = float(tx.get("profit_chips", 0))
                    profit_inr = float(tx.get("profit_inr", 0))

                    cur.execute("""
                        INSERT INTO transactions (game_id, player_name, buy_ins, end_chips, profit_chips, profit_inr)
                        VALUES (%s, %s, %s, %s, %s, %s);
                    """, (game_uuid, name, buy_ins, end_chips, profit_chips, profit_inr))
                    total_tx_count += 1

            conn.commit()
            print(f"🎉 Successfully migrated {len(games)} games and {total_tx_count} player transactions into PostgreSQL!")

    except Exception as e:
        conn.rollback()
        print(f"❌ Migration failed: {e}")
        raise e
    finally:
        conn.close()

if __name__ == "__main__":
    migrate_data()
