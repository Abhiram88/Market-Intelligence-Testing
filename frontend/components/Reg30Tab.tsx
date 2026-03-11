import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from './ui/Card';
import { 
  Upload, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  RefreshCw, 
  FileText,
  ChevronLeft,
  ChevronRight,
  Search,
  Trash2,
  Bookmark,
  Star,
  X,
  Link
} from 'lucide-react';
import { 
  parseNseCsv, 
  candidatesFromXbrlUrls,
  runReg30Analysis, 
  fetchAnalyzedEvents,
  clearReg30History,
  toggleBookmark,
  fetchBookmarkedSymbols,
  reAnalyzeSingleEvent,
  regenerateNarrativeOnly
} from '../services/reg30Service';
import { Reg30Report, EventCandidate, Reg30Source } from '../types';

const ROWS_PER_PAGE = 30;

const Reg30Tab: React.FC = () => {
  const [reports, setReports] = useState<Reg30Report[]>([]);
  const [candidates, setCandidates] = useState<EventCandidate[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [minImpact, setMinImpact] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [bookmarkedSymbols, setBookmarkedSymbols] = useState<Set<string>>(new Set());
  const [reAnalyzingId, setReAnalyzingId] = useState<string | null>(null);
  const [generatingNarrativeId, setGeneratingNarrativeId] = useState<string | null>(null);
  const [xbrlModalOpen, setXbrlModalOpen] = useState(false);
  const [xbrlLinksText, setXbrlLinksText] = useState('');
  const [xbrlProcessing, setXbrlProcessing] = useState(false);
  const [xbrlStatus, setXbrlStatus] = useState<string | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    loadHistory();
    loadBookmarks();
  }, []);

  const loadHistory = async () => {
    const data = await fetchAnalyzedEvents(300);
    setReports(data);
  };

  const loadBookmarks = async () => {
    const bookmarks = await fetchBookmarkedSymbols();
    setBookmarkedSymbols(new Set(bookmarks.map(b => b.symbol)));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, source: Reg30Source) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      const newCandidates = parseNseCsv(text, source);
      setCandidates(prev => [...prev, ...newCandidates]);
    };
    reader.readAsText(file);
  };

  const runBatchAnalysis = async () => {
    if (candidates.length === 0) return;
    setIsProcessing(true);
    const total = candidates.length;
    
    try {
      const newReports = await runReg30Analysis(candidates, (id) => {
        const index = candidates.findIndex(c => c.id === id);
        if (index !== -1) {
          const symbol = candidates[index].symbol || 'Unknown';
          setProcessingStatus(`Processing ${symbol} ${index + 1}/${total}`);
        }
      });

      setReports(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const uniqueNew = newReports.filter(r => !existingIds.has(r.id));
        return [...uniqueNew, ...prev];
      });
      
      setCandidates([]);
      setCurrentPage(1);
    } catch (error) {
      console.error("Batch analysis failed:", error);
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const handleXbrlLinksSubmit = async () => {
    const lines = xbrlLinksText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const linkCandidates = candidatesFromXbrlUrls(lines);
    if (linkCandidates.length === 0) return;
    setXbrlProcessing(true);
    setXbrlStatus(`Processing ${linkCandidates.length} link(s)...`);
    try {
      const newReports = await runReg30Analysis(linkCandidates, (id, step) => {
        const idx = linkCandidates.findIndex(c => c.id === id);
        if (idx !== -1) setXbrlStatus(`Link ${idx + 1}/${linkCandidates.length}: ${step}`);
      });
      setReports(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const uniqueNew = newReports.filter(r => !existingIds.has(r.id));
        return [...uniqueNew, ...prev];
      });
      setCurrentPage(1);
      setXbrlLinksText('');
      setXbrlModalOpen(false);
    } catch (err) {
      console.error("XBRL links analysis failed:", err);
      setXbrlStatus(`Error: ${(err as Error)?.message || 'Failed'}`);
    } finally {
      setXbrlProcessing(false);
      setXbrlStatus(null);
    }
  };

  const handleWipeLedger = async () => {
    if (confirm("Are you sure you want to wipe the entire analyzed events ledger?")) {
      await clearReg30History();
      setReports([]);
      setCurrentPage(1);
    }
  };

  const handleToggleBookmark = async (report: Reg30Report) => {
    if (!report.symbol) return;
    const isNowBookmarked = await toggleBookmark(report.symbol, report.company_name);
    setBookmarkedSymbols(prev => {
      const next = new Set(prev);
      if (isNowBookmarked) next.add(report.symbol);
      else next.delete(report.symbol);
      return next;
    });
  };

  const handleReAnalyze = async (report: Reg30Report) => {
    setReAnalyzingId(report.id);
    try {
      const updated = await reAnalyzeSingleEvent(report);
      if (updated) {
        setReports(prev => prev.map(r => r.id === report.id ? updated : r));
      }
    } catch (e) {
      console.error("Re-analysis failed:", e);
    } finally {
      setReAnalyzingId(null);
    }
  };

  const handleRegenerateNarrative = async (report: Reg30Report) => {
    setGeneratingNarrativeId(report.id);
    try {
      const updated = await regenerateNarrativeOnly(report);
      if (updated) {
        setReports(prev => prev.map(r => r.id === report.id ? { ...r, ...updated } : r));
      } else {
        alert("Failed to generate event analysis. Check Gemini quota or document size.");
      }
    } catch (e) {
      console.error("Narrative generation failed:", e);
    } finally {
      setGeneratingNarrativeId(null);
    }
  };

  const filteredReports = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return reports.filter(r => {
      // Robust null/undefined checks to prevent "Cannot read properties of null"
      const symbol = String(r.symbol || '').toLowerCase();
      const company = String(r.company_name || '').toLowerCase();
      const summary = String(r.summary || '').toLowerCase();
      
      const matchesSearch = 
        symbol.includes(term) || 
        company.includes(term) ||
        summary.includes(term);
        
      const matchesImpact = (r.impact_score || 0) >= minImpact;
      return matchesSearch && matchesImpact;
    });
  }, [reports, searchTerm, minImpact]);

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / ROWS_PER_PAGE));
  
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const paginatedReports = useMemo(() => {
    const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
    return filteredReports.slice(startIndex, startIndex + ROWS_PER_PAGE);
  }, [filteredReports, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      setExpandedRow(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const getImpactColor = (score: number) => {
    if (score >= 75) return 'bg-red-500 text-white';
    if (score >= 50) return 'bg-orange-500 text-white';
    if (score >= 25) return 'bg-yellow-500 text-white';
    return 'bg-slate-200 text-slate-600';
  };

  const getDirectionBadge = (dir: string) => {
    if (dir === 'POSITIVE') return <span className="px-2 py-1 rounded text-[10px] font-bold bg-green-100 text-green-700 uppercase">Positive</span>;
    if (dir === 'NEGATIVE') return <span className="px-2 py-1 rounded text-[10px] font-bold bg-red-100 text-red-700 uppercase">Negative</span>;
    return <span className="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 text-slate-600 uppercase">Neutral</span>;
  };

  return (
    <div className="space-y-8 font-sans">
      <div className="flex justify-between items-center">
        <div className="flex space-x-4 text-xs font-bold text-indigo-600 uppercase tracking-wider">
          <span className="text-slate-400">Important NSE Data Links</span>
          <a href="https://www.nseindia.com/companies-listing/corporate-filings-announcements-xbrl" target="_blank" rel="noreferrer" className="hover:underline bg-indigo-50 px-2 py-1 rounded">XBRL Announcements</a>
          <a href="https://www.nseindia.com/companies-listing/corporate-filings-actions" target="_blank" rel="noreferrer" className="hover:underline bg-indigo-50 px-2 py-1 rounded">Corporate Actions</a>
          <a href="https://www.nseindia.com/companies-listing/debt-centralised-database/crd" target="_blank" rel="noreferrer" className="hover:underline bg-indigo-50 px-2 py-1 rounded">Credit Reports</a>
        </div>
        <div className="flex space-x-2">
          <button className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded uppercase hover:bg-indigo-700 transition-colors">Simulation Tool</button>
          <button onClick={handleWipeLedger} className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold rounded uppercase hover:bg-red-700 transition-colors flex items-center">
            <Trash2 className="w-3 h-3 mr-1" /> Wipe Ledger
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-6 uppercase tracking-tight">Daily NSE CSV Analysis</h3>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <button
                type="button"
                onClick={() => setXbrlModalOpen(true)}
                className="border-2 border-dashed border-indigo-200 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-indigo-50 transition-colors h-32"
              >
                <Link className="w-6 h-6 text-indigo-500 mb-2" />
                <span className="text-[10px] font-bold text-indigo-600 uppercase text-center">Add XBRL links</span>
                <span className="text-[9px] text-slate-400 mt-1">One URL per line</span>
              </button>
              {['CorpAction', 'CreditRating'].map((src) => (
                <label key={src} className="border-2 border-dashed border-slate-200 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-colors h-32">
                  <Upload className="w-6 h-6 text-slate-400 mb-2" />
                  <span className="text-[10px] font-bold text-slate-600 uppercase text-center">Upload {src}</span>
                  <span className="text-[9px] text-slate-400 mt-1">CSV ONLY</span>
                  <input type="file" accept=".csv" className="hidden" onChange={(e) => handleFileUpload(e, src as Reg30Source)} />
                </label>
              ))}
            </div>
            <button 
              onClick={runBatchAnalysis}
              disabled={isProcessing || candidates.length === 0}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg uppercase tracking-wide text-sm transition-colors disabled:opacity-50 flex justify-center items-center shadow-md hover:bg-indigo-700"
            >
              {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              {isProcessing ? (processingStatus || 'Processing Pipeline...') : `Run CSV Analysis (${candidates.length} Pending)`}
            </button>
          </CardContent>
        </Card>

        <Card className="bg-[#0a0a12] text-white border-slate-800 shadow-xl">
          <CardContent className="p-8 flex flex-col justify-center h-full">
            <h3 className="text-xl font-bold mb-2 uppercase tracking-tight">Order-Pipeline Live Search</h3>
            <p className="text-slate-400 text-sm mb-8">
              Detect LOA, NTP, L1, and WO events from verified news and RSS channels without manual CSV imports.
            </p>
            <div className="relative">
              <input 
                type="text" 
                placeholder="SEARCH ORDER-PIPELINE EVENTS" 
                className="w-full bg-white text-slate-900 px-4 py-3 rounded-lg font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-center uppercase tracking-widest placeholder:text-slate-400"
              />
            </div>
            <div className="mt-8 flex items-center text-[10px] text-slate-500 font-mono uppercase tracking-widest">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Status: Sync Complete.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-6">
        <div className="flex-1 w-full">
          <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Symbol / Company Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search symbols, companies or keywords..." 
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50 border border-slate-200 rounded pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        <div className="w-full md:w-64">
          <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block flex justify-between">
            <span>Min Impact: {minImpact}</span>
            <span className={`w-2 h-2 rounded-full ${getImpactColor(minImpact).split(' ')[0]}`}></span>
          </label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={minImpact} 
            onChange={(e) => { setMinImpact(Number(e.target.value)); setCurrentPage(1); }}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-4 p-4 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-1">Date</div>
          <div className="col-span-2">Symbol</div>
          <div className="col-span-2">Event Family</div>
          <div className="col-span-4">Summary & Audit Trail</div>
          <div className="col-span-1 text-center">Impact</div>
          <div className="col-span-1 text-center">Direction</div>
          <div className="col-span-1 text-right">Action</div>
        </div>

        <div className="divide-y divide-slate-100">
          {paginatedReports.map((report) => (
            <div key={report.id} className="group hover:bg-slate-50 transition-colors">
              <div className="grid grid-cols-12 gap-4 p-4 items-start">
                <div className="col-span-1 text-xs text-slate-500 font-mono mt-1">{report.event_date}</div>
                <div className="col-span-2">
                  <div className="font-bold text-slate-900 text-sm">{report.symbol || 'N/A'}</div>
                  <div className="text-[10px] text-slate-400 truncate">{report.company_name || 'Unknown Company'}</div>
                </div>
                <div className="col-span-2">
                  <span className="inline-block px-2 py-1 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 uppercase border border-indigo-100">
                    {(report.event_family || 'OTHER').replace('_', ' ')}
                  </span>
                  {report.stage && (
                    <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600 uppercase border border-slate-200">
                      {report.stage}
                    </span>
                  )}
                </div>
                <div className="col-span-4">
                  <p className="text-xs text-slate-700 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all">
                    {report.summary || 'No summary available.'}
                  </p>
                  <button 
                    onClick={() => setExpandedRow(expandedRow === report.id ? null : report.id)}
                    className="mt-2 text-[10px] font-bold text-indigo-600 uppercase flex items-center hover:text-indigo-800"
                  >
                    {expandedRow === report.id ? 'HIDE AUDIT TRAIL' : 'VIEW SCORING FACTORS'}
                    {expandedRow === report.id ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                  </button>
                </div>
                <div className="col-span-1 flex justify-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${getImpactColor(report.impact_score || 0)}`}>
                    {report.impact_score || 0}
                  </div>
                </div>
                <div className="col-span-1 flex justify-center">
                  {getDirectionBadge(report.direction || 'NEUTRAL')}
                </div>
                <div className="col-span-1 flex justify-end space-x-2">
                  <button 
                    onClick={() => handleToggleBookmark(report)}
                    className={`p-1 transition-colors ${bookmarkedSymbols.has(report.symbol || '') ? 'text-yellow-500' : 'text-slate-400 hover:text-yellow-500'}`} 
                    title={bookmarkedSymbols.has(report.symbol || '') ? "Remove from Watchlist" : "Add to Watchlist"}
                  >
                    {bookmarkedSymbols.has(report.symbol || '') ? <Star className="w-4 h-4 fill-current" /> : <Bookmark className="w-4 h-4" />}
                  </button>
                  <button 
                    onClick={() => handleReAnalyze(report)}
                    disabled={reAnalyzingId === report.id}
                    className="p-1 text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-50" 
                    title="Re-Analyze"
                  >
                    <RefreshCw className={`w-4 h-4 ${reAnalyzingId === report.id ? 'animate-spin' : ''}`} />
                  </button>
                  {report.attachment_link && (
                    <a href={report.attachment_link} target="_blank" rel="noreferrer" className="p-1 text-slate-400 hover:text-indigo-600 transition-colors" title="View Source Document">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>

              {expandedRow === report.id && (
                <div className="bg-slate-50/50 animate-in slide-in-from-top-2 border-t border-slate-100">
                  <div className="px-10 py-10 border-l-4 border-indigo-600">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                      {/* Left Column: Scoring & Evidence */}
                      <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div className="space-y-4">
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Scoring Factors</h4>
                          <div className="space-y-2">
                            {report.scoring_factors?.map((f, i) => {
                              const colonIdx = f.indexOf(':');
                              const prefix = colonIdx !== -1 ? f.substring(0, colonIdx) : f;
                              const rest = colonIdx !== -1 ? f.substring(colonIdx + 1) : '';
                              return (
                                <div key={i} className="flex gap-3 text-[11px] font-bold">
                                  <span className={f.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}>{prefix}</span>
                                  <span className="text-slate-600">{rest}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="space-y-4">
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Evidence Extraction</h4>
                          <div className="space-y-3">
                            {(report.event_family === 'ORDER_CONTRACT' || report.event_family === 'ORDER_PIPELINE') && (
                              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-[10px] text-indigo-700 font-black uppercase tracking-wider">
                                Execution timeline: {report.extracted_data?.execution_months || 'N/A'} months
                                {report.extracted_data?.end_date && ` (Ending: ${report.extracted_data.end_date})`}
                              </div>
                            )}
                            {report.evidence_spans?.map((span, i) => (
                              <div key={i} className="p-3 bg-white border border-slate-100 rounded-xl text-[10px] italic text-slate-500 font-medium">"{span}"</div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Right Column: EVENT ANALYSIS PANEL */}
                      <div className="lg:col-span-4 space-y-6">
                        <div className="flex flex-col gap-2">
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Action Recommendation</h4>
                          <p className="text-[12px] font-black text-indigo-600 uppercase tracking-widest">{(report.recommendation || 'TRACK').replace(/_/g, ' ')}</p>
                        </div>

                        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-xl space-y-5 flex flex-col min-h-[300px]">
                          <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                            <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Event Analysis</h4>
                          </div>

                          {report.impact_score >= 50 ? (
                            <div className="space-y-6 animate-in fade-in duration-700 flex flex-col flex-1">
                              <div className="space-y-3 flex-1">
                                {report.event_analysis_text ? (
                                  <div className="space-y-4">
                                    <p className="text-[11px] font-medium text-slate-600 leading-relaxed italic border-l-2 border-indigo-100 pl-4 py-1">
                                      {report.event_analysis_text}
                                    </p>
                                  </div>
                                ) : (
                                  <div className="py-12 flex flex-col items-center gap-4 text-center">
                                    <p className="text-[10px] font-black text-slate-300 uppercase leading-relaxed px-4">Tactical narrative missing.</p>
                                    <button
                                      onClick={() => handleRegenerateNarrative(report)}
                                      disabled={generatingNarrativeId === report.id}
                                      className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
                                    >
                                      {generatingNarrativeId === report.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                                      Generate Analysis
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50">
                                <div className="space-y-1">
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Institutional Risk</p>
                                  <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase inline-block border ${
                                    report.institutional_risk === 'HIGH' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                                    report.institutional_risk === 'MED' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                  }`}>{report.institutional_risk || 'LOW'}</span>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Policy Bias</p>
                                  <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase inline-block border ${
                                    report.policy_bias === 'TAILWIND' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                    report.policy_bias === 'HEADWIND' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                                  }`}>{report.policy_bias || 'NEUTRAL'}</span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center space-y-4 opacity-50 grayscale">
                              <p className="text-[9px] font-black text-slate-400 uppercase leading-relaxed max-w-[180px]">
                                Tactical analysis disabled for events with impact score &lt; 50.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {filteredReports.length === 0 && (
            <div className="p-12 text-center text-slate-400">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">No events found matching your criteria.</p>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <div className="text-xs text-slate-500 font-medium">
              Showing <span className="font-bold text-slate-900">{(currentPage - 1) * ROWS_PER_PAGE + 1}</span> to <span className="font-bold text-slate-900">{Math.min(currentPage * ROWS_PER_PAGE, filteredReports.length)}</span> of <span className="font-bold text-slate-900">{filteredReports.length}</span> results
            </div>
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center space-x-1">
                {[...Array(totalPages)].map((_, i) => {
                  const pageNum = i + 1;
                  if (pageNum === 1 || pageNum === totalPages || (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)) {
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${currentPage === pageNum ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  } else if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                    return <span key={pageNum} className="text-slate-400 text-xs px-1">...</span>;
                  }
                  return null;
                })}
              </div>
              <button 
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* XBRL links modal */}
      {xbrlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !xbrlProcessing && setXbrlModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 uppercase tracking-tight">Add XBRL / iXBRL links</h3>
              <button type="button" onClick={() => !xbrlProcessing && setXbrlModalOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-hidden flex flex-col gap-4">
              <p className="text-sm text-slate-600">
                Paste one NSE iXBRL or XBRL link per line. Each link will be fetched, analyzed with Gemini for impact_score, and saved to the ledger.
              </p>
              <textarea
                value={xbrlLinksText}
                onChange={e => setXbrlLinksText(e.target.value)}
                placeholder={`https://nsearchives.nseindia.com/corporate/ixbrl/ANN_AWARD_BAGGING_144841_05032026193733_iXBRL_WEB.html\nhttps://nsearchives.nseindia.com/corporate/...`}
                className="w-full h-48 p-4 rounded-xl border border-slate-200 font-mono text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                disabled={xbrlProcessing}
              />
              {xbrlStatus && <p className="text-xs font-medium text-slate-500">{xbrlStatus}</p>}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button type="button" onClick={() => !xbrlProcessing && setXbrlModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleXbrlLinksSubmit}
                disabled={xbrlProcessing || !xbrlLinksText.trim()}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm uppercase tracking-wide hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
              >
                {xbrlProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
                {xbrlProcessing ? 'Processing…' : 'Process links'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reg30Tab;
