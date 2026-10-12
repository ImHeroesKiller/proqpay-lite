import type { CSSProperties, ReactNode } from 'react';

/** G3: the app shell uses one bounded frame independent of user role/view. */
export function WorkspaceFrame({children}:{children:ReactNode}) {
  return <div className="app-view-transition" style={{maxWidth:1180,margin:'0 auto'}}>{children}</div>;
}

/** Unstyled semantic heading body. Parents retain their existing layout CSS. */
export function WorkspaceTitle({
  title, description, eyebrow, level='h1', eyebrowClassName='page-eyebrow',
  titleStyle, descriptionStyle, className,
}: {
  title:ReactNode;description?:ReactNode;eyebrow?:ReactNode;
  level?:'h1'|'h2'|'h3';eyebrowClassName?:string;
  titleStyle?:CSSProperties;descriptionStyle?:CSSProperties;className?:string;
}) {
  const Heading=level;
  return <div className={className}>
    {eyebrow?<span className={eyebrowClassName}>{eyebrow}</span>:null}
    <Heading style={titleStyle}>{title}</Heading>
    {description?<p style={descriptionStyle}>{description}</p>:null}
  </div>;
}

/** Flat filter container. This does NOT imply a card or alter field size. */
export function CompactFilterSurface({children,className='',label}:{
  children:ReactNode;className?:string;label:string;
}) {
  return <div className={className} role="search" aria-label={label}>
    <div className="ui-filter-grid">{children}</div>
  </div>;
}

/** Flat KPI strip used by master data; never wraps values in MetricCard. */
export function InlineSummary({items,className,label,variant='strip'}:{
  items:ReadonlyArray<{value:ReactNode;label:ReactNode;note?:ReactNode}>;
  className:string;label:string;variant?:'strip'|'decision';
}) {
  return <div className={className} aria-label={label}>
    {items.map((item,index)=>variant==='decision'
      ? <div key={index}><span>{item.label}</span><strong>{item.value}</strong>{item.note?<small>{item.note}</small>:null}</div>
      : <span key={index}><strong>{item.value}</strong> {item.label}</span>)}
  </div>;
}
