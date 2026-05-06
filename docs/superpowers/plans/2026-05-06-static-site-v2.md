# Static Site V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the static site export to produce a polished GitHub-styled wiki with search, dark mode, TOC, hover previews, breadcrumbs, responsive mobile, and syntax highlighting.

**Architecture:** Static assets (CSS, JS, Prism) are stored in `resources/site-template/` and copied during export. The site exporter generates JSON indexes for search and previews at build time. All runtime interactivity is in a single `site.js` file. The page template is rewritten with the new nav/sidebar/TOC layout.

**Tech Stack:** TypeScript (exporter), CSS custom properties (theming), vanilla JS (runtime), Prism.js (syntax highlighting), Inter font (typography).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `resources/site-template/style.css` (rewrite) | Full CSS with custom properties, dark/light themes, responsive breakpoints, layout grid |
| `resources/site-template/site.js` (create) | Client-side: search, TOC highlighting, hover previews, theme toggle, mobile hamburger |
| `resources/site-template/prism.min.js` (create) | Vendored Prism.js core + common languages |
| `resources/site-template/prism.css` (create) | Prism theme that uses site CSS variables |
| `src/siteExporter.ts` (rewrite) | New page templates, search/preview JSON generation, TOC extraction, breadcrumbs |
| `src/test/siteExporter.test.ts` (modify) | Updated tests for new helper functions |

---

## Task 1: CSS Rewrite — GitHub-Style with Themes

**Files:**
- Rewrite: `resources/site-template/style.css`

- [ ] **Step 1: Write the complete CSS file**

Rewrite `resources/site-template/style.css` with the full content:

