"""用场景的矢量部件、花纹和配色生成线条头像。需要 Python 3 和 Node.js。"""

import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


PROTOTYPE = Path(__file__).resolve().parents[1] / "prototype"

# 用最小的 DOM 替身执行 coats.js，读取实际用到的花纹与体型数据。
READ_COATS = """
const fs = require('node:fs');
const vm = require('node:vm');
const defs = [];
const node = { insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {}, style: {} };
const context = {
  window: {},
  SillyArt: { apply() {} },
  document: {
    documentElement: { dataset: {} },
    getElementById: () => node,
    querySelector: () => ({ insertAdjacentHTML: (_, markup) => defs.push(markup) }),
    querySelectorAll: () => [],
  },
};
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), context);
const coats = context.window.SillyCoats;
const portraits = coats.list().map(({ id }) => {
  const { shape, head, eye } = coats.setArtStyle('line', id);
  return { id, shape, head, eyes: eye && [eye(345), eye(455)] };
});
console.log(JSON.stringify({ defs, portraits }));
"""


def by_id(tree, node_id):
    node = tree.find(f".//*[@id='{node_id}']")
    if node is None:
        raise ValueError(f"场景缺少 #{node_id}")
    return node


def avatar(scene, styles, patterns, portrait):
    cat = portrait["id"]
    shape = portrait.get("shape", {})
    head = by_id(scene, "cat-head")
    root = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg",
                              "viewBox": "244 12 312 284", "data-cat": cat,
                              "data-art-style": "line"})
    ET.SubElement(root, "style").text = styles
    defs = ET.SubElement(root, "defs")
    for clip in ("clip-head", "clip-eye-l", "clip-eye-r"):
        defs.append(by_id(scene, clip))
    defs.extend(ET.fromstring(markup) for markup in patterns)

    head_scale = shape.get("headSX", 1)
    pose = ET.SubElement(root, "g", {"id": "scene", "transform":
                         f"rotate(-4 400 262) translate(400 262) scale({head_scale} 1) translate(-400 -262)"})
    for side, pivot in (("l", 322), ("r", 478)):
        ear = by_id(head, f"ear-{side}")
        ear_scale = shape.get("ear", 1)
        if ear_scale != 1:
            ear[0].set("transform", f"translate({pivot} 110) scale({ear_scale}) translate({-pivot} -110)")
        pose.append(ear)
    pose.append(by_id(head, "head-fill"))
    markings = by_id(head, "coat-head-patterns")
    if "head" in portrait:
        markings.extend(ET.fromstring(f"<g>{portrait['head']}</g>"))
    pose.append(markings)
    pose.append(by_id(head, "head-line"))

    eyes = dict(zip(("eye-l-open", "eye-r-open"), portrait.get("eyes", [])))
    for child in head:
        node_id = child.get("id")
        if node_id in ("eye-l-open", "eye-r-open"):
            if node_id in eyes:
                child.insert(0, ET.fromstring(eyes[node_id]))
            pose.append(child)
        elif child.get("class") in ("blush", "coat-cow-marking", "whisker", "fang",
                                    "ink-thin coat-mouth-line", "ink-thin coat-nose"):
            pose.append(child)
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8") + b"\n"


def main():
    data = json.loads(subprocess.check_output(
        ["node", "-e", READ_COATS, str(PROTOTYPE / "coats.js")], text=True))
    page = (PROTOTYPE / "index.html").read_text(encoding="utf-8")
    start = page.index('<svg id="scene"')
    scene_markup = page[start:page.index("</svg>", start) + len("</svg>")]
    css = (PROTOTYPE / "style.css").read_text(encoding="utf-8")
    styles = "\n".join(css.split(f"/* portrait-{block}:start */")[1]
                       .split(f"/* portrait-{block}:end */")[0].replace("html", "svg")
                       for block in ("palette", "face"))
    directory = PROTOTYPE / "cats" / "line"
    directory.mkdir(parents=True, exist_ok=True)
    for portrait in data["portraits"]:
        path = directory / f"{portrait['id']}.svg"
        path.write_bytes(avatar(ET.fromstring(scene_markup), styles, data["defs"], portrait))
        print(path.relative_to(PROTOTYPE))


if __name__ == "__main__":
    main()
