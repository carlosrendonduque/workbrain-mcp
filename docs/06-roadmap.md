# WorkBrain — Roadmap (living document)

> This is the **single source of truth** for what's done, in progress, and pending.
> The original phase plan in `02-workbrain-implementation-brief.md` is historical
> context; this document supersedes it.

**Last updated:** 2026-05-07

**Status legend:** ✅ done · 🟡 in progress · ⬜ pending · ⏭️ skipped/deferred

---

## Strategic priority (May 2026)

After the first dogfooding session (see `05-first-test-playbook.md`), we identified
that the webapp is currently **read-only**: every productive action requires
IDE + MCP + CLI. This is fine for the engineer who built it, but it's a hard wall
for anyone else — including the engineer on a phone, in a meeting, or onboarding a
new project.

**Therefore:** before tackling production deployment, multi-tenancy, or live
integrations, we close the **self-service webapp gap** so 90% of the product is
usable without ever opening a terminal.

---

## Phase 1 — Ingest pipeline ✅

Foundation: paste → chunk → embed (voyage-3-large) → index in pgvector → semantic
search. Auth via API keys (HMAC). Cross-project isolation verified end-to-end.
15 tasks shipped.

## Phase 2 — Auto-classifier + flagship `compose_context` ✅

10 tasks shipped:
- Sonnet 4.6 classifier with tool use (type / externalId / references / date).
- Voyage rerank-2 second pass on `/api/search`.
- Metadata filters (externalId, dateRange, types).
- Per-project canon sync from `_meta/*.md`.
- Stakeholders sync from `_meta/stakeholders.md`.
- `record_decision`, `link_documents` MCP tools.
- `compose_context` flagship: structured bundle (canon + focus + linked + RAG +
  stakeholders + instructionsForAgent).

## Phase 3 — Drafts + multi-provider ⏭️

Deferred. Moved to **Phase 8** — depends on having the webapp usable first.

## Phase 4 — Webapp (MVP shipped, expansion in progress)

### Done ✅
- 4.1 Auth con cookie firmada (jose HS256, 30d).
- 4.2 Webapp shell + dashboard (KPIs, projects table, ops breakdown, recent feed).
- 4.3 Corpus browser per project (filtros por tipo, búsqueda libre, link counts).
- 4.7 Audit trail (filtros, paginación, expandable rows).

### Pending — self-service expansion (PRIORITIZED)

| ID | Task | Estimación | Por qué importa |
|---|---|---|---|
| **4.4** | Document detail view | ~3h | Foundation para 4.13 y 4.14 — falta la "tercera pata" después de project list y document list |
| **4.11** | Paste-to-ingest desde webapp | ~3h | Biggest single unlock: ingestar sin abrir IDE |
| **4.12** | Search UI desde webapp | ~3h | Buscar contexto sin pedirle al agente |
| **4.13** | Compose UI desde webapp | ~4h | Ver el bundle de `compose_context` formateado bonito, con focus picker |
| **4.14** | Curation actions (link, archive, supersede) | ~4h | Mantener el corpus limpio sin SQL ni CLI |
| **4.5** | Canon editor in-app | ~3h | Editar conventions/guidelines/architecture sin editar .md y correr sync |
| **4.10** | API key management UI | ~3h | Listar/etiquetar/rotar/revocar keys |

**Total estimado del sprint de usabilidad:** ~23h. Al cerrarlo, el 90% del valor del
producto se usa desde el browser.

### Pending — polish (después del sprint)

| ID | Task | Estimación |
|---|---|---|
| 4.6 | Visualizador del grafo de `document_links` | ~5h (lista) o ~10h (react-flow) |
| 4.8 | Toggle persist/ephemeral por proyecto | ~1h |
| 4.9 | CSV export de invocations | ~1h |
| 4.15 | Image/attachment support en documents | ~3-4h. Hoy `ingest_paste` toma solo markdown. Workaround: pegar screenshot en Claude Code chat → pedir transcripción a markdown → ingestar texto. Falta: blob storage (Vercel Blob o S3), columna `documents.attachments`, render en doc detail page. Útil para diagramas de arquitectura, mockups, errores de consola. |

### 🟡 Pending — committed for next session

