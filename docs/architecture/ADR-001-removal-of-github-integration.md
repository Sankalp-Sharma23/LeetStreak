# ADR-001: Complete Deprecation & Removal of GitHub Integration

## Status
Accepted

## Context
LeetStreak previously featured an experimental GitHub Auto-Sync integration. This allowed users to connect a GitHub personal access token via OAuth Device Flow, configure a repository, and automatically commit accepted LeetCode solutions.

However, in practice:
1. The GitHub integration added over 1,500 lines of complex background retry queues, OAuth polling routines, token encryption layers, and repository creation logic.
2. The core content script tied its submission detection listener strictly inside `initGitHubSync()`, meaning users without GitHub configured were locked out of submission detection and 1v1 battle reporting.
3. Plaintext key storage in `secure-token-manager.js` created unnecessary security exposure.
4. The product mission of LeetStreak is focused on competitive consistency, peer accountability, 1v1 battles, and hardcore focus. Code backup is an orthogonal concern that distracts from core stability.

## Decision
We completely excise the GitHub integration from the LeetStreak codebase:
- Remove GitHub OAuth Device Flow handlers, polling alarms, commit generation, repository verification, and retry queues.
- Remove `GitHubSync.jsx` and all related settings/UI toggles.
- Decouple the Monaco editor / code capture logic so features that genuinely need code extraction (such as Code Screenshot and 1v1 Battle code submission) continue to function without any dependency on GitHub.
- Remove GitHub token storage keys and clean up local storage migrations.

## Consequences
- **Positive:** Reduces service worker bundle size by ~45%; eliminates unnecessary network traffic to `api.github.com`; removes token storage security risk; decouples battle submission detection from third-party services.
- **Negative:** Users can no longer automatically sync solutions to a personal GitHub repo via this extension. This is an intentional product scoping decision.

