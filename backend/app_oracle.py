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
from datetime import datetime, date
from functools import wraps

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# Custom JSON Provider for Flask >= 2.2 to handle datetime objects and Oracle LOBs
class CustomJSONProvider(app.json_provider_class):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        # Handle Oracle LOBs (CLOB)
        if hasattr(obj, 'read') and callable(obj.read):
            return obj.read()
        return super().default(obj)

app.json = CustomJSONProvider(app)

def requires_permission(permission_name):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user_id = request.headers.get('X-User-Id')
            try:
                user_id = int(user_id)
            except (ValueError, TypeError):
                return jsonify({'error': 'ID de usuário inválido.'}), 400

            db = get_db()
            user = db.execute("SELECT id_perfil FROM usuarios WHERE id_usuario = ?", (user_id,)).fetchone()
            if not user:
                 return jsonify({'error': 'Usuário não encontrado.'}), 401
            
            # Se for admin (perfil 1), libera direto
            if int(user['id_perfil']) == 1:
                return f(*args, **kwargs)

            # Check if user has permission
            has = db.execute("""
                SELECT COUNT(*) as total
                FROM perfil_permissao pp
                JOIN permissoes per ON pp.id_permissao = per.id_permissao
                WHERE pp.id_perfil = ? AND per.descricao = ?
            """, (user['id_perfil'], permission_name)).fetchone()
            
            if not has or has['total'] == 0:
                return jsonify({'error': f'Sem permissão: {permission_name}'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def check_permission_backend(permission_name):
    user_id = request.headers.get('X-User-Id')
    try:
        user_id = int(request.headers.get('X-User-Id'))
    except (ValueError, TypeError):
        return False
        
    db = get_db()
    user = db.execute("SELECT id_perfil FROM usuarios WHERE id_usuario = ?", (user_id,)).fetchone()
    if not user: return False
    if int(user['id_perfil']) == 1: return True
    has = db.execute("""
        SELECT COUNT(*) as total FROM perfil_permissao pp
        JOIN permissoes per ON pp.id_permissao = per.id_permissao
        WHERE pp.id_perfil = ? AND per.descricao = ?
    """, (int(user['id_perfil']), permission_name)).fetchone()
    return has and has['total'] > 0

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/health')
def health():
    """Rota de diagnóstico — mostra status da conexão Oracle no Render."""
    info = {}
    # Variáveis de ambiente
    info['env_ORACLE_USER']  = os.environ.get('ORACLE_USER', '(nao definido)')
    info['env_ORACLE_DSN']   = os.environ.get('ORACLE_DSN',  '(nao definido)')
    info['env_ORACLE_PASS']  = '***' if os.environ.get('ORACLE_PASS') else '(nao definido)'
    info['env_WALLET_B64']   = f'{len(os.environ.get("WALLET_B64",""))} chars' if os.environ.get('WALLET_B64') else '(nao definido - PROBLEMA!)'
    info['env_WALLET_PASS']  = '***' if os.environ.get('WALLET_PASS') else '(nao definido)'

    # Wallet dir
    try:
        wdir = get_wallet_dir()
        info['wallet_dir'] = wdir
        info['wallet_files'] = os.listdir(wdir) if os.path.isdir(wdir) else 'pasta nao existe!'
    except Exception as e:
        info['wallet_error'] = str(e)

    # Teste de conexao
    try:
        wdir = get_wallet_dir()
        conn = oracledb.connect(
            user=ORACLE_USER, password=ORACLE_PASS, dsn=ORACLE_DSN,
            config_dir=wdir, wallet_location=wdir, wallet_password=WALLET_PASS
        )
        conn.close()
        info['db_status'] = 'CONECTADO OK'
    except Exception as e:
        info['db_status'] = f'ERRO: {type(e).__name__}: {e}'

    return jsonify(info)

# --- Configuração Oracle ---
# Lê de variáveis de ambiente (Render/Cloud) ou usa valores locais como fallback
ORACLE_USER = os.environ.get('ORACLE_USER', 'DIZIMO')
ORACLE_PASS = os.environ.get('ORACLE_PASS', 'Alinne05@ora')
ORACLE_DSN  = os.environ.get('ORACLE_DSN',  'imaculado_high')
WALLET_PASS = os.environ.get('WALLET_PASS', 'Alinne05@ora')

# Wallet resolvida de forma lazy na primeira conexão
_wallet_tmp_dir = None

def get_wallet_dir():
    """Retorna o diretório da Wallet Oracle.
    - Em produção (Render): extrai do env var WALLET_B64 (zip em base64)
    - Local: usa pasta DriveOracle relativa ao arquivo
    """
    global _wallet_tmp_dir
    wallet_b64 = os.environ.get('WALLET_B64')
    if wallet_b64:
        if _wallet_tmp_dir is None:
            try:
                tmp = tempfile.mkdtemp(prefix='oracle_wallet_')
                zip_bytes = base64.b64decode(wallet_b64)
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    zf.extractall(tmp)
                _wallet_tmp_dir = tmp
                arquivos = os.listdir(tmp)
                print(f'[Wallet] OK. Extraida para: {tmp}. Arquivos: {arquivos}')
            except Exception as e:
                print(f'[Wallet] ERRO ao extrair: {e}')
                raise
        return _wallet_tmp_dir
    else:
        # Local: usa pasta DriveOracle
        local = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))
        print(f'[Wallet] Modo local: {local}')
        return local

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
            wallet_dir = get_wallet_dir()  # lazy: resolve no momento da conexao
            print(f'[DB] Conectando. user={ORACLE_USER} dsn={ORACLE_DSN} wallet={wallet_dir}')
            connection = oracledb.connect(
                user=ORACLE_USER,
                password=ORACLE_PASS,
                dsn=ORACLE_DSN,
                config_dir=wallet_dir,
                wallet_location=wallet_dir,
                wallet_password=WALLET_PASS
            )
            cursor = connection.cursor()
            cursor.execute("ALTER SESSION SET NLS_COMP = LINGUISTIC")
            cursor.execute("ALTER SESSION SET NLS_SORT = BINARY_AI")
            connection.autocommit = False
            db = g._database = OracleWrapper(connection)
            print('[DB] Conexao estabelecida com sucesso.')
        except Exception as e:
            print(f'[DB] ERRO AO CONECTAR: {type(e).__name__}: {e}')
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

