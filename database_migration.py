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

# Give every group without a PIN (or still on the old shared default '1234')
# its own random PIN. Generated PINs are printed once so the operator can hand
# them to each table's host; only the hash is stored.
import secrets
from werkzeug.security import generate_password_hash, check_password_hash

cur.execute("SELECT group_id, group_name, admin_pin_hash FROM groups;")
issued = []
for group_id, group_name, pin_hash in cur.fetchall():
    if pin_hash and not check_password_hash(pin_hash, "1234"):
        continue
    new_pin = f"{secrets.randbelow(900000) + 100000}"
    cur.execute(
        "UPDATE groups SET admin_pin_hash = %s WHERE group_id = %s;",
        (generate_password_hash(new_pin), group_id),
    )
    issued.append((group_id, group_name, new_pin))

for group_id, group_name, new_pin in issued:
    print(f"🔑 New admin PIN for '{group_name}' ({group_id}): {new_pin}")

print("✅ Phase 2 complete: Database now supports table admin pins!")
cur.close()
conn.close()