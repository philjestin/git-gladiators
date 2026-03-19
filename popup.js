/**
 * Popup script for Git Gladiators
 * Handles token setup, time filtering, and leaderboard display
 */

// Scoring config
const SCORING_CONFIG = {
  commitWeight: 0.4,
  additionsWeight: 0.35,
  deletionsWeight: 0.25,
  streakMax: 15,
  streakPerWeek: 3,
  consistencyMin: 0.85,
  consistencyMax: 1.15,
  churnPenaltyMax: 10,
};

// DOM Elements
const tokenSetup = document.getElementById('tokenSetup');
const mainScreen = document.getElementById('mainScreen');
const tokenInput = document.getElementById('tokenInput');
const saveTokenBtn = document.getElementById('saveTokenBtn');
const tokenError = document.getElementById('tokenError');
const repoNameEl = document.getElementById('repoName');
const navTabs = document.getElementById('navTabs');
const leaderboardView = document.getElementById('leaderboardView');
const algorithmView = document.getElementById('algorithmView');
const timeTabs = document.getElementById('timeTabs');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const leaderboardEl = document.getElementById('leaderboard');
const refreshBtn = document.getElementById('refreshBtn');
const settingsBtn = document.getElementById('settingsBtn');

// State
let currentRepo = null;
let rawContributorData = null;
let currentPeriod = 'week';
let currentView = 'leaderboard';
let fetchRequestId = 0;

/**
 * Initialize popup
 */
async function init() {
  const { token } = await sendMessage({ action: 'getToken' });
  
  if (token) {
    showMainScreen();
  } else {
    showTokenSetup();
  }
  
  // Set up time tab listeners
  timeTabs.addEventListener('click', (e) => {
    if (e.target.classList.contains('time-tab')) {
      setTimePeriod(e.target.dataset.period);
    }
  });
  
  // Set up nav tab listeners
  navTabs.addEventListener('click', (e) => {
    if (e.target.classList.contains('nav-tab')) {
      setView(e.target.dataset.view);
    }
  });
}

/**
 * Switch between leaderboard and algorithm views
 */
function setView(view) {
  currentView = view;
  
  // Update active tab
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  
  // Show/hide views
  leaderboardView.style.display = view === 'leaderboard' ? 'flex' : 'none';
  algorithmView.style.display = view === 'algorithm' ? 'flex' : 'none';
}

/**
 * Set the active time period and re-render
 */
function setTimePeriod(period) {
  currentPeriod = period;
  
  // Update active tab
  document.querySelectorAll('.time-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.period === period);
  });
  
  // Re-render with filtered data
  if (rawContributorData) {
    const processed = processContributors(rawContributorData, period);
    renderLeaderboard(processed);
  }
}

/**
 * Get timestamp cutoff for time period
 */
function getPeriodCutoff(period) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  
  switch (period) {
    case 'week':
      return now - weekMs;
    case 'month':
      return now - (4 * weekMs); // ~4 weeks
    case 'year': {
      const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
      return jan1;
    }
    default:
      return 0; // All time
  }
}

/**
 * Process raw contributor data for a time period
 */
function processContributors(contributors, period) {
  const cutoffTimestamp = getPeriodCutoff(period) / 1000; // Convert to Unix timestamp

  const processed = contributors.map(contributor => {
    // Filter weeks by time period
    const relevantWeeks = contributor.weeks.filter(week => week.w >= cutoffTimestamp);

    // Sum up stats from relevant weeks
    let commits = relevantWeeks.reduce((sum, week) => sum + week.c, 0);
    const additions = relevantWeeks.reduce((sum, week) => sum + week.a, 0);
    const deletions = relevantWeeks.reduce((sum, week) => sum + week.d, 0);

    // Fallback to totalCommits for contributors missing week data (from /contributors endpoint)
    if (commits === 0 && period === 'all' && contributor.totalCommits) {
      commits = contributor.totalCommits;
    }
    
    const score = calculateScore(commits, additions, deletions, relevantWeeks);
    const titleInfo = assignTitle({ commits, additions, deletions });
    const { streakWeeks } = calculateStreak(relevantWeeks);

    return {
      login: contributor.login,
      avatar: contributor.avatar,
      profileUrl: contributor.profileUrl,
      commits,
      additions,
      deletions,
      streakWeeks,
      score,
      ...titleInfo
    };
  });
  
  // Filter out contributors with no activity in period
  const active = processed.filter(c => c.commits > 0 || c.additions > 0 || c.deletions > 0);
  
  // Sort by score
  active.sort((a, b) => b.score - a.score);
  
  // Assign ranks
  active.forEach((contributor, index) => {
    contributor.rank = index + 1;
  });
  
  return active;
}

