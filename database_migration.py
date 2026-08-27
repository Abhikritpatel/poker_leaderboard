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
print("✅ Phase 1 complete: Database now supports groups!")
cur.close()
conn.close()