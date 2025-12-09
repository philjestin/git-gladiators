# 🏆 Git Gladiators

A fun Chrome extension that creates a leaderboard for software engineers based on their contributions to GitHub repositories. Works with private repositories using your existing GitHub authentication!

![Git Gladiators](./docs/screenshot.png)

## Features

- **Works with Private Repos**: Uses your existing GitHub session - no API tokens needed!
- **Balanced Scoring**: Fair algorithm that weighs commits vs lines of code
- **Fun Titles**: Contributors earn titles like "🏛️ Code Architect", "🧹 The Cleaner", "⚡ Rapid Fire" based on their coding patterns
- **Retro Arcade UI**: Distinctive visual design inspired by classic arcade games

## Scoring Algorithm

The scoring system balances different contribution types:

| Factor | Weight | Description |
|--------|--------|-------------|
| Commits | 40% | Number of commits (logarithmic scale) |
| Lines Added | 35% | Total lines added (logarithmic scale) |
| Lines Deleted | 25% | Cleanup work is valuable too! |
| Balance Bonus | +10 max | Bonus for well-sized commits |

The logarithmic scaling ensures that a developer with 10x more commits doesn't get 10x the score - it's more balanced and fair.

## Contributor Titles

Based on contribution patterns, developers earn fun titles:

| Title | Criteria |
|-------|----------|
| 🏛️ Code Architect | 500+ commits |
| 🧹 The Cleaner | >60% deletions |
| 🌊 Tsunami Coder | >500 lines per commit avg |
| ⚡ Rapid Fire | <20 lines per commit, 50+ commits |
| 📚 Novel Writer | 50K+ lines added |
| 🎖️ Veteran | 100+ commits |
| ⚔️ Warrior | 50+ commits |
| 🛡️ Defender | 20+ commits |
| 🌱 Rising Star | 10+ commits |
| 🆕 Fresh Blood | Everyone else |

## Installation

### From Source (Developer Mode)

1. Clone or download this repository

2. Generate the icons (requires Node.js):
   ```bash
   npm run generate-icons
   ```

3. Open Chrome and navigate to `chrome://extensions/`

4. Enable **Developer mode** (toggle in top right)

5. Click **Load unpacked** and select this directory

6. The extension icon should appear in your toolbar

### Usage

1. **Create a GitHub Token** (first time only):
   - Go to [GitHub Classic Tokens](https://github.com/settings/tokens/new?description=Git%20Gladiators&scopes=repo)
   - Select the **`repo`** scope
   - Click "Generate token" and copy it (starts with `ghp_`)
   
   > **Note**: Classic tokens with `repo` scope work with any private repo you're a member of, including organization repos.

2. Navigate to any GitHub repository page
3. Click the Git Gladiators extension icon
4. Paste your token and click "CONNECT"
5. View the leaderboard!

The token is stored locally in your browser.

## How It Works

The extension uses a GitHub Personal Access Token (classic) to authenticate API requests:

- ✅ Works with any private repo you have access to (including org repos)
- ✅ Token stored locally in Chrome, never sent anywhere else
- ✅ Higher rate limits than unauthenticated requests (5000/hour)
- ⚙️ Click the settings icon to change or remove your token

## Development

### Project Structure

```
git-gladiators/
├── manifest.json      # Chrome extension manifest (v3)
├── background.js      # Service worker for API calls
├── content.js         # Content script for repo detection
├── popup.html         # Leaderboard UI
├── popup.js           # Popup logic
├── popup.css          # Retro arcade styling
├── icons/             # Extension icons
└── scripts/
    └── generate-icons.js  # Icon generation script
```

### Regenerating Icons

If you want to customize the icons:

```bash
# Edit scripts/generate-icons.js to change colors/design
node scripts/generate-icons.js
```

## Troubleshooting

### "Repository not found or no access"
- Make sure you're logged into GitHub in the same browser
- Verify you have access to the repository

### "Rate limited"
- Wait a minute and try again
- Authenticated requests have higher rate limits

### "GitHub is computing stats..."
- This happens for large repos or repos you haven't viewed recently
- The extension will automatically retry

## Privacy

This extension:
- Only activates on github.com
- Only reads contributor statistics for repositories you visit
- Stores no personal data
- Makes no requests to any servers other than GitHub's API

## License

MIT

