import oracledb
import os

WALLET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))

try:
    print(">>> Verificando/Aplicando migração: valor_dizimo...")
    connection = oracledb.connect(
        user='DIZIMO',
        password='Alinne05@ora',
        dsn='imaculado_high',
        config_dir=WALLET_DIR,
        wallet_location=WALLET_DIR,
        wallet_password='Alinne05@ora'
    )
    cursor = connection.cursor()

    try:
        cursor.execute("ALTER TABLE dizimistas ADD valor_dizimo NUMBER(12,2) DEFAULT 0")
        print(" [+] Coluna valor_dizimo adicionada com sucesso!")
    except Exception as e:
        if 'ORA-01430' in str(e):
            print(" [~] Coluna já existe.")
        else:
            print(f" [!] Erro: {e}")

    connection.commit()
    connection.close()
    print(">>> Concluído!")

except Exception as e:
    print("ERRO:", e)
