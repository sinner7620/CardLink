"""Regenerate the CardLink Math fonts from the installed, locked KaTeX 0.16."""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "node_modules/katex16/dist/fonts"
DESTINATION = ROOT / "assets/cardlink-math"


def trim(source: Path) -> None:
    font = TTFont(source, recalcTimestamp=False)
    glyphs = font.getGlyphOrder()
    mapping = font.getBestCmap()
    metrics = font["hmtx"].metrics.copy()

    options = subset.Options()
    options.hinting = False
    options.layout_features = ["*"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    options.name_languages = ["*"]
    options.name_legacy = True
    trimmer = subset.Subsetter(options=options)
    trimmer.populate(glyphs=glyphs)
    trimmer.subset(font)

    for record in font["name"].names:
        if record.nameID in {1, 3, 4, 6, 16}:
            record.string = record.toUnicode().replace("KaTeX", "CardLinkMath")

    assert font.getGlyphOrder() == glyphs, source
    assert font.getBestCmap() == mapping, source
    assert font["hmtx"].metrics == metrics, source
    font.save(DESTINATION / source.name.replace("KaTeX_", "CardLinkMath_"))


if __name__ == "__main__":
    sources = sorted(SOURCE.glob("KaTeX_*.woff2"))
    if not sources:
        raise SystemExit("Install the locked KaTeX dependency before regenerating the fonts.")
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for source in sources:
        trim(source)
