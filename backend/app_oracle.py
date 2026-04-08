import oracledb
import os
import json
import unicodedata
import base64
import zipfile
import io
import tempfile
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import bcrypt
from datetime import datetime

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

@app.route('/')
def index():
    return app.send_static_file('index.html')

# --- Configuração Oracle ---
# Lê de variáveis de ambiente (Render/Cloud) ou usa valores locais como fallback
ORACLE_USER = os.environ.get('ORACLE_USER', 'DIZIMO')
ORACLE_PASS = os.environ.get('ORACLE_PASS', 'Alinne05@ora')
ORACLE_DSN  = os.environ.get('ORACLE_DSN',  'imaculado_high')
WALLET_PASS = os.environ.get('WALLET_PASS', 'Alinne05@ora')

# Localização da Wallet:
# - Em produção (Render): extrai do env var WALLET_B64 (zip em base64)
# - Local: usa pasta DriveOracle
_wallet_tmp_dir = None

def get_wallet_dir():
    global _wallet_tmp_dir
    wallet_b64 = os.environ.get('WALLET_B64')
    if wallet_b64:
        # Produção: extrai wallet de base64 para pasta temporária
        if _wallet_tmp_dir is None:
            try:
                tmp = tempfile.mkdtemp(prefix='oracle_wallet_')
                zip_bytes = base64.b64decode(wallet_b64)
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    zf.extractall(tmp)
                _wallet_tmp_dir = tmp
                print(f'[Wallet] Extraida para: {tmp}')
            except Exception as e:
                print(f'[Wallet] ERRO ao extrair: {e}')
                raise
        return _wallet_tmp_dir
    else:
        # Local: usa pasta DriveOracle
        return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))

WALLET_DIR = get_wallet_dir()

class OracleWrapper:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, query, params=()):
        cursor = self.conn.cursor()
        
        # Replace ? with :1, :2 etc
        parts = query.split('?')
        if len(parts) > 1:
            new_query = ''
            for i in range(len(parts)-1):
                new_query += parts[i] + f':{i+1}'
            new_query += parts[-1]
            query = new_query
            
        cursor.execute(query, params)
        
        # Fix description for row mapping (SQLite Row like)
        if cursor.description:
            columns = [col[0].lower() for col in cursor.description]
            cursor.rowfactory = lambda *args: dict(zip(columns, args))
            
        return cursor
        
    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        try:
            connection = oracledb.connect(
                user=ORACLE_USER,
                password=ORACLE_PASS,
                dsn=ORACLE_DSN,
                config_dir=WALLET_DIR,
                wallet_location=WALLET_DIR,
                wallet_password='Alinne05@ora'
            )
            
            # Aplica regras linguisticas para busca ser Case e Accent Insensitive
            cursor = connection.cursor()
            cursor.execute("ALTER SESSION SET NLS_COMP = LINGUISTIC")
            cursor.execute("ALTER SESSION SET NLS_SORT = BINARY_AI")
            
            connection.autocommit = False
            db = g._database = OracleWrapper(connection)
        except Exception as e:
            print('ERRO ORACLE:', e)
            raise e
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def fetch_scalar(cursor):
    row = cursor.fetchone()
    if not row: return 0
    return list(row.values())[0] if isinstance(row, dict) else row[0]


def generate_phonetics(name, db):
    words = [w for w in str(name).split() if len(w) > 2]
    if not words: return ""
    query = "SELECT " + ", ".join([f"SOUNDEX(:{i+1})" for i in range(len(words))]) + " FROM DUAL"
    row = db.execute(query, words).fetchone()
    if not row: return ""
    return " ".join([v for v in row.values() if v])

def init_db():
    pass # Tables created externally via SQL Developer using schema_oracle.sql


# --- Helpers ---
def log_auditoria(tabela, id_registro, operacao, usuario, dados_anteriores=None, dados_novos=None):
    db = get_db()
    db.execute("""INSERT INTO auditoria (tabela, id_registro, operacao, usuario, dados_anteriores, dados_novos) 
                  VALUES (?, ?, ?, ?, ?, ?)""", 
               (tabela, id_registro, operacao, usuario, 
                json.dumps(dados_anteriores, default=str) if dados_anteriores else None, 
                json.dumps(dados_novos, default=str) if dados_novos else None))
    db.commit()

