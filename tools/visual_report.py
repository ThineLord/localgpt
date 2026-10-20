"""Build a local-only visual comparison report from explicitly selected captures.

Usage: python tools/visual_report.py output/playwright/round2/manifest.json
Requires Pillow. The manifest and all screenshots must stay outside Git.
This compares pixels without interpreting a difference score as UX acceptance.
"""
import argparse
import html
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageStat


def build(manifest):
    root = manifest.parent.resolve()
    data = json.loads(manifest.read_text())
    cards = []
    receipts = []
    for index, state in enumerate(data["states"]):
        images = {}
        for key in ("reference", "before", "after"):
            if state.get(key):
                path = (root / state[key]).resolve()
                if not path.is_relative_to(root):
                    raise ValueError("Capture must stay inside the report directory")
                images[key] = Image.open(path).convert("RGB")
        derived = {}
        if "reference" in images and "after" in images:
            reference, after = images["reference"], images["after"]
            if reference.size != after.size:
                raise ValueError(f"{state['name']}: viewport mismatch; no silent scaling")
            overlay = Image.blend(reference, after, .5)
            delta = ImageChops.difference(reference, after)
            overlay_name = f"overlay-{index}.png"
            difference_name = f"difference-{index}.png"
            overlay.save(root / overlay_name)
            ImageEnhance.Contrast(delta).enhance(3).save(root / difference_name)
            derived = {"overlay": overlay_name, "difference": difference_name}
            receipts.append({
                "name": state["name"], "size": reference.size,
                "mean_absolute_rgb_difference": sum(ImageStat.Stat(delta).mean) / 3,
                "interpretation": "Descriptive pixels only; content, font rasterization and browser differ.",
            })
        figures = []
        for key, title in (("reference", "真实参考"), ("before", "修改前"),
                           ("after", "修改后"), ("overlay", "50% 叠图"),
                           ("difference", "差异（增强对比）")):
            path = state.get(key) or derived.get(key)
            if path:
                safe = html.escape(path, quote=True)
                figures.append(f'<figure><a href="{safe}"><img loading="lazy" src="{safe}"></a>'
                               f'<figcaption>{title}</figcaption></figure>')
        issues = "".join(f"<li>{html.escape(item)}</li>" for item in state.get("issues", []))
        cards.append(f'<section><h2>{html.escape(state["name"])}</h2>'
                     f'<p>{html.escape(state.get("conditions", ""))}</p>'
                     f'<div class="captures">{"".join(figures)}</div><ul>{issues}</ul></section>')
    document = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HanzAgent 第二轮视觉验收</title>
<style>
*{box-sizing:border-box}body{margin:0 auto;max-width:1600px;padding:40px 24px;background:#f7f7f7;color:#181818;font:15px/1.6 -apple-system,BlinkMacSystemFont,sans-serif}
h1{font-size:28px;font-weight:600}h2{font-size:20px;font-weight:600}p{color:#555}
section{margin:28px 0;padding:24px;background:white;border:1px solid #e4e4e4;border-radius:16px}
.captures{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
figure{margin:0}img{width:100%;height:auto;border:1px solid #ddd;border-radius:8px}
figcaption{padding:6px 0;color:#555}li{margin:6px 0}
</style><h1>HanzAgent 第二轮视觉验收</h1>"""
    document += "<p>" + html.escape(data.get("summary", "")) + "</p>"
    document += "".join(cards) + "</html>"
    (root / "report.html").write_text(document)
    (root / "pixel-metrics.json").write_text(json.dumps(receipts, indent=2))
    print(f"Built {len(cards)} states: {root / 'report.html'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    build(parser.parse_args().manifest)
