import {useEffect,useRef,useState} from 'react'
import {Bar,BarChart,CartesianGrid,Cell,Legend,Line,LineChart,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import Bg from './Bg'
const C=['#22d3ee','#a78bfa','#f472b6','#fbbf24','#34d399']
const m$=(n:number)=>'$'+(+n||0).toFixed(n>0&&n<.01?6:4)
let tok:string|null=localStorage.getItem('t'), usr:any=JSON.parse(localStorage.getItem('u')||'null')
const toast=(m:string)=>window.dispatchEvent(new CustomEvent('toast',{detail:m}))
function logout(){localStorage.clear();tok=usr=null;location.hash='#/'}
async function api(p:string,m='GET',b?:any,f=false){
  const h:any={};if(tok)h.Authorization='Bearer '+tok;if(b&&!f)h['Content-Type']='application/json'
  const r=await fetch('/api/'+p,{method:m,headers:h,body:f?b:b&&JSON.stringify(b)});const j=await r.json().catch(()=>({}))
  if(r.status==401&&tok){logout();throw Error('Session expired')}if(!r.ok)throw Error(j.detail||'Error');return j}
function useLoad(p:string){const [d,setD]=useState<any>(null);const r=()=>api(p).then(setD).catch(e=>toast(e.message));useEffect(()=>{r()},[p]);return [d,r] as const}
const Card=({t,v,s}:any)=><div className="g p-4 fade"><div className="text-xs opacity-60">{t}</div><div className="text-2xl font-bold grad">{v}</div><div className="text-xs opacity-50">{s}</div></div>
const Box=({t,children}:any)=><div className="g p-4 fade"><div className="text-sm mb-2 opacity-70">{t}</div><div style={{height:260}}><ResponsiveContainer>{children}</ResponsiveContainer></div></div>
const ax=(k:string)=><><CartesianGrid stroke="#ffffff15"/><XAxis dataKey={k} stroke="#9fb0d0"/><YAxis stroke="#9fb0d0"/><Tooltip contentStyle={{background:'#0b1020',border:'1px solid #fff2'}}/><Legend/></>
const pie=(data:any[],key:string,name:string)=><PieChart><Pie data={data} dataKey={key} nameKey={name} label>{data.map((_,i)=><Cell key={i} fill={C[i%5]}/>)}</Pie><Tooltip contentStyle={{background:'#0b1020'}}/><Legend/></PieChart>

function Landing(){return <><section className="text-center py-20 fade"><h1 className="text-5xl md:text-7xl font-extrabold grad">SmartRAG</h1><p className="mt-4 text-xl opacity-80">Cost-aware RAG assistant with semantic caching &amp; smart model routing</p><a href={tok?'#/dashboard':'#/auth'} className="btn inline-block mt-8">Get started →</a></section>
  <div className="grid md:grid-cols-3 gap-4">{[['📄 Cited answers','Upload PDFs, ask questions, get answers with source citations.'],['⚡ Semantic cache','Similar questions reuse past answers – zero LLM cost.'],['🧭 Cost routing','Simple queries → cheap model, complex → powerful model.'],['📊 Live analytics','Tokens, latency, hit rate and dollars saved from real logs.'],['🗄 Vector search','FAISS (optional) or NumPy cosine over SQLite embeddings.'],['🔧 Configurable','Any OpenAI-compatible LLM/embedding API via .env.']].map(a=><div key={a[0]} className="g p-5 fade"><b>{a[0]}</b><p className="text-sm opacity-70 mt-1">{a[1]}</p></div>)}</div></>}

function Auth(){const [reg,setReg]=useState(false),[f,setF]=useState<any>({})
  const go=async(e:any)=>{e.preventDefault();try{const r=await api(reg?'register':'login','POST',f);tok=r.token;usr=r.user;localStorage.t=tok;localStorage.u=JSON.stringify(usr);location.hash='#/dashboard'}catch(x:any){toast(x.message)}}
  const set=(k:string)=>(e:any)=>setF({...f,[k]:e.target.value})
  return <form onSubmit={go} className="g p-6 max-w-sm mx-auto mt-10 space-y-3 fade"><h2 className="text-2xl font-bold grad">{reg?'Register':'Login'}</h2>
    {reg&&<input className="inp" placeholder="Name" onChange={set('name')}/>}<input className="inp" type="email" placeholder="Email" required onChange={set('email')}/><input className="inp" type="password" placeholder="Password (6+)" required onChange={set('password')}/>
    <button className="btn w-full">{reg?'Create account':'Login'}</button><a href="#" className="text-sm opacity-70 block text-center" onClick={e=>{e.preventDefault();setReg(!reg)}}>{reg?'Have an account? Login':'New here? Register'}</a></form>}

function Dash(){const [s]=useLoad('stats');if(!s)return null;const t=s.totals
  return <><div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
    <Card t="Queries" v={t.n}/><Card t="Cache hit rate" v={(t.n?100*t.hits/t.n:0).toFixed(1)+'%'} s={t.hits+' hits'}/><Card t="Cost saved" v={m$(t.cache_saved+t.routing_saved)} s="cache + routing"/><Card t="Avg latency" v={t.lat.toFixed(0)+' ms'}/><Card t="Documents" v={t.docs} s={t.chunks+' chunks'}/><Card t="Total cost" v={m$(t.cost)}/></div>
  <div className="grid md:grid-cols-2 gap-4 mt-4">
    <Box t="Queries per day"><BarChart data={s.daily}>{ax('d')}<Bar dataKey="q" name="Queries" fill={C[0]}/><Bar dataKey="hits" name="Cache hits" fill={C[1]}/></BarChart></Box>
    <Box t="Model usage">{pie(s.models,'n','model')}</Box>
    <Box t="Latency (ms) – last 30 queries"><LineChart data={s.lat.map((l:any,i:number)=>({...l,i:i+1}))}>{ax('i')}<Line dataKey="latency" name="ms" stroke={C[0]}/></LineChart></Box>
    <Box t="Cost vs saved per day ($)"><LineChart data={s.daily}>{ax('d')}<Line dataKey="cost" name="Spent" stroke={C[2]}/><Line dataKey="saved" name="Saved by cache" stroke={C[4]}/></LineChart></Box></div></>}

function Ans({r}:any){return <><div className="whitespace-pre-wrap">{r.answer}</div><div className="flex flex-wrap gap-1 mt-2">
  <span className={'tag '+(r.cache_hit?'hit':'miss')}>{r.cache_hit?'CACHE HIT '+String(r.similarity).slice(0,5):'CACHE MISS'}</span><span className="tag">{r.model}</span><span className="tag">{Math.round(r.latency)} ms</span><span className="tag">{r.tin}→{r.tout} tok</span><span className="tag">{m$(r.cost)}{r.saved?' · saved '+m$(r.saved):''}</span></div>
  <details className="mt-2"><summary className="cursor-pointer opacity-70">Sources ({r.sources.length})</summary>{r.sources.map((s:any)=><div key={s.n} className="mt-1 p-2 bg-black/30 rounded text-xs"><b>[{s.n}] {s.doc}</b> · chunk {s.idx} · score {s.score}<br/>{s.text}…</div>)}</details></>}
function Chat() {
  const [messages, setMessages] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()

    const text = q.trim()
    if (!text || busy) return

    setQ('')
    setBusy(true)

    setMessages(prev => [
      ...prev,
      { me: true, text }
    ])

    try {
      const r = await api('chat', 'POST', {
        query: text
      })

      setMessages(prev => [
        ...prev,
        { response: r }
      ])
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { error: err.message || 'Something went wrong' }
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="g p-4 flex flex-col"
      style={{ height: '78vh' }}
    >
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">

        {messages.map((x, i) => (
          <div
            key={i}
            className={
              'fade max-w-[85%] p-3 rounded-2xl text-sm ' +
              (x.me
                ? 'ml-auto bg-cyan-500/20'
                : 'bg-white/5')
            }
          >
            {x.me ? (
              x.text
            ) : x.error ? (
              <span>⚠ {x.error}</span>
            ) : (
              <Ans r={x.response} />
            )}
          </div>
        ))}

        {busy && (
          <div className="opacity-60 text-sm">
            Thinking…
          </div>
        )}

        <div ref={end} />
      </div>

      <form
        onSubmit={send}
        className="flex gap-2 mt-3"
      >
        <input
          className="inp"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Ask about your documents…"
        />

        <button
          className="btn"
          type="submit"
          disabled={busy}
        >
          {busy ? 'Thinking...' : 'Send'}
        </button>

        <button
          type="button"
          className="btn2"
          onClick={async () => {
            if (confirm('Clear chat history?')) {
              try {
                await api('history', 'DELETE')
                setMessages([])
              } catch (e: any) {
                toast(e.message)
              }
            }
          }}
        >
          Clear
        </button>
      </form>
    </div>
  )
}
function Docs(){const [d,r]=useLoad('docs')
  const up=async(fs:FileList)=>{for(const f of Array.from(fs)){const fd=new FormData();fd.append('file',f);toast('Indexing '+f.name+'…');try{await api('docs','POST',fd,true)}catch(x:any){toast(f.name+': '+x.message)}}r()}
  return <div className="g p-6 fade"><h2 className="text-xl font-bold grad mb-3">Documents</h2>
    <label className="block border-2 border-dashed border-white/20 rounded-xl p-8 text-center cursor-pointer hover:border-cyan-400" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();up(e.dataTransfer.files)}}>Drop or click to upload PDF / TXT / MD / CSV<input type="file" multiple accept=".pdf,.txt,.md,.csv" className="hidden" onChange={e=>e.target.files&&up(e.target.files)}/></label>
    <table className="mt-4"><thead><tr><th>Name</th><th>Chars</th><th>Chunks</th><th>Added</th><th></th></tr></thead><tbody>{(d||[]).map((x:any)=><tr key={x.id}><td>{x.name}</td><td>{x.chars}</td><td>{x.nchunks}</td><td>{x.created}</td><td><button className="btn2" onClick={async()=>{await api('docs/'+x.id,'DELETE');r()}}>Delete</button></td></tr>)}</tbody></table>{d&&!d.length&&<p className="opacity-60 mt-2">No documents yet</p>}</div>}

