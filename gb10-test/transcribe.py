"""
Spraak naar tekst op de GB10: Whisper (transcriptie) + pyannote (wie spreekt wanneer).

Uitvoer in hetzelfde formaat als de app nu van AssemblyAI maakt:
    [mm:ss] Spreker A: ...

Gebruik (zie README.md):
    python transcribe.py data/opnames/overleg.m4a --taal de
    -> schrijft data/transcripts/overleg.txt

Nodig: ffmpeg, en een Hugging Face-token (HF_TOKEN) waarmee de voorwaarden van
pyannote/speaker-diarization-3.1 zijn geaccepteerd. Alles draait lokaal; het token
dient alleen om het model eenmalig te downloaden.
"""

import argparse
import os
import subprocess
import tempfile
import time
from pathlib import Path

import torch
from pyannote.audio import Pipeline
from transformers import pipeline as hf_pipeline

TAAL = {"de": "german", "nl": "dutch"}


def naar_wav(bron: Path, doel: Path) -> None:
    """16 kHz mono WAV: werkt voor beide modellen, ongeacht het formaat van de telefoon."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(bron), "-ac", "1", "-ar", "16000", str(doel)],
        check=True,
    )


def transcriberen(wav: Path, taal: str, model: str, device: str):
    asr = hf_pipeline(
        "automatic-speech-recognition",
        model=model,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        device=device,
    )
    uit = asr(
        str(wav),
        chunk_length_s=30,
        batch_size=8,
        return_timestamps=True,
        generate_kwargs={"language": TAAL[taal], "task": "transcribe"},
    )
    return [
        {"start": c["timestamp"][0] or 0.0, "end": c["timestamp"][1] or c["timestamp"][0] or 0.0, "text": c["text"].strip()}
        for c in uit["chunks"]
        if c["text"].strip()
    ]


def sprekers(wav: Path, token: str, device: str, aantal: int | None):
    try:
        pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=token)
    except TypeError:  # oudere pyannote-versies
        pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=token)
    pipe.to(torch.device(device))
    uit = pipe(str(wav), **({"num_speakers": aantal} if aantal else {}))
    annotatie = getattr(uit, "speaker_diarization", uit)  # pyannote 4 geeft een object terug
    return [(beurt.start, beurt.end, spreker) for beurt, _, spreker in annotatie.itertracks(yield_label=True)]


def koppelen(stukken, beurten):
    """Geef elk stuk tekst de spreker met de meeste overlap in tijd; labels worden A, B, C, …"""
    letters: dict[str, str] = {}
    regels = []
    for s in stukken:
        overlap: dict[str, float] = {}
        for start, eind, spreker in beurten:
            o = min(s["end"], eind) - max(s["start"], start)
            if o > 0:
                overlap[spreker] = overlap.get(spreker, 0) + o
        spreker = max(overlap, key=overlap.get) if overlap else None
        if spreker and spreker not in letters:
            letters[spreker] = chr(ord("A") + len(letters))
        label = letters.get(spreker, "?") if spreker else "?"
        # Opeenvolgende stukken van dezelfde spreker samenvoegen.
        if regels and regels[-1]["label"] == label:
            regels[-1]["text"] += " " + s["text"]
        else:
            regels.append({"start": s["start"], "label": label, "text": s["text"]})
    return "\n".join(f"[{int(r['start'] // 60):02d}:{int(r['start'] % 60):02d}] Spreker {r['label']}: {r['text']}" for r in regels)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("opname", type=Path)
    p.add_argument("--taal", choices=TAAL.keys(), default="de")
    p.add_argument("--sprekers", type=int, help="aantal sprekers, als bekend (verbetert de herkenning)")
    p.add_argument("--model", default="openai/whisper-large-v3", help="bv. openai/whisper-large-v3-turbo (sneller)")
    p.add_argument("--uit", type=Path, help="standaard: data/transcripts/<naam>.txt")
    a = p.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN ontbreekt (zie README.md).")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("Let op: geen GPU gevonden, dit wordt erg traag.")

    uit = a.uit or Path(__file__).parent / "data" / "transcripts" / f"{a.opname.stem}.txt"
    uit.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        naar_wav(a.opname, wav)
        t0 = time.time()
        stukken = transcriberen(wav, a.taal, a.model, device)
        t1 = time.time()
        beurten = sprekers(wav, token, device, a.sprekers)
        t2 = time.time()

    uit.write_text(koppelen(stukken, beurten) + "\n", encoding="utf-8")
    print(f"Transcriptie {t1 - t0:.0f} s · sprekers {t2 - t1:.0f} s · {len(set(s for *_, s in beurten))} sprekers → {uit}")


if __name__ == "__main__":
    main()