```css
:root, [data-theme="dark"] {
    --color-bg-primary: #0d1117;
    --color-bg-secondary: #161b22;
    --color-bg-tertiary: #21262d;
    --color-text-primary: #c9d1d9;
    --color-text-secondary: #8b949e;
    --color-text-muted: #484f58;
    --color-link: #58a6ff;
    --color-link-hover: #79c0ff;
    --color-border: #30363d;
    --color-border-muted: #21262d;
    --color-tag-bg: #1f6feb33;
    --color-tag-text: #58a6ff;
    --color-code-bg: #161b22;
    --color-nav-bg: #010409;
    --color-hover-bg: #1c2128;
    --color-shadow: rgba(0,0,0,0.3);
}

[data-theme="light"] {
    --color-bg-primary: #ffffff;
    --color-bg-secondary: #f6f8fa;
    --color-bg-tertiary: #eaeef2;
    --color-text-primary: #1f2328;
    --color-text-secondary: #656d76;
    --color-text-muted: #8c959f;
    --color-link: #0969da;
    --color-link-hover: #0550ae;
    --color-border: #d0d7de;
    --color-border-muted: #eaeef2;
    --color-tag-bg: #ddf4ff;
    --color-tag-text: #0969da;
    --color-code-bg: #f6f8fa;
    --color-nav-bg: #f6f8fa;
    --color-hover-bg: #eaeef2;
    --color-shadow: rgba(0,0,0,0.08);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.6;
    color: var(--color-text-primary);
    background: var(--color-bg-primary);
    transition: background-color 0.2s, color 0.2s;
}

/* Top Nav */
.top-nav {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 20px;
    background: var(--color-nav-bg);
    border-bottom: 1px solid var(--color-border);
}
.nav-left { display: flex; align-items: center; gap: 12px; }
.nav-right { display: flex; align-items: center; gap: 12px; }
.site-title { color: var(--color-link); font-weight: 600; font-size: 14px; text-decoration: none; }
.hamburger { display: none; background: none; border: none; color: var(--color-text-primary); font-size: 20px; cursor: pointer; padding: 4px 8px; }
.theme-toggle { background: none; border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text-secondary); cursor: pointer; padding: 4px 8px; font-size: 14px; }
.theme-toggle:hover { background: var(--color-hover-bg); }

/* Search */
.search-container { position: relative; }
.search-input {
    width: 240px;
    padding: 5px 12px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    font-size: 13px;
}
.search-input:focus { outline: none; border-color: var(--color-link); }
.search-results {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px var(--color-shadow);
    max-height: 400px;
    overflow-y: auto;
    z-index: 200;
}
.search-results.active { display: block; }
.search-result-item {
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border-muted);
    cursor: pointer;
    transition: background 0.15s;
}
.search-result-item:hover { background: var(--color-hover-bg); }
.search-result-item:last-child { border-bottom: none; }
.search-result-title { font-weight: 500; font-size: 13px; color: var(--color-link); }
.search-result-snippet { font-size: 12px; color: var(--color-text-secondary); margin-top: 2px; }

/* Breadcrumbs */
.breadcrumbs {
    padding: 6px 20px;
    font-size: 12px;
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--color-border-muted);
    background: var(--color-bg-secondary);
}
.breadcrumbs a { color: var(--color-link); text-decoration: none; }
.breadcrumbs a:hover { text-decoration: underline; }
.breadcrumbs .sep { margin: 0 6px; opacity: 0.5; }

/* Layout */
.layout { display: flex; min-height: calc(100vh - 80px); }

/* Sidebar */
.sidebar {
    width: 250px;
    padding: 16px;
    border-right: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
    overflow-y: auto;
    position: sticky;
    top: 41px;
    height: calc(100vh - 41px);
}
.sidebar h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 16px 0 6px; }
.sidebar ul { list-style: none; }
.sidebar li { margin: 1px 0; }
.sidebar a { display: block; padding: 4px 8px; border-radius: 6px; color: var(--color-text-primary); text-decoration: none; font-size: 13px; transition: background 0.15s; }
.sidebar a:hover { background: var(--color-hover-bg); color: var(--color-link); }

/* Main content */
.content {
    flex: 1;
    padding: 32px 40px;
    max-width: 720px;
    min-width: 0;
}
.content h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; line-height: 1.3; }
.content h2 { font-size: 20px; font-weight: 600; margin-top: 32px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--color-border-muted); }
.content h3 { font-size: 16px; font-weight: 600; margin-top: 24px; margin-bottom: 8px; }
.content p { margin-bottom: 16px; }
.content ul, .content ol { margin-left: 20px; margin-bottom: 16px; }
.content li { margin-bottom: 4px; }
.content a { color: var(--color-link); text-decoration: none; }
.content a:hover { text-decoration: underline; color: var(--color-link-hover); }
.content img { max-width: 100%; height: auto; border-radius: 6px; margin: 16px 0; }
.content code { background: var(--color-code-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: 'SFMono-Regular', Consolas, monospace; }
.content pre { background: var(--color-code-bg); padding: 16px; border-radius: 8px; overflow-x: auto; margin-bottom: 16px; border: 1px solid var(--color-border-muted); }
.content pre code { background: none; padding: 0; border-radius: 0; }
.content blockquote { border-left: 3px solid var(--color-border); padding-left: 16px; color: var(--color-text-secondary); margin-bottom: 16px; }

/* Tags */
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 20px; }
.tag { background: var(--color-tag-bg); color: var(--color-tag-text); padding: 2px 10px; border-radius: 12px; font-size: 12px; text-decoration: none; transition: transform 0.1s; }
.tag:hover { transform: scale(1.02); }

/* TOC */
.toc {
    width: 200px;
    padding: 16px;
    position: sticky;
    top: 80px;
    height: fit-content;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
}
.toc h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin-bottom: 8px; }
.toc ul { list-style: none; }
.toc li { margin: 2px 0; }
.toc a { display: block; padding: 3px 8px; font-size: 12px; color: var(--color-text-secondary); text-decoration: none; border-left: 2px solid transparent; border-radius: 0 4px 4px 0; transition: all 0.15s; }
.toc a:hover { color: var(--color-link); background: var(--color-hover-bg); }
.toc a.active { color: var(--color-link); border-left-color: var(--color-link); }
.toc .toc-h3 { padding-left: 16px; }

/* Backlinks */
.backlinks { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--color-border); }
.backlinks h3 { font-size: 13px; color: var(--color-text-secondary); margin-bottom: 8px; }
.backlinks ul { list-style: none; }
.backlinks li { margin: 4px 0; }
.backlinks a { color: var(--color-link); font-size: 13px; }

/* Tag cloud (index page) */
.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.note-list { list-style: none; }
.note-list li { padding: 10px 0; border-bottom: 1px solid var(--color-border-muted); }
.note-list a { color: var(--color-link); font-weight: 500; }
.note-list .summary { display: block; font-size: 13px; color: var(--color-text-secondary); margin-top: 2px; }

/* Hover preview */
.hover-preview {
    display: none;
    position: absolute;
    z-index: 300;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px var(--color-shadow);
    padding: 12px 16px;
    max-width: 320px;
    font-size: 13px;
}
.hover-preview.active { display: block; }
.hover-preview-title { font-weight: 600; margin-bottom: 4px; color: var(--color-text-primary); }
.hover-preview-summary { color: var(--color-text-secondary); line-height: 1.4; }

/* Graph */
#graph-container { width: 100%; height: 80vh; }

/* Responsive */
@media (max-width: 1024px) {
    .toc { display: none; }
}
@media (max-width: 768px) {
    .hamburger { display: block; }
    .sidebar {
        position: fixed;
        top: 41px;
        left: 0;
        bottom: 0;
        z-index: 50;
        transform: translateX(-100%);
        transition: transform 0.25s ease;
        width: 260px;
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        top: 41px;
        background: rgba(0,0,0,0.4);
        z-index: 49;
    }
    .sidebar-backdrop.active { display: block; }
    .content { padding: 20px 16px; }
    .search-input { width: 160px; }
    .breadcrumbs { padding: 6px 16px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add resources/site-template/style.css
git commit -m "feat: rewrite site CSS with GitHub-style themes and responsive layout"
```

