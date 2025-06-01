# Quickstart

To quickly install the latest version of AI Notes in VS Code, run the following commands in your terminal:

```sh
curl -L -o ai-notes-0.0.3.vsix https://github.com/alexaytov/vscode-ai-notetaking/releases/download/0.0.3/ai-notes-0.0.3.vsix
code --install-extension ai-notes-0.0.3.vsix
```

# AI Notes

AI Notes is a Visual Studio Code extension that leverages AI to help you create, organize, and categorize your notes efficiently. It supports multiple LLM providers and can automatically suggest tags, names, and folders for your notes.

## Features

- **Create New Notes**: Quickly create a new note with a single command.
- **AI-Powered Tagging**: Automatically suggests relevant tags for your notes using AI.
- **AI-Powered Naming**: Suggests concise, descriptive names for your notes.
- **AI-Powered Folder Suggestion**: Recommends the most appropriate folder for your note, or proposes a new folder path.
- **Reclassify Notes**: Re-run AI classification to update tags, name, or folder for an existing note.
- **Export to PDF**: Export your markdown notes (with embedded images) to PDF.
- **Reveal in File Explorer**: Quickly locate your note in the file explorer.
- **Notes by Tag View**: Browse your notes grouped by tags in a dedicated sidebar view.
- **YAML Frontmatter**: Tags and metadata are stored in YAML frontmatter for easy parsing and editing.
- **Multiple LLM Providers**: Supports both VS Code LM API and SAP AI Core as AI backends.

## Requirements

- Node.js and npm
- For SAP AI Core: a valid service key and model name
- For VS Code LM API: VS Code Insiders and the appropriate AI/LM extension (if required)

## Extension Settings

This extension contributes the following settings:

- `ai-notes.llmProvider`: Select the LLM provider (`vscode-lm-api` or `sap-ai-core`).
- `ai-notes.aiCoreServiceKey`: SAP AI Core service key (required if using SAP AI Core).
- `ai-notes.aiModel`: Model name for either AI Core or VSCode LM API. Defaults to `gpt-4.1`.

## Usage

1. **Create a New Note**: Run the `AI Notes: New Note` command from the Command Palette. The extension will prompt you for note content and use AI to suggest tags, a name, and a folder location. You can edit these suggestions before saving.
2. **Reclassify a Note**: Use the `AI Notes: Reclassify Note` command to update the tags, name, or folder of an existing note using the latest AI suggestions.
3. **Export to PDF**: Select a markdown note and run `AI Notes: Export Note to PDF` to generate a PDF with embedded images.
   - This functionality was created with the idea to be able to quickly create fully portable and sharable notes
4. **Reveal in File Explorer**: Use `AI Notes: Reveal in File Explorer` to quickly locate your note in the workspace.
   - The idea here was to allow you to easily open the ondrive share option if you are using the OneDrive as a backup storage solution.
5. **Browse Notes by Tag**: Open the "AI Notes by Tag" view in the Explorer sidebar to see your notes grouped by tags.

## Known Issues

- The VS Code LM API is only available in certain environments (e.g., VS Code Insiders with the right extension).
  - It might be a bit buggy
- SAP AI Core requires a valid service key and model.
