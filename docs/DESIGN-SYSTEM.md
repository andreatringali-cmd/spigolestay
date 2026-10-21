# Design system Xenora (DS 1) — regole per chi aggiunge o modifica una pagina

Obiettivo: Xenora deve sembrare **un prodotto solo**: stessi pulsanti, stessi campi, stesse finestre, leggibile su telefono, in tema chiaro e scuro, usabile da tastiera. Questo documento dice cosa usare e cosa evitare. I componenti stanno in `src/components/ui/` (un file per componente, indice in `ui/index.ts`).

## 1. Come si importa

```tsx
import { Button, Field, Input, Select, Textarea, Badge, Modal, Tabs, TabPanel, Switch, DataTable, Alert } from "@/components/ui";
import { PageHeader, Card, StatCard, SectionTitle } from "@/components/ui";   // stessi import: ui.tsx è il «ponte» e ri-esporta tutto
```

`@/components/ui` risolve al file `components/ui.tsx` (PageHeader, Card, StatCard, SectionTitle) che ri-esporta anche `ui/index.ts`. Nei file nuovi usa sempre `@/components/ui`.

Altri pezzi condivisi: `ConfirmProvider` (`useConfirm()`), `ToastProvider` (`useToast()`), `components/Toggle.tsx` (adattatore sul `Switch`), `ExportMenu`, `FilterSheet`, `SearchInput`, `DateField`, `NumInput`, `EmptyState`, `StructureRequired`, `lib/a11y.ts` (`keyActivate`).

## 2. Token (in `src/app/globals.css`)

Non scrivere mai esadecimali o `text-white` nei componenti dell'app: usa i token. I colori cambiano da soli in tema scuro.

| Cosa | Token / classe Tailwind | Note |
|---|---|---|
| Sfondo pagina / card / intestazioni | `bg-paper` · `bg-surface` · `bg-wash` | |
| Testo | `text-txt` · `text-dim` (secondario) · `text-faint` (solo segnaposto e dettagli) | `dim` ≥ 4,5:1 anche su wash |
| Bordi | `border-line` (divisori, card) · `border-line-strong` (**campi e pulsanti**, ≥ 3:1) | |
| Accento | `bg-focus` + `text-on-focus` · `text-focus` | un solo accento: blu |
| Stati | `text-ok/warn/err` · `bg-ok/15` (tinta) · `bg-err` + `text-on-err` (pieno) | verde = completato, ambra = attenzione, rosso = errore/scaduto (MAI una categoria), blu = informativo |
| Testo su fondo pieno | `text-on-focus` / `on-ok` / `on-warn` / `on-err` | in scuro diventa quasi nero (il bianco su fondi chiari non passa) |
| Raggi | `--r-sm 6` chip · `--r-md 8` pulsanti/campi (`rounded-lg`) · `--r-lg 12` card (`rounded-xl`) · `--r-xl 16` finestre (`rounded-2xl`) | |
| Ombre | `--shadow-1` card interattiva · `--shadow-2` popover · `--shadow-3` finestra | |
| z-index | `--z-sticky 30` · `--z-drawer 40` · `--z-modal 200` · `--z-dropdown 1000` · `--z-toast 1100` | le conferme usano `modal + 10`; nei componenti nuovi `style={{ zIndex: "var(--z-modal)" }}` |
| Focus | anello globale `:focus-visible` (blu, 2 px, offset 2 px) | non spegnerlo |

Tema scuro: la classe `dark` sta su `<html>`; basta usare i token.

## 3. Componenti

### Button
`<Button variant="primary|secondary|ghost|danger|icon" size="sm|md" loading fullWidth>`
- `sm` = 36 px, `md` = 40 px; **su telefono entrambe 44 px** (bersaglio di tocco).
- Una sola azione `primary` per finestra/sezione. `danger` (rosso pieno) per eliminare, **sempre** dopo `useConfirm({ danger: true })`.
- `loading` mostra l'anello, blocca i clic e mette `aria-busy`. `disabled`: opacità 50 % + `cursor-not-allowed`.
- Pulsante **solo icona**: `variant="icon"` con `aria-label` obbligatorio (lo impone il tipo) oppure `<IconButton label="Chiudi">`.
- Un link con l'aspetto di un pulsante: `<a className={buttonClass("secondary", "sm")}>`.

