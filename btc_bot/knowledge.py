from __future__ import annotations
import json
from pathlib import Path
from .learning import record_knowledge

def ingest_jsonl(db_path,path,source=None):
    """Import vetted knowledge records without executing or trusting arbitrary code.

    Each JSONL row: {kind, statement, conditions?, evidence?, contradictions?}.
    Provenance is mandatory through source/path and confidence grows only with evidence.
    """
    path=Path(path);count=0;source=source or f'file:{path.name}'
    for raw in path.read_text(encoding='utf-8').splitlines():
        if not raw.strip():continue
        x=json.loads(raw);statement=str(x.get('statement','')).strip();kind=str(x.get('kind','research_note')).strip()
        if not statement:continue
        record_knowledge(db_path,kind,statement,x.get('conditions') or {},source,int(x.get('evidence',1)),int(x.get('contradictions',0)));count+=1
    return {'imported':count,'source':source}
