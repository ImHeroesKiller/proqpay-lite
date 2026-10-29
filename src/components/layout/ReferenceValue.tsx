'use client';
import {useState} from 'react';
export default function ReferenceValue({value}:{value:string}){const [copied,setCopied]=useState(false);const [failed,setFailed]=useState(false);return <span className="workspace-reference"><span title={value}>{value}</span><button type="button" className="btn btn-quiet" aria-label={`Salin ${value}`} onClick={()=>void navigator.clipboard.writeText(value).then(()=>{setCopied(true);setFailed(false);}).catch(()=>setFailed(true))}>{failed?'Gagal menyalin':copied?'Tersalin':'Salin'}</button></span>;}
