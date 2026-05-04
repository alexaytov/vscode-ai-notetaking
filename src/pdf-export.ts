import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { marked } from 'marked';
import { execFile } from 'child_process';

function embedImagesInMarkdown(mdContent: string, mdFilePath: string): string {
    return mdContent.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, imgPath) => {
        if (/^https?:\/\//.test(imgPath)) {
            return match;
        }
        const absPath = path.isAbsolute(imgPath)
            ? imgPath
            : path.join(path.dirname(mdFilePath), imgPath);
        if (!fs.existsSync(absPath)) {
            return match;
        }
        const ext = path.extname(absPath).slice(1).toLowerCase();
        const mimeMap: Record<string, string> = {
            svg: 'image/svg+xml',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            png: 'image/png',
        };
        const mime = mimeMap[ext] || 'image/png';
        try {
            const data = fs.readFileSync(absPath).toString('base64');
            return `![${alt}](data:${mime};base64,${data})`;
        } catch {
            return match;
        }
    });
}

function findChromePath(): string | undefined {
    switch (process.platform) {
        case 'darwin':
            const macPaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            ];
            return macPaths.find(p => fs.existsSync(p));
        case 'win32':
            const winPaths = [
                process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
                process.env['PROGRAMFILES'] + '\\Google\\Chrome\\Application\\chrome.exe',
                process.env['LOCALAPPDATA'] + '\\Google\\Chrome\\Application\\chrome.exe',
                process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
                process.env['PROGRAMFILES'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
            ];
            return winPaths.find(p => p && fs.existsSync(p));
        case 'linux':
            const linuxPaths = [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                '/usr/bin/microsoft-edge',
            ];
            return linuxPaths.find(p => fs.existsSync(p));
        default:
            return undefined;
    }
}

export async function exportMarkdownToPdf(mdFilePath: string): Promise<void> {
    const chromePath = findChromePath();
    if (!chromePath) {
        vscode.window.showErrorMessage(
            'PDF export requires Chrome, Edge, or Chromium to be installed on your system.'
        );
        return;
    }

    const mdContent = fs.readFileSync(mdFilePath, 'utf8');
    const mdContentNoFrontmatter = mdContent.replace(/^---\n[\s\S]*?---\n/, '');
    const mdWithEmbeddedImages = embedImagesInMarkdown(mdContentNoFrontmatter, mdFilePath);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        @page { margin: 2cm; }
        img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; }
    </style>
</head>
<body>
    ${marked(mdWithEmbeddedImages)}
</body>
</html>`;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.dirname(mdFilePath);
    const tmpHtml = path.join(workspaceFolder, '___tmp_export.html');
    const pdfPath = mdFilePath.replace(/\.md$/, '.pdf');

    fs.writeFileSync(tmpHtml, htmlContent, { encoding: 'utf8' });

    try {
        await new Promise<void>((resolve, reject) => {
            execFile(chromePath, [
                '--headless',
                '--disable-gpu',
                '--no-sandbox',
                `--print-to-pdf=${pdfPath}`,
                '--print-to-pdf-no-header',
                tmpHtml,
            ], { timeout: 30000 }, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
        vscode.window.showInformationMessage(`PDF exported: ${pdfPath}`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`PDF export failed: ${err.message}`);
    } finally {
        if (fs.existsSync(tmpHtml)) {
            fs.unlinkSync(tmpHtml);
        }
    }
}
