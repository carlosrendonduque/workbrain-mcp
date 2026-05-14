# Emergent product directions

Ideas que surgen del uso real (dogfooding), no de planning upfront. Cada
entrada es un kernel preservado para evaluación futura — la mayoría no
shipea; algunas gradúan a roadmap cuando se validan con más uso.

Distinto de:
- `06-roadmap.md` — lo planeado, con fases ordenadas.
- `07-dogfooding-findings.md` — gaps concretos pendientes de fix.

Convención: entradas al tope, fechadas. Status: 🌱 fresh · 🌿 maturing
· ✅ graduated to roadmap · ⏭️ rejected.

---

## Vocabulario / naming convention

Cuando se trabaja con WorkBrain en el flujo "meta-dialog" (ver entrada
del 2026-05-12 más abajo), se usan dos instancias distintas de Claude
que el usuario referencia por nombre:

- **WorkBrain Meta** — chat de orquestación / construcción de producto.
  Sostiene meta-contexto: principios, templates de prompt, framework de
  review, decisiones sobre qué capturar. NUNCA escribe código de ticket.
  En el repo, es el chat abierto sobre `workbrain/` (este repo).
- **WorkBrain Task Agent** — chat per-ticket en la IDE del repo target
  (ORION, ACME, etc). Ejecuta trabajo concreto del ticket: análisis,
  spike, refactor, auditoría. NUNCA decide dirección de producto. Hay
  uno distinto por ticket activo.

Forma de uso del usuario al referirse:

- *"El Meta sugiere X"* — refiere al chat de orquestación.
- *"El Task Agent de RSD-12539 respondió Y"* — refiere al chat per-ticket
  específico, identificándolo por externalId del ticket en juego.

Cuando la UI two-column del meta-dialog se diseñe (ver entrada abajo),
el panel izquierdo se etiqueta **Meta** y el panel derecho **Task Agent**.

---

## 2026-05-12 · Meta-dialog: WorkBrain como orquestador del task agent

🌱 fresh

**Observación.** Durante el dogfooding de ORION-312 corrieron dos sesiones
de Claude en paralelo:

- El **chat dev de WorkBrain** (donde Carlos y yo construimos producto)
  sostuvo el meta-contexto: principios del producto, templates de prompt,
  framework de review, decisiones sobre qué capturar.
- El **chat de ORION en la IDE** ejecutó el trabajo concreto del ticket:
  análisis, spike, refactor, auditoría de VRs.

Carlos shuttleaba entre los dos: un resultado del agente ORION volvía al
chat dev para revisión, se decidía refinamiento, se re-enviaba al agente
ORION con el refinamiento aplicado. El agente WorkBrain nunca escribió
código del ticket; el agente ORION nunca decidió dirección de producto.
Cada uno se mantuvo en su carril.

**Patrón (nombrado en el momento).** "Meta-dialog" / "revisión de la
revisión".

**Por qué podría funcionar.**

- El agente meta revisa sin estar atascado en ejecución — ve estructura.
- El ejecutor enfoca sin context-switching a razonamiento de producto.
- Rigor compuesto: cada resultado concreto se filtra por una capa de
  review explícita antes de convertirse en decisión.

**Manifestación potencial en producto.**

- UI de WorkBrain con dos columnas: izquierda = chat orquestador
  (review de producto/proceso), derecha = task agent (trabajo concreto
  del ticket).
- Estado compartido vía el corpus: drafts, decisions, activity feed son
  visibles a los dos lados.
- El chat orquestador tiene herramientas para inspeccionar o dirigir el
  output del task agent sin reescribirlo (¿prompts sugeridos? ¿review
  inline? ¿señal de aprobación?).

**Preguntas abiertas.**

- ¿El valor está en *dos agentes* o en *dos ventanas de chat*? ¿Uno solo
  con disciplina lograría lo mismo?
- ¿Cómo media WorkBrain? ¿Solo side-by-side, o estado compartido real /
  cross-talk explícito?
- ¿Escala a múltiples chats de proyecto en paralelo (ORION + ACME + ...)?
  ¿Un meta para muchas tasks?
- ¿Cuál es el MVP de UI vs la visión completa multi-agente?
- ¿El agente meta debe tener acceso al output del task agent vía
  herramienta MCP nueva (ej. `read_sibling_session`), o el handoff sigue
  siendo manual del usuario via copy-paste?

**Triggered by:** sesión de spike + refactor de ORION-312, 2026-05-12.

**Status:** parked. Revisitar cuando aparezcan más ideas de forma similar
— o cuando esta vuelva a surgir sin que la traigamos a colación en una
tercera sesión.
