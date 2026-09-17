---
name: pagina-web
description: Creare o migliorare una pagina, un sito vetrina o un piccolo gioco in HTML/CSS/JS in un unico file. Usala quando l'utente chiede un sito, una landing page, una demo o un gioco da aprire nel browser.
triggers: pagina web, sito, landing, html, css, gioco, game, vetrina, one-page, snake, pagina di benvenuto, mini gioco
---

# Pagina web in un file

## Regole di base
- **Un solo file `index.html`** con CSS e JS dentro, se non ti chiedono altro: si apre con un doppio clic, senza installare nulla.
- Nessuna libreria esterna, a meno che serva davvero. Niente build, niente npm.
- Mobile incluso: layout che regge a 380px di larghezza, nessuno scorrimento orizzontale.
- Tema chiaro e scuro automatici con `@media (prefers-color-scheme: dark)`.
- Font di sistema (`system-ui`): parte subito e funziona offline.

## Metodo
1. Chiedi (o decidi e dichiara) tre cose: scopo, pubblico, tono visivo.
2. Scrivi il file con `write_file`, poi **rileggilo** con `read_file` per controllare che sia integro.
3. Verifica che funzioni: apri il file col tool `browser` (`navigate` su `file:///percorso/index.html`), fai uno `snapshot` e controlla che non ci siano errori in console.
4. Solo dopo racconta cos'hai fatto, indicando il percorso completo del file.

## Qualità visiva
- Gerarchia chiara: un titolo grande, sottotitolo, poi il contenuto.
- Spazi generosi (`padding` 20-40px), angoli arrotondati, ombre leggere.
- Massimo due colori d'accento; il resto in scala di grigi.
- Se ci sono animazioni, devono essere brevi (150-300ms) e rispettare `prefers-reduced-motion`.

## Per i giochi
- Ciclo con `requestAnimationFrame`, non `setInterval`.
- Comandi sia da tastiera sia da tocco.
- Punteggio sempre visibile e schermata di fine partita con possibilità di ricominciare.
- Salva il punteggio migliore in `localStorage` dentro un `try/catch`.
