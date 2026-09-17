---
name: ricerca-approfondita
description: Ricerche su internet che devono essere affidabili e con fonti (notizie, confronti, dati, "informati su X"). Usala quando conta la verifica delle fonti, non per una curiosità veloce.
triggers: cerca, ricerca, informati, notizie, fonti, confronta, indaga, approfondisci, quanto costa, statistiche, dati su
---

# Ricerca approfondita con fonti

## Metodo
1. **Scomponi la domanda** in 2-4 sotto-domande concrete. Scrivile nel piano con `todo_write`.
2. **Cerca in ampiezza**: `web_search` su ogni sotto-domanda, con parole diverse (anche in inglese: le fonti sono più numerose).
3. **Scegli le fonti**: preferisci siti ufficiali, documentazione, enti pubblici, testate note. Scarta blog anonimi, contenuti pieni di pubblicità e pagine senza data.
4. **Leggi davvero** le 3-6 pagine migliori con `web_fetch`. Non fidarti degli snippet dei motori di ricerca: sono spesso tagliati o vecchi.
5. **Incrocia**: ogni dato importante deve comparire in almeno due fonti indipendenti. Se sono in contrasto, dillo e spiega la differenza.
6. **Se serve interazione** (login, pagine che si caricano con JavaScript, grafici): passa al tool `browser`. Se compare una verifica anti-robot, fermati: OpenHowl la farà completare all'utente.

## Come rispondi
- Apri con la risposta in 2-3 righe: prima la conclusione, poi i dettagli.
- Ogni affermazione importante ha la fonte in questo formato: `[nome sito](url)`.
- Indica sempre **quando** è aggiornato il dato ("dati di agosto 2026").
- Chiudi con una riga di **cautela**: cosa non è stato possibile verificare.

## Errori da evitare
- Riportare un numero senza fonte e senza data.
- Usare una sola fonte per una cifra importante.
- Dire "secondo le mie conoscenze": se non l'hai verificato adesso, non lo sai.
- Tradurre male i termini tecnici: se hai dubbi lascia anche l'originale tra parentesi.
