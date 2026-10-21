# apps/web conventions

- Pages under `apps/web/src/pages/<group>/`. Use existing shadcn/ui patterns (see `pages/customers/`, `pages/banking/` for templates).
- Routes registered in `apps/web/src/App.tsx`. Sidebar in `apps/web/src/components/layout/Sidebar.tsx`.
- No `any`. Declare concrete types for API responses.
- Match existing styling — don't introduce new design tokens or component libraries.
