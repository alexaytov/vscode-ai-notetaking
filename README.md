# AI Note Saver VS Code Extension

AI Note Saver is a Visual Studio Code extension that leverages OpenAI to automatically extract tags from your Markdown notes and organize them into a structured folder hierarchy. It also supports reclassifying existing notes with updated tags and filenames.

## Features

- **Save Note**: Extract 2–5 concise tags, generate a folder path (dash-separated, lowercase, max depth 3), propose a meaningful filename, and move the note.
- **Reclassify Note**: Update tags and filename for an existing note, move it to a new folder if needed, and clean up empty directories.
- **Configurable**: Customize OpenAI settings, target root path, and model.

## Quick Start

1. **Install the Extension**
   - From VSIX:
     ```bash
     code --install-extension ai-note-saver-0.0.1.vsix
     ```
   - Or search for **AI Note Saver** in the VS Code Marketplace.

2. **Configure Your API Key**
   Open **Settings** (`Ctrl+,` or `Cmd+,`) and add:
   ```json
   {
     "aiNoteSaver.openaiApiKey": "YOUR_OPENAI_API_KEY",
     "aiNoteSaver.apiUrl": "https://api.openai.com/v1",
     "aiNoteSaver.model": "gpt-4o-mini",
     "aiNoteSaver.targetRoot": "${workspaceFolder}/notes"
   }
   ```

3. **Use the Commands**
   - Open a Markdown file and run **AI Note Saver: Save Note** (`Ctrl+Shift+P`).
   - To update tags on an existing note, run **AI Note Saver: Reclassify Note**.

4. **Review**
   - Your note will be moved under `notes/<tag-path>/your-slug.md` with a new `Tags:` line inserted.

## Configuration

| Setting                         | Description                                      | Default                             |
|---------------------------------|--------------------------------------------------|-------------------------------------|
| `aiNoteSaver.openaiApiKey`      | Your OpenAI API key                              | _none_                              |
| `aiNoteSaver.apiUrl`            | Base URL for OpenAI API                          | `https://api.openai.com/v1`         |
| `aiNoteSaver.model`             | AI model to use                                  | `gpt-4o-mini`                       |
| `aiNoteSaver.targetRoot`        | Destination root (supports `${workspaceFolder}`) | `${workspaceFolder}/notes`          |

## Commands

- **AI Note Saver: Save Note** – Extract tags and save a new note.
- **AI Note Saver: Reclassify Note** – Update tags/filename of an existing note.

## Development

```bash
# Clone and install
git clone https://github.com/your-repo/vscode-ai-notetaking.git
cd vscode-ai-notetaking
npm install

# Build and watch
npm run compile
npm run watch

# Launch in Extension Host
# Press F5 in VS Code
```

## Bundling & Publishing

For performance, bundle with `vsce package` and exclude unnecessary files via `.vscodeignore`. See:
- https://aka.ms/vscode-bundle-extension
- https://aka.ms/vscode-vscodeignore

## Contributing

Contributions are welcome! Please open issues or pull requests.

## License

MIT © Aleksandar Aytov
