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
function textCmd(text,x,y,size=10,font='F1') {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET\n`;
}
function lineCmd(x1,y1,x2,y2,width=.7) {
  return `${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
}
function rectCmd(x,y,w,h,gray=.96,stroke=.82) {
  return `q ${gray} g ${x} ${y} ${w} ${h} re f Q\nq ${stroke} G ${x} ${y} ${w} ${h} re S Q\n`;
}
function rowText(lines,x,y,size=9,lineHeight=12,font='F1') {
  return lines.map((line,index)=>textCmd(line,x,y-(index*lineHeight),size,font)).join('');
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

export function buildInvoiceDocumentSnapshot({invoice,client,project,issuer}) {
  const items=Array.isArray(invoice.items) ? invoice.items : (()=>{try{return JSON.parse(invoice.items||'[]');}catch{return [];}})();
  return {
    version:1,
    invoiceId:String(invoice.id),
    invoiceNumber:String(invoice.invoice_number||invoice.id),
    issueDate:String(invoice.issued_at||invoice.created_at||new Date().toISOString()),
    dueDate:String(invoice.due_date||''),
    period:String(invoice.period||''),
    currency:'IDR',
    issuer:{
      legalName:String(issuer?.legal_name||issuer?.name||'PT Mandiri Semesta Gemilang'),
      address:String(issuer?.address||''),
      npwp:String(issuer?.npwp||''),
      email:String(issuer?.email||''),
      phone:String(issuer?.phone||''),
      bankName:String(issuer?.bank_name||''),
      bankAccountName:String(issuer?.bank_account_name||issuer?.legal_name||''),
      bankAccountNo:String(issuer?.bank_account_no||''),
      paymentNotes:String(issuer?.payment_notes||''),
    },
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
      description:String(item.description||'Service'),
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
  let c='';
  c += rectCmd(36,765,523,48,.95,.88);
  c += textCmd(snapshot.issuer.legalName||'INVOICE',48,793,13,'F2');
  c += textCmd('INVOICE',465,791,20,'F2');
  c += textCmd(snapshot.invoiceNumber,452,775,9,'F1');

  c += textCmd('DARI',36,744,8,'F2');
  c += textCmd(snapshot.issuer.legalName,36,728,10,'F2');
  const issuerLines=wrap(snapshot.issuer.address||'-',58);
  c += rowText(issuerLines.slice(0,3),36,714,8.5,11);
  let issuerMetaY=714-(Math.min(3,issuerLines.length)*11)-3;
  if(snapshot.issuer.npwp) c += textCmd('NPWP: '+snapshot.issuer.npwp,36,issuerMetaY,8.5);
  if(snapshot.issuer.email) c += textCmd(snapshot.issuer.email,36,issuerMetaY-11,8.5);

  c += textCmd('DITAGIHKAN KEPADA',315,744,8,'F2');
  c += textCmd(snapshot.client.name,315,728,10,'F2');
  const clientLines=wrap(snapshot.client.address||'-',43);
  c += rowText(clientLines.slice(0,3),315,714,8.5,11);
  let clientMetaY=714-(Math.min(3,clientLines.length)*11)-3;
  if(snapshot.client.npwp) c += textCmd('NPWP: '+snapshot.client.npwp,315,clientMetaY,8.5);

  c += lineCmd(36,650,559,650,1);
  const meta=[
    ['Tanggal invoice',shortDate(snapshot.issueDate)],
    ['Jatuh tempo',shortDate(snapshot.dueDate)],
    ['Periode',snapshot.period||'-'],
    ['Project',snapshot.project.name||'-'],
    ['PO / Kontrak',snapshot.client.purchaseOrder||'-'],
  ];
  let my=632;
  for(const [label,value] of meta){
    c += textCmd(label,36,my,8,'F1');
    c += textCmd(value,125,my,8.5,'F2');
    my-=14;
  }

  const tableTop=550;
  c += rectCmd(36,tableTop,523,24,.92,.80);
  c += textCmd('DESKRIPSI',45,tableTop+8,8,'F2');
  c += textCmd('QTY',340,tableTop+8,8,'F2');
  c += textCmd('RATE',392,tableTop+8,8,'F2');
  c += textCmd('JUMLAH',492,tableTop+8,8,'F2');
  let y=tableTop-20;
  const rows=snapshot.items.length?snapshot.items:[{description:'Payroll service',quantity:1,rate:snapshot.subtotal,amount:snapshot.subtotal}];
  for(const item of rows.slice(0,8)){
    c += textCmd(wrap(item.description,45)[0],45,y,8.5);
    c += textCmd(String(item.quantity),345,y,8.5);
    c += textCmd(money(item.rate),382,y,8.5);
    c += textCmd(money(item.amount),477,y,8.5,'F2');
    c += lineCmd(36,y-8,559,y-8,.3);
    y-=25;
  }

  const totalsY=Math.max(300,y-4);
  c += textCmd('Subtotal',390,totalsY,9);
  c += textCmd(money(snapshot.subtotal),477,totalsY,9,'F2');
  c += textCmd(`PPN ${Number(snapshot.tax.rate||0)}%`,390,totalsY-18,9);
  c += textCmd(money(snapshot.taxAmount),477,totalsY-18,9,'F2');
  c += lineCmd(386,totalsY-27,559,totalsY-27,.7);
  c += textCmd('TOTAL',390,totalsY-45,11,'F2');
  c += textCmd(money(snapshot.totalAmount),466,totalsY-45,11,'F2');

  const payY=205;
  c += rectCmd(36,payY,523,72,.965,.86);
  c += textCmd('INSTRUKSI PEMBAYARAN',48,payY+52,8,'F2');
  if(snapshot.issuer.bankName) c += textCmd('Bank: '+snapshot.issuer.bankName,48,payY+35,8.5);
  if(snapshot.issuer.bankAccountName) c += textCmd('Atas nama: '+snapshot.issuer.bankAccountName,48,payY+21,8.5);
  if(snapshot.issuer.bankAccountNo) c += textCmd('No. rekening: '+snapshot.issuer.bankAccountNo,300,payY+35,8.5,'F2');
  c += textCmd('Cantumkan nomor invoice pada referensi pembayaran.',300,payY+21,8);

  if(snapshot.tax.taxInvoiceNumber) c += textCmd('Faktur Pajak: '+snapshot.tax.taxInvoiceNumber,36,184,8.5);
  if(snapshot.issuer.paymentNotes) c += textCmd(snapshot.issuer.paymentNotes,36,168,8);
  c += lineCmd(36,84,559,84,.5);
  c += textCmd('Dokumen invoice resmi. Mohon lakukan pembayaran sebelum tanggal jatuh tempo.',36,66,8);
  c += textCmd('Generated by ProQPay · '+snapshot.invoiceNumber,390,66,7.5);
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
