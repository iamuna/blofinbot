"""Assemble lab/dashboard/v2/dashboard.html from dash.html + dash.css + dash.js."""
from pathlib import Path
here = Path(__file__).resolve().parent
page = (here / 'dash.html').read_text().replace('/*STYLE*/', (here / 'dash.css').read_text()).replace('/*APP*/', (here / 'dash.js').read_text())
(here / 'dashboard.html').write_text(page)
print(len(page), 'bytes')
