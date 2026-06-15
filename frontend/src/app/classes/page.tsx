'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  GraduationCap,
  Plus,
  X,
  BookOpen,
  User,
  BarChart3,
  ArrowRight,
  FileText,
  Upload,
  Calendar,
  Trash2,
  Loader2,
  CheckCircle,
  Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { API_BASE } from '@/lib/api';
import type { StudyClass } from '@/lib/types';

// ─── Subject Autocomplete Data ───

const COMMON_SUBJECTS = [
  'Mathematics', 'Calculus', 'Linear Algebra', 'Statistics', 'Discrete Math',
  'Physics', 'Chemistry', 'Biology', 'Anatomy', 'Biochemistry',
  'Computer Science', 'Data Structures', 'Algorithms', 'Machine Learning', 'Artificial Intelligence',
  'English', 'Literature', 'Creative Writing', 'Composition',
  'History', 'World History', 'US History', 'European History',
  'Psychology', 'Sociology', 'Philosophy', 'Political Science', 'Economics',
  'Business', 'Marketing', 'Finance', 'Accounting', 'Management',
  'Engineering', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering',
  'Art', 'Music', 'Theater', 'Film Studies',
  'Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Arabic',
  'Nursing', 'Pre-Med', 'Kinesiology', 'Public Health',
  'Environmental Science', 'Geology', 'Astronomy',
  'Law', 'Criminal Justice', 'International Relations',
];

const GRADE_LEVELS = [
  { value: 'freshman', label: 'Freshman' },
  { value: 'sophomore', label: 'Sophomore' },
  { value: 'junior', label: 'Junior' },
  { value: 'senior', label: 'Senior' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'phd', label: 'PhD' },
  { value: 'high_school', label: 'High School' },
  { value: 'other', label: 'Other' },
];

const DIFFICULTY_LEVELS = [
  { value: 'beginner', label: 'Introductory', desc: '100-level, no prereqs' },
  { value: 'intermediate', label: 'Intermediate', desc: '200-300 level' },
  { value: 'advanced', label: 'Advanced', desc: '400+ level, specialized' },
];

// ─── Form Types ───

interface ClassFormData {
  name: string;
  subject: string;
  teacher: string;
  description: string;
  difficulty_level: string;
  grade_level: string;
  language: string;
  exam_dates: string[];
}

const initialFormData: ClassFormData = {
  name: '',
  subject: '',
  teacher: '',
  description: '',
  difficulty_level: 'intermediate',
  grade_level: '',
  language: '',
  exam_dates: [],
};