# --- Auth Routes ---
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    login = data.get('login')
    senha = data.get('senha')
    
    if not login or not senha:
        return jsonify({'error': 'Preencha login e senha.'}), 400
        
    db = get_db()
    user = db.execute("SELECT * FROM usuarios WHERE login = ? AND status = 1", (login,)).fetchone()
    
    if user and bcrypt.checkpw(senha.encode('utf-8'), user['senha_hash'].encode('utf-8')):
        # Fetch user permissions
        permissoes_rows = db.execute("""
            SELECT p.descricao 
            FROM permissoes p
            JOIN perfil_permissao pp ON p.id_permissao = pp.id_permissao
            WHERE pp.id_perfil = ?
        """, (user['id_perfil'],)).fetchall()
        permissoes = [row['descricao'] for row in permissoes_rows]

        return jsonify({
            'message': 'Login realizado com sucesso',
            'user': {
                'id_usuario': user['id_usuario'],
                'nome': user['nome'],
                'login': user['login'],
                'id_perfil': user['id_perfil'],
                'permissoes': permissoes
            }
        })
    else:
        return jsonify({'error': 'Credenciais inválidas.'}), 401

# --- Dizimistas Routes ---
@app.route('/api/dizimistas', methods=['GET'])
def get_dizimistas():
    q = request.args.get('q')
    p_fonetica = request.args.get('fonetica')
    db = get_db()
    if p_fonetica:
        f_str = generate_phonetics(p_fonetica, db)
        parts = f_str.split()
        if parts:
            # Match ANY of the phonetic parts
            conds = " OR ".join(["fonetica LIKE ?" for _ in parts])
            params = [f"%{p}%" for p in parts]
            query = f"SELECT * FROM dizimistas WHERE status = 1 AND ({conds}) ORDER BY nome"
            dizimistas = db.execute(query, tuple(params)).fetchall()
        else:
            dizimistas = []
    elif q:
        query = "SELECT * FROM dizimistas WHERE status = 1 AND (nome LIKE ? OR cpf LIKE ?) ORDER BY nome"
        dizimistas = db.execute(query, (f'%{q}%', f'%{q}%')).fetchall()
    else:
        dizimistas = db.execute("SELECT * FROM dizimistas WHERE status = 1 ORDER BY nome").fetchall()
    return jsonify([dict(d) for d in dizimistas])

