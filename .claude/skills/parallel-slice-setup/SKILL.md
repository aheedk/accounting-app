---
name: parallel-slice-setup
description: How to set up worktrees and parallelize sub-agents by file ownership for a multi-phase slice of work in this repo, including the hot-spot files that commonly collide on merge and how to resolve those conflicts.
---

# Parallel agents working pattern

For multi-phase work:

- **Each slice gets its own worktree under `.claude/worktrees/slice-N-<topic>/`** with branch `slice-N-<topic>` cut from `main`. Slices merge into `main` sequentially in the priority order from the spec.
- **Within a slice**, parallelize sub-agents only by file ownership. Each sub-agent prompt MUST list:
  - Files it owns (whitelist).
  - Files it MUST NOT modify (blacklist of files owned by sibling agents in the same phase).
- **Hot-spot files** (cross-slice merge magnets):
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/layout/Sidebar.tsx`
  - `apps/api/src/db/types.ts`
  - `apps/api/src/app.ts`
  - `packages/shared/src/auditActions.ts`
  - `packages/shared/src/schemas/index.ts`
  - On merge conflict in any of these: re-apply both slices' append blocks. Never delete the other slice's lines.
