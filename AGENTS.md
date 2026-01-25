# Agent Instructions

This project uses bd (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd list --status=open # List open issues
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Issue Tracking Rules

- Use bd for all task tracking (no markdown TODOs or external trackers).
- Always use `--json` for create/update/close commands.
- Link discovered work with `discovered-from:<parent-id>` dependencies.

## Landing the Plane (Session Completion)

Work is not complete until `git push` succeeds.

1. File issues for remaining work
2. Run quality gates (if code changed)
3. Update issue status (close finished work)
4. Push to remote:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # Must show up to date with origin
   ```
5. Clean up (clear stashes, prune remote branches)
6. Verify all changes committed and pushed
7. Hand off context for the next session

Critical rules:
- Never stop before pushing
- Never say "ready to push when you are"
- If push fails, resolve and retry until it succeeds

## Workflow Pattern

1. Run `bd ready` to find actionable work
2. Update issue status to in_progress
3. Implement the task
4. Close the issue when done
5. Run `bd sync` at session end
