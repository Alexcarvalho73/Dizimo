import oracledb
import os
import base64
import io
import zipfile
import tempfile

def get_db():
    user = os.environ.get('ORACLE_USER', 'DIZIMO')
    password = os.environ.get('ORACLE_PASS', 'Alinne05@ora')
    dsn = os.environ.get('ORACLE_DSN', 'imaculado_high')
    wallet_pass = os.environ.get('WALLET_PASS', 'Alinne05@ora')
    wdir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))
    return oracledb.connect(user=user, password=password, dsn=dsn, config_dir=wdir, wallet_location=wdir, wallet_password=wallet_pass)

def migrate():
    conn = get_db()
    cursor = conn.cursor()
    
    perms = [
        'Visualizar Usuários',
        'Criar Usuários',
        'Editar Usuários',
        'Excluir Usuários',
        'Gerenciar Perfis'
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
    print("Migracao de permissoes de usuario concluida!")

if __name__ == "__main__":
    migrate()
