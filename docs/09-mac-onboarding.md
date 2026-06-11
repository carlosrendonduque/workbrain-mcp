# Onboarding en una Mac (y en cualquier máquina nueva)

Guía práctica para dejar WorkBrain funcionando en una Mac recién comprada, y para que
**otra persona (p. ej. en Colombia)** lo replique sin acceso al stack interno.

> **La idea central:** el MCP server (`packages/mcp-server`) es un **cliente liviano**. Lo único
> que necesita son dos variables de entorno — `WORKBRAIN_API_URL` y `WORKBRAIN_API_KEY` — y habla
> por HTTP con el backend. Si apuntás a **producción** (`https://www.workbrain.app`) **no necesitás
> base de datos, ni `.env.local`, ni levantar el web app**. Solo Node + el binario compilado + tu API key.

Hay dos caminos. El 99% del tiempo querés el **Camino A**.

| | Camino A — Usar WorkBrain (recomendado) | Camino B — Desarrollar el web app |
|---|---|---|
| Para qué | Consultar / ingerir el corpus desde el IDE | Tocar el código del backend / DB |
| Apunta a | Prod (`https://www.workbrain.app`) | Local (`http://localhost:3000`) |
| Necesita | Node, pnpm, build del MCP, API key | Todo lo de A + Neon + `.env.local` + migraciones |
| Quién | Tú en la Mac, tu hermano en Colombia | Solo si vas a programar WorkBrain |

---

## Camino A — Usar WorkBrain desde una Mac nueva

### 0. Prerrequisitos (una sola vez)

```bash
# Homebrew (si no está): https://brew.sh
# nvm para manejar Node:
brew install nvm
# seguí las instrucciones que imprime brew para agregar nvm a tu ~/.zshrc, luego abrí una terminal nueva

# Node 22 (la versión fijada en .nvmrc) + pnpm vía corepack:
nvm install 22 && nvm use 22
corepack enable          # pnpm se auto-activa en la versión de packageManager (pnpm@10.x)
```

Verificá:

```bash
node -v   # v22.x
pnpm -v   # 10.x
```

> macOS no trae `readlink -f` (es BSD). Más abajo se usan `which node` y `$(pwd)` para resolver
> rutas absolutas — funcionan tal cual en la Mac.

### 1. Clonar e instalar dependencias

```bash
# (ya clonaste el repo) — entrá a la carpeta del repo:
cd ~/ruta/al/workbrain      # ajustá a donde lo clonaste
nvm use                     # toma Node 22 desde .nvmrc
pnpm install
```

### 2. Compilar el MCP server

`dist/` está gitignored, así que en un clone fresco **hay que buildearlo**:

```bash
pnpm --filter @workbrain/mcp-server build
# genera packages/mcp-server/dist/index.js
```

### 3. Conseguir un API key de producción

Cada persona usa **su propio** API key. Los keys solo los puede emitir alguien con acceso a la
**DB de producción** (Carlos), porque el script necesita la conexión directa de prod y el salt de prod:

```bash
# Lo corre Carlos (no el hermano), apuntando a la DB de PROD:
DATABASE_URL_UNPOOLED="<conexión directa de prod>" \
WORKBRAIN_API_KEYS_SALT="<salt de prod, el mismo que está en Vercel>" \
  pnpm --filter @workbrain/web exec tsx scripts/generate-api-key.ts <email-de-la-persona> "macbook-carlos"
```

El key crudo (`wbk_<64 hex>`) se imprime **una sola vez**. Copialo. En la DB solo queda el hash HMAC-SHA256.

> **Para tu hermano:** generá un key con un label propio (p. ej. `"hno-colombia"`) y pasáselo por un
> canal seguro (no por chat público / no en el repo). El `.mcp.json` donde se pega ya está gitignored,
> así que no se sube a GitHub.

### 4. Crear `.mcp.json` apuntando a prod

```bash
cp .mcp.json.example .mcp.json
```

Necesitás dos rutas absolutas (en la Mac):

```bash
which node                                          # ruta absoluta del node de nvm
echo "$(pwd)/packages/mcp-server/dist/index.js"     # ruta absoluta del binario compilado
```

