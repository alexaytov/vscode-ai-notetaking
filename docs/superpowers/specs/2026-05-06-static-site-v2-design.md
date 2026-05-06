# Static Site V2: GitHub-Style Wiki — Design Spec

## Overview

A complete overhaul of the static site export to produce a polished, GitHub-styled wiki with client-side search, dark/light mode, table of contents, hover previews, breadcrumbs, responsive mobile, and syntax highlighting.

## Visual Style

- **Palette:** GitHub dark (`#0d1117` bg, `#c9d1d9` text, `#58a6ff` links, `#21262d` borders) with a light theme alternative (`#ffffff` bg, `#1f2328` text)
- **Layout:** Top navigation bar + collapsible sidebar + main content area + optional right-side TOC
- **Typography:** Inter for UI text, system monospace for code. Loaded via Google Fonts with system fallback.
- **Shape Language:** Rounded tag badges with colored backgrounds, subtle borders, minimal shadows

## Features

### 1. Client-side Full-text Search

**Build time:**
- Generate `search-index.json` during site export containing for each note: `{ slug, title, tags, summary, content (first 500 chars) }`
- Written to `_site/js/search-index.json`

**Runtime:**
- Search bar in the top nav bar (always visible)
- On focus: load the index JSON (lazy-loaded, cached after first load)
- On input: filter entries by substring match against title, tags, summary, and content
- Results dropdown: max 10 results, each showing title + matching context snippet
- Click result → navigate to that note page
- Escape or click outside → close dropdown
- No external library — simple case-insensitive substring matching

### 2. Dark/Light Mode Toggle

**Implementation:**
- All colors defined as CSS custom properties under `[data-theme="dark"]` and `[data-theme="light"]` selectors
- Default: read `prefers-color-scheme` media query on load, apply matching theme
- Toggle button (sun/moon icon) in the top nav bar
- On click: flip `data-theme` attribute on `<html>`, persist to `localStorage`
- On page load: check `localStorage` first, then system preference
- Transition: `transition: background-color 0.2s, color 0.2s` on body

**Color tokens:**
```
--color-bg-primary, --color-bg-secondary, --color-bg-tertiary
--color-text-primary, --color-text-secondary, --color-text-muted
--color-link, --color-link-hover
--color-border, --color-border-muted
--color-tag-bg, --color-tag-text
--color-code-bg
```

### 3. Table of Contents (Per-page)

**Generation:**
- At build time: extract all `<h2>` and `<h3>` elements from rendered HTML
- Generate a TOC data structure: `[{ id, text, level }]`
- Render as a `<nav class="toc">` on the right side of note pages

**Behavior:**
- Sticky positioning (follows scroll)
- Active section highlighted using IntersectionObserver on heading elements
- On desktop (> 1024px): always visible as right sidebar
- On tablet (768px–1024px): hidden, togglable via a "Contents" button
- On mobile (< 768px): rendered inline at the top of the article, collapsible

### 4. Hover Previews on Internal Links

**Build time:**
- Generate `preview-data.json`: `{ "note-slug": { title, summary, snippet (first 150 chars) } }`
- Written to `_site/js/preview-data.json`
- Internal note links get a `data-note-slug` attribute for targeting

**Runtime:**
- On mouseenter (with 300ms debounce): fetch preview data (lazy-loaded, cached), show tooltip
- Tooltip: positioned below/above the link, shows title (bold) + summary + snippet
- On mouseleave or click: hide tooltip
- Tooltip styled as a card with subtle shadow and border
- Disabled on touch devices (no hover)

### 5. Breadcrumbs + Responsive Mobile

**Breadcrumbs:**
- Rendered below the top nav bar on every page
- Format: `Home › [section] › [page title]`
- For note pages: `Home › Notes › note-name`
- For tag pages: `Home › Tags › tag-name`
- For graph: `Home › Graph`
- Each segment is a clickable link