export default function ClassesPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<StudyClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<ClassFormData>(initialFormData);
  const [error, setError] = useState('');
  const [formStep, setFormStep] = useState<'details' | 'materials'>('details');

  // Subject autocomplete
  const [subjectQuery, setSubjectQuery] = useState('');
  const [showSubjectSuggestions, setShowSubjectSuggestions] = useState(false);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  // Material upload in modal
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Exam date input
  const [newExamDate, setNewExamDate] = useState('');
  const [newExamLabel, setNewExamLabel] = useState('');

  useEffect(() => { fetchClasses(); }, []);

  async function fetchClasses() {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setClasses(data || []);
    } catch {
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredSubjects = subjectQuery.length > 0
    ? COMMON_SUBJECTS.filter(s => s.toLowerCase().includes(subjectQuery.toLowerCase())).slice(0, 8)
    : [];

  function updateField<K extends keyof ClassFormData>(field: K, value: ClassFormData[K]) {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === 'subject') {
      setSubjectQuery(value as string);
      setShowSubjectSuggestions(true);
    }
  }

  function addExamDate() {
    if (!newExamDate) return;
    const label = newExamLabel.trim() || 'Exam';
    setFormData(prev => ({
      ...prev,
      exam_dates: [...prev.exam_dates, `${newExamDate}|${label}`],
    }));
    setNewExamDate('');
    setNewExamLabel('');
  }

  function removeExamDate(index: number) {
    setFormData(prev => ({
      ...prev,
      exam_dates: prev.exam_dates.filter((_, i) => i !== index),
    }));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setPendingFiles(prev => [...prev, ...files]);
    e.target.value = '';
  }

  function removePendingFile(index: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');

    if (!formData.name.trim() || !formData.subject.trim()) {
      setError('Class name and subject are required.');
      return;
    }

    setSaving(true);

    try {
      // Create class in Supabase
      const { data, error: insertError } = await supabase
        .from('classes')
        .insert({
          name: formData.name.trim(),
          subject: formData.subject.trim(),
          teacher: formData.teacher.trim() || null,
          description: formData.description.trim() || null,
          difficulty_level: formData.difficulty_level || null,
          language: formData.language.trim() || null,
          exam_dates: formData.exam_dates,
          settings: {
            grade_level: formData.grade_level || null,
          },
        })
        .select()
        .single();

      if (insertError) throw insertError;
      const classId = data.id;

      // Upload pending files if any
      if (pendingFiles.length > 0) {
        setUploadingFiles(true);
        setUploadedCount(0);
        for (const file of pendingFiles) {
          try {
            const fd = new FormData();
            fd.append('class_id', classId);
            fd.append('title', file.name);
            fd.append('type', 'pdf');
            fd.append('file', file);
            await fetch(`${API_BASE}/api/upload-material`, { method: 'POST', body: fd });
            setUploadedCount(prev => prev + 1);
          } catch {
            // Continue with remaining files
          }
        }
        setUploadingFiles(false);
      }

      // Reset and navigate
      setFormData(initialFormData);
      setPendingFiles([]);
      setShowForm(false);
      setFormStep('details');
      router.push(`/classes/${classId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create class.');
    } finally {
      setSaving(false);
    }
  }

  function closeModal() {
    setShowForm(false);
    setFormData(initialFormData);
    setPendingFiles([]);
    setError('');
    setFormStep('details');
  }

  // ─── Class Card Helper ───

  function getGradeLabel(cls: StudyClass) {
    const gl = (cls.settings as Record<string, unknown>)?.grade_level as string;
    return GRADE_LEVELS.find(g => g.value === gl)?.label || '';
  }

  function getDifficultyLabel(cls: StudyClass) {
    return DIFFICULTY_LEVELS.find(d => d.value === cls.difficulty_level)?.label || '';
  }

  return (
    <div className="px-3 sm:px-5 py-4 max-w-6xl mx-auto animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="min-w-0">
          <h1 className="heading-display text-2xl sm:text-3xl">Classes</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Manage your courses, materials, and deadlines
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus size={18} />
          Add Class
        </button>
      </div>

      {/* ═══ Add Class Modal ═══ */}
      {showForm && (
        <>
          {/* Backdrop — covers entire viewport including sidebar */}
          <div
            className="fixed inset-0"
            style={{ zIndex: 9999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
            onClick={closeModal}
          />

          {/* Modal container — absolutely centered in viewport */}
          <div
            className="fixed inset-0 flex items-center justify-center p-4 sm:p-6"
            style={{ zIndex: 10000, pointerEvents: 'none' }}
          >
            <div
              className="w-full max-w-[600px] rounded-2xl overflow-hidden animate-fade-up"
              style={{
                pointerEvents: 'auto',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 0 0 1px rgba(212,166,74,0.08), 0 25px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4)',
                maxHeight: 'min(85vh, 680px)',
                display: 'flex',
                flexDirection: 'column',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Modal Header ── */}
              <div
                className="flex items-center justify-between px-5 sm:px-6 py-4 flex-shrink-0"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0"
                    style={{ background: 'var(--accent-muted)' }}
                  >
                    <GraduationCap size={18} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                      {formStep === 'details' ? 'Create New Class' : 'Add Materials'}
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {formStep === 'details' ? 'Step 1 of 2 — Course details' : 'Step 2 of 2 — Upload files (optional)'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeModal}
                  className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer"
                  style={{ color: 'var(--text-muted)', background: 'var(--elevated)' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* ── Step indicator bar ── */}
              <div className="flex-shrink-0 h-1" style={{ background: 'var(--bg)' }}>
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: formStep === 'details' ? '50%' : '100%',
                    background: 'linear-gradient(90deg, var(--accent), #b8923d)',
                    borderRadius: '0 2px 2px 0',
                  }}
                />
              </div>

              {/* ── Modal Body (scrollable) ── */}
              <div className="overflow-y-auto flex-1 min-h-0">
                {error && (
                  <div className="mx-5 sm:mx-6 mt-4 p-3 rounded-lg text-sm" style={{ background: 'var(--red-muted)', border: '1px solid rgba(204, 80, 64, 0.2)', color: 'var(--red)' }}>
                    {error}
                  </div>
                )}

                {formStep === 'details' ? (
                  <form onSubmit={(e) => { e.preventDefault(); setFormStep('materials'); }} className="p-5 sm:p-6 space-y-4">
                    {/* Name + Subject */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                          Class Name <span style={{ color: 'var(--red)' }}>*</span>
                        </label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. Introduction to Psychology"
                          value={formData.name}
                          onChange={(e) => updateField('name', e.target.value)}
                          autoFocus
                        />
                      </div>

                      <div className="relative">
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                          Subject <span style={{ color: 'var(--red)' }}>*</span>
                        </label>
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
                          <input
                            ref={subjectInputRef}
                            type="text"
                            className="form-input"
                            style={{ paddingLeft: '2.25rem' }}
                            placeholder="Type to search..."
                            value={formData.subject}
                            onChange={(e) => updateField('subject', e.target.value)}
                            onFocus={() => setShowSubjectSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowSubjectSuggestions(false), 200)}
                          />
                        </div>
                        {showSubjectSuggestions && filteredSubjects.length > 0 && (
                          <div
                            className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden"
                            style={{ background: 'var(--elevated)', border: '1px solid var(--border-subtle)', boxShadow: '0 10px 25px rgba(0,0,0,0.4)' }}
                          >
                            {filteredSubjects.map(s => (
                              <button
                                key={s}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors cursor-pointer"
                                style={{ color: 'var(--text-primary)' }}
                                onMouseDown={() => {
                                  updateField('subject', s);
                                  setShowSubjectSuggestions(false);
                                }}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Grade + Difficulty */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                          Grade Level
                        </label>
                        <select
                          className="form-input"
                          value={formData.grade_level}
                          onChange={(e) => updateField('grade_level', e.target.value)}
                        >
                          <option value="">Select...</option>
                          {GRADE_LEVELS.map(g => (
                            <option key={g.value} value={g.value}>{g.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                          Difficulty
                        </label>
                        <div className="flex gap-1.5">
                          {DIFFICULTY_LEVELS.map(d => (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => updateField('difficulty_level', d.value)}
                              className="flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer"
                              style={{
                                background: formData.difficulty_level === d.value ? 'var(--accent-muted)' : 'transparent',
                                border: `1px solid ${formData.difficulty_level === d.value ? 'rgba(212,166,74,0.3)' : 'var(--border-subtle)'}`,
                                color: formData.difficulty_level === d.value ? 'var(--accent)' : 'var(--text-muted)',
                              }}
                              title={d.desc}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Teacher + Language */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                          Teacher / Professor
                        </label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. Dr. Smith"
                          value={formData.teacher}
                          onChange={(e) => updateField('teacher', e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                          Language <span className="normal-case tracking-normal font-normal" style={{ color: 'var(--text-faint)' }}>(language courses only)</span>
                        </label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. Spanish, French"
                          value={formData.language}
                          onChange={(e) => updateField('language', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        Description
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Brief description of the course..."
                        value={formData.description}
                        onChange={(e) => updateField('description', e.target.value)}
                      />
                    </div>

                    {/* Exam Dates */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        Exam Dates & Deadlines
                      </label>
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="text"
                          className="form-input flex-1"
                          placeholder="Label (e.g. Midterm)"
                          value={newExamLabel}
                          onChange={(e) => setNewExamLabel(e.target.value)}
                        />
                        <input
                          type="date"
                          className="form-input"
                          value={newExamDate}
                          onChange={(e) => setNewExamDate(e.target.value)}
                          style={{ width: '150px' }}
                        />
                        <button
                          type="button"
                          onClick={addExamDate}
                          disabled={!newExamDate}
                          className="p-2 rounded-lg transition-colors cursor-pointer flex-shrink-0"
                          style={{
                            background: newExamDate ? 'var(--accent-muted)' : 'transparent',
                            color: newExamDate ? 'var(--accent)' : 'var(--text-faint)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <Plus size={16} />
                        </button>
                      </div>

                      {formData.exam_dates.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {formData.exam_dates.map((ed, i) => {
                            const [date, label] = ed.split('|');
                            return (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                                style={{ background: 'var(--elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                              >
                                <Calendar size={11} />
                                <span className="font-medium">{label}</span>
                                <span style={{ color: 'var(--text-faint)' }}>{new Date(date + 'T00:00:00').toLocaleDateString()}</span>
                                <button type="button" onClick={() => removeExamDate(i)} className="ml-0.5 hover:opacity-80 cursor-pointer" style={{ color: 'var(--text-faint)' }}>
                                  <X size={12} />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </form>
                ) : (
                  /* ─── Materials Step ─── */
                  <div className="p-5 sm:p-6 space-y-4">
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Upload PDFs, slides, or notes for <strong style={{ color: 'var(--accent)' }}>{formData.name}</strong>. Gideon will use these to quiz you, fact-check, and personalize study sessions.
                    </p>

                    {/* Drop zone */}
                    <div
                      className="rounded-xl p-6 text-center transition-all cursor-pointer"
                      style={{
                        background: 'var(--bg)',
                        border: '2px dashed var(--border)',
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-muted)'; }}
                      onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg)'; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.background = 'var(--bg)';
                        const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
                        setPendingFiles(prev => [...prev, ...files]);
                      }}
                    >
                      <Upload size={28} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
                      <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>
                        Drop PDFs here or click to browse
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        Syllabi, notes, slides, textbook chapters
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                    </div>

                    {/* Pending files list */}
                    {pendingFiles.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                          {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} ready
                        </p>
                        {pendingFiles.map((f, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between px-3 py-2 rounded-lg"
                            style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText size={14} style={{ color: 'var(--accent)' }} />
                              <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                              <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                                {(f.size / 1024 / 1024).toFixed(1)}MB
                              </span>
                            </div>
                            <button onClick={() => removePendingFile(i)} className="p-1 hover:opacity-80 cursor-pointer" style={{ color: 'var(--text-faint)' }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Upload progress */}
                    {uploadingFiles && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--accent-muted)', border: '1px solid rgba(212,166,74,0.2)' }}>
                        <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
                        <span className="text-sm" style={{ color: 'var(--accent)' }}>
                          Uploading & processing... {uploadedCount}/{pendingFiles.length}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Modal Footer (always visible, never scrolls) ── */}
              <div
                className="flex items-center justify-between px-5 sm:px-6 py-3.5 flex-shrink-0"
                style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface)' }}
              >
                {formStep === 'details' ? (
                  <>
                    <button type="button" onClick={closeModal} className="btn-secondary text-sm">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!formData.name.trim() || !formData.subject.trim()) {
                          setError('Class name and subject are required.');
                          return;
                        }
                        setError('');
                        setFormStep('materials');
                      }}
                      className="btn-primary text-sm"
                      disabled={!formData.name.trim() || !formData.subject.trim()}
                    >
                      Next: Add Materials
                      <ArrowRight size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setFormStep('details')} className="btn-secondary text-sm">
                      Back
                    </button>
                    <div className="flex items-center gap-3">
                      {pendingFiles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setPendingFiles([]); handleSubmit(); }}
                          className="text-xs font-medium cursor-pointer"
                          style={{ color: 'var(--text-muted)' }}
                          disabled={saving || uploadingFiles}
                        >
                          Skip files
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSubmit()}
                        className="btn-primary text-sm"
                        disabled={saving || uploadingFiles}
                      >
                        {saving || uploadingFiles ? (
                          <><Loader2 size={14} className="animate-spin" /> Creating...</>
                        ) : pendingFiles.length > 0 ? (
                          <><CheckCircle size={14} /> Create & Upload</>
                        ) : (
                          <>Create Class</>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ Class Grid ═══ */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-5 rounded w-3/4 mb-3" style={{ background: 'var(--elevated)' }} />
              <div className="h-4 rounded w-1/2 mb-4" style={{ background: 'var(--elevated)' }} />
              <div className="h-3 rounded w-full mb-2" style={{ background: 'var(--elevated)' }} />
              <div className="h-3 rounded w-2/3" style={{ background: 'var(--elevated)' }} />
            </div>
          ))}
        </div>
      ) : classes.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 stagger-children">
          {classes.map((cls) => (
            <Link key={cls.id} href={`/classes/${cls.id}`} className="group">
              <div className="card card-interactive h-full flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0" style={{ background: 'var(--blue-muted)' }}>
                    <BookOpen size={18} style={{ color: 'var(--blue)' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-base truncate" style={{ color: 'var(--text-primary)' }}>
                      {cls.name}
                    </h3>
                    <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                      {cls.subject}
                    </p>
                  </div>
                </div>

                {/* Tags row */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {getDifficultyLabel(cls) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                      {getDifficultyLabel(cls)}
                    </span>
                  )}
                  {getGradeLabel(cls) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--blue-muted)', color: 'var(--blue)' }}>
                      {getGradeLabel(cls)}
                    </span>
                  )}
                  {cls.language && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--green-muted)', color: 'var(--green)' }}>
                      {cls.language}
                    </span>
                  )}
                </div>

                {cls.description && (
                  <p className="text-sm mb-3 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                    {cls.description}
                  </p>
                )}

                <div
                  className="flex items-center gap-4 text-xs mt-auto pt-3"
                  style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-faint)' }}
                >
                  {cls.teacher && (
                    <span className="flex items-center gap-1">
                      <User size={12} />
                      {cls.teacher}
                    </span>
                  )}
                  {cls.exam_dates && cls.exam_dates.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {cls.exam_dates.length} deadline{cls.exam_dates.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-sm font-medium mt-3 group-hover:gap-2 transition-all">
                  <span className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                    View Details <ArrowRight size={14} />
                  </span>
                  <span className="flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                    <FileText size={12} />
                    Materials
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card text-center py-16">
          <GraduationCap size={48} className="mx-auto mb-4" style={{ color: 'var(--text-faint)' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No classes yet
          </h3>
          <p className="mb-6 max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Create your first class to start uploading materials and tracking your progress. Gideon will use your materials to personalize quizzes, study sessions, and fact-checking.
          </p>
          <button onClick={() => setShowForm(true)} className="btn-primary inline-flex">
            <Plus size={16} />
            Create Your First Class
          </button>
        </div>
      )}
    </div>
  );
}
