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

function getNextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

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

let currentAbortController = null;

/**
 * Fetch contributor stats from multiple GitHub API sources
 */
async function fetchContributorStats(owner, repo) {
  // Abort any previous in-flight request
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  const token = await getToken();

  if (!token) {
    return { status: 'no_token', message: 'GitHub token required for private repos' };
  }

  const headers = githubHeaders(token);
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    // Fetch stats/contributors (not paginated) and first page of contributors list
    const [statsResponse, listResponse] = await Promise.all([
      fetch(`${baseUrl}/stats/contributors`, { headers, signal }),
      fetch(`${baseUrl}/contributors?per_page=100`, { headers, signal }).catch(() => null)
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

    // Paginate through all contributors
    let listData = [];
    if (listResponse?.ok) {
      listData = await listResponse.json();
      // Check for more pages via Link header
      let nextUrl = getNextPageUrl(listResponse.headers.get('link'));
      while (nextUrl) {
        const nextResponse = await fetch(nextUrl, { headers, signal });
        if (!nextResponse.ok) break;
        const nextData = await nextResponse.json();
        if (!Array.isArray(nextData) || nextData.length === 0) break;
        listData = listData.concat(nextData);
        nextUrl = getNextPageUrl(nextResponse.headers.get('link'));
      }
    }

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

    // Fetch accurate per-commit additions/deletions via GraphQL
    // The stats/contributors REST API returns unreliable per-week a/d data
    await applyGraphQLStats(owner, repo, token, signal, contributors);

    return { status: 'success', data: contributors };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { status: 'aborted' };
    }
    console.error('Error fetching contributor stats:', error);
    return { status: 'error', message: error.message };
  }
}

/**
 * Fetch accurate per-commit stats via GraphQL and apply to contributors.
 * One query = 100 commits with additions/deletions. ~5 queries covers months of history.
 */
async function applyGraphQLStats(owner, repo, token, signal, contributors) {
  const query = `
    query($owner: String!, $repo: String!, $cursor: String, $since: GitTimestamp) {
      repository(owner: $owner, name: $repo) {
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 100, after: $cursor, since: $since) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  additions
                  deletions
                  committedDate
                  author { user { login } }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    // Fetch commits since Jan 1 of current year (up to 2000 commits / 20 pages)
    const since = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const allCommits = [];
    let cursor = null;

    for (let page = 0; page < 20; page++) {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          query,
          variables: { owner, repo, cursor, since }
        })
      });

      if (!response.ok) return; // Fall back to stats API data

      const data = await response.json();
      const history = data?.data?.repository?.defaultBranchRef?.target?.history;
      if (!history?.nodes) return;

      allCommits.push(...history.nodes);

      if (!history.pageInfo.hasNextPage) break;
      cursor = history.pageInfo.endCursor;
    }

    if (allCommits.length === 0) return;

    // Group commits by author and week
    const authorWeekMap = new Map(); // login -> Map(weekStart -> {a, d})
    for (const commit of allCommits) {
      const login = commit.author?.user?.login;
      if (!login) continue;

      const key = login.toLowerCase();
      const weekStart = getWeekStartTimestamp(new Date(commit.committedDate));

      if (!authorWeekMap.has(key)) {
        authorWeekMap.set(key, new Map());
      }
      const weekMap = authorWeekMap.get(key);

      if (!weekMap.has(weekStart)) {
        weekMap.set(weekStart, { a: 0, d: 0 });
      }
      const week = weekMap.get(weekStart);
      week.a += commit.additions || 0;
      week.d += commit.deletions || 0;
    }

    // Apply accurate a/d data to each contributor's weeks
    for (const contributor of contributors) {
      const weekMap = authorWeekMap.get(contributor.login.toLowerCase());
      if (!weekMap) continue;

      const weekStarts = Array.from(weekMap.keys());
      const minWeek = Math.min(...weekStarts);
      const maxWeek = Math.max(...weekStarts);

      // Zero out stats API's a/d within the GraphQL data range
      for (const week of contributor.weeks) {
        if (week.w >= minWeek && week.w <= maxWeek) {
          week.a = 0;
          week.d = 0;
        }
      }

      // Apply GraphQL data
      for (const [weekStart, stats] of weekMap) {
        const existing = contributor.weeks.find(w => w.w === weekStart);
        if (existing) {
          existing.a = stats.a;
          existing.d = stats.d;
        } else {
          contributor.weeks.push({ w: weekStart, a: stats.a, d: stats.d, c: 0 });
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.warn('GraphQL stats fetch failed, using stats API data:', e);
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
