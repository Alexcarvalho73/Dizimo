"""
migrate_missas_perm.py
Insere as 4 permissões de Missas no banco Oracle e garante que o perfil 1 (admin) as tenha.
Execute UMA VEZ em produção.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app_oracle import get_db

PERMISSOES_MISSAS = [
    'Visualizar Missas',
    'Criar Missas',
    'Editar Missas',
    'Excluir Missas',
]

db = get_db()

ids_inseridos = []
for desc in PERMISSOES_MISSAS:
    existe = db.execute("SELECT id_permissao FROM permissoes WHERE descricao = ?", (desc,)).fetchone()
    if existe:
        print(f"[OK - já existe] {desc} (id={existe['id_permissao']})")
        ids_inseridos.append(int(existe['id_permissao']))
    else:
        db.execute("INSERT INTO permissoes (descricao) VALUES (?)", (desc,))
        db.commit()
        novo = db.execute("SELECT id_permissao FROM permissoes WHERE descricao = ?", (desc,)).fetchone()
        print(f"[INSERIDO] {desc} (id={novo['id_permissao']})")
        ids_inseridos.append(int(novo['id_permissao']))

# Garantir que perfil admin (id_perfil=1) tenha todas as permissões
for perm_id in ids_inseridos:
    ja_tem = db.execute(
        "SELECT 1 FROM perfil_permissao WHERE id_perfil = 1 AND id_permissao = ?",
        (perm_id,)
    ).fetchone()
    if not ja_tem:
        db.execute("INSERT INTO perfil_permissao (id_perfil, id_permissao) VALUES (1, ?)", (perm_id,))
        db.commit()
        print(f"[ASSOCIADO] Permissão {perm_id} -> perfil admin (1)")
    else:
        print(f"[OK - já tem] Permissão {perm_id} já associada ao admin")

print("\nMigração de permissões de Missas concluída!")
