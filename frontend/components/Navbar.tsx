import React, { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, BookOpen, FileText, Settings, Menu, X, TrendingUp, Zap, ZapOff, Loader2 } from 'lucide-react';
import { getMarketSessionStatus } from '../services/marketService';
import { checkBreezeHealth } from '../services/apiService';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenSettings: () => void;
  sessionRefreshTrigger?: number;
}

type SessionState = 'checking' | 'active' | 'expired' | 'inactive';

const SESSION_POLL_MS = 5 * 60 * 1000; // re-check every 5 minutes

const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, onOpenSettings, sessionRefreshTrigger }) => {
  const [marketStatus, setMarketStatus] = useState(getMarketSessionStatus());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>('checking');

  // Market status poll
  useEffect(() => {
    const interval = setInterval(() => {
      setMarketStatus(getMarketSessionStatus());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Session health poll
  const refreshSession = useCallback(async () => {
    setSessionState('checking');
    const { session_active, session_valid } = await checkBreezeHealth();
    if (session_valid) setSessionState('active');
    else if (session_active) setSessionState('expired');
    else setSessionState('inactive');
  }, []);

  useEffect(() => {
    refreshSession();
    const interval = setInterval(refreshSession, SESSION_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshSession]);

  // Re-check immediately when a new session is saved (triggered from parent)
  useEffect(() => {
    if (sessionRefreshTrigger) refreshSession();
  }, [sessionRefreshTrigger, refreshSession]);

  const navItems = [
    { id: 'monitor', label: 'Monitor', icon: LayoutDashboard },
    { id: 'research', label: 'Research', icon: BookOpen },
    { id: 'reg30', label: 'Reg 30', icon: FileText },
  ];

  const handleTabClick = (id: string) => {
    setActiveTab(id);
    setMobileOpen(false);
  };

  const sessionBadge = {
    active:   { label: 'Session Active',  dot: 'bg-emerald-500 animate-pulse', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: <Zap className="w-3 h-3" /> },
    expired:  { label: 'Session Expired', dot: 'bg-amber-500',                 cls: 'bg-amber-50 border-amber-200 text-amber-700',   icon: <ZapOff className="w-3 h-3" /> },
    inactive: { label: 'No Session',      dot: 'bg-gray-400',                  cls: 'bg-gray-100 border-gray-200 text-gray-500',     icon: <ZapOff className="w-3 h-3" /> },
    checking: { label: 'Checking…',       dot: 'bg-gray-300',                  cls: 'bg-gray-100 border-gray-200 text-gray-400',     icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  }[sessionState];

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Brand */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-sm tracking-tight hidden sm:block">
              Market Intelligence
            </span>
            <span className="font-bold text-gray-900 text-sm tracking-tight sm:hidden">MAIA</span>
          </div>

          {/* Desktop tabs */}
          <div className="hidden sm:flex items-center gap-1">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => handleTabClick(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Market status */}
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              marketStatus.isOpen
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-gray-100 border-gray-200 text-gray-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${marketStatus.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
              {marketStatus.isOpen ? 'Market Open' : 'Market Closed'}
            </div>

            {/* Breeze session badge — clickable to open settings */}
            <button
              onClick={onOpenSettings}
              title={sessionState === 'active' ? 'Breeze session is live' : 'Click to configure Breeze session'}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors hover:opacity-80 ${sessionBadge.cls}`}
            >
              {sessionBadge.icon}
              {sessionBadge.label}
            </button>

            {/* Settings icon (mobile + desktop fallback) */}
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors sm:hidden"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen(v => !v)}
              className="sm:hidden p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === id
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
          {/* Market status row */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold mt-2 ${
            marketStatus.isOpen ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 bg-gray-50'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${marketStatus.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
            {marketStatus.isOpen ? 'Market Open' : 'Market Closed'}
          </div>
          {/* Session status row */}
          <button
            onClick={() => { onOpenSettings(); setMobileOpen(false); }}
            className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border ${sessionBadge.cls}`}
          >
            {sessionBadge.icon}
            {sessionBadge.label}
          </button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