function Analytics(){const [s]=useLoad('stats');if(!s)return null;const t=s.totals,tot=t.cost+t.cache_saved+t.routing_saved
  return <><div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Card t="Tokens in" v={t.tin}/><Card t="Tokens out" v={t.tout}/><Card t="Saved by cache" v={m$(t.cache_saved)}/><Card t="Saved by routing" v={m$(t.routing_saved)}/></div>
  <div className="grid md:grid-cols-2 gap-4 mt-4"><Box t="Tokens by model"><BarChart data={s.models}>{ax('model')}<Bar dataKey="tin" name="In" fill={C[0]}/><Bar dataKey="tout" name="Out" fill={C[1]}/></BarChart></Box>
    <Box t="Savings breakdown ($)">{pie([{k:'Cache',v:t.cache_saved},{k:'Routing',v:t.routing_saved},{k:'Spent',v:t.cost}],'v','k')}</Box>
    <Box t="Cost by model ($)"><BarChart data={s.models}>{ax('model')}<Bar dataKey="cost" name="Cost" fill={C[3]}/></BarChart></Box>
    <div className="g p-4 text-sm">Baseline (all strong model, no cache): <b>{m$(tot)}</b><br/>Actual spend: {m$(t.cost)} → <b className="grad">{tot?(100*(1-t.cost/tot)).toFixed(1):0}% saved</b></div></div></>}

