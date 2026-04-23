import oracledb
import os
import sys

# Ajuste do path para encontrar app_oracle se necessário
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app_oracle import ORACLE_USER, ORACLE_PASS, ORACLE_DSN, WALLET_PASS, get_wallet_dir

def migrate():
    print(">>> Iniciando migração para adicionar ULTIMO_LOGIN...")
    wdir = get_wallet_dir()
    try:
        conn = oracledb.connect(
            user=ORACLE_USER, password=ORACLE_PASS, dsn=ORACLE_DSN,
            config_dir=wdir, wallet_location=wdir, wallet_password=WALLET_PASS
        )
        cursor = conn.cursor()
        
        # Verificar se a coluna existe
        cursor.execute("""
            SELECT count(*) FROM user_tab_columns 
            WHERE table_name = 'USUARIOS' AND column_name = 'ULTIMO_LOGIN'
        """)
        exists = cursor.fetchone()[0]
        
        if not exists:
            print(">>> Adicionando coluna ULTIMO_LOGIN na tabela USUARIOS...")
            cursor.execute("ALTER TABLE usuarios ADD ultimo_login TIMESTAMP")
            conn.commit()
            print(">>> Sucesso!")
        else:
            print(">>> Coluna já presente.")
            
        conn.close()
    except Exception as e:
        print(f"ERRO: {e}")

if __name__ == "__main__":
    migrate()
