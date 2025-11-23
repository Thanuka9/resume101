import React, { useState, useRef, useEffect } from 'react';
import { ActiveTab, ResumeAnalysis, MarketReport, PortfolioAnalysis, InterviewPersona, SkillRating } from './types';
import { analyzeResumeDeep, scoutMarket, analyzePortfolio } from './services/geminiService';
import { useLiveAudio } from './hooks/useLiveAudio';

// Predefined Tech Roles
const TECH_ROLES = [
  "Software Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Developer",
  "Data Scientist",
  "Machine Learning Engineer",
  "DevOps Engineer / SRE",
  "Product Manager (Tech)",
  "Mobile Developer (iOS/Android)",
  "Cybersecurity Analyst",
  "Cloud Architect"
];

// Demo Data
const DEMO_CV_TEXT = `
Thanuka Ellepola
DATA SCIENTIST
Analytical and results-driven professional with a background in
Computer Systems & Networking and a Master’s in Business Analytics.
Over five years of leadership experience in healthcare revenue
operations. Recently completed a predictive analytics research project
using Python and Power BI, applying data modeling to real-world RCM
challenges.
`;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>(ActiveTab.RESUME);
  const resultsRef = useRef<HTMLDivElement>(null);
  
  // --- Resume Agent State ---
  const [resumeFile, setResumeFile] = useState<{ name: string; data?: string; mimeType?: string; text?: string } | null>(null);
  const [targetRole, setTargetRole] = useState("Software Engineer");
  const [resumeData, setResumeData] = useState<ResumeAnalysis | null>(null);
  const [skillRatings, setSkillRatings] = useState<SkillRating>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- Market Agent State ---
  const [location, setLocation] = useState("Colombo, Sri Lanka");
  const [marketReport, setMarketReport] = useState<MarketReport | null>(null);
  const [isScouting, setIsScouting] = useState(false);

  // --- Portfolio Agent State ---
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [portfolioDesc, setPortfolioDesc] = useState("");
  const [portfolioData, setPortfolioData] = useState<PortfolioAnalysis | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [expandedProject, setExpandedProject] = useState<number | null>(null);

  // --- Interview Agent State ---
  const [interviewPersona, setInterviewPersona] = useState<InterviewPersona>('Staff Architect');
  const { connect, disconnect, status, volume, toggleMute, isMuted } = useLiveAudio(targetRole, interviewPersona);

  useEffect(() => {
    if (resumeData && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    // Initialize skill ratings when resume data loads
    if (resumeData?.detectedTechStack) {
      const initialRatings: SkillRating = {};
      resumeData.detectedTechStack.forEach(skill => {
        initialRatings[skill] = 0;
      });
      setSkillRatings(initialRatings);
    }
  }, [resumeData]);

  // --- Handlers ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const fileType = file.type;

    if (fileName.endsWith('.docx') || fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          // @ts-ignore
          if (window.mammoth) {
            // @ts-ignore
            const result = await window.mammoth.extractRawText({ arrayBuffer });
            setResumeFile({ name: file.name, text: result.value });
          } else {
            alert("Document processor not ready. Please reload.");
          }
        } catch (err) {
          console.error(err);
          alert("Could not read Word document.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (fileName.endsWith('.pdf') || fileType === "application/pdf" || fileType.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        const base64Data = base64String.split(',')[1];
        const finalMimeType = fileName.endsWith('.pdf') ? 'application/pdf' : fileType;
        setResumeFile({ name: file.name, data: base64Data, mimeType: finalMimeType });
      };
      reader.readAsDataURL(file);
    } else {
      alert("Unsupported file format.");
    }
  };

  const runResumeAgent = async (useDemo = false) => {
    setIsAnalyzing(true);
    setResumeData(null);
    try {
      let data;
      if (useDemo) {
        data = await analyzeResumeDeep({ text: DEMO_CV_TEXT }, targetRole);
      } else if (resumeFile) {
        if (resumeFile.text) {
          data = await analyzeResumeDeep({ text: resumeFile.text }, targetRole);
        } else if (resumeFile.data && resumeFile.mimeType) {
          data = await analyzeResumeDeep({ base64Data: resumeFile.data, mimeType: resumeFile.mimeType }, targetRole);
        }
      }
      if (data) setResumeData(data);
    } catch (e) {
      console.error(e);
      alert("Agent Alpha encountered an error. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSkillRate = (skill: string, rating: number) => {
    setSkillRatings(prev => ({
      ...prev,
      [skill]: rating
    }));
  };

  const runMarketAgent = async () => {
    setIsScouting(true);
    setMarketReport(null);
    try {
      const report = await scoutMarket(targetRole, location);
      setMarketReport(report);
    } catch (e) {
      console.error(e);
      alert("Agent Bravo failed. Please try again.");
    } finally {
      setIsScouting(false);
    }
  };

  const runPortfolioAgent = async () => {
    setIsAuditing(true);
    setPortfolioData(null);
    setExpandedProject(null);
    try {
      const analysis = await analyzePortfolio(portfolioUrl, portfolioDesc, targetRole);
      setPortfolioData(analysis);
    } catch(e) {
       console.error(e);
       alert("Agent Delta failed. Please check the URL.");
    } finally {
       setIsAuditing(false);
    }
  };

  // --- Helper Components ---

  const ScoreCard = ({ label, score, description }: { label: string; score: number; description: string }) => {
    const getColor = (s: number) => {
      if (s >= 80) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5 shadow-emerald-500/20';
      if (s >= 60) return 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5 shadow-yellow-500/20';
      return 'text-red-400 border-red-500/30 bg-red-500/5 shadow-red-500/20';
    };
    return (
      <div className={`h-40 border rounded-2xl p-5 flex flex-col items-center justify-center relative overflow-hidden backdrop-blur-xl shadow-lg group cursor-help transition-all hover:scale-[1.02] ${getColor(score)}`}>
        <div className="text-5xl font-black mb-3 relative z-10">{score}</div>
        <div className="text-sm uppercase tracking-widest opacity-80 relative z-10 font-bold">{label}</div>
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none rounded-2xl">
          <p className="text-sm text-slate-200 text-center font-medium leading-relaxed">{description}</p>
        </div>
      </div>
    );
  };

  const BarChart = ({ data, currency }: { data: { label: string; value: number; color: string }[]; currency: string }) => {
    const maxValue = Math.max(...data.map(d => d.value));
    return (
      <div className="w-full space-y-4">
        {data.map((item) => (
          <div key={item.label}>
            <div className="flex justify-between text-sm font-bold text-slate-400 mb-1">
              <span>{item.label}</span>
              <span className="text-white">{currency} {item.value.toLocaleString()}</span>
            </div>
            <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-1000 ${item.color}`} 
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const getSortedImprovementPlan = (plan: ResumeAnalysis['improvementPlan']) => {
    const priorityWeight = { High: 3, Medium: 2, Low: 1 };
    return [...plan].sort((a, b) => {
       const wa = priorityWeight[a.priority as keyof typeof priorityWeight] || 0;
       const wb = priorityWeight[b.priority as keyof typeof priorityWeight] || 0;
       return wb - wa;
    });
  };

  return (
    <div className="min-h-screen bg-[#050a14] text-slate-200 font-sans selection:bg-cyan-500 selection:text-white pb-20 overflow-x-hidden">
      
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.9)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-600/20 rounded-full blur-[128px] animate-pulse"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[128px] animate-pulse"></div>
      </div>

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 h-20 bg-[#050a14]/90 backdrop-blur-xl border-b border-white/10 z-50 flex items-center justify-between px-6 lg:px-12">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-xl">TF</div>
          <span className="font-bold text-2xl text-white hidden sm:block">TechForge <span className="text-cyan-400 text-xs border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 rounded-md uppercase ml-1">AI</span></span>
        </div>
        <div className="flex gap-2 bg-slate-900/50 p-1.5 rounded-2xl border border-white/10 overflow-x-auto no-scrollbar">
          {[{ id: ActiveTab.RESUME, label: 'Resume', icon: '📄' }, { id: ActiveTab.PORTFOLIO, label: 'Code', icon: '🧠' }, { id: ActiveTab.INTERVIEW, label: 'Interview', icon: '🎙️' }, { id: ActiveTab.MARKET, label: 'Market', icon: '💰' }].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2.5 whitespace-nowrap ${activeTab === tab.id ? 'bg-slate-800 text-white shadow-lg border border-slate-600/50 scale-105' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className="hidden md:block">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="relative z-10 pt-28 px-4 max-w-[1600px] mx-auto">
        
        {/* --- RESUME TAB --- */}
        {activeTab === ActiveTab.RESUME && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-fade-in-up">
            <div className="xl:col-span-4 space-y-6">
              <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl xl:sticky xl:top-28">
                <h2 className="text-2xl font-bold text-white mb-8 flex items-center gap-3">
                  Agent Alpha <span className="text-xs font-bold text-slate-400 ml-auto bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">RECRUITER</span>
                </h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">Target Tech Role</label>
                    <div className="relative group">
                      <select value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-5 py-4 text-white text-base outline-none appearance-none hover:bg-slate-900">
                        {TECH_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">Upload Resume</label>
                    <div className="relative border-2 border-dashed border-slate-700 rounded-2xl p-10 text-center hover:bg-slate-800/30 transition-all cursor-pointer bg-slate-950/30">
                      <input type="file" onChange={handleFileUpload} accept=".pdf,.doc,.docx,.jpg,.png" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                      {resumeFile ? (
                        <div className="flex flex-col items-center justify-center text-cyan-400">
                           <span className="text-4xl mb-2">📑</span>
                           <span className="text-base font-semibold truncate max-w-[200px] text-slate-200">{resumeFile.name}</span>
                           <span className="text-[10px] text-cyan-400 uppercase tracking-widest mt-1">Ready</span>
                        </div>
                      ) : (
                        <div className="text-slate-500">
                          <span className="text-4xl block mb-2 opacity-50">📥</span>
                          <span className="text-base font-semibold">Drop PDF/DOCX</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => runResumeAgent(false)} disabled={!resumeFile || isAnalyzing} className="w-full py-5 rounded-xl font-bold text-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-500/20 shadow-lg transition-transform hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed">
                    {isAnalyzing ? 'Analyzing...' : 'Audit Resume'}
                  </button>
                  <button onClick={() => runResumeAgent(true)} className="w-full py-3.5 rounded-xl border border-slate-700 bg-slate-900/50 hover:bg-slate-800 text-slate-300 text-sm font-semibold">
                    Load Demo Candidate
                  </button>
                </div>
              </div>
            </div>

            <div className="xl:col-span-8" ref={resultsRef}>
              {resumeData ? (
                <div className="space-y-8 animate-fade-in-up pb-10">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <ScoreCard label="ATS Score" score={resumeData.scores.atsCompatibility} description="Parsability rating." />
                    <ScoreCard label="Eng Impact" score={resumeData.scores.engineeringImpact} description="Action -> Metric -> Result pattern." />
                    <ScoreCard label="Stack Match" score={resumeData.scores.techStackRelevance} description="Relevance to modern standards." />
                  </div>

                  {/* TECH PROFICIENCY MATRIX */}
                  {resumeData.detectedTechStack.length > 0 && (
                    <div className="bg-slate-900/60 backdrop-blur-md border border-cyan-500/20 rounded-3xl p-8 shadow-xl">
                      <div className="flex justify-between items-end mb-6">
                        <div>
                           <h3 className="text-cyan-400 font-bold uppercase tracking-wider text-sm flex items-center gap-2">
                             <span className="text-lg">⚡</span> Skills Matrix
                           </h3>
                           <p className="text-slate-400 text-xs mt-1">Rate your confidence level (1-5) to calibrate future matches.</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {resumeData.detectedTechStack.map((skill) => (
                          <div key={skill} className="flex items-center justify-between bg-slate-950/40 p-3 rounded-xl border border-white/5 hover:border-cyan-500/30 transition-colors">
                            <span className="font-mono text-sm text-slate-200">{skill}</span>
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map((level) => (
                                <button
                                  key={level}
                                  onClick={() => handleSkillRate(skill, level)}
                                  className={`w-2.5 h-6 rounded-sm transition-all duration-200 ${
                                    (skillRatings[skill] || 0) >= level 
                                      ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]' 
                                      : 'bg-slate-800 hover:bg-slate-700'
                                  }`}
                                  title={`${level}/5 Proficiency`}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* IMPROVEMENT PLAN */}
                  <div className="bg-gradient-to-br from-[#0f172a] to-[#1e293b] border border-indigo-500/30 rounded-3xl p-10 shadow-xl relative overflow-hidden">
                    <h3 className="text-indigo-400 font-bold uppercase tracking-wider text-sm mb-8 flex items-center gap-3">
                       <span className="p-2 bg-indigo-500/20 rounded-lg text-lg">🚀</span> Strategic Improvement Plan
                    </h3>
                    <div className="space-y-4">
                       {resumeData.improvementPlan && getSortedImprovementPlan(resumeData.improvementPlan).map((item, i) => (
                         <div key={i} className="bg-slate-950/40 p-6 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-all">
                           <div className="flex items-center gap-3 mb-3">
                             <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase ${item.priority === 'High' ? 'bg-red-500/20 text-red-400' : (item.priority === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400')}`}>{item.priority} Priority</span>
                             <h4 className="font-bold text-white text-lg">{item.action}</h4>
                           </div>
                           <div className="pl-4 border-l-2 border-indigo-500/20 ml-1">
                             <p className="text-indigo-200/80 text-sm font-mono bg-slate-900/50 p-3 rounded-lg">Example: "{item.example}"</p>
                           </div>
                         </div>
                       ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-red-900/10 border border-red-500/20 rounded-3xl p-8">
                       <h3 className="text-red-400 font-bold uppercase tracking-wider text-sm mb-6">🚩 Red Flags</h3>
                       <ul className="space-y-4">
                         {resumeData.criticalGaps.map((gap, i) => (
                           <li key={i} className="flex items-start gap-3 text-slate-200 bg-red-950/30 p-4 rounded-xl border border-red-500/10">
                             <span className="text-red-500">•</span> {gap}
                           </li>
                         ))}
                       </ul>
                    </div>
                    <div className="bg-emerald-900/10 border border-emerald-500/20 rounded-3xl p-8">
                      <h3 className="text-emerald-400 font-bold uppercase tracking-wider text-sm mb-6">✍️ Impact Rewrites</h3>
                      <div className="space-y-6">
                        {resumeData.rewrites.map((rw, i) => (
                          <div key={i} className="bg-emerald-950/30 p-5 rounded-2xl border border-emerald-500/10">
                            <div className="text-sm text-slate-400 line-through mb-2 opacity-70">{rw.original}</div>
                            <div className="text-base text-white font-medium flex gap-2">
                              <span className="text-emerald-500">➜</span> {rw.improved}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-[600px] flex items-center justify-center border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20 text-slate-400">
                   Upload resume to verify engineering impact.
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- PORTFOLIO TAB --- */}
        {activeTab === ActiveTab.PORTFOLIO && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-fade-in-up">
            <div className="xl:col-span-4 space-y-6">
              <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl xl:sticky xl:top-28">
                <h2 className="text-2xl font-bold text-white mb-8 flex items-center gap-3">
                  Agent Delta <span className="text-xs font-bold text-slate-400 ml-auto bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">PRINCIPAL</span>
                </h2>
                <div className="space-y-6">
                   <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">Repo URL</label>
                    <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="https://github.com/username/project" className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-5 py-4 text-white focus:ring-2 focus:ring-pink-500 outline-none font-mono text-sm" />
                   </div>
                   <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">Context</label>
                    <textarea value={portfolioDesc} onChange={(e) => setPortfolioDesc(e.target.value)} placeholder="Describe the architecture..." className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-5 py-4 text-white focus:ring-2 focus:ring-pink-500 outline-none h-48 resize-none text-sm leading-relaxed" />
                   </div>
                   <button onClick={runPortfolioAgent} disabled={(!portfolioUrl && !portfolioDesc) || isAuditing} className="w-full py-5 rounded-xl font-bold text-lg bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white shadow-pink-500/20 shadow-lg transition-transform hover:-translate-y-1 disabled:opacity-50">
                    {isAuditing ? 'Auditing...' : 'Run Code Audit'}
                   </button>
                </div>
              </div>
            </div>

            <div className="xl:col-span-8">
              {portfolioData ? (
                <div className="space-y-10 animate-fade-in-up pb-10">
                  <div className="bg-gradient-to-r from-pink-900/80 to-slate-900 border border-pink-500/30 rounded-3xl p-10 flex flex-col md:flex-row items-center justify-between shadow-2xl">
                    <div className="flex items-center gap-8">
                      <div className="w-32 h-32 bg-pink-500/10 rounded-2xl border border-pink-500/50 flex items-center justify-center text-7xl font-black text-white">{portfolioData.overallGrade}</div>
                      <div>
                        <div className="text-pink-300 font-bold uppercase tracking-wider text-sm mb-2">Verdict</div>
                        <div className="text-4xl font-bold text-white mb-2">{portfolioData.hiringDecision}</div>
                        <div className="text-pink-200/60 text-lg italic">"{portfolioData.technicalSuperpower}"</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {portfolioData.projects.map((proj, i) => (
                      <div key={i} className={`bg-slate-900/80 border ${expandedProject === i ? 'border-pink-500/50 ring-1 ring-pink-500/20' : 'border-slate-800 hover:border-slate-700'} rounded-3xl overflow-hidden shadow-lg transition-all duration-300`}>
                        <div 
                          onClick={() => setExpandedProject(expandedProject === i ? null : i)}
                          className="p-8 cursor-pointer flex flex-col md:flex-row justify-between items-center gap-6"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-4 mb-2">
                              <h4 className="text-2xl font-bold text-indigo-100">{proj.projectName}</h4>
                              {expandedProject === i ? <span className="text-pink-400 text-xl">−</span> : <span className="text-pink-400 text-xl">+</span>}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {proj.techStack.map(t => (
                                <span key={t} className="text-xs bg-slate-800 px-3 py-1 rounded-lg text-slate-400 border border-slate-700 font-mono">{t}</span>
                              ))}
                            </div>
                          </div>

                          <div className="flex gap-6 items-center">
                            <div className="text-center">
                              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Impact</div>
                              <div className={`text-xl font-black ${proj.impactScore > 70 ? 'text-emerald-400' : 'text-yellow-400'}`}>{proj.impactScore}</div>
                            </div>
                            <div className="text-center">
                               <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Quality</div>
                               <div className={`text-xl font-black ${proj.codeQualityScore > 70 ? 'text-blue-400' : 'text-yellow-400'}`}>{proj.codeQualityScore}</div>
                            </div>
                          </div>
                        </div>

                        {expandedProject === i && (
                          <div className="px-8 pb-8 pt-0 animate-fade-in space-y-6 cursor-auto">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                               <div className="bg-slate-950/50 p-6 rounded-2xl border border-white/5">
                                  <h5 className="text-xs text-slate-400 uppercase font-bold mb-3 flex items-center gap-2">🔍 Technical Critique</h5>
                                  <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{proj.critique}</p>
                               </div>
                               <div className="bg-slate-950/50 p-6 rounded-2xl border border-white/5">
                                  <h5 className="text-xs text-emerald-400 uppercase font-bold mb-3 flex items-center gap-2">💡 Recommended Improvement</h5>
                                  <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{proj.improvement}</p>
                               </div>
                            </div>

                            <div className="bg-[#0d1117] rounded-2xl border border-pink-500/20 overflow-hidden">
                               <div className="bg-slate-900/50 px-4 py-2 border-b border-white/5 flex items-center justify-between">
                                  <span className="text-xs text-pink-400 uppercase font-bold font-mono">Suggested Refactor</span>
                                  <div className="flex gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/20"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/20"></div>
                                  </div>
                               </div>
                               <div className="p-6 overflow-x-auto">
                                 <pre className="font-mono text-sm text-blue-100">
                                   <code>{proj.codeSnippet}</code>
                                 </pre>
                               </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[600px] flex items-center justify-center border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20 text-slate-400">
                   Submit GitHub URL to check for CI/CD, Tests, and Architecture.
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- INTERVIEW TAB --- */}
        {activeTab === ActiveTab.INTERVIEW && (
          <div className="max-w-4xl mx-auto animate-fade-in-up pt-12">
            <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-[3rem] overflow-hidden shadow-2xl relative p-20 flex flex-col items-center text-center space-y-12">
                <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                  <div className={`w-[600px] h-[600px] bg-indigo-600 rounded-full blur-[150px] transition-all duration-1000 ${status === 'active' ? 'scale-150 opacity-60' : 'scale-100 opacity-20'}`}></div>
                </div>
                
                <div className="relative z-10">
                  <h2 className="text-5xl font-black text-white mb-2">System Design Interview</h2>
                  <p className="text-slate-400 text-xl">Agent Charlie // Voice AI</p>
                </div>

                {/* Persona Selector */}
                <div className="relative z-10 w-64">
                   <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Interviewer Level</label>
                   <select 
                     value={interviewPersona} 
                     onChange={(e) => setInterviewPersona(e.target.value as InterviewPersona)}
                     disabled={status !== 'idle'}
                     className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-3 outline-none"
                   >
                      <option value="Junior Peer">Junior Peer (Friendly)</option>
                      <option value="Senior Engineer">Senior Engineer (Standard)</option>
                      <option value="Staff Architect">Staff Architect (Hard)</option>
                   </select>
                </div>

                <div className="relative group z-10">
                  <div className={`w-56 h-56 rounded-full flex items-center justify-center border-[8px] transition-all duration-500 ${status === 'active' ? 'border-indigo-500 bg-indigo-950 shadow-[0_0_100px_rgba(99,102,241,0.6)]' : 'border-slate-700 bg-slate-900 shadow-xl'}`}>
                    <svg className={`w-24 h-24 transition-colors ${status === 'active' ? 'text-white' : 'text-slate-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  </div>
                  {status === 'active' && <div className="absolute inset-0 rounded-full border-2 border-indigo-400 animate-ping opacity-30"></div>}
                </div>

                <div className="relative z-10">
                  {status === 'idle' || status === 'error' ? (
                    <button onClick={connect} className="px-12 py-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold text-2xl shadow-2xl transition-all hover:scale-105">Start Interview</button>
                  ) : (
                    <div className="flex gap-6">
                       <button onClick={toggleMute} className={`w-20 h-20 rounded-full flex items-center justify-center border-2 text-3xl ${isMuted ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-slate-800 border-slate-600 text-white'}`}>{isMuted ? '🔇' : '🎙️'}</button>
                       <button onClick={disconnect} className="px-12 py-6 bg-red-600 hover:bg-red-500 text-white rounded-full font-bold text-2xl shadow-2xl transition-all hover:scale-105">End Session</button>
                    </div>
                  )}
                </div>
            </div>
          </div>
        )}

        {/* --- MARKET TAB --- */}
        {activeTab === ActiveTab.MARKET && (
          <div className="max-w-7xl mx-auto space-y-10 animate-fade-in-up">
            <div className="bg-slate-900/60 backdrop-blur-xl p-10 rounded-3xl border border-white/10 shadow-2xl flex flex-col md:flex-row gap-8 items-end">
              <div className="flex-1 w-full space-y-3">
                 <label className="text-xs font-bold text-slate-400 uppercase">Role & Location</label>
                 <div className="flex gap-4">
                   <select value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="flex-1 bg-slate-950/50 border border-slate-700 rounded-xl px-5 py-4 text-white text-lg outline-none">
                     {TECH_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                   </select>
                   <input value={location} onChange={(e) => setLocation(e.target.value)} className="flex-1 bg-slate-950/50 border border-slate-700 rounded-xl px-5 py-4 text-white text-lg outline-none" />
                 </div>
              </div>
              <button onClick={runMarketAgent} disabled={isScouting} className="px-12 py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 text-lg h-[60px]">
                {isScouting ? 'Scouting...' : 'Get Data'}
              </button>
            </div>

            {marketReport && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Visual Chart Card */}
                <div className="xl:col-span-2 bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-12">
                   <h3 className="text-3xl font-bold text-white mb-10">Compensation Analysis</h3>
                   <div className="flex flex-col md:flex-row gap-12">
                      <div className="flex-1">
                         <BarChart 
                           currency={marketReport.compensationBreakdown.currency}
                           data={[
                             { label: 'Base Salary', value: marketReport.compensationBreakdown.baseSalary, color: 'bg-blue-500' },
                             { label: 'Equity / Stock Options', value: marketReport.compensationBreakdown.equity, color: 'bg-purple-500' },
                             { label: 'Sign-On Bonus', value: marketReport.compensationBreakdown.signOnBonus, color: 'bg-emerald-500' },
                             { label: 'Total Compensation (TC)', value: marketReport.compensationBreakdown.totalComp, color: 'bg-gradient-to-r from-cyan-400 to-blue-500' }
                           ]}
                         />
                      </div>
                      <div className="w-full md:w-1/3 bg-slate-950/50 p-8 rounded-2xl border border-white/5 flex flex-col justify-center text-center">
                          <span className="text-slate-400 text-sm uppercase font-bold mb-2">Estimated Total Comp</span>
                          <span className="text-5xl font-black text-white tracking-tight">{marketReport.compensationBreakdown.currency} {(marketReport.compensationBreakdown.totalComp / 1000).toFixed(0)}k</span>
                      </div>
                   </div>
                </div>

                {/* Tag Cloud Trends */}
                <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-10">
                   <h3 className="text-purple-400 font-bold uppercase tracking-wider text-sm mb-6">📈 Hiring Trends</h3>
                   <div className="flex flex-wrap gap-3">
                     {marketReport.hiringTrends.map((trend, i) => (
                       <span key={i} className={`px-4 py-2 rounded-lg text-base border ${i % 2 === 0 ? 'bg-purple-900/20 border-purple-500/20 text-purple-200' : 'bg-indigo-900/20 border-indigo-500/20 text-indigo-200'}`}>
                         {trend}
                       </span>
                     ))}
                   </div>
                </div>

                <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-10">
                   <h3 className="text-indigo-400 font-bold uppercase tracking-wider text-sm mb-6">📍 Hot Tech Hubs</h3>
                   <div className="flex flex-wrap gap-3">
                     {marketReport.topTechHubs.map((hub, i) => (
                       <span key={i} className="px-4 py-2 bg-indigo-900/20 border border-indigo-500/20 rounded-lg text-indigo-200 text-base">
                         {hub}
                       </span>
                     ))}
                   </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
};

export default App;