---

## Task 2: Vendor Prism.js

**Files:**
- Create: `resources/site-template/prism.min.js`
- Create: `resources/site-template/prism.css`

- [ ] **Step 1: Download Prism bundle**

Run:
```bash
curl -o resources/site-template/prism.min.js "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"
curl -o resources/site-template/prism-autoloader.min.js "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"
```

Note: We use the autoloader plugin so Prism loads language grammars on demand rather than bundling them all.

- [ ] **Step 2: Create the Prism CSS theme using site variables**

Create `resources/site-template/prism.css`:

```css
code[class*="language-"],
pre[class*="language-"] {
    color: var(--color-text-primary);
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 13px;
    text-align: left;
    white-space: pre;
    word-spacing: normal;
    word-break: normal;
    word-wrap: normal;
    line-height: 1.5;
    tab-size: 4;
}

.token.comment,
.token.prolog,
.token.doctype,
.token.cdata { color: var(--color-text-muted); }

.token.punctuation { color: var(--color-text-secondary); }

.token.property,
.token.tag,
.token.boolean,
.token.number,
.token.constant,
.token.symbol,
.token.deleted { color: #f97583; }

.token.selector,
.token.attr-name,
.token.string,
.token.char,
.token.builtin,
.token.inserted { color: #a5d6ff; }

.token.operator,
.token.entity,
.token.url { color: #79c0ff; }

.token.atrule,
.token.attr-value,
.token.keyword { color: #ff7b72; }

.token.function,
.token.class-name { color: #d2a8ff; }

.token.regex,
.token.important,
.token.variable { color: #ffa657; }

[data-theme="light"] .token.comment,
[data-theme="light"] .token.prolog,
[data-theme="light"] .token.doctype,
[data-theme="light"] .token.cdata { color: #6a737d; }

[data-theme="light"] .token.punctuation { color: #393a34; }

[data-theme="light"] .token.property,
[data-theme="light"] .token.tag,
[data-theme="light"] .token.boolean,
[data-theme="light"] .token.number,
[data-theme="light"] .token.constant,
[data-theme="light"] .token.symbol,
[data-theme="light"] .token.deleted { color: #cf222e; }

[data-theme="light"] .token.selector,
[data-theme="light"] .token.attr-name,
[data-theme="light"] .token.string,
[data-theme="light"] .token.char,
[data-theme="light"] .token.builtin,
[data-theme="light"] .token.inserted { color: #0550ae; }

[data-theme="light"] .token.operator,
[data-theme="light"] .token.entity,
[data-theme="light"] .token.url { color: #0969da; }

[data-theme="light"] .token.atrule,
[data-theme="light"] .token.attr-value,
[data-theme="light"] .token.keyword { color: #cf222e; }

[data-theme="light"] .token.function,
[data-theme="light"] .token.class-name { color: #8250df; }

[data-theme="light"] .token.regex,
[data-theme="light"] .token.important,
[data-theme="light"] .token.variable { color: #953800; }
```

- [ ] **Step 3: Commit**

```bash
git add resources/site-template/prism.min.js resources/site-template/prism-autoloader.min.js resources/site-template/prism.css
git commit -m "feat: vendor Prism.js with autoloader and themed CSS"
```

