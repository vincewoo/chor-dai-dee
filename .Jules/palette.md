## 2024-05-23 - Login Form Accessibility
**Learning:** Implicit labeling (via `placeholder` or `aria-label` alone) is insufficient for robust accessibility and best practices. Explicit, visible `<label>` elements linked via `htmlFor`/`id` provide better usability for all users and are preferred over hidden labels unless design strictly forbids them.
**Action:** When auditing forms, prioritize converting implicit labels to explicit visible labels. Ensure `id` attributes are unique and correctly linked.
