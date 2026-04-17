import oracledb
import os
import base64
import io
import zipfile
import tempfile

# Hand-rolled wallet handling similar to app_oracle.py
def get_db():
    user = os.environ.get('ORACLE_USER', 'DIZIMO')
    password = os.environ.get('ORACLE_PASS', 'Alinne05@ora')
    dsn = os.environ.get('ORACLE_DSN', 'imaculado_high')
    wallet_b64 = os.environ.get('WALLET_B64')
    wallet_pass = os.environ.get('WALLET_PASS', 'Alinne05@ora')

    if wallet_b64:
        temp_dir = tempfile.mkdtemp()
        wallet_data = base64.b64decode(wallet_b64)
        with zipfile.ZipFile(io.BytesIO(wallet_data)) as z:
            z.extractall(temp_dir)
        return oracledb.connect(user=user, password=password, dsn=dsn, config_dir=temp_dir, wallet_location=temp_dir, wallet_password=wallet_pass)
    else:
        # Fallback to local DriveOracle
        wdir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))
        return oracledb.connect(user=user, password=password, dsn=dsn, config_dir=wdir, wallet_location=wdir, wallet_password=wallet_pass)

def migrate():
    conn = get_db()
    cursor = conn.cursor()
    
    perms = [
        'Visualizar Pastorais',
        'Criar Pastorais',
        'Editar Pastorais',
        'Excluir Pastorais'
    ]
    
    for p in perms:
        cursor.execute("SELECT COUNT(*) FROM permissoes WHERE descricao = :1", [p])
        count = cursor.fetchone()[0]
        if count == 0:
            print(f"Inserindo permissao: {p}")
            cursor.execute("INSERT INTO permissoes (descricao) VALUES (:1)", [p])
        else:
            print(f"Permissao ja existe: {p}")
            
    conn.commit()
    conn.close()
    print("Migracao concluida!")

if __name__ == "__main__":
    migrate()
