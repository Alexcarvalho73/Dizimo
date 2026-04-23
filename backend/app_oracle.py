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
            if str(user['id_perfil']) == '1':
                return f(*args, **kwargs)

            # Check if user has permission
            has = db.execute("""
                SELECT COUNT(*) as total
                FROM perfil_permissao pp
                JOIN permissoes per ON pp.id_permissao = per.id_permissao
                WHERE pp.id_perfil = ? AND per.descricao = ?
            """, (user['id_perfil'], permission_name)).fetchone()
            
            if not has or has['total'] == 0:
                print(f"[AUTH] Acesso negado: Usuario {user_id} tentou acessar '{permission_name}' sem permissao.")
                return jsonify({
                    'error': f'Acesso Negado: Você não tem a permissão "{permission_name}" necessária para realizar esta operação.',
                    'code': 'PERMISSION_DENIED',
                    'permission': permission_name
                }), 403
            
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

def check_user_coordination(user_id, id_pastoral):
    if not user_id: return False
    db = get_db()
    user = db.execute("SELECT id_perfil, id_dizimista FROM usuarios WHERE id_usuario = ?", (user_id,)).fetchone()
    if not user: return False
    if int(user['id_perfil']) == 1: return True
    if not user['id_dizimista']: return False
    
    res = db.execute("""
        SELECT COUNT(*) as total FROM dizimista_pastoral 
        WHERE id_dizimista = ? AND id_pastoral = ? AND papel = 'C'
    """, (user['id_dizimista'], id_pastoral)).fetchone()
    return res and res['total'] > 0

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

@app.errorhandler(403)
def forbidden(e):
    return jsonify({'error': 'Acesso proibido ou permissão insuficiente.', 'code': 'FORBIDDEN'}), 403

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Recurso não encontrado.', 'code': 'NOT_FOUND'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Erro interno do servidor. Verifique os logs.', 'code': 'INTERNAL_ERROR'}), 500

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

# --- Configurações & Parâmetros ---
@app.route('/api/configuracoes', methods=['GET'])
def get_configuracoes():
    db = get_db()
    rows = db.execute("SELECT chave, valor FROM configuracoes").fetchall()
    return jsonify({r['chave']: r['valor'] for r in rows})

@app.route('/api/configuracoes', methods=['PUT'])
def update_configuracoes():
    user_id = request.headers.get('X-User-Id')
    db = get_db()
    
    # Verificação rígida de admin (Perfil 1)
    user = db.execute("SELECT id_perfil FROM usuarios WHERE id_usuario = ?", (user_id,)).fetchone()
    if not user or str(user['id_perfil']) != '1':
        return jsonify({'error': 'Acesso Negado: Somente o perfil administrador pode alterar parâmetros.'}), 403

    data = request.json
    try:
        for chave, valor in data.items():
            # Tenta encontrar a chave primeiro
            row = db.execute("SELECT chave FROM configuracoes WHERE chave = ?", (chave,)).fetchone()
            if row:
                db.execute("UPDATE configuracoes SET valor = ? WHERE chave = ?", (valor, chave))
            else:
                db.execute("INSERT INTO configuracoes (chave, valor) VALUES (?, ?)", (chave, valor))
        db.commit()
        return jsonify({'message': 'Configurações atualizadas com sucesso'})
    except Exception as e:
        print(f"[CONFIG] Erro: {e}")
        return jsonify({'error': str(e)}), 500

def init_configuracoes():
    db = get_db()
    try:
        # Check if table exists
        db.execute("SELECT chave FROM configuracoes WHERE 1=0")
    except:
        # Create table if error
        try:
            db.execute("CREATE TABLE configuracoes (chave VARCHAR2(50) PRIMARY KEY, valor VARCHAR2(2000))")
            db.commit()
            print("[CONFIG] Tabela 'configuracoes' criada.")
        except Exception as e:
            print(f"[CONFIG] Erro ao criar tabela: {e}")
    
    # Defaults
    defaults = {
        'paroquia_nome': 'Imaculado Coração de Maria',
        'paroquia_logo': 'Logo.jpg'
    }
    for k, v in defaults.items():
        existe = db.execute("SELECT 1 FROM configuracoes WHERE chave = ?", (k,)).fetchone()
        if not existe:
            db.execute("INSERT INTO configuracoes (chave, valor) VALUES (?, ?)", (k, v))
            db.commit()