@app.route('/api/auth/change-password', methods=['POST'])
def change_password():
    data = request.json
    user_id = data.get('id_usuario')
    senha_atual = data.get('senha_atual')
    nova_senha = data.get('nova_senha')
    
    if not user_id or not senha_atual or not nova_senha:
        return jsonify({'error': 'Preencha todos os campos.'}), 400
        
    db = get_db()
    user = db.execute("SELECT * FROM usuarios WHERE id_usuario = ?", (user_id,)).fetchone()
    
    if not user:
        return jsonify({'error': 'Usuário não encontrado.'}), 404
        
    if not bcrypt.checkpw(senha_atual.encode('utf-8'), user['senha_hash'].encode('utf-8')):
        return jsonify({'error': 'Senha atual incorreta.'}), 401
        
    new_hash = bcrypt.hashpw(nova_senha.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.execute("UPDATE usuarios SET senha_hash = ? WHERE id_usuario = ?", (new_hash, user_id))
    db.commit()
    
    log_auditoria(user_id, 'ALTERACAO', 'usuarios', user_id, f"Troca de senha do usuario {user['login']}")
    
    return jsonify({'message': 'Senha alterada com sucesso!'})

# --- Dizimistas Routes ---
@app.route('/api/dizimistas', methods=['GET'])
@requires_permission('Visualizar Dizimistas')
def get_dizimistas():
    q = request.args.get('q')
    p_fonetica = request.args.get('fonetica')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 10))
    offset = (page - 1) * per_page

    db = get_db()
    base_where = "status = 1"
    params = []

    if p_fonetica:
        f_str = generate_phonetics(p_fonetica, db)
        parts = f_str.split()
        if parts:
            conds = " OR ".join(["fonetica LIKE ?" for _ in parts])
            params = [f"%{p}%" for p in parts]
            base_where += f" AND ({conds})"
        else:
            return jsonify({"data": [], "total": 0, "page": page, "per_page": per_page})
    elif q:
        base_where += " AND (nome LIKE ? OR cpf LIKE ?)"
        params = [f'%{q}%', f'%{q}%']

    # Total de registros
    count_query = f"SELECT COUNT(*) as total FROM dizimistas WHERE {base_where}"
    total = db.execute(count_query, tuple(params)).fetchone()['total']

    # Dados paginados
    data_query = f"SELECT * FROM dizimistas WHERE {base_where} ORDER BY nome OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
    data_params = params + [offset, per_page]
    dizimistas = db.execute(data_query, tuple(data_params)).fetchall()

    return jsonify({
        "data": [dict(d) for d in dizimistas],
        "total": int(total),
        "page": page,
        "per_page": per_page
    })

