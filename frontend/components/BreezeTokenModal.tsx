import React, { useState, useEffect } from 'react';
import { X, Key, ShieldCheck, Server } from 'lucide-react';
import { setBreezeSession } from '../services/apiService';

interface BreezeTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BreezeTokenModal: React.FC<BreezeTokenModalProps> = ({ isOpen, onClose }) => {
  const [apiSession, setApiSession] = useState('');
  const [proxyKey, setProxyKey] = useState('');
  // Pointing to your verified us-central1 endpoint
  const [proxyUrl, setProxyUrl] = useState('https://maia-breeze-proxy-service-919207294606.us-central1.run.app');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Local storage persistence for session settings
      setProxyKey(localStorage.getItem('breeze_proxy_key') || '');
      const savedUrl = localStorage.getItem('breeze_proxy_url');
      if (savedUrl) setProxyUrl(savedUrl);
    }
  }, [isOpen]);

  const handleSave = async () => {
    setStatus('loading');
    setMessage('');

    try {
      // 1. Persist configuration to local storage
      localStorage.setItem('breeze_proxy_key', proxyKey);
      localStorage.setItem('breeze_proxy_url', proxyUrl);


      // 3. Activate the session if a token is provided
      if (apiSession) {
        // This triggers the /admin/api-session endpoint in your proxy
        await setBreezeSession(apiSession, proxyKey);
        setMessage('Session successfully activated!');
      } else {
        setMessage('Configuration saved.');
      }
      
      setStatus('success');
      setTimeout(() => {
        onClose();
        setStatus('idle');
        setApiSession(''); // Clear sensitive token after use
      }, 1500);
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || 'Failed to activate session');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800 flex items-center">
            <Key className="w-4 h-4 mr-2 text-indigo-600" />
            Breeze API Gateway
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Daily API Session Token</label>
            <input
              type="text"
              value={apiSession}
              onChange={(e) => setApiSession(e.target.value)}
              placeholder="Enter today's session token..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">Obtain this from the ICICI Direct login flow.</p>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-900 mb-3 flex items-center">
              <Server className="w-3 h-3 mr-1" /> Gateway Configuration
            </h4>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Proxy URL (us-central1)</label>
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Proxy Admin Key</label>
                <input
                  type="password"
                  value={proxyKey}
                  onChange={(e) => setProxyKey(e.target.value)}
                  placeholder="X-Proxy-Admin-Key"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-slate-50"
                />
              </div>
            </div>
          </div>

          {message && (
            <div className={`p-3 rounded-lg text-sm flex items-center ${status === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              <ShieldCheck className="w-4 h-4 mr-2" />
              {message}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={status === 'loading'}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center"
          >
            {status === 'loading' ? 'Handshaking...' : 'Save & Activate Session'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BreezeTokenModal;