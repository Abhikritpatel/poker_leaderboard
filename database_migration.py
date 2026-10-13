import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

conn=psycopg2.connect(os.getenv("DATABASE_URL"))
conn.autocommit=True
cur=conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS groups(
    group_id VARCHAR(50) PRIMARY KEY,
    group_name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
""")

cur.execute("""
    INSERT INTO groups(group_id,group_name)
    VALUES('main','Main Table')
    ON CONFLICT (group_id) DO NOTHING;
""")

cur.execute("""
    ALTER TABLE games 
    ADD COLUMN IF NOT EXISTS group_id VARCHAR(50) REFERENCES groups(group_id) DEFAULT 'main';
""")
# 4. Ensure all existing games are assigned to 'main'
cur.execute("UPDATE games SET group_id = 'main' WHERE group_id IS NULL;")

# 5. Add admin_pin_hash to groups table
cur.execute("""
    ALTER TABLE groups 
    ADD COLUMN IF NOT EXISTS admin_pin_hash VARCHAR(255);
""")

# Backfill default PIN '1234' for existing groups that have no PIN
from werkzeug.security import generate_password_hash
default_hash = generate_password_hash("1234")
cur.execute("""
    UPDATE groups 
    SET admin_pin_hash = %s 
    WHERE admin_pin_hash IS NULL;
""", (default_hash,))

print("✅ Phase 2 complete: Database now supports table admin pins!")
cur.close()
conn.close()