@app.route('/api/dizimistas/<int:id>', methods=['GET'])
@requires_permission('Visualizar Dizimistas')
def get_dizimista(id):
    db = get_db()
    diz = db.execute("SELECT * FROM dizimistas WHERE id_dizimista = ?", (id,)).fetchone()
    if not diz:
        return jsonify({'error': 'Não encontrado'}), 404
    return jsonify(dict(diz))

@app.route('/api/dizimistas', methods=['POST'])
@requires_permission('Criar Dizimistas')
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
        
    nasc = data.get('data_nascimento')
    nasc_dt = None
    if nasc and nasc.strip():
        try:
            nasc_dt = datetime.strptime(nasc, '%Y-%m-%d')
        except:
            pass

    cursor = db.execute("""
        INSERT INTO dizimistas (nome, cpf, telefone, email, endereco, bairro, cidade, cep, data_nascimento, valor_dizimo, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (data.get('nome'), cpf, data.get('telefone'), data.get('email'), 
          data.get('endereco'), data.get('bairro'), data.get('cidade'), data.get('cep'), nasc_dt, 
          data.get('valor_dizimo', 0), data.get('observacoes')))
    db.commit()
    
    # Needs a real logged user for audit in production, using 'system' or passed user
    new_id = fetch_scalar(db.execute("SELECT MAX(id_dizimista) FROM dizimistas"))
    
    user_id = data.get('user_id', 'sistema')
    log_auditoria('dizimistas', new_id, 'INCLUSAO', user_id, dados_novos=data)
    
    return jsonify({'message': 'Dizimista criado com sucesso', 'id': new_id}), 201

@app.route('/api/dizimistas/<int:id>', methods=['PUT', 'DELETE'])
def manage_dizimista(id):
    if request.method == 'DELETE':
        if not check_permission_backend('Excluir Dizimistas'):
             return jsonify({'error': 'Sem permissão para excluir dizimistas'}), 403
        db = get_db()
        # Exclusão lógica
        dizimista = db.execute("SELECT * FROM dizimistas WHERE id_dizimista = ?", (id,)).fetchone()
        if not dizimista:
            return jsonify({'error': 'Não encontrado.'}), 404
        db.execute("UPDATE dizimistas SET status = 0 WHERE id_dizimista = ?", (id,))
        db.commit()
        return jsonify({'message': 'Removido com sucesso'})
        
    if request.method == 'PUT':
        if not check_permission_backend('Editar Dizimistas'):
             return jsonify({'error': 'Sem permissão para editar dizimistas'}), 403
        data = request.json
        db = get_db()
        cpf = data.get('cpf')
        
        # Check if another user has this CPF
        exist = db.execute("SELECT id_dizimista FROM dizimistas WHERE cpf = ? AND id_dizimista != ?", (cpf, id)).fetchone()
        if exist:
            return jsonify({'error': 'CPF já cadastrado em outro dizimista.'}), 400
            
        dados_anteriores = dict(db.execute("SELECT * FROM dizimistas WHERE id_dizimista = ?", (id,)).fetchone() or {})
        
        fonetica_str = generate_phonetics(data.get('nome', ''), db)
        nasc = data.get('data_nascimento')
        nasc_dt = None
        if nasc and nasc.strip():
            try:
                nasc_dt = datetime.strptime(nasc, '%Y-%m-%d')
            except:
                pass

        db.execute("""
            UPDATE dizimistas 
            SET nome=?, cpf=?, telefone=?, email=?, endereco=?, bairro=?, cidade=?, cep=?, observacoes=?, fonetica=?, data_nascimento=?, valor_dizimo=?
            WHERE id_dizimista=?
        """, (data.get('nome'), cpf, data.get('telefone'), data.get('email'), 
              data.get('endereco'), data.get('bairro'), data.get('cidade'), data.get('cep'), data.get('observacoes'), 
              fonetica_str, nasc_dt, data.get('valor_dizimo', 0), id))
        db.commit()
        
        user_id = data.get('user_id', 'sistema')
        log_auditoria('dizimistas', id, 'ALTERACAO', user_id, dados_anteriores=dados_anteriores, dados_novos=data)
        
        return jsonify({'message': 'Dizimista atualizado com sucesso'})

@app.route('/api/dizimistas/<int:id>/historico', methods=['GET'])
def get_dizimista_historico(id):
    db = get_db()
    historico = db.execute("SELECT * FROM auditoria WHERE nome_tabela = 'dizimistas' AND id_registro = ? ORDER BY data_hora DESC", (id,)).fetchall()
    return jsonify([dict(h) for h in historico])


# --- Missas ---
@app.route('/api/missas', methods=['GET'])
@requires_permission('Visualizar Missas')
def get_missas():
    db = get_db()
    missas = db.execute("SELECT * FROM missas WHERE status = 1 ORDER BY data_missa DESC, hora").fetchall()
    return jsonify([dict(m) for m in missas])

@app.route('/api/missas', methods=['POST'])
@requires_permission('Criar Missas')
def create_missa():
    data = request.json
    db = get_db()
    db.execute("""
        INSERT INTO missas (data_missa, hora, comunidade, celebrante, tipo)
        VALUES (?, ?, ?, ?, ?)
    """, (data.get('data_missa'), data.get('hora'), data.get('comunidade'),
          data.get('celebrante'), data.get('tipo')))
    db.commit()
    return jsonify({'message': 'Missa criada com sucesso'}), 201

@app.route('/api/missas/<int:id>', methods=['GET'])
@requires_permission('Visualizar Missas')
def get_missa(id):
    db = get_db()
    m = db.execute("SELECT * FROM missas WHERE id_missa = ?", (id,)).fetchone()
    if not m:
        return jsonify({'error': 'Não encontrado'}), 404
    return jsonify(dict(m))

@app.route('/api/missas/<int:id>', methods=['PUT'])
@requires_permission('Editar Missas')
def update_missa(id):
    data = request.json
    db = get_db()
    db.execute("""
        UPDATE missas SET data_missa=?, hora=?, comunidade=?, celebrante=?, tipo=?
        WHERE id_missa=?
    """, (data.get('data_missa'), data.get('hora'), data.get('comunidade'),
          data.get('celebrante'), data.get('tipo'), id))
    db.commit()
    return jsonify({'message': 'Missa atualizada com sucesso'})

@app.route('/api/missas/<int:id>', methods=['DELETE'])
@requires_permission('Excluir Missas')
def delete_missa(id):
    db = get_db()
    db.execute("UPDATE missas SET status = 0 WHERE id_missa = ?", (id,))
    db.commit()
    return jsonify({'message': 'Missa excluída'})


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
@requires_permission('Visualizar Usuários')
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
@requires_permission('Visualizar Lançamentos')
def get_recebimentos():
    db = get_db()
    mes = request.args.get('mes')
    ano = request.args.get('ano')
    id_dizimista = request.args.get('id_dizimista')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 10))
    offset = (page - 1) * per_page

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

    # Count total
    count_query = f"""
        SELECT COUNT(*) as total
        FROM recebimentos r
        JOIN dizimistas d ON r.id_dizimista = d.id_dizimista
        WHERE {where_str}
    """
    total = db.execute(count_query, params).fetchone()['total']

    # Get paginated data
    query = f"""
        SELECT r.*, d.nome as dizimista_nome, t.descricao as tipo_pagamento_nome
        FROM recebimentos r
        JOIN dizimistas d ON r.id_dizimista = d.id_dizimista
        JOIN tipos_pagamento t ON r.id_tipo_pagamento = t.id_tipo_pagamento
        WHERE {where_str}
        ORDER BY r.data_recebimento DESC
        OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    """
    data_params = params + [offset, per_page]
    recebimentos = db.execute(query, data_params).fetchall()

    return jsonify({
        "data": [dict(r) for r in recebimentos],
        "total": int(total),
        "page": page,
        "per_page": per_page
    })

@app.route('/api/recebimentos', methods=['POST'])
@requires_permission('Criar Lançamentos')
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
@requires_permission('Excluir Lançamentos')
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
