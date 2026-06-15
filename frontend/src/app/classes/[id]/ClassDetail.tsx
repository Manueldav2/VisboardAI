'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { API_BASE } from '@/lib/api';
import Link from 'next/link';
import {
  ArrowLeft,
  Upload,
  FileText,
  Brain,
  Mic,
  CheckCircle,
  Clock,
  Plus,
  Trash2,
  Play,
  User,
  Globe,
  CalendarDays,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { StudyClass, CourseMaterial, ConceptMastery, StudyMode } from '@/lib/types';

const studyModes: { mode: StudyMode; label: string; description: string }[] = [
  { mode: 'quiz', label: 'Quiz', description: 'Test your knowledge' },
  { mode: 'guided_study', label: 'Guided Study', description: 'Step-by-step learning' },
  { mode: 'cram', label: 'Cram', description: 'Fast review before exams' },
  { mode: 'language', label: 'Language', description: 'Practice in target language' },
  { mode: 'strategy', label: 'Strategy', description: 'Exam strategies & tips' },
  { mode: 'general', label: 'General', description: 'Open conversation' },
];

export default function ClassDetail() {
  const params = useParams();
  const router = useRouter();
  const classId = params.id as string;

  const [studyClass, setStudyClass] = useState<StudyClass | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [concepts, setConcepts] = useState<ConceptMastery[]>([]);
  const [loading, setLoading] = useState(true);

  const [showUpload, setShowUpload] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [materialTitle, setMaterialTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  const [showModeSelector, setShowModeSelector] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [classRes, materialsRes, conceptsRes] = await Promise.all([
        supabase.from('classes').select('*').eq('id', classId).single(),
        supabase
          .from('course_materials')
          .select('*')
          .eq('class_id', classId)
          .order('created_at', { ascending: false }),
        supabase
          .from('concept_mastery')
          .select('*')
          .eq('class_id', classId)
          .order('mastery_level', { ascending: true }),
      ]);

      if (classRes.error) throw classRes.error;
      setStudyClass(classRes.data);
      setMaterials(materialsRes.data || []);
      setConcepts(conceptsRes.data || []);
    } catch {
      // Class not found or Supabase not configured
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleTextUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteText.trim() || !materialTitle.trim()) return;

    setUploading(true);
    try {
      const { data, error } = await supabase
        .from('course_materials')
        .insert({
          class_id: classId,
          title: materialTitle.trim(),
          type: 'text',
          raw_text: pasteText.trim(),
          processed: false,
        })
        .select()
        .single();

      if (error) throw error;
      setMaterials((prev) => [data, ...prev]);
      setPasteText('');
      setMaterialTitle('');
      setShowUpload(false);
    } catch {
      // Handle error
    } finally {
      setUploading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('class_id', classId);
      formData.append('title', file.name);
      formData.append('type', 'pdf');

      const response = await fetch(`${API_BASE}/api/upload-material`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      await response.json();
      const { data: refreshed } = await supabase
        .from('course_materials')
        .select('*')
        .eq('class_id', classId)
        .order('created_at', { ascending: false });
      setMaterials(refreshed || []);
    } catch {
      // Handle error silently for now
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function deleteMaterial(id: string) {
    try {
      await supabase.from('course_materials').delete().eq('id', id);
      setMaterials((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // Handle error
    }
  }

  function startSession(mode: StudyMode) {
    router.push(`/study-buddy?mode=${mode}&class_id=${classId}`);
  }

  function getMasteryColor(level: number) {
    if (level >= 0.8) return 'high';
    if (level >= 0.4) return 'medium';
    return 'low';
  }

  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 rounded w-1/3 mb-4" style={{ background: 'var(--elevated)' }} />
          <div className="h-4 rounded w-1/2 mb-8" style={{ background: 'var(--elevated)' }} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="h-6 rounded w-1/4 mb-4" style={{ background: 'var(--elevated)' }} />
              <div className="h-32 rounded" style={{ background: 'var(--elevated)' }} />
            </div>
            <div className="card">
              <div className="h-6 rounded w-1/4 mb-4" style={{ background: 'var(--elevated)' }} />
              <div className="h-32 rounded" style={{ background: 'var(--elevated)' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!studyClass) {
    return (
      <div className="p-8 max-w-6xl mx-auto text-center py-20">
        <h2 className="heading-section text-xl mb-2">Class not found</h2>
        <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
          This class may have been deleted or does not exist.
        </p>
        <Link href="/classes" className="btn-primary inline-flex">
          <ArrowLeft size={16} />
          Back to Classes
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      {/* Back nav */}
      <Link
        href="/classes"
        className="inline-flex items-center gap-2 text-sm mb-6 transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={16} />
        Back to Classes
      </Link>

      {/* Class Header */}
      <div className="card mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <h1 className="heading-display text-2xl sm:text-3xl mb-1">{studyClass.name}</h1>
            <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
              {studyClass.subject}
            </p>
          </div>
          <button
            onClick={() => setShowModeSelector(true)}
            className="btn-primary flex-shrink-0"
            style={{ minHeight: '44px' }}
          >
            <Play size={16} />
            Start Study Session
          </button>
        </div>

        {studyClass.description && (
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            {studyClass.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: 'var(--text-faint)' }}>
          {studyClass.teacher && (
            <span className="flex items-center gap-1.5">
              <User size={14} />
              {studyClass.teacher}
            </span>
          )}
          {studyClass.language && (
            <span className="flex items-center gap-1.5">
              <Globe size={14} />
              {studyClass.language}
            </span>
          )}
          {studyClass.exam_dates && studyClass.exam_dates.length > 0 && (
            <span className="flex items-center gap-1.5">
              <CalendarDays size={14} />
              {studyClass.exam_dates.length} upcoming exam
              {studyClass.exam_dates.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Mode Selector Modal */}
      {showModeSelector && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        >
          <div className="card w-full max-w-md mx-4">
            <h2 className="heading-section text-xl mb-4">Select Study Mode</h2>
            <div className="space-y-2">
              {studyModes.map(({ mode, label, description }) => (
                <button
                  key={mode}
                  onClick={() => {
                    setShowModeSelector(false);
                    startSession(mode);
                  }}
                  className="w-full text-left p-3 rounded-lg transition-colors"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.background = 'var(--elevated)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {label}
                  </span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                    {description}
                  </p>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowModeSelector(false)}
              className="btn-secondary w-full mt-4"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Materials Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="heading-section text-lg flex items-center gap-2">
              <FileText size={18} style={{ color: 'var(--text-muted)' }} />
              Course Materials
            </h2>
            <button onClick={() => setShowUpload(!showUpload)} className="btn-secondary text-sm">
              <Upload size={14} />
              Upload
            </button>
          </div>

          {/* Upload panel */}
          {showUpload && (
            <div className="card mb-4" style={{ borderColor: 'rgba(106, 155, 204, 0.2)' }}>
              <h3 className="font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                Add Material
              </h3>

              <form onSubmit={handleTextUpload} className="space-y-3 mb-4">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Material title"
                  value={materialTitle}
                  onChange={(e) => setMaterialTitle(e.target.value)}
                />
                <textarea
                  className="form-textarea"
                  placeholder="Paste notes, textbook excerpts, or other text content..."
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={5}
                />
                <button type="submit" className="btn-primary text-sm" disabled={uploading}>
                  {uploading ? 'Saving...' : 'Save Text'}
                </button>
              </form>

              <div className="pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Or upload a PDF:
                </p>
                <label className="btn-secondary text-sm cursor-pointer inline-flex">
                  <Plus size={14} />
                  Choose File
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Materials list */}
          {materials.length > 0 ? (
            <div className="space-y-2">
              {materials.map((material) => (
                <div
                  key={material.id}
                  className="card flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--blue-muted)' }}
                    >
                      <FileText size={14} style={{ color: 'var(--blue)' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {material.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                        <span>{material.type}</span>
                        {material.processed ? (
                          <span className="flex items-center gap-1" style={{ color: 'var(--green)' }}>
                            <CheckCircle size={10} />
                            Processed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1" style={{ color: 'var(--amber)' }}>
                            <Clock size={10} />
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteMaterial(material.id)}
                    className="p-1 transition-colors"
                    style={{ color: 'var(--text-faint)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="card text-center py-8">
              <FileText size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No materials uploaded yet. Add notes or PDFs to enhance your study sessions.
              </p>
            </div>
          )}
        </div>

        {/* Concept Mastery Section */}
        <div>
          <h2 className="heading-section text-lg flex items-center gap-2 mb-4">
            <Brain size={18} style={{ color: 'var(--text-muted)' }} />
            Concept Mastery
          </h2>

          {concepts.length > 0 ? (
            <div className="space-y-2">
              {concepts.map((concept) => (
                <div key={concept.id} className="card py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {concept.concept}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {concept.times_correct}/{concept.times_tested} correct
                    </span>
                  </div>
                  <div className="mastery-bar">
                    <div
                      className={`fill ${getMasteryColor(concept.mastery_level)}`}
                      style={{ width: `${Math.round(concept.mastery_level * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {Math.round(concept.mastery_level * 100)}% mastery
                    </span>
                    {concept.mastery_level < 0.5 && (
                      <button
                        onClick={() => startSession('quiz')}
                        className="text-xs flex items-center gap-1"
                        style={{ color: 'var(--blue)' }}
                      >
                        <Mic size={10} />
                        Practice
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card text-center py-8">
              <Brain size={32} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No concepts tracked yet. Complete quizzes to build your mastery profile.
              </p>
              <button
                onClick={() => startSession('quiz')}
                className="btn-primary text-sm mt-3 inline-flex"
              >
                <Play size={14} />
                Start a Quiz
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
