export const MSG_INVOICE_BRAND = Object.freeze({
  legalName:'PT Mandiri Semesta Gemilang',
  shortName:'MSG',
  address:'Graha MSG, Jl. Raya Pos Pengumben Raya No.Kav 188, Klp. Dua, Kec. Kb. Jeruk, Kota Jakarta Barat, Daerah Khusus Ibukota Jakarta 11550',
  email:'rizal@msg-os.com',
  phone:'+62 856-9766-6101',
  website:'www.msg-os.com',
  tagline:'People. Operations. Technology.',
  productName:'ProQPay Lite',
  productDescriptor:'AI Payroll OS',
});

const C={
  navy:[0.02,0.14,0.38],
  blue:[0.04,0.29,0.72],
  orange:[1.00,0.35,0.04],
  ink:[0.06,0.09,0.16],
  muted:[0.39,0.45,0.55],
  border:[0.83,0.86,0.90],
  soft:[0.96,0.97,0.99],
  white:[1,1,1],
};

function ascii(value='') {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function pdfEscape(value='') {
  return ascii(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function money(value) {
  return 'Rp ' + Math.round(Number(value || 0)).toLocaleString('id-ID');
}
function shortDate(value) {
  if (!value) return '-';
  const date=new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0,10);
  return date.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
}
function wrap(value,max=52) {
  const words=ascii(value).split(' ').filter(Boolean), lines=[]; let line='';
  for (const word of words) {
    const candidate=line ? line+' '+word : word;
    if (candidate.length>max && line) { lines.push(line); line=word; }
    else line=candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}
function color(rgb){return rgb.join(' ');}
function textCmd(text,x,y,size=10,font='F1',rgb=C.ink) {
  return `BT ${color(rgb)} rg /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET\n`;
}
function lineCmd(x1,y1,x2,y2,width=.7,rgb=C.border) {
  return `q ${color(rgb)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q\n`;
}
function rectCmd(x,y,w,h,fill=C.soft,stroke=C.border,width=.6) {
  return `q ${color(fill)} rg ${x} ${y} ${w} ${h} re f Q\nq ${color(stroke)} RG ${width} w ${x} ${y} ${w} ${h} re S Q\n`;
}
function fillRect(x,y,w,h,fill){
  return `q ${color(fill)} rg ${x} ${y} ${w} ${h} re f Q\n`;
}
function rowText(lines,x,y,size=9,lineHeight=12,font='F1',rgb=C.ink) {
  return lines.map((line,index)=>textCmd(line,x,y-(index*lineHeight),size,font,rgb)).join('');
}
function roundedRectPath(x,y,w,h,r){
  const k=.5522847498;
  return [
    `${x+r} ${y} m`,`${x+w-r} ${y} l`,
    `${x+w-r+r*k} ${y} ${x+w} ${y+r-r*k} ${x+w} ${y+r} c`,
    `${x+w} ${y+h-r} l`,
    `${x+w} ${y+h-r+r*k} ${x+w-r+r*k} ${y+h} ${x+w-r} ${y+h} c`,
    `${x+r} ${y+h} l`,
    `${x+r-r*k} ${y+h} ${x} ${y+h-r+r*k} ${x} ${y+h-r} c`,
    `${x} ${y+r} l`,
    `${x} ${y+r-r*k} ${x+r-r*k} ${y} ${x+r} ${y} c h`,
  ].join(' ');
}
function fillRoundedRect(x,y,w,h,r,fill){
  return `q ${color(fill)} rg ${roundedRectPath(x,y,w,h,r)} f Q\n`;
}
function strokePath(path,width,rgb){
  return `q ${color(rgb)} RG ${width} w 1 J 1 j ${path} S Q\n`;
}
function proqpayLogoCmd(x,y,scale=1){
  const box=38*scale;
  let c=fillRoundedRect(x,y,box,box,7*scale,C.navy);
  c += strokePath(`${x+9*scale} ${y+19*scale} m ${x+15*scale} ${y+12*scale} l ${x+29*scale} ${y+27*scale} l`,3.2*scale,C.white);
  c += strokePath(`${x+27*scale} ${y+27*scale} m ${x+31*scale} ${y+31*scale} l ${x+29*scale} ${y+25*scale} l`,2.4*scale,C.orange);
  const tx=x+48*scale;
  c += textCmd('Pro',tx,y+21*scale,17*scale,'F2',C.navy);
  c += textCmd('Q',tx+27*scale,y+21*scale,17*scale,'F2',C.orange);
  c += textCmd('Pay',tx+40*scale,y+21*scale,17*scale,'F2',C.navy);
  c += textCmd('Lite',tx+74*scale,y+21*scale,11*scale,'F2',C.orange);
  c += textCmd(MSG_INVOICE_BRAND.productDescriptor,tx,y+7*scale,7.2*scale,'F2',C.muted);
  return c;
}
function buildPdf(content) {
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf='%PDF-1.4\n';
  const offsets=[0];
  objects.forEach((object,index)=>{
    offsets.push(pdf.length);
    pdf += `${index+1} 0 obj\n${object}\nendobj\n`;
  });
  const xref=pdf.length;
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i++) pdf += String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function canonicalIssuer(issuer={}) {
  return {
    legalName:MSG_INVOICE_BRAND.legalName,
    address:MSG_INVOICE_BRAND.address,
    email:MSG_INVOICE_BRAND.email,
    phone:MSG_INVOICE_BRAND.phone,
    website:MSG_INVOICE_BRAND.website,
    npwp:String(issuer?.npwp||''),
    bankName:String(issuer?.bankName||issuer?.bank_name||''),
    bankAccountName:String(issuer?.bankAccountName||issuer?.bank_account_name||MSG_INVOICE_BRAND.legalName),
    bankAccountNo:String(issuer?.bankAccountNo||issuer?.bank_account_no||''),
    paymentNotes:String(issuer?.paymentNotes||issuer?.payment_notes||''),
  };
}

export function buildInvoiceDocumentSnapshot({invoice,client,project,issuer}) {
  const items=Array.isArray(invoice.items) ? invoice.items : (()=>{try{return JSON.parse(invoice.items||'[]');}catch{return [];}})();
  const issuerData=canonicalIssuer(issuer);
  return {
    version:2,
    template:'MSG_PROQPAY_A4_V2',
    invoiceId:String(invoice.id),
    invoiceNumber:String(invoice.invoice_number||invoice.id),
    issueDate:String(invoice.issued_at||invoice.created_at||new Date().toISOString()),
    dueDate:String(invoice.due_date||''),
    period:String(invoice.period||''),
    currency:'IDR',
    issuer:issuerData,
    client:{
      name:String(client?.name||invoice.company||''),
      address:String(client?.billing_address||''),
      npwp:String(client?.npwp||''),
      nitku:String(client?.nitku||''),
      billingEmail:String(client?.billing_email||''),
      billingCcEmail:String(client?.billing_cc_email||''),
      purchaseOrder:String(client?.purchase_order||''),
    },
    project:{
      name:String(project?.name||''),
      code:String(project?.code||''),
    },
    tax:{
      status:String(client?.tax_status||invoice.tax_status||'NON_PKP'),
      rate:Number(invoice.tax_rate||0),
      taxInvoiceNumber:String(invoice.tax_invoice_number||''),
      taxInvoiceDate:String(invoice.tax_invoice_date||''),
    },
    items:items.map((item)=>({
      description:String(item.description||'Payroll Services'),
      quantity:Number(item.quantity||1),
      rate:Number(item.rate||0),
      amount:Number(item.amount||0),
    })),
    subtotal:Number(invoice.subtotal||0),
    taxAmount:Number(invoice.tax_amount||0),
    totalAmount:Number(invoice.total_amount||0),
  };
}

export function generateInvoicePdf(snapshot) {
  const issuer=canonicalIssuer(snapshot?.issuer||{});
  let c='';

  // Header brand shell.
  c += proqpayLogoCmd(38,774,.90);
  c += textCmd(MSG_INVOICE_BRAND.legalName,38,756,10.5,'F2',C.navy);
  c += textCmd(MSG_INVOICE_BRAND.tagline,38,743,7.5,'F1',C.muted);
  c += textCmd('INVOICE',458,790,24,'F2',C.navy);
  c += textCmd(snapshot.invoiceNumber,420,771,9.5,'F2',C.ink);
  c += fillRect(36,727,523,3,C.navy);
  c += fillRect(36,724,86,3,C.orange);

  // Issuer and customer identity.
  c += textCmd('ISSUED BY',36,704,7.5,'F2',C.orange);
  c += textCmd(issuer.legalName,36,687,10.5,'F2',C.ink);
  c += rowText(wrap(issuer.address,58).slice(0,3),36,673,8.2,10.5,'F1',C.muted);
  let iy=641;
  if(issuer.npwp){c += textCmd('NPWP  '+issuer.npwp,36,iy,8,'F1',C.ink);iy-=11;}
  c += textCmd(issuer.email+'  |  '+issuer.phone,36,iy,7.8,'F1',C.muted);
  c += textCmd(issuer.website,36,iy-11,7.8,'F1',C.muted);

  c += textCmd('BILL TO',318,704,7.5,'F2',C.orange);
  c += textCmd(snapshot.client.name||'-',318,687,10.5,'F2',C.ink);
  c += rowText(wrap(snapshot.client.address||'-',41).slice(0,3),318,673,8.2,10.5,'F1',C.muted);
  let cy=641;
  if(snapshot.client.npwp){c += textCmd('NPWP  '+snapshot.client.npwp,318,cy,8,'F1',C.ink);cy-=11;}
  if(snapshot.client.nitku){c += textCmd('NITKU  '+snapshot.client.nitku,318,cy,8,'F1',C.muted);}

  // Invoice metadata band.
  c += rectCmd(36,575,523,52,C.soft,C.border,.5);
  const meta=[
    ['INVOICE DATE',shortDate(snapshot.issueDate)],
    ['DUE DATE',shortDate(snapshot.dueDate)],
    ['PERIOD',snapshot.period||'-'],
    ['PROJECT',snapshot.project.name||'-'],
  ];
  meta.forEach(([label,value],index)=>{
    const x=49+(index*128);
    c += textCmd(label,x,609,6.8,'F2',C.muted);
    c += textCmd(String(value).slice(0,index===3?24:20),x,590,8.3,'F2',C.ink);
    if(index<3) c += lineCmd(x+111,585,x+111,616,.5,C.border);
  });
  if(snapshot.client.purchaseOrder){
    c += textCmd('PO / CONTRACT  '+snapshot.client.purchaseOrder,49,565,7.5,'F1',C.muted);
  }

  // Line items.
  const tableTop=530;
  c += fillRect(36,tableTop,523,26,C.navy);
  c += textCmd('NO',46,tableTop+9,7.5,'F2',C.white);
  c += textCmd('DESCRIPTION',76,tableTop+9,7.5,'F2',C.white);
  c += textCmd('QTY',350,tableTop+9,7.5,'F2',C.white);
  c += textCmd('UNIT PRICE',393,tableTop+9,7.5,'F2',C.white);
  c += textCmd('AMOUNT',499,tableTop+9,7.5,'F2',C.white);
  let y=tableTop-24;
  const rows=snapshot.items.length?snapshot.items:[{description:'Payroll Services',quantity:1,rate:snapshot.subtotal,amount:snapshot.subtotal}];
  rows.slice(0,8).forEach((item,index)=>{
    c += textCmd(String(index+1),48,y,8,'F1',C.muted);
    const lines=wrap(item.description,43).slice(0,2);
    c += rowText(lines,76,y,8.4,10,'F1',C.ink);
    c += textCmd(String(item.quantity),353,y,8.2,'F1',C.ink);
    c += textCmd(money(item.rate),389,y,8.2,'F1',C.ink);
    c += textCmd(money(item.amount),482,y,8.2,'F2',C.ink);
    const rowHeight=Math.max(26,lines.length*10+9);
    c += lineCmd(36,y-rowHeight+7,559,y-rowHeight+7,.35,C.border);
    y-=rowHeight;
  });

  const totalsY=Math.max(284,y-4);
  c += textCmd('Subtotal',390,totalsY,8.5,'F1',C.muted);
  c += textCmd(money(snapshot.subtotal),477,totalsY,8.8,'F2',C.ink);
  c += textCmd(`PPN ${Number(snapshot.tax.rate||0)}%`,390,totalsY-18,8.5,'F1',C.muted);
  c += textCmd(money(snapshot.taxAmount),477,totalsY-18,8.8,'F2',C.ink);
  c += fillRoundedRect(383,totalsY-54,176,29,6,C.navy);
  c += textCmd('TOTAL',395,totalsY-44,9,'F2',C.white);
  c += textCmd(money(snapshot.totalAmount),460,totalsY-44,10.5,'F2',C.white);

  // Payment / billing contact.
  const infoY=173;
  c += rectCmd(36,infoY,523,78,C.soft,C.border,.5);
  const hasBank=Boolean(issuer.bankName||issuer.bankAccountNo);
  c += textCmd(hasBank?'PAYMENT INFORMATION':'BILLING CONTACT',49,infoY+56,7.5,'F2',C.orange);
  if(hasBank){
    if(issuer.bankName) c += textCmd('Bank',49,infoY+38,7.5,'F1',C.muted);
    if(issuer.bankName) c += textCmd(issuer.bankName,99,infoY+38,8.5,'F2',C.ink);
    if(issuer.bankAccountName) c += textCmd('Account name',49,infoY+24,7.5,'F1',C.muted);
    if(issuer.bankAccountName) c += textCmd(issuer.bankAccountName,112,infoY+24,8.5,'F2',C.ink);
    if(issuer.bankAccountNo) c += textCmd('Account no.',325,infoY+38,7.5,'F1',C.muted);
    if(issuer.bankAccountNo) c += textCmd(issuer.bankAccountNo,386,infoY+38,9,'F2',C.ink);
    c += textCmd('Use invoice number as payment reference.',325,infoY+23,7.5,'F1',C.muted);
  }else{
    c += textCmd(issuer.email,49,infoY+36,9,'F2',C.ink);
    c += textCmd(issuer.phone+'  |  '+issuer.website,49,infoY+20,8,'F1',C.muted);
    c += textCmd('Payment account details are shown when configured in Billing Setup.',318,infoY+30,7.2,'F1',C.muted);
  }

  if(snapshot.tax.taxInvoiceNumber){
    c += textCmd('Tax Invoice',36,145,7.4,'F2',C.muted);
    c += textCmd(snapshot.tax.taxInvoiceNumber,95,145,8.3,'F2',C.ink);
  }
  if(issuer.paymentNotes) c += textCmd(issuer.paymentNotes,36,130,7.5,'F1',C.muted);

  // Footer.
  c += lineCmd(36,91,559,91,.55,C.border);
  c += textCmd(MSG_INVOICE_BRAND.legalName,36,73,7.3,'F2',C.navy);
  c += textCmd(MSG_INVOICE_BRAND.address,36,61,6.8,'F1',C.muted);
  c += textCmd(MSG_INVOICE_BRAND.website,36,49,6.8,'F1',C.muted);
  c += textCmd('Generated securely by',432,72,6.5,'F1',C.muted);
  c += textCmd(MSG_INVOICE_BRAND.productName,432,59,8,'F2',C.navy);
  c += textCmd(MSG_INVOICE_BRAND.productDescriptor,432,48,6.5,'F1',C.orange);

  return buildPdf(c);
}

export async function sha256Hex(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,'0')).join('');
}

export function bytesToBase64(bytes) {
  let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
