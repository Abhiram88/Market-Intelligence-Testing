import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { INITIAL_RESEARCH_TASKS } from '../mockData';
import { ResearchTask } from '../types';
import { Database, Play, CheckCircle, Clock, AlertCircle } from 'lucide-react';

const ResearchTab: React.FC = () => {
  const [tasks, setTasks] = useState<ResearchTask[]>(INITIAL_RESEARCH_TASKS);
  const [isProcessing, setIsProcessing] = useState(false);

  const runDeepResearch = () => {
    setIsProcessing(true);
    // Simulate background processing
    setTimeout(() => {
      setTasks(prev => prev.map(t => 
        t.status === 'PENDING' ? { ...t, status: 'COMPLETED', result: 'Analysis complete. Volatility attributed to global cues.' } : t
      ));
      setIsProcessing(false);
    }, 3000);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Historical Research</h2>
          <p className="text-slate-500">Deep-dive analysis of past market volatility events.</p>
        </div>
        <button
          onClick={runDeepResearch}
          disabled={isProcessing}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          <Play className="w-4 h-4 mr-2" />
          {isProcessing ? 'Processing Queue...' : 'Run Deep Research'}
        </button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-slate-500" />
            <CardTitle>Volatile Event Queue</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Analysis Result</th>
                  <th className="px-6 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">{task.date}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        task.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                        task.status === 'PROCESSING' ? 'bg-blue-100 text-blue-800' :
                        task.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {task.status === 'COMPLETED' && <CheckCircle className="w-3 h-3 mr-1" />}
                        {task.status === 'PENDING' && <Clock className="w-3 h-3 mr-1" />}
                        {task.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 max-w-md truncate">
                      {task.result || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <button className="text-indigo-600 hover:text-indigo-900 font-medium text-xs">
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResearchTab;
