import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Star, GitFork, Eye, AlertCircle, MapPin, Building2,
  Link as LinkIcon, Calendar, BookOpen, Activity, BarChart3,
  Moon, Sun, Key, ExternalLink, X, Clock, GitCommit,
  GitPullRequest, Tag, Sparkles, RefreshCw, ChevronRight, Code2
} from 'lucide-react';

// --- TYPES ---
interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  bio: string | null;
  twitter_username: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  pushed_at: string;
  updated_at: string;
  default_branch: string;
}

interface GitHubEvent {
  id: string;
  type: string;
  repo: { name: string; url: string };
  payload: any;
  created_at: string;
}

interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

const NOTABLE_PROFILES = [
  'PixelPioneer08-oss',
  'torvalds',
  'gaearon',
  'yyx990803',
  'shadcn',
  'sindresorhus',
  'vercel'
];

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Java: '#b07219',
  'C++': '#f34b7d',
  Dart: '#00B4AB',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Go: '#00ADD8',
  Rust: '#dea584',
  Shell: '#89e051',
  Vue: '#41b883',
  Other: '#8b949e',
};

// --- HELPER FUNCTIONS ---
function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  const intervals: [number, string][] = [
    [31536000, 'y'],
    [2592000, 'mo'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count}${label} ago`;
  }
  return 'just now';
}

// Lightweight Markdown-to-JSX Renderer for README Drawer
function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-3 text-sm leading-relaxed break-words">
      {lines.map((line, idx) => {
        if (line.startsWith('# '))
          return <h1 key={idx} className="text-xl font-bold border-b pb-1 border-zinc-700/50 mt-4">{line.slice(2)}</h1>;
        if (line.startsWith('## '))
          return <h2 key={idx} className="text-lg font-semibold border-b pb-1 border-zinc-700/40 mt-3">{line.slice(3)}</h2>;
        if (line.startsWith('### '))
          return <h3 key={idx} className="text-base font-semibold mt-2">{line.slice(4)}</h3>;
        if (line.startsWith('- ') || line.startsWith('* '))
          return <li key={idx} className="ml-5 list-disc">{line.slice(2)}</li>;
        if (line.startsWith('```'))
          return <div key={idx} className="border-t border-zinc-700/50 my-1" />;
        if (!line.trim())
          return <div key={idx} className="h-1" />;
        return <p key={idx} className="opacity-90">{line}</p>;
      })}
    </div>
  );
}