```tsx
<Button onClick={salva} loading={salvo}>Salva</Button>
<Button variant="secondary" onClick={chiudi}>Annulla</Button>
<IconButton label="Chiudi" onClick={chiudi}><Icon name="x" /></IconButton>
```

### Field, Input, Select, Textarea
Altezza unica 40 px (44 su telefono), bordo `line-strong`, sfondo `surface`, segnaposto `faint`, anello di focus visibile, errore = bordo rosso.
```tsx
<Field label="Email" hint="Qui ti scriviamo la conferma" error={errore} required>
  <Input type="email" value={v} onChange={(e) => setV(e.target.value)} />
</Field>
<Input label="Nome" value={n} onChange={...} />                      {/* scorciatoia: si avvolge da sola in un Field */}
<Select label="Stato" value={s} onChange={...}><option value="a">Aperta</option></Select>
```
- `Field` collega da solo etichetta (`htmlFor`), aiuto e errore (`aria-describedby`, `aria-invalid`); l'errore è `role="alert"`.
- Dentro un `Field` funzionano anche `DateField` e `NumInput` (prendono id e aria dal `Field`). Per i campi che non puoi sostituire usa `inputClass()` o `FIELD_CONTROL`.
- Importi: `NumInput` (accetta la virgola italiana), non `type="number"`.

### Badge
`<Badge tone="ok|warn|err|info|neutral" size="sm|md" dot>Saldato</Badge>` — testo sempre visibile (mai solo colore), corpo ≥ 11 px. Non inventare pillole a mano.

### Modal
`<Modal open onClose title description footer size="sm|md|lg|xl" busy layer>` — fa tutto da sola: `role="dialog"` `aria-modal`, `aria-labelledby`, Esc (solo la finestra in cima), trappola del focus, ritorno del focus all'elemento che l'ha aperta, blocco dello scorrimento, portale nel `<body>`, z-index dai token, **su telefono diventa un foglio (sheet) in basso**.
- Footer: «Annulla» (secondario) a sinistra del primario.
- Azione **distruttiva**: il focus iniziale va su «Annulla» → metti `data-autofocus` su «Annulla» (o usa `useConfirm({ danger: true })`, che lo fa da solo).
- Mai più `fixed inset-0` scritti a mano.

### Tabs / TabPanel
`<Tabs id={id} ariaLabel="Sezioni" value items onChange variant="underline|pill" />` + `<TabPanel id={id} value active>`: `role=tablist/tab/tabpanel`, frecce sinistra/destra, Home/End, solo la scheda attiva si raggiunge con Tab. Per scelte singole non-schede (es. «Griglia | Dettagliata») usa pulsanti con `aria-pressed` dentro un `role="group"`.

### Switch (e `components/Toggle.tsx`)
`<Switch checked onCheckedChange label />` — `role="switch"`, `aria-checked`, bersaglio esteso. Mettilo dentro una `<label>` con il testo, oppure dagli `label`. Colore acceso predefinito blu; `color="var(--ok)"` solo per «attivo = ok».

### DataTable
`<DataTable columns rows rowKey onRowClick caption stickyHeader loading empty />` — intestazione 11 px maiuscola su `wash`, celle `px-3 py-2`, righe cliccabili **raggiungibili da tastiera** (Tab, poi Invio/Spazio), stato vuoto e scheletro di caricamento. Per tabelle con righe espandibili o piè di tabella resta una `<table>` a mano, ma usa le stesse classi.