@app.route('/api/dizimistas', methods=['POST'])
def create_dizimista():
    data = request.json
    db = get_db()
    
    # Check CPF format and uniqueness
    cpf = data.get('cpf')
    if not cpf:
        return jsonify({'error': 'CPF é obrigatório.'}), 400
        
    exist = db.execute("SELECT id_dizimista FROM dizimistas WHERE cpf = ?", (cpf,)).fetchone()
    if exist:
        return jsonify({'error': 'CPF já cadastrado.'}), 400
        
    cursor = db.execute("""
        INSERT INTO dizimistas (nome, cpf, telefone, email, endereco, bairro, cidade, cep, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (data.get('nome'), cpf, data.get('telefone'), data.get('email'), 
          data.get('endereco'), data.get('bairro'), data.get('cidade'), data.get('cep'), data.get('observacoes')))
    db.commit()
    
    # Needs a real logged user for audit in production, using 'system' or passed user
    new_id = fetch_scalar(db.execute("SELECT MAX(id_dizimista) FROM dizimistas"))
    
    user_id = data.get('user_id', 'sistema')
    log_auditoria('dizimistas', new_id, 'INCLUSAO', user_id, dados_novos=data)
    
    return jsonify({'message': 'Dizimista criado com sucesso', 'id': new_id}), 201

@app.route('/api/dizimistas/<int:id>', methods=['PUT', 'DELETE'])
def manage_dizimista(id):
    db = get_db()
    
    if request.method == 'DELETE':
        # Exclusão lógica
        dizimista = db.execute("SELECT * FROM dizimistas WHERE id_dizimista = ?", (id,)).fetchone()
        if not dizimista:
            return jsonify({'error': 'Não encontrado.'}), 404
        db.execute("UPDATE dizimistas SET status = 0 WHERE id_dizimista = ?", (id,))
        db.commit()
        return jsonify({'message': 'Removido com sucesso'})
        
    if request.method == 'PUT':
        data = request.json
        cpf = data.get('cpf')
        
        # Check if another user has this CPF
        exist = db.execute("SELECT id_dizimista FROM dizimistas WHERE cpf = ? AND id_dizimista != ?", (cpf, id)).fetchone()
        if exist:
            return jsonify({'error': 'CPF já cadastrado em outro dizimista.'}), 400
            
        dados_anteriores = dict(db.execute("SELECT * FROM dizimistas WHERE id_dizimista = ?", (id,)).fetchone() or {})
        
        fonetica_str = generate_phonetics(data.get('nome', ''), db)
        db.execute("""
            UPDATE dizimistas 
            SET nome=?, cpf=?, telefone=?, email=?, endereco=?, bairro=?, cidade=?, cep=?, observacoes=?, fonetica=?
            WHERE id_dizimista=?
        """, (data.get('nome'), cpf, data.get('telefone'), data.get('email'), 
              data.get('endereco'), data.get('bairro'), data.get('cidade'), data.get('cep'), data.get('observacoes'), fonetica_str, id))
        db.commit()
        
        user_id = data.get('user_id', 'sistema')
        log_auditoria('dizimistas', id, 'ALTERACAO', user_id, dados_anteriores=dados_anteriores, dados_novos=data)
        
        return jsonify({'message': 'Dizimista atualizado com sucesso'})

@app.route('/api/dizimistas/<int:id>/historico', methods=['GET'])
def get_dizimista_historico(id):
    db = get_db()
    historico = db.execute("SELECT * FROM auditoria WHERE nome_tabela = 'dizimistas' AND id_registro = ? ORDER BY data_hora DESC", (id,)).fetchall()
    return jsonify([dict(h) for h in historico])


# --- Usuários & Perfis (RF02, RF03) ---
@app.route('/api/perfis', methods=['GET', 'POST'])
def handle_perfis():
    db = get_db()
    if request.method == 'GET':
        perfis = db.execute("SELECT * FROM perfis WHERE status = 1").fetchall()
        return jsonify([dict(p) for p in perfis])
    if request.method == 'POST':
        data = request.json
        cursor = db.execute("INSERT INTO perfis (descricao) VALUES (?)", (data['descricao'],))
        new_id = fetch_scalar(db.execute("SELECT MAX(id_perfil) FROM perfis"))
        db.commit()
        return jsonify({'message': 'Perfil criado com sucesso', 'id': new_id}), 201

@app.route('/api/perfis/<int:id>', methods=['PUT', 'DELETE'])
def gerenciar_perfis(id):
    db = get_db()
    if request.method == 'DELETE':
        # Check if there are users with this profile before deleting
        users_count = fetch_scalar(db.execute("SELECT COUNT(*) FROM usuarios WHERE id_perfil = ? AND status = 1", (id,)))
        if users_count > 0:
            return jsonify({'error': 'Não é possível excluir perfil associado a usuários ativos.'}), 400
        
        db.execute("UPDATE perfis SET status = 0 WHERE id_perfil = ?", (id,))
        db.commit()
        return jsonify({'message': 'Removido com sucesso'})
    if request.method == 'PUT':
        data = request.json
        db.execute("UPDATE perfis SET descricao=? WHERE id_perfil=?", (data['descricao'], id))
        db.commit()
        return jsonify({'message': 'Atualizado com sucesso'})

@app.route('/api/permissoes', methods=['GET'])
def get_permissoes():
    db = get_db()
    permissoes = db.execute("SELECT * FROM permissoes ORDER BY descricao").fetchall()
    return jsonify([dict(p) for p in permissoes])

@app.route('/api/perfis/<int:id_perfil>/permissoes', methods=['GET', 'POST'])
def handle_perfil_permissoes(id_perfil):
    db = get_db()
    if request.method == 'GET':
        rows = db.execute("SELECT id_permissao FROM perfil_permissao WHERE id_perfil = ?", (id_perfil,)).fetchall()
        return jsonify([r['id_permissao'] for r in rows])
        
    if request.method == 'POST':
        data = request.json # Expects a list of id_permissao
        ids_permissoes = data.get('permissoes', [])
        
        db.execute("DELETE FROM perfil_permissao WHERE id_perfil = ?", (id_perfil,))
        
        for id_perm in ids_permissoes:
            db.execute("INSERT INTO perfil_permissao (id_perfil, id_permissao) VALUES (?, ?)", (id_perfil, id_perm))
            
        db.commit()
        return jsonify({'message': 'Permissões atualizadas com sucesso'})

@app.route('/api/usuarios', methods=['GET'])
def get_usuarios():
    db = get_db()
    query = """
        SELECT u.id_usuario, u.nome, u.login, u.status, u.data_criacao, p.descricao as perfil_nome, u.id_perfil
        FROM usuarios u
        JOIN perfis p ON u.id_perfil = p.id_perfil
        WHERE u.status = 1
    """
    usuarios = db.execute(query).fetchall()
    return jsonify([dict(u) for u in usuarios])

@app.route('/api/usuarios', methods=['POST'])
def create_usuario():
    data = request.json
    db = get_db()
    login = data.get('login')
    
    if db.execute("SELECT id_usuario FROM usuarios WHERE login = ?", (login,)).fetchone():
        return jsonify({'error': 'Login já em uso.'}), 400
        
    senha_hash = bcrypt.hashpw(data['senha'].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    cursor = db.execute("INSERT INTO usuarios (nome, login, senha_hash, id_perfil) VALUES (?, ?, ?, ?)",
                        (data['nome'], login, senha_hash, data['id_perfil']))
    db.commit()
    user_id = data.get('current_user_id', 'sistema')
    log_auditoria('usuarios', 0, 'INCLUSAO', user_id, dados_novos=data)
    return jsonify({'message': 'Usuário criado com sucesso', 'id': 0}), 201

@app.route('/api/usuarios/<int:id>', methods=['PUT', 'DELETE'])
def gerenciar_usuario(id):
    db = get_db()
    if request.method == 'DELETE':
        db.execute("UPDATE usuarios SET status = 0 WHERE id_usuario = ?", (id,))
        db.commit()
        return jsonify({'message': 'Removido com sucesso'})
    if request.method == 'PUT':
        data = request.json
        if 'senha' in data and data['senha']:
            senha_hash = bcrypt.hashpw(data['senha'].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            db.execute("UPDATE usuarios SET nome=?, id_perfil=?, senha_hash=? WHERE id_usuario=?", 
                       (data['nome'], data['id_perfil'], senha_hash, id))
        else:
            db.execute("UPDATE usuarios SET nome=?, id_perfil=? WHERE id_usuario=?", 
                       (data['nome'], data['id_perfil'], id))
        db.commit()
        return jsonify({'message': 'Atualizado com sucesso'})

# --- Tipos de Pagamento (RF06) ---
@app.route('/api/tipos-pagamento', methods=['GET', 'POST'])
def handle_tipos():
    db = get_db()
    if request.method == 'GET':
        tipos = db.execute("SELECT * FROM tipos_pagamento WHERE status = 1").fetchall()
        return jsonify([dict(t) for t in tipos])
    if request.method == 'POST':
        data = request.json
        cursor = db.execute("INSERT INTO tipos_pagamento (descricao) VALUES (?)", (data['descricao'],))
        new_id = fetch_scalar(db.execute("SELECT MAX(id_tipo_pagamento) FROM tipos_pagamento"))
        db.commit()
        return jsonify({'message': 'Criado com sucesso', 'id': new_id}), 201

@app.route('/api/tipos-pagamento/<int:id>', methods=['PUT', 'DELETE'])
def manage_tipos(id):
    db = get_db()
    if request.method == 'DELETE':
        db.execute("UPDATE tipos_pagamento SET status = 0 WHERE id_tipo_pagamento = ?", (id,))
        db.commit()
        return jsonify({'message': 'Removido'})
    if request.method == 'PUT':
        data = request.json
        db.execute("UPDATE tipos_pagamento SET descricao = ? WHERE id_tipo_pagamento = ?", (data['descricao'], id))
        db.commit()
        return jsonify({'message': 'Atualizado'})

# --- Missas (RF05) ---
@app.route('/api/missas', methods=['GET', 'POST'])
def handle_missas():
    db = get_db()
    if request.method == 'GET':
        missas = db.execute("SELECT * FROM missas WHERE status = 1 ORDER BY data DESC").fetchall()
        return jsonify([dict(t) for t in missas])
    if request.method == 'POST':
        data = request.json
        cursor = db.execute("INSERT INTO missas (data, hora, comunidade, celebrante, tipo) VALUES (?, ?, ?, ?, ?)",
                            (data['data'], data['hora'], data.get('comunidade'), data.get('celebrante'), data.get('tipo')))
        db.commit()
        return jsonify({'message': 'Missa criada', 'id': 0}), 201

@app.route('/api/missas/<int:id>', methods=['PUT', 'DELETE'])
def manage_missas(id):
    db = get_db()
    if request.method == 'DELETE':
        db.execute("UPDATE missas SET status = 0 WHERE id_missa = ?", (id,))
        db.commit()
        return jsonify({'message': 'Removida'})
    if request.method == 'PUT':
        data = request.json
        db.execute("UPDATE missas SET data=?, hora=?, comunidade=?, celebrante=?, tipo=? WHERE id_missa=?",
                   (data['data'], data['hora'], data.get('comunidade'), data.get('celebrante'), data.get('tipo'), id))
        db.commit()
        return jsonify({'message': 'Atualizada'})

# --- Recebimentos Routes ---
@app.route('/api/recebimentos', methods=['GET'])
def get_recebimentos():
    db = get_db()
    mes = request.args.get('mes')
    ano = request.args.get('ano')
    id_dizimista = request.args.get('id_dizimista')

    where_clauses = ["r.status = 1"]
    params = []

    if mes:
        where_clauses.append("r.competencia LIKE ?")
        params.append(f"{mes.zfill(2)}/%")
    if ano:
        where_clauses.append("r.competencia LIKE ?")
        params.append(f"%/{ano}")
    if id_dizimista:
        where_clauses.append("r.id_dizimista = ?")
        params.append(id_dizimista)

    where_str = " AND ".join(where_clauses)
    query = f"""
        SELECT r.*, d.nome as dizimista_nome, t.descricao as tipo_pagamento_nome
        FROM recebimentos r
        JOIN dizimistas d ON r.id_dizimista = d.id_dizimista
        JOIN tipos_pagamento t ON r.id_tipo_pagamento = t.id_tipo_pagamento
        WHERE {where_str}
        ORDER BY r.data_recebimento DESC
    """
    recebimentos = db.execute(query, params).fetchall()
    return jsonify([dict(r) for r in recebimentos])

@app.route('/api/recebimentos', methods=['POST'])
def create_recebimento():
    data = request.json
    db = get_db()
    
    # Validations
    id_dizimista = data.get('id_dizimista')
    valor = data.get('valor')
    competencia = data.get('competencia') # MM/YYYY
    id_tipo_pagamento = data.get('id_tipo_pagamento')
    id_usuario = data.get('id_usuario')
    
    if not all([id_dizimista, valor, competencia, id_tipo_pagamento, id_usuario]):
        return jsonify({'error': 'Dados incompletos.'}), 400
        
    cursor = db.execute("""
        INSERT INTO recebimentos (id_dizimista, valor, competencia, id_tipo_pagamento, id_missa, id_usuario, observacao)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (id_dizimista, valor, competencia, id_tipo_pagamento, data.get('id_missa'), id_usuario, data.get('observacao')))
    
    db.commit()
    return jsonify({'message': 'Atendimento registrado com sucesso', 'id': 0}), 201

