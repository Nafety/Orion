import { useState, useEffect, useMemo } from 'react'
import Scene from './Scene'
import { Info, Clock, Users, Globe, ExternalLink, Play, BarChart2, X, FilterX } from 'lucide-react'

const getStableColor = (str: string) => {
  if (!str || str === "Autres" || str === "Signal Original") return "#4b5563";
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash % 360)}, 75%, 65%)`;
};

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [payload, setPayload] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'recent'>('all')
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    if (t) {
      setToken(t)
      setLoading(true)
      window.history.replaceState({}, document.title, "/")
      fetch(`http://127.0.0.1:8000/api/city-data?token=${t}`)
        .then(res => res.json())
        .then(d => { setPayload(d); setLoading(false); })
        .catch(() => setLoading(false))
    }
  }, [])

  const handleTabChange = (tab: 'all' | 'recent') => {
    setSelectedNode(null);
    setActiveFilter(null);
    setActiveTab(tab);
  };

  const displayData = useMemo(() => {
    if (!payload) return [];
    return activeTab === 'all' ? payload.top_artists : payload.recent_tracks;
  }, [payload, activeTab]);

  const dynamicLegend = useMemo(() => {
    if (!payload) return [];
    const source = activeTab === 'all' 
      ? payload.top_artists.flatMap((a: any) => (a.genres && a.genres.length > 0) ? a.genres : ["Signal Original"]) 
      : payload.recent_tracks.map((t: any) => t.artist_name);
    const unique = Array.from(new Set(source));
    return unique.sort().map(name => ({ label: name, color: getStableColor(name) }));
  }, [payload, activeTab]);

  if (!token) return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[#010103] text-white font-sans">
      <Globe size={48} className="text-cyan-500 mb-6" />
      <h1 className="text-8xl font-black italic tracking-tighter uppercase leading-none">ORION<span className="text-cyan-500">.</span></h1>
      <button onClick={() => window.location.href = 'http://127.0.0.1:8000/login'} className="mt-8 px-12 py-4 border border-cyan-500 text-cyan-500 uppercase font-bold hover:bg-cyan-500 hover:text-black transition-all shadow-[0_0_30px_rgba(34,211,238,0.2)]">Connecter le Flux</button>
    </div>
  );

  if (loading || !payload) return <div className="h-full w-full flex items-center justify-center bg-[#010103] text-cyan-500 font-mono tracking-[0.5em] uppercase text-xs animate-pulse">Mapping Neural Network...</div>

  const cleanId = selectedNode?.id?.match(/[a-zA-Z0-9]{22}/)?.[0] || selectedNode?.id;
  const currentMainstreamScore = activeTab === 'all' ? payload.stats.top_mainstream_score : payload.stats.recent_mainstream_score;

  return (
    <div className="h-full w-full relative bg-[#010103] overflow-hidden font-sans text-white text-selection-none">
      
      {selectedNode && (
        <div key={activeTab} className="absolute left-10 top-1/2 -translate-y-1/2 w-85 max-h-[90vh] bg-black/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-6 z-[100] animate-in slide-in-from-left-10 duration-500 shadow-2xl flex flex-col overflow-hidden">
          <button onClick={() => setSelectedNode(null)} className="absolute top-6 right-6 text-white/30 hover:text-white transition-colors z-[110]"><X size={20}/></button>
          
          <div className="relative w-full aspect-square rounded-[1.5rem] overflow-hidden mb-4 border border-white/10 shrink-0">
            <img src={selectedNode.image} className="w-full h-full object-cover" alt="" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          <div className="w-full mb-4 shrink-0 rounded-2xl overflow-hidden bg-black/40 border border-white/5">
            <iframe title="Spotify Player" src={`https://open.spotify.com/embed/${selectedNode.type}/${cleanId}?utm_source=generator&theme=0`} width="100%" height="80" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" className="block rounded-xl"></iframe>
          </div>

          <div className="overflow-y-auto custom-scrollbar pr-1 flex-1">
            {activeTab === 'recent' && selectedNode.top_track && (
              <div className="mb-2 inline-block px-3 py-1 bg-yellow-400 text-black text-[9px] font-black italic uppercase tracking-tighter rounded-full shadow-[0_0_15px_rgba(250,204,21,0.5)] animate-pulse">
                ★ Top Track Hit
              </div>
            )}
            <h2 className="text-2xl font-black italic tracking-tighter leading-tight mb-1 uppercase break-words">{selectedNode.name}</h2>
            <p className="text-cyan-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4 opacity-70">
              {activeTab === 'all' ? (selectedNode.genres?.[0] || "Signal Original") : (selectedNode.artist_name || "Unknown Artist")}
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 shrink-0">
                <div className="flex items-center gap-2 text-gray-400 uppercase font-black text-[8px] tracking-widest"><BarChart2 size={12}/> Popularity</div>
                <div className="text-lg font-mono text-white">{selectedNode.popularity}%</div>
              </div>
              {activeTab === 'all' && selectedNode.top_track && (
                <div className="p-3 bg-yellow-400/10 rounded-xl border border-yellow-400/20 shrink-0">
                  <div className="flex items-center gap-2 text-yellow-500 uppercase font-black text-[8px] tracking-widest mb-1"><Play size={12}/> Top Track</div>
                  <div className="text-[10px] font-bold text-white uppercase italic truncate">{selectedNode.top_track}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="absolute top-10 left-1/2 -translate-x-1/2 flex gap-2 p-1 bg-black/40 backdrop-blur-3xl rounded-full border border-white/10 z-50">
        <button onClick={() => handleTabChange('all')} className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${activeTab === 'all' ? 'bg-cyan-500 text-black shadow-[0_0_20px_#22d3ee]' : 'text-white/50 hover:text-white'}`}><Users size={14} className="inline mr-2"/> Top Artists</button>
        <button onClick={() => handleTabChange('recent')} className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${activeTab === 'recent' ? 'bg-cyan-500 text-black shadow-[0_0_20px_#22d3ee]' : 'text-white/50 hover:text-white'}`}><Clock size={14} className="inline mr-2"/> Recent tracks</button>
      </div>

      <Scene data={displayData} viewType={activeTab} onNodeSelect={setSelectedNode} selectedNode={selectedNode} activeFilter={activeFilter} />

      <div className="absolute top-8 right-8 p-6 bg-black/60 backdrop-blur-xl border border-white/10 rounded-[2rem] w-64 z-10 hidden lg:flex flex-col max-h-[45vh] shadow-2xl">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3"><Info size={14} className="text-cyan-400" /><span className="text-[9px] font-black uppercase tracking-widest leading-none">Indicateurs</span></div>
          {activeFilter && (<button onClick={() => setActiveFilter(null)} className="text-cyan-400 hover:text-white transition-colors cursor-pointer"><FilterX size={14}/></button>)}
        </div>

        <div className="overflow-y-auto pr-2 custom-scrollbar flex-1">
          <div className="mb-4 space-y-2 border-b border-white/5 pb-4">
            <div className="flex items-center gap-3 px-2 py-1.5 opacity-80">
              <div className="w-3 h-3 rounded-full border border-yellow-400 flex items-center justify-center shadow-[0_0_5px_#facc15]"><div className="w-1 h-1 bg-yellow-400 rounded-full" /></div>
              <span className="text-[8px] font-black uppercase tracking-tighter text-yellow-500">Ring : Top Track Hit</span>
            </div>
            {activeTab === 'all' && (
              <div className="flex items-center gap-3 px-2 py-1.5 opacity-80">
                <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee] animate-pulse" />
                <span className="text-[8px] font-black uppercase tracking-tighter text-cyan-400">Glow : Pulse Récent</span>
              </div>
            )}
          </div>
          <div className="space-y-1">
            {dynamicLegend.map(item => (
              <button key={item.label} onClick={() => setActiveFilter(activeFilter === item.label ? null : item.label)} className={`w-full flex items-center gap-3 py-1.5 px-2 rounded-lg transition-all text-left ${activeFilter === item.label ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5'}`}>
                <div className="w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor]" style={{ backgroundColor: item.color }} />
                <span className={`text-[8px] font-bold uppercase truncate tracking-tight ${activeFilter === item.label ? 'text-white' : 'text-gray-400'}`}>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-10 right-10 w-72 p-8 bg-black/40 backdrop-blur-2xl border border-white/5 rounded-tl-[3rem] z-10 shadow-2xl">
        <div className="mb-4">
          <div className="flex justify-between text-[9px] font-black uppercase text-gray-500 mb-2"><span>Mainstream Index</span><span>{Math.round(currentMainstreamScore)}%</span></div>
          <div className="w-full h-[2px] bg-white/5"><div className="h-full bg-cyan-500 shadow-[0_0_10px_#22d3ee] transition-all duration-1000 ease-out" style={{ width: `${currentMainstreamScore}%` }} /></div>
        </div>
        <div className="flex gap-8">
          <div className="flex flex-col"><span className="text-[7px] font-black uppercase text-gray-600 tracking-tighter">{activeTab === 'all' ? 'Total Styles' : 'Unique Artists'}</span><span className="text-2xl font-light text-white">{activeTab === 'all' ? payload.stats.total_genres : payload.stats.total_recent_artists}</span></div>
          <div className="border-l border-white/10 pl-6 flex flex-col flex-1 overflow-hidden"><span className="text-[7px] font-black uppercase text-gray-600 text-right tracking-tighter">Last Active</span><span className="text-[10px] font-bold text-cyan-400 truncate uppercase text-right tracking-tight">{payload.stats.last_played}</span></div>
        </div>
      </div>
      <div className="absolute bottom-10 left-10 text-white italic font-black text-6xl pointer-events-none uppercase tracking-tighter opacity-80">ORION<span className="text-cyan-500">.</span></div>
    </div>
  )
}