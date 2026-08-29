import React, { useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { TrendingUp, BookOpen, RotateCcw, CheckCircle, Circle } from 'lucide-react';
import { updatePYQ } from '../api';

const STATUS_CONFIG = {
  'Not Started':     { color: '#e5e7eb', textColor: 'text-gray-500', bg: 'bg-gray-100', icon: Circle,       label: 'Not Started' },
  'Studied':         { color: '#818cf8', textColor: 'text-indigo-600', bg: 'bg-indigo-100', icon: BookOpen,  label: 'Studied' },
  'Needs Revision':  { color: '#fb923c', textColor: 'text-orange-600', bg: 'bg-orange-100', icon: RotateCcw, label: 'Needs Revision' },
  'Reviewed':        { color: '#22c55e', textColor: 'text-green-600', bg: 'bg-green-100', icon: CheckCircle, label: 'Reviewed' },
};

function DonutChart({ topics }) {
  const counts = useMemo(() => {
    const c = { 'Not Started': 0, 'Studied': 0, 'Needs Revision': 0, 'Reviewed': 0 };
    topics.forEach(t => { c[t.masteryStatus || 'Not Started']++; });
    return c;
  }, [topics]);

  const total = topics.length;
  const mastered = counts['Reviewed'];
  const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value, color: STATUS_CONFIG[name].color }));

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-48 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.length ? data : [{ name: 'empty', value: 1, color: '#f3f4f6' }]}
              cx="50%" cy="50%"
              innerRadius={55} outerRadius={80}
              dataKey="value" startAngle={90} endAngle={-270}
              strokeWidth={2}
            >
              {(data.length ? data : [{ color: '#f3f4f6' }]).map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v, n) => [`${v} topic${v !== 1 ? 's' : ''}`, n]} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-4xl font-extrabold text-gray-900">{pct}%</span>
          <span className="text-xs font-semibold text-gray-500 mt-0.5">Mastered</span>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
          <div key={status} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
            <span className="text-gray-600">{cfg.label}</span>
            <span className="ml-auto font-bold text-gray-800">{counts[status]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeBarChart({ topics }) {
  const data = useMemo(() => topics.map(t => {
    const totalSeconds = t.matches.reduce((sum, m) => sum + (m.endTime - m.startTime), 0);
    return {
      name: t.topic.length > 14 ? t.topic.slice(0, 14) + '…' : t.topic,
      fullName: t.topic,
      minutes: +(totalSeconds / 60).toFixed(1),
      fill: STATUS_CONFIG[t.masteryStatus || 'Not Started'].color
    };
  }), [topics]);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} angle={-30} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} unit="m" />
        <Tooltip
          formatter={(v, _n, { payload }) => [`${v} min`, payload.fullName]}
          contentStyle={{ borderRadius: '10px', border: '1px solid #e5e7eb', fontSize: 12 }}
        />
        <Bar dataKey="minutes" radius={[6, 6, 0, 0]}>
          {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TopicRow({ topic, index, lectureGroupId, onPYQChange, onMasteryChange }) {
  const cfg = STATUS_CONFIG[topic.masteryStatus || 'Not Started'];
  const Icon = cfg.icon;
  const totalSeconds = topic.matches.reduce((sum, m) => sum + (m.endTime - m.startTime), 0);
  const minutes = (totalSeconds / 60).toFixed(1);
  const pyq = topic.pyqCount || 0;

  const handlePYQ = async (delta) => {
    try {
      const result = await updatePYQ(lectureGroupId || 'no-id', index, delta);
      onPYQChange(index, result.pyqCount);
    } catch (e) {
      console.error('PYQ update failed', e);
      // Optimistic local update as fallback
      onPYQChange(index, Math.max(0, pyq + delta));
    }
  };

  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-xl bg-white/70 backdrop-blur border border-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
      {/* Number */}
      <span className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 shrink-0">
        {index + 1}
      </span>

      {/* Topic name */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900 text-sm truncate font-outfit">{topic.topic}</p>
        <p className="text-xs text-indigo-500 font-medium mt-0.5">{minutes} min coverage</p>
      </div>

      {/* Progress bar */}
      <div className="w-24 hidden sm:block">
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: topic.masteryStatus === 'Reviewed' ? '100%' : topic.masteryStatus === 'Studied' ? '60%' : topic.masteryStatus === 'Needs Revision' ? '30%' : '0%', backgroundColor: cfg.color }}
          />
        </div>
      </div>

      {/* Interactive Status Select */}
      <div className="shrink-0 relative">
        <select 
          value={topic.masteryStatus || 'Not Started'}
          onChange={(e) => onMasteryChange(index, e.target.value)}
          className={`appearance-none outline-none cursor-pointer flex items-center text-xs font-bold pl-7 pr-6 py-1.5 rounded-full border-2 transition-all shadow-sm ${cfg.bg} ${cfg.textColor} border-transparent hover:border-current`}
        >
          {Object.entries(STATUS_CONFIG).map(([status, config]) => (
            <option key={status} value={status}>{config.label}</option>
          ))}
        </select>
        <Icon className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${cfg.textColor} pointer-events-none`} />
        <div className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60 ${cfg.textColor} text-[10px]`}>▼</div>
      </div>

      {/* PYQ counter */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
        <button
          onClick={() => handlePYQ(-1)}
          className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-600 font-bold text-sm transition-colors"
        >−</button>
        <div className="text-center w-6">
          <span className="block text-sm font-bold text-indigo-700 leading-none">{pyq}</span>
        </div>
        <button
          onClick={() => handlePYQ(1)}
          className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 hover:bg-indigo-100 text-gray-600 hover:text-indigo-600 font-bold text-sm transition-colors"
        >+</button>
      </div>
    </div>
  );
}

