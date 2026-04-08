CREATE TABLE IF NOT EXISTS perfis (
    id_perfil INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL,
    status INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS permissoes (
    id_permissao INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS perfil_permissao (
    id_perfil INTEGER,
    id_permissao INTEGER,
    FOREIGN KEY(id_perfil) REFERENCES perfis(id_perfil),
    FOREIGN KEY(id_permissao) REFERENCES permissoes(id_permissao)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    login TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    id_perfil INTEGER,
    status INTEGER DEFAULT 1,
    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(id_perfil) REFERENCES perfis(id_perfil)
);

CREATE TABLE IF NOT EXISTS dizimistas (
    id_dizimista INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf TEXT UNIQUE,
    telefone TEXT,
    email TEXT,
    endereco TEXT,
    bairro TEXT,
    cidade TEXT,
    cep TEXT,
    data_ingresso DATETIME DEFAULT CURRENT_TIMESTAMP,
    status INTEGER DEFAULT 1,
    observacoes TEXT
);

CREATE TABLE IF NOT EXISTS missas (
    id_missa INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    hora TEXT NOT NULL,
    comunidade TEXT,
    celebrante TEXT,
    tipo TEXT,
    status INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tipos_pagamento (
    id_tipo_pagamento INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL,
    status INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recebimentos (
    id_recebimento INTEGER PRIMARY KEY AUTOINCREMENT,
    data_recebimento DATETIME DEFAULT CURRENT_TIMESTAMP,
    competencia TEXT NOT NULL,
    id_dizimista INTEGER NOT NULL,
    valor REAL NOT NULL,
    id_tipo_pagamento INTEGER NOT NULL,
    id_missa INTEGER,
    id_usuario INTEGER NOT NULL,
    status INTEGER DEFAULT 1,
    observacao TEXT,
    FOREIGN KEY(id_dizimista) REFERENCES dizimistas(id_dizimista),
    FOREIGN KEY(id_tipo_pagamento) REFERENCES tipos_pagamento(id_tipo_pagamento),
    FOREIGN KEY(id_missa) REFERENCES missas(id_missa),
    FOREIGN KEY(id_usuario) REFERENCES usuarios(id_usuario)
);

CREATE TABLE IF NOT EXISTS auditoria (
    id_auditoria INTEGER PRIMARY KEY AUTOINCREMENT,
    tabela TEXT NOT NULL,
    id_registro INTEGER NOT NULL,
    operacao TEXT NOT NULL,
    usuario TEXT NOT NULL,
    data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
    dados_anteriores TEXT,
    dados_novos TEXT
);
