'use client';

import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** A single focus boundary; data and financial actions remain owned by callers. */
export default function DetailDrawer({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  const close=useRef(onClose);
  useEffect(()=>{close.current=onClose;},[onClose]);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();close.current();}
      if(event.key!=='Tab')return;
      const items=[...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')||[])].filter(item=>item.getClientRects().length);
      if(!items.length)return;
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus();};
  },[]);
  return createPortal(<div className="workspace-detail-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={ref} className="workspace-detail-drawer" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" className="btn" aria-label={`Tutup ${title}`} onClick={onClose}>Tutup detail</button></header><div className="workspace-detail-body">{children}</div></div></div>,document.body);
}
