import oracledb
import os

# Configuração Oracle
ORACLE_USER = os.environ.get('ORACLE_USER', 'DIZIMO')
ORACLE_PASS = os.environ.get('ORACLE_PASS', 'Alinne05@ora')
ORACLE_DSN  = os.environ.get('ORACLE_DSN',  'imaculado_high')
WALLET_PASS = os.environ.get('WALLET_PASS', 'Alinne05@ora')

def get_wallet_dir():
    local = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))
    return local

def migrate():
    wallet_dir = get_wallet_dir()
    try:
        connection = oracledb.connect(
            user=ORACLE_USER,
            password=ORACLE_PASS,
            dsn=ORACLE_DSN,
            config_dir=wallet_dir,
            wallet_location=wallet_dir,
            wallet_password=WALLET_PASS
        )
        cursor = connection.cursor()
        
        print("Adicionando coluna TROCAR_SENHA à tabela USUARIOS...")
        try:
            cursor.execute("ALTER TABLE usuarios ADD trocar_senha NUMBER(1) DEFAULT 0")
            connection.commit()
            print("Coluna adicionada com sucesso!")
        except oracledb.DatabaseError as e:
            error, = e.args
            if error.code == 1430: # ORA-01430: column being added already exists in table
                print("A coluna já existe.")
            else:
                print(f"Erro ao adicionar coluna: {e}")
        
        connection.close()
    except Exception as e:
        print(f"Erro ao conectar: {e}")

if __name__ == '__main__':
    migrate()
