/** Presentation-only ordering; never changes transaction values or status. */
export type SortDirection='asc'|'desc'|null;
export function compareWorkspaceValues(a:string|number|null,b:string|number|null,numeric=false):number{
  if(a==null&&b==null)return 0;
  if(a==null)return 1;
  if(b==null)return -1;
  if(numeric){
    const number=(value:string|number)=>typeof value==='number'?value:Number(value.replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'));
    const left=number(a),right=number(b);
    if(Number.isFinite(left)&&Number.isFinite(right))return left-right;
  }
  const date=(value:string|number)=>{const parts=String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);return parts?Date.UTC(Number(parts[3]),Number(parts[2])-1,Number(parts[1])):null;};
  const leftDate=date(a),rightDate=date(b);if(leftDate!=null&&rightDate!=null)return leftDate-rightDate;
  return String(a).localeCompare(String(b),'id',{numeric:true,sensitivity:'base'});
}
export function workspacePage(total:number,page:number,pageSize:number){
  const pages=Math.max(1,Math.ceil(total/pageSize));
  return {page:Math.max(1,Math.min(page,pages)),pages};
}
