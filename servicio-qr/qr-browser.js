import QRCode from 'qrcode/lib/browser.js';

export function renderQr(code) {
  return QRCode.toDataURL(code,{width:288,margin:3,errorCorrectionLevel:'M'});
}