---

## Task 3: Client-side JavaScript (site.js)

**Files:**
- Create: `resources/site-template/site.js`

- [ ] **Step 1: Create the site.js file**

Create `resources/site-template/site.js`:

```javascript
(function() {
    // Theme Toggle
    function initTheme() {
        var saved = localStorage.getItem('ai-notes-theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
        } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        updateToggleIcon();
    }

    function updateToggleIcon() {
        var btn = document.querySelector('.theme-toggle');
        if (!btn) return;
        var theme = document.documentElement.getAttribute('data-theme');
        btn.textContent = theme === 'dark' ? '☀' : '☽';
    }

    var toggleBtn = document.querySelector('.theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            var current = document.documentElement.getAttribute('data-theme');
            var next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('ai-notes-theme', next);
            updateToggleIcon();
        });
    }
    initTheme();

    // Mobile Hamburger
    var hamburger = document.querySelector('.hamburger');
    var sidebar = document.querySelector('.sidebar');
    var backdrop = document.querySelector('.sidebar-backdrop');

    if (hamburger && sidebar) {
        hamburger.addEventListener('click', function() {
            sidebar.classList.toggle('open');
            if (backdrop) backdrop.classList.toggle('active');
        });
        if (backdrop) {
            backdrop.addEventListener('click', function() {
                sidebar.classList.remove('open');
                backdrop.classList.remove('active');
            });
        }
    }

    // Search
    var searchInput = document.querySelector('.search-input');
    var searchResults = document.querySelector('.search-results');
    var searchIndex = null;

    if (searchInput && searchResults) {
        searchInput.addEventListener('focus', function() {
            if (!searchIndex) {
                var base = document.querySelector('meta[name="base-path"]');
                var basePath = base ? base.content : '.';
                fetch(basePath + '/js/search-index.json')
                    .then(function(r) { return r.json(); })
                    .then(function(data) { searchIndex = data; })
                    .catch(function() {});
            }
        });

        searchInput.addEventListener('input', function() {
            var query = searchInput.value.trim().toLowerCase();
            if (!query || !searchIndex) {
                searchResults.classList.remove('active');
                return;
            }
            var matches = searchIndex.filter(function(note) {
                return note.title.toLowerCase().includes(query) ||
                    (note.summary && note.summary.toLowerCase().includes(query)) ||
                    note.tags.some(function(t) { return t.toLowerCase().includes(query); }) ||
                    note.content.toLowerCase().includes(query);
            }).slice(0, 10);

            if (matches.length === 0) {
                searchResults.classList.remove('active');
                return;
            }

            searchResults.innerHTML = matches.map(function(m) {
                var snippet = m.summary || m.content.slice(0, 80);
                return '<a class="search-result-item" href="' + m.url + '">' +
                    '<div class="search-result-title">' + escapeHtml(m.title) + '</div>' +
                    '<div class="search-result-snippet">' + escapeHtml(snippet) + '</div></a>';
            }).join('');
            searchResults.classList.add('active');
        });

        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                searchResults.classList.remove('active');
                searchInput.blur();
            }
        });

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.search-container')) {
                searchResults.classList.remove('active');
            }
        });
    }

    // Table of Contents — scroll spy
    var tocLinks = document.querySelectorAll('.toc a');
    if (tocLinks.length > 0) {
        var headings = [];
        tocLinks.forEach(function(link) {
            var id = link.getAttribute('href').slice(1);
            var el = document.getElementById(id);
            if (el) headings.push({ el: el, link: link });
        });

        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    tocLinks.forEach(function(l) { l.classList.remove('active'); });
                    var match = headings.find(function(h) { return h.el === entry.target; });
                    if (match) match.link.classList.add('active');
                }
            });
        }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });

        headings.forEach(function(h) { observer.observe(h.el); });
    }

    // Hover Previews
    var previewData = null;
    var previewEl = document.querySelector('.hover-preview');
    var previewTimeout = null;

    document.querySelectorAll('a[data-note-slug]').forEach(function(link) {
        link.addEventListener('mouseenter', function(e) {
            if (!previewEl) return;
            if (!previewData) {
                var base = document.querySelector('meta[name="base-path"]');
                var basePath = base ? base.content : '.';
                fetch(basePath + '/js/preview-data.json')
                    .then(function(r) { return r.json(); })
                    .then(function(data) { previewData = data; showPreview(e, link); })
                    .catch(function() {});
                return;
            }
            showPreview(e, link);
        });

        link.addEventListener('mouseleave', function() {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(function() {
                if (previewEl) previewEl.classList.remove('active');
            }, 100);
        });
    });

    function showPreview(e, link) {
        var slug = link.getAttribute('data-note-slug');
        if (!previewData || !previewData[slug]) return;
        var data = previewData[slug];
        previewTimeout = setTimeout(function() {
            previewEl.innerHTML = '<div class="hover-preview-title">' + escapeHtml(data.title) + '</div>' +
                '<div class="hover-preview-summary">' + escapeHtml(data.summary || data.snippet) + '</div>';
            var rect = link.getBoundingClientRect();
            previewEl.style.left = rect.left + 'px';
            previewEl.style.top = (rect.bottom + window.scrollY + 8) + 'px';
            previewEl.classList.add('active');
        }, 300);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Smooth scroll for TOC links
    document.querySelectorAll('.toc a').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            var target = document.getElementById(link.getAttribute('href').slice(1));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
})();
```

