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

export interface TocEntry {
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
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
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

function pageHead(title: string, basePath: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="base-path" content="${basePath}">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${basePath}/css/style.css">
<link rel="stylesheet" href="${basePath}/css/prism.css">
</head>
<body>`;
}

function navBar(basePath: string): string {
    return `<nav class="top-nav">
<button class="hamburger" aria-label="Toggle sidebar">&#9776;</button>
<a class="site-title" href="${basePath}/index.html">Notes Wiki</a>
<div class="nav-right">
<input type="search" class="search-input" placeholder="Search notes..." aria-label="Search notes">
<button class="theme-toggle" aria-label="Toggle theme">&#9790;</button>
</div>
</nav>`;
}

function sidebarHtml(allTags: Record<string, SiteNote[]>, basePath: string): string {
    const tagLinks = Object.keys(allTags).sort().map(tag =>
        `<li><a href="${basePath}/tags/${generateSlug(tag)}.html">${tag} (${allTags[tag].length})</a></li>`
    ).join('\n');
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
        `<li class="toc-h${e.level}"><a href="#${e.id}">${e.text}</a></li>`
    ).join('\n');
    return `<nav class="toc"><h4>On this page</h4><ul>${items}</ul></nav>`;
}

function pageFooter(basePath: string): string {
    return `<div class="hover-preview"></div>
<script src="${basePath}/js/site.js"></script>
<script src="${basePath}/js/prism.min.js"></script>
<script src="${basePath}/js/prism-autoloader.min.js"></script>
</body>
</html>`;
}

export async function exportSite(workspaceRoot: string, extensionPath: string): Promise<string> {
    // Configure marked to generate heading IDs
    const renderer = new marked.Renderer();
    renderer.heading = function ({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const slug = text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `<h${depth} id="${slug}">${text}</h${depth}>`;
    };
    marked.use({ renderer });

    const siteDir = path.join(workspaceRoot, '_site');

    if (fs.existsSync(siteDir)) {
        await fsp.rm(siteDir, { recursive: true });
    }
    fs.mkdirSync(path.join(siteDir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'tags'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'js'), { recursive: true });

    // Copy CSS assets
    const styleSrc = path.join(extensionPath, 'resources', 'site-template', 'style.css');
    await fsp.copyFile(styleSrc, path.join(siteDir, 'css', 'style.css'));
    const prismCssSrc = path.join(extensionPath, 'resources', 'site-template', 'prism.css');
    await fsp.copyFile(prismCssSrc, path.join(siteDir, 'css', 'prism.css'));

    // Copy JS assets
    const d3Src = path.join(extensionPath, 'resources', 'd3.min.js');
    await fsp.copyFile(d3Src, path.join(siteDir, 'js', 'd3.min.js'));
    const graphJsSrc = path.join(extensionPath, 'resources', 'site-template', 'graph.js');
    await fsp.copyFile(graphJsSrc, path.join(siteDir, 'js', 'graph.js'));
    const siteJsSrc = path.join(extensionPath, 'resources', 'site-template', 'site.js');
    await fsp.copyFile(siteJsSrc, path.join(siteDir, 'js', 'site.js'));
    const prismJsSrc = path.join(extensionPath, 'resources', 'site-template', 'prism.min.js');
    await fsp.copyFile(prismJsSrc, path.join(siteDir, 'js', 'prism.min.js'));
    const prismAutoSrc = path.join(extensionPath, 'resources', 'site-template', 'prism-autoloader.min.js');
    await fsp.copyFile(prismAutoSrc, path.join(siteDir, 'js', 'prism-autoloader.min.js'));

    const notes = await gatherSiteNotes(workspaceRoot);
    const allTags = collectTags(notes);

    for (const note of notes) {
        note.backlinks = findBacklinks(note, notes);
    }

    // Render HTML content for each note
    for (const note of notes) {
        const rewritten = rewriteMarkdownLinks(note.content);
        note.htmlContent = marked(rewritten) as string;
    }

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

    // Generate index page
    const indexHtml = renderIndexPage(notes, allTags);
    await fsp.writeFile(path.join(siteDir, 'index.html'), indexHtml, 'utf8');

    // Generate graph page
    const graphNotes = await scanWorkspaceForGraph(workspaceRoot);
    const graphData = buildGraphData(graphNotes);
    const graphHtml = renderGraphPage(graphData, allTags);
    await fsp.writeFile(path.join(siteDir, 'graph.html'), graphHtml, 'utf8');

    // Generate search-index.json
    const searchIndex: SearchEntry[] = notes.map(n => ({
        title: n.slug,
        tags: n.tags,
        summary: n.summary,
        content: n.content.slice(0, 500),
        url: `notes/${n.slug}.html`
    }));
    await fsp.writeFile(path.join(siteDir, 'search-index.json'), JSON.stringify(searchIndex), 'utf8');

    // Generate preview-data.json
    const previewData: Record<string, PreviewEntry> = {};
    for (const n of notes) {
        previewData[n.slug] = {
            title: n.slug,
            summary: n.summary,
            snippet: n.htmlContent.replace(/<[^>]+>/g, '').slice(0, 200)
        };
    }
    await fsp.writeFile(path.join(siteDir, 'preview-data.json'), JSON.stringify(previewData), 'utf8');

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
                const slug = path.basename(fullPath, '.md');
                notes.push({ filePath: fullPath, fileName: entry.name, slug, tags, summary, content, htmlContent: '', backlinks: [] });
            } catch { /* skip unreadable files */ }
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
            if (resolved === target.filePath) {
                backlinks.push(note.slug);
                break;
            }
        }
    }
    return backlinks;
}

function addDataNoteSlugs(html: string): string {
    return html.replace(/<a\s+href="(\.\.\/notes\/([^"]+)\.html)">/g, (match, href, slug) => {
        return `<a href="${href}" data-note-slug="${slug}">`;
    });
}

function renderNotePage(note: SiteNote, allTags: Record<string, SiteNote[]>): string {
    const basePath = '..';
    const contentWithSlugs = addDataNoteSlugs(note.htmlContent);
    const headings = extractTocHeadings(note.htmlContent);
    const backlinksHtml = note.backlinks.length > 0
        ? `<div class="backlinks"><h3>Backlinks</h3><ul>${note.backlinks.map(s => `<li><a href="${s}.html" data-note-slug="${s}">${s}</a></li>`).join('')}</ul></div>`
        : '';
    const breadcrumb = buildBreadcrumb('note', note.slug, basePath);

    return `${pageHead(note.slug, basePath)}
${navBar(basePath)}
<nav class="breadcrumb">${breadcrumb}</nav>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="main"><h1>${note.slug}</h1>${contentWithSlugs}${backlinksHtml}</main>
${tocHtml(headings)}
</div>
${pageFooter(basePath)}`;
}

function renderTagPage(tag: string, tagNotes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const basePath = '..';
    const noteList = tagNotes.map(n =>
        `<li><a href="../notes/${n.slug}.html" data-note-slug="${n.slug}">${n.fileName}</a>${n.summary ? `<span class="summary"> — ${n.summary}</span>` : ''}</li>`
    ).join('\n');
    const breadcrumb = buildBreadcrumb('tag', tag, basePath);

    return `${pageHead(`Tag: ${tag}`, basePath)}
${navBar(basePath)}
<nav class="breadcrumb">${breadcrumb}</nav>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="main"><h1>Tag: ${tag}</h1><ul class="note-list">${noteList}</ul></main>
</div>
${pageFooter(basePath)}`;
}

function renderIndexPage(notes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const basePath = '.';
    const recent = notes.slice(0, 10);
    const recentList = recent.map(n =>
        `<li><a href="notes/${n.slug}.html" data-note-slug="${n.slug}">${n.fileName}</a>${n.summary ? `<span class="summary"> — ${n.summary}</span>` : ''}</li>`
    ).join('\n');
    const tagCloud = Object.keys(allTags).sort().map(tag =>
        `<a href="tags/${generateSlug(tag)}.html">${tag}</a>`
    ).join('\n');
    const breadcrumb = buildBreadcrumb('index', '', basePath);

    return `${pageHead('Notes Wiki', basePath)}
${navBar(basePath)}
<nav class="breadcrumb">${breadcrumb}</nav>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="main"><h1>Notes Wiki</h1><h2 id="recent">Recent Notes</h2><ul class="note-list">${recentList}</ul><h2 id="tags">Tags</h2><div class="tag-cloud">${tagCloud}</div></main>
</div>
${pageFooter(basePath)}`;
}

function renderGraphPage(graphData: unknown, allTags: Record<string, SiteNote[]>): string {
    const basePath = '.';
    const breadcrumb = buildBreadcrumb('graph', '', basePath);

    return `${pageHead('Knowledge Graph', basePath)}
${navBar(basePath)}
<nav class="breadcrumb">${breadcrumb}</nav>
<div class="layout">
${sidebarHtml(allTags, basePath)}
<main class="main" style="max-width:none;padding:20px;">
<h1>Knowledge Graph</h1><div id="graph-container"></div>
<script src="./js/d3.min.js"></script>
<script>window.graphData = ${JSON.stringify(graphData)}; window.graphNavBase = 'notes/';</script>
<script src="./js/graph.js"></script>
</main>
</div>
${pageFooter(basePath)}`;
}
