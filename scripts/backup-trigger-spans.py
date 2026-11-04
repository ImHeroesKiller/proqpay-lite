"""Return complete trigger statement spans using SQLite's own SQL parser."""

import json
import sqlite3
import sys

source = sys.stdin.read()
start = 0
offset = 0
buffer = ''
spans = []
for line in source.splitlines(keepends=True):
    buffer += line
    offset += len(line.encode('utf-16-le')) // 2
    if sqlite3.complete_statement(buffer):
        if 'CREATE TRIGGER' in buffer.upper():
            spans.append([start, offset])
        buffer = ''
        start = offset

print(json.dumps(spans))