/**
 * Calculate streak: consecutive weeks with >= 1 commit, counting back from most recent active week
 */
function calculateStreak(relevantWeeks) {
  const { streakMax, streakPerWeek } = SCORING_CONFIG;
  const activeWeeks = relevantWeeks.filter(w => w.c > 0);
  if (activeWeeks.length === 0) return { streakWeeks: 0, streakBonus: 0 };

  // Sort by timestamp descending to count back from most recent
  const sorted = [...activeWeeks].sort((a, b) => b.w - a.w);
  const weekSec = 7 * 24 * 60 * 60;

  let streakWeeks = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i - 1].w - sorted[i].w;
    // Allow gap of exactly 1 week (GitHub weekly buckets)
    if (gap <= weekSec + 86400) { // +1 day tolerance
      streakWeeks++;
    } else {
      break;
    }
  }

  const streakBonus = Math.min(streakMax, streakWeeks * streakPerWeek);
  return { streakWeeks, streakBonus };
}

/**
 * Calculate consistency multiplier based on coefficient of variation of weekly commits
 */
function calculateConsistency(relevantWeeks) {
  const { consistencyMin, consistencyMax } = SCORING_CONFIG;
  const activeWeeks = relevantWeeks.filter(w => w.c > 0);

  if (activeWeeks.length < 3) return 1.0;

  const counts = activeWeeks.map(w => w.c);
  const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
  const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0;

  // 1.15 - (0.3 * min(1, CV))  →  range [0.85, 1.15]
  return consistencyMax - ((consistencyMax - consistencyMin) * Math.min(1, cv));
}

/**
 * Calculate code churn penalty
 */
function calculateChurn(relevantWeeks) {
  const { churnPenaltyMax } = SCORING_CONFIG;
  const activeWeeks = relevantWeeks.filter(w => w.c > 0 || w.a > 0 || w.d > 0);

  if (activeWeeks.length < 2) return 0;

  // Sort chronologically
  const sorted = [...activeWeeks].sort((a, b) => a.w - b.w);

  let totalChurn = 0;
  let totalAdditions = 0;
  for (let i = 0; i < sorted.length; i++) {
    totalAdditions += sorted[i].a;
    if (i < sorted.length - 1) {
      totalChurn += Math.min(sorted[i].a, sorted[i + 1].d);
    }
  }

  if (totalAdditions === 0) return 0;

  const churnRatio = Math.min(1.0, totalChurn / totalAdditions);
  return -churnPenaltyMax * churnRatio;
}

/**
 * Calculate final score with streak, consistency, and churn
 */
function calculateScore(commits, additions, deletions, relevantWeeks) {
  const { commitWeight, additionsWeight, deletionsWeight } = SCORING_CONFIG;

  const logCommits = Math.log10(commits + 1) * 100;
  const logAdditions = Math.log10(additions + 1) * 10;
  const logDeletions = Math.log10(deletions + 1) * 10;

  const commitScore = logCommits * commitWeight;
  const additionScore = logAdditions * additionsWeight;
  const deletionScore = logDeletions * deletionsWeight;

  const baseScore = commitScore + additionScore + deletionScore;
  const consistencyMultiplier = calculateConsistency(relevantWeeks);
  const { streakBonus } = calculateStreak(relevantWeeks);
  const churnPenalty = calculateChurn(relevantWeeks);

  const finalScore = (baseScore * consistencyMultiplier) + streakBonus + churnPenalty;
  return Math.round(Math.max(0, finalScore) * 10) / 10;
}

/**
 * Assign titles based on contribution patterns
 */
