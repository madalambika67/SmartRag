import os, re, io, json, time, sqlite3, hashlib, secrets
import numpy as np, httpx
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
load_dotenv(); E = os.getenv
DB = E("DB_PATH", "smartrag.db")
def db():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c
with db() as c:
    c.executescript("""
create table if not exists users(id integer primary key,email text unique,name text,pw text,salt text);
create table if not exists sessions(token text primary key,uid int);
create table if not exists docs(id integer primary key,uid int,name text,chars int,nchunks int,created text default current_timestamp);
create table if not exists chunks(id integer primary key,doc_id int,uid int,doc_name text,idx int,text text,vec blob);
create table if not exists cache(id integer primary key,uid int,query text,answer text,sources text,vec blob,model text,cost real,tin int,tout int,hits int default 0,created text default current_timestamp);
create table if not exists queries(id integer primary key,uid int,query text,answer text,sources text,model text,route text,cache_hit int,sim real,tin int,tout int,latency real,cost real,saved real,created text default current_timestamp);
create table if not exists settings(uid int,k text,v text,primary key(uid,k));""")
app = FastAPI(title="SmartRAG")
DEF = {"cache_threshold": 0.85, "route_threshold": 0.4, "top_k": 4}

def user(authorization: str = Header("")):
    r = db().execute("select uid from sessions where token=?", (authorization.replace("Bearer ", ""),)).fetchone()
    if not r: raise HTTPException(401, "Not authenticated")
    return r[0]
def hpw(p, s): return hashlib.pbkdf2_hmac("sha256", p.encode(), s.encode(), 100000).hex()
def cfg(c, u):
    d = dict(DEF)
    for r in c.execute("select k,v from settings where uid=?", (u,)): d[r["k"]] = float(r["v"])
    return d
def price(tier):
    p = tier.upper(); return float(E(p + "_IN", 0.15 if tier == "cheap" else 2.5)), float(E(p + "_OUT", 0.6 if tier == "cheap" else 10))
def cost(tier, tin, tout):
    i, o = price(tier); return (tin * i + tout * o) / 1e6

class Auth(BaseModel):
    email: str; password: str; name: str = ""
def session(c, uid, name, email):
    t = secrets.token_hex(24); c.execute("insert into sessions values(?,?)", (t, uid)); c.commit()
    return {"token": t, "user": {"id": uid, "name": name, "email": email}}
@app.post("/api/register")
def register(a: Auth):
    c = db(); s = secrets.token_hex(8); nm = a.name or a.email.split("@")[0]
    if len(a.password) < 6: raise HTTPException(400, "Password must be 6+ characters")
    try: cur = c.execute("insert into users(email,name,pw,salt) values(?,?,?,?)", (a.email.lower(), nm, hpw(a.password, s), s))
    except sqlite3.IntegrityError: raise HTTPException(400, "Email already registered")
    return session(c, cur.lastrowid, nm, a.email)
@app.post("/api/login")
def login(a: Auth):
    c = db(); r = c.execute("select * from users where email=?", (a.email.lower(),)).fetchone()
    if not r or r["pw"] != hpw(a.password, r["salt"]): raise HTTPException(400, "Invalid credentials")
    return session(c, r["id"], r["name"], r["email"])

# ---------- embeddings (API or local signed-hashing fallback) ----------
D = 512
def embed(texts):
    if E("EMBED_API_KEY"):
        r = httpx.post(E("EMBED_BASE_URL", "https://api.openai.com/v1") + "/embeddings", headers={"Authorization": "Bearer " + E("EMBED_API_KEY")},
                       json={"model": E("EMBED_MODEL", "text-embedding-3-small"), "input": texts}, timeout=60)
        if r.status_code != 200: raise HTTPException(502, "Embedding API error: " + r.text[:200])
        a = np.array([d["embedding"] for d in r.json()["data"]], dtype=np.float32)
    else:
        a = np.zeros((len(texts), D), dtype=np.float32)
        for i, t in enumerate(texts):
            w = [x for x in re.findall(r"\w+", t.lower()) if len(x) > 2]
            for g in w + [x + " " + y for x, y in zip(w, w[1:])]:
                h = int(hashlib.md5(g.encode()).hexdigest(), 16); a[i, h % D] += 1 if (h >> 70) & 1 else -1
    return a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-9)
def chunk(text, n=160, ov=30):
    w = text.split(); return [" ".join(w[i:i + n]) for i in range(0, max(len(w), 1), n - ov) if w[i:i + n]]

