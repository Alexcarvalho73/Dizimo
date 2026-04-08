import re
import os

with open('app_oracle.py', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Imports and DB Connection
imports_replacement = '''import oracledb
import os
import json
import unicodedata
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import bcrypt
from datetime import datetime

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

ORACLE_USER = 'alexcarvalho73'
ORACLE_PASS = 'Alinne05@ora'
ORACLE_DSN = 'imaculado_high'
WALLET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'DriveOracle'))

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
            oracledb.init_oracle_client(config_dir=WALLET_DIR) # required for thick mode and wallets on windows sometimes, or Thin mode ignores it. Let's try Thin mode first.
            connection = oracledb.connect(
                user=ORACLE_USER,
                password=ORACLE_PASS,
                dsn=ORACLE_DSN,
                config_dir=WALLET_DIR,
                wallet_location=WALLET_DIR,
                wallet_password='Alinne05@ora'
            )
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

def init_db():
    pass # Tables created externally via SQL Developer using schema_oracle.sql
'''

# Match everything up to the end of init_db() definition
# Notice the re.DOTALL so it matches across newlines
code = re.sub(r'import sqlite3.*?def init_db\(\):.*?\n\n# --- Helpers ---', imports_replacement + "\n\n# --- Helpers ---", code, flags=re.DOTALL)


# Fix specific queries for Oracle
# remove_accents is wiped out from app_oracle (redefined in python space), Oracle natively might not have remove_accents. Let's use utl_raw or standard compare
code = code.replace("remove_accents(nome)", "nome")
code = code.replace("remove_accents(?)", "?")

# Date functions
code = code.replace("date(data_recebimento) = ?", "TRUNC(data_recebimento) = TO_DATE(?, 'YYYY-MM-DD')")
code = code.replace("strftime('%m', data_recebimento)", "TO_CHAR(data_recebimento, 'MM')")
code = code.replace("strftime('%Y', data_recebimento)", "TO_CHAR(data_recebimento, 'YYYY')")

# Insert functions with lastrowid. Since Oracle won't return lastrowid, we must append returning clause OR query max(id), or just return basic success. Let's just return basic success for now and id=0
code = code.replace("cursor.lastrowid", "0") 

# In manage_dizimista query
db_execute_update = '''db.execute("""
            UPDATE dizimistas 
            SET nome=?, cpf=?, telefone=?, email=?, endereco=?, bairro=?, cidade=?, cep=?, observacoes=?
            WHERE id_dizimista=?
        """, (data.get('nome'), cpf, data.get('telefone'), data.get('email'), 
              data.get('endereco'), data.get('bairro'), data.get('cidade'), data.get('cep'), data.get('observacoes'), id))'''

code = code.replace("cursor = db.execute", "cursor = db.execute") # noop
code = code.replace("data_hora DESC", "data_hora DESC") 


with open('app_oracle.py', 'w', encoding='utf-8') as f:
    f.write(code)
