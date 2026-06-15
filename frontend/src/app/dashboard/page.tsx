'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  GraduationCap,
  Clock,
  AlertTriangle,
  CalendarDays,
  BookOpen,
  Brain,
  Mic,
  Network,
  Zap,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { StudyClass, StudySession, ConceptMastery } from '@/lib/types';
import { Spotlight } from '@/components/ui/spotlight';
import { CountUp } from '@/components/ui/count-up';

export default function DashboardPage() {
  const [classes, setClasses] = useState<StudyClass[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [weakConcepts, setWeakConcepts] = useState<(ConceptMastery & { class_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [classesRes, sessionsRes, conceptsRes] = await Promise.all([
          supabase.from('classes').select('*').order('created_at', { ascending: false }),
          supabase
            .from('study_sessions')
            .select('*')
            .order('started_at', { ascending: false })
            .limit(10),
          supabase
            .from('concept_mastery')
            .select('*')
            .lt('mastery_level', 0.5)
            .order('mastery_level', { ascending: true })
            .limit(8),
        ]);

        const classData = classesRes.data || [];
        setClasses(classData);
        setSessions(sessionsRes.data || []);

        const conceptData = (conceptsRes.data || []).map((c: ConceptMastery) => ({
          ...c,
          class_name: classData.find((cl: StudyClass) => cl.id === c.class_id)?.name,
        }));
        setWeakConcepts(conceptData);
      } catch {
        // Supabase not configured
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const upcomingExams = classes
    .flatMap((cls) =>
      (cls.exam_dates || []).map((date: string) => ({
        date,
        className: cls.name,
        classId: cls.id,
      }))
    )
    .filter((exam) => new Date(exam.date) >= new Date())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysUntil(dateStr: string) {
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function formatRelativeTime(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const modeLabels: Record<string, string> = {
    quiz: 'Quiz',
    guided_study: 'Guided Study',
    cram: 'Cram',
    language: 'Language',
    strategy: 'Strategy',
    general: 'General',
  };

  if (loading) {
    return (
      <div className="px-3 sm:px-5 py-4 max-w-6xl mx-auto">
        <h1 className="heading-display text-2xl sm:text-3xl mb-5">Dashboard</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-8 rounded w-1/3 mb-2" style={{ background: 'var(--elevated)' }} />
              <div className="h-4 rounded w-2/3" style={{ background: 'var(--elevated)' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Spotlight className="min-h-screen" spotlightColor="rgba(212, 166, 74, 0.03)">
    <div className="px-3 sm:px-5 py-4 max-w-6xl mx-auto">
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="heading-display text-2xl sm:text-3xl mb-2"
      >
        Dashboard
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="text-sm mb-5"
        style={{ color: 'var(--text-muted)' }}
      >
        Your study progress at a glance
      </motion.p>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5 stagger-children">
        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--blue-muted)' }}
            >
              <GraduationCap size={18} style={{ color: 'var(--blue)' }} />
            </div>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Classes</span>
          </div>
          <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}><CountUp end={classes.length} delay={200} /></p>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-muted)' }}
            >
              <Clock size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Sessions</span>
          </div>
          <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}><CountUp end={sessions.length} delay={300} /></p>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--red-muted)' }}
            >
              <AlertTriangle size={18} style={{ color: 'var(--red)' }} />
            </div>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Weak Topics</span>
          </div>
          <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}><CountUp end={weakConcepts.length} delay={400} /></p>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--green-muted)' }}
            >
              <CalendarDays size={18} style={{ color: 'var(--green)' }} />
            </div>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Upcoming Exams</span>
          </div>
          <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}><CountUp end={upcomingExams.length} delay={500} /></p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mb-5 stagger-children">
        {/* Recent Sessions */}
        <div className="card lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} style={{ color: 'var(--text-muted)' }} />
            <h2 className="heading-section text-base">Recent Sessions</h2>
          </div>
          {sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.slice(0, 5).map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between py-2 last:border-0"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{
                        background:
                          session.tool === 'thought_plot'
                            ? 'var(--accent-muted)'
                            : 'var(--blue-muted)',
                      }}
                    >
                      {session.tool === 'thought_plot' ? (
                        <Network size={14} style={{ color: 'var(--accent)' }} />
                      ) : (
                        <Mic size={14} style={{ color: 'var(--blue)' }} />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {modeLabels[session.mode] || session.mode}
                      </p>
                      {session.topic && (
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{session.topic}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {formatRelativeTime(session.started_at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
              No sessions yet. Start studying to see your history.
            </p>
          )}
        </div>

        {/* Upcoming Exams */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays size={18} style={{ color: 'var(--text-muted)' }} />
            <h2 className="heading-section text-base">Upcoming Exams</h2>
          </div>
          {upcomingExams.length > 0 ? (
            <div className="space-y-3">
              {upcomingExams.map((exam, i) => {
                const days = daysUntil(exam.date);
                return (
                  <Link
                    key={i}
                    href={`/classes/${exam.classId}`}
                    className="flex items-center justify-between py-2 -mx-2 px-2 rounded-lg transition-colors"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {exam.className}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {formatDate(exam.date)}
                      </p>
                    </div>
                    <span
                      className="text-xs font-medium px-2 py-1 rounded-full"
                      style={{
                        background:
                          days <= 3
                            ? 'var(--red-muted)'
                            : days <= 7
                            ? 'var(--amber-muted)'
                            : 'var(--green-muted)',
                        color:
                          days <= 3
                            ? 'var(--red)'
                            : days <= 7
                            ? 'var(--amber)'
                            : 'var(--green)',
                      }}
                    >
                      {days}d
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
              No upcoming exams.
            </p>
          )}
        </div>
      </div>

      {/* Weak Topics */}
      <div className="card mb-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} style={{ color: 'var(--text-muted)' }} />
          <h2 className="heading-section text-base">Weak Topics</h2>
          <span className="text-xs ml-auto" style={{ color: 'var(--text-faint)' }}>
            Topics below 50% mastery
          </span>
        </div>
        {weakConcepts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {weakConcepts.map((concept) => (
              <div
                key={concept.id}
                className="p-3 rounded-lg"
                style={{
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg)',
                }}
              >
                <p className="text-sm font-medium mb-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {concept.concept}
                </p>
                {concept.class_name && (
                  <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>
                    {concept.class_name}
                  </p>
                )}
                <div className="mastery-bar">
                  <div
                    className={`fill ${
                      concept.mastery_level < 0.25 ? 'low' : 'medium'
                    }`}
                    style={{ width: `${Math.round(concept.mastery_level * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {Math.round(concept.mastery_level * 100)}%
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {concept.times_correct}/{concept.times_tested}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
            No weak topics tracked yet. Complete quizzes to see your mastery.
          </p>
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="heading-section mb-4 flex items-center gap-2">
          <Zap size={18} style={{ color: 'var(--amber)' }} />
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 stagger-children">
          <Link href="/study-buddy?mode=quiz" className="card card-interactive text-center py-5">
            <Brain size={24} style={{ color: 'var(--blue)' }} className="mx-auto mb-2" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Start Quiz</p>
          </Link>
          <Link
            href="/study-buddy?mode=guided_study"
            className="card card-interactive text-center py-5"
          >
            <BookOpen size={24} style={{ color: 'var(--accent)' }} className="mx-auto mb-2" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Guided Study</p>
          </Link>
          <Link href="/study-buddy?mode=cram" className="card card-interactive text-center py-5">
            <Zap size={24} style={{ color: 'var(--red)' }} className="mx-auto mb-2" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Cram Session</p>
          </Link>
          <Link href="/thought-plot" className="card card-interactive text-center py-5">
            <Network size={24} style={{ color: 'var(--green)' }} className="mx-auto mb-2" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Map Thoughts</p>
          </Link>
        </div>
      </div>
    </div>
    </Spotlight>
  );
}
