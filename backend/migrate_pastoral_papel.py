"""
Migração: adiciona coluna 'papel' na tabela dizimista_pastoral
Valores: 'servo' (padrão) | 'coordenador'

Execute este script uma única vez no servidor Oracle.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app_oracle import app, get_db

with app.app_context():
    db = get_db()
    # 1. Tenta adicionar a coluna (Oracle)
    try:
        db.execute(
            "ALTER TABLE dizimista_pastoral ADD (papel CHAR(1) DEFAULT 'S')"
        )
        db.commit()
        print("[OK] Coluna 'papel' adicionada à tabela dizimista_pastoral como CHAR(1).")
    except Exception as e:
        msg = str(e).lower()
        if 'already exists' in msg or 'duplicate column' in msg or 'ORA-01430' in str(e):
            print("[INFO] Coluna 'papel' já existe. Ajustando tipo para CHAR(1)...")
            try:
                db.execute("ALTER TABLE dizimista_pastoral MODIFY (papel CHAR(1))")
                db.commit()
                print("[OK] Coluna 'papel' modificada para CHAR(1).")
            except Exception as em:
                print(f"[ERRO ao modificar] {em}")
        else:
            print(f"[ERRO] {e}")
            sys.exit(1)

    # 2. Garante que registros existentes tenham o valor padrão
    try:
        db.execute(
            "UPDATE dizimista_pastoral SET papel = 'S' WHERE papel IS NULL"
        )
        db.commit()
        print("[OK] Registros existentes atualizados com papel='S'.")
    except Exception as e:
        print(f"[AVISO ao atualizar existentes] {e}")

    print("\nMigração concluída!")
