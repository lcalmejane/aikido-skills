# Previewing HTML and images for the client

Applies to `moodboard.html`, trial renders, sweeps, style thumbnails and any page the skill produces for a person to look at.
Pick the **first option your environment supports**, in this order. Do not skip to a lower one because it is easier.

| Order | Where | Use it when |
|---|---|---|
| 1 | The agent CLI / LLM host itself | The host can display or render HTML or images in its own interface (HTML artifact, canvas, rendered panel, inline image) |
| 2 | The IDE built-in browser | You run inside an IDE such as VS Code (or a fork) that offers an integrated browser or preview panel |
| 3 | An external browser | Neither of the above is available |

## 1. Agent CLI / LLM host

- If the host can show HTML, give it the content of `moodboard.html` (the file is one page, images embedded, no script, no external link, so it is safe to render).
- If the host only shows images, show each `trials/<track>-<scene>.webp` inline (or `.png`) and list the palette and the notes as text.
- If you are not sure the host renders HTML, do not guess: try once, and if nothing visible comes back, go to option 2.

## 2. IDE built-in browser

- VS Code and forks: use the integrated browser (`Simple Browser: Show`) or a preview extension already installed. A `file://` page is often refused: serve the folder on the loopback interface instead, and stop the server when the client has answered.

```
python3 -m http.server 8765 --bind 127.0.0.1 --directory <mood-board-dir>
# then open http://127.0.0.1:8765/moodboard.html in the integrated browser
```

- Bind to `127.0.0.1` only, never `0.0.0.0`: a client mood board is private. Use another port if 8765 is taken.
- Run the server in the background with a timeout, and say which URL is open.
- If the IDE has no integrated browser, or the call fails, go to option 3.

## 3. External browser (last resort)

| System | Command |
|---|---|
| macOS | `open <dir>/moodboard.html` |
| Linux | `xdg-open <dir>/moodboard.html` |
| Windows | `start "" "<dir>\moodboard.html"` |

If even this is impossible (remote machine, headless), give the absolute path and say the page can be copied to the client.

## Rules

- Say which option you used and why the higher ones were not available. One short sentence.
- After each rebuild of the page (`moodboard decide`, `moodboard html`), refresh the same view instead of opening a new one.
- Never send a mood board to an external service to preview it. The page stays on the machine.
- Check the images yourself before showing them (wrong object, text, odd anatomy) and say what is wrong.
