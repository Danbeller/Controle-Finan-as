"""
FinControl Pro — Backend FastAPI + SQLite Multi-Tenant
Cada empresa tem seu próprio banco: data/{slug}.db
Super-admin no banco principal: fincontrol_master.db
"""

import sqlite3, os, hashlib, time, json, re
from datetime import datetime, timedelta
from typing import Optional, List
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Depends, Form, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
SECRET_KEY          = "fincontrol-secret-2024-sqlite"
ALGORITHM           = "HS256"
TOKEN_EXPIRE_HOURS  = 12
MASTER_DB           = "fincontrol_master.db"
DATA_DIR            = "data"          # pasta onde ficam os .db de cada empresa
SUPERADMIN_USER     = "superadmin"
SUPERADMIN_PASS     = "Super@2024!"   # TROQUE ESTA SENHA em produção

os.makedirs(DATA_DIR, exist_ok=True)

pwd_ctx = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
oauth2  = OAuth2PasswordBearer(tokenUrl="/auth/login")
app     = FastAPI(title="FinControl Pro API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# DB HELPERS
# ─────────────────────────────────────────────
def db_path_for(slug: str) -> str:
    """Retorna o caminho do banco de uma empresa pelo slug."""
    return os.path.join(DATA_DIR, f"{slug}.db")

@contextmanager
def get_master_db():
    conn = sqlite3.connect(MASTER_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@contextmanager
def get_tenant_db(slug: str):
    conn = sqlite3.connect(db_path_for(slug))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def row_to_dict(row):
    if row is None:
        return None
    return dict(row)

def rows_to_list(rows):
    return [dict(r) for r in rows]

# ─────────────────────────────────────────────
# INIT MASTER DB
# ─────────────────────────────────────────────
def init_master_db():
    with get_master_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS empresas (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            nome       TEXT NOT NULL,
            slug       TEXT UNIQUE NOT NULL,
            ativo      INTEGER NOT NULL DEFAULT 1,
            criado_em  TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS superadmins (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            username  TEXT UNIQUE NOT NULL,
            senha     TEXT NOT NULL,
            nome      TEXT NOT NULL
        );
        """)
        # Seed superadmin
        exists = conn.execute("SELECT 1 FROM superadmins WHERE username=?", (SUPERADMIN_USER,)).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO superadmins (username,senha,nome) VALUES (?,?,?)",
                (SUPERADMIN_USER, pwd_ctx.hash(SUPERADMIN_PASS), "Super Administrador")
            )

# ─────────────────────────────────────────────
# INIT TENANT DB (banco de cada empresa)
# ─────────────────────────────────────────────
def init_tenant_db(slug: str):
    with get_tenant_db(slug) as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            username  TEXT UNIQUE NOT NULL,
            senha     TEXT NOT NULL,
            nome      TEXT NOT NULL,
            role      TEXT NOT NULL DEFAULT 'operador',
            ativo     INTEGER NOT NULL DEFAULT 1,
            criado_em TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS categorias_financeiro (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            nome  TEXT NOT NULL,
            tipo  TEXT NOT NULL CHECK(tipo IN ('receita','despesa'))
        );

        CREATE TABLE IF NOT EXISTS clientes (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            nome      TEXT NOT NULL,
            cpf_cnpj  TEXT,
            telefone  TEXT,
            email     TEXT,
            endereco  TEXT,
            cidade    TEXT,
            uf        TEXT,
            cep       TEXT,
            criado_em TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS fornecedores (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            razao_social TEXT NOT NULL,
            cnpj         TEXT,
            contato      TEXT,
            email        TEXT,
            telefone     TEXT,
            endereco     TEXT,
            cidade       TEXT,
            uf           TEXT,
            criado_em    TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS transacoes (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo          TEXT NOT NULL CHECK(tipo IN ('receita','despesa')),
            descricao     TEXT NOT NULL,
            valor         REAL NOT NULL,
            data          TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pago' CHECK(status IN ('pago','pendente','cancelado')),
            categoria_id  INTEGER REFERENCES categorias_financeiro(id),
            cliente_id    INTEGER REFERENCES clientes(id),
            fornecedor_id INTEGER REFERENCES fornecedores(id),
            observacao    TEXT,
            usuario_id    INTEGER REFERENCES usuarios(id),
            criado_em     TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS produtos (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo         TEXT UNIQUE NOT NULL,
            nome           TEXT NOT NULL,
            descricao      TEXT,
            estoque_atual  REAL NOT NULL DEFAULT 0,
            estoque_minimo REAL NOT NULL DEFAULT 0,
            custo          REAL NOT NULL DEFAULT 0,
            preco_venda    REAL NOT NULL DEFAULT 0,
            unidade        TEXT NOT NULL DEFAULT 'un',
            categoria_id   INTEGER,
            ativo          INTEGER NOT NULL DEFAULT 1,
            criado_em      TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS movimentos_estoque (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            produto_id     INTEGER NOT NULL REFERENCES produtos(id),
            tipo           TEXT NOT NULL CHECK(tipo IN ('entrada','saida','ajuste')),
            quantidade     REAL NOT NULL,
            custo_unitario REAL NOT NULL DEFAULT 0,
            observacao     TEXT,
            usuario_id     INTEGER REFERENCES usuarios(id),
            data_hora      TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER REFERENCES usuarios(id),
            username   TEXT,
            acao       TEXT NOT NULL,
            tabela     TEXT,
            detalhe    TEXT,
            data_hora  TEXT DEFAULT (datetime('now','localtime'))
        );
        """)

        # Seed categorias padrão se vazio
        cats_exist = conn.execute("SELECT COUNT(*) FROM categorias_financeiro").fetchone()[0]
        if cats_exist == 0:
            cats = [
                ('Vendas','receita'),('Serviços','receita'),('Investimentos','receita'),
                ('Aluguéis Recebidos','receita'),('Outras Receitas','receita'),
                ('Fornecedores','despesa'),('Folha de Pagamento','despesa'),
                ('Aluguel','despesa'),('Utilities','despesa'),('Marketing','despesa'),
                ('Impostos','despesa'),('Manutenção','despesa'),('Outras Despesas','despesa'),
            ]
            conn.executemany("INSERT INTO categorias_financeiro (nome,tipo) VALUES (?,?)", cats)

def seed_tenant_admin(slug: str, username: str, senha: str, nome: str):
    """Cria o usuário admin inicial da empresa."""
    with get_tenant_db(slug) as conn:
        exists = conn.execute("SELECT 1 FROM usuarios WHERE username=?", (username,)).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO usuarios (username,senha,nome,role) VALUES (?,?,?,?)",
                (username, pwd_ctx.hash(senha), nome, 'admin')
            )
            conn.execute(
                "INSERT INTO usuarios (username,senha,nome,role) VALUES (?,?,?,?)",
                ('gerente', pwd_ctx.hash('gerente123'), 'Gerente', 'gerente')
            )
            conn.execute(
                "INSERT INTO usuarios (username,senha,nome,role) VALUES (?,?,?,?)",
                ('operador', pwd_ctx.hash('op123'), 'Operador', 'operador')
            )

# ─────────────────────────────────────────────
# AUTH HELPERS
# ─────────────────────────────────────────────
def create_token(data: dict):
    exp = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({**data, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str = Depends(oauth2)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        uid  = payload.get("sub")
        slug = payload.get("slug")
        is_super = payload.get("super", False)
        if uid is None:
            raise HTTPException(status_code=401)
        return {"uid": int(uid), "slug": slug, "super": is_super}
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")

def get_current_user(tok: dict = Depends(verify_token)):
    if tok["super"]:
        return {"id": 0, "username": SUPERADMIN_USER, "nome": "Super Admin",
                "role": "superadmin", "slug": None, "super": True}
    slug = tok["slug"]
    uid  = tok["uid"]
    with get_tenant_db(slug) as conn:
        u = conn.execute("SELECT * FROM usuarios WHERE id=? AND ativo=1", (uid,)).fetchone()
    if not u:
        raise HTTPException(status_code=401)
    d = row_to_dict(u)
    d["slug"] = slug
    d["super"] = False
    return d

def require_tenant_user(user=Depends(get_current_user)):
    if user.get("super"):
        raise HTTPException(status_code=403, detail="Super-admin não acessa dados de empresa diretamente")
    return user

def audit(conn, user, acao, tabela=None, detalhe=None):
    conn.execute(
        "INSERT INTO audit_log (usuario_id,username,acao,tabela,detalhe) VALUES (?,?,?,?,?)",
        (user['id'], user['username'], acao, tabela, detalhe)
    )

# ─────────────────────────────────────────────
# AUTH ENDPOINTS
# ─────────────────────────────────────────────
@app.post("/auth/login")
async def login(username: str = Form(...), password: str = Form(...),
                x_empresa_slug: Optional[str] = Header(None)):
    """
    Login unificado.
    - Se x_empresa_slug header estiver presente → login na empresa.
    - Se não → tenta superadmin primeiro, depois procura em todas as empresas.
    """
    # 1. Tenta superadmin
    with get_master_db() as conn:
        sa = conn.execute("SELECT * FROM superadmins WHERE username=?", (username,)).fetchone()
        if sa and pwd_ctx.verify(password, sa['senha']):
            token = create_token({"sub": str(sa['id']), "super": True})
            return {"access_token": token, "token_type": "bearer",
                    "usuario": {"id": sa['id'], "username": sa['username'],
                                "nome": sa['nome'], "role": "superadmin", "slug": None}}

    # 2. Login em empresa específica via header
    if x_empresa_slug:
        slug = x_empresa_slug.strip().lower()
        if not os.path.exists(db_path_for(slug)):
            raise HTTPException(status_code=404, detail="Empresa não encontrada")
        with get_tenant_db(slug) as conn:
            u = conn.execute("SELECT * FROM usuarios WHERE username=? AND ativo=1", (username,)).fetchone()
            if not u or not pwd_ctx.verify(password, u['senha']):
                raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
            u = row_to_dict(u)
            audit(conn, u, "LOGIN", "usuarios", "Login bem-sucedido")
        token = create_token({"sub": str(u['id']), "slug": slug})
        u.pop('senha', None)
        u['slug'] = slug
        return {"access_token": token, "token_type": "bearer", "usuario": u}

    # 3. Sem header: procura em todas as empresas ativas
    with get_master_db() as conn:
        empresas = rows_to_list(conn.execute("SELECT slug FROM empresas WHERE ativo=1").fetchall())
    for emp in empresas:
        slug = emp['slug']
        if not os.path.exists(db_path_for(slug)):
            continue
        with get_tenant_db(slug) as conn:
            u = conn.execute("SELECT * FROM usuarios WHERE username=? AND ativo=1", (username,)).fetchone()
            if u and pwd_ctx.verify(password, u['senha']):
                u = row_to_dict(u)
                audit(conn, u, "LOGIN", "usuarios", "Login bem-sucedido")
                token = create_token({"sub": str(u['id']), "slug": slug})
                u.pop('senha', None)
                u['slug'] = slug
                return {"access_token": token, "token_type": "bearer", "usuario": u}

    raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

# ─────────────────────────────────────────────
# SUPERADMIN — GESTÃO DE EMPRESAS
# ─────────────────────────────────────────────
class EmpresaIn(BaseModel):
    nome: str
    slug: str
    admin_username: str
    admin_senha: str
    admin_nome: str

class EmpresaUpdateIn(BaseModel):
    nome: str
    ativo: bool

@app.get("/superadmin/empresas")
async def list_empresas(user=Depends(get_current_user)):
    if not user.get("super"):
        raise HTTPException(status_code=403)
    with get_master_db() as conn:
        rows = rows_to_list(conn.execute("SELECT * FROM empresas ORDER BY nome").fetchall())
    # Enriquece com contagem de usuários
    for emp in rows:
        db = db_path_for(emp['slug'])
        if os.path.exists(db):
            with get_tenant_db(emp['slug']) as c:
                emp['total_usuarios'] = c.execute("SELECT COUNT(*) FROM usuarios WHERE ativo=1").fetchone()[0]
                emp['total_transacoes'] = c.execute("SELECT COUNT(*) FROM transacoes").fetchone()[0]
        else:
            emp['total_usuarios'] = 0
            emp['total_transacoes'] = 0
    return rows

@app.post("/superadmin/empresas", status_code=201)
async def create_empresa(e: EmpresaIn, user=Depends(get_current_user)):
    if not user.get("super"):
        raise HTTPException(status_code=403)
    # Valida slug
    slug = re.sub(r'[^a-z0-9_-]', '', e.slug.strip().lower())
    if not slug:
        raise HTTPException(status_code=400, detail="Slug inválido")
    with get_master_db() as conn:
        try:
            conn.execute("INSERT INTO empresas (nome,slug) VALUES (?,?)", (e.nome.strip(), slug))
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Slug já utilizado por outra empresa")
    # Cria banco da empresa e admin inicial
    init_tenant_db(slug)
    seed_tenant_admin(slug, e.admin_username, e.admin_senha, e.admin_nome)
    return {"ok": True, "slug": slug}

@app.put("/superadmin/empresas/{slug}")
async def update_empresa(slug: str, e: EmpresaUpdateIn, user=Depends(get_current_user)):
    if not user.get("super"):
        raise HTTPException(status_code=403)
    with get_master_db() as conn:
        row = conn.execute("SELECT id FROM empresas WHERE slug=?", (slug,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.execute("UPDATE empresas SET nome=?, ativo=? WHERE slug=?",
                     (e.nome, 1 if e.ativo else 0, slug))
    return {"ok": True}

@app.delete("/superadmin/empresas/{slug}", status_code=204)
async def delete_empresa(slug: str, user=Depends(get_current_user)):
    if not user.get("super"):
        raise HTTPException(status_code=403)
    with get_master_db() as conn:
        row = conn.execute("SELECT id FROM empresas WHERE slug=?", (slug,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.execute("DELETE FROM empresas WHERE slug=?", (slug,))
    # Remove banco da empresa
    db = db_path_for(slug)
    if os.path.exists(db):
        os.remove(db)

@app.get("/superadmin/empresas/{slug}/usuarios")
async def get_empresa_usuarios(slug: str, user=Depends(get_current_user)):
    if not user.get("super"):
        raise HTTPException(status_code=403)
    if not os.path.exists(db_path_for(slug)):
        raise HTTPException(status_code=404)
    with get_tenant_db(slug) as conn:
        rows = rows_to_list(conn.execute(
            "SELECT id,username,nome,role,ativo,criado_em FROM usuarios ORDER BY nome"
        ).fetchall())
    return rows

class UsuarioTenantIn(BaseModel):
    username: str
    senha: str
    nome: str
    role: str = "operador"

@app.post("/superadmin/empresas/{slug}/usuarios", status_code=201)
async def add_empresa_usuario(slug: str, u: UsuarioTenantIn, user=Depends(get_current_user)):
    if not user.get("super"):
        raise HTTPException(status_code=403)
    if not os.path.exists(db_path_for(slug)):
        raise HTTPException(status_code=404)
    with get_tenant_db(slug) as conn:
        try:
            conn.execute(
                "INSERT INTO usuarios (username,senha,nome,role) VALUES (?,?,?,?)",
                (u.username, pwd_ctx.hash(u.senha), u.nome, u.role)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Username já existe nesta empresa")
    return {"ok": True}

@app.delete("/superadmin/empresas/{slug}/usuarios/{uid}", status_code=204)
async def remove_empresa_usuario(slug: str, uid: int, user=Depends(get_current_user)):
    if not user.get("super"):
        raise HTTPException(status_code=403)
    if not os.path.exists(db_path_for(slug)):
        raise HTTPException(status_code=404)
    with get_tenant_db(slug) as conn:
        conn.execute("UPDATE usuarios SET ativo=0 WHERE id=?", (uid,))

# ─────────────────────────────────────────────
# DASHBOARD
# ─────────────────────────────────────────────
@app.get("/dashboard")
async def dashboard(user=Depends(require_tenant_user)):
    slug = user['slug']
    with get_tenant_db(slug) as conn:
        saldo_rec  = conn.execute("SELECT COALESCE(SUM(valor),0) FROM transacoes WHERE tipo='receita' AND status='pago'").fetchone()[0]
        saldo_desp = conn.execute("SELECT COALESCE(SUM(valor),0) FROM transacoes WHERE tipo='despesa' AND status='pago'").fetchone()[0]
        total_prods= conn.execute("SELECT COUNT(*) FROM produtos WHERE ativo=1").fetchone()[0]
        estoque_baixo = conn.execute("SELECT COUNT(*) FROM produtos WHERE ativo=1 AND estoque_atual <= estoque_minimo").fetchone()[0]
        estoque_critico = rows_to_list(conn.execute(
            "SELECT id,codigo,nome,estoque_atual,estoque_minimo FROM produtos WHERE ativo=1 AND estoque_atual <= estoque_minimo ORDER BY (estoque_atual - estoque_minimo) ASC LIMIT 10"
        ).fetchall())
        ultimas = rows_to_list(conn.execute(
            "SELECT t.*,c.nome as cat_nome FROM transacoes t LEFT JOIN categorias_financeiro c ON t.categoria_id=c.id ORDER BY t.criado_em DESC LIMIT 8"
        ).fetchall())
    return {
        "saldo": saldo_rec - saldo_desp,
        "total_receitas": saldo_rec,
        "total_despesas": saldo_desp,
        "total_produtos": total_prods,
        "estoque_baixo": estoque_baixo,
        "estoque_critico": estoque_critico,
        "ultimas_transacoes": ultimas,
    }

@app.get("/dashboard/fluxo-mensal")
async def fluxo_mensal(user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        rows = rows_to_list(conn.execute("""
            SELECT strftime('%Y-%m', data) as mes, tipo, SUM(valor) as total
            FROM transacoes WHERE status='pago'
              AND data >= date('now','-6 months')
            GROUP BY mes, tipo ORDER BY mes
        """).fetchall())
    return rows

@app.get("/dashboard/categorias-despesas")
async def cat_despesas(user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        rows = rows_to_list(conn.execute("""
            SELECT COALESCE(c.nome,'Outras') as categoria, SUM(t.valor) as total
            FROM transacoes t LEFT JOIN categorias_financeiro c ON t.categoria_id=c.id
            WHERE t.tipo='despesa' AND t.status='pago'
            GROUP BY t.categoria_id ORDER BY total DESC LIMIT 8
        """).fetchall())
    return rows

@app.get("/dashboard/categorias-receitas")
async def cat_receitas(user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        rows = rows_to_list(conn.execute("""
            SELECT COALESCE(c.nome,'Outras') as categoria, SUM(t.valor) as total
            FROM transacoes t LEFT JOIN categorias_financeiro c ON t.categoria_id=c.id
            WHERE t.tipo='receita' AND t.status='pago'
            GROUP BY t.categoria_id ORDER BY total DESC LIMIT 8
        """).fetchall())
    return rows

# ─────────────────────────────────────────────
# CATEGORIAS
# ─────────────────────────────────────────────
@app.get("/categorias-financeiro")
async def get_cats(user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        return rows_to_list(conn.execute("SELECT * FROM categorias_financeiro ORDER BY tipo,nome").fetchall())

# ─────────────────────────────────────────────
# TRANSAÇÕES
# ─────────────────────────────────────────────
class TransacaoIn(BaseModel):
    tipo: str
    descricao: str
    valor: float
    data: str
    status: str = "pago"
    categoria_id: Optional[int] = None
    cliente_id: Optional[int] = None
    fornecedor_id: Optional[int] = None
    observacao: Optional[str] = None

@app.get("/transacoes")
async def get_transacoes(tipo: Optional[str]=None, q: Optional[str]=None,
                          status: Optional[str]=None, user=Depends(require_tenant_user)):
    sql = """
        SELECT t.*, c.nome as categoria_nome,
               cl.nome as cliente_nome, f.razao_social as fornecedor_nome
        FROM transacoes t
        LEFT JOIN categorias_financeiro c ON t.categoria_id=c.id
        LEFT JOIN clientes cl ON t.cliente_id=cl.id
        LEFT JOIN fornecedores f ON t.fornecedor_id=f.id
        WHERE 1=1
    """
    params = []
    if tipo:   sql += " AND t.tipo=?";          params.append(tipo)
    if status: sql += " AND t.status=?";         params.append(status)
    if q:      sql += " AND t.descricao LIKE ?"; params.append(f"%{q}%")
    sql += " ORDER BY t.data DESC, t.id DESC"
    with get_tenant_db(user['slug']) as conn:
        return rows_to_list(conn.execute(sql, params).fetchall())

@app.post("/transacoes", status_code=201)
async def create_transacao(t: TransacaoIn, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        cur = conn.execute(
            "INSERT INTO transacoes (tipo,descricao,valor,data,status,categoria_id,cliente_id,fornecedor_id,observacao,usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (t.tipo, t.descricao, t.valor, t.data, t.status,
             t.categoria_id, t.cliente_id, t.fornecedor_id, t.observacao, user['id'])
        )
        audit(conn, user, f"CRIAR_{t.tipo.upper()}", "transacoes", f"{t.descricao} R${t.valor:.2f}")
    return {"id": cur.lastrowid, "ok": True}

@app.delete("/transacoes/{tid}", status_code=204)
async def delete_transacao(tid: int, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        row = conn.execute("SELECT * FROM transacoes WHERE id=?", (tid,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transação não encontrada")
        conn.execute("DELETE FROM transacoes WHERE id=?", (tid,))
        audit(conn, user, "EXCLUIR_TRANSACAO", "transacoes", f"ID {tid}")

# ─────────────────────────────────────────────
# PRODUTOS
# ─────────────────────────────────────────────
class ProdutoIn(BaseModel):
    codigo: str
    nome: str
    descricao: Optional[str] = ""
    estoque_atual: float = 0
    estoque_minimo: float = 0
    custo: float = 0
    preco_venda: float = 0
    unidade: str = "un"

@app.get("/produtos")
async def get_produtos(q: Optional[str]=None, user=Depends(require_tenant_user)):
    sql = "SELECT * FROM produtos WHERE ativo=1"
    params = []
    if q:
        sql += " AND (nome LIKE ? OR codigo LIKE ? OR descricao LIKE ?)"
        params += [f"%{q}%",f"%{q}%",f"%{q}%"]
    sql += " ORDER BY nome"
    with get_tenant_db(user['slug']) as conn:
        return rows_to_list(conn.execute(sql, params).fetchall())

@app.post("/produtos", status_code=201)
async def create_produto(p: ProdutoIn, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        try:
            cur = conn.execute(
                "INSERT INTO produtos (codigo,nome,descricao,estoque_atual,estoque_minimo,custo,preco_venda,unidade) VALUES (?,?,?,?,?,?,?,?)",
                (p.codigo, p.nome, p.descricao, p.estoque_atual, p.estoque_minimo, p.custo, p.preco_venda, p.unidade)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Código já cadastrado")
        if p.estoque_atual > 0:
            conn.execute(
                "INSERT INTO movimentos_estoque (produto_id,tipo,quantidade,custo_unitario,observacao,usuario_id) VALUES (?,?,?,?,?,?)",
                (cur.lastrowid, 'entrada', p.estoque_atual, p.custo, 'Estoque inicial', user['id'])
            )
        audit(conn, user, "CRIAR_PRODUTO", "produtos", p.nome)
    return {"id": cur.lastrowid, "ok": True}

@app.put("/produtos/{pid}")
async def update_produto(pid: int, p: ProdutoIn, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        row = conn.execute("SELECT * FROM produtos WHERE id=? AND ativo=1", (pid,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Produto não encontrado")
        conn.execute(
            "UPDATE produtos SET nome=?,descricao=?,estoque_minimo=?,custo=?,preco_venda=?,unidade=? WHERE id=?",
            (p.nome, p.descricao, p.estoque_minimo, p.custo, p.preco_venda, p.unidade, pid)
        )
        audit(conn, user, "EDITAR_PRODUTO", "produtos", p.nome)
    return {"ok": True}

@app.delete("/produtos/{pid}", status_code=204)
async def delete_produto(pid: int, user=Depends(require_tenant_user)):
    if user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Apenas administradores podem excluir produtos")
    with get_tenant_db(user['slug']) as conn:
        row = conn.execute("SELECT nome FROM produtos WHERE id=?", (pid,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.execute("UPDATE produtos SET ativo=0 WHERE id=?", (pid,))
        audit(conn, user, "EXCLUIR_PRODUTO", "produtos", f"ID {pid} - {row['nome']}")

# ─────────────────────────────────────────────
# MOVIMENTOS
# ─────────────────────────────────────────────
class MovimentoIn(BaseModel):
    produto_id: int
    tipo: str
    quantidade: float
    custo_unitario: float = 0
    observacao: Optional[str] = None

@app.get("/movimentos")
async def get_movimentos(tipo: Optional[str]=None, user=Depends(require_tenant_user)):
    sql = """
        SELECT m.*, p.nome as produto_nome, p.codigo as produto_codigo,
               u.username as usuario_nome
        FROM movimentos_estoque m
        LEFT JOIN produtos p ON m.produto_id=p.id
        LEFT JOIN usuarios u ON m.usuario_id=u.id
        WHERE 1=1
    """
    params = []
    if tipo: sql += " AND m.tipo=?"; params.append(tipo)
    sql += " ORDER BY m.data_hora DESC LIMIT 200"
    with get_tenant_db(user['slug']) as conn:
        return rows_to_list(conn.execute(sql, params).fetchall())

@app.post("/movimentos", status_code=201)
async def create_movimento(m: MovimentoIn, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        prod = conn.execute("SELECT * FROM produtos WHERE id=? AND ativo=1", (m.produto_id,)).fetchone()
        if not prod:
            raise HTTPException(status_code=404, detail="Produto não encontrado")
        if m.tipo == 'saida' and prod['estoque_atual'] < m.quantidade:
            raise HTTPException(status_code=400, detail=f"Estoque insuficiente. Disponível: {prod['estoque_atual']}")
        delta = m.quantidade if m.tipo == 'entrada' else -m.quantidade
        conn.execute("UPDATE produtos SET estoque_atual=estoque_atual+? WHERE id=?", (delta, m.produto_id))
        cur = conn.execute(
            "INSERT INTO movimentos_estoque (produto_id,tipo,quantidade,custo_unitario,observacao,usuario_id) VALUES (?,?,?,?,?,?)",
            (m.produto_id, m.tipo, m.quantidade, m.custo_unitario, m.observacao, user['id'])
        )
        audit(conn, user, f"MOVIMENTO_{m.tipo.upper()}", "movimentos_estoque",
              f"{prod['nome']} qtd={m.quantidade}")
    return {"id": cur.lastrowid, "ok": True}

# ─────────────────────────────────────────────
# CLIENTES
# ─────────────────────────────────────────────
class ClienteIn(BaseModel):
    nome: str
    cpf_cnpj: Optional[str] = None
    telefone: Optional[str] = None
    email: Optional[str] = None
    endereco: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    cep: Optional[str] = None

@app.get("/clientes")
async def get_clientes(q: Optional[str]=None, user=Depends(require_tenant_user)):
    sql = "SELECT * FROM clientes WHERE 1=1"
    params = []
    if q:
        sql += " AND (nome LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ? OR email LIKE ?)"
        params += [f"%{q}%"]*4
    sql += " ORDER BY nome"
    with get_tenant_db(user['slug']) as conn:
        return rows_to_list(conn.execute(sql, params).fetchall())

@app.post("/clientes", status_code=201)
async def create_cliente(c: ClienteIn, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        cur = conn.execute(
            "INSERT INTO clientes (nome,cpf_cnpj,telefone,email,endereco,cidade,uf,cep) VALUES (?,?,?,?,?,?,?,?)",
            (c.nome,c.cpf_cnpj,c.telefone,c.email,c.endereco,c.cidade,c.uf,c.cep)
        )
        audit(conn, user, "CRIAR_CLIENTE", "clientes", c.nome)
    return {"id": cur.lastrowid, "ok": True}

@app.delete("/clientes/{cid}", status_code=204)
async def delete_cliente(cid: int, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        row = conn.execute("SELECT nome FROM clientes WHERE id=?", (cid,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.execute("DELETE FROM clientes WHERE id=?", (cid,))
        audit(conn, user, "EXCLUIR_CLIENTE", "clientes", f"ID {cid} - {row['nome']}")

# ─────────────────────────────────────────────
# FORNECEDORES
# ─────────────────────────────────────────────
class FornecedorIn(BaseModel):
    razao_social: str
    cnpj: Optional[str] = None
    contato: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    endereco: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None

@app.get("/fornecedores")
async def get_fornecedores(q: Optional[str]=None, user=Depends(require_tenant_user)):
    sql = "SELECT * FROM fornecedores WHERE 1=1"
    params = []
    if q:
        sql += " AND (razao_social LIKE ? OR cnpj LIKE ? OR contato LIKE ?)"
        params += [f"%{q}%"]*3
    sql += " ORDER BY razao_social"
    with get_tenant_db(user['slug']) as conn:
        return rows_to_list(conn.execute(sql, params).fetchall())

@app.post("/fornecedores", status_code=201)
async def create_fornecedor(f: FornecedorIn, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        cur = conn.execute(
            "INSERT INTO fornecedores (razao_social,cnpj,contato,email,telefone,endereco,cidade,uf) VALUES (?,?,?,?,?,?,?,?)",
            (f.razao_social,f.cnpj,f.contato,f.email,f.telefone,f.endereco,f.cidade,f.uf)
        )
        audit(conn, user, "CRIAR_FORNECEDOR", "fornecedores", f.razao_social)
    return {"id": cur.lastrowid, "ok": True}

@app.delete("/fornecedores/{fid}", status_code=204)
async def delete_fornecedor(fid: int, user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        row = conn.execute("SELECT razao_social FROM fornecedores WHERE id=?", (fid,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        conn.execute("DELETE FROM fornecedores WHERE id=?", (fid,))
        audit(conn, user, "EXCLUIR_FORNECEDOR", "fornecedores", f"ID {fid} - {row['razao_social']}")

# ─────────────────────────────────────────────
# RELATÓRIOS
# ─────────────────────────────────────────────
@app.get("/relatorios/dre")
async def dre(user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        rec  = conn.execute("SELECT COALESCE(SUM(valor),0) FROM transacoes WHERE tipo='receita' AND status='pago'").fetchone()[0]
        desp = conn.execute("SELECT COALESCE(SUM(valor),0) FROM transacoes WHERE tipo='despesa' AND status='pago'").fetchone()[0]
    resultado = rec - desp
    margem    = round(resultado / rec * 100, 1) if rec > 0 else 0
    return {"receita_bruta": rec, "despesas_totais": desp, "resultado": resultado, "margem": margem}

@app.get("/relatorios/top-produtos")
async def top_produtos(user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        rows = rows_to_list(conn.execute("""
            SELECT p.nome,
                   SUM(CASE WHEN m.tipo='entrada' THEN m.quantidade ELSE 0 END) as entradas,
                   SUM(CASE WHEN m.tipo='saida'   THEN m.quantidade ELSE 0 END) as saidas
            FROM movimentos_estoque m JOIN produtos p ON m.produto_id=p.id
            GROUP BY p.id ORDER BY (entradas+saidas) DESC LIMIT 5
        """).fetchall())
    return rows

@app.get("/relatorios/audit-log")
async def audit_log(user=Depends(require_tenant_user)):
    with get_tenant_db(user['slug']) as conn:
        rows = rows_to_list(conn.execute(
            "SELECT * FROM audit_log ORDER BY data_hora DESC LIMIT 100"
        ).fetchall())
    return rows

# ─────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    init_master_db()
    print(f"✅ FinControl Pro Multi-Tenant iniciado")
    print(f"   Master DB : {os.path.abspath(MASTER_DB)}")
    print(f"   Dados     : {os.path.abspath(DATA_DIR)}/")
    print(f"   Superadmin: {SUPERADMIN_USER} / {SUPERADMIN_PASS}")

# ─────────────────────────────────────────────
# SERVE STATIC FILES
# ─────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/", include_in_schema=False)
async def serve_index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
