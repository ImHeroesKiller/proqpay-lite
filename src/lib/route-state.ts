/**
 * G2: one browser URL mutation + event contract for the ProQPay workspace.
 * Never changes the permitted business view or payment role; caller resolves
 * allowed views in workspace-navigation before issuing a route update.
 */
export const ROUTE_CHANGE_EVENT='proqpay:route-change';
export type RouteUpdateMode='push'|'replace';
export type RoutePatch=Record<string,string|null|undefined>;
export const ROUTE_FILTER_KEYS=['clientId','projectId','q'] as const;

export function routeParams():URLSearchParams {
  return typeof window==='undefined'?new URLSearchParams():new URLSearchParams(window.location.search);
}
export function routeValue(key:string):string|null{return routeParams().get(key);}

/** Preserves unknown query values and URL fragments; null removes one key. */
export function patchRoute(patch:RoutePatch,mode:RouteUpdateMode='replace',state?:unknown):boolean {
  if(typeof window==='undefined')return false;
  const url=new URL(window.location.href);
  for(const [key,value] of Object.entries(patch)){
    if(value==null||value==='')url.searchParams.delete(key);
    else url.searchParams.set(key,value);
  }
  if(url.href===window.location.href)return false;
  const historyState=state===undefined?window.history.state:state;
  if(mode==='push')window.history.pushState(historyState,'',url);
  else window.history.replaceState(historyState,'',url);
  window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT,{detail:{mode,params:url.searchParams.toString()}}));
  return true;
}

export function subscribeRoute(listener:()=>void):()=>void {
  if(typeof window==='undefined')return ()=>{};
  window.addEventListener('popstate',listener);
  window.addEventListener(ROUTE_CHANGE_EVENT,listener);
  return ()=>{
    window.removeEventListener('popstate',listener);
    window.removeEventListener(ROUTE_CHANGE_EVENT,listener);
  };
}

/** Scoped client/project filters are shared across PAYROLL, PAYMENT and CLOSE. */
export function workspaceRouteFilters():{clientId:string;projectId:string;query:string}{
  const params=routeParams();
  return{clientId:params.get('clientId')||'ALL',projectId:params.get('projectId')||'ALL',query:params.get('q')||''};
}
export function patchWorkspaceFilters(
  current:{clientId:string;projectId:string;query:string},
  change:Partial<{clientId:string;projectId:string;query:string}>,
):{clientId:string;projectId:string;query:string}{
  const next={...current,...change};
  if(change.clientId && change.clientId!==current.clientId)next.projectId='ALL';
  patchRoute({
    clientId:next.clientId==='ALL'?null:next.clientId,
    projectId:next.projectId==='ALL'?null:next.projectId,
    q:next.query.trim()||null,
  });
  return next;
}
