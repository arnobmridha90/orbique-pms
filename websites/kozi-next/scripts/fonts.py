"""Make the two Fraunces files the sites use, from the full variable fonts in @fontsource-variable.

The sites only ever set Fraunces to SOFT 100 and opsz 144, so those axes (and WONK) are pinned
and only weight stays variable, 300 to 700. That makes each file about a third of the size.
Run by hand after updating the font package:  pip install fonttools brotli && python3 scripts/fonts.py
Fraunces is under the SIL Open Font License 1.1 (no reserved font name); see src/assets/fonts/OFL.txt.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = Path(__file__).resolve().parent.parent
src = root / 'node_modules/@fontsource-variable/fraunces/files'
out = root / 'src/assets/fonts'
for style in ('normal', 'italic'):
    font = TTFont(src / f'fraunces-latin-full-{style}.woff2')
    font = instancer.instantiateVariableFont(font, {'opsz': 144, 'SOFT': 100, 'WONK': 1, 'wght': (300, 700)})
    font.flavor = 'woff2'
    font.save(out / f'fraunces-kozi-{style}.woff2')
    print(style, (out / f'fraunces-kozi-{style}.woff2').stat().st_size, 'bytes')