function Dashboard({ topics, lectureGroupId, onPYQChange, onMasteryChange }) {
  if (!topics || topics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <TrendingUp className="w-16 h-16 mb-4 opacity-30" />
        <p className="text-lg font-semibold">No data yet</p>
        <p className="text-sm mt-1">Generate a timeline first to see your dashboard.</p>
      </div>
    );
  }

  const counts = { 'Not Started': 0, 'Studied': 0, 'Needs Revision': 0, 'Reviewed': 0 };
  topics.forEach(t => { counts[t.masteryStatus || 'Not Started']++; });

  return (
    <div className="space-y-8 py-2">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
          const Icon = cfg.icon;
          return (
            <div key={status} className={`flex flex-col gap-1 p-5 rounded-2xl border border-white bg-white/70 backdrop-blur shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cfg.bg}`}>
                <Icon className={`w-5 h-5 ${cfg.textColor}`} />
              </div>
              <span className="text-3xl font-black text-gray-900 mt-2">{counts[status]}</span>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{cfg.label}</span>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card rounded-2xl p-6 hover:shadow-md transition-shadow">
          <h3 className="font-bold text-gray-800 mb-4 text-base font-outfit">Overall Mastery</h3>
          <DonutChart topics={topics} />
        </div>
        <div className="glass-card rounded-2xl p-6 hover:shadow-md transition-shadow">
          <h3 className="font-bold text-gray-800 mb-2 text-base font-outfit">Time Coverage per Topic</h3>
          <p className="text-xs text-indigo-400 mb-4 font-medium">Estimated from transcript lengths · color = mastery</p>
          <TimeBarChart topics={topics} />
        </div>
      </div>

      {/* Per-topic list */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="font-bold text-gray-800 mb-4 text-base flex items-center gap-2 font-outfit">
          <TrendingUp className="w-5 h-5 text-indigo-500" /> Topic Breakdown
          <span className="ml-auto text-xs font-semibold text-indigo-400 bg-indigo-50 px-3 py-1 rounded-full">+ / − = PYQ frequency</span>
        </h3>
        <div className="space-y-2">
          {topics.map((t, i) => (
            <TopicRow
              key={i}
              topic={t}
              index={i}
              lectureGroupId={lectureGroupId}
              onPYQChange={onPYQChange}
              onMasteryChange={onMasteryChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
