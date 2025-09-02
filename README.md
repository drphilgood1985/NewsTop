**Overview**
- Purpose: Generates a wallpaper from news keywords at 04:00, 12:00, 19:00 and sets it as your Linux Mint desktop background.
- Inputs: RSS headlines, time of day, extra context from `image.config.json`.
- Quality-first pipeline: Refines a polished imagery prompt with OpenAI, then generates the image with Google Gemini/Imagen (high quality). Falls back to a random themed photo if APIs are absent.

**Setup**
- Requirements: Node.js 18+, `gsettings` (default on Cinnamon/GNOME), network connectivity.
- Install deps: `npm install`
- Configure env: copy `.env.example` to `.env` and set values.
  - `OPENAI_API_KEY`: required for best prompt refinement.
  - `OPENAI_MODEL`: defaults to `gpt-4.1` for high-quality text.
  - `GEMINI_API_KEY`: required for image generation with Gemini/Imagen.
  - `DESKTOP_ENV`: `cinnamon` (Mint default) or `gnome`.
  - `OUTPUT_DIR`: where images are saved (default `output`).
- Edit `image.config.json` to tune style, vibe, negative prompts, feeds, and keyword limits.
  - `resolution`: `{ "width": 2560, "height": 1440 }` (your display)
  - `geminiModel`: e.g., `gemini-2.5-flash-image-preview` (from AI Studio “Get code” name)
  - `openaiTextModel`: defaults to `gpt-4.1`
  - `stylePool`: random art/photography styles chosen per run

**Run Once**
- `npm run run-once`
- Output: saves an image in `output/` and applies it as wallpaper.

**Test Run (detailed logs)**
- Run: `npm run test-run`
- Console: prints timestamped steps and samples of headlines/keywords.
- Logs: writes `logs/test-run-YYYYMMDD-HHMMSS.log` (detailed) and `logs/test-run-YYYYMMDD-HHMMSS.summary.log` (JSON summary).
- Files written:
  - `test.mjs:1` (runner script)
  - `logs/` directory for log files
  - `output/test-background-*.png` for the generated image

**Auto Prompt Logs**
- Run-once (systemd/cron) appends every Gemini prompt to `logs/prompts.log` as JSON lines.
- The `prompt` field is exactly the text sent to the Gemini endpoint (including any appended sizing instructions used by `models:generateContent`).
- Fields: `ts`, `source`, `endpoint` (`images:generate` or `models:generateContent`), `model`, `resolution`, `prompt`.
- Example: `{ "ts": "2025-01-01T12:00:00.000Z", "source": "auto", "endpoint": "models:generateContent", "model": "gemini-2.5-flash-image-preview", "resolution": { "width":2560, "height":1440 }, "prompt": "<exact text>" }`.

**Schedule (cron)**
- Install a cron job: `bash scripts/install-cron.sh`
- Schedules at 04:00, 12:00, 19:00 local time. Logs to `logs/cron.log`.

**How It Works**
- Fetch: RSS feeds in `image.config.json`.
- Extract: frequency-based keywords, stopword-filtered.
- Refine: OpenAI (`openaiTextModel`, default `gpt-4.1`) crafts one polished imagery prompt that includes time-of-day, vibe, and a randomly selected style from `stylePool` plus a compact negative prompt.
  - The refiner explicitly selects 1–3 concrete subjects (people, places, or objects) to feature prominently, and composes the scene around them.
- Generate: Google Gemini/Imagen (`geminiModel`) renders a high-resolution image (default 2560x1440).
- Fallback: If generation fails or keys are missing, pulls a themed random photo.
- Apply: Sets wallpaper via `gsettings` (Cinnamon or GNOME).

**Notes**
- You can set `DEBUG=1` to see verbose logs: `npm run debug`.
- If wallpaper doesn’t change, ensure your session has DBus/gsettings access (run from user cron, not system cron).
- For GNOME, set `DESKTOP_ENV=gnome` in `.env`.



**Gemini/Imagen models**
- For image models (names containing `imagen`, `image`, or `preview` such as `gemini-2.5-flash-image-preview`), the code now prefers the Images API for higher-resolution outputs, with fallback to `models:generateContent`.
- You can override the model via `GEMINI_MODEL` in `.env` without editing `image.config.json`.


**Example Log Snippet**
- `[2025-01-01T12:00:00.123Z] [INFO] Fetched headlines count=78 ms=842`
- `[2025-01-01T12:00:00.456Z] [HEADLINE] Global markets rally on...`
- `[2025-01-01T12:00:00.789Z] [INFO] Prompt built:`
- `[2025-01-01T12:00:00.790Z] [PROMPT] A visually striking wallpaper evoking: market, rally, ...`
- `[2025-01-01T12:00:02.001Z] [INFO] Image ready bytes=1345678 ms=1210 generator=fallback`
- `[2025-01-01T12:00:02.120Z] [INFO] Wallpaper set successfully desktopEnv=cinnamon`