- [ ] **Step 2: Commit**

```bash
git add resources/site-template/site.js
git commit -m "feat: add client-side JS for search, TOC, previews, theme, and mobile nav"
```

---

## Task 4: Site Exporter Rewrite

**Files:**
- Rewrite: `src/siteExporter.ts`
- Modify: `src/test/siteExporter.test.ts`

- [ ] **Step 1: Update the tests**

Replace `src/test/siteExporter.test.ts` with:

```typescript
import * as assert from 'assert';
import { rewriteMarkdownLinks, generateSlug, extractTocHeadings, buildBreadcrumb } from '../siteExporter';

suite('SiteExporter', () => {
    test('rewriteMarkdownLinks converts .md to .html paths', () => {
        const md = 'See [my note](./other-note.md) for details.';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [my note](../notes/other-note.html) for details.');
    });

    test('rewriteMarkdownLinks ignores absolute URLs', () => {
        const md = 'See [docs](https://example.com/page.md).';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [docs](https://example.com/page.md).');
    });

    test('generateSlug creates url-safe slugs', () => {
        assert.strictEqual(generateSlug('Hello World'), 'hello-world');
        assert.strictEqual(generateSlug('C++ Notes!'), 'c-notes');
    });

    test('extractTocHeadings finds h2 and h3', () => {
        const html = '<h2 id="intro">Introduction</h2><p>text</p><h3 id="sub">Sub section</h3>';
        const toc = extractTocHeadings(html);
        assert.strictEqual(toc.length, 2);
        assert.strictEqual(toc[0].id, 'intro');
        assert.strictEqual(toc[0].text, 'Introduction');
        assert.strictEqual(toc[0].level, 2);
        assert.strictEqual(toc[1].level, 3);
    });

    test('buildBreadcrumb for note page', () => {
        const result = buildBreadcrumb('note', 'api-design', '..');
        assert.ok(result.includes('Home'));
        assert.ok(result.includes('Notes'));
        assert.ok(result.includes('api-design'));
    });

    test('buildBreadcrumb for tag page', () => {
        const result = buildBreadcrumb('tag', 'meeting', '..');
        assert.ok(result.includes('Tags'));
        assert.ok(result.includes('meeting'));
    });
});
```

- [ ] **Step 2: Rewrite siteExporter.ts**

Replace the entire content of `src/siteExporter.ts` with:

```typescript
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';
import { extractTagsFromContent } from './tagCache';
import { extractSummaryFromContent } from './summaries';
import { extractMarkdownLinks } from './backlinksWebview';
import { scanWorkspaceForGraph, buildGraphData } from './graphData';

interface SiteNote {
    filePath: string;
    fileName: string;
    slug: string;
    tags: string[];
    summary: string | null;
    content: string;
    htmlContent: string;
    backlinks: string[];
}

interface TocEntry {
    id: string;
    text: string;
    level: number;
}

interface SearchEntry {
    title: string;
    tags: string[];
    summary: string | null;
    content: string;
    url: string;
}

interface PreviewEntry {
    title: string;
    summary: string | null;
    snippet: string;
}

export function rewriteMarkdownLinks(md: string): string {
    return md.replace(/\[([^\]]*)\]\(([^)]+\.md)\)/g, (match, text, href) => {
        if (/^https?:\/\//.test(href)) { return match; }
        const basename = path.basename(href, '.md');
        return `[${text}](../notes/${basename}.html)`;
    });
}

export function generateSlug(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function extractTocHeadings(html: string): TocEntry[] {
    const regex = /<h([23])\s+id="([^"]*)"[^>]*>(.*?)<\/h[23]>/g;
    const entries: TocEntry[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        entries.push({ level: parseInt(match[1]), id: match[2], text: match[3].replace(/<[^>]+>/g, '') });
    }
    return entries;
}

export function buildBreadcrumb(type: 'note' | 'tag' | 'graph' | 'index', name: string, basePath: string): string {
    const home = `<a href="${basePath}/index.html">Home</a>`;
    const sep = '<span class="sep">›</span>';
    if (type === 'index') { return home; }
    if (type === 'graph') { return `${home}${sep}Graph`; }
    if (type === 'tag') { return `${home}${sep}<a href="${basePath}/index.html#tags">Tags</a>${sep}${name}`; }
    return `${home}${sep}Notes${sep}${name}`;
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function exportSite(workspaceRoot: string, extensionPath: string): Promise<string> {
    const siteDir = path.join(workspaceRoot, '_site');
    if (fs.existsSync(siteDir)) { await fsp.rm(siteDir, { recursive: true }); }
    fs.mkdirSync(path.join(siteDir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'tags'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'js'), { recursive: true });

    // Copy assets
    const templateDir = path.join(extensionPath, 'resources', 'site-template');
    await fsp.copyFile(path.join(templateDir, 'style.css'), path.join(siteDir, 'css', 'style.css'));
    await fsp.copyFile(path.join(templateDir, 'prism.css'), path.join(siteDir, 'css', 'prism.css'));
    await fsp.copyFile(path.join(templateDir, 'site.js'), path.join(siteDir, 'js', 'site.js'));
    await fsp.copyFile(path.join(templateDir, 'prism.min.js'), path.join(siteDir, 'js', 'prism.min.js'));
    await fsp.copyFile(path.join(templateDir, 'prism-autoloader.min.js'), path.join(siteDir, 'js', 'prism-autoloader.min.js'));
    await fsp.copyFile(path.join(extensionPath, 'resources', 'd3.min.js'), path.join(siteDir, 'js', 'd3.min.js'));
    await fsp.copyFile(path.join(templateDir, 'graph.js'), path.join(siteDir, 'js', 'graph.js'));

    // Gather notes
    const notes = await gatherSiteNotes(workspaceRoot);
    const allTags = collectTags(notes);
    for (const note of notes) { note.backlinks = findBacklinks(note, notes); }

    // Build search index and preview data
    const searchIndex: SearchEntry[] = [];
    const previewData: Record<string, PreviewEntry> = {};
    for (const note of notes) {
        searchIndex.push({ title: note.slug, tags: note.tags, summary: note.summary, content: note.content.slice(0, 500), url: `notes/${note.slug}.html` });
        previewData[note.slug] = { title: note.slug, summary: note.summary, snippet: note.content.slice(0, 150) };
    }
    await fsp.writeFile(path.join(siteDir, 'js', 'search-index.json'), JSON.stringify(searchIndex), 'utf8');
    await fsp.writeFile(path.join(siteDir, 'js', 'preview-data.json'), JSON.stringify(previewData), 'utf8');

    // Generate note pages
    for (const note of notes) {
        const html = renderNotePage(note, allTags);
        await fsp.writeFile(path.join(siteDir, 'notes', `${note.slug}.html`), html, 'utf8');
    }

    // Generate tag pages
    for (const [tag, tagNotes] of Object.entries(allTags)) {
        const html = renderTagPage(tag, tagNotes, allTags);
        await fsp.writeFile(path.join(siteDir, 'tags', `${generateSlug(tag)}.html`), html, 'utf8');
    }

    // Generate index
    await fsp.writeFile(path.join(siteDir, 'index.html'), renderIndexPage(notes, allTags), 'utf8');

    // Generate graph
    const graphNotes = await scanWorkspaceForGraph(workspaceRoot);
    const graphData = buildGraphData(graphNotes);
    await fsp.writeFile(path.join(siteDir, 'graph.html'), renderGraphPage(graphData, allTags), 'utf8');

    return siteDir;
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts', '_site', '_moc', '.ai-notes', '.templates']);

async function gatherSiteNotes(workspaceRoot: string): Promise<SiteNote[]> {
    const notes: SiteNote[] = [];
    await walkSite(workspaceRoot, notes);
    return notes;
}

async function walkSite(dir: string, notes: SiteNote[]): Promise<void> {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walkSite(fullPath, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const raw = await fsp.readFile(fullPath, 'utf8');
                const tags = extractTagsFromContent(raw);
                const summary = extractSummaryFromContent(raw);
                const content = raw.replace(/^---\n(?:.*\n)*?---\n/, '');
                const rewritten = rewriteMarkdownLinks(content);
                const htmlContent = marked(rewritten) as string;
                const slug = path.basename(fullPath, '.md');
                notes.push({ filePath: fullPath, fileName: entry.name, slug, tags, summary, content, htmlContent, backlinks: [] });
            } catch {}
        }
    }
}

function collectTags(notes: SiteNote[]): Record<string, SiteNote[]> {
    const tags: Record<string, SiteNote[]> = {};
    for (const note of notes) {
        for (const tag of note.tags) {
            if (!tags[tag]) { tags[tag] = []; }
            tags[tag].push(note);
        }
    }
    return tags;
}

function findBacklinks(target: SiteNote, allNotes: SiteNote[]): string[] {
    const backlinks: string[] = [];
    for (const note of allNotes) {
        if (note.filePath === target.filePath) { continue; }
        const links = extractMarkdownLinks(note.content);
        for (const link of links) {
            const resolved = path.resolve(path.dirname(note.filePath), link.href);
            if (resolved === target.filePath) { backlinks.push(note.slug); break; }
        }
    }
    return backlinks;
}

function pageHead(title: string, basePath: string): string {
    return `<!DOCTYPE html>