function CacheMon(){const [c,r]=useLoad('cache'),[s]=useLoad('stats');const t=s?.totals||{n:0,hits:0}
  return <><div className="grid grid-cols-3 gap-3 mb-4"><Card t="Entries" v={c?.length||0}/><Card t="Hits" v={t.hits}/><Card t="Misses" v={t.n-t.hits}/></div>
  <div className="g p-6 fade"><div className="flex justify-between mb-3"><h2 className="text-xl font-bold grad">Semantic Cache</h2><button className="btn2" onClick={async()=>{await api('cache','DELETE');toast('Cache cleared');r()}}>Clear all</button></div>
  <div className="overflow-x-auto"><table><thead><tr><th>Query</th><th>Model</th><th>Cost</th><th>Hits</th><th>Created</th><th></th></tr></thead><tbody>{(c||[]).map((x:any)=><tr key={x.id}><td>{x.query}</td><td>{x.model}</td><td>{m$(x.cost)}</td><td>{x.hits}</td><td>{x.created}</td><td><button className="btn2" onClick={async()=>{await api('cache/'+x.id,'DELETE');r()}}>✕</button></td></tr>)}</tbody></table></div></div></>}

function Settings(){const [s]=useLoad('settings'),[v,setV]=useState<any>(null);useEffect(()=>{if(s)setV(s)},[s]);if(!v)return null
  const F=[['cache_threshold','Cache similarity threshold',.5,1,.01],['route_threshold','Routing threshold (higher = more cheap)',0,1,.05],['top_k','Retrieved chunks (top-k)',1,10,1]]
  return <div className="g p-6 max-w-xl mx-auto space-y-4 fade"><h2 className="text-xl font-bold grad">Settings</h2>
    <p className="text-sm opacity-70">LLM: {s.llm_configured?'API configured':'offline extractive mode (set LLM_API_KEY in .env)'} · Embeddings: {s.embed_configured?'API':'local hashing'}<br/>Cheap: {s.cheap_model} · Strong: {s.strong_model}</p>
    {F.map(f=><label key={f[0] as string} className="block text-sm">{f[1]}: <b>{v[f[0] as string]}</b><input type="range" className="w-full" min={f[2] as number} max={f[3] as number} step={f[4] as number} value={v[f[0] as string]} onChange={e=>setV({...v,[f[0] as string]:+e.target.value})}/></label>)}
    <button className="btn" onClick={async()=>{await api('settings','PUT',v);toast('Saved')}}>Save</button></div>}