export default function App() {
  // --- STATE ---
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [searchInput, setSearchInput] = useState<string>('');
  const [activeUsername, setActiveUsername] = useState<string>('PixelPioneer08-oss');
  const [token, setToken] = useState<string>(() => localStorage.getItem('gh_explorer_token') || '');
  const [showTokenModal, setShowTokenModal] = useState<boolean>(false);

  const [user, setUser] = useState<GitHubUser null |>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [events, setEvents] = useState<GitHubEvent[]>([]);
  const [rateLimit, setRateLimit] = useState<RateLimit null |>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<{ type: 'not_found' | 'rate_limit' | 'generic'; message: string } | null>(null);

  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('gh_recent_searches') || '["PixelPioneer08-oss", "torvalds"]');
    } catch {
      return ['PixelPioneer08-oss', 'torvalds'];
    }
  });

  // Repo Browser Filters
  const [repoQuery, setRepoQuery] = useState<string>('');
  const [repoSort, setRepoSort] = useState<'stars' | 'updated' | 'name'>('stars');
  const [repoLang, setRepoLang] = useState<string>('ALL');

  // README Drawer
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo null |>(null);
  const [readmeContent, setReadmeContent] = useState<string>('');
  const [readmeLoading, setReadmeLoading] = useState<boolean>(false);

  // Active Section Tab
  const [activeTab, setActiveTab] = useState<'repos' | 'activity' | 'analytics'>('repos');

  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- INITIAL URL PARAMS & KEYBOARD SHORTCUT ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlUser = params.get('user');
    if (urlUser) {
      setActiveUsername(urlUser);
      setSearchInput(urlUser);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSelectedRepo(null);
        setShowTokenModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- FETCH GITHUB DATA ---
  useEffect(() => {
    if (!activeUsername) return;
    let isMounted = true;

    async function fetchProfileData() {
      setLoading(true);
      setError(null);

      // Update shareable URL query parameter
      const newUrl = `${window.location.pathname}?user=${encodeURIComponent(activeUsername)}`;
      window.history.replaceState({}, '', newUrl);

      const headers: HeadersInit = {
        Accept: 'application/vnd.github+json',
      };
      if (token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
      }

      try {
        const [userRes, reposRes, eventsRes] = await Promise.all([
          fetch(`[https://api.github.com/users/$](https://api.github.com/users/$){encodeURIComponent(activeUsername)}`, { headers }),
          fetch(`[https://api.github.com/users/$](https://api.github.com/users/$){encodeURIComponent(activeUsername)}/repos?per_page=100&sort=updated`, { headers }),
          fetch(`[https://api.github.com/users/$](https://api.github.com/users/$){encodeURIComponent(activeUsername)}/events/public?per_page=100`, { headers }),
        ]);

        // Extract Rate Limit headers
        const limit = Number(userRes.headers.get('x-ratelimit-limit') || 60);
        const remaining = Number(userRes.headers.get('x-ratelimit-remaining') || 0);
        const reset = Number(userRes.headers.get('x-ratelimit-reset') || 0);
        if (isMounted) setRateLimit({ limit, remaining, reset });

        if (userRes.status === 404) {
          if (isMounted) {
            setError({
              type: 'not_found',
              message: `GitHub user "@${activeUsername}" could not be found.`,
            });
            setUser(null);
          }
          return;
        }

        if (userRes.status === 403 || userRes.status === 429) {
          const resetTime = reset ? new Date(reset * 1000).toLocaleTimeString() : 'soon';
          if (isMounted) {
            setError({
              type: 'rate_limit',
              message: `GitHub API rate limit exceeded. Quota resets at ${resetTime}. Add a Personal Access Token to raise your limit to 5,000 req/hr.`,
            });
          }
          return;
        }

        if (!userRes.ok) {
          throw new Error(`GitHub API returned status ${userRes.status}`);
        }

        const userData: GitHubUser = await userRes.json();
        const reposData: GitHubRepo[] = reposRes.ok ? await reposRes.json() : [];
        const eventsData: GitHubEvent[] = eventsRes.ok ? await eventsRes.json() : [];

        if (isMounted) {
          setUser(userData);
          setRepos(Array.isArray(reposData) ? reposData : []);
          setEvents(Array.isArray(eventsData) ? eventsData : []);

          // Save to recent searches
          setRecentSearches((prev) => {
            const updated = [userData.login, ...prev.filter((u) => u.toLowerCase() !== userData.login.toLowerCase())].slice(0, 8);
            localStorage.setItem('gh_recent_searches', JSON.stringify(updated));
            return updated;
          });
        }
      } catch (err: any) {
        if (isMounted) {
          setError({
            type: 'generic',
            message: err?.message || 'Failed to connect to GitHub API.',
          });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchProfileData();
    return () => {
      isMounted = false;
    };
  }, [activeUsername, token]);

  // --- FETCH README FOR DRAWER ---
  useEffect(() => {
    if (!selectedRepo) return;
    let isMounted = true;

    async function fetchReadme() {
      setReadmeLoading(true);
      setReadmeContent('');
      const headers: HeadersInit = {
        Accept: 'application/vnd.github.raw+json',
      };
      if (token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
      }

      try {
        const res = await fetch(
          `[https://api.github.com/repos/$](https://api.github.com/repos/$){selectedRepo?.full_name}/readme`,
          { headers }
        );
        if (res.ok) {
          const text = await res.text();
          if (isMounted) setReadmeContent(text);
        } else {
          if (isMounted) setReadmeContent('*No README.md found in this repository.*');
        }
      } catch {
        if (isMounted) setReadmeContent('*Unable to load README.md.*');
      } finally {
        if (isMounted) setReadmeLoading(false);
      }
    }

    fetchReadme();
    return () => {
      isMounted = false;
    };
  }, [selectedRepo, token]);

  // --- AGGREGATED STATS & ANALYTICS ---
  const stats = useMemo(() => {
    let totalStars = 0;
    let totalForks = 0;
    let totalWatchers = 0;
    let totalIssues = 0;
    const langCounts: Record<string, number> = {};

    repos.forEach((r) => {
      totalStars += r.stargazers_count;
      totalForks += r.forks_count;
      totalWatchers += r.watchers_count;
      totalIssues += r.open_issues_count;
      if (r.language) {
        langCounts[r.language] = (langCounts[r.language] || 0) + 1;
      }
    });

    const totalLangRepos = Object.values(langCounts).reduce((a, b) => a + b, 0) || 1;
    const languages = Object.entries(langCounts)
      .map(([name, count]) => ({
        name,
        count,
        percent: Math.round((count / totalLangRepos) * 100),
        color: LANGUAGE_COLORS[name] || LANGUAGE_COLORS.Other,
      }))
      .sort((a, b) => b.count - a.count);

    const topRepos = [...repos]
      .sort((a, b) => b.stargazers_count - a.stargazers_count || b.forks_count - a.forks_count)
      .slice(0, 6);

    return { totalStars, totalForks, totalWatchers, totalIssues, languages, topRepos };
  }, [repos]);

  // --- FILTERED & SORTED REPOS ---
  const filteredRepos = useMemo(() => {
    return repos
      .filter((r) => {
        const matchesLang = repoLang === 'ALL' || r.language === repoLang;
        const q = repoQuery.toLowerCase();
        const matchesQuery =
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q)) ||
          (r.topics && r.topics.some((t) => t.toLowerCase().includes(q)));
        return matchesLang && matchesQuery;
      })
      .sort((a, b) => {
        if (repoSort === 'stars') return b.stargazers_count - a.stargazers_count;
        if (repoSort === 'updated') return new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime();
        return a.name.localeCompare(b.name);
      });
  }, [repos, repoQuery, repoSort, repoLang]);

  // --- HEATMAP DATA (LAST 16 WEEKS OF PUBLIC ACTIVITY) ---
  const heatmapDays = useMemo(() => {
    const countsByDate: Record<string, number> = {};
    events.forEach((ev) => {
      const day = ev.created_at.slice(0, 10);
      const weight = ev.type === 'PushEvent' ? (ev.payload?.commits?.length || 1) : 1;
      countsByDate[day] = (countsByDate[day] || 0) + weight;
    });

    const days: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 111; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      days.push({ date: iso, count: countsByDate[iso] || 0 });
    }
    return days;
  }, [events]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setActiveUsername(searchInput.trim());
    }
  };

  const saveToken = (newToken: string) => {
    setToken(newToken);
    localStorage.setItem('gh_explorer_token', newToken);
    setShowTokenModal(false);
  };

  return (
    <div className={darkMode ? 'min-h-screen bg-zinc-950 text-zinc-100' : 'min-h-screen bg-slate-50 text-slate-900'}>
      {/* TOP NAVBAR */}
      <header className={`sticky top-0 z-30 border-b backdrop-blur-md ${darkMode ? 'bg-zinc-950/85 border-zinc-800' : 'bg-white/85 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-600 text-white">
              <Code2 className="w-5 h-5"/>
            </div>
            <div>
              <span className="font-bold tracking-tight text-lg">GitPulse</span>
              <span className="hidden sm:inline-block ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Profile Explorer
              </span>
            </div>
          </div>

          {/* SEARCH BAR */}
          <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 opacity-50"/>
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search GitHub username... (Press /)"
              aria-label="Search GitHub username"
              className={`w-full pl-10 pr-16 py-2 text-sm rounded-lg border outline-none transition ${
                darkMode
                  ? 'bg-zinc-900 border-zinc-800 focus:border-indigo-500 text-zinc-100'
                  : 'bg-slate-100 border-slate-300 focus:border-indigo-600 text-slate-900'
              }`}
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition"
            >
              Load
            </button>
          </form>

          {/* ACTIONS & RATE LIMIT */}
          <div className="flex items-center gap-2">
            {rateLimit && (
              <div className="hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/40">
                <span className={rateLimit.remaining < 10 ? 'text-amber-400 font-semibold' : 'opacity-70'}>
                  API: {rateLimit.remaining}/{rateLimit.limit}
                </span>
              </div>
            )}

            <button
              onClick={() => setShowTokenModal(true)}
              title="Configure GitHub Personal Access Token"
              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition ${
                token
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : darkMode
                  ? 'border-zinc-800 hover:bg-zinc-900'
                  : 'border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Key className="w-3.5 h-3.5"/>
              <span className="hidden sm:inline">{token ? 'Token Active' : 'API Token'}</span>
            </button>

            <button
              onClick={() => setDarkMode(!darkMode)}
              aria-label="Toggle Theme"
              className={`p-2 rounded-lg border transition ${
                darkMode ? 'border-zinc-800 hover:bg-zinc-900 text-zinc-300' : 'border-slate-200 hover:bg-slate-100 text-slate-700'
              }`}
            >
              {darkMode ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}
            </button>
          </div>
        </div>
      </header>

      {/* EXPLORE / QUICK-TRY & RECENT SEARCHES BAR */}
      <section className={`border-b ${darkMode ? 'bg-zinc-900/40 border-zinc-800/80' : 'bg-slate-100/70 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium opacity-60 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400"/> Notable:
            </span>
            {NOTABLE_PROFILES.map((prof) => (
              <button
                key={prof}
                onClick={() => {
                  setSearchInput(prof);
                  setActiveUsername(prof);
                }}
                className={`px-2.5 py-1 rounded-full transition font-medium ${
                  activeUsername.toLowerCase() === prof.toLowerCase()
                    ? 'bg-indigo-600 text-white'
                    : darkMode
                    ? 'bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300'
                    : 'bg-white hover:bg-slate-200 text-slate-700 shadow-sm'
                }`}
              >
                @{prof}
              </button>
            ))}
          </div>

          {recentSearches.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="opacity-60 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5"/> Recent:
              </span>
              {recentSearches.slice(0, 5).map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setSearchInput(item);
                    setActiveUsername(item);
                  }}
                  className={`px-2 py-0.5 rounded border transition ${
                    darkMode ? 'border-zinc-800 bg-zinc-900 hover:border-zinc-700' : 'border-slate-300 bg-white hover:bg-slate-100'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* LOADING SKELETON */}
        {loading && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
            <div className={`lg:col-span-4 h-96 rounded-2xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-slate-200 border-slate-300'}`} />
            <div className="lg:col-span-8 space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className={`h-24 rounded-xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-slate-200 border-slate-300'}`} />
                ))}
              </div>
              <div className={`h-72 rounded-2xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-slate-200 border-slate-300'}`} />
            </div>
          </div>
        )}

        {/* ERROR STATE */}
        {!loading && error && (
          <div className={`max-w-lg mx-auto my-12 p-6 rounded-2xl border text-center space-y-4 ${
            darkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6"/>
            </div>
            <h2 className="text-lg font-bold">
              {error.type === 'not_found' ? 'User Not Found' : error.type === 'rate_limit' ? 'API Rate Limit Reached' : 'Request Error'}
            </h2>
            <p className="text-sm opacity-75">{error.message}</p>
            <div className="flex justify-center gap-3 pt-2">
              {error.type === 'rate_limit' && (
                <button
                  onClick={() => setShowTokenModal(true)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  Add GitHub Token
                </button>
              )}
              <button
                onClick={() => setActiveUsername('PixelPioneer08-oss')}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-700 hover:bg-zinc-800"
              >
                Load Default Profile
              </button>
            </div>
          </div>
        )}

        {/* PROFILE LOADED */}
        {!loading && !error && user && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* LEFT SIDEBAR: PROFILE CARD */}
            <aside className="lg:col-span-4 space-y-6">
              <div className={`p-6 rounded-2xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
                  <img
                    src={user.avatar_url}
                    alt={user.login}
                    className="w-28 h-28 rounded-full border-2 border-indigo-500/40 shadow-lg mb-4"
                  />
                  <h1 className="text-2xl font-bold tracking-tight">{user.name || user.login}</h1>
                  <a
                    href={user.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 hover:underline text-sm font-medium flex items-center gap-1"
                  >
                    @{user.login} <ExternalLink className="w-3.5 h-3.5"/>
                  </a>
                  {user.bio && <p className="mt-3 text-sm opacity-85 leading-relaxed">{user.bio}</p>}
                </div>

                {/* FOLLOWERS / FOLLOWING / REPOS PILLS */}
                <div className="grid grid-cols-3 gap-2 my-6 pt-4 border-t border-zinc-800/60 text-center">
                  <div className={`p-2.5 rounded-xl ${darkMode ? 'bg-zinc-950/60' : 'bg-slate-100'}`}>
                    <div className="text-lg font-bold">{user.followers.toLocaleString()}</div>
                    <div className="text-[11px] opacity-60">Followers</div>
                  </div>
                  <div className={`p-2.5 rounded-xl ${darkMode ? 'bg-zinc-950/60' : 'bg-slate-100'}`}>
                    <div className="text-lg font-bold">{user.following.toLocaleString()}</div>
                    <div className="text-[11px] opacity-60">Following</div>
                  </div>
                  <div className={`p-2.5 rounded-xl ${darkMode ? 'bg-zinc-950/60' : 'bg-slate-100'}`}>
                    <div className="text-lg font-bold">{user.public_repos.toLocaleString()}</div>
                    <div className="text-[11px] opacity-60">Repos</div>
                  </div>
                </div>

                {/* METADATA LIST */}
                <div className="space-y-2.5 text-sm opacity-85">
                  {user.company && (
                    <div className="flex items-center gap-2.5">
                      <Building2 className="w-4 h-4 opacity-60 shrink-0"/>
                      <span>{user.company}</span>
                    </div>
                  )}
                  {user.location && (
                    <div className="flex items-center gap-2.5">
                      <MapPin className="w-4 h-4 opacity-60 shrink-0"/>
                      <span>{user.location}</span>
                    </div>
                  )}
                  {user.blog && (
                    <div className="flex items-center gap-2.5 truncate">
                      <LinkIcon className="w-4 h-4 opacity-60 shrink-0"/>
                      <a
                        href={user.blog.startsWith('http') ? user.blog : `https://${user.blog}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline truncate"
                      >
                        {user.blog}
                      </a>
                    </div>
                  )}
                  {user.twitter_username && (
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 text-center font-bold opacity-60">𝕏</span>
                      <a
                        href={`[https://twitter.com/$](https://twitter.com/$){user.twitter_username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline"
                      >
                        @{user.twitter_username}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-4 h-4 opacity-60 shrink-0"/>
                    <span>Joined {new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
              </div>

              {/* LANGUAGE DISTRIBUTION MINI CARD */}
              <div className={`p-6 rounded-2xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                <h3 className="text-sm font-semibold mb-3">Language Distribution</h3>
                {stats.languages.length === 0 ? (
                  <p className="text-xs opacity-60">No language data detected.</p>
                ) : (
                  <>
                    <div className="h-2.5 w-full rounded-full overflow-hidden flex mb-4 bg-zinc-800">
                      {stats.languages.map((l) => (
                        <div
                          key={l.name}
                          style={{ width: `${l.percent}%`, backgroundColor: l.color }}
                          title={`${l.name}: ${l.percent}%`}
                        />
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {stats.languages.slice(0, 6).map((l) => (
                        <div key={l.name} className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                            {l.name}
                          </span>
                          <span className="opacity-60">{l.percent}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </aside>

            {/* RIGHT MAIN COLUMN */}
            <div className="lg:col-span-8 space-y-6">
              {/* 2. PROFILE STATS DASHBOARD */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Total Stars', value: stats.totalStars, icon: Star, color: 'text-amber-400' },
                  { label: 'Total Forks', value: stats.totalForks, icon: GitFork, color: 'text-indigo-400' },
                  { label: 'Watchers', value: stats.totalWatchers, icon: Eye, color: 'text-emerald-400' },
                  { label: 'Open Issues', value: stats.totalIssues, icon: AlertCircle, color: 'text-rose-400' },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`p-4 rounded-2xl border flex items-center justify-between ${
                      darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'
                    }`}
                  >
                    <div>
                      <div className="text-xs opacity-60">{item.label}</div>
                      <div className="text-2xl font-bold mt-1">{item.value.toLocaleString()}</div>
                    </div>
                    <item.icon className={`w-6 h-6 ${item.color}`} />
                  </div>
                ))}
              </div>

              {/* NAVIGATION TABS */}
              <div className="flex border-b border-zinc-800 gap-2">
                {[
                  { id: 'repos', label: `Repositories (${repos.length})`, icon: BookOpen },
                  { id: 'activity', label: `Recent Activity (${events.length})`, icon: Activity },
                  { id: 'analytics', label: 'Visual Analytics', icon: BarChart3 },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as any)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
                      activeTab === t.id
                        ? 'border-indigo-500 text-indigo-400'
                        : 'border-transparent opacity-65 hover:opacity-100'
                    }`}
                  >
                    <t.icon className="w-4 h-4" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* TAB 1: REPOSITORY BROWSER */}
              {activeTab === 'repos' && (
                <div className="space-y-4">
                  {/* FILTER CONTROLS */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50"/>
                      <input
                        type="text"
                        value={repoQuery}
                        onChange={(e) => setRepoQuery(e.target.value)}
                        placeholder="Filter repositories by name, description, or topic..."
                        className={`w-full pl-9 pr-4 py-2 text-sm rounded-xl border outline-none ${
                          darkMode ? 'bg-zinc-900 border-zinc-800 focus:border-indigo-500' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>

                    <select
                      value={repoLang}
                      onChange={(e) => setRepoLang(e.target.value)}
                      aria-label="Filter by language"
                      className={`px-3 py-2 text-sm rounded-xl border outline-none ${
                        darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-300'
                      }`}
                    >
                      <option value="ALL">All Languages</option>
                      {stats.languages.map((l) => (
                        <option key={l.name} value={l.name}>
                          {l.name} ({l.count})
                        </option>
                      ))}
                    </select>

                    <select
                      value={repoSort}
                      onChange={(e) => setRepoSort(e.target.value as any)}
                      aria-label="Sort repositories"
                      className={`px-3 py-2 text-sm rounded-xl border outline-none ${
                        darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-300'
                      }`}
                    >
                      <option value="stars">Sort: Most Stars</option>
                      <option value="updated">Sort: Recently Pushed</option>
                      <option value="name">Sort: Name (A-Z)</option>
                    </select>
                  </div>

                  {/* REPO CARDS */}
                  {filteredRepos.length === 0 ? (
                    <div className="text-center py-12 opacity-60 text-sm">
                      No repositories match your current filter criteria.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredRepos.map((repo) => (
                        <div
                          key={repo.id}
                          onClick={() => setSelectedRepo(repo)}
                          className={`group cursor-pointer p-5 rounded-2xl border transition flex flex-col justify-between ${
                            darkMode
                              ? 'bg-zinc-900/40 border-zinc-800/90 hover:border-indigo-500/60 hover:bg-zinc-900/80'
                              : 'bg-white border-slate-200 hover:border-indigo-400 shadow-sm'
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-bold text-base group-hover:text-indigo-400 transition flex items-center gap-1.5">
                                {repo.name}
                                {repo.fork && (
                                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full border border-zinc-700 opacity-70">
                                    Fork
                                  </span>
                                )}
                              </h3>
                              <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-0.5 transition"/>
                            </div>
                            <p className="text-xs opacity-75 mt-1.5 line-clamp-2">
                              {repo.description || 'No description provided.'}
                            </p>

                            {repo.topics && repo.topics.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-3">
                                {repo.topics.slice(0, 4).map((topic) => (
                                  <span
                                    key={topic}
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                                  >
                                    {topic}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between text-xs opacity-75 mt-4 pt-3 border-t border-zinc-800/50">
                            <div className="flex items-center gap-3">
                              {repo.language && (
                                <span className="flex items-center gap-1">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: LANGUAGE_COLORS[repo.language] || LANGUAGE_COLORS.Other }}
                                  />
                                  {repo.language}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Star className="w-3.5 h-3.5 text-amber-400"/>
                                {repo.stargazers_count}
                              </span>
                              <span className="flex items-center gap-1">
                                <GitFork className="w-3.5 h-3.5"/>
                                {repo.forks_count}
                              </span>
                            </div>
                            <span>Updated {timeAgo(repo.pushed_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: RECENT ACTIVITY FEED */}
              {activeTab === 'activity' && (
                <div className="space-y-3">
                  {events.length === 0 ? (
                    <div className="text-center py-12 opacity-60 text-sm">
                      No public events found in the last 90 days.
                    </div>
                  ) : (
                    events.slice(0, 35).map((ev) => {
                      const commits = ev.payload?.commits || [];
                      return (
                        <div
                          key={ev.id}
                          className={`p-4 rounded-xl border flex items-start gap-3.5 ${
                            darkMode ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 mt-0.5">
                            {ev.type === 'PushEvent' ? (
                              <GitCommit className="w-4 h-4"/>
                            ) : ev.type === 'PullRequestEvent' ? (
                              <GitPullRequest className="w-4 h-4"/>
                            ) : ev.type === 'WatchEvent' ? (
                              <Star className="w-4 h-4 text-amber-400"/>
                            ) : (
                              <Tag className="w-4 h-4"/>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">
                                <span className="text-indigo-400">{ev.type.replace('Event', '')}</span> in{' '}
                                <a
                                  href={`[https://github.com/$](https://github.com/$){ev.repo.name}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold hover:underline"
                                >
                                  {ev.repo.name}
                                </a>
                              </span>
                              <span className="text-xs opacity-60 shrink-0">{timeAgo(ev.created_at)}</span>
                            </div>
                            {commits.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs opacity-80">
                                {commits.slice(0, 3).map((c: any) => (
                                  <li key={c.sha} className="truncate font-mono">
                                    <span className="text-indigo-400">{c.sha.slice(0, 7)}</span> — {c.message.split('\n')[0]}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* TAB 3: VISUAL ANALYTICS */}
              {activeTab === 'analytics' && (
                <div className="space-y-6">
                  {/* COMMIT CONTRIBUTION HEATMAP */}
                  <div className={`p-6 rounded-2xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-sm">Public Activity Heatmap (Last 16 Weeks)</h3>
                        <p className="text-xs opacity-60">Aggregated from public Push, PR, Issue & Release events</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-16 gap-1.5 overflow-x-auto pb-2" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>
                      {Array.from({ length: 16 }).map((_, weekIdx) => (
                        <div key={weekIdx} className="flex flex-col gap-1.5">
                          {heatmapDays.slice(weekIdx * 7, weekIdx * 7 + 7).map((d) => {
                            const bg =
                              d.count === 0
                                ? darkMode
                                  ? 'bg-zinc-800/70'
                                  : 'bg-slate-200'
                                : d.count === 1
                                ? 'bg-emerald-900 text-emerald-200'
                                : d.count <= 3
                                ? 'bg-emerald-700'
                                : 'bg-emerald-500';
                            return (
                              <div
                                key={d.date}
                                title={`${d.date}: ${d.count} public event(s)`}
                                className={`w-full aspect-square rounded-sm ${bg}`}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* REPOS BY STARS BAR CHART */}
                  <div className={`p-6 rounded-2xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-slate-200'}`}>
                    <h3 className="font-bold text-sm mb-4">Top Repositories by Stars & Activity</h3>
                    <div className="space-y-3">
                      {stats.topRepos.map((r) => {
                        const maxStars = Math.max(...stats.topRepos.map((x) => x.stargazers_count), 1);
                        const widthPct = Math.max(Math.round((r.stargazers_count / maxStars) * 100), 8);
                        return (
                          <div key={r.id} className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium">{r.name}</span>
                              <span className="opacity-70">★ {r.stargazers_count} · ⑂ {r.forks_count}</span>
                            </div>
                            <div className="h-2.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full transition-all"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* REPO DETAIL & README DRAWER */}
      {selectedRepo && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div
            className={`w-full max-w-2xl h-full overflow-y-auto p-6 border-l shadow-2xl ${
              darkMode ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-800">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  {selectedRepo.name}
                  <a
                    href={selectedRepo.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-normal px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 inline-flex items-center gap-1"
                  >
                    Open on GitHub <ExternalLink className="w-3 h-3"/>
                  </a>
                </h2>
                <p className="text-xs opacity-70 mt-1">{selectedRepo.description || 'No description'}</p>
              </div>
              <button
                onClick={() => setSelectedRepo(null)}
                className="p-1.5 rounded-lg hover:bg-zinc-800"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5"/>
              </button>
            </div>

            <div className="mt-6">
              <div className="text-xs uppercase tracking-wider opacity-50 font-semibold mb-3">README.md Preview</div>
              {readmeLoading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-sm opacity-60">
                  <RefreshCw className="w-4 h-4 animate-spin"/> Loading README...
                </div>
              ) : (
                <div className={`p-5 rounded-xl border ${darkMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                  <SimpleMarkdown content="{readmeContent}"/>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* OPTIONAL GITHUB TOKEN MODAL */}
      {showTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className={`w-full max-w-md p-6 rounded-2xl border shadow-xl ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-400"/> GitHub Personal Access Token
              </h3>
              <button onClick={() => setShowTokenModal(false)}>
                <X className="w-4 h-4 opacity-60"/>
              </button>
            </div>
            <p className="text-xs opacity-75 leading-relaxed mb-4">
              Anonymous requests are limited to 60 requests/hour. Adding a read-only Personal Access Token raises your rate limit to 5,000 requests/hour. Stored locally in your browser.
            </p>
            <input
              type="password"
              defaultValue={token}
              id="gh-token-input"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className={`w-full px-3 py-2 text-sm rounded-lg border outline-none mb-4 ${
                darkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-slate-100 border-slate-300'
              }`}
            />
            <div className="flex justify-end gap-2">
              {token && (
                <button
                  onClick={() => saveToken('')}
                  className="px-3 py-1.5 text-xs rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                >
                  Clear Token
                </button>
              )}
              <button
                onClick={() => {
                  const el = document.getElementById('gh-token-input') as HTMLInputElement;
                  saveToken(el?.value || '');
                }}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Save Token
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
