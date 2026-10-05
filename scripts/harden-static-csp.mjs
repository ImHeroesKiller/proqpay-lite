import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function walk(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory()) out.push(...await walk(path));
    else if(entry.isFile() && entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

function cspHash(value){
  return "'sha256-"+createHash('sha256').update(value,'utf8').digest('base64')+"'";
}

export function collectInlineHashes(html){
  const scripts=new Set();
  const styles=new Set();
  for(const match of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)){
    if(match[1]) scripts.add(cspHash(match[1]));
  }
  for(const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)){
    if(match[1]) styles.add(cspHash(match[1]));
  }
  return {scripts,styles};
}

export async function hardenStaticCsp(outDir){
  const files=await walk(outDir);
  const scriptHashes=new Set();
  const styleHashes=new Set();
  for(const file of files){
    const html=await readFile(file,'utf8');
    const found=collectInlineHashes(html);
    for(const hash of found.scripts) scriptHashes.add(hash);
    for(const hash of found.styles) styleHashes.add(hash);
  }

  const headersPath=join(outDir,'_headers');
  let headers=await readFile(headersPath,'utf8');
  const scriptDirective="script-src 'self' 'unsafe-inline'";
  const scriptElemDirective="script-src-elem 'self' 'unsafe-inline'";
  const styleDirective="style-src 'self' 'unsafe-inline'";
  if(!headers.includes(scriptDirective) || !headers.includes(scriptElemDirective) || !headers.includes(styleDirective)){
    throw new Error('Expected CSP bootstrap directives were not found in out/_headers');
  }

  const hardenedScript=["'self'",...scriptHashes].join(' ');
  headers=headers
    .replace(scriptDirective,["script-src",hardenedScript].join(' '))
    .replace(scriptElemDirective,["script-src-elem",hardenedScript].join(' '))
    .replace(styleDirective,["style-src 'self'",...styleHashes].join(' '));

  const cspLine=headers.split('\n').find((line)=>line.includes('Content-Security-Policy:'))||'';
  if(/(?:^|;\s*)script-src(?:-elem)?\s[^;]*'unsafe-inline'/.test(cspLine) || /(?:^|;\s*)style-src\s[^;]*'unsafe-inline'/.test(cspLine)){
    throw new Error('Unsafe inline remains in script-src/script-src-elem/style-src after CSP hardening');
  }
  if(Buffer.byteLength(cspLine,'utf8')>24000){
    throw new Error('Generated CSP exceeds safe header budget');
  }
  await writeFile(headersPath,headers,'utf8');
  console.log(JSON.stringify({ok:true,htmlFiles:files.length,scriptHashes:scriptHashes.size,styleHashes:styleHashes.size,cspBytes:Buffer.byteLength(cspLine,'utf8')}));
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  await hardenStaticCsp(process.argv[2]||'out');
}
