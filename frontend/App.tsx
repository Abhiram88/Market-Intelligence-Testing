
import React, { useState } from 'react';
import Navbar from './components/Navbar';
import MonitorTab from './components/MonitorTab';
import ResearchTab from './components/ResearchTab';
import Reg30Tab from './components/Reg30Tab';
import BreezeTokenModal from './components/BreezeTokenModal';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('monitor');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      
      <main className="w-full px-4 sm:px-6 lg:px-10 py-8">
        {activeTab === 'monitor' && <MonitorTab />}
        {activeTab === 'research' && <ResearchTab />}
        {activeTab === 'reg30' && <Reg30Tab />}
      </main>

      <BreezeTokenModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </div>
  );
};

export default App;
