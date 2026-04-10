import oracledb
import os

WALLET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))

try:
    print(">>> Aplicando migração: Adicionando data_nascimento à tabela dizimistas...")
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
        cursor.execute("ALTER TABLE dizimistas ADD data_nascimento DATE")
        print(" [+] Coluna data_nascimento adicionada com sucesso!")
    except Exception as e:
        if 'ORA-01430' in str(e):
            print(" [~] Coluna já existe, pulando.")
        else:
            print(f" [!] Erro ao adicionar coluna: {e}")

    connection.commit()
    connection.close()
    print(">>> Migração concluída!")

except Exception as e:
    print("ERRO:", e)
