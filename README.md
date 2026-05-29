**Overview**
- Purpose: Polls current RSS headlines at 04:00, generates a current-events wallpaper, and sets it as your Linux Mint desktop background.
- Inputs: RSS headlines, extracted keywords, time of day, and extra context from `image.config.json`.
- Quality-first pipeline: OpenAI turns the day's headlines into a headline-faithful cinematic/painterly prompt and renders the wallpaper. Falls back to a random themed photo if APIs are absent.

**Setup**
- Requirements: Node.js 18+, `gsettings` (default on Cinnamon/GNOME), network connectivity.
- Install deps: `npm install`
- Configure env: copy `.env.example` to `.env` and set values.
  - `OPENAI_API_KEY`: required for prompt refinement and image generation with OpenAI.
  - `OPENAI_TEXT_MODEL`: defaults to `gpt-5.4-mini` for prompt refinement.
  - `OPENAI_IMAGE_MODEL`: defaults to `gpt-image-2` for image generation.
  - `OPENAI_QA_MODEL`: optional; defaults to the text model for visual QA.
  - `DESKTOP_ENV`: `cinnamon` (Mint default) or `gnome`.
  - `OUTPUT_DIR`: where images are saved (default `output`).
- Edit `image.config.json` to tune style, vibe, negative prompts, feeds, and keyword limits.
  - `resolution`: `{ "width": 2560, "height": 1440 }` (your display)
  - `openaiImageModel`: defaults to `gpt-image-2`
  - `openaiTextModel`: defaults to `gpt-5.4-mini`
  - `headlinePromptLimit`: number of current headlines sent to the prompt refiner
  - `embeddedHeadlineText`: controls subtle headline excerpts in the image and QA behavior
  - `stylePool`: random art/photography styles chosen per run

**Run Once**
- `npm run run-once`
- Output: saves an image in `output/` and applies it as wallpaper.
- Verbose manual run: `npm start run-verbose`
  - Prints the contributing headlines used for prompt generation, then generates and applies the wallpaper.
  - Equivalent npm alias: `npm run run-verbose`

**Focus Filter (topics/categories)**
- Restrict the run to a topic using `-focus` (or `--focus`/`-f`).
- Examples:
  - `npm run start -- -focus "sports"`
  - `npm run start -- -focus "business"`
  - `npm run start -- -focus "politics"`
  - `npm run start -- -focus "entertainment"`
  - `npm run start -- -focus "soccer"`
  - `npm run start -- -focus "european rap"`
  - Direct bin: `mint-news-wallpaper -focus "global trade"`
- You can also set `FOCUS="..."` as an env var: `FOCUS="football" npm run start`.
- Behavior:
  - Headlines are filtered to those matching the phrase or any focus word (case-insensitive). If nothing matches, the run continues unfiltered.
- Focus words are merged into top keywords to bias the prompt.

**Custom Prompt Override**
- Skip news-driven prompts entirely with `-prompt` / `--prompt` / `-p`.
- Example: `npm run start -- -prompt "a man in front of a seaside cafe sips coffee while seagulls circle"`
- The supplied text becomes the base scene and is passed directly to OpenAI image generation.
- You can also set `CUSTOM_PROMPT="..." npm run start` for automation/scripting.

**Test Run (detailed logs)**
- Run: `npm run test-run`
- Console: prints timestamped steps and samples of headlines/keywords.
- Logs: writes `logs/test-run-YYYYMMDD-HHMMSS.log` (detailed) and `logs/test-run-YYYYMMDD-HHMMSS.summary.log` (JSON summary).
- Files written:
  - `test.mjs:1` (runner script)
  - `logs/` directory for log files
  - `output/test-background-*.png` for the generated image

**Auto Prompt Logs**
- Run-once (systemd/cron) appends every OpenAI image prompt to `logs/prompts.log` as JSON lines.
- The `prompt` field is exactly the text sent to the OpenAI image endpoint.
- Fields: `ts`, `source`, `endpoint` (`images:generations`), `model`, `resolution`, `size`, `prompt`, and `metadata`.
- `metadata` includes the headlines, extracted keywords, keyword base prompt, randomized style, embedded headline snippets, QA result, retry status, and final image selection.
- Example: `{ "ts": "2025-01-01T12:00:00.000Z", "source": "auto", "endpoint": "images:generations", "model": "gpt-image-2", "resolution": { "width":2560, "height":1440 }, "size": "1536x1024", "prompt": "<exact text>", "metadata": { "headlines": ["..."], "keywords": ["..."], "selectedStyle": "..." } }`.

**Schedule (cron)**
- Install a cron job: `bash scripts/install-cron.sh`
- Schedules at 04:00 local time. Logs to `logs/cron.log`.

**How It Works**
- Fetch: RSS feeds in `image.config.json` are polled on each run.
- Extract: frequency-based keywords, stopword-filtered.
- Refine: OpenAI (`openaiTextModel`, default `gpt-5.4-mini`) crafts one polished imagery prompt from the current headlines, extracted keywords, time-of-day, vibe, and a randomly selected style from `stylePool`.
  - The refiner is instructed to use recognizable headline-derived subjects, places, institutions, events, or objects rather than generic mood-only symbolism.
  - If `embeddedHeadlineText.enabled` is true, it embeds one or two short headline excerpts as barely legible scene-native background details, never as the focal point.
- Generate: OpenAI Images (`openaiImageModel`, default `gpt-image-2`) renders a wallpaper image. The configured display resolution is mapped to the closest supported OpenAI image size.
- QA: When embedded headline text is enabled, a vision QA pass rejects dominant text, missing ambient text, composition drift, and banned props such as podiums or lecterns. One retry is attempted when configured.
- Fallback: If generation fails or keys are missing, pulls a themed random photo.
- Apply: Sets wallpaper via `gsettings` (Cinnamon or GNOME).

**Notes**
- You can set `DEBUG=1` to see verbose logs: `npm run debug`.
- If wallpaper doesn’t change, ensure your session has DBus/gsettings access (run from user cron, not system cron).
- For GNOME, set `DESKTOP_ENV=gnome` in `.env`.

**OpenAI Models**
- You can override the text model with `OPENAI_TEXT_MODEL` and the image model with `OPENAI_IMAGE_MODEL` in `.env` without editing `image.config.json`.
- The legacy `OPENAI_MODEL` env var is still accepted for text refinement.


**Example Log Snippet**
- `[2025-01-01T12:00:00.123Z] [INFO] Fetched headlines count=78 ms=842`
- `[2025-01-01T12:00:00.456Z] [HEADLINE] Global markets rally on...`
- `[2025-01-01T12:00:00.789Z] [INFO] Prompt built:`
- `[2025-01-01T12:00:00.790Z] [PROMPT] A visually striking wallpaper evoking: market, rally, ...`
- `[2025-01-01T12:00:02.001Z] [INFO] Image ready bytes=1345678 ms=1210 generator=fallback`
- `[2025-01-01T12:00:02.120Z] [INFO] Wallpaper set successfully desktopEnv=cinnamon`