const About=()=><div className="g p-6 max-w-2xl mx-auto fade space-y-3"><h2 className="text-2xl font-bold grad">About SmartRAG</h2><p>SmartRAG cuts LLM spend with a <b>semantic cache</b> (embedding similarity) and a <b>complexity router</b> that sends easy questions to a cheap model.</p><p className="opacity-80 text-sm">Stack: React · TypeScript · Tailwind · React Three Fiber · Recharts · FastAPI · SQLite · NumPy/FAISS · pypdf.</p></div>

const PAGES:any={dashboard:Dash,chat:Chat,docs:Docs,analytics:Analytics,cache:CacheMon,settings:Settings,about:About,auth:Auth,'':Landing}
const LBL:any={docs:'Documents',cache:'Cache Monitor'}
export default function App(){
  const [p,setP]=useState(location.hash.slice(2)),[t,setT]=useState('')
  useEffect(()=>{const h=()=>setP(location.hash.slice(2)),ts=(e:any)=>{setT(e.detail);setTimeout(()=>setT(''),3000)};addEventListener('hashchange',h);addEventListener('toast',ts);return()=>{removeEventListener('hashchange',h);removeEventListener('toast',ts)}},[])
  const prot=['dashboard','chat','docs','analytics','cache','settings'].includes(p)
  useEffect(()=>{if(prot&&!tok)location.hash='#/auth'},[p])
  const Page=(prot&&!tok)?Auth:PAGES[p]||Landing
  return <><Bg/><nav className="g mx-3 mt-3 px-4 py-2 flex flex-wrap gap-2 items-center sticky top-3 z-10"><a href="#/" className="font-bold grad text-lg mr-3">◈ SmartRAG</a>
    {tok?<>{['dashboard','chat','docs','analytics','cache','settings','about'].map(x=><a key={x} href={'#/'+x} className="btn2 text-sm capitalize">{LBL[x]||x}</a>)}<span className="ml-auto text-sm opacity-70">{usr?.name}</span><button className="btn2 text-sm" onClick={logout}>Logout</button></>
    :<><a className="btn2 text-sm" href="#/about">About</a><a className="btn ml-auto text-sm" href="#/auth">Login / Register</a></>}</nav>
    <main className="max-w-6xl mx-auto p-4"><Page key={p}/></main>{t&&<div className="fixed bottom-4 right-4 g px-4 py-2">{t}</div>}</>}
