
import React, { useState, useEffect } from 'react';
import { LayoutDashboard, BookOpen, FileText, Settings } from 'lucide-react';
import { getMarketSessionStatus } from '../services/marketService';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenSettings: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, onOpenSettings }) => {
  const [marketStatus, setMarketStatus] = useState(getMarketSessionStatus());

  useEffect(() => {
    const interval = setInterval(() => {
      setMarketStatus(getMarketSessionStatus());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { id: 'monitor', label: 'Monitor', icon: LayoutDashboard },
    { id: 'research', label: 'Research', icon: BookOpen },
    { id: 'reg30', label: 'Reg30', icon: FileText },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="w-full mx-auto px-4 sm:px-6 lg:px-10">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center mr-3">
                <span className="text-white font-bold text-lg">M</span>
              </div>
              <span className="font-bold text-xl text-slate-900 tracking-tight">Intelligence Monitor</span>
            </div>
            <div className="hidden sm:ml-10 sm:flex sm:space-x-8">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-indigo-500 text-slate-900'
                        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mr-2 ${isActive ? 'text-indigo-500' : 'text-slate-400'}`} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center">
            <div className={`flex items-center px-3 py-1 rounded-full border ${
              marketStatus.isOpen 
                ? 'bg-green-50 border-green-200 text-green-700' 
                : 'bg-slate-100 border-slate-200 text-slate-600'
            } mr-4`}>
              <span className={`w-2 h-2 rounded-full mr-2 ${
                marketStatus.isOpen ? 'bg-green-500 animate-pulse' : 'bg-slate-400'
              }`}></span>
              <span className="text-xs font-bold uppercase tracking-wider">{marketStatus.status}</span>
            </div>
            <button 
              onClick={onOpenSettings}
              className="p-2 rounded-full text-slate-400 hover:text-slate-500 hover:bg-slate-100 transition-colors"
              title="API Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
