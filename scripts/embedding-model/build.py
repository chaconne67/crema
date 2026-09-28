"""Builds the embedding model the Crema engine bundles for meaning search in the knowledge notebook:
exp-models/dragonkue-KoEn-E5-Tiny (Apache-2.0; fine-tuned from intfloat/multilingual-e5-small for
Korean retrieval) at a pinned revision, its fp32 ONNX quantized to int8 for x86 (the repository's int8
file is built for ARM64). Mean pooling and L2 normalization are done by the engine
(agent/knowledge_embed.py); queries take the prefix "query: ", passages "passage: ".

    python build.py <out dir>      (needs: onnx, onnxruntime)

Writes model.onnx, tokenizer.json and NOTICE.txt, and prints their SHA-256. The result is published as
a release asset of chaconne67/crema and pinned by hash in scripts/build-engine.ps1.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

REPO = "exp-models/dragonkue-KoEn-E5-Tiny"
REVISION = "292c09c78c71a3f00ed56ee0d1ed9f0d39182fc9"
BASE = f"https://huggingface.co/{REPO}/resolve/{REVISION}"

NOTICE = f"""Crema knowledge search model

Source: https://huggingface.co/{REPO} (revision {REVISION})
License: Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
Base models: intfloat/multilingual-e5-small (MIT), dragonkue/multilingual-e5-small-ko
Changes: onnx/model.onnx quantized to int8 weights with onnxruntime.quantization.quantize_dynamic
(QInt8) for x86; tokenizer.json unchanged.
"""


def fetch(name: str, target: Path) -> None:
    with urllib.request.urlopen(f"{BASE}/{name}") as response, open(target, "wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)


def main(out: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    out.mkdir(parents=True, exist_ok=True)
    fp32 = out / "model.fp32.onnx"
    fetch("onnx/model.onnx", fp32)
    fetch("tokenizer.json", out / "tokenizer.json")
    quantize_dynamic(str(fp32), str(out / "model.onnx"), weight_type=QuantType.QInt8)
    fp32.unlink()
    (out / "NOTICE.txt").write_text(NOTICE, encoding="utf-8", newline="\n")
    for name in ("model.onnx", "tokenizer.json", "NOTICE.txt"):
        data = (out / name).read_bytes()
        print(f"{hashlib.sha256(data).hexdigest()}  {name}  {len(data)}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
