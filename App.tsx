
import React, { useState, useRef, useEffect } from 'react';
import { ActiveTab, ResumeAnalysis, MarketReport, PortfolioAnalysis, InterviewPersona, SkillRating, InterviewFeedback } from './types';
import { analyzeResumeDeep, scoutMarket, analyzePortfolio, generateInterviewFeedback } from './services/geminiService';
import { useLiveAudio } from './hooks/useLiveAudio';

const TECH_ROLES = ["Software Engineer", "Frontend Engineer", "Backend Engineer", "Data Scientist", "DevOps Engineer", "Product Manager", "Mobile Developer", "Cybersecurity Analyst", "Cloud Architect"];
const TECH_LOCATIONS = ["United States", "United Kingdom", "Canada", "Germany", "Netherlands", "Sweden", "France", "Switzerland", "Singapore", "India", "Sri Lanka", "Australia", "Japan", "United Arab Emirates", "Brazil", "Remote (Global)"];

// --- Visual Components ---
const RadarChart = ({ data }: { data: any }) => {
   const size = 180;
   const center = size / 2;
   const radius = 70;
   const metrics = Object.keys(data);
   const angleStep = (Math.PI * 2) / metrics.length;
   const getPoint = (val: number, i: number) => {
      const angle = i * angleStep - Math.PI / 2;
      const r = (val / 100) * radius;
      return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
   };
   const points = metrics.map((k, i) => getPoint(data[k], i)).join(' ');
   return (
      <svg width={size} height={size} className="overflow-visible">
         <polygon points={points} fill="rgba(236, 72, 153, 0.2)" stroke="#ec4899" strokeWidth="2" />
         {metrics.map((k, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const x = center + (radius + 20) * Math.cos(angle);
            const y = center + (radius + 20) * Math.sin(angle);
            return <text key={k} x={x} y={y} textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="bold">{k.toUpperCase()}</text>;
         })}
      </svg>
   );
};

const CompensationBarChart = ({ breakdown }: { breakdown: MarketReport['compensationBreakdown'] }) => {
    const maxVal = Math.max(breakdown.baseSalary, breakdown.equity, breakdown.signOnBonus) || 1;
    const getWidth = (val: number) => `${Math.max((val / maxVal) * 100, 2)}%`;
    
    return (
        <div className="w-full space-y-3">
             <div className="space-y-1">
                 <div className="flex justify-between text-xs font-bold text-slate-400">
                     <span>Base Salary</span>
                     <span>{breakdown.baseSalary.toLocaleString()} {breakdown.currency}</span>
                 </div>
                 <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                     <div className="h-full bg-emerald-500 rounded-full" style={{ width: getWidth(breakdown.baseSalary) }}></div>
                 </div>
             </div>
             <div className="space-y-1">
                 <div className="flex justify-between text-xs font-bold text-slate-400">
                     <span>Equity (Yearly)</span>
                     <span>{breakdown.equity.toLocaleString()} {breakdown.currency}</span>
                 </div>
                 <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                     <div className="h-full bg-purple-500 rounded-full" style={{ width: getWidth(breakdown.equity) }}></div>
                 </div>
             </div>
             <div className="space-y-1">
                 <div className="flex justify-between text-xs font-bold text-slate-400">
                     <span>Sign-on Bonus</span>
                     <span>{breakdown.signOnBonus.toLocaleString()} {breakdown.currency}</span>
                 </div>
                 <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                     <div className="h-full bg-amber-500 rounded-full" style={{ width: getWidth(breakdown.signOnBonus) }}></div>
                 </div>
             </div>
        </div>
    );
};