Editá `.mcp.json` y dejalo así (reemplazando las rutas y el key):

```json
{
  "mcpServers": {
    "workbrain": {
      "command": "/Users/<tu-usuario>/.nvm/versions/node/v22.x.x/bin/node",
      "args": [
        "/Users/<tu-usuario>/ruta/al/workbrain/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "WORKBRAIN_API_URL": "https://www.workbrain.app",
        "WORKBRAIN_API_KEY": "wbk_<tu-key>"
      }
    }
  }
}
```

> **Lo único distinto entre máquinas son las dos rutas absolutas y el API key.** El resto es idéntico.
> Para **Cursor** en vez de la extensión Claude Code: `cp .cursor/mcp.json.example .cursor/mcp.json`
> y poné los mismos valores. Ambos archivos están gitignored.

### 5. Conectar el IDE y verificar

1. Recargá el IDE (VS Code con la extensión Claude Code, o Cursor) y aceptá el MCP server `workbrain`
   cuando lo pregunte.
2. En una conversación nueva, las tools `mcp__workbrain__*` deberían aparecer. Probá:
   - `set_active_project` → `acme` (o el slug que uses)
   - `search` con cualquier consulta → deberían volver chunks.

Si las tools no aparecen: casi siempre es una **ruta no-absoluta** en `.mcp.json` (el IDE no lee tu
`~/.zshrc`, así que `node` "pelado" no se encuentra) o un **API key inválido** (HTTP 401 → regenerá el key).

¡Listo! Eso es todo para usar WorkBrain en la Mac.

---

## Camino B — Levantar el stack local completo (solo si vas a desarrollar el web app)

Esto reproduce el backend en tu máquina (Neon + Next.js + corpus repo). No hace falta para *usar*
WorkBrain. El procedimiento completo, paso a paso, está en el **[README](../README.md)** sección
"Quick start" (clonar → `.env.local` → `db:migrate` → `db:seed` → `generate-api-key` → `corpus:init`
→ build MCP → `pnpm --filter @workbrain/web dev`).

Resumen de lo que vas a necesitar además del Camino A:
- Cuenta de **Neon** (plan Launch) → `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
- Cuenta de **Voyage AI** → `VOYAGE_API_KEY`.
- `apps/web/.env.local` (copiá de `apps/web/.env.example`) con esas claves + `WORKBRAIN_API_KEYS_SALT`
  (`openssl rand -hex 32`) + `WORKBRAIN_CORPUS_*`.
- Migraciones: `pnpm --filter @workbrain/web db:migrate`.
- En `.mcp.json`, `WORKBRAIN_API_URL` apunta a `http://localhost:3000` y el backend tiene que estar corriendo.

---

## Notas / gotchas en macOS

- **`readlink -f` no existe** en la Mac. Usá `which node` y `$(pwd)/...` para rutas absolutas (como arriba).
- **El IDE no carga tu shell** (`~/.zshrc`). Por eso `command` y `args` en `.mcp.json` **tienen que ser
  rutas absolutas**, no `node` ni rutas relativas.
- **Node por nvm**: si abrís una terminal y `node -v` no es 22, corré `nvm use 22`. La ruta del binario
  cambia con la versión exacta (`v22.x.x`) — re-resolvé con `which node` si actualizás Node.
- **Un key por máquina/persona.** No compartas el mismo `wbk_` entre varias personas; generá uno por cada
  una con un label claro para poder revocarlo después.
- **Nunca commitees `.mcp.json` ni el API key.** Ambos archivos de config (`.mcp.json`, `.cursor/mcp.json`)
  ya están gitignored a propósito.

## Checklist rápido (Camino A)

- [ ] `node -v` → v22, `pnpm -v` → 10
- [ ] `pnpm install` ok
- [ ] `pnpm --filter @workbrain/mcp-server build` → existe `packages/mcp-server/dist/index.js`
- [ ] API key `wbk_...` generado (por Carlos contra prod) y copiado
- [ ] `.mcp.json` con rutas **absolutas** + `WORKBRAIN_API_URL=https://www.workbrain.app` + el key
- [ ] IDE recargado, MCP `workbrain` aceptado, `search` devuelve resultados