# Chame init_configuracoes() no local adequado ou garante que o banco esteja pronto.
@app.before_request
def check_configs():
    if not hasattr(app, '_configs_initialized'):
        try:
            init_configuracoes()
            app._configs_initialized = True
        except: pass

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

        # Fetch user pastorals if linked to a dizimista
        user_pastorals = []
        if user.get('id_dizimista'):
            rows = db.execute("SELECT id_pastoral FROM dizimista_pastoral WHERE id_dizimista = ?", (user['id_dizimista'],)).fetchall()
            user_pastorals = [r['id_pastoral'] for r in rows]

        return jsonify({
            'message': 'Login realizado com sucesso',
            'user': {
                'id_usuario': user['id_usuario'],
                'nome': user['nome'],
                'login': user['login'],
                'id_perfil': user['id_perfil'],
                'id_dizimista': user.get('id_dizimista'),
                'pastorais': user_pastorals,
                'permissoes': permissoes,
                'trocar_senha': user.get('trocar_senha', 0)
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
    db.execute("UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id_usuario = ?", (new_hash, user_id))
    db.commit()
    
    log_auditoria('usuarios', user_id, 'ALTERACAO', user['login'], 
                  dados_novos={'msg': f"Troca de senha do usuario {user['login']}"})
    
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
#    if not cpf:
#        return jsonify({'error': 'CPF é obrigatório.'}), 400
        
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
        INSERT INTO dizimistas (nome, apelido, cpf, telefone, email, endereco, bairro, cidade, cep, data_nascimento, valor_dizimo, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (data.get('nome'), data.get('apelido'), cpf, data.get('telefone'), data.get('email'), 
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
            SET nome=?, apelido=?, cpf=?, telefone=?, email=?, endereco=?, bairro=?, cidade=?, cep=?, observacoes=?, fonetica=?, data_nascimento=?, valor_dizimo=?
            WHERE id_dizimista=?
        """, (data.get('nome'), data.get('apelido'), cpf, data.get('telefone'), data.get('email'), 
              data.get('endereco'), data.get('bairro'), data.get('cidade'), data.get('cep'), data.get('observacoes'), 
              fonetica_str, nasc_dt, data.get('valor_dizimo', 0), id))
        db.commit()
        
        user_id = data.get('user_id', 'sistema')
        log_auditoria('dizimistas', id, 'ALTERACAO', user_id, dados_anteriores=dados_anteriores, dados_novos=data)
        
        return jsonify({'message': 'Dizimista atualizado com sucesso'})

@app.route('/api/dizimistas/<int:id>/historico', methods=['GET'])
def get_dizimista_historico(id):
    db = get_db()
    historico = db.execute("SELECT * FROM auditoria WHERE tabela = 'dizimistas' AND id_registro = ? ORDER BY data_hora DESC", (id,)).fetchall()
    return jsonify([dict(h) for h in historico])

@app.route('/api/dizimistas/<int:id>/pastorais', methods=['GET', 'POST'])
def handle_dizimista_pastorais(id):
    db = get_db()
    if request.method == 'GET':
        rows = db.execute("SELECT id_pastoral FROM dizimista_pastoral WHERE id_dizimista = ?", (id,)).fetchall()
        return jsonify([r['id_pastoral'] for r in rows])
    if request.method == 'POST':
        data = request.json # { pastorais: [id1, id2] }
        pastorais = data.get('pastorais', [])
        db.execute("DELETE FROM dizimista_pastoral WHERE id_dizimista = ?", (id,))
        for pid in pastorais:
            db.execute("INSERT INTO dizimista_pastoral (id_dizimista, id_pastoral) VALUES (?, ?)", (id, pid))
        db.commit()
        return jsonify({'message': 'Vínculo pastoral atualizado'})


@app.route('/api/missas', methods=['GET'])
@requires_permission('Visualizar Missas')
def get_missas():
    db = get_db()
    user_id = request.headers.get('X-User-Id')
    user = db.execute("SELECT id_perfil, id_dizimista FROM usuarios WHERE id_usuario = ?", (user_id,)).fetchone()

    # Parâmetros de filtro
    data_de   = request.args.get('data_de', '')
    data_ate  = request.args.get('data_ate', '')
    tipo      = request.args.get('tipo', '')
    celebrante = request.args.get('celebrante', '')
    order_dir = 'ASC' if request.args.get('order', 'asc').lower() == 'asc' else 'DESC'

    params = []

    # Filter logic: if linked to a dizimista, see only masses with relevant pastorals
    if user and int(user['id_perfil']) != 1 and user['id_dizimista']:
        base_query = """
            SELECT DISTINCT m.* FROM missas m
            JOIN missa_pastoral mp ON m.id_missa = mp.id_missa
            JOIN dizimista_pastoral dp ON mp.id_pastoral = dp.id_pastoral
            WHERE m.status = 1 AND dp.id_dizimista = ?
        """
        params = [user['id_dizimista']]
    else:
        base_query = "SELECT * FROM missas WHERE status = 1"

    # Aplicar filtros adicionais
    if data_de:
        base_query += " AND data_missa >= ?"
        params.append(data_de)
    if data_ate:
        base_query += " AND data_missa <= ?"
        params.append(data_ate)
    if tipo:
        base_query += " AND tipo = ?"
        params.append(tipo)
    if celebrante:
        base_query += " AND UPPER(celebrante) LIKE UPPER(?)"
        params.append(f'%{celebrante}%')

    base_query += f" ORDER BY data_missa {order_dir}, hora"

    missas_rows = db.execute(base_query, params).fetchall()

    missas = []
    for m in missas_rows:
        m_dict = dict(m)
        id_m = m_dict['id_missa']

        # Requisitos de pastorais
        p_reqs = db.execute("""
            SELECT mp.id_pastoral, mp.quantidade_servos as quantidade, p.nome as pastoral_nome
            FROM missa_pastoral mp
            JOIN pastorais p ON mp.id_pastoral = p.id_pastoral
            WHERE mp.id_missa = ?
        """, (id_m,)).fetchall()
        m_dict['pastorais'] = [dict(p) for p in p_reqs]

        # Calcular totais de vagas e preenchidas (Filtrado por pastoral do usuário se não for Admin)
        if user and int(user['id_perfil']) != 1 and user['id_dizimista']:
            vagas_data = db.execute("""
                SELECT
                    (SELECT SUM(mp.quantidade_servos) FROM missa_pastoral mp 
                     JOIN dizimista_pastoral dp ON mp.id_pastoral = dp.id_pastoral
                     WHERE mp.id_missa = ? AND dp.id_dizimista = ?) as total,
                    (SELECT COUNT(*) FROM missa_servos ms
                     JOIN dizimista_pastoral dp ON ms.id_pastoral = dp.id_pastoral
                     WHERE ms.id_missa = ? AND dp.id_dizimista = ? AND ms.status = 1) as preenchidas
                FROM dual
            """, (id_m, user['id_dizimista'], id_m, user['id_dizimista'])).fetchone()
        else:
            vagas_data = db.execute("""
                SELECT
                    (SELECT SUM(quantidade_servos) FROM missa_pastoral WHERE id_missa = ?) as total,
                    (SELECT COUNT(*) FROM missa_servos WHERE id_missa = ? AND status = 1) as preenchidas
                FROM dual
            """, (id_m, id_m)).fetchone()

        m_dict['total_vagas'] = int(vagas_data['total'] or 0)
        m_dict['preenchidas'] = int(vagas_data['preenchidas'] or 0)

        missas.append(m_dict)

    return jsonify(missas)

@app.route('/api/missas', methods=['POST'])
@requires_permission('Criar Missas')
def create_missa():
    try:
        data = request.json
        db = get_db()
        db.execute("""
            INSERT INTO missas (data_missa, hora, comunidade, celebrante, tipo)
            VALUES (?, ?, ?, ?, ?)
        """, (data.get('data_missa'), data.get('hora'), data.get('comunidade'),
              data.get('celebrante'), data.get('tipo')))
        
        new_id = fetch_scalar(db.execute("SELECT MAX(id_missa) FROM missas"))

        # Save Pastorals requirements
        pastorais_req = data.get('pastorais', [])
        for p in pastorais_req:
            db.execute("""
                INSERT INTO missa_pastoral (id_missa, id_pastoral, quantidade_servos)
                VALUES (?, ?, ?)
            """, (new_id, int(p['id_pastoral']), int(p['quantidade'])))

        db.commit()
        return jsonify({'message': 'Missa criada com sucesso', 'id': new_id}), 201
    except Exception as e:
        print(f"ERRO SQL (create_missa): {e}")
        return jsonify({'error': f'Erro ao criar missa: {str(e)}'}), 500

@app.route('/api/missas/<int:id>', methods=['GET'])
@requires_permission('Visualizar Missas')
def get_missa(id):
    db = get_db()
    m = db.execute("SELECT * FROM missas WHERE id_missa = ?", (id,)).fetchone()
    if not m:
        return jsonify({'error': 'Não encontrado'}), 404
    
    missa_dict = dict(m)
    # Buscar requisitos de pastorais
    pastorais = db.execute("""
        SELECT mp.id_pastoral, mp.quantidade_servos as quantidade, p.nome as pastoral_nome
        FROM missa_pastoral mp
        JOIN pastorais p ON mp.id_pastoral = p.id_pastoral
        WHERE mp.id_missa = ?
    """, (id,)).fetchall()
    missa_dict['pastorais'] = [dict(p) for p in pastorais]
    
    return jsonify(missa_dict)

@app.route('/api/missas/<int:id>', methods=['PUT'])
@requires_permission('Editar Missas')
def update_missa(id):
    try:
        data = request.json
        db = get_db()
        db.execute("""
            UPDATE missas SET data_missa=?, hora=?, comunidade=?, celebrante=?, tipo=?
            WHERE id_missa=?
        """, (data.get('data_missa'), data.get('hora'), data.get('comunidade'),
              data.get('celebrante'), data.get('tipo'), id))

        # Update Pastorals requirements
        db.execute("DELETE FROM missa_pastoral WHERE id_missa = ?", (id,))
        pastorais_req = data.get('pastorais', [])
        for p in pastorais_req:
            db.execute("""
                INSERT INTO missa_pastoral (id_missa, id_pastoral, quantidade_servos)
                VALUES (?, ?, ?)
            """, (id, int(p['id_pastoral']), int(p['quantidade'])))

        db.commit()
        return jsonify({'message': 'Missa atualizada com sucesso'})
    except Exception as e:
        print(f"ERRO SQL (update_missa): {e}")
        return jsonify({'error': f'Erro ao atualizar missa: {str(e)}'}), 500

@app.route('/api/missas/<int:id>', methods=['DELETE'])
@requires_permission('Excluir Missas')
def delete_missa(id):
    db = get_db()
    db.execute("UPDATE missas SET status = 0 WHERE id_missa = ?", (id,))
    db.commit()
    return jsonify({'message': 'Missa excluída'})

@app.route('/api/missas/<int:id>/resumo-financeiro', methods=['GET'])
def resumo_financeiro_missa(id):
    db = get_db()
    
    # Busca a missa
    m = db.execute("SELECT id_missa, data_missa, hora, comunidade FROM missas WHERE id_missa = ?", (id,)).fetchone()
    if not m:
        return jsonify({'error': 'Missa não encontrada'}), 404
        
    missa_data = dict(m)
    
    # Busca e agrupa os lançamentos da missa
    query = """
        SELECT 
            COALESCE(tl.descricao, 'Oferta') as tipo_lancamento,
            COALESCE(tp.descricao, 'Outros') as tipo_pagamento,
            SUM(r.valor) as total
        FROM recebimentos r
        JOIN tipos_pagamento tp ON r.id_tipo_pagamento = tp.id_tipo_pagamento
        LEFT JOIN tipos_lancamentos tl ON r.id_tipo_lancamento = tl.id_tipo_lancamento
        WHERE r.id_missa = ? AND r.status = 1
        GROUP BY tl.descricao, tp.descricao
    """
    agrupamentos = db.execute(query, (id,)).fetchall()
    
    # Estrutura a resposta de acordo com a regra: Dinheiro vs. Outros(Cartão)
    totais = {
        'coleta_dinheiro': 0.0,
        'coleta_cartao': 0.0,
        'dizimo_dinheiro': 0.0,
        'dizimo_cartao': 0.0
    }
    
    for row in agrupamentos:
        tl = row['tipo_lancamento'].strip().lower() # ex: 'dízimo' ou 'oferta'
        tp = row['tipo_pagamento'].strip().lower()   # ex: 'dinheiro', 'pix', 'cartão'
        v = float(row['total'] or 0)
        
        # Trata acentuação (Dízimo -> dizimo, Cartão -> cartao)
        import unicodedata
        tl_norm = ''.join(c for c in unicodedata.normalize('NFD', tl) if unicodedata.category(c) != 'Mn')
        
        if 'despesa' in tl_norm:
            continue
            
        is_dizimo = 'dizimo' in tl_norm
        is_dinheiro = 'dinheiro' in tp
        
        if is_dizimo:
            if is_dinheiro:
                totais['dizimo_dinheiro'] += v
            else:
                totais['dizimo_cartao'] += v
        else: # Se não é dízimo, assumimos Oferta (Coleta)
            if is_dinheiro:
                totais['coleta_dinheiro'] += v
            else:
                totais['coleta_cartao'] += v

    missa_data['totais'] = totais
    
    # Detalhes das despesas
    despesas_query = """
        SELECT r.valor, r.observacao
        FROM recebimentos r
        JOIN tipos_lancamentos tl ON r.id_tipo_lancamento = tl.id_tipo_lancamento
        WHERE r.id_missa = ? AND r.status = 1 AND LOWER(tl.descricao) LIKE '%despesa%'
    """
    despesas_rows = db.execute(despesas_query, (id,)).fetchall()
    missa_data['despesas'] = [{'valor': float(r['valor']), 'observacao': r['observacao'] or ''} for r in despesas_rows]
    
    return jsonify(missa_data)

@app.route('/api/missas/hoje', methods=['GET'])
def get_missas_hoje():
    db = get_db()
    data_str = request.args.get('data')
    if not data_str:
        data_str = datetime.now().strftime('%Y-%m-%d')
    
    print(f"[API] Buscando missas para data: {data_str}")
    missas_rows = db.execute("SELECT id_missa, hora, comunidade, celebrante FROM missas WHERE data_missa = ? AND status = 1 ORDER BY hora", (data_str,)).fetchall()
    return jsonify([dict(m) for m in missas_rows])

@app.route('/api/perfis', methods=['GET', 'POST'])
def handle_perfis():
    db = get_db()
    if request.method == 'GET':
        # Permitir GET para quem gerencia perfis OU usuários
        if not check_permission_backend('Gerenciar Perfis') and not check_permission_backend('Visualizar Usuários'):
            return jsonify({'error': 'Acesso Negado'}), 403
            
        perfis = db.execute("SELECT * FROM perfis WHERE status = 1").fetchall()
        return jsonify([dict(p) for p in perfis])
    if request.method == 'POST':
        if not check_permission_backend('Gerenciar Perfis'):
            return jsonify({'error': 'Acesso Negado'}), 403
        data = request.json
        cursor = db.execute("INSERT INTO perfis (descricao) VALUES (?)", (data['descricao'],))
        new_id = fetch_scalar(db.execute("SELECT MAX(id_perfil) FROM perfis"))
        db.commit()
        return jsonify({'message': 'Perfil criado com sucesso', 'id': new_id}), 201

@app.route('/api/perfis/<int:id>', methods=['PUT', 'DELETE'])
@requires_permission('Gerenciar Perfis')
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
@requires_permission('Gerenciar Perfis')
def get_permissoes():
    db = get_db()
    permissoes = db.execute("SELECT * FROM permissoes ORDER BY descricao").fetchall()
    return jsonify([dict(p) for p in permissoes])

@app.route('/api/perfis/<int:id_perfil>/permissoes', methods=['GET', 'POST'])
@requires_permission('Gerenciar Perfis')
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
        SELECT u.id_usuario, u.nome, u.login, u.status, u.data_criacao, p.descricao as perfil_nome, 
               u.id_perfil, u.id_dizimista, d.nome as nome_dizimista, u.trocar_senha
        FROM usuarios u
        JOIN perfis p ON u.id_perfil = p.id_perfil
        LEFT JOIN dizimistas d ON u.id_dizimista = d.id_dizimista
        WHERE u.status = 1
    """
    usuarios = db.execute(query).fetchall()
    return jsonify([dict(u) for u in usuarios])

@app.route('/api/usuarios', methods=['POST'])
@requires_permission('Criar Usuários')
def create_usuario():
    try:
        data = request.json
        db = get_db()
        login = data.get('login')
        
        print(f"[USER] Criando usuário: {login}")
        
        if db.execute("SELECT id_usuario FROM usuarios WHERE login = ?", (login,)).fetchone():
            return jsonify({'error': 'Login já em uso.'}), 400
            
        senha_hash = bcrypt.hashpw(data['senha'].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        id_dizimista = data.get('id_dizimista')
        if id_dizimista == '' or id_dizimista == 'null': id_dizimista = None
        
        id_perfil = int(data.get('id_perfil', 0))
        trocar_senha = 1 if data.get('trocar_senha') else 0
        
        db.execute("INSERT INTO usuarios (nome, login, senha_hash, id_perfil, id_dizimista, trocar_senha) VALUES (?, ?, ?, ?, ?, ?)",
                   (data['nome'], login, senha_hash, id_perfil, id_dizimista, trocar_senha))
        db.commit()
        
        new_id = fetch_scalar(db.execute("SELECT MAX(id_usuario) FROM usuarios"))
        current_user_login = data.get('current_user_id', 'sistema')
        log_auditoria('usuarios', new_id, 'INCLUSAO', current_user_login, dados_novos=data)
        
        return jsonify({'message': 'Usuário criado com sucesso', 'id': new_id}), 201
    except Exception as e:
        print(f"[USER] Erro ao criar: {e}")
        return jsonify({'error': f'Erro ao criar usuário: {str(e)}'}), 500

@app.route('/api/usuarios/<int:id>', methods=['PUT', 'DELETE'])
def gerenciar_usuario(id):
    try:
        db = get_db()
        if request.method == 'DELETE':
            if not check_permission_backend('Excluir Usuários'):
                 return jsonify({'error': 'Acesso Negado: Você não tem permissão para excluir usuários.'}), 403
            db.execute("UPDATE usuarios SET status = 0 WHERE id_usuario = ?", (id,))
            db.commit()
            return jsonify({'message': 'Removido com sucesso'})
        
        if request.method == 'PUT':
            if not check_permission_backend('Editar Usuários'):
                 return jsonify({'error': 'Acesso Negado: Você não tem permissão para editar usuários.'}), 403
            
            data = request.json
            print(f"[USER] Editando usuário ID: {id}")
            
            id_dizimista = data.get('id_dizimista')
            if id_dizimista == '' or id_dizimista == 'null': id_dizimista = None
            
            id_perfil = int(data.get('id_perfil', 0))
            
            # Buscar dados antigos para auditoria
            dados_antigos = db.execute("SELECT * FROM usuarios WHERE id_usuario = ?", (id,)).fetchone()
            trocar_senha = 1 if data.get('trocar_senha') else 0

            if 'senha' in data and data['senha']:
                senha_hash = bcrypt.hashpw(data['senha'].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                db.execute("UPDATE usuarios SET nome=?, id_perfil=?, senha_hash=?, id_dizimista=?, trocar_senha=? WHERE id_usuario=?", 
                           (data['nome'], id_perfil, senha_hash, id_dizimista, trocar_senha, id))
            else:
                db.execute("UPDATE usuarios SET nome=?, id_perfil=?, id_dizimista=?, trocar_senha=? WHERE id_usuario=?", 
                           (data['nome'], id_perfil, id_dizimista, trocar_senha, id))
            
            db.commit()
            log_auditoria('usuarios', id, 'ALTERACAO', data.get('current_user_id', 'sistema'), 
                          dados_anteriores=dict(dados_antigos) if dados_antigos else None, dados_novos=data)
            
            return jsonify({'message': 'Atualizado com sucesso'})
    except Exception as e:
        print(f"[USER] Erro ao gerenciar (ID {id}): {e}")
        return jsonify({'error': f'Erro ao processar usuário: {str(e)}'}), 500

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

@app.route('/api/tipos-lancamentos', methods=['GET'])
def get_tipos_lancamentos():
    db = get_db()
    tipos = db.execute("SELECT * FROM tipos_lancamentos WHERE status = 1 ORDER BY descricao").fetchall()
    return jsonify([dict(t) for t in tipos])

# --- Pastorais ---
@app.route('/api/pastorais', methods=['GET'])
@requires_permission('Visualizar Pastorais')
def get_pastorais():
    db = get_db()
    user_id = request.headers.get('X-User-Id')
    pastorais_rows = db.execute("SELECT * FROM pastorais WHERE status = 1 ORDER BY nome").fetchall()
    
    result = []
    for p in pastorais_rows:
        item = dict(p)
        item['pode_editar'] = check_user_coordination(user_id, p['id_pastoral'])
        result.append(item)
        
    return jsonify(result)

@app.route('/api/pastorais', methods=['POST'])
@requires_permission('Criar Pastorais')
def create_pastoral():
    db = get_db()
    data = request.json
    db.execute("INSERT INTO pastorais (nome) VALUES (?)", (data['nome'],))
    new_id = fetch_scalar(db.execute("SELECT MAX(id_pastoral) FROM pastorais"))
    db.commit()
    return jsonify({'message': 'Pastoral criada com sucesso', 'id': new_id}), 201

@app.route('/api/pastorais/<int:id>', methods=['PUT'])
@requires_permission('Editar Pastorais')
def update_pastoral(id):
    user_id = request.headers.get('X-User-Id')
    if not check_user_coordination(user_id, id):
        return jsonify({'error': 'Acesso Negado: Você só pode alterar pastorais das quais é coordenador.'}), 403
        
    db = get_db()
    data = request.json
    db.execute("UPDATE pastorais SET nome = ? WHERE id_pastoral = ?", (data['nome'], id))
    db.commit()
    return jsonify({'message': 'Pastoral atualizada'})

@app.route('/api/pastorais/<int:id>', methods=['DELETE'])
@requires_permission('Excluir Pastorais')
def delete_pastoral(id):
    user_id = request.headers.get('X-User-Id')
    if not check_user_coordination(user_id, id):
        return jsonify({'error': 'Acesso Negado: Você só pode excluir pastorais das quais é coordenador.'}), 403

    db = get_db()
    db.execute("UPDATE pastorais SET status = 0 WHERE id_pastoral = ?", (id,))
    db.commit()
    return jsonify({'message': 'Pastoral removida'})

@app.route('/api/pastorais/<int:id>/membros', methods=['GET'])
@requires_permission('Visualizar Pastorais')
def get_pastoral_membros(id):
    db = get_db()
    membros = db.execute("""
        SELECT d.id_dizimista, d.nome,
               COALESCE(dp.papel, 'S') as papel
        FROM dizimistas d
        JOIN dizimista_pastoral dp ON d.id_dizimista = dp.id_dizimista
        WHERE dp.id_pastoral = ? AND d.status = 1
        ORDER BY dp.papel ASC, d.nome
    """, (id,)).fetchall()
    return jsonify([dict(m) for m in membros])

@app.route('/api/pastorais/<int:id>/membros', methods=['POST'])
@requires_permission('Editar Pastorais')
def add_pastoral_membro(id):
    user_id = request.headers.get('X-User-Id')
    if not check_user_coordination(user_id, id):
        return jsonify({'error': 'Somente coordenadores podem incluir membros nesta pastoral.'}), 403

    db = get_db()
    data = request.json
    id_dizimista = data.get('id_dizimista')
    # Mapeia papel para S ou C
    papel_orig = data.get('papel', 'servo')
    papel_db = 'C' if papel_orig == 'coordenador' else 'S'

    if not id_dizimista:
        return jsonify({'error': 'id_dizimista obrigatório'}), 400
    
    try:
        db.execute(
            "INSERT INTO dizimista_pastoral (id_dizimista, id_pastoral, papel) VALUES (?, ?, ?)",
            (id_dizimista, id, papel_db)
        )
        db.commit()
        return jsonify({'message': 'Membro adicionado com sucesso'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/pastorais/<int:id_pastoral>/membros/<int:id_dizimista>', methods=['DELETE'])
@requires_permission('Editar Pastorais')
def remove_pastoral_membro(id_pastoral, id_dizimista):
    user_id = request.headers.get('X-User-Id')
    if not check_user_coordination(user_id, id_pastoral):
        return jsonify({'error': 'Somente coordenadores podem remover membros desta pastoral.'}), 403

    db = get_db()
    db.execute(
        "DELETE FROM dizimista_pastoral WHERE id_dizimista = ? AND id_pastoral = ?",
        (id_dizimista, id_pastoral)
    )
    db.commit()
    return jsonify({'message': 'Membro removido'})

@app.route('/api/pastorais/<int:id_pastoral>/membros/<int:id_dizimista>', methods=['PUT'])
@requires_permission('Editar Pastorais')
def update_pastoral_membro_papel(id_pastoral, id_dizimista):
    user_id = request.headers.get('X-User-Id')
    if not check_user_coordination(user_id, id_pastoral):
        return jsonify({'error': 'Somente coordenadores podem alterar papéis nesta pastoral.'}), 403

    db = get_db()
    data = request.json
    papel_orig = data.get('papel', 'servo')
    papel_db = 'C' if papel_orig == 'coordenador' else 'S'
    
    try:
        db.execute(
            "UPDATE dizimista_pastoral SET papel = ? WHERE id_dizimista = ? AND id_pastoral = ?",
            (papel_db, id_dizimista, id_pastoral)
        )
        db.commit()
        return jsonify({'message': 'Papel atualizado'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/missas/<int:id_missa>/servos', methods=['GET', 'POST'])
def handle_missa_servos(id_missa):
    db = get_db()
    if request.method == 'GET':
        servos = db.execute("""
            SELECT ms.*, d.nome as dizimista_nome, p.nome as pastoral_nome
            FROM missa_servos ms
            JOIN dizimistas d ON ms.id_dizimista = d.id_dizimista
            JOIN pastorais p ON ms.id_pastoral = p.id_pastoral
            WHERE ms.id_missa = ? AND ms.status = 1
        """, (id_missa,)).fetchall()
        return jsonify([dict(s) for s in servos])
    
    if request.method == 'POST':
        data = request.json # { id_pastoral, id_dizimista }
        # Validar se o dizimista pertence à pastoral
        vinculo = db.execute("SELECT 1 FROM dizimista_pastoral WHERE id_dizimista = ? AND id_pastoral = ?", 
                             (data['id_dizimista'], data['id_pastoral'])).fetchone()
        if not vinculo:
            return jsonify({'error': 'Este dizimista não pertence a esta pastoral'}), 400
        
        db.execute("""
            INSERT INTO missa_servos (id_missa, id_pastoral, id_dizimista)
            VALUES (?, ?, ?)
        """, (id_missa, data['id_pastoral'], data['id_dizimista']))
        db.commit()
        return jsonify({'message': 'Servo escalado com sucesso'}), 201

@app.route('/api/missas/servos/<int:id_vinculo>', methods=['DELETE'])
def remove_missa_servo(id_vinculo):
    db = get_db()
    db.execute("DELETE FROM missa_servos WHERE id_missa_servo = ?", (id_vinculo,))
    db.commit()
    return jsonify({'message': 'Servo removido da escala'})
def get_missa_pastorais(id_missa):
    db = get_db()
    rows = db.execute("""
        SELECT mp.*, p.nome as pastoral_nome
        FROM missa_pastoral mp
        JOIN pastorais p ON mp.id_pastoral = p.id_pastoral
        WHERE mp.id_missa = ?
    """, (id_missa,)).fetchall()
    return jsonify([dict(r) for r in rows])


# --- Recebimentos Routes ---
@app.route('/api/recebimentos', methods=['GET'])
@requires_permission('Visualizar Lançamentos')
def get_recebimentos():
    db = get_db()
    data_ini = request.args.get('data_ini')
    data_fim = request.args.get('data_fim')
    id_dizimista = request.args.get('id_dizimista')
    id_missa = request.args.get('id_missa')
    data_hoje = request.args.get('data_hoje')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 10))
    offset = (page - 1) * per_page

    where_clauses = ["r.status = 1"]
    params = []

    if data_ini:
        where_clauses.append("r.data_recebimento >= TO_DATE(?, 'YYYY-MM-DD')")
        params.append(data_ini)
    if data_fim:
        where_clauses.append("r.data_recebimento < TO_DATE(?, 'YYYY-MM-DD') + 1")
        params.append(data_fim)
    
    if not data_ini and not data_fim and data_hoje:
        hoje = datetime.now().strftime('%Y-%m-%d')
        where_clauses.append("r.data_recebimento >= TO_DATE(?, 'YYYY-MM-DD')")
        params.append(hoje)
        where_clauses.append("r.data_recebimento < TO_DATE(?, 'YYYY-MM-DD') + 1")
        params.append(hoje)

    if id_dizimista:
        where_clauses.append("r.id_dizimista = ?")
        params.append(id_dizimista)
    
    if id_missa:
        where_clauses.append("r.id_missa = ?")
        params.append(id_missa)

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
        SELECT r.*, d.nome as dizimista_nome, t.descricao as tipo_pagamento_nome, tl.descricao as tipo_lancamento_nome
        FROM recebimentos r
        JOIN dizimistas d ON r.id_dizimista = d.id_dizimista
        JOIN tipos_pagamento t ON r.id_tipo_pagamento = t.id_tipo_pagamento
        LEFT JOIN tipos_lancamentos tl ON r.id_tipo_lancamento = tl.id_tipo_lancamento
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
    id_tipo_lancamento = data.get('id_tipo_lancamento')
    id_usuario = data.get('id_usuario')
    
    if not all([id_dizimista, valor, competencia, id_tipo_pagamento, id_usuario]):
        return jsonify({'error': 'Dados incompletos.'}), 400
        
    cursor = db.execute("""
        INSERT INTO recebimentos (id_dizimista, valor, competencia, id_tipo_pagamento, id_tipo_lancamento, id_missa, id_usuario, observacao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (id_dizimista, valor, competencia, id_tipo_pagamento, id_tipo_lancamento, data.get('id_missa'), id_usuario, data.get('observacao')))
    
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

# --- Relatórios ---

@app.route('/api/relatorios/servos-missa', methods=['GET'])
@requires_permission('[Relatórios] Escala de Servos')
def relatorio_servos_missa():
    db = get_db()
    data_inicio = request.args.get('data_inicio')
    data_fim = request.args.get('data_fim')
    pastorais_filtro = request.args.get('pastorais') # Ex: "1,2,3"
    
    if not data_inicio or not data_fim:
        return jsonify({'error': 'Datas de início e fim são obrigatórias.'}), 400

    # 1. Buscar missas no período (usando comparação de string pois data_missa é VARCHAR2 em YYYY-MM-DD)
    query_missas = """
        SELECT * FROM missas 
        WHERE data_missa >= ? AND data_missa <= ?
        ORDER BY data_missa ASC, hora ASC
    """
    missas = db.execute(query_missas, (data_inicio, data_fim)).fetchall()
    
    report_data = []

    for m in missas:
        m_dict = dict(m)
        id_missa = m_dict['id_missa']
        
        # 2. Buscar requisitos de pastorais (filtrando se necessário)
        where_p = "WHERE mp.id_missa = ?"
        params_p = [id_missa]
        if pastorais_filtro:
            p_ids = [int(x) for x in pastorais_filtro.split(',')]
            placeholders = ','.join(['?'] * len(p_ids))
            where_p += f" AND mp.id_pastoral IN ({placeholders})"
            params_p.extend(p_ids)

        query_pastorais = f"""
            SELECT mp.id_pastoral, mp.quantidade_servos as quantidade, p.nome as pastoral_nome
            FROM missa_pastoral mp
            JOIN pastorais p ON mp.id_pastoral = p.id_pastoral
            {where_p}
            ORDER BY p.nome
        """
        reqs = db.execute(query_pastorais, tuple(params_p)).fetchall()
        
        pastorais_list = []
        for r in reqs:
            r_dict = dict(r)
            id_p = r_dict['id_pastoral']
            vagas = r_dict['quantidade']
            
            # 3. Buscar servos escalados
            query_servos = """
                SELECT ms.id_missa_servo, d.nome as dizimista_nome
                FROM missa_servos ms
                JOIN dizimistas d ON ms.id_dizimista = d.id_dizimista
                WHERE ms.id_missa = ? AND ms.id_pastoral = ? AND ms.status = 1
            """
            servos = db.execute(query_servos, (id_missa, id_p)).fetchall()
            servos_names = [s['dizimista_nome'] for s in servos]
            
            # Preencher com "(vago)" se necessário
            final_servos = servos_names[:]
            while len(final_servos) < vagas:
                final_servos.append("(vago)")
                
            r_dict['servos'] = final_servos
            pastorais_list.append(r_dict)
            
        m_dict['pastorais'] = pastorais_list
        # Só adiciona no relatório se houver pastorais para mostrar nessa missa (após filtro)
        if pastorais_list:
            report_data.append(m_dict)

    return jsonify(report_data)

if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
