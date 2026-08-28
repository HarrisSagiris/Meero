# Meero orchestrator — FastAPI API, codegen worker, web worker, and deploy
# worker. Multi-stage: `base` is the lean image api/codegen-worker/
# deploy-worker actually use; `web-worker` extends it with everything ONLY
# the web worker needs (Node.js, the vendored Next.js toolchain, a headless
# Chromium for build screenshots). This split matters for real — compose
# builds each service as its own image even though they used to share one
# Dockerfile, so anything installed in a shared, untargeted stage was being
# paid for 4 times over on every `--no-cache` deploy. See docker-compose.yml
# (`target: base` vs `target: web-worker`) for the other half of this.

FROM python:3.12-slim AS base
WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ---------------------------------------------------------------------------
# web-worker only, from here down. Everything above is what api /
# codegen-worker / deploy-worker actually build (target: base) — none of
# them ever run Node or a browser, so none of them should pay for either.
# ---------------------------------------------------------------------------
FROM base AS web-worker

# Node.js (for a real `next build`) AND the vendored generated-app toolchain,
# in ONE step on purpose. Installed straight from Debian's OWN apt repo
# (nodejs + the separate npm package) — deliberately NOT NodeSource's
# curl-a-script-and-run-it setup: that script's GPG key fetch has started
# 403ing (NodeSource-side infra issue, nothing we control), and even when it
# "succeeds" a piped `curl | bash -` swallows a curl failure silently (the
# pipe's exit status is bash's, which exits 0 on empty stdin) — so a broken
# key fetch would let the script "succeed" while never adding the repo, apt
# would silently fall back to Debian's own nodejs (which doesn't bundle npm),
# and the vendor step below would die with a confusing "npm: not found" two
# steps later. Debian trixie already ships a plenty-new Node 20.x directly,
# so there's no reason to depend on that fragile external script at all.
# `command -v npm` stays as a final guard so any future regression here
# fails loudly, right at the install, not mid-vendor.
#
# The vendored toolchain is the ONLY set of dependencies generated apps may
# import (their whole frontend framework + UI kit + backend SDK).
# web_worker.py symlinks it into each build's workspace, so no per-build
# `npm install` ever runs. These exact versions MUST match
# app/agent/codegen.py's VENDORED_PACKAGE_VERSIONS (and the literal table in
# app/agent/prompts.py) — a real Vercel release runs its own `npm install`
# from the generated package.json, so its tree must match what's built here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/* \
    && command -v npm \
    && mkdir -p /vendor/app && cd /vendor/app && npm init -y >/dev/null && npm install \
    next@^14.2.5 react@^18.3.1 react-dom@^18.3.1 \
    typescript@^5.5.4 @types/react@^18.3.3 @types/react-dom@^18.3.0 @types/node@^20.14.10 \
    tailwindcss@^3.4.7 postcss@^8.4.40 autoprefixer@^10.4.19 tailwindcss-animate@^1.0.7 \
    class-variance-authority@^0.7.0 clsx@^2.1.1 tailwind-merge@^2.4.0 lucide-react@^0.407.0 \
    @supabase/supabase-js@^2.45.0 \
    @radix-ui/react-slot@^1.1.0 @radix-ui/react-dialog@^1.1.1 \
    @radix-ui/react-dropdown-menu@^2.1.1 @radix-ui/react-label@^2.1.0 \
    @radix-ui/react-select@^2.1.1 @radix-ui/react-checkbox@^1.1.1 \
    @radix-ui/react-tabs@^1.1.0 @radix-ui/react-avatar@^1.1.0 \
    @radix-ui/react-popover@^1.1.1 @radix-ui/react-separator@^1.1.0 \
    @radix-ui/react-switch@^1.1.0 @radix-ui/react-toast@^1.2.1

# Chromium (only — not the full Playwright browser set) for a real
# headless-browser screenshot of each build's own live /preview page
# (_capture_screenshot in app/workers/web_worker.py). Still a genuinely
# heavy addition (~300-500MB + a real browser process per public build) —
# but now paid for exactly once, by the one image that uses it.
RUN pip install --no-cache-dir playwright>=1.48 \
    && playwright install --with-deps chromium

ENV APP_VENDOR_DIR=/vendor/app
