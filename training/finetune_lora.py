#!/usr/bin/env python3
"""LoRA/QLoRA-Feintuning eines offenen Modells auf eigenen ME-IT-Daten – komplett offline.

Ablauf:
  1. Im Cockpit unter "KI-Training" die JSONL-Datei exportieren (pseudonymisiert).
  2. Auf dem KI-PC (NVIDIA-GPU, Linux oder Windows+WSL2):
        pip install -r requirements-training.txt
        python training/finetune_lora.py --data training/data.jsonl
  3. Ergebnis in Ollama importieren:
        ollama create meit-assistent -f training/output/Modelfile
  4. In .env: OLLAMA_MODEL=meit-assistent

VRAM-Richtwerte (QLoRA 4-bit, Sequenzlänge 2048):
  8B ≈ 10–12 GB · 14B ≈ 16–20 GB · 32B ≈ 26–32 GB (RTX 5090 = 32 GB)

Hinweis: Die Bibliotheken (Unsloth, TRL) entwickeln sich schnell. Das Skript erkennt
die gängigen Varianten der TRL-API automatisch; bei Fehlern docs.unsloth.ai prüfen.
"""

from __future__ import annotations

import argparse
import inspect
import json
import random
import sys
from pathlib import Path

DEFAULT_BASE = "unsloth/Qwen3-14B-unsloth-bnb-4bit"
SYSTEM_PROMPT = (
    "Du bist der Support-Assistent eines österreichischen IT-Dienstleisters. "
    "Du ordnest Anfragen ein und gibst konkrete, geprüfte Lösungsschritte auf Deutsch."
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="LoRA-Feintuning für das ME-IT-Modell")
    p.add_argument("--data", required=True, help="JSONL-Export aus dem Cockpit")
    p.add_argument("--base", default=DEFAULT_BASE, help=f"Basismodell (Hugging Face), Standard: {DEFAULT_BASE}")
    p.add_argument("--out", default="training/output", help="Ausgabeordner")
    p.add_argument("--epochs", type=float, default=2.0)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--rank", type=int, default=16, help="LoRA-Rang (8–64)")
    p.add_argument("--max-len", type=int, default=2048)
    p.add_argument("--batch", type=int, default=2)
    p.add_argument("--grad-accum", type=int, default=4)
    p.add_argument("--eval-split", type=float, default=0.1, help="Anteil für Test (0 = aus)")
    p.add_argument("--quant", default="q4_k_m", help="GGUF-Quantisierung für Ollama (q4_k_m, q5_k_m, q8_0)")
    p.add_argument("--no-gguf", action="store_true", help="nur LoRA-Adapter speichern")
    p.add_argument("--dry-run", action="store_true", help="nur Daten prüfen, nicht trainieren")
    return p.parse_args()


def load_examples(path: str) -> list[dict]:
    examples = []
    for n, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.exit(f"Zeile {n}: ungültiges JSON ({exc})")
        msgs = row.get("messages")
        if not isinstance(msgs, list) or len(msgs) < 2 or msgs[-1].get("role") != "assistant":
            sys.exit(f"Zeile {n}: erwartet {{'messages': [..., {{'role': 'assistant', ...}}]}}")
        examples.append({"messages": msgs})
    return examples


