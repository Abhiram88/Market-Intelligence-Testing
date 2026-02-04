import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from './ui/Card';
import { 
  Upload, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle, 
  FileText,
  ChevronLeft,
  ChevronRight,
  Search,
  Trash2,
  Bookmark,
  Star
} from 'lucide-react';
import { 
  parseNseCsv, 
  runReg30Analysis, 
  fetchAnalyzedEvents,
  clearReg30History,
  toggleBookmark,
  fetchBookmarkedSymbols,
  reAnalyzeSingleEvent
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
              {['XBRL', 'CorpAction', 'CreditRating'].map((src) => (
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
                    View Scoring Factors
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
                <div className="bg-slate-50 px-4 py-4 border-t border-slate-100 ml-12 mr-4 mb-4 rounded-b-lg animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-widest">Scoring Factors</h4>
                      <ul className="space-y-1">
                        {report.scoring_factors && report.scoring_factors.length > 0 ? (
                          report.scoring_factors.map((factor, idx) => (
                            <li key={idx} className="text-xs text-slate-600 flex items-center">
                              <CheckCircle className="w-3 h-3 mr-2 text-green-500" />
                              {factor}
                            </li>
                          ))
                        ) : (
                          <li className="text-xs text-slate-400 italic">No scoring factors recorded.</li>
                        )}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-widest">Tactical Narrative</h4>
                      {report.event_analysis_text ? (
                        <div className="text-xs text-slate-700 bg-white p-3 rounded border border-slate-200 italic shadow-sm">
                          "{report.event_analysis_text}"
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No tactical narrative generated (Impact &lt; 50).</span>
                      )}
                      {report.extracted_data && (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {Object.entries(report.extracted_data).map(([k, v]) => (
                            v !== null && v !== undefined && (
                              <div key={k} className="flex flex-col">
                                <span className="text-[9px] text-slate-400 uppercase font-bold">{k.replace(/_/g, ' ')}</span>
                                <span className="text-xs font-mono text-slate-700">{String(v)}</span>
                              </div>
                            )
                          ))}
                        </div>
                      )}
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
    </div>
  );
};

export default Reg30Tab;
