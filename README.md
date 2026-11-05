# Ask Hermes about this page

A Firefox sidebar that asks [Hermes Agent](https://github.com/NousResearch/hermes-agent) about the text
you selected — or about the whole page — and shows the answer as markdown, right inside the browser.

```
page text ──► add-on ──POST /ask──► bridge (127.0.0.1:8790) ──► hermes chat (one turn) ──► answer
```

Select text and a small **Ask Hermes** button appears next to it; click it and type your question.
With nothing selected the same panel answers about the page itself. Follow-up questions continue the
same Hermes session, changing tab starts a new one, and **Clear** throws the conversation away.

The answer is rendered as markdown (headings, lists, tables, code, quotes, links), and every block —
paragraph, list item, table cell, heading — is laid out on its own: if the block holds even one
Persian/Arabic character it is RTL and right aligned, otherwise LTR and left aligned. Code blocks and
inline code are always LTR.

## Why a bridge process

An extension cannot talk to the Hermes desktop backend directly — the port is chosen per launch,
`/api/*` needs a session token, and its CORS rule trusts loopback page origins only. So the add-on
posts to a small loopback daemon that runs one `hermes chat` turn per question. The daemon is a plain
stdlib Python HTTP server; it starts with your session and does not need the desktop app to be open.

## Requirements

- Firefox 142+ (release builds only install *signed* add-ons — see *Install the add-on*)
- Hermes Agent on the same machine, `hermes` at `~/.local/bin/hermes` (or set `HERMES_BIN`)

## Install the bridge

```bash
tools/install.sh                          # copies the script to ~/.local/share, installs and starts a systemd user unit
curl -s http://127.0.0.1:8790/health      # {"ok": true, "hermes_bin": true}
```

No systemd? Run it yourself: `python3 bridge/hermes_ask_bridge.py` (env: `HERMES_ASK_PORT`, `HERMES_BIN`).

## Install the add-on

Release Firefox refuses unsigned add-ons, and a temporary load from `about:debugging` disappears on
restart — so sign it once with your own [AMO API key](https://addons.mozilla.org/developers/addon/api/key/)
(unlisted: it is not published in the store):

```bash
tools/build.sh                                   # -> dist/hermes-ask-<version>.xpi
python3 tools/amo-sign.py --keys ~/.amo-keys     # .amo-keys = issuer, then secret (two lines)
```

The signed file lands in `dist/signed/`; install it via `about:addons` → gear → *Install Add-on From
File…*. While developing, `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* →
`extension/manifest.json` skips signing (and loses all state on restart).

## Use

- **selection**: select text → the *Ask Hermes* bubble appears next to it → click it (or right-click →
  *Ask Hermes about this selection*), then ask in the sidebar. Only the selection travels with the question.
- **whole page**: open the sidebar (toolbar button or `Alt+Shift+H`) with *Whole page* selected.
- Follow-ups stay in one Hermes session; switching tab starts a new one; **Clear** empties the panel.
- The dot in the header is the bridge's health. Red = `systemctl --user status hermes-ask-bridge`.
- **Copy** under an answer puts the raw markdown on the clipboard.

## Actions (buttons under a message or under the chat)

⚙ in the header opens the options page. Every action is one line, `label | prompt`:

```
خلاصه | این متن را در سه جمله خلاصه کن.
ترجمه | این متن را به فارسی روان ترجمه کن.
```

Two lists:

| list | where the buttons appear | what is sent |
|---|---|---|
| **under each message** | a pill row under every question and answer | that message's markdown + the prompt |
| **under each chat** | a pill row above the composer | the selected text (or the whole page) + the prompt |

The same list lives in `~/.config/hermes-firefox-ask/actions.json` (the bridge owns it, `GET/PUT
/actions`), so it can be edited there with any text editor. Defaults are created on first run; empty
prompts are dropped. Edited actions show up in the sidebar the next time it takes focus — no need to
reopen the panel.

## What is sent

`page.url`, `page.title`, and the selected text (12 000 chars max) — or, when nothing is selected, the
visible page text (30 000 chars max, `article`/`main` preferred). No cookies, no history, no screenshots.

Each question is a normal Hermes session (`--source cli`), so it also shows up in the Hermes session
list under a title generated from the question; open it there to keep talking.

Because page text is untrusted input, the ask-turn runs with `-t web`: it may search the web, but it
has no file or shell tools, so instructions hidden in a page cannot become commands. The bridge also
refuses any request that carries an `http(s)` `Origin`, i.e. a web page cannot drive it (requests with
no `Origin` — local tools, curl — are allowed; the gate is Origin-based, not a secret).

## Ops

| | |
|---|---|
| logs | `journalctl --user -u hermes-ask-bridge -n 50` |
| port | `HERMES_ASK_PORT` in the unit (default 8790 — the add-on's `host_permissions` must match) |
| hermes binary | `HERMES_BIN` (default `~/.local/bin/hermes`) |
| turn timeout | `TIMEOUT` in the bridge (240s) |
| bridge self-check | `python3 bridge/hermes_ask_bridge.py --selftest` |

## Development

```bash
npm i                 # jsdom, for the tests
npm test              # content script, sidebar, markdown renderer
npm run build         # extension/ -> dist/hermes-ask-<version>.xpi
```

`tests/harness.html` renders a mixed Persian/English answer with the real renderer and CSS — open it in
any browser to eyeball the direction rules.

```
extension/manifest.json       MV3, sidebar_action, content script on <all_urls>
extension/background.js       context menu, pending selection, page-context fetch
extension/content/content.js  selection bubble (shadow DOM) + text collector
extension/sidebar/            the panel: sidebar.{html,css,js} + markdown.js
extension/options/            action editor (options_ui)
bridge/hermes_ask_bridge.py   HTTP -> `hermes chat --oneshot -Q -t web --source cli --ignore-rules`
tools/                        install.sh, build.sh, amo-sign.py, make_icons.py
tests/                        jsdom tests + render harness
```
