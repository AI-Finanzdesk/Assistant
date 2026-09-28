# GB10-test: lokale modellen uitproberen

Met deze test kijken we of onze eigen KI-server (NVIDIA GB10) mails en meetings goed genoeg kan
verwerken, vóórdat er iets aan Exchange, de agenda of de app gekoppeld wordt. **Er is geen
systeembeheerder voor nodig**: alles draait op de GB10 zelf, met voorbeeldbestanden die we met de
hand in een map zetten. Er gaat niets naar buiten, behalve het eenmalig downloaden van de modellen
(en alleen als je dat expliciet kiest: een vergelijking met Claude).

De test gebruikt **precies dezelfde prompts en antwoordschema's als de app** (`src/lib/ai/tasks.ts`),
dus wat hier goed werkt, werkt later ook in de app.

| Wat | Hoe | Resultaat |
|---|---|---|
| Mails samenvatten | `npm run gb10-test` | Samenvatting, actie en kennisonderwerpen per mail |
| Meetingverslag | idem, op transcripten | Verslag in onderdelen, taken, opvolging |
| Spraak naar tekst | `python transcribe.py` | Transcript met sprekers, in het formaat van de app |

Alles komt in één rapport (`results/<tijdstip>/rapport.html`) met de modellen naast elkaar, plus de
rekentijd per model.

## 1. Modelserver installeren (Ollama)

Ollama is de eenvoudigste start en draait op de GB10 (Linux, ARM). Het kan later worden vervangen
door vLLM; de test en de app praten met beide via hetzelfde protocol.

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Groter contextvenster, nodig voor lange transcripten
sudo systemctl edit ollama     # voeg toe onder [Service]:
#   Environment="OLLAMA_CONTEXT_LENGTH=32768"
sudo systemctl restart ollama

ollama pull gpt-oss:120b       # ca. 65 GB, eerste kandidaat
ollama pull mistral-small3.2   # ca. 15 GB, snel en sterk in Duits/Nederlands
```

Controle: `curl http://localhost:11434/v1/models` toont beide modellen. Kijk bij het downloaden of er
van deze modellen al een nieuwere versie is; die kun je gewoon in `LOCAL_MODELS` zetten.

## 2. Testkit klaarzetten

Node.js 20 of nieuwer is nodig (`node -v`).

```bash
git clone <repository> && cd <repository>
npm ci
cp gb10-test/.env.example gb10-test/.env    # taal, projectnaam, deelnemers invullen
mkdir -p gb10-test/data/mails gb10-test/data/transcripts gb10-test/data/opnames
```

`gb10-test/data/`, `gb10-test/results/` en `gb10-test/.env` staan in `.gitignore`: echte mails en
opnames komen nooit in git terecht.

## 3. Testmateriaal verzamelen

Kies materiaal waarvan we weten wat eruit hoort te komen, zodat we de kwaliteit kunnen beoordelen.

- **Mails** (15–20 stuks, verschillende soorten: offertes, afspraken, lange threads, Duits én
  Nederlands) naar `data/mails/`:
  - `.eml`: nieuwe Outlook en Outlook voor Mac → mail naar de map slepen.
  - `.txt`: klassieke Outlook voor Windows → *Datei → Speichern unter → Nur Text (\*.txt)*.
  - `.msg` (slepen in klassieke Outlook) wordt overgeslagen; sla die als `.txt` op.
- **Opnames** (2–3 overleggen van 15–60 minuten) naar `data/opnames/`. Een telefoonopname
  (m4a, mp3, webm, wav) is prima. Alleen met toestemming van alle deelnemers.
- Of direct **transcripten** als tekst in `data/transcripts/` (formaat: `[mm:ss] Spreker A: …`).

## 4. Opnames transcriberen (Whisper + sprekerherkenning)

De spraakmodellen draaien in de PyTorch-container van NVIDIA. Daarin werkt de GPU van de GB10 direct.

Eenmalig:
1. Maak een account op huggingface.co → *Settings → Access Tokens* → token met leesrechten.
2. Accepteer met dat account de voorwaarden op
   [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) en
   [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0).
   Het token dient alleen om de modellen te downloaden; de audio blijft op de GB10.

```bash
# Actuele tag van de container: catalog.ngc.nvidia.com → "PyTorch" (versie voor ARM64/DGX Spark)
docker run --gpus all -it --rm -v "$PWD/gb10-test":/work -w /work \
  -e HF_TOKEN=hf_... nvcr.io/nvidia/pytorch:<tag> bash

# in de container:
apt-get update && apt-get install -y ffmpeg
pip install -r requirements.txt
python transcribe.py data/opnames/overleg.m4a --taal de --sprekers 3
```

Het transcript komt in `data/transcripts/overleg.txt`. `--model openai/whisper-large-v3-turbo` is
sneller, `large-v3` iets nauwkeuriger. Luister een paar fragmenten terug om de kwaliteit te beoordelen.

## 5. Test draaien

```bash
npm run gb10-test
```

Het script laat elk model uit `LOCAL_MODELS` alle mails (in porties van 10, zoals de app) en alle
transcripten verwerken, na elkaar, zodat de tijden eerlijk te vergelijken zijn.

**Vergelijken met Claude** (optioneel): `npm run gb10-test -- --claude`. Dan gaat het testmateriaal
naar Claude via Google Cloud in de EU. Doe dit alleen met materiaal waarvoor dat mag, en met de
Google Cloud-gegevens in `gb10-test/.env` (zie de README in de hoofdmap, stap 2).

## 6. Beoordelen

Open `results/<tijdstip>/rapport.html` en let per blok op:

- **Klopt het?** Geen verzonnen namen, bedragen of datums.
- **Is het volledig?** Staan de belangrijke punten, besluiten en taken erin?
- **Taal:** goed Duits/Nederlands, in de gevraagde taal?
- **Snelheid:** de mailsync draait 's nachts, dus minuten zijn geen probleem. Een verslag moet
  binnen enkele minuten klaar zijn.
- **Fouten:** een model dat vaak het schema niet haalt, is ongeschikt voor de app.

De uitkomst bepaalt welke taken later in de app lokaal gaan en welke naar Claude.

## Wat deze test níet doet

Geen koppeling met Exchange, agenda, Supabase of de app, en er worden geen poorten opengezet.
Daarvoor is later de systeembeheerder nodig (zie de one-pager "Daten, KI und IT").
