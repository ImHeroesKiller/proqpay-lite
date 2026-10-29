'use client';
import {isValidElement,useMemo,useState,type ReactNode} from 'react';
import {compareWorkspaceValues,workspacePage,type SortDirection} from '@/lib/workspace-table';

export function workspaceCellText(value:ReactNode):string{
  if(value==null||typeof value==='boolean')return '';
  if(typeof value==='string'||typeof value==='number')return String(value);
  if(Array.isArray(value))return value.map(workspaceCellText).join(' ');
  if(isValidElement<{children?:ReactNode;text?:string;value?:string}>(value))return workspaceCellText(value.props.children??value.props.text??value.props.value);
  return '';
}
function primaryText(value:ReactNode):string{
  if(Array.isArray(value))return value.map(primaryText).find(Boolean)||'';
  if(isValidElement<{children?:ReactNode;text?:string;value?:string}>(value))return primaryText(value.props.children??value.props.text??value.props.value);
  return workspaceCellText(value);
}
export default function WorkspaceTable({headers,rows,numericColumns,sortValues,pageSize=25,paginate=true,query='',emptyTitle='Tidak ada data pada filter ini',label='Tabel workspace',className='',loading=false,error='',onRetry}:{headers:ReactNode[];rows:ReactNode[][];numericColumns?:number[];sortValues?:Array<Array<string|number|null>>;pageSize?:number;paginate?:boolean;query?:string;emptyTitle?:string;label?:string;className?:string;loading?:boolean;error?:string;onRetry?:()=>void}){
  const [sort,setSort]=useState<{column:number;direction:SortDirection}>({column:0,direction:null});
  const [page,setPage]=useState(1);
  const numbers=useMemo(()=>numericColumns||headers.flatMap((header,index)=>/nominal|net \/ thp|amount|limit|nilai|penerima|recipients|terpakai|saldo|total/i.test(workspaceCellText(header))?[index]:[]),[numericColumns,headers]);
  const visible=useMemo(()=>rows.map((cells,index)=>({cells,index})).filter(row=>!query.trim()||row.cells.some(cell=>workspaceCellText(cell).toLowerCase().includes(query.trim().toLowerCase()))).sort((a,b)=>{
    if(!sort.direction)return a.index-b.index;
    const value=(row:{cells:ReactNode[];index:number})=>sortValues?.[row.index]?.[sort.column]??primaryText(row.cells[sort.column]);
    return compareWorkspaceValues(value(a),value(b),numbers.includes(sort.column))*(sort.direction==='desc'?-1:1)||a.index-b.index;
  }),[rows,query,sort,sortValues,numbers]);
  const paging=workspacePage(visible.length,page,pageSize);
  const displayed=paginate?visible.slice((paging.page-1)*pageSize,paging.page*pageSize):visible;
  if(loading)return <p role="status">Memuat {label}…</p>;
  if(error)return <div className="workspace-inline-error" role="alert"><strong>{label} belum dapat dimuat</strong><p>{error}</p>{onRetry?<button type="button" className="btn" onClick={onRetry}>Coba lagi</button>:null}</div>;
  return <div className={`workspace-data-table ${className}`}><div className="ui-table-wrap"><table className="ui-data-table" aria-label={label}><thead><tr>{headers.map((header,index)=>{
    const sortable=!/^(action|aksi|tindakan|next|next action)$/i.test(workspaceCellText(header));
    return <th key={index} scope="col" className={numbers.includes(index)?'is-numeric':undefined} aria-sort={sort.column===index&&sort.direction?(sort.direction==='asc'?'ascending':'descending'):'none'}>{sortable?<button type="button" className="workspace-column-sort" onClick={()=>{setSort(current=>({column:index,direction:current.column===index&&current.direction==='asc'?'desc':'asc'}));setPage(1);}}>{header}<span aria-hidden="true">{sort.column===index&&sort.direction?(sort.direction==='asc'?' ↑':' ↓'):' ↕'}</span></button>:header}</th>;
  })}</tr></thead><tbody>{displayed.map(row=><tr key={row.index}>{row.cells.map((cell,index)=><td key={index} className={numbers.includes(index)?'is-numeric':undefined}>{cell}</td>)}</tr>)}</tbody></table></div>{!visible.length?<p className="workspace-empty" role="status">{emptyTitle}</p>:null}{paginate&&paging.pages>1?<nav className="workspace-table-pagination" aria-label={`Halaman ${label}`}><span>{(paging.page-1)*pageSize+1}–{Math.min(paging.page*pageSize,visible.length)} dari {visible.length}</span><button type="button" className="btn" disabled={paging.page===1} onClick={()=>setPage(paging.page-1)}>Sebelumnya</button><button type="button" className="btn" disabled={paging.page===paging.pages} onClick={()=>setPage(paging.page+1)}>Berikutnya</button></nav>:null}</div>;
}
