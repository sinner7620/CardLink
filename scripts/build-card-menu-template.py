"""Add CardLink menu commands to a copy of a user-supplied scene template."""
import argparse
import json
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("template")
parser.add_argument("addon")
parser.add_argument("output")
args = parser.parse_args()

with zipfile.ZipFile(args.template) as template_zip, zipfile.ZipFile(args.addon) as addon_zip:
    template = json.loads(template_zip.read("template.json"))
    manifest = json.loads(template_zip.read("manifest.json"))
    addon = json.loads(addon_zip.read("mnaddon.json"))
    addon_id = addon["addonid"]
    template["id"] = template["id"] + "-cardlink"
    template["name"] = "刷题 · 卡片 + CardLink"
    plugins = template.setdefault("plugins", [])
    if addon_id not in plugins:
        plugins.append(addon_id)
    configs = template.setdefault("pluginConfigs", {})
    configs.setdefault(addon_id, {"v": 1, "tagPrefix": "cardlink-practice", "reasons": [
        {"key": "careless", "label": "粗心"}, {"key": "arithmetic", "label": "算错"},
        {"key": "concept", "label": "概念不懂"}, {"key": "misread", "label": "读错题"}
    ]})
    menus = template.setdefault("selectionMenu", {})
    for kind in ("cards", "documents"):
        items = menus.setdefault(kind, [])
        for command in ("findAnswer", "markMistake"):
            action = f"addon.{addon_id}.{command}:"
            if action not in items:
                items.append(action)
    manifest["template"] = {"id": template["id"], "name": template["name"]}
    manifest["plugins"] = [p for p in manifest.get("plugins", []) if p.get("pluginID") != addon_id]
    manifest["plugins"].append({"pluginID": addon_id, "folder": addon_id, "title": addon["title"], "version": addon["version"]})
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as output:
        for entry in template_zip.infolist():
            if entry.filename not in ("template.json", "manifest.json") and not entry.filename.startswith(f"plugins/{addon_id}/"):
                output.writestr(entry.filename, template_zip.read(entry))
        for name, obj in (("template.json", template), ("manifest.json", manifest)):
            output.writestr(name, json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8"))
        for entry in addon_zip.infolist():
            if not entry.is_dir():
                output.writestr(f"plugins/{addon_id}/{entry.filename}", addon_zip.read(entry))
print(args.output)
