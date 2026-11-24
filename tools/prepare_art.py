"""Prepare one coat from a directory of transparent PNGs (see docs/DEVELOPMENT.md)."""
import argparse
import base64
import io
import json
import tempfile
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image, ImageOps

PROTOTYPE = Path(__file__).resolve().parents[1] / "prototype"
COW = {
    "head": "head.png", "ear": "ear-left.png", "body": "body.png",
    "arm-l": "arm-black.png", "arm-r": "arm-white.png",
    "paw-l": "paw-black.png", "paw-r": "paw-white.png",
    **{name: f"v2/{name}.png" for name in ("tail", "back-head", "ear-back", "back-body")},
}
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)


def publish(path, data):
    # The preview server may read these files while an artist regenerates them.
    tmp = tempfile.NamedTemporaryFile(dir=path.parent, delete=False)
    temporary = Path(tmp.name)
    try:
        with tmp:
            tmp.write(data)
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(source):
    with Image.open(source) as raw:
        image = raw.convert("RGBA")
    alpha = image.getchannel("A").point(lambda a: a if a >= 32 else 0)
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError(f"No opaque pixels: {source}")
    image.putalpha(alpha)
    image = ImageOps.expand(image.crop(bbox), border=6, fill=(0, 0, 0, 0))
    image.thumbnail((768, 768), Image.Resampling.LANCZOS)
    return image


def avatar(directory):
    # Keep the existing portrait's self-contained vector face and head pose.
    path = PROTOTYPE / "cats/cow.svg"
    tree = ET.parse(path)
    pose = tree.getroot().find(f"{{{SVG}}}g")
    for child in list(pose):
        if child.tag == f"{{{SVG}}}ellipse":  # first blush mark starts the face
            break
        pose.remove(child)
    for key, width in (("head", 300), ("ear", 110)):
        with Image.open(directory / f"{key}.webp") as image:
            height = width * image.height / image.width
            image.thumbnail((256, 256), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, "WEBP", quality=85, method=6)
        uri = base64.b64encode(buffer.getvalue()).decode("ascii")
        node = ET.Element(f"{{{SVG}}}image", {
            "href": "data:image/webp;base64," + uri, "width": str(width), "height": f"{height:.3f}",
            "x": "278" if key == "ear" else "250",
            "y": "24" if key == "ear" else f"{176-height/2:.3f}",
        })
        pose.insert(0, node)
        if key == "ear":
            node.set("id", "portrait-ear")
            pose.insert(1, ET.Element(f"{{{SVG}}}use", {
                "href": "#portrait-ear", "transform": "translate(800 0) scale(-1 1)",
            }))
    publish(path, ET.tostring(tree.getroot(), encoding="utf-8"))
    print(f"{path.name}: {path.stat().st_size:,} bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cat", default="cow")
    parser.add_argument("--source", type=Path, required=True, help="原图目录（不进仓库，奶牛猫的原图另存在仓库外）")
    args = parser.parse_args()
    if not args.source.is_dir():
        parser.error(f"Missing source directory: {args.source}")
    mapping = COW if args.cat == "cow" else {name: f"{name}.png" for name in COW}
    output = PROTOTYPE / "art" / args.cat
    output.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for name, filename in mapping.items():
        source = args.source / filename
        if not source.is_file():
            print(f"{name}: missing ({filename}), using vector")
            continue
        image = prepare(source)
        path = output / f"{name}.webp"
        encoded = io.BytesIO()
        image.save(encoded, "WEBP", quality=90, method=6)
        publish(path, encoded.getvalue())
        sizes[name] = image.size
        print(f"{path.name}: {image.width}x{image.height}, {path.stat().st_size:,} bytes")
    manifest = output / "manifest.js"
    registration = f"SillyArt.register({json.dumps(args.cat)}, {json.dumps(sizes)});\n"
    publish(manifest, registration.encode("utf-8"))
    print(f"{manifest.name}: {manifest.stat().st_size:,} bytes")
    if args.cat == "cow" and {"head", "ear"} <= sizes.keys():
        avatar(output)


if __name__ == "__main__":
    main()
