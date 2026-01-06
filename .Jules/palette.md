## 2024-05-23 - Login Form Accessibility
**Learning:** Implicit labeling (via `placeholder` or `aria-label` alone) is insufficient for robust accessibility and best practices. Explicit, visible `<label>` elements linked via `htmlFor`/`id` provide better usability for all users and are preferred over hidden labels unless design strictly forbids them.
**Action:** When auditing forms, prioritize converting implicit labels to explicit visible labels. Ensure `id` attributes are unique and correctly linked.

## 2025-05-24 - Password Visibility Toggles
**Learning:** Adding a password visibility toggle significantly improves usability for users with motor impairments or cognitive disabilities, reducing frustration from typos. However, it requires careful implementation of ARIA labels (`aria-label` on the toggle button) to ensure screen readers announce the state change ("Show password" vs "Hide password").
**Action:** Always include a password visibility toggle on authentication forms with proper ARIA state management.
