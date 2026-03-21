import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';

// ── Theme ───────────────────────────────────────────────────
type Theme = 'dark' | 'light';

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
});

const useTheme = () => useContext(ThemeContext);

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('nanoprym-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* */ }
  return 'dark';
}

const colors = {
  dark: {
    bg: '#0a0a0f',
    bgPanel: '#0d0d14',
    bgCard: '#111118',
    text: '#e0e0e0',
    textMuted: '#9ca3af',
    textDim: '#6b7280',
    textDimmer: '#4b5563',
    border: '#1e1e2e',
    borderSubtle: '#111118',
    borderInput: '#27273a',
    accent: '#a78bfa',
    link: '#60a5fa',
    highlight: 'rgba(167, 139, 250, 0.05)',
    highlightStrong: 'rgba(167, 139, 250, 0.1)',
  },
  light: {
    bg: '#f8f9fc',
    bgPanel: '#ffffff',
    bgCard: '#f1f3f8',
    text: '#1a1a2e',
    textMuted: '#4b5563',
    textDim: '#6b7280',
    textDimmer: '#9ca3af',
    border: '#e2e4ea',
    borderSubtle: '#eef0f4',
    borderInput: '#d1d5db',
    accent: '#7c3aed',
    link: '#2563eb',
    highlight: 'rgba(124, 58, 237, 0.05)',
    highlightStrong: 'rgba(124, 58, 237, 0.1)',
  },
};

// ── Types ───────────────────────────────────────────────────
interface EventMessage {
  id: string;
  taskId: string;
  topic: string;
  sender: string;
  text: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  activeTask: boolean;
  sseClients?: number;
  eventCount?: number;
}

interface DependencyStatus {
  name: string;
  state: 'up' | 'down' | 'unknown';
  latencyMs?: number;
  lastChecked: string;
  error?: string;
}

interface DetailedHealth {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  activeTask: boolean;
  system: {
    memoryUsedMb: number;
    memoryTotalMb: number;
    memoryPercent: number;
  };
  dependencies: DependencyStatus[];
}

interface HealthSnapshot {
  id: number;
  status: string;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_percent: number;
  dependencies: string;
  active_task: number;
  recorded_at: string;
}

interface TaskSummary {
  taskId: string;
  title: string;
  description: string;
  complexity: string;
  testsPassed?: number;
  testsFailed?: number;
  taskType: string;
  status: string;
  createdAt: string;
  eventCount: number;
  branch: string;
  repoName?: string;
}

interface RepoInfo {
  name: string;
  repoPath: string;
  repoUrl?: string;
  cloned: boolean;
  createdAt: string;
}

interface TaskDetailData {
  taskId: string;
  title: string;
  description: string;
  complexity: string;
  taskType: string;
  status: string;
  branch: string;
  events: EventMessage[];
  eventCount: number;
}

interface TaskDiffData {
  taskId: string;
  branch: string;
  diff: string;
  files: string[];
}

type TabId = 'events' | 'health' | 'tasks' | 'tools' | 'repos';

// ── Topic Config ────────────────────────────────────────────
const TOPIC_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  ISSUE_OPENED:          { icon: '\u{1F4CB}', color: '#60a5fa', label: 'Issue Opened' },
  PLAN_READY:            { icon: '\u{1F4DD}', color: '#a78bfa', label: 'Plan Ready' },
  IMPLEMENTATION_READY:  { icon: '\u{1F528}', color: '#f59e0b', label: 'Implementation' },
  WORKER_PROGRESS:       { icon: '\u{23F3}',  color: '#facc15', label: 'Progress' },
  VALIDATION_RESULT:     { icon: '\u{2705}',  color: '#34d399', label: 'Validation' },
  SCAN_RESULT:           { icon: '\u{1F50D}', color: '#818cf8', label: 'Scan Result' },
  STATE_SNAPSHOT:        { icon: '\u{1F4F8}', color: '#6b7280', label: 'Snapshot' },
  CLUSTER_COMPLETE:      { icon: '\u{1F3C1}', color: '#22c55e', label: 'Complete' },
  HUMAN_DECISION:        { icon: '\u{1F464}', color: '#f472b6', label: 'Human Decision' },
  AUTO_FIX_APPLIED:      { icon: '\u{1F527}', color: '#fb923c', label: 'Auto Fix' },
  EVOLUTION_PROPOSED:    { icon: '\u{1F9EC}', color: '#c084fc', label: 'Evolution' },
};

const DEFAULT_TOPIC = { icon: '\u{2022}', color: '#9ca3af', label: 'Unknown' };

// ── URL Routing ─────────────────────────────────────────────
// Converts ISSUE_OPENED ↔ issue-opened for clean URLs
function topicToSlug(topic: string): string {
  return topic.toLowerCase().replace(/_/g, '-');
}

function slugToTopic(slug: string): string | null {
  const upper = slug.toUpperCase().replace(/-/g, '_');
  return upper in TOPIC_CONFIG ? upper : null;
}

function parseRoute(): { tab: TabId; filter: string | null; taskId: string | null } {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/health') return { tab: 'health', filter: null, taskId: null };
  if (path === '/tools') return { tab: 'tools', filter: null, taskId: null };
  if (path === '/repos') return { tab: 'repos', filter: null, taskId: null };
  if (path === '/tasks') return { tab: 'tasks', filter: null, taskId: null };
  if (path.startsWith('/tasks/')) {
    const taskId = path.slice('/tasks/'.length);
    return { tab: 'tasks', filter: null, taskId };
  }
  if (path.startsWith('/events/')) {
    const slug = path.slice('/events/'.length);
    return { tab: 'events', filter: slugToTopic(slug), taskId: null };
  }
  if (path === '/events' || path === '/') return { tab: 'events', filter: null, taskId: null };
  return { tab: 'events', filter: null, taskId: null };
}

function buildPath(tab: TabId, filter: string | null, taskId?: string | null): string {
  if (tab === 'health') return '/health';
  if (tab === 'tools') return '/tools';
  if (tab === 'repos') return '/repos';
  if (tab === 'tasks') return taskId ? `/tasks/${taskId}` : '/tasks';
  if (filter) return `/events/${topicToSlug(filter)}`;
  return '/events';
}

function getTopicConfig(topic: string) {
  return TOPIC_CONFIG[topic] ?? DEFAULT_TOPIC;
}

// ── API helpers ─────────────────────────────────────────────
const API_BASE = '';

async function fetchEvents(params?: Record<string, string>): Promise<EventMessage[]> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(`${API_BASE}/api/events${qs}`);
  const data = await res.json();
  return data.events ?? [];
}

async function fetchStatus(): Promise<HealthStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchDetailedHealth(): Promise<DetailedHealth | null> {
  try {
    const res = await fetch(`${API_BASE}/api/health/details`);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    const data = await res.json();
    if (!data?.dependencies) return null;
    return data;
  } catch {
    return null;
  }
}

async function fetchHealthHistory(limit = 50): Promise<HealthSnapshot[]> {
  try {
    const res = await fetch(`${API_BASE}/api/health/history?limit=${limit}`);
    if (!res.ok) return [];
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return [];
    const data = await res.json();
    return data.snapshots ?? [];
  } catch {
    return [];
  }
}

