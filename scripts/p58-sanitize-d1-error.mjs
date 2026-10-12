#!/usr/bin/env node
import {readFileSync} from 'node:fs';
const text=process.argv.slice(2).map(path=>{try{return readFileSync(path,'utf8');}catch{return '';}}).join('\n');
const errorCodes=[...new Set(text.match(/(?:SQLITE_[A-Z_]+|D1_ERROR|D1_[A-Z_]+|code\s*[:=]\s*[0-9]{3,5}|[Ee]rror\s+[0-9]{3,5}|near\s+[^\s:;]{1,30})/g)||[])].slice(0,6);
const classes=['no such table','no such column','syntax error','near','unauthorized','permission','internal error','database not found','timed out','request failed'].filter(v=>text.toLowerCase().includes(v));
console.error(JSON.stringify({kind:'P58_READ_ONLY_D1_QUERY_FAILURE',errorCodes,classes,stderrLength:text.length,warning:'Raw provider/database content suppressed; never dump D1 results or tokens.'}));
