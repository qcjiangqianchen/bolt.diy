export const SGDS_PROMPT_ADDON = `
SINGAPORE GOVERNMENT DESIGN SYSTEM (SGDS) ADDITIVE LAYER:
- When the user asks for SGDS, Singapore Government Design System, government-mandated styling, Singapore government services, agency/internal government apps, public-service forms, or GovTech-style pages, apply SGDS as an ADDITIVE component and pattern layer.
- SGDS does not replace any existing website, content, multi-page, visual-quality, or completeness rules in this system prompt. All existing requirements for rich sections, strong page heroes, dense content surfaces, non-sparse internal pages, route completeness, visual polish, and domain-specific substance still apply.
- Never downgrade the design into a plain Bootstrap document, sparse government template, centered text page, or simple cards-only layout. SGDS should make the page more trustworthy and service-oriented, not less designed.
- Use the user's actual domain/request to infer concrete service names, page content, labels, data, and examples. Never render bracketed placeholders such as [SERVICE NAME], [TARGET USERS], [MAIN PURPOSE], TODO, lorem ipsum, or generic "service" copy. If the user prompt contains placeholders, replace them with sensible concrete defaults instead of copying them.
- Use SGDS as the authoritative component system for documented government UI components. Use Tailwind only for outer page layout wrappers, responsive grids, spacing, media composition, hero/page structure, and custom non-component sections.
- Do NOT use Tailwind utilities to override SGDS component internals such as colors, component padding, borders, border radius, alert/button states, nav states, form states, or table styling.
- Do NOT mix Bootstrap layout classes and Tailwind layout utilities on the same layout container. Use one layout system per section. Prefer Tailwind for outer layout and SGDS/Bootstrap classes for documented components.
- Use the SGDS HTML & CSS implementation only. Do not import SGDS React components or Web Components unless the user explicitly asks for a React implementation.
- Never wrap generated file contents in <![CDATA[ ... ]]>. File actions must contain the raw file text directly, starting HTML files with <!DOCTYPE html>.
- Never reference SGDS, Bootstrap, Bootstrap Icons, or Tailwind from CDN URLs. Use these local assets on every SGDS HTML page:
  <link rel="stylesheet" href="/vendor/sgds/sgds.css">
  <link rel="stylesheet" href="/vendor/bootstrap-icons/bootstrap-icons.css">
  <script src="/vendor/bootstrap/bootstrap.bundle.min.js"></script>
- The local SGDS assets are provided by the host application. Do not create package install steps only for SGDS assets inside the generated project.

SGDS COMPONENT BOUNDARY:
- Use SGDS or SGDS-compatible Bootstrap markup for official government banner/masthead, navigation, footer, breadcrumbs, alerts, buttons, cards, forms, tables, badges, accordions, tabs, modals, and toasts.
- Use Tailwind for page shells, max-width wrappers, spacing between sections, responsive grid placement, hero composition, and dense custom content sections.
- Keep SGDS component classes intact. Compose around the component instead of restyling inside it.

REQUIRED SGDS PAGE SHELL:
- Every SGDS HTML page must use one shared shell: local asset links in head, an official government/masthead strip, one responsive SGDS/Bootstrap navbar, main content, and a compact SGDS footer.
- Navbar links must be inside a single structured navbar list. Never output loose nav links scattered in the page corner. Never stack desktop nav links vertically unless they are inside the mobile collapsed menu.
- Use this navbar structure as the baseline, adapting labels and active state per page:
  <nav class="sgds navbar navbar-expand-lg navbar-light bg-white border-bottom">
    <div class="container">
      <a class="navbar-brand fw-bold" href="index.html">Concrete Service Name</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav" aria-controls="mainNav" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="mainNav">
        <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
          <li class="nav-item"><a class="nav-link active" aria-current="page" href="index.html">Overview</a></li>
          <li class="nav-item"><a class="nav-link" href="apply.html">Apply</a></li>
          <li class="nav-item"><a class="nav-link" href="status.html">Status</a></li>
          <li class="nav-item"><a class="nav-link" href="faq.html">FAQ</a></li>
        </ul>
      </div>
    </div>
  </nav>

SGDS QUALITY BAR:
- Government/internal-service pages should feel like complete, polished digital-service screens with the same ambition required elsewhere in this prompt.
- Combine SGDS service patterns with modern webpage composition: substantial heroes, operational stat strips, summary panels, process timelines, eligibility cards, document checklists, tables, alert bars, accordions, and clear next actions where useful.
- Prefer official banner/nav/footer, breadcrumbs for deeper pages, accessible form labels, meaningful validation/help text, summary panels, alert bars for important notices, and tables/cards for operational information.
- SGDS buttons, alerts, forms, tables, breadcrumbs, cards, accordions, and nav should be recognizable SGDS/Bootstrap-style components, but the surrounding page should still look carefully designed and content-rich.
- For interactive SGDS components such as accordions, tabs, dropdowns, tooltips, and modals, include the local Bootstrap bundle script once per HTML page.

MINIMUM CONTENT FLOOR FOR SGDS GENERATION:
- index.html must include at least 7 meaningful content surfaces: substantial hero, SGDS alert/notice, operational stat strip, eligibility/service summary cards, process timeline, document/checklist section, table or status/processing surface, FAQ/help preview, and footer. More is welcome when relevant.
- Every secondary top-level page must include at least 4 meaningful content blocks and must not be a single form/table/card.
- A page with only a welcome heading, one sentence, two cards, and a footer is a failed SGDS generation. Revise before outputting.
- Before writing the artifact, self-check: no placeholders, navbar is structured, every route exists, every page has dense content, SGDS assets are local, and SGDS is additive rather than replacing the normal design quality rules.
`;
