## Dogfooding findings — open

Hallazgos durante el uso real del producto que están abiertos. Cuando
un item se cierra se elimina (no se marca ✅) — la trazabilidad vive en
git history. La idea de este doc es responder rápido "qué falta".

---

### 1. Clasificación dudosa entre `decision` / `convention` / `guideline` / `note`

**Contexto:** durante la sesión real, el agente clasificó la regla
"Legacy/new coexistence rule for Recommended Actions" como
`convention`. No es una convention — es una **decisión temporal** sobre
cómo manejar la coexistencia legacy↔nuevo durante la migración ACME.
Cuando termine la migración la regla deja de aplicar; una convention de
verdad sería atemporal.

**Riesgo:** sin criterios claros, drafts caen en el bucket equivocado y
después la búsqueda / `compose_context` los recupera mal (o no los
recupera). Multiplicado por 1000 documentos, el corpus se vuelve
inconsistente.

**Lo que falta:**

Bloque de desambiguación en el contrato (`lib/mcp/instructions.ts`)
después de la tabla "content shape → type", con criterios accionables:

- **decision**: choice puntual con razón, time-bound, atado a ticket /
  fase / migración. "Decidimos X porque Y, mientras dure Z".
- **convention**: regla atemporal de código / data / arquitectura.
  Aplica siempre. "Siempre hacemos X".
- **guideline**: preferencia blanda de way-of-working. Recomendación,
  no regla.
- **note**: info general sin peso normativo.

Test rápido para resolver duda decision↔convention: *¿esto seguiría
siendo cierto cuando termine la migración / fase / proyecto actual?*
Sí → convention. No → decision.

**Aplica también al draft existente:** "convention-legacy-new-coexistence"
debería rejectearse y re-pegarse para que el agente lo reclasifique
como `decision` con la guía nueva.

---

### 2. Edit form de drafts no permite editar `relatedExternalIds`

**Contexto:** el form de "Edit before approving" en
`drafts-list.tsx` deja editar título, externalId y contenido. No deja
ajustar las relaciones que el agente propuso. Si el agente se equivoca
linkeando un sibling que no corresponde, el usuario no puede corregir
sin rejectear y re-pegar.

**Por qué importa poco hoy:** las relaciones materializan en
`document_links` solo cuando el target ya existe; si el agente linkea
algo inexistente queda como soft hint sin efecto. Pero a medida que
crezca el corpus va a importar.

**Prioridad:** baja. Considerarlo si aparece como dolor real durante
dogfooding extendido.

---