// ── Task API helpers ────────────────────────────────────────
async function fetchTasks(): Promise<TaskSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks`);
    const data = await res.json();
    return data.tasks ?? [];
  } catch {
    return [];
  }
}

async function fetchTaskDetail(taskId: string): Promise<TaskDetailData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTaskDiff(taskId: string): Promise<TaskDiffData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}/diff`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function apiMergeTask(taskId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}/merge`, { method: 'POST' });
    const data = await res.json();
    return { ok: res.ok, message: data.message ?? data.error ?? '' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

async function apiRejectTask(taskId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}/reject`, { method: 'POST' });
    const data = await res.json();
    return { ok: res.ok, message: data.message ?? data.error ?? '' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ── Repo API helpers ───────────────────────────────────────
async function fetchRepos(): Promise<RepoInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/api/repos`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.repos ?? [];
  } catch { return []; }
}

async function apiAddRepo(urlOrPath: string, name?: string): Promise<{ ok: boolean; repo?: RepoInfo; error?: string }> {
  try {
    const body: Record<string, string> = {};
    if (urlOrPath.startsWith('http') || urlOrPath.startsWith('git@') || urlOrPath.includes('github.com')) {
      body.url = urlOrPath;
    } else {
      body.path = urlOrPath;
    }
    if (name) body.name = name;
    const res = await fetch(`${API_BASE}/api/repos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? 'Failed to add repo' };
    return { ok: true, repo: data.repo };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiRemoveRepo(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/repos/${name}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      return { ok: false, error: data.error ?? 'Failed to remove repo' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── KB + TOM API helpers ────────────────────────────────────
interface KBStats { total: number; byCategory: Record<string, number> }
interface KBSyncReport {
  timestamp: string; gitEntries: number; qdrantPoints: number;
  missing: string[]; orphaned: string[]; stale: string[];
  healthy: number; repaired: number; errors: string[];
}
interface TOMCompressResult {
  ok: boolean; text: string; original_chars: number;
  compressed_chars: number; ratio: number; layers: string[]; cache_hit: boolean;
}
interface ScannerInfo { name: string; available: boolean }
interface ScannersResponse { scanners: ScannerInfo[]; total: number; available: number }
interface TesterInfo { name: string; available: boolean }
interface TestersResponse { testers: TesterInfo[]; total: number; available: number }
interface GeneratorInfo { name: string; type: string }
interface GeneratorsResponse { generators: GeneratorInfo[]; total: number }

// ── Evolution types ─────────────────────────────────────────
interface EvolutionRecord {
  version: number; description: string; commitHash: string;
  parentVersion: number | null; dependsOn: number[];
  gitTag: string; status: 'active' | 'rolled_back';
  createdAt: string; rolledBackAt?: string;
}
interface EvolutionsResponse { evolutions: EvolutionRecord[]; total: number; active: number; rolledBack: number }
interface CascadeResult { target: number; affected: number[]; chain: number[][] }
interface CascadeResponse { version: number; record: EvolutionRecord; cascade: CascadeResult }
interface RollbackResult { success: boolean; version: number; decision: string; rolledBack: number[]; ruleAdded?: string; error?: string }

async function fetchEvolutions(): Promise<EvolutionsResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/evolutions`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchCascade(version: number): Promise<CascadeResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/evolutions/${version}/cascade`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function apiRollback(version: number, decision: string): Promise<RollbackResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/evolutions/${version}/rollback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    return await res.json();
  } catch { return null; }
}

