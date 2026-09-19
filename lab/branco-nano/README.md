# 🐺 Il Branco nano

Prova in miniatura dell'idea «PCR + famiglia» per far evolvere modelli di IA, prima di provarla con Qwen.

```bash
python branco.py            # serve solo numpy · circa 3 secondi · scrive risultati.json e albero.html
python branco.py --seed 5 --gen 10
```

Poi apri `albero.html`: albero genealogico interattivo, «▶ Guarda l'evoluzione», scheda di ogni lupo, grafico per generazione.

| Fase | Nel nano | Con Qwen (prossimo passo) |
|---|---|---|
| Antenato | rete da 17 mila parametri addestrata poco su tutto | Qwen 3.5 base |
| PCR | un fondatore per materia (massimo, minimo, confronto, vicinanza) | una specializzazione per primer (es. contratti, lavoro…) |
| Accoppiamento | fusione dei pesi: media, somma, TIES, DARE | le stesse ricette con mergekit |
| Mutazione | breve ripasso della materia più debole | breve LoRA mirata |
| Selezione | esame su 4 materie + esame segreto su fatti mai visti | esame del campo + esame segreto |

Risultati su 7 seed (8 generazioni): miglior fondatore ~72% → alfa ~79% (+7 punti), esame segreto ~69%.
L'addestramento diretto con *tutti* i dati arriva al 100%: il branco serve quando i dati non li hai tutti insieme
ma hai specialisti già addestrati da fondere. Dopo alcune generazioni il branco spesso si blocca (consanguineità):
è il prossimo problema da risolvere.
