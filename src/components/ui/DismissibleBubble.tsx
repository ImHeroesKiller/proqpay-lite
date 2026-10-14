'use client';

import {useState,type ReactNode} from 'react';

export default function DismissibleBubble({children,className='',role='status'}:{
  children:ReactNode;
  className?:string;
  role?:'alert'|'status'|'note';
}){
  const [hidden,setHidden]=useState(false);
  if(hidden)return null;
  return <div className={className} role={role}>
    <div style={{flex:'1 1 auto',minWidth:0}}>{children}</div>
    <button type="button" aria-label="Tutup notifikasi" title="Tutup" className="ui-notice-close"
      onClick={()=>setHidden(true)}
      style={{marginLeft:'auto',alignSelf:'flex-start',flex:'0 0 auto',fontSize:20,lineHeight:1.1,padding:'4px 8px',cursor:'pointer'}}>×</button>
  </div>;
}