<html data-theme="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="base-path" content="${basePath}">
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${basePath}/css/style.css">
    <link rel="stylesheet" href="${basePath}/css/prism.css">
</head>
<body>`;
}

function navBar(basePath: string): string {
    return `<nav class="top-nav">
    <div class="nav-left">
        <button class="hamburger" aria-label="Menu">☰</button>
        <a class="site-title" href="${basePath}/index.html">My Notes</a>
    </div>
    <div class="nav-right">
        <div class="search-container">
            <input type="text" class="search-input" placeholder="Search notes...">
            <div class="search-results"></div>
        </div>
        <button class="theme-toggle" aria-label="Toggle theme">☽</button>
    </div>
</nav>`;
}

function sidebarHtml(allTags: Record<string, SiteNote[]>, basePath: string): string {
    const tagLinks = Object.keys(allTags).sort().map(tag =>
        `<li><a href="${basePath}/tags/${generateSlug(tag)}.html">${escapeHtml(tag)} (${allTags[tag].length})</a></li>`
    ).join('');
    return `<aside class="sidebar">
    <h3>Navigation</h3>
    <ul><li><a href="${basePath}/index.html">Home</a></li><li><a href="${basePath}/graph.html">Graph</a></li></ul>
    <h3>Tags</h3>
    <ul>${tagLinks}</ul>
</aside>
<div class="sidebar-backdrop"></div>`;
}

function tocHtml(entries: TocEntry[]): string {
    if (entries.length === 0) { return ''; }
    const items = entries.map(e =>
        `<li><a href="#${e.id}" class="${e.level === 3 ? 'toc-h3' : ''}">${escapeHtml(e.text)}</a></li>`
    ).join('');
    return `<nav class="toc"><h4>On this page</h4><ul>${items}</ul></nav>`;
}

function pageFooter(basePath: string): string {
    return `<div class="hover-preview"></div>
    <script src="${basePath}/js/site.js"></script>
    <script src="${basePath}/js/prism.min.js"></script>
    <script src="${basePath}/js/prism-autoloader.min.js"></script>
