import oracledb
import os

WALLET_DIR = os.path.abspath('../DriveOracle')
conn = oracledb.connect(
    user='ADMIN', 
    password='Alinne05@ora', 
    dsn='imaculado_high', 
    config_dir=WALLET_DIR, 
    wallet_location=WALLET_DIR, 
    wallet_password='Alinne05@ora'
)
cursor = conn.cursor()

try:
    cursor.execute('CREATE USER DIZIMO IDENTIFIED BY "Alinne05@ora"')
    print('Usuario DIZIMO criado com sucesso.')
except Exception as e:
    print('Erro ao criar (pode ja existir):', e)

try:
    cursor.execute('GRANT CONNECT, RESOURCE TO DIZIMO')
    cursor.execute('ALTER USER DIZIMO QUOTA UNLIMITED ON DATA')
    print('Permissoes concedidas.')
except Exception as e:
    print('Erro ao conceder privilégios:', e)

conn.close()
