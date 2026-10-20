import React, { useState, useEffect } from 'react';
import { X, BookOpen, Layers, CheckSquare, Printer } from 'lucide-react';
import confetti from 'canvas-confetti';
import { generateAIContent } from '../api';

const MASTERY_NEXT = {
  'Not Started':    'Studied',
  'Studied':        'Needs Revision',
  'Needs Revision': 'Reviewed',
  'Reviewed':       'Not Started',
};
const MASTERY_CFG = {
  'Not Started':   { bg: 'bg-gray-100',   text: 'text-gray-600',   label: '⬜ Not Started' },
  'Studied':       { bg: 'bg-indigo-100', text: 'text-indigo-700', label: '📖 Studied' },
  'Needs Revision':{ bg: 'bg-orange-100', text: 'text-orange-700', label: '🔄 Needs Revision' },
  'Reviewed':      { bg: 'bg-green-100',  text: 'text-green-700',  label: '✅ Reviewed' },
};

function SideDrawer({ isOpen, onClose, topicData, topicIndex, lectureGroupId, onMasteryChange }) {
  const [activeTab, setActiveTab] = useState('examNote');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Flashcard state
  const [activeCard, setActiveCard] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Quiz state
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [quizFinished, setQuizFinished] = useState(false);

  useEffect(() => {
    if (isOpen && topicData) {
      loadContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, topicData]);

  const currentMastery = topicData?.masteryStatus || 'Not Started';

  // When all quiz questions are answered, compute mastery
  useEffect(() => {
    if (!content?.quiz || Object.keys(selectedAnswers).length < content.quiz.length) return;
    if (quizFinished) return;
    setQuizFinished(true);

    const allCorrect = content.quiz.every((q, i) => selectedAnswers[i] === q.correctAnswer);
    const anyWrong = content.quiz.some((q, i) => selectedAnswers[i] !== q.correctAnswer);

    let nextStatus = currentMastery;

    if (allCorrect) {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#818cf8', '#c084fc', '#34d399']
      });
      if (currentMastery !== 'Reviewed') nextStatus = 'Reviewed';
    } else if (anyWrong && (currentMastery === 'Studied' || currentMastery === 'Not Started')) {
      nextStatus = 'Needs Revision';
    } else if (allCorrect && currentMastery === 'Needs Revision') {
      nextStatus = 'Reviewed'; // Though this is redundant because if allCorrect is true, it is handled in the first if block
    }

    if (nextStatus !== currentMastery) {
      onMasteryChange && onMasteryChange(topicIndex, nextStatus);
    }
  }, [selectedAnswers, content, quizFinished, currentMastery]);

  const handleMasteryToggle = () => {
    const next = MASTERY_NEXT[currentMastery];
    onMasteryChange && onMasteryChange(topicIndex, next);
  };

  const loadContent = async () => {
    if (content?.topic === topicData.topic) return;
    if (topicData.examNote) {
      setContent({
        examNote: topicData.examNote,
        flashcards: topicData.flashcards,
        quiz: topicData.quiz,
        difficulty: topicData.difficulty,
        topic: topicData.topic,
        source: 'db',
      });
      return;
    }

    setLoading(true);
    setError('');
    setSelectedAnswers({});
    setQuizFinished(false);

    try {
      const contextText = topicData.matches.map(m => m.context).filter(Boolean).join(' ');
      const data = await generateAIContent(lectureGroupId || 'no-id', topicIndex, topicData.topic, contextText);
      setContent({ ...data, topic: topicData.topic });
      setActiveCard(0);
      setIsFlipped(false);
      
      // Auto-advance to Studied when content is first loaded
      if (currentMastery === 'Not Started') {
        onMasteryChange && onMasteryChange(topicIndex, 'Studied');
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to generate content';
      const isQuotaError = msg.includes('quota') || msg.includes('429');
      setError(isQuotaError ? 'QUOTA_EXHAUSTED' : msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const cfg = MASTERY_CFG[currentMastery];

  return (
    <>
      <div className="fixed inset-0 bg-indigo-900/40 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[500px] bg-white/90 backdrop-blur-xl shadow-2xl z-50 flex flex-col border-l border-white/50">
        {/* Header */}
        <div className="p-4 border-b border-indigo-100/50 flex justify-between items-start bg-indigo-50/50 backdrop-blur">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="text-xl font-bold text-indigo-900 truncate font-outfit">{topicData?.topic}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {content?.difficulty && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  content.difficulty === 'Easy' ? 'bg-green-100 text-green-700' :
                  content.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {content.difficulty}
                </span>
              )}
              {/* Mastery toggle */}
              <button
                onClick={handleMasteryToggle}
                className={`text-xs font-bold px-3 py-0.5 rounded-full transition-all active:scale-95 ${cfg.bg} ${cfg.text} hover:opacity-80`}
                title="Click to cycle mastery status"
              >
                {cfg.label}
              </button>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-indigo-100 rounded-full transition-colors shrink-0">
            <X className="w-6 h-6 text-indigo-700" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-indigo-100/50 bg-white/40 shrink-0">
          <button
            className={`flex-1 py-3 font-medium flex items-center justify-center gap-2 text-sm transition-all ${activeTab === 'examNote' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white/60' : 'text-gray-500 hover:bg-white/40'}`}
            onClick={() => setActiveTab('examNote')}
          >
            <BookOpen className="w-4 h-4" /> Note
          </button>
          <button
            className={`flex-1 py-3 font-medium flex items-center justify-center gap-2 text-sm transition-all ${activeTab === 'flashcards' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white/60' : 'text-gray-500 hover:bg-white/40'}`}
            onClick={() => setActiveTab('flashcards')}
          >
            <Layers className="w-4 h-4" /> Cards
          </button>
          <button
            className={`flex-1 py-3 font-medium flex items-center justify-center gap-2 text-sm transition-all ${activeTab === 'quiz' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white/60' : 'text-gray-500 hover:bg-white/40'}`}
            onClick={() => setActiveTab('quiz')}
          >
            <CheckSquare className="w-4 h-4" /> Quiz
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 bg-transparent relative">
          {loading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-md flex flex-col items-center justify-center z-10 gap-4">
              <svg className="animate-spin h-10 w-10 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="font-semibold text-indigo-900 animate-pulse">Gemini is generating your materials…</p>
            </div>
          )}

          {error && (
            error === 'QUOTA_EXHAUSTED' ? (
              <div className="p-6 bg-amber-50 text-amber-900 rounded-2xl border border-amber-200 flex flex-col items-center gap-3 text-center">
                <span className="text-4xl">📊</span>
                <h3 className="font-bold text-lg">Daily API Quota Reached</h3>
                <p className="text-sm text-amber-800 leading-relaxed">Free tier limit is 20 requests/day. You've used them all for today.</p>
                <div className="w-full bg-amber-100 rounded-xl p-4 text-sm text-left space-y-1">
                  <p>⏰ <strong>Wait</strong> — resets at midnight UTC (5:30 AM IST)</p>
                  <p>💳 <strong>Add billing</strong> — 1,500+ requests/day</p>
                </div>
                <a href="https://aistudio.google.com/app/billing" target="_blank" rel="noopener noreferrer"
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm transition-colors">
                  Set Up Billing →
                </a>
              </div>
            ) : (
              <div className="p-5 bg-red-50 text-red-700 rounded-xl border border-red-200 flex flex-col items-center gap-3 text-center">
                <span className="text-3xl">⚠️</span>
                <p className="font-semibold">Failed to generate content.</p>
                <p className="text-xs text-red-500 break-all">{error}</p>
                <button onClick={() => { setContent(null); setError(''); loadContent(); }}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-colors">
                  🔄 Try Again
                </button>
              </div>
            )
          )}

          {!loading && content && (
            <div className="pb-10">
              {/* ── EXAM NOTE ── */}
              {activeTab === 'examNote' && (
                <div className="space-y-4" id="print-area">
                  <div className="flex justify-between items-start gap-4">
                    <h3 className="text-2xl font-bold text-gray-900 font-outfit">{content.examNote.title}</h3>
                    <button onClick={() => window.print()} className="shrink-0 p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-100 shadow-sm" title="Print/Export Note">
                      <Printer className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-gray-700 leading-relaxed bg-white/70 backdrop-blur p-5 rounded-2xl shadow-sm border border-white text-base">
                    {content.examNote.summary}
                  </p>
                  <h4 className="font-semibold text-indigo-900 flex items-center gap-2 font-outfit mt-6">
                    <CheckSquare className="w-4 h-4 text-indigo-500" /> Key Points
                  </h4>
                  <ul className="space-y-3">
                    {content.examNote.keyPoints.map((pt, i) => (
                      <li key={i} className="flex gap-3 bg-white/70 backdrop-blur p-4 rounded-xl shadow-sm border border-white hover:shadow-md transition-all hover:-translate-y-0.5">
                        <span className="text-indigo-500 font-bold">•</span>
                        <span className="text-gray-800 text-sm leading-relaxed">{pt}</span>
                      </li>
                    ))}
                  </ul>
                  {content.source && (
                    <div className="flex justify-center mt-6">
                      <span className="text-xs px-3 py-1 bg-gray-200 text-gray-600 rounded-full">{content.source}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── FLASHCARDS ── */}
              {activeTab === 'flashcards' && content.flashcards?.length > 0 && (
                <div className="flex flex-col items-center pt-6">
                  <div className="w-full max-w-sm aspect-[4/3] perspective-1000 cursor-pointer group"
                    onClick={() => setIsFlipped(f => !f)}>
                    <div className={`relative w-full h-full transition-transform duration-500 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
                      <div className="absolute inset-0 backface-hidden bg-gradient-to-br from-indigo-500 to-purple-700 rounded-3xl shadow-xl flex items-center justify-center p-8 text-center border-4 border-indigo-400">
                        <p className="text-white text-2xl font-bold leading-tight">{content.flashcards[activeCard].front}</p>
                        <span className="absolute bottom-5 text-indigo-200 text-xs font-semibold uppercase opacity-70 group-hover:opacity-100 transition-opacity">Tap to flip</span>
                      </div>
                      <div className="absolute inset-0 backface-hidden bg-white rounded-3xl shadow-xl flex items-center justify-center p-8 text-center border-4 border-indigo-200 rotate-y-180">
                        <p className="text-gray-800 text-lg font-medium leading-relaxed">{content.flashcards[activeCard].back}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between w-full max-w-sm mt-8">
                    <button disabled={activeCard === 0}
                      onClick={() => { setActiveCard(c => c - 1); setIsFlipped(false); }}
                      className="px-5 py-2 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 rounded-xl font-bold transition-all">
                      ← Prev
                    </button>
                    <span className="font-bold text-gray-500 bg-gray-200 px-4 py-1.5 rounded-full text-sm">
                      {activeCard + 1} / {content.flashcards.length}
                    </span>
                    <button disabled={activeCard === content.flashcards.length - 1}
                      onClick={() => { setActiveCard(c => c + 1); setIsFlipped(false); }}
                      className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 rounded-xl font-bold transition-all">
                      Next →
                    </button>
                  </div>
                </div>
              )}

              {/* ── QUIZ ── */}
              {activeTab === 'quiz' && (
                <div className="space-y-5">
                  {quizFinished && (
                    <div className={`p-3 rounded-xl text-sm font-semibold text-center border ${
                      content.quiz.every((q, i) => selectedAnswers[i] === q.correctAnswer)
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : 'bg-orange-50 border-orange-200 text-orange-800'
                    }`}>
                      {content.quiz.every((q, i) => selectedAnswers[i] === q.correctAnswer)
                        ? `🎉 Perfect score! Mastery → ${currentMastery}`
                        : `🔄 Some answers wrong. Mastery → ${currentMastery}`}
                    </div>
                  )}
                  {content.quiz.map((q, qIdx) => {
                    const answered = selectedAnswers[qIdx] !== undefined;
                    const isCorrect = selectedAnswers[qIdx] === q.correctAnswer;
                    return (
                      <div key={qIdx} className="bg-white/70 backdrop-blur p-5 rounded-2xl shadow-sm border border-white hover:shadow-md transition-all hover:-translate-y-0.5">
                        <h4 className="font-bold text-gray-900 mb-4 flex items-start gap-2 text-sm">
                          <span className="w-5 h-5 shrink-0 flex items-center justify-center bg-indigo-100 text-indigo-700 rounded-full text-xs">{qIdx + 1}</span>
                          {q.question}
                        </h4>
                        <div className="space-y-2">
                          {q.options.map((opt, oIdx) => {
                            const isSelected = selectedAnswers[qIdx] === opt;
                            const isRight = opt === q.correctAnswer;
                            let cls = 'w-full text-left p-3 rounded-xl border-2 transition-all font-medium text-sm ';
                            if (!answered) cls += 'border-gray-100 hover:border-indigo-400 hover:bg-indigo-50';
                            else if (isRight) cls += 'border-green-500 bg-green-50 text-green-900';
                            else if (isSelected) cls += 'border-red-400 bg-red-50 text-red-900';
                            else cls += 'border-gray-100 bg-gray-50 opacity-60';
                            return (
                              <button key={oIdx} disabled={answered}
                                onClick={() => setSelectedAnswers(prev => ({ ...prev, [qIdx]: opt }))}
                                className={cls}>
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                        {answered && (
                          <div className={`mt-4 p-3 rounded-xl text-xs leading-relaxed border-l-4 ${isCorrect ? 'bg-green-50 text-green-800 border-green-500' : 'bg-red-50 text-red-800 border-red-500'}`}>
                            <strong>{isCorrect ? '🎉 Correct!' : '❌ Incorrect.'}</strong> {q.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {quizFinished && (
                    <button
                      onClick={() => { setSelectedAnswers({}); setQuizFinished(false); }}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-colors"
                    >
                      🔁 Retry Quiz
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default SideDrawer;
