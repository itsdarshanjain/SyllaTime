import React from 'react';
import { X, Clock, Trash2, BookOpen, Sparkles, FolderOpen } from 'lucide-react';

function HistoryDrawer({ isOpen, onClose, sessions, activeSessionId, onLoadSession, onDeleteSession }) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-indigo-900/40 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[400px] bg-white/90 backdrop-blur-xl shadow-2xl z-50 flex flex-col border-l border-white/50">
        
        {/* Header */}
        <div className="p-5 border-b border-indigo-100/50 bg-indigo-50/50 backdrop-blur flex justify-between items-center">
          <div className="flex items-center gap-2 text-indigo-900">
            <FolderOpen className="w-5 h-5 text-indigo-600" />
            <h2 className="text-xl font-bold font-outfit">Session History</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-transparent">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-indigo-300">
              <Sparkles className="w-10 h-10 mb-2 opacity-50" />
              <p className="font-medium text-sm">No saved sessions yet.</p>
            </div>
          ) : (
            sessions.slice().sort((a, b) => b.lastModified - a.lastModified).map(session => {
              const isActive = session.id === activeSessionId;
              const date = new Date(session.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
              
              // Calculate mastery progress
              const total = session.topics?.length || 0;
              const mastered = session.topics?.filter(t => t.masteryStatus === 'Reviewed').length || 0;
              const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

              return (
                <div key={session.id} 
                  className={`relative p-4 rounded-2xl border transition-all shadow-sm group hover:-translate-y-0.5 ${
                    isActive ? 'bg-indigo-500 text-white border-indigo-400 shadow-indigo-200' : 'bg-white/70 backdrop-blur border-white hover:border-indigo-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div 
                      className="flex-1 min-w-0 cursor-pointer" 
                      onClick={() => !isActive && onLoadSession(session.id)}
                    >
                      <h3 className={`font-bold truncate text-base font-outfit ${isActive ? 'text-white' : 'text-gray-900'}`}>
                        {session.name || 'Untitled Session'}
                      </h3>
                      <div className={`flex items-center gap-3 mt-1 text-xs font-medium ${isActive ? 'text-indigo-100' : 'text-indigo-500'}`}>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {date}</span>
                        <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> {total} topics</span>
                      </div>
                    </div>
                    {isActive && (
                      <span className="shrink-0 bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ml-3 border border-white/30">
                        Active
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {total > 0 && (
                    <div className="mt-4">
                      <div className={`flex justify-between text-xs mb-1 ${isActive ? 'text-indigo-100' : 'text-gray-500'}`}>
                        <span className="font-semibold">Mastery</span>
                        <span className={`font-bold ${isActive ? 'text-white' : 'text-gray-900'}`}>{pct}%</span>
                      </div>
                      <div className={`h-1.5 w-full rounded-full overflow-hidden ${isActive ? 'bg-indigo-400/50' : 'bg-gray-100'}`}>
                        <div className={`h-full rounded-full ${isActive ? 'bg-white' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Actions overlay */}
                  {!isActive && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                      className="absolute top-3 right-3 p-2 bg-white hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-xl shadow-sm border border-gray-100 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                      title="Delete session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

export default HistoryDrawer;
