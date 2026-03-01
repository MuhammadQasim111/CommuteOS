import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  PlusCircle, 
  Library, 
  Settings, 
  Play, 
  Clock, 
  ChevronRight, 
  BrainCircuit, 
  Volume2, 
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Trophy,
  Download
} from 'lucide-react';

type Section = {
  heading: string;
  content: string;
  duration_minutes: number;
};

type Quiz = {
  question: string;
  options: string[];
  correct_answer: number;
};

type Podcast = {
  id: string;
  title: string;
  topic: string;
  duration: number;
  level: string;
  mode: string;
  audio_url?: string;
  sections?: Section[];
  quiz?: Quiz[];
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isGenerating, setIsGenerating] = useState(false);
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [selectedPodcast, setSelectedPodcast] = useState<Podcast | null>(null);
  
  // Form State
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(15);
  const [level, setLevel] = useState('Intermediate');
  const [mode, setMode] = useState('Professor');

  useEffect(() => {
    fetchPodcasts();
  }, []);

  const fetchPodcasts = async () => {
    const res = await fetch('/api/podcasts');
    const data = await res.json();
    setPodcasts(data);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, duration, level, mode }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        await fetchPodcasts();
        setActiveTab('library');
      } else {
        alert(data.error || 'Failed to generate podcast. Please try again.');
      }
    } catch (err) {
      console.error(err);
      alert('A network error occurred. Please check your connection.');
    } finally {
      setIsGenerating(false);
    }
  };

  const viewPodcast = async (id: string) => {
    const res = await fetch(`/api/podcasts/${id}`);
    const data = await res.json();
    setSelectedPodcast(data);
  };

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-100 flex flex-col">
        <div className="p-8 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
            <BrainCircuit size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">CommuteOS</h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-2">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => { setActiveTab('dashboard'); setSelectedPodcast(null); }} 
          />
          <NavItem 
            icon={<PlusCircle size={20} />} 
            label="Generate" 
            active={activeTab === 'generate'} 
            onClick={() => { setActiveTab('generate'); setSelectedPodcast(null); }} 
          />
          <NavItem 
            icon={<Library size={20} />} 
            label="Library" 
            active={activeTab === 'library'} 
            onClick={() => { setActiveTab('library'); setSelectedPodcast(null); }} 
          />
          <NavItem 
            icon={<Trophy size={20} />} 
            label="Learning Paths" 
            active={activeTab === 'paths'} 
            onClick={() => { setActiveTab('paths'); setSelectedPodcast(null); }} 
          />
        </nav>

        <div className="p-4 mt-auto">
          <NavItem icon={<Settings size={20} />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-20 bg-white/80 backdrop-blur-md border-bottom border-gray-100 flex items-center justify-between px-8 sticky top-0 z-10">
          <h2 className="text-lg font-semibold capitalize">{selectedPodcast ? 'Player' : activeTab}</h2>
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs">
              JD
            </div>
          </div>
        </header>

        <div className="p-8 max-w-6xl mx-auto">
          <AnimatePresence mode="wait">
            {selectedPodcast ? (
              <PodcastPlayer podcast={selectedPodcast} onBack={() => setSelectedPodcast(null)} />
            ) : (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'dashboard' && <Dashboard podcasts={podcasts} onView={viewPodcast} />}
                {activeTab === 'generate' && (
                  <GenerateForm 
                    topic={topic} setTopic={setTopic}
                    duration={duration} setDuration={setDuration}
                    level={level} setLevel={setLevel}
                    mode={mode} setMode={setMode}
                    onSubmit={handleGenerate}
                    isGenerating={isGenerating}
                  />
                )}
                {activeTab === 'library' && <LibraryView podcasts={podcasts} onView={viewPodcast} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
        active 
          ? 'bg-indigo-50 text-indigo-600 font-medium shadow-sm' 
          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Dashboard({ podcasts, onView }: { podcasts: Podcast[], onView: (id: string) => void }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="Total Learning Time" value="12.4 hrs" icon={<Clock className="text-indigo-600" />} />
        <StatCard label="Podcasts Generated" value={podcasts.length.toString()} icon={<BrainCircuit className="text-emerald-600" />} />
        <StatCard label="Quiz Accuracy" value="88%" icon={<CheckCircle2 className="text-amber-600" />} />
      </div>

      <section>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Recommended for you</h3>
          <button className="text-indigo-600 text-sm font-medium flex items-center gap-1">
            View all <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {podcasts.slice(0, 2).map(p => (
            <PodcastCard key={p.id} podcast={p} onClick={() => onView(p.id)} />
          ))}
          {podcasts.length === 0 && (
            <div className="col-span-2 p-12 border-2 border-dashed border-gray-200 rounded-3xl text-center text-gray-400">
              No podcasts yet. Start by generating one!
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string, value: string, icon: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
      </div>
      <p className="text-gray-500 text-sm mb-1">{label}</p>
      <h4 className="text-2xl font-bold">{value}</h4>
    </div>
  );
}

function PodcastCard({ podcast, onClick }: { podcast: Podcast, onClick: () => void, key?: string }) {
  return (
    <div 
      onClick={onClick}
      className="group bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-6"
    >
      <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
        <Play size={24} fill="currentColor" />
      </div>
      <div className="flex-1">
        <h4 className="font-bold text-lg mb-1 group-hover:text-indigo-600 transition-colors">{podcast.title}</h4>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="flex items-center gap-1"><Clock size={14} /> {podcast.duration}m</span>
          <span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] uppercase font-bold tracking-wider">{podcast.level}</span>
        </div>
      </div>
    </div>
  );
}

function GenerateForm({ 
  topic, setTopic, 
  duration, setDuration, 
  level, setLevel, 
  mode, setMode, 
  onSubmit, 
  isGenerating 
}: any) {
  return (
    <div className="max-w-2xl mx-auto bg-white p-10 rounded-[40px] border border-gray-100 shadow-xl">
      <div className="mb-8">
        <h3 className="text-2xl font-bold mb-2">Create New Session</h3>
        <p className="text-gray-500">Customize your AI-generated learning experience.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-semibold mb-2">Topic</label>
          <input 
            type="text" 
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Quantum Computing, Roman History, React Hooks..."
            className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold mb-2">Commute Duration (min)</label>
            <input 
              type="number" 
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Skill Level</label>
            <select 
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            >
              <option>Beginner</option>
              <option>Intermediate</option>
              <option>Expert</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Learning Mode</label>
          <div className="grid grid-cols-2 gap-3">
            {['Professor', 'Debate', 'Storytelling', 'Socratic'].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 py-3 rounded-xl border-2 transition-all ${
                  mode === m 
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-600 font-medium' 
                    : 'border-gray-100 text-gray-500 hover:border-gray-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <button 
          disabled={isGenerating}
          className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-all"
        >
          {isGenerating ? (
            <>
              <Loader2 className="animate-spin" />
              Generating your podcast...
            </>
          ) : (
            'Generate Podcast'
          )}
        </button>
      </form>
    </div>
  );
}

function LibraryView({ podcasts, onView }: { podcasts: Podcast[], onView: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {podcasts.map(p => (
        <PodcastCard key={p.id} podcast={p} onClick={() => onView(p.id)} />
      ))}
    </div>
  );
}

function PodcastPlayer({ podcast, onBack }: { podcast: Podcast, onBack: () => void }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);

  return (
    <div className="space-y-8">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-indigo-600 font-medium transition-colors">
        <ArrowLeft size={20} /> Back to Library
      </button>

      <div className="bg-white p-10 rounded-[40px] border border-gray-100 shadow-xl">
        <div className="flex flex-col md:flex-row gap-10">
          <div className="w-full md:w-64 h-64 bg-indigo-600 rounded-[32px] flex items-center justify-center text-white shadow-2xl shadow-indigo-200">
            <Volume2 size={80} />
          </div>
          
          <div className="flex-1 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold uppercase tracking-widest">{podcast.mode}</span>
              <span className="px-3 py-1 bg-gray-50 text-gray-500 rounded-full text-xs font-bold uppercase tracking-widest">{podcast.level}</span>
            </div>
            <h3 className="text-4xl font-black mb-4 leading-tight">{podcast.title}</h3>
            <p className="text-gray-500 mb-8 max-w-xl">Topic: {podcast.topic}. This session is tailored for your {podcast.duration} minute commute.</p>
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="w-16 h-16 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
                >
                  {isPlaying ? <div className="flex gap-1"><div className="w-1.5 h-6 bg-white rounded-full animate-pulse"></div><div className="w-1.5 h-6 bg-white rounded-full animate-pulse delay-75"></div></div> : <Play size={28} fill="currentColor" />}
                </button>
                
                {podcast.audio_url && (
                  <a 
                    href={podcast.audio_url} 
                    download={`${podcast.title}.mp3`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-6 py-3 bg-gray-100 text-gray-700 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                  >
                    <Download size={20} />
                    <span>Download MP3</span>
                  </a>
                )}
              </div>
              
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-indigo-600"
                  animate={{ width: isPlaying ? '100%' : '0%' }}
                  transition={{ duration: podcast.duration * 60, ease: "linear" }}
                />
              </div>
              <span className="text-sm font-bold text-gray-400">-{podcast.duration}:00</span>
            </div>
          </div>
        </div>

        {podcast.audio_url && (
          <audio 
            src={podcast.audio_url} 
            autoPlay={isPlaying} 
            onPlay={() => setIsPlaying(true)} 
            onPause={() => setIsPlaying(false)} 
            className="hidden"
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h4 className="text-xl font-bold">Transcript & Outline</h4>
          {podcast.sections?.map((s, i) => (
            <div key={i} className="bg-white p-6 rounded-3xl border border-gray-100">
              <h5 className="font-bold text-indigo-600 mb-2">{s.heading}</h5>
              <p className="text-gray-600 leading-relaxed text-sm">{s.content}</p>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <h4 className="text-xl font-bold">Knowledge Check</h4>
          {!showQuiz ? (
            <div className="bg-indigo-600 p-8 rounded-3xl text-white text-center">
              <BrainCircuit size={48} className="mx-auto mb-4 opacity-50" />
              <h5 className="text-lg font-bold mb-2">Ready for a quiz?</h5>
              <p className="text-indigo-100 text-sm mb-6">Test your knowledge on what you just learned.</p>
              <button 
                onClick={() => setShowQuiz(true)}
                className="w-full py-3 bg-white text-indigo-600 rounded-xl font-bold hover:bg-indigo-50 transition-colors"
              >
                Start Quiz
              </button>
            </div>
          ) : (
            <div className="bg-white p-8 rounded-3xl border border-gray-100">
              {podcast.quiz?.map((q, i) => (
                <div key={i} className="mb-8 last:mb-0">
                  <p className="font-bold mb-4 text-sm">{i + 1}. {q.question}</p>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => (
                      <button key={oi} className="w-full text-left p-3 rounded-xl border border-gray-100 text-xs hover:border-indigo-600 hover:bg-indigo-50 transition-all">
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button 
                onClick={() => setShowQuiz(false)}
                className="w-full mt-6 py-3 bg-indigo-600 text-white rounded-xl font-bold"
              >
                Submit Answers
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
