/** 业务单号生成：前缀 + 时间戳 + 随机数 */

function stamp(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace(/[-:T]/g, '');
}

function rand(n: number): string {
  let s = '';
  for (let i = 0; i < n; i += 1) s += Math.floor(Math.random() * 10);
  return s;
}

export const newOrderNo = () => `M${stamp()}${rand(4)}`;
export const newPaymentNo = () => `P${stamp()}${rand(4)}`;
export const newRefundNo = () => `R${stamp()}${rand(4)}`;
export const newChangeNo = () => `C${stamp()}${rand(4)}`;
export const newOutTradeNo = () => `OT${stamp()}${rand(6)}`;
export const newTradeNo = () => `TN${stamp()}${rand(6)}`;
export const newRequestId = () => `REQ${Date.now().toString(36).toUpperCase()}${rand(4)}`;
export const newSmsId = () => `SMS${Date.now().toString(36).toUpperCase()}${rand(3)}`;
export const newVerifyCode = () => String(Math.floor(100000 + Math.random() * 900000));