| ID | Task | Estimación |
|---|---|---|
| **4.17** | **Drafts + confirmation pattern** | ~4-5h. Agente usa `propose_document` (no `ingest_paste` directo) → escribe a `draft_documents` con `status=pending`. Nueva página `/projects/<...>/drafts` con review/approve/reject/edit. 5 nuevas MCP tools: `propose_document`, `list_drafts`, `approve_draft`, `reject_draft`, `archive_document`. `CLAUDE.md` template generator + endpoint `/api/projects/<...>/claude-md` + botón "Download CLAUDE.md" en page del proyecto. Convención obligatoria: agente presenta propuesta detallada y pide confirmación en lenguaje natural ANTES de cualquier mutación al corpus. Resuelve: el sistema no muere si el usuario nunca dice "guardalo" — el agente captura proactivamente al draft. |
| **4.18** | **Cross-project canon (user-level conventions)** | Promovido desde Phase 6+. Las convenciones que Carlos aplica a TODOS los proyectos (ej: Salesforce naming + test rules) capturadas una vez a nivel usuario y inyectadas como contexto adicional en `compose_context` de cualquier proyecto. Sin esto, copy-pastea las mismas conventions per-cliente. Schema: tabla `user_canon` (userId, conventions, guidelines, architecture). UI: nueva sección en `/account` para editarlo. Compose merge: project canon overrides user canon donde haya conflicto. Carlos lo señaló como "super importantísimo" el 2026-05-07. |

## Phase 5 — Production deployment & resilience

Antes de invitar a nadie: que esto despliegue limpio y no se pierdan datos.

| ID | Task | Estado | Notas |
|---|---|---|---|
| **5.1** | **Vercel project + env vars + dominio `workbrain.app`** | ✅ | Apex + www en SSL via Let's Encrypt, GitHub auto-deploy en push. |
| **5.6** | **MCP HTTP transport en `/api/mcp`** | ✅ | Streamable HTTP per spec — un solo `claude mcp add --transport http` para conectar cualquier IDE sin clone/build local. 5 tools stateless: ingest_paste, search, record_decision, link_documents, compose_context. |
| 5.2 | ~~Neon producción (branch separado del dev)~~ → **Ambiente propio de `workbrain-mcp`** | 🟡 | **Reemplazada el 2026-09-05.** Ya no se trata de separar branches dentro del mismo Neon: `workbrain` (el repo viejo, vivo en workbrain.app) queda **congelado como producción** y no se toca más. `workbrain-mcp` levanta **su propio proyecto de Neon, su propio sitio y sus propios secretos** — salt y session secret distintos, así que las API keys de producción no valen acá. Producción va a quedar desactualizada a propósito. Cuando este repo esté maduro se reconcilian: migración de datos + CI/CD en serio. Efecto secundario bueno: como en el ambiente nuevo no hay nada valioso, los scripts destructivos (`db:isolate`, `db:migrate`) son seguros de correr sin supervisión. |
| 5.3 | Corpus backup strategy | ⬜ | Auto-push hook · off-site mirror · restore drill |
| 5.4 | E2E test suite | ⬜ | Playwright sobre el webapp + harness de curl para MCP |
| 5.5 | Observabilidad básica | ⬜ | Logs aggregation · error tracking (Sentry?) · métricas básicas |

## Phase 6 — Multi-user / multi-tenant ⬜

Solo si querés invitar clientes/colegas. Toca auth, modelo de datos, UI y permisos.

| ID | Task | Notas |
|---|---|---|
| 6.1 | Onboarding (signup, email verify) | Reemplaza el flujo actual de "API key única" |
| 6.2 | Account settings page | Profile, password change, sessions activas |
| 6.3 | Hardening de aislamiento por tenant | Audit que ningún query cruce userId |
| 6.4 | Roles per-project | owner / editor / viewer |
| 6.5 | Invite flow | Owner invita teammates a un proyecto |
| 6.6 | Stubs de billing | Para Phase 7+ — solo placeholders |

## Phase 7 — Live integrations (opt-in por cliente) ⬜

| ID | Task | Notas |
|---|---|---|
| 7.1 | Jira webhook → ingest | Ticket nuevo o transición → POST a `/api/ingest/paste` |
| 7.2 | Outlook/Gmail OAuth → email ingest | Filter por sender/subject patterns |
| 7.3 | Teams webhook → thread ingest | Mensaje pinneado o keyword trigger |

Cada integración requiere: configuración per-tenant, opt-in explícito, mapping de
project, y respeto al governance memo (no oversell, manual paste por defecto).

## Phase 8 — Drafts + multi-provider ⬜

