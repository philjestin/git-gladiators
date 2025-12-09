/**
 * Background service worker for Git Gladiators
 * Handles GitHub API calls with PAT authentication
 */

/**
 * Get stored GitHub token
 */
async function getToken() {
  const result = await chrome.storage.local.get(['githubToken']);
  return result.githubToken || null;
}

/**
 * Save GitHub token
 */
async function saveToken(token) {
  await chrome.storage.local.set({ githubToken: token });
}

/**
 * Clear GitHub token
 */
async function clearToken() {
  await chrome.storage.local.remove(['githubToken']);
}

/**
 * Fetch contributor stats from GitHub API
 */
async function fetchContributorStats(owner, repo) {
  const token = await getToken();
  
  if (!token) {
    return { status: 'no_token', message: 'GitHub token required for private repos' };
  }
  
  const url = `https://api.github.com/repos/${owner}/${repo}/stats/contributors`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    
    if (response.status === 202) {
      return { status: 'computing', message: 'GitHub is computing stats...' };
    }
    
    if (response.status === 401) {
      return { status: 'invalid_token', message: 'Invalid or expired token' };
    }
    
    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        return { status: 'rate_limited', message: 'Rate limited. Try again later.' };
      }
      return { status: 'forbidden', message: 'Access forbidden. Check token permissions.' };
    }
    
    if (response.status === 404) {
      return { status: 'not_found', message: 'Repository not found or no access.' };
    }
    
    if (!response.ok) {
      return { status: 'error', message: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    
    if (!data || !Array.isArray(data)) {
      return { status: 'empty', message: 'No contributor data available.' };
    }
    
    // Return raw data with weeks for client-side time filtering
    const contributors = data.map(contributor => ({
      login: contributor.author?.login || 'Unknown',
      avatar: contributor.author?.avatar_url || '',
      profileUrl: contributor.author?.html_url || '',
      weeks: contributor.weeks // Array of { w: timestamp, a: additions, d: deletions, c: commits }
    }));
    
    return { status: 'success', data: contributors };
    
  } catch (error) {
    console.error('Error fetching contributor stats:', error);
    return { status: 'error', message: error.message };
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