const GaugeChart = ({ score, label }: { score: number, label: string }) => {
    // Semi-circle gauge
    const radius = 60;
    const circumference = Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;
    
    return (
        <div className="flex flex-col items-center">
            <div className="relative w-32 h-20 overflow-hidden mb-2">
                 <svg className="w-32 h-32 transform origin-center rotate-0">
                     <circle cx="64" cy="64" r={radius} fill="none" stroke="#1e293b" strokeWidth="12" className="origin-center" style={{ strokeDasharray: circumference, strokeDashoffset: 0, transform: 'rotate(180deg)', transformOrigin: '64px 64px' }} />
                     <circle cx="64" cy="64" r={radius} fill="none" stroke="url(#gradient)" strokeWidth="12" className="origin-center transition-all duration-1000 ease-out" style={{ strokeDasharray: circumference, strokeDashoffset: strokeDashoffset, transform: 'rotate(180deg)', transformOrigin: '64px 64px' }} />
                     <defs>
                        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#ef4444" />
                            <stop offset="50%" stopColor="#eab308" />
                            <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                     </defs>
                 </svg>
                 <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-2xl font-black text-white">{score}%</div>
            </div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</div>
        </div>
    );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>(ActiveTab.RESUME);
  const [resumeData, setResumeData] = useState<ResumeAnalysis | null>(null);
  const [marketReport, setMarketReport] = useState<MarketReport | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioAnalysis | null>(null);
  const [interviewFeedback, setInterviewFeedback] = useState<InterviewFeedback | null>(null);
  
  // Inputs
  const [targetRole, setTargetRole] = useState("Software Engineer");
  const [location, setLocation] = useState("United States");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [portfolioDesc, setPortfolioDesc] = useState("");
  const [interviewPersona, setInterviewPersona] = useState<InterviewPersona>('Staff Architect');
  const [interviewFocus, setInterviewFocus] = useState("");
  const [resumeFile, setResumeFile] = useState<any>(null);
  const [dictatedText, setDictatedText] = useState("");
  
  // Status
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isScouting, setIsScouting] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);
  const [analysisStep, setAnalysisStep] = useState("");
  const [skillRatings, setSkillRatings] = useState<SkillRating>({});
  const [expandedProject, setExpandedProject] = useState<number | null>(null);
  const [isDictationMode, setIsDictationMode] = useState(false);
  const [auditLogs, setAuditLogs] = useState<string[]>([]);
  const [showInterviewGuide, setShowInterviewGuide] = useState(true);

  const hasApiKey = !!process.env.API_KEY;

  // Refs
  const { checkMic, playTestSound, connect, disconnect, status, volume, transcript, isMuted, isAiSpeaking, toggleMute, connectionLogs } = useLiveAudio(targetRole, interviewPersona, interviewFocus);
  
  // Starfield
  const [stars, setStars] = useState<any[]>([]);
  useEffect(() => {
    setStars(Array.from({ length: 100 }).map(() => ({
      top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`,
      size: Math.random() * 2 + 1, opacity: Math.random() * 0.7 + 0.3, duration: Math.random() * 3 + 2
    })));
  }, []);

  useEffect(() => {
    if (resumeData?.detectedTechStack) {
      const r: SkillRating = {};
      resumeData.detectedTechStack.forEach(s => r[s.name] = 0);
      setSkillRatings(r);
    }
  }, [resumeData]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setResumeFile({ name: file.name, data: (reader.result as string).split(',')[1], mimeType: file.type });
    reader.readAsDataURL(file);
  };

  const runResumeAgent = async () => {
    if (!hasApiKey) return;
    setIsAnalyzing(true);
    setResumeData(null);
    setAnalysisStep("Extracting...");
    try {
      setTimeout(() => setAnalysisStep("Analyzing Impact..."), 2000);
      const data = await analyzeResumeDeep(dictatedText ? { text: dictatedText } : { base64Data: resumeFile?.data, mimeType: resumeFile?.mimeType }, targetRole);
      setResumeData(data);
    } catch(e) { alert("Analysis Failed"); } finally { setIsAnalyzing(false); setAnalysisStep(""); }
  };

  const runMarketAgent = async () => {
    if (!hasApiKey) return;
    setIsScouting(true);
    try {
      const data = await scoutMarket(targetRole, location);
      setMarketReport(data);
    } catch(e) { alert("Market Scout Failed"); } finally { setIsScouting(false); }
  };

  const runPortfolioAgent = async () => {
    if (!hasApiKey) return;
    setIsAuditing(true);
    setPortfolioData(null);
    setAuditLogs(["Initializing Agent Delta...", "Scanning Target URL...", "Evaluating Visual UX..."]);
    
    const steps = [
      "Accessing Repositories...",
      "Analyzing Work History...",
      "Checking Educational Background...",
      "Searching for Contact Data...",
      "Deep Code Analysis...",
      "Synthesizing Holistic Report..."
    ];
    
    let stepIndex = 0;
    const interval = setInterval(() => {
        if (stepIndex < steps.length) {
            setAuditLogs(prev => [...prev, steps[stepIndex]]);
            stepIndex++;
        }
    }, 2000);

    try {
      const data = await analyzePortfolio(portfolioUrl, portfolioDesc, targetRole);
      setPortfolioData(data);
    } catch(e) { alert("Portfolio Audit Failed"); } finally { 
        setIsAuditing(false);
        clearInterval(interval);
    }
  };

  const endInterview = async () => {
    disconnect();
    if (transcript.length > 2) {
      setIsGeneratingFeedback(true);
      try {
        const feedback = await generateInterviewFeedback(transcript, targetRole);
        setInterviewFeedback(feedback);
      } catch(e) { console.error(e); } finally { setIsGeneratingFeedback(false); }
    }
  };

  // --- Render Helpers ---
  const ScoreCard = ({ label, score, desc }: any) => (
    <div className={`min-h-40 p-5 rounded-2xl border flex flex-col items-center justify-center relative overflow-hidden group hover:scale-105 transition-all ${score >= 70 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
      <div className="text-4xl font-black mb-2">{score}</div>
      <div className="text-xs font-bold uppercase tracking-widest">{label}</div>
      <div className="absolute inset-0 bg-slate-950/95 flex items-center justify-center p-4 text-center text-xs opacity-0 group-hover:opacity-100 transition-opacity overflow-y-auto">{desc}</div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 pointer-events-none perspective-container z-0">
         <div className="grid-floor"></div>
         {stars.map((s, i) => <div key={i} className="star" style={{ top: s.top, left: s.left, width: `${s.size}px`, height: `${s.size}px`, opacity: s.opacity, animationDuration: `${s.duration}s` }}></div>)}
      </div>

      <nav className="fixed top-0 w-full h-20 z-50 flex items-center justify-between px-8 bg-[#020617]/90 backdrop-blur-xl border-b border-white/10">
        <div className="font-black text-2xl text-white tracking-tighter flex items-center gap-2">
            <span className="text-3xl">🚀</span> TechForge<span className="text-cyan-400">.AI</span>
        </div>
        <div className="flex gap-2">
          {[{ id: ActiveTab.RESUME, icon: '📄' }, { id: ActiveTab.PORTFOLIO, icon: '🧠' }, { id: ActiveTab.INTERVIEW, icon: '🎙️' }, { id: ActiveTab.MARKET, icon: '💰' }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${activeTab === t.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>
              <span>{t.icon}</span><span className="hidden md:inline">{t.id}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="min-h-screen bg-transparent text-slate-200 pt-28 px-4 overflow-hidden relative z-10">
        
        <main className="max-w-7xl mx-auto pb-20">
          
          {/* --- RESUME TAB --- */}
          {activeTab === ActiveTab.RESUME && (
            <div className="grid lg:grid-cols-12 gap-8 animate-fade-in-up">
              <div className="lg:col-span-4 space-y-6">
                <div className="glass-card p-6 rounded-3xl sticky top-24">
                  <h2 className="text-xl font-bold text-white mb-4">Agent Alpha <span className="text-xs bg-cyan-900/50 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/20">RECRUITER</span></h2>
                  <select value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 mb-4 text-white text-sm outline-none">{TECH_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
                  
                  <div className="flex bg-slate-900 rounded-lg p-1 mb-4">
                     <button onClick={() => setIsDictationMode(false)} className={`flex-1 py-2 text-xs font-bold rounded ${!isDictationMode ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'}`}>Upload</button>
                     <button onClick={() => setIsDictationMode(true)} className={`flex-1 py-2 text-xs font-bold rounded ${isDictationMode ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'}`}>Dictate</button>
                  </div>

                  {isDictationMode ? (
                    <textarea value={dictatedText} onChange={(e) => setDictatedText(e.target.value)} className="w-full h-32 bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs mb-4" placeholder="Paste or speak resume..." />
                  ) : (
                    <div className="border-2 border-dashed border-slate-700 rounded-xl p-6 text-center mb-4 relative hover:bg-slate-800/50 transition-colors">
                       <input type="file" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                       <div className="text-slate-500 text-sm font-bold">{resumeFile ? resumeFile.name : "Drop PDF Here"}</div>
                    </div>
                  )}

                  <button onClick={runResumeAgent} disabled={!hasApiKey || isAnalyzing} className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    {isAnalyzing ? `Analyzing: ${analysisStep}` : 'Audit Resume'}
                  </button>
                </div>
              </div>

              <div className="lg:col-span-8">
                {resumeData ? (
                  <div className="space-y-6">
                    <button onClick={() => setResumeData(null)} className="px-4 py-2 bg-slate-800 rounded-lg text-sm font-bold border border-slate-700 hover:bg-slate-700">← Back to Dashboard</button>
                    
                    <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                       <div className="relative z-10 flex flex-col md:flex-row gap-8 justify-between items-center">
                          <div>
                             <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">Verdict</div>
                             <div className={`text-4xl font-black ${resumeData.hiringVerdict.includes('No') ? 'text-red-400' : 'text-emerald-400'}`}>{resumeData.hiringVerdict}</div>
                             <p className="mt-4 text-slate-300 text-sm leading-relaxed max-w-xl">{resumeData.executiveSummary}</p>
                          </div>
                          <div className="flex gap-3">
                             <ScoreCard label="ATS" score={resumeData.scores.atsCompatibility} desc="Parsing success rate" />
                             <ScoreCard label="Impact" score={resumeData.scores.engineeringImpact} desc="Action/Metric/Result usage" />
                             <ScoreCard label="Stack" score={resumeData.scores.techStackRelevance} desc="Relevance to role" />
                          </div>
                       </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                       <div className="bg-emerald-900/10 border border-emerald-500/20 p-6 rounded-2xl">
                          <h3 className="text-emerald-400 font-bold text-sm uppercase mb-4">Key Strengths</h3>
                          <ul className="space-y-2">{resumeData.greenFlags.map((f, i) => <li key={i} className="text-sm text-slate-300 flex gap-2"><span>✓</span> {f}</li>)}</ul>
                       </div>
                       <div className="bg-red-900/10 border border-red-500/20 p-6 rounded-2xl">
                          <h3 className="text-red-400 font-bold text-sm uppercase mb-4">Critical Gaps</h3>
                          <ul className="space-y-2">{resumeData.criticalGaps.map((f, i) => <li key={i} className="text-sm text-slate-300 flex gap-2"><span>⚠</span> {f}</li>)}</ul>
                       </div>
                    </div>

                    <div className="glass-card p-6 rounded-2xl">
                       <h3 className="font-bold text-white mb-6">Strategic Action Plan</h3>
                       <div className="space-y-3">
                          {resumeData.improvementPlan.map((p, i) => (
                             <div key={i} className="bg-slate-900 p-4 rounded-xl border border-white/5 flex gap-4">
                                <span className={`text-[10px] font-black uppercase px-2 py-1 rounded h-fit ${p.priority === 'High' ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-300'}`}>{p.priority}</span>
                                <div>
                                   <div className="font-bold text-white text-sm">{p.action}</div>
                                   <div className="text-xs text-slate-400 mt-1">{p.example}</div>
                                </div>
                             </div>
                          ))}
                       </div>
                    </div>

                    <div className="glass-card p-6 rounded-2xl">
                       <h3 className="font-bold text-white mb-6">Tech Proficiency Matrix</h3>
                       <div className="flex flex-wrap gap-3">
                          {resumeData.detectedTechStack.map(skill => (
                             <div key={skill.name} className="relative group bg-slate-900 px-4 py-2 rounded-lg border border-slate-700 flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{skill.name}</span>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-950 border border-slate-600 rounded-xl text-xs text-slate-300 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
                                   <strong className="text-cyan-400 block mb-1">Relevance:</strong> {skill.importance}
                                </div>
                             </div>
                          ))}
                       </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-96 border-2 border-dashed border-slate-800 rounded-3xl flex items-center justify-center text-slate-600 font-bold">Waiting for resume...</div>
                )}
              </div>
            </div>
          )}

          {/* --- INTERVIEW TAB --- */}
          {activeTab === ActiveTab.INTERVIEW && (
            <div className="grid lg:grid-cols-12 gap-8 animate-fade-in-up">
              
              {/* --- ONBOARDING OVERLAY --- */}
              {showInterviewGuide && status === 'idle' && (
                 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-lg w-full shadow-2xl">
                       <h2 className="text-2xl font-black text-white mb-4">🎤 Ready for the Dojo?</h2>
                       <div className="space-y-4 mb-8">
                          <div className="flex gap-4 items-center">
                             <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center font-bold text-cyan-400">1</div>
                             <p className="text-slate-300 text-sm">Pass the <strong>System Check</strong> (Mic & Speaker).</p>
                          </div>
                          <div className="flex gap-4 items-center">
                             <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center font-bold text-cyan-400">2</div>
                             <p className="text-slate-300 text-sm">Agent Charlie will <strong>greet you first</strong>.</p>
                          </div>
                          <div className="flex gap-4 items-center">
                             <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center font-bold text-cyan-400">3</div>
                             <p className="text-slate-300 text-sm">Speak naturally. Click <strong>End Call</strong> to get your grade.</p>
                          </div>
                       </div>
                       <button onClick={() => setShowInterviewGuide(false)} className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-lg">I'm Ready</button>
                    </div>
                 </div>
              )}

              <div className="lg:col-span-4 space-y-6">
                 <div className="glass-card p-8 rounded-3xl relative">
                    <h2 className="text-2xl font-black text-white mb-2">Agent Charlie</h2>
                    <p className="text-xs text-slate-400 mb-6 uppercase tracking-widest">Voice-to-Voice Simulator</p>
                    
                    <div className="space-y-4">
                       <select value={interviewPersona} onChange={(e) => setInterviewPersona(e.target.value as any)} disabled={status !== 'idle'} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm">{['Junior Peer', 'Senior Engineer', 'Staff Architect', 'Tech Lead', 'Hiring Manager'].map(p => <option key={p} value={p}>{p}</option>)}</select>
                       <input value={interviewFocus} onChange={(e) => setInterviewFocus(e.target.value)} placeholder="Context (e.g. 5 YOE, React)" disabled={status !== 'idle'} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm" />
                       
                       {status === 'idle' && <button onClick={checkMic} className="w-full py-4 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white rounded-xl font-bold">1. Start System Check</button>}
                       
                       {status === 'mic-check' && (
                          <div className="bg-slate-900 p-4 rounded-xl border border-indigo-500/30 text-center">
                             <div className="text-xs font-bold text-indigo-400 mb-2">Mic Level</div>
                             <div className="h-1.5 bg-black rounded-full w-full mb-4 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.min(volume * 500, 100)}%` }}></div></div>
                             <div className="flex gap-2">
                                <button onClick={playTestSound} className="flex-1 py-2 bg-slate-800 text-xs font-bold rounded-lg border border-slate-700">Test Speaker</button>
                                <button onClick={connect} disabled={!hasApiKey} className="flex-1 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow-lg shadow-indigo-500/20 disabled:opacity-50">2. Connect Agent</button>
                             </div>
                          </div>
                       )}

                       {(status === 'active' || status === 'connecting') && (
                          <div className="flex gap-3">
                             <button onClick={toggleMute} className={`flex-1 py-3 font-bold rounded-xl border ${isMuted ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-slate-800 border-slate-600'}`}>{isMuted ? 'Unmute' : 'Mute'}</button>
                             <button onClick={endInterview} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl">End Call</button>
                          </div>
                       )}
                    </div>

                    <div className="mt-8 flex justify-center">
                       <div className={`w-32 h-32 rounded-full flex items-center justify-center text-4xl transition-all duration-300 border-4 ${status === 'active' && isAiSpeaking ? 'border-indigo-400 shadow-[0_0_50px_rgba(99,102,241,0.5)] scale-105' : 'border-slate-800 bg-slate-900'}`}>
                          {status === 'active' ? (isAiSpeaking ? '🤖' : '👂') : (status === 'mic-check' ? '🎤' : '😴')}
                       </div>
                    </div>
                 </div>
                 
                 {/* Connection Log for Debugging */}
                 <div className="bg-black/40 rounded-xl p-4 text-[10px] font-mono text-slate-500 h-32 overflow-y-auto">
                    {connectionLogs.map((l, i) => <div key={i}>{l}</div>)}
                 </div>
              </div>

              <div className="lg:col-span-8 space-y-6">
                 {interviewFeedback ? (
                    <div className="space-y-6 animate-fade-in-up">
                       <button onClick={() => setInterviewFeedback(null)} className="mb-4 px-4 py-2 bg-slate-800 rounded-lg text-sm font-bold border border-slate-700">← New Interview</button>
                       <div className="bg-slate-900/80 border border-white/10 p-8 rounded-3xl shadow-2xl flex items-center gap-8">
                          <div>
                             <div className="text-xs text-slate-400 font-bold uppercase mb-1">Total Score</div>
                             <div className="text-5xl font-black text-white">{interviewFeedback.overallScore}</div>
                          </div>
                          <div className="h-12 w-px bg-slate-700"></div>
                          <div>
                             <div className="text-xs text-slate-400 font-bold uppercase mb-1">Verdict</div>
                             <div className={`text-2xl font-black ${interviewFeedback.hiringRecommendation.includes('No') ? 'text-red-400' : 'text-emerald-400'}`}>{interviewFeedback.hiringRecommendation}</div>
                          </div>
                       </div>
                       <div className="grid md:grid-cols-2 gap-6">
                          <div className="glass-card p-6 rounded-2xl">
                             <div className="flex justify-between mb-4"><span className="font-bold">Technical Accuracy</span><span className="font-mono text-cyan-400">{interviewFeedback.technicalAccuracyScore}/100</span></div>
                             <div className="w-full bg-slate-900 rounded-full h-2"><div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${interviewFeedback.technicalAccuracyScore}%` }}></div></div>
                             <p className="mt-4 text-xs text-slate-400">{interviewFeedback.technicalAccuracy}</p>
                          </div>
                          <div className="glass-card p-6 rounded-2xl">
                             <div className="flex justify-between mb-4"><span className="font-bold">Communication</span><span className="font-mono text-purple-400">{interviewFeedback.communicationClarityScore}/100</span></div>
                             <div className="w-full bg-slate-900 rounded-full h-2"><div className="bg-purple-500 h-2 rounded-full" style={{ width: `${interviewFeedback.communicationClarityScore}%` }}></div></div>
                             <p className="mt-4 text-xs text-slate-400">{interviewFeedback.communicationClarity}</p>
                          </div>
                       </div>
                       <div className="glass-card p-6 rounded-2xl">
                          <h3 className="font-bold mb-4">Detailed Evidence</h3>
                          <div className="space-y-3">
                             {interviewFeedback.detailedFeedback.map((f, i) => (
                                <div key={i} className={`p-4 rounded-xl border-l-4 ${f.category === 'Strength' ? 'bg-emerald-900/10 border-emerald-500' : 'bg-red-900/10 border-red-500'}`}>
                                   <div className="text-xs font-black uppercase mb-1 opacity-70">{f.category}</div>
                                   <div className="text-sm font-bold text-white mb-1">{f.observation}</div>
                                   <div className="text-xs text-slate-400 italic">"{f.quote}"</div>
                                </div>
                             ))}
                          </div>
                       </div>
                    </div>
                 ) : (
                    <div className="h-[600px] bg-slate-950 border border-slate-800 rounded-3xl p-6 overflow-y-auto flex flex-col-reverse">
                       {transcript.map((t, i) => (
                          <div key={i} className={`mb-4 flex ${t.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                             <div className={`max-w-[80%] p-4 rounded-2xl text-sm ${t.speaker === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-300 rounded-bl-none'}`}>
                                <div className="text-[10px] font-bold uppercase opacity-50 mb-1">{t.speaker}</div>
                                {t.text}
                             </div>
                          </div>
                       ))}
                       {transcript.length === 0 && <div className="flex-1 flex items-center justify-center text-slate-600 font-bold italic">Transcript will appear here...</div>}
                    </div>
                 )}
              </div>
            </div>
          )}

          {/* --- MARKET TAB --- */}
          {activeTab === ActiveTab.MARKET && (
             <div className="max-w-6xl mx-auto animate-fade-in-up space-y-8">
                <div className="glass-card p-8 rounded-3xl flex flex-col md:flex-row gap-4 items-end">
                   <div className="flex-1 w-full space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">Search Context</label>
                      <div className="flex gap-4">
                         <select value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm outline-none">{TECH_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
                         <select value={location} onChange={(e) => setLocation(e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm outline-none">{TECH_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}</select>
                      </div>
                   </div>
                   <button onClick={runMarketAgent} disabled={!hasApiKey || isScouting} className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl h-[48px] w-full md:w-auto shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
                      {isScouting ? 'Scouting...' : 'Scan Market'}
                   </button>
                </div>

                {marketReport && (
                   <div className="space-y-8 animate-fade-in-up">
                      <div className="grid md:grid-cols-3 gap-6">
                         <div className="glass-card p-6 rounded-3xl flex flex-col items-center justify-center col-span-1">
                             <GaugeChart score={marketReport.salaryPercentile} label="Market Percentile" />
                             <div className="mt-4 text-center">
                                 <div className="text-xs text-slate-400 uppercase font-bold mb-1">Cost of Living Impact</div>
                                 <div className={`px-3 py-1 rounded-full text-xs font-bold ${marketReport.costOfLivingAnalysis.includes('High') ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                     {marketReport.costOfLivingAnalysis}
                                 </div>
                             </div>
                         </div>
                         <div className="glass-card p-6 rounded-3xl col-span-2 flex flex-col justify-center">
                            <h3 className="text-purple-400 font-bold text-sm uppercase mb-4">Compensation Breakdown (Annual)</h3>
                            <div className="flex flex-col gap-6">
                                <div className="flex items-end gap-2">
                                    <div className="text-4xl font-black text-white">{marketReport.compensationBreakdown.totalComp.toLocaleString()}</div>
                                    <div className="text-lg text-slate-400 font-medium mb-1">{marketReport.compensationBreakdown.currency} / Year</div>
                                </div>
                                <div className="text-sm font-mono text-emerald-400 bg-emerald-900/20 px-3 py-1 rounded w-fit">
                                   ≈ {Math.round(marketReport.compensationBreakdown.totalComp / 12).toLocaleString()} / Month
                                </div>
                                <CompensationBarChart breakdown={marketReport.compensationBreakdown} />
                            </div>
                         </div>
                      </div>

                      <div className="grid md:grid-cols-3 gap-6">
                          <div className="md:col-span-2 bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 p-6 rounded-2xl relative overflow-hidden">
                              <div className="absolute top-0 right-0 p-4 opacity-10 text-9xl">💬</div>
                              <h3 className="text-indigo-300 font-bold text-lg mb-2">Negotiation Power Script</h3>
                              <p className="text-xs text-indigo-400 mb-4 uppercase tracking-wider">Copy/Paste this to email recruiter</p>
                              <div className="bg-slate-950/50 p-4 rounded-xl border border-indigo-500/20 font-mono text-sm text-slate-300 leading-relaxed relative group">
                                  "{marketReport.negotiationScript}"
                                  <button className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-indigo-600 text-white text-[10px] px-2 py-1 rounded transition-opacity" onClick={() => navigator.clipboard.writeText(marketReport.negotiationScript)}>COPY</button>
                              </div>
                          </div>
                          <div className="glass-card p-6 rounded-2xl space-y-6">
                              <div>
                                  <h3 className="text-cyan-400 font-bold text-sm uppercase mb-4">Demand Cloud</h3>
                                  <div className="flex flex-wrap gap-2">
                                     {marketReport.hiringTrends.map((t, i) => (
                                        <span key={i} className="px-3 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs" style={{ opacity: 0.6 + (t.demandScore / 25) }}>
                                           {t.trend}
                                        </span>
                                     ))}
                                  </div>
                              </div>
                              <div>
                                  <h3 className="text-emerald-400 font-bold text-sm uppercase mb-4">Tech Hub Leaderboard</h3>
                                  <div className="space-y-2">
                                    {marketReport.topTechHubs.map((hub, index) => (
                                        <div key={index} className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg border border-slate-700/50">
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-[10px] font-bold text-emerald-400">{index + 1}</div>
                                                <span className="text-xs font-bold text-slate-200">{hub}</span>
                                            </div>
                                            <div className="h-1 w-12 bg-slate-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${100 - (index * 15)}%` }}></div>
                                            </div>
                                        </div>
                                    ))}
                                  </div>
                              </div>
                          </div>
                      </div>

                      <div>
                         <h3 className="text-white font-bold text-lg mb-4">Active Listings</h3>
                         <div className="grid md:grid-cols-2 gap-4">
                            {marketReport.jobListings.map((job, i) => (
                               <div key={i} className="bg-slate-900/50 p-6 rounded-2xl border border-white/5 hover:border-purple-500/50 transition-colors group">
                                  <div className="flex justify-between items-start mb-2">
                                      <div className="font-bold text-white text-lg group-hover:text-purple-400 transition-colors">{job.title}</div>
                                      <div className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-400">{job.location}</div>
                                  </div>
                                  <div className="text-sm font-bold text-slate-300 mb-3">{job.company}</div>
                                  <div className="text-slate-400 text-xs leading-relaxed line-clamp-2">{job.description}</div>
                               </div>
                            ))}
                         </div>
                      </div>
                   </div>
                )}
             </div>
          )}

          {/* --- PORTFOLIO TAB --- */}
          {activeTab === ActiveTab.PORTFOLIO && (
            <div className="grid lg:grid-cols-12 gap-8 animate-fade-in-up pb-20">
               <div className="lg:col-span-4 space-y-6">
                  <div className="glass-card p-6 rounded-3xl sticky top-24">
                     <h2 className="text-xl font-bold text-white mb-6">Agent Delta <span className="text-xs bg-pink-900/50 text-pink-300 px-2 py-0.5 rounded ml-2">PRINCIPAL</span></h2>
                     <select value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 mb-4 text-white text-sm outline-none">{TECH_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
                     <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="GitHub / Portfolio URL" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 mb-4 text-white text-sm" />
                     <textarea value={portfolioDesc} onChange={(e) => setPortfolioDesc(e.target.value)} placeholder="Project Context..." className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 mb-4 text-white text-sm" />
                     <button onClick={runPortfolioAgent} disabled={!hasApiKey || isAuditing} className="w-full py-3 bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-xl font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">{isAuditing ? 'Scanning...' : 'Deep Audit'}</button>
                  </div>
               </div>
               <div className="lg:col-span-8">
                  {isAuditing && !portfolioData ? (
                     <div className="bg-black/90 rounded-3xl p-6 font-mono text-sm h-96 overflow-y-auto border border-green-900 shadow-2xl shadow-green-900/10 relative overflow-hidden">
                         {/* Radar Scanner Animation */}
                         <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
                            <div className="w-full h-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(0,255,100,0.2)_360deg)] animate-[spin_4s_linear_infinite] rounded-full scale-150 origin-center"></div>
                         </div>
                         <div className="relative z-10">
                             {auditLogs.map((log, i) => (
                                 <div key={i} className="mb-2 text-green-400 animate-fade-in-up">
                                     <span className="opacity-50 mr-2">{new Date().toLocaleTimeString()}</span>
                                     <span className="text-pink-500 mr-2">➜</span>
                                     {log}
                                 </div>
                             ))}
                             <div className="animate-pulse text-green-400">_</div>
                         </div>
                     </div>
                  ) : portfolioData ? (
                     <div className="space-y-6 animate-fade-in-up">
                        <button onClick={() => setPortfolioData(null)} className="px-4 py-2 bg-slate-800 rounded-lg text-sm font-bold border border-slate-700 hover:bg-slate-700">← Back</button>
                        
                        <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-8">
                           <div>
                              <div className="text-xs text-pink-400 font-bold uppercase mb-1">Grade</div>
                              <div className="text-5xl font-black text-white">{portfolioData.overallGrade}</div>
                              <div className="text-slate-400 text-sm mt-2 italic">"{portfolioData.technicalSuperpower}"</div>
                           </div>
                           <div className="flex gap-4">
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-white">{portfolioData.brandAnalysis.careerNarrativeScore}</div>
                                    <div className="text-[10px] text-slate-500 uppercase">Narrative</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-white">{portfolioData.brandAnalysis.visualStorytellingScore}</div>
                                    <div className="text-[10px] text-slate-500 uppercase">Storytelling</div>
                                </div>
                           </div>
                           <RadarChart data={portfolioData.skillRadar} />
                        </div>

                        {/* Holistic Brand Report */}
                        <div className="glass-card p-6 rounded-2xl border-l-4 border-pink-500">
                             <h3 className="text-pink-400 font-bold text-sm uppercase mb-4">Holistic Brand Audit</h3>
                             <div className="grid md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs font-bold text-slate-500 uppercase mb-1">Experience Presentation</div>
                                        <p className="text-sm text-slate-300">{portfolioData.brandAnalysis.experiencePresentation}</p>
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-500 uppercase mb-1">Personal Brand</div>
                                        <p className="text-sm text-slate-300">{portfolioData.brandAnalysis.personalBrandCritique}</p>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-slate-500 uppercase mb-1">Education & Background</div>
                                    <p className="text-sm text-slate-300">{portfolioData.brandAnalysis.educationCritique}</p>
                                </div>
                             </div>
                        </div>

                        <div className="space-y-4">
                           {portfolioData.projects.map((p, i) => (
                              <div key={i} className="glass-card p-6 rounded-2xl cursor-pointer hover:bg-slate-800/50 transition-colors" onClick={() => setExpandedProject(expandedProject === i ? null : i)}>
                                 <div className="flex justify-between items-center">
                                    <div className="font-bold text-white">{p.projectName}</div>
                                    <div className="text-xs text-slate-500">{expandedProject === i ? 'Close' : 'Expand'}</div>
                                 </div>
                                 {expandedProject === i && (
                                    <div className="mt-4 pt-4 border-t border-slate-700 grid md:grid-cols-2 gap-6">
                                       <div>
                                          <div className="text-xs font-bold text-pink-400 uppercase mb-2">Critique</div>
                                          <p className="text-sm text-slate-300 whitespace-pre-wrap">{p.critique}</p>
                                       </div>
                                       <div>
                                          <div className="text-xs font-bold text-emerald-400 uppercase mb-2">Fix</div>
                                          <pre className="text-xs bg-black p-3 rounded text-emerald-300 overflow-x-auto">{p.codeSnippet}</pre>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           ))}
                        </div>
                     </div>
                  ) : (
                     <div className="h-96 border-2 border-dashed border-slate-800 rounded-3xl flex items-center justify-center text-slate-600 font-bold text-center px-8">
                         Start Audit to scan GitHub Repos or Portfolio Sites. <br/> Agent Delta will analyze both code quality and career narrative.
                     </div>
                  )}
               </div>
            </div>
          )}
        </main>

        {!hasApiKey && (
            <div className="fixed bottom-0 left-0 right-0 bg-red-900/95 text-red-200 text-center py-4 px-8 z-[100] backdrop-blur-lg border-t border-red-500 font-mono text-sm shadow-2xl">
                ⚠️ <span className="font-bold">CRITICAL ERROR:</span> API_KEY is missing from environment variables. All Agent functions are currently disabled.
            </div>
        )}

      </div>
    </>
  );
};

export default App;
