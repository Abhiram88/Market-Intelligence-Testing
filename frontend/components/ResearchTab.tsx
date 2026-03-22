import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { ResearchTask } from '../types';
import { Database, Play, CheckCircle, Clock, Loader2, XCircle } from 'lucide-react';

const ResearchTab: React.FC = () => {
  const [tasks, setTasks] = useState<ResearchTask[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const runDeepResearch = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setTasks(prev => prev.map(t =>
        t.status === 'pending' ? { ...t, status: 'completed', result: 'Analysis complete. Volatility attributed to global cues.' } : t
      ));
      setIsProcessing(false);
    }, 3000);
  };

  const statusConfig = {
    completed: { icon: <CheckCircle className="w-3.5 h-3.5" />, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    in_progress: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, className: 'bg-blue-50 text-blue-700 border-blue-200' },
    failed: { icon: <XCircle className="w-3.5 h-3.5" />, className: 'bg-rose-50 text-rose-700 border-rose-200' },
    pending: { icon: <Clock className="w-3.5 h-3.5" />, className: 'bg-amber-50 text-amber-700 border-amber-200' },
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Historical Research</h2>
          <p className="text-sm text-gray-500 mt-0.5">Deep-dive analysis of past market volatility events.</p>
        </div>
        <button
          onClick={runDeepResearch}
          disabled={isProcessing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isProcessing ? 'Processing…' : 'Run Deep Research'}
        </button>
      </div>

      <Card className="rounded-2xl border-gray-200 shadow-sm">
        <CardHeader className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-gray-400" />
            <CardTitle className="text-sm font-semibold text-gray-900">Volatile Event Queue</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="py-16 text-center">
              <Database className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No research tasks queued.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Analysis Result</th>
                    <th className="px-5 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tasks.map((task) => {
                    const cfg = statusConfig[task.status] || statusConfig.pending;
                    return (
                      <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-gray-900 text-xs font-mono">{task.date}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.className}`}>
                            {cfg.icon}
                            {task.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-gray-500 text-xs max-w-xs truncate">
                          {task.result || '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <button className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                            View Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResearchTab;
