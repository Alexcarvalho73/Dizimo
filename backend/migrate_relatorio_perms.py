import oracledb
import os

WALLET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))

def run():
    print(">>> Iniciando migração de permissões de relatórios...")
    try:
        connection = oracledb.connect(
            user='DIZIMO',
            password='Alinne05@ora',
            dsn='imaculado_high',
            config_dir=WALLET_DIR,
            wallet_location=WALLET_DIR,
            wallet_password='Alinne05@ora'
        )
        print(">>> Conexão estabelecida com sucesso!")
        cursor = connection.cursor()
        
        # 1. Verifica se a permissão já existe
        cursor.execute("SELECT id_permissao FROM permissoes WHERE descricao = '[Relatórios] Escala de Servos'")
        row = cursor.fetchone()
        
        if row:
            print("A permissão '[Relatórios] Escala de Servos' já existe no banco.")
            id_permissao = row[0]
        else:
            # Insere a nova permissão
            print("Inserindo permissão '[Relatórios] Escala de Servos'...")
            cursor.execute("INSERT INTO permissoes (descricao) VALUES ('[Relatórios] Escala de Servos')")
            
            # Pega o ID inserido
            cursor.execute("SELECT id_permissao FROM permissoes WHERE descricao = '[Relatórios] Escala de Servos'")
            id_permissao = cursor.fetchone()[0]
            print(f"Permissão cadastrada. ID: {id_permissao}")

        # 2. Atribui ao perfil de Administrador (normalmente ID 1), se já não tiver
        perfil_admin_id = 1
        cursor.execute("SELECT 1 FROM perfil_permissao WHERE id_perfil = :1 AND id_permissao = :2", (perfil_admin_id, id_permissao))
        if cursor.fetchone():
            print("A permissão já estava atribuída ao Administrador.")
        else:
            cursor.execute("INSERT INTO perfil_permissao (id_perfil, id_permissao) VALUES (:1, :2)", (perfil_admin_id, id_permissao))
            print("Permissão atribuída ao perfil Administrador (ID 1).")

        connection.commit()
        print("Migração concluída com sucesso.")
        
    except Exception as e:
        print(f"Erro durante a migração: {e}")
        try:
            connection.rollback()
        except:
            pass
    finally:
        try:
            cursor.close()
            connection.close()
        except:
            pass

if __name__ == '__main__':
    run()
