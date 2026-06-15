-- Thought Plot Platform Schema
-- Supabase + pgvector

-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- ══════════════════════════════════════════════
-- CLASSES & COURSE MATERIALS
-- ══════════════════════════════════════════════

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  name text not null,
  subject text,
  language text,
  difficulty_level text check (difficulty_level in ('beginner', 'intermediate', 'advanced')),
  teacher text,
  description text,
  exam_dates jsonb default '[]',
  settings jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists course_materials (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  title text not null,
  type text not null check (type in ('pdf', 'image', 'text', 'notes', 'exam', 'textbook', 'slides')),
  original_filename text,
  storage_path text,
  raw_text text,
  processed boolean default false,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references course_materials(id) on delete cascade,
  class_id uuid references classes(id) on delete cascade,
  content text not null,
  chunk_index int not null,
  metadata jsonb default '{}',
  embedding extensions.vector(1536),
  created_at timestamptz default now()
);

-- HNSW index for fast similarity search
create index if not exists material_chunks_embedding_idx
  on material_chunks using hnsw (embedding vector_cosine_ops);

-- ══════════════════════════════════════════════
-- STUDY SESSIONS & MEMORY
-- ══════════════════════════════════════════════

create table if not exists study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  class_id uuid references classes(id) on delete set null,
  mode text not null check (mode in ('quiz', 'guided_study', 'cram', 'language', 'strategy', 'general', 'thought_plot')),
  tool text not null check (tool in ('study_buddy', 'thought_plot', 'architect', 'argument_ref')),
  topic text,
  started_at timestamptz default now(),
  ended_at timestamptz,
  duration_seconds int,
  metadata jsonb default '{}'
);

create table if not exists session_transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references study_sessions(id) on delete cascade,
  speaker text not null check (speaker in ('user', 'ai', 'system')),
  text text not null,
  timestamp_ms bigint not null,
  is_final boolean default true,
  metadata jsonb default '{}'
);

create table if not exists session_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references study_sessions(id) on delete cascade,
  class_id uuid references classes(id) on delete set null,
  summary text not null,
  topics_covered text[] default '{}',
  weak_topics text[] default '{}',
  mastered_topics text[] default '{}',
  key_insights text[] default '{}',
  embedding extensions.vector(1536),
  created_at timestamptz default now()
);

create index if not exists session_summaries_embedding_idx
  on session_summaries using hnsw (embedding vector_cosine_ops);

-- ══════════════════════════════════════════════
-- CONCEPT MASTERY & PROGRESS
-- ══════════════════════════════════════════════

create table if not exists concept_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  class_id uuid references classes(id) on delete cascade,
  concept text not null,
  mastery_level float default 0 check (mastery_level >= 0 and mastery_level <= 1),
  times_tested int default 0,
  times_correct int default 0,
  last_tested_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists vocabulary_progress (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  class_id uuid references classes(id) on delete cascade,
  word text not null,
  translation text,
  language text not null,
  mastery_level float default 0,
  times_tested int default 0,
  times_correct int default 0,
  last_tested_at timestamptz,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════════════
-- STUDENT PROFILES & STUDY PLANS
-- ══════════════════════════════════════════════

create table if not exists student_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default' unique,
  -- Learning preferences (auto-updated by AI)
  learning_style text default 'adaptive',
  preferred_pace text default 'moderate',
  personality_notes text,
  -- Communication preferences
  voice_vs_text_ratio float default 0.5,
  avg_response_length text default 'medium',
  prefers_hints boolean default true,
  prefers_challenges boolean default false,
  engagement_signals jsonb default '{}',
  preferred_study_time text,
  -- Aggregate strengths/weaknesses
  strongest_topics jsonb default '[]',
  weakest_topics jsonb default '[]',
  debate_strengths jsonb default '[]',
  debate_weaknesses jsonb default '[]',
  -- Stats
  study_streak_days int default 0,
  last_study_date date,
  total_study_minutes int default 0,
  total_sessions int default 0,
  -- Session continuity
  last_session_summary text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  class_id uuid references classes(id) on delete cascade,
  plan_type text not null check (plan_type in ('exam_prep', 'weakness_review', 'daily', 'custom')),
  topics jsonb not null default '[]',
  active boolean default true,
  created_at timestamptz default now(),
  expires_at timestamptz
);

-- ══════════════════════════════════════════════
-- THOUGHT PLOT DATA
-- ══════════════════════════════════════════════

create table if not exists thought_plots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references study_sessions(id) on delete cascade,
  class_id uuid references classes(id) on delete set null,
  user_id text not null default 'default',
  title text,
  graph_json jsonb not null,
  summary text,
  mode text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ══════════════════════════════════════════════
-- RPC FUNCTIONS
-- ══════════════════════════════════════════════

-- Similarity search for course material chunks
create or replace function match_material_chunks(
  query_embedding extensions.vector(1536),
  match_class_id uuid,
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    material_chunks.id,
    material_chunks.content,
    material_chunks.metadata,
    1 - (material_chunks.embedding <=> query_embedding) as similarity
  from material_chunks
  where material_chunks.class_id = match_class_id
    and 1 - (material_chunks.embedding <=> query_embedding) > match_threshold
  order by material_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- Similarity search for session summaries (long-term memory)
create or replace function match_session_summaries(
  query_embedding extensions.vector(1536),
  match_user_id text default 'default',
  match_class_id uuid default null,
  match_threshold float default 0.6,
  match_count int default 5
)
returns table (
  id uuid,
  summary text,
  topics_covered text[],
  weak_topics text[],
  similarity float
)
language sql stable
as $$
  select
    session_summaries.id,
    session_summaries.summary,
    session_summaries.topics_covered,
    session_summaries.weak_topics,
    1 - (session_summaries.embedding <=> query_embedding) as similarity
  from session_summaries
  where (match_class_id is null or session_summaries.class_id = match_class_id)
    and 1 - (session_summaries.embedding <=> query_embedding) > match_threshold
  order by session_summaries.embedding <=> query_embedding
  limit match_count;
$$;