**Responsive layout:**
- Desktop (> 1024px): sidebar visible, TOC visible, full layout
- Tablet (768px–1024px): sidebar visible, TOC hidden (togglable)
- Mobile (< 768px): sidebar hidden behind hamburger menu, TOC inline/collapsed
- Hamburger button in top nav (only shown on mobile)
- Sidebar slides in as overlay with backdrop
- CSS transitions for all show/hide states (transform-based, not display)

### 6. Visual Polish

**Syntax highlighting:**
- Vendor Prism.js (core + common languages: javascript, typescript, python, bash, json, html, css, markdown)
- Include Prism CSS theme matching the site's dark/light mode
- Applied to all `<pre><code>` blocks in rendered markdown

**Typography:**
- Inter font from Google Fonts (preloaded, with `-apple-system, sans-serif` fallback)
- Line height: 1.6 for body, 1.3 for headings
- Max content width: 720px for readability

**Interactions:**
- Links: underline on hover with color transition
- Sidebar items: background highlight on hover
- Tag badges: slight scale on hover (1.02)
- Smooth scroll for TOC anchor links (`scroll-behavior: smooth`)

## Site Structure (Updated)

```
_site/
├── index.html
├── graph.html
├── notes/
│   └── {slug}.html
├── tags/
│   └── {tag-slug}.html
├── css/
│   ├── style.css          (complete rewrite with CSS variables + both themes)
│   └── prism.css          (syntax highlighting theme)
├── js/
│   ├── site.js            (search, TOC, hover previews, theme toggle, mobile nav)
│   ├── search-index.json  (pre-built at export time)
│   ├── preview-data.json  (pre-built at export time)
│   ├── prism.min.js       (vendored syntax highlighter)
│   ├── d3.min.js          (existing, for graph page)
│   └── graph.js           (existing, for graph page)
└── fonts/                  (optional: self-hosted Inter if we skip Google Fonts CDN)
```

## Page Template Structure

```html
<!DOCTYPE html>
<html data-theme="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{page title}</title>
    <link rel="stylesheet" href="{base}/css/style.css">
    <link rel="stylesheet" href="{base}/css/prism.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
    <nav class="top-nav">
        <div class="nav-left">
            <button class="hamburger" aria-label="Menu">☰</button>
            <a class="site-title" href="{base}/index.html">My Notes</a>
        </div>
        <div class="nav-right">
            <div class="search-container">
                <input type="text" class="search-input" placeholder="Search notes...">
                <div class="search-results"></div>
            </div>
            <button class="theme-toggle" aria-label="Toggle theme">☀/☾</button>
        </div>
    </nav>
    <div class="breadcrumbs">{breadcrumb links}</div>
    <div class="layout">
        <aside class="sidebar">{navigation + tags}</aside>
        <main class="content">{rendered markdown}</main>
        <nav class="toc">{table of contents}</nav>  <!-- note pages only -->
    </div>
    <script src="{base}/js/site.js"></script>
    <script src="{base}/js/prism.min.js"></script>
</body>
</html>
```

## Files to Create/Modify

| File | Action | Responsibility |
|------|--------|---------------|
| `resources/site-template/style.css` | Rewrite | Full CSS with variables, both themes, responsive breakpoints |
| `resources/site-template/site.js` | Create | Client-side: search, TOC observer, hover previews, theme toggle, mobile nav |
| `resources/site-template/prism.min.js` | Create | Vendored Prism.js core + languages |
| `resources/site-template/prism.css` | Create | Prism theme matching site dark/light modes |
| `src/siteExporter.ts` | Rewrite | New page templates, search index, preview data, breadcrumbs, TOC extraction |
| `src/extension.ts` | No change | Command already registered |
| `package.json` | No change | Command already registered |

## Implementation Order

1. **CSS rewrite** — new stylesheet with variables, themes, responsive layout
2. **Prism.js vendoring** — copy bundled Prism to resources
3. **Client-side JS** — site.js with all runtime features (search, TOC, previews, theme, mobile)
4. **Site exporter rewrite** — new templates, search index generation, preview data, breadcrumbs, TOC
5. **Integration test** — export a test workspace and verify all features work

This order ensures the static assets are ready before the exporter references them.
