import React, { useState, useEffect } from 'react';
import { X, Key, ShieldCheck, Server, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { setBreezeSession } from '../services/apiService';

interface BreezeTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BreezeTokenModal: React.FC<BreezeTokenModalProps> = ({ isOpen, onClose }) => {
  const [apiSession, setApiSession] = useState('');
  const [proxyKey, setProxyKey] = useState('');
  const [proxyUrl, setProxyUrl] = useState('https://maia-breeze-proxy-service-919207294606.us-central1.run.app');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setProxyKey(localStorage.getItem('breeze_proxy_key') || '');
      const savedUrl = localStorage.getItem('breeze_proxy_url');
      if (savedUrl) setProxyUrl(savedUrl);
      setStatus('idle');
      setMessage('');
    }
  }, [isOpen]);

  const handleSave = async () => {
    setStatus('loading');
    setMessage('');
    try {
      localStorage.setItem('breeze_proxy_key', proxyKey);
      localStorage.setItem('breeze_proxy_url', proxyUrl);
      if (apiSession) {
        await setBreezeSession(apiSession, proxyKey);
        setMessage('Session successfully activated!');
      } else {
        setMessage('Configuration saved.');
      }
      setStatus('success');
      setTimeout(() => {
        onClose();
        setStatus('idle');
        setApiSession('');
      }, 1500);
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || 'Failed to activate session');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-200 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
              <Key className="w-4 h-4 text-indigo-600" />
            </div>
            <h3 className="font-semibold text-gray-900">Breeze API Gateway</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Session token */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Daily API Session Token</label>
            <input
              type="text"
              value={apiSession}
              onChange={e => setApiSession(e.target.value)}
              placeholder="Enter today's session token…"
              className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400 bg-gray-50"
            />
            <p className="text-xs text-gray-400">Obtain from the ICICI Direct login flow.</p>
          </div>

          {/* Gateway config */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <Server className="w-3.5 h-3.5" />
              Gateway Configuration
            </div>
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-600">Proxy URL</label>
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={e => setProxyUrl(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs font-mono bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-600">Admin Key</label>
                <input
                  type="password"
                  value={proxyKey}
                  onChange={e => setProxyKey(e.target.value)}
                  placeholder="X-Proxy-Admin-Key"
                  className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs font-mono bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          {/* Status message */}
          {message && (
            <div className={`flex items-center gap-2.5 p-3.5 rounded-xl text-sm font-medium ${
              status === 'error'
                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}>
              {status === 'error'
                ? <AlertCircle className="w-4 h-4 flex-shrink-0" />
                : <CheckCircle className="w-4 h-4 flex-shrink-0" />}
              {message}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSave}
            disabled={status === 'loading'}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-colors disabled:opacity-60 flex justify-center items-center gap-2 shadow-sm"
          >
            {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === 'loading' ? 'Activating…' : 'Save & Activate Session'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BreezeTokenModal;
