# Kunplanejo

**Kunplanejo** ("collaborative space" in Esperanto) is a fork of
[Etherpad Lite](https://github.com/ether/etherpad-lite) with two custom
plugins inspired by [Rizzoma](https://github.com/rizzoma/rizzoma) and native
support for embedding as a [Matrix widget](https://spec.matrix.org/latest/).

---

## Added Features

### ep_matrix_widget — Matrix widget integration

When Etherpad is embedded as a widget in a Matrix room (Element, SchildiChat,
Cinny, etc.) the plugin automatically:

1. **Detects the widget context** (`widgetId` query param or cross-origin parent).
2. **Requests capabilities** from the hosting Matrix client via the
   [Matrix Widget API v2](https://github.com/matrix-org/matrix-widget-api).
3. **Picks up the user identity** — `userId`, `displayName` — from:
   - URL template substitutions (`$matrix_user_id`, `$displayname`) that Matrix
     clients inject when the widget is registered.
   - The Widget API `getOpenIDToken()` call (when the library is available).
   - A postMessage fallback for clients that don't support the full Widget API.
4. **Pre-populates the Etherpad author name** so collaborators see real Matrix
   display names instead of "Anonymous".

#### Registering the widget in Element

```
/addwidget https://your-etherpad.example/p/$matrix_room_id?widgetId=$matrix_widget_id&userId=$matrix_user_id&displayName=$matrix_display_name
```

Or use Element's *Room info → Add widgets* UI and paste the URL above.

#### Widget manifest endpoint

`GET /matrix-widget-manifest` — returns an `m.custom` widget descriptor
suitable for programmatic room widget registration.

---

### ep_rizzoma — Wave-style collaboration features

Inspired by Rizzoma's wave-based model:

| Feature | How it works |
|---------|-------------|
| **Thread sidebar** | Click the 💬 button that appears on hover next to any paragraph to open a discussion thread anchored to that line. |
| **Task toggles** | Lines starting with `[ ]` or `[x]` render an interactive checkbox. Clicking it marks the task done (strikethrough). |
| **Gadget placeholders** | Lines of the form `{{gadget:TYPE}}` are rendered as embedded gadget slots. External gadget handlers can listen for the `rz-gadget-init` DOM event to take over rendering. |
| **Thread REST API** | `GET /rizzoma/threads/:padId` returns JSON with thread and task annotations for integration with external systems. |

#### Gadget extension point

```js
document.addEventListener('rz-gadget-init', ({detail: {type, params, el}}) => {
  if (type === 'poll') renderPollGadget(el, params);
});
```

---

## Architecture

```
local_plugins/
  ep_matrix_widget/
    src/index.js          ← Express route (widget manifest)
    static/js/
      matrix_widget.js    ← Client-side Matrix Widget API integration
    static/css/
      matrix_widget.css   ← Embedded/compact mode styles

  ep_rizzoma/
    src/index.js          ← aceAttribsToClasses hook + /rizzoma/threads/:id
    static/js/
      rizzoma.js          ← Thread panel, task toggles, gadget placeholders
    static/css/
      rizzoma.css         ← Thread panel & task UI
```

Both plugins live in `local_plugins/` and are loaded automatically by Etherpad.

---

## Development

```bash
# Install dependencies (Node ≥ 18, pnpm)
pnpm install

# Run in dev mode
node src/node/server.js

# The pad URL is the Matrix room ID when registered as a widget, e.g.
# /p/!roomid:matrix.org
```

---

## Upstream

This repo tracks upstream `ether/etherpad-lite`. Pull upstream changes with:

```bash
git fetch upstream
git merge upstream/master
```

where `upstream` is `https://github.com/ether/etherpad-lite`.

---

## License

Apache 2.0 — same as the upstream Etherpad Lite project.
