/**
 * Background service worker for Git Gladiators
 * Handles GitHub API calls with PAT authentication
 */

// --- Token management ---

async function getToken() {
  const result = await chrome.storage.local.get(['githubToken']);
  return result.githubToken || null;
}

async function saveToken(token) {
  await chrome.storage.local.set({ githubToken: token });
}

async function clearToken() {
  await chrome.storage.local.remove(['githubToken']);
}

// --- GitHub API helpers ---

function githubHeaders(token) {
  return {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function getWeekStartTimestamp(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return Math.floor(d.getTime() / 1000);
}

/**
 * Fetch contributor stats from multiple GitHub API sources
 */
async function fetchContributorStats(owner, repo) {
  const token = await getToken();

  if (!token) {
    return { status: 'no_token', message: 'GitHub token required for private repos' };
  }

  const headers = githubHeaders(token);
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    // Fetch stats/contributors and contributors list in parallel
    const [statsResponse, listResponse] = await Promise.all([
      fetch(`${baseUrl}/stats/contributors`, { headers }),
      fetch(`${baseUrl}/contributors?per_page=100`, { headers }).catch(() => null)
    ]);

    // Handle stats endpoint errors
    if (statsResponse.status === 202) {
      return { status: 'computing', message: 'GitHub is computing stats...' };
    }
    if (statsResponse.status === 401) {
      return { status: 'invalid_token', message: 'Invalid or expired token' };
    }
    if (statsResponse.status === 403) {
      const remaining = statsResponse.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        return { status: 'rate_limited', message: 'Rate limited. Try again later.' };
      }
      return { status: 'forbidden', message: 'Access forbidden. Check token permissions.' };
    }
    if (statsResponse.status === 404) {
      return { status: 'not_found', message: 'Repository not found or no access.' };
    }
    if (!statsResponse.ok) {
      return { status: 'error', message: `HTTP ${statsResponse.status}` };
    }

    const statsData = await statsResponse.json();
    const listData = listResponse?.ok ? await listResponse.json() : [];

    // Build contributor map from stats data
    const contributorMap = new Map();

    if (Array.isArray(statsData)) {
      for (const stat of statsData) {
        const login = stat.author?.login;
        if (!login) continue;

        contributorMap.set(login.toLowerCase(), {
          login,
          avatar: stat.author?.avatar_url || '',
          profileUrl: stat.author?.html_url || '',
          weeks: stat.weeks || []
        });
      }
    }

    // Merge missing contributors from the contributors list endpoint
    if (Array.isArray(listData)) {
      for (const c of listData) {
        if (!c.login) continue;
        const key = c.login.toLowerCase();
        if (!contributorMap.has(key)) {
          contributorMap.set(key, {
            login: c.login,
            avatar: c.avatar_url || '',
            profileUrl: c.html_url || '',
            weeks: [],
            totalCommits: c.contributions || 0
          });
        }
      }
    }

    if (contributorMap.size === 0) {
      return { status: 'empty', message: 'No contributor data available.' };
    }

    const contributors = Array.from(contributorMap.values());

    // Find contributors with commits but no diff stats (additions/deletions both 0)
    const needsDiffStats = contributors.filter(c => {
      const totalCommits = c.weeks.reduce((sum, w) => sum + (w.c || 0), 0) || c.totalCommits || 0;
      const totalAdd = c.weeks.reduce((sum, w) => sum + (w.a || 0), 0);
      const totalDel = c.weeks.reduce((sum, w) => sum + (w.d || 0), 0);
      return totalCommits > 0 && totalAdd === 0 && totalDel === 0;
    });

    // Fetch commit-level stats as fallback for contributors missing diff data
    if (needsDiffStats.length > 0) {
      await Promise.all(
        needsDiffStats.map(c => fillDiffStats(baseUrl, headers, c))
      );
    }

    return { status: 'success', data: contributors };

  } catch (error) {
    console.error('Error fetching contributor stats:', error);
    return { status: 'error', message: error.message };
  }
}

/**
 * Fill in missing diff stats by fetching individual commit details
 */
async function fillDiffStats(baseUrl, headers, contributor) {
  try {
    // Fetch recent commits for this user
    const commitsResponse = await fetch(
      `${baseUrl}/commits?author=${encodeURIComponent(contributor.login)}&per_page=30`,
      { headers }
    );

    if (!commitsResponse.ok) return;

    const commits = await commitsResponse.json();
    if (!Array.isArray(commits) || commits.length === 0) return;

    // Fetch individual commit details to get stats (limit to 10 for rate limit safety)
    const details = await Promise.all(
      commits.slice(0, 10).map(async (commit) => {
        try {
          const res = await fetch(`${baseUrl}/commits/${commit.sha}`, { headers });
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      })
    );

    // Build week-based stats from commit details
    const weekMap = new Map();
    for (const detail of details) {
      if (!detail?.stats || !detail?.commit?.author?.date) continue;

      const weekStart = getWeekStartTimestamp(new Date(detail.commit.author.date));
      if (!weekMap.has(weekStart)) {
        weekMap.set(weekStart, { w: weekStart, a: 0, d: 0, c: 0 });
      }
      const week = weekMap.get(weekStart);
      week.a += detail.stats.additions || 0;
      week.d += detail.stats.deletions || 0;
      week.c += 1;
    }

    if (contributor.weeks.length === 0) {
      // No existing week data — use commit-based data directly
      contributor.weeks = Array.from(weekMap.values());
    } else {
      // Merge additions/deletions into existing week entries
      for (const [weekStart, commitWeek] of weekMap) {
        const existing = contributor.weeks.find(w => w.w === weekStart);
        if (existing) {
          existing.a = commitWeek.a;
          existing.d = commitWeek.d;
        } else {
          contributor.weeks.push(commitWeek);
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to fetch commit stats for ${contributor.login}:`, e);
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchStats') {
    fetchContributorStats(request.owner, request.repo)
      .then(sendResponse)
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  }

  if (request.action === 'saveToken') {
    saveToken(request.token)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'getToken') {
    getToken()
      .then(token => sendResponse({ token }))
      .catch(err => sendResponse({ token: null }));
    return true;
  }

  if (request.action === 'clearToken') {
    clearToken()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false }));
    return true;
  }
});

console.log('🏆 Git Gladiators background service started');
