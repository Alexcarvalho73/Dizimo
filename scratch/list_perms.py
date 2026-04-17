import oracledb
import os

def check():
    user = os.environ.get('ORACLE_USER', 'DIZIMO')
    password = os.environ.get('ORACLE_PASS', 'Alinne05@ora')
    dsn = os.environ.get('ORACLE_DSN', 'imaculado_high')
    wallet_pass = os.environ.get('WALLET_PASS', 'Alinne05@ora')
    wdir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))
    
    conn = oracledb.connect(user=user, password=password, dsn=dsn, config_dir=wdir, wallet_location=wdir, wallet_password=wallet_pass)
    cursor = conn.cursor()
    cursor.execute("SELECT descricao FROM permissoes ORDER BY descricao")
    for row in cursor:
        print(row[0])
    conn.close()

if __name__ == "__main__":
    check()
