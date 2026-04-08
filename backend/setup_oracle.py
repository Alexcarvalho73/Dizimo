import oracledb
import os
import bcrypt

WALLET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))

try:
    print(">>> Iniciando configuração do Oracle Banco de Dados Na Nuvem...")
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

    # 1. Criação das Tabelas
    with open('schema_oracle.sql', 'r', encoding='utf-8') as f:
        sql = f.read()

    # Oracle processa um comando CREATE por vez sem BLOCO PL/SQL
    statements = sql.split(';')
    for stmt in statements:
        cmd = stmt.strip()
        if cmd:
            try:
                cursor.execute(cmd)
                print(f" [+] Tabela ou Constraint criados com sucesso: {cmd[:30].replace(chr(10), ' ')}...")
            except Exception as e:
                # Ignorar ORA-00955 (nome já em uso por outro objeto existente)
                if 'ORA-00955' in str(e):
                    print(f" [~] Tabela já existe, pulando: {cmd[:30].replace(chr(10), ' ')}")
                else:
                    print(f" [!] Erro ao criar: {str(e)}")

    # 2. Injeção de Dados Padroes
    cursor.execute("SELECT COUNT(*) FROM permissoes")
    if cursor.fetchone()[0] == 0:
        permissoes_iniciais = [
                'Ver Dashboard',
                'Visualizar Dizimistas', 'Criar Dizimistas', 'Editar Dizimistas', 'Excluir Dizimistas',
                'Visualizar Lançamentos', 'Criar Lançamentos', 'Editar Lançamentos', 'Excluir Lançamentos',
                'Visualizar Usuários', 'Criar Usuários', 'Editar Usuários', 'Excluir Usuários',
                'Gerenciar Perfis'
        ]
        for p in permissoes_iniciais:
            cursor.execute("INSERT INTO permissoes (descricao) VALUES (:1)", [p])
        print(" [+] Permissões padrão injetadas.")

    cursor.execute("SELECT COUNT(*) FROM usuarios")
    if cursor.fetchone()[0] == 0:
        # Cria perfil admin via ID tracking
        cursor.execute("INSERT INTO perfis (descricao) VALUES ('Admin')")
        
        cursor.execute("SELECT id_perfil FROM perfis WHERE descricao = 'Admin' FETCH FIRST 1 ROWS ONLY")
        row_perfil = cursor.fetchone()
        if row_perfil:
            id_perfil = row_perfil[0]
            
            senha_hash = bcrypt.hashpw('admin123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            cursor.execute("INSERT INTO usuarios (nome, login, senha_hash, id_perfil) VALUES (:1, :2, :3, :4)",
                           ['Administrador', 'admin', senha_hash, id_perfil])
            
            cursor.execute("INSERT INTO tipos_pagamento (descricao) VALUES ('Dinheiro')")
            cursor.execute("INSERT INTO tipos_pagamento (descricao) VALUES ('Pix')")
            
            # Vincula todas as permissoes ao admin
            cursor.execute("SELECT id_permissao FROM permissoes")
            for permrow in cursor.fetchall():
                cursor.execute("INSERT INTO perfil_permissao (id_perfil, id_permissao) VALUES (:1, :2)", [id_perfil, permrow[0]])
                
        print(" [+] Usuário Administrador (admin / admin123) gerado e vinculado.")

    connection.commit()
    connection.close()
    print(">>> Banco de Dados ORACLE CLOUD perfeitamente estruturado e pronto para uso!")

except Exception as e:
    print("ERRO FATAL DURANTE PROCESSAMENTO:", e)
