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
    backlinks: string[];
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

export async function exportSite(workspaceRoot: string, extensionPath: string): Promise<string> {
    const siteDir = path.join(workspaceRoot, '_site');

    if (fs.existsSync(siteDir)) {
        await fsp.rm(siteDir, { recursive: true });
    }
    fs.mkdirSync(path.join(siteDir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'tags'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'js'), { recursive: true });

    const styleSrc = path.join(extensionPath, 'resources', 'site-template', 'style.css');
    await fsp.copyFile(styleSrc, path.join(siteDir, 'css', 'style.css'));

    const d3Src = path.join(extensionPath, 'resources', 'd3.min.js');
    await fsp.copyFile(d3Src, path.join(siteDir, 'js', 'd3.min.js'));

    const graphJsSrc = path.join(extensionPath, 'resources', 'site-template', 'graph.js');
    await fsp.copyFile(graphJsSrc, path.join(siteDir, 'js', 'graph.js'));

    const notes = await gatherSiteNotes(workspaceRoot);
    const allTags = collectTags(notes);

    for (const note of notes) {
        note.backlinks = findBacklinks(note, notes);
    }

    for (const note of notes) {
        const html = renderNotePage(note, allTags);
        await fsp.writeFile(path.join(siteDir, 'notes', `${note.slug}.html`), html, 'utf8');
    }

    for (const [tag, tagNotes] of Object.entries(allTags)) {
        const html = renderTagPage(tag, tagNotes, allTags);
        await fsp.writeFile(path.join(siteDir, 'tags', `${generateSlug(tag)}.html`), html, 'utf8');
    }

    const indexHtml = renderIndexPage(notes, allTags);
    await fsp.writeFile(path.join(siteDir, 'index.html'), indexHtml, 'utf8');

    const graphNotes = await scanWorkspaceForGraph(workspaceRoot);
    const graphData = buildGraphData(graphNotes);
    const graphHtml = renderGraphPage(graphData, allTags);
    await fsp.writeFile(path.join(siteDir, 'graph.html'), graphHtml, 'utf8');

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
                notes.push({ filePath: fullPath, fileName: entry.name, slug, tags, summary, content, backlinks: [] });
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
            if (resolved === target.filePath) {
                backlinks.push(note.slug);
                break;
            }
        }
    }
    return backlinks;
}

function sidebarHtml(allTags: Record<string, SiteNote[]>): string {
    const tagLinks = Object.keys(allTags).sort().map(tag =>
        `<li><a href="../tags/${generateSlug(tag)}.html">${tag} (${allTags[tag].length})</a></li>`
    ).join('\n');
    return `<div class="sidebar">
        <h3>Navigation</h3>
        <ul><li><a href="../index.html">Home</a></li><li><a href="../graph.html">Graph</a></li></ul>
        <h3>Tags</h3>
        <ul>${tagLinks}</ul>
    </div>`;
}

function renderNotePage(note: SiteNote, allTags: Record<string, SiteNote[]>): string {
    const rewritten = rewriteMarkdownLinks(note.content);
    const htmlContent = marked(rewritten) as string;
    const backlinksHtml = note.backlinks.length > 0
        ? `<div class="backlinks"><h3>Backlinks</h3><ul>${note.backlinks.map(s => `<li><a href="${s}.html">${s}</a></li>`).join('')}</ul></div>`
        : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${note.slug}</title><link rel="stylesheet" href="../css/style.css"></head><body>
<div class="layout">${sidebarHtml(allTags)}<div class="main"><h1>${note.slug}</h1>${htmlContent}${backlinksHtml}</div></div></body></html>`;
}

function renderTagPage(tag: string, tagNotes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const noteList = tagNotes.map(n =>
        `<li><a href="../notes/${n.slug}.html">${n.fileName}</a>${n.summary ? `<span class="summary"> — ${n.summary}</span>` : ''}</li>`
    ).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tag: ${tag}</title><link rel="stylesheet" href="../css/style.css"></head><body>
<div class="layout">${sidebarHtml(allTags)}<div class="main"><h1>Tag: ${tag}</h1><ul class="note-list">${noteList}</ul></div></div></body></html>`;
}

function renderIndexPage(notes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const recent = notes.slice(0, 10);
    const recentList = recent.map(n =>
        `<li><a href="notes/${n.slug}.html">${n.fileName}</a>${n.summary ? `<span class="summary"> — ${n.summary}</span>` : ''}</li>`
    ).join('\n');
    const tagCloud = Object.keys(allTags).sort().map(tag =>
        `<a href="tags/${generateSlug(tag)}.html">${tag}</a>`
    ).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Notes Wiki</title><link rel="stylesheet" href="css/style.css"></head><body>
<div class="layout"><div class="sidebar"><h3>Navigation</h3><ul><li><a href="index.html">Home</a></li><li><a href="graph.html">Graph</a></li></ul>
<h3>Tags</h3><ul>${Object.keys(allTags).sort().map(t => `<li><a href="tags/${generateSlug(t)}.html">${t} (${allTags[t].length})</a></li>`).join('')}</ul></div>
<div class="main"><h1>Notes Wiki</h1><h2>Recent Notes</h2><ul class="note-list">${recentList}</ul><h2>Tags</h2><div class="tag-cloud">${tagCloud}</div></div></div></body></html>`;
}

function renderGraphPage(graphData: unknown, allTags: Record<string, SiteNote[]>): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Knowledge Graph</title><link rel="stylesheet" href="css/style.css"></head><body>
<div class="layout">${sidebarHtml(allTags).replace(/\.\.\//g, '')}<div class="main" style="max-width:none;padding:20px;">
<h1>Knowledge Graph</h1><div id="graph-container"></div>
<script src="js/d3.min.js"></script>
<script>window.graphData = ${JSON.stringify(graphData)}; window.graphNavBase = 'notes/';</script>
<script src="js/graph.js"></script>
</div></div></body></html>`;
}
