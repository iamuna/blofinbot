"""Assemble lab/dashboard/dashboard.html from dash.html + dash.css + ../engine.js + dash.js."""
from pathlib import Path
here = Path(__file__).resolve().parent
engine = (here.parent / 'engine.js').read_text()
assert '</script>' not in engine
page = (here / 'dash.html').read_text().replace('/*STYLE*/', (here / 'dash.css').read_text()).replace('/*ENGINE*/', engine).replace('/*APP*/', (here / 'dash.js').read_text())
(here / 'dashboard.html').write_text(page)
print(len(page), 'bytes')