@app.get("/api/docs")
def docs(u=Depends(user)): return [dict(r) for r in db().execute("select * from docs where uid=? order by id desc", (u,))]
@app.post("/api/docs")
def upload(file: UploadFile = File(...), u=Depends(user)):
    raw = file.file.read(); n = file.filename
    if n.lower().endswith(".pdf"):
        from pypdf import PdfReader
        text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages)
    elif n.lower().endswith((".txt", ".md", ".csv")): text = raw.decode("utf-8", "ignore")
    else: raise HTTPException(400, "Supported: PDF, TXT, MD, CSV")
    ch = chunk(text)
    if not ch: raise HTTPException(400, "No extractable text in file")
    vecs = np.vstack([embed(ch[i:i + 64]) for i in range(0, len(ch), 64)])
    c = db(); d = c.execute("insert into docs(uid,name,chars,nchunks) values(?,?,?,?)", (u, n, len(text), len(ch))).lastrowid
    c.executemany("insert into chunks(doc_id,uid,doc_name,idx,text,vec) values(?,?,?,?,?,?)", [(d, u, n, i, t, vecs[i].tobytes()) for i, t in enumerate(ch)])
    c.execute("delete from cache where uid=?", (u,)); c.commit()  # knowledge changed -> invalidate cache
    return {"id": d, "chunks": len(ch)}
@app.delete("/api/docs/{i}")
def deldoc(i: int, u=Depends(user)):
    c = db(); c.execute("delete from chunks where doc_id=? and uid=?", (i, u)); c.execute("delete from docs where id=? and uid=?", (i, u)); c.execute("delete from cache where uid=?", (u,)); c.commit(); return {"ok": 1}

# ---------- routing + LLM ----------
def complexity(q):
    s = min(len(q.split()) / 30, 1) * 0.4
    if re.search(r"\b(compare|why|explain|analy[sz]e|summari[sz]e|difference|evaluate|trade-?offs?|step|how does|pros|cons|implications)\b", q.lower()): s += 0.4
    if q.count("?") > 1 or " and " in q.lower(): s += 0.2
    return s
def extract(q, top):
    qw = {w for w in re.findall(r"\w+", q.lower()) if len(w) > 2}; sc = []
    for n, (r, _) in enumerate(top, 1):
        for st in re.split(r"(?<=[.!?])\s+", r["text"]):
            ov = len(qw & set(re.findall(r"\w+", st.lower())))
            if ov: sc.append((ov, n, st.strip()))
    sc.sort(key=lambda x: -x[0])
    return " ".join(f"{s} [{n}]" for _, n, s in sc[:3]) or "I couldn't find a relevant answer in your documents."
def ask_llm(model, prompt):
    r = httpx.post(E("LLM_BASE_URL", "https://api.openai.com/v1") + "/chat/completions", headers={"Authorization": "Bearer " + E("LLM_API_KEY")}, timeout=120,
                   json={"model": model, "temperature": 0.2, "messages": [{"role": "system", "content": "Answer ONLY from the numbered context. Cite sources like [1]. If the answer is not in the context, say so."}, {"role": "user", "content": prompt}]})
    if r.status_code != 200: raise HTTPException(502, "LLM API error: " + r.text[:200])
    j = r.json(); return j["choices"][0]["message"]["content"], j["usage"]["prompt_tokens"], j["usage"]["completion_tokens"]

class Q(BaseModel): query: str
@app.post("/api/chat")
def chat(q: Q, u=Depends(user)):
    t0 = time.time(); c = db(); st = cfg(c, u); qt = q.query.strip()
    if not qt: raise HTTPException(400, "Empty query")
    qv = embed([qt])[0]; best = None
    for r in c.execute("select * from cache where uid=?", (u,)):
        v = np.frombuffer(r["vec"], dtype=np.float32)
        if v.shape == qv.shape:
            s = float(v @ qv)
            if s >= st["cache_threshold"] and (not best or s > best[0]): best = (s, r)
    def log(ans, src, model, route, hit, sim, tin, tout, cst, saved):
        lat = (time.time() - t0) * 1000
        c.execute("insert into queries(uid,query,answer,sources,model,route,cache_hit,sim,tin,tout,latency,cost,saved) values(?,?,?,?,?,?,?,?,?,?,?,?,?)", (u, qt, ans, json.dumps(src), model, route, hit, sim, tin, tout, lat, cst, saved)); c.commit()
        return {"answer": ans, "sources": src, "model": model, "route": route, "cache_hit": hit, "similarity": round(sim, 3), "tin": tin, "tout": tout, "latency": round(lat, 1), "cost": cst, "saved": saved}
    if best:
        r = best[1]; c.execute("update cache set hits=hits+1 where id=?", (r["id"],))
        return log(r["answer"], json.loads(r["sources"]), r["model"], "cache", 1, best[0], 0, 0, 0.0, r["cost"])
    rows = [r for r in c.execute("select id,doc_name,idx,text,vec from chunks where uid=?", (u,)) if len(r["vec"]) == qv.nbytes]
    if not rows: raise HTTPException(400, "Upload a document first (or re-upload after changing embedding provider).")
    s = np.stack([np.frombuffer(r["vec"], dtype=np.float32) for r in rows]) @ qv
    top = [(rows[i], float(s[i])) for i in np.argsort(-s)[:int(st["top_k"])]]
    src = [{"n": n, "doc": r["doc_name"], "idx": r["idx"], "score": round(sc, 3), "text": r["text"][:450]} for n, (r, sc) in enumerate(top, 1)]
    tier = "strong" if complexity(qt) >= st["route_threshold"] else "cheap"
    model = E("STRONG_MODEL", "gpt-4o") if tier == "strong" else E("CHEAP_MODEL", "gpt-4o-mini")
    prompt = "Context:\n" + "\n\n".join(f"[{n}] ({r['doc_name']}) {r['text']}" for n, (r, _) in enumerate(top, 1)) + f"\n\nQuestion: {qt}"
    if E("LLM_API_KEY"): ans, tin, tout = ask_llm(model, prompt)
    else: ans = extract(qt, top); tin, tout = len(prompt) // 4, len(ans) // 4; model += " (offline)"
    cst = cost(tier, tin, tout)
    c.execute("insert into cache(uid,query,answer,sources,vec,model,cost,tin,tout) values(?,?,?,?,?,?,?,?,?)", (u, qt, ans, json.dumps(src), qv.tobytes(), model, cst, tin, tout))
    return log(ans, src, model, tier, 0, 0.0, tin, tout, cst, 0.0)

