import qrcode from './vendor/qrcode.mjs';

export function createTotpQrDataUrl(uri:string){
  const value=String(uri||'').trim();
  if(!value) return '';
  const qr=qrcode(0,'M');
  qr.addData(value,'Byte');
  qr.make();
  return qr.createDataURL(6,24);
}
