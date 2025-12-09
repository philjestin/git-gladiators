/**
 * Content script for Git Gladiators
 * Detects GitHub repository pages
 */

/**
 * Parse current page URL to extract repo information
 */
function parseCurrentRepo() {
  const match = window.location.href.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
  if (match) {
    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, '')
    };
  }
  return null;
}

const repoInfo = parseCurrentRepo();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getRepoInfo') {
    sendResponse(repoInfo);
  }
  return true;
});

if (repoInfo) {
  console.log('🏆 Git Gladiators loaded for:', repoInfo);
}