@app.get("/api/history")
def history(u=Depends(user)):
    rs = [dict(r) for r in db().execute("select * from queries where uid=? order by id desc limit 100", (u,))]
    for r in rs: r["sources"] = json.loads(r["sources"])
    return rs[::-1]
@app.delete("/api/history")
def clearhist(u=Depends(user)):
    c = db(); c.execute("delete from queries where uid=?", (u,)); c.commit(); return {"ok": 1}

@app.get("/api/stats")
def stats(u=Depends(user)):
    c = db(); L = lambda s: [dict(r) for r in c.execute(s, (u,))]
    t = L("select count(*) n,coalesce(sum(cache_hit),0) hits,coalesce(sum(cost),0) cost,coalesce(sum(saved),0) cache_saved,coalesce(avg(latency),0) lat,coalesce(sum(tin),0) tin,coalesce(sum(tout),0) tout from queries where uid=?")[0]
    (ci, co), (si, so) = price("cheap"), price("strong")
    t["routing_saved"] = c.execute("select coalesce(sum(tin*?+tout*?),0)/1e6 from queries where uid=? and cache_hit=0 and route='cheap'", (si - ci, so - co, u)).fetchone()[0]
    for k, tb in (("docs", "docs"), ("chunks", "chunks"), ("cache_entries", "cache")): t[k] = c.execute(f"select count(*) from {tb} where uid=?", (u,)).fetchone()[0]
    return {"totals": t,
            "daily": L("select date(created) d,count(*) q,sum(cache_hit) hits,sum(cost) cost,sum(saved) saved from queries where uid=? group by d order by d"),
            "models": L("select model,count(*) n,sum(cost) cost,sum(tin) tin,sum(tout) tout from queries where uid=? and cache_hit=0 group by model"),
            "lat": L("select id,latency,cache_hit from (select * from queries where uid=? order by id desc limit 30) order by id")}

@app.get("/api/cache")
def cache(u=Depends(user)): return [dict(r) for r in db().execute("select id,query,model,cost,tin,tout,hits,created from cache where uid=? order by id desc", (u,))]
@app.delete("/api/cache")
def clearcache(u=Depends(user)):
    c = db(); c.execute("delete from cache where uid=?", (u,)); c.commit(); return {"ok": 1}
@app.delete("/api/cache/{i}")
def delcache(i: int, u=Depends(user)):
    c = db(); c.execute("delete from cache where id=? and uid=?", (i, u)); c.commit(); return {"ok": 1}
@app.get("/api/settings")
def getset(u=Depends(user)): return {**cfg(db(), u), "llm_configured": bool(E("LLM_API_KEY")), "embed_configured": bool(E("EMBED_API_KEY")), "cheap_model": E("CHEAP_MODEL", "gpt-4o-mini"), "strong_model": E("STRONG_MODEL", "gpt-4o")}
@app.put("/api/settings")
def putset(b: dict, u=Depends(user)):
    c = db()
    for k in DEF:
        if k in b: c.execute("insert or replace into settings values(?,?,?)", (u, k, str(float(b[k]))))
    c.commit(); return {"ok": 1}

_b = os.path.join(os.path.dirname(__file__), "..")
FE = os.path.join(_b, "frontend-react", "dist")

# Serve frontend only when the frontend files are available.
# On Vercel, the frontend is served separately.
if os.path.isdir(FE):
    app.mount("/", StaticFiles(directory=FE, html=True), name="ui")