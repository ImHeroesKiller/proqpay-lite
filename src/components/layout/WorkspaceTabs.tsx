'use client';
import type {ReactNode} from 'react';
export default function WorkspaceTabs({items,value,onChange,label,panelId}:{items:Array<{value:string;label:ReactNode}>;value:string;onChange:(value:string)=>void;label:string;panelId:string}){
  return <nav className="workspace-content-tabs" role="tablist" aria-label={label}>{items.map((item,index)=><button key={item.value} type="button" id={`${panelId}-${item.value}`} role="tab" aria-selected={value===item.value} aria-controls={panelId} tabIndex={value===item.value?0:-1} onClick={()=>onChange(item.value)} onKeyDown={event=>{
    const next=event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:-1;
    if(next<0)return;event.preventDefault();onChange(items[next].value);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }}>{item.label}</button>)}</nav>;
}
