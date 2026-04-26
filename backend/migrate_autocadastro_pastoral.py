"""
Script de migração: Adiciona coluna AUTOCADASTRO à tabela PASTORAIS.
Valor 0 = Não (padrão), 1 = Sim.

Execute UMA vez:
    python backend/migrate_autocadastro_pastoral.py
"""
import oracledb
import os
import sys

# Configurações Oracle (usa as mesmas do app)
ORACLE_USER = os.environ.get('ORACLE_USER', 'DIZIMO')
ORACLE_PASS = os.environ.get('ORACLE_PASS', 'Alinne05@ora')
ORACLE_DSN  = os.environ.get('ORACLE_DSN',  'imaculado_high')
WALLET_PASS = os.environ.get('WALLET_PASS', 'Alinne05@ora')

wallet_dir = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', 'DriveOracle')
)
print(f"[Wallet] Usando: {wallet_dir}")

conn = oracledb.connect(
    user=ORACLE_USER,
    password=ORACLE_PASS,
    dsn=ORACLE_DSN,
    config_dir=wallet_dir,
    wallet_location=wallet_dir,
    wallet_password=WALLET_PASS
)
cursor = conn.cursor()

# Verifica se a coluna já existe
cursor.execute("""
    SELECT COUNT(*) FROM user_tab_columns
    WHERE table_name = 'PASTORAIS' AND column_name = 'AUTOCADASTRO'
""")
count = cursor.fetchone()[0]

if count > 0:
    print("[MIGRAÇÃO] Coluna AUTOCADASTRO já existe em PASTORAIS. Nada a fazer.")
else:
    cursor.execute(
        "ALTER TABLE pastorais ADD autocadastro NUMBER DEFAULT 0 NOT NULL"
    )
    conn.commit()
    print("[MIGRAÇÃO] Coluna AUTOCADASTRO adicionada com sucesso (DEFAULT 0 = NÃO).")

cursor.close()
conn.close()
print("[MIGRAÇÃO] Concluída.")
