# 🐺 Il Branco di agenti

Stesso modello (Qwen 3.5 9B in LM Studio), «DNA» diversi: gli agenti si accoppiano, mutano imparando dai propri
errori e vengono selezionati con un esame vero.

```bash
node branco-agenti.mjs --prova 6            # prova veloce: ogni fondatore su un solo caso
node branco-agenti.mjs --gen 4 --figli 6    # corsa completa (~1 ora sul PC con LM Studio)
```

Mentre gira, apri `albero.html`: si aggiorna da sola ogni 20 secondi. `corsa.log` contiene il registro passo per passo.

| Pezzo | File | Cosa fa |
|---|---|---|
| Il mondo | `mondo.mjs` | Regolamento affitti inventato «LupoCasa» (9 articoli con tolleranze, tetti ed eccezioni), 5 clienti, 6 casi d'esame + 4 segreti. Le risposte giuste sono calcolate dal codice. |
| Gli strumenti | `mondo.mjs` | `indice`, `leggi_articolo`, `scheda_cliente`, `calcola` |
| Il DNA | `branco-agenti.mjs` | personalità · quanto ragiona (`reasoning_effort` none/low/medium) · temperatura · regole imparate |
| PCR | fondatori | 6 personalità: Scrupoloso, Contabile, Velocista, Cacciatore di eccezioni, Pianificatore, Intuitivo |
| Accoppiamento | `breed()` | geni presi dai due genitori, regole ereditate a caso (max 5) |
| Mutazione | `reflect()` | Qwen rilegge un caso sbagliato dal genitore — **senza la risposta giusta** — e scrive una regola generale |
| Selezione | ogni generazione | i 3 migliori (voto, poi velocità) tra figli e genitori |
| Esame segreto | fine corsa | 4 casi mai visti, per l'alfa e il miglior fondatore |

Limiti da sapere: ogni caso viene svolto una volta sola, quindi il voto contiene anche fortuna; l'esame è piccolo
(6 casi), quindi il branco può imparare *quell'esame*. L'esame segreto serve proprio a controllarlo.