def main() -> None:
    args = parse_args()
    examples = load_examples(args.data)
    print(f"{len(examples)} Trainingsbeispiele geladen.")
    if len(examples) < 50:
        print("WARNUNG: Sehr wenige Beispiele – das Modell lernt kaum etwas. Ziel: 300–1000 gute Beispiele.")
    if args.dry_run:
        print("Dry-Run: Daten sind formal in Ordnung.")
        return

    try:
        from unsloth import FastLanguageModel  # muss vor transformers/trl importiert werden
    except ImportError:
        sys.exit("Unsloth fehlt: pip install -r requirements-training.txt (NVIDIA-GPU + CUDA erforderlich)")
    from datasets import Dataset
    from trl import SFTConfig, SFTTrainer

    random.seed(42)
    random.shuffle(examples)
    n_eval = int(len(examples) * args.eval_split) if len(examples) >= 20 else 0
    eval_rows, train_rows = examples[:n_eval], examples[n_eval:]

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base, max_seq_length=args.max_len, load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model, r=args.rank, lora_alpha=args.rank, lora_dropout=0, bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth", random_state=42,
    )

    def to_text(row: dict) -> dict:
        return {"text": tokenizer.apply_chat_template(row["messages"], tokenize=False)}

    train_ds = Dataset.from_list(train_rows).map(to_text, remove_columns=["messages"])
    eval_ds = Dataset.from_list(eval_rows).map(to_text, remove_columns=["messages"]) if eval_rows else None

    # TRL hat Parameter umbenannt (max_seq_length -> max_length, tokenizer -> processing_class).
    config_fields = set(inspect.signature(SFTConfig.__init__).parameters)
    cfg = dict(
        output_dir=str(Path(args.out) / "checkpoints"), num_train_epochs=args.epochs, learning_rate=args.lr,
        per_device_train_batch_size=args.batch, gradient_accumulation_steps=args.grad_accum,
        warmup_ratio=0.05, lr_scheduler_type="cosine", logging_steps=5, save_strategy="epoch",
        optim="adamw_8bit", weight_decay=0.01, seed=42, report_to="none", dataset_text_field="text",
    )
    cfg["max_length" if "max_length" in config_fields else "max_seq_length"] = args.max_len
    if eval_ds is not None:
        cfg["eval_strategy" if "eval_strategy" in config_fields else "evaluation_strategy"] = "epoch"
    trainer_kwargs = dict(model=model, train_dataset=train_ds, eval_dataset=eval_ds,
                          args=SFTConfig(**{k: v for k, v in cfg.items() if k in config_fields}))
    trainer_fields = set(inspect.signature(SFTTrainer.__init__).parameters)
    trainer_kwargs["processing_class" if "processing_class" in trainer_fields else "tokenizer"] = tokenizer

    trainer = SFTTrainer(**trainer_kwargs)
    stats = trainer.train()
    print(f"Training fertig: {stats.metrics}")

    out = Path(args.out)
    adapter_dir = out / "lora-adapter"
    model.save_pretrained(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    print(f"LoRA-Adapter gespeichert: {adapter_dir}")

    # Kurzer Funktionstest mit einem Testbeispiel
    if eval_rows:
        FastLanguageModel.for_inference(model)
        sample = eval_rows[0]["messages"][:-1]
        inputs = tokenizer.apply_chat_template(sample, add_generation_prompt=True, return_tensors="pt").to(model.device)
        output = model.generate(input_ids=inputs, max_new_tokens=300, temperature=0.3, do_sample=True)
        print("\n--- Testfrage ---\n", sample[-1]["content"])
        print("--- Antwort ---\n", tokenizer.decode(output[0][inputs.shape[1]:], skip_special_tokens=True))
        print("--- Erwartet ---\n", eval_rows[0]["messages"][-1]["content"], "\n")

    if args.no_gguf:
        return
    gguf_dir = out / "gguf"
    model.save_pretrained_gguf(str(gguf_dir), tokenizer, quantization_method=args.quant)
    # Je nach Unsloth-Version landen die Dateien in "gguf/" oder "gguf_gguf/".
    ggufs = sorted(out.rglob("*.gguf"), key=lambda f: f.stat().st_mtime)
    if not ggufs:
        print(f"GGUF erstellt, aber Datei nicht gefunden – bitte in {gguf_dir} prüfen und Modelfile anpassen.")
        return
    gguf = ggufs[-1].resolve()
    modelfile = out / "Modelfile"
    modelfile.write_text(
        f"FROM {gguf}\n"
        "PARAMETER temperature 0.3\n"
        "PARAMETER num_ctx 8192\n"
        f'SYSTEM """{SYSTEM_PROMPT}"""\n',
        encoding="utf-8",
    )
    print(f"\nFertig! Jetzt in Ollama importieren:\n  ollama create meit-assistent -f {modelfile}\n"
          "Danach in .env: OLLAMA_MODEL=meit-assistent")


if __name__ == "__main__":
    main()
