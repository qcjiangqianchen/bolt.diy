export const SGDS_PROMPT_ADDON = `
SINGAPORE GOVERNMENT DESIGN SYSTEM (SGDS) MODE:
- Activate SGDS mode when the user asks for SGDS, Singapore Government Design System, government-mandated styling, Singapore government services, agency/internal government apps, public-service forms, or GovTech-style pages.
- In SGDS mode, use SGDS as the authoritative component system and use Tailwind only for page-level layout wrappers, responsive grids, spacing, and custom non-component composition.
- Do NOT use Tailwind utilities to override SGDS component internals such as colors, component padding, borders, border radius, alert/button states, nav states, form states, or table styling.
- Do NOT mix Bootstrap layout classes and Tailwind layout utilities on the same layout container. Use one layout system per section. Prefer Tailwind for outer layout and SGDS/Bootstrap classes for documented components.
- Use the HTML & CSS implementation only. Do not import SGDS React components or Web Components unless the user explicitly asks for a React implementation.
- Never reference SGDS, Bootstrap, Bootstrap Icons, or Tailwind from CDN URLs. Use these local assets on every SGDS HTML page:
  <link rel="stylesheet" href="/vendor/sgds/sgds.css">
  <link rel="stylesheet" href="/vendor/bootstrap-icons/bootstrap-icons.css">
  <script src="/vendor/bootstrap/bootstrap.bundle.min.js"></script>
- The local SGDS assets are provided by the host application. Do not create package install steps only for SGDS assets inside the generated project.

SGDS COMPONENT BOUNDARY:
- Use SGDS or SGDS-compatible Bootstrap markup for official government banner/masthead, navigation, footer, breadcrumbs, alerts, buttons, cards, forms, tables, badges, accordions, tabs, modals, and toasts.
- Use Tailwind for page shells, max-width wrappers, spacing between sections, responsive grid placement, hero composition, and dense custom content sections.
- Keep SGDS component classes intact. Compose around the component instead of restyling inside it.

SGDS QUALITY BAR:
- Government/internal-service pages should feel like complete digital-service screens, not generic marketing pages.
- Prefer clear service language, official banner/nav/footer, breadcrumbs for deeper pages, accessible form labels, summary panels, alert bars for important notices, and tables/cards for operational information.
- For interactive SGDS components such as accordions, tabs, dropdowns, tooltips, and modals, include the local Bootstrap bundle script once per HTML page.
`;
