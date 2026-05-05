import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { scanWorkspaceForGraph, buildGraphData } from './graphData';

export class GraphWebviewProvider {
    private panel?: vscode.WebviewPanel;

    constructor(
        private workspaceRoot: string,
        private extensionPath: string
    ) {}

    async show(): Promise<void> {
        if (this.panel) {
            this.panel.reveal();
            await this.update();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'aiNotesGraph',
            'Knowledge Graph',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this.panel.onDidDispose(() => { this.panel = undefined; });

        this.panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'openNote') {
                const uri = vscode.Uri.file(message.path);
                vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
            }
        });

        await this.update();
    }

    private async update(): Promise<void> {
        if (!this.panel) { return; }

        const notes = await scanWorkspaceForGraph(this.workspaceRoot);
        const graphData = buildGraphData(notes);

        const d3Path = path.join(this.extensionPath, 'resources', 'd3.min.js');
        const graphJsPath = path.join(this.extensionPath, 'resources', 'site-template', 'graph.js');

        const d3Script = fs.readFileSync(d3Path, 'utf8');
        const graphScript = fs.readFileSync(graphJsPath, 'utf8');

        this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
    body { margin: 0; padding: 0; background: #1e1e1e; overflow: hidden; }
    #graph-container { width: 100vw; height: 100vh; }
</style>
</head>
<body>
    <div id="graph-container"></div>
    <script>window.vscodeApi = acquireVsCodeApi();</script>
    <script>${d3Script}</script>
    <script>window.graphData = ${JSON.stringify(graphData)};</script>
    <script>${graphScript}</script>
</body>
</html>`;
    }
}
