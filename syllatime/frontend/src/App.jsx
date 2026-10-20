import React, { useState, useRef, useEffect } from 'react';
import YouTube from 'react-youtube';
import { processLectures, updateMastery } from './api';
import { Play, CheckCircle2, Clock, Sparkles, BarChart2, BookOpen, Circle, RotateCcw, CheckCircle, FolderOpen, Plus } from 'lucide-react';
import SideDrawer from './components/SideDrawer';
import Dashboard from './components/Dashboard';
import HistoryDrawer from './components/HistoryDrawer';

const MASTERY_ICON = {
  'Not Started':    Circle,
  'Studied':        BookOpen,
  'Needs Revision': RotateCcw,
  'Reviewed':       CheckCircle,
};
const MASTERY_STYLE = {
  'Not Started':    'bg-gray-100 text-gray-500',
  'Studied':        'bg-indigo-100 text-indigo-700',
  'Needs Revision': 'bg-orange-100 text-orange-700',
  'Reviewed':       'bg-green-100 text-green-700',
};

// Helper for localStorage
const loadSavedState = (key, defaultVal) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultVal;
  } catch {
    return defaultVal;
  }
};

function App() {
  // Session initialization
  const initialSessions = loadSavedState('syllatime_sessions', []);
  const initialActiveId = loadSavedState('syllatime_activeSessionId', null);
  const activeSess = initialSessions.find(s => s.id === initialActiveId);
  const fallbackId = Date.now().toString();

  const [sessions, setSessions] = useState(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(initialActiveId || fallbackId);

  // Active state
  const [topicsText, setTopicsText] = useState(activeSess?.topicsText ?? 'React Hooks\nState Management\nClass Components\nUseEffect');
  const [urls, setUrls] = useState(activeSess?.urls ?? ['https://www.youtube.com/watch?v=O6P86uwfdR0', '', '']);
  const [activeView, setActiveView] = useState(activeSess?.activeView ?? 'timeline');
  const [lectureData, setLectureData] = useState(activeSess?.lectureData ?? null);
  const [topics, setTopics] = useState(activeSess?.topics ?? []);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeVideoId, setActiveVideoId] = useState(null);

  // Auto-save active state into sessions array
  useEffect(() => {
    if (!activeSessionId) return;
    const firstLine = topicsText.split('\n').map(t => t.trim()).filter(Boolean)[0];
    const sessionName = firstLine ? firstLine : 'Untitled Session';

    setSessions(prev => {
      const exists = prev.find(s => s.id === activeSessionId);
      const newSession = {
        id: activeSessionId,
        name: sessionName,
        lastModified: Date.now(),
        topicsText, urls, activeView, lectureData, topics
      };
      if (exists) return prev.map(s => s.id === activeSessionId ? newSession : s);
      return [...prev, newSession];
    });
  }, [topicsText, urls, activeView, lectureData, topics, activeSessionId]);

  // Sync session array to localStorage
  useEffect(() => {
    localStorage.setItem('syllatime_sessions', JSON.stringify(sessions));
    localStorage.setItem('syllatime_activeSessionId', JSON.stringify(activeSessionId));
  }, [sessions, activeSessionId]);

  // History Drawer state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTopicIndex, setDrawerTopicIndex] = useState(0);

  const playerRef = useRef(null);

  const handleNewSession = () => {
    setTopicsText('New Topic\n');
    setUrls(['', '', '']);
    setActiveView('timeline');
    setLectureData(null);
    setTopics([]);
    setActiveSessionId(Date.now().toString());
  };

  const loadSession = (id) => {
    const sess = sessions.find(s => s.id === id);
    if (sess) {
      setTopicsText(sess.topicsText);
      setUrls(sess.urls);
      setActiveView(sess.activeView);
      setLectureData(sess.lectureData);
      setTopics(sess.topics);
      setActiveSessionId(id);
    }
    setHistoryOpen(false);
  };

  const deleteSession = (id) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) handleNewSession();
  };

  const handleUrlChange = (i, v) => {
    const n = [...urls]; n[i] = v; setUrls(n);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const syllabusTopics = topicsText.split('\n').map(t => t.trim()).filter(Boolean);
    const videoUrls = urls
      .map(u => u.trim().replace(/[<>()[\]'"]+/g, ''))
      .filter(Boolean);

    if (!syllabusTopics.length || !videoUrls.length) {
      setError('Please provide at least one topic and one valid YouTube URL.'); 
      return;
    }
    setLoading(true);
    try {
      const data = await processLectures(syllabusTopics, videoUrls);
      setLectureData(data);
      setTopics(data.topicMatches || []);
      if (data.videos?.length) setActiveVideoId(data.videos[0].videoId);
    } catch (err) {
      const serverError = err.response?.data?.error;
      const details = err.response?.data?.details;
      if (details && Array.isArray(details) && details.length > 0) {
        setError(details.map(d => `${d.videoId ? `[${d.videoId}] ` : ''}${d.error}`).join(' | '));
      } else {
        setError(serverError || err.message || 'An error occurred while generating the timeline.');
      }
    } finally {
      setLoading(false);
    }
  };

  const onPlayerReady = (e) => { playerRef.current = e.target; };

  const playTopic = (videoId, startTime) => {
    if (activeVideoId !== videoId) {
      setActiveVideoId(videoId);
      setTimeout(() => { playerRef.current?.seekTo(startTime, true); playerRef.current?.playVideo(); }, 500);
    } else {
      playerRef.current?.seekTo(startTime, true);
      playerRef.current?.playVideo();
    }
  };

  const openDrawer = (index) => { setDrawerTopicIndex(index); setDrawerOpen(true); };

  const handleMasteryChange = async (index, newStatus) => {
    setTopics(prev => prev.map((t, i) => i === index ? { ...t, masteryStatus: newStatus } : t));
    try {
      await updateMastery(lectureData?._id || 'no-id', index, newStatus);
    } catch (e) {
      console.error('Mastery update failed (optimistic update applied)', e);
    }
  };

  const handlePYQChange = (index, newCount) => {
    setTopics(prev => prev.map((t, i) => i === index ? { ...t, pyqCount: newCount } : t));
  };

  // Calculate global progress
  const totalTopics = topics.length;
  const masteredCount = topics.filter(t => t.masteryStatus === 'Reviewed').length;
  const progressPct = totalTopics > 0 ? Math.round((masteredCount / totalTopics) * 100) : 0;

  return (
    <div className="min-h-screen bg-transparent text-gray-900 pb-12">
      {/* ── HEADER ── */}
      <header className="glass sticky top-0 z-50 border-b border-indigo-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-indigo-900 font-outfit">SyllaTime</h1>
            <p className="text-indigo-600 font-medium text-sm mt-0.5">AI-Powered Syllabus-Aligned Video Lectures</p>
          </div>
          
          <div className="flex items-center gap-4">
            {lectureData && (
              <div className="flex gap-1.5 mr-2 bg-indigo-50/80 backdrop-blur p-1 rounded-xl border border-indigo-100">
                <button onClick={() => setActiveView('timeline')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${activeView === 'timeline' ? 'bg-white text-indigo-700 shadow-sm' : 'text-indigo-500 hover:bg-white/50'}`}>
                  <Clock className="w-4 h-4" /> Timeline
                </button>
                <button onClick={() => setActiveView('dashboard')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${activeView === 'dashboard' ? 'bg-white text-indigo-700 shadow-sm' : 'text-indigo-500 hover:bg-white/50'}`}>
                  <BarChart2 className="w-4 h-4" /> Dashboard
                </button>
              </div>
            )}
            <button onClick={handleNewSession}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl font-bold text-sm shadow-md transition-all hover:scale-105 active:scale-95">
              <Plus className="w-4 h-4" /> New Session
            </button>
            <button onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-white/60 hover:bg-white text-indigo-900 rounded-xl font-bold text-sm shadow-sm transition-all hover:scale-105 active:scale-95 border border-indigo-100">
              <FolderOpen className="w-4 h-4" /> History
            </button>
          </div>
        </div>
        {/* Global Progress Bar underneath header */}
        {lectureData && (
          <div className="w-full bg-indigo-900/40 h-1.5 absolute bottom-0 left-0">
            <div className="h-full bg-green-400 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(74,222,128,0.5)]" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto mt-8 px-6">
        {lectureData && (
          <div className="flex items-center justify-between mb-6 glass-card p-4 rounded-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Overall Progress</h3>
                <p className="text-xs text-gray-500">{masteredCount} of {totalTopics} topics fully mastered</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black text-indigo-600">{progressPct}%</span>
            </div>
          </div>
        )}

        {activeView === 'dashboard' && lectureData ? (
          <Dashboard topics={topics} lectureGroupId={lectureData?._id} onPYQChange={handlePYQChange} onMasteryChange={handleMasteryChange} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* ── FORM ── */}
            <div className="lg:col-span-1 glass-card p-6 rounded-2xl h-fit">
              <h2 className="text-xl font-bold mb-4 text-gray-900 font-outfit">Setup Your Study Plan</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-gray-700">Syllabus Topics <span className="text-gray-400 font-normal">(one per line)</span></label>
                    <button type="button" onClick={() => setTopicsText(topicsText.split(/[,;]/).map(s => s.trim()).filter(s => s).join('\n'))} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md transition-colors">
                      <Sparkles className="w-3 h-3" /> Auto-Format
                    </button>
                  </div>
                  <textarea
                    className="w-full border border-gray-200/60 bg-white/50 backdrop-blur-sm rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none transition-all focus:bg-white"
                    rows="6" value={topicsText}
                    onChange={e => setTopicsText(e.target.value)}
                    placeholder="e.g. Intro to Biology&#10;Cell Structure"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lecture Videos <span className="text-gray-400 font-normal">(YouTube URLs)</span></label>
                  {urls.map((url, i) => (
                    <input key={i} type="text"
                      className="w-full border border-gray-200/60 bg-white/50 backdrop-blur-sm rounded-xl p-2.5 text-sm mb-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all focus:bg-white"
                      placeholder={i === 0 ? "Primary YouTube URL" : "Optional — add another lecture covering the same topics"} value={url}
                      onChange={e => handleUrlChange(i, e.target.value)}
                    />
                  ))}
                </div>
                {error && <div className="text-red-600 text-sm p-3 bg-red-50 rounded-xl border border-red-100">{error}</div>}
                <button type="submit" disabled={loading}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-70 flex justify-center items-center gap-2 shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:-translate-y-0.5 active:translate-y-0">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Processing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" /> Generate Timeline
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* ── PLAYER + TIMELINE ── */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              {activeVideoId ? (
                <div className="bg-black rounded-2xl overflow-hidden aspect-video shadow-lg relative">
                  <YouTube videoId={activeVideoId}
                    opts={{ width: '100%', height: '100%', playerVars: { autoplay: 1 } }}
                    className="absolute inset-0 w-full h-full"
                    onReady={onPlayerReady} />
                </div>
              ) : (
                <div className="bg-gray-100 rounded-2xl aspect-video flex flex-col items-center justify-center border-2 border-dashed border-gray-300">
                  <Play className="w-12 h-12 text-gray-400 mb-2" />
                  <p className="text-gray-500 font-medium">Video player will appear here</p>
                </div>
              )}

              {lectureData && (
                <div className="glass-card p-6 rounded-2xl">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-900 font-outfit">
                    <Clock className="w-5 h-5 text-indigo-500" /> Interactive Timeline
                  </h2>
                  <div className="space-y-5">
                    {topics.map((t, index) => {
                      const status = t.masteryStatus || 'Not Started';
                      const MasIcon = MASTERY_ICON[status];
                      const masStyle = MASTERY_STYLE[status];
                      return (
                        <div key={index} className="flex gap-4 group">
                          <div className="flex flex-col items-center pt-2">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-indigo-200 bg-indigo-50 text-indigo-700 font-bold text-sm shrink-0">
                              {index + 1}
                            </div>
                            {index !== topics.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 mt-2" />}
                          </div>
                          <div className="flex-1 bg-white/70 backdrop-blur p-5 rounded-2xl border border-white shadow-sm hover:border-indigo-300 transition-all hover:shadow-md hover:-translate-y-0.5">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <h3 className="font-bold text-gray-900 text-lg truncate font-outfit">{t.topic}</h3>
                                {t.matches.length > 0 && (
                                  <span className="shrink-0 bg-green-100 text-green-700 text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Match Found
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                {/* Interactive Mastery Dropdown */}
                                <div className="relative">
                                  <select 
                                    value={status}
                                    onChange={(e) => handleMasteryChange(index, e.target.value)}
                                    className={`appearance-none outline-none cursor-pointer flex items-center text-xs font-bold pl-7 pr-6 py-1.5 rounded-full border-2 transition-all shadow-sm ${masStyle} border-transparent hover:border-current`}
                                  >
                                    {Object.keys(MASTERY_STYLE).map((s) => (
                                      <option key={s} value={s}>{s}</option>
                                    ))}
                                  </select>
                                  <MasIcon className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none`} />
                                  <div className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60 text-[10px]`}>▼</div>
                                </div>
                                {t.matches.length > 0 && (
                                  <button onClick={() => openDrawer(index)}
                                    className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs px-3.5 py-1.5 rounded-full font-bold shadow transition-all active:scale-95">
                                    <Sparkles className="w-3.5 h-3.5" /> AI Materials
                                  </button>
                                )}
                              </div>
                            </div>
                            {t.matches.length === 0 ? (
                              <p className="text-sm text-gray-400 italic mt-2">No matches found in provided videos.</p>
                            ) : (
                              <div className="space-y-2 mt-4">
                                {t.matches.map((match, mIdx) => (
                                  <div key={mIdx} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-xl border border-gray-100">
                                    <span className="text-sm font-semibold text-indigo-600">
                                      {Math.floor(match.startTime / 60)}:{String(Math.floor(match.startTime % 60)).padStart(2, '0')} –
                                      {Math.floor(match.endTime / 60)}:{String(Math.floor(match.endTime % 60)).padStart(2, '0')}
                                    </span>
                                    <button onClick={() => playTopic(match.videoId, match.startTime)}
                                      className="flex items-center gap-1.5 bg-indigo-100 hover:bg-indigo-600 hover:text-white text-indigo-700 text-xs px-4 py-1.5 rounded-lg font-bold transition-colors shadow-sm">
                                      <Play className="w-3.5 h-3.5" /> Seek
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <SideDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        topicData={topics[drawerTopicIndex]}
        topicIndex={drawerTopicIndex}
        lectureGroupId={lectureData?._id}
        onMasteryChange={handleMasteryChange}
      />

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onLoadSession={loadSession}
        onDeleteSession={deleteSession}
      />
    </div>
  );
}

export default App;
