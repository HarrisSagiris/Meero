# Meero web app — multi-stage Next.js standalone build.
# Build context is the MONOREPO ROOT (docker-compose.yml's `web` service:
# context: .) so this can see the workspace root package.json/lockfile
# alongside apps/web — npm workspaces needs both to install correctly.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
# The whole deps output, not just the root node_modules — npm workspaces
# sometimes nests a package under a specific workspace's own node_modules/
# instead of hoisting it to the root (e.g. recharts here, whose own
# sub-dependencies conflict with something already resolved at the root).
# node_modules is gitignored, so a root-only copy silently drops those
# nested packages with no error until `next build` fails on a module that
# installed fine but was never actually present at build time.
COPY --from=deps /app ./
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:8000
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_ORCHESTRATOR_URL=$NEXT_PUBLIC_ORCHESTRATOR_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build -w apps/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
# apps/web's standalone output already nests apps/web/server.js + the
# hoisted root node_modules, because next.config.ts sets
# outputFileTracingRoot to the monorepo root — copying it straight to WORKDIR
# reconstructs that same apps/web/... layout here.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
