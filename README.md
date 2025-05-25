# AI Notes

AI Notes is a Visual Studio Code extension that helps you create, organize, and categorize notes using AI. It supports multiple LLM providers and can suggest tags, names, and folders for your notes automatically.

## Features

- Create new notes with a single command
- AI-powered tag suggestion and editing
- AI-powered note naming
- AI-powered folder/categorization suggestion
- Supports multiple LLM providers (VS Code LM API, SAP AI Core)
- YAML frontmatter for tags

## Requirements

- Node.js and npm
- For SAP AI Core: a valid service key and model name
- For VS Code LM API: VS Code Insiders and the appropriate AI/LM extension (if required)

## Extension Settings

This extension contributes the following settings:

- `ai-notes.llmProvider`: Select the LLM provider (`vscode-lm-api` or `sap-ai-core`).
- `ai-notes.aiCoreServiceKey`: SAP AI Core service key (required if using SAP AI Core).
- `ai-notes.aiCoreModel`: Model name for SAP AI Core (required if using SAP AI Core).

## Usage

1. Run the `AI Notes: New Note` command from the Command Palette.
2. Edit your note and save it.
3. The extension will suggest tags (which you can edit), suggest a name, and organize your note automatically.

## Known Issues

- The VS Code LM API is only available in certain environments (e.g., VS Code Insiders with the right extension).
- SAP AI Core requires a valid service key and model.

## Release Notes

### 0.0.1
- Initial release of AI Notes with LLM provider selection, tag, name, and folder suggestion.

---

For more information, see the extension settings in VS Code or the [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines).