function assignTitle(stats) {
  const { commits, additions, deletions } = stats;
  const total = additions + deletions;
  const ratio = commits > 0 ? total / commits : 0;
  const deleteRatio = total > 0 ? deletions / total : 0;
  
  if (commits >= 500) return { title: "🏛️ Code Architect", color: "#FFD700" };
  if (deleteRatio > 0.6 && total > 100) return { title: "🧹 The Cleaner", color: "#9B59B6" };
  if (ratio > 500) return { title: "🌊 Tsunami Coder", color: "#3498DB" };
  if (ratio < 20 && commits > 50) return { title: "⚡ Rapid Fire", color: "#E74C3C" };
  if (additions > 50000) return { title: "📚 Novel Writer", color: "#2ECC71" };
  if (commits >= 100) return { title: "🎖️ Veteran", color: "#F39C12" };
  if (commits >= 50) return { title: "⚔️ Warrior", color: "#E67E22" };
  if (commits >= 20) return { title: "🛡️ Defender", color: "#1ABC9C" };
  if (commits >= 10) return { title: "🌱 Rising Star", color: "#27AE60" };
  if (commits >= 1) return { title: "🆕 Fresh Blood", color: "#95A5A6" };
  return { title: "💤 Inactive", color: "#666677" };
}

/**
 * Show token setup screen
 */
function showTokenSetup() {
  tokenSetup.style.display = 'flex';
  mainScreen.style.display = 'none';
  tokenInput.value = '';
  tokenError.textContent = '';
}

/**
 * Show main leaderboard screen
 */
async function showMainScreen() {
  tokenSetup.style.display = 'none';
  mainScreen.style.display = 'flex';
  
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  
  if (!tab?.url?.includes('github.com')) {
    showError('Not on GitHub', 'Navigate to a GitHub repository page');
    return;
  }
  
  currentRepo = parseGitHubUrl(tab.url);
  
  if (!currentRepo) {
    showError('Not a repository', 'Navigate to a GitHub repository page');
    return;
  }
  
  repoNameEl.textContent = `${currentRepo.owner}/${currentRepo.repo}`;
  await fetchAndDisplayStats();
}

/**
 * Parse GitHub URL
 */
function parseGitHubUrl(url) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
  if (match) {
    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, '')
    };
  }
  return null;
}

/**
 * Save token and verify
 */
async function handleSaveToken() {
  const token = tokenInput.value.trim();
  
  if (!token) {
    tokenError.textContent = 'Please enter a token';
    return;
  }
  
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    tokenError.textContent = 'Token should start with ghp_ (classic) or github_pat_ (fine-grained)';
    return;
  }
  
  saveTokenBtn.textContent = '⏳ VERIFYING...';
  saveTokenBtn.disabled = true;
  
  await sendMessage({ action: 'saveToken', token });
  
  try {
    const response = await fetch('https://api.github.com/rate_limit', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (response.ok) {
      showMainScreen();
    } else {
      await sendMessage({ action: 'clearToken' });
      tokenError.textContent = 'Invalid token. Please check and try again.';
    }
  } catch (e) {
    await sendMessage({ action: 'clearToken' });
    tokenError.textContent = 'Could not verify token. Check your connection.';
  }
  
  saveTokenBtn.textContent = '🔓 CONNECT';
  saveTokenBtn.disabled = false;
}

/**
 * Fetch stats from background script
 */
async function fetchAndDisplayStats() {
  if (!currentRepo) return;

  const thisRequest = ++fetchRequestId;
  showStatus('Summoning warriors...');

  const result = await sendMessage({
    action: 'fetchStats',
    owner: currentRepo.owner,
    repo: currentRepo.repo
  });

  // Ignore stale responses if a newer request was started
  if (thisRequest !== fetchRequestId) return;

  handleResult(result);
}

/**
 * Handle API result
 */
