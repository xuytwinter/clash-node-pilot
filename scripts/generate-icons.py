"""Build application icons from the approved sunglasses-cat master (Pillow)."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'packaging' / 'icons'
master = Image.open(OUT / 'cat-sunglasses.png').convert('RGBA')
if master.size != (1024, 1024):
    raise ValueError('Expected the approved 1024 x 1024 icon master')
master.save(OUT / 'clash-node-pilot.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
master.save(OUT / 'ClashNodePilot.icns', format='ICNS')
master.resize((64, 64), Image.Resampling.LANCZOS).save(ROOT / 'public' / 'favicon.png')