Era la antigua Phase 3.

| ID | Task | Notas |
|---|---|---|
| 8.1 | Generar drafts con `communication_style` del stakeholder | Email/Teams |
| 8.2 | Provider abstraction (OpenAI/Bedrock fallback) | Behind a thin adapter |

## Phase 9 — Web-native agent ⬜

Depende de Phase 8 (necesita LLM provider behind the webapp).

| ID | Task | Notas |
|---|---|---|
| 9.1 | In-browser chat con contexto cargado | Conversación stateful por proyecto activo |
| 9.2 | One-click workflows | "explain this ticket", "draft reply to Maya", etc. |
| 9.3 | Streaming UI | Ver el agente pensar y llamar tools en vivo |

---

## Suggested execution order (immediate)

Próximas tareas en orden recomendado, con razón:

1. **4.4 Document detail** — foundation para todo lo demás. Sin una página per-doc no podés anclar curation actions ni mostrar compose result limpio.
2. **4.11 Paste-to-ingest** — biggest single unlock. Después de esta task ya no necesitás Cursor para subir contenido.
3. **4.12 Search UI** — segundo biggest unlock. Cierra el ciclo "subir → encontrar".
4. **4.13 Compose UI** — la flagship desde browser. Valida la value prop sin IDE.
5. **4.14 Curation actions** — mantener corpus limpio (link, archive, supersede).
6. **4.5 Canon editor** — última pieza para que el webapp sea autosuficiente.
7. **4.10 API key UI** — gestión de keys; bajo en urgencia para 1 usuario, alto si vas a Phase 6 después.

Después de estas 7 tasks (~23h), pausá para dogfooding real. Las decisiones de
Phase 5/6/7 vienen mejor informadas con uso acumulado.

## Decisiones tomadas y descartadas

### ⏭️ Row-level security en la base compartida — descartado (2026-09-04)

Se evaluó poner las reglas de aislamiento dentro de Postgres para que la
separación entre clientes de la base compartida no dependa de un `WHERE` en
código. **Se descartó.** Tres razones, la última es la que decide:

1. **Exige cambiar el driver.** Las reglas necesitan `set_config` dentro de una
   transacción. El driver actual (`neon-http`) manda cada consulta como un
   request HTTP suelto, sin sesión. Habría que pasar todas las consultas a
   WebSocket/Pool y envolverlas en transacción, con el costo de latencia.
2. **Exige un rol nuevo.** Hoy la app se conecta como dueña de las tablas, y el
   dueño se salta las reglas. Escribirlas sin cambiar de rol no haría nada.
3. **Ya hay una respuesta mejor y más barata.** Al cliente que pregunta se le da
   **base propia** (`db:isolate`, ~1-2 USD/mes). La frase "no hay datos de nadie
   más en tu base" es más fuerte que "compartís base pero hay reglas", y ya está
   construida.

**Lo que se hizo en su lugar**, atacando el mismo riesgo por menos: un test que
renderiza la query real de búsqueda y verifica que el filtro por proyecto
sobrevive a toda combinación de filtros opcionales (`src/lib/search.test.ts`),
y un detector de sesiones que tocaron más de un cliente
(`pnpm --filter @workbrain/web check:sessions`).

**Cuándo reabrir:** si aparece un cliente que exige aislamiento verificable
*dentro* de una base compartida — es decir, que no acepta base propia y tampoco
acepta el filtro en código. No ha pasado todavía.

---

## Decisiones diferidas hasta más uso

Cosas que vimos en dogfooding pero no decidimos todavía. Recolectar evidencia antes
de cambiar:

- **Smoke-tests de Phase 2 en `acme-finance` contaminan RAG.** Opciones a evaluar:
  subir `minSimilarity` default de 0.3 a 0.5 · agregar flag `archived` en
  `documents` (excluido de RAG) · borrar manualmente. Decisión cuando 4.14 esté
  para ver si la curation soluciona en vez de cambiar el default.
- **Cross-pollination de decisiones técnicas entre proyectos del mismo cliente o
  consultor.** El aislamiento es invariante por diseño, pero la fricción es real.
  Posible solución futura: "user-level canon" que se inyecte como contexto
  adicional en `compose_context`. Decisión post Phase 6.
- **`set_active_project` no audita.** Por diseño (es estado local del MCP server),
  pero en multi-user queremos saber qué tenant tiene qué activo. Decisión en
  Phase 6.