async function fetchKBStats(): Promise<KBStats | null> {
  try {
    const res = await fetch(`${API_BASE}/api/kb/stats`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function apiKBSync(dryRun: boolean): Promise<KBSyncReport | null> {
  try {
    const res = await fetch(`${API_BASE}/api/kb/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchTOMStatus(): Promise<{ running: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/api/tom/status`);
    if (!res.ok) return { running: false };
    return await res.json();
  } catch { return { running: false }; }
}

async function apiTOMCompress(text: string): Promise<TOMCompressResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/tom/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchScanners(): Promise<ScannersResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/scanners`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchTesters(): Promise<TestersResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/testers`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchGenerators(): Promise<GeneratorsResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/generators`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Styles ──────────────────────────────────────────────────
function makeStyles(c: typeof colors.dark) {
  return {
    app: {
      minHeight: '100vh',
      background: c.bg,
      color: c.text,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      transition: 'background 0.2s, color 0.2s',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 20px',
      borderBottom: `1px solid ${c.border}`,
      background: c.bgPanel,
    } as React.CSSProperties,

    logo: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    } as React.CSSProperties,

    logoText: {
      fontSize: 16,
      fontWeight: 700,
      letterSpacing: 1,
      color: c.accent,
    } as React.CSSProperties,

    version: {
      fontSize: 11,
      color: c.textDim,
      padding: '2px 6px',
      border: `1px solid ${c.borderInput}`,
      borderRadius: 4,
    } as React.CSSProperties,

    statusBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      fontSize: 12,
      color: c.textMuted,
    } as React.CSSProperties,

    statusDot: (connected: boolean) => ({
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: connected ? '#22c55e' : '#ef4444',
      display: 'inline-block',
      marginRight: 4,
      boxShadow: connected ? '0 0 6px #22c55e' : '0 0 6px #ef4444',
    } as React.CSSProperties),

    body: {
      display: 'flex',
      height: 'calc(100vh - 49px)',
    } as React.CSSProperties,

    sidebar: {
      width: 220,
      borderRight: `1px solid ${c.border}`,
      background: c.bgPanel,
      padding: '12px 0',
      overflowY: 'auto' as const,
      flexShrink: 0,
    } as React.CSSProperties,

    sidebarSection: {
      padding: '8px 16px',
      fontSize: 10,
      textTransform: 'uppercase' as const,
      letterSpacing: 1.5,
      color: c.textDim,
      fontWeight: 600,
    } as React.CSSProperties,

    filterBtn: (active: boolean, color: string) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      padding: '6px 16px',
      border: 'none',
      background: active ? c.bgCard : 'transparent',
      color: active ? color : c.textMuted,
      cursor: 'pointer',
      fontSize: 12,
      textAlign: 'left' as const,
      fontFamily: 'inherit',
      transition: 'all 0.15s',
      borderLeft: active ? `2px solid ${color}` : '2px solid transparent',
    } as React.CSSProperties),

    filterCount: {
      marginLeft: 'auto',
      fontSize: 10,
      color: c.textDimmer,
      minWidth: 20,
      textAlign: 'right' as const,
    } as React.CSSProperties,

    main: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden',
    } as React.CSSProperties,

    eventList: {
      flex: 1,
      overflowY: 'auto' as const,
      padding: '4px 0',
    } as React.CSSProperties,

    eventRow: (isNew: boolean) => ({
      display: 'grid',
      gridTemplateColumns: '80px 28px 160px 100px 1fr',
      alignItems: 'start',
      gap: 8,
      padding: '6px 16px',
      borderBottom: `1px solid ${c.borderSubtle}`,
      transition: 'background 0.3s',
      background: isNew ? c.highlight : 'transparent',
      minHeight: 32,
    } as React.CSSProperties),

    eventTime: {
      color: c.textDimmer,
      fontSize: 11,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap' as const,
    } as React.CSSProperties,

    eventIcon: {
      fontSize: 14,
      textAlign: 'center' as const,
    } as React.CSSProperties,

    eventTopic: (color: string) => ({
      color,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0.3,
      whiteSpace: 'nowrap' as const,
    } as React.CSSProperties),

    eventSender: {
      color: c.link,
      fontSize: 12,
    } as React.CSSProperties,

    eventText: {
      color: c.text,
      fontSize: 12,
      lineHeight: 1.4,
      wordBreak: 'break-word' as const,
    } as React.CSSProperties,

    emptyState: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: c.textDimmer,
      gap: 12,
    } as React.CSSProperties,

    emptyIcon: {
      fontSize: 48,
      opacity: 0.3,
    } as React.CSSProperties,

    detailPanel: {
      width: 340,
      borderLeft: `1px solid ${c.border}`,
      background: c.bgPanel,
      overflowY: 'auto' as const,
      padding: 16,
      flexShrink: 0,
    } as React.CSSProperties,

    detailLabel: {
      fontSize: 10,
      textTransform: 'uppercase' as const,
      letterSpacing: 1,
      color: c.textDim,
      marginBottom: 4,
      marginTop: 12,
    } as React.CSSProperties,

    detailValue: {
      fontSize: 12,
      color: c.text,
      background: c.bgCard,
      padding: '6px 8px',
      borderRadius: 4,
      wordBreak: 'break-all' as const,
    } as React.CSSProperties,

    jsonBlock: {
      fontSize: 11,
      color: c.textMuted,
      background: c.bgCard,
      padding: 8,
      borderRadius: 4,
      maxHeight: 300,
      overflow: 'auto',
      whiteSpace: 'pre-wrap' as const,
      wordBreak: 'break-all' as const,
    } as React.CSSProperties,

    statsRow: {
      display: 'flex',
      gap: 12,
      padding: '6px 16px',
    } as React.CSSProperties,

    statCard: {
      flex: 1,
      background: c.bgCard,
      border: `1px solid ${c.border}`,
      borderRadius: 6,
      padding: '10px 12px',
      textAlign: 'center' as const,
    } as React.CSSProperties,

    statValue: {
      fontSize: 20,
      fontWeight: 700,
      color: c.accent,
    } as React.CSSProperties,

    statLabel: {
      fontSize: 10,
      color: c.textDim,
      marginTop: 2,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.5,
    } as React.CSSProperties,

    themeToggle: {
      background: 'none',
      border: `1px solid ${c.border}`,
      borderRadius: 6,
      padding: '4px 8px',
      cursor: 'pointer',
      fontSize: 16,
      lineHeight: 1,
      color: c.textMuted,
      transition: 'all 0.15s',
    } as React.CSSProperties,
  };
}

// ── Health Panel ────────────────────────────────────────────
function HealthPanel() {
  const { theme } = useTheme();
  const c = colors[theme];
  const styles = makeStyles(c);

  const [health, setHealth] = useState<DetailedHealth | null>(null);
  const [history, setHistory] = useState<HealthSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () => {
      fetchDetailedHealth().then(h => { setHealth(h); setLoaded(true); }).catch(() => setLoaded(true));
      fetchHealthHistory(30).then(setHistory).catch(() => {});
    };
    load();

    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  const stateColor = (state: string) =>
    state === 'up' || state === 'ok' ? '#22c55e'
    : state === 'down' ? '#ef4444'
    : state === 'degraded' ? '#facc15'
    : c.textDim;

  const depCard: React.CSSProperties = {
    background: c.bgCard,
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    padding: '12px 16px',
    flex: 1,
    minWidth: 140,
  };

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%' }}>
      {/* Overall Status */}
      {health && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <div style={{ ...depCard, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: stateColor(health.status) }}>
                {health.status.toUpperCase()}
              </div>
              <div style={styles.statLabel}>Overall</div>
            </div>
            <div style={{ ...depCard, textAlign: 'center' }}>
              <div style={styles.statValue}>{health.system.memoryPercent}%</div>
              <div style={styles.statLabel}>Memory</div>
              <div style={{ fontSize: 10, color: c.textDimmer, marginTop: 2 }}>
                {health.system.memoryUsedMb}MB / {health.system.memoryTotalMb}MB
              </div>
            </div>
            <div style={{ ...depCard, textAlign: 'center' }}>
              <div style={styles.statValue}>{health.uptime}s</div>
              <div style={styles.statLabel}>Uptime</div>
            </div>
          </div>

          {/* Dependencies */}
          <div style={{ ...styles.sidebarSection, padding: '0 0 8px' }}>Dependencies</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {health.dependencies.map(dep => {
              const isDown = dep.state === 'down';
              const hints: Record<string, string> = {
                qdrant: 'docker compose up -d qdrant',
                redis: 'docker compose up -d redis',
                ollama: 'ollama serve',
                tom: 'make tom-start',
              };
              return (
                <div key={dep.name} style={{
                  ...depCard,
                  borderColor: isDown ? '#ef4444' : c.border,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: stateColor(dep.state),
                      boxShadow: `0 0 6px ${stateColor(dep.state)}`,
                      display: 'inline-block',
                    }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{dep.name}</span>
                  </div>
                  <div style={{ fontSize: 11, color: stateColor(dep.state), fontWeight: 600 }}>
                    {dep.state.toUpperCase()}
                  </div>
                  {dep.latencyMs != null && (
                    <div style={{ fontSize: 10, color: c.textDim, marginTop: 2 }}>{dep.latencyMs}ms</div>
                  )}
                  <div style={{ fontSize: 9, color: c.textDimmer, marginTop: 4 }}>
                    checked {new Date(dep.lastChecked).toLocaleTimeString('en-US', { hour12: false })}
                  </div>
                  {isDown && dep.error && (
                    <div style={{
                      fontSize: 10, color: '#ef4444', marginTop: 6,
                      background: theme === 'dark' ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)',
                      borderRadius: 4, padding: '4px 6px', wordBreak: 'break-word',
                      maxHeight: 60, overflowY: 'auto',
                    }}>
                      {dep.error.length > 200 ? dep.error.slice(0, 200) + '...' : dep.error}
                    </div>
                  )}
                  {isDown && hints[dep.name] && (
                    <div style={{ fontSize: 10, color: c.textDim, marginTop: 4 }}>
                      fix: <code style={{ color: c.accent, fontSize: 10 }}>{hints[dep.name]}</code>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* History */}
      {history.length > 0 && (
        <>
          <div style={{ ...styles.sidebarSection, padding: '0 0 8px' }}>Recent History</div>
          <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '140px 70px 80px 1fr',
              gap: 8, padding: '6px 12px', borderBottom: `1px solid ${c.border}`,
              color: c.textDimmer, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600,
            }}>
              <span>Time</span>
              <span>Status</span>
              <span>Memory</span>
              <span>Dependencies</span>
            </div>
            {history.slice(0, 20).map(snap => {
              let deps: DependencyStatus[] = [];
              try { deps = JSON.parse(snap.dependencies); } catch { /* */ }
              const upCount = deps.filter(d => d.state === 'up').length;
              return (
                <div key={snap.id} style={{
                  display: 'grid', gridTemplateColumns: '140px 70px 80px 1fr',
                  gap: 8, padding: '4px 12px', borderBottom: `1px solid ${c.borderSubtle}`, fontSize: 11,
                }}>
                  <span style={{ color: c.textDimmer }}>
                    {new Date(snap.recorded_at).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  <span style={{ color: stateColor(snap.status), fontWeight: 600 }}>
                    {snap.status}
                  </span>
                  <span style={{ color: c.textMuted }}>{snap.memory_percent}%</span>
                  <span style={{ color: c.textMuted }}>{upCount}/{deps.length} up</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!health && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>{loaded ? '\u{1F50C}' : '\u{1F3E5}'}</div>
          <div>{loaded ? 'Orchestrator not running' : 'Loading health data...'}</div>
          {loaded && (
            <div style={{ fontSize: 11 }}>
              Start with <code style={{ color: c.accent }}>nanoprym serve</code> to see health data
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Diff Viewer ─────────────────────────────────────────────
function DiffViewer({ diff }: { diff: string }) {
  const { theme } = useTheme();
  const c = colors[theme];

  if (!diff) {
    return <div style={{ padding: 20, color: c.textDim, textAlign: 'center' }}>No changes</div>;
  }

  const lines = diff.split('\n');

  return (
    <div style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 12, overflow: 'auto' }}>
      {lines.map((line, i) => {
        let bg = 'transparent';
        let color = c.text;
        if (line.startsWith('+') && !line.startsWith('+++')) {
          bg = theme === 'dark' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.15)';
          color = '#22c55e';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          bg = theme === 'dark' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.15)';
          color = '#ef4444';
        } else if (line.startsWith('@@')) {
          color = c.accent;
        } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
          color = c.textDim;
        }
        return (
          <div key={i} style={{ padding: '1px 12px', background: bg, color, whiteSpace: 'pre', minHeight: 18 }}>
            <span style={{ display: 'inline-block', width: 40, color: c.textDimmer, textAlign: 'right', marginRight: 12, userSelect: 'none' }}>
              {i + 1}
            </span>
            {line}
          </div>
        );
      })}
    </div>
  );
}

// ── Task Detail View ────────────────────────────────────────
function TaskDetailView({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { theme } = useTheme();
  const c = colors[theme];
  const styles = makeStyles(c);

  const [task, setTask] = useState<TaskDetailData | null>(null);
  const [diff, setDiff] = useState<TaskDiffData | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<'diff' | 'tests' | 'events'>('diff');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchTaskDetail(taskId).then(setTask);
    fetchTaskDiff(taskId).then(setDiff);
  }, [taskId]);

  const handleMerge = async () => {
    if (!confirm(`Merge branch ${task?.branch} to main?`)) return;
    setActionLoading(true);
    const result = await apiMergeTask(taskId);
    setActionResult(result);
    setActionLoading(false);
    if (result.ok) fetchTaskDetail(taskId).then(setTask);
  };

  const handleReject = async () => {
    if (!confirm(`Reject task ${taskId}? Branch will be deleted.`)) return;
    setActionLoading(true);
    const result = await apiRejectTask(taskId);
    setActionResult(result);
    setActionLoading(false);
    if (result.ok) fetchTaskDetail(taskId).then(setTask);
  };

  const statusColor = (s: string) =>
    s === 'awaiting_review' ? '#facc15'
    : s === 'merged' ? '#22c55e'
    : s === 'rejected' ? '#ef4444'
    : s === 'in_progress' ? '#60a5fa'
    : c.textDim;

  const detailTabBtn = (tab: 'diff' | 'tests' | 'events', label: string) => ({
    padding: '6px 16px',
    border: 'none',
    borderBottom: activeDetailTab === tab ? `2px solid ${c.accent}` : '2px solid transparent',
    background: 'transparent',
    color: activeDetailTab === tab ? c.accent : c.textDim,
    cursor: 'pointer' as const,
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 600 as const,
  });

  // Extract test results from task events (SCAN_RESULT / VALIDATION_RESULT)
  const testResults = (task?.events ?? [])
    .filter(e => e.topic === 'SCAN_RESULT' || e.topic === 'VALIDATION_RESULT')
    .map(e => ({
      id: e.id,
      sender: e.sender,
      topic: e.topic,
      timestamp: e.timestamp,
      text: e.text,
      passed: (e.data?.passed as number) ?? 0,
      failed: (e.data?.failed as number) ?? 0,
      skipped: (e.data?.skipped as number) ?? 0,
      success: (e.data?.success as boolean) ?? (e.data?.passed === true),
      errors: (e.data?.errors as Array<{ message: string; file?: string; severity?: string }>) ?? [],
      warnings: (e.data?.warnings as string[]) ?? [],
      metadata: e.data?.metadata as Record<string, unknown> | undefined,
      scannerResults: e.data?.scanners as Record<string, { passed: boolean; errorCount: number }> | undefined,
    }));

  const totalPassed = testResults.reduce((s, r) => s + r.passed, 0);
  const totalFailed = testResults.reduce((s, r) => s + r.failed, 0);

  if (!task) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: c.textDim }}>Loading task...</div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${c.border}`, background: c.bgPanel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button
            onClick={onBack}
            style={{ background: 'none', border: 'none', color: c.textMuted, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}
          >
            {'\u2190'} Back
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>{task.title}</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: statusColor(task.status) + '22', color: statusColor(task.status),
            textTransform: 'uppercase',
          }}>
            {task.status.replace('_', ' ')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: c.textDim }}>
          <span>Branch: <span style={{ color: c.link }}>{task.branch}</span></span>
          <span>Complexity: {task.complexity}</span>
          <span>Type: {task.taskType}</span>
          <span>Events: {task.eventCount}</span>
          {diff?.files && <span>Files: {diff.files.length}</span>}
        </div>

        {/* Actions */}
        {task.status === 'awaiting_review' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={handleMerge}
              disabled={actionLoading}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: 4, cursor: 'pointer',
                background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                opacity: actionLoading ? 0.5 : 1,
              }}
            >
              {actionLoading ? 'Working...' : 'Merge to Main'}
            </button>
            <button
              onClick={handleReject}
              disabled={actionLoading}
              style={{
                padding: '6px 16px', border: `1px solid #ef4444`, borderRadius: 4, cursor: 'pointer',
                background: 'transparent', color: '#ef4444', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                opacity: actionLoading ? 0.5 : 1,
              }}
            >
              Reject
            </button>
          </div>
        )}

        {actionResult && (
          <div style={{
            marginTop: 8, fontSize: 11, padding: '4px 8px', borderRadius: 4,
            background: actionResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: actionResult.ok ? '#22c55e' : '#ef4444',
          }}>
            {actionResult.message}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${c.border}`, background: c.bgPanel }}>
        <button onClick={() => setActiveDetailTab('diff')} style={detailTabBtn('diff', 'Diff')}>
          Diff {diff?.files ? `(${diff.files.length} files)` : ''}
        </button>
        <button onClick={() => setActiveDetailTab('tests')} style={detailTabBtn('tests', 'Tests')}>
          Tests {testResults.length > 0 ? `(${totalPassed}${totalFailed > 0 ? `/${totalFailed} failed` : ' passed'})` : ''}
        </button>
        <button onClick={() => setActiveDetailTab('events')} style={detailTabBtn('events', 'Events')}>
          Events ({task.eventCount})
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', background: c.bg }}>
        {activeDetailTab === 'diff' ? (
          <div>
            {diff?.files && diff.files.length > 0 && (
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, fontSize: 11, color: c.textDim }}>
                {diff.files.map(f => (
                  <span key={f} style={{ display: 'inline-block', marginRight: 12, color: c.link }}>{f}</span>
                ))}
              </div>
            )}
            <DiffViewer diff={diff?.diff ?? ''} />
          </div>
        ) : activeDetailTab === 'tests' ? (
          <div style={{ padding: 16 }}>
            {testResults.length === 0 ? (
              <div style={{ textAlign: 'center', color: c.textDimmer, fontSize: 12, padding: 40 }}>
                No test or scan results yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Summary bar */}
                <div style={{
                  display: 'flex', gap: 16, padding: '12px 16px', borderRadius: 6,
                  background: c.bgCard, border: `1px solid ${c.border}`,
                }}>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{totalPassed}</div>
                    <div style={{ fontSize: 10, color: c.textDim }}>Passed</div>
                  </div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: totalFailed > 0 ? '#ef4444' : c.textDimmer }}>{totalFailed}</div>
                    <div style={{ fontSize: 10, color: c.textDim }}>Failed</div>
                  </div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: c.textMuted }}>{testResults.length}</div>
                    <div style={{ fontSize: 10, color: c.textDim }}>Results</div>
                  </div>
                </div>

                {/* Per-result cards */}
                {testResults.map(r => (
                  <div key={r.id} style={{
                    background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 6, padding: 14,
                    borderLeft: `3px solid ${r.success ? '#22c55e' : r.failed > 0 ? '#ef4444' : '#facc15'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{r.sender}</span>
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 3,
                          background: r.success ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          color: r.success ? '#22c55e' : '#ef4444', fontWeight: 600,
                        }}>
                          {r.success ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: c.textDimmer }}>
                        {new Date(r.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                      </span>
                    </div>

                    {/* Test counts */}
                    {(r.passed > 0 || r.failed > 0 || r.skipped > 0) && (
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, marginBottom: 8 }}>
                        <span style={{ color: '#22c55e' }}>{r.passed} passed</span>
                        {r.failed > 0 && <span style={{ color: '#ef4444' }}>{r.failed} failed</span>}
                        {r.skipped > 0 && <span style={{ color: c.textDimmer }}>{r.skipped} skipped</span>}
                      </div>
                    )}

                    {/* Scanner sub-results */}
                    {r.scannerResults && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {Object.entries(r.scannerResults).map(([name, sr]) => (
                          <span key={name} style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 3,
                            background: sr.passed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                            color: sr.passed ? '#22c55e' : '#ef4444',
                            border: `1px solid ${sr.passed ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                          }}>
                            {name} {sr.passed ? '\u2713' : `${sr.errorCount} errors`}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* k6 metrics */}
                    {r.metadata && (r.metadata as Record<string, unknown>).p95Duration != null && (
                      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: c.textMuted, marginBottom: 8 }}>
                        <span>p95: {((r.metadata as Record<string, unknown>).p95Duration as number).toFixed(1)}ms</span>
                        {(r.metadata as Record<string, unknown>).avgDuration != null &&
                          <span>avg: {((r.metadata as Record<string, unknown>).avgDuration as number).toFixed(1)}ms</span>}
                        {(r.metadata as Record<string, unknown>).rps != null &&
                          <span>rps: {((r.metadata as Record<string, unknown>).rps as number).toFixed(1)}</span>}
                        {(r.metadata as Record<string, unknown>).iterations != null &&
                          <span>iters: {(r.metadata as Record<string, unknown>).iterations as number}</span>}
                      </div>
                    )}

                    {/* Errors list */}
                    {r.errors.length > 0 && (
                      <div style={{ fontSize: 11, marginTop: 4 }}>
                        {r.errors.slice(0, 10).map((err, i) => (
                          <div key={i} style={{
                            padding: '3px 8px', marginBottom: 2, borderRadius: 3,
                            background: 'rgba(239,68,68,0.06)', color: '#ef4444',
                          }}>
                            {err.file && <span style={{ color: c.link, marginRight: 6 }}>{err.file}</span>}
                            {err.message}
                          </div>
                        ))}
                        {r.errors.length > 10 && (
                          <div style={{ color: c.textDimmer, padding: '3px 8px' }}>
                            ...and {r.errors.length - 10} more
                          </div>
                        )}
                      </div>
                    )}

                    {/* Description text */}
                    {r.text && r.errors.length === 0 && (
                      <div style={{ fontSize: 11, color: c.textMuted }}>{r.text.slice(0, 200)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: 4 }}>
            {task.events.map(event => {
              const cfg = getTopicConfig(event.topic);
              return (
                <div key={event.id} style={{
                  display: 'grid', gridTemplateColumns: '80px 28px 140px 80px 1fr',
                  gap: 8, padding: '4px 12px', borderBottom: `1px solid ${c.borderSubtle}`,
                  fontSize: 11, alignItems: 'start',
                }}>
                  <span style={{ color: c.textDimmer, fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  <span style={{ textAlign: 'center' }}>{cfg.icon}</span>
                  <span style={{ color: cfg.color, fontWeight: 600 }}>{event.topic}</span>
                  <span style={{ color: c.link }}>{event.sender}</span>
                  <span style={{ color: c.text, wordBreak: 'break-word' }}>
                    {event.text.slice(0, 300)}{event.text.length > 300 ? '...' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task Queue ──────────────────────────────────────────────
function TaskQueue({ onSelectTask }: { onSelectTask: (taskId: string) => void }) {
  const { theme } = useTheme();
  const c = colors[theme];
  const styles = makeStyles(c);

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [repoFilter, setRepoFilter] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      fetchTasks().then(t => { setTasks(t); setLoaded(true); }).catch(() => setLoaded(true));
    };
    load();
    const interval = setInterval(load, 5_000);
    return () => clearInterval(interval);
  }, []);

  const repoNames = [...new Set(tasks.map(t => t.repoName).filter(Boolean))] as string[];
  const filteredTasks = repoFilter ? tasks.filter(t => t.repoName === repoFilter) : tasks;

  const lanes: Record<string, TaskSummary[]> = {
    'In Progress': filteredTasks.filter(t => t.status === 'in_progress'),
    'Awaiting Review': filteredTasks.filter(t => t.status === 'awaiting_review'),
    'Completed': filteredTasks.filter(t => t.status === 'merged' || t.status === 'rejected'),
  };

  const statusColor = (s: string) =>
    s === 'awaiting_review' ? '#facc15'
    : s === 'merged' ? '#22c55e'
    : s === 'rejected' ? '#ef4444'
    : s === 'in_progress' ? '#60a5fa'
    : c.textDim;

  const laneColor = (lane: string) =>
    lane === 'In Progress' ? '#60a5fa'
    : lane === 'Awaiting Review' ? '#facc15'
    : '#22c55e';

  if (!loaded) {
    return <div style={{ padding: 40, textAlign: 'center', color: c.textDim }}>Loading tasks...</div>;
  }

  if (tasks.length === 0) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>{'\u{1F4CB}'}</div>
        <div>No tasks yet</div>
        <div style={{ fontSize: 11 }}>
          Submit a task with <code style={{ color: c.accent }}>nanoprym run "description"</code>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Repo filter bar */}
      {repoNames.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, marginRight: 4 }}>Repo:</span>
          <button
            onClick={() => setRepoFilter(null)}
            style={{
              padding: '3px 10px', border: `1px solid ${!repoFilter ? c.accent : c.border}`, borderRadius: 3,
              background: !repoFilter ? c.accent : 'transparent', color: !repoFilter ? '#fff' : c.textMuted,
              cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 500,
            }}
          >All</button>
          {repoNames.map(name => (
            <button
              key={name}
              onClick={() => setRepoFilter(repoFilter === name ? null : name)}
              style={{
                padding: '3px 10px', border: `1px solid ${repoFilter === name ? c.accent : c.border}`, borderRadius: 3,
                background: repoFilter === name ? c.accent : 'transparent', color: repoFilter === name ? '#fff' : c.textMuted,
                cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 500,
              }}
            >{name}</button>
          ))}
        </div>
      )}
    <div style={{ display: 'flex', gap: 16, padding: 16, flex: 1, overflow: 'auto' }}>
      {Object.entries(lanes).map(([lane, items]) => (
        <div key={lane} style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5,
            color: laneColor(lane), padding: '8px 0', borderBottom: `2px solid ${laneColor(lane)}`,
            marginBottom: 8, display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{lane}</span>
            <span style={{ color: c.textDimmer, fontWeight: 400 }}>{items.length}</span>
          </div>

          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(task => (
              <div
                key={task.taskId}
                onClick={() => onSelectTask(task.taskId)}
                style={{
                  background: c.bgCard,
                  border: `1px solid ${c.border}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = c.accent)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = c.border)}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: c.text, marginBottom: 4 }}>
                  {task.title}
                </div>
                <div style={{ fontSize: 11, color: c.textDim, marginBottom: 6 }}>
                  {task.description.slice(0, 100)}{task.description.length > 100 ? '...' : ''}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, color: c.textDimmer, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '1px 6px', borderRadius: 3,
                    background: statusColor(task.status) + '22', color: statusColor(task.status),
                    fontWeight: 600, textTransform: 'uppercase',
                  }}>
                    {task.status.replace('_', ' ')}
                  </span>
                  {task.repoName && (
                    <span style={{
                      padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                      background: 'rgba(96,165,250,0.15)', color: '#60a5fa',
                    }}>
                      {task.repoName}
                    </span>
                  )}
                  <span>{task.complexity}</span>
                  <span>{task.eventCount} events</span>
                  {((task.testsPassed ?? 0) > 0 || (task.testsFailed ?? 0) > 0) && (
                    <span style={{
                      padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                      background: (task.testsFailed ?? 0) > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                      color: (task.testsFailed ?? 0) > 0 ? '#ef4444' : '#22c55e',
                    }}>
                      {(task.testsFailed ?? 0) > 0
                        ? `\u2717 ${task.testsFailed} failed`
                        : `\u2713 ${task.testsPassed} passed`}
                    </span>
                  )}
                  <span>{new Date(task.createdAt).toLocaleTimeString('en-US', { hour12: false })}</span>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div style={{ textAlign: 'center', color: c.textDimmer, fontSize: 11, padding: 20 }}>
                No tasks
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}