</body></html>`;
}

function addNoteSlugToLinks(html: string, notes: SiteNote[]): string {
    const slugSet = new Set(notes.map(n => n.slug));
    return html.replace(/<a\s+href="\.\.\/notes\/([^"]+)\.html"/g, (match, slug) => {
        if (slugSet.has(slug)) { return `${match} data-note-slug="${slug}"`; }
        return match;
    });
}

function renderNotePage(note: SiteNote, allTags: Record<string, SiteNote[]>): string {
    const basePath = '..';
    const toc = extractTocHeadings(note.htmlContent);
    const tagsHtml = note.tags.length > 0
        ? `<div class="tags">${note.tags.map(t => `<a class="tag" href="../tags/${generateSlug(t)}.html">${escapeHtml(t)}</a>`).join('')}</div>`
        : '';
    const backlinksHtml = note.backlinks.length > 0
        ? `<div class="backlinks"><h3>Backlinks</h3><ul>${note.backlinks.map(s => `<li><a href="${s}.html" data-note-slug="${s}">${escapeHtml(s)}</a></li>`).join('')}</ul></div>`
        : '';
    const contentWithSlugs = addNoteSlugToLinks(note.htmlContent, []);

    return `${pageHead(note.slug, basePath)}
${navBar(basePath)}
<div class="breadcrumbs">${buildBreadcrumb('note', note.slug, basePath)}</div>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="content">
    <h1>${escapeHtml(note.slug)}</h1>
    ${tagsHtml}
    ${contentWithSlugs}
    ${backlinksHtml}
</main>
${tocHtml(toc)}
</div>
${pageFooter(basePath)}`;
}

function renderTagPage(tag: string, tagNotes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const basePath = '..';
    const noteList = tagNotes.map(n =>
        `<li><a href="../notes/${n.slug}.html" data-note-slug="${n.slug}">${escapeHtml(n.fileName)}</a>${n.summary ? `<span class="summary">${escapeHtml(n.summary)}</span>` : ''}</li>`
    ).join('');
    return `${pageHead(`Tag: ${tag}`, basePath)}
${navBar(basePath)}
<div class="breadcrumbs">${buildBreadcrumb('tag', tag, basePath)}</div>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="content">
    <h1>Tag: ${escapeHtml(tag)}</h1>
    <ul class="note-list">${noteList}</ul>
</main>
</div>
${pageFooter(basePath)}`;
}

function renderIndexPage(notes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const basePath = '.';
    const recent = notes.slice(0, 10);
    const recentList = recent.map(n =>
        `<li><a href="notes/${n.slug}.html" data-note-slug="${n.slug}">${escapeHtml(n.fileName)}</a>${n.summary ? `<span class="summary">${escapeHtml(n.summary)}</span>` : ''}</li>`
    ).join('');
    const tagCloud = Object.keys(allTags).sort().map(tag =>
        `<a class="tag" href="tags/${generateSlug(tag)}.html">${escapeHtml(tag)}</a>`
    ).join('');
    return `${pageHead('Notes Wiki', basePath)}
${navBar(basePath)}
<div class="breadcrumbs">${buildBreadcrumb('index', '', basePath)}</div>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="content">
    <h1>Notes Wiki</h1>
    <h2 id="recent">Recent Notes</h2>
    <ul class="note-list">${recentList}</ul>
    <h2 id="tags">Tags</h2>
    <div class="tag-cloud">${tagCloud}</div>
</main>
</div>
${pageFooter(basePath)}`;
}

function renderGraphPage(graphData: any, allTags: Record<string, SiteNote[]>): string {
    const basePath = '.';
    return `${pageHead('Knowledge Graph', basePath)}
${navBar(basePath)}
<div class="breadcrumbs">${buildBreadcrumb('graph', '', basePath)}</div>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="content" style="max-width:none;">
    <h1>Knowledge Graph</h1>
    <div id="graph-container"></div>
</main>
</div>
<script src="${basePath}/js/d3.min.js"></script>
<script>window.graphData = ${JSON.stringify(graphData)}; window.graphNavBase = 'notes/';</script>
<script src="${basePath}/js/graph.js"></script>
${pageFooter(basePath)}`;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/siteExporter.ts src/test/siteExporter.test.ts
git commit -m "feat: rewrite site exporter with search, TOC, previews, and breadcrumbs"
```

---

## Summary

| Task | Feature | Effort |
|------|---------|--------|
| 1 | CSS rewrite (themes, responsive, all components) | Medium |
| 2 | Vendor Prism.js | Trivial |
| 3 | Client-side JS (search, TOC, previews, theme, mobile) | Large |
| 4 | Site exporter rewrite (templates, JSON indexes, TOC) | Large |

Total: 4 focused tasks. Tasks 1-3 are static assets, Task 4 is the TypeScript rewrite.
