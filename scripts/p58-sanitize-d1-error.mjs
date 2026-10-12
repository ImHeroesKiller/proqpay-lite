#!/usr/bin/env node
import {readFileSync} from 'node:fs';
const text=process.argv.slice(2).map(path=>{try{return readFileSync(path,'utf8');}catch{return '';}}).join('\n');
const errorCodes=[...new Set(text.match(/(?:SQLITE_[A-Z_]+|D1_ERROR|D1_[A-Z_]+|code\s*[:=]\s*[0-9]{3,5}|[Ee]rror\s+[0-9]{3,5}|near\s+[^\s:;]{1,30})/g)||[])].slice(0,6);
const classes=['no such table','no such column','syntax error','near','unauthorized','permission','internal error','database not found','timed out','request failed','too many','too long','no such','no such function','compound','ambiguous','misuse','incomplete input','malformed','unrecognized token','unsupported','invalid column','cannot prepare','SELECT','statement'].filter(v=>text.toLowerCase().includes(v));
// The SQL source holds no customer values. Only the short provider DB parser reason,
// never the supplied SQL, customer rows, credentials or Cloudflare request URL.
const raw=(text.match(/SQLITE_ERROR[^\n\r]{0,130}/)||[])[0]||'';
const reason=raw.split(/\\n|\\r/)[0].replace(/\\".*?\\"/g,'[identifier]').slice(0,125);
console.error(JSON.stringify({kind:'P58_READ_ONLY_D1_QUERY_FAILURE',errorCodes,classes,reason,stderrLength:text.length,warning:'Raw provider/database content suppressed; never dump D1 results or tokens.'}));