@app.route('/api/recebimentos/<int:id>', methods=['DELETE'])
def delete_recebimento(id):
    """Estorno lógico de recebimento"""
    db = get_db()
    rec = db.execute("SELECT * FROM recebimentos WHERE id_recebimento = ? AND status = 1", (id,)).fetchone()
    if not rec:
        return jsonify({'error': 'Lançamento não encontrado.'}), 404
    db.execute("UPDATE recebimentos SET status = 0 WHERE id_recebimento = ?", (id,))
    db.commit()
    return jsonify({'message': 'Estornado com sucesso'})

# --- Dashboard Data ---
@app.route('/api/dashboard', methods=['GET'])
def get_dashboard_info():
    db = get_db()
    hoje = datetime.now().strftime('%Y-%m-%d')
    mes = datetime.now().strftime('%m')
    ano = datetime.now().strftime('%Y')
    
    # Totalizadores rápidos
    total_dia = fetch_scalar(db.execute("SELECT SUM(valor) FROM recebimentos WHERE TRUNC(data_recebimento) = TO_DATE(?, 'YYYY-MM-DD') AND status = 1", (hoje,))) or 0
    total_mes = fetch_scalar(db.execute("SELECT SUM(valor) FROM recebimentos WHERE TO_CHAR(data_recebimento, 'MM') = ? AND TO_CHAR(data_recebimento, 'YYYY') = ? AND status = 1", (mes, ano))) or 0
    dizimistas_ativos = fetch_scalar(db.execute("SELECT COUNT(*) FROM dizimistas WHERE status = 1")) or 0
    
    return jsonify({
        'total_dia': total_dia,
        'total_mes': total_mes,
        'dizimistas_ativos': dizimistas_ativos
    })

if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(debug=True, port=5000)