function handleResult(result) {
  if (!result) {
    showError('No response', 'Could not get data');
    return;
  }
  
  switch (result.status) {
    case 'aborted':
      return; // Request was cancelled, ignore
    case 'success':
      hideStatus();
      rawContributorData = result.data;
      const processed = processContributors(result.data, currentPeriod);
      renderLeaderboard(processed);
      break;
      
    case 'computing':
      showStatus('GitHub is computing stats... Retrying in 3s');
      setTimeout(fetchAndDisplayStats, 3000);
      break;
      
    case 'no_token':
      showTokenSetup();
      break;
      
    case 'invalid_token':
      showTokenSetup();
      tokenError.textContent = 'Token expired or invalid. Please enter a new one.';
      break;
      
    case 'rate_limited':
      showError('⚠️ Rate Limited', 'Too many requests. Wait a minute.');
      break;
      
    case 'not_found':
      showError('🔒 Not Found', 'Repo not found. Check token has repo access.');
      break;
      
    case 'forbidden':
      showError('🔒 Forbidden', 'Token lacks permission for this repo.');
      break;
      
    case 'empty':
      showEmpty('No warriors found', 'This repository has no contributor data');
      break;
      
    default:
      showError('⚠️ Error', result.message || 'Something went wrong');
  }
}

/**
 * Render leaderboard
 */
function renderLeaderboard(contributors) {
  leaderboardEl.innerHTML = '';
  
  if (!contributors?.length) {
    const periodName = currentPeriod === 'week' ? 'this week' :
                       currentPeriod === 'month' ? 'this month' :
                       currentPeriod === 'year' ? 'this year' : 'all time';
    showEmpty('No activity', `No contributions found for ${periodName}`);
    return;
  }
  
  contributors.forEach((contributor, index) => {
    const card = createContributorCard(contributor, index);
    leaderboardEl.appendChild(card);
  });
}

/**
 * Create contributor card
 */
function createContributorCard(contributor, index) {
  const card = document.createElement('div');
  card.className = `contributor rank-${contributor.rank}`;
  card.style.animationDelay = `${index * 0.05}s`;
  
  const medal = getMedalEmoji(contributor.rank);
  
  card.innerHTML = `
    ${medal ? `<span class="medal">${medal}</span>` : ''}
    <div class="contributor-header">
      <div class="rank">#${contributor.rank}</div>
      <img class="avatar" src="${contributor.avatar}" alt="${contributor.login}" loading="lazy">
      <div class="contributor-info">
        <a href="${contributor.profileUrl}" target="_blank" class="username">${contributor.login}</a>
        <div class="title-badge" style="color: ${contributor.color}">${contributor.title}</div>
      </div>
      <div class="score-display">
        <div class="score">${contributor.score}</div>
        <div class="score-label">POWER</div>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat stat-commits">
        <span class="stat-icon">⚡</span>
        <span class="stat-value">${formatNumber(contributor.commits)}</span>
      </div>
      <div class="stat stat-add">
        <span class="stat-icon">+</span>
        <span class="stat-value">${formatNumber(contributor.additions)}</span>
      </div>
      <div class="stat stat-del">
        <span class="stat-icon">−</span>
        <span class="stat-value">${formatNumber(contributor.deletions)}</span>
      </div>
      ${contributor.streakWeeks > 0 ? `
      <div class="stat stat-streak">
        <span class="stat-icon">🔥</span>
        <span class="stat-value">${contributor.streakWeeks}</span>
      </div>` : ''}
    </div>
  `;
  
  return card;
}

function getMedalEmoji(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return null;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function showStatus(message) {
  statusBar.classList.remove('hidden');
  statusText.textContent = message;
  leaderboardEl.innerHTML = '';
}

function hideStatus() {
  statusBar.classList.add('hidden');
}

function showError(title, hint) {
  hideStatus();
  leaderboardEl.innerHTML = `
    <div class="error-state">
      <div class="error-icon">💀</div>
      <div class="error-message">${title}</div>
      <div class="error-hint">${hint}</div>
    </div>
  `;
}

function showEmpty(title, message) {
  hideStatus();
  leaderboardEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🏟️</div>
      <div class="empty-message">${title}</div>
      <div class="error-hint">${message}</div>
    </div>
  `;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

// Event Listeners
saveTokenBtn.addEventListener('click', handleSaveToken);

tokenInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSaveToken();
});

refreshBtn.addEventListener('click', fetchAndDisplayStats);

settingsBtn.addEventListener('click', async () => {
  await sendMessage({ action: 'clearToken' });
  showTokenSetup();
});

// Initialize
document.addEventListener('DOMContentLoaded', init);