### Alert / Toast
`<Alert tone="info|ok|warn|err" title onClose action>` per avvisi **dentro la pagina** (errori di un modulo, esito di un'operazione). `useToast()` per notifiche a comparsa: `toast("Salvato", "success")`; gli errori restano 8 s e sono annunciati subito (`role="alert"`).
- **Mai** `window.alert/confirm/prompt`: usa `toast()` e `useConfirm()`.

### Card, PageHeader, StatCard
`<Card>` è statica (nessuna alzata al passaggio); `interactive` per le card cliccabili, `animate={false}` per toglierne l'ingresso, `padding="none|sm"` al posto dei `!p-*`. Ogni pagina: `PageHeader` + contenuto.

## 4. Testi (italiano)
Creare: «Nuova prenotazione» / «Nuovo ospite» (pulsante e titolo uguali). «Aggiungi» solo per inserire una voce in un elenco. Salvare: «Salva»; conferma con effetto esterno: «Conferma»; «Applica» solo per filtri. Cancellare dati: «Elimina» (con conferma); togliere un collegamento: «Rimuovi». Esportare: «Esporta». Attesa: «Caricamento…», «Salvataggio…». Vuoti: «Nessuna prenotazione» (senza punto) + azione. Importi sempre con `eur()`, date con `fmtDMY`.

## 5. Cosa evitare
- `<button className="…bg-focus text-white…">` scritto a mano → `Button`.
- `const inp = "w-full rounded-lg border …"` ridichiarata → `Input/Select/Textarea`.
- Overlay `fixed inset-0` a mano → `Modal`. Interruttori a mano → `Switch`/`Toggle`.
- Pillole `rounded-full px-2 py-0.5 text-[10px]` → `Badge`.
- `outline-none` senza alternativa (togli la classe: l'anello globale basta) e `text-faint` per testo che serve (usa `text-dim`).
- Esadecimali, `text-white`, corpi sotto 11 px, rosso per eventi normali.
- `div`/`tr`/`span` con `onClick` senza tastiera → un vero `<button>`/`<a>`; se è una riga intera usa `{...keyActivate(fn)}` (`lib/a11y.ts`).
- `window.alert/confirm/prompt`.
- Un selettore di struttura dentro la pagina: la struttura si sceglie solo in alto a destra (`StructureRequired` per le pagine di una sola struttura).

## 6. Checklist di accessibilità (prima di consegnare una pagina)
1. Ogni pulsante senza testo ha `aria-label` (o è un `IconButton`). Le icone decorative hanno `aria-hidden`.
2. Ogni campo ha un'etichetta (`Field`/`Input label`); gli errori sono `role="alert"` e il campo `aria-invalid`.
3. Si arriva a tutto con **Tab**, nell'ordine visivo; il focus è sempre visibile; **Esc** chiude finestre e menu; alla chiusura il focus torna dove era.
4. Nessun elemento cliccabile che non sia `<button>`/`<a>` (o non abbia `keyActivate`).
5. Interruttori `role="switch"`, schede `role="tab"`, finestre `role="dialog"`.
6. Contrasto testo ≥ 4,5:1 (3:1 sopra i 18 px e per le icone/bordi dei controlli) in **chiaro e scuro**: usa solo i token.
7. Bersagli di tocco ≥ 40 px su telefono (i componenti lo fanno da soli; per un link in linea aggiungi padding verticale con margine negativo).
8. Corpo del testo ≥ 11 px; nessuna informazione affidata al solo colore (testo, icona o pallino accanto).
9. La pagina non scorre di lato a 375 px; i campi sono a 16 px su telefono (già garantito da `globals.css`).
10. Verifica a 1440 e 375 px, chiaro e scuro.

## 7. Test
`tests/ui-*.test.ts` rendono i componenti con `react-dom/server` (la compilazione del JSX è in `tests/ui-harness.ts`). Aggiungi un test quando aggiungi un componente o una variante: classi, attributi `aria-*`, varianti. `tests/a11y.test.ts` copre `keyActivate`.

## 8. Layout dell'app
`AppShell` offre il link «Vai al contenuto» (primo elemento focalizzabile, visibile solo al focus), un solo `<main id="contenuto">`, `<nav aria-label="Menu principale">` con `aria-current` sulla voce attiva e i gruppi con `aria-expanded`.