// ── Tools Panel ──────────────────────────────────────────────
function ToolsPanel() {
  const { theme } = useTheme();
  const c = colors[theme];
  const styles = makeStyles(c);

  // KB state
  const [kbStats, setKBStats] = useState<KBStats | null>(null);
  const [syncReport, setSyncReport] = useState<KBSyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);

  // TOM state
  const [tomStatus, setTOMStatus] = useState<{ running: boolean } | null>(null);
  const [tomInput, setTOMInput] = useState('');
  const [tomResult, setTOMResult] = useState<TOMCompressResult | null>(null);
  const [compressing, setCompressing] = useState(false);

  // Scanners state
  const [scannersData, setScannersData] = useState<ScannersResponse | null>(null);

  // Testers state
  const [testersData, setTestersData] = useState<TestersResponse | null>(null);

  // Generators state
  const [generatorsData, setGeneratorsData] = useState<GeneratorsResponse | null>(null);

  // Evolutions state
  const [evoData, setEvoData] = useState<EvolutionsResponse | null>(null);
  const [selectedEvo, setSelectedEvo] = useState<number | null>(null);
  const [cascadeData, setCascadeData] = useState<CascadeResponse | null>(null);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    fetchKBStats().then(setKBStats);
    fetchTOMStatus().then(setTOMStatus);
    fetchScanners().then(setScannersData);
    fetchTesters().then(setTestersData);
    fetchGenerators().then(setGeneratorsData);
    fetchEvolutions().then(setEvoData);
  }, []);

  const handleSelectEvo = async (version: number) => {
    setSelectedEvo(version);
    setRollbackResult(null);
    const data = await fetchCascade(version);
    setCascadeData(data);
  };

  const handleRollback = async (version: number, decision: string) => {
    setRollingBack(true);
    const result = await apiRollback(version, decision);
    if (result) setRollbackResult(result);
    fetchEvolutions().then(setEvoData);
    setRollingBack(false);
  };

  const handleSync = async (dryRun: boolean) => {
    setSyncing(true);
    const report = await apiKBSync(dryRun);
    if (report) setSyncReport(report);
    fetchKBStats().then(setKBStats);
    setSyncing(false);
  };

  const handleCompress = async () => {
    if (!tomInput.trim()) return;
    setCompressing(true);
    const result = await apiTOMCompress(tomInput);
    if (result) setTOMResult(result);
    setCompressing(false);
  };

  const card: React.CSSProperties = {
    background: c.bgCard,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  };

  const statBox: React.CSSProperties = {
    background: c.bgPanel,
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    padding: '10px 14px',
    textAlign: 'center',
    flex: 1,
    minWidth: 80,
  };

  const btn = (active = false): React.CSSProperties => ({
    padding: '6px 14px',
    border: `1px solid ${active ? c.accent : c.border}`,
    borderRadius: 4,
    background: active ? c.accent : c.bgPanel,
    color: active ? '#fff' : c.text,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 500,
  });

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%', maxWidth: 900, margin: '0 auto' }}>

      {/* ── Evolutions ──────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Evolutions &amp; Rollback</div>
          {evoData && (
            <span style={{ fontSize: 11, color: c.textMuted }}>
              {evoData.active} active · {evoData.rolledBack} rolled back
            </span>
          )}
        </div>

        {evoData && evoData.evolutions.length > 0 ? (
          <div>
            {/* Evolution list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: selectedEvo != null ? 16 : 0 }}>
              {evoData.evolutions.map(evo => (
                <div
                  key={evo.version}
                  onClick={() => handleSelectEvo(evo.version)}
                  style={{
                    ...statBox,
                    display: 'flex', alignItems: 'center', gap: 10,
                    textAlign: 'left', cursor: 'pointer', flexDirection: 'row',
                    border: `1px solid ${selectedEvo === evo.version ? c.accent : c.border}`,
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: evo.status === 'active' ? '#22c55e' : '#ef4444',
                    boxShadow: `0 0 6px ${evo.status === 'active' ? '#22c55e' : '#ef4444'}`,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>
                      v{evo.version} — {evo.description.slice(0, 50)}
                    </div>
                    <div style={{ fontSize: 10, color: c.textDimmer }}>
                      {evo.gitTag} · {evo.commitHash.slice(0, 8)} · deps: [{evo.dependsOn.join(', ')}]
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: evo.status === 'active' ? '#22c55e' : '#ef4444', flexShrink: 0 }}>
                    {evo.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Cascade detail panel */}
            {selectedEvo != null && cascadeData && (
              <div style={{ background: c.bgPanel, border: `1px solid ${c.border}`, borderRadius: 6, padding: 14, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: c.text }}>
                  Cascade Analysis — v{cascadeData.version}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', color: c.textMuted, marginBottom: 12 }}>
                  <span>Status:</span>
                  <span style={{ color: cascadeData.record.status === 'active' ? '#22c55e' : '#ef4444' }}>
                    {cascadeData.record.status}
                  </span>
                  <span>Affected:</span>
                  <span style={{ color: cascadeData.cascade.affected.length > 0 ? '#facc15' : '#22c55e' }}>
                    {cascadeData.cascade.affected.length === 0 ? 'None' : cascadeData.cascade.affected.map(v => `v${v}`).join(', ')}
                  </span>
                  {cascadeData.cascade.chain.length > 0 && (<>
                    <span>Chains:</span>
                    <span style={{ color: c.text }}>
                      {cascadeData.cascade.chain.map(ch => ch.map(v => `v${v}`).join(' → ')).join(' | ')}
                    </span>
                  </>)}
                </div>

                {cascadeData.record.status === 'active' && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      style={{ ...btn(true), opacity: rollingBack ? 0.5 : 1 }}
                      onClick={() => handleRollback(cascadeData.version, 'rollback_all')}
                      disabled={rollingBack}
                    >
                      {rollingBack ? 'Rolling back...' : cascadeData.cascade.affected.length > 0 ? 'Rollback All' : 'Rollback'}
                    </button>
                    {cascadeData.cascade.affected.length > 0 && (
                      <button
                        style={{ ...btn(), opacity: rollingBack ? 0.5 : 1 }}
                        onClick={() => handleRollback(cascadeData.version, 'cancel')}
                        disabled={rollingBack}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}

                {rollbackResult && (
                  <div style={{
                    marginTop: 10, padding: 10, borderRadius: 4, fontSize: 11,
                    background: rollbackResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    color: rollbackResult.success ? '#22c55e' : '#ef4444',
                    border: `1px solid ${rollbackResult.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  }}>
                    {rollbackResult.success
                      ? `Rolled back: ${rollbackResult.rolledBack.map(v => `v${v}`).join(', ') || 'none'}${rollbackResult.ruleAdded ? ` · Rule: ${rollbackResult.ruleAdded}` : ''}`
                      : `Error: ${rollbackResult.error}`
                    }
                  </div>
                )}
              </div>
            )}
          </div>
        ) : evoData ? (
          <div style={{ color: c.textDimmer, fontSize: 11 }}>No evolutions registered yet</div>
        ) : (
          <div style={{ color: c.textDimmer, fontSize: 11 }}>Loading evolutions...</div>
        )}
      </div>

      {/* ── Scanners ──────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Scanner Plugins</div>
          {scannersData && (
            <span style={{ fontSize: 11, color: c.textMuted }}>
              {scannersData.available}/{scannersData.total} available
            </span>
          )}
        </div>
        {scannersData ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {scannersData.scanners.map(s => (
              <div key={s.name} style={{
                ...statBox,
                display: 'flex', alignItems: 'center', gap: 8,
                flexDirection: 'row', textAlign: 'left', minWidth: 120,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: s.available ? '#22c55e' : '#ef4444',
                  boxShadow: `0 0 6px ${s.available ? '#22c55e' : '#ef4444'}`,
                }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: s.available ? '#22c55e' : c.textDimmer }}>
                    {s.available ? 'Ready' : 'Not installed'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: c.textDimmer, fontSize: 11 }}>Loading scanners...</div>
        )}
      </div>

      {/* ── Testers ──────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Tester Plugins</div>
          {testersData && (
            <span style={{ fontSize: 11, color: c.textMuted }}>
              {testersData.available}/{testersData.total} available
            </span>
          )}
        </div>
        {testersData ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {testersData.testers.map(t => (
              <div key={t.name} style={{
                ...statBox,
                display: 'flex', alignItems: 'center', gap: 8,
                flexDirection: 'row', textAlign: 'left', minWidth: 120,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: t.available ? '#22c55e' : '#ef4444',
                  boxShadow: `0 0 6px ${t.available ? '#22c55e' : '#ef4444'}`,
                }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: t.available ? '#22c55e' : c.textDimmer }}>
                    {t.available ? 'Ready' : 'Not installed'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: c.textDimmer, fontSize: 11 }}>Loading testers...</div>
        )}
      </div>

      {/* ── Generators ──────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Generator Plugins</div>
          {generatorsData && (
            <span style={{ fontSize: 11, color: c.textMuted }}>
              {generatorsData.total} registered
            </span>
          )}
        </div>
        {generatorsData ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {generatorsData.generators.map(g => (
              <div key={g.name} style={{
                ...statBox,
                display: 'flex', alignItems: 'center', gap: 8,
                flexDirection: 'row', textAlign: 'left', minWidth: 120,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: c.accent,
                  boxShadow: `0 0 6px ${c.accent}`,
                }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{g.name}</div>
                  <div style={{ fontSize: 10, color: c.textMuted }}>generator</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: c.textDimmer, fontSize: 11 }}>Loading generators...</div>
        )}
      </div>

      {/* ── Knowledge Base ──────────────────────── */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Knowledge Base</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn()} onClick={() => handleSync(true)} disabled={syncing}>
              {syncing ? 'Checking...' : 'Check'}
            </button>
            <button style={btn(true)} onClick={() => handleSync(false)} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        </div>

        {/* Stats grid */}
        {kbStats && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: syncReport ? 16 : 0 }}>
            <div style={statBox}>
              <div style={{ ...styles.statValue, fontSize: 20 }}>{kbStats.total}</div>
              <div style={styles.statLabel}>Total</div>
            </div>
            {Object.entries(kbStats.byCategory).filter(([, v]) => v > 0).map(([cat, count]) => (
              <div key={cat} style={statBox}>
                <div style={{ ...styles.statValue, fontSize: 20 }}>{count}</div>
                <div style={styles.statLabel}>{cat}</div>
              </div>
            ))}
            {kbStats.total === 0 && (
              <div style={{ color: c.textDimmer, fontSize: 11, padding: '8px 0' }}>No KB entries yet</div>
            )}
          </div>
        )}

        {/* Sync report */}
        {syncReport && (
          <div style={{ background: c.bgPanel, border: `1px solid ${c.border}`, borderRadius: 6, padding: 14, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: c.text }}>Sync Report</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', color: c.textMuted }}>
              <span>Git entries:</span><span style={{ color: c.text }}>{syncReport.gitEntries}</span>
              <span>Qdrant points:</span><span style={{ color: c.text }}>{syncReport.qdrantPoints}</span>
              <span>Healthy:</span><span style={{ color: '#22c55e' }}>{syncReport.healthy}</span>
              {syncReport.missing.length > 0 && (<><span>Missing:</span><span style={{ color: '#facc15' }}>{syncReport.missing.length}</span></>)}
              {syncReport.orphaned.length > 0 && (<><span>Orphaned:</span><span style={{ color: '#facc15' }}>{syncReport.orphaned.length}</span></>)}
              {syncReport.stale.length > 0 && (<><span>Stale:</span><span style={{ color: '#facc15' }}>{syncReport.stale.length}</span></>)}
              {syncReport.repaired > 0 && (<><span>Repaired:</span><span style={{ color: '#22c55e' }}>{syncReport.repaired}</span></>)}
            </div>
            {syncReport.errors.length > 0 && (
              <div style={{ marginTop: 8, color: '#ef4444', fontSize: 11 }}>
                {syncReport.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── TOM Compression ──────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Token Optimization (TOM)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-block',
              width: 8, height: 8, borderRadius: '50%',
              background: tomStatus?.running ? '#22c55e' : '#ef4444',
            }} />
            <span style={{ fontSize: 11, color: c.textMuted }}>
              {tomStatus?.running ? 'Sidecar running' : 'Sidecar offline'}
            </span>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <textarea
            value={tomInput}
            onChange={e => setTOMInput(e.target.value)}
            placeholder="Enter text to compress..."
            style={{
              width: '100%', minHeight: 80, maxHeight: 200, resize: 'vertical',
              background: c.bgPanel, border: `1px solid ${c.borderInput}`, borderRadius: 4,
              color: c.text, padding: 10, fontSize: 12, fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: tomResult ? 16 : 0 }}>
          <button
            style={{ ...btn(true), opacity: compressing || !tomStatus?.running ? 0.5 : 1 }}
            onClick={handleCompress}
            disabled={compressing || !tomStatus?.running}
          >
            {compressing ? 'Compressing...' : 'Compress'}
          </button>
          {tomResult && (
            <span style={{ fontSize: 11, color: c.textMuted }}>
              {tomResult.original_chars} → {tomResult.compressed_chars} chars
              ({(tomResult.ratio * 100).toFixed(1)}% saved)
              | Layers: {tomResult.layers.join(', ')}
              {tomResult.cache_hit && ' | Cache hit'}
            </span>
          )}
        </div>

        {tomResult && (
          <div style={{
            background: c.bgPanel, border: `1px solid ${c.border}`, borderRadius: 6,
            padding: 14, fontSize: 12, color: c.text, whiteSpace: 'pre-wrap', lineHeight: 1.5,
          }}>
            {tomResult.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Repos Panel ─────────────────────────────────────────────
function ReposPanel() {
  const { theme } = useTheme();
  const c = colors[theme];
  const styles = makeStyles(c);

  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRepos = () => {
    fetchRepos().then(r => { setRepos(r); setLoaded(true); }).catch(() => setLoaded(true));
  };

  useEffect(() => { loadRepos(); }, []);

  const handleAdd = async () => {
    if (!addInput.trim()) return;
    setAdding(true);
    setError(null);
    const result = await apiAddRepo(addInput.trim(), addName.trim() || undefined);
    if (result.ok) {
      setAddInput('');
      setAddName('');
      loadRepos();
    } else {
      setError(result.error ?? 'Failed to add repo');
    }
    setAdding(false);
  };

  const handleRemove = async (name: string) => {
    const result = await apiRemoveRepo(name);
    if (result.ok) {
      loadRepos();
    } else {
      setError(result.error ?? 'Failed to remove repo');
    }
  };

  const card: React.CSSProperties = {
    background: c.bgCard,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  };

  const inputStyle: React.CSSProperties = {
    background: c.bgPanel,
    border: `1px solid ${c.borderInput}`,
    borderRadius: 4,
    color: c.text,
    padding: '8px 12px',
    fontSize: 12,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const btn = (primary = false): React.CSSProperties => ({
    padding: '8px 16px',
    border: `1px solid ${primary ? c.accent : c.border}`,
    borderRadius: 4,
    background: primary ? c.accent : c.bgPanel,
    color: primary ? '#fff' : c.text,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 500,
  });

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%', maxWidth: 900, margin: '0 auto' }}>
      {/* Add repo form */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 16 }}>Add Repository</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <div style={{ fontSize: 10, color: c.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              URL or local path
            </div>
            <input
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              placeholder="https://github.com/user/repo.git or /path/to/repo"
              style={{ ...inputStyle, width: '100%' }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: 10, color: c.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              Name (optional)
            </div>
            <input
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="custom-name"
              style={{ ...inputStyle, width: '100%' }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button style={{ ...btn(true), opacity: adding ? 0.5 : 1 }} onClick={handleAdd} disabled={adding}>
            {adding ? 'Adding...' : 'Add Repo'}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 4, fontSize: 11, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Repo list */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Registered Repos</div>
          <span style={{ fontSize: 11, color: c.textMuted }}>{repos.length} repos</span>
        </div>

        {!loaded ? (
          <div style={{ color: c.textDimmer, fontSize: 11 }}>Loading repos...</div>
        ) : repos.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>{'\u{1F4C2}'}</div>
            <div>No repos registered</div>
            <div style={{ fontSize: 11 }}>
              Add one above or use <code style={{ color: c.accent }}>nanoprym repo add &lt;url|path&gt;</code>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {repos.map(repo => (
              <div key={repo.name} style={{
                background: c.bgPanel,
                border: `1px solid ${c.border}`,
                borderRadius: 6,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: '#22c55e',
                  boxShadow: '0 0 6px #22c55e',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{repo.name}</div>
                  <div style={{ fontSize: 11, color: c.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {repo.repoPath}
                  </div>
                  {repo.repoUrl && (
                    <div style={{ fontSize: 10, color: c.textDim, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {repo.repoUrl}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 3, fontWeight: 600,
                    background: repo.cloned ? 'rgba(96,165,250,0.15)' : 'rgba(167,139,250,0.15)',
                    color: repo.cloned ? '#60a5fa' : c.accent,
                  }}>
                    {repo.cloned ? 'cloned' : 'local'}
                  </span>
                  <span style={{ fontSize: 10, color: c.textDimmer }}>
                    {new Date(repo.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleRemove(repo.name)}
                    style={{
                      background: 'none', border: `1px solid ${c.border}`, borderRadius: 4,
                      color: c.textDim, cursor: 'pointer', fontSize: 11, padding: '3px 8px',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.color = c.textDim; }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('nanoprym-theme', next); } catch { /* */ }
      return next;
    });
  }, []);

  const c = colors[theme];
  const styles = makeStyles(c);

  const initialRoute = parseRoute();
  const [activeTab, setActiveTab] = useState<TabId>(initialRoute.tab);
  const [events, setEvents] = useState<EventMessage[]>([]);
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<string | null>(initialRoute.filter);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialRoute.taskId);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hideSnapshots, setHideSnapshots] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<EventMessage | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const eventListRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Sync URL when tab/filter changes
  const navigate = useCallback((tab: TabId, f: string | null, taskId?: string | null) => {
    const p = buildPath(tab, f, taskId);
    if (window.location.pathname !== p) {
      window.history.pushState(null, '', p);
    }
  }, []);

  const handleSetTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setSelectedTaskId(null);
    const f = tab === 'health' || tab === 'tasks' || tab === 'repos' ? null : filter;
    navigate(tab, f);
  }, [filter, navigate]);

  const handleSetFilter = useCallback((f: string | null) => {
    setFilter(f);
    navigate('events', f);
  }, [navigate]);

  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    navigate('tasks', null, taskId);
  }, [navigate]);

  const handleBackToTasks = useCallback(() => {
    setSelectedTaskId(null);
    navigate('tasks', null);
  }, [navigate]);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const route = parseRoute();
      setActiveTab(route.tab);
      setFilter(route.filter);
      setSelectedTaskId(route.taskId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Fetch initial events + status
  useEffect(() => {
    fetchEvents({ limit: '200' }).then(setEvents).catch(() => {});
    fetchStatus().then(setStatus).catch(() => {});

    const statusInterval = setInterval(() => {
      fetchStatus().then(setStatus).catch(() => {});
    }, 5000);

    return () => clearInterval(statusInterval);
  }, []);

  // SSE connection
  useEffect(() => {
    const sse = new EventSource(`${API_BASE}/api/events/stream`);
    sseRef.current = sse;

    sse.onopen = () => setConnected(true);
    sse.onerror = () => setConnected(false);

    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') return;

        setEvents(prev => [...prev, msg]);
        setNewIds(prev => {
          const next = new Set(prev);
          next.add(msg.id);
          setTimeout(() => {
            setNewIds(p => {
              const n = new Set(p);
              n.delete(msg.id);
              return n;
            });
          }, 2000);
          return next;
        });
      } catch { /* ignore */ }
    };

    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && eventListRef.current) {
      eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!eventListRef.current) return;
    const el = eventListRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  // Filtered events
  const filteredEvents = events.filter(e => {
    if (hideSnapshots && e.topic === 'STATE_SNAPSHOT') return false;
    if (filter && e.topic !== filter) return false;
    return true;
  });

  // Topic counts
  const topicCounts: Record<string, number> = {};
  for (const e of events) {
    if (hideSnapshots && e.topic === 'STATE_SNAPSHOT') continue;
    topicCounts[e.topic] = (topicCounts[e.topic] ?? 0) + 1;
  }

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatUptime = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle: toggleTheme }}>
    <div style={styles.app}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoText}>NANOPRYM</span>
          <span style={styles.version}>v{status?.version ?? '0.1.0'}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['events', 'tasks', 'repos', 'tools', 'health'] as TabId[]).map(tab => (
            <button
              key={tab}
              onClick={() => handleSetTab(tab)}
              style={{
                padding: '4px 14px', border: 'none', borderRadius: 4,
                background: activeTab === tab ? c.bgCard : 'transparent',
                color: activeTab === tab ? c.accent : c.textDim,
                cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
          <button
            onClick={toggleTheme}
            style={styles.themeToggle}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '\u2600\uFE0F' : '\u{1F319}'}
          </button>
        </div>
        <div style={styles.statusBar}>
          <span>
            <span style={styles.statusDot(connected)} />
            {connected ? 'Live' : 'Disconnected'}
          </span>
          {status && (
            <>
              <span>Uptime: {formatUptime(status.uptime)}</span>
              <span>Events: {events.length}</span>
              {status.activeTask && <span style={{ color: '#facc15' }}>Task Active</span>}
            </>
          )}
        </div>
      </div>

      <div style={styles.body}>
        {activeTab === 'health' ? (
          <HealthPanel />
        ) : activeTab === 'repos' ? (
          <ReposPanel />
        ) : activeTab === 'tools' ? (
          <ToolsPanel />
        ) : activeTab === 'tasks' ? (
          selectedTaskId ? (
            <TaskDetailView taskId={selectedTaskId} onBack={handleBackToTasks} />
          ) : (
            <TaskQueue onSelectTask={handleSelectTask} />
          )
        ) : (
        <>
        {/* Sidebar — Topic Filters */}
        <div style={styles.sidebar}>
          <div style={styles.sidebarSection}>Filters</div>
          <button
            style={styles.filterBtn(filter === null, '#a78bfa')}
            onClick={() => handleSetFilter(null)}
          >
            All Events
            <span style={styles.filterCount}>{filteredEvents.length}</span>
          </button>

          {Object.entries(TOPIC_CONFIG)
            .filter(([key]) => !hideSnapshots || key !== 'STATE_SNAPSHOT')
            .map(([key, cfg]) => (
              <button
                key={key}
                style={styles.filterBtn(filter === key, cfg.color)}
                onClick={() => handleSetFilter(filter === key ? null : key)}
              >
                <span>{cfg.icon}</span>
                <span>{cfg.label}</span>
                <span style={styles.filterCount}>{topicCounts[key] ?? 0}</span>
              </button>
            ))
          }

          <div style={{ ...styles.sidebarSection, marginTop: 16 }}>Options</div>
          <button
            style={styles.filterBtn(hideSnapshots, '#6b7280')}
            onClick={() => setHideSnapshots(!hideSnapshots)}
          >
            Hide Snapshots
          </button>
          <button
            style={styles.filterBtn(autoScroll, '#6b7280')}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            Auto-scroll
          </button>
        </div>

        {/* Main — Event Stream */}
        <div style={styles.main}>
          {/* Stats */}
          {status && (
            <div style={styles.statsRow}>
              <div style={styles.statCard}>
                <div style={{ ...styles.statValue, color: status.status === 'ok' ? '#22c55e' : '#ef4444' }}>
                  {status.status.toUpperCase()}
                </div>
                <div style={styles.statLabel}>Health</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statValue}>{events.length}</div>
                <div style={styles.statLabel}>Events</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statValue}>{Object.keys(topicCounts).length}</div>
                <div style={styles.statLabel}>Topics</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statValue, color: status.activeTask ? '#facc15' : '#6b7280' }}>
                  {status.activeTask ? 'YES' : 'NO'}
                </div>
                <div style={styles.statLabel}>Active Task</div>
              </div>
            </div>
          )}

          {/* Column Headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 28px 160px 100px 1fr',
            gap: 8,
            padding: '6px 16px',
            borderBottom: `1px solid ${c.border}`,
            color: c.textDimmer,
            fontSize: 10,
            textTransform: 'uppercase' as const,
            letterSpacing: 1,
            fontWeight: 600,
            minHeight: 28,
            alignItems: 'center',
          }}>
            <span>Time</span>
            <span></span>
            <span>Topic</span>
            <span>Sender</span>
            <span>Message</span>
          </div>

          {/* Event Rows */}
          <div
            ref={eventListRef}
            style={styles.eventList}
            onScroll={handleScroll}
          >
            {filteredEvents.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>{'\u{1F4E1}'}</div>
                <div>Waiting for events...</div>
                <div style={{ fontSize: 11 }}>
                  {connected
                    ? 'Start the daemon with `nanoprym serve`, then submit tasks via API'
                    : 'Start the daemon with `nanoprym serve`'}
                </div>
              </div>
            ) : (
              filteredEvents.map(event => {
                const cfg = getTopicConfig(event.topic);
                const isSelected = selectedEvent?.id === event.id;
                return (
                  <div
                    key={event.id}
                    style={{
                      ...styles.eventRow(newIds.has(event.id)),
                      cursor: 'pointer',
                      background: isSelected
                        ? c.highlightStrong
                        : newIds.has(event.id)
                          ? c.highlight
                          : 'transparent',
                    }}
                    onClick={() => setSelectedEvent(isSelected ? null : event)}
                  >
                    <span style={styles.eventTime}>{formatTime(event.timestamp)}</span>
                    <span style={styles.eventIcon}>{cfg.icon}</span>
                    <span style={styles.eventTopic(cfg.color)}>{event.topic}</span>
                    <span style={styles.eventSender}>{event.sender}</span>
                    <span style={styles.eventText}>
                      {event.text.slice(0, 200).replace(/\n/g, ' ')}
                      {event.text.length > 200 ? '...' : ''}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedEvent && (
          <div style={styles.detailPanel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: c.accent }}>Event Detail</span>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: c.textDim,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontFamily: 'inherit',
                }}
              >
                {'\u2715'}
              </button>
            </div>

            <div style={styles.detailLabel}>ID</div>
            <div style={styles.detailValue}>{selectedEvent.id}</div>

            <div style={styles.detailLabel}>Task ID</div>
            <div style={styles.detailValue}>{selectedEvent.taskId}</div>

            <div style={styles.detailLabel}>Topic</div>
            <div style={{
              ...styles.detailValue,
              color: getTopicConfig(selectedEvent.topic).color,
            }}>
              {getTopicConfig(selectedEvent.topic).icon} {selectedEvent.topic}
            </div>

            <div style={styles.detailLabel}>Sender</div>
            <div style={{ ...styles.detailValue, color: c.link }}>{selectedEvent.sender}</div>

            <div style={styles.detailLabel}>Timestamp</div>
            <div style={styles.detailValue}>{new Date(selectedEvent.timestamp).toLocaleString()}</div>

            <div style={styles.detailLabel}>Message</div>
            <div style={{
              ...styles.detailValue,
              whiteSpace: 'pre-wrap',
              maxHeight: 200,
              overflow: 'auto',
            }}>
              {selectedEvent.text}
            </div>

            {selectedEvent.data && Object.keys(selectedEvent.data).length > 0 && (
              <>
                <div style={styles.detailLabel}>Data</div>
                <pre style={styles.jsonBlock}>
                  {JSON.stringify(selectedEvent.data, null, 2)}
                </pre>
              </>
            )}

            {selectedEvent.metadata && Object.keys(selectedEvent.metadata).length > 0 && (
              <>
                <div style={styles.detailLabel}>Metadata</div>
                <pre style={styles.jsonBlock}>
                  {JSON.stringify(selectedEvent.metadata, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
        </>
        )}
      </div>
    </div>
    </ThemeContext.Provider>
  );
}
